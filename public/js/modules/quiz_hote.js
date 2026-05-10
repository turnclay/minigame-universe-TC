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
function _pid() { return localStorage.getItem('minigame_partie_id') || localStorage.getItem('minigame_partie_session_id') || localStorage.getItem('ws_partie_id') || ''; }
function _cleScores() {
    const pid = _pid();
    return pid ? `partie_scores_${pid}` : null;
}
function _cleEtat()   {
    const pid = _pid();
    return pid ? `partie_etat_${pid}` : null;
}

function _pseudoHote() { return (GameState?.joueurs?.[0]) || 'Hôte'; }

// Nombre total de joueurs = invités WS + 1 (hôte)
// _nbJoueursWS = nb d'invités connectés (reçu de QUIZ_RESPONSE_IN)
// On force minimum 1 si pas encore de données WS
function _nbJoueursTotal() {
    return Math.max(_nbJoueursWS, 0) + 1; // +1 pour l'hôte
}

// ──────────────────────────────────────────────────────
// Listeners WS entrants (initialisés une seule fois)
// ──────────────────────────────────────────────────────
function _initWsListeners() {
    if (_wsListenersActifs) return;
    const s = _ws();
    if (!s) return;
    _wsListenersActifs = true;

    s.on('QUIZ_RESPONSE_IN', ({ pseudo, nbReponses, nbJoueurs, allAnswered }) => {
        // Enregistrer la réponse dans le panneau local
        if (!_reponsesRecues[pseudo]) {
            _reponsesRecues[pseudo] = { reponse: '…', ts: Date.now() };
        }
        // Mettre à jour le nb d'invités (hôte exclu côté serveur)
        if (nbJoueurs !== undefined) _nbJoueursWS = nbJoueurs;
        _afficherPanneauAttenteWS();

        // Recalculer allAnswered en incluant l'hôte
        const nbTotalAvecHote = _nbJoueursTotal();
        const nbReponsesAvecHote = Object.keys(_reponsesRecues).length;
        const tousOntRepondu = nbReponsesAvecHote >= nbTotalAvecHote;

        if (tousOntRepondu) {
            _activerBoutonAfficher('✅ Tous ont répondu — Cliquez pour révéler');
        } else {
            _mettreAJourBoutonAfficher(nbReponsesAvecHote, nbTotalAvecHote);
        }
    });

    // Timer écoulé → activer btn-afficher même si pas tout le monde a répondu
    s.on('QUIZ_TIMER_EXPIRED', () => {
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
        // L'UI est déjà mise à jour dans envoyerReponseHote() — pas de doublon
        if (status === 'ok') {
            console.log('[QUIZ_HOTE] ✅ Réponse hôte ACK ok');
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
    const nbAttendu  = _nbJoueursTotal(); // hôte inclus

    if (entries.length === 0) {
        container.innerHTML = `<p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">
            En attente… (0 / ${nbAttendu})
        </p>`;
        return;
    }

    container.innerHTML = entries.map(([p, data]) => {
        const isHote = p === pseudoHote;
        return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;
            background:${isHote ? 'rgba(196,181,253,.07)' : 'rgba(0,212,255,.07)'};
            border:1px solid ${isHote ? 'rgba(196,181,253,.25)' : 'rgba(0,212,255,.2)'};
            border-radius:10px;margin-bottom:6px;">
            <span style="font-weight:700;font-size:.85rem;color:${isHote ? '#c4b5fd' : '#00d4ff'};min-width:90px;white-space:nowrap;">
                ${isHote ? '🎮 ' : '👤 '}${_esc(p)}
            </span>
            <span style="flex:1;font-size:.82rem;color:rgba(255,255,255,.55);font-style:italic;">
                ✅ a répondu
            </span>
        </div>`;
    }).join('')
    + `<div style="text-align:center;margin-top:8px;font-size:.78rem;color:rgba(255,255,255,.35);
        padding-top:8px;border-top:1px solid rgba(255,255,255,.08);">
        ${entries.length} / ${nbAttendu} réponse${entries.length > 1 ? 's' : ''}
        ${entries.length < nbAttendu
            ? `<span style="color:#f59e0b;"> — ${nbAttendu - entries.length} en attente</span>`
            : '<span style="color:#4ade80;"> — Tous ont répondu ✅</span>'}
    </div>`;
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
    const cle = _cleEtat();
    if (cle) localStorage.setItem(cle, etat);
}

export function publierScores() {
    const cle = _cleScores();
    if (cle) localStorage.setItem(cle, JSON.stringify(GameState.scores || {}));
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
    _reponsesRecues      = {};
    _validationEnCours   = false;   // reset pour permettre nouvelle révélation
    _reponseHoteEnvoyee  = false;   // reset pour permettre réponse hôte à chaque question
    // Réinitialiser les boutons hôte pour la nouvelle question
    const btnEnv = document.getElementById('btn-valider-reponse');
    const inp    = document.getElementById('quiz-reponse-input');
    if (btnEnv) {
        btnEnv.disabled      = false;
        btnEnv._sent         = false;
        btnEnv.style.opacity = '';
        btnEnv.textContent   = '✅ Envoyer';
    }
    if (inp) { inp.value = ''; inp.disabled = false; }
    console.log('[QUIZ_HOTE] 🔄 Réponses vidées — hôte peut répondre à nouveau');
}

export function declencherAfficherReponse() {
    if (_validationEnCours) return;
    _validationEnCours = true;

    // Désactiver seulement btn-afficher et btn-valider — PAS btn-next
    // btn-next sera réactivé par QUIZ_CAN_NEXT quand le serveur confirme la révélation
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

        // Ajouter immédiatement la réponse de l'hôte dans le panneau local
        _reponsesRecues[pseudo] = { reponse: rep, ts: Date.now() };
        _afficherPanneauAttenteWS();

        // Désactiver le champ et le bouton hôte
        const btnEnv = document.getElementById('btn-valider-reponse');
        const inp    = document.getElementById('quiz-reponse-input');
        if (btnEnv) { btnEnv.disabled = true; btnEnv.style.opacity = '0.45'; btnEnv.textContent = '✅ Envoyé'; }
        if (inp)    { inp.disabled = true; }

        // Vérifier si tous (hôte inclus) ont maintenant répondu
        const nbTotalAvecHote    = _nbJoueursTotal();
        const nbReponsesAvecHote = Object.keys(_reponsesRecues).length;
        if (nbReponsesAvecHote >= nbTotalAvecHote) {
            _activerBoutonAfficher('✅ Tous ont répondu — Cliquez pour révéler');
        } else {
            _mettreAJourBoutonAfficher(nbReponsesAvecHote, nbTotalAvecHote);
        }

        console.log(`[QUIZ_HOTE] 📨 Réponse hôte: "${rep}" (${nbReponsesAvecHote}/${nbTotalAvecHote})`);
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
    if (pid) {
        ['partie_question_', 'partie_reponses_', 'partie_validation_', 'partie_scores_',
         'partie_premier_correct_', 'partie_nav_', 'partie_revelation_', 'partie_etat_']
            .forEach(k => localStorage.removeItem(k + pid));
    }
    publierEtat('fin');

    if (_wsOk()) _ws().send('HOST_END_GAME', {});
}

function _esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}