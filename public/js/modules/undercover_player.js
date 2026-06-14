// ================================================================
// public/js/modules/undercover_player.js
// ================================================================
// Emplacement : public/js/modules/undercover_player.js
//
// Module invité Undercover. Piloté 100% par WebSocket via player.js :
//   - reçoit l'état PUBLIC :  HOST_ACTION 'undercover:state'  → onHostAction
//   - reçoit son rôle PRIVÉ : HOST_ACTION 'undercover:role'   → onHostAction
//   - reçoit reset :          HOST_ACTION 'undercover:reset'
//   - resync (re)connexion :  gameState passé à initPlayer()
//
// Envoie (PLAYER_ACTION) :
//   undercover:role_vu        { }
//   undercover:vote           { cible }
//   undercover:mw_guess       { mot }
//   undercover:resync_role    { }   (au démarrage, pour récupérer sa carte)
//
// Enregistré dans JeuRegistry sous la clé 'undercover' (voir bas de fichier).
// Importé par jeu.js (effet de bord).
// ================================================================

import { JeuRegistry } from './player.js';

const $   = id => document.getElementById(id);
const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ROLE_CFG = {
    Civil:       { cls: 'civil',      icon: '🟢', label: 'Civil',        color: '#4ade80', glow: 'radial-gradient(circle at 50% 0%,rgba(74,222,128,.4) 0%,transparent 65%)',  conseil: 'Tu es un <strong>Civil</strong>. Décris ton mot sans le dire. Repère l\'imposteur !' },
    Undercover:  { cls: 'undercover', icon: '🔴', label: 'Undercover',   color: '#f87171', glow: 'radial-gradient(circle at 50% 0%,rgba(248,113,113,.4) 0%,transparent 65%)', conseil: 'Tu es l\'<strong>Undercover</strong>. Ton mot est légèrement différent. Fonds-toi dans la masse !' },
    MisterWhite: { cls: 'mw',         icon: '🎩', label: 'Mister White', color: '#fbbf24', glow: 'radial-gradient(circle at 50% 0%,rgba(251,191,36,.4) 0%,transparent 65%)',  conseil: 'Tu es le <strong>Mister White</strong>. Pas de mot. Écoute et improvise !' },
};
const _cfg = role => ROLE_CFG[role] || { cls: 'civil', icon: '❓', label: role || '—', color: '#fff', glow: '', conseil: '' };

