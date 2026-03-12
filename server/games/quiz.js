// ======================================================
// 🧠 QUIZ.JS — Module serveur pour le jeu de quiz
// ======================================================
// - Gère les sessions de quiz par partieId
// - Charge les questions depuis /data/questions.json
// - Réagit aux HOST_ACTION et PLAYER_ACTION routés par ws-handler
// - Ne contient AUCUN code client / DOM / document / window
// ======================================================

'use strict';

const fs   = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────
// Chargement des questions
// ─────────────────────────────────────────────────────

let QUESTIONS = [];
let QUESTIONS_TOTAL = 0;

function chargerQuestions() {
    if (QUESTIONS.length) return;

    try {
        const filePath = path.join(__dirname, '..', '..', 'data', 'questions.json');
        const raw = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw);

        if (Array.isArray(data)) {
            QUESTIONS = data;
        } else if (Array.isArray(data.questions)) {
            QUESTIONS = data.questions;
        } else {
            console.error('[QUIZ] ❌ Format questions.json invalide (attendu: tableau ou {questions:[]})');
            QUESTIONS = [];
        }

        QUESTIONS_TOTAL = QUESTIONS.length;
        console.log(`[QUIZ] ✅ ${QUESTIONS_TOTAL} questions chargées depuis questions.json`);
    } catch (err) {
        console.error('[QUIZ] ❌ Erreur chargement questions.json:', err);
        QUESTIONS = [];
        QUESTIONS_TOTAL = 0;
    }
}

// ─────────────────────────────────────────────────────
// Sessions en mémoire
// ─────────────────────────────────────────────────────
//
// sessions.set(partieId, {
//   questions: [...],
//   idx: -1,
//   etat: 'idle' | 'question' | 'correction' | 'ended',
//   reponses: Map<pseudo, { texte, correct }>
//   scores: { [pseudo]: number },
// });
//
// ─────────────────────────────────────────────────────

const sessions = new Map();

function getSession(partieId) {
    return sessions.get(partieId) || null;
}

function createSession(partieId) {
    chargerQuestions();
    const sess = {
        questions: QUESTIONS,
        idx: -1,
        etat: 'idle',
        reponses: new Map(),
        scores: {},
    };
    sessions.set(partieId, sess);
    return sess;
}

function detruireSession(partieId) {
    if (sessions.has(partieId)) {
        sessions.delete(partieId);
        console.log(`[QUIZ] 🧹 Session détruite pour partie ${partieId}`);
    }
}

// ─────────────────────────────────────────────────────
// Helpers internes
// ─────────────────────────────────────────────────────

function envoyerErreur(helpers, ws, code, message) {
    helpers.send(ws, 'ERROR', {
        code: code || 'QUIZ_BAD_STATE',
        message: message || 'Action impossible dans cet état.',
    });
}

function construirePayloadQuestion(sess) {
    const q = sess.questions[sess.idx];
    if (!q) return null;

    return {
        idx:      sess.idx,
        total:    sess.questions.length,
        theme:    q.theme || q.categorie || null,
        question: q.question || q.texte || '',
        type:     q.type === 'qcm' ? 'qcm' : 'texte',
        choix:    Array.isArray(q.choix) ? q.choix : null,
        indice1:  q.indice1 || null,
        indice2:  q.indice2 || null,
        points:   typeof q.points === 'number' ? q.points : 1,
    };
}

function construirePayloadCorrection(sess) {
    const q = sess.questions[sess.idx];
    if (!q) return null;

    const reponseBonne = q.reponse || q.bonneReponse || '';
    const points       = typeof q.points === 'number' ? q.points : 1;

    const reponses = Array.from(sess.reponses.entries()).map(([pseudo, r]) => ({
        pseudo,
        texte:   r.texte,
        correct: r.correct,
    }));

    return {
        idx:      sess.idx,
        total:    sess.questions.length,
        theme:    q.theme || q.categorie || null,
        question: q.question || q.texte || '',
        reponse:  reponseBonne,
        type:     q.type === 'qcm' ? 'qcm' : 'texte',
        points,
        reponses,
    };
}

