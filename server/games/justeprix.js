// ======================================================
// 🎮 server/games/justeprix.js — v1.1 (P5.4)
// ======================================================
// Migration de Juste Prix en WS-server-driven. Patron petitbac/pendu.
//
// Mécanique :
//   - Serveur tire un produit (mémorisation des produits déjà joués).
//   - Broadcast au client SANS le prix exact (uniquement fourchette).
//   - Joueurs (hôte + invités) estiment le prix en 60s.
//   - Révélation : serveur compare estimations au prix vrai, calcule
//     les points : 2pts ≤10% / 1pt ≤25% / +1 bonus au plus proche.
//   - Si personne dans la fourchette : 1pt consolation au moins loin.
//
// Actions hôte :
//   justeprix:load         → démarre, tire 1er produit
//   justeprix:host_answer  → estimation hôte (data.pseudo, data.estimation)
//   justeprix:reveal       → force la révélation
//   justeprix:next_produit → produit suivant
//
// Action joueur :
//   justeprix:answer       → estimation (data.estimation)
//
// Events serveur → clients :
//   JUSTEPRIX_PRODUIT_START { produit (sans prix), tsDebut, dureeMs, manche, scores }
//   JUSTEPRIX_RESPONSE_IN   { pseudo, nbReponses, nbJoueurs, allAnswered }  (host)
//   JUSTEPRIX_TIMER_EXPIRED { nbReponses, nbJoueurs }                       (host)
//   JUSTEPRIX_REVELATION    { produit (avec prix), prixNum, reponses[], scores, manche }
//   JUSTEPRIX_CAN_NEXT      { manche }                                       (host)
//   JUSTEPRIX_ANSWER_ACK    { status: 'ok'|'already'|'too_late'|'invalid' }
//
// v1.1 : la révélation est mémorisée dans s.derniereRevelation et
//        rejouée par getSessionState (phase 'resultats') → un invité
//        qui se reconnecte pendant la révélation reconstruit l'écran
//        de résultats à l'identique (parité LML / Petit Bac).
// ======================================================

import store from '../store.js';
import fs    from 'fs/promises';
import path  from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const sessions = new Map();

const DUREE_MS = 60_000;

// ─────────────────────────────────────────────────────
// Banque produits — chargement disque + cache
// ─────────────────────────────────────────────────────

const PRODUITS_PATH     = path.join(__dirname, '..', 'data', 'justeprix.json');
const PRODUITS_FALLBACK = '/data/justeprix.json';
let _produitsCache = null;

function _chargerProduits() {
    if (_produitsCache) return Promise.resolve(_produitsCache);

    const candidates = [PRODUITS_PATH];
    if (process.env.NODE_ENV === 'production') candidates.unshift(PRODUITS_FALLBACK);

    return (async () => {
        for (const p of candidates) {
            try {
                const raw    = await fs.readFile(p, 'utf-8');
                const propre = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
                const data   = JSON.parse(propre);
                if (!Array.isArray(data) || !data.length) continue;
                _produitsCache = data;
                console.log(`[JP] 📚 ${data.length} produit(s) chargé(s) depuis ${p}`);
                return data;
            } catch (err) {
                if (err.code !== 'ENOENT') console.warn(`[JP] ⚠️ ${p}:`, err.message);
            }
        }
        return null;
    })();
}

