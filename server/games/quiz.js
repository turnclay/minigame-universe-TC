// ======================================================
// 🧠 server/games/quiz.js  — v4.0
// Module serveur ESM — Logique complète du jeu Quiz
// MiniGame Universe
// ======================================================
//
// CORRECTIF PRINCIPAL (v4.0) :
//   Les clés du JSON source sont "Thème", "Question",
//   "Indice 1", "Indice 2", "Réponse".
//   On les normalise en noms camelCase dès le chargement.
//
// SCORING (v4.0) :
//   +2 pts  — sans indice
//   +1 pt   — avec 1 indice révélé
//   +0.5 pt — avec 2 indices révélés
//    0 pt   — mauvaise réponse ou absence
//
//   Les indices utilisés sont tracés PAR JOUEUR : on
//   mémorise combien d'indices avaient été broadcast
//   AU MOMENT où le joueur envoie sa réponse.
//
// MESSAGES ÉMIS :
//   → QUIZ_READY          (host)   session initialisée
//   → QUIZ_QUESTION       (tous)   nouvelle question
//   → QUIZ_INDICE         (tous)   indice révélé
//   → QUIZ_CORRECTION     (tous)   bonne réponse + résultats
//   → QUIZ_END            (tous)   fin de partie
//   → SCORES_UPDATE       (tous)   scores mis à jour
//   → QUIZ_ANSWER_ACK     (joueur) accusé de réception
//   → QUIZ_RESPONSE_IN    (host)   notification réponse reçue
// ======================================================

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─────────────────────────────────────────────────────
// CHARGEMENT ET NORMALISATION DES QUESTIONS
// ─────────────────────────────────────────────────────

let QUESTIONS        = [];
let QUESTIONS_TOTAL  = 0;
let _questionsLoaded = false;

/**
 * Normalise une entrée brute du JSON vers un objet uniforme.
 * Gère les clés françaises accentuées du format source :
 *   "n°", "Thème", "Question", "Indice 1", "Indice 2", "Réponse"
 */
function normaliserQuestion(raw) {
    const theme    = raw['Thème']    ?? raw['Theme']    ?? raw.theme    ?? raw.categorie ?? null;
    const question = raw['Question'] ?? raw.question    ?? raw.texte    ?? '';
    const indice1  = raw['Indice 1'] ?? raw['Indice1']  ?? raw.indice1  ?? null;
    const indice2  = raw['Indice 2'] ?? raw['Indice2']  ?? raw.indice2  ?? null;
    const reponse  = raw['Réponse']  ?? raw['Reponse']  ?? raw.reponse  ?? raw.bonneReponse ?? '';
    const numero   = raw['n°']       ?? raw.numero      ?? null;

    // Ignorer les entrées sans question ou sans réponse
    if (!String(question).trim() || !String(reponse).trim()) return null;

    return {
        numero,
        theme    : theme    ? String(theme).trim()    : null,
        question : String(question).trim(),
        indice1  : indice1  ? String(indice1).trim()  : null,
        indice2  : indice2  ? String(indice2).trim()  : null,
        reponse  : String(reponse).trim(),
    };
}

function chargerQuestions() {
    if (_questionsLoaded) return;
    _questionsLoaded = true;

    try {
        // data/questions.json à la racine du projet (2 niveaux au-dessus de server/games/)
        const filePath = path.join(__dirname, '..', '..', 'data', 'questions.json');
        const raw      = fs.readFileSync(filePath, 'utf8');

        let data;
        try {
            data = JSON.parse(raw);
        } catch (parseErr) {
            console.error('[QUIZ] ❌ JSON malformé :', parseErr.message);
            return;
        }

        const tableau = Array.isArray(data)
            ? data
            : Array.isArray(data.questions)
                ? data.questions
                : [];

        QUESTIONS = tableau
            .map(normaliserQuestion)
            .filter(Boolean);

        QUESTIONS_TOTAL = QUESTIONS.length;
        console.log(`[QUIZ] ✅ ${QUESTIONS_TOTAL} questions chargées et normalisées`);

    } catch (err) {
        console.error('[QUIZ] ❌ Impossible de lire questions.json :', err.message);
        QUESTIONS = [];
    }
}

