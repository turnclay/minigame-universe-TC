// /server/ws-handler.js
// ======================================================
// 🔌 GESTIONNAIRE WEBSOCKET — MiniGame Universe
// AUTH sans mot de passe (host libre)
// ======================================================

const store = require("./store.js");

// Ensemble des sockets authentifiées comme host (info, pas critique)
const hostSockets = new Set();

// ── Helpers d'envoi ───────────────────────────────────

function send(ws, type, payload = {}) {
    if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type, payload }));
    }
}

function broadcast(wss, type, payload = {}, excludeWs = null) {
    wss.clients.forEach(client => {
        if (client !== excludeWs && client.readyState === 1) {
            client.send(JSON.stringify({ type, payload }));
        }
    });
}

/**
 * Broadcast à tous les clients d'une même partie (host + joueurs)
 * On filtre sur client._partieId === partieId
 */
function broadcastToGame(wss, partieId, type, payload = {}) {
    wss.clients.forEach(client => {
        if (client.readyState !== 1) return;
        if (client._partieId !== partieId) return;
        client.send(JSON.stringify({ type, payload }));
    });
}

/**
 * Broadcast uniquement au host d'une partie
 */
function broadcastToHost(wss, partieId, type, payload = {}) {
    wss.clients.forEach(client => {
        if (client.readyState !== 1) return;
        if (!client._isHost) return;
        if (client._partieId !== partieId) return;
        client.send(JSON.stringify({ type, payload }));
    });
}

// ======================================================
// 🔧 SETUP WEBSOCKET HANDLER
// ======================================================

