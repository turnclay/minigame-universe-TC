// /js/core/cleanup.js — v2.1 (corrected & rewritten)
// =============================================================
// CLEANUP — Nettoyage du localStorage et des états mémoire
// entre les parties.
// =============================================================

import { nettoyerPartieInvites } from '../modules/quiz_hote.js';

// Préfixes des clés de session temporaires
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

// Clés exactes à supprimer systématiquement
const CLES_EXACTES = [
    'invite_joueur_context',
    'partie:signal',
    'minigame_partie_session_id',
    'minigame_partie_id',
    'ws_partie_id',
];

// Clés parasites (anciennes fonctionnalités)
const CLES_PARASITES = [
    'equipes_enregistrees',
    'minigame_theme',
    'scores_comptabilises',
];

// -------------------------------------------------------------
// 🔥 Nettoyage complet des clés de session
// -------------------------------------------------------------
export function nettoyerSession() {
    const toDelete = [];

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;

        if (PREFIXES_SESSION.some(p => key.startsWith(p))) toDelete.push(key);
        if (CLES_EXACTES.includes(key)) toDelete.push(key);
        if (CLES_PARASITES.includes(key)) toDelete.push(key);
    }

    toDelete.forEach(k => localStorage.removeItem(k));
    console.log(`[CLEANUP] ${toDelete.length} clé(s) supprimée(s) :`, toDelete);

    return toDelete.length;
}

// -------------------------------------------------------------
// 🔥 Nettoyage léger (parasites uniquement)
// -------------------------------------------------------------
export function nettoyerParasites() {
    let count = 0;

    CLES_PARASITES.forEach(k => {
        if (localStorage.getItem(k) !== null) {
            localStorage.removeItem(k);
            count++;
        }
    });

    if (count > 0) {
        console.log(`[CLEANUP] ${count} clé(s) parasite(s) supprimée(s)`);
    }

    return count;
}

// -------------------------------------------------------------
// 🔥 Nettoyage total (bouton "Réinitialiser")
// -------------------------------------------------------------
export function nettoyerTout() {
    nettoyerSession();
    console.log('[CLEANUP] Nettoyage complet effectué');
}

// -------------------------------------------------------------
// 🔥 Reset complet de quiz_hote + HostSession
// -------------------------------------------------------------
export function resetEtatQuizHote() {
    // 1. Reset du module quiz_hote.js
    try {
        nettoyerPartieInvites();
        console.log('[CLEANUP] ✅ quiz_hote réinitialisé');
    } catch {
        console.warn('[CLEANUP] ⚠️ quiz_hote non chargé — ignoré');
    }

    // 2. Reset du snapshot HostSession
    if (window.HostSession) {
        window.HostSession._snapshot = null;
        window.HostSession._partieId = null;
        window.HostSession._pendingStart = false;
        console.log('[CLEANUP] ✅ HostSession snapshot réinitialisé');
    }

    // 3. Reset de la réponse hôte
    window._quizReponseSaisieHote = '';
}
