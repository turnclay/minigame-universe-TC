// ======================================================
// 🟢 SERVEUR — MiniGame Universe (V2 Backend Port)
// ======================================================
// Portage du backend V3 (v4.2) pour le frontend V2.
//
// Différences clés vs V3 :
//   - Routes HTML adaptées à l'arborescence V2 :
//       /         → public/index.html
//       /jeu      → public/jeu.html
//     (V3 avait /host, /join, /games/:jeu — absents en V2)
//   - Pas de dossier public/host/ ni public/join/
//   - Même WebSocket, même Store, même protocole ws-handler
// ======================================================

import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import path from 'path';
import helmet from 'helmet';
import cors from 'cors';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';

import store from './store.js';
import { setupWebSocket } from './ws-handler.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app    = express();
const server = http.createServer(app);

const PORT   = process.env.PORT   || 3000;
const ORIGIN = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
const IS_DEV = process.env.NODE_ENV !== 'production';

console.log('[SERVER] Démarrage MiniGame V2 avec persistance des parties');

// ── Sécurité ──────────────────────────────────────────
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc : ["'self'"],
                scriptSrc  : ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://cdnjs.cloudflare.com'],
                styleSrc   : ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
                fontSrc    : ["'self'", 'https://fonts.gstatic.com'],
                imgSrc     : ["'self'", 'data:', 'blob:', 'https://api.qrserver.com'],
                connectSrc : [
                    "'self'",
                    ORIGIN.replace('https://', 'wss://').replace('http://', 'ws://'),
                    'ws://localhost:*',
                    'wss://localhost:*',
                ],
            },
        },
    })
);

app.use(cors({ origin: IS_DEV ? '*' : ORIGIN, methods: ['GET', 'POST'] }));
app.use(express.json({ limit: '10kb' }));

// ── Rate limit sur /api ───────────────────────────────
const rl = new RateLimiterMemory({ points: 120, duration: 60 });
app.use('/api', async (req, res, next) => {
    try {
        await rl.consume(req.ip);
        next();
    } catch {
        res.status(429).json({ error: 'Trop de requêtes. Veuillez patienter.' });
    }
});

// ── Fichiers statiques (public/) ──────────────────────
// Le dossier public/ est au même niveau que server/
const ROOT = path.join(__dirname, '..');
app.use(express.static(path.join(ROOT, 'public'), { maxAge: IS_DEV ? 0 : '1h' }));

// ── Routes HTML — arborescence V2 ────────────────────
// V2 n'a que deux pages HTML : index.html et jeu.html
const html = file => (_, res) => res.sendFile(path.join(ROOT, 'public', file));

app.get(['/', '/index.html'],   html('index.html'));
app.get(['/jeu', '/jeu.html'], html('jeu.html'));

// ── Fonction utilitaire de formatage ─────────────────
function formatPartieForAPI(p) {
    return {
        id           : p.id,
        nom          : p.nom,
        jeu          : p.jeu,
        mode         : p.mode,
        statut       : p.statut,
        codeCourt    : p.codeCourt,
        maxJoueurs   : p.maxJoueurs || 8,
        joueurs      : (p.joueurs || []).map(j => ({
            id      : j.id,
            pseudo  : j.pseudo,
            equipe  : j.equipe  || null,
            estPret : j.estPret || false,
        })),
        equipes      : (p.equipes || []).map(e => ({
            id      : e.id,
            nom     : e.nom,
            couleur : e.couleur || null,
        })),
        hostId       : p.hostId,
        createdAt    : p.createdAt    || new Date().toISOString(),
        lastActivity : p.lastActivity || new Date().toISOString(),
    };
}

// ── API REST ──────────────────────────────────────────

// Lister toutes les parties actives
app.get('/api/parties', (req, res) => {
    try {
        const parties = store.getAllParties()
            .filter(p => p.statut !== 'terminee')
            .map(formatPartieForAPI);
        res.json({ parties });
    } catch (err) {
        console.error('[API] /api/parties:', err);
        res.status(500).json({ error: 'Erreur serveur lors de la récupération des parties' });
    }
});

