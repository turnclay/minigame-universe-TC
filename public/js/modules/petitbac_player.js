// ============================================================
// /js/modules/petitbac_player.js — v1.0 (P5.1)
// ============================================================
// Module invité Petit Bac. Auto-enregistré dans JeuRegistry de
// player.js. Reçoit les events WS, affiche l'UI dans #jeu-contenu,
// soumet les réponses du joueur via PLAYER_ACTION.
//
// Interface JeuRegistry (cf player.js) :
//   initPlayer(session, socket, gameState, snapshot)
//   destroy()
//   onWsEvent(eventName, payload)   ← relais générique fourni
//   onScores(scores)                ← relais SCORES_UPDATE
// ============================================================

import { JeuRegistry } from './player.js';

const $   = id => document.getElementById(id);
const esc = s => String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const PetitbacModule = {
    _session       : null,
    _socket        : null,
    _lettre        : null,
    _categories    : [],
    _tsDebut       : 0,
    _dureeMs       : 120_000,
    _timerInterval : null,
    _aSoumis       : false,
    _scores        : {},

    initPlayer(session, sock, gameState, snapshot) {
        this._session = session;
        this._socket  = sock;
        this._aSoumis = false;
        this._scores  = (snapshot?.scores) || {};

        this._afficherEcranAttente();

        // Re-hydrater depuis gameState si partie déjà en cours (rejoin)
        if (gameState) {
            if (gameState.phase === 'jeu' && gameState.lettre) {
                this._onMancheStart({
                    lettre     : gameState.lettre,
                    categories : gameState.categories,
                    tsDebut    : gameState.tsDebut,
                    dureeMs    : gameState.dureeMs,
                    manche     : gameState.manche,
                });
            } else if (gameState.phase === 'resultats') {
                this._onRevelation({
                    lettre     : gameState.lettre,
                    categories : gameState.categories,
                    reponses   : gameState.reponses,
                    scores     : gameState.scores,
                    manche     : gameState.manche,
                });
            }
        }
    },

    destroy() { this._arreterTimer(); },

    // Relais générique depuis player.js (events QUIZ_* historiques).
    // On gère ici les events PETITBAC_* explicitement.
    onWsEvent(evt, payload) {
        switch (evt) {
            case 'PETITBAC_MANCHE_START':  this._onMancheStart(payload);  break;
            case 'PETITBAC_REVELATION':    this._onRevelation(payload);   break;
            case 'PETITBAC_ANSWER_ACK':    this._onAnswerAck(payload);    break;
            case 'PETITBAC_TIMER_EXPIRED': this._onTimerExpired(payload); break;
        }
    },

    onScores(scores) {
        if (scores) Object.assign(this._scores, scores);
        const pseudo = this._session?.pseudo;
        if (pseudo) {
            const el = $('p-mes-points');
            const pts = this._scores[pseudo] ?? 0;
            if (el) el.textContent = pts + ' pt' + (pts > 1 ? 's' : '');
        }
    },

    // ─────────────────────────────────────────────────────
    // Handlers events serveur
    // ─────────────────────────────────────────────────────

    _onMancheStart(payload) {
        this._arreterTimer();
        this._lettre     = payload.lettre || '';
        this._categories = Array.isArray(payload.categories) ? payload.categories : [];
        this._tsDebut    = payload.tsDebut || Date.now();
        this._dureeMs    = payload.dureeMs || 120_000;
        this._aSoumis    = false;
        if (payload.scores) Object.assign(this._scores, payload.scores);
        this._afficherJeu(payload.manche || 1);
        this._demarrerTimer();
    },

    _onRevelation(payload) {
        this._arreterTimer();
        this._afficherResultats(payload);
        if (payload.scores) Object.assign(this._scores, payload.scores);
        this.onScores(this._scores);
    },

    _onAnswerAck({ status }) {
        if (status === 'ok') {
            this._aSoumis = true;
            this._arreterTimer();
            this._afficherAttenteRevelation();
        } else if (status === 'already') {
            this._afficherToast('Réponses déjà soumises', 'warning');
        } else if (status === 'too_late') {
            this._afficherToast('Trop tard !', 'warning');
        } else {
            this._afficherToast('Soumission invalide', 'error');
        }
    },

    _onTimerExpired() {
        if (!this._aSoumis) {
            this._afficherToast('⏱ Temps écoulé — soumission auto', 'warning');
            this._soumettre(true);
        }
    },

    // ─────────────────────────────────────────────────────
    // UI
    // ─────────────────────────────────────────────────────

    _afficherEcranAttente() {
        const cont = $('jeu-contenu');
        if (!cont) return;
        cont.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;
                justify-content:center;min-height:50vh;gap:1.25rem;
                text-align:center;padding:2rem;">
                <div style="font-size:2.5rem;">📝</div>
                <h2 style="margin:0;font-size:1.1rem;">Petit Bac</h2>
                <p style="color:rgba(255,255,255,.5);margin:0;">
                    En attente du lancement…
                </p>
            </div>`;
    },

    _afficherJeu(manche) {
        const cont = $('jeu-contenu');
        if (!cont) return;
        const cats = this._categories.map(c => `
            <div style="background:rgba(139,92,246,.06);border:1px solid rgba(139,92,246,.22);
                border-radius:10px;padding:10px 12px;">
                <label style="display:flex;align-items:center;gap:6px;font-size:.8rem;
                    color:rgba(196,181,253,.9);font-weight:700;margin-bottom:6px;">
                    <span>${c.icon}</span><span>${esc(c.label)}</span>
                </label>
                <input id="pbp-input-${esc(c.id)}" data-cat="${esc(c.id)}" type="text"
                    maxlength="30" autocomplete="off" placeholder="…"
                    style="width:100%;box-sizing:border-box;padding:.55rem .75rem;
                    background:rgba(255,255,255,.07);
                    border:1.5px solid rgba(255,255,255,.18);border-radius:8px;
                    color:white;font-size:.95rem;font-family:inherit;outline:none;">
            </div>`).join('');

        cont.innerHTML = `
            <div style="padding:1rem 0;display:flex;flex-direction:column;gap:.85rem;">
                <div style="display:flex;justify-content:space-between;
                    align-items:center;flex-wrap:wrap;gap:.5rem;">
                    <span style="font-size:.72rem;text-transform:uppercase;
                        letter-spacing:.1em;color:rgba(255,255,255,.5);
                        background:rgba(255,255,255,.07);
                        border:1px solid rgba(255,255,255,.15);
                        border-radius:6px;padding:4px 10px;">
                        Manche ${manche}
                    </span>
                    <span id="pbp-timer" style="font-size:1rem;font-weight:800;color:#a78bfa;
                        background:rgba(139,92,246,.12);border:1px solid rgba(139,92,246,.3);
                        border-radius:8px;padding:4px 12px;">02:00</span>
                </div>
                <div style="text-align:center;padding:.65rem;
                    background:rgba(139,92,246,.1);border:1.5px solid rgba(139,92,246,.35);
                    border-radius:12px;">
                    <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.12em;
                        color:rgba(196,181,253,.8);margin-bottom:4px;font-weight:700;">Lettre</div>
                    <div style="font-size:2.5rem;font-weight:900;color:#c4b5fd;line-height:1;">
                        ${esc(this._lettre)}
                    </div>
                </div>
                <div style="display:flex;flex-direction:column;gap:.5rem;">${cats}</div>
                <button id="pbp-btn-send"
                    style="padding:.85rem;background:rgba(139,92,246,.22);
                    border:1.5px solid rgba(139,92,246,.5);border-radius:10px;
                    color:white;font-size:.95rem;font-weight:700;cursor:pointer;
                    font-family:inherit;margin-top:.5rem;">
                    📤 Soumettre mes réponses
                </button>
            </div>`;

        $('pbp-btn-send')?.addEventListener('click', () => this._soumettre(false));

        // Uppercase première lettre au fil de la saisie
        this._categories.forEach(c => {
            const inp = $(`pbp-input-${c.id}`);
            inp?.addEventListener('input', (e) => {
                if (e.target.value.length === 1) e.target.value = e.target.value.toUpperCase();
            });
        });
    },

    _afficherAttenteRevelation() {
        const btn = $('pbp-btn-send');
        if (btn) {
            btn.disabled    = true;
            btn.textContent = '⏳ Réponses soumises — en attente';
            btn.style.opacity = '0.6';
        }
        // Verrouiller tous les champs
        this._categories.forEach(c => {
            const inp = $(`pbp-input-${c.id}`);
            if (inp) inp.disabled = true;
        });
    },

    _afficherResultats(payload) {
        const cont = $('jeu-contenu');
        if (!cont) return;
        const moi = this._session?.pseudo;
        const moiRes = (payload.reponses || []).find(r => r.pseudo === moi);

        const lignes = (payload.reponses || [])
            .slice().sort((a, b) => (b.score || 0) - (a.score || 0))
            .map(r => {
                const isMe = r.pseudo === moi;
                const bg   = (r.score || 0) > 0 ? 'rgba(34,197,94,.15)' : 'rgba(255,255,255,.06)';
                const bd   = (r.score || 0) > 0 ? 'rgba(34,197,94,.35)' : 'rgba(255,255,255,.12)';
                return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;
                    background:${bg};border:1px solid ${bd};border-radius:10px;margin-bottom:6px;">
                    <span style="font-weight:700;font-size:.85rem;color:${isMe ? '#c4b5fd' : '#fff'};min-width:80px;">
                        ${isMe ? '👤 ' : ''}${esc(r.pseudo)}</span>
                    <span style="flex:1;font-size:.82rem;color:rgba(255,255,255,.6);">
                        ${r.score || 0} bonne${(r.score || 0) !== 1 ? 's' : ''} réponse${(r.score || 0) !== 1 ? 's' : ''}</span>
                    <span style="font-weight:700;font-size:.82rem;color:#86efac;">+${r.score || 0} pt${(r.score || 0) !== 1 ? 's' : ''}</span>
                </div>`;
            }).join('');

        const mesReponses = (moiRes?.reponses) || {};
        const detail = this._categories.map(c => {
            const val = String(mesReponses[c.id] || '').trim();
            const ok  = val.length > 0 && val.charAt(0).toUpperCase() === payload.lettre;
            const color = ok ? '#86efac' : (val ? '#fca5a5' : 'rgba(255,255,255,.4)');
            const icon  = ok ? '✅' : (val ? '❌' : '—');
            return `<div style="display:flex;gap:8px;align-items:center;padding:5px 10px;
                background:rgba(255,255,255,.04);border-radius:6px;margin-bottom:4px;font-size:.85rem;">
                <span style="min-width:24px;">${c.icon}</span>
                <span style="flex:1;color:rgba(255,255,255,.7);">${esc(c.label)}</span>
                <span style="color:${color};font-weight:600;">${icon} ${esc(val) || '—'}</span>
            </div>`;
        }).join('');

        cont.innerHTML = `
            <div style="padding:1rem 0;display:flex;flex-direction:column;gap:1rem;">
                <div style="text-align:center;padding:.7rem;
                    background:rgba(139,92,246,.1);border:1.5px solid rgba(139,92,246,.35);
                    border-radius:12px;">
                    <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.12em;
                        color:rgba(196,181,253,.8);margin-bottom:4px;font-weight:700;">
                        Résultats — Manche ${payload.manche || '?'} — Lettre ${esc(payload.lettre)}</div>
                </div>
                <div>
                    <div style="font-size:.78rem;text-transform:uppercase;letter-spacing:.1em;
                        color:rgba(167,139,250,.8);margin-bottom:6px;font-weight:700;">
                        Tes réponses
                    </div>
                    ${detail}
                </div>
                <div>
                    <div style="font-size:.78rem;text-transform:uppercase;letter-spacing:.1em;
                        color:rgba(167,139,250,.8);margin-bottom:6px;font-weight:700;">
                        Classement
                    </div>
                    ${lignes}
                </div>
                <p style="text-align:center;font-size:.85rem;color:rgba(255,255,255,.5);margin:0;">
                    En attente de la prochaine manche…
                </p>
            </div>`;
    },

    // ─────────────────────────────────────────────────────
    // Actions
    // ─────────────────────────────────────────────────────

    _soumettre(forced) {
        if (this._aSoumis) return;
        const reponses = {};
        this._categories.forEach(c => {
            const inp = $(`pbp-input-${c.id}`);
            reponses[c.id] = inp ? inp.value.trim() : '';
        });
        try {
            this._socket.send('PLAYER_ACTION', {
                action: 'petitbac:answer',
                data: { reponses },
            });
            this._aSoumis = true; // sera reconfirmé par PETITBAC_ANSWER_ACK
        } catch (err) {
            console.error('[PBP] send answer:', err.message);
        }
        if (forced) this._afficherAttenteRevelation();
    },

    // ─────────────────────────────────────────────────────
    // Timer visuel
    // ─────────────────────────────────────────────────────

    _demarrerTimer() {
        this._arreterTimer();
        const compute = () => Math.max(0, Math.ceil((this._tsDebut + this._dureeMs - Date.now()) / 1000));
        const render = () => {
            const t = $('pbp-timer');
            if (!t) return;
            const r = compute();
            const m = String(Math.floor(r / 60)).padStart(2, '0');
            const s = String(r % 60).padStart(2, '0');
            t.textContent = `${m}:${s}`;
            if (r <= 30) t.style.color = '#fca5a5';
        };
        render();
        this._timerInterval = setInterval(() => {
            render();
            if (compute() <= 0) this._arreterTimer();
        }, 250);
    },

    _arreterTimer() {
        if (this._timerInterval) {
            clearInterval(this._timerInterval);
            this._timerInterval = null;
        }
    },

    // ─────────────────────────────────────────────────────
    // Toast minimaliste (réutilise le container global créé par player.js)
    // ─────────────────────────────────────────────────────

    _afficherToast(msg, type = 'info') {
        const C = { success:'#22c55e', error:'#ef4444', warning:'#f59e0b', info:'#00d4ff' };
        const I = { success:'✅', error:'❌', warning:'⚠️', info:'ℹ️' };
        let c = $('toast-container');
        if (!c) {
            c = document.createElement('div'); c.id = 'toast-container';
            c.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:9999;display:flex;flex-direction:column;gap:.4rem;max-width:310px;pointer-events:none;';
            document.body.appendChild(c);
        }
        const el = document.createElement('div');
        el.style.cssText = `display:flex;gap:.5rem;align-items:flex-start;padding:.65rem .9rem;
            border-radius:8px;background:#1e1e2e;color:#fff;
            border-left:3px solid ${C[type] || C.info};box-shadow:0 4px 16px rgba(0,0,0,.5);
            font-size:.88rem;pointer-events:auto;`;
        el.innerHTML = `<span>${I[type] || 'ℹ️'}</span><span>${esc(msg)}</span>`;
        c.appendChild(el);
        setTimeout(() => el.remove(), 3000);
    },
};

JeuRegistry.register('petitbac', PetitbacModule);
console.log('[PBP] ✅ PetitbacModule enregistré dans JeuRegistry');
