// ======================================================
// 🎮 server/games/morpion.js
// ======================================================
// Handler serveur pour MORPION (host-authoritative)
//
// Rôle :
// - Valider les coups des invités
// - Relayer l'état du plateau hôte vers tous les invités
// - Gérer les reconnexions (resync)
//
// Le vrai logique de jeu (victoire, validité) reste côté hôte (morpion.js)
// Le serveur est un "passeur" + validateur basique
// ======================================================

// ─────────────────────────────────────────────────────
// SESSIONS (stockage par partieId)
// ─────────────────────────────────────────────────────

const sessions = {}; // { partieId: { lastState, ... } }

export function getSessionState(partieId) {
    return sessions[partieId] || null;
}

export function setSessionState(partieId, state) {
    sessions[partieId] = { ...state, ts: Date.now() };
}

export function detruireSession(partieId) {
    delete sessions[partieId];
}

// ─────────────────────────────────────────────────────
// HOST_ACTION HANDLER
// ─────────────────────────────────────────────────────
// L'hôte publie l'état du morpion pour que tous les invités
// le reçoivent en temps réel

export function handleHostAction(wss, ws, partieId, action, data, helpers) {
    if (!action.startsWith('morpion:')) return;

    const { broadcastToPlayers } = helpers;

    // ── morpion:state ──
    // Reçu : { plateau, taille, alignementRequis, tourActuel, joueurs, partieTerminee, gagnant, matchNul, modeAvance }
    // Renvoyé : aux invités pour sync complète
    if (action === 'morpion:state') {
        // Valider les données basiques
        if (!data || typeof data.plateau !== 'object' || !Array.isArray(data.plateau)) {
            console.warn('[MORPION] ⚠️ État plateau invalide');
            return;
        }

        // Sauvegarder l'état pour les resync futures
        setSessionState(partieId, data);

        // Relayer aux invités
        broadcastToPlayers(wss, partieId, 'HOST_ACTION', {
            action: 'morpion:state',
            data
        });

        console.log(`[MORPION] 📡 morpion:state publié → invités (tour ${data.tourActuel})`);
        return;
    }

    // ── morpion:reset ──
    // Reçu : réinitialisation pour nouvelle partie (optionnel)
    if (action === 'morpion:reset') {
        detruireSession(partieId);
        broadcastToPlayers(wss, partieId, 'HOST_ACTION', {
            action: 'morpion:reset'
        });
        console.log('[MORPION] 🔄 Reset → nouvelle partie');
        return;
    }
}

// ─────────────────────────────────────────────────────
// PLAYER_ACTION HANDLER
// ─────────────────────────────────────────────────────
// Un invité envoie son coup. Le serveur le valide basiquement
// et le relaie à l'hôte pour validation complète.

export function handlePlayerAction(wss, ws, partieId, pseudo, action, data, helpers) {
    if (!action.startsWith('morpion:')) return;

    const { broadcastToHost } = helpers;

    // ── morpion:move ──
    // Reçu : { row, col }
    // Renvoyé : à l'hôte pour validation logique complète
    if (action === 'morpion:move') {
        // Validation basique
        if (typeof data.row !== 'number' || typeof data.col !== 'number') {
            console.warn(`[MORPION] ⚠️ Coup invalide de ${pseudo}: row=${data.row}, col=${data.col}`);
            return;
        }

        // Relayer à l'hôte
        broadcastToHost(wss, partieId, 'PLAYER_ACTION', {
            pseudo,
            action: 'morpion:move',
            data: { row: data.row, col: data.col }
        });

        console.log(`[MORPION] 🎯 Coup ${pseudo}: (${data.row}, ${data.col}) → hôte`);
        return;
    }
}

