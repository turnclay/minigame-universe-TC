// ======================================================
// 🎮 server/games/lml.js — v1.0 (P5.3)
// ======================================================
// Migration de "Maxi Lettres" (Mot le Plus Long) en WS-server-driven.
//
// Mécanique :
//   - Serveur tire 10 lettres : 3 voyelles + 7 consonnes (mélangées).
//   - Tous les joueurs ont 60 s pour trouver le mot le plus long
//     possible avec ces lettres (chaque lettre = usage unique).
//   - Validation serveur via Lexique383.tsv + contrainte multiset.
//   - Points = longueur du mot. Bonus +1 au plus long s'il est seul.
//   - À la révélation, on envoie aussi le motMax (meilleur possible).
//
// Actions hôte (HOST_ACTION) :
//   lml:load        → nouveau tirage + timer
//   lml:host_answer → soumet le mot de l'hôte (data.mot, data.pseudo?)
//   lml:reveal      → force la révélation
//   lml:next_manche → relance avec nouvelles lettres
//
// Action joueur (PLAYER_ACTION) :
//   lml:answer → soumet le mot (data.mot)
//
// Events serveur → clients :
//   LML_MANCHE_START   { lettres[], tsDebut, dureeMs, manche, scores }
//   LML_RESPONSE_IN    { pseudo, nbReponses, nbJoueurs, allAnswered }  (host)
//   LML_TIMER_EXPIRED  { nbReponses, nbJoueurs }                       (host)
//   LML_REVELATION     { lettres[], reponses[], motMax, scores, manche }
//   LML_CAN_NEXT       { manche }                                       (host)
//   LML_ANSWER_ACK     { status: 'ok'|'already'|'too_late'|'invalid' }
// ======================================================

import store from '../store.js';
import fs    from 'fs/promises';
import path  from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const sessions = new Map();

const VOYELLES   = ['A','E','I','O','U','Y'];
const CONSONNES  = 'BCDFGHJKLMNPQRSTVWXZ'.split('');
const DUREE_MS   = 60_000;
const NB_VOY     = 3;
const NB_CONS    = 7;

// ─────────────────────────────────────────────────────
// Lexique : chargement unique au boot, partagé entre toutes les sessions
// ─────────────────────────────────────────────────────

const LEXIQUE_PATH = path.join(__dirname, '..', 'data', 'Lexique383.tsv');
const LEXIQUE_FALLBACK_PROD = '/data/Lexique383.tsv';
let _lexique = null;          // Set<string> (mots uppercase, longueur >= 2)
let _lexiqueLoading = null;   // Promise<Set> en cours de chargement

function _chargerLexique() {
    if (_lexique) return Promise.resolve(_lexique);
    if (_lexiqueLoading) return _lexiqueLoading;

    const candidates = [LEXIQUE_PATH];
    if (process.env.NODE_ENV === 'production') candidates.unshift(LEXIQUE_FALLBACK_PROD);

    _lexiqueLoading = (async () => {
        for (const p of candidates) {
            try {
                const raw = await fs.readFile(p, 'utf-8');
                const lex = new Set();
                // Lexique383.tsv : 1ère colonne = mot (séparateur tab),
                // 1ère ligne = headers, sauter.
                const lines = raw.split('\n');
                for (let i = 1; i < lines.length; i++) {
                    const m = (lines[i].split('\t')[0] || '').trim().toUpperCase();
                    if (m && m.length >= 2) lex.add(m);
                }
                _lexique = lex;
                console.log(`[LML] 📚 Lexique chargé depuis ${p} — ${lex.size} mots`);
                return lex;
            } catch (err) {
                if (err.code !== 'ENOENT') console.warn(`[LML] ⚠️ ${p}:`, err.message);
            }
        }
        console.warn('[LML] ⚠️ Lexique introuvable — validation tombera sur le multiset uniquement');
        _lexique = new Set();
        return _lexique;
    })();
    return _lexiqueLoading;
}

// Charger en arrière-plan au démarrage du module
_chargerLexique().catch(() => {});

// ─────────────────────────────────────────────────────
// Sessions
// ─────────────────────────────────────────────────────

function _getSession(partieId) { return sessions.get(partieId) || null; }

function _creerSession(partieId) {
    const s = {
        phase             : 'idle',
        lettres           : [],
        manche            : 0,
        tsDebut           : null,
        reponses          : {},  // { pseudo: { mot, ts } }
        revelationEnCours : false,
        timerHandle       : null,
        timerReveal       : null,
    };
    sessions.set(partieId, s);
    return s;
}

