// /js/modules/quiz_hote.js — v3.0
// ============================================================
// 📡 QUIZ_HOTE.JS — Pont UI hôte ↔ serveur WS
// ============================================================
//
// v3.0 : interface allégée — la séquence des questions
//         est entièrement gérée par server/games/quiz.js.
//
// Exports utilisés par quiz.js v3.0 :
//   publierEtat(etat)              — localStorage signal.js compat
//   publierScores()                — rafraîchit scoreboard
//   afficherReponsesInvitesSurHote(containerId)
//   viderReponses()
//   declencherAfficherReponse()    — envoie quiz:reveal au serveur
//   envoyerReponseHote(rep)        — envoie quiz:answer au serveur
//   lireReponsesInvites()          — snapshot _reponsesRecues
//   nettoyerPartieInvites()
//
// Supprimés vs v2.0 :
//   publierQuestion()              — séquence côté serveur
//   setQuestionSuivanteCallback()  — inutile
//   declencherValidationHote()     — alias supprimé
//   fallback localStorage complet  — conservé uniquement pour publierEtat/publierScores
// ============================================================

import { GameState } from '../core/state.js';

// ── État interne ───────────────────────────────────────
let _validationEnCours   = false;
let _reponseHoteEnvoyee  = false;
let _reponsesRecues      = {};   // { pseudo: { reponse, ts } }
let _nbJoueursWS         = 0;
let _wsListenersActifs   = false;

// ── Accès socket ───────────────────────────────────────
function _ws()   { return window.jeuSocket || null; }
function _wsOk() { const s = _ws(); return !!(s && s.connected); }

// ── Clés localStorage (compat signal.js + scoreboard) ──
function _pid()       { return localStorage.getItem('minigame_partie_id') || localStorage.getItem('minigame_partie_session_id') || localStorage.getItem('ws_partie_id') || 'inconnu'; }
function _cleScores() { return `partie_scores_${_pid()}`; }
function _cleEtat()   { return `partie_etat_${_pid()}`; }

function _pseudoHote() { return (GameState?.joueurs?.[0]) || 'Hôte'; }

// ──────────────────────────────────────────────────────
// Listeners WS entrants (initialisés une seule fois)
// ──────────────────────────────────────────────────────
function _initWsListeners() {
    if (_wsListenersActifs) return;
    const s = _ws();
    if (!s) return;
    _wsListenersActifs = true;

    s.on('QUIZ_RESPONSE_IN', ({ pseudo, nbReponses, nbJoueurs, allAnswered }) => {
        if (!_reponsesRecues[pseudo]) {
            _reponsesRecues[pseudo] = { reponse: '…', ts: Date.now() };
        }
        if (nbJoueurs) _nbJoueursWS = nbJoueurs;
        _afficherPanneauAttenteWS();
        if (allAnswered) {
            // Tous ont répondu → activer btn-afficher mais NE PAS révéler auto
            // L'hôte décide quand cliquer sur "Afficher"
            _activerBoutonAfficher('✅ Tous ont répondu — Cliquez pour révéler');
        } else {
            _mettreAJourBoutonAfficher(nbReponses, nbJoueurs);
        }
    });

    // Timer écoulé → activer btn-afficher même si pas tout le monde a répondu
    s.on('QUIZ_TIMER_EXPIRED', ({ nbReponses, nbJoueurs }) => {
        _activerBoutonAfficher('⏱ Timer écoulé — Cliquez pour révéler');
    });

    s.on('QUIZ_CORRECTION', ({ reponses, reponse: bonneReponse }) => {
        _validationEnCours = false;
        const repEl = document.getElementById('reponse');
        if (repEl && bonneReponse) repEl.textContent = bonneReponse;
        _afficherPanneauResultats(reponses || [], bonneReponse || '');
        if (typeof window.afficherScoreboard === 'function') window.afficherScoreboard();
    });

    s.on('SCORES_UPDATE', ({ scores }) => {
        if (scores) {
            GameState.scores = GameState.scores || {};
            Object.assign(GameState.scores, scores);
            localStorage.setItem(_cleScores(), JSON.stringify(scores));
        }
        if (typeof window.afficherScoreboard === 'function') window.afficherScoreboard();
    });

    s.on('PLAYER_JOINED', ({ joueurs }) => {
        _nbJoueursWS = (joueurs || []).length;
    });

    s.on('QUIZ_INDICE', ({ num, texte }) => {
        const el = document.getElementById(`indice${num}`);
        if (el) el.textContent = texte;
    });

    s.on('QUIZ_ANSWER_ACK', ({ status }) => {
        if (status === 'ok') {
            const btn = document.getElementById('btn-valider-reponse');
            if (btn) { btn.disabled = true; btn.style.opacity = '0.45'; btn.textContent = '✅ Envoyé'; }
            const inp = document.getElementById('quiz-reponse-input');
            if (inp) inp.disabled = true;
        }
    });
}

