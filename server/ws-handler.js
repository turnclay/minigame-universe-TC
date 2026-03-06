// server/ws-handler.js
// =============================================
// 🔌 GESTIONNAIRE WEBSOCKET
// Protocole de messages JSON : { type, payload }
// =============================================

const { v4: uuidv4 } = require("uuid");
const store = require("./store.js");

// ── Types de messages entrants (client → serveur) ──
const MSG_IN = {
    HOST_AUTH:          "HOST_AUTH",
    HOST_CREATE_GAME:   "HOST_CREATE_GAME",
    HOST_START_GAME:    "HOST_START_GAME",
    HOST_END_GAME:      "HOST_END_GAME",
    HOST_ADD_POINTS:    "HOST_ADD_POINTS",
    HOST_REMOVE_POINTS: "HOST_REMOVE_POINTS",
    HOST_KICK_PLAYER:   "HOST_KICK_PLAYER",
    PLAYER_JOIN:        "PLAYER_JOIN",
    PLAYER_ACTION:      "PLAYER_ACTION",
};

// ── Types de messages sortants (serveur → client) ──
const MSG_OUT = {
    AUTH_OK:        "AUTH_OK",
    AUTH_FAIL:      "AUTH_FAIL",
    JOIN_OK:        "JOIN_OK",
    JOIN_FAIL:      "JOIN_FAIL",
    GAME_CREATED:   "GAME_CREATED",
    GAME_STATE:     "GAME_STATE",
    GAME_STARTED:   "GAME_STARTED",
    GAME_ENDED:     "GAME_ENDED",
    SCORES_UPDATE:  "SCORES_UPDATE",
    PLAYER_LIST:    "PLAYER_LIST",
    PLAYER_JOINED:  "PLAYER_JOINED",
    PLAYER_LEFT:    "PLAYER_LEFT",
    PLAYER_KICKED:  "PLAYER_KICKED",
    ERROR:          "ERROR",
};

// ── Helpers ────────────────────────────────────────

function send(ws, type, payload = {}) {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({ type, payload }));
}

function broadcast(wss, type, payload = {}, filterFn = null) {
    wss.clients.forEach(client => {
        if (client.readyState !== client.OPEN) return;
        if (filterFn && !filterFn(client)) return;
        client.send(JSON.stringify({ type, payload }));
    });
}

function broadcastToPartie(wss, partieId, type, payload) {
    broadcast(wss, type, payload, client => {
        const conn = store.getConnexion(client._socketId);
        return conn && conn.partieId === partieId;
    });
}

function broadcastToHost(wss, partieId, type, payload) {
    broadcast(wss, type, payload, client => {
        const conn = store.getConnexion(client._socketId);
        return conn && conn.partieId === partieId && conn.role === "host";
    });
}

// ── Validation du mot de passe HOST ───────────────
function verifierMotDePasseHost(password) {
    const secret = process.env.HOST_PASSWORD;
    if (!secret || !password) return false;

    if (password.length !== secret.length) return false;

    let diff = 0;
    for (let i = 0; i < password.length; i++) {
        diff |= password.charCodeAt(i) ^ secret.charCodeAt(i);
    }
    return diff === 0;
}

