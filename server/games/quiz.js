// ======================================================
// 🧠 server/games/quiz.js
// Module serveur ESM — Logique complète du jeu Quiz
// ======================================================
//
// RÔLE :
//   Ce module gère toute la logique serveur du Quiz.
//   Il est appelé exclusivement depuis ws-handler.js.
//
// PATTERN :
//   export function handleHostAction(wss, ws, partieId, action, data, helpers)
//   export function handlePlayerAction(wss, ws, partieId, pseudo, action, data, helpers)
//
// SESSIONS :
//   Chaque partie possède une session en mémoire (Map `sessions`).
//   La session est créée au premier quiz:next_question et détruite à la fin.
//
// CORRECTION :
//   - Type "qcm"   : comparaison stricte insensible à la casse
//   - Type "texte" : comparaison normalisée (casse + accents + espaces)
//
// MESSAGES ÉMIS :
//   → QUIZ_READY          : session initialisée (host uniquement)
//   → QUIZ_QUESTION       : nouvelle question (tous)
//   → QUIZ_INDICE         : indice révélé (tous)
//   → QUIZ_CORRECTION     : correction affichée (tous)
//   → QUIZ_END            : quiz terminé (tous)
//   → SCORES_UPDATE       : mise à jour des scores (tous)
//   → QUIZ_ANSWER_ACK     : accusé de réception de la réponse (joueur uniquement)
//   → QUIZ_RESPONSE_IN    : notification d'une réponse reçue (host uniquement)
// ======================================================

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─────────────────────────────────────────────────────
// CHARGEMENT DES QUESTIONS
// ─────────────────────────────────────────────────────

let QUESTIONS       = [];
let QUESTIONS_TOTAL = 0;
let _questionsLoaded = false;

function chargerQuestions() {
    if (_questionsLoaded) return;
    _questionsLoaded = true;

    try {
        // data/questions.json est à la racine du projet (2 niveaux au-dessus de server/games/)
        const filePath = path.join(__dirname, '..', '..', 'data', 'questions.json');
        const raw  = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw);

        QUESTIONS = Array.isArray(data)
            ? data
            : Array.isArray(data.questions)
                ? data.questions
                : [];

        QUESTIONS_TOTAL = QUESTIONS.length;
        console.log(`[QUIZ] ✅ ${QUESTIONS_TOTAL} questions chargées`);
    } catch (err) {
        console.error('[QUIZ] ❌ Erreur chargement questions.json:', err.message);
        QUESTIONS = [];
    }
}

// ─────────────────────────────────────────────────────
// SESSIONS EN MÉMOIRE
// Structure d'une session :
// {
//   questions : Array   — liste mélangée des questions
//   idx       : number  — index de la question actuelle (-1 = avant le début)
//   etat      : string  — 'idle' | 'question' | 'correction' | 'ended'
//   reponses  : Map<pseudo, { texte, correct }>
//   scores    : Object<pseudo, number>
//   startedAt : number  — timestamp de début
// }
// ─────────────────────────────────────────────────────

const sessions = new Map();

function getSession(partieId) {
    return sessions.get(partieId) || null;
}

function createSession(partieId) {
    chargerQuestions();

    // Mélange de Fisher-Yates pour ne pas toujours poser les mêmes questions
    const shuffled = [...QUESTIONS].sort(() => Math.random() - 0.5);

    const sess = {
        questions : shuffled,
        idx       : -1,
        etat      : 'idle',
        reponses  : new Map(),
        scores    : {},
        startedAt : Date.now(),
    };

    sessions.set(partieId, sess);
    console.log(`[QUIZ] 🆕 Session créée: ${partieId} (${shuffled.length} questions)`);
    return sess;
}

export function detruireSession(partieId) {
    if (sessions.has(partieId)) {
        sessions.delete(partieId);
        console.log(`[QUIZ] 🧹 Session détruite: ${partieId}`);
    }
}

// ─────────────────────────────────────────────────────
// HELPERS INTERNES
// ─────────────────────────────────────────────────────

/**
 * Normalise une chaîne pour la comparaison :
 * minuscules + suppression des accents + trim des espaces
 */
