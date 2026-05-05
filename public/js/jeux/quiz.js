// /js/jeux/quiz.js — v2.0 WebSocket
// ============================================================
// Modifications vs v1.0 :
//
//   [AJOUT] chargerModuleHote() expose window.jeuSocket
//           pour que quiz_hote.js puisse l'utiliser.
//
//   [AJOUT] initialiserQuiz() charge les questions depuis
//           /data/questions.json et les envoie au serveur
//           via HOST_ACTION 'quiz:load' si WS connecté.
//           Fallback : comportement v1.0 sans modification.
//
//   [AJOUT] window._quizNbJoueursInvites() lit le snapshot
//           serveur si disponible, sinon fallback GameState.
//
//   [INCHANGÉ] Toute la logique UI (timer, afficherQuestion,
//              questionSuivante, listeners, DOM) est conservée.
//              Les IDs HTML (timer, theme-display, question,
//              indice1, indice2, reponse, btn-next, btn-prev,
//              btn-indice1, btn-indice2, quiz-reponse-input,
//              btn-valider-reponse, btn-afficher-reponse)
//              correspondent exactement à index.html.
// ============================================================

import { $, $$, show, hide } from "../core/dom.js";
import { GameState } from "../core/state.js";
import { ajouterPoints } from "../modules/scoreboard.js";

let questions      = [];
let ordreQuestions = [];
let index          = 0;
let timer          = null;
let tempsRestant   = 60;

let _publierEtat                    = () => {};
let _publierQuestion                = () => {};
let _publierScores                  = () => {};
let _afficherReponsesInvitesSurHote = () => {};
let _viderReponses                  = () => {};
let _setQuestionSuivanteCallback    = () => {};
let _declencherValidationHote       = () => {};
let _envoyerReponseHote             = () => {};
let _declencherAfficherReponse      = () => {};

// ======================================================
// 📡 CHARGEMENT DYNAMIQUE DE QUIZ_HOTE
// ======================================================
async function chargerModuleHote() {
    try {
        const m = await import('../modules/quiz_hote.js');
        _publierEtat                    = m.publierEtat;
        _publierQuestion                = m.publierQuestion;
        _publierScores                  = m.publierScores;
        _afficherReponsesInvitesSurHote = m.afficherReponsesInvitesSurHote;
        _viderReponses                  = m.viderReponses;
        _setQuestionSuivanteCallback    = m.setQuestionSuivanteCallback;
        _declencherValidationHote       = m.declencherValidationHote || (() => {});
        _envoyerReponseHote             = m.envoyerReponseHote       || (() => {});
        _declencherAfficherReponse      = m.declencherAfficherReponse || (() => {});

        // Exposer sur window pour index.html
        window._quizEnvoyerReponseHote   = (rep) => _envoyerReponseHote(rep);
        window._quizDeclencherAfficher   = ()    => _declencherAfficherReponse();
        window._quizDeclencherValidation = ()    => _declencherValidationHote();

        console.log('[QUIZ] ✅ Module hôte chargé');
        return true;
    } catch (e) {
        console.warn('[QUIZ] ⚠️ quiz_hote.js introuvable — mode solo', e.message);
        return false;
    }
}

// ──────────────────────────────────────────────────────
// UTILITAIRES (inchangés)
// ──────────────────────────────────────────────────────

function melangerTableau(tab) {
    for (let i = tab.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tab[i], tab[j]] = [tab[j], tab[i]];
    }
    return tab;
}

