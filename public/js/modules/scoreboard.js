// /js/modules/scoreboard.js
// ============================================================
// 🏆 SCOREBOARD — Scores en partie + exports complets
// ============================================================

import { $, show, hide } from "../core/dom.js";
import { GameState } from "../core/state.js";
import { ajouterPointsGlobaux, enregistrerPerformance, getScoresGlobaux } from "../core/storage.js";
import { socket } from "../core/socket.js";

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
// 🎯 CRÉDIT UNIFIÉ — serveur (WS) ou local (solo)
// ======================================================
// Source de vérité du board de partie = serveur (SCORES_UPDATE).
// - Partie WS active  → HOST_ADD_POINTS → store → broadcast SCORES_UPDATE
//                       (hôte ET invités dérivent leur board de cet event).
// - Hors WS (solo)    → board local via ajouterPoints().
// Dans tous les cas, le cumul inter-parties (scores_globaux) est alimenté
// pour les statistiques long terme — distinct du board de partie.
export function crediterScore(nom, points, jeu) {
    if (!nom || typeof points !== "number" || points === 0) return;

    // Cumul long terme (stats) — toujours, indépendant du board de partie.
    try { ajouterPointsGlobaux(nom, points, jeu || GameState.jeuActuel || "inconnu"); } catch {}

    const enWS = !!localStorage.getItem("ws_partie_id") && socket?.connected;
    if (enWS) {
        // Serveur autoritatif.
        socket.send("HOST_ADD_POINTS", { cible: nom, points });
    } else {
        // Solo / hors-WS : board local.
        ajouterPoints(nom, points);
    }
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
// 🎨 CSS DU SCOREBOARD (injecté une seule fois)
// ======================================================

function _injecterStyle() {
    if (document.getElementById('scoreboard-style')) return;
    const s = document.createElement('style');
    s.id = 'scoreboard-style';
    s.textContent = `
        .score-sep    { color: rgba(255,255,255,.3); font-weight: 400; }
        .score-global { color: rgba(255,255,255,.45); font-size: .8em; font-weight: 600; }
        .score-entry  { display:flex; align-items:center; gap:8px; }
        .score-rang   { width:1.6em; text-align:center; font-weight:700; opacity:.9; flex:0 0 auto; }
        .score-name   { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .score-points { flex:0 0 auto; white-space:nowrap; }
        .score-moi    { background:rgba(167,139,250,.12); border-radius:10px; }
        .score-moi .score-name { font-weight:700; color:#c4b5fd; }
    `;
    document.head.appendChild(s);
}

// ======================================================
// 📊 RENDU COMMUN D'UN CLASSEMENT (hôte + invité)
// ======================================================
// Rend un classement trié dans l'élément #elId à partir d'un objet
// scores { pseudo: points } quelconque (typiquement issu du serveur).
//   opts.cumul     : bool  → affiche le cumul global (scores_globaux)
//   opts.controles : bool  → affiche les boutons +/- (hôte uniquement)
//   opts.moi       : string → surligne l'entrée du joueur courant
export function rendreClassement(elId, scores, opts = {}) {
    const el = document.getElementById(elId);
    if (!el) return;

    const entrees = Object.entries(scores || {}).sort((a, b) => b[1] - a[1]);

    if (entrees.length === 0) {
        el.innerHTML = '<p style="opacity:.5;font-size:.85rem;text-align:center;padding:8px;">Aucun score</p>';
        return;
    }

    _injecterStyle();

    // Cumul global : relecture fraîche du localStorage (source long terme).
    let cumuls = {};
    if (opts.cumul) {
        try {
            const raw = localStorage.getItem('scores_globaux');
            if (raw) cumuls = JSON.parse(raw);
        } catch {
            try { cumuls = getScoresGlobaux() || {}; } catch {}
        }
    }

    const medailles = ['🥇', '🥈', '🥉'];

    el.innerHTML = entrees.map(([nom, pts], i) => {
        const estMoi = opts.moi && nom === opts.moi;

        const cumul = opts.cumul
            ? ((cumuls[nom] && typeof cumuls[nom].total === 'number')
                ? cumuls[nom].total
                : (typeof cumuls[nom] === 'number' ? cumuls[nom] : 0))
            : null;

        const blocCumul = (cumul !== null)
            ? `&nbsp;<span class="score-sep">/</span>&nbsp;<span class="score-global">${cumul}</span>`
            : '';

        const ctrl = opts.controles
            ? `<button class="score-btn" data-action="minus" data-nom="${escHtml(nom)}" aria-label="Retirer un point">–</button>`
            + `<button class="score-btn" data-action="plus"  data-nom="${escHtml(nom)}" aria-label="Ajouter un point">+</button>`
            : '';

        return `
            <div class="score-entry${estMoi ? ' score-moi' : ''}" role="listitem">
                <span class="score-rang">${medailles[i] || (i + 1) + '.'}</span>
                <span class="score-name">${escHtml(nom)}${estMoi ? ' <em style="opacity:.6;">(toi)</em>' : ''}</span>
                <span class="score-points">${pts}${blocCumul}&nbsp;pts</span>
                ${ctrl}
            </div>
        `;
    }).join("");
}

// ======================================================
// 📊 AFFICHER LE SCOREBOARD HÔTE
// ======================================================
// Board de partie HÔTE : dérive de GameState.scores (alimenté par
// SCORES_UPDATE côté host_session) + cumul global + contrôles +/-.
export function afficherScoreboard() {
    rendreClassement('score-list', GameState.scores || {}, { cumul: true, controles: true });
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