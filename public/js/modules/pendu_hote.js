// /js/modules/pendu_hote.js
// ============================================================
// 📡 PENDU_HOTE.JS — Synchronisation hôte ↔ invités (Pendu)
// ============================================================
// Logique MULTIJOUEUR : chaque joueur (hôte + invités) joue
// le MÊME mot en parallèle sur son propre écran.
//
// Clés localStorage :
//   partie_question_{id}   — { motSecret, theme, ts }
//   partie_etat_{id}       — "attente" | "en_cours" | "fin"
//   partie_scores_{id}     — scores de tous
//   partie_reponses_{id}   — { pseudo: { victoire, erreurs, points, ts } }
//   partie_revelation_{id} — résultats finaux (déclenché par l'hôte)
//
// Flux :
//   1. L'hôte publie le mot → tous les joueurs le reçoivent et jouent
//   2. Chaque joueur envoie son résultat dans partie_reponses_*
//   3. L'hôte clique "Résultats" → révélation + scores
// ============================================================

import { GameState } from '../core/state.js';
import { getPenduCallbacks } from '../jeux/pendu.js';
import { getPenduCallbacks } from '../jeux/pendu.js';
import { afficherScoreboard } from '../modules/scoreboard.js';

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
const cleRv = () => `partie_revelation_${partieId()}`;

function _pseudoHote() { return GameState?.joueurs?.[0] || 'Hôte'; }

export function publierEtat(etat)  { localStorage.setItem(cleE(), etat); }
export function publierScores()    { localStorage.setItem(cleS(), JSON.stringify(GameState.scores || {})); }
export function lireReponses()     { try { return JSON.parse(localStorage.getItem(cleR()) || '{}'); } catch { return {}; } }
export function viderReponses()    { localStorage.removeItem(cleR()); }

// ======================================================
// 📡 PUBLIER UN NOUVEAU MOT (début de manche)
// Publie motSecret + theme pour que TOUS jouent le même mot.
// ======================================================
export function publierMot({ motSecret, theme }) {
    localStorage.removeItem(cleRv());
    localStorage.removeItem(cleR());
    localStorage.setItem(cleQ(), JSON.stringify({
        motSecret,
        theme,
        ts: Date.now()
    }));
    console.log(`[PENDU_HOTE] 📡 Mot publié : "${motSecret}" (${theme})`);
}

// ======================================================
// 📨 ENVOYER LE RÉSULTAT DE L'HÔTE
// ======================================================
export function envoyerResultatHote({ victoire, erreurs, points }) {
    const pseudo   = _pseudoHote();
    const reponses = lireReponses();
    reponses[pseudo] = { victoire: !!victoire, erreurs: erreurs || 0, points: points || 0, ts: Date.now() };
    localStorage.setItem(cleR(), JSON.stringify(reponses));
    console.log(`[PENDU_HOTE] 📨 Résultat hôte (${pseudo}) : victoire=${victoire}, pts=${points}`);
}

// ======================================================
// 🔔 NOMBRE DE JOUEURS ATTENDUS
// ======================================================
function _getNbTotal() {
    const n = (GameState.joueurs || []).length;
    if (n > 0) return n;
    try {
        const pid = localStorage.getItem('ws_partie_id') || localStorage.getItem('minigame_partie_session_id');
        const r   = pid && localStorage.getItem(`invite_rejoint_${pid}`);
        if (r) { const l = JSON.parse(r); return l.length + 1; }
    } catch {}
    return 1;
}

// ======================================================
// 🎯 RÉVÉLATION — Déclenché par l'hôte (bouton Résultats)
// ======================================================
export function declencherRevelation(POINTS_BASE) {
    const pseudoHote = _pseudoHote();
    const reponses   = lireReponses();
    const repTri     = Object.entries(reponses).sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));

    // Créditer les points dans GameState
    repTri.forEach(([pseudo, data]) => {
        const pts = data.points || 0;
        if (pts <= 0) return;
        if (pseudo === pseudoHote) {
            // L'hôte se crédite via getPenduCallbacks
            const cbs = getPenduCallbacks();
            if (typeof cbs.validerAvecPoints === 'function') cbs.validerAvecPoints(pts);
        } else {
            if (GameState.scores[pseudo] === undefined) GameState.scores[pseudo] = 0;
            GameState.scores[pseudo] = +((GameState.scores[pseudo] + pts).toFixed(2));
            try {
                const jeu = GameState.jeuActuel || 'pendu';
                const sg  = JSON.parse(localStorage.getItem('scores_globaux') || '{}');
                if (!sg[pseudo]) sg[pseudo] = { total: 0, parJeu: {} };
                sg[pseudo].total = +((sg[pseudo].total || 0) + pts).toFixed(2);
                sg[pseudo].parJeu = sg[pseudo].parJeu || {};
                sg[pseudo].parJeu[jeu] = +((sg[pseudo].parJeu[jeu] || 0) + pts).toFixed(2);
                localStorage.setItem('scores_globaux', JSON.stringify(sg));
            } catch {}
        }
    });

    publierScores();

    // Signal révélation pour jeu.html
    localStorage.setItem(cleRv(), JSON.stringify({
        hote: pseudoHote,
        reponses: repTri.map(([pseudo, data]) => ({
            pseudo,
            victoire: data.victoire,
            erreurs:  data.erreurs || 0,
            points:   data.points  || 0
        })),
        ts: Date.now()
    }));

    afficherScoreboard();
    _afficherPanneauResultats(repTri, pseudoHote);
}

