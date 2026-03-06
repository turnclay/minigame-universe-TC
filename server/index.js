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

// Render fournit automatiquement process.env.PORT
const PORT   = process.env.PORT || 3000;

// ORIGIN dynamique (Render ou local)
const ORIGIN = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
const IS_DEV = process.env.NODE_ENV !== "production";

// ─────────────────────────────────────────────
// Sécurité HTTP
// ─────────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: [
                "'self'",
                ORIGIN.replace("https://", "wss://").replace("http://", "ws://"),
                "ws://localhost:3000",
                "wss://localhost:3000"
            ],
            mediaSrc: ["'self'"]
        }
    }
}));

app.use(cors({
    origin: IS_DEV ? "*" : ORIGIN,
    methods: ["GET", "POST"]
}));

app.use(express.json({ limit: "10kb" }));

// ─────────────────────────────────────────────
// Rate limiting REST
// ─────────────────────────────────────────────
const rateLimiter = new RateLimiterMemory({ points: 120, duration: 60 });
app.use("/api", async (req, res, next) => {
    try { await rateLimiter.consume(req.ip); next(); }
    catch { res.status(429).json({ error: "Trop de requêtes." }); }
});

// ─────────────────────────────────────────────
// Fichiers statiques (CORRIGÉ)
// ─────────────────────────────────────────────
const ROOT = path.join(__dirname, "..");

// Dossiers front-end
app.use("/css",    express.static(path.join(ROOT, "css")));
app.use("/js",     express.static(path.join(ROOT, "js")));
app.use("/images", express.static(path.join(ROOT, "images")));
app.use("/audio",  express.static(path.join(ROOT, "audio")));
app.use("/data",   express.static(path.join(ROOT, "data")));

// Interfaces Host & Join
app.use("/host", express.static(path.join(ROOT, "public", "host")));
app.use("/join", express.static(path.join(ROOT, "public", "join")));

// Page d'accueil
app.get("/", (req, res) => {
    res.redirect("/host");
});

// ─────────────────────────────────────────────
// API REST
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// WebSocket
// ─────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: "/ws" });
setupWebSocket(wss);

// ─────────────────────────────────────────────
// Démarrage serveur
// ─────────────────────────────────────────────
server.listen(PORT, "0.0.0.0", () => {
    console.log(`
╔══════════════════════════════════════════╗
║  🎮 MiniGame Universe — Serveur actif    ║
║  App     : http://localhost:${PORT}      ║
║  Host    : http://localhost:${PORT}/host ║
║  Players : http://localhost:${PORT}/join ║
╚══════════════════════════════════════════╝
    `);
});

process.on("uncaughtException",  e => console.error("[UNCAUGHT]", e));
process.on("unhandledRejection", e => console.error("[UNHANDLED]", e));
