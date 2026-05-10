// ======================================================
// 🔌 server/ws-handler.js — v6.2 (FIXED — robuste WS)
// ======================================================
// Corrections : gestion erreurs, synchro partieId, INTERNAL_ERROR
// ======================================================

import store from './store.js';
import * as quizHandler from './games/quiz.js';

// ── Handlers de jeux ─────────────────────────────────
const JEU_HANDLERS = {
    quiz: quizHandler,
    // Ajouter ici les futurs handlers :
    // petitbac : petitbacHandler,
    // undercover: undercoverHandler,
};

const PSEUDO_REGEX    = /^[a-zA-Z0-9_-]{2,20}$/;
const GRACE_PERIOD_MS = 120_000; // 2 minutes

// ─────────────────────────────────────────────────────
// HELPERS ENVOI / BROADCAST
// ─────────────────────────────────────────────────────

function send(ws, type, payload = {}) {
    if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type, payload }));
    }
}

function broadcastToGame(wss, partieId, type, payload = {}) {
    let count = 0;
    wss.clients.forEach(c => {
        if (c.readyState === 1 && c._partieId === partieId) {
            c.send(JSON.stringify({ type, payload }));
            count++;
        }
    });
    console.log(`[WS] 📢 broadcast ${type} → ${count} clients (${partieId})`);
}

function broadcastToPlayers(wss, partieId, type, payload = {}) {
    let count = 0;
    wss.clients.forEach(c => {
        if (c.readyState === 1 && !c._isHost && c._partieId === partieId) {
            c.send(JSON.stringify({ type, payload }));
            count++;
        }
    });
    console.log(`[WS] 📢 broadcast (players) ${type} → ${count} clients`);
}

function broadcastToHost(wss, partieId, type, payload = {}) {
    let count = 0;
    wss.clients.forEach(c => {
        if (c.readyState === 1 && c._isHost && c._partieId === partieId) {
            c.send(JSON.stringify({ type, payload }));
            count++;
        }
    });
    console.log(`[WS] 📢 broadcast (host) ${type} → ${count} clients`);
}

const helpers = { broadcastToGame, broadcastToPlayers, broadcastToHost, send };

// ─────────────────────────────────────────────────────
// HELPERS MÉTIER
// ─────────────────────────────────────────────────────

function estStatutTerminal(statut) {
    return statut === 'terminee' || statut === 'ended';
}

function estStatutLobby(statut) {
    return statut === 'lobby' || statut === 'waiting' || statut === 'en_attente';
}

function assignerEquipe(partie, pseudo) {
    if (partie.mode !== 'team' || !partie.equipes?.length) return null;
    const count = {};
    partie.equipes.forEach(eq => { count[eq.nom] = 0; });
    partie.joueurs.forEach(j => {
        if (j.equipe && count[j.equipe] !== undefined) count[j.equipe]++;
    });
    return partie.equipes.reduce(
        (min, eq) => (count[eq.nom] < count[min] ? eq.nom : min),
        partie.equipes[0].nom

    );
}

function trouverPartie(partieId, nomPartie) {
    if (partieId) {
        const p = store.getPartie(partieId);
        if (p) return p;
    }
    if (nomPartie) {
        return store.getAllParties().find(
            p => p.nom.toLowerCase() === nomPartie.toLowerCase() &&
                 !estStatutTerminal(p.statut)
        ) || null;
    }
    return null;
}

function getGameState(partieId, jeu) {
    const handler = JEU_HANDLERS[jeu];
    if (!handler?.getSessionState) return null;
    try { return handler.getSessionState(partieId); }
    catch (err) { console.error(`[WS] getGameState erreur (${jeu}):`, err.message); return null; }
}

// ── URL de rejointe adaptée à l'arborescence V2 ──────
// Pattern : /jeu?partieId=...&pseudo=...&role=...
// L'hôte construit le lien dans main.js (ou host.js pour les
// parties créées depuis la page dédiée) en ajoutant &pseudo=...
function buildJoinUrl(partie) {
    const params = new URLSearchParams({
        partieId  : partie.id,
        partieNom : partie.nom || '',
        jeu       : partie.jeu || '',
        createdAt : partie.createdAt ? new Date(partie.createdAt).getTime() : Date.now(),
    });
    if (partie.codeCourt) params.set('code', partie.codeCourt);
    return `/jeu?${params.toString()}`;
}

// ─────────────────────────────────────────────────────
// HANDLER PRINCIPAL
// ─────────────────────────────────────────────────────

