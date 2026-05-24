// ======================================================
// 🎮 server/games/petitbac.js — v1.0 (P5.1)
// ======================================================
// Migration du Petit Bac en WS-server-driven (calqué sur quiz.js).
//
// Mécanique :
//   - L'hôte demande "load" → serveur tire une lettre, broadcast la manche.
//   - Joueurs (hôte + invités) soumettent leurs réponses pendant 120 s.
//   - Timer expire OU tous soumis → l'hôte peut révéler.
//   - Scoring : +1 pt par réponse non vide commençant par la lettre.
//   - "next_manche" : nouvelle lettre, on recommence.
//
// Actions hôte (HOST_ACTION) :
//   petitbac:load          → démarre une session, tire la 1re lettre.
//   petitbac:host_answer   → soumet les réponses de l'hôte (data.reponses, data.score?).
//   petitbac:reveal        → force la révélation (avant fin du timer).
//   petitbac:next_manche   → relance avec une nouvelle lettre.
//
// Action joueur (PLAYER_ACTION) :
//   petitbac:answer        → soumet ses réponses (data.reponses).
//
// Events serveur → clients :
//   PETITBAC_MANCHE_START  { lettre, categories, tsDebut, dureeMs, manche, scores }
//   PETITBAC_RESPONSE_IN   { pseudo, nbReponses, nbJoueurs, allAnswered }  (host)
//   PETITBAC_TIMER_EXPIRED { nbReponses, nbJoueurs }                       (host)
//   PETITBAC_REVELATION    { lettre, categories, reponses[], scores, manche }
//   PETITBAC_CAN_NEXT      { manche }                                       (host)
//   PETITBAC_ANSWER_ACK    { status: 'ok'|'already'|'too_late'|'invalid' }
// ======================================================

import store from '../store.js';

const sessions = new Map();

const CATEGORIES = [
    { id: 'prenom',     label: 'Prénom',            icon: '👤' },
    { id: 'ville',      label: 'Ville',             icon: '🏙️' },
    { id: 'pays',       label: 'Pays',              icon: '🌍' },
    { id: 'animal',     label: 'Animal',            icon: '🐾' },
    { id: 'fruit',      label: 'Fruit / Légume',    icon: '🍎' },
    { id: 'metier',     label: 'Métier',            icon: '💼' },
    { id: 'objet',      label: 'Objet',             icon: '📦' },
    { id: 'marque',     label: 'Marque',            icon: '🏷️' },
    { id: 'personnage', label: 'Personnage fictif', icon: '🧚' },
    { id: 'celebrite',  label: 'Célébrité',         icon: '🌟' },
];

const LETTRES   = 'ABCDEFGHIJKLMNOPRSTUVW'.split('');
const DUREE_MS  = 120_000;

function _getSession(partieId) { return sessions.get(partieId) || null; }

function _creerSession(partieId) {
    const s = {
        phase             : 'idle',
        lettre            : null,
        manche            : 0,
        tsDebut           : null,
        reponses          : {},        // { pseudo: { reponses: {cat:val,…}, score, ts } }
        timerHandle       : null,
        timerReveal       : null,
        revelationEnCours : false,
        lettresJouees     : new Set(), // pour éviter de retomber sur la même lettre
    };
    sessions.set(partieId, s);
    return s;
}

function _annulerTimers(s) {
    if (s.timerHandle) { clearTimeout(s.timerHandle); s.timerHandle = null; }
    if (s.timerReveal) { clearTimeout(s.timerReveal); s.timerReveal = null; }
}

function _tirerLettre(s) {
    const dispo = LETTRES.filter(l => !s.lettresJouees.has(l));
    const pool  = dispo.length ? dispo : LETTRES; // recycle si toutes jouées
    const l     = pool[Math.floor(Math.random() * pool.length)];
    s.lettresJouees.add(l);
    return l;
}

function _scorer(reponses, lettre) {
    if (!reponses || typeof reponses !== 'object') return { score: 0, valides: {} };
    let score = 0;
    const valides = {};
    for (const cat of CATEGORIES) {
        const val = String(reponses[cat.id] || '').trim();
        const ok  = val.length > 0 && val.charAt(0).toUpperCase() === lettre;
        valides[cat.id] = ok;
        if (ok) score++;
    }
    return { score, valides };
}

