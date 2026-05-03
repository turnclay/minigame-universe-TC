// ======================================================
// 🎮 public/js/jeu.js — v3.0 WebSocket-first
// ======================================================
// Réécriture complète depuis la V2 localStorage-based.
//
// Architecture :
//   JeuApp          — point d'entrée, lit les params URL,
//                     ouvre le WebSocket, dispatche au bon module
//   ├── RoleHost    — logique côté host (HOST_AUTH, HOST_REJOIN,
//   │                 HOST_ACTION, contrôles jeu)
//   ├── RolePlayer  — logique côté joueur (PLAYER_JOIN/REJOIN,
//   │                 PLAYER_ACTION, attente → jeu)
//   └── JeuRegistry — charge dynamiquement le module du jeu actif
//       └── QuizModule — port de quiz_hote.js + quiz-client.js V3
//
// URL attendue :
//   /jeu?partieId=UUID&pseudo=MON_PSEUDO&role=player|host|host-player
//   (role=host → écran hôte sans participation au jeu)
//   (role=host-player → hôte qui joue aussi)
//   (role=player → invité standard)
//
// Modules V2 conservés (jeux/ et modules/) :
//   Tous les fichiers jeux/*.js et modules/*_hote.js sont
//   préservés intacts. Ce fichier ne les importe pas directement —
//   il expose window.JeuApp pour qu'ils puissent interagir.
//   Pour le quiz spécifiquement, QuizModule remplace quiz_hote.js
//   en utilisant le canal WS à la place de localStorage.
//
// ======================================================

import { socket } from './core/socket.js';

// ─────────────────────────────────────────────────────
// UTILITAIRES
// ─────────────────────────────────────────────────────

const $ = id => document.getElementById(id);
const show = id => { const e = $(id); if (e) e.hidden = false; };
const hide = id => { const e = $(id); if (e) e.hidden = true; };
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const setText = (id, t) => { const e = $(id); if (e) e.textContent = t ?? ''; };

function toast(msg, type = 'info', duration = 3000) {
    const COLORS = { success:'#22c55e', error:'#ef4444', warning:'#f59e0b', info:'#00d4ff' };
    const ICONS  = { success:'✅', error:'❌', warning:'⚠️', info:'ℹ️' };
    let c = $('toast-container');
    if (!c) {
        c = document.createElement('div');
        c.id = 'toast-container';
        c.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:9999;display:flex;flex-direction:column;gap:.4rem;max-width:310px;pointer-events:none;';
        document.body.appendChild(c);
    }
    const el = document.createElement('div');
    el.style.cssText = [
        'display:flex;gap:.5rem;align-items:flex-start',
        'padding:.65rem .9rem;border-radius:8px',
        `background:#1e1e2e;color:#fff;border-left:3px solid ${COLORS[type]||COLORS.info}`,
        'box-shadow:0 4px 16px rgba(0,0,0,.5)',
        'opacity:0;transition:opacity .2s,transform .2s;transform:translateX(12px)',
        'font-size:.88rem;pointer-events:auto',
    ].join(';');
    el.innerHTML = `<span style="flex-shrink:0">${ICONS[type]||'ℹ️'}</span><span>${esc(msg)}</span>`;
    c.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity='1'; el.style.transform='translateX(0)'; });
    setTimeout(() => {
        el.style.opacity='0'; el.style.transform='translateX(8px)';
        setTimeout(() => el.remove(), 220);
    }, duration);
}

function showBanner(msg) {
    let b = $('disconnect-banner');
    if (!b) {
        b = document.createElement('div');
        b.id = 'disconnect-banner';
        b.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#f87171;color:#000;text-align:center;padding:.5rem;font-weight:600;z-index:9999;display:none;';
        document.body.prepend(b);
    }
    b.textContent = msg;
    b.style.display = 'block';
}
function hideBanner() {
    const b = $('disconnect-banner'); if (b) b.style.display = 'none';
}

// ─────────────────────────────────────────────────────
// SESSION (paramètres URL + sessionStorage)
// ─────────────────────────────────────────────────────

function chargerSession() {
    const params     = new URLSearchParams(location.search);
    const partieId   = params.get('partieId')   || params.get('sessionId') || null;
    const pseudo     = params.get('pseudo')      || null;
    const role       = params.get('role')        || 'player';
    const jeu        = params.get('jeu')         || null;
    // Paramètres format V2 natif (générés par invite.js)
    const partieNom  = params.get('partieNom')   || null;
    const hote       = params.get('hote')        || null;

    // Format complet V3 : partieId + pseudo présents → session directe
    if (partieId && pseudo) {
        const session = { partieId, pseudo, role, jeu, partieNom, hote };
        try { sessionStorage.setItem('mgu_game_session', JSON.stringify(session)); } catch {}
        return session;
    }

    // Format V2 natif : partieId présent mais pseudo absent
    // → retourner une session partielle : JeuApp demandera le pseudo
    if (partieId) {
        return {
            partieId,
            pseudo      : null,
            role        : role || 'player',
            jeu,
            partieNom,
            hote,
            needsPseudo : true,
        };
    }

    // Fallback : sessionStorage (après navigation join → jeu)
    try {
        const saved = JSON.parse(sessionStorage.getItem('mgu_game_session') || 'null');
        if (saved?.partieId && saved?.pseudo) return saved;
    } catch {}

    return null;
}

// ─────────────────────────────────────────────────────
// REGISTRY DES MODULES DE JEU
// ─────────────────────────────────────────────────────

const JeuRegistry = {
    _modules: {},

    register(jeu, module) {
        this._modules[jeu] = module;
    },

    get(jeu) {
        return this._modules[jeu] || null;
    },

    has(jeu) {
        return Boolean(this._modules[jeu]);
    },
};

// ─────────────────────────────────────────────────────
// HOST PANELS (écran hôte)
// ─────────────────────────────────────────────────────

const HOST_PANELS = [
    'host-idle', 'host-question-panel', 'host-correction-panel', 'host-fin-panel',
];

const PLAYER_PANELS = [
    'player-waiting', 'player-texte-panel', 'player-qcm-panel',
    'player-correction-panel', 'player-fin-panel',
];

function showHostPanel(id) {
    HOST_PANELS.forEach(p => { const e = $(p); if (e) e.hidden = (p !== id); });
}

function showPlayerPanel(id) {
    PLAYER_PANELS.forEach(p => { const e = $(p); if (e) e.hidden = (p !== id); });
}

