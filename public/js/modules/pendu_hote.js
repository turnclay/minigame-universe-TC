// /js/modules/pendu_hote.js — v2.0 WS-server-driven (P5.2)
// ============================================================
// Plus aucun accès localStorage. Les événements WS du module
// jeu (public/js/jeux/pendu.js) ne suffisent pas pour le panneau
// hôte : on enregistre ici nos propres listeners (RESULT_IN,
// REVELATION, CAN_NEXT) pour rafraîchir le panneau de suivi.
//
// Pattern handlers stockés + socket.off — calqué sur petitbac_hote
// et quiz_hote (FIX B).
// ============================================================

import { GameState } from '../core/state.js';
import { socket }    from '../core/socket.js';
import HostSession   from '../core/host_session.js';

let _resultatsLive    = {};   // { pseudo: { victoire?, erreurs?, status:'en_cours'|'fini' } }
let _resultatsRevele  = [];   // [{ pseudo, victoire, erreurs, points }]
let _wsListenersActifs = false;

let _hMotStart   = null;
let _hResultIn   = null;
let _hRevelation = null;
let _hCanNext    = null;
let _hError      = null;

function _nbJoueursTotal() {
    const j = HostSession?._snapshot?.joueurs;
    return Array.isArray(j) ? j.length : 1;
}
function _pseudoHote() { return GameState?.joueurs?.[0] || 'Hôte'; }

function _initWsListeners() {
    if (_wsListenersActifs) return;
    _wsListenersActifs = true;

    _hMotStart = () => {
        _resultatsLive   = {};
        _resultatsRevele = [];
        _refreshPanneauLive();
        const btn = document.getElementById('pendu-btn-resultats');
        if (btn) {
            btn.disabled       = true;
            btn.style.opacity  = '0.4';
            btn.style.cursor   = 'not-allowed';
            btn.style.animation = '';
            btn.title          = 'En attente que tous aient terminé…';
            btn.textContent    = '📊 Afficher les résultats';
        }
    };

    _hResultIn = ({ pseudo, nbResults, nbJoueurs, allDone }) => {
        if (!pseudo || pseudo === 'null' || pseudo === 'undefined') return;
        // On ne connaît pas la victoire/erreurs avant REVELATION, on marque "fini"
        _resultatsLive[pseudo] = { status: 'fini', ts: Date.now() };
        _refreshPanneauLive({ nbResults, nbJoueurs });
        if (allDone) _activerBoutonReveler('✅ Tous ont terminé — Révéler');
    };

    _hRevelation = ({ resultats }) => {
        _resultatsRevele = Array.isArray(resultats) ? resultats : [];
        _afficherPanneauResultats();
    };

    _hCanNext = () => {
        const btn = document.getElementById('pendu-btn-resultats');
        if (btn) {
            btn.disabled       = true;
            btn.style.opacity  = '0.3';
            btn.style.cursor   = 'not-allowed';
            btn.style.animation = '';
            btn.title          = 'Manche révélée — cliquez sur "Nouveau mot"';
        }
    };

    _hError = ({ code }) => {
        if (code === 'PENDU_BAD_STATE') console.warn('[PENDU_HOTE] ⚠️ PENDU_BAD_STATE');
    };

    socket.on('PENDU_MOT_START',  _hMotStart);
    socket.on('PENDU_RESULT_IN',  _hResultIn);
    socket.on('PENDU_REVELATION', _hRevelation);
    socket.on('PENDU_CAN_NEXT',   _hCanNext);
    socket.on('ERROR',            _hError);
}

export function nettoyerPartieInvites() {
    if (!_wsListenersActifs) return;
    socket.off('PENDU_MOT_START',  _hMotStart);
    socket.off('PENDU_RESULT_IN',  _hResultIn);
    socket.off('PENDU_REVELATION', _hRevelation);
    socket.off('PENDU_CAN_NEXT',   _hCanNext);
    socket.off('ERROR',            _hError);
    _hMotStart = _hResultIn = _hRevelation = _hCanNext = _hError = null;
    _wsListenersActifs = false;
    _resultatsLive   = {};
    _resultatsRevele = [];
}

// ── Panneau ────────────────────────────────────────────────────

