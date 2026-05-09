// ======================================================
// 🎮 server/games/quiz.js — v1.0 (port V2 → WS)
// ======================================================
// Port de la logique métier de quiz_hote.js (V2) vers
// le serveur WebSocket.
//
// Conservé depuis quiz_hote.js V2 :
//   ✔ Algorithme similarité (bigrammes, normalisation)
//   ✔ Calcul de points par timestamp de réponse
//     (2pts avant indice1, 1pt après, 0.5pt après indice2)
//   ✔ Bonus +1pt au premier correct
//   ✔ Indices temporisés (tsIndice1 / tsIndice2)
//   ✔ Révélation manuelle (host) ou automatique (timer)
//   ✔ Verrou anti-double-révélation
//
// Protocole WS (messages émis vers les clients) :
//   → QUIZ_READY         { total, message }
//   → QUIZ_QUESTION      { id, question, theme, hasIndice1, hasIndice2,
//                          posees, total, ts }
//   → QUIZ_RESPONSE_IN   { pseudo, nbReponses, nbJoueurs, allAnswered }
//   → QUIZ_ANSWER_ACK    { status: 'ok'|'already_answered'|'too_late'|'invalid' }
//   → QUIZ_INDICE        { num, texte }
//   → QUIZ_CORRECTION    { question, theme, reponse, reponses[], posees, total }
//   → QUIZ_END           { scores, total }
//
// Protocole WS (actions reçues depuis les clients) :
//   HOST_ACTION  action: 'quiz:load'           data: { questions[] }
//   HOST_ACTION  action: 'quiz:next_question'   data: {}
//   HOST_ACTION  action: 'quiz:reveal'          data: {}
//   HOST_ACTION  action: 'quiz:reveal_indice'   data: { num }
//   HOST_ACTION  action: 'quiz:skip'            data: {}
//   PLAYER_ACTION action: 'quiz:answer'         data: { texte }
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
        phase         : 'idle',   // idle | question | correction | ended
        questions     : [],
        posees        : 0,
        questionEnCours : null,
        reponses      : {},       // { pseudo: { texte, ts, indicesVus } }
        indicesBroadcast: 0,      // nb indices déjà révélés (pour rejoins)
        revelationEnCours: false,
        timerHandle   : null,
    };
    sessions.set(partieId, session);
    return session;
}

// ─────────────────────────────────────────────────────
// API publique (appelée par ws-handler)
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
    if (s?.timerHandle) clearTimeout(s.timerHandle);
    sessions.delete(partieId);
    console.log(`[QUIZ] 🗑️ Session détruite: ${partieId}`);
}

// ─────────────────────────────────────────────────────
// Handlers d'actions
// ─────────────────────────────────────────────────────