// ─────────────────────────────────────────────────────
// RÔLE HOST
// ─────────────────────────────────────────────────────

const RoleHost = {
    session   : null,
    snapshot  : null,
    gameState : null,
    module    : null,

    init(session) {
        this.session = session;
        show('view-host');
        hide('view-player');

        // Authentifier
        socket.once('__connected__', () => {
            socket.send('HOST_AUTH', {});
        });

        socket.on('AUTH_OK', () => {
            hideBanner();
            // Tenter un rejoin si partie déjà existante
            socket.send('HOST_REJOIN', { partieId: session.partieId });
        });

        socket.on('HOST_REJOINED', ({ partieId, snapshot, gameState, joinUrl }) => {
            this.snapshot  = snapshot;
            this.gameState = gameState;
            toast('Reconnecté comme host ✅', 'success', 2000);
            this._applySnapshot(snapshot);
            if (joinUrl) this._renderJoinLink(joinUrl, snapshot?.codeCourt);
            // Réhydrater le module si déjà en cours
            const mod = JeuRegistry.get(snapshot?.jeu || session.jeu);
            if (mod?.onHostRejoined) mod.onHostRejoined(gameState, snapshot, session);
        });

        socket.on('ERROR', ({ code, message }) => {
            if (code === 'GAME_NOT_FOUND') {
                toast('Partie introuvable — elle a peut-être expiré.', 'warning', 5000);
                // L'hôte devra recréer via main.js
            } else {
                toast(message || `Erreur: ${code}`, 'error');
            }
        });

        socket.on('GAME_STARTED', ({ snapshot, joinUrl }) => {
            this.snapshot = snapshot;
            if (joinUrl) this._renderJoinLink(joinUrl, snapshot?.codeCourt);
        });

        socket.on('CODE_GENERATED', ({ code }) => {
            this._renderCode(code);
        });

        socket.on('PLAYER_JOINED', ({ pseudo, joueurs }) => {
            toast(`🎉 ${pseudo} a rejoint ! (${joueurs.length})`, 'success', 2500);
            this._renderJoueurs(joueurs);
        });

        socket.on('PLAYER_LEFT', ({ pseudo, joueurs }) => {
            toast(`${pseudo} a quitté`, 'warning', 2000);
            this._renderJoueurs(joueurs);
        });

        socket.on('SCORES_UPDATE', ({ scores }) => {
            this._renderScores(scores);
        });

        socket.on('GAME_ENDED', ({ snapshot }) => {
            this.snapshot = snapshot;
            toast('Partie terminée 🏁', 'info', 5000);
        });

        socket.on('__disconnected__', () => {
            showBanner('⚠️ Connexion perdue — reconnexion en cours…');
        });

        socket.on('__connected__', () => {
            hideBanner();
        });

        // Charger le module du jeu
        const jeu = session.jeu;
        if (jeu && JeuRegistry.has(jeu)) {
            this.module = JeuRegistry.get(jeu);
            if (this.module.initHost) this.module.initHost(session, socket, helpers_host);
        }
    },

    _applySnapshot(snap) {
        if (!snap) return;
        setText('h-info-nom',  snap.nom || '—');
        setText('h-info-jeu',  (snap.jeu || '—').toUpperCase());
        setText('h-info-mode', snap.mode === 'team' ? '🛡️ Équipes' : '👤 Solo');
        this._renderJoueurs(snap.joueurs || []);
        this._renderScores(snap.scores || {});
    },

    _renderJoueurs(joueurs) {
        const el = $('h-joueurs-connectes');
        const nb = $('h-nb-joueurs');
        if (nb) nb.textContent = joueurs.length;
        if (!el) return;
        if (joueurs.length === 0) {
            el.innerHTML = '<div style="text-align:center;padding:1.5rem;opacity:.5;"><p>En attente de joueurs…</p></div>';
            return;
        }
        el.innerHTML = joueurs.map(j => {
            const init = (j.pseudo || '?').charAt(0).toUpperCase();
            return `<div style="display:flex;align-items:center;gap:.6rem;padding:.5rem .75rem;background:rgba(255,255,255,.04);border-radius:8px;margin-bottom:.4rem;">
                <span style="width:30px;height:30px;border-radius:50%;background:#00d4ff22;display:flex;align-items:center;justify-content:center;font-weight:700;color:#00d4ff;">${init}</span>
                <span style="flex:1;font-weight:500;">${esc(j.pseudo)}</span>
                ${j.equipe ? `<span style="font-size:.75rem;opacity:.6;background:rgba(255,255,255,.06);padding:.2rem .5rem;border-radius:4px;">🛡️ ${esc(j.equipe)}</span>` : ''}
                <button class="btn-kick" data-pseudo="${esc(j.pseudo)}" style="background:none;border:1px solid #f8717140;color:#f87171;padding:.2rem .5rem;border-radius:5px;cursor:pointer;font-size:.8rem;">✖</button>
            </div>`;
        }).join('');
        el.querySelectorAll('.btn-kick').forEach(btn => {
            btn.addEventListener('click', () => {
                if (confirm(`Expulser ${btn.dataset.pseudo} ?`)) {
                    socket.send('HOST_KICK_PLAYER', { pseudo: btn.dataset.pseudo });
                }
            });
        });
    },

    _renderScores(scores) {
        const el = $('h-scores-liste');
        if (!el) return;
        const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
        if (entries.length === 0) {
            el.innerHTML = '<p style="opacity:.5;font-size:.9rem;">Aucun score encore.</p>';
            return;
        }
        const medals = ['🥇','🥈','🥉'];
        const max    = entries[0]?.[1] || 1;
        el.innerHTML = entries.map(([nom, pts], i) => {
            const pct = max > 0 ? Math.round((pts / max) * 100) : 0;
            return `<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem;">
                <span style="width:1.5rem;">${medals[i] || `${i+1}.`}</span>
                <span style="flex:1;font-weight:500;">${esc(nom)}</span>
                <div style="width:70px;height:5px;background:#ffffff15;border-radius:3px;overflow:hidden;">
                    <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,#00d4ff,#7c3aed);border-radius:3px;"></div>
                </div>
                <span style="font-size:.85rem;min-width:44px;text-align:right;">${pts}pts</span>
                <button class="bpt" data-c="${esc(nom)}" data-d="1" style="background:#00d4ff15;border:none;color:#00d4ff;padding:.15rem .4rem;border-radius:4px;cursor:pointer;">＋</button>
                <button class="bpt" data-c="${esc(nom)}" data-d="-1" style="background:#f8717115;border:none;color:#f87171;padding:.15rem .4rem;border-radius:4px;cursor:pointer;">－</button>
            </div>`;
        }).join('');
        el.querySelectorAll('.bpt').forEach(btn => {
            btn.addEventListener('click', () => {
                const d = parseInt(btn.dataset.d);
                socket.send(d > 0 ? 'HOST_ADD_POINTS' : 'HOST_REMOVE_POINTS', { cible: btn.dataset.c, points: 1 });
            });
        });
    },

    _renderJoinLink(joinUrl, code) {
        const fullUrl = `${location.origin}${joinUrl}`;
        const linkEl  = $('h-join-link');
        if (linkEl) { linkEl.href = fullUrl; linkEl.textContent = fullUrl; }
        if (code) this._renderCode(code);
    },

    _renderCode(code) {
        let codeEl = $('h-code-court');
        if (!codeEl) {
            codeEl = document.createElement('div');
            codeEl.id = 'h-code-court';
            const joinBlock = document.querySelector('.join-block');
            const qrEl = $('h-qr');
            if (joinBlock && qrEl) joinBlock.insertBefore(codeEl, qrEl);
            else if (joinBlock) joinBlock.appendChild(codeEl);
        }
        const joinUrl = `${location.origin}/jeu?partieId=${this.session?.partieId}&role=player&code=${code}`;
        codeEl.innerHTML = `
            <p style="font-size:.72rem;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin:0 0 .4rem;">📱 Code de la partie</p>
            <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.4rem;">
                <span style="font-size:2rem;font-weight:900;letter-spacing:.2em;color:#00d4ff;">${esc(code)}</span>
                <button id="h-btn-copy-code" style="background:rgba(0,212,255,.12);border:1px solid rgba(0,212,255,.25);color:#00d4ff;border-radius:6px;padding:.3rem .6rem;cursor:pointer;font-size:.8rem;">📋</button>
            </div>
            <p style="font-size:.78rem;opacity:.5;margin:0;">Les joueurs entrent ce code sur <strong>${location.origin}/jeu</strong></p>`;
        $('h-btn-copy-code')?.addEventListener('click', () => {
            navigator.clipboard.writeText(code)
                .then(() => toast('Code copié ! 🔑', 'success', 1500))
                .catch(() => {});
        });
        // QR code
        const qrEl = $('h-qr');
        if (qrEl) {
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(joinUrl)}&bgcolor=0d0d1a&color=00d4ff&margin=2`;
            qrEl.innerHTML = `<img src="${qrUrl}" alt="QR Code" style="border-radius:8px;display:block;" onerror="this.parentElement.innerHTML='<p style=opacity:.4;font-size:.8rem>QR indisponible</p>'">`;
        }
    },
};

// Helpers exposés aux modules de jeu côté host
const helpers_host = {
    toast,
    showHostPanel,
    showPlayerPanel,
    setText,
    show,
    hide,
    $,
};

// ─────────────────────────────────────────────────────
// RÔLE PLAYER
// ─────────────────────────────────────────────────────

const RolePlayer = {
    session   : null,
    snapshot  : null,
    gameState : null,
    module    : null,
    scoreLocal: 0,

    init(session) {
        this.session = session;
        hide('view-host');
        show('view-player');
        setText('pg-pseudo', session.pseudo);
        showPlayerPanel('player-waiting');

        socket.once('__connected__', () => {
            // Tenter d'abord un PLAYER_REJOIN (si retour après navigation)
            socket.send('PLAYER_REJOIN', { partieId: session.partieId, pseudo: session.pseudo });
        });

        socket.on('REJOIN_OK', ({ pseudo, equipe, snapshot, gameState }) => {
            hideBanner();
            this.snapshot  = snapshot;
            this.gameState = gameState;
            this.session.equipe = equipe;
            toast(`Reconnecté : ${pseudo} 👋`, 'success', 2000);
            this._chargerModule(snapshot?.jeu || session.jeu, gameState, snapshot);
        });

        socket.on('JOIN_ERROR', ({ code }) => {
            // PLAYER_NOT_FOUND sur PLAYER_REJOIN → première connexion,
            // tenter un PLAYER_JOIN une seule fois.
            if (code === 'PLAYER_NOT_FOUND') {
                socket.send('PLAYER_JOIN', {
                    pseudo   : session.pseudo,
                    partieId : session.partieId,
                });
                return;
            }

            // GAME_NOT_FOUND : la partie n'existe pas encore côté serveur.
            // NE PAS boucler — afficher un message avec bouton retry.
            if (code === 'GAME_NOT_FOUND') {
                const contenu = document.querySelector('#player-waiting, #phase-jeu, main') || document.body;
                contenu.innerHTML = `
                    <div style="display:flex;flex-direction:column;align-items:center;
                        justify-content:center;min-height:60vh;text-align:center;padding:2rem;gap:1rem;">
                        <span style="font-size:3rem;">⏳</span>
                        <h2 style="color:white;margin:0;">Partie pas encore prête</h2>
                        <p style="color:rgba(255,255,255,.6);max-width:320px;">
                            L'hôte n'a pas encore créé la partie côté serveur,
                            ou le serveur a redémarré. Attends quelques secondes
                            que l'hôte lance le jeu, puis réessaie.
                        </p>
                        <button id="btn-retry-join"
                            style="padding:.75rem 2rem;background:rgba(0,212,255,.15);
                                border:1px solid rgba(0,212,255,.4);border-radius:10px;
                                color:#00d4ff;font-size:.95rem;cursor:pointer;font-family:inherit;">
                            🔄 Réessayer
                        </button>
                        <a href="/" style="font-size:.8rem;color:rgba(255,255,255,.3);text-decoration:none;margin-top:.5rem;">
                            ← Retour à l'accueil
                        </a>
                    </div>`;
                document.getElementById('btn-retry-join')?.addEventListener('click', () => {
                    window.location.reload();
                });
                return;
            }

            const msgs = {
                PSEUDO_TAKEN  : 'Ce pseudo est déjà utilisé dans cette partie.',
                GAME_STARTED  : "La partie est déjà en cours — ton pseudo n'est pas dans la liste.",
                MAX_PLAYERS   : 'La partie est complète.',
                PSEUDO_INVALID: 'Pseudo invalide (2-20 caractères).',
                MISSING_FIELDS: 'Données manquantes.',
            };
            toast(msgs[code] || 'Erreur: ' + code, 'error', 5000);
        });

        socket.on('JOIN_OK', ({ pseudo, equipe, snapshot }) => {
            hideBanner();
            this.snapshot = snapshot;
            this.session.equipe = equipe;
            toast(`Bienvenue ${pseudo} ! En attente du lancement…`, 'success', 3000);
            this._afficherAttente(snapshot);
        });

        socket.on('GAME_STARTED', ({ snapshot }) => {
            this.snapshot = snapshot;
            toast('La partie commence ! 🚀', 'success', 2000);
            this._chargerModule(snapshot?.jeu || session.jeu, null, snapshot);
        });

        socket.on('HOST_ACTION', ({ action, data }) => {
            if (this.module?.onHostAction) this.module.onHostAction(action, data);
        });

        socket.on('SCORES_UPDATE', ({ scores }) => {
            const pts = scores?.[session.pseudo] ?? this.scoreLocal;
            this.scoreLocal = pts;
            setText('pg-score-val', `${pts} pt${pts !== 1 ? 's' : ''}`);
            if (this.module?.onScores) this.module.onScores(scores);
        });

        socket.on('GAME_ENDED', ({ snapshot }) => {
            this.snapshot = snapshot;
            this._afficherFin(snapshot?.scores || {});
        });

        socket.on('KICKED', ({ reason }) => {
            toast(`Vous avez été expulsé : ${reason || 'par le host'}`, 'error', 5000);
            setTimeout(() => window.location.href = '/jeu', 2000);
        });

        socket.on('HOST_DISCONNECTED', ({ message }) => {
            showBanner(`⚠️ ${message || "Le host s'est déconnecté"}`);
        });

        socket.on('__disconnected__', () => {
            showBanner('⚠️ Connexion perdue — reconnexion en cours…');
        });

        socket.on('__connected__', () => {
            hideBanner();
        });
    },

    _afficherAttente(snapshot) {
        const jeuIcon   = _jeuIcon(snapshot?.jeu);
        const modeLabel = snapshot?.mode === 'team' ? '🛡️ Équipes' : '👤 Solo';
        const contenu   = $('player-waiting') || document.querySelector('#phase-jeu') || document.body;

        contenu.innerHTML = `
            <div id="ecran-attente" style="display:flex;flex-direction:column;align-items:center;
                justify-content:center;min-height:60vh;text-align:center;padding:2rem;gap:1.5rem;">
                <div style="background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.3);
                    border-radius:12px;padding:.6rem 1.2rem;color:#4ade80;font-size:.85rem;font-weight:600;">
                    ✅ Connecté à la partie
                </div>
                <div style="background:rgba(0,212,255,.07);border:1px solid rgba(0,212,255,.2);
                    border-radius:16px;padding:1.5rem 2rem;min-width:280px;max-width:400px;width:100%;">
                    <div style="font-size:3rem;margin-bottom:.5rem;">${jeuIcon}</div>
                    <div style="font-size:1.2rem;font-weight:700;margin-bottom:.25rem;">${esc(snapshot?.nom||'Partie')}</div>
                    <div style="font-size:.85rem;opacity:.6;margin-bottom:1rem;">
                        ${(snapshot?.jeu||'').toUpperCase()} · ${modeLabel}
                    </div>
                    <div style="background:rgba(255,255,255,.05);border-radius:8px;padding:.75rem;margin-bottom:.75rem;">
                        <div style="font-size:.75rem;color:#64748b;margin-bottom:.2rem;">VOTRE PSEUDO</div>
                        <div style="font-size:1.1rem;font-weight:700;color:#00d4ff;">${esc(this.session.pseudo)}</div>
                        ${this.session.equipe ? `<div style="font-size:.8rem;opacity:.6;margin-top:.2rem;">🛡️ ${esc(this.session.equipe)}</div>` : ''}
                    </div>
                    <div style="font-size:.85rem;opacity:.6;" id="attente-joueurs-count">
                        👥 ${(snapshot?.joueurs||[]).length} joueur(s) connecté(s)
                    </div>
                </div>
                <div style="display:flex;flex-direction:column;align-items:center;gap:.75rem;">
                    <div style="width:36px;height:36px;border:3px solid rgba(0,212,255,.2);
                        border-top-color:#00d4ff;border-radius:50%;animation:spin .9s linear infinite;"></div>
                    <p style="color:#64748b;font-size:.9rem;">En attente du lancement…</p>
                </div>
                <button id="btn-quitter-attente" style="background:none;border:1px solid rgba(255,255,255,.1);
                    color:#64748b;border-radius:8px;padding:.5rem 1rem;cursor:pointer;font-size:.82rem;">
                    Quitter
                </button>
            </div>
            <style>@keyframes spin { to { transform: rotate(360deg); } }</style>`;

        $('btn-quitter-attente')?.addEventListener('click', () => {
            if (confirm('Quitter la salle d\'attente ?')) window.location.href = '/';
        });

        socket.on('PLAYER_JOINED', ({ joueurs }) => {
            const el = $('attente-joueurs-count');
            if (el) el.textContent = `👥 ${joueurs.length} joueur(s) connecté(s)`;
        });
    },

    _chargerModule(jeu, gameState, snapshot) {
        if (this.module?.destroy) this.module.destroy();

        const mod = JeuRegistry.get(jeu);
        if (mod) {
            this.module = mod;
            if (mod.initPlayer) mod.initPlayer(this.session, socket, gameState, snapshot, helpers_player);
        } else {
            // Jeu sans module client dédié → écran "se joue sur l'écran de l'hôte"
            this._afficherJeuSurHote(jeu);
        }
    },

    _afficherJeuSurHote(jeu) {
        const contenu = document.querySelector('#phase-jeu, #player-waiting, main') || document.body;
        contenu.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                min-height:60vh;text-align:center;padding:2rem;gap:1rem;">
                <span style="font-size:3rem;">🖥️</span>
                <h2 style="margin:0;">Jeu sur écran principal</h2>
                <p style="opacity:.6;max-width:320px;">
                    <strong>${esc(jeu)}</strong> se joue sur l'écran de l'hôte.<br>
                    Tu es inscrit en tant que <strong style="color:#00d4ff;">${esc(this.session.pseudo)}</strong>.
                </p>
            </div>`;
    },

    _afficherFin(scores) {
        if (this.module?.destroy) this.module.destroy();
        const pseudo   = this.session.pseudo;
        const entries  = Object.entries(scores).sort((a, b) => b[1] - a[1]);
        const medals   = ['🥇','🥈','🥉'];

        const contenu = document.querySelector('#phase-jeu, main, #player-waiting') || document.body;
        contenu.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                min-height:60vh;text-align:center;padding:2rem;gap:1.5rem;">
                <span style="font-size:3.5rem;">🏆</span>
                <h2 style="margin:0;">Partie terminée !</h2>
                <div style="display:flex;flex-direction:column;gap:.5rem;width:100%;max-width:360px;">
                    ${entries.map(([nom, pts], i) => `
                        <div style="display:flex;justify-content:space-between;align-items:center;
                            padding:.75rem 1rem;border-radius:10px;
                            background:${nom===pseudo?'rgba(0,212,255,.12)':'rgba(255,255,255,.04)'};
                            ${nom===pseudo?'outline:2px solid rgba(0,212,255,.4);':''}">
                            <span>${medals[i]||`${i+1}.`} ${esc(nom)}${nom===pseudo?' <em style="font-size:.8rem;opacity:.6;">(toi)</em>':''}</span>
                            <span style="font-weight:700;color:${nom===pseudo?'#00d4ff':'white'}">${pts} pts</span>
                        </div>`).join('')}
                </div>
                <a href="/" style="display:inline-block;margin-top:.5rem;padding:.75rem 2rem;
                    background:linear-gradient(135deg,#6a5af9,#8a2be2);border-radius:10px;
                    color:white;text-decoration:none;font-weight:700;">
                    🏠 Retour à l'accueil
                </a>
            </div>`;
    },
};

// Helpers exposés aux modules de jeu côté player
const helpers_player = {
    toast,
    showPlayerPanel,
    setText,
    show,
    hide,
    $,
};

// ─────────────────────────────────────────────────────
// MODULE QUIZ (port de quiz_hote.js V2 + quiz-client.js V3)
// ─────────────────────────────────────────────────────

const QuizModule = {

    // ── CÔTÉ HOST ────────────────────────────────────────
    initHost(session, socket, helpers) {
        this._session = session;
        this._socket  = socket;
        this._h       = helpers;
        this._totalQuestionsJSON = 0;

        helpers.showHostPanel('host-idle');

        // Écouter les messages spécifiques au quiz
        socket.on('QUIZ_READY', ({ total, message }) => {
            this._totalQuestionsJSON = total;
            helpers.setText('host-idle-total', `${total} question${total>1?'s':''} chargée${total>1?'s':''}`);
            _majProgressLabel(0, total);
            toast(message || 'Quiz prêt !', 'info', 2500);
        });

        socket.on('QUIZ_QUESTION', (payload) => {
            this._questionEnCours = payload;
            if (payload.total) this._totalQuestionsJSON = payload.total;
            _majProgressLabel(payload.posees, payload.total ?? this._totalQuestionsJSON);
            renderHostQuestion(payload);
        });

        socket.on('QUIZ_RESPONSE_IN', ({ pseudo, nbReponses, nbJoueurs, allAnswered }) => {
            helpers.setText('h-resp-counter', `${nbReponses} / ${nbJoueurs ?? '?'}`);
            // Afficher dans la liste live
            const liveEl = helpers.$('h-reponses-live');
            if (liveEl) {
                const ligne = document.createElement('div');
                ligne.style.cssText = 'padding:4px 8px;font-size:.82rem;color:rgba(255,255,255,.7);border-bottom:1px solid rgba(255,255,255,.05);';
                ligne.textContent = `✅ ${pseudo} a répondu`;
                liveEl.appendChild(ligne);
            }
            if (allAnswered) toast('✅ Tous les joueurs ont répondu !', 'success', 2000);
        });

        socket.on('QUIZ_CORRECTION', (payload) => {
            if (payload.total) this._totalQuestionsJSON = payload.total;
            _majProgressLabel(payload.posees, payload.total ?? this._totalQuestionsJSON);
            renderHostCorrection(payload);
        });

        socket.on('QUIZ_INDICE', ({ num, texte }) => {
            const el  = helpers.$(`h-indice${num}`);
            const btn = helpers.$(`h-btn-indice${num}`);
            if (el) { el.textContent = `💡 Indice ${num} : ${texte}`; el.hidden = false; el.classList.add('indice-visible'); }
            if (btn) btn.classList.add('indice-used');
        });

        socket.on('QUIZ_END', ({ scores, total }) => {
            renderHostFin(scores, total);
        });

        // Contrôles host
        this._initControlesHost(socket, helpers);
    },

    onHostRejoined(gameState, snapshot, session) {
        if (!gameState) return;
        console.log('[QUIZ-HOST] Réhydratation gameState:', gameState.phase);
        _appliquerGameStateHost(gameState, this._totalQuestionsJSON);
    },

    _initControlesHost(socket, helpers) {
        const lancerQ = () => socket.send('HOST_ACTION', { action: 'quiz:next_question', data: {} });
        const reveler = () => socket.send('HOST_ACTION', { action: 'quiz:reveal', data: {} });
        const passer  = () => {
            if (confirm('Passer cette question sans points ?'))
                socket.send('HOST_ACTION', { action: 'quiz:skip', data: {} });
        };
        const revelerIndice = num => {
            if (!this._questionEnCours) return;
            if (!this._questionEnCours[`hasIndice${num}`]) {
                toast(`Pas d'indice ${num}.`, 'warning'); return;
            }
            socket.send('HOST_ACTION', { action: 'quiz:reveal_indice', data: { num } });
        };
        const terminer = () => {
            if (confirm('Terminer la partie ?')) socket.send('HOST_END_GAME', {});
        };

        // Charger les questions depuis les données locales (data/questions.json)
        const btnLoad = helpers.$('host-btn-load');
        if (btnLoad) {
            btnLoad.addEventListener('click', async () => {
                try {
                    const res = await fetch('/data/questions.json');
                    const questions = await res.json();
                    socket.send('HOST_ACTION', { action: 'quiz:load', data: { questions } });
                    toast(`${questions.length} questions chargées`, 'success', 2000);
                } catch (err) {
                    toast('Erreur chargement questions', 'error');
                }
            });
        }

        ['host-btn-next', 'h-btn-next-q'].forEach(id => helpers.$(id)?.addEventListener('click', lancerQ));
        ['h-btn-reveal'].forEach(id => helpers.$(id)?.addEventListener('click', reveler));
        ['h-btn-skip'].forEach(id => helpers.$(id)?.addEventListener('click', passer));
        ['h-btn-indice1'].forEach(id => helpers.$(id)?.addEventListener('click', () => revelerIndice(1)));
        ['h-btn-indice2'].forEach(id => helpers.$(id)?.addEventListener('click', () => revelerIndice(2)));
        ['h-btn-end-quiz', 'h-fin-end'].forEach(id => helpers.$(id)?.addEventListener('click', terminer));
    },

    // ── CÔTÉ PLAYER ──────────────────────────────────────
    initPlayer(session, socket, gameState, snapshot, helpers) {
        this._session  = session;
        this._socket   = socket;
        this._h        = helpers;
        this._aRepondu = false;
        this._timerInterval = null;
        this._timerSecondes = 60;
        this._timerExpire   = false;
        this._totalQuestionsJSON = snapshot?.jeu === 'quiz' ? 0 : 0;

        helpers.showPlayerPanel('player-waiting');
        helpers.setText('pg-pseudo', session.pseudo);

        socket.on('QUIZ_QUESTION', (payload) => {
            if (payload.total) this._totalQuestionsJSON = payload.total;
            _majProgressLabel(payload.posees, payload.total ?? this._totalQuestionsJSON);
            this._renderPlayerQuestion(payload);
        });

        socket.on('QUIZ_ANSWER_ACK', ({ status, texte }) => {
            if (status === 'ok') {
                this._aRepondu = true;
                this._arreterTimer();
                this._confirmerEnvoi(texte);
            } else if (status === 'already_answered') {
                toast('Vous avez déjà répondu.', 'warning');
            } else if (status === 'too_late') {
                toast('Trop tard — correction déjà affichée.', 'warning');
            } else if (status === 'invalid') {
                toast('Réponse invalide.', 'error');
            }
        });

        socket.on('QUIZ_INDICE', ({ num, texte }) => {
            const el = helpers.$(`p-indice${num}`);
            if (el) { el.textContent = `💡 Indice ${num} : ${texte}`; el.hidden = false; el.classList.add('indice-visible'); }
        });

        socket.on('QUIZ_CORRECTION', (payload) => {
            this._arreterTimer();
            this._renderPlayerCorrection(payload, session.pseudo);
        });

        socket.on('QUIZ_END', ({ scores }) => {
            this._arreterTimer();
            this._renderPlayerFin(scores, session.pseudo);
        });

        // Réhydrater si gameState présent (rejoin)
        if (gameState) _appliquerGameStatePlayer(gameState, session.pseudo, this);

        // Contrôles
        helpers.$('p-btn-send')?.addEventListener('click', () => this._envoyerReponse());
        helpers.$('p-answer-input')?.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) this._envoyerReponse();
        });
    },

    onHostAction(action, data) {
        // Les actions quiz passent par les events WS dédiés (QUIZ_QUESTION, etc.)
        // Ce handler est un fallback pour d'éventuelles actions non typées
    },

    onScores(scores) {
        // Géré par RolePlayer directement
    },

    destroy() {
        if (this._timerInterval) clearInterval(this._timerInterval);
    },

    // ── Rendu player ──────────────────────────────────────

    _renderPlayerQuestion(payload) {
        this._aRepondu    = false;
        this._timerExpire = false;
        helpers_player.showPlayerPanel('player-texte-panel');
        helpers_player.setText('p-theme',         payload.theme    || '—');
        helpers_player.setText('p-progress',      `Q ${payload.posees} / ${payload.total ?? this._totalQuestionsJSON}`);
        helpers_player.setText('p-question-text', payload.question);
        [1, 2].forEach(n => {
            const el = helpers_player.$(`p-indice${n}`);
            if (el) { el.textContent = ''; el.hidden = true; el.classList.remove('indice-visible'); }
        });
        const input = helpers_player.$('p-answer-input');
        if (input) { input.value = ''; input.disabled = false; input.placeholder = 'Votre réponse…'; }
        const btn = helpers_player.$('p-btn-send');
        if (btn) { btn.disabled = false; btn.textContent = '✉️ Envoyer'; }
        helpers_player.show('p-texte-answer-zone');
        helpers_player.hide('p-texte-sent');
        const oldTimer = helpers_player.$('p-timer');
        if (oldTimer) oldTimer.remove();
        this._demarrerTimer();
        setTimeout(() => helpers_player.$('p-answer-input')?.focus(), 150);
    },

    _confirmerEnvoi(texte) {
        helpers_player.hide('p-texte-answer-zone');
        helpers_player.show('p-texte-sent');
        const el = helpers_player.$('p-texte-sent');
        if (el) el.innerHTML = `✅ Réponse envoyée : <strong>${esc(texte)}</strong><br><small>En attente de la correction…</small>`;
        toast('Réponse envoyée !', 'success', 2000);
    },

    _renderPlayerCorrection(payload, pseudo) {
        helpers_player.showPlayerPanel('player-correction-panel');
        helpers_player.setText('p-corr-theme',     payload.theme || '—');
        helpers_player.setText('p-corr-question',  payload.question);
        helpers_player.setText('p-corr-bonne-rep', payload.reponse);

        const maReponse = payload.reponses?.find(r => r.pseudo === pseudo);
        const resultEl  = helpers_player.$('p-corr-result');
        if (!resultEl) return;

        if (!maReponse) {
            resultEl.className = 'corr-feedback corr-noAnswer';
            resultEl.innerHTML = "😶 Vous n'avez pas répondu à temps.";
        } else if (maReponse.correct) {
            const pts     = maReponse.points;
            const premier = maReponse.estPremier ? ' 🏆 Premier correct !' : '';
            resultEl.className = 'corr-feedback corr-correct';
            resultEl.innerHTML = `🎉 Bonne réponse ! <strong>+${pts} pt${pts!==1?'s':''}</strong>${premier}`;
        } else {
            resultEl.className = 'corr-feedback corr-incorrect';
            resultEl.innerHTML = `❌ Mauvaise réponse. Vous avez écrit : <em>${esc(maReponse.texte)}</em>`;
        }
    },

    _renderPlayerFin(scores, pseudo) {
        helpers_player.showPlayerPanel('player-fin-panel');
        const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
        const medals  = ['🥇','🥈','🥉'];
        const el = helpers_player.$('p-fin-scores');
        if (!el) return;
        el.innerHTML = entries.map(([nom, pts], i) => {
            const isMe = nom === pseudo;
            return `<div class="result-row${i===0?' result-winner':''}${isMe?' result-me':''}">
                <span>${medals[i]||`${i+1}.`}</span>
                <span class="result-nom">${esc(nom)}${isMe?'<span class="badge-moi">MOI</span>':''}</span>
                <span class="result-pts">${pts} pt${pts!==1?'s':''}</span>
            </div>`;
        }).join('');
        toast('🏆 Résultats finaux !', 'success', 4000);
    },

    _envoyerReponse() {
        if (this._aRepondu || this._timerExpire) return;
        const input = helpers_player.$('p-answer-input');
        const texte = input?.value.trim();
        if (!texte) { toast("Écrivez votre réponse.", 'warning'); return; }
        const btn = helpers_player.$('p-btn-send');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Envoi…'; }
        this._socket.send('PLAYER_ACTION', { action: 'quiz:answer', data: { texte } });
    },

    _demarrerTimer() {
        this._arreterTimer();
        this._timerSecondes = 60;
        this._timerExpire   = false;
        this._afficherTimer(60);
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
        let el = helpers_player.$('p-timer');
        if (!el) {
            const zone = helpers_player.$('p-texte-answer-zone');
            if (!zone) return;
            el = document.createElement('div');
            el.id = 'p-timer';
            zone.parentNode.insertBefore(el, zone);
        }
        el.textContent = `⏱ ${s}s`;
        el.className   = 'quiz-timer';
        if (s <= 10)      el.classList.add('timer-danger');
        else if (s <= 20) el.classList.add('timer-warning');
    },

    _expirerTimer() {
        this._timerExpire = true;
        const input = helpers_player.$('p-answer-input');
        const btn   = helpers_player.$('p-btn-send');
        if (input) { input.disabled = true; input.placeholder = '⏱ Temps écoulé'; }
        if (btn)   { btn.disabled = true; btn.textContent = '⏱ Temps écoulé'; }
        if (!this._aRepondu) toast('⏱ Temps écoulé !', 'warning', 3000);
    },
};

