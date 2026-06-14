// ======================================================
// 🎭 server/games/mimedessine.js — v2.1 (WS, tours invités — hôte observateur)
// ======================================================
// Source de vérité = serveur. Modèle :
//   - Liste ordonnée de participants (hôte d'abord, puis invités).
//   - Chacun joue une manche à son tour : un thème + un mot s'affichent
//     sur l'écran du participant ACTIF (qui mime) ; les autres devinent à
//     voix haute. Boutons Trouvé / Passer / Finir la manche.
//   - "Participant suivant" passe au joueur suivant ; même dispositif
//     répliqué sur l'écran de l'invité devenu actif.
//   - Le serveur tire les mots (anti-répétition de catégorie), fait
//     autorité sur les scores (store) et le minuteur (tsTourEnd).
//
// Phases : menu → accueil → tour → fin_manche → classement
//
// Actions hôte (HOST_ACTION) :
//   mimedessine:config     { participants[], motsParCategorie{cat:[mots]}, duree? }
//   mimedessine:commencer  {}                  (démarre la manche du participant courant)
//   mimedessine:trouve     {}                  (si l'hôte est le participant actif)
//   mimedessine:passer     {}                  (idem)
//   mimedessine:fin_manche {}                  (hôte : termine/force la manche)
//   mimedessine:suivant    {}                  (participant suivant)
//   mimedessine:classement {}
//   mimedessine:rejouer    {}
//
// Action joueur (PLAYER_ACTION) — uniquement le participant ACTIF :
//   mimedessine:trouve {} | mimedessine:passer {} | mimedessine:fin_manche {}
//
// Events serveur → clients :
//   MIMEDESSSINE_PHASE        { phase, manche, participant, index, nbParticipants,
//                               categorie, scores, scoreManche, motsManche, tsTourEnd, duree } (all, mot masqué)
//   MIMEDESSSINE_MOT_A_DEVINER{ mot, categorie }     (participant actif + hôte)
//   SCORES_UPDATE             { scores }              (all)
// ======================================================

import store from '../store.js';

const sessions = new Map();
const DUREE_DEFAUT = 180000;

function _get(partieId) { return sessions.get(partieId) || null; }

function _creer(partieId) {
    const s = {
        phase: 'menu', manche: 0,
        participants: [], index: 0, participant: null,
        motsParCategorie: {}, categories: [],
        derniereCategorie: null, categorie: null, mot: null,
        motsManche: [], scoreManche: {},
        duree: DUREE_DEFAUT, tsTourEnd: null, _timer: null,
    };
    sessions.set(partieId, s);
    return s;
}

function _clearTimer(s) { if (s._timer) { clearTimeout(s._timer); s._timer = null; } }

function _nouveauMot(s) {
    const cats = s.categories.filter(c => c !== s.derniereCategorie);
    const pool = cats.length ? cats : s.categories;
    const cat  = pool[Math.floor(Math.random() * pool.length)] || null;
    const mots = (cat && s.motsParCategorie[cat]) ? s.motsParCategorie[cat] : [];
    const mot  = mots.length ? mots[Math.floor(Math.random() * mots.length)] : null;
    s.categorie = cat;
    s.mot = mot;
    s.derniereCategorie = cat;
    s.motsManche.push({ mot, categorie: cat, trouve: false });
}

function _payloadPhase(partieId, s) {
    return {
        phase: s.phase, manche: s.manche,
        participant: s.participant, index: s.index,
        nbParticipants: s.participants.length,
        categorie: (s.phase === 'tour') ? s.categorie : null,
        scores: store.getScores(partieId) || {},
        scoreManche: { ...s.scoreManche },
        motsManche: (s.phase === 'fin_manche') ? s.motsManche : [],
        tsTourEnd: s.tsTourEnd,
        duree: s.duree,
    };
}

function _diffuser(wss, partieId, s, helpers) {
    const { broadcastToGame, broadcastToHost, sendToPseudo } = helpers;
    // État de tour (mot masqué) à tous
    broadcastToGame(wss, partieId, 'MIMEDESSSINE_PHASE', _payloadPhase(partieId, s));
    // Le mot au participant actif + à l'hôte (validation)
    if (s.phase === 'tour' && s.mot) {
        if (s.participant) sendToPseudo(wss, partieId, s.participant, 'MIMEDESSSINE_MOT_A_DEVINER', { mot: s.mot, categorie: s.categorie });
        broadcastToHost(wss, partieId, 'MIMEDESSSINE_MOT_A_DEVINER', { mot: s.mot, categorie: s.categorie });
    }
    broadcastToGame(wss, partieId, 'SCORES_UPDATE', { scores: store.getScores(partieId) || {} });
}

function _armerTimer(wss, partieId, s, helpers) {
    _clearTimer(s);
    if (!s.duree) return;
    s._timer = setTimeout(() => {
        const cur = _get(partieId);
        if (!cur || cur.phase !== 'tour') return;
        _finManche(wss, partieId, cur, helpers);
    }, s.duree);
}

// ─────────────────────────────────────────────────────
export function getSessionState(partieId) {
    const s = _get(partieId);
    if (!s) return null;
    return _payloadPhase(partieId, s); // mot non inclus (sécurité)
}

export function detruireSession(partieId) {
    const s = _get(partieId);
    if (s) _clearTimer(s);
    sessions.delete(partieId);
    console.log(`[MIMEDESSSINE] 🗑️ Session détruite: ${partieId}`);
}

