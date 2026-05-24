// ======================================================
// 🎮 server/games/pendu.js — v1.0 (P5.2)
// ======================================================
// Migration du Pendu en WS-server-driven (patron petitbac/quiz).
//
// Mécanique : tous les joueurs (hôte + invités) jouent le MÊME mot
// en parallèle sur leur propre écran. Chacun a son propre clavier,
// ses propres erreurs, son propre dessin. À la fin de SA partie
// chacun envoie son résultat ; l'hôte révèle quand tous ont fini.
//
// Actions hôte (HOST_ACTION) :
//   pendu:load     → démarre une session, tire le 1er mot.
//   pendu:result   → soumet le résultat hôte (data.victoire, data.erreurs).
//   pendu:reveal   → force la révélation (avant que tous aient fini).
//   pendu:next_mot → relance avec un nouveau mot.
//
// Action joueur (PLAYER_ACTION) :
//   pendu:result   → soumet son résultat (data.victoire, data.erreurs).
//
// Events serveur → clients :
//   PENDU_MOT_START   { motSecret, theme, manche, scores }
//   PENDU_RESULT_IN   { pseudo, nbResults, nbJoueurs, allDone }   (host)
//   PENDU_REVELATION  { resultats[], scores, manche }
//   PENDU_CAN_NEXT    { manche }                                   (host)
//   PENDU_RESULT_ACK  { status: 'ok'|'already'|'too_late'|'invalid' }
// ======================================================

import store from '../store.js';
import fs    from 'fs/promises';
import path  from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const sessions = new Map();

const POINTS_BASE = 10;   // doit rester aligné avec le client (affichage)
const MAX_ERREURS = 7;

// ─────────────────────────────────────────────────────
// Chargement banque de mots (server/data/pendu.json)
// ─────────────────────────────────────────────────────

const PENDU_PATH     = path.join(__dirname, '..', 'data', 'pendu.json');
const PENDU_FALLBACK = '/data/pendu.json'; // Render disk en prod
let _motsCache = null;

async function _chargerMotsDisque() {
    if (_motsCache) return _motsCache;
    const candidates = [PENDU_PATH];
    if (process.env.NODE_ENV === 'production') candidates.unshift(PENDU_FALLBACK);

    for (const p of candidates) {
        try {
            const raw    = await fs.readFile(p, 'utf-8');
            const propre = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
            const data   = JSON.parse(propre);
            if (!Array.isArray(data) || !data.length) continue;
            _motsCache = data
                .filter(e => e && e.MOT && e.THEME)
                .map(e => ({ mot: String(e.MOT).toUpperCase(), theme: String(e.THEME).toUpperCase() }));
            console.log(`[PENDU] 📚 ${_motsCache.length} mot(s) chargé(s) depuis ${p}`);
            return _motsCache;
        } catch (err) {
            if (err.code !== 'ENOENT') console.warn(`[PENDU] ⚠️ ${p}:`, err.message);
        }
    }
    return null;
}

// ─────────────────────────────────────────────────────
// Sessions
// ─────────────────────────────────────────────────────

function _getSession(partieId) { return sessions.get(partieId) || null; }

function _creerSession(partieId) {
    const s = {
        phase             : 'idle',
        motSecret         : null,
        theme             : null,
        manche            : 0,
        tsDebut           : null,
        resultats         : {},        // { pseudo: { victoire, erreurs, points, ts } }
        revelationEnCours : false,
        motsJoues         : new Set(), // pour éviter de retirer le même mot
    };
    sessions.set(partieId, s);
    return s;
}

function _tirerMot(s, banque) {
    const dispo = banque.filter(m => !s.motsJoues.has(m.mot));
    const pool  = dispo.length ? dispo : banque; // recycle si tout joué
    const m     = pool[Math.floor(Math.random() * pool.length)];
    s.motsJoues.add(m.mot);
    return m;
}

function _calculerPoints(victoire, erreurs) {
    if (!victoire) return 0;
    return Math.max(1, POINTS_BASE - Math.max(0, Math.min(MAX_ERREURS, erreurs | 0)));
}