// Helpers réhydratation gameState (pattern quiz-client.js V3)

function _appliquerGameStateHost(gameState, totalDéfaut) {
    if (!gameState) return;
    switch (gameState.phase) {
        case 'idle':
            showHostPanel('host-idle');
            if (gameState.total) setText('host-idle-total', `${gameState.total} question${gameState.total>1?'s':''}`);
            break;
        case 'question':
            if (gameState.payload) renderHostQuestion(gameState.payload);
            break;
        case 'correction':
            if (gameState.payload) renderHostCorrection(gameState.payload);
            break;
        case 'ended':
            renderHostFin(gameState.scores || {}, gameState.total || 0);
            break;
    }
}

function _appliquerGameStatePlayer(gameState, pseudo, mod) {
    if (!gameState) return;
    switch (gameState.phase) {
        case 'idle':
            helpers_player.showPlayerPanel('player-waiting');
            break;
        case 'question':
            if (gameState.payload) mod._renderPlayerQuestion(gameState.payload);
            toast('Question en cours — rejointe.', 'info', 2000);
            break;
        case 'correction':
            if (gameState.payload) mod._renderPlayerCorrection(gameState.payload, pseudo);
            mod._arreterTimer();
            break;
        case 'ended':
            mod._renderPlayerFin(gameState.scores || {}, pseudo);
            break;
    }
}

