// ======================================================
// 🟢 SERVEUR — MiniGame Universe v4.1
// ======================================================
// Nouveautés v4.1 :
//  - Route GET /api/parties/code/:code — résout un code court → partie
//    ⚠️  Déclarée AVANT /api/parties/:id pour éviter le conflit de routing
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

store.resetStore();
console.log('[SERVER] Store réinitialisé');

// ── Sécurité ──────────────────────────────────────────
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
                'ws://localhost:*', 'wss://localhost:*',
            ],
        },
    },
}));
app.use(cors({ origin: IS_DEV ? '*' : ORIGIN, methods: ['GET', 'POST'] }));
app.use(express.json({ limit: '10kb' }));

// ── Rate limit ────────────────────────────────────────
const rl = new RateLimiterMemory({ points: 120, duration: 60 });
app.use('/api', async (req, res, next) => {
    try { await rl.consume(req.ip); next(); }
    catch { res.status(429).json({ error: 'Trop de requêtes.' }); }
});

// ── Statiques ─────────────────────────────────────────
const ROOT = path.join(__dirname, '..');
app.use(express.static(path.join(ROOT, 'public'), { maxAge: IS_DEV ? 0 : '1h' }));

// ── HTML routes ───────────────────────────────────────
const html = file => (_, res) => res.sendFile(path.join(ROOT, 'public', file));

app.get(['/', '/index.html'],  html('index.html'));
app.get(['/host', '/host/'],   html('host/index.html'));
app.get(['/join', '/join/'],   html('join/index.html'));

const JEUX = ['quiz','justeprix','undercover','lml','mimer','pendu','petitbac','memoire','morpion','puissance4'];
JEUX.forEach(jeu => {
    app.get([`/games/${jeu}`, `/games/${jeu}/`], html(`games/${jeu}/index.html`));
});

// ── API ───────────────────────────────────────────────

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

app.get('/api/parties/by-name/:nom', (req, res) => {
    try {
        const nom = decodeURIComponent(req.params.nom).toLowerCase();
        const p   = store.getAllParties().find(
            p => p.nom.toLowerCase() === nom && p.statut !== 'terminee'
        );
        if (!p) return res.status(404).json({ error: 'Introuvable' });
        res.json({ id: p.id, nom: p.nom, jeu: p.jeu, mode: p.mode, statut: p.statut });
    } catch { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ✅ NEW v4.1 — Route par code court
// ⚠️  DOIT être déclarée AVANT /api/parties/:id
//     sinon Express interprète "code" comme un :id
app.get('/api/parties/code/:code', (req, res) => {
    try {
        const code = req.params.code.toUpperCase().trim();

        // Validation du format : exactement 6 caractères alphanumériques
        if (!/^[A-Z0-9]{6}$/.test(code)) {
            return res.status(400).json({ error: 'Format de code invalide (6 caractères alphanumériques attendus).' });
        }

        const p = store.getPartieByCode(code);
        if (!p) {
            return res.status(404).json({ error: 'Code invalide ou expiré. Vérifiez le code ou demandez à votre host.' });
        }

        res.json({
            id:         p.id,
            nom:        p.nom,
            jeu:        p.jeu,
            mode:       p.mode,
            statut:     p.statut,
            maxJoueurs: p.maxJoueurs || 8,
            joueurs:    (p.joueurs || []).map(j => ({ pseudo: j.pseudo })),
            equipes:    (p.equipes || []).map(e => ({ nom: e.nom })),
        });
    } catch (err) {
        console.error('[API] /api/parties/code/:code:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Route par ID — après /code/:code pour éviter tout conflit
app.get('/api/parties/:id', (req, res) => {
    try {
        const p = store.getPartie(req.params.id);
        if (!p) return res.status(404).json({ error: 'Introuvable' });
        res.json({
            id: p.id, nom: p.nom, jeu: p.jeu, mode: p.mode,
            statut: p.statut, maxJoueurs: p.maxJoueurs || 8,
            joueurs: (p.joueurs || []).map(j => ({ pseudo: j.pseudo })),
            equipes: (p.equipes || []).map(e => ({ nom: e.nom })),
        });
    } catch { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ── WebSocket ─────────────────────────────────────────
const { WebSocketServer } = require('ws');
const wsServer = new WebSocketServer({ server, path: '/ws' });
setupWebSocket(wsServer);

// ── Start ─────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔══════════════════════════════════════════╗
║  🎮 MiniGame Universe v4.1               ║
║  http://localhost:${PORT}                ║
╚══════════════════════════════════════════╝`);
});