function _parsePrix(str) {
    return parseFloat(String(str || '').replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
}

// ─────────────────────────────────────────────────────
// Sessions
// ─────────────────────────────────────────────────────

function _getSession(partieId) { return sessions.get(partieId) || null; }

function _creerSession(partieId) {
    const s = {
        phase             : 'idle',
        produit           : null,
        prixNum           : 0,
        manche            : 0,
        tsDebut           : null,
        estimations       : {},        // { pseudo: { valeur:string, ts } }
        revelationEnCours : false,
        derniereRevelation: null,      // payload JUSTEPRIX_REVELATION mémorisé (rejoin)
        timerHandle       : null,
        timerReveal       : null,
        produitsJoues     : new Set(), // IDs déjà tirés
    };
    sessions.set(partieId, s);
    return s;
}

function _annulerTimers(s) {
    if (s.timerHandle) { clearTimeout(s.timerHandle); s.timerHandle = null; }
    if (s.timerReveal) { clearTimeout(s.timerReveal); s.timerReveal = null; }
}

function _tirerProduit(s, banque) {
    const dispo = banque.filter(p => !s.produitsJoues.has(p.ID));
    const pool  = dispo.length ? dispo : banque;
    const p     = pool[Math.floor(Math.random() * pool.length)];
    s.produitsJoues.add(p.ID);
    return p;
}

// ─────────────────────────────────────────────────────
// Payload "produit public" (sans le prix exact)
// ─────────────────────────────────────────────────────

function _produitPublic(p) {
    return {
        id          : p.ID || null,
        nom         : p.Nom || '',
        description : p.Description || '',
        marque      : p.Marque      || '',
        categorie   : p['Catégorie'] || '',
        fourchette  : p['Fourchette de prix'] || '',
        imageSrc    : p.Image || '', // chemin relatif, résolu par client
    };
}

function _produitAvecPrix(p) {
    return { ..._produitPublic(p), prix: p.Prix || '' };
}

// ─────────────────────────────────────────────────────
// API publique
// ─────────────────────────────────────────────────────

export function getSessionState(partieId) {
    const s = _getSession(partieId);
    if (!s) return null;
    const base = { phase: s.phase, manche: s.manche };
    if (s.phase === 'jeu' && s.produit) {
        return {
            ...base,
            produit    : _produitPublic(s.produit),
            tsDebut    : s.tsDebut,
            dureeMs    : DUREE_MS,
            nbReponses : Object.keys(s.estimations).length,
        };
    }
    if (s.phase === 'resultats' && s.derniereRevelation) {
        // Rejoin pendant la révélation : on renvoie le payload complet
        // (produit avec prix + reponses calculées) tel qu'il a été diffusé.
        return { ...base, ...s.derniereRevelation };
    }
    return base;
}

export function detruireSession(partieId) {
    const s = _getSession(partieId);
    if (s) _annulerTimers(s);
    sessions.delete(partieId);
    console.log(`[JP] 🗑️ Session détruite: ${partieId}`);
}

// ─────────────────────────────────────────────────────
// HOST ACTIONS
// ─────────────────────────────────────────────────────

export function handleHostAction(wss, ws, partieId, action, data, helpers) {
    const { broadcastToGame, broadcastToHost, send } = helpers;
    const cmd = action.split(':')[1];

    switch (cmd) {

        case 'load':
        case 'next_produit': {
            _chargerProduits().then(banque => {
                if (!banque || !banque.length) {
                    return send(ws, 'ERROR', {
                        code   : 'JUSTEPRIX_BAD_STATE',
                        message: 'Banque de produits introuvable côté serveur.',
                    });
                }

                let s = _getSession(partieId);
                if (!s) s = _creerSession(partieId);
                _annulerTimers(s);

                const p = _tirerProduit(s, banque);
                s.manche++;
                s.phase             = 'jeu';
                s.produit           = p;
                s.prixNum           = _parsePrix(p.Prix);
                s.tsDebut           = Date.now();
                s.estimations       = {};
                s.revelationEnCours = false;
                s.derniereRevelation = null;

                broadcastToGame(wss, partieId, 'JUSTEPRIX_PRODUIT_START', {
                    produit : _produitPublic(p),
                    tsDebut : s.tsDebut,
                    dureeMs : DUREE_MS,
                    manche  : s.manche,
                    scores  : store.getScores(partieId) || {},
                });

                s.timerHandle = setTimeout(() => {
                    if (s.phase !== 'jeu') return;
                    const nbJoueurs = (store.getPartie(partieId)?.joueurs || []).length;
                    broadcastToHost(wss, partieId, 'JUSTEPRIX_TIMER_EXPIRED', {
                        nbReponses : Object.keys(s.estimations).length,
                        nbJoueurs,
                    });
                    s.timerReveal = setTimeout(() => {
                        if (s.phase === 'jeu' && !s.revelationEnCours) {
                            _declencherRevelation(wss, partieId, s, helpers, 'timer');
                        }
                    }, 5000);
                }, DUREE_MS);

                console.log(`[JP] 🎲 Manche ${s.manche} — produit: "${p.Nom}" (prix réel: ${p.Prix})`);
            }).catch(err => {
                console.error('[JP] ❌ load/next_produit:', err);
                send(ws, 'ERROR', { code: 'JUSTEPRIX_BAD_STATE', message: 'Erreur lecture banque.' });
            });
            break;
        }

        case 'host_answer': {
            const s = _getSession(partieId);
            if (!s || s.phase !== 'jeu') {
                return send(ws, 'JUSTEPRIX_ANSWER_ACK', { status: 'too_late' });
            }
            const partie = store.getPartie(partieId);
            const pseudo = (data.pseudo && String(data.pseudo).trim()) || partie?.hostPseudo || null;
            if (!pseudo) return send(ws, 'JUSTEPRIX_ANSWER_ACK', { status: 'invalid' });
            if (s.estimations[pseudo] !== undefined) {
                return send(ws, 'JUSTEPRIX_ANSWER_ACK', { status: 'already' });
            }
            const valeur = String(data.estimation || '').trim();
            if (!valeur) return send(ws, 'JUSTEPRIX_ANSWER_ACK', { status: 'invalid' });
            s.estimations[pseudo] = { valeur, ts: Date.now() };

            send(ws, 'JUSTEPRIX_ANSWER_ACK', { status: 'ok' });

            const nbJoueurs  = (partie?.joueurs || []).length;
            const nbReponses = Object.keys(s.estimations).length;
            broadcastToHost(wss, partieId, 'JUSTEPRIX_RESPONSE_IN', {
                pseudo, nbReponses, nbJoueurs,
                allAnswered: nbReponses >= nbJoueurs,
            });
            console.log(`[JP] 🎮 Estimation hôte ${pseudo}: ${valeur}€`);
            break;
        }

        case 'reveal': {
            const s = _getSession(partieId);
            if (!s || s.phase !== 'jeu') {
                return send(ws, 'ERROR', { code: 'JUSTEPRIX_BAD_STATE' });
            }
            _declencherRevelation(wss, partieId, s, helpers, 'host');
            break;
        }

        default:
            console.warn(`[JP] ⚠️ Action host inconnue: ${cmd}`);
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
                return send(ws, 'JUSTEPRIX_ANSWER_ACK', { status: 'too_late' });
            }
            if (!pseudo || pseudo === 'null' || pseudo === 'undefined') {
                return send(ws, 'JUSTEPRIX_ANSWER_ACK', { status: 'invalid' });
            }
            if (s.estimations[pseudo] !== undefined) {
                return send(ws, 'JUSTEPRIX_ANSWER_ACK', { status: 'already' });
            }
            const valeur = String(data.estimation || '').trim();
            if (!valeur) return send(ws, 'JUSTEPRIX_ANSWER_ACK', { status: 'invalid' });
            s.estimations[pseudo] = { valeur, ts: Date.now() };

            send(ws, 'JUSTEPRIX_ANSWER_ACK', { status: 'ok' });

            const partie     = store.getPartie(partieId);
            const nbJoueurs  = (partie?.joueurs || []).length;
            const nbReponses = Object.keys(s.estimations).length;
            broadcastToHost(wss, partieId, 'JUSTEPRIX_RESPONSE_IN', {
                pseudo, nbReponses, nbJoueurs,
                allAnswered: nbReponses >= nbJoueurs,
            });
            console.log(`[JP] 🎮 Estimation ${pseudo}: ${valeur}€`);
            break;
        }

        default:
            console.warn(`[JP] ⚠️ Action joueur inconnue: ${cmd}`);
    }
}

