// /js/modules/quiz_hote.js — v4.2
// ============================================================
// Architecture hôte LOCAL + invités WS.
// _nbInvites  = nb d'invités réels (depuis serveur, SANS hôte)
// _nbJoueursTotal() = _nbInvites + 1 (hôte inclus)
// Le serveur envoie nbJoueurs = invités + hôte (total réel).
//
// [FIX 2] envoyerReponseHote() utilise HOST_ACTION quiz:host_answer
// au lieu de PLAYER_ACTION. En effet le socket hôte a ws._isHost=true
// et ws._pseudo=null : toute PLAYER_ACTION serait indexée sous "null"
// côté serveur. HOST_ACTION lit hostPseudo depuis la partie en store.
// ============================================================

import { GameState } from '../core/state.js';

let _validationEnCours   = false;
let _reponseHoteEnvoyee  = false;
let _reponsesRecues      = {};
let _nbInvites           = 0;   // nb d'invités réels (sans l'hôte)
let _wsListenersActifs   = false;

function _ws()   { return window.jeuSocket || null; }
function _wsOk() { const s = _ws(); return !!(s && s.connected); }

function _pid() {
    return localStorage.getItem('minigame_partie_id')
        || localStorage.getItem('minigame_partie_session_id')
        || localStorage.getItem('ws_partie_id')
        || '';
}
function _cleScores() { const p = _pid(); return p ? `partie_scores_${p}` : null; }
function _cleEtat()   { const p = _pid(); return p ? `partie_etat_${p}` : null; }
function _pseudoHote() { return (GameState?.joueurs?.[0]) || 'Hôte'; }

// Nombre total = invités + hôte
function _nbJoueursTotal() {
    const inv = _nbInvites > 0
        ? _nbInvites
        : (window.HostSession?._snapshot?.joueurs?.length ?? 0);
    return inv + 1; // +1 pour l'hôte
}

// ────────────────────────────────────────────────────────────
// LISTENERS WS
// ────────────────────────────────────────────────────────────
function _initWsListeners() {
    if (_wsListenersActifs) return;
    const s = _ws();
    if (!s) return;
    _wsListenersActifs = true;

    // Initialiser depuis le snapshot
    const snap = window.HostSession?._snapshot;
    if (snap?.joueurs?.length > 0) _nbInvites = snap.joueurs.length;

    s.on('QUIZ_QUESTION', () => {
        _reponsesRecues      = {};
        _validationEnCours   = false;
        _reponseHoteEnvoyee  = false;
        window._quizReponseSaisieHote = '';
        _afficherPanneauAttenteWS();
    });

    s.on('QUIZ_RESPONSE_IN', ({ pseudo, nbJoueurs }) => {
        if (!pseudo || pseudo === 'null' || pseudo === 'undefined') return;
        if (!_reponsesRecues[pseudo]) {
            _reponsesRecues[pseudo] = { reponse: '…', ts: Date.now() };
        }
        // nbJoueurs du serveur = total (invités + hôte)
        if (typeof nbJoueurs === 'number') _nbInvites = Math.max(0, nbJoueurs - 1);
        _afficherPanneauAttenteWS();
        _recalculerBoutonAfficher();
    });

    s.on('QUIZ_TIMER_EXPIRED', () => {
        _activerBoutonAfficher('⏱ Timer écoulé — Cliquez pour révéler');
    });

    s.on('QUIZ_CORRECTION', ({ reponses, reponse: bonneReponse }) => {
        _validationEnCours = false;
        const repEl = document.getElementById('reponse');
        if (repEl && bonneReponse) repEl.textContent = bonneReponse;

        const pseudoHote = _pseudoHote();
        const resultats  = [...(reponses || [])];

        // Intégrer la réponse de l'hôte si absente des résultats serveur
        // (cas où le serveur ne l'a pas reçue via HOST_ACTION quiz:host_answer)
        if (!resultats.some(r => r.pseudo === pseudoHote)) {
            const texteHote = (window._quizReponseSaisieHote || '').trim();
            const correct   = texteHote && bonneReponse
                ? _similariteLocale(texteHote, bonneReponse)
                : false;
            const nbCorrectsInvites = resultats.filter(r => r.correct).length;
            const estPremier        = correct && nbCorrectsInvites === 0;
            const points            = correct ? (estPremier ? 2 : 1) : 0;

            resultats.unshift({ pseudo: pseudoHote, texte: texteHote, correct, points, estPremier });

            if (points > 0) {
                GameState.scores = GameState.scores || {};
                GameState.scores[pseudoHote] = (GameState.scores[pseudoHote] || 0) + points;
                const cle = _cleScores();
                if (cle) localStorage.setItem(cle, JSON.stringify(GameState.scores));
            }
        }

        _afficherPanneauResultats(resultats, bonneReponse || '');
        if (typeof window.afficherScoreboard === 'function') window.afficherScoreboard();
    });

    s.on('SCORES_UPDATE', ({ scores }) => {
        if (!scores) return;
        const pseudoHote     = _pseudoHote();
        const scoreHoteLocal = GameState.scores?.[pseudoHote] ?? 0;
        GameState.scores     = GameState.scores || {};
        Object.assign(GameState.scores, scores);
        // Restaurer le score hôte si le serveur l'a déjà — préférer le serveur
        if (scores[pseudoHote] !== undefined) {
            GameState.scores[pseudoHote] = scores[pseudoHote];
        } else if (scoreHoteLocal > 0) {
            GameState.scores[pseudoHote] = scoreHoteLocal;
        }
        const cle = _cleScores();
        if (cle) localStorage.setItem(cle, JSON.stringify(GameState.scores));
        if (typeof window.afficherScoreboard === 'function') window.afficherScoreboard();
    });

    s.on('PLAYER_JOINED', ({ joueurs }) => {
        _nbInvites = (joueurs || []).length; // invités seulement
    });

    s.on('QUIZ_INDICE', ({ num, texte }) => {
        const el = document.getElementById(`indice${num}`);
        if (el) el.textContent = texte;
    });
}