// ─────────────────────────────────────────────────────
// HOST ACTIONS
// ─────────────────────────────────────────────────────
export function handleHostAction(wss, ws, partieId, action, data, helpers) {
    const cmd = action.split(':')[1];
    let s = _get(partieId);
    if (!s) s = _creer(partieId);

    switch (cmd) {
        case 'config': {
            _clearTimer(s);
            s.participants      = Array.isArray(data.participants) ? data.participants.filter(Boolean) : [];
            s.motsParCategorie  = data.motsParCategorie || {};
            s.categories        = Object.keys(s.motsParCategorie);
            s.duree             = data.duree || DUREE_DEFAUT;
            s.index             = 0;
            s.participant       = s.participants[0] || null;
            s.manche            = 1;
            s.derniereCategorie = null;
            s.categorie = null; s.mot = null;
            s.motsManche = []; s.scoreManche = {};
            s.participants.forEach(p => { s.scoreManche[p] = 0; });
            s.tsTourEnd = null;
            s.phase = 'accueil';
            _diffuser(wss, partieId, s, helpers);
            console.log(`[MIMEDESSSINE] ⚙️ config — ${s.participants.length} participant(s)`);
            break;
        }

        case 'commencer': _commencer(wss, partieId, s, helpers); break;

        case 'trouve':     _trouve(wss, partieId, s, helpers, s.participant); break;
        case 'passer':     _passer(wss, partieId, s, helpers); break;
        case 'fin_manche': _finManche(wss, partieId, s, helpers); break;

        case 'suivant': {
            _clearTimer(s);
            if (s.index < s.participants.length - 1) {
                s.index++;
                s.participant = s.participants[s.index];
                s.manche = s.index + 1;
                s.phase = 'accueil';
                s.derniereCategorie = null;
                s.categorie = null; s.mot = null;
                s.motsManche = [];
                s.tsTourEnd = null;
                _diffuser(wss, partieId, s, helpers);
                console.log(`[MIMEDESSSINE] ⏭️ participant suivant: ${s.participant}`);
            } else {
                _classement(wss, partieId, s, helpers);
            }
            break;
        }

        case 'classement': _classement(wss, partieId, s, helpers); break;

        case 'rejouer': {
            _clearTimer(s);
            s.index = 0; s.participant = s.participants[0] || null;
            s.manche = 1; s.phase = 'accueil';
            s.derniereCategorie = null; s.categorie = null; s.mot = null;
            s.motsManche = [];
            s.scoreManche = {}; s.participants.forEach(p => { s.scoreManche[p] = 0; });
            s.tsTourEnd = null;
            _diffuser(wss, partieId, s, helpers);
            break;
        }

        default: console.warn(`[MIMEDESSSINE] ⚠️ Action host inconnue: ${cmd}`);
    }
}

// ─────────────────────────────────────────────────────
// PLAYER ACTIONS (participant actif uniquement)
// ─────────────────────────────────────────────────────
export function handlePlayerAction(wss, ws, partieId, pseudo, action, data, helpers) {
    const cmd = action.split(':')[1];
    const s = _get(partieId);
    if (!s || pseudo !== s.participant) return;

    if (cmd === 'commencer') { _commencer(wss, partieId, s, helpers); return; }
    if (s.phase !== 'tour') return;

    switch (cmd) {
        case 'trouve':     _trouve(wss, partieId, s, helpers, pseudo); break;
        case 'passer':     _passer(wss, partieId, s, helpers); break;
        case 'fin_manche': _finManche(wss, partieId, s, helpers); break;
        default: console.warn(`[MIMEDESSSINE] ⚠️ Action joueur inconnue: ${cmd}`);
    }
}

// ─────────────────────────────────────────────────────
function _trouve(wss, partieId, s, helpers, mimeur) {
    if (s.phase !== 'tour') return;
    const last = s.motsManche[s.motsManche.length - 1];
    if (last) last.trouve = true;
    if (mimeur) {
        s.scoreManche[mimeur] = (s.scoreManche[mimeur] || 0) + 1;
        store.modifierScore(partieId, mimeur, 1);
    }
    _nouveauMot(s);
    _diffuser(wss, partieId, s, helpers);
}

function _passer(wss, partieId, s, helpers) {
    if (s.phase !== 'tour') return;
    _nouveauMot(s);
    _diffuser(wss, partieId, s, helpers);
}

function _commencer(wss, partieId, s, helpers) {
    if (s.phase !== 'accueil') return;
    s.phase = 'tour';
    s.motsManche = [];
    s.tsTourEnd = Date.now() + s.duree;
    _nouveauMot(s);
    _diffuser(wss, partieId, s, helpers);
    _armerTimer(wss, partieId, s, helpers);
    console.log(`[MIMEDESSSINE] ▶️ manche de ${s.participant}`);
}

function _finManche(wss, partieId, s, helpers) {
    _clearTimer(s);
    s.phase = 'fin_manche';
    s.tsTourEnd = null;
    s.mot = null; s.categorie = null;
    _diffuser(wss, partieId, s, helpers);
    console.log(`[MIMEDESSSINE] 🏁 fin de manche ${s.participant}`);
}

function _classement(wss, partieId, s, helpers) {
    _clearTimer(s);
    s.phase = 'classement';
    s.tsTourEnd = null; s.mot = null; s.categorie = null;
    _diffuser(wss, partieId, s, helpers);
    console.log('[MIMEDESSSINE] 🏆 classement final');
}