// ─────────────────────────────────────────────────────
// Révélation + scoring
// ─────────────────────────────────────────────────────

function _declencherRevelation(wss, partieId, s, helpers, source) {
    if (s.revelationEnCours) return;
    s.revelationEnCours = true;
    _annulerTimers(s);

    const { broadcastToGame, broadcastToHost } = helpers;
    const prix = s.prixNum;

    const repTri = Object.entries(s.estimations)
        .filter(([p]) => p && p !== 'null' && p !== 'undefined')
        .sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));

    const resultats = repTri.map(([pseudo, d]) => {
        const est   = _parsePrix(d.valeur);
        const ecart = prix > 0 ? Math.abs(est - prix) / prix : 1;
        let points  = 0;
        if (ecart <= 0.10)      points = 2;
        else if (ecart <= 0.25) points = 1;
        return { pseudo, estimation: d.valeur, ecart, points, estPlusProche: false };
    });

    // Plus proche : prioritairement parmi ceux ≥1pt, sinon consolation
    const avecPoints = resultats.filter(r => r.points > 0);
    let plusProche = null;
    if (avecPoints.length > 0) {
        plusProche = avecPoints.reduce((min, r) => r.ecart < min.ecart ? r : min, avecPoints[0]);
    } else if (resultats.length > 0) {
        plusProche = resultats.reduce((min, r) => r.ecart < min.ecart ? r : min, resultats[0]);
        plusProche.points = 1; // consolation
    }
    if (plusProche) {
        plusProche.estPlusProche = true;
        plusProche.points += 1; // bonus +1
    }

    // Créditer les scores
    resultats.forEach(r => {
        if (r.points > 0) store.modifierScore(partieId, r.pseudo, r.points);
    });

    s.phase = 'resultats';
    const scores = store.getScores(partieId) || {};

    // Source unique du payload : diffusé en direct ET réutilisé au rejoin
    // (getSessionState) → host, invités présents et invités reconnectés
    // voient exactement les mêmes résultats.
    s.derniereRevelation = {
        produit  : _produitAvecPrix(s.produit),
        prixNum  : prix,
        reponses : resultats,
        scores,
        manche   : s.manche,
    };

    broadcastToGame(wss, partieId, 'JUSTEPRIX_REVELATION', s.derniereRevelation);
    broadcastToGame(wss, partieId, 'SCORES_UPDATE', { scores });
    broadcastToHost(wss, partieId, 'JUSTEPRIX_CAN_NEXT', { manche: s.manche });

    console.log(`[JP] 🎯 Révélation manche ${s.manche} — source: ${source} — prix: ${s.produit?.Prix}`);
}