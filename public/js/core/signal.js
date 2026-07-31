// /js/core/signal.js
// =============================================================
// 📡 SIGNAL — Canal de communication hôte → invités
// =============================================================
// Clé localStorage unique : 'partie:signal'
// Format  : { type: 'start'|'end', sid: string, jeu: string, ts: number }
//
// HÔTE  → signalDemarrage(sid, jeu)
// INVITÉ → ecouterSignal(onStart, onEnd)  +  lireSignal() au démarrage
//
// Pourquoi une clé dédiée plutôt que partie_etat_* ?
// partie_etat_* dépend d'un sessionId qui peut diverger entre hôte et invité.
// 'partie:signal' est universel, sans ID dans la clé.
// =============================================================

export const SIGNAL_KEY = 'partie:signal';

/** Hôte → émet le signal de démarrage */
export function signalDemarrage(sid, jeu) {
    const payload = { type: 'start', sid, jeu, ts: Date.now() };
    localStorage.setItem(SIGNAL_KEY, JSON.stringify(payload));
    console.log('[SIGNAL] 🚀 Démarrage :', payload);
}

/** Hôte → émet le signal de fin */
export function signalFin(sid) {
    localStorage.setItem(SIGNAL_KEY, JSON.stringify({ type: 'end', sid, ts: Date.now() }));
}

/** Lire le dernier signal (invité arrivé après le start) */
export function lireSignal() {
    try { return JSON.parse(localStorage.getItem(SIGNAL_KEY) || 'null'); }
    catch { return null; }
}

/** Effacer le signal (fin de partie) */
export function effacerSignal() {
    localStorage.removeItem(SIGNAL_KEY);
}

/**
 * Invité → écouter les futurs signaux via StorageEvent
 * @returns {()=>void} cleanup — appeler pour se désabonner
 */
export function ecouterSignal(onStart, onEnd) {
    const handler = (e) => {
        if (e.key !== SIGNAL_KEY || !e.newValue) return;
        try {
            const s = JSON.parse(e.newValue);
            if (s.type === 'start' && onStart) onStart(s);
            if (s.type === 'end'   && onEnd)   onEnd(s);
        } catch {}
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
}