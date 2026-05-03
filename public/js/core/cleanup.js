// /js/core/cleanup.js
// =============================================================
// 🧹 CLEANUP — Nettoyage du localStorage entre les parties
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
//   invite_joueur_context
//   partie:signal
//   minigame_partie_session_id  (régénéré par invite.js)
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
    // NE PAS supprimer minigame_partie_session_id — quiz_hote.js en dépend
];

// Clés parasites permanentes à nettoyer UNE FOIS au démarrage
// (données d'anciennes sessions ou fonctionnalités non utilisées)
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
    console.log(`[CLEANUP] 🧹 ${keysToDelete.length} clé(s) supprimée(s) :`, keysToDelete);
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
    if (count) console.log(`[CLEANUP] 🧹 ${count} clé(s) parasite(s) supprimée(s)`);
    return count;
}

/**
 * Nettoyage total — TOUT supprimer sauf les données permanentes.
 * Utilisé par le bouton "Réinitialiser" dans les réglages.
 */
export function nettoyerTout() {
    nettoyerSession();
    // Conserver players, parties, scores_globaux, performances
    console.log('[CLEANUP] 🧹 Nettoyage complet effectué');
}