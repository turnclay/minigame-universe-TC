// ======================================================
// 🧠 server/games/memoire.js — v1.2 (WS, conforme Architecte/JEUX/QA + durci)
// ======================================================
// Source de vérité = serveur. Jeu simultané : l'hôte choisit un défi
// + difficulté et GÉNÈRE les données une seule fois ; le serveur les
// rediffuse à tous (mêmes cartes/suite/couleurs/symboles) et FAIT
// AUTORITÉ sur :
//   - le timing de mémorisation (tsAffichageFin = horloge serveur),
//   - le SCORE (recalculé serveur à partir des erreurs → anti-triche),
//   - la transition 'resultats' (auto sur allDone, ou forcée par l'hôte).
//
// Phases : menu → countdown → affichage → jeu → resultats
//
// Actions hôte (HOST_ACTION) :
//   memoire:defi            → { typeDefi, difficulte, donnees, phase, config, base }
//   memoire:phase           → { phase }   (countdown | affichage | jeu ; 'resultats' ignoré)
//   memoire:result          → { pseudo, erreurs }            (résultat de l'hôte)
//   memoire:force_resultats → {}          (révélation forcée — anti soft-lock)
//
// Action joueur (PLAYER_ACTION) :
//   memoire:result          → { erreurs }
//
// Events serveur → clients :
//   MEMOIRE_DEFI      { typeDefi, difficulte, donnees, phase, config, base, tsAffichageFin, manche, scores } (all)
//   MEMOIRE_PHASE     { phase, manche }                                                                       (all)
//   MEMOIRE_RESULT_IN { pseudo, erreurs, score, nbResults, nbJoueurs, allDone }                               (host)
//   MEMOIRE_RESULT_ACK{ status: 'ok'|'already'|'too_late'|'invalid' }                                         (auteur)
//   SCORES_UPDATE     { scores }                                                                              (all)
// ======================================================

import store from '../store.js';

const sessions = new Map();

function _getSession(partieId) { return sessions.get(partieId) || null; }

function _creerSession(partieId) {
    const s = {
        phase          : 'menu',
        typeDefi       : null,
        difficulte     : null,
        donnees        : null,
        config         : null,
        base           : 3,
        tsAffichageFin : null,
        manche         : 0,
        resultats      : {},   // { pseudo: { erreurs, score, ts } }
    };
    sessions.set(partieId, s);
    return s;
}

// Durée de mémorisation (ms) selon le défi — horloge autoritaire.
function _dureeMemo(s) {
    const c = s.config || {};
    if (s.typeDefi === 'couleurs') {
        const n = (s.donnees && Array.isArray(s.donnees.couleurs) ? s.donnees.couleurs.length : 0)
               || c.sequence || 0;
        return n * ((c.vitesse || 1000) + 90) + 250;
    }
    return c.tempsAffichage || 5000;
}

// Score recalculé serveur — formule IDENTIQUE au client (calculerScore).
function _calculerScore(s, erreurs) {
    const seuil = (s.config && s.config.seuilErreurs != null) ? s.config.seuilErreurs : 0;
    const base  = s.base || 3;
    if (erreurs > seuil) return 0;
    return erreurs === 0 ? base : 1;
}

// ─────────────────────────────────────────────────────
// API publique
// ─────────────────────────────────────────────────────