// ─────────────────────────────────────────────────────
// SESSIONS EN MÉMOIRE
// ─────────────────────────────────────────────────────
//
// Structure d'une session :
// {
//   pool             : number[]  — indices mélangés dans QUESTIONS (Fisher-Yates)
//   poolIdx          : number    — curseur dans pool (-1 avant le début)
//   posees           : number    — nb de questions effectivement posées
//   etat             : 'idle' | 'question' | 'correction' | 'ended'
//   reponses         : Map<pseudo, { texte: string, indicesVus: number }>
//                        indicesVus = nb d'indices broadcast AU moment de la réponse
//   indicesBroadcast : number    — 0 | 1 | 2 (indices révélés sur la question en cours)
//   scores           : Record<pseudo, number>
// }

const sessions = new Map();

function getSession(partieId)  { return sessions.get(partieId) || null; }

/** Mélange Fisher-Yates d'un tableau d'indices 0..n-1 */
function shuffleIndices(n) {
    const arr = Array.from({ length: n }, (_, i) => i);
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function createSession(partieId) {
    chargerQuestions();

    const sess = {
        pool               : shuffleIndices(QUESTIONS.length),
        poolIdx            : -1,
        posees             : 0,
        etat               : 'idle',
        reponses           : new Map(),
        indicesBroadcast   : 0,
        scores             : {},
    };

    sessions.set(partieId, sess);
    console.log(`[QUIZ] 🆕 Session créée : ${partieId} (${QUESTIONS.length} questions dispo)`);
    return sess;
}

export function detruireSession(partieId) {
    if (sessions.has(partieId)) {
        sessions.delete(partieId);
        console.log(`[QUIZ] 🧹 Session détruite : ${partieId}`);
    }
}

// ─────────────────────────────────────────────────────
// HELPERS — VÉRIFICATION DE RÉPONSE
// ─────────────────────────────────────────────────────

const DETERMINANTS_RE = /^(le|la|les|l|un|une|des|du|de|d|au|aux|à|a)\s+/;

/**
 * Normalise une chaîne pour comparaison souple :
 *   - décomposition NFD (accents séparés) puis suppression des diacritiques
 *   - minuscules
 *   - apostrophes et tirets → espace
 *   - tout non alphanumérique → espace
 *   - suppression d'un déterminant initial courant
 *   - collapsage des espaces
 */
function normaliserStr(str) {
    return String(str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[''`\-]/g, ' ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(DETERMINANTS_RE, '')
        .trim();
}

/**
 * Vérifie si reponseJoueur correspond à l'une des formulations acceptées.
 * Le champ "Réponse" peut contenir plusieurs variantes séparées par " / " ou " | ".
 */
function estCorrecte(reponseJoueur, reponseAttendue) {
    const soumise = normaliserStr(reponseJoueur);
    if (!soumise) return false;

    return String(reponseAttendue || '')
        .split(/\s*[\/|]\s*/)
        .map(v => normaliserStr(v))
        .filter(Boolean)
        .some(v => v === soumise);
}

/**
 * Calcule les points selon le nombre d'indices vus au moment de la réponse.
 *   0 indice → 2 pts
 *   1 indice → 1 pt
 *   ≥2 indices → 0.5 pt
 */
function calculerPoints(indicesVus) {
    if (indicesVus <= 0) return 2;
    if (indicesVus === 1) return 1;
    return 0.5;
}

// ─────────────────────────────────────────────────────
// HELPERS — PAYLOADS
// ─────────────────────────────────────────────────────

function questionCourante(sess) {
    return QUESTIONS[sess.pool[sess.poolIdx]] || null;
}

/**
 * Payload envoyé lors d'une nouvelle question.
 * Ne contient PAS la réponse ni le texte des indices.
 * On envoie uniquement l'existence des indices (hasIndice1/2)
 * pour que le client active les bons boutons.
 */
function payloadQuestion(sess) {
    const q = questionCourante(sess);
    if (!q) return null;

    return {
        posees     : sess.posees,
        total      : QUESTIONS_TOTAL,
        theme      : q.theme    || '—',
        question   : q.question,
        hasIndice1 : Boolean(q.indice1),
        hasIndice2 : Boolean(q.indice2),
    };
}

/**
 * Payload de correction.
 * Les points sont calculés ici (au moment du reveal).
 * Si skip=true, tout le monde a 0 pts.
 */
function payloadCorrection(sess, skip = false) {
    const q = questionCourante(sess);
    if (!q) return null;

    const reponses = Array.from(sess.reponses.entries()).map(([pseudo, r]) => {
        const correct = estCorrecte(r.texte, q.reponse);
        const points  = (correct && !skip) ? calculerPoints(r.indicesVus) : 0;
        return { pseudo, texte: r.texte, correct, points, indicesVus: r.indicesVus };
    });

    return {
        posees   : sess.posees,
        total    : QUESTIONS_TOTAL,
        theme    : q.theme    || '—',
        question : q.question,
        reponse  : q.reponse,
        reponses,
        skipped  : skip,
    };
}

/** Compte les joueurs actifs dans la partie (exclut le host pur) */
function nbJoueursAttendu(wss, partieId) {
    let n = 0;
    wss.clients.forEach(c => {
        if (c.readyState === 1 && !c._isHost && c._partieId === partieId) n++;
    });
    return n;
}

// ─────────────────────────────────────────────────────
// HOST ACTIONS
// ─────────────────────────────────────────────────────

export function handleHostAction(wss, ws, partieId, action, data, helpers) {
    const { broadcastToGame, broadcastToHost, send } = helpers;

    switch (action) {

        // ──────────────────────────────────────────────────
        // quiz:next_question
        // Lance la question suivante (ou initialise la session)
        // ──────────────────────────────────────────────────
        case 'quiz:next_question': {
            let sess = getSession(partieId);

            if (!sess) {
                sess = createSession(partieId);
                broadcastToHost(wss, partieId, 'QUIZ_READY', {
                    total   : QUESTIONS_TOTAL,
                    message : `Quiz prêt — ${QUESTIONS_TOTAL} questions disponibles.`,
                });
            }

            // Plus de questions disponibles
            if (sess.poolIdx + 1 >= sess.pool.length) {
                broadcastToGame(wss, partieId, 'QUIZ_END', {
                    scores : sess.scores,
                    total  : sess.posees,
                });
                sess.etat = 'ended';
                console.log(`[QUIZ] 🏁 Fin du quiz : ${partieId}`);
                return;
            }

            sess.poolIdx++;
            sess.posees++;
            sess.reponses.clear();
            sess.indicesBroadcast = 0;
            sess.etat = 'question';

            broadcastToGame(wss, partieId, 'QUIZ_QUESTION', payloadQuestion(sess));
            console.log(`[QUIZ] ❓ Question ${sess.posees}/${QUESTIONS_TOTAL} : ${partieId}`);
            break;
        }

        // ──────────────────────────────────────────────────
        // quiz:reveal — révèle la réponse, attribue les points
        // ──────────────────────────────────────────────────
        case 'quiz:reveal': {
            const sess = getSession(partieId);
            if (!sess || sess.etat !== 'question') {
                return send(ws, 'ERROR', {
                    code    : 'QUIZ_BAD_STATE',
                    message : 'Aucune question active.',
                });
            }

            const payload = payloadCorrection(sess, false);
            sess.etat = 'correction';

            // Créditer les scores
            payload.reponses.forEach(({ pseudo, points }) => {
                if (points > 0) {
                    sess.scores[pseudo] = (sess.scores[pseudo] || 0) + points;
                }
            });

            broadcastToGame(wss, partieId, 'QUIZ_CORRECTION', payload);
            broadcastToGame(wss, partieId, 'SCORES_UPDATE', { scores: sess.scores });
            console.log(`[QUIZ] ✅ Révélation Q${sess.posees} : ${partieId}`);
            break;
        }

        // ──────────────────────────────────────────────────
        // quiz:skip — passe la question sans attribuer de points
        // ──────────────────────────────────────────────────
        case 'quiz:skip': {
            const sess = getSession(partieId);
            if (!sess || sess.etat !== 'question') {
                return send(ws, 'ERROR', {
                    code    : 'QUIZ_BAD_STATE',
                    message : 'Aucune question active.',
                });
            }

            const payload = payloadCorrection(sess, true); // skip → 0 pts
            sess.etat = 'correction';

            broadcastToGame(wss, partieId, 'QUIZ_CORRECTION', payload);
            // Pas de SCORES_UPDATE : les scores n'ont pas changé
            console.log(`[QUIZ] ⏭ Question passée Q${sess.posees} : ${partieId}`);
            break;
        }

        // ──────────────────────────────────────────────────
        // quiz:reveal_indice — révèle l'indice 1 ou 2
        // ──────────────────────────────────────────────────
        case 'quiz:reveal_indice': {
            const sess = getSession(partieId);
            if (!sess || sess.etat !== 'question') return;

            const num = Number(data.num);
            if (num !== 1 && num !== 2) return;

            const q     = questionCourante(sess);
            const texte = q ? q[`indice${num}`] : null;

            if (!texte) {
                return send(ws, 'ERROR', {
                    code    : 'QUIZ_NO_INDICE',
                    message : `Pas d'indice ${num} pour cette question.`,
                });
            }

            // Mettre à jour le compteur d'indices broadcast
            // (utilisé pour scorer les réponses FUTURES des joueurs)
            sess.indicesBroadcast = Math.max(sess.indicesBroadcast, num);

            broadcastToGame(wss, partieId, 'QUIZ_INDICE', { num, texte });
            console.log(`[QUIZ] 💡 Indice ${num} révélé Q${sess.posees} : ${partieId}`);
            break;
        }

        default:
            console.warn(`[QUIZ] ⚠️ Action host inconnue : "${action}"`);
    }
}

