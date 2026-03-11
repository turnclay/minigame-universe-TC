// ======================================================
// 🎮 GAME-LOBBY.JS — Écran d'attente joueur
// ======================================================
// À inclure dans chaque page jeu (games/quiz/index.html etc.)
// Gère l'écran d'attente AVANT que le host lance la partie,
// puis appelle onGameStart(snapshot) quand c'est parti.
// ======================================================

import { GameSocket } from '/js/core/socket.js';

const GAME_ICONS = {
    quiz: '❓', justeprix: '💰', undercover: '🕵️', lml: '📖',
    mimer: '🎭', pendu: '🪢', petitbac: '📝', memoire: '🧠',
    morpion: '⭕', puissance4: '🔴',
};

export class GameLobby {
    constructor({ containerId = 'game-lobby', onStart, onError } = {}) {
        this.socket      = new GameSocket();
        this.containerId = containerId;
        this.onStart     = onStart;
        this.onError     = onError;
        this.session     = null;
        this.joueurs     = [];
    }

    // ── Lancement ────────────────────────────────────

    init() {
        this.session = this._loadSession();
        if (!this.session?.partieId || !this.session?.pseudo) {
            const msg = 'Session invalide. Retournez à la page de connexion.';
            if (this.onError) this.onError(msg);
            else this._renderError(msg);
            return;
        }

        this._renderWaiting();

        const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        this.socket.connect(`${wsProto}//${location.host}/ws`);

        this.socket.on('__connected__', () => {
            this._updateStatus('Connexion établie, rejoindre la partie…', 'ok');
            this.socket.send('PLAYER_JOIN', {
                pseudo:   this.session.pseudo,
                partieId: this.session.partieId,
            });
        });

        this.socket.on('__disconnected__', () => {
            this._updateStatus('Connexion perdue, reconnexion…', 'warn');
        });

        this.socket.on('JOIN_OK', ({ pseudo, equipe, snapshot }) => {
            this.session = { ...this.session, equipe };
            this.joueurs = snapshot.joueurs || [];
            this._renderLobby(snapshot);

            // Sauvegarder session enrichie
            try {
                sessionStorage.setItem('mgu_game_session', JSON.stringify({
                    ...this.session, equipe, jeu: snapshot.jeu, mode: snapshot.mode,
                }));
            } catch {}
        });

        this.socket.on('JOIN_ERROR', ({ code }) => {
            const msgs = {
                GAME_NOT_FOUND: 'Partie introuvable ou terminée.',
                PSEUDO_TAKEN:   'Ce pseudo est déjà utilisé dans cette partie.',
                GAME_STARTED:   'La partie a déjà commencé sans vous.',
                MAX_PLAYERS:    'La partie est complète.',
            };
            const msg = msgs[code] || `Erreur: ${code}`;
            if (this.onError) this.onError(msg);
            else this._renderError(msg);
        });

        this.socket.on('PLAYER_JOINED', ({ joueurs }) => {
            this.joueurs = joueurs;
            this._renderJoueurs(joueurs);
        });

        this.socket.on('PLAYER_LEFT', ({ pseudo, joueurs }) => {
            this.joueurs = joueurs;
            this._renderJoueurs(joueurs);
        });

        this.socket.on('GAME_STARTED', ({ snapshot }) => {
            this._renderStarting();
            setTimeout(() => {
                if (this.onStart) this.onStart(snapshot, this.session, this.socket);
            }, 800);
        });

        this.socket.on('GAME_ENDED', ({ snapshot }) => {
            this._renderEnded(snapshot);
        });

        this.socket.on('KICKED', ({ reason }) => {
            this._renderError(`Vous avez été expulsé : ${reason || 'par le host'}`, true);
            setTimeout(() => { window.location.href = '/join/'; }, 2500);
        });

        this.socket.on('HOST_DISCONNECTED', () => {
            this._updateStatus('⚠️ Le host s\'est déconnecté…', 'warn');
        });
    }

    // Accès au socket pour les jeux après démarrage
    getSocket() { return this.socket; }
    getSession() { return this.session; }

    // ── Rendu ─────────────────────────────────────────

