// /js/modules/justeprix_hote.js — v2.0 WS-server-driven (P5.4)
// ============================================================
// Plus aucun accès localStorage. Le panneau hôte est alimenté
// par les events WS. Pattern handlers stockés + socket.off.
// ============================================================

import { GameState } from '../core/state.js';
import { socket }    from '../core/socket.js';
import HostSession   from '../core/host_session.js';

let _reponsesLive    = {};   // { pseudo: { ts } }
let _resultatsRevele = [];   // [{ pseudo, estimation, ecart, points, estPlusProche }]
let _vraiPrix        = '';
let _wsListenersActifs = false;

let _hStart       = null;
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

    _hStart = () => {
        _reponsesLive    = {};
        _resultatsRevele = [];
        _vraiPrix        = '';
        _refreshLive();
        _supprimerBannerPrix();
        const btn = document.getElementById('jp-btn-afficher-prix');
        if (btn) {
            btn.disabled       = true;
            btn.style.opacity  = '0.4';
            btn.style.cursor   = 'not-allowed';
            btn.style.animation = '';
            btn.title          = 'En attente des estimations…';
        }
    };

    _hResponseIn = ({ pseudo, nbReponses, nbJoueurs, allAnswered }) => {
        if (!pseudo || pseudo === 'null' || pseudo === 'undefined') return;
        _reponsesLive[pseudo] = { ts: Date.now() };
        _refreshLive({ nbReponses, nbJoueurs });
        if (allAnswered) _activerBoutonReveler('✅ Tous ont estimé — Révéler');
    };

    _hRevelation = ({ produit, reponses }) => {
        _resultatsRevele = Array.isArray(reponses) ? reponses : [];
        _vraiPrix        = produit?.prix || '';
        _afficherBannerPrix(_vraiPrix);
        _afficherPanneauResultats();
    };

    _hCanNext = () => {
        const btn = document.getElementById('jp-btn-afficher-prix');
        if (btn) {
            btn.disabled       = true;
            btn.style.opacity  = '0.3';
            btn.style.cursor   = 'not-allowed';
            btn.style.animation = '';
            btn.title          = 'Manche révélée — cliquez sur "Produit suivant"';
        }
    };

    _hError = ({ code }) => {
        if (code === 'JUSTEPRIX_BAD_STATE') console.warn('[JP_HOTE] ⚠️ JUSTEPRIX_BAD_STATE');
    };

    socket.on('JUSTEPRIX_PRODUIT_START', _hStart);
    socket.on('JUSTEPRIX_RESPONSE_IN',   _hResponseIn);
    socket.on('JUSTEPRIX_REVELATION',    _hRevelation);
    socket.on('JUSTEPRIX_CAN_NEXT',      _hCanNext);
    socket.on('ERROR',                   _hError);
}

export function nettoyerPartieInvites() {
    if (!_wsListenersActifs) return;
    socket.off('JUSTEPRIX_PRODUIT_START', _hStart);
    socket.off('JUSTEPRIX_RESPONSE_IN',   _hResponseIn);
    socket.off('JUSTEPRIX_REVELATION',    _hRevelation);
    socket.off('JUSTEPRIX_CAN_NEXT',      _hCanNext);
    socket.off('ERROR',                   _hError);
    _hStart = _hResponseIn = _hRevelation = _hCanNext = _hError = null;
    _wsListenersActifs = false;
    _reponsesLive    = {};
    _resultatsRevele = [];
    _vraiPrix        = '';
}

// ── Panneau ───────────────────────────────────────────────────