function _annulerTimers(s) {
    if (s.timerHandle) { clearTimeout(s.timerHandle); s.timerHandle = null; }
    if (s.timerReveal) { clearTimeout(s.timerReveal); s.timerReveal = null; }
}

function _tirerLettres() {
    const arr = [];
    for (let i = 0; i < NB_VOY;  i++) arr.push(VOYELLES[Math.floor(Math.random() * VOYELLES.length)]);
    for (let i = 0; i < NB_CONS; i++) arr.push(CONSONNES[Math.floor(Math.random() * CONSONNES.length)]);
    // Mélange Fisher-Yates
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function _motValide(mot, lettres, lexique) {
    if (!mot || mot.length < 2) return false;
    if (lexique.size > 0 && !lexique.has(mot)) return false;
    const dispo = {};
    for (const l of lettres) dispo[l] = (dispo[l] || 0) + 1;
    for (const c of mot) {
        if (!dispo[c]) return false;
        dispo[c]--;
    }
    return true;
}

function _trouverMotMax(lettres, lexique) {
    if (!lexique || lexique.size === 0) return '';
    const dispo = {};
    for (const l of lettres) dispo[l] = (dispo[l] || 0) + 1;
    let meilleur = '';
    for (const mot of lexique) {
        if (mot.length <= meilleur.length) continue;
        const tmp = { ...dispo };
        let ok = true;
        for (const c of mot) {
            if (!tmp[c]) { ok = false; break; }
            tmp[c]--;
        }
        if (ok) meilleur = mot;
    }
    return meilleur;
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
            lettres    : s.lettres,
            tsDebut    : s.tsDebut,
            dureeMs    : DUREE_MS,
            nbReponses : Object.keys(s.reponses).length,
        };
    }
    if (s.phase === 'resultats') {
        return { ...base, lettres: s.lettres, scores: store.getScores(partieId) || {} };
    }
    return base;
}

export function detruireSession(partieId) {
    const s = _getSession(partieId);
    if (s) _annulerTimers(s);
    sessions.delete(partieId);
    console.log(`[LML] 🗑️ Session détruite: ${partieId}`);
}

// ─────────────────────────────────────────────────────
// HOST ACTIONS
// ─────────────────────────────────────────────────────

export function handleHostAction(wss, ws, partieId, action, data, helpers) {
    const { broadcastToGame, broadcastToHost, send } = helpers;
    const cmd = action.split(':')[1];

    switch (cmd) {

        case 'load':
        case 'next_manche': {
            let s = _getSession(partieId);
            if (!s) s = _creerSession(partieId);
            _annulerTimers(s);

            s.manche++;
            s.phase             = 'jeu';
            s.lettres           = _tirerLettres();
            s.tsDebut           = Date.now();
            s.reponses          = {};
            s.revelationEnCours = false;

            broadcastToGame(wss, partieId, 'LML_MANCHE_START', {
                lettres : s.lettres,
                tsDebut : s.tsDebut,
                dureeMs : DUREE_MS,
                manche  : s.manche,
                scores  : store.getScores(partieId) || {},
            });

            s.timerHandle = setTimeout(() => {
                if (s.phase !== 'jeu') return;
                const nbJoueurs = (store.getPartie(partieId)?.joueurs || []).length;
                broadcastToHost(wss, partieId, 'LML_TIMER_EXPIRED', {
                    nbReponses : Object.keys(s.reponses).length,
                    nbJoueurs,
                });
                s.timerReveal = setTimeout(() => {
                    if (s.phase === 'jeu' && !s.revelationEnCours) {
                        _declencherRevelation(wss, partieId, s, helpers, 'timer');
                    }
                }, 5000);
            }, DUREE_MS);

            console.log(`[LML] 🎲 Manche ${s.manche} — lettres: ${s.lettres.join('')}`);
            break;
        }

        case 'host_answer': {
            const s = _getSession(partieId);
            if (!s || s.phase !== 'jeu') {
                return send(ws, 'LML_ANSWER_ACK', { status: 'too_late' });
            }
            const partie = store.getPartie(partieId);
            const pseudo = (data.pseudo && String(data.pseudo).trim()) || partie?.hostPseudo || null;
            if (!pseudo) return send(ws, 'LML_ANSWER_ACK', { status: 'invalid' });
            if (s.reponses[pseudo] !== undefined) {
                return send(ws, 'LML_ANSWER_ACK', { status: 'already' });
            }
            const mot = String(data.mot || '').toUpperCase().trim();
            s.reponses[pseudo] = { mot, ts: Date.now() };

            send(ws, 'LML_ANSWER_ACK', { status: 'ok' });

            const nbJoueurs  = (partie?.joueurs || []).length;
            const nbReponses = Object.keys(s.reponses).length;
            broadcastToHost(wss, partieId, 'LML_RESPONSE_IN', {
                pseudo, nbReponses, nbJoueurs,
                allAnswered: nbReponses >= nbJoueurs,
            });
            console.log(`[LML] 🎮 Mot hôte ${pseudo}: "${mot}"`);
            break;
        }

        case 'reveal': {
            const s = _getSession(partieId);
            if (!s || s.phase !== 'jeu') {
                return send(ws, 'ERROR', { code: 'LML_BAD_STATE' });
            }
            _declencherRevelation(wss, partieId, s, helpers, 'host');
            break;
        }

        default:
            console.warn(`[LML] ⚠️ Action host inconnue: ${cmd}`);
    }
}

