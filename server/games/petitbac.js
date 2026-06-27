// ======================================================
// 🎮 server/games/petitbac.js — v2.2 (async Wikidata)
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

const LETTRES   = 'ABCDEFGHIJKLMNOPRSTUVWXYZ'.split('');
const DUREE_MS  = 120_000;

// ─────────────────────────────────────────────────────
// Chargeur dynamique du validateur Wikidata
// ─────────────────────────────────────────────────────

let _validerWikidata = null;

async function _getWikidataValidator() {
    if (!_validerWikidata) {
        const m = await import('./wikidata-validator.js');
        _validerWikidata = m.validerWikidata;
    }
    return _validerWikidata;
}

// ─────────────────────────────────────────────────────
// Sessions
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
// Normalisation
// ─────────────────────────────────────────────────────

function _normCmp(v) {
    return String(v || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/['’\s-]/g, '')
        .trim();
}

function _premiereLettre(v) {
    return String(v || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .charAt(0).toUpperCase();
}

// ─────────────────────────────────────────────────────
// Nouvelle version ASYNC de _estValide
// ─────────────────────────────────────────────────────

async function _estValideAsync(catId, val, lettre) {
    const v = String(val || '').trim();
    if (!v) return false;
    if (_premiereLettre(v) !== lettre) return false;

    const dico = CAT_DICO[catId];

    // Catégorie sans dico → lettre seule
    if (!dico) return true;

    // Dictionnaire statique prêt → O(1)
    if (dictionnairePret(dico)) {
        return motExisteDans(dico, v);
    }

    // Catégories dynamiques → Wikidata
    if (catId === 'celebrite' || catId === 'personnage') {
        const validate = await _getWikidataValidator();
        const r = await validate(catId, v, lettre);
        return r.valid;
    }

    // Dégradation gracieuse
    return true;
}

// ─────────────────────────────────────────────────────
// Nouvelle version ASYNC de _evaluerManche
// ─────────────────────────────────────────────────────

async function _evaluerManche(s) {
    const pseudos = Object.keys(s.reponses)
        .filter(p => p && p !== 'null' && p !== 'undefined');

    const compte = {};
    const valide = {};
    for (const cat of CATEGORIES) compte[cat.id] = new Map();

    // Lancer toutes les validations en parallèle
    for (const p of pseudos) {
        valide[p] = {};
        const rep = s.reponses[p].reponses || {};

        const validations = await Promise.all(
            CATEGORIES.map(cat =>
                _estValideAsync(cat.id, rep[cat.id] || '', s.lettre)
            )
        );

        CATEGORIES.forEach((cat, i) => {
            const ok = validations[i];
            valide[p][cat.id] = ok;
            if (ok) {
                const key = _normCmp(rep[cat.id] || '');
                compte[cat.id].set(key, (compte[cat.id].get(key) || 0) + 1);
            }
        });
    }

    const resultats = [];
    for (const p of pseudos) {
        const rep     = s.reponses[p].reponses || {};
        const details = {};
        let   score   = 0;

        for (const cat of CATEGORIES) {
            const v = String(rep[cat.id] || '').trim();
            let statut, points;

            if (!v) {
                statut = 'vide';     points = 0;
            } else if (!valide[p][cat.id]) {
                statut = 'invalide'; points = 0;
            } else {
                const n = compte[cat.id].get(_normCmp(v)) || 1;
                if (n > 1) { statut = 'double'; points = 1; }
                else       { statut = 'unique'; points = 2; }
            }

            details[cat.id] = { val: v, statut, points };
            score += points;
        }

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
    console.log(`[PETITBAC] Session détruite: ${partieId}`);
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

            console.log(`[PETITBAC] Manche ${s.manche} — lettre: ${s.lettre}`);
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
            console.log(`[PETITBAC] Réponses hôte ${pseudo} reçues`);
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
            console.warn(`[PETITBAC] Action host inconnue: ${cmd}`);
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
                console.warn('[PETITBAC] petitbac:answer — pseudo null rejeté');
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
            console.log(`[PETITBAC] Réponses ${pseudo} reçues`);
            break;
        }

        default:
            console.warn(`[PETITBAC] Action joueur inconnue: ${cmd}`);
    }
}

// ─────────────────────────────────────────────────────
// Révélation
// ─────────────────────────────────────────────────────

async function _declencherRevelation(wss, partieId, s, helpers, source) {
    if (s.revelationEnCours) return;
    s.revelationEnCours = true;
    _annulerTimers(s);

    const { broadcastToGame, broadcastToHost } = helpers;

    const liste = await _evaluerManche(s);
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

    console.log(`[PETITBAC] Révélation manche ${s.manche} — source: ${source}`);
}
