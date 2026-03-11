// ======================================================
// 🔌 WS-HANDLER.JS v3.1 - DOUBLON FIXÉ
// ======================================================
// Fix :
//  - HOST_REJOIN : host peut se re-connecter après refresh
//  - PLAYER_JOIN : broadcastToGame inclut le host
//  - Logs détaillés pour debug
//  - broadcastToPlayers séparé de broadcastToGame
//  - ✅ ANTI-DOUBLONS sur PLAYER_JOIN
//  - ✅ Utilisation de store.ajouterJoueur()
// ======================================================

const store = require('./store.js');

const PSEUDO_REGEX = /^[a-zA-Z0-9_-]{2,20}$/;

function send(ws, type, payload = {}) {
    if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type, payload }));
    }
}

// Broadcast à TOUS les clients d'une partie (host + joueurs)
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

// Broadcast uniquement aux joueurs (pas au host)
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

// Broadcast uniquement au host
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
                 p.statut !== 'terminee' && p.statut !== 'ended'
        ) || null;
    }
    return null;
}

// ─────────────────────────────────────────────────────

function handleMessage(wss, ws, type, payload) {
    switch (type) {

        // ── HOST_AUTH ──────────────────────────────────
        case 'HOST_AUTH': {
            ws._isHost = true;
            ws._role = 'host';
            send(ws, 'AUTH_OK', { message: 'Host authentifié' });
            console.log('[WS] ✅ HOST_AUTH OK');
            break;
        }

        // ── HOST_REJOIN ────────────────────────────────
        // Appelé après refresh si le host avait une partie active
        case 'HOST_REJOIN': {
            if (!ws._isHost) return send(ws, 'ERROR', { code: 'NOT_HOST' });
            const { partieId } = payload;
            const partie = store.getPartie(partieId);
            if (!partie || partie.statut === 'terminee') {
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
                     p.statut !== 'terminee' && p.statut !== 'ended'
            );
            if (existing) return send(ws, 'ERROR', { code: 'NAME_TAKEN', message: 'Ce nom de partie est déjà pris.' });

            if (ws._partieId) {
                const old = store.getPartie(ws._partieId);
                if (old && old.statut !== 'terminee') {
                    return send(ws, 'ERROR', { code: 'HOST_ALREADY_HAS_GAME' });
                }
            }

            const partie = store.creerPartie({ nom, jeu, mode, equipes: equipes || [], hostJoue: hostJoue || false, hostPseudo: hostPseudo || null });
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
            broadcastToPlayers(wss, partie.id, 'HOST_ACTION', { action, data: data || {} });
            break;
        }

        // ── PLAYER_JOIN ────────────────────────────────
        // 🔥 SECTION CORRIGÉE - ANTI-DOUBLONS
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

            if (['ended', 'terminee'].includes(partie.statut)) {
                console.log(`[WS] ❌ Partie terminée`);
                return send(ws, 'JOIN_ERROR', { code: 'GAME_NOT_FOUND' });
            }

            if (['started', 'en_cours'].includes(partie.statut)) {
                console.log(`[WS] ❌ Partie déjà lancée`);
                return send(ws, 'JOIN_ERROR', { code: 'GAME_STARTED' });
            }

            // ✅ Vérifier les pseudos en cas insensible
            if (partie.joueurs.some(j => j.pseudo.toLowerCase() === pseudo.toLowerCase())) {
                console.log(`[WS] ❌ Pseudo déjà pris: ${pseudo}`);
                return send(ws, 'JOIN_ERROR', { code: 'PSEUDO_TAKEN' });
            }

            // ✅ Vérifier le nombre max
            if (partie.joueurs.length >= (partie.maxJoueurs || 8)) {
                console.log(`[WS] ❌ Partie pleine`);
                return send(ws, 'JOIN_ERROR', { code: 'MAX_PLAYERS' });
            }

            // ✅ Assigner l'équipe
            const equipe = assignerEquipe(partie, pseudo);
            console.log(`[WS] ✅ Équipe assignée: ${equipe || 'aucune'}`);

            // ✅ Créer l'objet joueur
            const joueur = { pseudo, equipe, score: 0, statut: 'connected' };

            // ✅ Utiliser store.ajouterJoueur() (avec protection anti-doublons)
            const result = store.ajouterJoueur(partie.id, joueur);
            if (!result) {
                console.warn(`[WS] ⚠️ Impossible d'ajouter le joueur (peut-être déjà présent)`);
                return send(ws, 'JOIN_ERROR', { code: 'PLAYER_ALREADY_EXISTS' });
            }

            // ✅ Enregistrer les données du socket
            ws._pseudo   = pseudo;
            ws._partieId = partie.id;
            ws._equipe   = equipe;
            ws._role     = 'player';

            // ✅ Enregistrer le socket du joueur dans le store
            store.setJoueurSocket(partie.id, pseudo, ws);

            // ✅ Confirmer au joueur
            send(ws, 'JOIN_OK', {
                pseudo, equipe,
                snapshot: store.snapshotPartie(partie.id),
            });
            console.log(`[WS] ✅ Joueur confirmé: ${pseudo}`);

            // ✅ Notifier TOUT LE MONDE (host inclus) - UNE SEULE FOIS
            const joueursActuels = store.getJoueurs(partie.id);
            console.log(`[WS] 📢 Broadcast PLAYER_JOINED à tous - ${joueursActuels.length} joueurs total`);
            console.log(`[WS]    Joueurs: [${joueursActuels.map(j => j.pseudo).join(', ')}]`);

            broadcastToGame(wss, partie.id, 'PLAYER_JOINED', {
                pseudo,
                equipe,
                joueurs: joueursActuels,
            });

            break;
        }

        // ── PLAYER_ACTION ────────────────���─────────────
        case 'PLAYER_ACTION': {
            if (!ws._partieId) return send(ws, 'ERROR', { code: 'NO_ACTIVE_GAME' });
            const partie = store.getPartie(ws._partieId);
            if (!partie) return send(ws, 'ERROR', { code: 'NO_ACTIVE_GAME' });
            const { action, data } = payload;
            broadcastToHost(wss, ws._partieId, 'PLAYER_ACTION', {
                pseudo: ws._pseudo, equipe: ws._equipe, action, data: data || {},
            });
            break;
        }

        // ── GET_PARTIES ────────────────────────────────
        case 'GET_PARTIES': {
            const parties = store.getAllParties()
                .filter(p => p.statut !== 'terminee' && p.statut !== 'ended')
                .map(p => ({
                    id: p.id, nom: p.nom, jeu: p.jeu, mode: p.mode,
                    statut: p.statut, maxJoueurs: p.maxJoueurs || 8,
                    joueurs: (p.joueurs || []).map(j => ({ pseudo: j.pseudo })),
                }));
            send(ws, 'PARTIES_LIST', { parties });
            break;
        }

        default:
            console.warn(`[WS] ⚠️ Type inconnu: "${type}"`);
    }
}