function renderHostQuestion(payload) {
    showHostPanel('host-question-panel');
    setText('h-theme',         payload.theme    || '—');
    setText('h-progress',      `Q ${payload.posees} / ${payload.total}`);
    setText('h-question-text', payload.question);
    const typeBadge = $('h-type-badge');
    if (typeBadge) typeBadge.textContent = '✍️ Texte libre';
    [1,2].forEach(n => {
        const el  = $(`h-indice${n}`);
        const btn = $(`h-btn-indice${n}`);
        if (el) { el.textContent = ''; el.hidden = true; el.classList.remove('indice-visible','indice-used'); }
        if (btn) { btn.disabled = !payload[`hasIndice${n}`]; btn.classList.remove('indice-used'); }
    });
    setText('h-resp-counter', '0 / ?');
    const live = $('h-reponses-live');
    if (live) live.innerHTML = '';
}

function renderHostCorrection(payload) {
    showHostPanel('host-correction-panel');
    setText('h-corr-theme',    payload.theme || '—');
    setText('h-corr-progress', `Q ${payload.posees} / ${payload.total}`);
    setText('h-corr-question', payload.question);
    setText('h-corr-reponse',  `✅ ${payload.reponse}`);
    const container = $('h-corr-reponses');
    if (!container) return;
    if (!payload.reponses?.length) {
        container.innerHTML = '<p style="opacity:.5;text-align:center;">Aucune réponse reçue.</p>';
        return;
    }
    const medals = ['🥇','🥈','🥉']; let ci = 0;
    container.innerHTML = payload.reponses.map(r => {
        const cls   = r.correct ? 'correct' : 'incorrect';
        const medal = r.correct ? (medals[ci++]||'✅') : '❌';
        const ptsEl = r.correct ? `<span style="color:#86efac;font-weight:700;">+${r.points}pt${r.points!==1?'s':''}</span>` : '';
        const prem  = r.estPremier ? ' 🏆' : '';
        return `<div style="display:flex;align-items:center;gap:.5rem;padding:.5rem .75rem;
            background:${r.correct?'rgba(34,197,94,.1)':'rgba(239,68,68,.1)'};
            border-radius:8px;margin-bottom:.4rem;">
            <span>${medal}</span>
            <span style="flex:1;font-weight:600;color:#00d4ff;">${esc(r.pseudo)}${prem}</span>
            <span style="flex:2;font-style:italic;opacity:.8;">${esc(r.texte)}</span>
            ${ptsEl}
        </div>`;
    }).join('');
}

