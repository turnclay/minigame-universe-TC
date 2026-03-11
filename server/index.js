// ======================================================
// 🟢 SERVEUR — MiniGame Universe v4.1 (corrigé)
// ======================================================

require('dotenv').config();

const express  = require('express');
const http     = require('http');
const path     = require('path');
const helmet   = require('helmet');
const cors     = require('cors');
const { RateLimiterMemory } = require('rate-limiter-flexible');

const store = require('./store.js');
const { setupWebSocket } = require('./ws-handler.js');

const app    = express();
const server = http.createServer(app);

const PORT   = process.env.PORT || 3000;
const ORIGIN = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
const IS_DEV = process.env.NODE_ENV !== 'production';

// ─────────────────────────────────────────────────────
// RESET STORE
// ─────────────────────────────────────────────────────
store.resetStore();
console.log('[SERVER] 🔄 Store réinitialisé');

// ─────────────────────────────────────────────────────
// SÉCURITÉ
// ─────────────────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc:  ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            styleSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            fontSrc:    ["'self'", 'https://fonts.gstatic.com'],
            imgSrc:     ["'self'", 'data:', 'blob:', 'https://api.qrserver.com'],
            connectSrc: [
                "'self'",
                ORIGIN.replace('https://', 'wss://').replace('http://', 'ws://'),
                'ws://localhost:3000', 'wss://localhost:3000',
                'ws://localhost:*',
            ],
            mediaSrc:   ["'self'"],
        },
    },
}));

app.use(cors({ origin: IS_DEV ? '*' : ORIGIN, methods: ['GET', 'POST'] }));
app.use(express.json({ limit: '10kb' }));

// ─────────────────────────────────────────────────────
// RATE LIMITING
// ─────────────────────────────────────────────────────
const rateLimiter = new RateLimiterMemory({ points: 120, duration: 60 });
app.use('/api', async (req, res, next) => {
    try { await rateLimiter.consume(req.ip); next(); }
    catch { res.status(429).json({ error: 'Trop de requêtes.' }); }
});

// ─────────────────────────────────────────────────────
// FICHIERS STATIQUES
// ─────────────────────────────────────────────────────
const ROOT = path.join(__dirname, '..');
app.use(express.static(path.join(ROOT, 'public'), { maxAge: IS_DEV ? 0 : '1h' }));

// ─────────────────────────────────────────────────────
// ROUTES HTML
// ─────────────────────────────────────────────────────
const html = (file) => (req, res) =>
    res.sendFile(path.join(ROOT, 'public', file));

app.get(['/', '/index.html'],      html('index.html'));
app.get(['/host', '/host/'],       html('host/index.html'));
app.get(['/join', '/join/'],       html('join/index.html'));

// ── Jeux ──
const JEUX = ['quiz', 'justeprix', 'undercover', 'lml', 'mimer', 'pendu', 'petitbac', 'memoire', 'morpion', 'puissance4'];
JEUX.forEach(jeu => {
    app.get([`/games/${jeu}`, `/games/${jeu}/`], html(`games/${jeu}/index.html`));
});

// ─────────────────────────────────────────────────────
// API REST
// ─────────────────────────────────────────────────────

/** GET /api/parties — Lister les parties disponibles */
app.get('/api/parties', (req, res) => {
    try {
        const parties = store.getAllParties()
            .filter(p => p.statut !== 'terminee' && p.statut !== 'ended')
            .map(p => ({
                id: p.id, nom: p.nom, jeu: p.jeu, mode: p.mode,
                statut: p.statut, maxJoueurs: p.maxJoueurs || 8,
                joueurs: (p.joueurs || []).map(j => ({ pseudo: j.pseudo })),
                equipes: (p.equipes || []).map(e => ({ nom: e.nom })),
            }));
        res.json({ parties });
    } catch (err) {
        console.error('[API] /api/parties:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

/** GET /api/parties/:id — Récupérer une partie */
app.get('/api/parties/:id', (req, res) => {
    try {
        const partie = store.getPartie(req.params.id);
        if (!partie) return res.status(404).json({ error: 'Partie introuvable' });
        res.json({
            id: partie.id, nom: partie.nom, jeu: partie.jeu, mode: partie.mode,
            statut: partie.statut, maxJoueurs: partie.maxJoueurs || 8,
            joueurs: (partie.joueurs || []).map(j => ({ pseudo: j.pseudo })),
            equipes: (partie.equipes || []).map(e => ({ nom: e.nom })),
        });
    } catch (err) {
        console.error('[API] /api/parties/:id:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

/** GET /api/parties/by-name/:nom — Trouver par nom */
app.get('/api/parties/by-name/:nom', (req, res) => {
    try {
        const nom = decodeURIComponent(req.params.nom).trim().toLowerCase();
        const partie = store.getAllParties().find(
            p => p.nom.toLowerCase() === nom &&
                 p.statut !== 'terminee' && p.statut !== 'ended'
        );
        if (!partie) return res.status(404).json({ error: 'Partie introuvable' });
        res.json({ id: partie.id, nom: partie.nom, jeu: partie.jeu, mode: partie.mode, statut: partie.statut });
    } catch (err) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ─────────────────────────────────────────────────────
// WEBSOCKET
// ─────────────────────────────────────────────────────
const { WebSocketServer } = require('ws');
const wsServer = new WebSocketServer({ server, path: '/ws' });
setupWebSocket(wsServer);
console.log('[SERVER] 🔌 WebSocket configuré sur /ws');

// ─────────────────────────────────────────────────────
// DÉMARRAGE
// ─────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔══════════════════════════════════════════╗
║  🎮 MiniGame Universe v4.1               ║
║  App     : http://localhost:${PORT}      ║
║  Host    : http://localhost:${PORT}/host ║
║  Players : http://localhost:${PORT}/join ║
║  WS      : ws://localhost:${PORT}/ws     ║
╚══════════════════════════════════════════╝
    `);
});