function handleMessage(wss, ws, type, payload) {
    switch (type) {

        // ── HOST_AUTH ──────────────────────────────────
        case 'HOST_AUTH': {
            ws._isHost = true;
            ws._role   = 'host';
            send(ws, 'AUTH_OK', { message: 'Host authentifié' });
            console.log('[WS] ✅ HOST_AUTH OK');
            break;
        }

        // ── HOST_REJOIN ────────────────────────────────
        case 'HOST_REJOIN': {
            if (!ws._isHost) return send(ws, 'ERROR', { code: 'NOT_HOST' });
            const { partieId } = payload;
            const partie = store.getPartie(partieId);
            if (!partie || estStatutTerminal(partie.statut)) {
                return send(ws, 'ERROR', { code: 'GAME_NOT_FOUND' });
            }
            ws._partieId = partieId;
            store.setHostSocket(partieId, ws);

            const gameState = getGameState(partieId, partie.jeu);
            send(ws, 'HOST_REJOINED', {
                partieId,
                snapshot  : store.snapshotPartie(partieId),
                gameState : gameState || null,
                joinUrl   : buildJoinUrl(partie),
            });
            console.log(`[WS] ✅ HOST_REJOIN OK → "${partie.nom}" (${partieId})`);
            break;
        }

        // ── HOST_CREATE_GAME ───────────────────────────
        case 'HOST_CREATE_GAME': {
            if (!ws._isHost) return send(ws, 'ERROR', { code: 'NOT_HOST' });
            const { nom, jeu, mode, equipes, hostJoue, hostPseudo } = payload;
            if (!nom || !jeu || !mode) return send(ws, 'ERROR', { code: 'MISSING_FIELDS' });

            const existing = store.getAllParties().find(
                p => p.nom.toLowerCase() === nom.toLowerCase() && !estStatutTerminal(p.statut)
            );
            if (existing) return send(ws, 'ERROR', { code: 'NAME_TAKEN', message: 'Ce nom est déjà pris.' });

            if (ws._partieId) {
                const old = store.getPartie(ws._partieId);
                if (old && !estStatutTerminal(old.statut)) {
                    return send(ws, 'ERROR', { code: 'HOST_ALREADY_HAS_GAME' });
                }
            }

            const partie = store.creerPartie({
                nom, jeu, mode,
                equipes    : equipes || [],
                hostJoue   : hostJoue   || false,
                hostPseudo : hostPseudo || null,

            });

            if (hostJoue && hostPseudo && PSEUDO_REGEX.test(hostPseudo)) {
                const equipe = assignerEquipe(partie, hostPseudo);
                store.ajouterJoueur(partie.id, {
                    pseudo : hostPseudo,
                    equipe : equipe || null,
                    statut : 'host-player',
                });
            }

            ws._partieId = partie.id;
            store.setHostSocket(partie.id, ws);

            // Générer le code court immédiatement
            const code = store.genererCodeCourt(partie.id);

            send(ws, 'GAME_CREATED', {
                partieId : partie.id,
                snapshot : store.snapshotPartie(partie.id),
                joinUrl  : buildJoinUrl(partie),
            });

            // [v6.1] Broadcaster le code court séparément
            // → host.js V3 écoute socket.on('CODE_GENERATED')
            // → main.js V2 peut aussi l'écouter via HostSession
            if (code) {
                send(ws, 'CODE_GENERATED', { code, partieId: partie.id });
            }

            console.log(`[WS] ✅ GAME_CREATED "${partie.nom}" → ${partie.id} (code: ${code})`);
            break;
        }

        // ── HOST_START_GAME ────────────────────────────
        case 'HOST_START_GAME': {
            if (!ws._isHost) return send(ws, 'ERROR', { code: 'NOT_HOST' });
            const partie = store.getPartie(ws._partieId);
            if (!partie) return send(ws, 'ERROR', { code: 'NO_ACTIVE_GAME' });

            if (partie.hostJoue && partie.hostPseudo) {
                const dejaDedans = partie.joueurs.some(
                    j => j.pseudo.toLowerCase() === partie.hostPseudo.toLowerCase()
                );
                if (!dejaDedans) {
                    const equipe = assignerEquipe(partie, partie.hostPseudo);
                    store.ajouterJoueur(partie.id, {
                        pseudo : partie.hostPseudo,
                        equipe : equipe || null,
                        statut : 'host-player',
                    });
                }
            }

            // Rafraîchir _joinedAt → fenêtre de grâce pour navigation
            wss.clients.forEach(c => {
                if (c._partieId === partie.id && !c._isHost && c._pseudo) {
                    c._joinedAt = Date.now();
                }
            });

            store.setStatut(partie.id, 'en_cours');
            broadcastToGame(wss, partie.id, 'GAME_STARTED', {
                snapshot : store.snapshotPartie(partie.id),
                joinUrl  : buildJoinUrl(partie),
            });
            console.log(`[WS] ✅ GAME_STARTED "${partie.nom}"`);
            break;
        }

        // ── HOST_END_GAME ──────────────────────────────
        case 'HOST_END_GAME': {
            if (!ws._isHost) return send(ws, 'ERROR', { code: 'NOT_HOST' });
            const partie = store.getPartie(ws._partieId);
            if (!partie) return send(ws, 'ERROR', { code: 'NO_ACTIVE_GAME' });

            const snapshot      = store.snapshotPartie(partie.id);
            const jeuHandlerEnd = JEU_HANDLERS[partie.jeu];
            if (jeuHandlerEnd?.detruireSession) jeuHandlerEnd.detruireSession(partie.id);

            store.terminerPartie(partie.id);
            broadcastToGame(wss, partie.id, 'GAME_ENDED', { snapshot });
            ws._partieId = null;
            console.log('[WS] ✅ GAME_ENDED');
            break;
        }

        // ── HOST_ADD/REMOVE_POINTS ─────────────────────
        case 'HOST_ADD_POINTS':
        case 'HOST_REMOVE_POINTS': {
            if (!ws._isHost) return send(ws, 'ERROR', { code: 'NOT_HOST' });
            const partie = store.getPartie(ws._partieId);
            if (!partie) return send(ws, 'ERROR', { code: 'NO_ACTIVE_GAME' });
            const { cible, points } = payload;
            if (!cible) return send(ws, 'ERROR', { code: 'MISSING_FIELDS' });
            const delta = type === 'HOST_ADD_POINTS' ? Math.abs(points || 1) : -Math.abs(points || 1);
            store.modifierScore(partie.id, cible, delta);
            broadcastToGame(wss, partie.id, 'SCORES_UPDATE', { scores: store.getScores(partie.id) });
            break;
        }

        // ── HOST_KICK_PLAYER ───────────────────────────
        case 'HOST_KICK_PLAYER': {
            if (!ws._isHost) return send(ws, 'ERROR', { code: 'NOT_HOST' });
            const partie = store.getPartie(ws._partieId);
            if (!partie) return send(ws, 'ERROR', { code: 'NO_ACTIVE_GAME' });
            const { pseudo } = payload;
            if (!pseudo) return send(ws, 'ERROR', { code: 'MISSING_FIELDS' });

            store.retirerJoueur(partie.id, pseudo);
            wss.clients.forEach(c => {
                if (c._pseudo === pseudo && c._partieId === partie.id && c.readyState === 1) {
                    c._kicked = true;
                    send(c, 'KICKED', { reason: 'Expulsé par le host' });
                }
            });
            broadcastToGame(wss, partie.id, 'PLAYER_LEFT', {
                pseudo,
                joueurs : store.getJoueurs(partie.id),
            });
            console.log(`[WS] ✅ HOST_KICK_PLAYER: ${pseudo}`);
            break;
        }

        // ── HOST_ACTION ────────────────────────────────
        case 'HOST_ACTION': {
            if (!ws._isHost) return send(ws, 'ERROR', { code: 'NOT_HOST' });
            const partie = store.getPartie(ws._partieId);
            if (!partie) return send(ws, 'ERROR', { code: 'NO_ACTIVE_GAME' });
            const { action, data } = payload;
            if (!action) return send(ws, 'ERROR', { code: 'MISSING_FIELDS' });

            const jeuPrefixe = (action || '').split(':')[0];
            const jeuHandler = JEU_HANDLERS[jeuPrefixe] || JEU_HANDLERS[partie.jeu];
            if (jeuHandler && action.includes(':')) {
                jeuHandler.handleHostAction(wss, ws, partie.id, action, data || {}, helpers);
            } else {
                broadcastToPlayers(wss, partie.id, 'HOST_ACTION', { action, data: data || {} });
            }
            break;
        }

        // ── PLAYER_JOIN ────────────────────────────────
        case 'PLAYER_JOIN': {
            const { pseudo, partieId, nomPartie } = payload;
            console.log(`[WS] 🔹 PLAYER_JOIN demande: ${pseudo}`);

            if (!pseudo || !PSEUDO_REGEX.test(pseudo)) {
                return send(ws, 'JOIN_ERROR', { code: 'PSEUDO_INVALID' });
            }

            const partie = trouverPartie(partieId, nomPartie);
            if (!partie) return send(ws, 'JOIN_ERROR', { code: 'GAME_NOT_FOUND' });
            if (estStatutTerminal(partie.statut)) return send(ws, 'JOIN_ERROR', { code: 'GAME_NOT_FOUND' });

            // Partie en cours → rejoin si pseudo connu, sinon refus
            if (partie.statut === 'en_cours') {
                const joueurExistant = partie.joueurs.find(
                    j => j.pseudo.toLowerCase() === pseudo.toLowerCase()
                );
                if (joueurExistant) {
                    ws._pseudo   = joueurExistant.pseudo;
                    ws._partieId = partie.id;
                    ws._equipe   = joueurExistant.equipe;
                    ws._role     = 'player';
                    ws._kicked   = false;
                    ws._joinedAt = Date.now();
                    store.setJoueurSocket(partie.id, joueurExistant.pseudo, ws);

                    const gameState = getGameState(partie.id, partie.jeu);
                    send(ws, 'REJOIN_OK', {
                        pseudo    : joueurExistant.pseudo,
                        equipe    : joueurExistant.equipe,
                        snapshot  : store.snapshotPartie(partie.id),
                        gameState : gameState || null,
                    });
                    broadcastToHost(wss, partie.id, 'PLAYER_RECONNECTED', { pseudo });
                    return;
                }
                return send(ws, 'JOIN_ERROR', { code: 'GAME_STARTED' });
            }

            if (!estStatutLobby(partie.statut)) {
                // La partie est en cours et le pseudo n'est pas dans la liste.
                // Retourner GAME_STARTED (plus précis que GAME_NOT_FOUND)
                // pour que l'invité sache que la partie existe mais a déjà commencé.
                return send(ws, 'JOIN_ERROR', { code: 'GAME_STARTED' });
            }
            if (partie.joueurs.some(j => j.pseudo.toLowerCase() === pseudo.toLowerCase())) {
                return send(ws, 'JOIN_ERROR', { code: 'PSEUDO_TAKEN' });
            }
            if (partie.joueurs.length >= (partie.maxJoueurs || 8)) {
                return send(ws, 'JOIN_ERROR', { code: 'MAX_PLAYERS' });
            }

            const equipe = assignerEquipe(partie, pseudo);
            const result = store.ajouterJoueur(partie.id, { pseudo, equipe, statut: 'connected' });
            if (!result) return send(ws, 'JOIN_ERROR', { code: 'PLAYER_ALREADY_EXISTS' });

            ws._pseudo   = pseudo;
            ws._partieId = partie.id;
            ws._equipe   = equipe;
            ws._role     = 'player';
            ws._kicked   = false;
            ws._joinedAt = Date.now();
            store.setJoueurSocket(partie.id, pseudo, ws);

            send(ws, 'JOIN_OK', {
                pseudo,
                equipe,
                snapshot : store.snapshotPartie(partie.id),
                joinUrl  : buildJoinUrl(partie),
            });

            broadcastToGame(wss, partie.id, 'PLAYER_JOINED', {
                pseudo,
                equipe,
                joueurs : store.getJoueurs(partie.id),
            });
            console.log(`[WS] ✅ Joueur confirmé: ${pseudo}`);
            break;
        }

        // ── PLAYER_REJOIN ──────────────────────────────
        case 'PLAYER_REJOIN': {
            const { pseudo, partieId } = payload;
            if (!pseudo || !partieId) return send(ws, 'JOIN_ERROR', { code: 'MISSING_FIELDS' });

            const partie = store.getPartie(partieId);
            if (!partie || estStatutTerminal(partie.statut)) {
                return send(ws, 'JOIN_ERROR', { code: 'GAME_NOT_FOUND' });
            }

            const joueurExistant = partie.joueurs.find(
                j => j.pseudo.toLowerCase() === pseudo.toLowerCase()
            );
            if (!joueurExistant) {
                return send(ws, 'JOIN_ERROR', { code: 'PLAYER_NOT_FOUND' });
            }

            ws._pseudo   = joueurExistant.pseudo;
            ws._partieId = partieId;
            ws._equipe   = joueurExistant.equipe;
            ws._role     = 'player';
            ws._kicked   = false;
            ws._joinedAt = Date.now();
            store.setJoueurSocket(partieId, joueurExistant.pseudo, ws);

            const gameState = getGameState(partieId, partie.jeu);
            send(ws, 'REJOIN_OK', {
                pseudo    : joueurExistant.pseudo,
                equipe    : joueurExistant.equipe,
                snapshot  : store.snapshotPartie(partieId),
                gameState : gameState || null,
            });
            console.log(`[WS] ✅ PLAYER_REJOIN OK: ${joueurExistant.pseudo}`);
            break;
        }

        // ── PLAYER_ACTION ──────────────────────────────
        case 'PLAYER_ACTION': {
            if (!ws._partieId) return send(ws, 'ERROR', { code: 'NO_ACTIVE_GAME' });
            const partie = store.getPartie(ws._partieId);
            if (!partie) return send(ws, 'ERROR', { code: 'NO_ACTIVE_GAME' });
            const { action, data } = payload;

            const jeuPrefixePl = (action || '').split(':')[0];
            const jeuHandlerPl = JEU_HANDLERS[jeuPrefixePl] || JEU_HANDLERS[partie.jeu];
            if (jeuHandlerPl && action.includes(':')) {
                jeuHandlerPl.handlePlayerAction(
                    wss, ws, partie.id, ws._pseudo, action, data || {}, helpers
                );
            } else {
                broadcastToHost(wss, ws._partieId, 'PLAYER_ACTION', {
                    pseudo : ws._pseudo,
                    equipe : ws._equipe,
                    action,
                    data   : data || {},
                });
            }
            break;
        }

        // ── GET_PARTIES ────────────────────────────────
        case 'GET_PARTIES': {
            const parties = store.getAllParties()
                .filter(p => !estStatutTerminal(p.statut))
                .map(p => ({
                    id         : p.id,
                    nom        : p.nom,
                    jeu        : p.jeu,
                    mode       : p.mode,
                    statut     : p.statut,
                    maxJoueurs : p.maxJoueurs || 8,
                    joueurs    : (p.joueurs || []).map(j => ({ pseudo: j.pseudo })),
                    joinUrl    : buildJoinUrl(p),
                }));
            send(ws, 'PARTIES_LIST', { parties });
            break;
        }

        default:
            console.warn(`[WS] ⚠️ Message inconnu: "${type}"`);
    }
}

