// ======================================================
// 🎮 server/games/puissance4.js
// ======================================================
// Handler serveur pour PUISSANCE 4 (host-authoritative)
//
// Rôle :
// - Valider les coups des invités
// - Relayer l'état de la grille hôte vers tous les invités
// - Gérer les reconnexions (resync)
//
// Le vrai logique de jeu (victoire, gravité, validité) reste côté hôte (puissance4.js)
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
// L'hôte publie l'état de la grille pour que tous les invités
// le reçoivent en temps réel

export function handleHostAction(wss, ws, partieId, action, data, helpers) {
    if (!action.startsWith('puissance4:')) return;

    const { broadcastToPlayers } = helpers;

    // ── puissance4:state ──
    // Reçu : { grille, joueurActuel, joueurs, couleurs, partieTerminee, gagnant, matchNul }
    // Renvoyé : aux invités pour sync complète
    if (action === 'puissance4:state') {
        // Valider les données basiques
        if (!data || typeof data.grille !== 'object' || !Array.isArray(data.grille)) {
            console.warn('[PUISSANCE4] ⚠️ État grille invalide');
            return;
        }

        // Sauvegarder l'état pour les resync futures
        setSessionState(partieId, data);

        // Relayer aux invités
        broadcastToPlayers(wss, partieId, 'HOST_ACTION', {
            action: 'puissance4:state',
            data
        });

        console.log(`[PUISSANCE4] 📡 puissance4:state publié → invités (joueur ${data.joueurActuel})`);
        return;
    }

    // ── puissance4:reset ──
    // Reçu : réinitialisation pour nouvelle partie (optionnel)
    if (action === 'puissance4:reset') {
        detruireSession(partieId);
        broadcastToPlayers(wss, partieId, 'HOST_ACTION', {
            action: 'puissance4:reset'
        });
        console.log('[PUISSANCE4] 🔄 Reset → nouvelle partie');
        return;
    }
}

// ─────────────────────────────────────────────────────
// PLAYER_ACTION HANDLER
// ─────────────────────────────────────────────────────
// Un invité envoie son coup. Le serveur le valide basiquement
// et le relaie à l'hôte pour validation complète.

export function handlePlayerAction(wss, ws, partieId, pseudo, action, data, helpers) {
    if (!action.startsWith('puissance4:')) return;

    const { broadcastToHost } = helpers;

    // ── puissance4:move ──
    // Reçu : { col }
    // Renvoyé : à l'hôte pour validation logique complète (gravité, victoire, etc.)
    if (action === 'puissance4:move') {
        // Validation basique
        if (typeof data.col !== 'number' || data.col < 0 || data.col > 6) {
            console.warn(`[PUISSANCE4] ⚠️ Coup invalide de ${pseudo}: col=${data.col}`);
            return;
        }

        // Relayer à l'hôte
        broadcastToHost(wss, partieId, 'PLAYER_ACTION', {
            pseudo,
            action: 'puissance4:move',
            data: { col: data.col }
        });

        console.log(`[PUISSANCE4] 🎯 Coup ${pseudo}: colonne ${data.col} → hôte`);
        return;
    }
}

