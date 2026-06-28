// ======================================================
// 🎮 server/games/petitbac.js — v2.2 (validation async Wikidata)
// ======================================================
// Évolution vs v2.1 :
//   ✅ _estValideAsync : pour celebrite/personnage sans fichier statique,
//      délègue à wikidata-validator.js (live API + cache TTL 24h).
//   ✅ _evaluerMancheAsync : Promise.all sur toutes les validations
//      → latence = max(validations) et non somme.
//   ✅ _declencherRevelation devient async, attend l'évaluation.
//   ✅ Dégradation gracieuse inchangée : si Wikidata injoignable → valid=true.
//   Inchangé : barème unicité 2/1/0, scoring à la révélation,
//   payload REVELATION, scoreboard global, gestion timers.
// ======================================================

import store from '../store.js';
import { motExisteDans, dictionnairePret } from './dictionnaires.js';

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

// Catégorie → dico logique (cf dictionnaires.js).
// Catégorie ABSENTE = validée « lettre seule » (prenom).
const CAT_DICO = {
    animal     : 'general',
    fruit      : 'general',
    metier     : 'general',
    objet      : 'general',
    pays       : 'pays',
    ville      : 'ville',
    marque     : 'marque',
    personnage : 'personnage',
    celebrite  : 'celebrite',
};

// Catégories qui peuvent basculer sur Wikidata live si pas de fichier statique
const CAT_WIKIDATA = new Set(['celebrite', 'personnage']);

const LETTRES  = 'ABCDEFGHIJKLMNOPRSTUVW'.split('');
const DUREE_MS = 120_000;

// ─────────────────────────────────────────────────────
// Chargement paresseux du validateur Wikidata
// (import dynamique pour éviter de bloquer le démarrage
//  si wikidata-validator.js est absent)
// ─────────────────────────────────────────────────────

let _validerWikidata = null;

async function _getWikidataValidator() {
    if (_validerWikidata) return _validerWikidata;
    try {
        const m = await import('./wikidata-validator.js');
        _validerWikidata = m.validerWikidata;
        console.log('[PETITBAC] ✅ wikidata-validator chargé');
    } catch (e) {
        // Module absent → dégradation gracieuse permanente
        console.warn('[PETITBAC] ⚠️ wikidata-validator indisponible — catégories dynamiques tolérées');
        _validerWikidata = async () => ({ valid: true, reason: 'validator absent' });
    }
    return _validerWikidata;
}

// ─────────────────────────────────────────────────────
// Gestion des sessions
// ─────────────────────────────────────────────────────

function _getSession(partieId) { return sessions.get(partieId) || null; }