// ──────────────────────────────────────────────────────
// Boutons hôte
// ──────────────────────────────────────────────────────
function _activerBoutonAfficher(titre) {
    const btn = document.getElementById('btn-afficher-reponse');
    if (!btn) return;
    btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer';
    btn.title    = titre || '✅ Cliquez pour révéler la réponse';
    if (!document.getElementById('style-btn-pulse')) {
        const s = document.createElement('style');
        s.id = 'style-btn-pulse';
        s.textContent = '@keyframes btnPulse{0%{transform:scale(1)}50%{transform:scale(1.06)}100%{transform:scale(1)}}';
        document.head.appendChild(s);
    }
    btn.style.animation = 'btnPulse .5s ease';
}

function _mettreAJourBoutonAfficher(nbRecus, nbAttendu) {
    const btn = document.getElementById('btn-afficher-reponse');
    if (!btn) return;
    const reste = Math.max(0, (nbAttendu || 0) - (nbRecus || 0));
    btn.disabled = true; btn.style.opacity = '0.4'; btn.style.cursor = 'not-allowed';
    btn.title    = reste > 0 ? `En attente de ${reste} joueur${reste > 1 ? 's' : ''}…` : 'En attente…';
    btn.style.animation = '';
}

function _resetBoutonsHote() {
    const btnEnvoyer = document.getElementById('btn-valider-reponse');
    if (btnEnvoyer) {
        btnEnvoyer.disabled = false; btnEnvoyer._sent = false;
        btnEnvoyer.style.opacity = ''; btnEnvoyer.textContent = '✅ Envoyer';
    }
    const input = document.getElementById('quiz-reponse-input');
    if (input) { input.value = ''; input.disabled = false; }
    const btnAfficher = document.getElementById('btn-afficher-reponse');
    if (btnAfficher) {
        btnAfficher.disabled = true; btnAfficher.style.opacity = '0.4';
        btnAfficher.style.cursor = 'not-allowed';
        btnAfficher.title = 'En attente des réponses de tous les joueurs…';
        btnAfficher.style.animation = '';
    }
}

// ──────────────────────────────────────────────────────
// Panneau attente (avant révélation)
// ──────────────────────────────────────────────────────
function _afficherPanneauAttenteWS() {
    const container = document.getElementById('invites-reponses');
    if (!container || _validationEnCours) return;
    const pseudoHote = _pseudoHote();
    const entries    = Object.entries(_reponsesRecues);
    const nbAttendu  = _nbJoueursWS;

    if (entries.length === 0) {
        container.innerHTML = `<p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">En attente… (0 / ${nbAttendu || '?'})</p>`;
        return;
    }
    container.innerHTML = entries.map(([p]) => {
        const isHote = p === pseudoHote;
        return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;
            background:${isHote ? 'rgba(196,181,253,.07)' : 'rgba(0,212,255,.07)'};
            border:1px solid ${isHote ? 'rgba(196,181,253,.25)' : 'rgba(0,212,255,.2)'};
            border-radius:10px;margin-bottom:6px;">
            <span style="font-weight:700;font-size:.85rem;color:${isHote ? '#c4b5fd' : '#00d4ff'};min-width:80px;">
                ${isHote ? '🎮 ' : ''}${_esc(p)}
            </span>
            <span style="flex:1;font-size:.82rem;color:rgba(255,255,255,.35);font-style:italic;">✅ a répondu</span>
        </div>`;
    }).join('') + `<p style="font-size:.78rem;color:rgba(255,255,255,.35);text-align:center;margin-top:6px;">
        ${entries.length} / ${nbAttendu || '?'} réponses
    </p>`;
}

// ──────────────────────────────────────────────────────
// Panneau résultats (après révélation)
// ──────────────────────────────────────────────────────
function _afficherPanneauResultats(resultats, bonneReponse) {
    const container = document.getElementById('invites-reponses');
    if (!container) return;
    if (!resultats || resultats.length === 0) {
        container.innerHTML = '<p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">Aucune réponse reçue</p>';
        return;
    }
    const pseudoHote = _pseudoHote();
    container.innerHTML = resultats.map(({ pseudo, texte, reponse, correct, points, estPremier }) => {
        const rep    = texte || reponse || '';
        const bg     = correct ? 'rgba(34,197,94,.15)'  : 'rgba(239,68,68,.12)';
        const border = correct ? 'rgba(34,197,94,.35)'  : 'rgba(239,68,68,.25)';
        const isHote = pseudo === pseudoHote;
        const prem   = estPremier ? ' <span style="font-size:.75rem;color:#fbbf24;">🏆+1</span>' : '';
        const badge  = correct
            ? `<span style="color:#86efac;font-weight:700;font-size:.82rem;">+${points}pt${points !== 1 ? 's' : ''} ✅${prem}</span>`
            : '<span style="color:#fca5a5;font-size:.82rem;">0pt ❌</span>';
        return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;
            background:${bg};border:1px solid ${border};border-radius:10px;margin-bottom:6px;flex-wrap:wrap;">
            <span style="font-weight:700;font-size:.85rem;color:${isHote ? '#c4b5fd' : '#00d4ff'};min-width:80px;">
                ${isHote ? '🎮 ' : ''}${_esc(pseudo)}
            </span>
            <span style="flex:1;font-size:.88rem;color:rgba(255,255,255,.85);font-style:italic;word-break:break-word;">"${_esc(rep)}"</span>
            ${badge}
        </div>`;
    }).join('') + (bonneReponse ? `
        <div style="margin-top:10px;padding:8px 12px;border-top:1px solid rgba(255,255,255,.1);
            font-size:.82rem;color:rgba(255,255,255,.5);text-align:center;">
            Réponse correcte : <strong style="color:#00d4ff;">${_esc(bonneReponse)}</strong>
        </div>` : '');
}