// Recherche par nom
app.get('/api/parties/by-name/:nom', (req, res) => {
    try {
        const nom = decodeURIComponent(req.params.nom).toLowerCase();
        const p   = store.getAllParties().find(
            p => p.nom.toLowerCase() === nom && p.statut !== 'terminee'
        );
        if (!p) return res.status(404).json({ error: 'Partie introuvable' });
        res.json(formatPartieForAPI(p));
    } catch (err) {
        console.error('[API] /api/parties/by-name:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Recherche par code court — DOIT être avant /:id
app.get('/api/parties/code/:code', (req, res) => {
    try {
        const code = req.params.code.toUpperCase().trim();
        if (!/^[A-Z0-9]{6}$/.test(code)) {
            return res.status(400).json({ error: 'Format de code invalide (6 caractères alphanumériques).' });
        }
        const p = store.getPartieByCode(code);
        if (!p) {
            return res.status(404).json({ error: 'Code invalide. Vérifiez le code ou demandez à l\'hôte.' });
        }
        if (p.statut === 'terminee') {
            return res.status(410).json({ error: 'Cette partie est terminée.' });
        }
        res.json(formatPartieForAPI(p));
    } catch (err) {
        console.error('[API] /api/parties/code/:code:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Recherche par ID
app.get('/api/parties/:id', (req, res) => {
    try {
        const p = store.getPartie(req.params.id);
        if (!p) return res.status(404).json({ error: 'Partie introuvable' });
        res.json(formatPartieForAPI(p));
    } catch (err) {
        console.error('[API] /api/parties/:id:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Mise à jour du statut d'une partie
app.post('/api/parties/:id/statut', express.json(), (req, res) => {
    try {
        const { statut } = req.body;
        const partie     = store.getPartie(req.params.id);
        if (!partie) return res.status(404).json({ error: 'Partie introuvable' });
        if (!['lobby', 'en_cours', 'terminee'].includes(statut)) {
            return res.status(400).json({ error: 'Statut invalide' });
        }
        partie.statut       = statut;
        partie.lastActivity = new Date().toISOString();
        store.updatePartie(partie.id, partie);
        res.json({ success: true, statut: partie.statut });
    } catch (err) {
        console.error('[API] POST /api/parties/:id/statut:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ── Route questions.json ─────────────────────────────
// Source canonique : server/data/questions.json.
// Production Render : /data/questions.json (disque persistant) en fallback.
// NOTE : depuis P2, le client ne fetche plus cette route pour alimenter le
// quiz — le tirage est exclusivement côté serveur via server/games/quiz.js.
// La route est conservée pour usages diagnostiques / outillage.
app.get('/api/questions', async (req, res) => {
    try {
        const fs   = await import('fs/promises');
        const path = await import('path');

        const candidates = [
            path.default.join(ROOT, 'server', 'data', 'questions.json'), // source canonique
            '/data/questions.json',                                       // Render disk (prod)
        ];

        let texte = null;
        for (const p of candidates) {
            try { texte = await fs.default.readFile(p, 'utf-8'); break; } catch {}
        }

        if (!texte) {
            return res.status(404).json({ error: 'questions.json introuvable' });
        }

        // Supprimer les caractères de contrôle invalides dans les chaînes JSON
        // (garde \t \n \r qui sont légaux en JSON)
        const propre = texte.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

        const questions = JSON.parse(propre);
        res.json(questions);
    } catch (err) {
        console.error('[API] /api/questions:', err.message);
        res.status(500).json({ error: 'Erreur lecture questions.json : ' + err.message });
    }
});

// ── WebSocket ─────────────────────────────────────────
const wsServer = new WebSocketServer({ server, path: '/ws' });
setupWebSocket(wsServer);

// ── Nettoyage périodique (toutes les heures) ──────────
setInterval(() => {
    try {
        store.nettoyerPartiesAnciennes(24);
    } catch (err) {
        console.error('[NETTOYAGE] Erreur:', err);
    }
}, 60 * 60 * 1000);

// ── Démarrage ─────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔══════════════════════════════════════════╗
║  🎮 MiniGame Universe V2 — Backend       ║
║  http://localhost:${PORT}                ║
║  WebSocket : ws://localhost:${PORT}/ws   ║
║  Persistance : ✅                         ║
╚══════════════════════════════════════════╝`);

    const actives = store.getAllParties().filter(p => p.statut !== 'terminee').length;
    console.log(actives > 0
        ? `[SERVER] ${actives} partie(s) active(s) restaurée(s) depuis le disque`
        : '[SERVER] Aucune partie active en mémoire'
    );
});