export function handleHostAction(wss, ws, partieId, action, data, helpers) {
    const { broadcastToGame, broadcastToPlayers, broadcastToHost, send } = helpers;
    const cmd = action.split(':')[1];

    switch (cmd) {

        // ── quiz:load ─────────────────────────────────────────
        // Charger les questions depuis le client host
        // data = { questions: [ { Question, Thème, Indice 1, Indice 2, Réponse } ] }
        case 'load': {
            let s = getSession(partieId);

            // Si une session existe en phase 'ended' ou avec des données résiduelles,
            // la recréer proprement pour éviter QUIZ_END {total:0} sur next_question.
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
            console.log(`[QUIZ] 📚 ${questions.length} questions chargées pour ${partieId}`);
            break;
        }

        // ── quiz:next_question ────────────────────────────────
        case 'next_question': {
            let s = getSession(partieId);
            if (!s) s = creerSession(partieId);

            if (s.phase === 'question') {
                return send(ws, 'ERROR', { code: 'QUIZ_BAD_STATE', message: 'Une question est déjà en cours.' });
            }
            // Si la session n'a pas encore de questions chargées (session résiduelle
            // ou quiz:load pas encore reçu), refuser silencieusement.
            // Cela évite QUIZ_END {total:0} sur une session vide.
            if (s.questions.length === 0) {
                console.warn('[QUIZ] ⚠️ next_question ignoré — quiz:load pas encore reçu');
                return send(ws, 'ERROR', { code: 'QUIZ_BAD_STATE', message: 'Chargez les questions avec quiz:load.' });
            }
            if (s.posees >= s.questions.length) {
                // Plus de questions → fin légitime
                _terminerQuiz(wss, partieId, s, helpers);
                return;
            }

            const q  = s.questions[s.posees];
            s.posees++;
            s.phase             = 'question';
            s.questionEnCours   = q;
            s.reponses          = {};
            s.indicesBroadcast  = 0;
            s.revelationEnCours = false;
            s._dernieresReponses = [];

            const DUREE = 60; // secondes
            const tsDebut = Date.now();

            // Timestamps absolus des indices (conservés depuis quiz_hote.js)
            q._tsIndice1 = tsDebut + (DUREE - 30) * 1000; // après 30s
            q._tsIndice2 = tsDebut + (DUREE - 10) * 1000; // après 50s
            q._tsDebut   = tsDebut;
            q._duree     = DUREE;

            const payload = _questionPayload(s, q);
            broadcastToGame(wss, partieId, 'QUIZ_QUESTION', payload);
            console.log(`[QUIZ] ❓ Q${s.posees}/${s.questions.length}: ${q.Question || q.question}`);

            // Timer automatique → révélation à la fin
            if (s.timerHandle) clearTimeout(s.timerHandle);
            s.timerHandle = setTimeout(() => {
                if (s.phase === 'question' && !s.revelationEnCours) {
                    console.log(`[QUIZ] ⏱ Timer écoulé → révélation auto`);
                    _declencharRevelation(wss, partieId, s, helpers, 'timer');
                }
            }, DUREE * 1000);
            break;
        }

        // ── quiz:reveal ───────────────────────────────────────
        case 'reveal': {
            const s = getSession(partieId);
            if (!s || s.phase !== 'question') {
                return send(ws, 'ERROR', { code: 'QUIZ_BAD_STATE', message: 'Pas de question en cours.' });
            }
            _declencharRevelation(wss, partieId, s, helpers, 'host');
            break;
        }

        // ── quiz:reveal_indice ────────────────────────────────
        case 'reveal_indice': {
            const s = getSession(partieId);
            if (!s || s.phase !== 'question') {
                return send(ws, 'ERROR', { code: 'QUIZ_BAD_STATE' });
            }
            const num = data.num;
            if (num !== 1 && num !== 2) return;
            const q   = s.questionEnCours;
            const txt = num === 1
                ? (q['Indice 1'] || q.indice1 || '')
                : (q['Indice 2'] || q.indice2 || '');

            if (!txt) {
                return send(ws, 'ERROR', { code: 'QUIZ_BAD_STATE', message: `Pas d'indice ${num}.` });
            }

            s.indicesBroadcast = Math.max(s.indicesBroadcast, num);
            broadcastToGame(wss, partieId, 'QUIZ_INDICE', { num, texte: txt });
            console.log(`[QUIZ] 💡 Indice ${num} révélé`);
            break;
        }

        // ── quiz:skip ─────────────────────────────────────────
        case 'skip': {
            const s = getSession(partieId);
            if (!s || s.phase !== 'question') {
                return send(ws, 'ERROR', { code: 'QUIZ_BAD_STATE' });
            }
            if (s.timerHandle) clearTimeout(s.timerHandle);
            s.phase             = 'correction';
            s.revelationEnCours = false;

            const bonneReponse = _getBonneReponse(s.questionEnCours);
            const payload = _correctionPayload(s, s.questionEnCours, []);
            broadcastToGame(wss, partieId, 'QUIZ_CORRECTION', payload);
            console.log(`[QUIZ] ⏭ Question passée`);
            break;
        }

        default:
            console.warn(`[QUIZ] ⚠️ Action host inconnue: ${cmd}`);
    }
}

export function handlePlayerAction(wss, ws, partieId, pseudo, action, data, helpers) {
    const { broadcastToHost, broadcastToGame, send } = helpers;
    const cmd = action.split(':')[1];

    switch (cmd) {

        // ── quiz:answer ───────────────────────────────────────
        case 'answer': {
            const s = getSession(partieId);

            // Vérifications
            if (!s || s.phase !== 'question') {
                return send(ws, 'QUIZ_ANSWER_ACK', { status: 'too_late' });
            }
            if (s.reponses[pseudo] !== undefined) {
                return send(ws, 'QUIZ_ANSWER_ACK', { status: 'already_answered' });
            }
            const texte = (data.texte || '').trim();
            if (!texte) {
                return send(ws, 'QUIZ_ANSWER_ACK', { status: 'invalid' });
            }

            // Calculer les indices vus par ce joueur au moment de sa réponse
            const ts = Date.now();
            const q  = s.questionEnCours;
            let indicesVus = 0;
            if (q._tsIndice1 && ts > q._tsIndice1) indicesVus++;
            if (q._tsIndice2 && ts > q._tsIndice2) indicesVus++;

            s.reponses[pseudo] = { texte, ts, indicesVus };

            // Accusé de réception
            send(ws, 'QUIZ_ANSWER_ACK', { status: 'ok', texte });

            // Notifier l'host du nombre de réponses
            const partie   = store.getPartie(partieId);
            const nbJoueurs = (partie?.joueurs || []).length;
            const nbReponses = Object.keys(s.reponses).length;
            const allAnswered = nbReponses >= nbJoueurs;

            broadcastToHost(wss, partieId, 'QUIZ_RESPONSE_IN', {
                pseudo, nbReponses, nbJoueurs, allAnswered,
            });

            // Si tout le monde a répondu → révélation automatique
            if (allAnswered && !s.revelationEnCours) {
                console.log(`[QUIZ] ✅ Tous ont répondu → révélation auto`);
                _declencharRevelation(wss, partieId, s, helpers, 'all_answered');
            }
            break;
        }

        default:
            console.warn(`[QUIZ] ⚠️ Action joueur inconnue: ${cmd}`);
    }
}

