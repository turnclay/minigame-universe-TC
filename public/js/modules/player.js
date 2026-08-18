// ================================================================
// public/js/modules/player.js — v1.0
// ================================================================
// Module unique gérant TOUT le gameplay côté invité.
// Instancié par jeu.js après connexion WS + JOIN_OK.
//
// Responsabilités :
//   - Registre des modules de jeu invité (JeuRegistry)
//   - Transitions d'écran (attente → gameplay → correction → fin)
//   - Dispatch des événements WS aux modules jeu
//   - localStorage invité : UNE seule clé : mgu_player_id
//     (pseudo persisté pour reconnexion automatique)
//
// Interface publique :
//   Player.init(session, socket)   — point d'entrée
//   Player.destroy()               — nettoyage (navigation)
//
// Interface d'un module jeu (JeuRegistry) :
//   mod.initPlayer(session, socket, gameState, snapshot)
//   mod.destroy()           — optionnel
//   mod.onHostAction(a, d)  — optionnel
//   mod.onScores(scores)    — optionnel
//
// localStorage invité (clés) :
//   mgu_player_id    → pseudo persisté (reconnexion auto)
//   — Aucune autre clé. Tout le reste passe par WS.
// ================================================================

import { getPionParPseudo } from '../core/pion.js';

// ── Import navigation invité (lazy pour éviter circular deps) ──────────
let _navbarInite = false;
async function _initNavbar() {
    if (_navbarInite) return;
    _navbarInite = true;
    try {
        const nav = await import('../navigation.js');
        if (typeof nav.initNavbarInvite === 'function') nav.initNavbarInvite();
    } catch(e) { console.warn('[PLAYER] initNavbarInvite indisponible:', e.message); }
}

// ── Clé localStorage invité ────────────────────────────────────
const PLAYER_ID_KEY = 'mgu_player_id';

export function getPlayerPseudo()        { return localStorage.getItem(PLAYER_ID_KEY) || null; }
export function setPlayerPseudo(pseudo)  { if (pseudo) localStorage.setItem(PLAYER_ID_KEY, pseudo); }
export function clearPlayerPseudo()      { localStorage.removeItem(PLAYER_ID_KEY); }

// ── Utilitaires DOM ────────────────────────────────────────────
const $  = id => document.getElementById(id);
const setText = (id, t) => { const e = $(id); if (e) e.textContent = t ?? ''; };
function _majPion(pseudo) {
    const el = $('hdr-pion');
    if (!el) return;
    const couleur = getPionParPseudo(pseudo);
    el.style.background = couleur ? couleur.hex : 'transparent';
    el.setAttribute('title', couleur ? `Pion ${couleur.label}` : '');
}
const esc = s => String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function jeuIcon(jeu) {
    const m = {
        quiz:'❓', justeprix:'💰', undercover:'🕵️', lml:'📖', mimer:'🎭',
        mimedessine:'🎭', pendu:'🪢', petitbac:'📝', memoire:'🧠',
        morpion:'⭕', puissance4:'🔴', uno:'🃏'
    };
    return m[(jeu || '').toLowerCase()] || '🎮';
}

// ── Registre des modules jeu ───────────────────────────────────
const JeuRegistry = {
    _mods: {},
    register(jeu, mod)  { this._mods[jeu.toLowerCase()] = mod; },
    get(jeu)            { return this._mods[(jeu || '').toLowerCase()] || null; },
};

// ── Toast ──────────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3000) {
    const C = { success:'#22c55e', error:'#ef4444', warning:'#f59e0b', info:'var(--mgu-or-600)' };
    const I = { success:'✅', error:'❌', warning:'⚠️', info:'ℹ️' };
    let c = $('toast-container');
    if (!c) {
        c = document.createElement('div'); c.id = 'toast-container';
        c.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:9999;display:flex;flex-direction:column;gap:.4rem;max-width:310px;pointer-events:none;';
        document.body.appendChild(c);
    }
    const el = document.createElement('div');
    el.style.cssText = [
        'display:flex;gap:.5rem;align-items:flex-start;padding:.65rem .9rem;border-radius:8px',
        `background:#1e1e2e;color:#ffffff;border-left:3px solid ${C[type] || C.info}`,
        'box-shadow:0 4px 16px rgba(0,0,0,.5)',
        'opacity:0;transition:opacity .2s,transform .2s;transform:translateX(12px)',
        'font-size:.88rem;pointer-events:auto'
    ].join(';');
    el.innerHTML = `<span style="flex-shrink:0">${I[type] || 'ℹ️'}</span><span>${esc(msg)}</span>`;
    c.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateX(0)'; });
    setTimeout(() => {
        el.style.opacity = '0'; el.style.transform = 'translateX(8px)';
        setTimeout(() => el.remove(), 220);
    }, duration);
}

function showBanner(msg) {
    let b = $('disconnect-banner');
    if (!b) {
        b = document.createElement('div'); b.id = 'disconnect-banner';
        b.style.cssText = 'position:fixed;top:0;left:0;right:0;background:var(--mgu-pion-rouge);color:#000;text-align:center;padding:.5rem;font-weight:600;z-index:9999;display:none;font-size:.9rem;';
        document.body.prepend(b);
    }
    b.textContent = msg; b.style.display = 'block';
}
function hideBanner() { const b = $('disconnect-banner'); if (b) b.style.display = 'none'; }

