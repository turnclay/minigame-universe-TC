// public/js/core/socket.js
// =============================================
// 🔌 CLIENT WEBSOCKET PARTAGÉ — v2.1
// Utilisé par host.js, jeu.js et tous les modules
// Compatible ws-handler.js v6.0
// =============================================
//
// MODIFICATIONS v2.1 (port backend V2) :
//
//   [FIX 1] — buildUrl() : URL construite automatiquement
//   ─────────────────────────────────────────────────────
//   connect() accepte toujours une URL explicite,
//   mais si aucune n'est fournie, l'URL est dérivée
//   du window.location courant (ws:// ou wss://).
//   Plus besoin de passer l'URL manuellement depuis
//   chaque module.
//
//   [FIX 2] — disconnect() ne bloque plus la reconnexion
//   ─────────────────────────────────────────────────────
//   Avant : disconnect() mettait _maxReconnect à 0,
//   ce qui empêchait définitivement toute reconnexion
//   future dans la même instance (singleton partagé).
//   → Ajout d'un flag _intentionalClose distinct.
//   disconnect() pose ce flag ; _tryReconnect le vérifie.
//   reset() permet de réinitialiser pour une reconnexion
//   intentionnelle (ex : navigation index → jeu).
//
//   [FIX 3] — Fenêtre de grâce post-navigation
//   ─────────────────────────────────────────────────────
//   Le ws-handler accorde 2 minutes de grâce après
//   GAME_STARTED pour couvrir la navigation vers jeu.html.
//   Côté client, la reconnexion doit être rapide pour
//   que le joueur se reconnecte dans cette fenêtre.
//   → _reconnectDelay réduit à 500ms (était 1500ms).
//   → Délai linéaire plafonné à 3s (évite d'exploser
//     la fenêtre de grâce avec un backoff exponentiel).
//
//   [AMÉLIORATION 1] — once(type, callback)
//   ─────────────────────────────────────────────────────
//   Abonnement à usage unique : se désabonne automatiquement
//   après le premier appel. Utile pour AUTH_OK, JOIN_OK, etc.
//
//   [AMÉLIORATION 2] — waitFor(type, timeoutMs)
//   ─────────────────────────────────────────────────────
//   Retourne une Promise qui se résout au prochain message
//   du type donné, ou se rejette après timeout.
//   Utile pour les flux async (await socket.waitFor('AUTH_OK')).
// =============================================

export class GameSocket {
    constructor() {
        this._ws               = null;
        this._handlers         = {};     // Map<type, [callbacks]>
        this._queue            = [];     // messages en attente si non connecté
        this._connected        = false;
        this._intentionalClose = false;  // [FIX 2] flag déconnexion volontaire
        this._reconnectDelay   = 500;    // [FIX 3] délai initial réduit (ms)
        this._maxReconnect     = 5;
        this._reconnectCount   = 0;
        this._url              = null;
        this._connectTimeout   = null;   // [NOUVEAU] Timeout pour la connexion
    }

    // ── Construction d'URL ─────────────────────────
    // [FIX 1] : dérive ws://host/ws depuis window.location
    static buildUrl() {
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        return `${proto}://${location.host}/ws`;
    }

    // ── Connexion ──────────────────────────────────
    // url est optionnelle : si absente, GameSocket.buildUrl() est utilisée
    connect(url) {
        this._url              = url || GameSocket.buildUrl();
        this._intentionalClose = false; // [FIX 2]
        this._open();
    }

    _open() {
        // Nettoyer l'ancienne socket proprement
        if (this._ws) {
            this._ws.onopen    = null;
            this._ws.onmessage = null;
            this._ws.onclose   = null;
            this._ws.onerror   = null;
        }

        this._ws = new WebSocket(this._url);

        // [NOUVEAU] Timeout de connexion : 10 secondes
        this._connectTimeout = setTimeout(() => {
            console.error('[Socket] ❌ Timeout connexion (10s) — fermeture');
            this._emit('__connect_timeout__', {});
            if (this._ws) {
                this._ws.close();
            }
        }, 10000);

        this._ws.onopen = () => {
            // Annuler le timeout si la connexion a réussi
            if (this._connectTimeout) {
                clearTimeout(this._connectTimeout);
                this._connectTimeout = null;
            }
            console.log('[Socket] ✅ Connecté');
            this._connected      = true;
            this._reconnectCount = 0;
            // Vider la file d'attente dans l'ordre
            while (this._queue.length > 0) {
                this._ws.send(this._queue.shift());
            }
            this._emit('__connected__', {});
        };

        this._ws.onmessage = (event) => {
            let msg;
            try { msg = JSON.parse(event.data); }
            catch { return; }
            const { type, payload = {} } = msg;
            console.log(`[Socket] ← ${type}`, payload);
            this._emit(type, payload);
        };

        this._ws.onclose = () => {
            // Annuler le timeout
            if (this._connectTimeout) {
                clearTimeout(this._connectTimeout);
                this._connectTimeout = null;
            }
            console.warn('[Socket] ⚠️ Connexion fermée');
            this._connected = false;
            this._emit('__disconnected__', {});

            // [FIX 2] Ne pas reconnecter si la fermeture est intentionnelle
            if (!this._intentionalClose) {
                this._tryReconnect();
            }
        };

        this._ws.onerror = (err) => {
            console.error('[Socket] ❌ Erreur WebSocket', err);
        };
    }

