// ======================================================
// 🔌 WS-HANDLER.JS v2 — Gestionnaire WebSocket (corrigé)
// ======================================================
// Fix :
//  - PLAYER_JOIN accepte partieId OU nomPartie (recherche par nom exact)
//  - Logs améliorés
//  - Gestion déconnexion host : notifie les joueurs
// ======================================================

const store = require('./store.js');

const ERROR_CODES = {
    NOT_HOST: 'Vous n\'êtes pas host.',
    PSEUDO_INVALID: 'Pseudo invalide.',
    GAME_NOT_FOUND: 'Partie introuvable.',
    GAME_STARTED: 'Partie déjà en cours.',
    PSEUDO_TAKEN: 'Pseudo déjà utilisé.',
    MAX_PLAYERS: 'Partie pleine.',
    MISSING_FIELDS: 'Données manquantes.',
    HOST_ALREADY_HAS_GAME: 'Host a déjà une partie active.',
    NO_ACTIVE_GAME: 'Aucune partie active.',
};

const PSEUDO_REGEX = /^[a-zA-Z0-9_-]{2,20}$/;

// ── Helpers ───────────────────────────────────────────

function send(ws, type, payload = {}) {
    if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type, payload }));
    }
}

function broadcastToGame(wss, partieId, type, payload = {}) {
    wss.clients.forEach(c => {
        if (c.readyState === 1 && c._partieId === partieId) {
            c.send(JSON.stringify({ type, payload }));
        }
    });
}