function corrigerReponses(sess) {
    const q = sess.questions[sess.idx];
    if (!q) return;

    const bonne = String(q.reponse || q.bonneReponse || '').trim().toLowerCase();
    const points = typeof q.points === 'number' ? q.points : 1;

    sess.reponses.forEach((r, pseudo) => {
        const texteNorm = String(r.texte || '').trim().toLowerCase();
        const correct = texteNorm === bonne;
        r.correct = correct;

        if (correct) {
            if (!sess.scores[pseudo]) sess.scores[pseudo] = 0;
            sess.scores[pseudo] += points;
        }
    });
}

// ─────────────────────────────────────────────────────
// HOST_ACTION
// ─────────────────────────────────────────────────────
//
// Actions attendues :
//   - quiz:next_question
//   - quiz:reveal
//   - quiz:skip
//   - quiz:reveal_indice { num }
// ─────────────────────────────────────────────────────

function handleHostAction(wss, ws, partieId, action, data = {}, helpers) {
    const { broadcastToGame, broadcastToHost } = helpers;

    if (!partieId) {
        return envoyerErreur(helpers, ws, 'QUIZ_BAD_STATE', 'Partie inconnue.');
    }

    let sess = getSession(partieId);

    switch (action) {

        case 'quiz:next_question': {
            if (!sess) {
                // Première utilisation : créer la session
                sess = createSession(partieId);
                // Informer le host que le quiz est prêt
                broadcastToHost(wss, partieId, 'QUIZ_READY', {
                    total:   sess.questions.length,
                    message: 'Quiz prêt, vous pouvez commencer.',
                });
            }

            if (!sess.questions.length) {
                return envoyerErreur(helpers, ws, 'QUIZ_BAD_STATE', 'Aucune question disponible.');
            }

            // Passer à la question suivante
            sess.idx += 1;
            sess.reponses.clear();
            sess.etat = 'question';

            if (sess.idx >= sess.questions.length) {
                // Plus de questions → fin du quiz
                const scores = sess.scores || {};
                broadcastToGame(wss, partieId, 'QUIZ_END', {
                    scores,
                    total: sess.questions.length,
                });
                sess.etat = 'ended';
                console.log(`[QUIZ] 🏁 Fin du quiz pour partie ${partieId}`);
                return;
            }

            const payload = construirePayloadQuestion(sess);
            if (!payload) {
                return envoyerErreur(helpers, ws, 'QUIZ_BAD_STATE', 'Question introuvable.');
            }

            broadcastToGame(wss, partieId, 'QUIZ_QUESTION', payload);
            console.log(`[QUIZ] ▶ Question ${sess.idx + 1}/${sess.questions.length} pour partie ${partieId}`);
            break;
        }

        case 'quiz:reveal': {
            if (!sess || sess.etat !== 'question' || sess.idx < 0) {
                return envoyerErreur(helpers, ws, 'QUIZ_BAD_STATE', 'Aucune question en cours à révéler.');
            }

            corrigerReponses(sess);
            const payload = construirePayloadCorrection(sess);
            if (!payload) {
                return envoyerErreur(helpers, ws, 'QUIZ_BAD_STATE', 'Impossible de construire la correction.');
            }

            sess.etat = 'correction';

            broadcastToGame(wss, partieId, 'QUIZ_CORRECTION', payload);
            broadcastToGame(wss, partieId, 'SCORES_UPDATE', { scores: sess.scores });

            console.log(`[QUIZ] ✅ Correction envoyée pour Q${sess.idx + 1} (partie ${partieId})`);
            break;
        }

        case 'quiz:skip': {
            if (!sess || sess.etat !== 'question' || sess.idx < 0) {
                return envoyerErreur(helpers, ws, 'QUIZ_BAD_STATE', 'Aucune question en cours à passer.');
            }

            const payload = construirePayloadCorrection(sess);
            if (!payload) {
                return envoyerErreur(helpers, ws, 'QUIZ_BAD_STATE', 'Impossible de construire la correction.');
            }

            // On ne corrige pas les réponses, pas de points attribués
            sess.etat = 'correction';

            broadcastToGame(wss, partieId, 'QUIZ_CORRECTION', payload);
            console.log(`[QUIZ] ⏭ Question passée pour partie ${partieId}`);
            break;
        }

        case 'quiz:reveal_indice': {
            if (!sess || sess.etat !== 'question' || sess.idx < 0) {
                return envoyerErreur(helpers, ws, 'QUIZ_BAD_STATE', 'Aucune question en cours.');
            }

            const num = Number(data.num || 0);
            if (num !== 1 && num !== 2) {
                return envoyerErreur(helpers, ws, 'QUIZ_BAD_STATE', 'Indice invalide.');
            }

            const q = sess.questions[sess.idx];
            const cle = num === 1 ? 'indice1' : 'indice2';
            const texte = q[cle] || null;

            if (!texte) {
                return envoyerErreur(helpers, ws, 'QUIZ_BAD_STATE', `Pas d'indice ${num} pour cette question.`);
            }

            broadcastToGame(wss, partieId, 'QUIZ_INDICE', { num, texte });
            console.log(`[QUIZ] 💡 Indice ${num} révélé pour Q${sess.idx + 1} (partie ${partieId})`);
            break;
        }

        default:
            console.warn(`[QUIZ] ⚠️ Action host inconnue: ${action}`);
    }
}

