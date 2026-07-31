// /js/modules/petitbac_hote.js — v2.0 (résultats détaillés + bouton ?)
// ============================================================
// Plus aucun accès localStorage. Toutes les données viennent des
// events WS serveur. Ce module gère uniquement le PANNEAU HÔTE
// (suivi des soumissions invités + bouton "Révéler résultats" +
// affichage détaillé statut/points/définition à la révélation).
//
// v2.0 : la révélation porte désormais r.details = { cat:{ val, statut,
// points } }. Le panneau affiche le détail par catégorie avec un
// bouton « ? » (définition Wiktionnaire) sur chaque mot.
// ============================================================

import { GameState }    from '../core/state.js';
import { socket }       from '../core/socket.js';
import HostSession      from '../core/host_session.js';

let _reponsesRecues   = {};   // { pseudo: { ts } }  (live, depuis RESPONSE_IN)
let _resultatsManche  = [];   // [{ pseudo, score, details }] (depuis REVELATION)
let _wsListenersActifs = false;

// Handlers WS stockés pour cleanup (socket.off)
let _hManche      = null;
let _hResponseIn  = null;
let _hRevelation  = null;
let _hCanNext     = null;
let _hError       = null;

// ── Helpers définition / statut ─────────────────────────────
const lienDef = mot =>
    `https://fr.wiktionary.org/w/index.php?search=${encodeURIComponent(String(mot || '').trim())}`;

function _styleStatut(statut) {
    switch (statut) {
        case 'unique':   return { color:'#86efac', icon:'✅', badge:'+2' };
        case 'double':   return { color:'#fde047', icon:'✅', badge:'+1' };
        case 'invalide': return { color:'#fca5a5', icon:'❌', badge:'0' };
        case 'annule':   return { color:'#f87171', icon:'🚫', badge:'annulé' };
        default:         return { color:'rgba(255,255,255,.35)', icon:'—', badge:'' };
    }
}

function _btnDef(mot) {
    if (!mot) return '';
    return `<a href="${lienDef(mot)}" target="_blank" rel="noopener noreferrer"
        title="Définition / vérifier le mot"
        style="flex:none;display:inline-flex;align-items:center;justify-content:center;
        width:18px;height:18px;border-radius:50%;text-decoration:none;
        background:rgba(167,139,250,.18);border:1px solid rgba(167,139,250,.4);
        color:#c4b5fd;font-size:.68rem;font-weight:800;line-height:1;">?</a>`;
}

function _nbJoueursTotal() {
    const snapJoueurs = HostSession?._snapshot?.joueurs;
    return Array.isArray(snapJoueurs) ? snapJoueurs.length : 1;
}

function _pseudoHote() { return GameState?.joueurs?.[0] || 'Hôte'; }

// ────────────────────────────────────────────────────────────
// Listeners WS
// ────────────────────────────────────────────────────────────

function _initWsListeners() {
    if (_wsListenersActifs) return;
    _wsListenersActifs = true;

    _hManche = () => {
        _reponsesRecues  = {};
        _resultatsManche = [];
        _refreshPanneau();
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
        if (allAnswered) _activerBoutonReveler('✅ Tous ont soumis — Révéler');
    };

    _hRevelation = ({ reponses }) => {
        _resultatsManche = Array.isArray(reponses) ? reponses : [];
        _afficherResultatsPanneau();
    };

    _hCanNext = () => {
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
            const sc      = r.score || 0;
            const isHote  = r.pseudo === hote;
            const details = r.details || {};

            // Chips par catégorie non vide.
            const chips = Object.entries(details)
                .filter(([, d]) => d && String(d.val || '').trim())
                .map(([catId, d]) => {
                    const st  = _styleStatut(d.statut);
                    const val = String(d.val || '').trim();
                    const btnInvalider = d.statut !== 'annule'
                        ? `<button class="pb-btn-invalidate" data-pseudo="${_escHtml(r.pseudo)}" data-cat="${_escHtml(catId)}"
                            title="Invalider cette réponse"
                            style="flex:none;display:inline-flex;align-items:center;justify-content:center;
                            width:18px;height:18px;border-radius:50%;border:1px solid rgba(248,113,113,.4);
                            background:rgba(248,113,113,.15);color:#f87171;font-size:.65rem;cursor:pointer;
                            padding:0;line-height:1;">🚫</button>`
                        : '';
                    return `<span style="display:inline-flex;align-items:center;gap:5px;
                        padding:3px 8px;border-radius:8px;font-size:.78rem;
                        background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);
                        color:${st.color};">
                        <span>${st.icon}</span><span style="color:#fff;">${_escHtml(val)}</span>
                        ${st.badge ? `<span style="opacity:.8;">${st.badge}</span>` : ''}
                        ${_btnDef(val)}
                        ${btnInvalider}
                    </span>`;
                }).join('');

            return `<div style="padding:10px 12px;border-radius:10px;margin-bottom:8px;
                background:${sc > 0 ? 'rgba(34,197,94,.1)' : 'rgba(255,255,255,.05)'};
                border:1px solid ${sc > 0 ? 'rgba(34,197,94,.3)' : 'rgba(255,255,255,.12)'};">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:${chips ? '8px' : '0'};">
                    <span style="font-weight:700;font-size:.85rem;color:${isHote ? '#c4b5fd' : '#a78bfa'};min-width:80px;">
                        ${isHote ? '🎮 ' : ''}${_escHtml(r.pseudo)}</span>
                    <span style="flex:1;"></span>
                    <span style="font-weight:800;font-size:.82rem;color:#86efac;">+${sc} pt${sc !== 1 ? 's' : ''}</span>
                </div>
                ${chips ? `<div style="display:flex;flex-wrap:wrap;gap:6px;">${chips}</div>` : ''}
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

    panneau.addEventListener('click', (e) => {
        const btn = e.target.closest('.pb-btn-invalidate');
        if (!btn) return;
        const { pseudo, cat } = btn.dataset;
        if (!pseudo || !cat) return;
        try {
            socket.send('HOST_ACTION', { action: 'petitbac:invalidate', data: { pseudo, catId: cat } });
        } catch (err) {
            console.error('[PB_HOTE] send invalidate:', err.message);
        }
    });

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