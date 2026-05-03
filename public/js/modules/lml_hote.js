// /js/modules/lml_hote.js
// ============================================================
// 📡 LML_HOTE.JS — Synchronisation hôte ↔ invités (Mot le Plus Long)
// ============================================================
// Clés localStorage :
//   partie_question_{id}   — { lettres[], ts }
//   partie_etat_{id}       — "attente" | "en_cours" | "fin"
//   partie_scores_{id}     — scores de tous
//   partie_reponses_{id}   — mots soumis { pseudo: { mot, ts } }
//   partie_revelation_{id} — résultats + motMax
//
// Règle de points : longueur du mot valide
//   + bonus 👑+1 pour le plus long parmi tous (si seul)
// ============================================================

import { GameState } from '../core/state.js';

let _validationEnCours  = false;
let _reponseHoteEnvoyee = false;
let _lettresEnCours     = [];
let _listenerActif      = false;

function partieId() {
    const id = localStorage.getItem('minigame_partie_session_id');
    if (!id) console.warn('[LML_HOTE] ⚠️ session_id introuvable !');
    return id || 'inconnu';
}

const cleQ  = () => `partie_question_${partieId()}`;
const cleE  = () => `partie_etat_${partieId()}`;
const cleS  = () => `partie_scores_${partieId()}`;
const cleR  = () => `partie_reponses_${partieId()}`;
const cleRv = () => `partie_revelation_${partieId()}`;

function _pseudoHote() { return GameState?.joueurs?.[0] || 'Hôte'; }

// ── Exports standards ────────────────────────────────────────────
export function publierEtat(etat)  { localStorage.setItem(cleE(), etat); }
export function publierScores()    { localStorage.setItem(cleS(), JSON.stringify(GameState.scores || {})); }
export function lireReponses()     { try { return JSON.parse(localStorage.getItem(cleR()) || '{}'); } catch { return {}; } }
export function viderReponses()    { localStorage.removeItem(cleR()); }

// ── Nb joueurs ────────────────────────────────────────────────────
function _getNbTotal() {
    if (typeof window._lmlNbInvites === 'function') {
        const n = window._lmlNbInvites();
        if (n >= 0) return n + 1;
    }
    const t = (GameState.joueurs || []).length;
    if (t > 0) return t;
    try {
        const pid = localStorage.getItem('minigame_partie_session_id');
        const r   = pid && localStorage.getItem(`invite_rejoint_${pid}`);
        if (r) return JSON.parse(r).length + 1;
    } catch {}
    return 1;
}

// ======================================================
// 📡 PUBLIER UNE MANCHE
// ======================================================
export function publierManche(lettres) {
    _reponseHoteEnvoyee = false;
    _validationEnCours  = false;
    _lettresEnCours     = [...lettres];

    localStorage.setItem(cleQ(), JSON.stringify({ lettres, ts: Date.now() }));
    localStorage.removeItem(cleRv());
    _resetBoutonsHote();
    _demarrerEcouteReponses();
}

function _resetBoutonsHote() {
    const btnEnvoyer = document.getElementById('lml-btn-envoyer-hote');
    if (btnEnvoyer) {
        btnEnvoyer.disabled   = false;
        btnEnvoyer._sent      = false;
        btnEnvoyer.style.opacity  = '';
        btnEnvoyer.textContent = '✅ Envoyer mon mot';
    }
    const inp = document.getElementById('lml-input');
    if (inp) { inp.value = ''; inp.disabled = false; }

    const btnAfficher = document.getElementById('lml-btn-afficher');
    if (btnAfficher) {
        btnAfficher.disabled         = true;
        btnAfficher.style.opacity    = '0.4';
        btnAfficher.style.cursor     = 'not-allowed';
        btnAfficher.style.animation  = '';
        btnAfficher.title = 'En attente des mots de tous les joueurs…';
    }

    const reps = document.getElementById('lml-invites-reponses');
    if (reps) reps.innerHTML = '<p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">En attente des mots…</p>';
}

// ── Écoute StorageEvent ───────────────────────────────────────────
function _demarrerEcouteReponses() {
    if (_listenerActif) return;
    _listenerActif = true;
    window.addEventListener('storage', e => {
        if (_validationEnCours || e.key !== cleR()) return;
        afficherReponsesInvitesSurHote('lml-invites-reponses');
        _verifierSiTousOntRepondu();
    });
}

