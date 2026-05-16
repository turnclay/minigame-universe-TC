// /js/modules/scoreboard.js
// ============================================================
// 🏆 SCOREBOARD — Scores en partie + exports complets
// ============================================================

import { $, show, hide } from "../core/dom.js";
import { GameState } from "../core/state.js";
import { ajouterPointsGlobaux, enregistrerPerformance, getScoresGlobaux } from "../core/storage.js";

// ======================================================
// ➕ AJOUTER DES POINTS (partie en cours + global)
// ======================================================

// ✅ Rendu différé via rAF : garantit que tous les writes localStorage
// de ajouterPointsGlobaux sont terminés avant de relire scores_globaux,
// même si plusieurs ajouterPoints() s'enchaînent dans le même tick.
let _rafPending = false;
function _scheduleRender() {
    if (_rafPending) return;
    _rafPending = true;
    requestAnimationFrame(() => {
        _rafPending = false;
        afficherScoreboard();
    });
}

export function ajouterPoints(nom, points) {
    if (!nom || typeof points !== "number" || points <= 0) return;

    if (GameState.scores[nom] === undefined) GameState.scores[nom] = 0;
    GameState.scores[nom] = +((GameState.scores[nom] + points)).toFixed(2);

    const jeu = GameState.jeuActuel || GameState.jeu || "inconnu";
    ajouterPointsGlobaux(nom, points, jeu);

    _scheduleRender();
}

// ======================================================
// 🔧 MODIFIER UN SCORE MANUELLEMENT (+/- delta)
// ======================================================

export function modifierScore(nom, delta) {
    if (!nom || typeof delta !== "number") return;
    if (GameState.scores[nom] === undefined) GameState.scores[nom] = 0;
    GameState.scores[nom] = Math.max(0, +((GameState.scores[nom] + delta)).toFixed(2));
    afficherScoreboard();
}

// ======================================================
// 🏅 ENREGISTRER UN SUCCÈS (fin de jeu)
// ======================================================

export function registerSuccess(jeu, joueur, points = 3) {
    if (!joueur) return;

    // Ajouter les points dans GameState + global
    ajouterPoints(joueur, points);

    // Enregistrer la victoire dans les performances
    try {
        enregistrerPerformance(joueur, jeu, {
            score:   points,
            victoire: true,
            temps:   0,
            erreurs: 0
        });
    } catch (e) {
        console.warn('[SCOREBOARD] enregistrerPerformance indisponible', e.message);
    }

    console.log(`[SCOREBOARD] ✅ Victoire enregistrée — ${joueur} +${points}pts (${jeu})`);
}

// ======================================================
// 📊 AFFICHER LE SCOREBOARD (score partie + score global)
// ======================================================

export function afficherScoreboard() {
    const liste = $("score-list");
    if (!liste) return;

    const scores  = GameState.scores || {};
    const entrees = Object.entries(scores).sort((a, b) => b[1] - a[1]);

    if (entrees.length === 0) {
        liste.innerHTML = '<p style="opacity:.5;font-size:.85rem;text-align:center;padding:8px;">Aucun score</p>';
        return;
    }

    // Injecter le CSS une seule fois
    if (!document.getElementById('scoreboard-style')) {
        const s = document.createElement('style');
        s.id = 'scoreboard-style';
        s.textContent = `
            .score-sep    { color: rgba(255,255,255,.3); font-weight: 400; }
            .score-global { color: rgba(255,255,255,.45); font-size: .8em; font-weight: 600; }
        `;
        document.head.appendChild(s);
    }

    // ✅ FIX : relecture fraîche du localStorage à chaque rendu,
    // en parsant directement depuis la source pour éviter tout cache mémoire.
    let scoresGlobaux = {};
    try {
        const raw = localStorage.getItem('scores_globaux');
        if (raw) scoresGlobaux = JSON.parse(raw);
    } catch(e) {
        // Fallback sur la fonction utilitaire si la clé change
        try { scoresGlobaux = getScoresGlobaux() || {}; } catch {}
    }

    liste.innerHTML = entrees.map(([nom, pts]) => {
        // ✅ FIX : lecture individuelle par nom — pas de référence partagée
        const cumul = (scoresGlobaux[nom] && typeof scoresGlobaux[nom].total === 'number')
            ? scoresGlobaux[nom].total
            : (typeof scoresGlobaux[nom] === 'number' ? scoresGlobaux[nom] : 0);

        return `
            <div class="score-entry" role="listitem">
                <span class="score-name">${escHtml(nom)}</span>
                <span class="score-points">${pts}&nbsp;<span class="score-sep">/</span>&nbsp;<span class="score-global">${cumul}</span>&nbsp;pts</span>
            </div>
        `;
    }).join("");

}

// ======================================================
// 👁️ MASQUER / AFFICHER LE BLOC SCOREBOARD
// ======================================================

export function masquerScoreboard() {
    hide("scoreboard");
}

export function afficherBlocScoreboard() {
    show("scoreboard");
    afficherScoreboard();
}

// ======================================================
// 🎛️ BOUTONS +/- INLINE DU SCOREBOARD
// ======================================================

export function initScoreButtons() {
    const liste = $("score-list");
    if (!liste) return;

    liste.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-action]");
        if (!btn) return;
        const { action, nom } = btn.dataset;
        if (!nom) return;
        if (action === "plus")  modifierScore(nom,  1);
        if (action === "minus") modifierScore(nom, -1);
    });
}

// ======================================================
// 👁️ TOGGLE VISIBILITY
// ======================================================

export function initToggleScoreboard() {
    const btn   = $("toggle-scores");
    const liste = $("score-list");
    if (!btn || !liste) return;

    btn.addEventListener("click", () => {
        const isHidden = liste.style.display === "none" || liste.hidden;
        liste.style.display = isHidden ? "" : "none";
        btn.textContent = isHidden ? "🚫" : "👁️";
    });
}

// ======================================================
// 🔒 ESCAPE HTML
// ======================================================

function escHtml(str) {
    return String(str || "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}