function setupWebSocket(wss) {
    wss.on("connection", (ws) => {
        ws._pseudo   = null;
        ws._equipe   = null;
        ws._partieId = null;
        ws._isHost   = false;

        // ── Réception de message ───────────────────────
        ws.on("message", (raw) => {
            let msg;
            try { msg = JSON.parse(raw); } catch { return; }

            const { type, payload = {} } = msg;

            switch (type) {

        // ══════════════════════════════════════════════
// 🔐 AUTH HOST — sans mot de passe
// ══════════════════════════════════════════════
case "HOST_AUTH": {
    ws._isHost = true;
    hostSockets.add(ws);
    send(ws, "AUTH_OK", { message: "Authentifié comme host" });

    // ❌ Désactivation de la restauration automatique
    // Avant : si une partie existait, on renvoyait GAME_RESTORED
    // Maintenant : on n'envoie plus rien, le host démarre toujours propre

    /*
    const partieExistante = store.getPartieActive();
    if (partieExistante) {
        ws._partieId = partieExistante.id;
        store.setHostSocket(partieExistante.id, ws);
        send(ws, "GAME_RESTORED", {
            partieId: partieExistante.id,
            snapshot: store.snapshotPartie(partieExistante.id)
        });
    }
    */

    break;
}

                // ══════════════════════════════════════════════
                // 🎮 CRÉER UNE PARTIE
                // ══════════════════════════════════════════════
                case "HOST_CREATE_GAME": {
                    if (!ws._isHost) {
                        send(ws, "ERROR", { code: "NOT_HOST" }); return;
                    }

                    // Vérifier qu'il n'y a pas déjà une partie active
                    const partieActive = store.getPartieActive();
                    if (partieActive) {
                        send(ws, "ERROR", { code: "GAME_EXISTS" }); return;
                    }

                    const { nom, jeu, mode, equipes, joueursSolo, hostJoue, hostPseudo } = payload;
                    if (!nom || !jeu || !mode) {
                        send(ws, "ERROR", { code: "MISSING_FIELDS" }); return;
                    }

                    const partie = store.creerPartie({
                        nom,
                        jeu,
                        mode,
                        equipes:     equipes     || [],
                        joueursSolo: joueursSolo || [],
                        hostJoue:    hostJoue    || false,
                        hostPseudo:  hostPseudo  || null,
                        // on laisse le store gérer le socket via setHostSocket
                        hostSocketId: null
                    });

                    ws._partieId = partie.id;
                    store.setHostSocket(partie.id, ws);

                    send(ws, "GAME_CREATED", {
                        partieId: partie.id,
                        snapshot: store.snapshotPartie(partie.id)
                    });
                    break;
                }

                // ══════════════════════════════════════════════
                // ▶ DÉMARRER LA PARTIE
                // ══════════════════════════════════════════════
                case "HOST_START_GAME": {
                    if (!ws._isHost) {
                        send(ws, "ERROR", { code: "NOT_HOST" }); return;
                    }

                    const partie = store.getPartieActive();
                    if (!partie) {
                        send(ws, "ERROR", { code: "NO_ACTIVE_GAME" }); return;
                    }

                    store.setStatut(partie.id, "en_cours");

                    const snapshot = store.snapshotPartie(partie.id);
                    broadcastToGame(wss, partie.id, "GAME_STARTED", { snapshot });
                    break;
                }

                // ══════════════════════════════════════════════
                // ⏹ TERMINER LA PARTIE
                // ══════════════════════════════════════════════
                case "HOST_END_GAME": {
                    if (!ws._isHost) {
                        send(ws, "ERROR", { code: "NOT_HOST" }); return;
                    }

                    const partie = store.getPartieActive();
                    if (!partie) {
                        send(ws, "ERROR", { code: "NO_ACTIVE_GAME" }); return;
                    }

                    const snapshot = store.snapshotPartie(partie.id);
                    store.terminerPartie(partie.id);

                    broadcastToGame(wss, partie.id, "GAME_ENDED", { snapshot });
                    break;
                }

                // ══════════════════════════════════════════════
                // ➕ AJOUTER DES POINTS
                // ══════════════════════════════════════════════
                case "HOST_ADD_POINTS": {
                    if (!ws._isHost) {
                        send(ws, "ERROR", { code: "NOT_HOST" }); return;
                    }

                    const partie = store.getPartieActive();
                    if (!partie) return;

                    const { cible, points = 1 } = payload;
                    store.modifierScore(partie.id, cible, Math.abs(points));

                    broadcastToGame(wss, partie.id, "SCORES_UPDATE", {
                        scores: store.getScores(partie.id)
                    });
                    break;
                }

                // ══════════════════════════════════════════════
                // ➖ RETIRER DES POINTS
                // ══════════════════════════════════════════════
                case "HOST_REMOVE_POINTS": {
                    if (!ws._isHost) {
                        send(ws, "ERROR", { code: "NOT_HOST" }); return;
                    }

                    const partie = store.getPartieActive();
                    if (!partie) return;

                    const { cible, points = 1 } = payload;
                    store.modifierScore(partie.id, cible, -Math.abs(points));

                    broadcastToGame(wss, partie.id, "SCORES_UPDATE", {
                        scores: store.getScores(partie.id)
                    });
                    break;
                }

                // ══════════════════════════════════════════════
                // 🦵 EXPULSER UN JOUEUR
                // ══════════════════════════════════════════════
                case "HOST_KICK_PLAYER": {
                    if (!ws._isHost) {
                        send(ws, "ERROR", { code: "NOT_HOST" }); return;
                    }

                    const partie = store.getPartieActive();
                    if (!partie) return;

                    const { pseudo } = payload;
                    store.retirerJoueur(partie.id, pseudo);

                    // Notifier le joueur expulsé
                    wss.clients.forEach(client => {
                        if (client._pseudo === pseudo && client.readyState === 1) {
                            send(client, "PLAYER_KICKED", { reason: "Expulsé par le host" });
                        }
                    });

                    broadcastToGame(wss, partie.id, "PLAYER_LEFT", {
                        pseudo,
                        joueurs: store.getJoueurs(partie.id)
                    });
                    break;
                }

                // ══════════════════════════════════════════════
                // 🙋 REJOINDRE UNE PARTIE (joueur)
                // ══════════════════════════════════════════════
                case "PLAYER_JOIN": {
                    const { pseudo, partieId, equipe } = payload;

                    if (!pseudo || !partieId) {
                        send(ws, "JOIN_FAIL", { error: "Données manquantes." }); return;
                    }

                    const partie = store.getPartie(partieId);
                    if (!partie) {
                        send(ws, "JOIN_FAIL", { error: "Partie introuvable." }); return;
                    }

                    if (partie.statut === "terminee") {
                        send(ws, "JOIN_FAIL", { error: "Cette partie est terminée." }); return;
                    }

                    // Vérifier doublon de pseudo
                    const joueurs = store.getJoueurs(partieId);
                    if (joueurs.some(j => j.pseudo === pseudo)) {
                        send(ws, "JOIN_FAIL", { error: "Ce pseudo est déjà pris." }); return;
                    }

                    ws._pseudo   = pseudo;
                    ws._equipe   = equipe || null;
                    ws._partieId = partieId;

                    store.ajouterJoueur(partieId, { pseudo, equipe: equipe || null });

                    send(ws, "JOIN_OK", {
                        pseudo,
                        partieId,
                        snapshot: store.snapshotPublic(partieId)
                    });

                    broadcastToGame(wss, partieId, "PLAYER_JOINED", {
                        pseudo,
                        equipe,
                        joueurs: store.getJoueurs(partieId)
                    });
                    break;
                }

                // ══════════════════════════════════════════════
                // 🎯 ACTION JOUEUR (transmis au host)
                // ══════════════════════════════════════════════
                case "PLAYER_ACTION": {
                    const partie = ws._partieId
                        ? store.getPartie(ws._partieId)
                        : store.getPartieActive();
                    if (!partie) return;

                    // Relayer uniquement au host de cette partie
                    broadcastToHost(wss, partie.id, "PLAYER_ACTION", {
                        pseudo: ws._pseudo,
                        equipe: ws._equipe,
                        action: payload
                    });
                    break;
                }

                default:
                    console.warn("[WS] Type inconnu:", type);
            }
        });

        // ── Déconnexion ──────────────────────────────────
        ws.on("close", () => {
            if (ws._isHost) {
                hostSockets.delete(ws);
                return;
            }

            if (!ws._pseudo || !ws._partieId) return;

            const partie = store.getPartie(ws._partieId);
            if (!partie) return;

            store.retirerJoueur(ws._partieId, ws._pseudo);

            broadcastToGame(wss, ws._partieId, "PLAYER_LEFT", {
                pseudo:  ws._pseudo,
                joueurs: store.getJoueurs(ws._partieId)
            });
        });

        ws.on("error", err => console.error("[WS] Erreur socket:", err));
    });
}

module.exports = { setupWebSocket };