// /js/modules/quiz_hote.js — v4.3
// ============================================================
// Architecture hôte LOCAL + invités WS.
// _nbInvites  = nb d'invités réels (depuis serveur, SANS hôte)
// _nbJoueursTotal() = _nbInvites + 1 (hôte inclus)
//
// CORRECTIONS v4.3 :
// [FIX A] _nbInvites réinitialisé à 0 dans nettoyerPartieInvites()
//         ET dans viderReponses() ET sur QUIZ_QUESTION.
//         Avant : _nbInvites gardait la valeur de la partie précédente
//         → le bouton "Afficher" attendait un joueur fantôme.
//
// [FIX B] Accumulation de listeners socket.on() supprimée.
//         Les handlers WS sont désormais stockés et enlevés proprement
//         via socket.off() dans nettoyerPartieInvites().
//         Avant : _wsListenersActifs = false + socket.on() à nouveau
//         créait des doublons de handlers à chaque nouvelle partie.
//
// [FIX C] _nbJoueursTotal() lit le snapshot HostSession de façon
//         défensive : si _snapshot est null (après reset), renvoie 1
//         (hôte seul) au lieu d'une valeur résiduelle.
//
// [FIX D] ERROR handler : réinitialise _validationEnCours si une
//         erreur serveur survient pendant la révélation.
// ============================================================

import { GameState } from '../core/state.js';
import { socket } from '../core/socket.js';
import HostSession from '../core/host_session.js';
import { getPartieId } from '../core/partie_id.js';
import { afficherScoreboard } from './scoreboard.js';

let _validationEnCours   = false;
let _reponseHoteEnvoyee  = false;
let _reponsesRecues      = {};
let _nbInvites           = 0;   // nb d'invités réels (sans l'hôte)
let _wsListenersActifs   = false;
let _quizReponseSaisieHote = ''; // remplace _quizReponseSaisieHote

// Références des handlers WS pour pouvoir les retirer avec socket.off()
// [FIX B] — stockés pour cleanup propre
let _handleQuizQuestion   = null;
let _handleResponseIn     = null;
let _handleTimerExpired   = null;
let _handleCorrection     = null;
let _handleScoresUpdate   = null;
let _handlePlayerJoined   = null;
let _handleQuizIndice     = null;
let _handleError          = null;

function _ws()   { return socket; }
function _wsOk() { const s = _ws(); return !!(s && s.connected); }

function _pid() {
    return getPartieId() || '';
}
function _cleScores() { const p = _pid(); return p ? `partie_scores_${p}` : null; }
function _cleEtat()   { const p = _pid(); return p ? `partie_etat_${p}` : null; }
function _pseudoHote() { return (GameState?.joueurs?.[0]) || 'Hôte'; }

// [FIX C] — défensif : si snapshot null ou vide → 0 invités (hôte seul)
function _nbJoueursTotal() {
    if (_nbInvites > 0) return _nbInvites + 1;
    const snapJoueurs = HostSession?._snapshot?.joueurs;
    const fromSnap    = Array.isArray(snapJoueurs) ? snapJoueurs.length : 0;
    return fromSnap + 1; // +1 pour l'hôte
}