// ──────────────────────────────────────────────────────
// EXPORTS
// ──────────────────────────────────────────────────────

export function publierEtat(etat) {
    localStorage.setItem(_cleEtat(), etat);
}

export function publierScores() {
    localStorage.setItem(_cleScores(), JSON.stringify(GameState.scores || {}));
    if (typeof window.afficherScoreboard === 'function') window.afficherScoreboard();
}

export function afficherReponsesInvitesSurHote(containerId = 'invites-reponses') {
    _initWsListeners();
    if (_wsOk()) {
        _afficherPanneauAttenteWS();
    }
    // Pas de fallback localStorage : si pas de WS, pas de jeu multijoueur
}

export function viderReponses() {
    _reponsesRecues = {};
}

export function declencherAfficherReponse() {
    if (_validationEnCours) return;
    _validationEnCours = true;

    const btnEnvoyer  = document.getElementById('btn-valider-reponse');
    const btnAfficher = document.getElementById('btn-afficher-reponse');
    if (btnEnvoyer)  { btnEnvoyer.disabled  = true; btnEnvoyer.style.opacity  = '0.45'; }
    if (btnAfficher) { btnAfficher.disabled = true; btnAfficher.style.opacity = '0.45'; btnAfficher.style.animation = ''; }

    if (_wsOk()) {
        _ws().send('HOST_ACTION', { action: 'quiz:reveal', data: {} });
        console.log('[QUIZ_HOTE] 📡 quiz:reveal → serveur');
    } else {
        console.warn('[QUIZ_HOTE] ⚠️ WS indisponible — révélation impossible');
        _validationEnCours = false;
    }
}

export function envoyerReponseHote(rep) {
    if (!rep || _reponseHoteEnvoyee) return;
    _reponseHoteEnvoyee = true;
    const pseudo = _pseudoHote();

    _initWsListeners();

    if (_wsOk()) {
        _ws().send('PLAYER_ACTION', { action: 'quiz:answer', data: { texte: rep } });
        _reponsesRecues[pseudo] = { reponse: rep, ts: Date.now() };
        _afficherPanneauAttenteWS();
        console.log(`[QUIZ_HOTE] 📨 Réponse hôte: "${rep}"`);
    } else {
        console.warn('[QUIZ_HOTE] ⚠️ WS indisponible — réponse non envoyée');
    }
}

export function lireReponsesInvites() {
    return { ..._reponsesRecues };
}

export function nettoyerPartieInvites() {
    _reponsesRecues     = {};
    _validationEnCours  = false;
    _reponseHoteEnvoyee = false;
    _wsListenersActifs  = false;

    const pid = _pid();
    ['partie_question_minigame_partie_id', 'partie_reponses_', 'partie_validation_', 'partie_scores_',
     'partie_premier_correct_', 'partie_nav_', 'partie_revelation_']
        .forEach(k => localStorage.removeItem(k + pid));
    publierEtat('fin');

    if (_wsOk()) _ws().send('HOST_END_GAME', {});
}

function _esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}