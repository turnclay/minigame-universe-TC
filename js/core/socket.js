// public/js/core/socket.js
// =============================================
// 🔌 CLIENT WEBSOCKET PARTAGÉ
// Utilisé par host.js et player.js
// =============================================

export class GameSocket {
    constructor() {
        this._ws         = null;
        this._handlers   = {};   // Map<type, [callbacks]>
        this._queue      = [];   // messages en attente si non connecté
        this._connected  = false;
        this._reconnectDelay = 1500;
        this._maxReconnect   = 5;
        this._reconnectCount = 0;
        this._url        = null;
    }

    // ── Connexion ──────────────────────────────────
    connect(url) {
        this._url = url;
        this._open();
    }

    _open() {
        if (this._ws) {
            this._ws.onopen    = null;
            this._ws.onmessage = null;
            this._ws.onclose   = null;
            this._ws.onerror   = null;
        }

        this._ws = new WebSocket(this._url);

        this._ws.onopen = () => {
            console.log("[Socket] Connecté ✅");
            this._connected  = true;
            this._reconnectCount = 0;
            // Vide la file d'attente
            while (this._queue.length > 0) {
                this._ws.send(this._queue.shift());
            }
            this._emit("__connected__", {});
        };

        this._ws.onmessage = (event) => {
            let msg;
            try { msg = JSON.parse(event.data); }
            catch { return; }
            const { type, payload = {} } = msg;
            this._emit(type, payload);
        };

        this._ws.onclose = () => {
            console.warn("[Socket] Connexion fermée.");
            this._connected = false;
            this._emit("__disconnected__", {});
            this._tryReconnect();
        };

        this._ws.onerror = (err) => {
            console.error("[Socket] Erreur WebSocket", err);
        };
    }

    _tryReconnect() {
        if (this._reconnectCount >= this._maxReconnect) {
            console.error("[Socket] Reconnexion abandonnée après", this._maxReconnect, "tentatives.");
            this._emit("__reconnect_failed__", {});
            return;
        }
        this._reconnectCount++;
        const delay = this._reconnectDelay * this._reconnectCount;
        console.log(`[Socket] Reconnexion dans ${delay}ms (tentative ${this._reconnectCount})...`);
        setTimeout(() => this._open(), delay);
    }

    disconnect() {
        this._maxReconnect = 0; // empêche la reconnexion auto
        this._ws?.close();
    }

    // ── Envoi ──────────────────────────────────────
    send(type, payload = {}) {
        const msg = JSON.stringify({ type, payload });
        if (this._connected && this._ws?.readyState === WebSocket.OPEN) {
            this._ws.send(msg);
        } else {
            // File d'attente (max 20 messages)
            if (this._queue.length < 20) this._queue.push(msg);
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

    _emit(type, payload) {
        (this._handlers[type] || []).forEach(cb => {
            try { cb(payload); }
            catch (e) { console.error(`[Socket] Erreur handler "${type}":`, e); }
        });
    }

    get connected() { return this._connected; }
}

// Singleton partagé
export const socket = new GameSocket();