// ────────────────────────────────────────────────────────────
// LISTENERS WS
// [FIX B] — handlers stockés + off() propre dans nettoyerPartieInvites
// ────────────────────────────────────────────────────────────
function _initWsListeners() {
    if (_wsListenersActifs) return;
    const s = _ws();
    if (!s) return;
    _wsListenersActifs = true;

    // Initialiser _nbInvites depuis le snapshot courant (non résiduel)
    // [FIX A] — on ne prend le snapshot QUE si la partie est active (partieId non null)
    const snap = HostSession?._snapshot;
    if (snap?.joueurs?.length > 0 && HostSession?._partieId) {
        _nbInvites = snap.joueurs.length;
    } else {
        _nbInvites = 0; // [FIX A] — hôte seul par défaut
    }

    // ── Définir chaque handler et le stocker pour cleanup ─────

    _handleQuizQuestion = () => {
        _reponsesRecues     = {};
        _validationEnCours  = false;
        _reponseHoteEnvoyee = false;
        _quizReponseSaisieHote = '';

        // [FIX A] Recalculer _nbInvites depuis le snapshot actif
        // (peut avoir changé si un joueur a rejoint/quitté entre deux questions)
        const snapNow = HostSession?._snapshot;
        if (HostSession?._partieId && Array.isArray(snapNow?.joueurs)) {
            // Snapshot joueurs inclut l'hôte si hostJoue:true → soustraire 1
            const total = snapNow.joueurs.length;
            _nbInvites = Math.max(0, total - 1); // -1 pour l'hôte
        } else {
            _nbInvites = 0;
        }

        _afficherPanneauAttenteWS();
    };

    _handleResponseIn = ({ pseudo, nbJoueurs }) => {
        if (!pseudo || pseudo === 'null' || pseudo === 'undefined') return;
        if (!_reponsesRecues[pseudo]) {
            _reponsesRecues[pseudo] = { reponse: '…', ts: Date.now() };
        }
        // nbJoueurs du serveur = total réel (hôte + invités)
        if (typeof nbJoueurs === 'number') {
            _nbInvites = Math.max(0, nbJoueurs - 1);
        }
        _afficherPanneauAttenteWS();
        _recalculerBoutonAfficher();
    };

    _handleTimerExpired = () => {
        _activerBoutonAfficher('⏱ Timer écoulé — Cliquez pour révéler');
    };

    _handleCorrection = ({ reponses, reponse: bonneReponse }) => {
        _validationEnCours = false;
        const repEl = document.getElementById('reponse');
        if (repEl && bonneReponse) repEl.textContent = bonneReponse;

        const pseudoHote = _pseudoHote();
        const resultats  = [...(reponses || [])];

        // Intégrer la réponse de l'hôte si absente des résultats serveur
        if (!resultats.some(r => r.pseudo === pseudoHote)) {
            const texteHote = (_quizReponseSaisieHote || '').trim();
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
        afficherScoreboard();
    };

    _handleScoresUpdate = ({ scores }) => {
        if (!scores) return;
        const pseudoHote     = _pseudoHote();
        const scoreHoteLocal = GameState.scores?.[pseudoHote] ?? 0;
        GameState.scores     = GameState.scores || {};
        Object.assign(GameState.scores, scores);
        // Préférer le score serveur s'il est disponible, sinon garder le local
        if (scores[pseudoHote] === undefined && scoreHoteLocal > 0) {
            GameState.scores[pseudoHote] = scoreHoteLocal;
        }
        const cle = _cleScores();
        if (cle) localStorage.setItem(cle, JSON.stringify(GameState.scores));
        afficherScoreboard();
    };

    _handlePlayerJoined = ({ joueurs }) => {
        // joueurs = liste des invités (sans l'hôte côté serveur)
        _nbInvites = (joueurs || []).length;
    };

    _handleQuizIndice = ({ num, texte }) => {
        const el = document.getElementById(`indice${num}`);
        if (el) el.textContent = texte;
    };

    // [FIX D] Réinitialiser _validationEnCours si erreur serveur pendant révélation
    _handleError = ({ code }) => {
        if (_validationEnCours) {
            console.warn('[QUIZ_HOTE] ⚠️ ERROR reçu pendant validation (' + code + ') — reset');
            _validationEnCours = false;
            const btnAff = document.getElementById('btn-afficher-reponse');
            if (btnAff && btnAff.disabled) {
                btnAff.disabled        = false;
                btnAff.style.opacity   = '1';
                btnAff.style.cursor    = 'pointer';
                btnAff.title           = '⚠️ Erreur serveur — Cliquez pour réessayer';
                btnAff.style.animation = 'btnPulse .5s ease';
            }
        }
    };

    // Enregistrer tous les handlers
    s.on('QUIZ_QUESTION',    _handleQuizQuestion);
    s.on('QUIZ_RESPONSE_IN', _handleResponseIn);
    s.on('QUIZ_TIMER_EXPIRED', _handleTimerExpired);
    s.on('QUIZ_CORRECTION',  _handleCorrection);
    s.on('SCORES_UPDATE',    _handleScoresUpdate);
    s.on('PLAYER_JOINED',    _handlePlayerJoined);
    s.on('QUIZ_INDICE',      _handleQuizIndice);
    s.on('ERROR',            _handleError);
}

// ────────────────────────────────────────────────────────────
// BOUTON AFFICHER
// ────────────────────────────────────────────────────────────

function _recalculerBoutonAfficher() {
    const nbTotal = _nbJoueursTotal();
    const nbRecus = Object.keys(_reponsesRecues).length;
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
    afficherScoreboard();
}

export function afficherReponsesInvitesSurHote() {
    _initWsListeners();
    if (_wsOk()) _afficherPanneauAttenteWS();
}

export function viderReponses() {
    _reponsesRecues      = {};
    _validationEnCours   = false;
    _reponseHoteEnvoyee  = false;
    // [FIX A] Remettre _nbInvites à 0 : sera recalculé sur QUIZ_QUESTION
    // via le snapshot actif. Évite les joueurs fantômes de la partie précédente.
    _nbInvites           = 0;
    _quizReponseSaisieHote = '';

    const btnEnv = document.getElementById('btn-valider-reponse');
    const inp    = document.getElementById('quiz-reponse-input');

    if (btnEnv) {
        btnEnv.disabled      = false;
        btnEnv._sent         = false;
        btnEnv.style.opacity = '';
        btnEnv.textContent   = '✅ Envoyer';
    }
    if (inp) {
        inp.value    = '';
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
        const data    = {};
        const repHote = (_quizReponseSaisieHote || '').trim();
        if (repHote) { data.reponseHote = repHote; data.tsHote = Date.now(); }
        _ws().send('HOST_ACTION', { action: 'quiz:reveal', data });
    } else {
        _validationEnCours = false;
    }
}

/**
 * [FIX 2] Envoie la réponse de l'hôte via HOST_ACTION quiz:host_answer
 * au lieu de PLAYER_ACTION (ws._pseudo est null pour le socket hôte).
 */
export function envoyerReponseHote(rep) {
    if (!rep || _reponseHoteEnvoyee) return;
    _reponseHoteEnvoyee = true;

    const pseudo = _pseudoHote();
    const ts     = Date.now();

    if (_wsOk()) {
        _ws().send('HOST_ACTION', {
            action : 'quiz:host_answer',
            data   : { pseudo, reponse: rep, ts },
        });
        console.log('[QUIZ] 📨 Réponse hôte envoyée (HOST_ACTION quiz:host_answer):', rep, '→', pseudo);
    } else {
        console.warn('[QUIZ] ⚠️ Pas de WebSocket pour envoyer la réponse hôte');
    }

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

/**
 * Nettoyage complet entre deux parties.
 * [FIX A] _nbInvites remis à 0
 * [FIX B] Les handlers WS sont retirés proprement via socket.off()
 *         avant que _wsListenersActifs soit remis à false,
 *         pour éviter l'accumulation de doublons sur la nouvelle partie.
 */
export function nettoyerPartieInvites() {
    // [FIX B] Retirer tous les handlers WS de la partie précédente
    const s = _ws();
    if (s && _wsListenersActifs) {
        if (_handleQuizQuestion)   s.off('QUIZ_QUESTION',     _handleQuizQuestion);
        if (_handleResponseIn)     s.off('QUIZ_RESPONSE_IN',  _handleResponseIn);
        if (_handleTimerExpired)   s.off('QUIZ_TIMER_EXPIRED',_handleTimerExpired);
        if (_handleCorrection)     s.off('QUIZ_CORRECTION',   _handleCorrection);
        if (_handleScoresUpdate)   s.off('SCORES_UPDATE',     _handleScoresUpdate);
        if (_handlePlayerJoined)   s.off('PLAYER_JOINED',     _handlePlayerJoined);
        if (_handleQuizIndice)     s.off('QUIZ_INDICE',       _handleQuizIndice);
        if (_handleError)          s.off('ERROR',             _handleError);
        console.log('[QUIZ_HOTE] ✅ Handlers WS retirés');
    }

    // Réinitialiser toutes les références de handlers
    _handleQuizQuestion  = null;
    _handleResponseIn    = null;
    _handleTimerExpired  = null;
    _handleCorrection    = null;
    _handleScoresUpdate  = null;
    _handlePlayerJoined  = null;
    _handleQuizIndice    = null;
    _handleError         = null;

    _reponsesRecues      = {};
    _validationEnCours   = false;
    _reponseHoteEnvoyee  = false;
    _nbInvites           = 0;       // [FIX A] — CRITIQUE
    _wsListenersActifs   = false;
    _quizReponseSaisieHote = '';

    const pid = _pid();
    if (pid) {
        [
            'partie_question_','partie_reponses_','partie_validation_','partie_scores_',
            'partie_premier_correct_','partie_nav_','partie_revelation_','partie_etat_'
        ].forEach(k => localStorage.removeItem(k + pid));
    }

    publierEtat('fin');

    // Ne pas envoyer HOST_END_GAME ici : c'est la responsabilité de HostSession.terminer()
    // pour éviter les doubles envois.
    console.log('[QUIZ_HOTE] ✅ État nettoyé pour nouvelle partie');
}