// ─────────────────────────────────────────────────────
// API publique
// ─────────────────────────────────────────────────────

export function getSessionState(partieId) {
    const s = _getSession(partieId);
    if (!s) return null;
    const base = { phase: s.phase, manche: s.manche };
    if (s.phase === 'jeu') {
        return {
            ...base,
            lettre     : s.lettre,
            categories : CATEGORIES,
            tsDebut    : s.tsDebut,
            dureeMs    : DUREE_MS,
            nbReponses : Object.keys(s.reponses).length,
        };
    }
    if (s.phase === 'resultats') {
        return {
            ...base,
            lettre     : s.lettre,
            categories : CATEGORIES,
            reponses   : _payloadRevelation(s),
            scores     : store.getScores(partieId) || {},
        };
    }
    return base;
}

export function detruireSession(partieId) {
    const s = _getSession(partieId);
    if (s) _annulerTimers(s);
    sessions.delete(partieId);
    console.log(`[PETITBAC] 🗑️ Session détruite: ${partieId}`);
}

// ─────────────────────────────────────────────────────
// HOST ACTIONS
// ─────────────────────────────────────────────────────

export function handleHostAction(wss, ws, partieId, action, data, helpers) {
    const { broadcastToGame, broadcastToHost, send } = helpers;
    const cmd = action.split(':')[1];

    switch (cmd) {

        case 'load':
        case 'next_manche': {
            let s = _getSession(partieId);
            if (!s) s = _creerSession(partieId);
            _annulerTimers(s);

            s.manche++;
            s.phase             = 'jeu';
            s.lettre            = _tirerLettre(s);
            s.tsDebut           = Date.now();
            s.reponses          = {};
            s.revelationEnCours = false;

            broadcastToGame(wss, partieId, 'PETITBAC_MANCHE_START', {
                lettre     : s.lettre,
                categories : CATEGORIES,
                tsDebut    : s.tsDebut,
                dureeMs    : DUREE_MS,
                manche     : s.manche,
                scores     : store.getScores(partieId) || {},
            });

            // Timer serveur : notifie l'hôte à expiration, laisse 5s puis
            // déclenche la révélation auto si non faite.
            s.timerHandle = setTimeout(() => {
                if (s.phase !== 'jeu') return;
                const nbJoueurs = (store.getPartie(partieId)?.joueurs || []).length;
                broadcastToHost(wss, partieId, 'PETITBAC_TIMER_EXPIRED', {
                    nbReponses : Object.keys(s.reponses).length,
                    nbJoueurs,
                });
                s.timerReveal = setTimeout(() => {
                    if (s.phase === 'jeu' && !s.revelationEnCours) {
                        _declencherRevelation(wss, partieId, s, helpers, 'timer');
                    }
                }, 5000);
            }, DUREE_MS);

            console.log(`[PETITBAC] 🎲 Manche ${s.manche} — lettre: ${s.lettre}`);
            break;
        }

        case 'host_answer': {
            const s = _getSession(partieId);
            if (!s || s.phase !== 'jeu') {
                return send(ws, 'PETITBAC_ANSWER_ACK', { status: 'too_late' });
            }
            const partie = store.getPartie(partieId);
            const pseudo = (data.pseudo && String(data.pseudo).trim()) || partie?.hostPseudo || null;
            if (!pseudo) {
                return send(ws, 'PETITBAC_ANSWER_ACK', { status: 'invalid' });
            }
            if (s.reponses[pseudo] !== undefined) {
                return send(ws, 'PETITBAC_ANSWER_ACK', { status: 'already' });
            }
            const reponses = data.reponses || {};
            const { score } = _scorer(reponses, s.lettre);
            s.reponses[pseudo] = { reponses, score, ts: Date.now() };

            send(ws, 'PETITBAC_ANSWER_ACK', { status: 'ok' });

            const nbJoueurs  = (partie?.joueurs || []).length;
            const nbReponses = Object.keys(s.reponses).length;
            broadcastToHost(wss, partieId, 'PETITBAC_RESPONSE_IN', {
                pseudo, nbReponses, nbJoueurs,
                allAnswered: nbReponses >= nbJoueurs,
            });
            console.log(`[PETITBAC] 🎮 Réponses hôte ${pseudo}: score=${score}`);
            break;
        }

        case 'reveal': {
            const s = _getSession(partieId);
            if (!s || s.phase !== 'jeu') {
                return send(ws, 'ERROR', { code: 'PETITBAC_BAD_STATE', message: 'Pas de manche en cours.' });
            }
            _declencherRevelation(wss, partieId, s, helpers, 'host');
            break;
        }

        default:
            console.warn(`[PETITBAC] ⚠️ Action host inconnue: ${cmd}`);
    }
}

