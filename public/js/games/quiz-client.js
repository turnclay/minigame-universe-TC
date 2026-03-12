// ======================================================
// 🎮 QUIZ.JS v2.0 — Logique serveur du jeu Quiz
// ======================================================
//
// Architecture :
//   - Les questions sont lues depuis /data/questions.json
//   - Chaque question a un type : 'texte' | 'qcm'
//   - Le host ne saisit rien — il appuie sur "Question suivante"
//     → le serveur lit la prochaine entrée du JSON et la broadcast
//   - Si hostJoue=true, la question est envoyée au host aussi
//
// Flux :
//   HOST_ACTION quiz:start          → init session (optionnel)
//   HOST_ACTION quiz:next_question  → envoie QUIZ_QUESTION à tous
//   HOST_ACTION quiz:reveal         → correction + attribution des points
//   HOST_ACTION quiz:reveal_indice  → broadcast indice { num, texte }
//   HOST_ACTION quiz:skip           → correction sans points, question suivante possible
//   PLAYER_ACTION quiz:answer       → enregistre réponse joueur
//
// Événements serveur → clients :
//   QUIZ_READY        → { total }               (après quiz:start)
//   QUIZ_QUESTION     → { idx, total, type, question, choix[], points, ... }
//   QUIZ_RESPONSE_IN  → { pseudo, nbReponses, nbJoueurs }  (host only)
//   QUIZ_ANSWER_ACK   → { status }              (joueur only)
//   QUIZ_INDICE       → { num, texte }          (broadcast)
//   QUIZ_CORRECTION   → { reponse, reponses[], scores }
//   SCORES_UPDATE     → { scores }
//   QUIZ_END          → { scores, total }
//
// Structure d'une question dans questions.json :
//   {
//     "id": 1, "theme": "...", "type": "texte"|"qcm",
//     "question": "...", "indice1": "...", "indice2": "...",
//     "choix": ["A","B","C","D"],   ← uniquement si type=qcm
//     "reponse": "...", "points": 10
//   }
//
// ======================================================

'use strict';

const path  = require('path');
const fs    = require('fs');
const store = require('../store.js');

// ── Chargement du fichier questions.json ─────────────

const QUESTIONS_PATH = path.join(__dirname, '../../data/questions.json');

function chargerQuestions() {
    try {
        const raw       = fs.readFileSync(QUESTIONS_PATH, 'utf8');
        const questions = JSON.parse(raw);
        if (!Array.isArray(questions) || questions.length === 0) {
            throw new Error('questions.json vide ou mal formé');
        }
        console.log(`[QUIZ] ✅ ${questions.length} questions chargées depuis questions.json`);
        return questions;
    } catch (err) {
        console.error('[QUIZ] ❌ Impossible de charger questions.json :', err.message);
        return [{
            id: 0, theme: 'Erreur', type: 'texte',
            question: '⚠️ Fichier questions.json introuvable. Vérifiez /data/questions.json',
            reponse: 'N/A', points: 0,
        }];
    }
}

// ── Sessions actives ─ Map<partieId, QuizSession> ────

const quizSessions = new Map();

// ── Normalisation pour comparaison réponses ───────────