function renderHostFin(scores, total) {
    showHostPanel('host-fin-panel');
    setText('h-fin-total', `${total} question${total>1?'s':''}`);
    const container = $('h-fin-scores');
    if (!container) return;
    const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const medals  = ['🥇','🥈','🥉'];
    container.innerHTML = entries.length
        ? entries.map(([nom, pts], i) => `
            <div style="display:flex;align-items:center;gap:.5rem;padding:.4rem 0;${i===0?'font-weight:700;':''}">
                <span>${medals[i]||`${i+1}.`}</span>
                <span style="flex:1;">${esc(nom)}</span>
                <span style="color:${i===0?'#ffd700':'inherit'};">${pts} pts</span>
            </div>`).join('')
        : '<p style="opacity:.5;">Aucun score.</p>';
    toast('🏁 Quiz terminé !', 'success', 4000);
}

function _majProgressLabel(posees, total) {
    setText('progress-label', `Q ${posees} / ${total}`);
}

function _jeuIcon(jeu) {
    const icons = { quiz:'❓', justeprix:'💰', undercover:'🕵️', lml:'📖', mimer:'🎭',
                    pendu:'🪢', petitbac:'📝', memoire:'🧠', morpion:'⭕', puissance4:'🔴' };
    return icons[jeu] || '🎮';
}