// ─────────────────────────────────────────────────────
// PLAYER ACTIONS
// ─────────────────────────────────────────────────────

export function handlePlayerAction(wss, ws, partieId, pseudo, action, data, helpers) {
    const { broadcastToHost, send } = helpers;
    const cmd = action.split(':')[1];

    switch (cmd) {
        case 'answer': {
            const s = _getSession(partieId);
            if (!s || s.phase !== 'jeu') {
                return send(ws, 'PETITBAC_ANSWER_ACK', { status: 'too_late' });
            }
            if (!pseudo || pseudo === 'null' || pseudo === 'undefined') {
                console.warn('[PETITBAC] ⚠️ petitbac:answer — pseudo null rejeté');
                return send(ws, 'PETITBAC_ANSWER_ACK', { status: 'invalid' });
            }
            if (s.reponses[pseudo] !== undefined) {
                return send(ws, 'PETITBAC_ANSWER_ACK', { status: 'already' });
            }
            const reponses = data.reponses || {};
            const { score } = _scorer(reponses, s.lettre);
            s.reponses[pseudo] = { reponses, score, ts: Date.now() };

            send(ws, 'PETITBAC_ANSWER_ACK', { status: 'ok' });

            const partie     = store.getPartie(partieId);
            const nbJoueurs  = (partie?.joueurs || []).length;
            const nbReponses = Object.keys(s.reponses).length;
            broadcastToHost(wss, partieId, 'PETITBAC_RESPONSE_IN', {
                pseudo, nbReponses, nbJoueurs,
                allAnswered: nbReponses >= nbJoueurs,
            });
            console.log(`[PETITBAC] 🎮 Réponses ${pseudo}: score=${score}`);
            break;
        }

        default:
            console.warn(`[PETITBAC] ⚠️ Action joueur inconnue: ${cmd}`);
    }
}

// ─────────────────────────────────────────────────────
// Révélation
// ─────────────────────────────────────────────────────

function _payloadRevelation(s) {
    return Object.entries(s.reponses)
        .filter(([p]) => p && p !== 'null' && p !== 'undefined')
        .sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0))
        .map(([pseudo, data]) => ({
            pseudo,
            reponses: data.reponses || {},
            score   : data.score    || 0,
        }));
}

function _declencherRevelation(wss, partieId, s, helpers, source) {
    if (s.revelationEnCours) return;
    s.revelationEnCours = true;
    _annulerTimers(s);

    const { broadcastToGame, broadcastToHost } = helpers;
    const liste = _payloadRevelation(s);

    // Créditer les scores (1 pt par catégorie correcte)
    liste.forEach(r => {
        if (r.score > 0) store.modifierScore(partieId, r.pseudo, r.score);
    });

    s.phase = 'resultats';
    const scores = store.getScores(partieId) || {};

    broadcastToGame(wss, partieId, 'PETITBAC_REVELATION', {
        lettre     : s.lettre,
        categories : CATEGORIES,
        reponses   : liste,
        scores,
        manche     : s.manche,
    });
    broadcastToGame(wss, partieId, 'SCORES_UPDATE', { scores });
    broadcastToHost(wss, partieId, 'PETITBAC_CAN_NEXT', { manche: s.manche });

    console.log(`[PETITBAC] 🎯 Révélation manche ${s.manche} — source: ${source}`);
}
