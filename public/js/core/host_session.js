// /js/core/host_session.js — v2.0
// ============================================================
// HostSession — Gestion centralisée de la session WebSocket
//
// CORRECTIONS v2.0 :
//
// [FIX A] GAME_CREATED handler fait maintenant TOUT :
//   1. Stocke _partieId + _snapshot
//   2. Écrit minigame_partie_id dans localStorage
//   3. Met à jour invite.js (lien d'invitation)
//   4. Envoie HOST_START_GAME (garantit que _partieId existe)
//   5. Lance le jeu via lancerJeu(_pendingGame)
//   Avant : lancerJeu() était appelé depuis initStartSolo() → notifierDemarrage()
//   était appelé avec _partieId=null → double creerPartie → NAME_TAKEN.
//
// [FIX B] notifierDemarrage() est supprimé du flux principal.
//   HOST_START_GAME est envoyé uniquement depuis le handler GAME_CREATED.
//   notifierDemarrage() reste pour les cas de rejoin (HOST_REJOINED).
//
// [FIX C] nettoyerSession() est appelé ICI, juste avant lancerJeu(),
//   et non plus dans lancerJeu(). Garantit que minigame_partie_id
//   du nouveau jeu est écrit AVANT le nettoyage des anciennes clés.
//
// [FIX D] _pendingGame : stocke le nom du jeu à lancer.
//   Défini par initStartSolo() dans main.js, lu dans GAME_CREATED.
//
// [FIX E] NAME_TAKEN : restaure le bouton start et affiche un message clair.
//
// [FIX F] creerPartie() a un verrou _creationEnCours pour éviter
//   les doubles appels depuis des chemins concurrents.
// ============================================================

import { GameState } from './state.js';
import { socket } from './socket.js';

