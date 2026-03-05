// /js/modules/scoreboard.js

import { $, show, hide } from "../core/dom.js";
import { GameState } from "../core/state.js";
import {
    updatePartieScores,
    getScoresGlobaux,
    getClassementGlobal,
    ajouterPointsGlobaux,
    loadGame
} from "../core/storage.js";


// ======================================================
// 🎯 CONFIGURATION CENTRALE DES JEUX
// ======================================================
const GAME_CONFIG = {
    quiz:        { points: false, pointsParReussite: 10, defis: 1 },
    justeprix:   { points: false, pointsParReussite: 10, defis: 4 },
    undercover:  { points: true,  pointsParReussite: 10, defis: 1 },
    lml:         { points: true,  pointsParReussite: 10, defis: 1 },
    mimer:       { points: false, pointsParReussite: 10, defis: 1 },
    pendu:       { points: true,  pointsParReussite: 10, defis: 1 },
    petitbac:    { points: false, pointsParReussite: 10, defis: 2 },
    memoire:     { points: true,  pointsParReussite: 10, defis: 4 },
    morpion:     { points: true,  pointsParReussite: 10, defis: 1 },
    puissance4:  { points: true,  pointsParReussite: 10, defis: 1 }
};


// ======================================================
// 🧠 Sync GameState ↔ liste des participants
// ======================================================
function syncScoresWithPlayers() {
    let cibles = [];

    if (GameState.mode === "solo" && Array.isArray(GameState.joueurs)) {
        cibles = [...GameState.joueurs];
    }
    if (GameState.mode === "team" && Array.isArray(GameState.equipes)) {
        cibles = GameState.equipes.map(e => e.nom);
    }

    if (!GameState.scores) GameState.scores = {};

    cibles.forEach(cible => {
        if (!(cible in GameState.scores)) {
            GameState.scores[cible] = 0;
        }
    });

    Object.keys(GameState.scores).forEach(cible => {
        if (!cibles.includes(cible)) {
            delete GameState.scores[cible];
        }
    });
}


// ======================================================
// 📌 Afficher le scoreboard
// ======================================================
export function afficherScoreboard() {
    const container = $("score-list");
    if (!container) return;

    syncScoresWithPlayers();

    container.innerHTML = "";

    const scores = GameState.scores || {};
    const scoresGlobaux = getScoresGlobaux();

    // 🔥 Jeu en cours
    const jeuActuel = GameState.jeuActuel || loadGame()?.jeu || "";

    Object.keys(scores).forEach(cible => {
        const ligne = document.createElement("div");
        ligne.className = "score-ligne";

        const totalGlobal = scoresGlobaux[cible]?.total ?? 0;

        // 🔥 Score du joueur pour CE jeu
        const scoreJeuEnCours =
            scoresGlobaux[cible]?.parJeu?.[jeuActuel] ?? 0;

        ligne.innerHTML = `
            <span class="score-nom">${cible} :</span>
            <span class="score-valeur" title="Score pour ce jeu">${scoreJeuEnCours}</span>
            <span class="score-global" title="Total cumulé tous jeux confondus">/${totalGlobal}</span>
            <button class="score-plus"  data-cible="${cible}">+1</button>
            <button class="score-moins" data-cible="${cible}">-1</button>
        `;

        container.appendChild(ligne);
    });

    show("scoreboard");
}


// ======================================================
// 📌 Masquer le scoreboard
// ======================================================
export function masquerScoreboard() {
    hide("scoreboard");
}


// ======================================================
// 📌 Modifier un score (boutons ±1)
// ======================================================
export function modifierScore(cible, delta) {
    if (!GameState.scores) GameState.scores = {};
    if (GameState.scores[cible] === undefined) GameState.scores[cible] = 0;

    const avant = GameState.scores[cible];
    GameState.scores[cible] = Math.max(0, avant + delta);
    const apres = GameState.scores[cible];

    updatePartieScores();

    const gain = apres - avant;
    if (gain > 0) {
        const jeu = GameState.jeuActuel || loadGame()?.jeu || "";
        ajouterPointsGlobaux(cible, gain, jeu);
    }

    afficherScoreboard();
}


// ======================================================
// 📌 Ajouter des points programmatiquement
// ======================================================
export function ajouterPoints(cible, points) {
    if (!points || points <= 0) return;
    if (!GameState.scores) GameState.scores = {};
    if (GameState.scores[cible] === undefined) GameState.scores[cible] = 0;

    GameState.scores[cible] += points;

    updatePartieScores();

    const jeu = GameState.jeuActuel || loadGame()?.jeu || "";
    ajouterPointsGlobaux(cible, points, jeu);

    afficherScoreboard();
}


// ======================================================
// 🎯 Attribution automatique selon GAME_CONFIG
// ======================================================
export function registerSuccess(jeu, cible) {
    const cfg = GAME_CONFIG[jeu];
    if (!cfg || !cfg.points) return;
    ajouterPoints(cible, cfg.pointsParReussite);
}


// ======================================================
// 📌 Init boutons +1 / -1
// ======================================================
export function initScoreButtons() {
    const container = $("score-list");
    if (!container) return;

    container.onclick = (e) => {
        if (e.target.classList.contains("score-plus")) {
            modifierScore(e.target.dataset.cible, +1);
        }
        if (e.target.classList.contains("score-moins")) {
            modifierScore(e.target.dataset.cible, -1);
        }
    };
}


// ======================================================
// 📌 Toggle visibilité du scoreboard
// ======================================================
export function initToggleScoreboard() {
    const btn  = $("toggle-scores");
    const list = $("score-list");
    if (!btn || !list) return;

    let visible = true;

    btn.onclick = () => {
        visible = !visible;
        if (visible) {
            list.style.display = "";
            afficherScoreboard();
        } else {
            list.style.display = "none";
        }
        btn.classList.toggle("active",   visible);
        btn.classList.toggle("striked", !visible);
    };
}


// ======================================================
// 🏆 Afficher le classement global
// ======================================================
export function afficherClassementGlobal() {
    const classement = getClassementGlobal();
    const container  = $("classement-global-list");
    if (!container) return;

    container.innerHTML = "";

    if (classement.length === 0) {
        container.innerHTML = `<p class="classement-vide">Aucun score enregistré pour l'instant.</p>`;
        return;
    }

    classement.forEach((entry, index) => {
        const ligne = document.createElement("div");
        ligne.className = "classement-ligne";

        const medaille = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`;

        const detailJeux = Object.entries(entry.parJeu || {})
            .map(([jeu, pts]) => `<span class="detail-jeu">${jeu}: ${pts}pts</span>`)
            .join(" ");

        ligne.innerHTML = `
            <span class="classement-rang">${medaille}</span>
            <span class="classement-nom">${entry.nom}</span>
            <span class="classement-total">${entry.total} pts</span>
            <div class="classement-detail">${detailJeux}</div>
        `;

        container.appendChild(ligne);
    });
}


// ======================================================
// 🧩 Binding Undercover
// ======================================================
function initUndercoverScoreboardBinding() {
    ["undercover-config", "undercover-distribution", "undercover"].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;

        const observer = new MutationObserver(() => {
            const visible = !el.hidden && getComputedStyle(el).display !== "none";
            if (visible) {
                show("scoreboard");
                afficherScoreboard();
            }
        });

        observer.observe(el, {
            attributes: true,
            attributeFilter: ["style", "hidden", "class"]
        });
    });
}

document.addEventListener("DOMContentLoaded", () => {
    initUndercoverScoreboardBinding();
});