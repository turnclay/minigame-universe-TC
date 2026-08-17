// ============================================================
// /js/modules/mime_player.js — v5.0 (WS, tours auto — sans « Commencer »)
// ============================================================
// Écran invité miroir du participant ACTIF (rendu dans #jeu-contenu).
//   - Si je suis le participant actif → thème + mot + Trouvé / Passer / Finir.
//   - Sinon → thème + « X mime, devine à voix haute ! » + scores.
// Events reçus (relayés par player.js) :
//   MIMEDESSSINE_PHASE { phase, manche, participant, index, nbParticipants,
//                        categorie, scores, scoreManche, motsManche, tsTourEnd }
//   MIMEDESSSINE_MOT_A_DEVINER { mot, categorie }   (participant actif uniquement)
// Actions émises (participant actif) :
//   mimedessine:trouve {} | mimedessine:passer {} | mimedessine:fin_manche {}
// ============================================================

import { getPlayerPseudo } from './player.js';

const $   = id => document.getElementById(id);
const esc = s => String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

let _pseudo = null;
let _socket = null;
let _state  = { phase:'menu', participant:null, index:0, nbParticipants:0,
                categorie:null, scores:{}, scoreManche:{}, motsManche:[], tsTourEnd:null };
let _mot    = null;
let _timerIv = null;

const _estActif = () => _pseudo && _state.participant === _pseudo;

const MimeDessineModule = {
    _session: null,
    _socket : null,

    initPlayer(session, sock, gameState) {
        this._session = session;
        this._socket  = sock;
        _socket = sock;
        _pseudo = session?.pseudo || getPlayerPseudo();
        _state  = { ..._state, ...(gameState || {}) };
        _mot = null;
        _render();
    },

    destroy() {
        _stopTimer();
        const c = $('jeu-contenu'); if (c) c.innerHTML = '';
        _mot = null;
    },

    onScores(scores) { if (scores) { _state.scores = scores; } },

    onWsEvent(type, payload) {
        if (type === 'MIMEDESSSINE_PHASE') {
            _state = { ..._state, ...payload };
            if (payload.phase !== 'tour') _mot = null;
            _render();
            if (payload.phase === 'tour' && payload.tsTourEnd && _estActif()) _startTimer(); else _stopTimer();
        } else if (type === 'MIMEDESSSINE_MOT_A_DEVINER') {
            _mot = payload.mot || null;
            if (_state.phase === 'tour') _render();
        }
    },

    _send(cmd) {
        try { _socket?.send('PLAYER_ACTION', { action: 'mimedessine:' + cmd, data: {} }); }
        catch (e) { console.error('[MIME] send', cmd, e.message); }
    },
};