    _tryReconnect() {
        if (this._reconnectCount >= this._maxReconnect) {
            console.error('[Socket] ❌ Reconnexion abandonnée après', this._maxReconnect, 'tentatives');
            this._emit('__reconnect_failed__', {});
            return;
        }
        this._reconnectCount++;

        // [FIX 3] Délai linéaire plafonné à 3000ms
        // (évite de dépasser la fenêtre de grâce de 2 min du ws-handler)
        const delay = Math.min(this._reconnectDelay * this._reconnectCount, 3000);
        console.log(`[Socket] 🔄 Reconnexion dans ${delay}ms (tentative ${this._reconnectCount}/${this._maxReconnect})...`);
        setTimeout(() => this._open(), delay);
    }

    // [FIX 2] disconnect() marque la fermeture comme intentionnelle
    disconnect() {
        this._intentionalClose = true;
        this._ws?.close();
    }

    // [FIX 2] reset() : permet une reconnexion propre après navigation
    // Appeler avant connect() si le socket a été fermé intentionnellement
    reset() {
        this._intentionalClose = false;
        this._reconnectCount   = 0;
        this._queue            = [];
    }

    // ── Envoi ──────────────────────────────────────
    send(type, payload = {}) {
        const msg = JSON.stringify({ type, payload });
        if (this._connected && this._ws?.readyState === WebSocket.OPEN) {
            this._ws.send(msg);
            console.log(`[Socket] → ${type}`, payload);
        } else {
            // File d'attente (max 20 messages)
            if (this._queue.length < 20) {
                this._queue.push(msg);
                console.log(`[Socket] ⏳ En file d'attente: ${type} (${this._queue.length}/20)`);
            }
        }
    }

    // ── Abonnements ────────────────────────────────
    on(type, callback) {
        if (!this._handlers[type]) this._handlers[type] = [];
        this._handlers[type].push(callback);
        return this; // chaînable
    }

    off(type, callback) {
        if (!this._handlers[type]) return;
        this._handlers[type] = this._handlers[type].filter(cb => cb !== callback);
    }

    // [AMÉLIORATION 1] Abonnement à usage unique
    once(type, callback) {
        const wrapper = (payload) => {
            this.off(type, wrapper);
            callback(payload);
        };
        return this.on(type, wrapper);
    }

    // [AMÉLIORATION 2] Attend le prochain message d'un type donné
    // Usage : const { snapshot } = await socket.waitFor('JOIN_OK', 10_000);
    waitFor(type, timeoutMs = 10_000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.off(type, handler);
                reject(new Error(`[Socket] Timeout en attente de "${type}" (${timeoutMs}ms)`));
            }, timeoutMs);

            const handler = (payload) => {
                clearTimeout(timer);
                resolve(payload);
            };
            this.once(type, handler);
        });
    }

    _emit(type, payload) {
        (this._handlers[type] || []).forEach(cb => {
            try { cb(payload); }
            catch (e) { console.error(`[Socket] Erreur handler "${type}":`, e); }
        });
    }

    get connected() { return this._connected; }
}

// ── Singleton partagé ──────────────────────────
// Import depuis n'importe quel module :
//   import { socket } from './core/socket.js';
//
// Connexion (à appeler une seule fois depuis main.js ou jeu.js) :
//   socket.connect();                   // URL auto depuis window.location
//   socket.connect('ws://host/ws');     // URL explicite
//
// Après navigation vers jeu.html (si le socket était ouvert) :
//   socket.reset();
//   socket.connect();
export const socket = new GameSocket();