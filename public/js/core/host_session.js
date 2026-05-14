// /js/core/host_session.js — v4.1 (rewritten & corrected)
// ============================================================
// HostSession — Gestion centralisée de la session WebSocket
// ============================================================

import { GameState } from './state.js';
import { socket } from './socket.js';
import {
    setPartieSessionId,
    mettreAJourLienInvitation,
    resetPartieSessionId
} from '../modules/invite.js';
import { resetEtatQuizHote } from '../core/cleanup.js';

const HostSession = {
    _partieId: null,
    _snapshot: null,
    _authenticated: false,
    _pendingStart: false,

    // ---------------------------------------------------------
    // RESET LOCAL
    // ---------------------------------------------------------
    reset() {
        this._partieId = null;
        this._snapshot = null;
        this._pendingStart = false;
        console.log('[HOST] 🔄 HostSession reset');
    },

    // ---------------------------------------------------------
    // INITIALISATION WS
    // ---------------------------------------------------------
    init() {
        try {
            socket.connect();

            socket.once('__connected__', () => {
                console.log('[HOST] 🔌 Socket connecté → authentification…');
                socket.send('HOST_AUTH');
            });

            socket.on('AUTH_OK', () => {
                console.log('[HOST] ✅ Authentifié');
                this._authenticated = true;

                const saved = localStorage.getItem('minigame_partie_id');
                if (saved) {
                    console.log('[HOST] 🔄 Rejoin demandé —', saved);
                    socket.send('HOST_REJOIN', { partieId: saved });
                    return;
                }

                console.log('[HOST] ℹ️ Aucun ID sauvegardé — prêt à créer');
            });

            socket.on('HOST_REJOINED', ({ partieId, snapshot, joinUrl }) => {
                console.log('[HOST] 🔄 Rejoin OK —', partieId);
                this._partieId = partieId;
                this._snapshot = snapshot;
                this._afficherLienJoin(joinUrl, snapshot?.codeCourt);
            });

            socket.on('GAME_CREATED', ({ partieId, snapshot, joinUrl }) => {
                console.log('[HOST] 🎉 Partie créée —', partieId);

                this._partieId = partieId;
                this._snapshot = snapshot;

                localStorage.setItem('minigame_partie_id', partieId);

                // Mise à jour du lien d’invitation
                setPartieSessionId(partieId);
                mettreAJourLienInvitation();

                this._afficherLienJoin(joinUrl, snapshot?.codeCourt);

                if (this._pendingStart) {
                    this._pendingStart = false;
                    socket.send('HOST_START_GAME', { partieId });
                    console.log('[HOST] ▶️ HOST_START_GAME différé envoyé');
                }
            });

            socket.on('PLAYER_JOINED', ({ pseudo, joueurs }) => {
                console.log(`[HOST] ➕ Joueur rejoint: ${pseudo}`);
                this._afficherCompteurJoueurs(joueurs.length);
                HostSession._syncJoueurRejoint(pseudo);
                HostSession._toastHote(`🎉 ${pseudo} a rejoint !`, 'success');
                this._snapshot = { ...(this._snapshot || {}), joueurs };
            });

            socket.on('PLAYER_LEFT', ({ pseudo, joueurs }) => {
                console.log(`[HOST] ➖ Joueur parti: ${pseudo}`);
                this._afficherCompteurJoueurs(joueurs.length);
                HostSession._syncJoueurParti(pseudo);
                HostSession._toastHote(`${pseudo} a quitté`, 'warning');
                this._snapshot = { ...(this._snapshot || {}), joueurs };
            });

            socket.on('SCORES_UPDATE', ({ scores }) => {
                console.log('[HOST] 📊 Scores mis à jour:', scores);
            });

            socket.on('GAME_ENDED', () => {
                console.log('[HOST] 🏁 Partie terminée');

                this._partieId = null;
                this._snapshot = null;
                this._pendingStart = false;

                localStorage.removeItem('minigame_partie_id');
                localStorage.removeItem('minigame_partie_session_id');

                resetEtatQuizHote();
                resetPartieSessionId();
            });

            socket.on('ERROR', ({ code, message }) => {
                console.warn('[HOST] ⚠️ Erreur WS:', code, message || '');

                if (code === 'GAME_NOT_FOUND') {
                    console.log('[HOST] 🧹 ID périmé supprimé');
                    localStorage.removeItem('minigame_partie_id');
                    localStorage.removeItem('minigame_partie_session_id');

                    this._partieId = null;
                    this._snapshot = null;
                    resetPartieSessionId();

                    if (GameState.joueurs?.length > 0 && GameState.jeu) {
                        this.creerPartie();
                    }
                }

                if (code === 'NAME_TAKEN') {
                    this._toastHote('Nom de partie déjà utilisé.', 'error');
                }
            });

        } catch (err) {
            console.warn('[HOST] ⚠️ Socket indisponible — mode local', err.message);
        }
    },

    // ---------------------------------------------------------
    // CRÉATION DE PARTIE
    // ---------------------------------------------------------
    creerPartie() {
        if (!this._authenticated) return;
        if (this._partieId) return;

        const nom = GameState.partieNom || 'Partie';
        const jeu = GameState.jeu || 'quiz';
        const mode = GameState.mode || 'solo';
        const hostPseudo = GameState.joueurs?.[0] || null;

        socket.send('HOST_CREATE_GAME', {
            nom,
            jeu,
            mode,
            equipes: [],
            hostJoue: !!hostPseudo,
            hostPseudo,
        });

        console.log('[HOST] 📤 HOST_CREATE_GAME envoyé');
    },

    // ---------------------------------------------------------
    // DÉMARRAGE
    // ---------------------------------------------------------
    notifierDemarrage() {
        if (!this._authenticated) return;

        if (this._partieId) {
            socket.send('HOST_START_GAME', { partieId: this._partieId });
            console.log('[HOST] ▶️ HOST_START_GAME');
        } else {
            this._pendingStart = true;
            this.creerPartie();
        }
    },

    // ---------------------------------------------------------
    // FIN
    // ---------------------------------------------------------
    terminer() {
        if (!this._authenticated || !this._partieId) return;
        socket.send('HOST_END_GAME');
        console.log('[HOST] ⏹️ HOST_END_GAME');
    },

    // ---------------------------------------------------------
    // UI + SYNC HELPERS
    // ---------------------------------------------------------
    _syncJoueurRejoint(pseudo) {
        if (!pseudo) return;

        if (!GameState.joueurs.includes(pseudo)) {
            GameState.joueurs.push(pseudo);
            GameState.scores[pseudo] = GameState.scores[pseudo] ?? 0;
        }

        const container = document.getElementById('joueurs-selectionnes-container');
        if (!container) return;

        if (container.querySelector(`[data-joueur="${CSS.escape(pseudo)}"]`)) return;

        const div = document.createElement('div');
        div.className = 'joueur-tag';
        div.dataset.joueurWs = pseudo;
        div.innerHTML = `
            <span class="nom">${_escHtml(pseudo)}</span>
            <span class="remove" data-joueur="${_escHtml(pseudo)}">✖</span>`;

        div.querySelector('.remove').addEventListener('click', () => {
            if (HostSession._partieId) {
                socket.send('HOST_KICK_PLAYER', { pseudo });
            }
            HostSession._syncJoueurParti(pseudo);
        });

        container.appendChild(div);
    },

    _syncJoueurParti(pseudo) {
        GameState.joueurs = (GameState.joueurs || []).filter(j => j !== pseudo);
        delete GameState.scores[pseudo];

        const container = document.getElementById('joueurs-selectionnes-container');
        if (!container) return;

        const tag = container.querySelector(`[data-joueur="${CSS.escape(pseudo)}"]`);
        tag?.closest('.joueur-tag')?.remove();
    },

    _toastHote(msg, type = 'info') {
        const COLORS = { success: '#22c55e', error: '#ef4444', warning: '#f59e0b', info: '#00d4ff' };
        const ICONS = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };

        let c = document.getElementById('host-toast-container');
        if (!c) {
            c = document.createElement('div');
            c.id = 'host-toast-container';
            c.style.cssText =
                'position:fixed;bottom:1.5rem;right:1.5rem;z-index:9999;display:flex;flex-direction:column;gap:.4rem;max-width:320px;pointer-events:none;';
            document.body.appendChild(c);
        }

        const el = document.createElement('div');
        el.style.cssText = [
            'display:flex;gap:.5rem;align-items:center;padding:.65rem .9rem;border-radius:10px',
            `background:#1e1e2e;color:#fff;border-left:3px solid ${COLORS[type]}`,
            'box-shadow:0 4px 16px rgba(0,0,0,.5)',
            'opacity:0;transition:opacity .25s,transform .25s;transform:translateY(6px)',
            'font-size:.88rem;font-weight:600;pointer-events:auto',
        ].join(';');

        el.innerHTML = `<span>${ICONS[type]}</span><span>${msg}</span>`;
        c.appendChild(el);

        requestAnimationFrame(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        });

        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(6px)';
            setTimeout(() => el.remove(), 260);
        }, 4000);
    },

    _afficherLienJoin(joinUrl, code) {
        const el = document.getElementById('ws-join-info');
        if (!el || !joinUrl) return;

        const url = `${location.origin}${joinUrl}`;
        el.innerHTML = `
            <div style="margin-top:12px;padding:10px 14px;background:rgba(0,212,255,.08);
                border:1px solid rgba(0,212,255,.25);border-radius:10px;font-size:.82rem;
                color:rgba(255,255,255,.85);text-align:center;">
                🔗 Lien invités :
                <a href="${url}" target="_blank" style="color:#00d4ff;word-break:break-all;">${url}</a>
                ${code ? `<br><strong style="font-size:1.1rem;letter-spacing:.15em;color:#fff;">${code}</strong>` : ''}
            </div>`;
        el.style.display = 'block';
    },

    _afficherCompteurJoueurs(count) {
        const el = document.getElementById('ws-joueurs-count');
        if (el) {
            el.textContent = `${count} joueur${count > 1 ? 's' : ''} connecté${count > 1 ? 's' : ''}`;
        }
    },
};

function _escHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export default HostSession;
