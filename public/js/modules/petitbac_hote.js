// /js/modules/petitbac_hote.js — v2.0 WS-server-driven (P5.1)
// ============================================================
// Plus aucun accès localStorage. Toutes les données viennent des
// events WS serveur. Ce module gère uniquement le PANNEAU HÔTE
// (suivi des soumissions invités + bouton "Révéler résultats").
//
// Données en mémoire mises à jour par les events WS du module
// jeu (public/js/jeux/petitbac.js) :
//   - _reponsesRecues : { pseudo: { score? } }     ← PETITBAC_RESPONSE_IN
//   - _resultatsManche : [{ pseudo, reponses, score }] ← PETITBAC_REVELATION
//
// Pattern handlers stockés + socket.off pour cleanup propre,
// comme quiz_hote.js (FIX B).
// ============================================================

import { GameState }    from '../core/state.js';
import { socket }       from '../core/socket.js';
import HostSession      from '../core/host_session.js';

let _reponsesRecues   = {};   // { pseudo: { score } }  (live, depuis RESPONSE_IN)
let _resultatsManche  = [];   // [{ pseudo, reponses, score }] (depuis REVELATION)
let _wsListenersActifs = false;

// Handlers WS stockés pour cleanup (socket.off)
let _hManche      = null;
let _hResponseIn  = null;
let _hRevelation  = null;
let _hCanNext     = null;
let _hError       = null;

function _nbJoueursTotal() {
    const snapJoueurs = HostSession?._snapshot?.joueurs;
    return Array.isArray(snapJoueurs) ? snapJoueurs.length : 1;
}

function _pseudoHote() { return GameState?.joueurs?.[0] || 'Hôte'; }

// ────────────────────────────────────────────────────────────
// Listeners WS — branchés une seule fois par session quiz.
// ────────────────────────────────────────────────────────────

function _initWsListeners() {
    if (_wsListenersActifs) return;
    _wsListenersActifs = true;

    _hManche = () => {
        _reponsesRecues  = {};
        _resultatsManche = [];
        _refreshPanneau();
        // Réinitialiser le bouton "Révéler"
        const btn = document.getElementById('pb-btn-resultats');
        if (btn) {
            btn.disabled       = true;
            btn.style.opacity  = '0.4';
            btn.style.cursor   = 'not-allowed';
            btn.title          = 'En attente des soumissions…';
            btn.style.animation = '';
            btn.textContent    = '📊 Afficher les résultats';
        }
    };

    _hResponseIn = ({ pseudo, nbReponses, nbJoueurs, allAnswered }) => {
        if (!pseudo || pseudo === 'null' || pseudo === 'undefined') return;
        if (!_reponsesRecues[pseudo]) _reponsesRecues[pseudo] = { ts: Date.now() };
        _refreshPanneau({ nbReponses, nbJoueurs });
        // Si tous ont soumis, activer le bouton "Révéler"
        if (allAnswered) _activerBoutonReveler('✅ Tous ont soumis — Révéler');
    };

    _hRevelation = ({ reponses }) => {
        _resultatsManche = Array.isArray(reponses) ? reponses : [];
        _afficherResultatsPanneau();
    };

    _hCanNext = () => {
        // Désactiver "Révéler" après révélation faite
        const btn = document.getElementById('pb-btn-resultats');
        if (btn) {
            btn.disabled       = true;
            btn.style.opacity  = '0.3';
            btn.style.cursor   = 'not-allowed';
            btn.style.animation = '';
            btn.title          = 'Manche révélée — cliquez sur "Nouvelle manche"';
        }
    };

    _hError = ({ code }) => {
        if (code === 'PETITBAC_BAD_STATE') {
            console.warn('[PB_HOTE] ⚠️ PETITBAC_BAD_STATE — réinit panneau');
        }
    };

    socket.on('PETITBAC_MANCHE_START',  _hManche);
    socket.on('PETITBAC_RESPONSE_IN',   _hResponseIn);
    socket.on('PETITBAC_REVELATION',    _hRevelation);
    socket.on('PETITBAC_CAN_NEXT',      _hCanNext);
    socket.on('ERROR',                  _hError);
}

export function nettoyerPartieInvites() {
    if (!_wsListenersActifs) return;
    socket.off('PETITBAC_MANCHE_START',  _hManche);
    socket.off('PETITBAC_RESPONSE_IN',   _hResponseIn);
    socket.off('PETITBAC_REVELATION',    _hRevelation);
    socket.off('PETITBAC_CAN_NEXT',      _hCanNext);
    socket.off('ERROR',                  _hError);
    _hManche = _hResponseIn = _hRevelation = _hCanNext = _hError = null;
    _wsListenersActifs = false;
    _reponsesRecues  = {};
    _resultatsManche = [];
}

// ────────────────────────────────────────────────────────────
// Affichage panneau
// ────────────────────────────────────────────────────────────

