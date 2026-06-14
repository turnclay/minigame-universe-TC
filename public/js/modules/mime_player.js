// ============================================================
// /js/modules/mime_player.js — v2.0 (WS, conforme — rend dans #jeu-contenu)
// ============================================================
// Module invité Mime/Dessine. Rendu dans #jeu-contenu (conteneur invité
// standard de la plateforme) — auparavant #game-container (inexistant) →
// rien ne s'affichait.
//
// Contrat serveur (server/games/mimedessine.js) :
//   Events reçus : MIMEDESSSINE_DEFI, MIMEDESSSINE_PHASE,
//     MIMEDESSSINE_MOT_A_DEVINER (dessinateur), MIMEDESSSINE_DRAWING_DATA
//     (devineurs), MIMEDESSSINE_GUESS_ACK.
//   Actions émises : mimedessine:drawing_update { data }, mimedessine:guess { guess }.
//
// Enregistré dans JeuRegistry par player.js
//   (import { MimeDessineModule } + JeuRegistry.register('mimedessine', …)).
// ============================================================

import { getPlayerPseudo } from './player.js';

const $   = id => document.getElementById(id);
const esc = s => String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

let _state    = null;   // dernier état serveur (config, phase, manche, drawerPseudo, motADeviner, dessinData…)
let _pseudo   = null;
let _socket   = null;
let _canvas   = null;
let _ctx      = null;
let _drawing  = false;
let _lastX    = 0;
let _lastY    = 0;

const MimeDessineModule = {
    _session: null,
    _socket : null,

    initPlayer(session, sock, gameState, snapshot) {
        this._session = session;
        this._socket  = sock;
        _socket       = sock;
        _pseudo       = session?.pseudo || getPlayerPseudo();
        _state        = gameState || { phase: 'menu', manche: 0 };
        _render();
    },

    destroy() {
        _detacherCanvas();
        const cont = $('jeu-contenu');
        if (cont) cont.innerHTML = '';
        _state = null; _canvas = null; _ctx = null; _drawing = false;
    },

    onScores() { /* scoreboard géré par player.js (SCORES_UPDATE) */ },

    onWsEvent(type, payload) {
        switch (type) {
            case 'MIMEDESSSINE_DEFI':
            case 'MIMEDESSSINE_PHASE':
                _state = { ..._state, ...payload };
                _render();
                break;

            case 'MIMEDESSSINE_MOT_A_DEVINER':
                if (_pseudo === _state?.drawerPseudo) {
                    _state = { ..._state, motADeviner: payload.mot };
                    _render();
                }
                break;

            case 'MIMEDESSSINE_DRAWING_DATA':
                if (_pseudo !== _state?.drawerPseudo && _state?.phase === 'dessin') {
                    _dessinerRecu(payload.data);
                }
                break;

            case 'MIMEDESSSINE_GUESS_ACK':
                _feedbackGuess(payload.status);
                break;
        }
    },

    _send(action, data) {
        try { _socket?.send('PLAYER_ACTION', { action, data }); }
        catch (e) { console.error('[MIME] send', action, e.message); }
    },
};

// ── Rendu principal dans #jeu-contenu ────────────────────────
function _render() {
    const cont = $('jeu-contenu');
    if (!cont || !_state) return;

    const isDrawer = (_pseudo === _state.drawerPseudo);
    const phase    = _state.phase;
    const manche   = _state.manche ?? 0;

    let html = `<div class="mime-wrap" style="padding:1rem 0;display:flex;flex-direction:column;gap:14px;">
        <h2 style="text-align:center;color:#c4b5fd;margin:0;">🎭 Mime/Dessine — Manche ${manche}</h2>`;

    if (phase === 'menu' || phase === 'choix_mot') {
        if (isDrawer) {
            html += `<p style="text-align:center;color:#fff;">Tu es le <strong>dessinateur</strong>. Attends que l'hôte lance le dessin.</p>`;
            if (_state.motADeviner) {
                html += `<p style="text-align:center;">Mot à dessiner : <strong>${esc(_state.motADeviner)}</strong></p>`;
            }
        } else {
            html += `<p style="text-align:center;color:rgba(255,255,255,.75);">Préparation… ${esc(_state.drawerPseudo || 'Quelqu\u2019un')} va dessiner.</p>`;
        }

    } else if (phase === 'dessin') {
        if (isDrawer) {
            html += `<p style="text-align:center;">Dessine : <strong>${esc(_state.motADeviner || '…')}</strong></p>
                <div style="display:flex;flex-direction:column;gap:8px;align-items:center;">
                    <canvas id="mime-canvas" width="600" height="400" style="max-width:100%;background:#fff;border-radius:10px;border:1px solid rgba(0,0,0,.2);touch-action:none;"></canvas>
                    <button id="mime-clear" class="btn-secondary">🗑️ Effacer</button>
                </div>`;
        } else {
            html += `<p style="text-align:center;color:rgba(255,255,255,.75);"><strong>${esc(_state.drawerPseudo || '')}</strong> dessine…</p>
                <div style="display:flex;justify-content:center;">
                    <canvas id="mime-canvas" width="600" height="400" style="max-width:100%;background:#fff;border-radius:10px;pointer-events:none;"></canvas>
                </div>
                <div style="display:flex;gap:8px;justify-content:center;">
                    <input id="mime-guess" type="text" placeholder="Ton hypothèse…" maxlength="40"
                        style="flex:1;max-width:280px;padding:10px;border-radius:10px;border:1.5px solid rgba(167,139,250,.4);background:rgba(255,255,255,.06);color:#fff;font-family:inherit;">
                    <button id="mime-send" class="btn-primary">Deviner</button>
                </div>
                <p id="mime-feedback" style="text-align:center;font-size:.85rem;min-height:1.2em;"></p>`;
        }

    } else if (phase === 'reponse') {
        html += `<p style="text-align:center;">Le mot était : <strong>${esc(_state.motADeviner || '')}</strong></p>
            <div style="display:flex;justify-content:center;">
                <canvas id="mime-canvas" width="600" height="400" style="max-width:100%;background:#fff;border-radius:10px;pointer-events:none;"></canvas>
            </div>
            <p style="text-align:center;color:rgba(255,255,255,.6);">Scores mis à jour. En attente de la suite…</p>`;

    } else if (phase === 'resultats') {
        html += `<p style="text-align:center;color:#fff;">🏁 Fin de la manche. En attente du prochain tour…</p>`;
    }

    html += `</div>`;
    cont.innerHTML = html;

    _setupCanvas(isDrawer, phase);

    const clear = $('mime-clear');
    if (clear) clear.onclick = _effacer;

    const send = $('mime-send');
    if (send) send.onclick = _soumettreGuess;
    const guess = $('mime-guess');
    if (guess) guess.addEventListener('keydown', e => { if (e.key === 'Enter') _soumettreGuess(); });
}

