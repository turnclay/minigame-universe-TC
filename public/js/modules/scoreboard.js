// /js/modules/scoreboard.js
// ======================================================
// 📊 SCOREBOARD — Gestion des scores en cours de partie
// ======================================================

import { GameState } from "../core/state.js";
import { ajouterPointsGlobaux, saveGame, loadGame } from "../core/storage.js";

// ======================================================
// 🏆 AJOUTER DES POINTS (+ cumul global)
// ======================================================

/**
 * Ajoute des points à un joueur/équipe.
 * Met à jour GameState.scores + scores globaux + sauvegarde.
 */
export function ajouterPoints(nom, points) {
    if (!nom || typeof points !== "number" || points <= 0) return;

    if (!GameState.scores[nom]) GameState.scores[nom] = 0;
    GameState.scores[nom] += points;

    // Cumul global
    ajouterPointsGlobaux(nom, points, GameState.jeu);

    // Sauvegarde partie en cours
    _sauvegarderScores();
    afficherScoreboard();
}

/**
 * Modifie le score (positif OU négatif).
 * N'affecte PAS les scores globaux si delta < 0.
 */
export function modifierScore(nom, delta) {
    if (!nom || typeof delta !== "number") return;

    if (!GameState.scores[nom]) GameState.scores[nom] = 0;
    GameState.scores[nom] = Math.max(0, GameState.scores[nom] + delta);

    if (delta > 0) {
        ajouterPointsGlobaux(nom, delta, GameState.jeu);
    }

    _sauvegarderScores();
    afficherScoreboard();
}

/**
 * Enregistre un succès (victoire) → points prédéfinis par jeu.
 */
export function registerSuccess(jeu, nom) {
    const pointsParJeu = {
        quiz:       2,
        justeprix:  2,
        undercover: 3,
        lml:        5,
        mimer:      5,
        pendu:      10,
        petitbac:   1,
        memoire:    3,
        morpion:    3,
        puissance4: 4,
    };
    const pts = pointsParJeu[jeu] || 1;
    ajouterPoints(nom, pts);
}

// ======================================================
// 🎨 AFFICHAGE DU SCOREBOARD
// ======================================================

export function afficherScoreboard() {
    const sb = document.getElementById("scoreboard");
    if (!sb) return;

    const scores = GameState.scores;
    const entries = Object.entries(scores);

    if (entries.length === 0) {
        sb.innerHTML = "";
        return;
    }

    const sorted = [...entries].sort((a, b) => b[1] - a[1]);
    const medals = ["🥇", "🥈", "🥉"];

    sb.innerHTML = `
        <div class="scoreboard-inner">
            <div class="scoreboard-title">
                <span class="sb-icon">🏆</span>
                <span>Scores</span>
            </div>
            <div class="scoreboard-list">
                ${sorted.map(([nom, pts], i) => `
                    <div class="sb-row ${i === 0 ? "sb-leader" : ""}">
                        <span class="sb-medal">${medals[i] || `${i + 1}.`}</span>
                        <span class="sb-nom">${_esc(nom)}</span>
                        <span class="sb-pts">${pts}</span>
                    </div>
                `).join("")}
            </div>
        </div>
    `;

    sb.hidden = false;
}

export function masquerScoreboard() {
    const sb = document.getElementById("scoreboard");
    if (sb) sb.hidden = true;
}

export function resetScoreboard() {
    GameState.scores = {};
    const sb = document.getElementById("scoreboard");
    if (sb) sb.innerHTML = "";
    if (sb) sb.hidden = true;
}

// ======================================================
// 🔒 PRIVÉ
// ======================================================

function _sauvegarderScores() {
    const partie = loadGame();
    if (!partie) return;
    partie.scores = { ...GameState.scores };
    saveGame(partie);
}

function _esc(str) {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}