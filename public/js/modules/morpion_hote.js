// /js/modules/morpion_hote.js
// ============================================================
// 📡 MORPION_HOTE.JS — Synchronisation hôte ↔ invités (Morpion)
// ============================================================
// Logique multijoueur : chaque joueur joue depuis son propre écran.
// L'hôte publie l'état complet du plateau après chaque coup.
// Les invités voient le plateau en miroir ET soumettent leurs coups
// via partie_reponses_* → l'hôte valide et re-publie.
//
// Clés localStorage :
//   partie_question_{id}   — état complet du plateau { plateau, taille, tourActuel,
//                            joueurs, partieTerminee, gagnant, ts }
//   partie_etat_{id}       — "attente" | "en_cours" | "fin"
//   partie_scores_{id}     — scores de tous
//   partie_reponses_{id}   — { pseudo: { row, col, ts } }  coup soumis par un invité
//   partie_revelation_{id} — résultats finaux { gagnant, matchNul }
// ============================================================

import { GameState } from '../core/state.js';

function partieId() {
    const id = localStorage.getItem('minigame_partie_session_id');
    if (!id) console.warn('[MORPION_HOTE] ⚠️ session_id introuvable !');
    return id || 'inconnu';
}

const cleQ  = () => `partie_question_${partieId()}`;
const cleE  = () => `partie_etat_${partieId()}`;
const cleS  = () => `partie_scores_${partieId()}`;
const cleR  = () => `partie_reponses_${partieId()}`;
const cleRv = () => `partie_revelation_${partieId()}`;

function _pseudoHote() { return GameState?.joueurs?.[0] || 'Hôte'; }

export function publierEtat(etat)  { localStorage.setItem(cleE(), etat); }
export function publierScores()    { localStorage.setItem(cleS(), JSON.stringify(GameState.scores || {})); }
export function lireCoupInvite()   {
    try { return JSON.parse(localStorage.getItem(cleR()) || 'null'); } catch { return null; }
}
export function viderCoupInvite()  { localStorage.removeItem(cleR()); }

// ======================================================
// 📡 PUBLIER L'ÉTAT COMPLET DU PLATEAU
// Appelé après chaque coup valide côté hôte.
// ======================================================
export function publierEtatPlateau({ plateau, taille, alignementRequis, tourActuel, joueurs,
                                     partieTerminee, gagnant, matchNul, modeAvance }) {
    localStorage.setItem(cleQ(), JSON.stringify({
        plateau,
        taille,
        alignementRequis,
        tourActuel,
        joueurs,        // [{ nom, symbole, color, equipe, equipeNom }]
        partieTerminee: !!partieTerminee,
        gagnant:        gagnant  || null,
        matchNul:       !!matchNul,
        modeAvance:     !!modeAvance,
        ts: Date.now()
    }));

    // Si fin de partie → publier la révélation
    if (partieTerminee) {
        localStorage.setItem(cleRv(), JSON.stringify({
            gagnant:  gagnant  || null,
            matchNul: !!matchNul,
            ts: Date.now()
        }));
    }
}

// ======================================================
// 📡 ÉCOUTER LES COUPS DES INVITÉS
// Renvoie une fonction cleanup.
// ======================================================
export function ecouterCoupInvite(onCoup) {
    let _tsVu = 0;

    const verifier = () => {
        const raw = localStorage.getItem(cleR());
        if (!raw) return;
        try {
            const data = JSON.parse(raw);
            if (!data || data.ts <= _tsVu) return;
            _tsVu = data.ts;
            onCoup(data);   // { pseudo, row, col, ts }
        } catch {}
    };

    // StorageEvent = réaction instantanée entre onglets
    const handler = (e) => { if (e.key === cleR()) verifier(); };
    window.addEventListener('storage', handler);

    // Polling de secours (même onglet)
    const iv = setInterval(verifier, 500);

    return () => {
        window.removeEventListener('storage', handler);
        clearInterval(iv);
    };
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

export function nettoyerPartieInvites() {
    const pid = partieId();
    [`partie_question_${pid}`, `partie_reponses_${pid}`,
     `partie_scores_${pid}`,   `partie_revelation_${pid}`]
        .forEach(k => localStorage.removeItem(k));
    publierEtat('fin');
}