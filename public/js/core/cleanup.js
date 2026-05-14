// /js/core/cleanup.js — v2.0
// =============================================================
// CLEANUP — Nettoyage du localStorage et des états mémoire
// entre les parties.
//
// CORRECTIONS v2.0 :
// [FIX] 'minigame_partie_id' ajouté dans CLES_EXACTES.
//       Cette clé était absente : cleanup.js ne la supprimait pas,
//       et lancerJeu() la restaurait après nettoyerSession(),
//       ce qui faisait pointer quiz_hote._pid() vers l'ancienne partie.
//
// [FIX] 'performances' retiré de CLES_PARASITES.
//       Les performances sont des données permanentes (historique joueurs)
//       et ne doivent jamais être supprimées au démarrage ou entre deux parties.
//
// [NEW] resetEtatQuizHote() : réinitialise les variables mémoire de
//       quiz_hote.js (nettoyerPartieInvites) + HostSession._snapshot.
//       Doit être appelé avant chaque nouvelle partie quiz.
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
    // Le seul ID valide est celui reçu de GAME_CREATED.
    'minigame_partie_session_id',
    'minigame_partie_id',      // [FIX] manquait — cause principale des joueurs fantômes
    'ws_partie_id',
];

const CLES_PARASITES = [
    'equipes_enregistrees',
    'minigame_theme',
    // 'performances' retiré : données permanentes à ne jamais purger
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
        if (CLES_EXACTES.includes(k))  keysToDelete.push(k);
        if (CLES_PARASITES.includes(k)) keysToDelete.push(k);
    }

    keysToDelete.forEach(k => localStorage.removeItem(k));
    console.log(`[CLEANUP] ${keysToDelete.length} clé(s) de session supprimée(s) :`, keysToDelete);
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
    if (count) console.log(`[CLEANUP] ${count} clé(s) parasite(s) supprimée(s)`);
    return count;
}

/**
 * Nettoyage total — TOUT supprimer sauf les données permanentes.
 * Utilisé par le bouton "Réinitialiser" dans les réglages.
 */
export function nettoyerTout() {
    nettoyerSession();
    console.log('[CLEANUP] Nettoyage complet effectué');
}

/**
 * [NEW] Réinitialise l'état mémoire du module quiz_hote.js
 * et du snapshot HostSession entre deux parties.
 *
 * POURQUOI :
 *   quiz_hote.js maintient des variables module-scope (_nbInvites,
 *   _reponsesRecues, _wsListenersActifs…) qui ne sont jamais remises
 *   à zéro entre deux parties dans la même page navigateur.
 *   Si la partie précédente avait 1 invité, _nbInvites reste à 1
 *   pour la partie suivante → le bouton "Afficher" attend un joueur
 *   fantôme qui n'existe pas.
 *
 * QUAND APPELER :
 *   - Dans main.js, juste avant HostSession.creerPartie() (initStartSolo)
 *   - Dans main.js, dans le handler GAME_ENDED
 */
export function resetEtatQuizHote() {
    // 1. Réinitialiser quiz_hote.js via son export nettoyerPartieInvites()
    //    Import dynamique pour éviter la dépendance circulaire et les
    //    erreurs si le module n'est pas encore chargé.
    import('../modules/quiz_hote.js')
        .then(m => {
            if (typeof m.nettoyerPartieInvites === 'function') {
                m.nettoyerPartieInvites();
                console.log('[CLEANUP] ✅ quiz_hote réinitialisé');
            }
        })
        .catch(() => {
            // Module pas encore chargé (premier démarrage) — normal, ignorer
        });

    // 2. Réinitialiser le snapshot HostSession pour que _nbJoueursTotal()
    //    ne lise plus les joueurs de la partie précédente.
    if (window.HostSession) {
        window.HostSession._snapshot  = null;
        window.HostSession._partieId  = null;
        window.HostSession._pendingStart = false;
        console.log('[CLEANUP] ✅ HostSession snapshot réinitialisé');
    }

    // 3. Vider le window global utilisé par quiz_hote pour la réponse hôte
    window._quizReponseSaisieHote = '';
}