// ── Handler principal ──────────────────────────────
function setupWebSocket(wss) {
    wss.on("connection", (ws) => {
        const socketId = uuidv4();
        ws._socketId = socketId;

        console.log(`[WS] Nouvelle connexion : ${socketId}`);

        // ─────────────────────────────────────────────
        // (Optionnel) Rate-limit WebSocket propre
        // ─────────────────────────────────────────────
        /*
        const { RateLimiterMemory } = require("rate-limiter-flexible");
        const wsLimiter = new RateLimiterMemory({ points: 60, duration: 10 });

        ws.on("message", async raw => {
            try {
                await wsLimiter.consume(socketId);
            } catch {
                send(ws, MSG_OUT.ERROR, { code: "RATE_LIMIT" });
                return ws.close();
            }
            handleRawMessage(raw);
        });
        */

        // ─────────────────────────────────────────────
        // Handler message normal
        // ─────────────────────────────────────────────
        ws.on("message", (raw) => {
            let msg;
            try {
                msg = JSON.parse(raw);
            } catch {
                send(ws, MSG_OUT.ERROR, { code: "INVALID_JSON" });
                return;
            }
            const { type, payload = {} } = msg;
            handleMessage(wss, ws, socketId, type, payload);
        });

        ws.on("close", () => {
            const conn = store.getConnexion(socketId);
            if (conn) {
                console.log(`[WS] Déconnexion : ${conn.pseudo || socketId} (rôle: ${conn.role})`);

                if (conn.role === "player" && conn.partieId) {
                    const partie = store.getPartie(conn.partieId);
                    if (partie && conn.equipe) {
                        const eq = partie.equipes.find(e => e.nom === conn.equipe);
                        if (eq) eq.membres = eq.membres.filter(m => m !== conn.pseudo);
                    }

                    broadcastToHost(wss, conn.partieId, MSG_OUT.PLAYER_LEFT, {
                        pseudo: conn.pseudo,
                        joueurs: store.getJoueursPartie(conn.partieId).map(j => ({
                            pseudo: j.pseudo, equipe: j.equipe
                        }))
                    });
                }
            }
            store.supprimerConnexion(socketId);
        });

        ws.on("error", (err) => {
            console.error(`[WS] Erreur socket ${socketId}:`, err.message);
        });
    });
}