    _renderWaiting() {
        const c = document.getElementById(this.containerId);
        if (!c) return;
        c.innerHTML = `
            <div class="lobby-card" style="max-width:460px;margin:0 auto;text-align:center;padding:2.5rem 2rem;">
                <div class="lobby-spinner" style="width:44px;height:44px;border:4px solid rgba(255,255,255,.1);border-top-color:#00d4ff;border-radius:50%;animation:spin .9s linear infinite;margin:0 auto 1.25rem;"></div>
                <p id="lobby-status" style="color:#94a3b8;font-size:.95rem;">Connexion en cours…</p>
            </div>`;
        this._ensureStyles();
    }

    _renderLobby(snapshot) {
        const c = document.getElementById(this.containerId);
        if (!c) return;
        const icon = GAME_ICONS[snapshot.jeu] || '🎮';
        const equipeInfo = this.session.equipe
            ? `<div style="margin-top:.5rem;font-size:.85rem;opacity:.7;">Votre équipe : <strong>🛡️ ${this._esc(this.session.equipe)}</strong></div>`
            : '';

        c.innerHTML = `
            <div class="lobby-card" style="max-width:460px;margin:0 auto;text-align:center;padding:2.5rem 2rem;">
                <div style="font-size:3rem;margin-bottom:.5rem;">${icon}</div>
                <h2 style="font-size:1.4rem;font-weight:800;margin-bottom:.25rem;">${this._esc(snapshot.nom)}</h2>
                <div style="font-size:.85rem;color:#94a3b8;margin-bottom:.5rem;">${snapshot.jeu.toUpperCase()} · ${snapshot.mode === 'team' ? '🛡️ Équipes' : '👤 Solo'}</div>
                <div style="display:inline-flex;align-items:center;gap:.4rem;padding:.35rem .8rem;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);border-radius:20px;color:#4ade80;font-size:.85rem;margin-bottom:1rem;">
                    <span style="width:7px;height:7px;border-radius:50%;background:#4ade80;animation:pulse 1.5s ease infinite;"></span>
                    Connecté · ${this._esc(this.session.pseudo)}
                </div>
                ${equipeInfo}

                <div style="margin:1.5rem 0;padding:1rem;background:rgba(255,255,255,.04);border-radius:10px;">
                    <div style="font-size:.8rem;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:.75rem;">⏳ En attente du host…</div>
                    <div id="lobby-joueurs" style="display:flex;flex-wrap:wrap;gap:.4rem;justify-content:center;"></div>
                    <div id="lobby-nb" style="margin-top:.6rem;font-size:.8rem;color:#64748b;"></div>
                </div>

                <p style="font-size:.85rem;color:#64748b;">Le jeu démarrera quand le host lancera la partie.</p>
                <p id="lobby-status" style="margin-top:.5rem;font-size:.8rem;color:#00d4ff;min-height:1.2em;"></p>
            </div>`;

        this._renderJoueurs(snapshot.joueurs || []);
        this._ensureStyles();
    }

    _renderJoueurs(joueurs) {
        const c   = document.getElementById('lobby-joueurs');
        const nb  = document.getElementById('lobby-nb');
        if (!c) return;

        c.innerHTML = joueurs.map(j => `
            <span style="display:inline-flex;align-items:center;gap:.3rem;padding:.3rem .65rem;background:rgba(255,255,255,.06);border-radius:20px;font-size:.82rem;">
                <span style="width:18px;height:18px;border-radius:50%;background:#00d4ff22;display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:700;color:#00d4ff;">${j.pseudo.charAt(0).toUpperCase()}</span>
                ${this._esc(j.pseudo)}
                ${j.pseudo === this.session.pseudo ? '<span style="color:#00d4ff;font-size:.7rem;">(vous)</span>' : ''}
            </span>`).join('');

        if (nb) nb.textContent = `${joueurs.length} joueur${joueurs.length > 1 ? 's' : ''} connecté${joueurs.length > 1 ? 's' : ''}`;
    }

    _renderStarting() {
        const c = document.getElementById(this.containerId);
        if (!c) return;
        c.innerHTML = `
            <div class="lobby-card" style="max-width:380px;margin:0 auto;text-align:center;padding:3rem 2rem;">
                <div style="font-size:3.5rem;margin-bottom:.75rem;animation:bounce .6s ease infinite alternate;">🚀</div>
                <h2 style="font-size:1.5rem;font-weight:800;margin-bottom:.5rem;">C'est parti !</h2>
                <p style="color:#94a3b8;">Le jeu démarre…</p>
            </div>`;
        this._ensureStyles();
    }