// ── Rendu (#jeu-contenu) ─────────────────────────────────────
function _render() {
    const c = $('jeu-contenu');
    if (!c) return;
    const actif = _estActif();

    if (_state.phase === 'attente' || _state.phase === 'menu') {
        c.innerHTML = `<div style="text-align:center;padding:1.5rem;display:flex;flex-direction:column;gap:12px;">
            <h2 style="color:var(--mgu-or-600);margin:0;">🎭 Mime</h2>
            <p style="color:var(--mgu-encre-600);">En attente du démarrage de la partie par l'hôte… Prépare-toi, ton tour viendra automatiquement !</p>
        </div>`;
        return;
    }

    if (_state.phase === 'tour') {
        if (actif) {
            c.innerHTML = `<div style="text-align:center;padding:1rem;display:flex;flex-direction:column;gap:14px;max-width:520px;margin:0 auto;">
                <div style="color:var(--mgu-or-600);font-weight:700;">${esc(_state.categorie || '')}</div>
                <div style="background:var(--mgu-carton-50);border:1.5px solid rgba(232,178,59,.4);border-radius:14px;padding:18px;">
                    <h1 style="margin:0;color:var(--mgu-encre-900);">${esc(_mot || '…')}</h1>
                    <p id="mime-timer" style="margin:.4rem 0 0;color:var(--mgu-encre-600);font-size:.85rem;"></p>
                </div>
                <p style="color:var(--mgu-encre-600);font-size:.85rem;">Mime ce mot — les autres devinent à voix haute.</p>
                <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
                    <button id="mime-trouve" class="btn-primary">✅ Trouvé !</button>
                    <button id="mime-passer" class="btn-secondary">➡️ Passer</button>
                    <button id="mime-fin" class="btn-secondary">⏹ Finir ma manche</button>
                </div>
            </div>`;
            $('mime-trouve')?.addEventListener('click', () => MimeDessineModule._send('trouve'));
            $('mime-passer')?.addEventListener('click', () => MimeDessineModule._send('passer'));
            $('mime-fin')?.addEventListener('click', () => MimeDessineModule._send('fin_manche'));
            if (_state.tsTourEnd) _startTimer();
        } else {
            c.innerHTML = `<div style="text-align:center;padding:1.5rem;display:flex;flex-direction:column;gap:12px;">
                <h2 style="color:var(--mgu-or-600);margin:0;">🎭 ${esc(_state.participant || '')} mime !</h2>
                <p style="color:var(--mgu-encre-900);">Thème : <strong>${esc(_state.categorie || '')}</strong></p>
                <p style="color:var(--mgu-encre-600);">Devine le mot à voix haute. 🗣️</p>
                <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;">${_miniScores()}</div>
            </div>`;
        }
        return;
    }

    if (_state.phase === 'fin_manche') {
        const p = _state.participant;
        const sc = (_state.scoreManche || {})[p] || 0;
        const mots = _state.motsManche || [];
        const liste = mots.length
            ? mots.map(m => `<li style="padding:5px 0;border-bottom:1px solid var(--mgu-carton-line);display:flex;justify-content:space-between;gap:8px;">
                <span style="font-weight:700;color:${m.trouve ? '#2f5f42' : 'rgba(255,255,255,.5)'};">${m.trouve ? '✅ ' : '❌ '}${esc(m.mot)}</span>
                <span style="font-size:.72rem;color:var(--mgu-encre-600);">${esc(m.categorie || '')}</span></li>`).join('')
            : '<li style="color:var(--mgu-encre-600);">—</li>';
        c.innerHTML = `<div style="text-align:center;padding:1rem;max-width:520px;margin:0 auto;">
            <h2 style="color:var(--mgu-or-600);">🏁 Manche de ${esc(p || '')} terminée</h2>
            <p style="color:var(--mgu-encre-900);">Score : <strong>${sc}</strong> / ${mots.length}</p>
            <ul style="list-style:none;padding:12px;margin:10px 0;text-align:left;background:rgba(0,0,0,.15);border-radius:12px;max-height:160px;overflow:auto;">${liste}</ul>
            <p style="color:var(--mgu-encre-600);">En attente de l'hôte…</p>
        </div>`;
        return;
    }

    if (_state.phase === 'classement') {
        const scores = _state.scores || {};
        const rows = Object.entries(scores).map(([nom, score]) => ({ nom, score }))
            .sort((a, b) => b.score - a.score);
        const lignes = rows.map((it, i) => {
            const m = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1) + '.';
            return `<div style="display:flex;justify-content:space-between;gap:10px;padding:8px 12px;${i===0?'font-weight:700;color:var(--mgu-or-600);':''}">
                <span>${m} ${esc(it.nom)}</span><span>${it.score} pt${it.score>1?'s':''}</span></div>`;
        }).join('');
        c.innerHTML = `<div style="text-align:center;padding:1rem;max-width:480px;margin:0 auto;">
            <h2 style="color:var(--mgu-or-600);">🏆 Classement final</h2>
            <div style="margin-top:10px;">${lignes}</div>
        </div>`;
        return;
    }

    c.innerHTML = `<div style="text-align:center;padding:1.5rem;color:var(--mgu-encre-600);">🎭 Mime — en attente du lancement…</div>`;
}

function _miniScores() {
    const sc = _state.scoreManche || {};
    return Object.keys(sc).length
        ? Object.entries(sc).map(([p, v]) =>
            `<span style="background:var(--mgu-carton-50);border-radius:20px;padding:4px 12px;font-size:.78rem;color:var(--mgu-encre-600);">${esc(p)} : ${v}</span>`).join('')
        : '';
}

// ── Timer ────────────────────────────────────────────────────
function _startTimer() {
    _stopTimer();
    const upd = () => {
        const el = $('mime-timer');
        if (!el || !_state.tsTourEnd) return;
        const reste = Math.max(0, Math.round((_state.tsTourEnd - Date.now()) / 1000));
        const m = String(Math.floor(reste / 60)).padStart(2, '0');
        const s = String(reste % 60).padStart(2, '0');
        el.textContent = `⏱️ ${m}:${s}`;
        if (reste <= 0) _stopTimer();
    };
    upd();
    _timerIv = setInterval(upd, 500);
}
function _stopTimer() { if (_timerIv) { clearInterval(_timerIv); _timerIv = null; } }

export { MimeDessineModule };