// ======================================================
// 🧠 server/games/memoire.js — v1.0 (migration WS)
// ======================================================
// Mémoire en WS-server-driven (patron pendu/petitbac).
//
// Mécanique : l'hôte choisit un défi + une difficulté et GÉNÈRE les
// données une seule fois. Le serveur rediffuse ces mêmes données à
// tous les invités (mêmes cartes / suite / couleurs / symboles).
// Chacun joue en parallèle sur son écran, calcule ses erreurs et son
// score (formule identique côté client) puis soumet son résultat.
// Le serveur fait autorité sur le total des scores (store).
//
// Actions hôte (HOST_ACTION) :
//   memoire:defi   → { typeDefi, difficulte, donnees, phase, config, base }
//   memoire:phase  → { phase }
//   memoire:result → { pseudo, erreurs, score }   (résultat de l'hôte)
//
// Action joueur (PLAYER_ACTION) :
//   memoire:result → { erreurs, score }
//
// Events serveur → clients :
//   MEMOIRE_DEFI      { typeDefi, difficulte, donnees, phase, config, base, manche, scores } (all)
//   MEMOIRE_PHASE     { phase, manche }                                                      (all)
//   MEMOIRE_RESULT_IN { pseudo, erreurs, score, nbResults, nbJoueurs, allDone }              (host)
//   MEMOIRE_RESULT_ACK{ status: 'ok'|'already'|'too_late'|'invalid' }                        (auteur)
//   SCORES_UPDATE     { scores }                                                             (all)
// ======================================================

import store from '../store.js';

const sessions = new Map();

function _getSession(partieId) { return sessions.get(partieId) || null; }

function _creerSession(partieId) {
    const s = {
        phase      : 'menu',
        typeDefi   : null,
        difficulte : null,
        donnees    : null,
        config     : null,
        base       : 3,
        manche     : 0,
        resultats  : {},   // { pseudo: { erreurs, score, ts } }
    };
    sessions.set(partieId, s);
    return s;
}

// ─────────────────────────────────────────────────────
// API publique
// ─────────────────────────────────────────────────────

export function getSessionState(partieId) {
    const s = _getSession(partieId);
    if (!s) return null;
    return {
        phase      : s.phase,
        typeDefi   : s.typeDefi,
        difficulte : s.difficulte,
        donnees    : s.donnees,
        config     : s.config,
        base       : s.base,
        manche     : s.manche,
        scores     : store.getScores(partieId) || {},
    };
}

export function detruireSession(partieId) {
    sessions.delete(partieId);
    console.log(`[MEMOIRE] 🗑️ Session détruite: ${partieId}`);
}

// ─────────────────────────────────────────────────────
// HOST ACTIONS
// ─────────────────────────────────────────────────────

export function handleHostAction(wss, ws, partieId, action, data, helpers) {
    const { broadcastToGame } = helpers;
    const cmd = action.split(':')[1];

    switch (cmd) {

        case 'defi': {
            let s = _getSession(partieId);
            if (!s) s = _creerSession(partieId);

            s.typeDefi   = data.typeDefi ?? null;
            s.difficulte = data.difficulte ?? null;
            s.phase      = data.phase || 'menu';
            s.config     = data.config ?? s.config;
            s.base       = data.base ?? s.base;

            // Nouveau défi : on (re)part proprement au countdown.
            if (s.phase === 'countdown') {
                s.manche++;
                s.resultats = {};
                s.donnees   = null;
            }
            if (data.donnees != null) s.donnees = data.donnees;

            broadcastToGame(wss, partieId, 'MEMOIRE_DEFI', {
                typeDefi   : s.typeDefi,
                difficulte : s.difficulte,
                donnees    : s.donnees,
                phase      : s.phase,
                config     : s.config,
                base       : s.base,
                manche     : s.manche,
                scores     : store.getScores(partieId) || {},
            });
            console.log(`[MEMOIRE] 🎯 defi=${s.typeDefi} diff=${s.difficulte} phase=${s.phase} manche=${s.manche}`);
            break;
        }

        case 'phase': {
            const s = _getSession(partieId);
            if (!s) break;
            s.phase = data.phase || s.phase;
            broadcastToGame(wss, partieId, 'MEMOIRE_PHASE', { phase: s.phase, manche: s.manche });
            console.log(`[MEMOIRE] ⏩ phase → ${s.phase}`);
            break;
        }

        case 'result': {
            _enregistrerResultat(wss, partieId, data.pseudo, data, helpers, ws);
            break;
        }

        default:
            console.warn(`[MEMOIRE] ⚠️ Action host inconnue: ${cmd}`);
    }
}

// ─────────────────────────────────────────────────────
// PLAYER ACTIONS
// ─────────────────────────────────────────────────────

export function handlePlayerAction(wss, ws, partieId, pseudo, action, data, helpers) {
    const cmd = action.split(':')[1];
    if (cmd === 'result') {
        _enregistrerResultat(wss, partieId, pseudo, data, helpers, ws);
    } else {
        console.warn(`[MEMOIRE] ⚠️ Action joueur inconnue: ${cmd}`);
    }
}

// ─────────────────────────────────────────────────────
// Enregistrement d'un résultat (hôte ou invité)
// ─────────────────────────────────────────────────────

function _enregistrerResultat(wss, partieId, pseudoRaw, data, helpers, ws) {
    const { broadcastToGame, broadcastToHost, send } = helpers;
    const s = _getSession(partieId);

    if (!s || (s.phase !== 'jeu' && s.phase !== 'affichage' && s.phase !== 'resultats')) {
        return send(ws, 'MEMOIRE_RESULT_ACK', { status: 'too_late' });
    }

    const partie = store.getPartie(partieId);
    const pseudo = (pseudoRaw && String(pseudoRaw).trim()) || partie?.hostPseudo || null;
    if (!pseudo || pseudo === 'null' || pseudo === 'undefined') {
        return send(ws, 'MEMOIRE_RESULT_ACK', { status: 'invalid' });
    }
    if (s.resultats[pseudo] !== undefined) {
        return send(ws, 'MEMOIRE_RESULT_ACK', { status: 'already' });
    }

    const erreurs = Math.max(0, (data.erreurs | 0));
    const score   = Math.max(0, Math.min(1000, (data.score | 0)));
    s.resultats[pseudo] = { erreurs, score, ts: Date.now() };

    if (score > 0) store.modifierScore(partieId, pseudo, score);

    send(ws, 'MEMOIRE_RESULT_ACK', { status: 'ok' });

    const nbJoueurs = (partie?.joueurs || []).length;
    const nbResults = Object.keys(s.resultats).length;
    const scores    = store.getScores(partieId) || {};

    broadcastToHost(wss, partieId, 'MEMOIRE_RESULT_IN', {
        pseudo, erreurs, score, nbResults, nbJoueurs,
        allDone: nbResults >= nbJoueurs,
    });
    broadcastToGame(wss, partieId, 'SCORES_UPDATE', { scores });

    console.log(`[MEMOIRE] 🎮 Résultat ${pseudo}: erreurs=${erreurs}, score=${score} (${nbResults}/${nbJoueurs})`);
}