    _renderEnded(snapshot) {
        const entries = Object.entries(snapshot.scores || {}).sort((a, b) => b[1] - a[1]);
        const medals  = ['🥇', '🥈', '🥉'];
        const c = document.getElementById(this.containerId);
        if (!c) return;
        c.innerHTML = `
            <div class="lobby-card" style="max-width:400px;margin:0 auto;text-align:center;padding:2.5rem 2rem;">
                <div style="font-size:3rem;margin-bottom:.5rem;">🏁</div>
                <h2 style="font-size:1.4rem;font-weight:800;margin-bottom:1.25rem;">Partie terminée !</h2>
                ${entries.map(([nom, pts], i) => `
                    <div style="display:flex;align-items:center;gap:.5rem;padding:.45rem .75rem;background:${i===0?'rgba(255,215,0,.08)':'rgba(255,255,255,.04)'};border-radius:8px;margin-bottom:.3rem;${nom===this.session.pseudo?'border:1px solid rgba(0,212,255,.3);':''}">
                        <span>${medals[i] || `${i+1}.`}</span>
                        <span style="flex:1;font-weight:${i===0?700:400};">${this._esc(nom)} ${nom===this.session.pseudo?'<span style="color:#00d4ff;font-size:.8rem;">(vous)</span>':''}</span>
                        <span style="color:${i===0?'#ffd700':'inherit'};">${pts} pts</span>
                    </div>`).join('')}
                <a href="/join/" style="display:block;margin-top:1.5rem;padding:.75rem;background:rgba(255,255,255,.07);border-radius:8px;color:#e2e8f0;text-decoration:none;font-size:.9rem;">← Rejoindre une autre partie</a>
                <a href="/" style="display:block;margin-top:.5rem;font-size:.85rem;color:#64748b;text-decoration:none;">Retour à l'accueil</a>
            </div>`;
    }

    _renderError(msg, redirecting = false) {
        const c = document.getElementById(this.containerId);
        if (!c) return;
        c.innerHTML = `
            <div class="lobby-card" style="max-width:380px;margin:0 auto;text-align:center;padding:2.5rem 2rem;">
                <div style="font-size:2.5rem;margin-bottom:.75rem;">❌</div>
                <p style="color:#f87171;margin-bottom:1rem;">${this._esc(msg)}</p>
                ${redirecting
                    ? `<p style="font-size:.85rem;color:#64748b;">Redirection…</p>`
                    : `<a href="/join/" style="display:inline-block;padding:.65rem 1.5rem;background:rgba(255,255,255,.07);border-radius:8px;color:#e2e8f0;text-decoration:none;font-size:.9rem;">← Rejoindre une partie</a>`}
            </div>`;
    }

    _updateStatus(msg, type = 'info') {
        const el = document.getElementById('lobby-status');
        if (!el) return;
        const colors = { ok: '#4ade80', warn: '#f59e0b', error: '#f87171', info: '#00d4ff' };
        el.style.color = colors[type] || '#00d4ff';
        el.textContent = msg;
    }

    _ensureStyles() {
        if (document.getElementById('game-lobby-styles')) return;
        const style = document.createElement('style');
        style.id = 'game-lobby-styles';
        style.textContent = `
            @keyframes spin    { to { transform: rotate(360deg); } }
            @keyframes pulse   { 0%,100% { opacity:1; } 50% { opacity:.4; } }
            @keyframes bounce  { from { transform: translateY(0); } to { transform: translateY(-8px); } }
            .lobby-card { animation: fadein .35s ease; }
            @keyframes fadein  { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:none; } }
        `;
        document.head.appendChild(style);
    }

    _esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    _loadSession() {
        const params   = new URLSearchParams(location.search);
        const partieId = params.get('partieId');
        const pseudo   = params.get('pseudo');
        if (partieId && pseudo) return { partieId, pseudo, role: 'player' };
        try {
            const saved = sessionStorage.getItem('mgu_game_session');
            if (saved) return JSON.parse(saved);
        } catch {}
        return null;
    }
}