// /js/core/cleanup.js

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
    'minigame_partie_session_id',
    'minigame_partie_id',
    'ws_partie_id',
];

const CLES_PARASITES = [
    'equipes_enregistrees',
    'minigame_theme',
    'scores_comptabilises',
];

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
    console.log(`[CLEANUP] ${keysToDelete.length} clé(s) de session supprimée(s)`);
    return keysToDelete.length;
}

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

export function nettoyerTout() {
    nettoyerSession();
    console.log('[CLEANUP] Nettoyage complet effectué');
}

export function resetEtatQuizHote() {
    import('../modules/quiz_hote.js')
        .then(m => {
            if (typeof m.nettoyerPartieInvites === 'function') {
                m.nettoyerPartieInvites();
                console.log('[CLEANUP] ✅ quiz_hote réinitialisé');
            }
        })
        .catch(() => {});

    // HostSession est réinitialisé depuis main.js qui le détient
}