// ─────────────────────────────────────────────────────

function setupWebSocket(wss) {
    wss.on('connection', (ws) => {
        ws._pseudo   = null;
        ws._equipe   = null;
        ws._partieId = null;
        ws._isHost   = false;
        ws._role     = null;

        ws.on('message', (raw) => {
            let msg;
            try { msg = JSON.parse(raw); } catch { return; }
            const { type, payload = {} } = msg;
            if (!type) return;
            console.log(`[WS] ← ${type}`, JSON.stringify(payload).slice(0, 80));
            try {
                handleMessage(wss, ws, type, payload);
            } catch (err) {
                console.error(`[WS] ❌ Erreur ${type}:`, err);
                send(ws, 'ERROR', { code: 'INTERNAL_ERROR' });
            }
        });

        ws.on('close', () => {
            console.log(`[WS] 🔌 Close: ${ws._pseudo || (ws._isHost ? 'host' : 'anon')}`);

            if (ws._isHost && ws._partieId) {
                broadcastToPlayers(wss, ws._partieId, 'HOST_DISCONNECTED', {
                    message: 'Le host s\'est déconnecté',
                });
                return;
            }

            if (!ws._pseudo || !ws._partieId) return;
            const partie = store.getPartie(ws._partieId);
            if (!partie || partie.statut === 'terminee') return;

            store.retirerJoueur(ws._partieId, ws._pseudo);
            broadcastToGame(wss, ws._partieId, 'PLAYER_LEFT', {
                pseudo: ws._pseudo,
                joueurs: store.getJoueurs(ws._partieId),
            });
            console.log(`[WS] ✅ Joueur retiré: ${ws._pseudo}`);
        });

        ws.on('error', err => console.error('[WS] ❌ Erreur:', err));
    });
}

module.exports = { setupWebSocket };