function formatTemps(s) {
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

function getQuestionCourante() {
    return questions[ordreQuestions[index]];
}

function bonneReponse(points = 2) {
    if (points <= 0) return;
    if (GameState.mode === "solo") ajouterPoints(GameState.joueurs[0], points);
    else ajouterPoints(GameState.equipes[0].nom, points);
    _publierScores();
}

function arreterTimer() { clearInterval(timer); timer = null; }

function demarrerTimer() {
    arreterTimer();
    tempsRestant = 60;
    const t = $("timer");
    if (!t) return;
    t.textContent = "1:00";
    t.classList.remove("clignote");
    const q = getQuestionCourante();
    if (!q) return;
    timer = setInterval(() => {
        tempsRestant--;
        t.textContent = formatTemps(tempsRestant);
        if (tempsRestant === 30) $("indice1").textContent = q["Indice 1"];
        if (tempsRestant === 10) $("indice2").textContent = q["Indice 2"];
        if (tempsRestant <= 5 && tempsRestant > 0) t.classList.add("clignote");
        if (tempsRestant <= 0) { arreterTimer(); t.textContent = "0:00"; t.classList.remove("clignote"); }
    }, 1000);
}

function afficherQuestion() {
    const q = getQuestionCourante();
    if (!q) return;

    $("theme-display").textContent = q["Thème"];
    $("question").textContent      = q["Question"];
    $("indice1").textContent       = "";
    $("indice2").textContent       = "";

    const repEl = $("reponse");
    if (repEl) repEl.textContent = "";

    const inputHote = document.getElementById("quiz-reponse-input");
    if (inputHote) { inputHote.value = ""; inputHote.disabled = false; }

    const btnEnvoyer = document.getElementById("btn-valider-reponse");
    if (btnEnvoyer) {
        btnEnvoyer.disabled      = false;
        btnEnvoyer._sent         = false;
        btnEnvoyer.style.opacity = '';
        btnEnvoyer.textContent   = '✅ Envoyer';
    }

    const btnAfficher = document.getElementById("btn-afficher-reponse");
    if (btnAfficher) {
        btnAfficher.disabled        = true;
        btnAfficher.style.opacity   = '0.4';
        btnAfficher.style.cursor    = 'not-allowed';
        btnAfficher.title           = 'En attente des réponses de tous les joueurs…';
        btnAfficher.style.animation = '';
    }

    const verifEl = document.getElementById("verif-resultat");
    if (verifEl) verifEl.hidden = true;

    demarrerTimer();
    _publierQuestion(q, 60);
    _viderReponses();
    setTimeout(() => _afficherReponsesInvitesSurHote('invites-reponses'), 500);
}

function questionSuivante() {
    index = (index + 1) % ordreQuestions.length;
    afficherQuestion();
}

function questionPrecedente() {
    index = (index - 1 + ordreQuestions.length) % ordreQuestions.length;
    afficherQuestion();
}

// ======================================================
// 🖥️ PANNEAU RÉPONSES
// ======================================================
function injecterPanneauInvites() {
    if (document.getElementById('panneau-invites-quiz')) return;
    const section = $("quiz");
    if (!section) return;

    const panneau = document.createElement('div');
    panneau.id = 'panneau-invites-quiz';
    panneau.style.cssText = `margin-top:20px;background:rgba(0,212,255,0.06);
        border:1px solid rgba(0,212,255,0.2);border-radius:14px;padding:14px 16px;`;
    panneau.innerHTML = `
        <div style="font-size:.78rem;text-transform:uppercase;letter-spacing:.1em;
            color:rgba(0,212,255,.7);margin-bottom:10px;font-weight:700;">
            📱 Réponses des joueurs
        </div>
        <div id="invites-reponses">
            <p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">Aucune réponse pour l'instant</p>
        </div>
    `;
    section.appendChild(panneau);

    if (!document.getElementById('style-invites')) {
        const style = document.createElement('style');
        style.id = 'style-invites';
        style.textContent = '@keyframes btnPulse{0%{transform:scale(1)}50%{transform:scale(1.06)}100%{transform:scale(1)}}';
        document.head.appendChild(style);
    }

    setInterval(() => _afficherReponsesInvitesSurHote('invites-reponses'), 2000);
}

// ======================================================
// 🎧 LISTENERS (inchangés)
// ======================================================
function attacherListenersQuiz() {
    ["btn-next", "btn-next-arrow"].forEach(id => {
        const el = $(id);
        if (el) el.onclick = questionSuivante;
    });
    const prev = $("btn-prev");
    if (prev) prev.onclick = questionPrecedente;

    const ind1 = $("btn-indice1");
    if (ind1) ind1.onclick = () => { $("indice1").textContent = getQuestionCourante()["Indice 1"]; };
    const ind2 = $("btn-indice2");
    if (ind2) ind2.onclick = () => { $("indice2").textContent = getQuestionCourante()["Indice 2"]; };
}

// ======================================================
// 📥 INITIALISATION
// ======================================================
async function initialiserQuiz() {
    const hoteActif = await chargerModuleHote();

    if (hoteActif) {
        const pid = localStorage.getItem('minigame_partie_session_id');
        console.log('[QUIZ] Partie — partieId =', pid);
        _publierEtat('en_cours');
        _publierScores();
        _setQuestionSuivanteCallback(questionSuivante);

        // Polling demande état (canal localStorage — conservé pour compatibilité signal.js)
        const cleDemandeEtat = `partie_demande_etat_${pid}`;
        let _dernierTs = 0;
        setInterval(() => {
            try {
                const raw = localStorage.getItem(cleDemandeEtat);
                if (!raw) return;
                const data = JSON.parse(raw);
                if (data.ts <= _dernierTs) return;
                _dernierTs = data.ts;
                _publierEtat('en_cours');
                _publierScores();
                const q = getQuestionCourante();
                if (q) _publierQuestion(q, tempsRestant > 0 ? tempsRestant : 60);
            } catch {}
// /js/jeux/quiz.js — v3.0 WS-server-driven
// ============================================================
// Le serveur est l'unique source de vérité pour la séquence.
// Ce fichier gère l'UI hôte et délègue toute logique au serveur.
//
// Flux :
//   init → fetch questions.json → quiz:load → QUIZ_READY
//   btn-next → quiz:next_question → QUIZ_QUESTION (broadcast)
//   Invité répond → quiz:answer → QUIZ_RESPONSE_IN (host)
//   btn-reveal/timer → quiz:reveal → QUIZ_CORRECTION (broadcast)
//   btn-indice → quiz:reveal_indice → QUIZ_INDICE (broadcast)
//   Plus de questions → QUIZ_END (broadcast)
// ============================================================

import { $ } from "../core/dom.js";
import { GameState } from "../core/state.js";
import { ajouterPoints } from "../modules/scoreboard.js";

// ── État local minimal ─────────────────────────────────
// Plus de séquence locale — uniquement ce dont l'UI a besoin
let _timerLocal     = null;  // timer visuel hôte (affichage seulement)
let _tempsRestant   = 60;
let _questionEnCours = null; // question courante reçue du serveur

// ── Stubs module hôte ─────────────────────────────────
let _publierEtat                    = () => {};
let _publierScores                  = () => {};
let _afficherReponsesInvitesSurHote = () => {};
let _viderReponses                  = () => {};
let _declencherAfficherReponse      = () => {};
let _envoyerReponseHote             = () => {};

// ======================================================
// 📡 CHARGEMENT MODULE HÔTE
// ======================================================
async function chargerModuleHote() {
    try {
        const m = await import('../modules/quiz_hote.js');
        _publierEtat                    = m.publierEtat;
        _publierScores                  = m.publierScores;
        _afficherReponsesInvitesSurHote = m.afficherReponsesInvitesSurHote;
        _viderReponses                  = m.viderReponses;
        _declencherAfficherReponse      = m.declencherAfficherReponse || (() => {});
        _envoyerReponseHote             = m.envoyerReponseHote        || (() => {});

        // Exposer sur window pour index.html
        window._quizEnvoyerReponseHote   = rep => _envoyerReponseHote(rep);
        window._quizDeclencherAfficher   = ()  => _declencherAfficherReponse();
        window._quizDeclencherValidation = ()  => _declencherAfficherReponse();

        console.log('[QUIZ] ✅ Module hôte chargé');
        return true;
    } catch (e) {
        console.warn('[QUIZ] ⚠️ quiz_hote.js indisponible', e.message);
        return false;
    }
}

// ======================================================
// 🖥️ DOM HÔTE — mis à jour par les événements WS serveur
// ======================================================

// Appelé sur réception de QUIZ_QUESTION depuis le serveur
function _onQuizQuestion(payload) {
    const { question, theme, posees, total, ts, hasIndice1, hasIndice2 } = payload;
    _questionEnCours = payload;
    _viderReponses();

    // Thème + question
    const tEl = $('theme-display'); if (tEl) tEl.textContent = theme || '—';
    const qEl = $('question');      if (qEl) qEl.textContent = question || '';

    // Vider indices + réponse
    const i1 = $('indice1'); if (i1) i1.textContent = '';
    const i2 = $('indice2'); if (i2) i2.textContent = '';
    const rp = $('reponse'); if (rp) rp.textContent = '';

    // Reset champ réponse hôte
    const inp = document.getElementById('quiz-reponse-input');
    if (inp) { inp.value = ''; inp.disabled = false; }

    // Reset btn Envoyer
    const btnEnv = document.getElementById('btn-valider-reponse');
    if (btnEnv) {
        btnEnv.disabled    = false;
        btnEnv._sent       = false;
        btnEnv.style.opacity = '';
        btnEnv.textContent  = '✅ Envoyer';
    }

    // Reset btn Afficher
    const btnAff = document.getElementById('btn-afficher-reponse');
    if (btnAff) {
        btnAff.disabled       = true;
        btnAff.style.opacity  = '0.4';
        btnAff.style.cursor   = 'not-allowed';
        btnAff.title          = 'En attente des réponses…';
        btnAff.style.animation = '';
    }

    // Cache verif-resultat
    const vEl = document.getElementById('verif-resultat');
    if (vEl) vEl.hidden = true;

    // Boutons indice (activer/désactiver selon dispo)
    const btn1 = $('btn-indice1');
    if (btn1) { btn1.disabled = !hasIndice1; }
    const btn2 = $('btn-indice2');
    if (btn2) { btn2.disabled = !hasIndice2; }

    // Timer visuel (affichage seulement — le vrai timer est côté serveur)
    _demarrerTimerVisuel(ts);

    // Panneau réponses
    setTimeout(() => _afficherReponsesInvitesSurHote('invites-reponses'), 500);

    console.log(`[QUIZ] ❓ Q${posees}/${total}: ${question}`);
}

// Appelé sur réception de QUIZ_CORRECTION depuis le serveur
function _onQuizCorrection(payload) {
    _arreterTimerVisuel();

    const { reponse, question, theme, posees, total } = payload;

    // Afficher la bonne réponse
    const repEl = $('reponse'); if (repEl && reponse) repEl.textContent = reponse;

    // Scoreboard
    _publierScores();
    if (typeof window.afficherScoreboard === 'function') window.afficherScoreboard();

    console.log(`[QUIZ] ✅ Correction Q${posees}/${total}: "${reponse}"`);
}

// Appelé sur réception de QUIZ_END depuis le serveur
function _onQuizEnd({ scores, total }) {
    _arreterTimerVisuel();
    _publierEtat('fin');

    // Afficher classement final dans scoreboard
    if (scores) {
        GameState.scores = GameState.scores || {};
        Object.assign(GameState.scores, scores);
        _publierScores();
    }
    if (typeof window.afficherScoreboard === 'function') window.afficherScoreboard();

    console.log(`[QUIZ] 🏁 Fin du quiz — ${total} questions`);
}

// ======================================================
// ⏱ TIMER VISUEL HÔTE (affichage seulement)
// Le vrai timer est géré par server/games/quiz.js
// ======================================================
function _demarrerTimerVisuel(tsDebut) {
    _arreterTimerVisuel();
    const duree = 60;
    _tempsRestant = duree;

    const t = $('timer');
    if (!t) return;
    t.textContent = '1:00';
    t.classList.remove('clignote');

    // Calculer le temps restant si tsDebut est fourni (rejoin en cours de question)
    if (tsDebut) {
        const ecoulees = Math.floor((Date.now() - tsDebut) / 1000);
        _tempsRestant = Math.max(0, duree - ecoulees);
    }

    _timerLocal = setInterval(() => {
        _tempsRestant--;
        if (t) {
            const m = Math.floor(_tempsRestant / 60);
            const s = (_tempsRestant % 60).toString().padStart(2, '0');
            t.textContent = `${m}:${s}`;
            if (_tempsRestant <= 5 && _tempsRestant > 0) t.classList.add('clignote');
            if (_tempsRestant <= 0) {
                _arreterTimerVisuel();
                t.textContent = '0:00';
                t.classList.remove('clignote');
            }
        }
    }, 1000);
}

function _arreterTimerVisuel() {
    if (_timerLocal) { clearInterval(_timerLocal); _timerLocal = null; }
}

// ======================================================
// 📱 PANNEAU RÉPONSES INVITÉS
// ======================================================
function injecterPanneauInvites() {
    if (document.getElementById('panneau-invites-quiz')) return;
    const section = $('quiz');
    if (!section) return;

    const panneau = document.createElement('div');
    panneau.id = 'panneau-invites-quiz';
    panneau.style.cssText = 'margin-top:20px;background:rgba(0,212,255,0.06);border:1px solid rgba(0,212,255,0.2);border-radius:14px;padding:14px 16px;';
    panneau.innerHTML = `
        <div style="font-size:.78rem;text-transform:uppercase;letter-spacing:.1em;color:rgba(0,212,255,.7);margin-bottom:10px;font-weight:700;">
            📱 Réponses des joueurs
        </div>
        <div id="invites-reponses">
            <p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">Aucune réponse pour l'instant</p>
        </div>
    `;
    section.appendChild(panneau);

    // Injection du style pulse si absent
    if (!document.getElementById('style-invites')) {
        const s = document.createElement('style');
        s.id = 'style-invites';
        s.textContent = '@keyframes btnPulse{0%{transform:scale(1)}50%{transform:scale(1.06)}100%{transform:scale(1)}}';
        document.head.appendChild(s);
    }

    // Rafraîchissement périodique du panneau
    setInterval(() => _afficherReponsesInvitesSurHote('invites-reponses'), 2000);
}

// ======================================================
// 🎧 LISTENERS HÔTE — branchés sur les commandes WS serveur
// ======================================================
function attacherListenersQuiz(socket) {
    // ── Bouton "Question suivante" ─────────────────────
    ['btn-next', 'btn-next-arrow'].forEach(id => {
        const el = $(id);
        if (el) el.onclick = () => {
            socket.send('HOST_ACTION', { action: 'quiz:next_question', data: {} });
        };
    });

    // Pas de btn-prev : le serveur séquence en avant uniquement

    // ── Boutons indice ─────────────────────────────────
    const ind1 = $('btn-indice1');
    if (ind1) ind1.onclick = () => {
        socket.send('HOST_ACTION', { action: 'quiz:reveal_indice', data: { num: 1 } });
    };
    const ind2 = $('btn-indice2');
    if (ind2) ind2.onclick = () => {
        socket.send('HOST_ACTION', { action: 'quiz:reveal_indice', data: { num: 2 } });
    };

    // ── Bouton "Afficher réponse" ──────────────────────
    const btnAff = document.getElementById('btn-afficher-reponse');
    if (btnAff) btnAff.onclick = () => _declencherAfficherReponse();

    // ── Bouton "Envoyer" (réponse de l'hôte s'il joue) ─
    const btnEnv = document.getElementById('btn-valider-reponse');
    if (btnEnv) {
        btnEnv.onclick = () => {
            if (btnEnv._sent) return;
            const inp = document.getElementById('quiz-reponse-input');
            const rep = inp?.value.trim();
            if (!rep) return;
            _envoyerReponseHote(rep);
        };
    }
}

// ======================================================
// 📡 ÉCOUTE DES ÉVÉNEMENTS WS SERVEUR (côté hôte)
// ======================================================
function abonnerEvenementsServeur(socket) {
    socket.on('QUIZ_READY', ({ total, message }) => {
        console.log(`[QUIZ] 📚 ${message}`);
        // Activer le bouton "Question suivante" maintenant que les questions sont chargées
        const btnNext = $('btn-next');
        if (btnNext) { btnNext.disabled = false; btnNext.style.opacity = '1'; }
    });

    socket.on('QUIZ_QUESTION', payload => _onQuizQuestion(payload));

    socket.on('QUIZ_CORRECTION', payload => _onQuizCorrection(payload));

    socket.on('QUIZ_INDICE', ({ num, texte }) => {
        const el = $(`indice${num}`);
        if (el) el.textContent = texte;
    });

    socket.on('QUIZ_END', payload => _onQuizEnd(payload));

    socket.on('SCORES_UPDATE', ({ scores }) => {
        if (scores) {
            GameState.scores = GameState.scores || {};
            Object.assign(GameState.scores, scores);
        }
        _publierScores();
        if (typeof window.afficherScoreboard === 'function') window.afficherScoreboard();
    });
}

// ======================================================
// 📥 INITIALISATION PRINCIPALE
// ======================================================
async function initialiserQuiz() {
    const hoteActif = await chargerModuleHote();

    if (hoteActif) {
        _publierEtat('en_cours');
        _publierScores();
    }

    // Récupérer le socket WS (exposé par HostSession dans main.js)
    const socket = window.jeuSocket;
    if (!socket) {
        console.error('[QUIZ] ❌ window.jeuSocket introuvable — mode solo uniquement');
        // Fallback mode solo sans WS
        _chargerQuizFallback(hoteActif);
        return;
    }

    // S'abonner aux événements serveur
    abonnerEvenementsServeur(socket);

    // Charger les questions et les envoyer au serveur
    try {
        const res = await fetch('data/questions.json');
        const questions = await res.json();

        // Mélanger côté client (ordre unique par partie)
        const ordre = [...Array(questions.length).keys()];
        for (let i = ordre.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [ordre[i], ordre[j]] = [ordre[j], ordre[i]];
        }
        const questionsMelangees = ordre.map(i => questions[i]);

        // Envoyer au serveur — il gère la séquence à partir de maintenant
        socket.send('HOST_ACTION', {
            action : 'quiz:load',
            data   : { questions: questionsMelangees },
        });
        console.log(`[QUIZ] 📡 ${questionsMelangees.length} questions envoyées au serveur`);

        // Attacher les listeners et le panneau
        attacherListenersQuiz(socket);
        if (hoteActif) injecterPanneauInvites();

        // Désactiver btn-next jusqu'à QUIZ_READY
        const btnNext = $('btn-next');
        if (btnNext) { btnNext.disabled = true; btnNext.style.opacity = '0.4'; }

    } catch (err) {
        console.error('[QUIZ] ❌ Erreur chargement questions.json :', err);
        alert('Impossible de charger les questions.');
    }
}

// ── Fallback mode solo (sans WS) ─────────────────────
// Comportement v1.0 minimal pour tester localement
function _chargerQuizFallback(hoteActif) {
    console.warn('[QUIZ] ⚠️ Mode solo (pas de WS)');
    // Mode solo : aucune synchronisation réseau, pas de support
}

// ======================================================
// EXPORTS WINDOW
// ======================================================
window.initialiserQuiz = initialiserQuiz;

window._quizGetReponseCorrecte = function () {
    if (!_questionEnCours) return '';
    return _questionEnCours['Réponse'] || _questionEnCours.reponse || '';
};

window._quizNbJoueursInvites = function () {
    const snapshot = window.HostSession?._snapshot;
    if (snapshot?.joueurs?.length > 0) return snapshot.joueurs.length;
    return Math.max(0, (GameState.joueurs || []).length - 1);
};

window._quizValiderAvecPoints = function (correct, points) {
    if (correct && points > 0) {
        const participant = GameState.mode === 'solo'
            ? GameState.joueurs[0]
            : GameState.equipes?.[0]?.nom;
        if (participant) { ajouterPoints(participant, points); _publierScores(); }
    }
};