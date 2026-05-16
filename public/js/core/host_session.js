// /js/core/host_session.js

import { GameState } from './state.js';
import { socket } from './socket.js';

// Callbacks injectés par main.js pour éviter les dépendances circulaires
let _cbRestaurerBouton = null;
let _cbLancerJeu       = null;
let _cbMasquerLoader   = null;

const HostSession = {
    _partieId        : null,
    _snapshot        : null,
    _authenticated   : false,
    _pendingStart    : false,
    _pendingGame     : null,
    _creationEnCours : false,
    _partieStarted   : false,
    _wsHandlersAdded : false,

    reset() {
        this._partieId        = null;
        this._snapshot        = null;
        this._pendingStart    = false;
        this._pendingGame     = null;
        this._creationEnCours = false;
        this._partieStarted   = false;
        this._wsHandlersAdded = false;
        console.log('[HOST] 🔄 HostSession reset (nouvelle partie)');
    },

    setCallbacks({ restaurerBouton, lancerJeu, masquerLoader }) {
        _cbRestaurerBouton = restaurerBouton || null;
        _cbLancerJeu       = lancerJeu       || null;
        _cbMasquerLoader   = masquerLoader   || null;
    },

    init() {
        if (this._wsHandlersAdded) return;
        this._wsHandlersAdded = true;

        try {
            socket.connect();

            socket.once('__connected__', () => {
                console.log('[HOST] Socket connecté — authentification...');
                socket.send('HOST_AUTH');
            });

            socket.on('AUTH_OK', () => {
                console.log('[HOST] ✅ Authentifié');
                this._authenticated = true;

                // Masquer le loader une fois authentifié
                if (_cbMasquerLoader) _cbMasquerLoader(false);

                const savedId = localStorage.getItem('minigame_partie_id');
                if (savedId) {
                    console.log('[HOST] 🔄 HOST_REJOIN —', savedId);
                    socket.send('HOST_REJOIN', { partieId: savedId });
                    return;
                }
                console.log('[HOST] ℹ️ Pas de partie sauvegardée — prêt à créer');
            });

            socket.on('HOST_REJOINED', ({ partieId, snapshot, joinUrl }) => {
                console.log('[HOST] ✅ Rejoin host OK —', partieId);
                this._partieId        = partieId;
                this._snapshot        = snapshot;
                this._creationEnCours = false;

                localStorage.setItem('minigame_partie_id', partieId);

                import('../modules/invite.js').then(m => {
                    m.setPartieSessionId(partieId);
                    m.afficherBlocInvitation();
                }).catch(err => console.warn('[HOST] ⚠️ Erreur import invite.js:', err.message));

                this._afficherLienJoin(joinUrl, snapshot?.codeCourt);
            });

            socket.on('GAME_CREATED', ({ partieId, snapshot, joinUrl }) => {
                console.log('[HOST] ✅ Partie créée —', partieId);

                this._partieId        = partieId;
                this._snapshot        = snapshot;
                this._creationEnCours = false;

                localStorage.setItem('minigame_partie_id', partieId);

                import('../modules/invite.js').then(m => {
                    m.setPartieSessionId(partieId);
                    m.afficherBlocInvitation();
                }).catch(err => console.warn('[HOST] ⚠️ Erreur invite.js:', err.message));

                this._afficherLienJoin(joinUrl, snapshot?.codeCourt);

                const gameALancer = this._pendingGame;
                this._pendingGame = null;

                if (gameALancer) {
                    try {
                        socket.send('HOST_START_GAME', { partieId });
                        console.log('[HOST] 📤 HOST_START_GAME —', partieId);
                    } catch (err) {
                        console.error('[HOST] ❌ HOST_START_GAME:', err.message);
                    }
                    if (_cbRestaurerBouton) _cbRestaurerBouton();
                    if (_cbLancerJeu) {
                        console.log('[HOST] 🎮 Lancement du jeu —', gameALancer);
                        this._partieStarted = true;
                        _cbLancerJeu(gameALancer, { fromServer: true });
                    }
                }
            });

            socket.on('PLAYER_JOINED', ({ pseudo, joueurs }) => {
                console.log(`[HOST] 👤 Joueur rejoint: ${pseudo} (${joueurs.length} total)`);
                this._afficherCompteurJoueurs(joueurs.length);
                HostSession._syncJoueurRejoint(pseudo);
                HostSession._toastHote(`🎉 ${pseudo} a rejoint la partie !`, 'success');
                this._snapshot = { ...(this._snapshot || {}), joueurs };
            });

            socket.on('PLAYER_LEFT', ({ pseudo, joueurs }) => {
                console.log(`[HOST] 👤 Joueur parti: ${pseudo}`);
                this._afficherCompteurJoueurs(joueurs.length);
                HostSession._syncJoueurParti(pseudo);
                HostSession._toastHote(`${pseudo} a quitté la partie`, 'warning');
                this._snapshot = { ...(this._snapshot || {}), joueurs };
            });

            socket.on('SCORES_UPDATE', ({ scores }) => {
                console.log('[HOST] 📊 Scores mis à jour:', scores);
            });

            socket.on('GAME_ENDED', () => {
                console.log('[HOST] 🏁 Partie terminée (WS)');

                this._partieId        = null;
                this._snapshot        = null;
                this._pendingStart    = false;
                this._pendingGame     = null;
                this._creationEnCours = false;

                localStorage.removeItem('minigame_partie_id');
                localStorage.removeItem('minigame_partie_session_id');

                import('./cleanup.js').then(m => {
                    if (typeof m.resetEtatQuizHote === 'function') m.resetEtatQuizHote();
                }).catch(() => {});

                import('../modules/invite.js').then(m => {
                    if (typeof m.resetPartieSessionId === 'function') m.resetPartieSessionId();
                }).catch(() => {});
            });

            socket.on('ERROR', ({ code, message }) => {
                console.warn('[HOST] ⚠️ Erreur WS:', code, message || '');
                this._creationEnCours = false;

                if (code === 'GAME_NOT_FOUND') {
                    console.log('[HOST] 🧹 ID périmé supprimé — prêt pour une nouvelle partie');
                    localStorage.removeItem('minigame_partie_id');
                    localStorage.removeItem('minigame_partie_session_id');
                    this._partieId    = null;
                    this._snapshot    = null;
                    this._pendingGame = null;

                    import('../modules/invite.js').then(m => {
                        if (typeof m.resetPartieSessionId === 'function') m.resetPartieSessionId();
                    }).catch(() => {});

                    if (_cbRestaurerBouton) _cbRestaurerBouton();
                }

                if (code === 'HOST_ALREADY_HAS_GAME') {
                    console.log('[HOST] ℹ️ Partie déjà active — attente HOST_REJOINED');
                }

                if (code === 'NAME_TAKEN') {
                    console.warn('[HOST] ⚠️ Nom de partie déjà pris :', GameState.partieNom);
                    this._partieId    = null;
                    this._pendingGame = null;

                    if (_cbRestaurerBouton) _cbRestaurerBouton();

                    this._toastHote(
                        'Ce nom de partie est déjà utilisé. Choisissez un autre nom.',
                        'error'
                    );
                }

                if (code === 'INTERNAL_ERROR') {
                    console.error('[HOST] ❌ INTERNAL_ERROR — vérifier logs serveur');
                    this._pendingGame = null;
                    if (_cbRestaurerBouton) _cbRestaurerBouton();
                    this._toastHote('Erreur serveur temporaire. Réessaie dans quelques secondes.', 'error');
                }
            });

            // Gérer les échecs de reconnexion
            socket.on('__reconnect_failed__', () => {
                console.error('[HOST] ❌ Reconnexion échouée après 5 tentatives');
                if (_cbMasquerLoader) _cbMasquerLoader(true); // avec erreur
                this._toastHote('Impossible de se connecter au serveur. Veuillez rafraîchir la page.', 'error');
            });

            // Gérer les timeouts de connexion
            socket.on('__connect_timeout__', () => {
                console.error('[HOST] ⏱️ Timeout connexion WebSocket (10s)');
                if (_cbMasquerLoader) _cbMasquerLoader(true); // avec erreur
                this._toastHote('Le serveur met trop de temps à répondre. Veuillez rafraîchir la page.', 'error');
            });

        } catch (err) {
            console.warn('[HOST] Socket non disponible — mode local uniquement:', err.message);
        }
    },

    creerPartie() {
        if (!this._authenticated) {
            console.warn('[HOST] creerPartie() ignoré — pas authentifié');
            return;
        }
        if (this._partieId) {
            console.log('[HOST] creerPartie() ignoré — partie déjà créée:', this._partieId);
            return;
        }
        if (this._creationEnCours) {
            console.log('[HOST] creerPartie() ignoré — création déjà en cours');
            return;
        }

        const nom        = GameState.partieNom || 'Partie';
        const jeu        = GameState.jeu       || 'quiz';
        const mode       = GameState.mode      || 'solo';
        const hostPseudo = (GameState.joueurs && GameState.joueurs.length > 0)
            ? String(GameState.joueurs[0]).trim()
            : null;

        this._creationEnCours = true;

        try {
            socket.send('HOST_CREATE_GAME', {
                nom,
                jeu,
                mode,
                equipes    : [],
                hostJoue   : !!hostPseudo,
                hostPseudo : hostPseudo || null,
            });
            console.log(`[HOST] 📤 HOST_CREATE_GAME — "${nom}" / ${jeu} / ${mode} / hostPseudo: ${hostPseudo}`);
        } catch (err) {
            console.error('[HOST] ❌ Erreur send HOST_CREATE_GAME:', err.message);
            this._creationEnCours = false;
            this._toastHote('Erreur de connexion. Vérifie ta connexion internet.', 'error');
        }
    },

    notifierDemarrage() {
        if (!this._authenticated) {
            console.warn('[HOST] notifierDemarrage() ignoré — pas authentifié');
            return;
        }
        if (!this._partieId) {
            console.warn('[HOST] notifierDemarrage() ignoré — pas de partieId');
            return;
        }
        try {
            socket.send('HOST_START_GAME', { partieId: this._partieId });
            console.log('[HOST] 📤 HOST_START_GAME (notifierDemarrage) —', this._partieId);
        } catch (err) {
            console.error('[HOST] ❌ Erreur send HOST_START_GAME:', err.message);
        }
    },

    terminer() {
        if (!this._authenticated || !this._partieId) return;
        try {
            socket.send('HOST_END_GAME');
            console.log('[HOST] 📤 HOST_END_GAME');
        } catch (err) {
            console.error('[HOST] ❌ Erreur send HOST_END_GAME:', err.message);
        }
    },

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
                try { socket.send('HOST_KICK_PLAYER', { pseudo }); }
                catch (err) { console.error('[HOST] ❌ HOST_KICK_PLAYER:', err.message); }
            }
            HostSession._syncJoueurParti(pseudo);
        });

        container.appendChild(div);
        console.log(`[HOST] ✅ Joueur affiché dans le lobby: ${pseudo}`);
    },

    _syncJoueurParti(pseudo) {
        if (!pseudo) return;
        GameState.joueurs = (GameState.joueurs || []).filter(j => j !== pseudo);
        delete GameState.scores[pseudo];

        const container = document.getElementById('joueurs-selectionnes-container');
        if (!container) return;
        const tag = container.querySelector(`[data-joueur="${CSS.escape(pseudo)}"]`);
        tag?.closest('.joueur-tag')?.remove();
        console.log(`[HOST] ✅ Joueur retiré du lobby: ${pseudo}`);
    },

    _toastHote(msg, type = 'info') {
        const COLORS = { success: '#22c55e', error: '#ef4444', warning: '#f59e0b', info: '#00d4ff' };
        const ICONS  = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
        let c = document.getElementById('host-toast-container');
        if (!c) {
            c = document.createElement('div');
            c.id = 'host-toast-container';
            c.style.cssText = 'position:fixed;bottom:1.5rem;right:1.5rem;z-index:9999;display:flex;flex-direction:column;gap:.4rem;max-width:320px;pointer-events:none;';
            document.body.appendChild(c);
        }
        const el = document.createElement('div');
        el.style.cssText = [
            'display:flex;gap:.5rem;align-items:center;padding:.65rem .9rem;border-radius:10px',
            `background:#1e1e2e;color:#fff;border-left:3px solid ${COLORS[type] || COLORS.info}`,
            'box-shadow:0 4px 16px rgba(0,0,0,.5)',
            'opacity:0;transition:opacity .25s,transform .25s;transform:translateY(6px)',
            'font-size:.88rem;font-weight:600;pointer-events:auto',
        ].join(';');
        el.innerHTML = `<span>${ICONS[type] || 'ℹ️'}</span><span>${msg}</span>`;
        c.appendChild(el);
        requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
        setTimeout(() => {
            el.style.opacity = '0'; el.style.transform = 'translateY(6px)';
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
                <a href="${url}" target="_blank"
                    style="color:#00d4ff;word-break:break-all;">${url}</a>
                ${code ? `<br><strong style="font-size:1.1rem;letter-spacing:.15em;color:#fff;">${code}</strong>` : ''}
            </div>`;
        el.style.display = 'block';
    },

    _afficherCompteurJoueurs(count) {
        const el = document.getElementById('ws-joueurs-count');
        if (!el) return;
        el.textContent = `${count} joueur${count > 1 ? 's' : ''} connecté${count > 1 ? 's' : ''}`;
    },
};

function _escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export default HostSession;