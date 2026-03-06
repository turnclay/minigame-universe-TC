// /js/core/socket.js
// =============================================
// 🔌 CLIENT WEBSOCKET PARTAGÉ
// =============================================

export class GameSocket {
    constructor() {
        this._ws         = null;
        this._handlers   = {};
        this._queue      = [];
        this._connected  = false;
        this._reconnectDelay = 1500;
        this._maxReconnect   = 5;
        this._reconnectCount = 0;
        this._url        = null;
    }

    connect(url) {
        this._url = url;
        this._open();
    }

    _open() {
        if (this._ws) {
            this._ws.onopen = this._ws.onmessage = this._ws.onclose = this._ws.onerror = null;
        }
        this._ws = new WebSocket(this._url);

        this._ws.onopen = () => {
            this._connected = true;
            this._reconnectCount = 0;
            while (this._queue.length > 0) this._ws.send(this._queue.shift());
            this._emit("__connected__", {});
        };

        this._ws.onmessage = (event) => {
            let msg;
            try { msg = JSON.parse(event.data); } catch { return; }
            const { type, payload = {} } = msg;
            this._emit(type, payload);
        };

        this._ws.onclose = () => {
            this._connected = false;
            this._emit("__disconnected__", {});
            this._tryReconnect();
        };

        this._ws.onerror = (err) => { console.error("[Socket] Erreur WebSocket", err); };
    }

    _tryReconnect() {
        if (this._reconnectCount >= this._maxReconnect) {
            this._emit("__reconnect_failed__", {}); return;
        }
        this._reconnectCount++;
        setTimeout(() => this._open(), this._reconnectDelay * this._reconnectCount);
    }

    disconnect() {
        this._maxReconnect = 0;
        this._ws?.close();
    }

    send(type, payload = {}) {
        const msg = JSON.stringify({ type, payload });
        if (this._connected && this._ws?.readyState === WebSocket.OPEN) {
            this._ws.send(msg);
        } else {
            if (this._queue.length < 20) this._queue.push(msg);
        }
    }

    on(type, callback) {
        if (!this._handlers[type]) this._handlers[type] = [];
        this._handlers[type].push(callback);
        return this;
    }

    off(type, callback) {
        if (!this._handlers[type]) return;
        this._handlers[type] = this._handlers[type].filter(cb => cb !== callback);
    }

    _emit(type, payload) {
        (this._handlers[type] || []).forEach(cb => {
            try { cb(payload); } catch (e) { console.error(`[Socket] Erreur handler "${type}":`, e); }
        });
    }

    get connected() { return this._connected; }
}

export const socket = new GameSocket();