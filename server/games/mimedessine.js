// ======================================================
// 🎨 server/games/mimedessine.js — v1.0 (WS, conforme Architecte/JEUX/QA + durci)
// ======================================================
// Source de vérité = serveur. Jeu simultané : l'hôte choisit un défi
// + difficulté et GÉNÈRE les données (mots) une seule fois ; le serveur les
// rediffuse à tous et FAIT AUTORITÉ sur :
//   - le timing des phases (tsPhaseEnd = horloge serveur),
//   - le SCORE (recalculé serveur à partir des devinettes → anti-triche),
//   - la transition 'resultats' (auto sur allDone, ou forcée par l'hôte).
//
// Phases : menu → choix_mot → dessin → reponse → resultats
//
// Actions hôte (HOST_ACTION) :
//   mimedessine:defi            → { config, motsDisponibles } (initialisation du jeu)
//   mimedessine:choix_mot       → { mot, drawerPseudo } (l'hôte choisit le mot et le dessinateur)
//   mimedessine:start_dessin    → {} (l'hôte lance la phase de dessin)
//   mimedessine:reveler_mot     → {} (l'hôte révèle le mot avant la fin du temps)
//   mimedessine:force_resultats → {} (révélation forcée — anti soft-lock)
//
// Action joueur (PLAYER_ACTION) :
//   mimedessine:drawing_update  → { data } (le dessinateur envoie des données de dessin)
//   mimedessine:guess           → { guess } (un joueur envoie une devinette)
//
// Events serveur → clients :
//   MIMEDESSSINE_DEFI          { config, phase, manche, drawerPseudo, scores } (all)
//   MIMEDESSSINE_PHASE         { phase, manche, tsPhaseEnd, motADevinerRevele } (all)
//   MIMEDESSSINE_MOT_A_DEVINER { mot } (drawer only)
//   MIMEDESSSINE_DRAWING_DATA  { data } (all except drawer)
//   MIMEDESSSINE_GUESS_IN      { pseudo, guess, correct, scoreGuesseur, scoreDessinateur, allGuessed } (host)
//   MIMEDESSSINE_GUESS_ACK     { status: 'ok'|'already'|'too_late'|'invalid'|'correct'|'incorrect' } (auteur)
//   SCORES_UPDATE              { scores } (all)
// ======================================================

import store from '../store.js';

const sessions = new Map();

function _getSession(partieId) { return sessions.get(partieId) || null; }

function _creerSession(partieId) {
    const s = {
        phase           : 'menu',
        manche          : 0,
        config          : {
            tempsDessin     : 90000, // 90 secondes
            tempsReponse    : 15000, // 15 secondes après le dessin
            scoreDessinateur: 3,
            scoreGuesseur   : 2,
            motsParManche   : 1,
        },
        motsDisponibles : [],
        motADeviner     : null,
        drawerPseudo    : null,
        dessinData      : [],
        guesses         : [], // { pseudo, guess, correct, ts }
        tsPhaseEnd      : null,
        motADevinerRevele: false,
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
        phase           : s.phase,
        manche          : s.manche,
        config          : s.config,
        motADeviner     : s.motADeviner, // Should be null for non-drawer in 'dessin' phase
        drawerPseudo    : s.drawerPseudo,
        dessinData      : s.dessinData,
        tsPhaseEnd      : s.tsPhaseEnd,
        motADevinerRevele: s.motADevinerRevele,
        scores          : store.getScores(partieId) || {},
    };
}

export function detruireSession(partieId) {
    sessions.delete(partieId);
    console.log(`[MIMEDESSSINE] 🗑️ Session détruite: ${partieId}`);
}

// ─────────────────────────────────────────────────────
// HOST ACTIONS
// ─────────────────────────────────────────────────────

