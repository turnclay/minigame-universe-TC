// ======================================================
// 🎮 server/games/quiz.js — v2.2 (stable + fixes points)
// ======================================================
// Corrections appliquées (depuis v2.0 original) :
//   - handler quiz:host_answer : enregistre la réponse hôte sans ws._pseudo
//   - _annulerTimers() centralisé : clearTimeout appelé EN PREMIER dans
//     next_question, AVANT la réinitialisation de l'état
//   - Guards pseudo null dans handlePlayerAction et _declencherRevelation
//   - [FIX v2.2] Scores du hôte comptabilisés dans resultats AVANT modifierScore
//   - [FIX v2.2] QUIZ_CORRECTION inclut les scores dans le payload
//   - [FIX v2.2] QUIZ_CAN_NEXT inclut les scores pour mise à jour client
// ======================================================

import store from '../store.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const sessions = new Map();

// ─────────────────────────────────────────────────────
// CHARGEMENT QUESTIONS — source canonique : server/data/questions.json
// Production Render : /data/questions.json (disque persistant) en fallback.
// Le tirage aléatoire est effectué EXCLUSIVEMENT côté serveur (CLAUDE.md
// §Questions : tirage aléatoire, ordre partagé, progression identique).
// ─────────────────────────────────────────────────────

const QUESTIONS_PATH = path.join(__dirname, '..', 'data', 'questions.json');
const QUESTIONS_FALLBACK_PROD = '/data/questions.json';

let _questionsCache = null;

async function _chargerQuestionsDisque() {
    if (_questionsCache) return _questionsCache;

    const candidates = [QUESTIONS_PATH];
    if (process.env.NODE_ENV === 'production') candidates.unshift(QUESTIONS_FALLBACK_PROD);

    for (const p of candidates) {
        try {
            const raw = await fs.readFile(p, 'utf-8');
            // Nettoyer les caractères de contrôle invalides (cohérent avec /api/questions)
            const propre = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
            const data   = JSON.parse(propre);
            if (!Array.isArray(data) || !data.length) continue;
            _questionsCache = data;
            console.log(`[QUIZ] 📚 ${data.length} question(s) chargée(s) depuis ${p}`);
            return data;
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.warn(`[QUIZ] ⚠️ Lecture ${p} échouée :`, err.message);
            }
        }
    }
    return null;
}

