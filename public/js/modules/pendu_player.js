// ============================================================
// /js/modules/pendu_player.js — v1.0 (P5.2)
// ============================================================
// Module invité Pendu. Auto-enregistré dans JeuRegistry.
// Chaque invité joue le MÊME mot en parallèle avec son propre
// clavier, ses propres erreurs, son propre dessin SVG. À la fin,
// son résultat est envoyé via PLAYER_ACTION pendu:result.
// ============================================================

import { JeuRegistry } from './player.js';

const $   = id => document.getElementById(id);
const esc = s => String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const MAX_ERREURS = 7;

const DESSINS = [
    `<svg viewBox="0 0 200 250" style="width:140px;height:auto;"><line x1="10" y1="230" x2="150" y2="230" stroke="#fff" stroke-width="4"/></svg>`,
    `<svg viewBox="0 0 200 250" style="width:140px;height:auto;"><line x1="10" y1="230" x2="150" y2="230" stroke="#fff" stroke-width="4"/><line x1="50" y1="230" x2="50" y2="20" stroke="#fff" stroke-width="4"/></svg>`,
    `<svg viewBox="0 0 200 250" style="width:140px;height:auto;"><line x1="10" y1="230" x2="150" y2="230" stroke="#fff" stroke-width="4"/><line x1="50" y1="230" x2="50" y2="20" stroke="#fff" stroke-width="4"/><line x1="50" y1="20" x2="130" y2="20" stroke="#fff" stroke-width="4"/></svg>`,
    `<svg viewBox="0 0 200 250" style="width:140px;height:auto;"><line x1="10" y1="230" x2="150" y2="230" stroke="#fff" stroke-width="4"/><line x1="50" y1="230" x2="50" y2="20" stroke="#fff" stroke-width="4"/><line x1="50" y1="20" x2="130" y2="20" stroke="#fff" stroke-width="4"/><line x1="130" y1="20" x2="130" y2="50" stroke="#fff" stroke-width="2"/></svg>`,
    `<svg viewBox="0 0 200 250" style="width:140px;height:auto;"><line x1="10" y1="230" x2="150" y2="230" stroke="#fff" stroke-width="4"/><line x1="50" y1="230" x2="50" y2="20" stroke="#fff" stroke-width="4"/><line x1="50" y1="20" x2="130" y2="20" stroke="#fff" stroke-width="4"/><line x1="130" y1="20" x2="130" y2="50" stroke="#fff" stroke-width="2"/><circle cx="130" cy="70" r="20" stroke="#fff" stroke-width="3" fill="none"/></svg>`,
    `<svg viewBox="0 0 200 250" style="width:140px;height:auto;"><line x1="10" y1="230" x2="150" y2="230" stroke="#fff" stroke-width="4"/><line x1="50" y1="230" x2="50" y2="20" stroke="#fff" stroke-width="4"/><line x1="50" y1="20" x2="130" y2="20" stroke="#fff" stroke-width="4"/><line x1="130" y1="20" x2="130" y2="50" stroke="#fff" stroke-width="2"/><circle cx="130" cy="70" r="20" stroke="#fff" stroke-width="3" fill="none"/><line x1="130" y1="90" x2="130" y2="150" stroke="#fff" stroke-width="3"/></svg>`,
    `<svg viewBox="0 0 200 250" style="width:140px;height:auto;"><line x1="10" y1="230" x2="150" y2="230" stroke="#fff" stroke-width="4"/><line x1="50" y1="230" x2="50" y2="20" stroke="#fff" stroke-width="4"/><line x1="50" y1="20" x2="130" y2="20" stroke="#fff" stroke-width="4"/><line x1="130" y1="20" x2="130" y2="50" stroke="#fff" stroke-width="2"/><circle cx="130" cy="70" r="20" stroke="#fff" stroke-width="3" fill="none"/><line x1="130" y1="90" x2="130" y2="150" stroke="#fff" stroke-width="3"/><line x1="130" y1="100" x2="100" y2="120" stroke="#fff" stroke-width="3"/><line x1="130" y1="100" x2="160" y2="120" stroke="#fff" stroke-width="3"/><line x1="130" y1="150" x2="110" y2="190" stroke="#fff" stroke-width="3"/><line x1="130" y1="150" x2="150" y2="190" stroke="#fff" stroke-width="3"/></svg>`,
];

