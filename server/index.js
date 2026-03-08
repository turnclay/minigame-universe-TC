// server/server.js
// ======================================================
// 🟢 SERVEUR — MiniGame Universe v3
// Fix principal : resetStore au démarrage pour éviter
// "partie toujours en cours" après redéploiement.
// ======================================================

require("dotenv").config();

const express    = require("express");
const http       = require("http");
const path       = require("path");
const { WebSocketServer } = require("ws");
const helmet     = require("helmet");
const cors       = require("cors");
const { RateLimiterMemory } = require("rate-limiter-flexible");
const { setupWebSocket } = require("./ws-handler.js");
const store      = require("./store.js");

const app    = express();
const server = http.createServer(app);

const PORT   = process.env.PORT || 3000;
const ORIGIN = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
const IS_DEV = process.env.NODE_ENV !== "production";

// ─────────────────────────────────────────────────────
// 🔄 RESET STORE AU DÉMARRAGE
// ✅ FIX : empêche les parties "fantômes" après redéploiement
// ─────────────────────────────────────────────────────
store.resetStore();
console.log("[SERVER] 🔄 Store réinitialisé — aucune partie en cours");

// ─────────────────────────────────────────────────────
// Sécurité HTTP
// ─────────────────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc:  ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc:    ["'self'", "https://fonts.gstatic.com"],
            imgSrc:     ["'self'", "data:", "blob:", "https://api.qrserver.com"],
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

// ─────────────────────────────────────────────────────
// Rate limiting
// ─────────────────────────────────────────────────────
const rateLimiter = new RateLimiterMemory({ points: 120, duration: 60 });
app.use("/api", async (req, res, next) => {
    try { await rateLimiter.consume(req.ip); next(); }
    catch { res.status(429).json({ error: "Trop de requêtes." }); }
});

// ─────────────────────────────────────────────────────
// Fichiers statiques
// ─────────────────────────────────────────────────────
const ROOT = path.join(__dirname, "..");

app.use(express.static(path.join(ROOT, "public"), {
    maxAge: IS_DEV ? 0 : "1h"
}));

// ─────────────────────────────────────────────────────
// Routes HTML — Support des URLs avec ou sans slash final
// ─────────────────────────────────────────────────────
app.get(["/", "/main", "/main/"], (req, res) => {
    res.sendFile(path.join(ROOT, "public", "index.html"));
});

app.get(["/host", "/host/"], (req, res) => {
    res.sendFile(path.join(ROOT, "public", "host.html"));
});

app.get(["/join", "/join/"], (req, res) => {
    res.sendFile(path.join(ROOT, "public", "join.html"));
});

// ─────────────────────────────────────────────────────
// API REST
// ─────────────────────────────────────────────────────

// ✅ Lister les parties en lobby (pour la page join)
app.get("/api/parties", (req, res) => {
    try {
        const parties = store.getAllParties?.()
            ?.filter(p => p.statut !== "terminee")
            ?.map(p => ({
                id:        p.id,
                nom:       p.nom,
                jeu:       p.jeu,
                mode:      p.mode,
                statut:    p.statut,
                equipes:   (p.equipes || []).map(e => ({ nom: e.nom })),
                nbJoueurs: store.getJoueurs?.(p.id)?.length || 0
            })) || [];

        res.json(parties);
    } catch(e) {
        console.error("[API] Erreur /api/parties:", e);
        res.status(500).json({ error: "Erreur serveur" });
    }
});

// ✅ Détail d'une partie (pour rejoindre avec partieId dans l'URL)
app.get("/api/parties/:id", (req, res) => {
    const partie = store.getPartie?.(req.params.id);
    if (!partie) return res.status(404).json({ error: "Partie introuvable" });

    res.json({
        id:        partie.id,
        nom:       partie.nom,
        jeu:       partie.jeu,
        mode:      partie.mode,
        statut:    partie.statut,
        equipes:   (partie.equipes || []).map(e => ({ nom: e.nom })),
        nbJoueurs: store.getJoueurs?.(partie.id)?.length || 0
    });
});

app.get("/api/ping", (req, res) => {
    res.json({ ok: true, ts: Date.now(), parties: store.getAllParties?.()?.length || 0 });
});

// ─────────────────────────────────────────────────────
// WebSocket
// ─────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: "/ws" });
setupWebSocket(wss);

// ─────────────────────────────────────────────────────
// Démarrage
// ─────────────────────────────────────────────────────
server.listen(PORT, "0.0.0.0", () => {
    console.log(`
╔══════════════════════════════════════════╗
║  🎮 MiniGame Universe v3                 ║
║  App     : http://localhost:${PORT}      ║
║  Host    : http://localhost:${PORT}/host ║
║  Players : http://localhost:${PORT}/join ║
╚══════════════════════════════════════════╝
    `);
});

process.on("uncaughtException",  e => console.error("[UNCAUGHT]", e));
process.on("unhandledRejection", e => console.error("[UNHANDLED]", e));