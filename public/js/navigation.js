// ======================================================
// 🧭 NAVIGATION.JS — Gestion de la navigation
// ======================================================

/**
 * Allez à l'accueil
 */
export function goHome() {
    window.location.href = '/';
}

/**
 * Allez au host (créer partie)
 */
export function goHost(jeuId = null) {
    const url = jeuId ? `/host/?jeu=${jeuId}` : '/host/';
    window.location.href = url;
}

/**
 * Allez au join (rejoindre partie)
 */
export function goJoin() {
    window.location.href = '/join/';
}

/**
 * Allez au jeu
 */
export function goGame(jeuId, partieId) {
    const url = `/games/${jeuId}/?partieId=${partieId}`;
    window.location.href = url;
}