// ── Canvas ───────────────────────────────────────────────────
function _setupCanvas(isDrawer, phase) {
    _detacherCanvas();
    _canvas = $('mime-canvas');
    if (!_canvas) return;
    _ctx = _canvas.getContext('2d');
    _ctx.lineWidth   = 3;
    _ctx.lineCap     = 'round';
    _ctx.strokeStyle = '#111';

    // Restaurer un dessin existant (rejoin / changement de phase)
    if (_state?.dessinData && (typeof _state.dessinData === 'string')) {
        _dessinerRecu(_state.dessinData);
    }

    if (isDrawer && phase === 'dessin') {
        _canvas.addEventListener('mousedown', _start);
        _canvas.addEventListener('mousemove', _move);
        _canvas.addEventListener('mouseup',   _stop);
        _canvas.addEventListener('mouseout',  _stop);
        _canvas.addEventListener('touchstart', _touchStart, { passive: false });
        _canvas.addEventListener('touchmove',  _touchMove,  { passive: false });
        _canvas.addEventListener('touchend',   _stop);
    }
}

function _detacherCanvas() {
    if (!_canvas) return;
    _canvas.removeEventListener('mousedown', _start);
    _canvas.removeEventListener('mousemove', _move);
    _canvas.removeEventListener('mouseup',   _stop);
    _canvas.removeEventListener('mouseout',  _stop);
    _canvas.removeEventListener('touchstart', _touchStart);
    _canvas.removeEventListener('touchmove',  _touchMove);
    _canvas.removeEventListener('touchend',   _stop);
}

function _coord(e) {
    const r = _canvas.getBoundingClientRect();
    const sx = _canvas.width / r.width, sy = _canvas.height / r.height;
    const src = e.touches ? e.touches[0] : e;
    return [(src.clientX - r.left) * sx, (src.clientY - r.top) * sy];
}

function _start(e) { _drawing = true; [_lastX, _lastY] = _coord(e); }
function _touchStart(e) { e.preventDefault(); _start(e); }

function _move(e) {
    if (!_drawing || !_ctx) return;
    const [x, y] = _coord(e);
    _ctx.beginPath();
    _ctx.moveTo(_lastX, _lastY);
    _ctx.lineTo(x, y);
    _ctx.stroke();
    [_lastX, _lastY] = [x, y];
    MimeDessineModule._send('mimedessine:drawing_update', { data: _canvas.toDataURL('image/png') });
}
function _touchMove(e) { e.preventDefault(); _move(e); }

function _stop() { _drawing = false; }

function _effacer() {
    if (!_ctx || !_canvas) return;
    _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
    MimeDessineModule._send('mimedessine:drawing_update', { data: [] });
}

function _dessinerRecu(data) {
    if (!_ctx || !_canvas) return;
    if (Array.isArray(data) && data.length === 0) {
        _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
        return;
    }
    if (typeof data !== 'string') return;
    const img = new Image();
    img.onload = () => {
        _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
        _ctx.drawImage(img, 0, 0, _canvas.width, _canvas.height);
    };
    img.src = data;
}

// ── Devinette ────────────────────────────────────────────────
function _soumettreGuess() {
    const inp = $('mime-guess');
    if (!inp) return;
    const v = inp.value.trim();
    if (!v) return;
    MimeDessineModule._send('mimedessine:guess', { guess: v });
    inp.value = '';
}

function _feedbackGuess(status) {
    const fb = $('mime-feedback');
    if (!fb) return;
    if (status === 'correct')        { fb.textContent = '✅ Correct !';        fb.style.color = '#86efac'; }
    else if (status === 'incorrect') { fb.textContent = '❌ Essaie encore.';   fb.style.color = '#fca5a5'; }
    else if (status === 'already')   { fb.textContent = 'Déjà trouvé ✅';      fb.style.color = '#86efac'; }
    else if (status === 'too_late')  { fb.textContent = 'Trop tard.';          fb.style.color = 'rgba(255,255,255,.6)'; }
}

export { MimeDessineModule };