// ─────────────────────────────────────────────────────
// PLAYER_ACTION
// ─────────────────────────────────────────────────────
//
// Actions attendues :
//   - quiz:answer { texte }
// ─────────────────────────────────────────────────────

function handlePlayerAction(wss, ws, partieId, pseudo, action, data = {}, helpers) {
    const { broadcastToHost } = helpers;

    if (!partieId || !pseudo) {
        return envoyerErreur(helpers, ws, 'QUIZ_BAD_STATE', 'Partie ou pseudo manquant.');
    }

    const sess = getSession(partieId);
    if (!sess || sess.etat !== 'question' || sess.idx < 0) {
        // Question déjà terminée ou pas encore commencée
        helpers.send(ws, 'QUIZ_ANSWER_ACK', { status: 'too_late' });
        return;
    }

    switch (action) {
        case 'quiz:answer': {
            const texte = String((data && data.texte) || '').trim();
            if (!texte) {
                helpers.send(ws, 'QUIZ_ANSWER_ACK', { status: 'invalid', texte: '' });
                return;
            }

            if (sess.reponses.has(pseudo)) {
                helpers.send(ws, 'QUIZ_ANSWER_ACK', { status: 'already_answered', texte });
                return;
            }

            sess.reponses.set(pseudo, { texte, correct: false });

            // ACK au joueur
            helpers.send(ws, 'QUIZ_ANSWER_ACK', { status: 'ok', texte });

            // Info live au host
            const nbReponses = sess.reponses.size;
            const nbJoueurs  = null; // On ne connaît pas le nombre total de joueurs côté module
            const allAnswered = false;

            broadcastToHost(wss, partieId, 'QUIZ_RESPONSE_IN', {
                pseudo,
                nbReponses,
                nbJoueurs,
                allAnswered,
            });

            console.log(`[QUIZ] ✉️ Réponse reçue de ${pseudo} pour Q${sess.idx + 1} (partie ${partieId})`);
            break;
        }

        default:
            console.warn(`[QUIZ] ⚠️ Action player inconnue: ${action}`);
    }
}

// ─────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────

module.exports = {
    handleHostAction,
    handlePlayerAction,
    detruireSession,
};