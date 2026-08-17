// ============================================================
// /js/modules/justeprix_player.js — v1.1 (P5.4)
// ============================================================
// Module invité Juste Prix. Auto-enregistré dans JeuRegistry.
// Affiche le produit (sans prix), permet la saisie d'estimation,
// soumet via PLAYER_ACTION justeprix:answer.
//
// v1.1 : rejoin pendant la phase 'resultats' — le serveur fournit
//        désormais reponses[] + produit dans gameState, on
//        reconstruit l'écran de résultats à l'identique.
// ============================================================

import { JeuRegistry } from './player.js';

const $   = id => document.getElementById(id);
const esc = s => String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function _resoudreImage(src, idProduit) {
    if (!src || !src.trim()) src = `images/produit_${idProduit}.jpg`;
    if (src.startsWith('http')) return src;
    // Image servie depuis public/images/ via le routeur statique Express.
    const base = window.location.origin;
    return src.startsWith('/') ? `${base}${src}` : `${base}/${src}`;
}

const JusteprixModule = {
    _session       : null,
    _socket        : null,
    _produit       : null,
    _tsDebut       : 0,
    _dureeMs       : 60_000,
    _timerInterval : null,
    _aSoumis       : false,

    initPlayer(session, sock, gameState, snapshot) {
        this._session = session;
        this._socket  = sock;
        this._aSoumis = false;
        this._afficherEcranAttente();

        if (gameState && gameState.phase === 'jeu' && gameState.produit) {
            this._onProduitStart({
                produit : gameState.produit,
                tsDebut : gameState.tsDebut,
                dureeMs : gameState.dureeMs,
                manche  : gameState.manche,
            });
        } else if (gameState && gameState.phase === 'resultats' && gameState.reponses) {
            // Rejoin pendant la révélation : payload complet fourni par
            // getSessionState → on reconstruit l'écran de résultats.
            this._afficherResultats(gameState);
        }
    },

    destroy() { this._arreterTimer(); },

    onWsEvent(evt, payload) {
        switch (evt) {
            case 'JUSTEPRIX_PRODUIT_START': this._onProduitStart(payload); break;
            case 'JUSTEPRIX_REVELATION':    this._onRevelation(payload);   break;
            case 'JUSTEPRIX_ANSWER_ACK':    this._onAnswerAck(payload);    break;
            case 'JUSTEPRIX_TIMER_EXPIRED': this._onTimerExpired();        break;
        }
    },

    onScores() {},

    // ─────────────────────────────────────────────────────

    _onProduitStart(payload) {
        this._arreterTimer();
        this._produit = payload.produit || null;
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
            this._toast('Estimation invalide', 'error');
        }
    },

    _onTimerExpired() {
        if (!this._aSoumis) {
            const inp = $('jpp-input');
            const val = inp ? inp.value.trim() : '';
            if (val) this._soumettre(val);
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
                <div style="font-size:2.5rem;">💰</div>
                <h2 style="margin:0;font-size:1.1rem;">Juste Prix</h2>
                <p style="color:var(--mgu-encre-600);margin:0;">
                    En attente du produit…
                </p>
            </div>`;
    },

    _afficherJeu(manche) {
        const cont = $('jeu-contenu');
        if (!cont || !this._produit) return;
        const p   = this._produit;
        const src = _resoudreImage(p.imageSrc, p.id);

        cont.innerHTML = `
            <div style="padding:1rem 0;display:flex;flex-direction:column;gap:.85rem;">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem;">
                    <span style="font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;
                        color:var(--mgu-encre-600);background:var(--mgu-carton-50);
                        border:1px solid var(--mgu-carton-line);border-radius:6px;padding:4px 10px;">
                        Manche ${manche}
                    </span>
                    <span id="jpp-timer" style="font-size:1rem;font-weight:800;color:var(--mgu-or-600);
                        background:rgba(232,178,59,.12);border:1px solid rgba(232,178,59,.3);
                        border-radius:8px;padding:4px 12px;">01:00</span>
                </div>
                <div style="background:rgba(232,178,59,.07);border:1.5px solid rgba(232,178,59,.3);
                    border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:8px;text-align:center;">
                    ${p.categorie ? `<span style="font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;
                        color:var(--mgu-or-600);font-weight:700;">${esc(p.categorie)}</span>` : ''}
                    <div style="font-size:1.05rem;font-weight:800;color:var(--mgu-encre-900);">${esc(p.nom || '—')}</div>
                    ${p.marque ? `<div style="font-size:.78rem;color:var(--mgu-encre-600);">${esc(p.marque)}</div>` : ''}
                    ${p.description ? `<div style="font-size:.82rem;color:var(--mgu-encre-600);">${esc(p.description)}</div>` : ''}
                    <img src="${esc(src)}" alt="${esc(p.nom)}"
                        onerror="this.style.display='none'"
                        style="max-width:100%;max-height:200px;margin:8px auto 0;border-radius:10px;background:var(--mgu-carton-50);">
                    ${p.fourchette ? `<div style="margin-top:6px;font-size:.82rem;color:var(--mgu-encre-600);
                        background:var(--mgu-carton-50);padding:6px 10px;border-radius:8px;">
                        💡 Fourchette : <strong style="color:var(--mgu-or-600);">${esc(p.fourchette)}</strong></div>` : ''}
                </div>
                <input id="jpp-input" type="number" step="0.01" min="0" inputmode="decimal"
                    autocomplete="off" placeholder="Ton estimation (€)…"
                    style="width:100%;box-sizing:border-box;padding:.85rem 1rem;
                    background:var(--mgu-carton-50);border:1.5px solid var(--mgu-carton-line);
                    border-radius:10px;color:var(--mgu-encre-900);font-size:1.05rem;font-family:inherit;
                    text-align:center;font-weight:700;outline:none;">
                <button id="jpp-btn-send"
                    style="padding:.85rem;background:rgba(232,178,59,.22);
                    border:1.5px solid rgba(232,178,59,.5);border-radius:10px;
                    color:var(--mgu-encre-900);font-size:.95rem;font-weight:700;cursor:pointer;
                    font-family:inherit;">
                    📤 Envoyer mon estimation
                </button>
            </div>`;

        $('jpp-input')?.addEventListener('keypress', e => {
            if (e.key === 'Enter') $('jpp-btn-send')?.click();
        });
        $('jpp-btn-send')?.addEventListener('click', () => {
            const inp = $('jpp-input');
            const val = inp ? inp.value.trim() : '';
            if (!val) return;
            this._soumettre(val);
        });
    },

    _verrouillerSaisie() {
        const inp = $('jpp-input'); if (inp) inp.disabled = true;
        const btn = $('jpp-btn-send');
        if (btn) {
            btn.disabled    = true;
            btn.textContent = '⏳ Estimation envoyée';
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
            const correct = (r.points || 0) > 0;
            const bg   = correct ? 'rgba(95,167,119,.15)' : 'rgba(214,72,79,.12)';
            const bd   = correct ? 'rgba(95,167,119,.35)' : 'rgba(214,72,79,.25)';
            const ecartTxt = (typeof r.ecart === 'number') ? `${(r.ecart * 100).toFixed(1)}%` : '—';
            const badgePP  = r.estPlusProche ? ' 🎯' : '';
            const badge = correct
                ? `<span style="color:#2f5f42;font-weight:700;">+${r.points}pt${r.points !== 1 ? 's' : ''}${badgePP}</span>`
                : `<span style="color:#8a2f33;">0pt</span>`;
            return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;
                background:${bg};border:1px solid ${bd};border-radius:10px;margin-bottom:6px;font-size:.85rem;flex-wrap:wrap;">
                <span style="font-weight:700;min-width:80px;color:${isMe ? 'var(--mgu-or-600)' : '#fff'};">
                    ${isMe ? '👤 ' : ''}${esc(r.pseudo)}</span>
                <span style="font-style:italic;color:var(--mgu-encre-600);">${esc(String(r.estimation))}€</span>
                <span style="flex:1;font-size:.75rem;color:var(--mgu-encre-600);text-align:right;">${ecartTxt}</span>
                ${badge}
            </div>`;
        }).join('');

        cont.innerHTML = `
            <div style="padding:1rem 0;display:flex;flex-direction:column;gap:1rem;">
                <div style="text-align:center;padding:.8rem;
                    background:rgba(232,178,59,.1);border:1.5px solid rgba(232,178,59,.35);
                    border-radius:12px;">
                    <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.12em;
                        color:rgba(232,178,59,.85);margin-bottom:4px;font-weight:700;">
                        Manche ${payload.manche || '?'} — Prix réel
                    </div>
                    <div style="font-size:1.4rem;font-weight:900;color:var(--mgu-or-600);">
                        ${esc(payload.produit?.prix || '—')}
                    </div>
                    <div style="font-size:.78rem;color:var(--mgu-encre-600);margin-top:4px;">
                        ${esc(payload.produit?.nom || '')}
                    </div>
                </div>
                ${lignes}
                <p style="text-align:center;font-size:.85rem;color:var(--mgu-encre-600);margin:0;">
                    En attente du prochain produit…
                </p>
            </div>`;
    },

    _soumettre(estimation) {
        if (this._aSoumis) return;
        try {
            this._socket.send('PLAYER_ACTION', {
                action: 'justeprix:answer',
                data: { estimation },
            });
        } catch (err) {
            console.error('[JPP] send answer:', err.message);
        }
    },

    // ─────────────────────────────────────────────────────
    // Timer
    // ─────────────────────────────────────────────────────

    _demarrerTimer() {
        this._arreterTimer();
        const compute = () => Math.max(0, Math.ceil((this._tsDebut + this._dureeMs - Date.now()) / 1000));
        const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
        const render = () => {
            const t = $('jpp-timer'); if (!t) return;
            const r = compute();
            t.textContent = fmt(r);
            if (r <= 5 && r > 0) t.style.color = '#8a2f33';
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

JeuRegistry.register('justeprix', JusteprixModule);
console.log('[JPP] ✅ JusteprixModule enregistré dans JeuRegistry');