// ────────────────────────────────────────────────────────────
// BOUTON AFFICHER
// ────────────────────────────────────────────────────────────

function _recalculerBoutonAfficher() {
    const nbTotal  = _nbJoueursTotal();
    const nbRecus  = Object.keys(_reponsesRecues).length;
    if (nbRecus >= nbTotal) {
        _activerBoutonAfficher('✅ Tous ont répondu — Cliquez pour révéler');
    } else {
        _desactiverBoutonAfficher(nbRecus, nbTotal);
    }
}

function _activerBoutonAfficher(titre) {
    const btn = document.getElementById('btn-afficher-reponse');
    if (!btn) return;
    btn.disabled        = false;
    btn.style.opacity   = '1';
    btn.style.cursor    = 'pointer';
    btn.title           = titre || 'Révéler la réponse';
    btn.style.animation = 'btnPulse .5s ease';
    if (!document.getElementById('style-btn-pulse')) {
        const s = document.createElement('style');
        s.id = 'style-btn-pulse';
        s.textContent = '@keyframes btnPulse{0%{transform:scale(1)}50%{transform:scale(1.06)}100%{transform:scale(1)}}';
        document.head.appendChild(s);
    }
}

function _desactiverBoutonAfficher(nbRecus, nbAttendu) {
    const btn = document.getElementById('btn-afficher-reponse');
    if (!btn) return;
    const reste = Math.max(0, nbAttendu - nbRecus);
    btn.disabled        = true;
    btn.style.opacity   = '0.4';
    btn.style.cursor    = 'not-allowed';
    btn.title           = reste > 0
        ? `En attente de ${reste} joueur${reste > 1 ? 's' : ''}…`
        : 'En attente…';
    btn.style.animation = '';
}