function _creerSession(partieId) {
    const s = {
        phase             : 'idle',
        lettre            : null,
        manche            : 0,
        tsDebut           : null,
        reponses          : {},
        dernierResultat   : [],
        timerHandle       : null,
        timerReveal       : null,
        revelationEnCours : false,
        lettresJouees     : new Set(),
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
    const pool  = dispo.length ? dispo : LETTRES;
    const l     = pool[Math.floor(Math.random() * pool.length)];
    s.lettresJouees.add(l);
    return l;
}

// ─────────────────────────────────────────────────────
// Validation / normalisation
// ─────────────────────────────────────────────────────

function _normCmp(v) {
    return String(v || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[''\s-]/g, '')
        .trim();
}

function _premiereLettre(v) {
    return String(v || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .charAt(0).toUpperCase();
}

/**
 * Validation async d'une réponse pour une catégorie.
 *
 * Priorité :
 *   1. Dico statique (.txt / .bloom) présent → O(1), sync
 *   2. Catégorie dynamique (celebrite / personnage) → Wikidata live
 *   3. Pas de dico et pas dynamique → lettre seule (prenom, dégradation)
 */
async function _estValideAsync(catId, val, lettre) {
    const v = String(val || '').trim();
    if (!v) return false;
    if (_premiereLettre(v) !== lettre) return false;

    const dico = CAT_DICO[catId];
    if (!dico) return true; // prenom → lettre seule

    // Dico statique disponible → rapide, prioritaire
    if (dictionnairePret(dico)) {
        return motExisteDans(dico, v);
    }

    // Catégorie dynamique sans fichier → Wikidata live
    if (CAT_WIKIDATA.has(catId)) {
        try {
            const validate = await _getWikidataValidator();
            const r = await validate(catId, v, lettre);
            return r.valid;
        } catch (e) {
            console.warn(`[PETITBAC] ⚠️ Wikidata erreur pour "${v}" (${catId}):`, e.message);
            return true; // dégradation gracieuse
        }
    }

    // Dico absent, catégorie non dynamique → toléré
    return true;
}

// ─────────────────────────────────────────────────────
// Évaluation de la manche (scoring unicité) — async
// ─────────────────────────────────────────────────────

async function _evaluerMancheAsync(s) {
    const pseudos = Object.keys(s.reponses)
        .filter(p => p && p !== 'null' && p !== 'undefined');

    // Pré-calculer toutes les validations en parallèle
    // Structure : validations[pseudo][catIndex] = Promise<bool>
    const validations = {};
    for (const p of pseudos) {
        const rep = s.reponses[p].reponses || {};
        validations[p] = await Promise.all(
            CATEGORIES.map(cat => _estValideAsync(cat.id, String(rep[cat.id] || '').trim(), s.lettre))
        );
    }

    // Compter les occurrences des réponses valides (unicité)
    const compte = {}; // catId → Map(normCmp → count)
    for (const cat of CATEGORIES) compte[cat.id] = new Map();

    for (const p of pseudos) {
        const rep = s.reponses[p].reponses || {};
        CATEGORIES.forEach((cat, i) => {
            if (validations[p][i]) {
                const key = _normCmp(String(rep[cat.id] || '').trim());
                compte[cat.id].set(key, (compte[cat.id].get(key) || 0) + 1);
            }
        });
    }

    // Calculer les scores
    const resultats = [];
    for (const p of pseudos) {
        const rep     = s.reponses[p].reponses || {};
        const details = {};
        let   score   = 0;

        CATEGORIES.forEach((cat, i) => {
            const v      = String(rep[cat.id] || '').trim();
            const estOk  = validations[p][i];
            let statut, points;

            if (!v) {
                statut = 'vide';     points = 0;
            } else if (!estOk) {
                statut = 'invalide'; points = 0;
            } else {
                const n = compte[cat.id].get(_normCmp(v)) || 1;
                if (n > 1) { statut = 'double'; points = 1; }
                else       { statut = 'unique'; points = 2; }
            }

            details[cat.id] = { val: v, statut, points };
            score += points;
        });

        resultats.push({ pseudo: p, score, details, ts: s.reponses[p].ts || 0 });
    }

    resultats.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    return resultats;
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
            reponses   : s.dernierResultat,
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
            s.dernierResultat   = [];
            s.revelationEnCours = false;

            broadcastToGame(wss, partieId, 'PETITBAC_MANCHE_START', {
                lettre     : s.lettre,
                categories : CATEGORIES,
                tsDebut    : s.tsDebut,
                dureeMs    : DUREE_MS,
                manche     : s.manche,
                scores     : store.getScores(partieId) || {},
            });

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
            s.reponses[pseudo] = { reponses: data.reponses || {}, ts: Date.now() };

            send(ws, 'PETITBAC_ANSWER_ACK', { status: 'ok' });

            const nbJoueurs  = (partie?.joueurs || []).length;
            const nbReponses = Object.keys(s.reponses).length;
            broadcastToHost(wss, partieId, 'PETITBAC_RESPONSE_IN', {
                pseudo, nbReponses, nbJoueurs,
                allAnswered: nbReponses >= nbJoueurs,
            });
            console.log(`[PETITBAC] 🎮 Réponses hôte ${pseudo} reçues`);
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
            s.reponses[pseudo] = { reponses: data.reponses || {}, ts: Date.now() };

            send(ws, 'PETITBAC_ANSWER_ACK', { status: 'ok' });

            const partie     = store.getPartie(partieId);
            const nbJoueurs  = (partie?.joueurs || []).length;
            const nbReponses = Object.keys(s.reponses).length;
            broadcastToHost(wss, partieId, 'PETITBAC_RESPONSE_IN', {
                pseudo, nbReponses, nbJoueurs,
                allAnswered: nbReponses >= nbJoueurs,
            });
            console.log(`[PETITBAC] 🎮 Réponses ${pseudo} reçues`);
            break;
        }

        default:
            console.warn(`[PETITBAC] ⚠️ Action joueur inconnue: ${cmd}`);
    }
}

// ─────────────────────────────────────────────────────
// Révélation (async — attend l'évaluation complète)
// ─────────────────────────────────────────────────────

function _declencherRevelation(wss, partieId, s, helpers, source) {
    if (s.revelationEnCours) return;
    s.revelationEnCours = true;
    _annulerTimers(s);

    const { broadcastToGame, broadcastToHost } = helpers;

    // Évaluation async — les broadcasts se font à la résolution
    _evaluerMancheAsync(s).then(liste => {
        s.dernierResultat = liste;

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
    }).catch(err => {
        console.error(`[PETITBAC] ❌ Erreur évaluation manche ${s.manche}:`, err);
        // Remettre revelationEnCours à false pour permettre une nouvelle tentative
        s.revelationEnCours = false;
    });
}