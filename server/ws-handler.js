// ======================================================
// 🔌 WS-HANDLER.JS v3.2 — BUG FIX PLAYER_LEFT INTEMPESTIF
// ======================================================
// Corrections v3.2 :
//
//   BUG #1 CORRIGÉ — ws.on('close') : statut terminal incomplet
//   ─────────────────────────────────────────────────────────────
//   Avant : if (!partie || partie.statut === 'terminee') return;
//   Le code ne filtrait que 'terminee' et ignorait 'ended'.
//   Si la partie était en statut 'ended', retirerJoueur() était appelé
//   et PLAYER_LEFT était broadcasté → l'host voyait le joueur disparaître.
//   → Corrigé avec la fonction estStatutTerminal() qui couvre les deux.
//
//   BUG #2 CORRIGÉ — Délai de grâce après JOIN_OK (cause principale)
//   ─────────────────────────────────────────────────────────────────
//   Quand le joueur rejoint depuis /join/, il reçoit JOIN_OK puis son
//   navigateur redirige vers /games/xxx/. Cette navigation ferme le
//   socket WebSocket de la page /join/. Sans protection, le serveur
//   appelait immédiatement retirerJoueur() + broadcast PLAYER_LEFT,
//   et l'host voyait le joueur disparaître de la liste d'attente.
//   → Ajout de ws._joinedAt : si le close arrive dans les 15s après un
//     JOIN_OK, on l'ignore. La page du jeu enverra PLAYER_REJOIN pour
//     ré-enregistrer le socket sans toucher à la liste des joueurs.
//
//   BUG #3 CORRIGÉ — Double traitement après HOST_KICK_PLAYER
//   ─────────────────────────────────────────────────────────────────
//   Après un kick, le close du socket du joueur déclenchait un 2e
//   PLAYER_LEFT. → Ajout de ws._kicked pour bloquer ce double traitement.
//
//   NOUVEAU : PLAYER_REJOIN
//   ─────────────────────────────────────────────────────────────────
//   Message envoyé par la page du jeu au chargement pour ré-enregistrer
//   le socket du joueur sans le retirer/ré-ajouter à la liste.
// ======================================================

'use strict';

const store = require('./store.js');

// ── Modules de jeux ───────────────────────────────────
// Chaque jeu expose handleHostAction() et handlePlayerAction()
// Ils sont appelés depuis HOST_ACTION / PLAYER_ACTION quand
// l'action commence par le préfixe du jeu (ex: "quiz:*")
const quizHandler = require('./games/quiz.js');

const JEU_HANDLERS = {
    quiz: quizHandler,
    // justeprix: require('./games/justeprix.js'),
    // undercover: require('./games/undercover.js'),
    // etc.
};

const PSEUDO_REGEX = /^[a-zA-Z0-9_-]{2,20}$/;

// Délai de grâce (ms) après JOIN_OK pendant lequel ws.on('close') est ignoré.
// Le joueur est en train de naviguer depuis /join/ vers la page du jeu.
const GRACE_PERIOD_MS = 15000;

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
    console.log(`[WS] 📢 broadcast ${type} → ${count} clients (partieId=${partieId})`);
}

function broadcastToPlayers(wss, partieId, type, payload = {}) {
    let count = 0;
    wss.clients.forEach(c => {
        if (c.readyState === 1 && !c._isHost && c._partieId === partieId) {
            c.send(JSON.stringify({ type, payload }));
            count++;
        }
    });
    console.log(`[WS] 📢 broadcast (players only) ${type} → ${count} clients`);
}

function broadcastToHost(wss, partieId, type, payload = {}) {
    let count = 0;
    wss.clients.forEach(c => {
        if (c.readyState === 1 && c._isHost && c._partieId === partieId) {
            c.send(JSON.stringify({ type, payload }));
            count++;
        }
    });
    console.log(`[WS] 📢 broadcast (host only) ${type} → ${count} clients`);
}

// ─────────────────────────────────────────────────────
// HELPERS MÉTIER
// ─────────────────────────────────────────────────────

// ✅ Centralise la vérification des statuts terminaux
function estStatutTerminal(statut) {
    return statut === 'terminee' || statut === 'ended';
}