// ─────────────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────────────

export function setupWebSocket(wss) {
    wss.on('connection', ws => {
        ws._pseudo   = null;
        ws._equipe   = null;
        ws._partieId = null;
        ws._isHost   = false;
        ws._role     = null;
        ws._joinedAt = null;
        ws._kicked   = false;

        ws.on('message', raw => {
            let msg;
            try { msg = JSON.parse(raw); } catch { return; }
            const { type, payload = {} } = msg;
            if (!type) return;
            console.log(`[WS] ← ${type}`, JSON.stringify(payload).slice(0, 80));
            try {
                handleMessage(wss, ws, type, payload);
            } catch (err) {
                console.error(`[WS] ❌ Erreur handler ${type}:`, err);
                send(ws, 'ERROR', { code: 'INTERNAL_ERROR' });
            }
        });

        ws.on('close', () => {
            const label = ws._pseudo || (ws._isHost ? 'host' : 'anon');
            console.log(`[WS] 🔌 Close: ${label}`);

            if (ws._isHost && ws._partieId) {
                broadcastToPlayers(wss, ws._partieId, 'HOST_DISCONNECTED', {
                    message: "Le host s'est déconnecté",
                });
                return;
            }

            if (!ws._pseudo || !ws._partieId) return;
            if (ws._kicked) { console.log(`[WS] ✅ Close ignoré — kick: ${ws._pseudo}`); return; }

            if (ws._joinedAt !== null && Date.now() - ws._joinedAt < GRACE_PERIOD_MS) {
                console.log(`[WS] ⏳ Close ignoré — grâce (${Math.round((Date.now() - ws._joinedAt) / 1000)}s): ${ws._pseudo}`);
                return;
            }

            const partie = store.getPartie(ws._partieId);
            if (!partie || estStatutTerminal(partie.statut)) {
                console.log(`[WS] ✅ Close ignoré — partie terminée: ${ws._pseudo}`);
                return;
            }

            store.retirerJoueur(ws._partieId, ws._pseudo);
            broadcastToGame(wss, ws._partieId, 'PLAYER_LEFT', {
                pseudo  : ws._pseudo,
                joueurs : store.getJoueurs(ws._partieId),
            });
            console.log(`[WS] ✅ Joueur retiré: ${ws._pseudo}`);
        });

        ws.on('error', err => console.error('[WS] ❌ Erreur socket:', err));
    });
}