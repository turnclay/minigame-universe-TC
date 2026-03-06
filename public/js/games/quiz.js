import { $, $$, show, hide } from "../core/dom.js";
import { GameState } from "../core/state.js";
import { ajouterPoints } from "../modules/scoreboard.js";

// ======================================================
// 🎯 MODULE QUIZ — VARIABLES
// ======================================================

let questions = [];
let ordreQuestions = [];
let index = 0;

let timer = null;
let tempsRestant = 60;

// ======================================================
// 🔧 OUTILS
// ======================================================

function melangerTableau(tab) {
    for (let i = tab.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tab[i], tab[j]] = [tab[j], tab[i]];
    }
    return tab;
}

function formatTemps(s) {
    const minutes = Math.floor(s / 60);
    const secondes = s % 60;
    return `${minutes}:${secondes.toString().padStart(2, "0")}`;
}

function getQuestionCourante() {
    return questions[ordreQuestions[index]];
}

// ======================================================
// 🏆 AJOUT DES POINTS
// ======================================================

function bonneReponse() {
    const points = 2;

    if (GameState.mode === "solo") {
        const joueur = GameState.joueurs[0];
        ajouterPoints(joueur, points);
    } else {
        const equipe = GameState.equipes[0].nom;
        ajouterPoints(equipe, points);
    }
}

// ======================================================
// ⏱️ TIMER
// ======================================================

function arreterTimer() {
    clearInterval(timer);
    timer = null;
}

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

        if (tempsRestant <= 5 && tempsRestant > 0) {
            t.classList.add("clignote");
        }

        if (tempsRestant <= 0) {
            arreterTimer();
            t.textContent = "0:00";
            t.classList.remove("clignote");
        }
    }, 1000);
}

// ======================================================
// 📝 AFFICHAGE DES QUESTIONS
// ======================================================

function afficherQuestion() {
    const q = getQuestionCourante();
    if (!q) return;

    $("theme-display").textContent = q["Thème"];
    $("question").textContent = q["Question"];
    $("indice1").textContent = "";
    $("indice2").textContent = "";
    $("reponse").textContent = "";

    demarrerTimer();
}

// ======================================================
// 🔄 NAVIGATION
// ======================================================

function questionSuivante() {
    index = (index + 1) % ordreQuestions.length;
    afficherQuestion();
}

function questionPrecedente() {
    index = (index - 1 + ordreQuestions.length) % ordreQuestions.length;
    afficherQuestion();
}

// ======================================================
// 🎧 LISTENERS
// ======================================================

function attacherListenersQuiz() {

    ["btn-next", "btn-next-arrow"].forEach(id => {
        const el = $(id);
        if (el) el.onclick = questionSuivante;
    });

    const prev = $("btn-prev");
    if (prev) prev.onclick = questionPrecedente;

    const ind1 = $("btn-indice1");
    if (ind1) ind1.onclick = () => {
        $("indice1").textContent = getQuestionCourante()["Indice 1"];
    };

    const ind2 = $("btn-indice2");
    if (ind2) ind2.onclick = () => {
        $("indice2").textContent = getQuestionCourante()["Indice 2"];
    };

    const rep = $("btn-reponse");
    if (rep) rep.onclick = () => {
        $("reponse").textContent = getQuestionCourante()["Réponse"];
        bonneReponse();
    };
}

// ======================================================
// 📥 INITIALISATION DU QUIZ
// ======================================================

function initialiserQuiz() {
    fetch("data/questions.json")
        .then(r => r.json())
        .then(data => {
            questions = data;
            ordreQuestions = melangerTableau([...Array(questions.length).keys()]);
            index = 0;

            afficherQuestion();
            attacherListenersQuiz();
        })
        .catch(err => {
            console.error("❌ ERREUR FETCH :", err);
            alert("Impossible de charger les questions.");
        });
}

window.initialiserQuiz = initialiserQuiz;