// ─────────────────────────────────────────────────────
// API publique
// ─────────────────────────────────────────────────────

export function getSessionState(partieId) {
    const s = _getSession(partieId);
    if (!s) return null;
    const base = { phase: s.phase, manche: s.manche };
    if (s.phase === 'jeu') {
        return {
            ...base,
            motSecret  : s.motSecret,
            theme      : s.theme,
            tsDebut    : s.tsDebut,
            nbResults  : Object.keys(s.resultats).length,
        };
    }
    if (s.phase === 'resultats') {
        return {
            ...base,
            motSecret : s.motSecret,
            theme     : s.theme,
            resultats : _payloadRevelation(s),
            scores    : store.getScores(partieId) || {},
        };
    }
    return base;
}

export function detruireSession(partieId) {
    sessions.delete(partieId);
    console.log(`[PENDU] 🗑️ Session détruite: ${partieId}`);
}

// ─────────────────────────────────────────────────────
// HOST ACTIONS
// ─────────────────────────────────────────────────────

export function handleHostAction(wss, ws, partieId, action, data, helpers) {
    const { broadcastToGame, broadcastToHost, send } = helpers;
    const cmd = action.split(':')[1];

    switch (cmd) {

        case 'load':
        case 'next_mot': {
            // .then()/.catch() pour garder la fonction synchrone (pattern quiz)
            // → le try/catch ws-handler capture les erreurs synchrones,
            //   le .catch gère les erreurs async (lecture disque).
            _chargerMotsDisque().then(banque => {
                if (!banque || !banque.length) {
                    return send(ws, 'ERROR', {
                        code   : 'PENDU_BAD_STATE',
                        message: 'Banque de mots introuvable côté serveur.',
                    });
                }

                let s = _getSession(partieId);
                if (!s) s = _creerSession(partieId);

                const m = _tirerMot(s, banque);
                s.manche++;
                s.phase             = 'jeu';
                s.motSecret         = m.mot;
                s.theme             = m.theme;
                s.tsDebut           = Date.now();
                s.resultats         = {};
                s.revelationEnCours = false;

                broadcastToGame(wss, partieId, 'PENDU_MOT_START', {
                    motSecret : s.motSecret,
                    theme     : s.theme,
                    manche    : s.manche,
                    scores    : store.getScores(partieId) || {},
                });
                console.log(`[PENDU] 🎲 Manche ${s.manche} — mot: "${s.motSecret}" (${s.theme})`);
            }).catch(err => {
                console.error('[PENDU] ❌ load/next_mot:', err);
                send(ws, 'ERROR', { code: 'PENDU_BAD_STATE', message: 'Erreur serveur lecture banque.' });
            });
            break;
        }

        case 'result': {
            const s = _getSession(partieId);
            if (!s || s.phase !== 'jeu') {
                return send(ws, 'PENDU_RESULT_ACK', { status: 'too_late' });
            }
            const partie = store.getPartie(partieId);
            const pseudo = (data.pseudo && String(data.pseudo).trim()) || partie?.hostPseudo || null;
            if (!pseudo) return send(ws, 'PENDU_RESULT_ACK', { status: 'invalid' });
            if (s.resultats[pseudo] !== undefined) {
                return send(ws, 'PENDU_RESULT_ACK', { status: 'already' });
            }

            const victoire = !!data.victoire;
            const erreurs  = Math.max(0, Math.min(MAX_ERREURS, (data.erreurs | 0)));
            const points   = _calculerPoints(victoire, erreurs);
            s.resultats[pseudo] = { victoire, erreurs, points, ts: Date.now() };

            send(ws, 'PENDU_RESULT_ACK', { status: 'ok' });

            const nbJoueurs  = (partie?.joueurs || []).length;
            const nbResults  = Object.keys(s.resultats).length;
            broadcastToHost(wss, partieId, 'PENDU_RESULT_IN', {
                pseudo, nbResults, nbJoueurs,
                allDone: nbResults >= nbJoueurs,
            });
            console.log(`[PENDU] 🎮 Résultat hôte ${pseudo}: victoire=${victoire}, pts=${points}`);
            break;
        }

        case 'reveal': {
            const s = _getSession(partieId);
            if (!s || s.phase !== 'jeu') {
                return send(ws, 'ERROR', { code: 'PENDU_BAD_STATE', message: 'Pas de manche en cours.' });
            }
            _declencherRevelation(wss, partieId, s, helpers, 'host');
            break;
        }

        default:
            console.warn(`[PENDU] ⚠️ Action host inconnue: ${cmd}`);
    }
}