// ── CSS des cartes (la page invité ne charge pas style.css) ──
// Repris à l'identique du CSS injecté côté hôte pour une carte cohérente.
function _injectCSS() {
    if (document.getElementById('uc-player-card-css')) return;
    const s = document.createElement('style');
    s.id = 'uc-player-card-css';
    s.textContent = `
.uc-distrib-wrap-player { display:flex; flex-direction:column; align-items:center; gap:14px; padding:18px 12px 24px; }
.uc-distrib-titre-player { margin:0; font-size:1.1rem; font-weight:800; color:#fff; text-align:center; }
.uc-waiting-player { font-size:.85rem; color:rgba(255,255,255,.45); text-align:center; margin:.25rem 0 0; }

.uc-carte-slot { display:flex; flex-direction:column; align-items:center; gap:8px; }
.uc-carte-nom { font-size:.72rem; font-weight:700; letter-spacing:.07em; color:rgba(255,255,255,.45); text-transform:uppercase; }
.uc-carte-nom--moi { color:#c4b5fd; }

.uc-scene { border-radius:16px; width:120px; height:168px; perspective:900px; }
.uc-scene--moi { width:200px; height:280px; cursor:pointer; outline:none; -webkit-tap-highlight-color:transparent; }
.uc-scene--moi:focus-visible { box-shadow:0 0 0 3px rgba(167,139,250,.6); border-radius:16px; }

.uc-card3d { width:100%; height:100%; position:relative; transform-style:preserve-3d; transition:transform .65s cubic-bezier(.4,0,.2,1); border-radius:16px; }
.uc-card3d--flip { transform:rotateY(180deg); }
.uc-card3d--vu { box-shadow:0 0 0 2px rgba(74,222,128,.55), 0 0 16px rgba(74,222,128,.2); }

.uc-face { position:absolute; inset:0; border-radius:16px; backface-visibility:hidden; -webkit-backface-visibility:hidden; overflow:hidden; }

.uc-dos { background:linear-gradient(150deg,#1e1240 0%,#0b0718 100%); border:1.5px solid rgba(167,139,250,.22); display:flex; flex-direction:column; align-items:center; justify-content:center; box-shadow:0 10px 32px rgba(0,0,0,.5); }
.uc-dos-inner { display:flex; flex-direction:column; align-items:center; gap:8px; user-select:none; }
.uc-dos-logo { font-size:2.6rem; filter:drop-shadow(0 0 12px rgba(167,139,250,.6)); animation:ucp-float 3s ease-in-out infinite; }
@keyframes ucp-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
.uc-dos-label { font-size:.62rem; font-weight:800; letter-spacing:.2em; color:rgba(167,139,250,.45); text-transform:uppercase; }
.uc-dos-hint { position:absolute; bottom:12px; font-size:.62rem; font-weight:700; letter-spacing:.12em; color:rgba(255,255,255,.28); text-transform:uppercase; animation:ucp-blink 2.4s ease-in-out infinite; }
@keyframes ucp-blink { 0%,100%{opacity:.28} 50%{opacity:.7} }

.uc-face-front { transform:rotateY(180deg); border:1.5px solid rgba(255,255,255,.1); box-shadow:0 10px 32px rgba(0,0,0,.5); display:flex; align-items:stretch; }
.uc-face-front--civil      { background:linear-gradient(160deg,#0d2218 0%,#060e0b 100%); border-color:rgba(74,222,128,.28); }
.uc-face-front--undercover { background:linear-gradient(160deg,#22100d 0%,#0e0606 100%); border-color:rgba(248,113,113,.28); }
.uc-face-front--mw         { background:linear-gradient(160deg,#21180a 0%,#0e0d05 100%); border-color:rgba(251,191,36,.28); }
.uc-face-glow { position:absolute; inset:0; pointer-events:none; border-radius:14px; }
.uc-face-inner { position:relative; z-index:1; width:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; padding:18px 12px; box-sizing:border-box; }
.uc-role-icon { font-size:2.2rem; line-height:1; }
.uc-role-name { font-size:.95rem; font-weight:900; letter-spacing:.04em; text-transform:uppercase; text-align:center; }
.uc-sep { width:32px; height:1.5px; background:rgba(255,255,255,.1); border-radius:2px; }

.uc-mot-bloc { display:flex; flex-direction:column; align-items:center; gap:4px; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.08); border-radius:10px; padding:10px 12px; width:100%; box-sizing:border-box; text-align:center; }
.uc-mot-mw  { border-color:rgba(251,191,36,.18); background:rgba(251,191,36,.04); }
.uc-mot-lab { font-size:.55rem; font-weight:800; letter-spacing:.2em; color:rgba(255,255,255,.35); text-transform:uppercase; }
.uc-mot-val { font-size:1.25rem; font-weight:900; color:#fff; word-break:break-word; }
.uc-mot-sub { font-size:.66rem; color:rgba(251,191,36,.65); font-style:italic; }
.uc-theme-pill { font-size:.64rem; font-weight:600; color:rgba(255,255,255,.4); background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.07); border-radius:14px; padding:2px 10px; }

.uc-confirm-bloc { width:200px; }
.uc-conseil { font-size:.8rem; color:rgba(255,255,255,.6); text-align:center; line-height:1.6; margin:0 0 10px; }
.uc-conseil strong { color:rgba(255,255,255,.92); }
.uc-vu-msg { font-size:.85rem; color:rgba(74,222,128,.9); text-align:center; padding:8px 0; margin:0; }
.uc-btn-ok { display:block; width:100%; padding:12px; background:linear-gradient(135deg,#059669,#047857); border:none; border-radius:12px; color:#fff; font-size:.9rem; font-weight:800; cursor:pointer; font-family:inherit; box-shadow:0 3px 12px rgba(5,150,105,.3); transition:transform .15s, box-shadow .15s; }
.uc-btn-ok:hover { transform:translateY(-2px); box-shadow:0 5px 18px rgba(5,150,105,.45); }
    `;
    document.head.appendChild(s);
}

