require("dotenv").config();

const express    = require("express");
const http       = require("http");
const path       = require("path");
const { WebSocketServer } = require("ws");
const helmet     = require("helmet");
const cors       = require("cors");
const { RateLimiterMemory } = require("rate-limiter-flexible");
const { setupWebSocket } = require("./ws-handler.js");

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3000;
const ORIGIN = process.env.ALLOWED_ORIGIN || `http://localhost:${PORT}`;
const IS_DEV = process.env.NODE_ENV !== "production";

// ── Sécurité HTTP ──────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc:  ["'self'"],
            scriptSrc:   ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            styleSrc:    ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc:     ["'self'", "https://fonts.gstatic.com"],
            imgSrc:      ["'self'", "data:", "blob:"],
            connectSrc:  [
                "'self'",
                "ws://localhost:3000",
                "wss://localhost:3000",
                ORIGIN.replace("https://", "wss://").replace("http://", "ws://")
            ],
            mediaSrc:    ["'self'"],
        }
    }
}));

app.use(cors({ origin: IS_DEV ? "*" : ORIGIN, methods: ["GET", "POST"] }));
app.use(express.json({ limit: "10kb" }));

// ── Rate limiting REST uniquement (/api) ──────────
const rateLimiter = new RateLimiterMemory({ points: 120, duration: 60 });
app.use("/api", async (req, res, next) => {
    try { await rateLimiter.consume(req.ip); next(); }
    catch { res.status(429).json({ error: "Trop de requêtes." }); }
});

// ── Fichiers statiques ────────────────────────────
const ROOT = path.join(__dirname, "..");

// Assets partagés (js, css, images, audio, data)
app.use("/css",    express.static(path.join(ROOT, "css"),    { maxAge: IS_DEV ? 0 : "1h" }));
app.use("/js",     express.static(path.join(ROOT, "js"),     { maxAge: IS_DEV ? 0 : "1h" }));
app.use("/images", express.static(path.join(ROOT, "images"), { maxAge: IS_DEV ? 0 : "1h" }));
app.use("/audio",  express.static(path.join(ROOT, "audio"),  { maxAge: IS_DEV ? 0 : "1h" }));
app.use("/data",   express.static(path.join(ROOT, "data"),   { maxAge: IS_DEV ? 0 : "1h" }));

// Interface HOST  → /host
app.use("/host", express.static(path.join(ROOT, "public", "host")));

// Interface PLAYER → /join
app.use("/join", express.static(path.join(ROOT, "public", "join")));

// Racine → app standalone existante
app.get("/", (req, res) => {
    res.sendFile(path.join(ROOT, "index.html"));
});

// ── API REST ──────────────────────────────────────
const store = require("./store.js");

app.get("/api/parties", (req, res) => {
    const parties = store.getAllParties()
        .filter(p => p.statut === "lobby")
        .map(p => ({
            id:        p.id,
            nom:       p.nom,
            jeu:       p.jeu,
            mode:      p.mode,
            equipes:   p.equipes || [],
            nbJoueurs: store.getJoueursPartie(p.id).length
        }));
    res.json(parties);
});

// ── WebSocket ─────────────────────────────────────
const wss = new WebSocketServer({ server, path: "/ws" });

// Rate limiting WS intégré dans setupWebSocket via ws-handler
// On n'ajoute PAS de listener "message" ici pour éviter les doubles appels
const wsRateLimiter = new RateLimiterMemory({ points: 60, duration: 10 });

// Injecte le rate limiter sur chaque socket avant de passer à setupWebSocket
wss.on("connection", (ws, req) => {
    ws._ip = req.socket.remoteAddress || "unknown";
    ws._rateLimited = false;

    // Patch : on wrappe ws.emit pour intercepter les messages
    const originalEmit = ws.emit.bind(ws);
    ws.emit = async function (event, ...args) {
        if (event === "message") {
            try {
                await wsRateLimiter.consume(ws._ip);
            } catch {
                if (!ws._rateLimited) {
                    ws._rateLimited = true;
                    ws.send(JSON.stringify({ type: "ERROR", payload: { code: "RATE_LIMIT" } }));
                    ws.close();
                }
                return; // bloque le message sans crash
            }
        }
        return originalEmit(event, ...args);
    };
});

setupWebSocket(wss);

// ── Démarrage ─────────────────────────────────────
server.listen(PORT, "0.0.0.0", () => {
    console.log(`
╔══════════════════════════════════════════╗
║  🎮 MiniGame Universe — Serveur actif    ║
║  App     : http://localhost:${PORT}         ║
║  Host    : http://localhost:${PORT}/host    ║
║  Players : http://localhost:${PORT}/join    ║
╚══════════════════════════════════════════╝
    `);
});

process.on("uncaughtException",  e => console.error("[UNCAUGHT]", e));
process.on("unhandledRejection", e => console.error("[UNHANDLED]", e));