// ======================================================
// 🔍 VÉRIFIER SI TOUS ONT RÉPONDU
// ======================================================
function _verifierSiTousOntRepondu() {
    const nb  = _getNbTotal();
    const nbR = Object.keys(lireReponses()).length;
    const btn = document.getElementById('lml-btn-afficher');
    if (!btn) return;

    if (nb > 0 && nbR >= nb) {
        btn.disabled         = false;
        btn.style.opacity    = '1';
        btn.style.cursor     = 'pointer';
        btn.title = '✅ Tous ont soumis — Cliquez pour révéler';
        if (!document.getElementById('style-lml-pulse')) {
            const s = document.createElement('style');
            s.id = 'style-lml-pulse';
            s.textContent = '@keyframes lmlPulse{0%{transform:scale(1)}50%{transform:scale(1.06)}100%{transform:scale(1)}}';
            document.head.appendChild(s);
        }
        btn.style.animation = 'lmlPulse .5s ease';
    } else {
        const reste = Math.max(0, nb - nbR);
        btn.disabled         = true;
        btn.style.opacity    = '0.4';
        btn.style.cursor     = 'not-allowed';
        btn.style.animation  = '';
        btn.title = `En attente de ${reste} joueur${reste > 1 ? 's' : ''}…`;
    }
}

// ======================================================
// 📨 ENVOYER LE MOT DE L'HÔTE
// ======================================================
export function envoyerMotHote(mot) {
    if (!mot || _reponseHoteEnvoyee) return;
    _reponseHoteEnvoyee = true;
    const pseudo   = _pseudoHote();
    const reponses = JSON.parse(localStorage.getItem(cleR()) || '{}');
    reponses[pseudo] = { mot: mot.toUpperCase(), ts: Date.now() };
    localStorage.setItem(cleR(), JSON.stringify(reponses));
    console.log(`[LML_HOTE] 📨 Mot hôte (${pseudo}) : "${mot}"`);
    afficherReponsesInvitesSurHote('lml-invites-reponses');
    _verifierSiTousOntRepondu();
}

// ======================================================
// 🎯 RÉVÉLATION — calcul des points
// ======================================================
export function declencherRevelation(lexique, lettres) {
    if (_validationEnCours) return;
    _validationEnCours = true;

    ['lml-btn-afficher', 'lml-btn-envoyer-hote'].forEach(id => {
        const b = document.getElementById(id);
        if (b) { b.disabled = true; b.style.opacity = '0.45'; }
    });

    const pseudoHote = _pseudoHote();
    const reponses   = lireReponses();
    const repTri     = Object.entries(reponses).sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));

    // Vérifier chaque mot
    const resultats = repTri.map(([pseudo, data]) => {
        const mot    = (data.mot || '').toUpperCase().trim();
        const valide = mot.length > 0 && _motValide(mot, lettres, lexique);
        return { pseudo, mot, valide, points: valide ? mot.length : 0, estPlusLong: false };
    });

    // Bonus +1 au plus long (s'il est seul)
    const valides = resultats.filter(r => r.valide);
    if (valides.length > 0) {
        const maxLen = Math.max(...valides.map(r => r.mot.length));
        const plusLongs = valides.filter(r => r.mot.length === maxLen);
        if (plusLongs.length === 1) { plusLongs[0].estPlusLong = true; plusLongs[0].points += 1; }
    }

    // Meilleur mot possible
    const motMax = _trouverMotLePlusLong(lettres, lexique);

    // Créditer les points
    resultats.forEach(r => {
        if (r.points <= 0) return;
        if (r.pseudo === pseudoHote) {
            if (typeof window._lmlValiderAvecPoints === 'function') window._lmlValiderAvecPoints(r.points);
        } else {
            if (GameState.scores[r.pseudo] === undefined) GameState.scores[r.pseudo] = 0;
            GameState.scores[r.pseudo] = +((GameState.scores[r.pseudo] + r.points).toFixed(2));
            try {
                const jeu = GameState.jeuActuel || 'lml';
                const sg  = JSON.parse(localStorage.getItem('scores_globaux') || '{}');
                if (!sg[r.pseudo]) sg[r.pseudo] = { total: 0, parJeu: {} };
                sg[r.pseudo].total = +((sg[r.pseudo].total || 0) + r.points).toFixed(2);
                sg[r.pseudo].parJeu = sg[r.pseudo].parJeu || {};
                sg[r.pseudo].parJeu[jeu] = +((sg[r.pseudo].parJeu[jeu] || 0) + r.points).toFixed(2);
                localStorage.setItem('scores_globaux', JSON.stringify(sg));
            } catch {}
        }
    });
    publierScores();

    // Signal révélation pour jeu.html
    localStorage.setItem(cleRv(), JSON.stringify({
        hote: pseudoHote, motMax,
        reponses: resultats.map(r => ({
            pseudo: r.pseudo, mot: r.mot,
            valide: r.valide, points: r.points, estPlusLong: r.estPlusLong
        })),
        ts: Date.now()
    }));

    _afficherPanneauResultats(resultats, motMax);
    if (typeof window.afficherScoreboard === 'function') window.afficherScoreboard();
}

// ── Vérification mot avec lettres disponibles ─────────────────────
function _motValide(mot, lettres, lexique) {
    if (!lexique || lexique.size === 0) {
        if (mot.length < 2) return false;
        const d = {};
        for (const l of lettres) d[l] = (d[l] || 0) + 1;
        for (const ch of mot) { if (!d[ch]) return false; d[ch]--; }
        return true;
    }
    if (!lexique.has(mot)) return false;
    const dispo = {};
    for (const l of lettres) dispo[l] = (dispo[l] || 0) + 1;
    for (const c of mot) { if (!dispo[c]) return false; dispo[c]--; }
    return true;
}

