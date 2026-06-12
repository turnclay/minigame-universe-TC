// /js/modules/lml_hote.js — v2.0 WS-server-driven (P5.3)
// ============================================================
// Plus aucun accès localStorage. Le panneau hôte est alimenté
// par les events WS LML_RESPONSE_IN / LML_REVELATION / LML_CAN_NEXT.
// Pattern handlers stockés + socket.off (calqué petitbac_hote /
// pendu_hote / quiz_hote).
// ============================================================

import { GameState } from '../core/state.js';
import { socket }    from '../core/socket.js';
import HostSession   from '../core/host_session.js';

let _reponsesLive    = {};   // { pseudo: { status:'fini' } }
let _resultatsRevele = [];   // [{ pseudo, mot, valide, points, estPlusLong }]
let _motMax          = '';
let _wsListenersActifs = false;

let _hManche      = null;
let _hResponseIn  = null;
let _hRevelation  = null;
let _hCanNext     = null;
let _hError       = null;

function _nbJoueursTotal() {
    const j = HostSession?._snapshot?.joueurs;
    return Array.isArray(j) ? j.length : 1;
}
function _pseudoHote() { return GameState?.joueurs?.[0] || 'Hôte'; }

function _initWsListeners() {
    if (_wsListenersActifs) return;
    _wsListenersActifs = true;

    _hManche = () => {
        _reponsesLive    = {};
        _resultatsRevele = [];
        _motMax          = '';
        _refreshLive();
        const btn = document.getElementById('lml-btn-afficher');
        if (btn) {
            btn.disabled       = true;
            btn.style.opacity  = '0.4';
            btn.style.cursor   = 'not-allowed';
            btn.style.animation = '';
            btn.title          = 'En attente des mots…';
        }
    };

    _hResponseIn = ({ pseudo, nbReponses, nbJoueurs, allAnswered }) => {
        if (!pseudo || pseudo === 'null' || pseudo === 'undefined') return;
        _reponsesLive[pseudo] = { status: 'fini', ts: Date.now() };
        _refreshLive({ nbReponses, nbJoueurs });
        if (allAnswered) _activerBoutonReveler('✅ Tous ont soumis — Révéler');
    };

    _hRevelation = ({ reponses, motMax }) => {
        _resultatsRevele = Array.isArray(reponses) ? reponses : [];
        _motMax          = motMax || '';
        _afficherPanneauResultats();
    };

    _hCanNext = () => {
        const btn = document.getElementById('lml-btn-afficher');
        if (btn) {
            btn.disabled       = true;
            btn.style.opacity  = '0.3';
            btn.style.cursor   = 'not-allowed';
            btn.style.animation = '';
            btn.title          = 'Manche révélée — cliquez sur "Nouvelles lettres"';
        }
    };

    _hError = ({ code }) => {
        if (code === 'LML_BAD_STATE') console.warn('[LML_HOTE] ⚠️ LML_BAD_STATE');
    };

    socket.on('LML_MANCHE_START', _hManche);
    socket.on('LML_RESPONSE_IN',  _hResponseIn);
    socket.on('LML_REVELATION',   _hRevelation);
    socket.on('LML_CAN_NEXT',     _hCanNext);
    socket.on('ERROR',            _hError);
}

export function nettoyerPartieInvites() {
    if (!_wsListenersActifs) return;
    socket.off('LML_MANCHE_START', _hManche);
    socket.off('LML_RESPONSE_IN',  _hResponseIn);
    socket.off('LML_REVELATION',   _hRevelation);
    socket.off('LML_CAN_NEXT',     _hCanNext);
    socket.off('ERROR',            _hError);
    _hManche = _hResponseIn = _hRevelation = _hCanNext = _hError = null;
    _wsListenersActifs = false;
    _reponsesLive    = {};
    _resultatsRevele = [];
    _motMax          = '';
}

// ── Panneau ───────────────────────────────────────────────────