// ────────────────────────────────────────────────────────────
// PANNEAU ATTENTE
// ────────────────────────────────────────────────────────────
function _afficherPanneauAttenteWS() {
    const container = document.getElementById('invites-reponses');
    if (!container) return;

    const pseudoHote = _pseudoHote();
    const entries    = Object.entries(_reponsesRecues)
        .filter(([p]) => p && p !== 'null' && p !== 'undefined');
    const nbAttendu  = _nbJoueursTotal();

    if (entries.length === 0) {
        container.innerHTML = `<p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">
            En attente… (0 / ${nbAttendu})</p>`;
        return;
    }

    container.innerHTML =
        entries.map(([p]) => {
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

// ────────────────────────────────────────────────────────────
// PANNEAU RÉSULTATS
// ────────────────────────────────────────────────────────────
function _afficherPanneauResultats(resultats, bonneReponse) {
    const container = document.getElementById('invites-reponses');
    if (!container) return;

    if (!resultats || resultats.length === 0) {
        container.innerHTML = '<p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">Aucune réponse reçue</p>';
        return;
    }

    const pseudoHote = _pseudoHote();
    container.innerHTML =
        resultats.map(({ pseudo, texte, reponse, correct, points, estPremier }) => {
            const rep    = texte || reponse || '';
            const bg     = correct ? 'rgba(34,197,94,.15)' : 'rgba(239,68,68,.12)';
            const border = correct ? 'rgba(34,197,94,.35)' : 'rgba(239,68,68,.25)';
            const isHote = pseudo === pseudoHote;
            const prem   = estPremier ? ' <span style="font-size:.75rem;color:#fbbf24;">🏆+1</span>' : '';
            const badge  = correct
                ? `<span style="color:#86efac;font-weight:700;font-size:.82rem;">+${points}pt${points !== 1 ? 's' : ''} ✅${prem}</span>`
                : `<span style="color:#fca5a5;font-size:.82rem;">${rep ? '0pt ❌' : 'Sans réponse'}</span>`;
            return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;
                background:${bg};border:1px solid ${border};border-radius:10px;margin-bottom:6px;flex-wrap:wrap;">
                <span style="font-weight:700;font-size:.85rem;color:${isHote ? '#c4b5fd' : '#00d4ff'};min-width:80px;">
                    ${isHote ? '🎮 ' : ''}${_esc(pseudo)}
                </span>
                <span style="flex:1;font-size:.88rem;color:rgba(255,255,255,.85);font-style:italic;word-break:break-word;">"${_esc(rep)}"</span>
                ${badge}
            </div>`;
        }).join('')
        + (bonneReponse
            ? `<div style="margin-top:10px;padding:8px 12px;border-top:1px solid rgba(255,255,255,.1);
                font-size:.82rem;color:rgba(255,255,255,.5);text-align:center;">
                Réponse correcte : <strong style="color:#00d4ff;">${_esc(bonneReponse)}</strong>
            </div>`
            : '');
}

// ────────────────────────────────────────────────────────────
// SIMILARITÉ LOCALE
// ────────────────────────────────────────────────────────────
function _similariteLocale(a, b) {
    if (!a || !b) return false;
    const norm = s => String(s).toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9 ]/g, '').replace(/ +/g, ' ').trim();
    const na = norm(a), nb = norm(b);
    if (na === nb) return true;
    if (nb.includes(na) || na.includes(nb)) return true;
    const bg = s => { const set = new Set(); for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2)); return set; };
    const ba = bg(na), bb = bg(nb);
    if (!ba.size || !bb.size) return false;
    let inter = 0; ba.forEach(g => { if (bb.has(g)) inter++; });
    return (2 * inter) / (ba.size + bb.size) >= 0.85;
}

function _esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s || '');
    return d.innerHTML;
}

// ────────────────────────────────────────────────────────────
// EXPORTS
// ────────────────────────────────────────────────────────────

export function publierEtat(etat) {
    const cle = _cleEtat();
    if (cle) localStorage.setItem(cle, etat);
}

export function publierScores() {
    const cle = _cleScores();
    if (cle) localStorage.setItem(cle, JSON.stringify(GameState.scores || {}));
    if (typeof window.afficherScoreboard === 'function') window.afficherScoreboard();
}

export function afficherReponsesInvitesSurHote() {
    _initWsListeners();
    if (_wsOk()) _afficherPanneauAttenteWS();
}

export function viderReponses() {
    _reponsesRecues      = {};
    _validationEnCours   = false;
    _reponseHoteEnvoyee  = false;
    window._quizReponseSaisieHote = '';

    const btnEnv = document.getElementById('btn-valider-reponse');
    const inp    = document.getElementById('quiz-reponse-input');

    if (btnEnv) {
        btnEnv.disabled = false;
        btnEnv._sent = false;
        btnEnv.style.opacity = '';
        btnEnv.textContent = '✅ Envoyer';
    }
    if (inp) {
        inp.value = '';
        inp.disabled = false;
    }
}

export function declencherAfficherReponse() {
    if (_validationEnCours) return;
    _validationEnCours = true;

    const btnEnvoyer  = document.getElementById('btn-valider-reponse');
    const btnAfficher = document.getElementById('btn-afficher-reponse');

    if (btnEnvoyer)  { btnEnvoyer.disabled  = true; btnEnvoyer.style.opacity  = '0.45'; }
    if (btnAfficher) { btnAfficher.disabled = true; btnAfficher.style.opacity = '0.45'; btnAfficher.style.animation = ''; }

    if (_wsOk()) {
        const data = {};
        const repHote = (window._quizReponseSaisieHote || '').trim();

        if (repHote) {
            data.reponseHote = repHote;
            data.tsHote = Date.now();
        }

        _ws().send('HOST_ACTION', { action: 'quiz:reveal', data });
    } else {
        _validationEnCours = false;
    }
}

// ════════════════════════════════════════════════════════════
// [FIX 2] envoyerReponseHote — utilise HOST_ACTION quiz:host_answer
// ════════════════════════════════════════════════════════════
// POURQUOI : le socket hôte est authentifié avec ws._isHost = true
// et ws._pseudo = null. Toute PLAYER_ACTION reçue côté serveur
// passerait pseudo = ws._pseudo = null → score crédité à "null".
//
// SOLUTION : on envoie HOST_ACTION avec action:"quiz:host_answer"
// et on inclut explicitement le pseudo dans data.pseudo.
// Le serveur (server/games/quiz.js handleHostAction) lit
// data.pseudo ou partie.hostPseudo — jamais ws._pseudo.
// ════════════════════════════════════════════════════════════
export function envoyerReponseHote(rep) {
    if (!rep || _reponseHoteEnvoyee) return;
    _reponseHoteEnvoyee = true;

    const pseudo = _pseudoHote();
    const ts     = Date.now();

    // [FIX 2] — HOST_ACTION au lieu de PLAYER_ACTION
    if (_wsOk()) {
        _ws().send('HOST_ACTION', {
            action : 'quiz:host_answer',
            data   : {
                pseudo,       // explicitement transmis — le serveur le lit depuis data
                reponse : rep,
                ts,
            },
        });
        console.log('[QUIZ] 📨 Réponse hôte envoyée (HOST_ACTION quiz:host_answer):', rep, '→', pseudo);
    } else {
        console.warn('[QUIZ] ⚠️ Pas de WebSocket pour envoyer la réponse hôte');
    }

    // Mise à jour locale (UI) — reflète immédiatement dans le panneau
    _reponsesRecues[pseudo] = { reponse: rep, ts };

    const btnEnv = document.getElementById('btn-valider-reponse');
    const inp    = document.getElementById('quiz-reponse-input');

    if (btnEnv) {
        btnEnv.disabled      = true;
        btnEnv.style.opacity = '0.45';
        btnEnv.textContent   = '✅ Envoyé';
        btnEnv._sent         = true;
    }
    if (inp) inp.disabled = true;

    _recalculerBoutonAfficher();
}

export function lireReponsesInvites() {
    return { ..._reponsesRecues };
}

export function nettoyerPartieInvites() {
    _reponsesRecues      = {};
    _validationEnCours   = false;
    _reponseHoteEnvoyee  = false;
    _wsListenersActifs   = false;
    window._quizReponseSaisieHote = '';

    const pid = _pid();
    if (pid) {
        [
            'partie_question_','partie_reponses_','partie_validation_','partie_scores_',
            'partie_premier_correct_','partie_nav_','partie_revelation_','partie_etat_'
        ].forEach(k => localStorage.removeItem(k + pid));
    }

    publierEtat('fin');

    if (_wsOk()) _ws().send('HOST_END_GAME', {});
}