// Enregistrer le module quiz
JeuRegistry.register('quiz', QuizModule);

// ─────────────────────────────────────────────────────
// POINT D'ENTRÉE — JeuApp
// ─────────────────────────────────────────────────────

const JeuApp = {
    session: null,

    init() {
        const session = chargerSession();

        // Aucun partieId détectable → erreur
        if (!session) {
            document.body.innerHTML = `
                <div style="display:flex;align-items:center;justify-content:center;
                    height:100vh;color:#f87171;font-size:1.1rem;text-align:center;padding:2rem;flex-direction:column;gap:1rem;">
                    <span style="font-size:3rem;">❌</span>
                    <p>Paramètres manquants.<br>
                    <small style="opacity:.6;">Utilisez le lien fourni par le host.</small></p>
                    <a href="/" style="padding:.6rem 1.5rem;background:rgba(255,255,255,.1);border-radius:8px;color:white;text-decoration:none;">
                        🏠 Accueil
                    </a>
                </div>`;
            return;
        }

        // Format V2 natif : partieId présent mais pseudo manquant
        // → afficher un formulaire de saisie du pseudo, puis continuer
        if (session.needsPseudo) {
            this._afficherFormulairePseudo(session);
            return;
        }

        this._demarrer(session);
    },

    // ── Formulaire de saisie du pseudo (flow V2 natif) ────────
    _afficherFormulairePseudo(session) {
        const nomPartie = session.partieNom || 'Partie';
        const jeuLabel  = session.jeu ? session.jeu.toUpperCase() : '';

        document.body.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:center;
                min-height:100vh;padding:2rem;background:#0d0d1a;">
                <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);
                    border-radius:20px;padding:2.5rem 2rem;max-width:380px;width:100%;text-align:center;">
                    <div style="font-size:2.5rem;margin-bottom:.5rem;">🎮</div>
                    <h2 style="color:white;margin:0 0 .25rem;font-size:1.2rem;">${esc(nomPartie)}</h2>
                    ${jeuLabel ? `<div style="font-size:.8rem;opacity:.5;margin-bottom:1.5rem;text-transform:uppercase;letter-spacing:.1em;">${esc(jeuLabel)}</div>` : '<div style="margin-bottom:1.5rem;"></div>'}
                    <label style="display:block;font-size:.8rem;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.5rem;text-align:left;">
                        Ton pseudo
                    </label>
                    <input id="input-pseudo-jeu" type="text" maxlength="20" autocomplete="off"
                        placeholder="Entre ton pseudo…"
                        style="width:100%;box-sizing:border-box;padding:.75rem 1rem;
                            background:rgba(255,255,255,.07);border:1.5px solid rgba(255,255,255,.18);
                            border-radius:10px;color:white;font-size:1rem;font-family:inherit;
                            outline:none;margin-bottom:1rem;">
                    <button id="btn-rejoindre-jeu"
                        style="width:100%;padding:.85rem;background:linear-gradient(135deg,#6a5af9,#8a2be2);
                            border:none;border-radius:12px;color:white;font-size:1rem;
                            font-weight:700;cursor:pointer;font-family:inherit;">
                        🚀 Rejoindre
                    </button>
                    <p id="err-pseudo-jeu" style="color:#f87171;font-size:.85rem;margin:.75rem 0 0;min-height:1.2em;"></p>
                    <a href="/" style="display:inline-block;margin-top:1rem;font-size:.8rem;
                        color:rgba(255,255,255,.3);text-decoration:none;">← Retour à l'accueil</a>
                </div>
            </div>
            <style>
                body { margin:0; font-family:'Segoe UI',sans-serif; }
                #input-pseudo-jeu:focus { border-color:#00d4ff; box-shadow:0 0 0 3px rgba(0,212,255,.2); }
                #btn-rejoindre-jeu:hover { opacity:.9; transform:translateY(-1px); }
            </style>`;

        const input  = document.getElementById('input-pseudo-jeu');
        const btn    = document.getElementById('btn-rejoindre-jeu');
        const errEl  = document.getElementById('err-pseudo-jeu');

        const valider = () => {
            const pseudo = input.value.trim();
            if (!pseudo || pseudo.length < 2) {
                errEl.textContent = 'Pseudo trop court (2 caractères minimum).';
                input.focus();
                return;
            }
            if (!/^[a-zA-Z0-9_-]{2,20}$/.test(pseudo)) {
                errEl.textContent = 'Lettres, chiffres, tiret ou underscore uniquement.';
                input.focus();
                return;
            }
            errEl.textContent = '';
            // Compléter la session et continuer
            const sessionComplete = { ...session, pseudo, needsPseudo: false };
            try { sessionStorage.setItem('mgu_game_session', JSON.stringify(sessionComplete)); } catch {}
            this._demarrer(sessionComplete);
        };

        input.addEventListener('keydown', e => { if (e.key === 'Enter') valider(); });
        btn.addEventListener('click', valider);
        setTimeout(() => input.focus(), 100);
    },

    // ── Démarrage effectif après que le pseudo est connu ──────
    _demarrer(session) {
        this.session = session;

        // Connexion WebSocket
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        socket.connect(`${proto}//${location.host}/ws`);

        // Exposer globalement pour les modules V2 existants
        window.JeuApp    = this;
        window.jeuSocket = socket;

        // Dispatch par rôle
        const role = session.role || 'player';
        if (role === 'host') {
            RoleHost.init(session);
        } else if (role === 'host-player') {
            RoleHost.init(session);
            RolePlayer.init({ ...session, role: 'host-player' });
        } else {
            RolePlayer.init(session);
        }
    },
};

document.addEventListener('DOMContentLoaded', () => JeuApp.init());

// Expositions globales pour les modules V2 (jeux/*.js, modules/*_hote.js)
// Ils peuvent appeler window.jeuSocket.send(...) pour envoyer des actions
window.JeuRegistry = JeuRegistry;
window.QuizModule  = QuizModule;