// Normalise une lettre (retire les accents) pour matcher le clavier A-Z.
const _pNorm = c => String(c || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const PenduModule = {
    _session       : null,
    _socket        : null,
    _motSecret     : '',
    _theme         : '',
    _motAffiche    : [],
    _lettresUsees  : new Set(),
    _nbErreurs     : 0,
    _termine       : false,
    _resultEnvoye  : false,
    _themeVisible  : false,
    _keydownHandler: null,

    initPlayer(session, sock, gameState, snapshot) {
        this._session = session;
        this._socket  = sock;
        this._reset();
        this._afficherEcranAttente();

        if (gameState && gameState.phase === 'jeu' && gameState.motSecret) {
            this._onMotStart({
                motSecret : gameState.motSecret,
                theme     : gameState.theme,
                manche    : gameState.manche,
            });
        } else if (gameState && gameState.phase === 'resultats') {
            this._onRevelation({
                motSecret : gameState.motSecret,
                theme     : gameState.theme,
                resultats : gameState.resultats,
                scores    : gameState.scores,
                manche    : gameState.manche,
            });
        }
    },

    destroy() {
        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler);
            this._keydownHandler = null;
        }
    },

    onWsEvent(evt, payload) {
        switch (evt) {
            case 'PENDU_MOT_START':  this._onMotStart(payload);  break;
            case 'PENDU_REVELATION': this._onRevelation(payload); break;
            case 'PENDU_RESULT_ACK': this._onResultAck(payload); break;
        }
    },

    onScores() {},

    // ─────────────────────────────────────────────────────

    _reset() {
        this._motSecret    = '';
        this._theme        = '';
        this._motAffiche   = [];
        this._lettresUsees = new Set();
        this._nbErreurs    = 0;
        this._termine      = false;
        this._resultEnvoye = false;
        this._themeVisible = false;
    },

    _onMotStart(payload) {
        this._reset();
        this._motSecret = String(payload.motSecret || '').toUpperCase();
        this._theme     = String(payload.theme     || '').toUpperCase();
        this._motAffiche = Array(this._motSecret.length).fill('_');

        // Révéler 1ère + dernière (accents normalisés)
        const reveler = new Set([
            _pNorm(this._motSecret[0]),
            _pNorm(this._motSecret[this._motSecret.length - 1])
        ]);
        for (let i = 0; i < this._motSecret.length; i++) {
            if (reveler.has(_pNorm(this._motSecret[i]))) {
                this._motAffiche[i] = this._motSecret[i];
                this._lettresUsees.add(_pNorm(this._motSecret[i]));
            }
        }
        this._afficherJeu(payload.manche || 1);
    },

    _onRevelation(payload) {
        this._afficherResultats(payload);
    },

    _onResultAck({ status }) {
        if (status !== 'ok' && status !== 'already') {
            this._toast(`Erreur soumission: ${status}`, 'error');
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
                <div style="font-size:2.5rem;">🪢</div>
                <h2 style="margin:0;font-size:1.1rem;">Pendu</h2>
                <p style="color:rgba(255,255,255,.5);margin:0;">
                    En attente du mot…
                </p>
            </div>`;
    },

    _afficherJeu(manche) {
        const cont = $('jeu-contenu');
        if (!cont) return;
        cont.innerHTML = `
            <div style="padding:1rem 0;display:flex;flex-direction:column;gap:.85rem;">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem;">
                    <span style="font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;
                        color:rgba(255,255,255,.5);background:rgba(255,255,255,.07);
                        border:1px solid rgba(255,255,255,.15);border-radius:6px;padding:4px 10px;">
                        Manche ${manche}
                    </span>
                    <span style="font-size:.82rem;color:rgba(167,139,250,.85);font-weight:700;">
                        ❌ <span id="pp-erreurs">0</span> / ${MAX_ERREURS}
                    </span>
                </div>
                <div id="pp-dessin" style="display:flex;justify-content:center;
                    padding:.5rem;background:rgba(0,0,0,.25);border-radius:12px;"></div>
                <div id="pp-theme-row" style="display:flex;gap:8px;align-items:center;justify-content:center;">
                    <button id="pp-theme-toggle"
                        style="font-size:.75rem;padding:5px 10px;background:rgba(167,139,250,.15);
                        border:1px solid rgba(167,139,250,.35);border-radius:7px;color:#c4b5fd;
                        cursor:pointer;font-family:inherit;">
                        🎯 Afficher le thème
                    </button>
                    <span id="pp-theme" style="font-size:.85rem;color:#c4b5fd;font-weight:700;display:none;"></span>
                </div>
                <div id="pp-mot" style="display:flex;justify-content:center;gap:6px;flex-wrap:wrap;
                    padding:.8rem;background:rgba(167,139,250,.08);border:1.5px solid rgba(167,139,250,.3);
                    border-radius:12px;min-height:60px;align-items:center;"></div>
                <div id="pp-clavier" style="display:grid;grid-template-columns:repeat(9,1fr);gap:5px;"></div>
                <div id="pp-result" hidden style="padding:.85rem;border-radius:10px;text-align:center;
                    font-weight:700;font-size:.95rem;"></div>
            </div>`;

        this._render();
        this._creerClavier();
        $('pp-theme-toggle')?.addEventListener('click', () => this._toggleTheme());

        // Listener clavier (un seul)
        if (this._keydownHandler) document.removeEventListener('keydown', this._keydownHandler);
        this._keydownHandler = (e) => {
            if (this._termine) return;
            const l = e.key.toUpperCase();
            if (/^[A-Z]$/.test(l) && !this._lettresUsees.has(l)) this._jouerLettre(l);
        };
        document.addEventListener('keydown', this._keydownHandler);
    },

    _render() {
        const elMot = $('pp-mot');
        if (elMot) elMot.innerHTML = this._motAffiche.map(l => `
            <span style="display:inline-block;min-width:24px;padding:4px 8px;
                background:rgba(255,255,255,.06);border-bottom:2px solid rgba(196,181,253,.5);
                border-radius:4px;font-weight:800;font-size:1.1rem;letter-spacing:1px;
                color:#fff;">${l === '_' ? '&nbsp;' : esc(l)}</span>`).join('');
        const elD = $('pp-dessin');
        if (elD) elD.innerHTML = DESSINS[Math.min(this._nbErreurs, 6)];
        const elE = $('pp-erreurs');
        if (elE) elE.textContent = this._nbErreurs;
    },

    _creerClavier() {
        const el = $('pp-clavier');
        if (!el) return;
        el.innerHTML = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => {
            const used = this._lettresUsees.has(l);
            const inMot = used && Array.from(this._motSecret).some(c => _pNorm(c) === l);
            const bg    = used
                ? (inMot ? 'rgba(34,197,94,.25)' : 'rgba(239,68,68,.25)')
                : 'rgba(255,255,255,.08)';
            const bd    = used
                ? (inMot ? 'rgba(34,197,94,.55)' : 'rgba(239,68,68,.45)')
                : 'rgba(255,255,255,.18)';
            return `<button data-l="${l}" ${used ? 'disabled' : ''}
                style="padding:8px 0;background:${bg};border:1.5px solid ${bd};
                border-radius:6px;color:#fff;font-weight:700;font-size:.95rem;
                cursor:${used ? 'default' : 'pointer'};font-family:inherit;">${l}</button>`;
        }).join('');
        el.querySelectorAll('button').forEach(b => {
            b.addEventListener('click', () => {
                if (this._termine || b.disabled) return;
                this._jouerLettre(b.dataset.l);
            });
        });
    },

    _toggleTheme() {
        this._themeVisible = !this._themeVisible;
        const t = $('pp-theme');
        const btn = $('pp-theme-toggle');
        if (t) {
            if (this._themeVisible) { t.textContent = this._theme; t.style.display = 'inline'; }
            else                    { t.textContent = '';          t.style.display = 'none';   }
        }
        if (btn) btn.textContent = this._themeVisible ? '🔒 Masquer le thème' : '🎯 Afficher le thème';
    },

    _jouerLettre(l) {
        if (this._lettresUsees.has(l) || this._termine) return;
        this._lettresUsees.add(l);
        let trouve = false;
        for (let i = 0; i < this._motSecret.length; i++) {
            if (_pNorm(this._motSecret[i]) === l) {
                this._motAffiche[i] = this._motSecret[i];
                trouve = true;
            }
        }
        if (trouve) {
            if (!this._motAffiche.includes('_')) this._terminer(true);
        } else {
            this._nbErreurs++;
            if (this._nbErreurs >= MAX_ERREURS) this._terminer(false);
        }
        this._render();
        this._creerClavier();
    },

    _terminer(victoire) {
        if (this._termine) return;
        this._termine = true;
        this._themeVisible = true;
        const t = $('pp-theme');
        if (t) { t.textContent = this._theme; t.style.display = 'inline'; }
        const btn = $('pp-theme-toggle');
        if (btn) btn.disabled = true;

        const el = $('pp-result');
        if (el) {
            el.hidden = false;
            if (victoire) {
                el.style.background = 'rgba(34,197,94,.15)';
                el.style.border     = '1.5px solid rgba(34,197,94,.4)';
                el.style.color      = '#86efac';
                el.innerHTML        = `🎉 Trouvé ! Le mot était <strong>${esc(this._motSecret)}</strong>`;
            } else {
                el.style.background = 'rgba(239,68,68,.12)';
                el.style.border     = '1.5px solid rgba(239,68,68,.4)';
                el.style.color      = '#fca5a5';
                el.innerHTML        = `😢 Perdu. Le mot était <strong>${esc(this._motSecret)}</strong>`;
            }
        }

        if (!this._resultEnvoye) {
            this._resultEnvoye = true;
            try {
                this._socket.send('PLAYER_ACTION', {
                    action: 'pendu:result',
                    data: { victoire, erreurs: this._nbErreurs },
                });
                console.log(`[PP] 📨 Résultat envoyé : victoire=${victoire}, erreurs=${this._nbErreurs}`);
            } catch (err) { console.error('[PP] send result:', err.message); }
        }
    },

    _afficherResultats(payload) {
        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler);
            this._keydownHandler = null;
        }
        const cont = $('jeu-contenu');
        if (!cont) return;
        const moi = this._session?.pseudo;
        const lignes = (payload.resultats || []).map(r => {
            const isMe = r.pseudo === moi;
            const bg   = r.victoire ? 'rgba(34,197,94,.15)' : 'rgba(239,68,68,.12)';
            const bd   = r.victoire ? 'rgba(34,197,94,.35)' : 'rgba(239,68,68,.25)';
            const badge = r.victoire
                ? `<span style="color:#86efac;font-weight:700;">+${r.points}pt${r.points !== 1 ? 's' : ''} ✅</span>`
                : `<span style="color:#fca5a5;">0pt ❌</span>`;
            return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;
                background:${bg};border:1px solid ${bd};border-radius:10px;margin-bottom:6px;font-size:.85rem;">
                <span style="font-weight:700;min-width:80px;color:${isMe ? '#c4b5fd' : '#fff'};">
                    ${isMe ? '👤 ' : ''}${esc(r.pseudo)}</span>
                <span style="flex:1;color:rgba(255,255,255,.6);">
                    ${r.victoire ? '🎉 Trouvé' : '😢 Pas trouvé'} — ${r.erreurs} erreur${r.erreurs !== 1 ? 's' : ''}</span>
                ${badge}
            </div>`;
        }).join('');

        cont.innerHTML = `
            <div style="padding:1rem 0;display:flex;flex-direction:column;gap:1rem;">
                <div style="text-align:center;padding:.7rem;
                    background:rgba(167,139,250,.1);border:1.5px solid rgba(167,139,250,.35);
                    border-radius:12px;">
                    <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.12em;
                        color:rgba(196,181,253,.8);margin-bottom:4px;font-weight:700;">
                        Résultats — Manche ${payload.manche || '?'}
                    </div>
                    <div style="font-size:1.1rem;font-weight:900;color:#c4b5fd;">
                        Le mot : ${esc(payload.motSecret)}
                    </div>
                    <div style="font-size:.78rem;color:rgba(196,181,253,.7);margin-top:4px;">
                        Thème : ${esc(payload.theme)}
                    </div>
                </div>
                ${lignes}
                <p style="text-align:center;font-size:.85rem;color:rgba(255,255,255,.5);margin:0;">
                    En attente du prochain mot…
                </p>
            </div>`;
    },

    _toast(msg, type = 'info') {
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
            border-radius:8px;background:#1e1e2e;color:#fff;border-left:3px solid ${C[type] || C.info};
            box-shadow:0 4px 16px rgba(0,0,0,.5);font-size:.88rem;pointer-events:auto;`;
        el.innerHTML = `<span>${I[type] || 'ℹ️'}</span><span>${esc(msg)}</span>`;
        c.appendChild(el);
        setTimeout(() => el.remove(), 3000);
    },
};

JeuRegistry.register('pendu', PenduModule);
console.log('[PP] ✅ PenduModule enregistré dans JeuRegistry');