// Fisher-Yates — tirage déterministe pour CETTE session, partagé par tous.
function _melanger(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

function getSession(partieId)  { return sessions.get(partieId) || null; }

function creerSession(partieId) {
    const s = {
        phase             : 'idle',
        questions         : [],
        posees            : 0,
        questionEnCours   : null,
        reponses          : {},
        indicesBroadcast  : 0,
        revelationEnCours : false,
        timerHandle       : null,
        timerIndice1      : null,
        timerIndice2      : null,
        timerReveal       : null,
        _dernieresReponses: [],
        _autoStartPending : false,
    };
    sessions.set(partieId, s);
    return s;
}

// Annule TOUS les timers d'une session (timerReveal inclus)
function _annulerTimers(s) {
    if (s.timerHandle)  { clearTimeout(s.timerHandle);  s.timerHandle  = null; }
    if (s.timerIndice1) { clearTimeout(s.timerIndice1); s.timerIndice1 = null; }
    if (s.timerIndice2) { clearTimeout(s.timerIndice2); s.timerIndice2 = null; }
    if (s.timerReveal)  { clearTimeout(s.timerReveal);  s.timerReveal  = null; }
}

// ─────────────────────────────────────────────────────
// API publique
// ─────────────────────────────────────────────────────

export function getSessionState(partieId) {
    const s = getSession(partieId);
    if (!s) return null;
    const base = { phase: s.phase, total: s.questions.length };
    if (s.phase === 'question' && s.questionEnCours)
        return { ...base, payload: _questionPayload(s, s.questionEnCours), indicesBroadcast: s.indicesBroadcast, nbReponses: Object.keys(s.reponses).length };
    if (s.phase === 'correction' && s.questionEnCours)
        return { ...base, payload: _correctionPayload(s, s.questionEnCours, s._dernieresReponses || []) };
    if (s.phase === 'ended')
        return { ...base, scores: store.getScores(partieId) };
    return base;
}

export function detruireSession(partieId) {
    const s = getSession(partieId);
    if (s) _annulerTimers(s);
    sessions.delete(partieId);
    console.log(`[QUIZ] 🗑️ Session détruite: ${partieId}`);
}

// ─────────────────────────────────────────────────────
// HOST ACTIONS
// ─────────────────────────────────────────────────────

export function handleHostAction(wss, ws, partieId, action, data, helpers) {
    const { broadcastToGame, broadcastToHost, send } = helpers;
    const cmd = action.split(':')[1];

    switch (cmd) {

        // quiz:load — tirage et chargement EXCLUSIVEMENT côté serveur.
        // Le client n'envoie PLUS de questions (CLAUDE.md §Questions).
        // Si data.questions est présent (legacy), il est ignoré + warn.
        case 'load': {
            if (Array.isArray(data?.questions) && data.questions.length) {
                console.warn(`[QUIZ] ⚠️ quiz:load reçoit data.questions du client — ignoré (tirage serveur uniquement)`);
            }

            _chargerQuestionsDisque().then(banque => {
                if (!banque || !banque.length) {
                    return send(ws, 'ERROR', {
                        code   : 'QUIZ_BAD_STATE',
                        message: 'Banque de questions introuvable côté serveur.',
                    });
                }

                let s = getSession(partieId);
                if (s && (s.phase === 'ended' || s.questions.length === 0)) {
                    _annulerTimers(s);
                    sessions.delete(partieId);
                    s = null;
                }
                if (!s) s = creerSession(partieId);

                // Tirage Fisher-Yates côté serveur — ordre partagé par tous.
                const tirage = _melanger(banque);

                s.questions = tirage;
                s.posees    = 0;
                s.phase     = 'idle';

                broadcastToGame(wss, partieId, 'QUIZ_READY', {
                    total  : tirage.length,
                    message: `${tirage.length} question${tirage.length > 1 ? 's' : ''} chargée${tirage.length > 1 ? 's' : ''} !`,
                });

                s._autoStartPending = true;
                setTimeout(() => {
                    const sNow = getSession(partieId);
                    if (sNow && sNow.phase === 'idle' && sNow.questions.length > 0 && sNow._autoStartPending) {
                        sNow._autoStartPending = false;
                        handleHostAction(wss, ws, partieId, 'quiz:next_question', {}, helpers);
                    }
                }, 1000);
            }).catch(err => {
                console.error('[QUIZ] ❌ quiz:load échec chargement disque :', err);
                send(ws, 'ERROR', {
                    code   : 'QUIZ_BAD_STATE',
                    message: 'Erreur serveur lors du chargement des questions.',
                });
            });
            break;
        }

        case 'next_question': {
            let s = getSession(partieId);
            if (!s) s = creerSession(partieId);
            if (s._autoStartPending) s._autoStartPending = false;
            if (s.phase === 'question') return;
            if (!s.questions.length) return send(ws, 'ERROR', { code: 'QUIZ_BAD_STATE', message: 'Chargez les questions.' });
            if (s.posees >= s.questions.length) { _terminerQuiz(wss, partieId, s, helpers); return; }

            // Annuler TOUS les timers EN PREMIER, avant toute modification d'état
            _annulerTimers(s);

            const q  = s.questions[s.posees];
            s.posees++;
            s.phase              = 'question';
            s.questionEnCours    = q;
            s.reponses           = {};
            s.indicesBroadcast   = 0;
            s.revelationEnCours  = false;
            s._dernieresReponses = [];

            const DUREE = 60, T1 = 40, T2 = 50, ts0 = Date.now();
            q._tsIndice1 = ts0 + T1 * 1000;
            q._tsIndice2 = ts0 + T2 * 1000;
            q._tsDebut   = ts0;

            broadcastToGame(wss, partieId, 'QUIZ_QUESTION', _questionPayload(s, q));

            const texte1 = q['Indice 1'] || q.indice1 || '';
            if (texte1) {
                s.timerIndice1 = setTimeout(() => {
                    if (s.phase !== 'question' || s.questionEnCours !== q) return;
                    s.indicesBroadcast = Math.max(s.indicesBroadcast, 1);
                    broadcastToGame(wss, partieId, 'QUIZ_INDICE', { num: 1, texte: texte1 });
                }, T1 * 1000);
            }

            const texte2 = q['Indice 2'] || q.indice2 || '';
            if (texte2) {
                s.timerIndice2 = setTimeout(() => {
                    if (s.phase !== 'question' || s.questionEnCours !== q) return;
                    s.indicesBroadcast = Math.max(s.indicesBroadcast, 2);
                    broadcastToGame(wss, partieId, 'QUIZ_INDICE', { num: 2, texte: texte2 });
                }, T2 * 1000);
            }

            s.timerHandle = setTimeout(() => {
                if (s.phase !== 'question' || s.questionEnCours !== q) return;

                const partie        = store.getPartie(partieId);
                const nbJoueursReel = (partie?.joueurs || []).length;

                broadcastToHost(wss, partieId, 'QUIZ_TIMER_EXPIRED', {
                    partieId,
                    nbReponses : Object.keys(s.reponses).length,
                    nbJoueurs  : nbJoueursReel,
                });

                s.timerReveal = setTimeout(() => {
                    if (s.phase === 'question' && !s.revelationEnCours && s.questionEnCours === q) {
                        _declencherRevelation(wss, partieId, s, helpers, 'timer');
                    }
                }, 5000);
            }, DUREE * 1000);

            break;
        }

        // Réponse de l'hôte — utilise data.pseudo, jamais ws._pseudo (null pour host)
        case 'host_answer': {
            const s = getSession(partieId);
            if (!s || s.phase !== 'question') return send(ws, 'QUIZ_ANSWER_ACK', { status: 'too_late' });

            const partie     = store.getPartie(partieId);
            const pseudo     = (data.pseudo && String(data.pseudo).trim()) || partie?.hostPseudo || null;
            if (!pseudo)     return send(ws, 'QUIZ_ANSWER_ACK', { status: 'invalid' });
            if (s.reponses[pseudo] !== undefined) return send(ws, 'QUIZ_ANSWER_ACK', { status: 'already_answered' });

            const texte = (data.reponse || data.texte || '').trim();
            if (!texte) return send(ws, 'QUIZ_ANSWER_ACK', { status: 'invalid' });

            const ts = data.ts || Date.now();
            const q  = s.questionEnCours;
            let indicesVus = 0;
            if (q._tsIndice1 && ts > q._tsIndice1) indicesVus++;
            if (q._tsIndice2 && ts > q._tsIndice2) indicesVus++;

            s.reponses[pseudo] = { texte, ts, indicesVus };

            send(ws, 'QUIZ_ANSWER_ACK', { status: 'ok', texte });

            const nbReponses    = Object.keys(s.reponses).length;
            const nbJoueursReel = (partie?.joueurs || []).length;

            // Notifier l'hôte que sa propre réponse est enregistrée
            send(ws, 'QUIZ_RESPONSE_IN', {
                pseudo,
                nbReponses,
                nbJoueurs  : nbJoueursReel,
                allAnswered: nbReponses >= nbJoueursReel,
            });

            console.log(`[QUIZ] 🎮 Réponse hôte: ${pseudo} → "${texte}" (${nbReponses}/${nbJoueursReel})`);
            break;
        }

        case 'reveal': {
            const s = getSession(partieId);
            if (!s || s.phase !== 'question') return send(ws, 'ERROR', { code: 'QUIZ_BAD_STATE', message: 'Pas de question en cours.' });

            const partie     = store.getPartie(partieId);
            const hostPseudo = partie?.hostPseudo;

            // Fallback : intégrer réponse hôte si absente
            if (hostPseudo && (data.reponseHote || data.texte || data.reponse)) {
                if (s.reponses[hostPseudo] === undefined) {
                    s.reponses[hostPseudo] = {
                        texte      : (data.reponseHote || data.texte || data.reponse || '').trim(),
                        ts         : data.tsHote || Date.now(),
                        indicesVus : 2,
                    };
                    console.log(`[QUIZ] 🎮 Réponse hôte via reveal (fallback): ${hostPseudo}`);
                }
            }

            _declencherRevelation(wss, partieId, s, helpers, 'host');
            break;
        }

        case 'reveal_indice': {
            const s = getSession(partieId);
            if (!s || s.phase !== 'question') return send(ws, 'ERROR', { code: 'QUIZ_BAD_STATE' });
            const num = data.num;
            if (num !== 1 && num !== 2) return;
            const q   = s.questionEnCours;
            const txt = num === 1 ? (q['Indice 1'] || q.indice1 || '') : (q['Indice 2'] || q.indice2 || '');
            if (!txt) return send(ws, 'ERROR', { code: 'QUIZ_BAD_STATE', message: `Pas d'indice ${num}.` });
            s.indicesBroadcast = Math.max(s.indicesBroadcast, num);
            broadcastToGame(wss, partieId, 'QUIZ_INDICE', { num, texte: txt });
            break;
        }

        case 'skip': {
            const s = getSession(partieId);
            if (!s || s.phase !== 'question') return send(ws, 'ERROR', { code: 'QUIZ_BAD_STATE' });
            _annulerTimers(s);
            s.phase             = 'correction';
            s.revelationEnCours = false;
            if (s.questionEnCours) broadcastToGame(wss, partieId, 'QUIZ_CORRECTION', _correctionPayload(s, s.questionEnCours, []));
            break;
        }

        default:
            console.warn(`[QUIZ] ⚠️ Action host inconnue: ${cmd}`);
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
            const s = getSession(partieId);
            if (!s || s.phase !== 'question') return send(ws, 'QUIZ_ANSWER_ACK', { status: 'too_late' });

            // Guard pseudo null (hôte ne doit jamais passer par ici)
            if (!pseudo || String(pseudo) === 'null' || String(pseudo) === 'undefined') {
                console.warn('[QUIZ] ⚠️ quiz:answer — pseudo null rejeté');
                return send(ws, 'QUIZ_ANSWER_ACK', { status: 'invalid' });
            }

            if (s.reponses[pseudo] !== undefined) return send(ws, 'QUIZ_ANSWER_ACK', { status: 'already_answered' });

            const texte = (data.texte || data.reponse || '').trim();
            if (!texte) return send(ws, 'QUIZ_ANSWER_ACK', { status: 'invalid' });

            const ts = Date.now();
            const q  = s.questionEnCours;
            let indicesVus = 0;
            if (q._tsIndice1 && ts > q._tsIndice1) indicesVus++;
            if (q._tsIndice2 && ts > q._tsIndice2) indicesVus++;

            s.reponses[pseudo] = { texte, ts, indicesVus };
            send(ws, 'QUIZ_ANSWER_ACK', { status: 'ok', texte });

            const partie        = store.getPartie(partieId);
            const nbJoueursReel = (partie?.joueurs || []).length;
            const nbReponses    = Object.keys(s.reponses).length;

            broadcastToHost(wss, partieId, 'QUIZ_RESPONSE_IN', {
                pseudo,
                nbReponses,
                nbJoueurs  : nbJoueursReel,
                allAnswered: nbReponses >= nbJoueursReel,
            });
            break;
        }

        default:
            console.warn(`[QUIZ] ⚠️ Action joueur inconnue: ${cmd}`);
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

    const q = s.questionEnCours;
    if (!q) {
        console.error(`[QUIZ] ❌ questionEnCours null — source: ${source}`);
        s.revelationEnCours = false;
        return;
    }

    const bonneReponse = _getBonneReponse(q);

    const repTri = Object.entries(s.reponses)
        .filter(([p]) => p && p !== 'null' && p !== 'undefined')
        .sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));

    const resultats = [];
    let premierCorrect = null;

    repTri.forEach(([pseudo, rep]) => {
        const texte   = String(rep.texte || '').trim();
        const correct = bonneReponse ? _similarite(texte, bonneReponse) >= 0.85 : false;
        const points  = correct ? 1 : 0;
        resultats.push({ pseudo, texte, correct, points, estPremier: false });
        if (correct && !premierCorrect) premierCorrect = pseudo;
    });

    if (premierCorrect) {
        const res = resultats.find(r => r.pseudo === premierCorrect);
        if (res) { res.points += 1; res.estPremier = true; }
    }

    // [FIX v2.2] Comptabiliser les points AVANT le broadcast
    resultats.forEach(r => {
        if (r.points > 0) store.modifierScore(partieId, r.pseudo, r.points);
    });

    s._dernieresReponses = resultats;
    s.phase = 'correction';

    // [FIX v2.2] Inclure les scores dans le payload QUIZ_CORRECTION
    const scores = store.getScores(partieId) || {};
    const correctionPayload = _correctionPayload(s, q, resultats);
    correctionPayload.scores = scores;

    broadcastToGame(wss, partieId, 'QUIZ_CORRECTION', correctionPayload);

    broadcastToGame(wss, partieId, 'SCORES_UPDATE', { scores });

    // [FIX v2.2] Inclure les scores dans QUIZ_CAN_NEXT également
    broadcastToHost(wss, partieId, 'QUIZ_CAN_NEXT', {
        posees   : s.posees,
        total    : s.questions.length,
        remaining: s.questions.length - s.posees,
        scores,
    });
}

