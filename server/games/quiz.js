// ======================================================
// 🎮 server/games/quiz.js — v2.1 (FIX — host_answer)
// ======================================================
// [FIX 3] Ajout du handler quiz:host_answer dans handleHostAction.
//
// POURQUOI :
//   L'hôte envoie HOST_ACTION { action:'quiz:host_answer', data:{pseudo,reponse,ts} }.
//   Le socket hôte a ws._isHost=true et ws._pseudo=null.
//   Si on routait via PLAYER_ACTION, le serveur lirait ws._pseudo=null
//   et la réponse serait indexée sous "null" dans s.reponses.
//
//   quiz:host_answer lit data.pseudo (envoyé explicitement par quiz_hote.js)
//   ou en fallback partie.hostPseudo — jamais ws._pseudo.
//
// AUSSI dans quiz:reveal :
//   La réponse de l'hôte est intégrée dans s.reponses[hostPseudo]
//   avant _declencherRevelation(), cohérent avec quiz:host_answer.
// ======================================================

import store from '../store.js';

// ─────────────────────────────────────────────────────
// Sessions en mémoire
// ─────────────────────────────────────────────────────

const sessions = new Map();

function getSession(partieId) {
    return sessions.get(partieId) || null;
}

function creerSession(partieId) {
    const session = {
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
    sessions.set(partieId, session);
    return session;
}

// ─────────────────────────────────────────────────────
// API publique
// ─────────────────────────────────────────────────────

export function getSessionState(partieId) {
    const s = getSession(partieId);
    if (!s) return null;

    const base = { phase: s.phase, total: s.questions.length };

    if (s.phase === 'question' && s.questionEnCours) {
        return {
            ...base,
            payload         : _questionPayload(s, s.questionEnCours),
            indicesBroadcast: s.indicesBroadcast,
            nbReponses      : Object.keys(s.reponses).length,
        };
    }
    if (s.phase === 'correction' && s.questionEnCours) {
        return {
            ...base,
            payload: _correctionPayload(s, s.questionEnCours, s._dernieresReponses || []),
        };
    }
    if (s.phase === 'ended') {
        return { ...base, scores: store.getScores(partieId) };
    }
    return base;
}

export function detruireSession(partieId) {
    const s = getSession(partieId);
    if (s) {
        if (s.timerHandle)  clearTimeout(s.timerHandle);
        if (s.timerIndice1) clearTimeout(s.timerIndice1);
        if (s.timerIndice2) clearTimeout(s.timerIndice2);
        if (s.timerReveal)  clearTimeout(s.timerReveal);
    }
    sessions.delete(partieId);
    console.log(`[QUIZ] 🗑️ Session détruite: ${partieId}`);
}

// ─────────────────────────────────────────────────────
// Handlers d'actions HÔTE
// ─────────────────────────────────────────────────────

export function handleHostAction(wss, ws, partieId, action, data, helpers) {
    const { broadcastToGame, broadcastToHost, send } = helpers;
    const cmd = action.split(':')[1];

    switch (cmd) {

        // ───────────────────────────────────────────────
        // quiz:load
        // ───────────────────────────────────────────────
        case 'load': {
            let s = getSession(partieId);

            if (s && (s.phase === 'ended' || s.questions.length === 0)) {
                if (s.timerHandle) clearTimeout(s.timerHandle);
                sessions.delete(partieId);
                s = null;
            }
            if (!s) s = creerSession(partieId);

            const questions = Array.isArray(data.questions) ? data.questions : [];
            if (questions.length === 0) {
                return send(ws, 'ERROR', { code: 'QUIZ_BAD_STATE', message: 'Aucune question fournie.' });
            }

            s.questions = questions;
            s.posees    = 0;
            s.phase     = 'idle';

            broadcastToGame(wss, partieId, 'QUIZ_READY', {
                total   : questions.length,
                message : `${questions.length} question${questions.length > 1 ? 's' : ''} chargée${questions.length > 1 ? 's' : ''} !`,
            });

            s._autoStartPending = true;
            setTimeout(() => {
                const sNow = getSession(partieId);
                if (sNow && sNow.phase === 'idle' && sNow.questions.length > 0 && sNow._autoStartPending) {
                    sNow._autoStartPending = false;
                    handleHostAction(wss, ws, partieId, 'quiz:next_question', {}, helpers);
                }
            }, 1000);
            break;
        }

        // ───────────────────────────────────────────────
        // quiz:next_question
        // ───────────────────────────────────────────────
        case 'next_question': {
            let s = getSession(partieId);
            if (!s) s = creerSession(partieId);

            if (s._autoStartPending) s._autoStartPending = false;

            if (s.phase === 'question') return;
            if (s.questions.length === 0) {
                return send(ws, 'ERROR', { code: 'QUIZ_BAD_STATE', message: 'Chargez les questions avec quiz:load.' });
            }
            if (s.posees >= s.questions.length) {
                _terminerQuiz(wss, partieId, s, helpers);
                return;
            }

            const q  = s.questions[s.posees];
            s.posees++;
            s.phase              = 'question';
            s.questionEnCours    = q;
            s.reponses           = {};
            s.indicesBroadcast   = 0;
            s.revelationEnCours  = false;
            s._dernieresReponses = [];

            const DUREE     = 60;
            const T_INDICE1 = 40;
            const T_INDICE2 = 50;
            const tsDebut   = Date.now();

            q._tsIndice1 = tsDebut + T_INDICE1 * 1000;
            q._tsIndice2 = tsDebut + T_INDICE2 * 1000;
            q._tsDebut   = tsDebut;

            broadcastToGame(wss, partieId, 'QUIZ_QUESTION', _questionPayload(s, q));

            if (s.timerHandle)   clearTimeout(s.timerHandle);
            if (s.timerIndice1)  clearTimeout(s.timerIndice1);
            if (s.timerIndice2)  clearTimeout(s.timerIndice2);

            const texte1 = q['Indice 1'] || q.indice1 || '';
            if (texte1) {
                s.timerIndice1 = setTimeout(() => {
                    if (s.phase !== 'question') return;
                    s.indicesBroadcast = Math.max(s.indicesBroadcast, 1);
                    broadcastToGame(wss, partieId, 'QUIZ_INDICE', { num: 1, texte: texte1 });
                }, T_INDICE1 * 1000);
            }

            const texte2 = q['Indice 2'] || q.indice2 || '';
            if (texte2) {
                s.timerIndice2 = setTimeout(() => {
                    if (s.phase !== 'question') return;
                    s.indicesBroadcast = Math.max(s.indicesBroadcast, 2);
                    broadcastToGame(wss, partieId, 'QUIZ_INDICE', { num: 2, texte: texte2 });
                }, T_INDICE2 * 1000);
            }

            s.timerHandle = setTimeout(() => {
                if (s.phase !== 'question') return;

                const partie       = store.getPartie(partieId);
                const nbJoueursReel = (partie?.joueurs || []).length;

                broadcastToHost(wss, partieId, 'QUIZ_TIMER_EXPIRED', {
                    partieId,
                    nbReponses : Object.keys(s.reponses).length,
                    // [FIX 3] nbJoueurs = total réel depuis store (hôte inclus si hostJoue:true)
                    nbJoueurs  : nbJoueursReel,
                });

                s.timerReveal = setTimeout(() => {
                    if (s.phase === 'question' && !s.revelationEnCours) {
                        _declencherRevelation(wss, partieId, s, helpers, 'timer');
                    }
                }, 5000);
            }, DUREE * 1000);

            break;
        }

        // ───────────────────────────────────────────────
        // quiz:host_answer
        // ───────────────────────────────────────────────
        // [FIX 3] Nouveau handler : enregistre la réponse de l'hôte
        // dans s.reponses en utilisant data.pseudo (explicitement transmis
        // par quiz_hote.js) ou en fallback partie.hostPseudo.
        // N'utilise JAMAIS ws._pseudo qui est null pour le socket hôte.
        case 'host_answer': {
            const s = getSession(partieId);

            if (!s || s.phase !== 'question') {
                return send(ws, 'QUIZ_ANSWER_ACK', { status: 'too_late' });
            }

            const partie     = store.getPartie(partieId);
            // [FIX 3] pseudo : data.pseudo en priorité, sinon partie.hostPseudo
            const pseudo     = (data.pseudo && String(data.pseudo).trim())
                || partie?.hostPseudo
                || null;

            if (!pseudo) {
                console.warn('[QUIZ] ⚠️ quiz:host_answer — pseudo introuvable (data.pseudo et hostPseudo null)');
                return send(ws, 'QUIZ_ANSWER_ACK', { status: 'invalid' });
            }

            if (s.reponses[pseudo] !== undefined) {
                return send(ws, 'QUIZ_ANSWER_ACK', { status: 'already_answered' });
            }

            const texte = (data.reponse || data.texte || '').trim();
            if (!texte) {
                return send(ws, 'QUIZ_ANSWER_ACK', { status: 'invalid' });
            }

            const ts  = data.ts || Date.now();
            const q   = s.questionEnCours;

            let indicesVus = 0;
            if (q._tsIndice1 && ts > q._tsIndice1) indicesVus++;
            if (q._tsIndice2 && ts > q._tsIndice2) indicesVus++;

            s.reponses[pseudo] = { texte, ts, indicesVus };

            send(ws, 'QUIZ_ANSWER_ACK', { status: 'ok', texte });

            const nbReponses    = Object.keys(s.reponses).length;
            const nbJoueursReel = (partie?.joueurs || []).length;
            const allAnswered   = nbReponses >= nbJoueursReel;

            // Notifier l'hôte que SA réponse est enregistrée
            // (QUIZ_RESPONSE_IN avec son propre pseudo pour MAJ du panneau)
            send(ws, 'QUIZ_RESPONSE_IN', {
                pseudo,
                nbReponses,
                nbJoueurs  : nbJoueursReel,
                allAnswered,
            });

            console.log(`[QUIZ] 🎮 Réponse hôte enregistrée: ${pseudo} → "${texte}" (${nbReponses}/${nbJoueursReel})`);
            break;
        }

        // ───────────────────────────────────────────────
        // quiz:reveal
        // ───────────────────────────────────────────────
        case 'reveal': {
            const s = getSession(partieId);
            if (!s || s.phase !== 'question') {
                return send(ws, 'ERROR', { code: 'QUIZ_BAD_STATE', message: 'Pas de question en cours.' });
            }

            const partie     = store.getPartie(partieId);
            const hostPseudo = partie?.hostPseudo;

            // Intégrer la réponse hôte si elle n'est pas déjà dans s.reponses
            // (cas fallback : hôte n'a pas envoyé quiz:host_answer mais a
            // quand même saisi une réponse et cliqué "Afficher")
            if (hostPseudo && (data.reponseHote || data.texte || data.reponse)) {
                if (s.reponses[hostPseudo] === undefined) {
                    const ts = data.tsHote || Date.now();
                    s.reponses[hostPseudo] = {
                        texte      : (data.reponseHote || data.texte || data.reponse || '').trim(),
                        ts,
                        indicesVus : 2,
                    };
                    console.log(`[QUIZ] 🎮 Réponse hôte intégrée via quiz:reveal (fallback): ${hostPseudo}`);
                }
            }

            _declencherRevelation(wss, partieId, s, helpers, 'host');
            break;
        }

        // ───────────────────────────────────────────────
        // quiz:reveal_indice
        // ───────────────────────────────────────────────
        case 'reveal_indice': {
            const s = getSession(partieId);
            if (!s || s.phase !== 'question') {
                return send(ws, 'ERROR', { code: 'QUIZ_BAD_STATE' });
            }
            const num = data.num;
            if (num !== 1 && num !== 2) return;

            const q   = s.questionEnCours;
            const txt = num === 1 ? (q['Indice 1'] || q.indice1 || '') : (q['Indice 2'] || q.indice2 || '');

            if (!txt) {
                return send(ws, 'ERROR', { code: 'QUIZ_BAD_STATE', message: `Pas d'indice ${num}.` });
            }

            s.indicesBroadcast = Math.max(s.indicesBroadcast, num);
            broadcastToGame(wss, partieId, 'QUIZ_INDICE', { num, texte: txt });
            break;
        }

        // ───────────────────────────────────────────────
        // quiz:skip
        // ───────────────────────────────────────────────
        case 'skip': {
            const s = getSession(partieId);
            if (!s || s.phase !== 'question') {
                return send(ws, 'ERROR', { code: 'QUIZ_BAD_STATE' });
            }
            if (s.timerHandle) clearTimeout(s.timerHandle);

            s.phase             = 'correction';
            s.revelationEnCours = false;

            broadcastToGame(wss, partieId, 'QUIZ_CORRECTION', _correctionPayload(s, s.questionEnCours, []));
            break;
        }

        default:
            console.warn(`[QUIZ] ⚠️ Action host inconnue: ${cmd}`);
    }
}

// ─────────────────────────────────────────────────────
// Handlers d'actions JOUEUR (invités uniquement)
// ─────────────────────────────────────────────────────

export function handlePlayerAction(wss, ws, partieId, pseudo, action, data, helpers) {
    const { broadcastToHost, send } = helpers;
    const cmd = action.split(':')[1];

    switch (cmd) {

        case 'answer': {
            const s = getSession(partieId);

            if (!s || s.phase !== 'question') {
                return send(ws, 'QUIZ_ANSWER_ACK', { status: 'too_late' });
            }

            // [FIX 3] Guard : pseudo ne doit jamais être null ici
            if (!pseudo || pseudo === 'null' || pseudo === 'undefined') {
                console.warn('[QUIZ] ⚠️ quiz:answer reçu avec pseudo null — rejeté');
                return send(ws, 'QUIZ_ANSWER_ACK', { status: 'invalid' });
            }

            if (s.reponses[pseudo] !== undefined) {
                return send(ws, 'QUIZ_ANSWER_ACK', { status: 'already_answered' });
            }

            const texte = (data.texte || data.reponse || '').trim();
            if (!texte) {
                return send(ws, 'QUIZ_ANSWER_ACK', { status: 'invalid' });
            }

            const ts = Date.now();
            const q  = s.questionEnCours;

            let indicesVus = 0;
            if (q._tsIndice1 && ts > q._tsIndice1) indicesVus++;
            if (q._tsIndice2 && ts > q._tsIndice2) indicesVus++;

            s.reponses[pseudo] = { texte, ts, indicesVus };

            send(ws, 'QUIZ_ANSWER_ACK', { status: 'ok', texte });

            const partie        = store.getPartie(partieId);
            // [FIX 3] nbJoueurs = total réel depuis store
            const nbJoueursReel = (partie?.joueurs || []).length;
            const nbReponses    = Object.keys(s.reponses).length;
            const allAnswered   = nbReponses >= nbJoueursReel;

            broadcastToHost(wss, partieId, 'QUIZ_RESPONSE_IN', {
                pseudo,
                nbReponses,
                nbJoueurs : nbJoueursReel,
                allAnswered,
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

    if (s.timerHandle)  clearTimeout(s.timerHandle);
    if (s.timerIndice1) clearTimeout(s.timerIndice1);
    if (s.timerIndice2) clearTimeout(s.timerIndice2);
    if (s.timerReveal)  clearTimeout(s.timerReveal);

    const { broadcastToGame, broadcastToHost } = helpers;
    const q            = s.questionEnCours;
    const bonneReponse = _getBonneReponse(q);

    const repTri = Object.entries(s.reponses)
        .sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));

    const resultats = [];
    let premierCorrectPseudo = null;

    repTri.forEach(([pseudo, data]) => {
        // [FIX 3] Guard : ignorer les entrées null parasites
        if (!pseudo || pseudo === 'null' || pseudo === 'undefined') return;

        const texte   = String(data.texte || '').trim();
        const sim     = bonneReponse ? _similarite(texte, bonneReponse) : 0;
        const correct = sim >= 0.85;

        let points = correct ? 1 : 0;

        resultats.push({
            pseudo,
            texte,
            correct,
            points,
            estPremier: false,
        });

        if (correct && !premierCorrectPseudo) premierCorrectPseudo = pseudo;
    });

    if (premierCorrectPseudo) {
        const res = resultats.find(r => r.pseudo === premierCorrectPseudo);
        if (res) { res.points += 1; res.estPremier = true; }
    }

    resultats.forEach(r => {
        if (r.points > 0) store.modifierScore(partieId, r.pseudo, r.points);
    });

    s._dernieresReponses = resultats;
    s.phase = 'correction';

    broadcastToGame(wss, partieId, 'QUIZ_CORRECTION', _correctionPayload(s, q, resultats));

    const scoresActuels = store.getScores(partieId);
    broadcastToGame(wss, partieId, 'SCORES_UPDATE', { scores: scoresActuels });

    broadcastToHost(wss, partieId, 'QUIZ_CAN_NEXT', {
        posees   : s.posees,
        total    : s.questions.length,
        remaining: s.questions.length - s.posees,
        scores   : scoresActuels,
    });
}

// ─────────────────────────────────────────────────────
// Fin de quiz
// ─────────────────────────────────────────────────────

function _terminerQuiz(wss, partieId, s, helpers) {
    const { broadcastToGame } = helpers;
    if (s.timerHandle) clearTimeout(s.timerHandle);

    s.phase = 'ended';

    broadcastToGame(wss, partieId, 'QUIZ_END', {
        scores: store.getScores(partieId),
        total : s.posees,
    });
}

// ─────────────────────────────────────────────────────
// Helpers payload
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
    return (q['Réponse'] || q.reponse || q.answer || '').trim();
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
    if (ba.size === 0 || bb.size === 0) return 0;
    let inter = 0;
    ba.forEach(g => { if (bb.has(g)) inter++; });
    return (2 * inter) / (ba.size + bb.size);
}