export function getSessionState(partieId) {
    const s = _getSession(partieId);
    if (!s) return null;
    return {
        phase          : s.phase,
        typeDefi       : s.typeDefi,
        difficulte     : s.difficulte,
        donnees        : s.donnees,
        config         : s.config,
        base           : s.base,
        tsAffichageFin : s.tsAffichageFin,
        manche         : s.manche,
        scores         : store.getScores(partieId) || {},
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

            // Gère la cohérence des données en fonction de la phase
            if (data.donnees != null) {
                s.donnees = data.donnees;
            } else if (s.phase === 'menu' || s.phase === 'countdown') {
                // Si pas de nouvelles données fournies, et que nous sommes en phase menu ou countdown,
                // on s'assure que les données sont nulles pour un état propre.
                s.donnees = null;
            }
            // Si phase 'affichage' ou 'jeu' et data.donnees est null, s.donnees conserve sa valeur (attendu)

            if (s.phase === 'countdown') {
                s.manche++;
                s.resultats      = {};
                s.tsAffichageFin = null; // Reset timer for countdown
            }

            if (s.phase === 'affichage') {
                s.tsAffichageFin = Date.now() + _dureeMemo(s);
            } else if (s.phase === 'menu' || s.phase === 'countdown') {
                s.tsAffichageFin = null;
            }

            broadcastToGame(wss, partieId, 'MEMOIRE_DEFI', {
                typeDefi       : s.typeDefi,
                difficulte     : s.difficulte,
                donnees        : s.donnees,
                phase          : s.phase,
                config         : s.config,
                base           : s.base,
                tsAffichageFin : s.tsAffichageFin,
                manche         : s.manche,
                scores         : store.getScores(partieId) || {},
            });
            console.log(`[MEMOIRE] 🎯 defi=${s.typeDefi} diff=${s.difficulte} phase=${s.phase} manche=${s.manche}`);
            break;
        }

        case 'phase': {
            const s = _getSession(partieId);
            if (!s) break;
            // 'resultats' est piloté par le serveur (allDone / force) → ignoré ici.
            if (data.phase === 'resultats') break;
            s.phase = data.phase || s.phase;
            broadcastToGame(wss, partieId, 'MEMOIRE_PHASE', { phase: s.phase, manche: s.manche });
            console.log(`[MEMOIRE] ⏩ phase → ${s.phase}`);
            break;
        }

        case 'result': {
            _enregistrerResultat(wss, partieId, data.pseudo, data, helpers, ws);
            break;
        }

        case 'force_resultats': {
            const s = _getSession(partieId);
            if (!s) break;
            if (s.phase !== 'resultats') {
                s.phase = 'resultats';
                broadcastToGame(wss, partieId, 'MEMOIRE_PHASE', { phase: 'resultats', manche: s.manche });
                console.log(`[MEMOIRE] 🏁 Révélation forcée par l'hôte (manche ${s.manche})`);
            }
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
// Enregistrement d'un résultat (hôte ou invité) — idempotent
// Le SCORE est recalculé serveur à partir des erreurs (anti-triche).
// ─────────────────────────────────────────────────────

function _enregistrerResultat(wss, partieId, pseudoRaw, data, helpers, ws) {
    const { broadcastToGame, broadcastToHost, send } = helpers;
    const s = _getSession(partieId);

    if (!s || (s.phase !== 'affichage' && s.phase !== 'jeu' && s.phase !== 'resultats')) {
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
    const score   = _calculerScore(s, erreurs);   // ← autorité serveur
    s.resultats[pseudo] = { erreurs, score, ts: Date.now() };

    if (score > 0) store.modifierScore(partieId, pseudo, score);

    send(ws, 'MEMOIRE_RESULT_ACK', { status: 'ok' });

    const nbJoueurs = (partie?.joueurs || []).length;
    const nbResults = Object.keys(s.resultats).length;
    const allDone   = nbJoueurs > 0 && nbResults >= nbJoueurs;
    const scores    = store.getScores(partieId) || {};

    broadcastToHost(wss, partieId, 'MEMOIRE_RESULT_IN', {
        pseudo, erreurs, score, nbResults, nbJoueurs, allDone,
    });
    broadcastToGame(wss, partieId, 'SCORES_UPDATE', { scores });

    if (allDone) {
        s.phase = 'resultats';
        broadcastToGame(wss, partieId, 'MEMOIRE_PHASE', { phase: 'resultats', manche: s.manche });
        console.log(`[MEMOIRE] 🏁 Tous ont soumis (manche ${s.manche}) → resultats`);
    }

    console.log(`[MEMOIRE] 🎮 ${pseudo}: erreurs=${erreurs} → score=${score} (${nbResults}/${nbJoueurs})`);
}