const HostSession = {
    _partieId        : null,
    _snapshot        : null,
    _authenticated   : false,
    _pendingStart    : false,  // HOST_START_GAME en attente de GAME_CREATED
    _pendingGame     : null,   // [FIX D] nom du jeu à lancer après GAME_CREATED
    _creationEnCours : false,  // [FIX F] verrou anti-double-create

    // ── Reset complet avant une nouvelle partie ──────────
    reset() {
        this._partieId        = null;
        this._snapshot        = null;
        this._pendingStart    = false;
        this._pendingGame     = null;
        this._creationEnCours = false;
        console.log('[HOST] 🔄 HostSession reset (nouvelle partie)');
    },

    // ── Initialisation WS ────────────────────────────────
    init() {
        try {
            socket.connect();

            socket.once('__connected__', () => {
                console.log('[HOST] Socket connecté — authentification...');
                socket.send('HOST_AUTH');
            });

            socket.on('AUTH_OK', () => {
                console.log('[HOST] ✅ Authentifié');
                this._authenticated = true;

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
                this._afficherLienJoin(joinUrl, snapshot?.codeCourt);
            });

            // ── GAME_CREATED — point central du flux WS ──────
            // [FIX A] Tout se passe ici, dans l'ordre garanti :
            // 1. Sauvegarder l'ID dans localStorage
            // 2. Mettre à jour le lien d'invitation
            // 3. Envoyer HOST_START_GAME (maintenant que _partieId est défini)
            // 4. Nettoyer l'ancienne session
            // 5. Créer la partie locale
            // 6. Lancer le jeu
            socket.on('GAME_CREATED', ({ partieId, snapshot, joinUrl }) => {
                console.log('[HOST] ✅ Partie créée —', partieId);

                this._partieId        = partieId;
                this._snapshot        = snapshot;
                this._creationEnCours = false;

                // 1. Persister l'ID (source de vérité pour quiz_hote._pid())
                localStorage.setItem('minigame_partie_id', partieId);

                // 2. Mettre à jour invite.js — APRÈS avoir écrit l'ID
                import('../modules/invite.js').then(m => {
                    if (typeof m.setPartieSessionId === 'function') {
                        m.setPartieSessionId(partieId);
                    }
                    if (typeof m.mettreAJourLienInvitation === 'function') {
                        m.mettreAJourLienInvitation();
                    }
                }).catch(err => console.warn('[HOST] ⚠️ invite.js:', err.message));

                this._afficherLienJoin(joinUrl, snapshot?.codeCourt);

                // 3. [FIX A] Envoyer HOST_START_GAME maintenant que _partieId est défini
                try {
                    socket.send('HOST_START_GAME', { partieId });
                    console.log('[HOST] 📤 HOST_START_GAME envoyé après GAME_CREATED —', partieId);
                } catch (err) {
                    console.error('[HOST] ❌ Erreur HOST_START_GAME:', err.message);
                }

                // 4. [FIX C] Nettoyer les ANCIENNES clés de session MAINTENANT
                // (après avoir écrit le nouvel ID, avant de lancer le jeu)
                import('../core/cleanup.js').then(m => {
                    if (typeof m.nettoyerSession === 'function') {
                        m.nettoyerSession();
                        // Réécrire le nouvel ID (nettoyerSession l'aurait supprimé)
                        localStorage.setItem('minigame_partie_id', partieId);
                    }
                }).catch(() => {});

                // 5. [FIX D] Lancer le jeu si un jeu était en attente
                const gameALancer = this._pendingGame;
                this._pendingGame = null;

                if (gameALancer) {
                    // Créer la partie locale (localStorage)
                    import('../modules/parties.js').then(m => {
                        if (typeof m.creerNouvellePartie === 'function') {
                            m.creerNouvellePartie();
                        }
                    }).catch(() => {});

                    // Restaurer le bouton start
                    import('../main.js').then(m => {
                        if (typeof m._restaurerBoutonStart === 'function') {
                            m._restaurerBoutonStart();
                        }
                    }).catch(() => {});

                    // Lancer le jeu via window.lancerJeu (exposé par main.js)
                    // Délai court pour laisser le DOM se stabiliser
                    setTimeout(() => {
                        if (typeof window.lancerJeu === 'function') {
                            console.log('[HOST] 🎮 Lancement du jeu —', gameALancer);
                            window.lancerJeu(gameALancer, { fromServer: true });
                        }
                    }, 50);
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

                import('../core/cleanup.js').then(m => {
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

                    // Restaurer le bouton start
                    import('../main.js').then(m => {
                        if (typeof m._restaurerBoutonStart === 'function') m._restaurerBoutonStart();
                    }).catch(() => {});
                }

                if (code === 'HOST_ALREADY_HAS_GAME') {
                    console.log('[HOST] ℹ️ Partie déjà active côté serveur — attente HOST_REJOINED');
                }

                if (code === 'NAME_TAKEN') {
                    console.warn('[HOST] ⚠️ Nom de partie déjà pris :', GameState.partieNom);
                    this._partieId    = null;
                    this._pendingGame = null;

                    // [FIX E] Restaurer le bouton et avertir l'utilisateur
                    import('../main.js').then(m => {
                        if (typeof m._restaurerBoutonStart === 'function') m._restaurerBoutonStart();
                    }).catch(() => {});

                    this._toastHote(
                        'Ce nom de partie est déjà utilisé. Choisissez un autre nom.',
                        'error'
                    );
                }

                if (code === 'INTERNAL_ERROR') {
                    console.error('[HOST] ❌ INTERNAL_ERROR — vérifier logs serveur');
                    this._pendingGame = null;
                    import('../main.js').then(m => {
                        if (typeof m._restaurerBoutonStart === 'function') m._restaurerBoutonStart();
                    }).catch(() => {});
                    this._toastHote('Erreur serveur temporaire. Réessaie dans quelques secondes.', 'error');
                }
            });

        } catch (err) {
            console.warn('[HOST] Socket non disponible — mode local uniquement:', err.message);
        }
    },

    // ── Créer la partie côté serveur ─────────────────────
    // [FIX F] Verrou _creationEnCours pour éviter les doubles envois.
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

    // ── notifierDemarrage — utilisé uniquement pour rejoin ──
    // [FIX B] N'est plus appelé dans le flux normal.
    // Reste disponible pour les cas de reconnexion (HOST_REJOINED + partie déjà démarrée).
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

    // ── Terminer la partie ───────────────────────────────
    terminer() {
        if (!this._authenticated || !this._partieId) return;
        try {
            socket.send('HOST_END_GAME');
            console.log('[HOST] 📤 HOST_END_GAME');
        } catch (err) {
            console.error('[HOST] ❌ Erreur send HOST_END_GAME:', err.message);
        }
    },

    // ── Sync joueur dans GameState + DOM ─────────────────
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

    // ── Toast hôte ───────────────────────────────────────
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

    // ── Afficher lien / QR ───────────────────────────────
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