// /public/js/core/game-client.js
// =============================================
// 🎮 BASE CLIENT JEU — commun à tous les jeux
// =============================================
// Usage dans chaque jeu :
//   import { GameClient } from '/js/core/game-client.js';
//   const client = new GameClient();
//   client.onReady((session) => { /* démarrer le jeu */ });
//   client.onAction((action, data) => { /* action du host */ });
//   client.sendAction('MA_ACTION', { ... });
// =============================================

import { GameSocket } from './socket.js';

export class GameClient {
    constructor() {
        this.socket  = new GameSocket();
        this.session = null; // { partieId, pseudo, equipe, jeu, mode, role }
        this._onReadyCb      = null;
        this._onActionCb     = null;
        this._onScoresCb     = null;
        this._onEndCb        = null;
        this._onPlayerJoinCb = null;
        this._onPlayerLeftCb = null;
        this._onKickedCb     = null;
        this._onDisconnectCb = null;
        this._onHostDisconnectCb = null;
    }

    // ── API publique ───────────────────────────────────

    /** Appelé quand la session est chargée et le socket connecté */
    onReady(cb)           { this._onReadyCb = cb; return this; }
    /** Appelé sur HOST_ACTION */
    onAction(cb)          { this._onActionCb = cb; return this; }
    /** Appelé sur SCORES_UPDATE */
    onScores(cb)          { this._onScoresCb = cb; return this; }
    /** Appelé sur GAME_ENDED */
    onEnd(cb)             { this._onEndCb = cb; return this; }
    /** Appelé sur PLAYER_JOINED */
    onPlayerJoin(cb)      { this._onPlayerJoinCb = cb; return this; }
    /** Appelé sur PLAYER_LEFT */
    onPlayerLeft(cb)      { this._onPlayerLeftCb = cb; return this; }
    /** Appelé si le joueur est expulsé */
    onKicked(cb)          { this._onKickedCb = cb; return this; }
    /** Appelé sur déconnexion WebSocket */
    onDisconnect(cb)      { this._onDisconnectCb = cb; return this; }
    /** Appelé si le host se déconnecte */
    onHostDisconnect(cb)  { this._onHostDisconnectCb = cb; return this; }

    /**
     * Envoie une action au host via PLAYER_ACTION
     */
    sendAction(action, data = {}) {
        this.socket.send('PLAYER_ACTION', { action, data });
    }

    /**
     * Lance la connexion et charge la session
     * @returns {Promise<session>}
     */
    init() {
        return new Promise((resolve, reject) => {
            // 1. Charger la session depuis l'URL et sessionStorage
            const session = this._loadSession();
            if (!session || !session.partieId || !session.pseudo) {
                reject(new Error('Session invalide. Retournez à la page de connexion.'));
                return;
            }
            this.session = session;

            // 2. Connexion WebSocket
            const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
            this.socket.connect(`${wsProto}//${location.host}/ws`);

            // 3. Événements
            this.socket.on('__connected__', () => {
                console.log('[GameClient] Connecté');
                // Re-rejoindre la partie (en cas de reconnexion)
                this.socket.send('PLAYER_JOIN', {
                    pseudo: session.pseudo,
                    partieId: session.partieId,
                });
            });

            this.socket.on('JOIN_OK', ({ pseudo, equipe, snapshot }) => {
                this.session = { ...session, equipe, snapshot };
                if (this._onReadyCb) this._onReadyCb(this.session, snapshot);
                resolve(this.session);
            });

            this.socket.on('JOIN_ERROR', ({ code }) => {
                const msgs = {
                    GAME_NOT_FOUND: 'Partie introuvable.',
                    PSEUDO_TAKEN: 'Pseudo déjà pris.',
                    GAME_STARTED: 'Partie déjà en cours.',
                    MAX_PLAYERS: 'Partie pleine.',
                };
                reject(new Error(msgs[code] || `Erreur: ${code}`));
            });

            this.socket.on('HOST_ACTION', ({ action, data }) => {
                if (this._onActionCb) this._onActionCb(action, data);
            });

            this.socket.on('SCORES_UPDATE', ({ scores }) => {
                if (this._onScoresCb) this._onScoresCb(scores);
            });

            this.socket.on('GAME_ENDED', ({ snapshot }) => {
                if (this._onEndCb) this._onEndCb(snapshot);
            });

            this.socket.on('GAME_STARTED', ({ snapshot }) => {
                // Déjà dans le jeu, on peut notifier un rafraîchissement
                if (this._onReadyCb && !this.session.snapshot) {
                    this.session.snapshot = snapshot;
                    this._onReadyCb(this.session, snapshot);
                }
            });

            this.socket.on('PLAYER_JOINED', (data) => {
                if (this._onPlayerJoinCb) this._onPlayerJoinCb(data);
            });

            this.socket.on('PLAYER_LEFT', (data) => {
                if (this._onPlayerLeftCb) this._onPlayerLeftCb(data);
            });

            this.socket.on('KICKED', ({ reason }) => {
                if (this._onKickedCb) this._onKickedCb(reason);
                else {
                    alert(`Vous avez été expulsé : ${reason}`);
                    window.location.href = '/join/';
                }
            });

            this.socket.on('__disconnected__', () => {
                if (this._onDisconnectCb) this._onDisconnectCb();
            });

            this.socket.on('HOST_DISCONNECTED', ({ message }) => {
                if (this._onHostDisconnectCb) this._onHostDisconnectCb(message);
                else {
                    // Notification par défaut
                    const banner = document.createElement('div');
                    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#f87171;color:#000;text-align:center;padding:.5rem;font-weight:600;z-index:9999;';
                    banner.textContent = '⚠️ Le host s\'est déconnecté. La partie peut être interrompue.';
                    document.body.prepend(banner);
                }
            });
        });
    }

    // ── Session ────────────────────────────────────────

    _loadSession() {
        // Priorité : URL params
        const params = new URLSearchParams(location.search);
        const partieId = params.get('partieId');
        const pseudo   = params.get('pseudo');

        if (partieId && pseudo) {
            return { partieId, pseudo, role: 'player' };
        }

        // Fallback : sessionStorage
        try {
            const saved = sessionStorage.getItem('mgu_game_session');
            if (saved) return JSON.parse(saved);
        } catch {}

        return null;
    }

    get pseudo()   { return this.session?.pseudo; }
    get partieId() { return this.session?.partieId; }
    get equipe()   { return this.session?.equipe; }
    get jeu()      { return this.session?.jeu; }
}