function _trouverMotLePlusLong(lettres, lexique) {
    if (!lexique || lexique.size === 0) return '';
    const dispo = {};
    for (const l of lettres) dispo[l] = (dispo[l] || 0) + 1;
    let meilleur = '';
    for (const mot of lexique) {
        if (mot.length <= meilleur.length) continue;
        const tmp = { ...dispo }; let ok = true;
        for (const c of mot) { if (!tmp[c]) { ok = false; break; } tmp[c]--; }
        if (ok) meilleur = mot;
    }
    return meilleur;
}

// ── Panneau résultats hôte ────────────────────────────────────────
function _afficherPanneauResultats(resultats, motMax) {
    const container = document.getElementById('lml-invites-reponses');
    if (!container) return;
    const pseudoHote = _pseudoHote();

    container.innerHTML = resultats.map(({ pseudo, mot, valide, points, estPlusLong }) => {
        const bg     = valide ? 'rgba(34,197,94,.15)'  : 'rgba(239,68,68,.12)';
        const border = valide ? 'rgba(34,197,94,.35)'  : 'rgba(239,68,68,.25)';
        const isHote = pseudo === pseudoHote;
        const badge  = valide
            ? `<span style="color:#86efac;font-weight:700;font-size:.82rem;">+${points}pt${points!==1?'s':''} ✅${estPlusLong?' <span style="font-size:.75rem;color:#a78bfa;">👑+1</span>':''}</span>`
            : `<span style="color:#fca5a5;font-size:.82rem;">0pt ❌</span>`;
        return `
        <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;
            background:${bg};border:1px solid ${border};
            border-radius:10px;margin-bottom:6px;flex-wrap:wrap;">
            <span style="font-weight:700;font-size:.85rem;color:${isHote?'#c4b5fd':'#a78bfa'};min-width:80px;">
                ${isHote?'🎮 ':''}${escHtml(pseudo)}
            </span>
            <span style="flex:1;font-size:.88rem;color:rgba(255,255,255,.85);font-style:italic;letter-spacing:.05em;">"${escHtml(mot||'—')}"</span>
            <span style="font-size:.75rem;color:rgba(255,255,255,.4);">${mot.length} lettre${mot.length>1?'s':''}</span>
            ${badge}
        </div>`;
    }).join('') + (motMax ? `
        <div style="margin-top:10px;padding:8px 12px;border-top:1px solid rgba(255,255,255,.1);
            font-size:.82rem;color:rgba(255,255,255,.5);text-align:center;">
            💎 Meilleur mot possible : <strong style="color:#a78bfa;">${escHtml(motMax)}</strong> (${motMax.length} lettres)
        </div>` : '');
}

// ======================================================
// 🔔 PANNEAU D'ATTENTE (avant révélation)
// ======================================================
export function afficherReponsesInvitesSurHote(containerId = 'lml-invites-reponses') {
    const container = document.getElementById(containerId);
    if (!container || _validationEnCours) return;
    const reponses   = lireReponses();
    const entries    = Object.entries(reponses);
    const nbAttendu  = _getNbTotal();
    const pseudoHote = _pseudoHote();

    if (entries.length === 0) {
        container.innerHTML = `<p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">En attente des mots… (0 / ${nbAttendu||'?'})</p>`;
        return;
    }
    container.innerHTML = entries.map(([p]) => {
        const isHote = p === pseudoHote;
        return `
        <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;
            background:${isHote?'rgba(196,181,253,.07)':'rgba(167,139,250,.07)'};
            border:1px solid ${isHote?'rgba(196,181,253,.25)':'rgba(167,139,250,.25)'};
            border-radius:10px;margin-bottom:6px;">
            <span style="font-weight:700;font-size:.85rem;color:${isHote?'#c4b5fd':'#a78bfa'};min-width:80px;">
                ${isHote?'🎮 ':''}${escHtml(p)}
            </span>
            <span style="flex:1;font-size:.82rem;color:rgba(255,255,255,.35);font-style:italic;">📝 a soumis</span>
        </div>`;
    }).join('') + `<p style="font-size:.78rem;color:rgba(255,255,255,.35);text-align:center;margin-top:6px;">${entries.length} / ${nbAttendu||'?'} mots reçus</p>`;
}

export function declencherAfficherResultats(lexique, lettres) {
    declencherRevelation(lexique, lettres);
}

export function nettoyerPartieInvites() {
    const pid = partieId();
    [`partie_question_${pid}`, `partie_reponses_${pid}`, `partie_scores_${pid}`, `partie_revelation_${pid}`]
        .forEach(k => localStorage.removeItem(k));
    publierEtat('fin');
    _validationEnCours = false;
    _reponseHoteEnvoyee = false;
    _listenerActif = false;
}

function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}