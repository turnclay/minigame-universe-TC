// ======================================================
// 🔌 GESTIONNAIRE WEBSOCKET v6 (Option A - WebSocket partout)
// ======================================================
// Architecture :
//   - Format uniforme : { type: "...", payload: {...} }
//   - PLAYER_JOIN via WebSocket (pas de REST)
//   - HOST_ACTION pour les instructions du host
//   - Gestion complète des équipes
// ======================================================

const store = require('./store.js');

// ── Codes d'erreur standards ──
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

/**
 * Envoie un message à un client
 */
function send(ws, type, payload = {}) {
    if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type, payload }));
    }
}

/**
 * Envoie un message à tous les clients d'une partie
 */
function broadcastToGame(wss, partieId, type, payload = {}) {
    wss.clients.forEach(client => {
        if (client.readyState !== 1) return;
        if (client._partieId !== partieId) return;
        client.send(JSON.stringify({ type, payload }));
    });
}

/**
 * Envoie un message à tous les hosts d'une partie
 */
function broadcastToHost(wss, partieId, type, payload = {}) {
    wss.clients.forEach(client => {
        if (client.readyState !== 1) return;
        if (!client._isHost) return;
        if (client._partieId !== partieId) return;
        client.send(JSON.stringify({ type, payload }));
    });
}

/**
 * Assigne un joueur à une équipe
 */
function assignerEquipe(partie, joueur) {
    if (partie.mode !== 'team' || !partie.equipes || partie.equipes.length === 0) {
        return null;
    }

    // Compter les joueurs par équipe
    const equipeCount = {};
    partie.equipes.forEach(eq => {
        equipeCount[eq.nom] = 0;
    });

    partie.joueurs.forEach(j => {
        if (j.equipe && equipeCount[j.equipe] !== undefined) {
            equipeCount[j.equipe]++;
        }
    });

    // Assigner à l'équipe avec le moins de joueurs
    let minEquipe = partie.equipes[0].nom;
    let minCount = equipeCount[minEquipe];

    for (let eq of partie.equipes) {
        if (equipeCount[eq.nom] < minCount) {
            minEquipe = eq.nom;
            minCount = equipeCount[eq.nom];
        }
    }

    return minEquipe;
}

/**
 * Configure le serveur WebSocket
 */
