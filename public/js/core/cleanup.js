// /js/core/cleanup.js
// =============================================================
// CLEANUP — Nettoyage du localStorage entre les parties
// =============================================================
// Appelé par l'hôte avant de créer une nouvelle partie.
// Supprime toutes les clés de session sans toucher aux données
// permanentes (players, parties, scores_globaux, performances).
//
// Clés nettoyées (préfixes) :
//   partie_etat_*        partie_question_*     partie_reponses_*
//   partie_scores_*      partie_revelation_*   partie_demande_etat_*
//   partie_premier_*     partie_nav_*          partie_validation_*
//   invite_rejoint_*     invite_pret_*
//
// Clés exactes supprimées :
//   invite_joueur_context
//   partie:signal
//   minigame_partie_session_id   ← UUID de partie (réattribué par GAME_CREATED)
//   ws_partie_id                 ← UUID WS (réattribué par GAME_CREATED)
// =============================================================

const PREFIXES_SESSION = [
    'partie_etat_',
    'partie_question_',
    'partie_reponses_',
    'partie_scores_',
    'partie_revelation_',
    'partie_demande_etat_',
    'partie_premier_correct_',
    'partie_nav_',
    'partie_validation_',
    'invite_rejoint_',
    'invite_pret_',
];

const CLES_EXACTES = [
    'invite_joueur_context',
    'partie:signal',
    // IDs de partie — toujours supprimés entre deux parties.
    // Le seul ID valide est celui reçu de GAME_CREATED (ws_partie_id).
    // minigame_partie_session_id est un alias synchronisé au même moment.
    'minigame_partie_session_id',
    'ws_partie_id',
];

const CLES_PARASITES = [
    'equipes_enregistrees',
    'minigame_theme',
    'performances',
    'scores_comptabilises',
];

/**
 * Nettoyer toutes les clés de session.
 * NE touche PAS : players, parties, scores_globaux, performances.
 */
export function nettoyerSession() {
    const keysToDelete = [];

    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (PREFIXES_SESSION.some(p => k.startsWith(p))) keysToDelete.push(k);
        if (CLES_EXACTES.includes(k)) keysToDelete.push(k);
        if (CLES_PARASITES.includes(k)) keysToDelete.push(k);
    }

    keysToDelete.forEach(k => localStorage.removeItem(k));
    console.log(`[CLEANUP] ${keysToDelete.length} cle(s) supprimee(s) :`, keysToDelete);
    return keysToDelete.length;
}

/**
 * Nettoyer UNIQUEMENT les clés parasites (appelé au démarrage de l'app).
 * Ne touche pas aux données de jeu en cours.
 */
export function nettoyerParasites() {
    let count = 0;
    CLES_PARASITES.forEach(k => {
        if (localStorage.getItem(k) !== null) {
            localStorage.removeItem(k);
            count++;
        }
    });
    if (count) console.log(`[CLEANUP] ${count} cle(s) parasite(s) supprimee(s)`);
    return count;
}

/**
 * Nettoyage total — TOUT supprimer sauf les données permanentes.
 * Utilisé par le bouton "Réinitialiser" dans les réglages.
 */
export function nettoyerTout() {
    nettoyerSession();
    console.log('[CLEANUP] Nettoyage complet effectue');
}