function assignerEquipe(partie, pseudo) {
    if (partie.mode !== 'team' || !partie.equipes?.length) return null;
    const count = {};
    partie.equipes.forEach(eq => { count[eq.nom] = 0; });
    partie.joueurs.forEach(j => {
        if (j.equipe && count[j.equipe] !== undefined) count[j.equipe]++;
    });
    return partie.equipes.reduce((min, eq) =>
        count[eq.nom] < count[min] ? eq.nom : min,
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
            send(ws, 'HOST_REJOINED', {
                partieId,
                snapshot: store.snapshotPartie(partieId),
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
                p => p.nom.toLowerCase() === nom.toLowerCase() &&
                     !estStatutTerminal(p.statut)
            );
            if (existing) {
                return send(ws, 'ERROR', { code: 'NAME_TAKEN', message: 'Ce nom de partie est déjà pris.' });
            }

            if (ws._partieId) {
                const old = store.getPartie(ws._partieId);
                if (old && !estStatutTerminal(old.statut)) {
                    return send(ws, 'ERROR', { code: 'HOST_ALREADY_HAS_GAME' });
                }
            }

            const partie = store.creerPartie({
                nom, jeu, mode,
                equipes:    equipes    || [],
                hostJoue:   hostJoue   || false,
                hostPseudo: hostPseudo || null,
            });
            ws._partieId = partie.id;
            store.setHostSocket(partie.id, ws);

            send(ws, 'GAME_CREATED', {
                partieId: partie.id,
                snapshot: store.snapshotPartie(partie.id),
            });
            console.log(`[WS] ✅ GAME_CREATED "${partie.nom}" → ${partie.id}`);
            break;
        }

        // ── HOST_START_GAME ────────────────────────────
        case 'HOST_START_GAME': {
            if (!ws._isHost) return send(ws, 'ERROR', { code: 'NOT_HOST' });
            const partie = store.getPartie(ws._partieId);
            if (!partie) return send(ws, 'ERROR', { code: 'NO_ACTIVE_GAME' });

            store.setStatut(partie.id, 'en_cours');
            broadcastToGame(wss, partie.id, 'GAME_STARTED', {
                snapshot: store.snapshotPartie(partie.id),
            });
            console.log(`[WS] ✅ GAME_STARTED "${partie.nom}"`);
            break;
        }

        // ── HOST_END_GAME ──────────────────────────────
        case 'HOST_END_GAME': {
            if (!ws._isHost) return send(ws, 'ERROR', { code: 'NOT_HOST' });
            const partie = store.getPartie(ws._partieId);
            if (!partie) return send(ws, 'ERROR', { code: 'NO_ACTIVE_GAME' });

            const snapshot = store.snapshotPartie(partie.id);
            // Nettoyer la session de jeu si elle existe
            const jeuHandlerEnd = JEU_HANDLERS[partie.jeu];
            if (jeuHandlerEnd?.detruireSession) {
                jeuHandlerEnd.detruireSession(partie.id);
            }
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

            // ✅ Marquer _kicked AVANT d'envoyer KICKED pour éviter le double
            // traitement dans ws.on('close') quand le socket du joueur se ferme
            wss.clients.forEach(c => {
                if (c._pseudo === pseudo && c._partieId === partie.id && c.readyState === 1) {
                    c._kicked = true;
                    send(c, 'KICKED', { reason: 'Expulsé par le host' });
                }
            });

            broadcastToGame(wss, partie.id, 'PLAYER_LEFT', {
                pseudo,
                joueurs: store.getJoueurs(partie.id),
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

            // Routing vers le module jeu si l'action contient un préfixe "jeu:*"
            const jeuPrefixe = (action || '').split(':')[0];
            const jeuHandler = JEU_HANDLERS[jeuPrefixe] || JEU_HANDLERS[partie.jeu];
            if (jeuHandler && action.includes(':')) {
                jeuHandler.handleHostAction(wss, ws, partie.id, action, data || {}, {
                    broadcastToGame, broadcastToPlayers, broadcastToHost, send,
                });
            } else {
                // Fallback : relayer aux joueurs (comportement générique)
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
            if (!partie) {
                console.log(`[WS] ❌ Partie non trouvée`);
                return send(ws, 'JOIN_ERROR', { code: 'GAME_NOT_FOUND' });
            }

            console.log(`[WS] 🔹 Partie trouvée: "${partie.nom}" (${partie.id})`);

            if (estStatutTerminal(partie.statut)) {
                console.log(`[WS] ❌ Partie terminée`);
                return send(ws, 'JOIN_ERROR', { code: 'GAME_NOT_FOUND' });
            }

            if (partie.statut === 'en_cours' || partie.statut === 'started') {
                console.log(`[WS] ❌ Partie déjà lancée`);
                return send(ws, 'JOIN_ERROR', { code: 'GAME_STARTED' });
            }

            if (partie.joueurs.some(j => j.pseudo.toLowerCase() === pseudo.toLowerCase())) {
                console.log(`[WS] ❌ Pseudo déjà pris: ${pseudo}`);
                return send(ws, 'JOIN_ERROR', { code: 'PSEUDO_TAKEN' });
            }

            if (partie.joueurs.length >= (partie.maxJoueurs || 8)) {
                console.log(`[WS] ❌ Partie pleine`);
                return send(ws, 'JOIN_ERROR', { code: 'MAX_PLAYERS' });
            }

            const equipe = assignerEquipe(partie, pseudo);
            console.log(`[WS] ✅ Équipe assignée: ${equipe || 'aucune'}`);

            const joueur = { pseudo, equipe, score: 0, statut: 'connected' };

            const result = store.ajouterJoueur(partie.id, joueur);
            if (!result) {
                console.warn(`[WS] ⚠️ Impossible d'ajouter le joueur (déjà présent)`);
                return send(ws, 'JOIN_ERROR', { code: 'PLAYER_ALREADY_EXISTS' });
            }

            // ✅ Enregistrer les métadonnées sur le socket
            ws._pseudo   = pseudo;
            ws._partieId = partie.id;
            ws._equipe   = equipe;
            ws._role     = 'player';
            ws._kicked   = false;
            ws._joinedAt = Date.now(); // ← timestamp pour le délai de grâce

            store.setJoueurSocket(partie.id, pseudo, ws);

            send(ws, 'JOIN_OK', {
                pseudo,
                equipe,
                snapshot: store.snapshotPartie(partie.id),
            });
            console.log(`[WS] ✅ Joueur confirmé: ${pseudo}`);

            const joueursActuels = store.getJoueurs(partie.id);
            console.log(`[WS] 📢 Broadcast PLAYER_JOINED — ${joueursActuels.length} joueurs total`);
            console.log(`[WS]    Liste: [${joueursActuels.map(j => j.pseudo).join(', ')}]`);

            broadcastToGame(wss, partie.id, 'PLAYER_JOINED', {
                pseudo,
                equipe,
                joueurs: joueursActuels,
            });

            break;
        }

        // ── PLAYER_REJOIN ──────────────────────────────
        // Envoyé par la page du jeu (/games/xxx/) au chargement.
        // Permet de ré-enregistrer le socket du joueur après sa navigation
        // depuis /join/ sans le retirer puis le re-ajouter à la liste.
        case 'PLAYER_REJOIN': {
            const { pseudo, partieId } = payload;
            if (!pseudo || !partieId) {
                return send(ws, 'JOIN_ERROR', { code: 'MISSING_FIELDS' });
            }

            const partie = store.getPartie(partieId);
            if (!partie || estStatutTerminal(partie.statut)) {
                return send(ws, 'JOIN_ERROR', { code: 'GAME_NOT_FOUND' });
            }

            // Vérifier que le joueur est bien dans la liste
            const joueurExistant = partie.joueurs.find(
                j => j.pseudo.toLowerCase() === pseudo.toLowerCase()
            );
            if (!joueurExistant) {
                // Le joueur n'est pas (ou plus) dans la liste → JOIN normal
                console.log(`[WS] ℹ️ PLAYER_REJOIN: joueur ${pseudo} absent → fallback JOIN`);
                return send(ws, 'JOIN_ERROR', { code: 'PLAYER_NOT_FOUND' });
            }

            // Mettre à jour le socket sans toucher à la liste
            ws._pseudo   = joueurExistant.pseudo;
            ws._partieId = partieId;
            ws._equipe   = joueurExistant.equipe;
            ws._role     = 'player';
            ws._kicked   = false;
            ws._joinedAt = Date.now();
            store.setJoueurSocket(partieId, joueurExistant.pseudo, ws);

            send(ws, 'REJOIN_OK', {
                pseudo:   joueurExistant.pseudo,
                equipe:   joueurExistant.equipe,
                snapshot: store.snapshotPartie(partieId),
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

            // Routing vers le module jeu si l'action contient un préfixe "jeu:*"
            const jeuPrefixePl = (action || '').split(':')[0];
            const jeuHandlerPl = JEU_HANDLERS[jeuPrefixePl] || JEU_HANDLERS[partie.jeu];
            if (jeuHandlerPl && action.includes(':')) {
                jeuHandlerPl.handlePlayerAction(wss, ws, partie.id, ws._pseudo, action, data || {}, {
                    broadcastToGame, broadcastToPlayers, broadcastToHost, send,
                });
            } else {
                // Fallback : relayer au host (comportement générique)
                broadcastToHost(wss, ws._partieId, 'PLAYER_ACTION', {
                    pseudo: ws._pseudo, equipe: ws._equipe, action, data: data || {},
                });
            }
            break;
        }

        // ── GET_PARTIES ────────────────────────────────
        case 'GET_PARTIES': {
            const parties = store.getAllParties()
                .filter(p => !estStatutTerminal(p.statut))
                .map(p => ({
                    id:         p.id,
                    nom:        p.nom,
                    jeu:        p.jeu,
                    mode:       p.mode,
                    statut:     p.statut,
                    maxJoueurs: p.maxJoueurs || 8,
                    joueurs:    (p.joueurs || []).map(j => ({ pseudo: j.pseudo })),
                }));
            send(ws, 'PARTIES_LIST', { parties });
            break;
        }

        default:
            console.warn(`[WS] ⚠️ Type de message inconnu: "${type}"`);
    }
}

// ─────────────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────────────

function setupWebSocket(wss) {
    wss.on('connection', (ws) => {
        // Initialisation de toutes les propriétés du socket
        ws._pseudo   = null;
        ws._equipe   = null;
        ws._partieId = null;
        ws._isHost   = false;
        ws._role     = null;
        ws._joinedAt = null;  // ✅ timestamp JOIN_OK pour délai de grâce
        ws._kicked   = false; // ✅ flag kick explicite pour éviter double PLAYER_LEFT

        ws.on('message', (raw) => {
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

            // ── Cas 1 : host déconnecté ──────────────────────────────
            if (ws._isHost && ws._partieId) {
                broadcastToPlayers(wss, ws._partieId, 'HOST_DISCONNECTED', {
                    message: 'Le host s\'est déconnecté',
                });
                return;
            }

            // ── Cas 2 : socket non identifié ────────────────────────
            if (!ws._pseudo || !ws._partieId) return;

            // ── Cas 3 : joueur expulsé explicitement ─────────────────
            // Le PLAYER_LEFT a déjà été broadcasté dans HOST_KICK_PLAYER
            if (ws._kicked) {
                console.log(`[WS] ✅ Close ignoré — expulsion déjà traitée: ${ws._pseudo}`);
                return;
            }

            // ── Cas 4 : délai de grâce post-JOIN_OK ──────────────────
            // Le socket /join/ se ferme quand le joueur navigue vers /games/xxx/.
            // On ignore ce close : la page du jeu enverra PLAYER_REJOIN.
            if (ws._joinedAt !== null && (Date.now() - ws._joinedAt) < GRACE_PERIOD_MS) {
                console.log(`[WS] ⏳ Close ignoré — joueur en navigation vers le jeu: ${ws._pseudo} (${Date.now() - ws._joinedAt}ms après JOIN_OK)`);
                return;
            }

            // ── Cas 5 : partie déjà terminée ────────────────────────
            const partie = store.getPartie(ws._partieId);
            if (!partie || estStatutTerminal(partie.statut)) {
                console.log(`[WS] ✅ Close ignoré — partie terminée: ${ws._pseudo}`);
                return;
            }

            // ── Cas 6 : déconnexion réelle ───────────────────────────
            store.retirerJoueur(ws._partieId, ws._pseudo);
            broadcastToGame(wss, ws._partieId, 'PLAYER_LEFT', {
                pseudo:  ws._pseudo,
                joueurs: store.getJoueurs(ws._partieId),
            });
            console.log(`[WS] ✅ Joueur retiré (déconnexion réelle): ${ws._pseudo}`);
        });

        ws.on('error', err => console.error('[WS] ❌ Erreur socket:', err));
    });
}

module.exports = { setupWebSocket };