// ── Panneau résultats côté hôte ──────────────────────────────
function _afficherPanneauResultats(repTri, pseudoHote) {
    const container = document.getElementById('pendu-invites-reponses');
    if (!container) return;
    container.innerHTML = repTri.map(([pseudo, data]) => {
        const victoire = data.victoire;
        const erreurs  = data.erreurs || 0;
        const points   = data.points  || 0;
        const isHote   = pseudo === pseudoHote;
        const bg       = victoire ? 'rgba(34,197,94,.15)'   : 'rgba(239,68,68,.12)';
        const border   = victoire ? 'rgba(34,197,94,.35)'   : 'rgba(239,68,68,.25)';
        const badge    = victoire
            ? `<span style="color:#86efac;font-weight:700;font-size:.82rem;">+${points}pt${points!==1?'s':''} ✅</span>`
            : `<span style="color:#fca5a5;font-size:.82rem;">0pt ❌ (${erreurs} erreur${erreurs!==1?'s':''})</span>`;
        return `
        <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;
            background:${bg};border:1px solid ${border};
            border-radius:10px;margin-bottom:6px;flex-wrap:wrap;">
            <span style="font-weight:700;font-size:.85rem;color:${isHote?'#c4b5fd':'#a78bfa'};min-width:80px;">
                ${isHote?'🎮 ':''}${escHtml(pseudo)}
            </span>
            <span style="flex:1;font-size:.82rem;color:rgba(255,255,255,.6);">
                ${victoire ? '🎉 Trouvé' : '😢 Pas trouvé'} — ${erreurs} erreur${erreurs!==1?'s':''}
            </span>
            ${badge}
        </div>`;
    }).join('');
}

// ======================================================
// 🔔 PANNEAU D'ATTENTE (avant révélation)
// ======================================================
export function afficherReponsesInvitesSurHote(containerId = 'pendu-invites-reponses') {
    const container = document.getElementById(containerId);
    if (!container) return;
    const reponses   = lireReponses();
    const entries    = Object.entries(reponses);
    const nbAttendu  = _getNbTotal();
    const pseudoHote = _pseudoHote();

    if (entries.length === 0) {
        container.innerHTML = `<p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">En attente des résultats… (0 / ${nbAttendu||'?'})</p>`;
        return;
    }
    container.innerHTML = entries.map(([p, data]) => {
        const isHote = p === pseudoHote;
        const fini   = data.victoire !== undefined;
        const status = fini
            ? (data.victoire ? '✅ Trouvé' : '❌ Pas trouvé')
            : '📝 En cours…';
        return `
        <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;
            background:${isHote?'rgba(196,181,253,.07)':'rgba(167,139,250,.07)'};
            border:1px solid ${isHote?'rgba(196,181,253,.25)':'rgba(167,139,250,.25)'};
            border-radius:10px;margin-bottom:6px;">
            <span style="font-weight:700;font-size:.85rem;color:${isHote?'#c4b5fd':'#a78bfa'};min-width:80px;">
                ${isHote?'🎮 ':''}${escHtml(p)}
            </span>
            <span style="flex:1;font-size:.82rem;color:rgba(255,255,255,.55);">${status}</span>
        </div>`;
    }).join('') + `<p style="font-size:.78rem;color:rgba(255,255,255,.35);text-align:center;margin-top:6px;">${entries.length} / ${nbAttendu||'?'} joueurs</p>`;
}

// ======================================================
// 🔍 VÉRIFIER SI TOUS ONT TERMINÉ (pour activer le bouton Résultats)
// ======================================================
export function verifierSiTousOntTermine() {
    const nb  = _getNbTotal();
    const nbR = Object.keys(lireReponses()).length;
    const btn = document.getElementById('pendu-btn-resultats');
    if (!btn) return;

    if (nb > 0 && nbR >= nb) {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor  = 'pointer';
        btn.title = '✅ Tous ont terminé — Afficher les résultats';
        btn.style.animation = 'lmlPulse .5s ease';
    } else {
        const reste = Math.max(0, nb - nbR);
        btn.disabled = true;
        btn.style.opacity = '0.4';
        btn.style.cursor  = 'not-allowed';
        btn.title = `En attente de ${reste} joueur${reste>1?'s':''}…`;
    }
}

export function nettoyerPartieInvites() {
    const pid = partieId();
    [`partie_question_${pid}`, `partie_reponses_${pid}`, `partie_scores_${pid}`, `partie_revelation_${pid}`]
        .forEach(k => localStorage.removeItem(k));
    publierEtat('fin');
}

function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}