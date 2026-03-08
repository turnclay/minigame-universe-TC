// /public/js/modules/scoreboard.js
// Pont entre les modules de jeu et le système de scores WebSocket/sessionStorage

import { GameState } from "../core/state.js";

// ── Helpers internes ──────────────────────────────
function _persisterScore(nom, delta) {
    // 1. Mettre à jour GameState en mémoire
    if (!GameState.scores) GameState.scores = {};
    GameState.scores[nom] = (GameState.scores[nom] || 0) + delta;

    // 2. Persister dans sessionStorage pour la session de jeu
    try {
        const raw = sessionStorage.getItem("mgu_game_session");
        if (raw) {
            const session = JSON.parse(raw);
            if (!session.scores) session.scores = {};
            session.scores[nom] = (session.scores[nom] || 0) + delta;
            sessionStorage.setItem("mgu_game_session", JSON.stringify(session));
        }
    } catch {}

    // 3. Envoyer via WebSocket si disponible (interface joueur connecté)
    if (window._gameSocket?.connected) {
        window._gameSocket.send("PLAYER_SCORE", { nom, delta });
    }

    _rafraichirAffichage();
}

function _rafraichirAffichage() {
    const sb = document.getElementById("scoreboard");
    if (!sb || sb.hidden) return;

    const scores = GameState.scores || {};
    const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) return;

    const medals = ["🥇", "🥈", "🥉"];
    sb.innerHTML = entries.map(([nom, pts], i) =>
        `<div class="sb-row">
            <span class="sb-medal">${medals[i] || `${i+1}.`}</span>
            <span class="sb-nom">${nom}</span>
            <span class="sb-pts">${pts}</span>
         </div>`
    ).join("");
    sb.hidden = false;
}

// ── API publique ──────────────────────────────────

/** Ajoute des points à un participant */
export function ajouterPoints(nom, delta) {
    if (!nom || typeof delta !== "number" || delta <= 0) return;
    _persisterScore(nom, delta);
}

/** Modifie le score d'un participant (peut être positif ou négatif) */
export function modifierScore(nom, delta) {
    if (!nom || typeof delta !== "number") return;
    if (delta === 0) return;

    if (!GameState.scores) GameState.scores = {};
    const actuel = GameState.scores[nom] || 0;
    const nouveau = Math.max(0, actuel + delta);
    const diff = nouveau - actuel;
    if (diff !== 0) _persisterScore(nom, diff);
}

/** Enregistre une victoire (alias pour compatibilité) */
export function registerSuccess(nom, points = 1) {
    ajouterPoints(nom, points);
}

/** Affiche le scoreboard */
export function afficherScoreboard() {
    const sb = document.getElementById("scoreboard");
    if (sb) sb.hidden = false;
    _rafraichirAffichage();
}

/** Masque le scoreboard */
export function masquerScoreboard() {
    const sb = document.getElementById("scoreboard");
    if (sb) sb.hidden = true;
}

/** Remet à zéro le scoreboard en mémoire */
export function resetScoreboard() {
    if (GameState.scores) {
        Object.keys(GameState.scores).forEach(k => { GameState.scores[k] = 0; });
    }
    _rafraichirAffichage();
}

/** Retourne les scores actuels */
export function getScores() {
    return { ...(GameState.scores || {}) };
}