function _refreshPanneauLive(meta = {}) {
    const container = document.getElementById('pendu-invites-reponses');
    if (!container) return;
    const entries    = Object.entries(_resultatsLive);
    const nbAttendu  = meta.nbJoueurs || _nbJoueursTotal();
    const nbResults  = meta.nbResults ?? entries.length;
    const hote       = _pseudoHote();

    if (!entries.length) {
        container.innerHTML = `<p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">
            En attente des résultats… (0 / ${nbAttendu})</p>`;
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
            <span style="flex:1;font-size:.82rem;color:rgba(255,255,255,.55);">✅ Terminé</span>
        </div>`;
    }).join('') + `<p style="font-size:.78rem;color:rgba(255,255,255,.35);text-align:center;margin-top:6px;">
        ${nbResults} / ${nbAttendu} joueurs</p>`;
}

function _afficherPanneauResultats() {
    const container = document.getElementById('pendu-invites-reponses');
    if (!container) return;
    const hote = _pseudoHote();
    container.innerHTML = _resultatsRevele.map(r => {
        const isHote = r.pseudo === hote;
        const bg     = r.victoire ? 'rgba(34,197,94,.15)' : 'rgba(239,68,68,.12)';
        const bd     = r.victoire ? 'rgba(34,197,94,.35)' : 'rgba(239,68,68,.25)';
        const badge  = r.victoire
            ? `<span style="color:#86efac;font-weight:700;font-size:.82rem;">+${r.points}pt${r.points !== 1 ? 's' : ''} ✅</span>`
            : `<span style="color:#fca5a5;font-size:.82rem;">0pt ❌ (${r.erreurs} erreur${r.erreurs !== 1 ? 's' : ''})</span>`;
        return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;
            background:${bg};border:1px solid ${bd};border-radius:10px;margin-bottom:6px;flex-wrap:wrap;">
            <span style="font-weight:700;font-size:.85rem;color:${isHote ? '#c4b5fd' : '#a78bfa'};min-width:80px;">
                ${isHote ? '🎮 ' : ''}${_escHtml(r.pseudo)}</span>
            <span style="flex:1;font-size:.82rem;color:rgba(255,255,255,.6);">
                ${r.victoire ? '🎉 Trouvé' : '😢 Pas trouvé'} — ${r.erreurs} erreur${r.erreurs !== 1 ? 's' : ''}</span>
            ${badge}
        </div>`;
    }).join('');
}

function _activerBoutonReveler(label) {
    const btn = document.getElementById('pendu-btn-resultats');
    if (!btn) return;
    btn.disabled       = false;
    btn.style.opacity  = '1';
    btn.style.cursor   = 'pointer';
    btn.title          = label;
    btn.style.animation = 'lmlPulse .5s ease';
}

// ── API publique ────────────────────────────────────────────

export function injecterPanneauHote() {
    _initWsListeners();

    // Style pulse (utilisé par _activerBoutonReveler)
    if (!document.getElementById('style-pendu-pulse')) {
        const s = document.createElement('style');
        s.id = 'style-pendu-pulse';
        s.textContent = '@keyframes lmlPulse{0%{transform:scale(1)}50%{transform:scale(1.06)}100%{transform:scale(1)}}';
        document.head.appendChild(s);
    }

    const section = document.getElementById('pendu');
    if (!section) return;

    // Le panneau peut déjà exister statiquement dans index.html
    // (#panneau-invites-pendu, sans bouton). On le réutilise, sinon on le crée.
    let panneau = document.getElementById('panneau-invites-pendu');
    if (!panneau) {
        panneau = document.createElement('div');
        panneau.id = 'panneau-invites-pendu';
        panneau.style.cssText = `
            margin-top:16px;background:rgba(167,139,250,.06);
            border:1px solid rgba(167,139,250,.25);border-radius:14px;padding:14px 16px;`;
        panneau.innerHTML = `
            <div style="font-size:.78rem;text-transform:uppercase;letter-spacing:.1em;
                color:rgba(167,139,250,.8);margin-bottom:10px;font-weight:700;">
                🎮 Résultats des joueurs
            </div>
            <div id="pendu-invites-reponses">
                <p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">
                    En attente des résultats…
                </p>
            </div>`;
        section.appendChild(panneau);
    }

    // S'assurer que le conteneur de réponses existe.
    if (!document.getElementById('pendu-invites-reponses')) {
        const div = document.createElement('div');
        div.id = 'pendu-invites-reponses';
        panneau.appendChild(div);
    }

    // CORRECTIF CRITIQUE : garantir la présence du bouton "Afficher les
    // résultats". Le panneau statique d'index.html ne le contient pas, et
    // l'ancien `return` anticipé empêchait sa création → l'hôte ne pouvait
    // jamais révéler et la manche restait bloquée. On le crée s'il manque.
    if (!document.getElementById('pendu-btn-resultats')) {
        const wrapBtn = document.createElement('div');
        wrapBtn.style.cssText = 'margin-top:12px;text-align:center;';
        const btn = document.createElement('button');
        btn.id = 'pendu-btn-resultats';
        btn.style.cssText = [
            'padding:10px 22px;background:rgba(167,139,250,.18);',
            'border:1.5px solid rgba(167,139,250,.45);border-radius:12px;color:white;',
            'font-size:.88rem;font-weight:700;cursor:not-allowed;opacity:0.4;',
            'transition:opacity .2s;font-family:inherit;'
        ].join('');
        btn.disabled    = true;
        btn.title       = 'En attente que tous aient terminé…';
        btn.textContent = '📊 Afficher les résultats';
        wrapBtn.appendChild(btn);
        panneau.appendChild(wrapBtn);
    }

    // Câblage de la révélation (une seule fois).
    const btnRes = document.getElementById('pendu-btn-resultats');
    if (btnRes && !btnRes._penduBound) {
        btnRes._penduBound = true;
        btnRes.onclick = () => {
            try { socket.send('HOST_ACTION', { action: 'pendu:reveal', data: {} }); }
            catch (err) { console.error('[PENDU_HOTE] send reveal:', err.message); }
        };
    }
}

function _escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}