function broadcastToHost(wss, partieId, type, payload = {}) {
    wss.clients.forEach(c => {
        if (c.readyState === 1 && c._isHost && c._partieId === partieId) {
            c.send(JSON.stringify({ type, payload }));
        }
    });
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

// ── Chercher une partie par ID ou par nom exact ───────

function trouverPartie(partieId, nomPartie) {
    // Priorité : par ID
    if (partieId) {
        const p = store.getPartie(partieId);
        if (p) return p;
    }
    // Fallback : par nom exact (insensible à la casse)
    if (nomPartie) {
        return store.getAllParties().find(
            p => p.nom.toLowerCase() === nomPartie.toLowerCase() &&
                 p.statut !== 'terminee' && p.statut !== 'ended'
        ) || null;
    }
    return null;
}

// ── Handler principal ─────────────────────────────────

function handleMessage(wss, ws, type, payload) {
    switch (type) {

        // ── HOST_AUTH ──────────────────────────────────
        case 'HOST_AUTH': {
            ws._isHost = true;
            ws._role = 'host';
            send(ws, 'AUTH_OK', { message: 'Host authentifié' });
            console.log('[WS] Host authentifié');
            break;
        }

        // ── HOST_CREATE_GAME ───────────────────────────
        case 'HOST_CREATE_GAME': {
            if (!ws._isHost) return send(ws, 'ERROR', { code: 'NOT_HOST' });

            const { nom, jeu, mode, equipes, hostJoue, hostPseudo } = payload;
            if (!nom || !jeu || !mode) return send(ws, 'ERROR', { code: 'MISSING_FIELDS' });

            // Vérifier unicité du nom de partie (parmi celles actives)
            const existing = store.getAllParties().find(
                p => p.nom.toLowerCase() === nom.toLowerCase() &&
                     p.statut !== 'terminee' && p.statut !== 'ended'
            );
            if (existing) {
                return send(ws, 'ERROR', { code: 'NAME_TAKEN', message: 'Une partie avec ce nom existe déjà.' });
            }

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
            console.log(`[WS] Partie créée: "${partie.nom}" (${partie.jeu}) → ${partie.id}`);
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
            console.log(`[WS] Partie démarrée: "${partie.nom}"`);
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
            console.log('[WS] Partie terminée');
            break;
        }

        // ── HOST_ADD_POINTS ────────────────────────────
        case 'HOST_ADD_POINTS': {
            if (!ws._isHost) return send(ws, 'ERROR', { code: 'NOT_HOST' });
            const partie = store.getPartie(ws._partieId);
            if (!partie) return send(ws, 'ERROR', { code: 'NO_ACTIVE_GAME' });
            const { cible, points } = payload;
            if (!cible) return send(ws, 'ERROR', { code: 'MISSING_FIELDS' });
            store.modifierScore(partie.id, cible, Math.abs(points || 1));
            broadcastToGame(wss, partie.id, 'SCORES_UPDATE', { scores: store.getScores(partie.id) });
            break;
        }

        // ── HOST_REMOVE_POINTS ─────────────────────────
        case 'HOST_REMOVE_POINTS': {
            if (!ws._isHost) return send(ws, 'ERROR', { code: 'NOT_HOST' });
            const partie = store.getPartie(ws._partieId);
            if (!partie) return send(ws, 'ERROR', { code: 'NO_ACTIVE_GAME' });
            const { cible, points } = payload;
            if (!cible) return send(ws, 'ERROR', { code: 'MISSING_FIELDS' });
            store.modifierScore(partie.id, cible, -Math.abs(points || 1));
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
                pseudo, joueurs: store.getJoueurs(partie.id),
            });
            console.log(`[WS] ${pseudo} expulsé`);
            break;
        }

        // ── HOST_ACTION ────────────────────────────────
        case 'HOST_ACTION': {
            if (!ws._isHost) return send(ws, 'ERROR', { code: 'NOT_HOST' });
            const partie = store.getPartie(ws._partieId);
            if (!partie) return send(ws, 'ERROR', { code: 'NO_ACTIVE_GAME' });
            const { action, data } = payload;
            if (!action) return send(ws, 'ERROR', { code: 'MISSING_FIELDS' });
            broadcastToGame(wss, partie.id, 'HOST_ACTION', { action, data: data || {} });
            break;
        }

        // ── PLAYER_JOIN ────────────────────────────────
        case 'PLAYER_JOIN': {
            const { pseudo, partieId, nomPartie } = payload;

            // Validation pseudo
            if (!pseudo || !PSEUDO_REGEX.test(pseudo)) {
                return send(ws, 'JOIN_ERROR', { code: 'PSEUDO_INVALID' });
            }

            // Trouver la partie par ID ou par nom
            const partie = trouverPartie(partieId, nomPartie);
            if (!partie) {
                return send(ws, 'JOIN_ERROR', { code: 'GAME_NOT_FOUND' });
            }

            if (['ended', 'terminee'].includes(partie.statut)) {
                return send(ws, 'JOIN_ERROR', { code: 'GAME_NOT_FOUND' });
            }

            if (['started', 'en_cours'].includes(partie.statut)) {
                return send(ws, 'JOIN_ERROR', { code: 'GAME_STARTED' });
            }

            // Pseudo déjà pris dans cette partie
            if (partie.joueurs.some(j => j.pseudo.toLowerCase() === pseudo.toLowerCase())) {
                return send(ws, 'JOIN_ERROR', { code: 'PSEUDO_TAKEN' });
            }

            // Partie pleine
            if (partie.joueurs.length >= (partie.maxJoueurs || 8)) {
                return send(ws, 'JOIN_ERROR', { code: 'MAX_PLAYERS' });
            }

            const equipe = assignerEquipe(partie, pseudo);
            const joueur = { pseudo, equipe, score: 0, statut: 'connected' };
            partie.joueurs.push(joueur);

            ws._pseudo    = pseudo;
            ws._partieId  = partie.id;
            ws._equipe    = equipe;
            ws._role      = 'player';

            // Initialiser score
            if (!partie.scores[pseudo]) partie.scores[pseudo] = 0;

            send(ws, 'JOIN_OK', {
                pseudo, equipe,
                snapshot: store.snapshotPartie(partie.id),
            });

            broadcastToGame(wss, partie.id, 'PLAYER_JOINED', {
                pseudo, equipe, joueurs: store.getJoueurs(partie.id),
            });

            console.log(`[WS] ${pseudo} a rejoint "${partie.nom}" (équipe: ${equipe || 'aucune'})`);
            break;
        }

        // ── PLAYER_ACTION ──────────────────────────────
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
                    statut: p.statut,
                    joueurs: (p.joueurs || []).map(j => ({ pseudo: j.pseudo })),
                    maxJoueurs: p.maxJoueurs || 8,
                }));
            send(ws, 'PARTIES_LIST', { parties });
            break;
        }

        default:
            console.warn(`[WS] Type inconnu: ${type}`);
    }
}

// ── Setup principal ───────────────────────────────────

function setupWebSocket(wss) {
    wss.on('connection', (ws) => {
        ws._pseudo   = null;
        ws._equipe   = null;
        ws._partieId = null;
        ws._isHost   = false;
        ws._role     = null;

        console.log(`[WS] Nouvelle connexion`);

        ws.on('message', (raw) => {
            let msg;
            try { msg = JSON.parse(raw); } catch {
                console.warn('[WS] JSON invalide');
                return;
            }
            const { type, payload = {} } = msg;
            if (!type) return;
            console.log(`[WS] → ${type}`, Object.keys(payload));
            try {
                handleMessage(wss, ws, type, payload);
            } catch (err) {
                console.error(`[WS] Erreur ${type}:`, err);
                send(ws, 'ERROR', { code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
            }
        });

        ws.on('close', () => {
            console.log(`[WS] Déconnexion: ${ws._pseudo || ws._role || 'anon'}`);

            if (ws._isHost && ws._partieId) {
                // Notifier les joueurs que le host s'est déconnecté
                broadcastToGame(wss, ws._partieId, 'HOST_DISCONNECTED', {
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
        });

        ws.on('error', err => console.error('[WS] Erreur socket:', err));
    });
}

module.exports = { setupWebSocket };