// ─────────────────────────────────────────────────────
// PLAYER ACTIONS
// ─────────────────────────────────────────────────────

export function handlePlayerAction(wss, ws, partieId, pseudo, action, data, helpers) {
    const { broadcastToHost, send } = helpers;
    const cmd = action.split(':')[1];

    switch (cmd) {
        case 'result': {
            const s = _getSession(partieId);
            if (!s || s.phase !== 'jeu') {
                return send(ws, 'PENDU_RESULT_ACK', { status: 'too_late' });
            }
            if (!pseudo || pseudo === 'null' || pseudo === 'undefined') {
                return send(ws, 'PENDU_RESULT_ACK', { status: 'invalid' });
            }
            if (s.resultats[pseudo] !== undefined) {
                return send(ws, 'PENDU_RESULT_ACK', { status: 'already' });
            }

            const victoire = !!data.victoire;
            const erreurs  = Math.max(0, Math.min(MAX_ERREURS, (data.erreurs | 0)));
            const points   = _calculerPoints(victoire, erreurs);
            s.resultats[pseudo] = { victoire, erreurs, points, ts: Date.now() };

            send(ws, 'PENDU_RESULT_ACK', { status: 'ok' });

            const partie     = store.getPartie(partieId);
            const nbJoueurs  = (partie?.joueurs || []).length;
            const nbResults  = Object.keys(s.resultats).length;
            broadcastToHost(wss, partieId, 'PENDU_RESULT_IN', {
                pseudo, nbResults, nbJoueurs,
                allDone: nbResults >= nbJoueurs,
            });
            console.log(`[PENDU] 🎮 Résultat ${pseudo}: victoire=${victoire}, pts=${points}`);
            break;
        }

        default:
            console.warn(`[PENDU] ⚠️ Action joueur inconnue: ${cmd}`);
    }
}

// ─────────────────────────────────────────────────────
// Révélation
// ─────────────────────────────────────────────────────

function _payloadRevelation(s) {
    return Object.entries(s.resultats)
        .filter(([p]) => p && p !== 'null' && p !== 'undefined')
        .sort((a, b) => (b[1].points || 0) - (a[1].points || 0))
        .map(([pseudo, data]) => ({
            pseudo,
            victoire : !!data.victoire,
            erreurs  : data.erreurs || 0,
            points   : data.points  || 0,
        }));
}

function _declencherRevelation(wss, partieId, s, helpers, source) {
    if (s.revelationEnCours) return;
    s.revelationEnCours = true;

    const { broadcastToGame, broadcastToHost } = helpers;
    const liste = _payloadRevelation(s);

    liste.forEach(r => {
        if (r.points > 0) store.modifierScore(partieId, r.pseudo, r.points);
    });

    s.phase = 'resultats';
    const scores = store.getScores(partieId) || {};

    broadcastToGame(wss, partieId, 'PENDU_REVELATION', {
        motSecret : s.motSecret,
        theme     : s.theme,
        resultats : liste,
        scores,
        manche    : s.manche,
    });
    broadcastToGame(wss, partieId, 'SCORES_UPDATE', { scores });
    broadcastToHost(wss, partieId, 'PENDU_CAN_NEXT', { manche: s.manche });

    console.log(`[PENDU] 🎯 Révélation manche ${s.manche} — source: ${source}`);
}