function _terminerQuiz(wss, partieId, s, helpers) {
    _annulerTimers(s);
    s.phase = 'ended';
    helpers.broadcastToGame(wss, partieId, 'QUIZ_END', {
        scores: store.getScores(partieId) || {},
        total : s.posees,
    });
}

// ─────────────────────────────────────────────────────
// Payload helpers
// ─────────────────────────────────────────────────────

function _questionPayload(s, q) {
    return {
        id        : s.posees,
        question  : q['Question']  || q.question  || '',
        theme     : q['Thème']     || q.theme     || '',
        hasIndice1: Boolean(q['Indice 1'] || q.indice1),
        hasIndice2: Boolean(q['Indice 2'] || q.indice2),
        posees    : s.posees,
        total     : s.questions.length,
        ts        : q._tsDebut || Date.now(),
    };
}

function _correctionPayload(s, q, resultats) {
    return {
        question : q['Question']  || q.question  || '',
        theme    : q['Thème']     || q.theme     || '',
        reponse  : _getBonneReponse(q),
        reponses : resultats,
        posees   : s.posees,
        total    : s.questions.length,
    };
}

function _getBonneReponse(q) {
    if (!q) return '';
    let r = q['Réponse'] ?? q.reponse ?? q.answer ?? '';
    return String(r).trim();
}


// ─────────────────────────────────────────────────────
// Similarité
// ─────────────────────────────────────────────────────

function _normaliser(str) {
    return String(str || '').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function _bigrammes(str) {
    const s = _normaliser(str);
    const bg = new Set();
    for (let i = 0; i < s.length - 1; i++) bg.add(s.slice(i, i + 2));
    return bg;
}

function _similarite(a, b) {
    if (!a || !b) return 0;
    if (_normaliser(a) === _normaliser(b)) return 1;
    const na = _normaliser(a), nb = _normaliser(b);
    if (nb.includes(na) || na.includes(nb)) return 0.9;
    const ba = _bigrammes(a), bb = _bigrammes(b);
    if (!ba.size || !bb.size) return 0;
    let inter = 0;
    ba.forEach(g => { if (bb.has(g)) inter++; });
    return (2 * inter) / (ba.size + bb.size);
}