export const UndercoverPlayerModule = {

    _session : null,
    _socket  : null,
    _pseudo  : null,

    _myRole  : null,
    _myMot   : null,
    _theme   : null,
    _roleVu  : false,

    _state   : null,   // dernier état public reçu
    _voted   : false,  // a voté dans le round courant
    _mwSent  : false,  // a envoyé sa devinette MW

    // ──────────────────────────────────────────────────────────
    initPlayer(session, socket, gameState /*, snapshot */) {
        this._session = session;
        this._socket  = socket;
        this._pseudo  = session.pseudo;

        this._myRole = null; this._myMot = null; this._theme = null;
        this._roleVu = false; this._state = null; this._voted = false; this._mwSent = false;

        _injectCSS();
        this._renderAttente('Distribution des rôles en cours…');

        // Demander son rôle privé (utile surtout en reconnexion / arrivée tardive)
        this._send('undercover:resync_role', {});

        // Resync : état public mémorisé côté serveur
        if (gameState && gameState.action === 'undercover:state' && gameState.data) {
            this._applyState(gameState.data);
        }
    },

    destroy() { /* aucun timer local à nettoyer */ },

    onScores() {},

    // Tous les HOST_ACTION arrivent ici via player.js
    onHostAction(action, data) {
        if (!action || !action.startsWith('undercover:')) return;
        const cmd = action.split(':')[1];

        if (cmd === 'role') {
            if (data && data.pseudo && data.pseudo !== this._pseudo) return; // pas pour moi
            this._myRole = data.role || 'Civil';
            this._myMot  = data.mot ?? null;
            this._theme  = data.theme ?? this._theme;
            // Si on est en distribution, (re)dessiner la carte
            if (!this._state || this._state.phase === 'distribution') this._renderDistribution();
            return;
        }

        if (cmd === 'state') { this._applyState(data); return; }

        if (cmd === 'reset') {
            this._myRole = null; this._myMot = null; this._roleVu = false;
            this._state = null; this._voted = false; this._mwSent = false;
            this._renderAttente('Nouvelle partie — distribution en cours…');
            this._send('undercover:resync_role', {});
            return;
        }
    },

    // ──────────────────────────────────────────────────────────
    _applyState(st) {
        if (!st || typeof st.phase !== 'string') return;
        const prev = this._state;
        this._state = st;
        if (st.theme) this._theme = st.theme;

        // Réinitialiser le flag vote à chaque nouveau round de vote
        if (st.phase === 'vote' && (!prev || prev.phase !== 'vote')) this._voted = false;
        if (st.phase !== 'vote') this._voted = this._voted && st.phase === 'vote';

        switch (st.phase) {
            case 'distribution': this._renderDistribution(); break;
            case 'debat':        this._renderDebat();        break;
            case 'vote':         this._renderVote();         break;
            case 'elimination':  this._renderElimination();  break;
            case 'fin':          this._renderFin();          break;
            default:             this._renderAttente('En attente…');
        }
    },

    _send(action, data) {
        try { this._socket.send('PLAYER_ACTION', { action, data: data || {} }); }
        catch (e) { console.error('[UC-PLAYER] send', action, e); }
    },

    _setHTML(html) { const c = $('jeu-contenu'); if (c) c.innerHTML = html; },

    // ──────────────────────────────────────────────────────────
    // ÉCRANS
    // ──────────────────────────────────────────────────────────
    _renderAttente(msg) {
        this._setHTML(`
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                min-height:55vh;text-align:center;padding:2rem;gap:1.25rem;">
                <div style="width:42px;height:42px;border:4px solid rgba(167,139,250,.2);
                    border-top-color:#a78bfa;border-radius:50%;animation:ucp-spin .9s linear infinite;"></div>
                <p style="color:rgba(255,255,255,.7);margin:0;font-size:.95rem;">${esc(msg)}</p>
            </div>
            <style>@keyframes ucp-spin{to{transform:rotate(360deg)}}</style>`);
    },

    _renderDistribution() {
        if (!this._myRole) { this._renderAttente('Distribution des rôles en cours…'); return; }

        const role = this._myRole;
        const mot  = this._myMot; // null pour Mister White
        const cfg  = _cfg(role);

        const motHTML = mot !== null
            ? `<div class="uc-mot-bloc"><span class="uc-mot-lab">TON MOT</span><span class="uc-mot-val">${esc(mot)}</span></div>`
            : `<div class="uc-mot-bloc uc-mot-mw"><span class="uc-mot-lab">TON MOT</span><span class="uc-mot-val">???</span><span class="uc-mot-sub">Pas de mot — improvise !</span></div>`;
        const themeHTML = this._theme ? `<div class="uc-theme-pill">🏷️ ${esc(this._theme)}</div>` : '';

        // ── État « rôle déjà mémorisé » : carte retournée + verrouillée ──
        if (this._roleVu) {
            this._setHTML(`
                <div class="uc-distrib-wrap-player">
                    <h2 class="uc-distrib-titre-player">Ta carte</h2>
                    <div class="uc-carte-slot" data-pseudo="${esc(this._pseudo)}">
                        <div class="uc-carte-nom uc-carte-nom--moi">👤 Moi</div>
                        <div class="uc-scene uc-scene--moi" aria-hidden="true">
                            <div class="uc-card3d uc-card3d--flip uc-card3d--vu">
                                <div class="uc-face uc-dos">
                                    <div class="uc-dos-inner"><span class="uc-dos-logo">🕵️</span><span class="uc-dos-label">UNDERCOVER</span></div>
                                </div>
                                <div class="uc-face uc-face-front uc-face-front--${cfg.cls}">
                                    <div class="uc-face-glow" style="background:${cfg.glow}"></div>
                                    <div class="uc-face-inner">
                                        <div class="uc-role-icon">${cfg.icon}</div>
                                        <div class="uc-role-name" style="color:${cfg.color}">${cfg.label}</div>
                                        <div class="uc-sep"></div>
                                        ${motHTML}
                                        ${themeHTML}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="uc-confirm-bloc"><p class="uc-vu-msg">✅ Rôle mémorisé !</p></div>
                    </div>
                    <p class="uc-waiting-player">En attente du lancement du débat par l'hôte…</p>
                </div>`);
            return;
        }

        // ── Carte cliquable : flip → conseil + bouton « C'est noté » ──
        this._setHTML(`
            <div class="uc-distrib-wrap-player">
                <h2 class="uc-distrib-titre-player">Appuie sur ta carte</h2>
                <div class="uc-carte-slot" data-pseudo="${esc(this._pseudo)}">
                    <div class="uc-carte-nom uc-carte-nom--moi">👤 Moi</div>
                    <div class="uc-scene uc-scene--moi" id="uc-p-scene" role="button" tabindex="0">
                        <div class="uc-card3d" id="uc-p-card">
                            <div class="uc-face uc-dos">
                                <div class="uc-dos-inner"><span class="uc-dos-logo">🕵️</span><span class="uc-dos-label">UNDERCOVER</span></div>
                                <span class="uc-dos-hint">Appuie pour révéler</span>
                            </div>
                            <div class="uc-face uc-face-front uc-face-front--${cfg.cls}">
                                <div class="uc-face-glow" style="background:${cfg.glow}"></div>
                                <div class="uc-face-inner">
                                    <div class="uc-role-icon">${cfg.icon}</div>
                                    <div class="uc-role-name" style="color:${cfg.color}">${cfg.label}</div>
                                    <div class="uc-sep"></div>
                                    ${motHTML}
                                    ${themeHTML}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="uc-confirm-bloc" id="uc-p-confirm" hidden>
                        <p class="uc-conseil">${cfg.conseil}</p>
                        <button class="uc-btn-ok" id="uc-p-btnok">✅ C'est noté</button>
                    </div>
                </div>
            </div>`);

        const scene   = $('uc-p-scene');
        const card    = $('uc-p-card');
        const confirm = $('uc-p-confirm');
        let flipped   = false;

        const flip = () => {
            if (flipped) return;
            flipped = true;
            card?.classList.add('uc-card3d--flip');
            if (confirm) {
                setTimeout(() => {
                    confirm.hidden = false;
                    confirm.style.opacity    = '0';
                    confirm.style.transform  = 'translateY(10px)';
                    confirm.style.transition = 'opacity .35s, transform .35s';
                    requestAnimationFrame(() => {
                        confirm.style.opacity   = '1';
                        confirm.style.transform = 'translateY(0)';
                    });
                }, 650);
            }
        };

        scene?.addEventListener('click', flip);
        scene?.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); }
        });

        $('uc-p-btnok')?.addEventListener('click', () => {
            this._roleVu = true;
            this._send('undercover:role_vu', {});
            this._renderDistribution();
        });
    },

    _renderDebat() {
        const moiElimine = this._state && !this._state.joueursEnJeu?.includes(this._pseudo);
        const obs = moiElimine
            ? `<div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.25);border-radius:10px;
                 padding:9px 14px;font-size:.82rem;font-weight:700;color:#fca5a5;">👁️ Tu es éliminé — mode observateur</div>`
            : '';
        const motRappel = (!moiElimine && this._myMot !== null)
            ? `<div style="font-size:.9rem;color:rgba(255,255,255,.7);">Ton mot : <strong style="color:#fff;">${esc(this._myMot)}</strong></div>`
            : (!moiElimine && this._myRole === 'MisterWhite'
                ? `<div style="font-size:.9rem;color:#fbbf24;">🎩 Pas de mot — improvise !</div>` : '');

        this._setHTML(`
            <div style="display:flex;flex-direction:column;align-items:center;gap:1rem;padding:2rem 1rem;text-align:center;">
                <div style="font-size:2.4rem;">🗣️</div>
                <h2 style="margin:0;font-size:1.15rem;">Phase de débat</h2>
                ${this._theme ? `<div style="font-size:.82rem;color:rgba(255,255,255,.6);">Thème : <strong>${esc(this._theme)}</strong></div>` : ''}
                ${motRappel}
                ${obs}
                <p style="color:rgba(255,255,255,.45);font-size:.85rem;margin:0;">Décris ton mot à voix haute. En attente de l'ouverture du vote…</p>
            </div>`);
    },

    _renderVote() {
        const st = this._state || {};
        const enJeu = st.joueursEnJeu || [];
        const moiElimine = !enJeu.includes(this._pseudo);
        const tally = st.votesPublics || {};

        const tallyHTML = Object.keys(tally).length
            ? `<div style="width:100%;max-width:340px;display:flex;flex-direction:column;gap:6px;margin-top:.5rem;">
                ${Object.entries(tally).sort((a,b)=>b[1]-a[1]).map(([n,v]) => `
                    <div style="display:flex;justify-content:space-between;background:rgba(255,255,255,.05);
                        border-radius:8px;padding:6px 12px;font-size:.85rem;">
                        <span>${esc(n)}</span><span style="font-weight:700;color:#a78bfa;">${v} vote${v>1?'s':''}</span>
                    </div>`).join('')}
               </div>`
            : '';

        if (moiElimine) {
            this._setHTML(`
                <div style="display:flex;flex-direction:column;align-items:center;gap:1rem;padding:2rem 1rem;text-align:center;">
                    <div style="font-size:2.4rem;">🗳️</div>
                    <h2 style="margin:0;font-size:1.15rem;">Vote en cours</h2>
                    <div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.25);border-radius:10px;
                        padding:9px 14px;font-size:.82rem;font-weight:700;color:#fca5a5;">👁️ Tu es éliminé — tu observes</div>
                    ${tallyHTML}
                </div>`);
            return;
        }

        if (this._voted) {
            this._setHTML(`
                <div style="display:flex;flex-direction:column;align-items:center;gap:1rem;padding:2rem 1rem;text-align:center;">
                    <div style="font-size:2.4rem;">🗳️</div>
                    <h2 style="margin:0;font-size:1.15rem;">Vote enregistré</h2>
                    <p style="color:#86efac;font-weight:700;margin:0;">✅ Ton vote a été pris en compte</p>
                    ${tallyHTML}
                    <p style="color:rgba(255,255,255,.45);font-size:.85rem;margin:0;">En attente des autres votes…</p>
                </div>`);
            return;
        }

        const cands = enJeu.filter(j => j !== this._pseudo);
        this._setHTML(`
            <div style="display:flex;flex-direction:column;align-items:center;gap:1rem;padding:1.5rem 1rem;text-align:center;">
                <div style="font-size:2.4rem;">🗳️</div>
                <h2 style="margin:0;font-size:1.15rem;">Qui suspectes-tu ?</h2>
                <div id="ucp-vote-list" style="width:100%;max-width:340px;display:flex;flex-direction:column;gap:8px;margin-top:.5rem;">
                    ${cands.map(j => `
                        <button class="ucp-vote-btn" data-cible="${esc(j)}"
                            style="display:flex;justify-content:space-between;align-items:center;width:100%;
                                padding:12px 16px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);
                                border-radius:10px;color:#fff;font-weight:700;font-size:.92rem;cursor:pointer;font-family:inherit;">
                            <span>👤 ${esc(j)}</span><span style="opacity:.5;">→</span>
                        </button>`).join('')}
                </div>
                ${tallyHTML}
            </div>`);

        $('ucp-vote-list')?.querySelectorAll('.ucp-vote-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (this._voted) return;
                const cible = btn.getAttribute('data-cible');
                this._voted = true;
                this._send('undercover:vote', { cible });
                this._renderVote();
            });
        });
    },

    _renderElimination() {
        const st = this._state || {};
        const elimine = st.elimine;
        const role    = st.elimineRole;
        const moiElimine = elimine === this._pseudo;

        // Mister White éliminé → s'il s'agit de moi, je peux deviner
        if (st.attenteMW) {
            if (moiElimine && !this._mwSent) {
                this._setHTML(`
                    <div style="display:flex;flex-direction:column;align-items:center;gap:1rem;padding:1.5rem 1rem;text-align:center;">
                        <div style="font-size:2.4rem;">🎩</div>
                        <h2 style="margin:0;font-size:1.15rem;">Tu es éliminé (Mister White) !</h2>
                        <p style="color:rgba(255,255,255,.7);font-size:.88rem;margin:0;">Dernière chance : devine le mot des Civils.</p>
                        <div style="display:flex;gap:8px;width:100%;max-width:340px;margin-top:.5rem;">
                            <input id="ucp-mw-inp" type="text" placeholder="Le mot Civil ?" autocomplete="off"
                                style="flex:1;padding:10px 13px;background:rgba(255,255,255,.08);border:1.5px solid rgba(255,255,255,.2);
                                    border-radius:10px;color:#fff;font-size:.9rem;font-family:inherit;outline:none;">
                            <button id="ucp-mw-btn" style="padding:10px 16px;border:none;border-radius:10px;
                                background:#fbbf24;color:#1a1a2e;font-weight:800;cursor:pointer;font-family:inherit;">🎯</button>
                        </div>
                    </div>`);
                const envoyer = () => {
                    const v = $('ucp-mw-inp')?.value?.trim();
                    if (!v) return;
                    this._mwSent = true;
                    this._send('undercover:mw_guess', { mot: v });
                    this._renderAttente('Réponse envoyée — en attente du résultat…');
                };
                $('ucp-mw-btn')?.addEventListener('click', envoyer);
                $('ucp-mw-inp')?.addEventListener('keydown', e => { if (e.key === 'Enter') envoyer(); });
                return;
            }
            this._renderAttente('🎩 Mister White a été éliminé — il tente de deviner le mot…');
            return;
        }

        const roleLabel = role ? (ROLE_CFG[role]?.label || role) : '';
        const moiMsg = moiElimine
            ? `<div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:12px;
                 padding:12px 16px;color:#fca5a5;font-weight:700;">Tu as été éliminé. Tu passes en observateur.</div>`
            : '';

        this._setHTML(`
            <div style="display:flex;flex-direction:column;align-items:center;gap:1rem;padding:2rem 1rem;text-align:center;">
                <div style="font-size:2.4rem;">❌</div>
                <h2 style="margin:0;font-size:1.15rem;">${esc(elimine || '—')} éliminé</h2>
                ${roleLabel ? `<div style="font-size:.9rem;color:rgba(255,255,255,.7);">Rôle révélé : <strong>${esc(roleLabel)}</strong></div>` : ''}
                ${moiMsg}
                <p style="color:rgba(255,255,255,.45);font-size:.85rem;margin:0;">En attente du tour suivant…</p>
            </div>`);
    },

    _renderFin() {
        const st = this._state || {};
        const roles = st.rolesReveles || {};
        const mots  = st.motsReveles || {};
        const lignes = Object.entries(roles).map(([p, r]) => {
            const cfg = ROLE_CFG[r] || ROLE_CFG.Civil;
            const mot = r === 'Civil' ? (mots.civil || '') : r === 'Undercover' ? (mots.undercover || '') : '???';
            const moi = p === this._pseudo;
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;border-radius:10px;
                background:${moi ? 'rgba(167,139,250,.14)' : 'rgba(255,255,255,.04)'};${moi ? 'outline:1.5px solid rgba(167,139,250,.4);' : ''}">
                <span>${cfg.icon} ${esc(p)}${moi ? ' <em style="opacity:.6;font-size:.8rem;">(toi)</em>' : ''}</span>
                <span style="font-size:.82rem;color:rgba(255,255,255,.65);">${esc(cfg.label)} · ${esc(mot)}</span>
            </div>`;
        }).join('');

        this._setHTML(`
            <div style="display:flex;flex-direction:column;align-items:center;gap:1rem;padding:2rem 1rem;text-align:center;">
                <div style="font-size:3rem;">🏆</div>
                <h2 style="margin:0;font-size:1.2rem;">${esc(st.finMessage || 'Partie terminée !')}</h2>
                <div style="width:100%;max-width:360px;display:flex;flex-direction:column;gap:6px;">${lignes}</div>
                <p style="color:rgba(255,255,255,.45);font-size:.85rem;margin:0;">En attente de l'hôte pour une nouvelle partie…</p>
            </div>`);
    },
};

// Enregistrement dans le registre invité
JeuRegistry.register('undercover', UndercoverPlayerModule);