function normaliserReponse(str) {
    return String(str || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/['']/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

// ── Payload question → jamais la réponse incluse ──────

function questionPayload(session) {
    const q = session.questions[session.questionIdx];
    return {
        idx:      session.questionIdx,
        total:    session.questions.length,
        id:       q.id     || session.questionIdx,
        theme:    q.theme  || null,
        type:     q.type   || 'texte',
        question: q.question,
        indice1:  q.indice1 || null,
        indice2:  q.indice2 || null,
        choix:    q.type === 'qcm' ? (q.choix || []) : [],
        points:   q.points  || 10,
    };
}

// ── Payload correction → contient la réponse ──────────

function correctionPayload(session, scores) {
    const q = session.questions[session.questionIdx];
    const reponsesPubliques = Object.entries(session.reponses)
        .map(([pseudo, r]) => ({
            pseudo,
            texte:   r.texte,
            correct: normaliserReponse(r.texte) === normaliserReponse(q.reponse),
            ts:      r.ts,
        }))
        .sort((a, b) => {
            if (a.correct !== b.correct) return a.correct ? -1 : 1;
            return a.ts - b.ts;
        });

    return {
        idx:      session.questionIdx,
        total:    session.questions.length,
        id:       q.id     || session.questionIdx,
        theme:    q.theme  || null,
        type:     q.type   || 'texte',
        question: q.question,
        reponse:  q.reponse,
        choix:    q.type === 'qcm' ? (q.choix || []) : [],
        points:   q.points  || 10,
        reponses: reponsesPubliques,
        scores,
    };
}

// ── Gestion session ───────────────────────────────────

function creerSession(partieId) {
    const questions = chargerQuestions();
    const session   = {
        questions,
        questionIdx: -1,       // -1 = session démarrée mais aucune question envoyée
        phase:       'idle',   // 'idle' | 'question' | 'correction' | 'fin'
        reponses:    {},       // { pseudo: { texte, ts } }
        timer:       null,
    };
    quizSessions.set(partieId, session);
    console.log(`[QUIZ] Session créée: ${partieId} (${questions.length} questions)`);
    return session;
}

function getSession(partieId) {
    return quizSessions.get(partieId) || null;
}

function detruireSession(partieId) {
    const s = quizSessions.get(partieId);
    if (s?.timer) clearTimeout(s.timer);
    quizSessions.delete(partieId);
    console.log(`[QUIZ] Session détruite: ${partieId}`);
}

// ══════════════════════════════════════════════════════
// HANDLER HOST
// ══════════════════════════════════════════════════════

function handleHostAction(wss, ws, partieId, action, data, fns) {
    const { broadcastToGame, broadcastToHost, send } = fns;

    switch (action) {

        // ── quiz:start ─────────────────────────────────
        // Optionnel : initialise la session sans envoyer de question
        case 'quiz:start': {
            if (getSession(partieId)) detruireSession(partieId);
            const session = creerSession(partieId);

            broadcastToGame(wss, partieId, 'QUIZ_READY', {
                total:   session.questions.length,
                message: 'Le quiz est prêt — le host va lancer les questions.',
            });
            console.log(`[QUIZ] 🚀 Session initialisée, ${session.questions.length} questions disponibles`);
            break;
        }

        // ── quiz:next_question ─────────────────────────
        // Le host appuie sur "Lancer la question suivante"
        // → serveur lit la prochaine question du JSON et la broadcast à tous
        case 'quiz:next_question': {
            let session = getSession(partieId);
            if (!session) {
                // Démarrage implicite si le host n'a pas fait quiz:start
                session = creerSession(partieId);
            }

            if (session.phase === 'question') {
                return send(ws, 'ERROR', {
                    code:    'QUIZ_BAD_STATE',
                    message: 'Révélez d\'abord la réponse avant de passer à la suivante.',
                });
            }

            session.questionIdx++;

            // Plus de questions disponibles → fin automatique
            if (session.questionIdx >= session.questions.length) {
                session.phase = 'fin';
                const scores  = store.getScores(partieId);
                broadcastToGame(wss, partieId, 'QUIZ_END', {
                    scores,
                    total: session.questions.length,
                });
                detruireSession(partieId);
                console.log(`[QUIZ] 🏁 Fin — toutes les questions traitées`);
                break;
            }

            session.phase    = 'question';
            session.reponses = {};

            const qp = questionPayload(session);
            broadcastToGame(wss, partieId, 'QUIZ_QUESTION', qp);
            console.log(`[QUIZ] ➡ Q${session.questionIdx + 1}/${session.questions.length} — type: ${qp.type}`);
            break;
        }

        // ── quiz:reveal ────────────────────────────────
        // Le host révèle la réponse → correction + attribution des points
        case 'quiz:reveal': {
            const session = getSession(partieId);
            if (!session || session.phase !== 'question') {
                return send(ws, 'ERROR', {
                    code:    'QUIZ_BAD_STATE',
                    message: 'Aucune question en cours à révéler.',
                });
            }

            session.phase = 'correction';
            if (session.timer) { clearTimeout(session.timer); session.timer = null; }

            const q          = session.questions[session.questionIdx];
            let nbCorrects   = 0;

            Object.entries(session.reponses).forEach(([pseudo, r]) => {
                if (normaliserReponse(r.texte) === normaliserReponse(q.reponse)) {
                    store.modifierScore(partieId, pseudo, q.points || 10);
                    nbCorrects++;
                }
            });

            const scores = store.getScores(partieId);
            broadcastToGame(wss, partieId, 'QUIZ_CORRECTION', correctionPayload(session, scores));
            broadcastToGame(wss, partieId, 'SCORES_UPDATE', { scores });

            console.log(`[QUIZ] ✅ Correction Q${session.questionIdx + 1} — ${nbCorrects} correct(s) sur ${Object.keys(session.reponses).length} réponse(s)`);
            break;
        }

        // ── quiz:reveal_indice ─────────────────────────
        // Le host dévoile un indice → QUIZ_INDICE broadcasté à tous
        case 'quiz:reveal_indice': {
            const session = getSession(partieId);
            if (!session || session.phase !== 'question') return;

            const { num } = data;
            const q       = session.questions[session.questionIdx];
            const texte   = q[`indice${num}`];

            if (!texte) {
                return send(ws, 'ERROR', { code: 'NO_INDICE', message: `Pas d'indice ${num}` });
            }

            broadcastToGame(wss, partieId, 'QUIZ_INDICE', { num, texte });
            console.log(`[QUIZ] 💡 Indice ${num} révélé`);
            break;
        }

        // ── quiz:skip ──────────────────────────────────
        // Passe la question en cours (correction sans points)
        case 'quiz:skip': {
            const session = getSession(partieId);
            if (!session || session.phase !== 'question') {
                return send(ws, 'ERROR', { code: 'QUIZ_BAD_STATE' });
            }

            session.phase    = 'correction';
            const scores     = store.getScores(partieId);

            broadcastToGame(wss, partieId, 'QUIZ_CORRECTION', correctionPayload(session, scores));
            broadcastToGame(wss, partieId, 'SCORES_UPDATE', { scores });
            console.log(`[QUIZ] ⏭ Question ${session.questionIdx + 1} passée sans points`);
            break;
        }

        default:
            console.warn(`[QUIZ] ⚠️ Action host inconnue: "${action}"`);
    }
}

// ══════════════════════════════════════════════════════
// HANDLER JOUEUR
// ══════════════════════════════════════════════════════

function handlePlayerAction(wss, ws, partieId, pseudo, action, data, fns) {
    const { broadcastToHost, send } = fns;

    switch (action) {

        // ── quiz:answer ────────────────────────────────
        case 'quiz:answer': {
            const session = getSession(partieId);

            if (!session || session.phase !== 'question') {
                return send(ws, 'QUIZ_ANSWER_ACK', { status: 'too_late' });
            }

            if (session.reponses[pseudo]) {
                return send(ws, 'QUIZ_ANSWER_ACK', { status: 'already_answered' });
            }

            const texte = String(data.texte || '').trim();
            if (!texte) return;

            session.reponses[pseudo] = { texte, ts: Date.now() };

            // Confirmer immédiatement au joueur
            send(ws, 'QUIZ_ANSWER_ACK', { status: 'ok', texte });

            // Notifier le host du nombre de réponses reçues (sans dévoiler le contenu)
            const partie     = store.getPartie(partieId);
            const nbJoueurs  = partie?.joueurs?.length || 0;
            const nbReponses = Object.keys(session.reponses).length;

            broadcastToHost(wss, partieId, 'QUIZ_RESPONSE_IN', {
                pseudo,
                nbReponses,
                nbJoueurs,
                allAnswered: nbReponses >= nbJoueurs && nbJoueurs > 0,
            });

            console.log(`[QUIZ] 📝 ${pseudo}: "${texte}" (${nbReponses}/${nbJoueurs})`);

            // Auto-révélation si tous les joueurs ont répondu
            if (nbReponses >= nbJoueurs && nbJoueurs > 0) {
                console.log(`[QUIZ] ⚡ Auto-révélation`);
                handleHostAction(wss, ws, partieId, 'quiz:reveal', {}, fns);
            }

            break;
        }

        default:
            console.warn(`[QUIZ] ⚠️ Action joueur inconnue: "${action}" (${pseudo})`);
    }
}

// ══════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════

module.exports = {
    handleHostAction,
    handlePlayerAction,
    detruireSession,
    getSession,
};