function setupWebSocket(wss) {
    wss.on('connection', (ws) => {
        console.log(`🔌 Client connecté: ${ws._socket.remoteAddress}`);

        // ───────────────────────────────────────────────
        // MÉTADONNÉES INTERNES
        // ───────────────────────────────────────────────
        ws._pseudo = null;
        ws._equipe = null;
        ws._partieId = null;
        ws._isHost = false;
        ws._role = null; // 'host' ou 'player'

        // ───────────────────────────────────────────────
        // MESSAGE REÇU
        // ───────────────────────────────────────────────
        ws.on('message', (raw) => {
            let msg;
            try {
                msg = JSON.parse(raw);
            } catch (err) {
                console.warn('[WS] Message JSON invalide:', raw);
                return;
            }

            const { type, payload = {} } = msg;

            if (!type) {
                console.warn('[WS] Pas de type dans le message');
                return;
            }

            console.log(`[WS] Message reçu: ${type}`, payload);

            try {
                handleMessage(wss, ws, type, payload);
            } catch (err) {
                console.error(`[WS] Erreur lors du traitement ${type}:`, err);
                send(ws, 'ERROR', { code: 'INTERNAL_ERROR', message: 'Erreur serveur' });
            }
        });

        // ───────────────────────────────────────────────
        // DÉCONNEXION
        // ───────────────────────────────────────────────
        ws.on('close', () => {
            console.log(`🔌 Client déconnecté: ${ws._pseudo || 'anonymous'}`);

            if (ws._isHost) {
                console.warn(`⚠️ Host déconnecté: ${ws._partieId}`);
                // TODO: Gérer la déconnexion du host (terminer la partie ?)
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

            console.log(`✅ ${ws._pseudo} a quitté ${ws._partieId}`);
        });

        ws.on('error', err => console.error('[WS] Erreur socket:', err));
    });
}

/**
 * Traite un message WebSocket
 */
function handleMessage(wss, ws, type, payload) {
    switch (type) {
        // ───────────────────────────────────────────────
        // HOST_AUTH — Authentifier un host
        // ───────────────────────────────────────────────
        case 'HOST_AUTH': {
            ws._isHost = true;
            ws._role = 'host';
            send(ws, 'AUTH_OK', { message: 'Host authentifié' });
            console.log('[WS] Host authentifié');
            break;
        }

        // ───────────────────────────────────────────────
        // HOST_CREATE_GAME — Créer une partie
        // ───────────────────────────────────────────────
        case 'HOST_CREATE_GAME': {
            if (!ws._isHost) {
                return send(ws, 'ERROR', { code: 'NOT_HOST', message: ERROR_CODES.NOT_HOST });
            }

            const { nom, jeu, mode, equipes, hostJoue, hostPseudo } = payload;

            if (!nom || !jeu || !mode) {
                return send(ws, 'ERROR', {
                    code: 'MISSING_FIELDS',
                    message: ERROR_CODES.MISSING_FIELDS,
                });
            }

            // Empêcher un host d'avoir 2 parties actives
            if (ws._partieId) {
                const old = store.getPartie(ws._partieId);
                if (old && old.statut !== 'terminee') {
                    return send(ws, 'ERROR', {
                        code: 'HOST_ALREADY_HAS_GAME',
                        message: ERROR_CODES.HOST_ALREADY_HAS_GAME,
                    });
                }
            }

            const partie = store.creerPartie({
                nom,
                jeu,
                mode,
                equipes: equipes || [],
                hostJoue: hostJoue || false,
                hostPseudo: hostPseudo || null,
            });

            ws._partieId = partie.id;
            store.setHostSocket(partie.id, ws);

            send(ws, 'GAME_CREATED', {
                partieId: partie.id,
                snapshot: store.snapshotPartie(partie.id),
            });

            console.log(`✅ Partie créée: ${partie.nom} (${partie.jeu})`);
            break;
        }

        // ───────────────────────────────────────────────
        // HOST_START_GAME — Démarrer la partie
        // ───────────────────────────────────────────────
        case 'HOST_START_GAME': {
            if (!ws._isHost) {
                return send(ws, 'ERROR', { code: 'NOT_HOST' });
            }

            const partie = store.getPartie(ws._partieId);
            if (!partie) {
                return send(ws, 'ERROR', { code: 'NO_ACTIVE_GAME' });
            }

            store.setStatut(partie.id, 'en_cours');

            broadcastToGame(wss, partie.id, 'GAME_STARTED', {
                snapshot: store.snapshotPartie(partie.id),
            });

            console.log(`🚀 Partie démarrée: ${partie.nom}`);
            break;
        }

        // ───────────────────────────────────────────────
        // HOST_END_GAME — Terminer la partie
        // ───────────────────────────────────────────────
        case 'HOST_END_GAME': {
            if (!ws._isHost) {
                return send(ws, 'ERROR', { code: 'NOT_HOST' });
            }

            const partie = store.getPartie(ws._partieId);
            if (!partie) {
                return send(ws, 'ERROR', { code: 'NO_ACTIVE_GAME' });
            }

            const snapshot = store.snapshotPartie(partie.id);
            store.terminerPartie(partie.id);

            broadcastToGame(wss, partie.id, 'GAME_ENDED', { snapshot });
            ws._partieId = null;

            console.log(`🏁 Partie terminée`);
            break;
        }

        // ───────────────────────────────────────────────
        // HOST_ADD_POINTS — Ajouter des points
        // ───���───────────────────────────────────────────
        case 'HOST_ADD_POINTS': {
            if (!ws._isHost) {
                return send(ws, 'ERROR', { code: 'NOT_HOST' });
            }

            const partie = store.getPartie(ws._partieId);
            if (!partie) {
                return send(ws, 'ERROR', { code: 'NO_ACTIVE_GAME' });
            }

            const { cible, points } = payload;
            if (!cible) {
                return send(ws, 'ERROR', { code: 'MISSING_FIELDS' });
            }

            store.modifierScore(partie.id, cible, Math.abs(points || 1));

            broadcastToGame(wss, partie.id, 'SCORES_UPDATE', {
                scores: store.getScores(partie.id),
            });

            break;
        }

        // ───────────────────────────────────────────────
        // HOST_REMOVE_POINTS — Retirer des points
        // ───────────────────────────────────────────────
        case 'HOST_REMOVE_POINTS': {
            if (!ws._isHost) {
                return send(ws, 'ERROR', { code: 'NOT_HOST' });
            }

            const partie = store.getPartie(ws._partieId);
            if (!partie) {
                return send(ws, 'ERROR', { code: 'NO_ACTIVE_GAME' });
            }

            const { cible, points } = payload;
            if (!cible) {
                return send(ws, 'ERROR', { code: 'MISSING_FIELDS' });
            }

            store.modifierScore(partie.id, cible, -Math.abs(points || 1));

            broadcastToGame(wss, partie.id, 'SCORES_UPDATE', {
                scores: store.getScores(partie.id),
            });

            break;
        }

        // ───────────────────────────────────────────────
        // HOST_KICK_PLAYER — Expulser un joueur
        // ───────────────────────────────────────────────
        case 'HOST_KICK_PLAYER': {
            if (!ws._isHost) {
                return send(ws, 'ERROR', { code: 'NOT_HOST' });
            }

            const partie = store.getPartie(ws._partieId);
            if (!partie) {
                return send(ws, 'ERROR', { code: 'NO_ACTIVE_GAME' });
            }

            const { pseudo } = payload;
            if (!pseudo) {
                return send(ws, 'ERROR', { code: 'MISSING_FIELDS' });
            }

            store.retirerJoueur(partie.id, pseudo);

            // Notifier le joueur expulsé
            wss.clients.forEach(c => {
                if (c._pseudo === pseudo && c._partieId === partie.id && c.readyState === 1) {
                    send(c, 'KICKED', { reason: 'Expulsé par le host' });
                }
            });

            broadcastToGame(wss, partie.id, 'PLAYER_LEFT', {
                pseudo,
                joueurs: store.getJoueurs(partie.id),
            });

            console.log(`✖️ ${pseudo} expulsé`);
            break;
        }

        // ───────────────────────────────────────────────
        // HOST_ACTION — Envoyer une instruction aux joueurs
        // ───────────────────────────────────────────────
        case 'HOST_ACTION': {
            if (!ws._isHost) {
                return send(ws, 'ERROR', { code: 'NOT_HOST' });
            }

            const partie = store.getPartie(ws._partieId);
            if (!partie) {
                return send(ws, 'ERROR', { code: 'NO_ACTIVE_GAME' });
            }

            const { action, data } = payload;
            if (!action) {
                return send(ws, 'ERROR', { code: 'MISSING_FIELDS' });
            }

            broadcastToGame(wss, partie.id, 'HOST_ACTION', {
                action,
                data: data || {},
            });

            break;
        }

        // ───────────────────────────────────────────────
        // PLAYER_JOIN — Rejoindre une partie
        // ───────────────────────────────────────────────
        case 'PLAYER_JOIN': {
            const { pseudo, partieId } = payload;

            // Validation pseudo
            const pseudoRegex = /^[a-zA-Z0-9_-]{2,20}$/;
            if (!pseudo || !pseudoRegex.test(pseudo)) {
                return send(ws, 'JOIN_ERROR', { code: 'PSEUDO_INVALID' });
            }

            // Vérifier la partie
            const partie = store.getPartie(partieId);
            if (!partie) {
                return send(ws, 'JOIN_ERROR', { code: 'GAME_NOT_FOUND' });
            }

            if (['ended', 'terminee'].includes(partie.statut)) {
                return send(ws, 'JOIN_ERROR', { code: 'GAME_NOT_FOUND' });
            }

            if (['started', 'en_cours'].includes(partie.statut)) {
                return send(ws, 'JOIN_ERROR', { code: 'GAME_STARTED' });
            }

            // Vérifier les doublons
            if (partie.joueurs.some(j => j.pseudo === pseudo)) {
                return send(ws, 'JOIN_ERROR', { code: 'PSEUDO_TAKEN' });
            }

            // Vérifier la capacité
            if (partie.joueurs.length >= (partie.maxJoueurs || 8)) {
                return send(ws, 'JOIN_ERROR', { code: 'MAX_PLAYERS' });
            }

            // Assigner l'équipe
            const equipe = assignerEquipe(partie, pseudo);

            // Créer le joueur
            const joueur = {
                id: ws.id,
                pseudo,
                equipe,
                score: 0,
                statut: 'connected',
            };

            partie.joueurs.push(joueur);

            // Mettre à jour le socket
            ws._pseudo = pseudo;
            ws._partieId = partieId;
            ws._equipe = equipe;
            ws._role = 'player';

            // Envoyer confirmation
            send(ws, 'JOIN_OK', {
                pseudo,
                equipe,
                snapshot: store.snapshotPartie(partieId),
            });

            // Notifier les autres
            broadcastToGame(wss, partieId, 'PLAYER_JOINED', {
                pseudo,
                equipe,
                joueurs: store.getJoueurs(partieId),
            });

            console.log(`✅ ${pseudo} a rejoint ${partieId} (équipe: ${equipe || 'aucune'})`);
            break;
        }

        // ───────────────────────────────────────────────
        // PLAYER_ACTION — Action du joueur
        // ───────────────────────────────────────────────
        case 'PLAYER_ACTION': {
            if (!ws._partieId) {
                return send(ws, 'ERROR', { code: 'NO_ACTIVE_GAME' });
            }

            const partie = store.getPartie(ws._partieId);
            if (!partie) {
                return send(ws, 'ERROR', { code: 'NO_ACTIVE_GAME' });
            }

            const { action, data } = payload;

            // Envoyer au host seulement
            broadcastToHost(wss, ws._partieId, 'PLAYER_ACTION', {
                pseudo: ws._pseudo,
                equipe: ws._equipe,
                action,
                data: data || {},
            });

            break;
        }

        // ───────────────────────────────────────────────
        // GET_PARTIES — Lister les parties (pour WebSocket)
        // ───────────────────────────────────────────────
        case 'GET_PARTIES': {
            const parties = store
                .getAllParties()
                .filter(p => p.statut !== 'terminee' && p.statut !== 'ended')
                .map(p => ({
                    id: p.id,
                    nom: p.nom,
                    jeu: p.jeu,
                    mode: p.mode,
                    statut: p.statut,
                    joueurs: (p.joueurs || []).map(j => ({ pseudo: j.pseudo })),
                }));

            send(ws, 'PARTIES_LIST', { parties });
            break;
        }

        // ───────────────────────────────────────────────
        // DÉFAUT
        // ───────────────────────────────────────────────
        default:
            console.warn(`[WS] Type de message inconnu: ${type}`);
    }
}

module.exports = { setupWebSocket };