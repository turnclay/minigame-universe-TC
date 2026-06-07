// /js/modules/morpion_hote.js
// ============================================================
// 📡 MORPION_HOTE.JS — Synchronisation hôte ↔ invités (Morpion)
// ============================================================
// Logique multijoueur : chaque joueur joue depuis son propre écran.
// L'hôte publie l'état complet du plateau après chaque coup.
// Les invités reçoivent l'état via WS (HOST_ACTION 'morpion:state').
//
// Clés localStorage (LEGACY — non utilisées par morpion.js) :
//   partie_scores_{id}     — scores de tous
// ============================================================

import { GameState } from '../core/state.js';

function partieId() {
    // Lire ws_partie_id (source de vérité) avec fallback minigame_partie_session_id
    const id = localStorage.getItem('ws_partie_id')
             || localStorage.getItem('minigame_partie_session_id');
    if (!id) console.warn('[HOTE] ⚠️ Aucun partieId en localStorage — GAME_CREATED pas encore reçu ?');
    return id || 'inconnu';
}

const cleS  = () => `partie_scores_${partieId()}`;

export function publierScores()    { localStorage.setItem(cleS(), JSON.stringify(GameState.scores || {})); }

// ======================================================
// 📡 PUBLIER L'ÉTAT COMPLET DU PLATEAU
// Appelé après chaque coup valide côté hôte.
// L'état est envoyé via WS (HOST_ACTION 'morpion:state')
// ======================================================
export function publierEtatPlateau({ plateau, taille, alignementRequis, tourActuel, joueurs,
                                     partieTerminee, gagnant, matchNul, modeAvance }) {
    // Les données sont envoyées via WS par morpion.js, pas localStorage
    // Cette fonction est nécessaire à l'import du module, mais directement inutilisée
    // On la garde pour compatibilité et future utilisation.
    console.log('[MORPION_HOTE] État plateau (via WS, pas localStorage)');
}

// ======================================================
// 🏆 CRÉDITER LES POINTS (fin de partie)
// ======================================================
export function crediterPoints(gagnants, points = 3) {
    if (!gagnants || gagnants.length === 0) return;
    gagnants.forEach(pseudo => {
        if (GameState.scores[pseudo] === undefined) GameState.scores[pseudo] = 0;
        GameState.scores[pseudo] = +((GameState.scores[pseudo] + points).toFixed(2));
        try {
            const jeu = 'morpion';
            const sg  = JSON.parse(localStorage.getItem('scores_globaux') || '{}');
            if (!sg[pseudo]) sg[pseudo] = { total: 0, parJeu: {} };
            sg[pseudo].total = +((sg[pseudo].total || 0) + points).toFixed(2);
            sg[pseudo].parJeu = sg[pseudo].parJeu || {};
            sg[pseudo].parJeu[jeu] = +((sg[pseudo].parJeu[jeu] || 0) + points).toFixed(2);
            localStorage.setItem('scores_globaux', JSON.stringify(sg));
        } catch {}
    });
    publierScores();
    if (typeof window.afficherScoreboard === 'function') window.afficherScoreboard();
}