export function handleHostAction(wss, ws, partieId, action, data, helpers) {
    const { broadcastToGame, sendToPseudo } = helpers;
    const cmd = action.split(':')[1];
    let s = _getSession(partieId);
    if (!s) s = _creerSession(partieId);

    switch (cmd) {
        case 'defi': {
            s.config = { ...s.config, ...data.config };
            s.motsDisponibles = data.motsDisponibles || [];
            s.phase = 'menu';
            s.manche = 0;
            s.motADeviner = null;
            s.drawerPseudo = null;
            s.dessinData = [];
            s.guesses = [];
            s.tsPhaseEnd = null;
            s.motADevinerRevele = false;

            broadcastToGame(wss, partieId, 'MIMEDESSSINE_DEFI', {
                config       : s.config,
                phase        : s.phase,
                manche       : s.manche,
                drawerPseudo : s.drawerPseudo,
                scores       : store.getScores(partieId) || {},
            });
            console.log(`[MIMEDESSSINE] 🎯 Défi configuré. Phase: ${s.phase}`);
            break;
        }

        case 'choix_mot': {
            if (s.phase !== 'menu' && s.phase !== 'resultats') break; // Only allow choosing word from menu or after results
            s.manche++;
            s.motADeviner = data.mot;
            s.drawerPseudo = data.drawerPseudo;
            s.dessinData = [];
            s.guesses = [];
            s.tsPhaseEnd = null;
            s.motADevinerRevele = false;
            s.phase = 'choix_mot'; // Host has chosen, now waiting for host to start drawing

            // Send the word to the drawer only
            if (s.drawerPseudo) {
                sendToPseudo(wss, partieId, s.drawerPseudo, 'MIMEDESSSINE_MOT_A_DEVINER', { mot: s.motADeviner });
            }

            broadcastToGame(wss, partieId, 'MIMEDESSSINE_DEFI', {
                config       : s.config,
                phase        : s.phase,
                manche       : s.manche,
                drawerPseudo : s.drawerPseudo,
                scores       : store.getScores(partieId) || {},
            });
            console.log(`[MIMEDESSSINE] ✍️ Mot choisi: "${s.motADeviner}" par ${s.drawerPseudo}. Phase: ${s.phase}`);
            break;
        }

        case 'start_dessin': {
            if (s.phase !== 'choix_mot') break;
            s.phase = 'dessin';
            s.tsPhaseEnd = Date.now() + s.config.tempsDessin;
            broadcastToGame(wss, partieId, 'MIMEDESSSINE_PHASE', {
                phase: s.phase,
                manche: s.manche,
                tsPhaseEnd: s.tsPhaseEnd,
                motADevinerRevele: s.motADevinerRevele,
            });
            console.log(`[MIMEDESSSINE] ▶️ Début du dessin. Fin dans ${s.config.tempsDessin / 1000}s. Phase: ${s.phase}`);
            break;
        }

        case 'reveler_mot': {
            if (s.phase !== 'dessin' && s.phase !== 'reponse') break;
            s.motADevinerRevele = true;
            s.phase = 'reponse'; // Transition to reponse phase if not already there
            s.tsPhaseEnd = Date.now() + s.config.tempsReponse; // Give a short time to see the word
            broadcastToGame(wss, partieId, 'MIMEDESSSINE_PHASE', {
                phase: s.phase,
                manche: s.manche,
                tsPhaseEnd: s.tsPhaseEnd,
                motADevinerRevele: s.motADevinerRevele,
                motADeviner: s.motADeviner, // Reveal the word to everyone
            });
            console.log(`[MIMEDESSSINE] 💡 Mot révélé par l'hôte: "${s.motADeviner}". Phase: ${s.phase}`);
            break;
        }

        case 'force_resultats': {
            if (s.phase === 'resultats') break;
            s.phase = 'resultats';
            s.tsPhaseEnd = null;
            broadcastToGame(wss, partieId, 'MIMEDESSSINE_PHASE', {
                phase: s.phase,
                manche: s.manche,
                tsPhaseEnd: s.tsPhaseEnd,
                motADevinerRevele: s.motADevinerRevele,
                motADeviner: s.motADeviner,
            });
            console.log(`[MIMEDESSSINE] 🏁 Résultats forcés par l'hôte. Phase: ${s.phase}`);
            break;
        }

        default:
            console.warn(`[MIMEDESSSINE] ⚠️ Action host inconnue: ${cmd}`);
    }
}

// ─────────────────────────────────────────────────────
// PLAYER ACTIONS
// ─────────────────────────────────────────────────────