// ─────────────────────────────────────────────────────
// PLAYER ACTIONS
// ─────────────────────────────────────────────────────

export function handlePlayerAction(wss, ws, partieId, pseudo, action, data, helpers) {
    const { send, broadcastToHost } = helpers;

    switch (action) {

        // ──────────────────────────────────────────────────
        // quiz:answer — le joueur envoie sa réponse
        // ──────────────────────────────────────────────────
        case 'quiz:answer': {
            const sess = getSession(partieId);

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

            // Mémoriser la réponse et le nb d'indices broadcast à ce moment précis
            sess.reponses.set(pseudo, {
                texte,
                indicesVus : sess.indicesBroadcast,
            });

            send(ws, 'QUIZ_ANSWER_ACK', { status: 'ok', texte });

            const nbJoueurs  = nbJoueursAttendu(wss, partieId);
            const nbReponses = sess.reponses.size;

            broadcastToHost(wss, partieId, 'QUIZ_RESPONSE_IN', {
                pseudo,
                nbReponses,
                nbJoueurs,
                allAnswered : nbJoueurs > 0 && nbReponses >= nbJoueurs,
            });

            console.log(`[QUIZ] 📝 Réponse de ${pseudo} (${nbReponses}/${nbJoueurs}) : ${partieId}`);
            break;
        }

        default:
            console.warn(`[QUIZ] ⚠️ Action joueur inconnue : "${action}" (${pseudo})`);
    }
}