// ================================================================
// PLAYER — objet principal
// ================================================================
export const Player = {

    session         : null,
    socket          : null,
    snapshot        : null,
    module          : null,    // module jeu actif
    scoreLocal      : 0,
    _waitingForGame : false,
    _waitingAttempts: 0,
    _waitingMax     : 40,      // 40 × 3s = 2 min max

    // ──────────────────────────────────────────────────────────
    // INIT — point d'entrée appelé par jeu.js
    // ──────────────────────────────────────────────────────────
    init(session, socket) {
        this.session  = session;
        this.socket   = socket;
        this._waitingForGame   = false;
        this._waitingAttempts  = 0;

        // Persister le pseudo pour reconnexion auto
        if (session.pseudo) setPlayerPseudo(session.pseudo);

        // Initialiser l'écran identification
        this._initEcranIdentification();

        // ── Connecté → tenter REJOIN d'abord ──────────────────
        // Si le socket est déjà connecté (reconnexion rapide),
        // envoyer PLAYER_REJOIN immédiatement.
        // Sinon, attendre __connected__.
        const _envoyerRejoin = () => {
            socket.send('PLAYER_REJOIN', {
                partieId : session.partieId,
                pseudo   : session.pseudo,
            });
        };
        if (socket.connected) {
            _envoyerRejoin();
        } else {
            socket.once('__connected__', _envoyerRejoin);
        }

        // ── Reconnexion réussie ────────────────────────────────
        socket.on('REJOIN_OK', ({ pseudo, equipe, snapshot, gameState }) => {
            hideBanner();
            this._waitingForGame = false;
            this.snapshot        = snapshot;
            this.session.equipe  = equipe;
            this.session.pseudo  = pseudo;
            setPlayerPseudo(pseudo);
            toast(`Reconnecté : ${pseudo} 👋`, 'success', 2000);
            this._basculerVersJeu(snapshot);
            this._chargerModule(snapshot?.jeu || session.jeu, gameState, snapshot);
        });

        // ── Erreur JOIN ────────────────────────────────────────
        socket.on('JOIN_ERROR', ({ code }) => this._gererJoinError(code));

        // ── JOIN_OK → salle d'attente ──────────────────────────
        socket.on('JOIN_OK', ({ pseudo, equipe, snapshot }) => {
            hideBanner();
            this._waitingForGame = false;
            this.snapshot        = snapshot;
            this.session.equipe  = equipe;
            this.session.pseudo  = pseudo;
            setPlayerPseudo(pseudo);
            toast(`Bienvenue ${pseudo} ! En attente du lancement…`, 'success', 3000);
            this._basculerVersJeu(snapshot);
            this._afficherAttente(snapshot);
        });

        // ── GAME_STARTED → basculer + module immédiat + countdown synchronisé ─
        socket.on('GAME_STARTED', ({ snapshot, tsCountdownEnd }) => {
            this.snapshot        = snapshot;
            this._waitingForGame = false;

            // 1. Basculer vers #phase-jeu immédiatement (idempotent)
            this._basculerVersJeu(snapshot);

            // 2. Charger le module JEU IMMÉDIATEMENT — pas après le countdown.
            //    Le countdown est visuel seulement ; les events WS (QUIZ_READY,
            //    QUIZ_QUESTION…) peuvent arriver pendant ces 3s et doivent
            //    être reçus par le module déjà initialisé.
            const jeuReel = snapshot?.jeu || session.jeu;
            this._chargerModule(jeuReel, null, snapshot);

            // 3. Overlay countdown synchronisé : basé sur tsCountdownEnd serveur
            //    pour terminer à la même milliseconde wall-clock chez tous les clients.
            this._afficherCountdownOverlay(tsCountdownEnd, () => {
                toast('La partie commence ! 🚀', 'success', 2000);
            });
        });

        // Exposer Player sur window pour accès global (ex: _afficherCorrection)
        window.Player = this;

        // ── Relay vers module jeu actif ────────────────────────
        socket.on('HOST_ACTION', ({ action, data }) => {
            this.module?.onHostAction?.(action, data);
        });

        socket.on('SCORES_UPDATE', ({ scores }) => {
            this.derniersScores = scores || {};   // board complet (pour le panneau 🏆 invité)
            if (scores && this.session?.pseudo) {
                this.scoreLocal = scores[this.session.pseudo] ?? this.scoreLocal;
            }
            this.module?.onScores?.(scores);
            setText('hdr-score', `${this.scoreLocal ?? 0} pt${(this.scoreLocal ?? 0) > 1 ? 's' : ''}`);
            // Mettre à jour l'affichage du score si visible
            const el = document.getElementById('p-mes-points');
            if (el) el.textContent = (this.scoreLocal ?? 0) + ' pt' + ((this.scoreLocal ?? 0) > 1 ? 's' : '');
            // Rafraîchir le panneau scores invité s'il est ouvert
            const liste = document.getElementById('scores-invite-list');
            if (liste) {
                import('./modules/scoreboard.js').then(m =>
                    m.rendreClassement('scores-invite-list', this.derniersScores, {
                        cumul: false, controles: false, moi: this.session?.pseudo
                    })
                ).catch(() => {});
            }
        });

        // ── Relay des events de jeu vers le module invité actif ────────
        // Dispatcher central enregistré une seule fois dès Player.init()
        // (pas de listener dupliqué). Pour chaque event :
        //   - si le module expose _on<EVENT> (Quiz, historique) → appelé ;
        //   - sinon → délégation générique via onWsEvent(evt, payload)
        //     (Petit Bac, Pendu, Maxi Lettres, Juste Prix).
        // Un event non géré par le module courant est ignoré par son switch
        // → aucun effet de bord inter-jeux. Avant P5.5, seuls les QUIZ_*
        // étaient relayés : les jeux P5 côté invité ne recevaient jamais
        // leurs events et restaient bloqués sur l'écran d'attente.
        const gameEvents = [
            // Quiz
            'QUIZ_QUESTION','QUIZ_CORRECTION','QUIZ_END','QUIZ_INDICE',
            'QUIZ_ANSWER_ACK','QUIZ_RESPONSE_IN','QUIZ_TIMER_EXPIRED','QUIZ_CAN_NEXT',
            // Petit Bac
            'PETITBAC_MANCHE_START','PETITBAC_REVELATION','PETITBAC_ANSWER_ACK','PETITBAC_TIMER_EXPIRED',
            // Pendu
            'PENDU_MOT_START','PENDU_REVELATION','PENDU_ANSWER_ACK','PENDU_RESULT_IN','PENDU_TIMER_EXPIRED',
            // Maxi Lettres
            'LML_MANCHE_START','LML_REVELATION','LML_ANSWER_ACK','LML_TIMER_EXPIRED',
            // Juste Prix
            'JUSTEPRIX_PRODUIT_START','JUSTEPRIX_REVELATION','JUSTEPRIX_ANSWER_ACK','JUSTEPRIX_TIMER_EXPIRED',
            // Memoire
            'MEMOIRE_DEFI','MEMOIRE_PHASE','MEMOIRE_RESULT_ACK',
            // Mime Dessine
            'MIMEDESSSINE_DEFI', 'MIMEDESSSINE_PHASE', 'MIMEDESSSINE_MOT_A_DEVINER',
            'MIMEDESSSINE_DRAWING_DATA', 'MIMEDESSSINE_GUESS_IN', 'MIMEDESSSINE_GUESS_ACK',
             // UNO
    'UNO_STATE','UNO_HAND','UNO_TURN','UNO_EFFECT','UNO_UNO_SAID','UNO_PENALTY',
    'UNO_CHALLENGE_OK','UNO_ERROR','UNO_WINNER','UNO_COLOR_CHOSEN',
    'UNO_CHOOSE_COLOR','UNO_DRAW_PLAYABLE',
];
        gameEvents.forEach(evt => {
            socket.on(evt, payload => {
                if (this.module && typeof this.module['_on' + evt] === 'function') {
                    this.module['_on' + evt](payload);
                } else if (this.module) {
                    this.module.onWsEvent?.(evt, payload);
                }
                // Si module pas encore chargé : l'événement est perdu, mais la
                // ré-hydratation gameState au (re)chargement du module couvre
                // l'état courant (PRODUIT_START / MANCHE_START / résultats).
            });
        });

        // ── Fin de partie ──────────────────────────────────────
        socket.on('GAME_ENDED', ({ snapshot }) => {
            this.snapshot = snapshot;
            this.module?.destroy?.();
            this._afficherFin((snapshot?.scores) || {});
        });

        // ── Expulsion ──────────────────────────────────────────
        socket.on('KICKED', ({ reason }) => {
            toast(`Vous avez été expulsé${reason ? ' : ' + reason : ''}`, 'error', 5000);
            setTimeout(() => { window.location.href = '/'; }, 2500);
        });

        // ── Hôte déconnecté ────────────────────────────────────
        socket.on('HOST_DISCONNECTED', ({ message }) =>
            showBanner(`⚠️ ${message || "L'hôte s'est déconnecté"}`)
        );

        // ── Connexion socket ───────────────────────────────────
        socket.on('__disconnected__', () =>
            showBanner('⚠️ Connexion perdue — reconnexion en cours…')
        );
        socket.on('__connected__', () => hideBanner());

        // ── Compteur joueurs en attente ────────────────────────
        socket.on('PLAYER_JOINED', ({ joueurs }) => {
            const el = $('attente-joueurs-count');
            if (el) el.textContent = `👥 ${joueurs.length} joueur(s) connecté(s)`;
        });
    },

    // ──────────────────────────────────────────────────────────
    // DESTROY — nettoyage lors de la navigation
    // ──────────────────────────────────────────────────────────
    destroy() {
        this.module?.destroy?.();
        this.module   = null;
        this.session  = null;
        this.snapshot = null;
    },

    // ──────────────────────────────────────────────────────────
    // ÉCRAN IDENTIFICATION — pré-remplit la carte meta
    // ──────────────────────────────────────────────────────────
    _initEcranIdentification() {
        const s = this.session;
        const LABELS = {
            quiz:'❓ Quiz', justeprix:'💰 Juste Prix', undercover:'🕵️ Undercover',
            lml:'📖 Maxi Lettres', mimer:'🎭 Mimer', mimedessine:'🎭 Mimer',
            pendu:'🪢 Pendu', petitbac:'📝 Petit Bac', memoire:'🧠 Mémoire',
            morpion:'⭕ Morpion', puissance4:'🔴 Puissance 4', uno:'🃏 UNO'
        };
        setText('id-meta-nom',  s.partieNom || '—');
        setText('id-meta-jeu',  s.jeu ? (LABELS[s.jeu.toLowerCase()] || s.jeu.toUpperCase()) : '—');
        setText('id-meta-id',   s.partieId  || '—');
        setText('id-meta-hote', s.hote      || '—');

        const rowHote = $('id-row-hote');
        if (rowHote) rowHote.style.display = s.hote ? '' : 'none';

        const rowDate = $('id-row-date');
        if (rowDate) {
            if (s.createdAt) {
                try {
                    const d = new Date(isNaN(s.createdAt) ? s.createdAt : Number(s.createdAt));
                    setText('id-meta-date',
                        d.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' })
                        + ' à ' + d.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' })
                    );
                    rowDate.style.display = '';
                } catch { rowDate.style.display = 'none'; }
            } else {
                rowDate.style.display = 'none';
            }
        }
    },

    // ──────────────────────────────────────────────────────────
    // GESTION ERREURS JOIN
    // ──────────────────────────────────────────────────────────
    _gererJoinError(code) {
        const session = this.session;
        const etat    = $('id-etat');

        if (code === 'PLAYER_NOT_FOUND') {
            // Premier JOIN : le joueur n'existe pas encore dans la partie
            this.socket.send('PLAYER_JOIN', {
                pseudo   : session.pseudo,
                partieId : session.partieId,
            });
            return;
        }

        if (code === 'GAME_NOT_FOUND') {
            if (!this._waitingForGame) {
                this._waitingForGame   = true;
                this._waitingAttempts  = 0;
                this._afficherAttenteCreation();
            }
            this._waitingAttempts++;

            if (this._waitingAttempts >= this._waitingMax) {
                const msg = $('attente-creation-msg');
                if (msg) msg.innerHTML = `
                    <p style="color:var(--mgu-pion-rouge);margin:0 0 .75rem;">
                        L'hôte n'a pas encore créé la partie.<br>
                        Vérifie le lien ou demande à l'hôte.
                    </p>
                    <button onclick="location.reload()"
                        style="padding:.6rem 1.5rem;background:rgba(232,178,59,.15);
                               border:1px solid rgba(232,178,59,.4);border-radius:8px;
                               color:var(--mgu-or-600);cursor:pointer;font-family:inherit;">
                        🔄 Réessayer
                    </button>`;
                this._waitingForGame = false;
                return;
            }

            let count = 3;
            const cd  = $('attente-countdown');
            const iv  = setInterval(() => {
                count--;
                if (cd) cd.textContent = count > 0
                    ? `Nouvelle tentative dans ${count}s…`
                    : 'Connexion…';
                if (count <= 0) {
                    clearInterval(iv);
                    if (this._waitingForGame) {
                        this.socket.send('PLAYER_JOIN', {
                            pseudo   : session.pseudo,
                            partieId : session.partieId,
                        });
                    }
                }
            }, 1000);
            return;
        }

        // Autres codes d'erreur
        const msgs = {
            PSEUDO_TAKEN   : 'Ce pseudo est déjà utilisé dans cette partie.',
            GAME_STARTED   : "La partie a déjà commencé — demande à l'hôte de t'ajouter.",
            MAX_PLAYERS    : 'La partie est complète.',
            PSEUDO_INVALID : 'Pseudo invalide (2-20 caractères alphanumériques).',
            MISSING_FIELDS : 'Données manquantes. Vérifie le lien.',
        };
        const msg = msgs[code] || `Erreur : ${code}`;
        if (etat) etat.textContent = msg;
        toast(msg, 'error', 5000);
        // Réactiver le formulaire pour permettre de réessayer
        const btn   = $('btn-join');
        const input = $('id-pseudo');
        if (btn)   { btn.disabled = false; btn.textContent = '🚀 Rejoindre la partie'; }
        if (input) input.disabled = false;
    },

    // ──────────────────────────────────────────────────────────
    // BASCULE identification → jeu
    // ──────────────────────────────────────────────────────────
    _basculerVersJeu(snapshot) {
        const phId  = $('phase-identification');
        const phJeu = $('phase-jeu');
        if (phId)  { phId.style.display  = 'none'; phId.hidden  = true;  }
        if (phJeu) { phJeu.style.display = '';     phJeu.hidden = false;  }

        setText('hdr-pseudo', this.session.pseudo || '—');
        setText('hdr-partie', snapshot?.nom || this.session.partieNom || 'Partie');
        setText('hdr-jeu',   (snapshot?.jeu || this.session.jeu || '').toUpperCase());
        _majPion(this.session.pseudo);

        const nav = $('invite-navbar');
        if (nav) nav.classList.add('visible');

        // Initialiser les boutons navbar invité (🏠 et ☰) — une seule fois
        _initNavbar();
    },

    // ──────────────────────────────────────────────────────────
    // ÉCRANS GÉNÉRIQUES
    // ──────────────────────────────────────────────────────────
    _afficherAttente(snapshot) {
        const cont = $('jeu-contenu');
        if (!cont) return;
        const icon = jeuIcon(snapshot?.jeu || this.session.jeu);
        const mode = snapshot?.mode === 'team' ? '🛡️ Équipes' : '👤 Solo';
        const nb   = (snapshot?.joueurs || []).length;
        cont.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;
                justify-content:center;min-height:55vh;text-align:center;padding:2rem;gap:1.5rem;">
                <div style="background:rgba(95,167,119,.12);border:1px solid rgba(95,167,119,.3);
                    border-radius:12px;padding:.6rem 1.2rem;color:#2f5f42;font-size:.85rem;font-weight:600;">
                    ✅ Connecté à la partie
                </div>
                <div style="background:rgba(232,178,59,.07);border:1px solid rgba(232,178,59,.2);
                    border-radius:16px;padding:1.5rem 2rem;min-width:260px;max-width:380px;width:100%;">
                    <div style="font-size:3rem;margin-bottom:.5rem;">${icon}</div>
                    <div style="font-size:1.2rem;font-weight:700;margin-bottom:.25rem;">
                        ${esc(snapshot?.nom || this.session.partieNom || 'Partie')}
                    </div>
                    <div style="font-size:.85rem;opacity:.6;margin-bottom:1rem;">
                        ${(snapshot?.jeu || this.session.jeu || '').toUpperCase()} · ${mode}
                    </div>
                    <div style="background:var(--mgu-carton-50);border-radius:8px;
                        padding:.75rem;margin-bottom:.75rem;">
                        <div style="font-size:.72rem;color:#64748b;text-transform:uppercase;
                            letter-spacing:.06em;margin-bottom:.25rem;">Ton pseudo</div>
                        <div style="font-size:1.1rem;font-weight:700;color:var(--mgu-or-600);">
                            ${esc(this.session.pseudo)}
                        </div>
                        ${this.session.equipe
                            ? `<div style="font-size:.8rem;opacity:.6;margin-top:.25rem;">
                                   🛡️ ${esc(this.session.equipe)}</div>`
                            : ''}
                    </div>
                    <div id="attente-joueurs-count" style="font-size:.85rem;opacity:.6;">
                        👥 ${nb} joueur(s) connecté(s)
                    </div>
                </div>
                <div style="display:flex;flex-direction:column;align-items:center;gap:.75rem;">
                    <div style="width:36px;height:36px;border:3px solid rgba(232,178,59,.2);
                        border-top-color:var(--mgu-or-600);border-radius:50%;animation:pl-spin .9s linear infinite;">
                    </div>
                    <p style="color:#64748b;font-size:.9rem;margin:0;">En attente du lancement…</p>
                </div>
                <button id="btn-quitter-attente"
                    style="background:none;border:1px solid var(--mgu-carton-line);color:#64748b;
                           border-radius:8px;padding:.5rem 1rem;cursor:pointer;font-size:.82rem;
                           font-family:inherit;">
                    Quitter
                </button>
            </div>
            <style>@keyframes pl-spin{to{transform:rotate(360deg)}}</style>`;
        $('btn-quitter-attente')?.addEventListener('click', () => {
            if (confirm('Quitter la salle d\'attente ?')) window.location.href = '/';
        });
    },

    _afficherAttenteCreation() {
        const phJeu  = $('phase-jeu');
        const actif  = phJeu && !phJeu.hidden && phJeu.style.display !== 'none';
        const target = actif ? $('jeu-contenu') : $('id-etat');
        if (!target) return;
        const nom = this.session.partieNom || 'la partie';
        if (actif) {
            target.innerHTML = `
                <div style="display:flex;flex-direction:column;align-items:center;
                    justify-content:center;min-height:55vh;text-align:center;
                    padding:2rem;gap:1.25rem;">
                    <div style="width:48px;height:48px;border:4px solid rgba(232,178,59,.2);
                        border-top-color:var(--mgu-or-600);border-radius:50%;
                        animation:pl-spin .9s linear infinite;"></div>
                    <h2 style="color:var(--mgu-encre-900);margin:0;font-size:1.2rem;">En attente de l'hôte…</h2>
                    <div id="attente-creation-msg">
                        <p style="color:var(--mgu-encre-600);max-width:320px;margin:0 0 .5rem;">
                            Connecté en tant que
                            <strong style="color:var(--mgu-or-600);">${esc(this.session.pseudo)}</strong><br>
                            L'hôte configure <strong>${esc(nom)}</strong>.
                        </p>
                        <p id="attente-countdown"
                            style="color:var(--mgu-encre-600);font-size:.82rem;margin:0;">
                            Nouvelle tentative dans 3s…
                        </p>
                    </div>
                    <a href="/" style="font-size:.8rem;color:var(--mgu-encre-600);text-decoration:none;">
                        ← Retour
                    </a>
                </div>
                <style>@keyframes pl-spin{to{transform:rotate(360deg)}}</style>`;
        } else {
            target.innerHTML = `
                <span style="display:inline-flex;align-items:center;gap:.5rem;">
                    <span style="width:14px;height:14px;border:2px solid rgba(232,178,59,.3);
                        border-top-color:var(--mgu-or-600);border-radius:50%;
                        animation:pl-spin .9s linear infinite;display:inline-block;"></span>
                    En attente de l'hôte…
                    <span id="attente-countdown"
                        style="color:var(--mgu-encre-600);font-size:.8rem;"></span>
                </span>
                <style>@keyframes pl-spin{to{transform:rotate(360deg)}}</style>`;
        }
    },

    // ── Countdown OVERLAY synchronisé serveur ──────────────────────
    // Argument : tsEnd = échéance absolue (Date.now() local) envoyée par
    // le serveur dans GAME_STARTED.tsCountdownEnd. Si tsEnd est absent
    // (compat ancien serveur), fallback sur 3 s à partir de maintenant.
    // L'affichage recalcule la valeur à chaque tick depuis le timestamp
    // → fin strictement simultanée sur host + tous les invités.
    _afficherCountdownOverlay(tsEnd, onEnd) {
        document.getElementById('pl-cd-overlay')?.remove();

        const FALLBACK_MS = 3000;
        const target      = tsEnd || (Date.now() + FALLBACK_MS);
        const compute     = () => Math.max(0, Math.ceil((target - Date.now()) / 1000));

        let cur = compute();
        if (cur <= 0) { if (onEnd) onEnd(); return; }

        if (!document.getElementById('style-pl-cd')) {
            const s = document.createElement('style'); s.id = 'style-pl-cd';
            s.textContent = `
                @keyframes plCdPop {
                    0%  { transform:scale(1.4); opacity:0 }
                    60% { transform:scale(.93)             }
                    100%{ transform:scale(1);   opacity:1  }
                }
                #pl-cd-overlay {
                    position:fixed; inset:0; z-index:800;
                    display:flex; align-items:center; justify-content:center;
                    flex-direction:column; gap:1rem;
                    background:rgba(0,0,0,.72); backdrop-filter:blur(8px);
                    pointer-events:none;
                }
                .pl-cd-n {
                    font-size:6rem; font-weight:900; color:var(--mgu-encre-900);
                    text-shadow:0 0 60px rgba(232,178,59,.9);
                    animation:plCdPop .4s cubic-bezier(.4,0,.2,1);
                }
                .pl-cd-l {
                    font-size:1rem; color:var(--mgu-encre-600);
                    font-weight:700; letter-spacing:.1em; text-transform:uppercase;
                }`;
            document.head.appendChild(s);
        }

        const ov  = document.createElement('div'); ov.id = 'pl-cd-overlay';
        const nEl = document.createElement('div'); nEl.className = 'pl-cd-n'; nEl.textContent = String(cur);
        const lEl = document.createElement('div'); lEl.className = 'pl-cd-l'; lEl.textContent = 'La partie commence…';
        ov.append(nEl, lEl);
        document.body.appendChild(ov);

        const iv = setInterval(() => {
            const remaining = compute();
            if (remaining !== cur) {
                cur = remaining;
                if (remaining > 0) {
                    nEl.style.animation = 'none';
                    nEl.textContent = String(remaining);
                    requestAnimationFrame(() => {
                        nEl.style.animation = 'plCdPop .4s cubic-bezier(.4,0,.2,1)';
                    });
                }
            }
            if (remaining <= 0) {
                clearInterval(iv);
                ov.style.opacity = '0';
                ov.style.transition = 'opacity .3s';
                setTimeout(() => { ov.remove(); if (onEnd) onEnd(); }, 300);
            }
        }, 100);
    },

    // ── Countdown dans #jeu-contenu (conservé pour compat, non utilisé par GAME_STARTED) ─
    _afficherCountdown(n, onEnd) {
        const cont = $('jeu-contenu');
        if (!cont) { if (onEnd) onEnd(); return; }
        if (!$('style-pl-cd')) {
            const s = document.createElement('style'); s.id = 'style-pl-cd';
            s.textContent = `
                @keyframes plCdPop {
                    0%  { transform:scale(1.4); opacity:0 }
                    60% { transform:scale(.93)             }
                    100%{ transform:scale(1);   opacity:1  }
                }
                .pl-cd-n { font-size:5rem;font-weight:900;color:var(--mgu-encre-900);
                    text-shadow:0 0 50px rgba(232,178,59,.9);
                    animation:plCdPop .4s cubic-bezier(.4,0,.2,1) }
                .pl-cd-l { font-size:.95rem;color:var(--mgu-encre-600);
                    font-weight:700;letter-spacing:.1em;text-transform:uppercase }`;
            document.head.appendChild(s);
        }
        cont.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;
                justify-content:center;min-height:55vh;gap:1rem;
                text-align:center;padding:2rem;">
                <div class="pl-cd-n" id="pl-cd-number">${n}</div>
                <div class="pl-cd-l">La partie commence…</div>
            </div>`;
        let cur = n;
        const nEl = $('pl-cd-number');
        const iv  = setInterval(() => {
            cur--;
            if (cur > 0) {
                if (nEl) {
                    nEl.style.animation = 'none';
                    nEl.textContent = String(cur);
                    requestAnimationFrame(() => {
                        nEl.style.animation = 'plCdPop .4s cubic-bezier(.4,0,.2,1)';
                    });
                }
            } else {
                clearInterval(iv);
                onEnd();
            }
        }, 1000);
    },

    _afficherJeuSurHote(jeu) {
        const cont = $('jeu-contenu');
        if (!cont) return;
        cont.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;
                justify-content:center;min-height:55vh;text-align:center;
                padding:2rem;gap:1rem;">
                <span style="font-size:3.5rem;">${jeuIcon(jeu)}</span>
                <h2 style="margin:0;font-size:1.2rem;">Jeu sur l'écran de l'hôte</h2>
                <p style="color:var(--mgu-encre-600);max-width:300px;margin:0;line-height:1.6;">
                    <strong style="color:var(--mgu-or-600);">${esc((jeu || '').toUpperCase())}</strong>
                    se joue sur l'écran principal.<br>
                    Tu es inscrit en tant que
                    <strong style="color:var(--mgu-or-600);">${esc(this.session.pseudo)}</strong>.
                </p>
                <div style="width:28px;height:28px;border:2px solid rgba(232,178,59,.2);
                    border-top-color:var(--mgu-or-600);border-radius:50%;
                    animation:pl-spin .9s linear infinite;margin-top:.5rem;"></div>
            </div>
            <style>@keyframes pl-spin{to{transform:rotate(360deg)}}</style>`;
    },

    _afficherFin(scores) {
        const cont    = $('jeu-contenu');
        if (!cont) return;
        const pseudo  = this.session.pseudo;
        const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
        const medals  = ['🥇','🥈','🥉'];
        cont.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;
                justify-content:center;min-height:55vh;text-align:center;
                padding:2rem;gap:1.5rem;">
                <span style="font-size:3.5rem;">🏆</span>
                <h2 style="margin:0;">Partie terminée !</h2>
                <div style="display:flex;flex-direction:column;gap:.5rem;
                    width:100%;max-width:360px;">
                    ${entries.length
                        ? entries.map(([nom, pts], i) => `
                            <div style="display:flex;justify-content:space-between;
                                align-items:center;padding:.75rem 1rem;border-radius:10px;
                                background:${nom === pseudo
                                    ? 'rgba(232,178,59,.12)' : 'rgba(255,255,255,.04)'};
                                ${nom === pseudo
                                    ? 'outline:2px solid rgba(232,178,59,.4);' : ''}">
                                <span>
                                    ${medals[i] || (i + 1) + '.'} ${esc(nom)}
                                    ${nom === pseudo
                                        ? '<em style="font-size:.8rem;opacity:.6;"> (toi)</em>'
                                        : ''}
                                </span>
                                <span style="font-weight:700;color:${
                                    nom === pseudo ? 'var(--mgu-or-600)' : 'white'}">
                                    ${pts} pts
                                </span>
                            </div>`).join('')
                        : '<p style="opacity:.5;">Aucun score enregistré.</p>'}
                </div>
                <a href="/"
                    style="display:inline-block;padding:.75rem 2rem;
                        background:linear-gradient(135deg,var(--mgu-or-600),var(--mgu-or-500));
                        border-radius:10px;color:var(--mgu-encre-900);text-decoration:none;
                        font-weight:700;margin-top:.5rem;">
                    🏠 Retour à l'accueil
                </a>
            </div>`;
    },

    // ──────────────────────────────────────────────────────────
    // CHARGEMENT DU MODULE JEU
    // ──────────────────────────────────────────────────────────
    _chargerModule(jeu, gameState, snapshot) {
        this.module?.destroy?.();
        this.module = null;

        const jeuReel = snapshot?.jeu || jeu || this.session.jeu;
        if (jeuReel) {
            this.session.jeu = jeuReel;
            setText('hdr-jeu', jeuReel.toUpperCase());
        }

        const mod = JeuRegistry.get(jeuReel);
        if (mod) {
            this.module = mod;
            mod.initPlayer(this.session, this.socket, gameState, snapshot);
        } else {
            this._afficherJeuSurHote(jeuReel);
        }
    },
};

