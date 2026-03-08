// /server/ws-handler.js
// ======================================================
// 🔌 GESTIONNAIRE WEBSOCKET v4
// - Pas de GAME_EXISTS : chaque host peut créer autant
//   de parties qu'il veut (multi-parties supporté)
// - Chaque connexion host gère SA partie via ws._partieId
// ======================================================

const store = require("./store.js");

function send(ws, type, payload = {}) {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type, payload }));
}

function broadcastToGame(wss, partieId, type, payload = {}) {
    wss.clients.forEach(client => {
        if (client.readyState !== 1) return;
        if (client._partieId !== partieId) return;
        client.send(JSON.stringify({ type, payload }));
    });
}

function broadcastToHost(wss, partieId, type, payload = {}) {
    wss.clients.forEach(client => {
        if (client.readyState !== 1) return;
        if (!client._isHost) return;
        if (client._partieId !== partieId) return;
        client.send(JSON.stringify({ type, payload }));
    });
}

function setupWebSocket(wss) {
    wss.on("connection", (ws) => {
        ws._pseudo   = null;
        ws._equipe   = null;
        ws._partieId = null;
        ws._isHost   = false;

        ws.on("message", (raw) => {
            let msg;
            try { msg = JSON.parse(raw); } catch { return; }
            const { type, payload = {} } = msg;

            switch (type) {

                case "HOST_AUTH": {
                    ws._isHost = true;
                    send(ws, "AUTH_OK", {});
                    break;
                }

                // ✅ Plus de GAME_EXISTS global.
                // Seule contrainte : ce host-WS ne peut pas avoir 2 parties actives simultanément.
                case "HOST_CREATE_GAME": {
                    if (!ws._isHost) { send(ws, "ERROR", { code: "NOT_HOST" }); return; }
                    const { nom, jeu, mode, equipes, joueursSolo, hostJoue, hostPseudo } = payload;
                    if (!nom || !jeu || !mode) { send(ws, "ERROR", { code: "MISSING_FIELDS" }); return; }

                    // Bloquer seulement si CE host a déjà une partie non-terminée
                    if (ws._partieId) {
                        const old = store.getPartie(ws._partieId);
                        if (old && old.statut !== "terminee") {
                            send(ws, "ERROR", { code: "HOST_ALREADY_HAS_GAME" }); return;
                        }
                    }

                    const partie = store.creerPartie({ nom, jeu, mode,
                        equipes: equipes || [], joueursSolo: joueursSolo || [],
                        hostJoue: hostJoue || false, hostPseudo: hostPseudo || null });

                    ws._partieId = partie.id;
                    store.setHostSocket(partie.id, ws);
                    send(ws, "GAME_CREATED", { partieId: partie.id, snapshot: store.snapshotPartie(partie.id) });
                    break;
                }

                case "HOST_START_GAME": {
                    if (!ws._isHost) { send(ws, "ERROR", { code: "NOT_HOST" }); return; }
                    const partie = ws._partieId ? store.getPartie(ws._partieId) : null;
                    if (!partie) { send(ws, "ERROR", { code: "NO_ACTIVE_GAME" }); return; }
                    store.setStatut(partie.id, "en_cours");
                    broadcastToGame(wss, partie.id, "GAME_STARTED", { snapshot: store.snapshotPartie(partie.id) });
                    break;
                }

                case "HOST_END_GAME": {
                    if (!ws._isHost) { send(ws, "ERROR", { code: "NOT_HOST" }); return; }
                    const partie = ws._partieId ? store.getPartie(ws._partieId) : null;
                    if (!partie) { send(ws, "ERROR", { code: "NO_ACTIVE_GAME" }); return; }
                    const snapshot = store.snapshotPartie(partie.id);
                    store.terminerPartie(partie.id);
                    broadcastToGame(wss, partie.id, "GAME_ENDED", { snapshot });
                    ws._partieId = null;
                    break;
                }

                case "HOST_ADD_POINTS": {
                    if (!ws._isHost) return;
                    const partie = ws._partieId ? store.getPartie(ws._partieId) : null;
                    if (!partie) return;
                    store.modifierScore(partie.id, payload.cible, Math.abs(payload.points || 1));
                    broadcastToGame(wss, partie.id, "SCORES_UPDATE", { scores: store.getScores(partie.id) });
                    break;
                }

                case "HOST_REMOVE_POINTS": {
                    if (!ws._isHost) return;
                    const partie = ws._partieId ? store.getPartie(ws._partieId) : null;
                    if (!partie) return;
                    store.modifierScore(partie.id, payload.cible, -Math.abs(payload.points || 1));
                    broadcastToGame(wss, partie.id, "SCORES_UPDATE", { scores: store.getScores(partie.id) });
                    break;
                }

                case "HOST_KICK_PLAYER": {
                    if (!ws._isHost) return;
                    const partie = ws._partieId ? store.getPartie(ws._partieId) : null;
                    if (!partie) return;
                    const { pseudo } = payload;
                    store.retirerJoueur(partie.id, pseudo);
                    wss.clients.forEach(c => {
                        if (c._pseudo === pseudo && c._partieId === partie.id && c.readyState === 1)
                            send(c, "PLAYER_KICKED", { reason: "Expulsé par le host" });
                    });
                    broadcastToGame(wss, partie.id, "PLAYER_LEFT", { pseudo, joueurs: store.getJoueurs(partie.id) });
                    break;
                }

                case "PLAYER_JOIN": {
                    const { pseudo, partieId, equipe } = payload;
                    if (!pseudo || !partieId) { send(ws, "JOIN_FAIL", { error: "Données manquantes." }); return; }
                    const partie = store.getPartie(partieId);
                    if (!partie) { send(ws, "JOIN_FAIL", { error: "Partie introuvable." }); return; }
                    if (partie.statut === "terminee") { send(ws, "JOIN_FAIL", { error: "Partie terminée." }); return; }
                    if (store.getJoueurs(partieId).some(j => j.pseudo === pseudo)) {
                        send(ws, "JOIN_FAIL", { error: "Pseudo déjà pris." }); return;
                    }
                    ws._pseudo = pseudo; ws._equipe = equipe || null; ws._partieId = partieId;
                    store.ajouterJoueur(partieId, { pseudo, equipe: equipe || null });
                    send(ws, "JOIN_OK", { pseudo, partieId, snapshot: store.snapshotPublic(partieId) });
                    broadcastToGame(wss, partieId, "PLAYER_JOINED", { pseudo, equipe, joueurs: store.getJoueurs(partieId) });
                    break;
                }

                case "PLAYER_ACTION": {
                    if (!ws._partieId) return;
                    broadcastToHost(wss, ws._partieId, "PLAYER_ACTION", { pseudo: ws._pseudo, equipe: ws._equipe, action: payload });
                    break;
                }

                default: console.warn("[WS] Type inconnu:", type);
            }
        });

        ws.on("close", () => {
            if (ws._isHost) return;
            if (!ws._pseudo || !ws._partieId) return;
            const partie = store.getPartie(ws._partieId);
            if (!partie || partie.statut === "terminee") return;
            store.retirerJoueur(ws._partieId, ws._pseudo);
            broadcastToGame(wss, ws._partieId, "PLAYER_LEFT", { pseudo: ws._pseudo, joueurs: store.getJoueurs(ws._partieId) });
        });

        ws.on("error", err => console.error("[WS] Erreur socket:", err));
    });
}

module.exports = { setupWebSocket };