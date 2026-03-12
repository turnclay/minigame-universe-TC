// ======================================================
// 🧠 QUIZ.JS — Module serveur (ESM) pour le jeu de quiz
// ======================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Pour reconstruire __dirname en ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
            console.error('[QUIZ] ❌ Format questions.json invalide');
            QUESTIONS = [];
        }

        QUESTIONS_TOTAL = QUESTIONS.length;
        console.log(`[QUIZ] ✅ ${QUESTIONS_TOTAL} questions chargées`);
    } catch (err) {
        console.error('[QUIZ] ❌ Erreur chargement questions.json:', err);
        QUESTIONS = [];
        QUESTIONS_TOTAL = 0;
    }
}

// ─────────────────────────────────────────────────────
// Sessions en mémoire
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

export function detruireSession(partieId) {
    sessions.delete(partieId);
    console.log(`[QUIZ] 🧹 Session détruite pour partie ${partieId}`);
}

// ─────────────────────────────────────────────────────
// Helpers internes
// ─────────────────────────────────────────────────────

function construirePayloadQuestion(sess) {
    const q = sess.questions[sess.idx];
    if (!q) return null;

    return {
        idx: sess.idx,
        total: sess.questions.length,
        theme: q.theme || q.categorie || null,
        question: q.question || q.texte || '',
        type: q.type === 'qcm' ? 'qcm' : 'texte',
        choix: Array.isArray(q.choix) ? q.choix : null,
        indice1: q.indice1 || null,
        indice2: q.indice2 || null,
        points: typeof q.points === 'number' ? q.points : 1,
    };
}

function construirePayloadCorrection(sess) {
    const q = sess.questions[sess.idx];
    if (!q) return null;

    const bonne = q.reponse || q.bonneReponse || '';
    const points = typeof q.points === 'number' ? q.points : 1;

    const reponses = Array.from(sess.reponses.entries()).map(([pseudo, r]) => ({
        pseudo,
        texte: r.texte,
        correct: r.correct,
    }));

    return {
        idx: sess.idx,
        total: sess.questions.length,
        theme: q.theme || q.categorie || null,
        question: q.question || q.texte || '',
        reponse: bonne,
        type: q.type === 'qcm' ? 'qcm' : 'texte',
        points,
        reponses,
    };
}

function corrigerReponses(sess) {
    const q = sess.questions[sess.idx];
    const bonne = String(q.reponse || q.bonneReponse || '').trim().toLowerCase();
    const points = typeof q.points === 'number' ? q.points : 1;

    sess.reponses.forEach((r, pseudo) => {
        const texteNorm = String(r.texte || '').trim().toLowerCase();
        const correct = texteNorm === bonne;
        r.correct = correct;

        if (correct) {
            sess.scores[pseudo] = (sess.scores[pseudo] || 0) + points;
        }
    });
}

// ─────────────────────────────────────────────────────
// HOST_ACTION
// ─────────────────────────────────────────────────────

export function handleHostAction(wss, ws, partieId, action, data, helpers) {
    const { broadcastToGame, broadcastToHost, send } = helpers;

    let sess = getSession(partieId);

    switch (action) {

        case 'quiz:next_question': {
            if (!sess) {
                sess = createSession(partieId);
                broadcastToHost(wss, partieId, 'QUIZ_READY', {
                    total: sess.questions.length,
                    message: 'Quiz prêt.',
                });
            }

            sess.idx++;
            sess.reponses.clear();
            sess.etat = 'question';

            if (sess.idx >= sess.questions.length) {
                broadcastToGame(wss, partieId, 'QUIZ_END', {
                    scores: sess.scores,
                    total: sess.questions.length,
                });
                sess.etat = 'ended';
                return;
            }

            const payload = construirePayloadQuestion(sess);
            broadcastToGame(wss, partieId, 'QUIZ_QUESTION', payload);
            break;
        }

        case 'quiz:reveal': {
            if (!sess || sess.etat !== 'question') return;

            corrigerReponses(sess);
            const payload = construirePayloadCorrection(sess);
            sess.etat = 'correction';

            broadcastToGame(wss, partieId, 'QUIZ_CORRECTION', payload);
            broadcastToGame(wss, partieId, 'SCORES_UPDATE', { scores: sess.scores });
            break;
        }

        case 'quiz:skip': {
            if (!sess || sess.etat !== 'question') return;

            const payload = construirePayloadCorrection(sess);
            sess.etat = 'correction';

            broadcastToGame(wss, partieId, 'QUIZ_CORRECTION', payload);
            break;
        }

        case 'quiz:reveal_indice': {
            if (!sess || sess.etat !== 'question') return;

            const num = Number(data.num);
            const q = sess.questions[sess.idx];
            const cle = num === 1 ? 'indice1' : 'indice2';
            const texte = q[cle];

            if (texte) {
                broadcastToGame(wss, partieId, 'QUIZ_INDICE', { num, texte });
            }
            break;
        }
    }
}

// ─────────────────────────────────────────────────────
// PLAYER_ACTION
// ─────────────────────────────────────────────────────

export function handlePlayerAction(wss, ws, partieId, pseudo, action, data, helpers) {
    const { send, broadcastToHost } = helpers;

    const sess = getSession(partieId);
    if (!sess || sess.etat !== 'question') {
        send(ws, 'QUIZ_ANSWER_ACK', { status: 'too_late' });
        return;
    }

    switch (action) {
        case 'quiz:answer': {
            const texte = String(data.texte || '').trim();
            if (!texte) {
                send(ws, 'QUIZ_ANSWER_ACK', { status: 'invalid' });
                return;
            }

            if (sess.reponses.has(pseudo)) {
                send(ws, 'QUIZ_ANSWER_ACK', { status: 'already_answered' });
                return;
            }

            sess.reponses.set(pseudo, { texte, correct: false });
            send(ws, 'QUIZ_ANSWER_ACK', { status: 'ok', texte });

            broadcastToHost(wss, partieId, 'QUIZ_RESPONSE_IN', {
                pseudo,
                nbReponses: sess.reponses.size,
                nbJoueurs: null,
                allAnswered: false,
            });

            break;
        }
    }
}