function _refreshPanneau(meta = {}) {
    const container = document.getElementById('pb-invites-reponses');
    if (!container) return;

    const entries     = Object.entries(_reponsesRecues);
    const nbAttendu   = meta.nbJoueurs || _nbJoueursTotal();
    const nbReponses  = meta.nbReponses ?? entries.length;
    const pseudoHote  = _pseudoHote();

    if (entries.length === 0) {
        container.innerHTML = `<p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">
            En attente des réponses… (0 / ${nbAttendu})</p>`;
        return;
    }

    container.innerHTML = entries.map(([p]) => {
        const isHote = p === pseudoHote;
        return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;
            background:${isHote ? 'rgba(196,181,253,.07)' : 'rgba(167,139,250,.07)'};
            border:1px solid ${isHote ? 'rgba(196,181,253,.25)' : 'rgba(167,139,250,.25)'};
            border-radius:10px;margin-bottom:6px;">
            <span style="font-weight:700;font-size:.85rem;color:${isHote ? '#c4b5fd' : '#a78bfa'};min-width:80px;">
                ${isHote ? '🎮 ' : ''}${_escHtml(p)}</span>
            <span style="flex:1;font-size:.82rem;color:rgba(255,255,255,.55);">⏳ Soumis</span>
        </div>`;
    }).join('') + `<p style="font-size:.78rem;color:rgba(255,255,255,.35);text-align:center;margin-top:6px;">
        ${nbReponses} / ${nbAttendu} joueurs ont soumis</p>`;
}

function _afficherResultatsPanneau() {
    const container = document.getElementById('pb-invites-reponses');
    if (!container) return;
    const hote = _pseudoHote();
    container.innerHTML = _resultatsManche
        .slice().sort((a, b) => (b.score || 0) - (a.score || 0))
        .map(r => {
            const sc     = r.score || 0;
            const isHote = r.pseudo === hote;
            const bg     = sc > 0 ? 'rgba(34,197,94,.15)' : 'rgba(255,255,255,.06)';
            const bd     = sc > 0 ? 'rgba(34,197,94,.35)' : 'rgba(255,255,255,.12)';
            return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;
                background:${bg};border:1px solid ${bd};border-radius:10px;margin-bottom:6px;flex-wrap:wrap;">
                <span style="font-weight:700;font-size:.85rem;color:${isHote ? '#c4b5fd' : '#a78bfa'};min-width:80px;">
                    ${isHote ? '🎮 ' : ''}${_escHtml(r.pseudo)}</span>
                <span style="flex:1;font-size:.82rem;color:rgba(255,255,255,.6);">
                    ${sc} bonne${sc !== 1 ? 's' : ''} réponse${sc !== 1 ? 's' : ''}</span>
                <span style="font-weight:700;font-size:.82rem;color:#86efac;">
                    +${sc} pt${sc !== 1 ? 's' : ''} ✅</span>
            </div>`;
        }).join('');
}

function _activerBoutonReveler(label) {
    const btn = document.getElementById('pb-btn-resultats');
    if (!btn) return;
    btn.disabled       = false;
    btn.style.opacity  = '1';
    btn.style.cursor   = 'pointer';
    btn.title          = label;
    btn.style.animation = 'btnPulse .6s ease infinite alternate';
}

// ────────────────────────────────────────────────────────────
// API publique appelée par jeux/petitbac.js
// ────────────────────────────────────────────────────────────

export function injecterPanneauHote() {
    _initWsListeners();
    if (document.getElementById('panneau-invites-pb')) return;
    const section = document.getElementById('petitbac');
    if (!section) return;

    const panneau = document.createElement('div');
    panneau.id = 'panneau-invites-pb';
    panneau.style.cssText = `
        margin-top:18px;background:rgba(139,92,246,.06);
        border:1px solid rgba(139,92,246,.25);border-radius:14px;padding:14px 16px;`;
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
        </div>`;
    section.appendChild(panneau);

    document.getElementById('pb-btn-resultats').onclick = () => {
        try { socket.send('HOST_ACTION', { action: 'petitbac:reveal', data: {} }); }
        catch (err) { console.error('[PB_HOTE] send reveal:', err.message); }
    };

    if (!document.getElementById('style-pb-btn-pulse')) {
        const s = document.createElement('style');
        s.id = 'style-pb-btn-pulse';
        s.textContent = '@keyframes btnPulse{0%{transform:scale(1)}100%{transform:scale(1.05)}}';
        document.head.appendChild(s);
    }
}

// Vide le panneau (appelé par jeux/petitbac.js sur MANCHE_START)
export function viderPanneau() {
    _reponsesRecues  = {};
    _resultatsManche = [];
    _refreshPanneau();
}

// Affiche le panneau (live ou résultats selon ce qui est disponible)
export function afficherReponsesInvitesSurHote(_containerId, reponsesDepuisServeur) {
    if (Array.isArray(reponsesDepuisServeur) && reponsesDepuisServeur.length) {
        _resultatsManche = reponsesDepuisServeur;
        _afficherResultatsPanneau();
    } else {
        _refreshPanneau();
    }
}

function _escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
