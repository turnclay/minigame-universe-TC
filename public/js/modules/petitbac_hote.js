// /js/modules/petitbac_hote.js
// ============================================================
// 📡 PETITBAC_HOTE.JS — Synchronisation hôte ↔ invités (Petit Bac)
// ============================================================
// Jeu simultané — même lettre pour tous :
//   1. L'hôte tire une lettre + publie les catégories
//   2. Tous les joueurs (hôte compris) remplissent leurs réponses en 2 min
//   3. Quand l'hôte clique "Valider" → publish phase 'resultats'
//   4. Les invités soumettent via partie_reponses_*
//      { pseudo: { reponses: {cat:val,…}, score, ts } }
//   5. L'hôte clique "Afficher résultats" → révélation groupée + scores
//
// Clés localStorage :
//   partie_question_{sid}   — { lettre, categories, phase, ts }
//     phase : "attente" | "jeu" | "resultats"
//   partie_reponses_{sid}   — { pseudo: { reponses:{…}, score, ts } }
//   partie_scores_{sid}     — { pseudo: totalPts }
//   partie_revelation_{sid} — { reponses:[…], lettre, hote, ts }
//   partie_etat_{sid}       — "attente" | "en_cours" | "fin"
// ============================================================

import { GameState } from '../core/state.js';

// ── Helpers clés ──────────────────────────────────────────────
function partieId() {
    const id = localStorage.getItem('minigame_partie_session_id');
    if (!id) console.warn('[PB_HOTE] ⚠️ session_id introuvable !');
    return id || 'inconnu';
}
const cleQ  = () => `partie_question_${partieId()}`;
const cleE  = () => `partie_etat_${partieId()}`;
const cleS  = () => `partie_scores_${partieId()}`;
const cleR  = () => `partie_reponses_${partieId()}`;
const cleRv = () => `partie_revelation_${partieId()}`;

// ── Publications ──────────────────────────────────────────────

export function publierEtat(etat) {
    localStorage.setItem(cleE(), etat);
}

export function publierScores() {
    localStorage.setItem(cleS(), JSON.stringify(GameState.scores || {}));
}

export function viderReponses() {
    localStorage.removeItem(cleR());
    localStorage.removeItem(cleRv());
}

export function lireReponses() {
    try { return JSON.parse(localStorage.getItem(cleR()) || '{}'); } catch { return {}; }
}

/**
 * Publier la lettre + les catégories pour que tous jouent en même temps.
 * phase = "jeu" → les invités affichent les champs et le timer démarre.
 */
export function publierManche({ lettre, categories }) {
    viderReponses();
    localStorage.setItem(cleQ(), JSON.stringify({
        lettre,
        categories,  // [{id, label, icon}, …]
        phase: 'jeu',
        ts: Date.now()
    }));
    console.log(`[PB_HOTE] 📡 Lettre publiée : "${lettre}"`);
}

/**
 * Changer la phase sans modifier lettre/catégories NI le ts de manche.
 * ⚠️ NE PAS toucher au ts : côté invité, _lireEtat détecte une "nouvelle manche"
 * quand data.ts change. Modifier le ts ici réinitialiserait la grille et effacerait
 * les réponses déjà saisies, rendant le score = 0.
 */
export function publierPhase(phase) {
    try {
        const raw  = localStorage.getItem(cleQ());
        if (!raw) return;
        const data = JSON.parse(raw);
        data.phase = phase;
        // ✅ ts volontairement conservé : l'invité ne doit pas croire à une nouvelle manche
        localStorage.setItem(cleQ(), JSON.stringify(data));
    } catch (e) {
        console.error('[PB_HOTE] publierPhase error', e);
    }
}

/**
 * L'hôte soumet ses propres réponses (appelé en même temps que validerReponses()).
 */
export function envoyerReponsesHote({ reponses, score }) {
    const pseudo   = GameState?.joueurs?.[0] || 'Hôte';
    const toutes   = lireReponses();
    toutes[pseudo] = { reponses, score, ts: Date.now() };
    localStorage.setItem(cleR(), JSON.stringify(toutes));
    console.log(`[PB_HOTE] 📨 Réponses hôte (${pseudo}) : score=${score}`);
}

/**
 * Nombre de joueurs attendus (hôte + invités).
 */
function _getNbTotal() {
    const n = (GameState.joueurs || []).length;
    if (n > 0) return n;
    try {
        const pid = localStorage.getItem('minigame_partie_session_id');
        const r   = pid && localStorage.getItem(`invite_rejoint_${pid}`);
        if (r) { const l = JSON.parse(r); return l.length + 1; }
    } catch {}
    return 1;
}

/**
 * Révélation groupée — appelée par l'hôte via le bouton "Afficher résultats".
 * Crédite les points et publie le signal de révélation pour jeu.html.
 */
