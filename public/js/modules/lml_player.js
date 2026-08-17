// ============================================================
// /js/modules/lml_player.js — v1.0 (P5.3)
// ============================================================
// Module invité Maxi Lettres. Auto-enregistré dans JeuRegistry.
// Affiche les 10 lettres reçues du serveur, permet la saisie,
// soumet le mot via PLAYER_ACTION lml:answer.
// ============================================================

import { JeuRegistry } from './player.js';

const $   = id => document.getElementById(id);
const esc = s => String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const LmlModule = {
    _session       : null,
    _socket        : null,
    _lettres       : [],
    _tsDebut       : 0,
    _dureeMs       : 60_000,
    _timerInterval : null,
    _aSoumis       : false,

    initPlayer(session, sock, gameState, snapshot) {
        this._session = session;
        this._socket  = sock;
        this._aSoumis = false;

        this._afficherEcranAttente();

        if (gameState && gameState.phase === 'jeu' && Array.isArray(gameState.lettres) && gameState.lettres.length) {
            this._onMancheStart({
                lettres : gameState.lettres,
                tsDebut : gameState.tsDebut,
                dureeMs : gameState.dureeMs,
                manche  : gameState.manche,
            });
        }
    },

    destroy() { this._arreterTimer(); },

    onWsEvent(evt, payload) {
        switch (evt) {
            case 'LML_MANCHE_START':  this._onMancheStart(payload);  break;
            case 'LML_REVELATION':    this._onRevelation(payload);   break;
            case 'LML_ANSWER_ACK':    this._onAnswerAck(payload);    break;
            case 'LML_TIMER_EXPIRED': this._onTimerExpired();        break;
        }
    },

    onScores() {},

    // ─────────────────────────────────────────────────────

    _onMancheStart(payload) {
        this._arreterTimer();
        this._lettres = Array.isArray(payload.lettres) ? payload.lettres : [];
        this._tsDebut = payload.tsDebut || Date.now();
        this._dureeMs = payload.dureeMs || 60_000;
        this._aSoumis = false;
        this._afficherJeu(payload.manche || 1);
        this._demarrerTimer();
    },

    _onRevelation(payload) {
        this._arreterTimer();
        this._afficherResultats(payload);
    },

    _onAnswerAck({ status }) {
        if (status === 'ok') {
            this._aSoumis = true;
            this._verrouillerSaisie();
        } else if (status === 'already') {
            this._toast('Déjà soumis', 'warning');
        } else if (status === 'too_late') {
            this._toast('Trop tard !', 'warning');
        } else {
            this._toast('Soumission invalide', 'error');
        }
    },

    _onTimerExpired() {
        if (!this._aSoumis) {
            const inp = $('lp-input');
            const mot = inp ? inp.value.toUpperCase().trim() : '';
            this._soumettre(mot);
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
                <div style="font-size:2.5rem;">📖</div>
                <h2 style="margin:0;font-size:1.1rem;">Maxi Lettres</h2>
                <p style="color:var(--mgu-encre-600);margin:0;">
                    En attente des lettres…
                </p>
            </div>`;
    },

    _afficherJeu(manche) {
        const cont = $('jeu-contenu');
        if (!cont) return;
        const lettres = this._lettres.map((l, i) => `
            <button class="lp-lettre" data-i="${i}"
                style="min-width:38px;padding:10px 0;background:rgba(232,178,59,.18);
                border:1.5px solid rgba(232,178,59,.45);border-radius:8px;color:var(--mgu-encre-900);
                font-weight:800;font-size:1.1rem;cursor:pointer;font-family:inherit;">
                ${esc(l)}
            </button>`).join('');

        cont.innerHTML = `
            <div style="padding:1rem 0;display:flex;flex-direction:column;gap:.85rem;">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem;">
                    <span style="font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;
                        color:var(--mgu-encre-600);background:var(--mgu-carton-50);
                        border:1px solid var(--mgu-carton-line);border-radius:6px;padding:4px 10px;">
                        Manche ${manche}
                    </span>
                    <span id="lp-timer" style="font-size:1rem;font-weight:800;color:var(--mgu-or-600);
                        background:rgba(232,178,59,.12);border:1px solid rgba(232,178,59,.3);
                        border-radius:8px;padding:4px 12px;">01:00</span>
                </div>
                <div id="lp-lettres" style="display:flex;justify-content:center;gap:6px;flex-wrap:wrap;">${lettres}</div>
                <input id="lp-input" type="text" maxlength="10" autocomplete="off" spellcheck="false"
                    placeholder="Ton mot le plus long…"
                    style="width:100%;box-sizing:border-box;padding:.75rem 1rem;
                    background:var(--mgu-carton-50);border:1.5px solid var(--mgu-carton-line);
                    border-radius:10px;color:var(--mgu-encre-900);font-size:1rem;font-family:inherit;
                    text-align:center;font-weight:700;letter-spacing:.1em;outline:none;">
                <div style="display:flex;gap:8px;">
                    <button id="lp-shuffle" style="flex:0 0 auto;padding:.6rem 1rem;
                        background:var(--mgu-carton-50);border:1.5px solid var(--mgu-carton-line);
                        border-radius:10px;color:var(--mgu-encre-900);font-size:.85rem;cursor:pointer;
                        font-family:inherit;">🔀 Mélanger</button>
                    <button id="lp-clear" style="flex:0 0 auto;padding:.6rem 1rem;
                        background:var(--mgu-carton-50);border:1.5px solid var(--mgu-carton-line);
                        border-radius:10px;color:var(--mgu-encre-900);font-size:.85rem;cursor:pointer;
                        font-family:inherit;">⌫ Effacer</button>
                </div>
                <button id="lp-btn-send"
                    style="padding:.85rem;background:rgba(95,167,119,.22);
                    border:1.5px solid rgba(95,167,119,.5);border-radius:10px;
                    color:var(--mgu-encre-900);font-size:.95rem;font-weight:700;cursor:pointer;
                    font-family:inherit;">
                    📤 Envoyer mon mot
                </button>
            </div>`;

        // Clic lettre = ajouter à l'input
        $('lp-lettres')?.querySelectorAll('.lp-lettre').forEach(b => {
            b.addEventListener('click', () => {
                if (b.classList.contains('utilisee')) return;
                const inp = $('lp-input');
                if (inp && !inp.disabled && inp.value.length < 10) {
                    inp.value += b.textContent.trim();
                    b.classList.add('utilisee');
                    b.style.opacity = '0.35';
                }
            });
        });

        $('lp-shuffle')?.addEventListener('click', () => {
            // Re-mélange local des boutons (visuel uniquement)
            const z = $('lp-lettres');
            if (!z) return;
            const buttons = Array.from(z.children);
            for (let i = buttons.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                z.insertBefore(buttons[j], buttons[i]);
                buttons.splice(buttons.indexOf(buttons[j]), 1, buttons[i]);
            }
        });

        $('lp-clear')?.addEventListener('click', () => {
            const inp = $('lp-input');
            if (inp) inp.value = '';
            $('lp-lettres')?.querySelectorAll('.lp-lettre').forEach(b => {
                b.classList.remove('utilisee');
                b.style.opacity = '';
            });
        });

        $('lp-input')?.addEventListener('input', e => {
            e.target.value = e.target.value.toUpperCase();
        });
        $('lp-input')?.addEventListener('keypress', e => {
            if (e.key === 'Enter') $('lp-btn-send')?.click();
        });
        $('lp-btn-send')?.addEventListener('click', () => {
            const inp = $('lp-input');
            const mot = inp ? inp.value.toUpperCase().trim() : '';
            if (!mot) return;
            this._soumettre(mot);
        });
    },

    _verrouillerSaisie() {
        const inp = $('lp-input'); if (inp) inp.disabled = true;
        const btn = $('lp-btn-send');
        if (btn) {
            btn.disabled    = true;
            btn.textContent = '⏳ Mot envoyé — en attente';
            btn.style.opacity = '0.6';
        }
    },

    _afficherResultats(payload) {
        this._arreterTimer();
        const cont = $('jeu-contenu');
        if (!cont) return;
        const moi = this._session?.pseudo;

        const lignes = (payload.reponses || []).map(r => {
            const isMe = r.pseudo === moi;
            const bg   = r.valide ? 'rgba(95,167,119,.15)' : 'rgba(214,72,79,.12)';
            const bd   = r.valide ? 'rgba(95,167,119,.35)' : 'rgba(214,72,79,.25)';
            const badge = r.valide
                ? `<span style="color:#2f5f42;font-weight:700;">+${r.points}pt${r.points !== 1 ? 's' : ''} ✅${r.estPlusLong ? ' 👑' : ''}</span>`
                : `<span style="color:#8a2f33;">0pt ❌</span>`;
            const motLen = (r.mot || '').length;
            return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;
                background:${bg};border:1px solid ${bd};border-radius:10px;margin-bottom:6px;font-size:.85rem;flex-wrap:wrap;">
                <span style="font-weight:700;min-width:80px;color:${isMe ? 'var(--mgu-or-600)' : '#fff'};">
                    ${isMe ? '👤 ' : ''}${esc(r.pseudo)}</span>
                <span style="flex:1;font-style:italic;color:var(--mgu-encre-600);">"${esc(r.mot || '—')}"</span>
                <span style="font-size:.75rem;color:var(--mgu-encre-600);">${motLen} lettre${motLen > 1 ? 's' : ''}</span>
                ${badge}
            </div>`;
        }).join('');

        cont.innerHTML = `
            <div style="padding:1rem 0;display:flex;flex-direction:column;gap:1rem;">
                <div style="text-align:center;padding:.7rem;
                    background:rgba(232,178,59,.1);border:1.5px solid rgba(232,178,59,.35);
                    border-radius:12px;">
                    <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.12em;
                        color:rgba(196,181,253,.8);margin-bottom:4px;font-weight:700;">
                        Résultats — Manche ${payload.manche || '?'}
                    </div>
                    <div style="font-size:.95rem;color:var(--mgu-or-600);letter-spacing:.15em;font-weight:700;">
                        ${(payload.lettres || []).map(esc).join(' ')}
                    </div>
                </div>
                ${lignes}
                ${payload.motMax ? `
                    <div style="text-align:center;padding:.6rem;font-size:.85rem;
                        color:var(--mgu-encre-600);border-top:1px solid var(--mgu-carton-line);">
                        💎 Meilleur possible : <strong style="color:var(--mgu-or-600);">${esc(payload.motMax)}</strong>
                        (${payload.motMax.length} lettres)
                    </div>` : ''}
                <p style="text-align:center;font-size:.85rem;color:var(--mgu-encre-600);margin:0;">
                    En attente de la prochaine manche…
                </p>
            </div>`;
    },

    _soumettre(mot) {
        if (this._aSoumis) return;
        try {
            this._socket.send('PLAYER_ACTION', {
                action: 'lml:answer',
                data: { mot },
            });
        } catch (err) {
            console.error('[LP] send answer:', err.message);
        }
    },

    // ─────────────────────────────────────────────────────
    // Timer visuel
    // ─────────────────────────────────────────────────────

    _demarrerTimer() {
        this._arreterTimer();
        const compute = () => Math.max(0, Math.ceil((this._tsDebut + this._dureeMs - Date.now()) / 1000));
        const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
        const render = () => {
            const t = $('lp-timer'); if (!t) return;
            const r = compute();
            t.textContent = fmt(r);
            if (r <= 10 && r > 0) t.style.color = '#8a2f33';
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

    _toast(msg, type = 'info') {
        const C = { success:'#22c55e', error:'#ef4444', warning:'#f59e0b', info:'var(--mgu-or-600)' };
        const I = { success:'✅', error:'❌', warning:'⚠️', info:'ℹ️' };
        let c = $('toast-container');
        if (!c) {
            c = document.createElement('div'); c.id = 'toast-container';
            c.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:9999;display:flex;flex-direction:column;gap:.4rem;max-width:310px;pointer-events:none;';
            document.body.appendChild(c);
        }
        const el = document.createElement('div');
        el.style.cssText = `display:flex;gap:.5rem;align-items:flex-start;padding:.65rem .9rem;
            border-radius:8px;background:#1e1e2e;color:var(--mgu-encre-900);border-left:3px solid ${C[type] || C.info};
            box-shadow:0 4px 16px rgba(0,0,0,.5);font-size:.88rem;pointer-events:auto;`;
        el.innerHTML = `<span>${I[type] || 'ℹ️'}</span><span>${esc(msg)}</span>`;
        c.appendChild(el);
        setTimeout(() => el.remove(), 3000);
    },
};

JeuRegistry.register('lml', LmlModule);
console.log('[LP] ✅ LmlModule enregistré dans JeuRegistry');