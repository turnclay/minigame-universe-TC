// /js/modules/memoire_hote.js
// ============================================================
// 📡 MEMOIRE_HOTE.JS — Synchronisation hôte ↔ invités
// ============================================================
// Jeu simultané :
//   1. L'hôte choisit défi + difficulté → clique "Lancer à tous"
//   2. Les données sont générées UNE SEULE FOIS (même grille pour tous)
//   3. Phase "countdown" → phase "affichage" → phase "jeu"
//   4. Chaque joueur (hôte compris) joue sur son écran en même temps
//   5. Les invités soumettent via partie_reponses_*
//      { pseudo: { erreurs, score, ts } }
//   6. L'hôte voit le suivi en temps réel ; crédite les points
//   7. Phase "resultats" → classement global
//
// Clés localStorage :
//   partie_question_{sid}  — état du défi publié par l'hôte
//     { typeDefi, difficulte, donnees, phase, nbAttendu, ts }
//     phase : "menu" | "countdown" | "affichage" | "jeu" | "resultats"
//   partie_reponses_{sid}  — { pseudo: { erreurs, score, ts }, … }
//   partie_scores_{sid}    — { pseudo: totalPts }
//   partie_etat_{sid}      — "attente" | "en_cours" | "fin"
// ============================================================

import { GameState } from '../core/state.js';

// ── Helpers clés ──────────────────────────────────────────────
function partieId() {
    const id = localStorage.getItem('minigame_partie_session_id');
    if (!id) console.warn('[MEMOIRE_HOTE] ⚠️ session_id introuvable !');
    return id || 'inconnu';
}
const cleQ = () => `partie_question_${partieId()}`;
const cleE = () => `partie_etat_${partieId()}`;
const cleS = () => `partie_scores_${partieId()}`;
const cleR = () => `partie_reponses_${partieId()}`;

// ── Publications ──────────────────────────────────────────────

export function publierEtat(etat) {
    localStorage.setItem(cleE(), etat);
}

export function publierScores(scores) {
    localStorage.setItem(cleS(), JSON.stringify(scores || {}));
}

export function viderReponses() {
    localStorage.removeItem(cleR());
}

/**
 * Publier le défi complet — appelé une seule fois par lancerDefi.
 * donnees contient les données générées par l'hôte (paires, suite…)
 * qui seront lues à l'identique par chaque invité.
 */
export function publierDefi({ typeDefi, difficulte, donnees, phase, nbAttendu }) {
    localStorage.setItem(cleQ(), JSON.stringify({
        typeDefi,
        difficulte,
        donnees,        // données partagées générées par l'hôte
        phase,
        nbAttendu: nbAttendu || 0,
        ts: Date.now()
    }));
}

/**
 * Changer uniquement la phase sans regénérer les données.
 * Utilisé pour passer de "affichage" → "jeu" → "resultats" en sync.
 */
export function publierPhase(phase) {
    try {
        const raw  = localStorage.getItem(cleQ());
        if (!raw) return;
        const data = JSON.parse(raw);
        data.phase = phase;
        data.ts    = Date.now();
        localStorage.setItem(cleQ(), JSON.stringify(data));
    } catch (e) {
        console.error('[MEMOIRE_HOTE] publierPhase error', e);
    }
}

// ── Écoute des réponses invités ───────────────────────────────

/**
 * Écouter les réponses soumises par les invités.
 * L'hôte reçoit un callback pour chaque nouvelle réponse :
 * { pseudo, erreurs, score, ts }
 * @returns {()=>void} cleanup
 */
export function ecouterReponsesInvites(onReponse) {
    // ts de la dernière réponse vue par pseudo
    const _tsvuParPseudo = {};

    const verifier = () => {
        const raw = localStorage.getItem(cleR());
        if (!raw) return;
        try {
            const data = JSON.parse(raw);
            // data = { pseudo1: { erreurs, score, ts }, pseudo2: … }
            for (const [pseudo, rep] of Object.entries(data)) {
                if (!rep || !rep.ts) continue;
                if (rep.ts <= (_tsvuParPseudo[pseudo] || 0)) continue;
                _tsvuParPseudo[pseudo] = rep.ts;
                onReponse({ pseudo, erreurs: rep.erreurs ?? 0, score: rep.score ?? 0, ts: rep.ts });
            }
        } catch {}
    };

    const handler = e => { if (e.key === cleR()) verifier(); };
    window.addEventListener('storage', handler);
    const iv = setInterval(verifier, 600);

    return () => {
        window.removeEventListener('storage', handler);
        clearInterval(iv);
    };
}

// ── Créditer les points ───────────────────────────────────────

/**
 * Créditer delta points à pseudo.
 * Met à jour GameState.scores, scores_globaux, et rafraîchit le scoreboard.
 * Si scoresParticipants est fourni, il est aussi mis à jour
 * (mais NE DOIT PAS être passé si l'appelant l'a déjà incrémenté).
 */
export function crediterPoints(pseudo, delta, scoresParticipants) {
    if (!pseudo || !delta || delta <= 0) return;

    // GameState (partie en cours)
    if (GameState.scores[pseudo] === undefined) GameState.scores[pseudo] = 0;
    GameState.scores[pseudo] = +((GameState.scores[pseudo] + delta).toFixed(2));

    // Scores locaux de la session
    if (scoresParticipants) {
        scoresParticipants[pseudo] = (scoresParticipants[pseudo] || 0) + delta;
    }

    // Scores globaux cumulatifs
    try {
        const sg = JSON.parse(localStorage.getItem('scores_globaux') || '{}');
        if (!sg[pseudo]) sg[pseudo] = { total: 0, parJeu: {} };
        sg[pseudo].total = +((sg[pseudo].total || 0) + delta).toFixed(2);
        sg[pseudo].parJeu = sg[pseudo].parJeu || {};
        sg[pseudo].parJeu.memoire = +((sg[pseudo].parJeu.memoire || 0) + delta).toFixed(2);
        localStorage.setItem('scores_globaux', JSON.stringify(sg));
    } catch {}

    if (typeof window.afficherScoreboard === 'function') window.afficherScoreboard();
}

// ── Nettoyage ─────────────────────────────────────────────────

export function nettoyerPartie() {
    const pid = partieId();
    [`partie_question_${pid}`, `partie_reponses_${pid}`, `partie_scores_${pid}`]
        .forEach(k => localStorage.removeItem(k));
    publierEtat('fin');
}