export function handlePlayerAction(wss, ws, partieId, pseudo, action, data, helpers) {
    const { broadcastToGame, send, broadcastToHost, sendToAllExcept } = helpers;
    const cmd = action.split(':')[1];
    const s = _getSession(partieId);
    if (!s) {
        send(ws, 'MIMEDESSSINE_GUESS_ACK', { status: 'too_late' });
        return;
    }

    switch (cmd) {
        case 'drawing_update': {
            if (s.phase !== 'dessin' || pseudo !== s.drawerPseudo) {
                // Only the drawer can send drawing updates during the drawing phase
                return;
            }
            s.dessinData = data.data; // Store the latest drawing data
            sendToAllExcept(wss, partieId, pseudo, 'MIMEDESSSINE_DRAWING_DATA', { data: s.dessinData });
            break;
        }

        case 'guess': {
            if (s.phase !== 'dessin' && s.phase !== 'reponse') {
                send(ws, 'MIMEDESSSINE_GUESS_ACK', { status: 'too_late' });
                return;
            }
            if (pseudo === s.drawerPseudo) {
                send(ws, 'MIMEDESSSINE_GUESS_ACK', { status: 'invalid' }); // Drawer cannot guess
                return;
            }

            const guess = String(data.guess || '').trim().toLowerCase();
            if (!guess) {
                send(ws, 'MIMEDESSSINE_GUESS_ACK', { status: 'invalid' });
                return;
            }

            // Check if already guessed correctly
            const alreadyGuessedCorrectly = s.guesses.some(g => g.pseudo === pseudo && g.correct);
            if (alreadyGuessedCorrectly) {
                send(ws, 'MIMEDESSSINE_GUESS_ACK', { status: 'already' });
                return;
            }

            const motADevinerLower = String(s.motADeviner || '').trim().toLowerCase();
            const correct = (guess === motADevinerLower);

            const scoreGuesseur = correct ? s.config.scoreGuesseur : 0;
            const scoreDessinateur = correct ? s.config.scoreDessinateur : 0;

            s.guesses.push({ pseudo, guess, correct, ts: Date.now() });

            if (correct) {
                store.modifierScore(partieId, pseudo, scoreGuesseur);
                if (s.drawerPseudo) {
                    store.modifierScore(partieId, s.drawerPseudo, scoreDessinateur);
                }
            }

            const partie = store.getPartie(partieId);
            const nbJoueurs = (partie?.joueurs || []).length;
            const nbGuessers = nbJoueurs - (s.drawerPseudo ? 1 : 0);
            const nbCorrectGuesses = s.guesses.filter(g => g.correct).length;
            const allGuessed = nbGuessers > 0 && nbCorrectGuesses >= nbGuessers;

            send(ws, 'MIMEDESSSINE_GUESS_ACK', { status: correct ? 'correct' : 'incorrect' });

            broadcastToHost(wss, partieId, 'MIMEDESSSINE_GUESS_IN', {
                pseudo, guess, correct, scoreGuesseur, scoreDessinateur, allGuessed,
            });
            broadcastToGame(wss, partieId, 'SCORES_UPDATE', { scores: store.getScores(partieId) || {} });

            if (allGuessed) {
                s.phase = 'reponse'; // Transition to reponse phase
                s.tsPhaseEnd = Date.now() + s.config.tempsReponse; // Give a short time to see the word
                s.motADevinerRevele = true;
                broadcastToGame(wss, partieId, 'MIMEDESSSINE_PHASE', {
                    phase: s.phase,
                    manche: s.manche,
                    tsPhaseEnd: s.tsPhaseEnd,
                    motADevinerRevele: s.motADevinerRevele,
                    motADeviner: s.motADeviner,
                });
                console.log(`[MIMEDESSSINE] 🎉 Tous ont deviné ! Mot: "${s.motADeviner}". Phase: ${s.phase}`);
            }

            console.log(`[MIMEDESSSINE] 💬 ${pseudo} a deviné "${guess}" (${correct ? 'correct' : 'incorrect'})`);
            break;
        }

        default:
            console.warn(`[MIMEDESSSINE] ⚠️ Action joueur inconnue: ${cmd}`);
    }
}