function _refreshLive(meta = {}) {
    const container = document.getElementById('lml-invites-reponses');
    if (!container) return;
    const entries   = Object.entries(_reponsesLive);
    const nbAttendu = meta.nbJoueurs || _nbJoueursTotal();
    const nbReps    = meta.nbReponses ?? entries.length;
    const hote      = _pseudoHote();

    if (!entries.length) {
        container.innerHTML = `<p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">
            En attente des mots… (0 / ${nbAttendu})</p>`;
        return;
    }
    container.innerHTML = entries.map(([p]) => {
        const isHote = p === hote;
        return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;
            background:${isHote ? 'rgba(196,181,253,.07)' : 'rgba(167,139,250,.07)'};
            border:1px solid ${isHote ? 'rgba(196,181,253,.25)' : 'rgba(167,139,250,.25)'};
            border-radius:10px;margin-bottom:6px;">
            <span style="font-weight:700;font-size:.85rem;color:${isHote ? '#c4b5fd' : '#a78bfa'};min-width:80px;">
                ${isHote ? '🎮 ' : ''}${_escHtml(p)}</span>
            <span style="flex:1;font-size:.82rem;color:rgba(255,255,255,.35);font-style:italic;">📝 a soumis</span>
        </div>`;
    }).join('') + `<p style="font-size:.78rem;color:rgba(255,255,255,.35);text-align:center;margin-top:6px;">
        ${nbReps} / ${nbAttendu} mots reçus</p>`;
}

function _afficherPanneauResultats() {
    const container = document.getElementById('lml-invites-reponses');
    if (!container) return;
    const hote = _pseudoHote();
    container.innerHTML = _resultatsRevele.map(r => {
        const bg     = r.valide ? 'rgba(34,197,94,.15)'  : 'rgba(239,68,68,.12)';
        const border = r.valide ? 'rgba(34,197,94,.35)'  : 'rgba(239,68,68,.25)';
        const isHote = r.pseudo === hote;
        const badge  = r.valide
            ? `<span style="color:#86efac;font-weight:700;font-size:.82rem;">+${r.points}pt${r.points !== 1 ? 's' : ''} ✅${r.estPlusLong ? ' <span style="font-size:.75rem;color:#a78bfa;">👑+1</span>' : ''}</span>`
            : `<span style="color:#fca5a5;font-size:.82rem;">0pt ❌</span>`;
        const motLen = (r.mot || '').length;
        return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;
            background:${bg};border:1px solid ${border};border-radius:10px;margin-bottom:6px;flex-wrap:wrap;">
            <span style="font-weight:700;font-size:.85rem;color:${isHote ? '#c4b5fd' : '#a78bfa'};min-width:80px;">
                ${isHote ? '🎮 ' : ''}${_escHtml(r.pseudo)}</span>
            <span style="flex:1;font-size:.88rem;color:rgba(255,255,255,.85);font-style:italic;letter-spacing:.05em;">
                "${_escHtml(r.mot || '—')}"</span>
            <span style="font-size:.75rem;color:rgba(255,255,255,.4);">${motLen} lettre${motLen > 1 ? 's' : ''}</span>
            ${badge}
        </div>`;
    }).join('') + (_motMax ? `
        <div style="margin-top:10px;padding:8px 12px;border-top:1px solid rgba(255,255,255,.1);
            font-size:.82rem;color:rgba(255,255,255,.5);text-align:center;">
            💎 Meilleur mot possible : <strong style="color:#a78bfa;">${_escHtml(_motMax)}</strong> (${_motMax.length} lettres)
        </div>` : '');
}

function _activerBoutonReveler(label) {
    const btn = document.getElementById('lml-btn-afficher');
    if (!btn) return;
    btn.disabled       = false;
    btn.style.opacity  = '1';
    btn.style.cursor   = 'pointer';
    btn.title          = label;
    btn.style.animation = 'lmlPulse .5s ease';
    if (!document.getElementById('style-lml-pulse')) {
        const s = document.createElement('style');
        s.id = 'style-lml-pulse';
        s.textContent = '@keyframes lmlPulse{0%{transform:scale(1)}50%{transform:scale(1.06)}100%{transform:scale(1)}}';
        document.head.appendChild(s);
    }
}

// ── API publique ──────────────────────────────────────────────

export function injecterPanneauHote() {
    _initWsListeners();
    if (document.getElementById('panneau-invites-lml')) return;
    const section = document.getElementById('lml');
    if (!section) return;

    const panneau = document.createElement('div');
    panneau.id = 'panneau-invites-lml';
    panneau.style.cssText = `
        margin-top:16px;background:rgba(167,139,250,.06);
        border:1px solid rgba(167,139,250,.25);border-radius:14px;padding:14px 16px;`;
    // On n'injecte QUE le panneau de réponses : le bouton "Révéler" existe déjà
    // statiquement dans .lml-hote-row (#lml-btn-afficher). Injecter un second
    // bouton avec le même id créait un doublon d'id dans le DOM.
    panneau.innerHTML = `
        <div style="font-size:.78rem;text-transform:uppercase;letter-spacing:.1em;
            color:rgba(167,139,250,.8);margin-bottom:10px;font-weight:700;">
            📝 Mots des joueurs
        </div>
        <div id="lml-invites-reponses">
            <p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">
                En attente des mots…
            </p>
        </div>`;
    section.appendChild(panneau);

    // Réutilise le bouton "Révéler" statique (#lml-btn-afficher) pour la
    // révélation. Handler attaché une seule fois.
    const btnReveal = document.getElementById('lml-btn-afficher');
    if (btnReveal && !btnReveal._lmlBound) {
        btnReveal._lmlBound = true;
        btnReveal.onclick = () => {
            try { socket.send('HOST_ACTION', { action: 'lml:reveal', data: {} }); }
            catch (err) { console.error('[LML_HOTE] send reveal:', err.message); }
        };
    }
}

function _escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}