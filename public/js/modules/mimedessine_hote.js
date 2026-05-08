// /js/modules/mimedessine_hote.js
// ============================================================
// 📡 MIMEDESSINE_HOTE.JS — Synchronisation hôte ↔ invités
// ============================================================
// Logique multijoueur tour par tour :
//   - L'hôte publie l'état du tour (qui joue, quel mode, quelle catégorie, quel mot)
//   - Quand c'est le tour d'un invité, il voit le mot et joue sur son écran
//   - L'invité envoie son résultat (trouvé/passer) via partie_reponses_*
//   - L'hôte valide et passe au défi suivant ou au joueur suivant
//
// Clés localStorage :
//   partie_question_{id}  — état complet du tour
//     { participant, indexParticipant, mode, categorie, mot, motCache,
//       phase, mancheEnCours, ts }
//     phase : "accueil" | "defi" | "mot_revele" | "fin_manche" | "classement"
//   partie_etat_{id}      — "attente" | "en_cours" | "fin"
//   partie_scores_{id}    — { pseudo: score }
//   partie_reponses_{id}  — { pseudo: { action, ts } }  "trouve" | "passer"
// ============================================================

import { GameState } from '../core/state.js';

function partieId() {
    // Lire ws_partie_id (source de vérité) avec fallback minigame_partie_session_id
    const id = localStorage.getItem('ws_partie_id')
             || localStorage.getItem('minigame_partie_session_id');
    if (!id) console.warn('[HOTE] ⚠️ Aucun partieId en localStorage — GAME_CREATED pas encore reçu ?');
    return id || 'inconnu';
}

const cleQ  = () => `partie_question_${partieId()}`;
const cleE  = () => `partie_etat_${partieId()}`;
const cleS  = () => `partie_scores_${partieId()}`;
const cleR  = () => `partie_reponses_${partieId()}`;

export function publierEtat(etat)  { localStorage.setItem(cleE(), etat); }
export function publierScores(scores) {
    localStorage.setItem(cleS(), JSON.stringify(scores || {}));
}
export function viderReponse()     { localStorage.removeItem(cleR()); }
export function lireReponse() {
    try { return JSON.parse(localStorage.getItem(cleR()) || 'null'); } catch { return null; }
}

// ======================================================
// 📡 PUBLIER L'ÉTAT COMPLET DU TOUR
// ======================================================
export function publierEtatTour({
    participant, indexParticipant, nbParticipants,
    mode, categorie, mot, motCache,
    phase, mancheEnCours, scoresParParticipant
}) {
    localStorage.setItem(cleQ(), JSON.stringify({
        participant,
        indexParticipant,
        nbParticipants,
        mode,           // "mimer" | "dessiner"
        categorie,
        mot,            // null tant que non révélé (sécurité)
        motCache,       // true si l'hôte a caché le mot
        phase,          // "accueil" | "defi" | "mot_revele" | "fin_manche" | "classement"
        mancheEnCours,
        scoresParParticipant: scoresParParticipant || {},
        ts: Date.now()
    }));
}

// ======================================================
// 📡 ÉCOUTER LES ACTIONS DES INVITÉS (trouve / passer)
// ======================================================
export function ecouterActionInvite(onAction) {
    let _tsVu = 0;

    const verifier = () => {
        const raw = localStorage.getItem(cleR());
        if (!raw) return;
        try {
            const data = JSON.parse(raw);
            if (!data || data.ts <= _tsVu) return;
            _tsVu = data.ts;
            onAction(data);  // { pseudo, action: "trouve"|"passer", ts }
        } catch {}
    };

    const handler = (e) => { if (e.key === cleR()) verifier(); };
    window.addEventListener('storage', handler);
    const iv = setInterval(verifier, 600);

    return () => {
        window.removeEventListener('storage', handler);
        clearInterval(iv);
    };
}

// ======================================================
// 🏆 CRÉDITER LES POINTS
// ======================================================
export function crediterPoints(pseudo, delta, scoresParParticipant) {
    if (!pseudo || delta <= 0) return;
    if (GameState.scores[pseudo] === undefined) GameState.scores[pseudo] = 0;
    GameState.scores[pseudo] = +((GameState.scores[pseudo] + delta).toFixed(2));
    if (scoresParParticipant) {
        scoresParParticipant[pseudo] = (scoresParParticipant[pseudo] || 0) + delta;
    }
    try {
        const sg = JSON.parse(localStorage.getItem('scores_globaux') || '{}');
        if (!sg[pseudo]) sg[pseudo] = { total: 0, parJeu: {} };
        sg[pseudo].total = +((sg[pseudo].total || 0) + delta).toFixed(2);
        sg[pseudo].parJeu = sg[pseudo].parJeu || {};
        sg[pseudo].parJeu.mimer = +((sg[pseudo].parJeu.mimer || 0) + delta).toFixed(2);
        localStorage.setItem('scores_globaux', JSON.stringify(sg));
    } catch {}
    if (typeof window.afficherScoreboard === 'function') window.afficherScoreboard();
}

export function nettoyerPartieInvites() {
    const pid = partieId();
    [`partie_question_${pid}`, `partie_reponses_${pid}`,
     `partie_scores_${pid}`]
        .forEach(k => localStorage.removeItem(k));
    publierEtat('fin');
}