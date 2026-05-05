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
        }, 800);
    }

    fetch("data/questions.json")
        .then(r => r.json())
        .then(data => {
            questions      = data;
            ordreQuestions = melangerTableau([...Array(questions.length).keys()]);
            index          = 0;
            _viderReponses();

            // [v2.0] Charger les questions côté serveur si WS connecté
            const s = window.jeuSocket;
            if (s && s.connected) {
                s.send('HOST_ACTION', {
                    action : 'quiz:load',
                    data   : { questions: data },
                });
                console.log(`[QUIZ] 📡 ${data.length} questions envoyées au serveur`);
            }

            afficherQuestion();
            attacherListenersQuiz();
            if (hoteActif) injecterPanneauInvites();
        })
        .catch(err => {
            console.error("❌ questions.json :", err);
            alert("Impossible de charger les questions.");
        });
}

// ======================================================
// EXPORTS WINDOW (inchangés + extension v2.0)
// ======================================================

window.initialiserQuiz = initialiserQuiz;

window._quizGetReponseCorrecte = function () {
    const q = getQuestionCourante();
    return q ? (q["Réponse"] || q.reponse || '') : '';
};

// [v2.0] Lecture du nb joueurs WS en priorité, fallback GameState
window._quizNbJoueursInvites = function () {
    // Si un snapshot WS est disponible (via JeuApp)
    const snapshot = window.JeuApp?.session?.snapshot;
    if (snapshot?.joueurs?.length > 0) {
        return Math.max(0, snapshot.joueurs.length - 1);
    }
    return Math.max(0, (GameState.joueurs || []).length - 1);
};

window._quizValiderAvecPoints = function (correct, points) {
    if (correct && points > 0) bonneReponse(points);
    else _publierScores();
};