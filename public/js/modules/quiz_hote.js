// /js/modules/quiz_hote.js — v4.0 FINAL
// ============================================================
// Architecture : hôte répond EN LOCAL (même page).
// Pas de PLAYER_ACTION WS pour l'hôte.
// Le serveur gère les invités ; quiz_hote.js gère l'hôte.
// ============================================================

import { GameState } from '../core/state.js';

// ── État interne ────────────────────────────────────────────
let _validationEnCours   = false;
let _reponseHoteEnvoyee  = false;
let _reponsesRecues      = {};   // { pseudo: { reponse, ts, correct? } }
let _nbInvites           = 0;   // nb d'invités (depuis serveur, sans l'hôte)
let _wsListenersActifs   = false;

// ── Accès socket ─────────────────────────────────────────────
function _ws()   { return window.jeuSocket || null; }
function _wsOk() { const s = _ws(); return !!(s && s.connected); }

// ── localStorage ─────────────────────────────────────────────
function _pid() {
    return localStorage.getItem('minigame_partie_id')
        || localStorage.getItem('minigame_partie_session_id')
        || localStorage.getItem('ws_partie_id')
        || '';
}
function _cleScores() { const p = _pid(); return p ? `partie_scores_${p}` : null; }
function _cleEtat()   { const p = _pid(); return p ? `partie_etat_${p}` : null; }

// ── Pseudo hôte ───────────────────────────────────────────────
function _pseudoHote() { return (GameState?.joueurs?.[0]) || 'Hôte'; }

// ── Nombre total de joueurs (invités + hôte) ──────────────────
function _nbJoueursTotal() {
    const invites = _nbInvites > 0
        ? _nbInvites
        : (window.HostSession?._snapshot?.joueurs?.length ?? 0);
    return invites + 1; // +1 pour l'hôte
}

// ────────────────────────────────────────────────────────────
// LISTENERS WS (initialisés une seule fois)
// ────────────────────────────────────────────────────────────
function _initWsListeners() {
    if (_wsListenersActifs) return;
    const s = _ws();
    if (!s) return;
    _wsListenersActifs = true;

    // Initialiser depuis le snapshot existant
    const snap = window.HostSession?._snapshot;
    if (snap?.joueurs?.length > 0) _nbInvites = snap.joueurs.length;

    // Reset complet à chaque nouvelle question
    s.on('QUIZ_QUESTION', () => {
        _reponsesRecues      = {};
        _validationEnCours   = false;
        _reponseHoteEnvoyee  = false;
        window._quizReponseSaisieHote = '';
        _afficherPanneauAttenteWS();
    });

    // Réponse d'un invité reçue
    s.on('QUIZ_RESPONSE_IN', ({ pseudo, nbJoueurs }) => {
        if (!pseudo || pseudo === 'null' || pseudo === 'undefined') return;
        if (!_reponsesRecues[pseudo]) {
            _reponsesRecues[pseudo] = { reponse: '…', ts: Date.now() };
        }
        // nbJoueurs = nombre d'invités seulement (côté serveur)
        if (typeof nbJoueurs === 'number') _nbInvites = nbJoueurs;
        _afficherPanneauAttenteWS();
        _recalculerEtatBoutonAfficher();
    });

    // Timer expiré → hôte peut révéler même sans toutes les réponses
    s.on('QUIZ_TIMER_EXPIRED', () => {
        _activerBoutonAfficher('⏱ Timer écoulé — Cliquez pour révéler');
    });

    // Résultats du serveur (invités)
    s.on('QUIZ_CORRECTION', ({ reponses, reponse: bonneReponse }) => {
        _validationEnCours = false;
        const repEl = document.getElementById('reponse');
        if (repEl && bonneReponse) repEl.textContent = bonneReponse;

        // Construire la liste complète : invités (serveur) + hôte (local)
        const pseudoHote = _pseudoHote();
        const resultats  = [...(reponses || [])];

        // Ajouter l'hôte si absent des résultats serveur
        const hoteInclus = resultats.some(r => r.pseudo === pseudoHote);
        if (!hoteInclus) {
            const texteHote = (window._quizReponseSaisieHote || '').trim();
            const correct   = texteHote && bonneReponse
                ? _similariteLocale(texteHote, bonneReponse)
                : false;
            // Est-il le premier correct parmi tous ?
            const nbCorrectsInvites   = resultats.filter(r => r.correct).length;
            const estPremier          = correct && nbCorrectsInvites === 0;
            const points              = correct ? (estPremier ? 2 : 1) : 0;

            // Insérer l'hôte en tête
            resultats.unshift({ pseudo: pseudoHote, texte: texteHote, correct, points, estPremier });

            // Mettre à jour le score local de l'hôte
            if (points > 0) {
                GameState.scores = GameState.scores || {};
                GameState.scores[pseudoHote] = (GameState.scores[pseudoHote] || 0) + points;
            }
        }

        _afficherPanneauResultats(resultats, bonneReponse || '');
        if (typeof window.afficherScoreboard === 'function') window.afficherScoreboard();
    });

    // Scores mis à jour par le serveur (invités)
    s.on('SCORES_UPDATE', ({ scores }) => {
        if (!scores) return;
        // Fusionner : garder le score hôte local, prendre les scores invités du serveur
        const pseudoHote = _pseudoHote();
        GameState.scores = GameState.scores || {};
        const scoreHoteLocal = GameState.scores[pseudoHote] ?? 0;
        Object.assign(GameState.scores, scores);
        // Restaurer le score hôte local (le serveur ne le connaît pas)
        GameState.scores[pseudoHote] = scoreHoteLocal;
        const cle = _cleScores();
        if (cle) localStorage.setItem(cle, JSON.stringify(GameState.scores));
        if (typeof window.afficherScoreboard === 'function') window.afficherScoreboard();
    });

    s.on('PLAYER_JOINED', ({ joueurs }) => {
        _nbInvites = (joueurs || []).length;
    });

    s.on('QUIZ_INDICE', ({ num, texte }) => {
        const el = document.getElementById(`indice${num}`);
        if (el) el.textContent = texte;
    });
}