function _refreshLive(meta = {}) {
    const container = document.getElementById('jp-invites-reponses');
    if (!container) return;
    const entries   = Object.entries(_reponsesLive);
    const nbAttendu = meta.nbJoueurs || _nbJoueursTotal();
    const nbReps    = meta.nbReponses ?? entries.length;
    const hote      = _pseudoHote();

    if (!entries.length) {
        container.innerHTML = `<p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">
            En attente des estimations… (0 / ${nbAttendu})</p>`;
        return;
    }
    container.innerHTML = entries.map(([p]) => {
        const isHote = p === hote;
        return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;
            background:${isHote ? 'rgba(196,181,253,.07)' : 'rgba(251,191,36,.07)'};
            border:1px solid ${isHote ? 'rgba(196,181,253,.25)' : 'rgba(251,191,36,.2)'};
            border-radius:10px;margin-bottom:6px;">
            <span style="font-weight:700;font-size:.85rem;color:${isHote ? '#c4b5fd' : '#fbbf24'};min-width:80px;">
                ${isHote ? '🎮 ' : ''}${_escHtml(p)}</span>
            <span style="flex:1;font-size:.82rem;color:rgba(255,255,255,.35);font-style:italic;">💰 a estimé</span>
        </div>`;
    }).join('') + `<p style="font-size:.78rem;color:rgba(255,255,255,.35);text-align:center;margin-top:6px;">
        ${nbReps} / ${nbAttendu} estimations reçues</p>`;
}

function _afficherPanneauResultats() {
    const container = document.getElementById('jp-invites-reponses');
    if (!container) return;
    const hote = _pseudoHote();
    container.innerHTML = _resultatsRevele.map(r => {
        const correct = (r.points || 0) > 0;
        const bg      = correct ? 'rgba(34,197,94,.15)' : 'rgba(239,68,68,.12)';
        const border  = correct ? 'rgba(34,197,94,.35)' : 'rgba(239,68,68,.25)';
        const isHote  = r.pseudo === hote;
        const ecartTxt = (typeof r.ecart === 'number')
            ? `${(r.ecart * 100).toFixed(1)}% d'écart` : '—';
        const badgePP  = r.estPlusProche ? ' <span style="font-size:.75rem;color:#fbbf24;">🎯+1</span>' : '';
        const badge = correct
            ? `<span style="color:#86efac;font-weight:700;font-size:.82rem;">+${r.points}pt${r.points !== 1 ? 's' : ''} ✅${badgePP}</span>`
            : `<span style="color:#fca5a5;font-size:.82rem;">0pt ❌</span>`;
        return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;
            background:${bg};border:1px solid ${border};border-radius:10px;margin-bottom:6px;flex-wrap:wrap;">
            <span style="font-weight:700;font-size:.85rem;color:${isHote ? '#c4b5fd' : '#00d4ff'};min-width:80px;">
                ${isHote ? '🎮 ' : ''}${_escHtml(r.pseudo)}</span>
            <span style="font-size:.88rem;color:rgba(255,255,255,.85);font-style:italic;">${_escHtml(String(r.estimation))}€</span>
            <span style="flex:1;font-size:.75rem;color:rgba(255,255,255,.4);text-align:right;">${ecartTxt}</span>
            ${badge}
        </div>`;
    }).join('');
}

function _afficherBannerPrix(prix) {
    if (!prix) return;
    let banner = document.getElementById('jp-prix-reel-banner');
    if (!banner) {
        const panneau = document.getElementById('panneau-invites-jp');
        if (!panneau) return;
        banner = document.createElement('div');
        banner.id = 'jp-prix-reel-banner';
        banner.style.cssText = `text-align:center;padding:10px 14px;margin-bottom:12px;
            background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.3);
            border-radius:10px;font-size:.95rem;color:rgba(255,255,255,.7);`;
        panneau.insertAdjacentElement('beforebegin', banner);
    }
    banner.innerHTML = `Prix réel : <strong style="color:#fbbf24;font-size:1.15rem;">${_escHtml(prix)}</strong>`;
}

function _supprimerBannerPrix() {
    document.getElementById('jp-prix-reel-banner')?.remove();
}

function _activerBoutonReveler(label) {
    const btn = document.getElementById('jp-btn-afficher-prix');
    if (!btn) return;
    btn.disabled       = false;
    btn.style.opacity  = '1';
    btn.style.cursor   = 'pointer';
    btn.title          = label;
    btn.style.animation = 'jpPulse .5s ease';
    if (!document.getElementById('style-jp-pulse')) {
        const s = document.createElement('style');
        s.id = 'style-jp-pulse';
        s.textContent = `@keyframes jpPulse{0%{transform:scale(1)}50%{transform:scale(1.06)}100%{transform:scale(1)}}`;
        document.head.appendChild(s);
    }
}

// ── API publique ──────────────────────────────────────────────

export function injecterPanneauHote() {
    _initWsListeners();
    if (document.getElementById('panneau-invites-jp')) return;
    const section = document.getElementById('justeprix');
    if (!section) return;

    const panneau = document.createElement('div');
    panneau.id = 'panneau-invites-jp';
    panneau.style.cssText = `
        margin-top:20px;background:rgba(251,191,36,0.06);
        border:1px solid rgba(251,191,36,0.25);border-radius:14px;padding:14px 16px;`;
    panneau.innerHTML = `
        <div style="font-size:.78rem;text-transform:uppercase;letter-spacing:.1em;
            color:rgba(251,191,36,.8);margin-bottom:10px;font-weight:700;">
            💰 Estimations des joueurs
        </div>
        <div id="jp-invites-reponses">
            <p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">
                Aucune estimation pour l'instant
            </p>
        </div>
        <div style="margin-top:12px;text-align:center;">
            <button id="jp-btn-afficher-prix"
                style="padding:10px 22px;background:rgba(251,191,36,.18);
                border:1.5px solid rgba(251,191,36,.45);border-radius:12px;color:white;
                font-size:.88rem;font-weight:700;cursor:not-allowed;opacity:0.4;
                transition:opacity .2s;font-family:inherit;"
                disabled title="En attente des estimations…">
                💰 Afficher le prix
            </button>
        </div>`;
    section.appendChild(panneau);

    document.getElementById('jp-btn-afficher-prix').onclick = () => {
        try { socket.send('HOST_ACTION', { action: 'justeprix:reveal', data: {} }); }
        catch (err) { console.error('[JP_HOTE] send reveal:', err.message); }
    };
}

function _escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