function handleMessage(wss, ws, socketId, type, payload) {
    switch (type) {

        // 🟦 HOST : Authentification
        case MSG_IN.HOST_AUTH: {
            const { password } = payload;

            if (!verifierMotDePasseHost(password)) {
                send(ws, MSG_OUT.AUTH_FAIL, { error: "Mot de passe incorrect." });
                console.warn(`[WS] Tentative d'auth host échouée — socket ${socketId}`);
                return;
            }

            store.supprimerConnexion(socketId);

            store.enregistrerConnexion(socketId, {
                pseudo: "__host__",
                role: "host",
                partieId: null
            });

            send(ws, MSG_OUT.AUTH_OK, { role: "host" });
            console.log(`[WS] ✅ Host authentifié — socket ${socketId}`);
            break;
        }

        // 🟦 HOST : Créer une partie
        case MSG_IN.HOST_CREATE_GAME: {
            const conn = store.getConnexion(socketId);

            if (!conn || conn.role !== "host") {
                send(ws, MSG_OUT.ERROR, { code: "NOT_HOST" });
                return;
            }

            const { nom, jeu, mode, equipes = [] } = payload;
            if (!nom || !jeu || !mode) {
                send(ws, MSG_OUT.ERROR, { code: "MISSING_FIELDS" });
                return;
            }

            const partieId = uuidv4();
            store.creerPartie({ id: partieId, nom, jeu, mode, equipes, hostSocketId: socketId });

            conn.partieId = partieId;

            send(ws, MSG_OUT.GAME_CREATED, {
                partieId,
                snapshot: store.snapshotPartie(partieId)
            });

            console.log(`[WS] Partie créée : "${nom}" (${jeu}) — ${partieId}`);
            break;
        }

        // 🟦 HOST : Démarrer la partie
        case MSG_IN.HOST_START_GAME: {
            const conn = store.getConnexion(socketId);

            if (!conn || conn.role !== "host") {
                send(ws, MSG_OUT.ERROR, { code: "NOT_HOST" });
                return;
            }

            if (!conn.partieId) {
                send(ws, MSG_OUT.ERROR, { code: "NO_ACTIVE_GAME" });
                return;
            }

            store.updatePartieStatut(conn.partieId, "en_cours");
            const snapshot = store.snapshotPartie(conn.partieId);

            broadcastToPartie(wss, conn.partieId, MSG_OUT.GAME_STARTED, { snapshot });

            console.log(`[WS] Partie démarrée : ${conn.partieId}`);
            break;
        }

        // 🟦 HOST : Terminer la partie
        case MSG_IN.HOST_END_GAME: {
            const conn = store.getConnexion(socketId);

            if (!conn || conn.role !== "host" || !conn.partieId) {
                send(ws, MSG_OUT.ERROR, { code: "NOT_HOST" });
                return;
            }

            store.updatePartieStatut(conn.partieId, "terminee");
            const snapshot = store.snapshotPartie(conn.partieId);

            broadcastToPartie(wss, conn.partieId, MSG_OUT.GAME_ENDED, { snapshot });

            console.log(`[WS] Partie terminée : ${conn.partieId}`);
            break;
        }

        // 🟦 HOST : Modifier les scores
        case MSG_IN.HOST_ADD_POINTS:
        case MSG_IN.HOST_REMOVE_POINTS: {
            const conn = store.getConnexion(socketId);
            if (!conn || conn.role !== "host" || !conn.partieId) return;

            const { cible, points = 1 } = payload;
            if (!cible) return;

            const delta = type === MSG_IN.HOST_ADD_POINTS ? points : -points;
            store.ajouterPointsPartie(conn.partieId, cible, delta);

            const snapshot = store.snapshotPartie(conn.partieId);

            broadcastToPartie(wss, conn.partieId, MSG_OUT.SCORES_UPDATE, {
                scores: snapshot.scores
            });

            break;
        }

        // 🟦 HOST : Expulser un joueur
        case MSG_IN.HOST_KICK_PLAYER: {
            const conn = store.getConnexion(socketId);
            if (!conn || conn.role !== "host") return;

            const { pseudo } = payload;
            if (!pseudo) return;

            wss.clients.forEach(client => {
                const c = store.getConnexion(client._socketId);
                if (c && c.pseudo === pseudo && c.role === "player") {
                    send(client, MSG_OUT.PLAYER_KICKED, { reason: "Expulsé par le host." });
                    setTimeout(() => client.close(), 200);
                }
            });

            break;
        }

        // 🟩 PLAYER : Rejoindre une partie
        case MSG_IN.PLAYER_JOIN: {
            const { pseudo, partieId, equipe = null } = payload;

            if (!pseudo || pseudo.trim() === "") {
                send(ws, MSG_OUT.JOIN_FAIL, { error: "Pseudo invalide." });
                return;
            }

            const pseudoNettoye = pseudo.trim().slice(0, 20);

            const partie = store.getPartie(partieId);
            if (!partie) {
                send(ws, MSG_OUT.JOIN_FAIL, { error: "Partie introuvable." });
                return;
            }
            if (partie.statut !== "lobby") {
                send(ws, MSG_OUT.JOIN_FAIL, { error: "La partie a déjà commencé." });
                return;
            }

            const result = store.enregistrerConnexion(socketId, {
                pseudo: pseudoNettoye,
                role: "player",
                partieId,
                equipe
            });

            if (!result.ok) {
                send(ws, MSG_OUT.JOIN_FAIL, {
                    error: result.error === "PSEUDO_DEJA_PRIS"
                        ? "Ce pseudo est déjà utilisé."
                        : "Connexion refusée."
                });
                return;
            }

            if (partie.mode === "team" && equipe) {
                const eq = partie.equipes.find(e => e.nom === equipe);
                if (eq && !eq.membres.includes(pseudoNettoye)) {
                    eq.membres.push(pseudoNettoye);
                }
                if (!(equipe in partie.scores)) partie.scores[equipe] = 0;
            } else if (partie.mode === "solo") {
                if (!(pseudoNettoye in partie.scores)) partie.scores[pseudoNettoye] = 0;
            }

            send(ws, MSG_OUT.JOIN_OK, {
                pseudo: pseudoNettoye,
                equipe,
                snapshot: store.snapshotPartie(partieId)
            });

            broadcastToHost(wss, partieId, MSG_OUT.PLAYER_JOINED, {
                pseudo: pseudoNettoye,
                equipe,
                joueurs: store.getJoueursPartie(partieId).map(j => ({
                    pseudo: j.pseudo, equipe: j.equipe
                }))
            });

            break;
        }

        // 🟩 PLAYER : Action de jeu
        case MSG_IN.PLAYER_ACTION: {
            const conn = store.getConnexion(socketId);
            if (!conn || conn.role !== "player" || !conn.partieId) return;

            broadcastToHost(wss, conn.partieId, "PLAYER_ACTION", {
                pseudo: conn.pseudo,
                equipe: conn.equipe,
                action: payload
            });
            break;
        }

        default:
            send(ws, MSG_OUT.ERROR, { code: "UNKNOWN_MESSAGE_TYPE", type });
            console.warn(`[WS] Message inconnu : "${type}" — socket ${socketId}`);
    }
}

module.exports = {
    setupWebSocket
};