export function declencherRevelation(lettre, POINTS_PAR_REPONSE = 1) {
    const pseudoHote = GameState?.joueurs?.[0] || 'Hôte';
    const reponses   = lireReponses();
    const repTri     = Object.entries(reponses).sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));

    // Créditer les points dans GameState
    repTri.forEach(([pseudo, data]) => {
        const pts = (data.score || 0) * POINTS_PAR_REPONSE;
        if (pts <= 0) return;
        if (GameState.scores[pseudo] === undefined) GameState.scores[pseudo] = 0;
        GameState.scores[pseudo] = +((GameState.scores[pseudo] + pts).toFixed(2));
        try {
            const sg = JSON.parse(localStorage.getItem('scores_globaux') || '{}');
            if (!sg[pseudo]) sg[pseudo] = { total: 0, parJeu: {} };
            sg[pseudo].total = +((sg[pseudo].total || 0) + pts).toFixed(2);
            sg[pseudo].parJeu = sg[pseudo].parJeu || {};
            sg[pseudo].parJeu.petitbac = +((sg[pseudo].parJeu.petitbac || 0) + pts).toFixed(2);
            localStorage.setItem('scores_globaux', JSON.stringify(sg));
        } catch {}
    });

    publierScores();

    // Signal révélation pour jeu.html
    localStorage.setItem(cleRv(), JSON.stringify({
        hote: pseudoHote,
        lettre,
        reponses: repTri.map(([pseudo, data]) => ({
            pseudo,
            reponses: data.reponses || {},
            score:    data.score    || 0
        })),
        ts: Date.now()
    }));

    if (typeof window.afficherScoreboard === 'function') window.afficherScoreboard();
    console.log('[PB_HOTE] 🎯 Révélation déclenchée');
}

/**
 * Panneau invités côté hôte — affiche les soumissions en temps réel.
 */
export function afficherReponsesInvitesSurHote(containerId = 'pb-invites-reponses') {
    const container = document.getElementById(containerId);
    if (!container) return;
    const reponses   = lireReponses();
    const entries    = Object.entries(reponses);
    const nbAttendu  = _getNbTotal();
    const pseudoHote = GameState?.joueurs?.[0] || 'Hôte';

    if (entries.length === 0) {
        container.innerHTML = `<p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">
            En attente des réponses… (0 / ${nbAttendu || '?'})</p>`;
        return;
    }
    container.innerHTML = entries.map(([p, data]) => {
        const isHote = p === pseudoHote;
        const score  = data.score ?? '?';
        return `
        <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;
            background:${isHote ? 'rgba(196,181,253,.07)' : 'rgba(167,139,250,.07)'};
            border:1px solid ${isHote ? 'rgba(196,181,253,.25)' : 'rgba(167,139,250,.25)'};
            border-radius:10px;margin-bottom:6px;">
            <span style="font-weight:700;font-size:.85rem;color:${isHote ? '#c4b5fd' : '#a78bfa'};min-width:80px;">
                ${isHote ? '🎮 ' : ''}${escHtml(p)}
            </span>
            <span style="flex:1;font-size:.82rem;color:rgba(255,255,255,.55);">
                ✅ ${score} bonne${score !== 1 ? 's' : ''} réponse${score !== 1 ? 's' : ''}
            </span>
        </div>`;
    }).join('') + `<p style="font-size:.78rem;color:rgba(255,255,255,.35);text-align:center;margin-top:6px;">
        ${entries.length} / ${nbAttendu || '?'} joueurs ont soumis</p>`;
}

/**
 * Vérifier si tous ont soumis → activer le bouton "Afficher résultats".
 */
export function verifierSiTousOntSoumis() {
    const nb  = _getNbTotal();
    const nbR = Object.keys(lireReponses()).length;
    const btn = document.getElementById('pb-btn-resultats');
    if (!btn) return;
    if (nb > 0 && nbR >= nb) {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor  = 'pointer';
        btn.title = '✅ Tous ont soumis — Afficher les résultats';
    } else {
        const reste = Math.max(0, nb - nbR);
        btn.disabled = true;
        btn.style.opacity = '0.4';
        btn.style.cursor  = 'not-allowed';
        btn.title = `En attente de ${reste} joueur${reste > 1 ? 's' : ''}…`;
    }
}

/**
 * Injecter le panneau de suivi invités dans la section Petit Bac (côté hôte).
 * Appelé depuis petitbac.js une fois le module hôte chargé.
 */
export function injecterPanneauHote() {
    if (document.getElementById('panneau-invites-pb')) return;
    const section = document.getElementById('petitbac');
    if (!section) return;

    const panneau = document.createElement('div');
    panneau.id = 'panneau-invites-pb';
    panneau.style.cssText = `
        margin-top:18px;background:rgba(139,92,246,.06);
        border:1px solid rgba(139,92,246,.25);border-radius:14px;padding:14px 16px;
    `;
    panneau.innerHTML = `
        <div style="font-size:.78rem;text-transform:uppercase;letter-spacing:.1em;
            color:rgba(139,92,246,.8);margin-bottom:10px;font-weight:700;">
            📝 Soumissions des joueurs
        </div>
        <div id="pb-invites-reponses">
            <p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">
                Aucune soumission pour l'instant
            </p>
        </div>
        <div style="margin-top:12px;text-align:center;">
            <button id="pb-btn-resultats"
                style="padding:10px 22px;background:linear-gradient(135deg,#6a5af9,#8a2be2);
                border:none;border-radius:12px;color:white;font-size:.88rem;font-weight:700;
                cursor:not-allowed;opacity:0.4;transition:opacity .2s;font-family:inherit;"
                disabled title="En attente des soumissions…">
                📊 Afficher les résultats
            </button>
        </div>
    `;
    section.appendChild(panneau);

    // Polling toutes les 2s
    setInterval(() => {
        afficherReponsesInvitesSurHote('pb-invites-reponses');
        verifierSiTousOntSoumis();
    }, 2000);
}

export function nettoyerPartieInvites() {
    const pid = partieId();
    [`partie_question_${pid}`, `partie_reponses_${pid}`,
     `partie_scores_${pid}`, `partie_revelation_${pid}`]
        .forEach(k => localStorage.removeItem(k));
    publierEtat('fin');
}

function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}