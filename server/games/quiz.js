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
        phase            : 'idle',
        questions        : [],
        posees           : 0,
        questionEnCours  : null,
        reponses         : {},
        indicesBroadcast : 0,
        revelationEnCours: false,
        timerHandle      : null,
        timerIndice1     : null,
        timerIndice2     : null,
        timerReveal      : null,
        _dernieresReponses: [],
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

            // ── Lancement automatique de la 1ère question ──────────────
            // L'hôte n'a pas à cliquer sur btn-next pour démarrer.
            // On délègue à next_question via un micro-délai pour laisser
            // QUIZ_READY arriver sur les clients avant QUIZ_QUESTION.
            setTimeout(() => {
                const sNow = getSession(partieId);
                if (sNow && sNow.phase === 'idle' && sNow.questions.length > 0) {
                    handleHostAction(wss, ws, partieId, 'quiz:next_question', {}, helpers);
                }
            }, 800);
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

            const DUREE    = 60;  // secondes par question
            const T_INDICE1 = 40; // indice 1 après 40s
            const T_INDICE2 = 50; // indice 2 après 50s
            const tsDebut   = Date.now();

            // Timestamps absolus des indices
            q._tsIndice1 = tsDebut + T_INDICE1 * 1000;
            q._tsIndice2 = tsDebut + T_INDICE2 * 1000;
            q._tsDebut   = tsDebut;
            q._duree     = DUREE;

            const payload = _questionPayload(s, q);
            broadcastToGame(wss, partieId, 'QUIZ_QUESTION', payload);
            console.log(`[QUIZ] ❓ Q${s.posees}/${s.questions.length}: ${q.Question || q.question}`);

            // Nettoyer les anciens timers
            if (s.timerHandle)   { clearTimeout(s.timerHandle);   s.timerHandle   = null; }
            if (s.timerIndice1)  { clearTimeout(s.timerIndice1);  s.timerIndice1  = null; }
            if (s.timerIndice2)  { clearTimeout(s.timerIndice2);  s.timerIndice2  = null; }

            // ── Indice 1 automatique à 40s ────────────────────────────
            const texte1 = q['Indice 1'] || q.indice1 || '';
            if (texte1) {
                s.timerIndice1 = setTimeout(() => {
                    if (s.phase !== 'question') return;
                    s.indicesBroadcast = Math.max(s.indicesBroadcast, 1);
                    broadcastToGame(wss, partieId, 'QUIZ_INDICE', { num: 1, texte: texte1 });
                    console.log(`[QUIZ] 💡 Indice 1 auto (40s) → ${partieId}`);
                }, T_INDICE1 * 1000);
            }

            // ── Indice 2 automatique à 50s ────────────────────────────
            const texte2 = q['Indice 2'] || q.indice2 || '';
            if (texte2) {
                s.timerIndice2 = setTimeout(() => {
                    if (s.phase !== 'question') return;
                    s.indicesBroadcast = Math.max(s.indicesBroadcast, 2);
                    broadcastToGame(wss, partieId, 'QUIZ_INDICE', { num: 2, texte: texte2 });
                    console.log(`[QUIZ] 💡 Indice 2 auto (50s) → ${partieId}`);
                }, T_INDICE2 * 1000);
            }

            // ── Timer principal (60s) ─────────────────────────────────
            // À expiration : notifier l'hôte que le timer est écoulé
            // (active btn-afficher-reponse côté client),
            // PUIS révéler automatiquement 5s plus tard si l'hôte n'a pas agi.
            s.timerHandle = setTimeout(() => {
                if (s.phase !== 'question') return;
                console.log(`[QUIZ] ⏱ Timer écoulé (60s) → ${partieId}`);

                // Notifier l'hôte : timer fini, il peut révéler manuellement
                broadcastToHost(wss, partieId, 'QUIZ_TIMER_EXPIRED', {
                    partieId,
                    nbReponses : Object.keys(s.reponses).length,
                    nbJoueurs  : (store.getPartie(partieId)?.joueurs || []).length,
                });

                // Révélation automatique 5s après si l'hôte n'a pas cliqué
                s.timerReveal = setTimeout(() => {
                    if (s.phase === 'question' && !s.revelationEnCours) {
                        console.log(`[QUIZ] ⏱ Révélation auto (65s) → ${partieId}`);
                        _declencharRevelation(wss, partieId, s, helpers, 'timer');
                    }
                }, 5000);
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

            // Si tout le monde a répondu → notifier l'hôte pour qu'il
            // active btn-afficher-reponse. PAS de révélation automatique :
            // l'hôte choisit quand révéler via quiz:reveal.
            // (La révélation auto arrive à 65s si l'hôte n'agit pas.)
            if (allAnswered && !s.revelationEnCours) {
                console.log(`[QUIZ] ✅ Tous ont répondu — hôte peut révéler`);
                // QUIZ_RESPONSE_IN avec allAnswered:true suffit côté client
                // pour activer btn-afficher-reponse (déjà envoyé juste au-dessus)
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

    if (s.timerHandle)  { clearTimeout(s.timerHandle);  s.timerHandle  = null; }
    if (s.timerIndice1) { clearTimeout(s.timerIndice1); s.timerIndice1 = null; }
    if (s.timerIndice2) { clearTimeout(s.timerIndice2); s.timerIndice2 = null; }
    if (s.timerReveal)  { clearTimeout(s.timerReveal);  s.timerReveal  = null; }

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

        // Calcul simplifié : 1pt bonne réponse, bonus 1pt premier correct
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
    const scoresActuels = store.getScores(partieId);
    broadcastToGame(wss, partieId, 'SCORES_UPDATE', { scores: scoresActuels });

    // Notifier l'hôte qu'il peut passer à la question suivante
    const { broadcastToHost } = helpers;
    broadcastToHost(wss, partieId, 'QUIZ_CAN_NEXT', {
        posees   : s.posees,
        total    : s.questions.length,
        remaining: s.questions.length - s.posees,
        scores   : scoresActuels,
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