function normaliser(str) {
    return String(str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

/**
 * Construit le payload à envoyer lors d'une nouvelle question.
 * Ne contient PAS la réponse — celle-ci reste côté serveur.
 */
function payloadQuestion(sess) {
    const q = sess.questions[sess.idx];
    if (!q) return null;

    return {
        idx      : sess.idx,
        total    : sess.questions.length,
        theme    : q.theme || q.categorie || null,
        question : q.question || q.texte || '',
        type     : q.type === 'qcm' ? 'qcm' : 'texte',
        choix    : Array.isArray(q.choix) ? q.choix : null,
        indice1  : q.indice1 || null,
        indice2  : q.indice2 || null,
        points   : typeof q.points === 'number' ? q.points : 1,
    };
}

/**
 * Construit le payload de correction (inclut la bonne réponse et les réponses des joueurs).
 */
function payloadCorrection(sess) {
    const q = sess.questions[sess.idx];
    if (!q) return null;

    const bonneReponse = q.reponse || q.bonneReponse || '';
    const points       = typeof q.points === 'number' ? q.points : 1;

    const reponses = Array.from(sess.reponses.entries()).map(([pseudo, r]) => ({
        pseudo,
        texte  : r.texte,
        correct: r.correct,
    }));

    return {
        idx      : sess.idx,
        total    : sess.questions.length,
        theme    : q.theme || q.categorie || null,
        question : q.question || q.texte || '',
        reponse  : bonneReponse,
        type     : q.type === 'qcm' ? 'qcm' : 'texte',
        points,
        reponses,
    };
}

/**
 * Corrige toutes les réponses de la question courante
 * et met à jour sess.scores.
 */
function corrigerReponses(sess) {
    const q      = sess.questions[sess.idx];
    const bonne  = normaliser(q.reponse || q.bonneReponse || '');
    const points = typeof q.points === 'number' ? q.points : 1;

    sess.reponses.forEach((r, pseudo) => {
        const soumise = normaliser(r.texte);
        r.correct = (soumise === bonne);

        if (r.correct) {
            sess.scores[pseudo] = (sess.scores[pseudo] || 0) + points;
        }
    });
}

/**
 * Compte le nombre de joueurs attendus dans la partie.
 * Utilisé pour la notification "allAnswered".
 */
function nbJoueursAttendu(wss, partieId) {
    let count = 0;
    wss.clients.forEach(c => {
        if (c.readyState === 1 && !c._isHost && c._partieId === partieId) count++;
    });
    return count;
}

// ─────────────────────────────────────────────────────
// HOST ACTIONS
// Actions déclenchées par le host via HOST_ACTION
// ─────────────────────────────────────────────────────

export function handleHostAction(wss, ws, partieId, action, data, helpers) {
    const { broadcastToGame, broadcastToHost, send } = helpers;

    switch (action) {

        // ────────────────────────────────────────────
        // quiz:next_question
        // Lance la prochaine question (ou initialise la session si première question)
        // ────────────────────────────────────────────
        case 'quiz:next_question': {
            let sess = getSession(partieId);

            if (!sess) {
                sess = createSession(partieId);
                broadcastToHost(wss, partieId, 'QUIZ_READY', {
                    total  : sess.questions.length,
                    message: `Quiz prêt — ${sess.questions.length} questions.`,
                });
            }

            sess.idx++;
            sess.reponses.clear();
            sess.etat = 'question';

            // Fin du quiz : toutes les questions ont été posées
            if (sess.idx >= sess.questions.length) {
                broadcastToGame(wss, partieId, 'QUIZ_END', {
                    scores: sess.scores,
                    total : sess.idx, // nb questions réellement posées
                });
                sess.etat = 'ended';
                console.log(`[QUIZ] 🏁 Quiz terminé: ${partieId}`);
                return;
            }

            const payload = payloadQuestion(sess);
            broadcastToGame(wss, partieId, 'QUIZ_QUESTION', payload);
            console.log(`[QUIZ] ❓ Question ${sess.idx + 1}/${sess.questions.length}: ${partieId}`);
            break;
        }

        // ────────────────────────────────────────────
        // quiz:reveal
        // Révèle la bonne réponse et attribue les points
        // ────────────────────────────────────────────
        case 'quiz:reveal': {
            const sess = getSession(partieId);
            if (!sess || sess.etat !== 'question') {
                return send(ws, 'ERROR', { code: 'QUIZ_BAD_STATE', message: 'Aucune question active.' });
            }

            corrigerReponses(sess);
            const payload = payloadCorrection(sess);
            sess.etat = 'correction';

            broadcastToGame(wss, partieId, 'QUIZ_CORRECTION', payload);
            broadcastToGame(wss, partieId, 'SCORES_UPDATE', { scores: sess.scores });
            console.log(`[QUIZ] ✅ Réponse révélée Q${sess.idx + 1}: ${partieId}`);
            break;
        }

        // ────────────────────────────────────────────
        // quiz:skip
        // Passe la question sans attribuer de points
        // ────────────────────────────────────────────
        case 'quiz:skip': {
            const sess = getSession(partieId);
            if (!sess || sess.etat !== 'question') {
                return send(ws, 'ERROR', { code: 'QUIZ_BAD_STATE', message: 'Aucune question active.' });
            }

            // On corrige quand même pour afficher les réponses,
            // mais sans mise à jour des scores
            const q      = sess.questions[sess.idx];
            const bonne  = normaliser(q.reponse || q.bonneReponse || '');
            sess.reponses.forEach(r => {
                r.correct = normaliser(r.texte) === bonne;
            });

            const payload = payloadCorrection(sess);
            sess.etat = 'correction';

            broadcastToGame(wss, partieId, 'QUIZ_CORRECTION', payload);
            // Pas de SCORES_UPDATE car les scores n'ont pas changé
            console.log(`[QUIZ] ⏭ Question passée Q${sess.idx + 1}: ${partieId}`);
            break;
        }

        // ────────────────────────────────────────────
        // quiz:reveal_indice
        // Révèle l'indice 1 ou 2 de la question courante
        // ────────────────────────────────────────────
        case 'quiz:reveal_indice': {
            const sess = getSession(partieId);
            if (!sess || sess.etat !== 'question') return;

            const num  = Number(data.num);
            if (num !== 1 && num !== 2) return;

            const q     = sess.questions[sess.idx];
            const texte = q[`indice${num}`];

            if (!texte) {
                return send(ws, 'ERROR', {
                    code   : 'QUIZ_NO_INDICE',
                    message: `Pas d'indice ${num} pour cette question.`,
                });
            }

            broadcastToGame(wss, partieId, 'QUIZ_INDICE', { num, texte });
            console.log(`[QUIZ] 💡 Indice ${num} révélé Q${sess.idx + 1}: ${partieId}`);
            break;
        }

        default:
            console.warn(`[QUIZ] ⚠️ Action host inconnue: "${action}"`);
    }
}

// ─────────────────────────────────────────────────────
// PLAYER ACTIONS
// Actions déclenchées par les joueurs via PLAYER_ACTION
// ─────────────────────────────────────────────────────

export function handlePlayerAction(wss, ws, partieId, pseudo, action, data, helpers) {
    const { send, broadcastToHost } = helpers;

    switch (action) {

        // ────────────────────────────────────────────
        // quiz:answer
        // Le joueur envoie sa réponse à la question courante
        // ────────────────────────────────────────────
        case 'quiz:answer': {
            const sess = getSession(partieId);

            // Vérifications de garde
            if (!sess || sess.etat !== 'question') {
                return send(ws, 'QUIZ_ANSWER_ACK', { status: 'too_late' });
            }

            if (sess.reponses.has(pseudo)) {
                return send(ws, 'QUIZ_ANSWER_ACK', { status: 'already_answered' });
            }

            const texte = String(data.texte || '').trim();
            if (!texte) {
                return send(ws, 'QUIZ_ANSWER_ACK', { status: 'invalid' });
            }

            // Enregistrement de la réponse (correct sera déterminé lors du reveal)
            sess.reponses.set(pseudo, { texte, correct: false });

            // Accusé de réception au joueur
            send(ws, 'QUIZ_ANSWER_ACK', { status: 'ok', texte });

            // Notification au host
            const nbJoueurs   = nbJoueursAttendu(wss, partieId);
            const nbReponses  = sess.reponses.size;
            const allAnswered = nbJoueurs > 0 && nbReponses >= nbJoueurs;

            broadcastToHost(wss, partieId, 'QUIZ_RESPONSE_IN', {
                pseudo,
                nbReponses,
                nbJoueurs,
                allAnswered,
            });

            console.log(`[QUIZ] 📝 Réponse de ${pseudo} (${nbReponses}/${nbJoueurs}): ${partieId}`);
            break;
        }

        default:
            console.warn(`[QUIZ] ⚠️ Action joueur inconnue: "${action}" (${pseudo})`);
    }
}