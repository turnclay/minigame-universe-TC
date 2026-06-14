// ======================================================
// 🕵️ server/games/undercover.js
// ======================================================
// Emplacement : server/games/undercover.js
//
// Handler serveur pour UNDERCOVER (host-authoritative), aligné sur le
// patron morpion.js / puissance4.js et sur les helpers réellement exposés
// par ws-handler.js : { broadcastToGame, broadcastToPlayers, broadcastToHost,
//                        send, sendToPseudo, sendToAllExcept }
//
// Principe :
//   - L'hôte reste autoritaire (rôles, mots, votes, élimination, fin, MW).
//   - Le serveur MÉMORISE le dernier état PUBLIC (resync via getSessionState,
//     renvoyé dans JOIN_OK/REJOIN_OK sous la clé `gameState`).
//   - Le serveur mémorise aussi le rôle PRIVÉ de chaque invité et ne le
//     renvoie qu'au socket concerné (sendToPseudo) — jamais en clair à tous.
//   - Les actions invités (role_vu / vote / mw_guess / resync_role) sont
//     relayées à l'hôte (broadcastToHost) qui recalcule et republie l'état.
// ======================================================

const sessions = {}; // { partieId: { etatPublic, rolesPrives, ts } }

function _ensure(partieId) {
    if (!sessions[partieId]) {
        sessions[partieId] = { etatPublic: null, rolesPrives: {}, ts: Date.now() };
    }
    return sessions[partieId];
}

// Renvoyé tel quel comme `gameState` à la (re)connexion d'un invité.
// Le module invité (undercover_player.js) sait consommer { action, data }.
export function getSessionState(partieId) {
    const s = sessions[partieId];
    if (!s || !s.etatPublic) return null;
    return { action: 'undercover:state', data: s.etatPublic };
}

export function setSessionState(partieId, etatPublic) {
    const s = _ensure(partieId);
    s.etatPublic = etatPublic;
    s.ts = Date.now();
}

export function detruireSession(partieId) {
    delete sessions[partieId];
}

// ─────────────────────────────────────────────────────
// HOST_ACTION (préfixe "undercover:")
// ─────────────────────────────────────────────────────
export function handleHostAction(wss, ws, partieId, action, data, helpers) {
    if (!action.startsWith('undercover:')) return;

    const { broadcastToPlayers, sendToPseudo } = helpers;
    const cmd = action.split(':')[1];
    const s   = _ensure(partieId);

    switch (cmd) {

        // État PUBLIC (aucun rôle privé). Mémorisé + diffusé aux invités.
        case 'state': {
            if (!data || typeof data.phase !== 'string') return;
            setSessionState(partieId, data);
            broadcastToPlayers(wss, partieId, 'HOST_ACTION', { action: 'undercover:state', data });
            return;
        }

        // Rôle/mot PRIVÉ d'un invité. Mémorisé + envoyé UNIQUEMENT à lui.
        case 'role': {
            if (!data || !data.pseudo) return;
            s.rolesPrives[data.pseudo] = {
                role : data.role || 'Civil',
                mot  : data.mot ?? null,
                theme: data.theme ?? null,
            };
            sendToPseudo(wss, partieId, data.pseudo, 'HOST_ACTION', { action: 'undercover:role', data });
            return;
        }

        // Nouvelle partie : purge mémoire + signal aux invités.
        case 'reset': {
            sessions[partieId] = { etatPublic: null, rolesPrives: {}, ts: Date.now() };
            broadcastToPlayers(wss, partieId, 'HOST_ACTION', { action: 'undercover:reset', data: data || {} });
            return;
        }

        default:
            broadcastToPlayers(wss, partieId, 'HOST_ACTION', { action, data: data || {} });
            return;
    }
}

// ─────────────────────────────────────────────────────
// PLAYER_ACTION (préfixe "undercover:")
// ─────────────────────────────────────────────────────
export function handlePlayerAction(wss, ws, partieId, pseudo, action, data, helpers) {
    if (!action.startsWith('undercover:')) return;

    const { broadcastToHost, send } = helpers;
    const cmd = action.split(':')[1];
    const s   = _ensure(partieId);

    switch (cmd) {

        case 'role_vu':
            broadcastToHost(wss, partieId, 'PLAYER_ACTION', { pseudo, action: 'undercover:role_vu', data: data || {} });
            return;

        case 'vote': {
            const cible = data && data.cible;
            if (!cible) { send(ws, 'UNDERCOVER_ACK', { status: 'vote_invalid' }); return; }
            broadcastToHost(wss, partieId, 'PLAYER_ACTION', { pseudo, action: 'undercover:vote', data: { cible } });
            send(ws, 'UNDERCOVER_ACK', { status: 'vote_ok' });
            return;
        }

        case 'mw_guess':
            broadcastToHost(wss, partieId, 'PLAYER_ACTION', { pseudo, action: 'undercover:mw_guess', data: data || {} });
            return;

        // (Re)connexion : renvoyer le rôle privé mémorisé si dispo,
        // sinon demander à l'hôte de le réémettre.
        case 'resync_role': {
            const prive = s.rolesPrives[pseudo];
            if (prive) {
                send(ws, 'HOST_ACTION', { action: 'undercover:role', data: { pseudo, ...prive } });
            } else {
                broadcastToHost(wss, partieId, 'PLAYER_ACTION', { pseudo, action: 'undercover:resync_role', data: {} });
            }
            return;
        }

        default:
            broadcastToHost(wss, partieId, 'PLAYER_ACTION', { pseudo, action, data: data || {} });
            return;
    }
}