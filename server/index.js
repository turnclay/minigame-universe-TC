// ======================================================
// 🟢 SERVEUR — MiniGame Universe v4 (WebSocket partout)
// ======================================================
// Architecture :
//   - Pas de PLAYER_JOIN REST (seulement WebSocket)
//   - GET /api/parties pour lister les parties disponibles
//   - Tous les messages via /ws
// ======================================================

require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const { RateLimiterMemory } = require('rate-limiter-flexible');

const store = require('./store.js');
const { setupWebSocket } = require('./ws-handler.js');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const ORIGIN = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
const IS_DEV = process.env.NODE_ENV !== 'production';

// ─────────────────────────────────────────────────────
// RESET STORE
// ─────────────────────────────────────────────────────
store.resetStore();
console.log('[SERVER] 🔄 Store réinitialisé — aucune partie en cours');

// ─────────────────────────────────────────────────────
// Sécurité HTTP
// ─────────────────────────────────────────────────────
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
                styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
                fontSrc: ["'self'", 'https://fonts.gstatic.com'],
                imgSrc: ["'self'", 'data:', 'blob:', 'https://api.qrserver.com'],
                connectSrc: [
                    "'self'",
                    ORIGIN.replace('https://', 'wss://').replace('http://', 'ws://'),
                    'ws://localhost:3000',
                    'wss://localhost:3000',
                ],
                mediaSrc: ["'self'"],
            },
        },
    })
);

app.use(
    cors({
        origin: IS_DEV ? '*' : ORIGIN,
        methods: ['GET', 'POST'],
    })
);

app.use(express.json({ limit: '10kb' }));

// ─────────────────────────────────────────────────────
// Rate limiting
// ─────────────────────────────────────────────────────
const rateLimiter = new RateLimiterMemory({ points: 120, duration: 60 });
app.use('/api', async (req, res, next) => {
    try {
        await rateLimiter.consume(req.ip);
        next();
    } catch {
        res.status(429).json({ error: 'Trop de requêtes.' });
    }
});

// ─────────────────────────────────────────────────────
// Fichiers statiques
// ─────────────────────────────────────────────────────
const ROOT = path.join(__dirname, '..');

app.use(
    express.static(path.join(ROOT, 'public'), {
        maxAge: IS_DEV ? 0 : '1h',
    })
);

// ─────────────────────────────────────────────────────
// ROUTES HTML
// ─────────────────────────────────────────────────────

app.get(['/'], (req, res) => {
    res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

app.get(['/host', '/host/'], (req, res) => {
    res.sendFile(path.join(ROOT, 'public', 'host', 'index.html'));
});

app.get(['/join', '/join/'], (req, res) => {
    res.sendFile(path.join(ROOT, 'public', 'join', 'index.html'));
});

// ── Routes jeux ──
app.get(['/games/quiz', '/games/quiz/'], (req, res) => {
    res.sendFile(path.join(ROOT, 'public', 'games', 'quiz', 'index.html'));
});

app.get(['/games/undercover', '/games/undercover/'], (req, res) => {
    res.sendFile(path.join(ROOT, 'public', 'games', 'undercover', 'index.html'));
});

// Ajouter d'autres jeux au besoin...

// ─────────────────────────────────────────────────────
// API REST — PARTIES
// ─────────────────────────────────────────────────────

/**
 * GET /api/parties — Lister les parties disponibles
 */
app.get('/api/parties', (req, res) => {
    try {
        const parties = store
            .getAllParties()
            .filter(p => p.statut !== 'terminee' && p.statut !== 'ended')
            .map(p => ({
                id: p.id,
                nom: p.nom,
                jeu: p.jeu,
                mode: p.mode,
                statut: p.statut,
                joueurs: (p.joueurs || []).map(j => ({
                    pseudo: j.pseudo,
                })),
                equipes: (p.equipes || []).map(e => ({ nom: e.nom })),
            }));

        res.json({ parties });
    } catch (err) {
        console.error('[API] Erreur GET /api/parties:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

/**
 * GET /api/parties/:id — Récupérer une partie
 */
app.get('/api/parties/:id', (req, res) => {
    try {
        const partie = store.getPartie(req.params.id);
        if (!partie) return res.status(404).json({ error: 'Partie introuvable' });

        res.json({
            id: partie.id,
            nom: partie.nom,
            jeu: partie.jeu,
            mode: partie.mode,
            statut: partie.statut,
            joueurs: (partie.joueurs || []).map(j => ({ pseudo: j.pseudo })),
            equipes: (partie.equipes || []).map(e => ({ nom: e.nom })),
        });
    } catch (err) {
        console.error('[API] Erreur GET /api/parties/:id:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ─────────────────────────────────────────────────────
// WEBSOCKET SERVER
// ─────────────────────────────────────────────────────

const wss = require('ws').WebSocketServer;
const wsServer = new wss({ server, path: '/ws' });

setupWebSocket(wsServer);

console.log('[SERVER] 🔌 WebSocket configuré sur /ws');

// ─────────────────────────────────────────────────────
// DÉMARRAGE
// ─────────────────────────────────────────────────────

server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════���══════════════════════╗
║  🎮 MiniGame Universe v4                 ║
║  App     : http://localhost:${PORT}      ║
║  Host    : http://localhost:${PORT}/host ║
║  Players : http://localhost:${PORT}/join ║
║  WebSocket : ws://localhost:${PORT}/ws   ║
╚══════════════════════════════════════════╝
    `);
});