// ─────────────────────────────────────────────────────
// Révélation
// ─────────────────────────────────────────────────────

function _declencharRevelation(wss, partieId, s, helpers, source) {
    if (s.revelationEnCours) return;
    s.revelationEnCours = true;

    if (s.timerHandle) { clearTimeout(s.timerHandle); s.timerHandle = null; }

    const { broadcastToGame, broadcastToHost, broadcastToPlayers } = helpers;
    const q            = s.questionEnCours;
    const bonneReponse = _getBonneReponse(q);

    // Lire les timestamps des indices
    const tsIndice1 = q._tsIndice1 || Infinity;
    const tsIndice2 = q._tsIndice2 || Infinity;

    // Trier les réponses par timestamp
    const repTri = Object.entries(s.reponses)
        .sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));

    const resultats = [];
    let premierCorrectPseudo = null;

    repTri.forEach(([pseudo, data]) => {
        const texte   = String(data.texte || '').trim();
        const tsRep   = data.ts || Date.now();
        const sim     = bonneReponse ? _similarite(texte, bonneReponse) : 0;
        const correct = sim >= 0.85;

        // Calcul des points (conservé depuis quiz_hote.js)
        let points = 0;
        if (correct) {
            if (tsRep < tsIndice1)      points = 2;   // avant indice1
            else if (tsRep < tsIndice2) points = 1;   // après indice1
            else                        points = 1;   // après indice2 → 1pt (base)
        }

        resultats.push({
            pseudo,
            texte,
            correct,
            points,
            indicesVus: data.indicesVus || 0,
            estPremier: false,
        });

        if (correct && !premierCorrectPseudo) premierCorrectPseudo = pseudo;
    });

    // Bonus +1pt au premier correct
    if (premierCorrectPseudo) {
        const res = resultats.find(r => r.pseudo === premierCorrectPseudo);
        if (res) { res.points = +(res.points + 1); res.estPremier = true; }
    }

    // Créditer les scores côté serveur
    resultats.forEach(r => {
        if (r.points > 0) {
            store.modifierScore(partieId, r.pseudo, r.points);
        }
    });

    // Sauvegarder pour les rejoins
    s._dernieresReponses = resultats;
    s.phase = 'correction';

    const payload = _correctionPayload(s, q, resultats);
    broadcastToGame(wss, partieId, 'QUIZ_CORRECTION', payload);

    // Mise à jour des scores pour tous
    broadcastToGame(wss, partieId, 'SCORES_UPDATE', {
        scores: store.getScores(partieId),
    });

    console.log(`[QUIZ] 📊 Révélation (${source}) — ${resultats.length} réponse(s), bonne: "${bonneReponse}"`);
}

// ─────────────────────────────────────────────────────
// Fin de quiz
// ─────────────────────────────────────────────────────

function _terminerQuiz(wss, partieId, s, helpers) {
    const { broadcastToGame } = helpers;
    if (s.timerHandle) { clearTimeout(s.timerHandle); s.timerHandle = null; }
    s.phase = 'ended';

    const scores = store.getScores(partieId);
    broadcastToGame(wss, partieId, 'QUIZ_END', {
        scores,
        total: s.posees,
    });
    console.log(`[QUIZ] 🏁 Quiz terminé — ${s.posees} questions`);
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
        question  : q['Question']  || q.question  || '',
        theme     : q['Thème']     || q.theme     || '',
        reponse   : _getBonneReponse(q),
        reponses  : resultats,
        posees    : s.posees,
        total     : s.questions.length,
    };
}

function _getBonneReponse(q) {
    return (q['Réponse'] || q.reponse || q.answer || '').trim();
}

// ─────────────────────────────────────────────────────
// Algorithme de similarité (conservé depuis quiz_hote.js V2)
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