// ================================================================
// MODULE QUIZ — côté invité
// ================================================================
// Événements WS reçus :
//   QUIZ_QUESTION   { posees, total, theme, question, tempsRestant, ts,
//                    hasIndice1, hasIndice2 }
//   QUIZ_INDICE     { num, texte }
//   QUIZ_ANSWER_ACK { status: 'ok'|'already_answered'|'too_late', texte? }
//   QUIZ_CORRECTION { posees, total, theme, question, reponse,
//                    reponses: [{pseudo, texte, correct, points, estPremier}] }
//   QUIZ_END        { scores: {pseudo: pts}, total }
//
// Événements WS envoyés :
//   PLAYER_ACTION   { action: 'quiz:answer', data: { texte } }
// ================================================================
const QuizModule = {

    _session       : null,
    _socket        : null,
    _aRepondu      : false,
    _timerInterval : null,
    _timerSecondes : 60,
    _timerExpire   : false,
    _totalQ        : 0,

    initPlayer(session, sock, gameState, snapshot) {
        this._session       = session;
        this._socket        = sock;
        this._aRepondu      = false;
        this._timerExpire   = false;
        this._timerInterval = null;

        this._afficherEcranAttente();
        if (gameState) this._rehydrater(gameState, session.pseudo);

        // Listeners directs sur le socket (cas normal)
        sock.on('QUIZ_QUESTION',   payload  => this._onQUIZ_QUESTION(payload));
        sock.on('QUIZ_INDICE',     payload  => this._onQUIZ_INDICE(payload));
        sock.on('QUIZ_ANSWER_ACK', payload  => this._onQUIZ_ANSWER_ACK(payload));
        sock.on('QUIZ_CORRECTION',    payload  => this._onQUIZ_CORRECTION(payload));
        sock.on('QUIZ_END',           payload  => this._onQUIZ_END(payload));
        sock.on('QUIZ_TIMER_EXPIRED', ()         => this._onQUIZ_TIMER_EXPIRED());
        sock.on('QUIZ_CAN_NEXT',      ({ scores }) => this._onQUIZ_CAN_NEXT(scores));

        $('p-btn-send')?.addEventListener('click',    () => this._envoyerReponse());
        $('p-answer-input')?.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) this._envoyerReponse();
        });
    },

    destroy() { this._arreterTimer(); },
    onHostAction() {},
    onScores()    {},

    // ── Aliases pour le relay Player.init() ────────────────────
    _onQUIZ_QUESTION(payload) {
        if (payload.total) this._totalQ = payload.total;
        this._afficherQuestion(payload);
    },
    _onQUIZ_INDICE({ num, texte }) {
        const el = $(`p-indice${num}`);
        if (el) { el.textContent = `💡 Indice ${num} : ${texte}`; el.hidden = false; }
    },
    _onQUIZ_ANSWER_ACK({ status, texte }) {
        if (status === 'ok') {
            this._aRepondu = true;
            this._arreterTimer();
            this._confirmerEnvoi(texte);
        } else if (status === 'already_answered') toast('Vous avez déjà répondu.', 'warning');
        else if (status === 'too_late')           toast('Trop tard.', 'warning');
        else                                      toast('Réponse invalide.', 'error');
    },
    _onQUIZ_CAN_NEXT(scores) {
        // Mettre à jour les scores affichés si la correction est visible
        if (scores && this._session?.pseudo) {
            const mesPoints = scores[this._session.pseudo] ?? 0;
            const el = $('p-mes-points');
            if (el) el.textContent = mesPoints + ' pt' + (mesPoints > 1 ? 's' : '');
        }
    },
    _onQUIZ_TIMER_EXPIRED() {
        // Timer serveur écoulé → bloquer la saisie si l'invité n'a pas répondu
        this._timerExpire = true;
        this._arreterTimer();
        const input = $('p-answer-input');
        const btn   = $('p-btn-send');
        if (input && !this._aRepondu) {
            input.disabled     = true;
            input.placeholder  = '⏱ Temps écoulé';
        }
        if (btn && !this._aRepondu) {
            btn.disabled    = true;
            btn.textContent = '⏱ Temps écoulé';
        }
        if (!this._aRepondu) toast('⏱ Temps écoulé ! En attente de la correction…', 'warning', 3000);
    },
    _onQUIZ_CORRECTION(payload) {
        this._arreterTimer();
        this._afficherCorrection(payload, this._session?.pseudo);
    },
    _onQUIZ_END({ scores, total }) {
        // Ignorer QUIZ_END {total:0} — artifact d'une session résiduelle
        // côté serveur (ancienne partie non nettoyée).
        // Un quiz valide a toujours total >= 1.
        if (!total || total === 0) {
            console.warn('[QUIZ] ⚠️ QUIZ_END ignoré — total:0 (session résiduelle serveur)');
            return;
        }
        this._arreterTimer();
        this._afficherFin(scores, this._session?.pseudo);
    },

    _afficherEcranAttente() {
        const cont = $('jeu-contenu');
        if (!cont) return;
        cont.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;
                justify-content:center;min-height:50vh;gap:1.25rem;
                text-align:center;padding:2rem;">
                <div style="font-size:2.5rem;">❓</div>
                <h2 style="margin:0;font-size:1.1rem;">Quiz en cours</h2>
                <p style="color:var(--mgu-encre-600);margin:0;">
                    En attente de la prochaine question…
                </p>
            </div>`;
    },

    _afficherQuestion(payload) {
        this._aRepondu    = false;
        this._timerExpire = false;

        const { theme, question, posees, total, tempsRestant } = payload;
        const totalAff = total ?? this._totalQ;
        const cont = $('jeu-contenu');
        if (!cont) return;

        cont.innerHTML = `
            <div style="padding:1rem 0;display:flex;flex-direction:column;gap:1rem;">
                <div style="display:flex;justify-content:space-between;
                    align-items:center;flex-wrap:wrap;gap:.5rem;">
                    <span style="font-size:.75rem;text-transform:uppercase;
                        letter-spacing:.1em;color:var(--mgu-encre-600);
                        background:var(--mgu-carton-50);
                        border:1px solid var(--mgu-carton-line);
                        border-radius:6px;padding:4px 10px;">
                        ${esc(theme || '—')}
                    </span>
                    <span style="font-size:.75rem;color:#64748b;font-weight:600;">
                        Q ${posees} / ${totalAff || '?'}
                    </span>
                </div>
                <div style="font-size:1.15rem;font-weight:700;line-height:1.45;
                    text-align:center;padding:.75rem;
                    background:var(--mgu-carton-50);border-radius:12px;">
                    ${esc(question)}
                </div>
                <div style="display:flex;flex-direction:column;gap:.5rem;">
                    <div id="p-indice1" hidden
                        style="font-size:.85rem;color:var(--mgu-or-600);padding:.5rem .75rem;
                               background:rgba(232,178,59,.1);
                               border:1px solid rgba(232,178,59,.25);border-radius:8px;"></div>
                    <div id="p-indice2" hidden
                        style="font-size:.85rem;color:#f97316;padding:.5rem .75rem;
                               background:rgba(249,115,22,.1);
                               border:1px solid rgba(249,115,22,.25);border-radius:8px;"></div>
                </div>
                <div id="p-texte-answer-zone"
                    style="display:flex;flex-direction:column;gap:.75rem;">
                    <input id="p-answer-input" type="text" autocomplete="off"
                        placeholder="Votre réponse…"
                        style="width:100%;box-sizing:border-box;padding:.75rem 1rem;
                               background:var(--mgu-carton-50);
                               border:1.5px solid var(--mgu-carton-line);
                               border-radius:10px;color:var(--mgu-encre-900);font-size:1rem;
                               font-family:inherit;outline:none;">
                    <button id="p-btn-send"
                        style="padding:.85rem;background:rgba(95,167,119,.2);
                               border:1.5px solid rgba(95,167,119,.45);
                               border-radius:10px;color:var(--mgu-encre-900);font-size:.95rem;
                               font-weight:700;cursor:pointer;font-family:inherit;">
                        ✉️ Envoyer
                    </button>
                </div>
                <div id="p-texte-sent" hidden
                    style="padding:1rem;background:rgba(95,167,119,.12);
                           border:1px solid rgba(95,167,119,.3);border-radius:10px;
                           text-align:center;color:#2f5f42;font-size:.9rem;"></div>
            </div>`;

        $('p-btn-send')?.addEventListener('click',    () => this._envoyerReponse());
        $('p-answer-input')?.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) this._envoyerReponse();
        });

        this._demarrerTimer(tempsRestant ?? 60);
        setTimeout(() => $('p-answer-input')?.focus(), 150);
    },

    _confirmerEnvoi(texte) {
        const zone = $('p-texte-answer-zone');
        const sent = $('p-texte-sent');
        if (zone) zone.hidden = true;
        if (sent) {
            sent.hidden   = false;
            sent.innerHTML = `✅ Réponse envoyée : <strong>${esc(texte)}</strong><br>
                <small style="opacity:.7;">En attente de la correction…</small>`;
        }
        toast('Réponse envoyée !', 'success', 2000);
    },

    _afficherCorrection(payload, pseudo) {
        const cont = $('jeu-contenu');
        if (!cont) return;
        const { theme, question, reponse, reponses, posees, total } = payload;
        const maRep = (reponses || []).find(r => r.pseudo === pseudo);

        // Score total du joueur dans GameState (mis à jour par SCORES_UPDATE)
        const scoresActuels = window.Player?.scoreLocal ?? 0;

        let fb;
        if (!maRep) {
            fb = `<div style="background:rgba(100,116,139,.12);
                border:1px solid rgba(100,116,139,.3);border-radius:10px;
                padding:.75rem;color:var(--mgu-encre-600);">
                😶 Tu n'as pas répondu à temps. +0 pt
            </div>`;
        } else if (maRep.correct) {
            const prem = maRep.estPremier
                ? '<span style="color:var(--mgu-or-600);"> 🏆 +1 bonus premier !</span>'
                : '';
            const totalPts = maRep.points;
            fb = `<div style="background:rgba(95,167,119,.12);
                border:1px solid rgba(95,167,119,.3);border-radius:10px;
                padding:.75rem;color:#2f5f42;font-weight:600;">
                🎉 Bonne réponse ! <strong>+${totalPts} pt${totalPts !== 1 ? 's' : ''}</strong>${prem}
            </div>`;
        } else {
            fb = `<div style="background:rgba(214,72,79,.12);
                border:1px solid rgba(214,72,79,.3);border-radius:10px;
                padding:.75rem;color:#8a2f33;">
                ❌ Mauvaise réponse — tu as écrit :
                <em>${esc(maRep.texte)}</em> +0 pt
            </div>`;
        }

        const totalAff = total ?? this._totalQ;
        cont.innerHTML = `
            <div style="padding:1rem 0;display:flex;flex-direction:column;gap:1rem;">
                <div style="display:flex;justify-content:space-between;
                    font-size:.75rem;color:#64748b;">
                    <span>${esc(theme || '—')}</span>
                    <span>Q ${posees} / ${totalAff}</span>
                </div>
                <div style="font-size:1rem;font-weight:600;line-height:1.4;
                    color:var(--mgu-encre-600);text-align:center;">
                    ${esc(question)}
                </div>
                <div style="text-align:center;">
                    <div style="font-size:.72rem;text-transform:uppercase;
                        letter-spacing:.08em;color:var(--mgu-encre-600);margin-bottom:.35rem;">
                        Réponse correcte
                    </div>
                    <div style="font-size:1.25rem;font-weight:800;color:var(--mgu-or-600);">
                        ${esc(reponse)}
                    </div>
                </div>
                ${fb}
                <div id="p-mes-points-row" style="text-align:center;margin-top:.5rem;
                    padding:.5rem;background:rgba(232,178,59,.06);border-radius:8px;
                    font-size:.82rem;color:var(--mgu-encre-600);">
                    Ton score : <span id="p-mes-points" style="color:var(--mgu-or-600);font-weight:700;">
                        ${this.scoreLocal ?? 0} pt${(this.scoreLocal ?? 0) > 1 ? 's' : ''}
                    </span>
                </div>
                <p style="font-size:.8rem;color:var(--mgu-encre-600);
                    text-align:center;margin:0;">
                    En attente de la prochaine question…
                </p>
            </div>`;
    },

    _afficherFin(scores, pseudo) {
        const cont    = $('jeu-contenu');
        if (!cont) return;
        const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
        const medals  = ['🥇','🥈','🥉'];
        cont.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;
                justify-content:center;min-height:50vh;text-align:center;
                padding:2rem;gap:1.5rem;">
                <span style="font-size:3rem;">🏆</span>
                <h2 style="margin:0;">Quiz terminé !</h2>
                <div style="display:flex;flex-direction:column;gap:.5rem;
                    width:100%;max-width:340px;">
                    ${entries.map(([nom, pts], i) => `
                        <div style="display:flex;justify-content:space-between;
                            align-items:center;padding:.7rem 1rem;border-radius:10px;
                            background:${nom === pseudo
                                ? 'rgba(232,178,59,.12)' : 'rgba(255,255,255,.04)'};
                            ${nom === pseudo
                                ? 'outline:2px solid rgba(232,178,59,.4);' : ''}">
                            <span>
                                ${medals[i] || (i + 1) + '.'} ${esc(nom)}
                                ${nom === pseudo
                                    ? '<em style="font-size:.8rem;opacity:.6;"> (toi)</em>'
                                    : ''}
                            </span>
                            <span style="font-weight:700;color:${
                                nom === pseudo ? 'var(--mgu-or-600)' : 'white'}">
                                ${pts} pts
                            </span>
                        </div>`).join('')}
                </div>
                <a href="/"
                    style="display:inline-block;padding:.75rem 2rem;
                        background:linear-gradient(135deg,var(--mgu-or-600),var(--mgu-or-500));
                        border-radius:10px;color:var(--mgu-encre-900);text-decoration:none;font-weight:700;">
                    🏠 Retour à l'accueil
                </a>
            </div>`;
    },

    _rehydrater(gs, pseudo) {
        if (!gs) return;
        if (gs.phase === 'question' && gs.payload) {
            this._afficherQuestion(gs.payload);
            toast('Question en cours — rejointe.', 'info', 2000);
        } else if (gs.phase === 'correction' && gs.payload) {
            this._afficherCorrection(gs.payload, pseudo);
            this._arreterTimer();
        } else if (gs.phase === 'ended') {
            this._afficherFin(gs.scores || {}, pseudo);
        }
    },

    _envoyerReponse() {
        if (this._aRepondu || this._timerExpire) return;
        const input = $('p-answer-input');
        const texte = input?.value.trim();
        if (!texte) { toast('Écrivez votre réponse.', 'warning'); return; }
        const btn = $('p-btn-send');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Envoi…'; }
        this._socket.send('PLAYER_ACTION', { action: 'quiz:answer', data: { texte } });
    },

    _demarrerTimer(s = 60) {
        this._arreterTimer();
        this._timerSecondes = s;
        this._timerExpire   = false;
        this._afficherTimer(s);
        this._timerInterval = setInterval(() => {
            this._timerSecondes--;
            if (this._timerSecondes <= 0) {
                this._timerSecondes = 0;
                this._afficherTimer(0);
                this._expirerTimer();
                this._arreterTimer();
            } else {
                this._afficherTimer(this._timerSecondes);
            }
        }, 1000);
    },

    _arreterTimer() {
        if (this._timerInterval) { clearInterval(this._timerInterval); this._timerInterval = null; }
    },

    _afficherTimer(s) {
        let el = $('p-timer');
        if (!el) {
            const zone = $('p-texte-answer-zone');
            if (!zone) return;
            el = document.createElement('div'); el.id = 'p-timer';
            el.style.cssText = 'font-family:monospace;font-size:1.8rem;font-weight:700;text-align:center;transition:color .3s;margin-bottom:.25rem;';
            zone.parentNode.insertBefore(el, zone);
        }
        el.textContent = `⏱ ${s}s`;
        el.style.color  = s <= 5 ? 'var(--mgu-pion-rouge)' : s <= 15 ? 'var(--mgu-or-600)' : 'var(--mgu-or-600)';
    },

    _expirerTimer() {
        this._timerExpire = true;
        const input = $('p-answer-input');
        const btn   = $('p-btn-send');
        if (input) { input.disabled = true; input.placeholder = '⏱ Temps écoulé'; }
        if (btn)   { btn.disabled   = true; btn.textContent   = '⏱ Temps écoulé'; }
        if (!this._aRepondu) toast('⏱ Temps écoulé !', 'warning', 3000);
    },
};

// Enregistrer le module quiz
JeuRegistry.register('quiz', QuizModule);

// Import the MimeDessineModule
import { MimeDessineModule } from './mime_player.js';
// Register the MimeDessineModule
JeuRegistry.register('mimedessine', MimeDessineModule);
// Le jeu mime tourne sous la clé 'mimer' (section #mimer / GAME_INITIALIZERS) :
// on enregistre le module sous les DEUX clés pour que JeuRegistry.get() le trouve.
JeuRegistry.register('mimer', MimeDessineModule);

// Exporter JeuRegistry pour permettre l'ajout de modules depuis d'autres fichiers
export { JeuRegistry };