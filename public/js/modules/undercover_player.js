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
    Civil:       { icon: '🟢', label: 'Civil',        color: '#4ade80', conseil: 'Décris ton mot sans le dire. Repère l\'imposteur !' },
    Undercover:  { icon: '🔴', label: 'Undercover',   color: '#f87171', conseil: 'Ton mot est légèrement différent. Fonds-toi dans la masse !' },
    MisterWhite: { icon: '🎩', label: 'Mister White', color: '#fbbf24', conseil: 'Pas de mot. Écoute et improvise !' },
};

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

        const cfg = ROLE_CFG[this._myRole] || ROLE_CFG.Civil;
        const theme = this._theme
            ? `<div style="font-size:.82rem;color:rgba(255,255,255,.6);background:rgba(167,139,250,.12);
                 border:1px solid rgba(167,139,250,.25);border-radius:20px;padding:5px 14px;">🏷️ ${esc(this._theme)}</div>`
            : '';
        const motBloc = this._myMot !== null
            ? `<div style="text-align:center;margin-top:.5rem;">
                   <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.1em;color:rgba(255,255,255,.5);">Ton mot</div>
                   <div style="font-size:1.7rem;font-weight:900;color:#fff;">${esc(this._myMot)}</div>
               </div>`
            : `<div style="text-align:center;margin-top:.5rem;">
                   <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.1em;color:rgba(255,255,255,.5);">Ton mot</div>
                   <div style="font-size:1.4rem;font-weight:900;color:#fbbf24;">???</div>
                   <div style="font-size:.78rem;color:rgba(255,255,255,.5);">Pas de mot — improvise !</div>
               </div>`;

        if (this._roleVu) {
            this._setHTML(`
                <div style="display:flex;flex-direction:column;align-items:center;gap:1rem;padding:2rem 1rem;text-align:center;">
                    <div style="font-size:2.4rem;">${cfg.icon}</div>
                    <div style="font-size:1.1rem;font-weight:800;color:${cfg.color};">${cfg.label}</div>
                    ${motBloc}
                    <p style="color:#86efac;font-weight:700;margin:.5rem 0 0;">✅ Rôle mémorisé</p>
                    <p style="color:rgba(255,255,255,.45);font-size:.85rem;margin:0;">En attente du lancement du débat par l'hôte…</p>
                </div>`);
            return;
        }

        this._setHTML(`
            <div style="display:flex;flex-direction:column;align-items:center;gap:1rem;padding:1.5rem 1rem;text-align:center;">
                <h2 style="margin:0;font-size:1.15rem;">Ta carte</h2>
                ${theme}
                <div style="background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.1);border-radius:16px;
                    padding:1.25rem 1.5rem;min-width:240px;max-width:320px;width:100%;">
                    <div style="font-size:2.4rem;">${cfg.icon}</div>
                    <div style="font-size:1.2rem;font-weight:900;color:${cfg.color};margin-top:.25rem;">${cfg.label}</div>
                    ${motBloc}
                </div>
                <p style="color:rgba(255,255,255,.6);font-size:.85rem;max-width:300px;margin:.25rem 0 0;">${cfg.conseil}</p>
                <button id="ucp-role-vu" style="margin-top:.5rem;padding:12px 28px;border:none;border-radius:10px;
                    background:linear-gradient(135deg,#6a5af9,#8a2be2);color:#fff;font-weight:700;font-size:.95rem;
                    cursor:pointer;font-family:inherit;">✅ C'est noté</button>
            </div>`);

        $('ucp-role-vu')?.addEventListener('click', () => {
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