// ─────────────────────────────────────────────────────
// PLAYER ACTIONS
// ─────────────────────────────────────────────────────

export function handlePlayerAction(wss, ws, partieId, pseudo, action, data, helpers) {
    const { broadcastToHost, send } = helpers;
    const cmd = action.split(':')[1];

    switch (cmd) {
        case 'answer': {
            const s = _getSession(partieId);
            if (!s || s.phase !== 'jeu') {
                return send(ws, 'LML_ANSWER_ACK', { status: 'too_late' });
            }
            if (!pseudo || pseudo === 'null' || pseudo === 'undefined') {
                return send(ws, 'LML_ANSWER_ACK', { status: 'invalid' });
            }
            if (s.reponses[pseudo] !== undefined) {
                return send(ws, 'LML_ANSWER_ACK', { status: 'already' });
            }
            const mot = String(data.mot || '').toUpperCase().trim();
            s.reponses[pseudo] = { mot, ts: Date.now() };

            send(ws, 'LML_ANSWER_ACK', { status: 'ok' });

            const partie     = store.getPartie(partieId);
            const nbJoueurs  = (partie?.joueurs || []).length;
            const nbReponses = Object.keys(s.reponses).length;
            broadcastToHost(wss, partieId, 'LML_RESPONSE_IN', {
                pseudo, nbReponses, nbJoueurs,
                allAnswered: nbReponses >= nbJoueurs,
            });
            console.log(`[LML] 🎮 Mot ${pseudo}: "${mot}"`);
            break;
        }

        default:
            console.warn(`[LML] ⚠️ Action joueur inconnue: ${cmd}`);
    }
}

// ─────────────────────────────────────────────────────
// Révélation
// ─────────────────────────────────────────────────────

function _declencherRevelation(wss, partieId, s, helpers, source) {
    if (s.revelationEnCours) return;
    s.revelationEnCours = true;
    _annulerTimers(s);

    const { broadcastToGame, broadcastToHost } = helpers;

    _chargerLexique().then(lexique => {
        const repTri = Object.entries(s.reponses)
            .filter(([p]) => p && p !== 'null' && p !== 'undefined')
            .sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));

        const resultats = repTri.map(([pseudo, d]) => {
            const mot    = String(d.mot || '').toUpperCase().trim();
            const valide = _motValide(mot, s.lettres, lexique);
            return { pseudo, mot, valide, points: valide ? mot.length : 0, estPlusLong: false };
        });

        // Bonus +1 au plus long valide s'il est SEUL
        const valides = resultats.filter(r => r.valide);
        if (valides.length) {
            const maxLen   = Math.max(...valides.map(r => r.mot.length));
            const plusLong = valides.filter(r => r.mot.length === maxLen);
            if (plusLong.length === 1) {
                plusLong[0].estPlusLong = true;
                plusLong[0].points += 1;
            }
        }

        // Créditer scores
        resultats.forEach(r => {
            if (r.points > 0) store.modifierScore(partieId, r.pseudo, r.points);
        });

        s.phase = 'resultats';
        const motMax = _trouverMotMax(s.lettres, lexique);
        const scores = store.getScores(partieId) || {};

        broadcastToGame(wss, partieId, 'LML_REVELATION', {
            lettres   : s.lettres,
            reponses  : resultats,
            motMax,
            scores,
            manche    : s.manche,
        });
        broadcastToGame(wss, partieId, 'SCORES_UPDATE', { scores });
        broadcastToHost(wss, partieId, 'LML_CAN_NEXT', { manche: s.manche });

        console.log(`[LML] 🎯 Révélation manche ${s.manche} — source: ${source} — motMax: "${motMax}"`);
    }).catch(err => {
        console.error('[LML] ❌ révélation:', err);
        s.revelationEnCours = false;
    });
}