// ────────────────────────────────────────────────────────────
// GESTION DU BOUTON AFFICHER
// ────────────────────────────────────────────────────────────
function _recalculerEtatBoutonAfficher() {
    const nbTotal  = _nbJoueursTotal();
    const nbRecus  = Object.keys(_reponsesRecues).length;
    if (nbRecus >= nbTotal) {
        _activerBoutonAfficher('✅ Tous ont répondu — Cliquez pour révéler');
    } else {
        _mettreAJourBoutonAfficher(nbRecus, nbTotal);
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

function _mettreAJourBoutonAfficher(nbRecus, nbAttendu) {
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
                : '<span style="color:#fca5a5;font-size:.82rem;">0pt ❌</span>';
            return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;
                background:${bg};border:1px solid ${border};border-radius:10px;margin-bottom:6px;flex-wrap:wrap;">
                <span style="font-weight:700;font-size:.85rem;color:${isHote ? '#c4b5fd' : '#00d4ff'};min-width:80px;">
                    ${isHote ? '🎮 ' : ''}${_esc(pseudo)}
                </span>
                <span style="flex:1;font-size:.88rem;color:rgba(255,255,255,.85);font-style:italic;word-break:break-word;">"${_esc(rep)}"</span>
                ${badge}
            </div>`;
        }).join('')
        + (bonneReponse ? `<div style="margin-top:10px;padding:8px 12px;border-top:1px solid rgba(255,255,255,.1);
            font-size:.82rem;color:rgba(255,255,255,.5);text-align:center;">
            Réponse correcte : <strong style="color:#00d4ff;">${_esc(bonneReponse)}</strong>
        </div>` : '');
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

// ────────────────────────────────────────────────────────────
// ESCAPE HTML
// ────────────────────────────────────────────────────────────
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
    if (btnEnv) { btnEnv.disabled = false; btnEnv._sent = false; btnEnv.style.opacity = ''; btnEnv.textContent = '✅ Envoyer'; }
    if (inp)    { inp.value = ''; inp.disabled = false; }
}

export function declencherAfficherReponse() {
    if (_validationEnCours) return;
    _validationEnCours = true;

    const btnEnvoyer  = document.getElementById('btn-valider-reponse');
    const btnAfficher = document.getElementById('btn-afficher-reponse');
    if (btnEnvoyer)  { btnEnvoyer.disabled  = true; btnEnvoyer.style.opacity  = '0.45'; }
    if (btnAfficher) { btnAfficher.disabled = true; btnAfficher.style.opacity = '0.45'; btnAfficher.style.animation = ''; }

    if (_wsOk()) {
        // Envoyer la réponse de l'hôte avec la révélation
        const data = {};
        const repHote = (window._quizReponseSaisieHote || '').trim();
        if (repHote) { data.reponseHote = repHote; data.tsHote = Date.now(); }
        _ws().send('HOST_ACTION', { action: 'quiz:reveal', data });
    } else {
        _validationEnCours = false;
    }
}

export function envoyerReponseHote(rep) {
    if (!rep || _reponseHoteEnvoyee) return;
    _reponseHoteEnvoyee = true;

    const pseudo = _pseudoHote();
    _reponsesRecues[pseudo] = { reponse: rep, ts: Date.now() };
    _afficherPanneauAttenteWS();

    const btnEnv = document.getElementById('btn-valider-reponse');
    const inp    = document.getElementById('quiz-reponse-input');
    if (btnEnv) { btnEnv.disabled = true; btnEnv.style.opacity = '0.45'; btnEnv.textContent = '✅ Envoyé'; btnEnv._sent = true; }
    if (inp)    { inp.disabled = true; }

    _recalculerEtatBoutonAfficher();
}

export function lireReponsesInvites() {
    return { ..._reponsesRecues };
}

export function nettoyerPartieInvites() {
    _reponsesRecues     = {};
    _validationEnCours  = false;
    _reponseHoteEnvoyee = false;
    _wsListenersActifs  = false;
    window._quizReponseSaisieHote = '';

    const pid = _pid();
    if (pid) {
        ['partie_question_','partie_reponses_','partie_validation_','partie_scores_',
         'partie_premier_correct_','partie_nav_','partie_revelation_','partie_etat_']
            .forEach(k => localStorage.removeItem(k + pid));
    }
    publierEtat('fin');
    if (_wsOk()) _ws().send('HOST_END_GAME', {});
}