// /server/store.js
// ======================================================
// 🗄️ STORE — État serveur MiniGame Universe
// ======================================================

const { v4: uuidv4 } = require("uuid");

// Stockage en mémoire
const parties = new Map();   // partieId → partie
let _partieActiveId = null;  // Une seule partie active à la fois
const _hostSockets  = new Map(); // partieId → ws

// ══════════════════════════════════════════════════════
// 🏗️ CRÉATION
// ══════════════════════════════════════════════════════

function creerPartie({ nom, jeu, mode, equipes, joueursSolo, hostJoue, hostPseudo }) {
    const id = uuidv4();

    // Initialiser les scores
    const scores = {};

    if (mode === "team") {
        (equipes || []).forEach(eq => { scores[eq.nom] = 0; });
    } else {
        (joueursSolo || []).forEach(j => { scores[j] = 0; });
        if (hostJoue && hostPseudo) { scores[hostPseudo] = 0; }
    }

    const partie = {
        id,
        nom,
        jeu,
        mode,
        statut:      "lobby",
        equipes:     equipes     || [],
        joueursSolo: joueursSolo || [],
        joueurs:     [],           // joueurs WS connectés
        scores,
        gameState:   null,
        hostJoue:    hostJoue    || false,
        hostPseudo:  hostPseudo  || null,
        createdAt:   Date.now(),
        updatedAt:   Date.now(),
    };

    parties.set(id, partie);
    _partieActiveId = id;

    console.log(`[STORE] ✅ Partie créée : ${id} (${nom})`);
    return partie;
}

// ══════════════════════════════════════════════════════
// 📖 LECTURE
// ══════════════════════════════════════════════════════

function getPartie(id) {
    return parties.get(id) || null;
}

/** Retourne la partie active en cours (lobby ou en_cours) */
function getPartieActive() {
    if (!_partieActiveId) return null;
    const p = parties.get(_partieActiveId);
    if (!p || p.statut === "terminee") {
        _partieActiveId = null;
        return null;
    }
    return p;
}

function getJoueurs(partieId) {
    const p = getPartie(partieId);
    return p ? [...p.joueurs] : [];
}

function getScores(partieId) {
    const p = getPartie(partieId);
    return p ? { ...p.scores } : {};
}

function getGameState(partieId) {
    const p = getPartie(partieId);
    return p ? p.gameState : null;
}

// ══════════════════════════════════════════════════════
// ✏️ MODIFICATION
// ══════════════════════════════════════════════════════

function setStatut(partieId, statut) {
    const p = getPartie(partieId);
    if (!p) return;
    p.statut    = statut;
    p.updatedAt = Date.now();
}

function terminerPartie(partieId) {
    setStatut(partieId, "terminee");
    if (_partieActiveId === partieId) {
        _partieActiveId = null;
    }
    console.log(`[STORE] 🏁 Partie terminée : ${partieId}`);
}

function ajouterJoueur(partieId, { pseudo, equipe }) {
    const p = getPartie(partieId);
    if (!p) return;

    // Éviter les doublons
    if (!p.joueurs.find(j => j.pseudo === pseudo)) {
        p.joueurs.push({ pseudo, equipe: equipe || null });
    }

    // Initialiser le score si besoin
    if (p.mode === "solo" && !(pseudo in p.scores)) {
        p.scores[pseudo] = 0;
    }

    p.updatedAt = Date.now();
}

function retirerJoueur(partieId, pseudo) {
    const p = getPartie(partieId);
    if (!p) return;
    p.joueurs   = p.joueurs.filter(j => j.pseudo !== pseudo);
    p.updatedAt = Date.now();
}

function modifierScore(partieId, cible, delta) {
    const p = getPartie(partieId);
    if (!p) return;

    if (!(cible in p.scores)) p.scores[cible] = 0;
    p.scores[cible] = Math.max(0, p.scores[cible] + delta);
    p.updatedAt = Date.now();
}

function setScores(partieId, scores) {
    const p = getPartie(partieId);
    if (!p) return;
    p.scores    = { ...scores };
    p.updatedAt = Date.now();
}

function updateGameState(partieId, gameState) {
    const p = getPartie(partieId);
    if (!p) return;
    p.gameState = gameState;
    p.updatedAt = Date.now();
}

function patchGameState(partieId, patch) {
    const p = getPartie(partieId);
    if (!p) return;
    p.gameState = { ...(p.gameState || {}), ...patch };
    p.updatedAt = Date.now();
}

// ══════════════════════════════════════════════════════
// 🔌 SOCKETS HOST
// ══════════════════════════════════════════════════════

function setHostSocket(partieId, ws) {
    _hostSockets.set(partieId, ws);
}

function getHostSocket(partieId) {
    return _hostSockets.get(partieId) || null;
}

// ══════════════════════════════════════════════════════
// 📸 SNAPSHOTS
// ══════════════════════════════════════════════════════

/** Snapshot complet pour le host */
function snapshotPartie(partieId, avecGameState = false) {
    const p = getPartie(partieId);
    if (!p) return null;

    const snap = {
        id:          p.id,
        nom:         p.nom,
        jeu:         p.jeu,
        mode:        p.mode,
        statut:      p.statut,
        equipes:     p.equipes,
        joueursSolo: p.joueursSolo,
        joueurs:     [...p.joueurs],
        scores:      { ...p.scores },
        hostJoue:    p.hostJoue,
        hostPseudo:  p.hostPseudo,
        createdAt:   p.createdAt,
    };

    if (avecGameState) snap.gameState = p.gameState;
    return snap;
}

/** Snapshot allégé pour les joueurs */
function snapshotPublic(partieId) {
    const p = getPartie(partieId);
    if (!p) return null;

    return {
        id:      p.id,
        nom:     p.nom,
        jeu:     p.jeu,
        mode:    p.mode,
        statut:  p.statut,
        equipes: p.equipes.map(e => ({ nom: e.nom })),
        scores:  { ...p.scores },
        nbJoueurs: p.joueurs.length,
    };
}

// ══════════════════════════════════════════════════════
// 🐛 DEBUG
// ══════════════════════════════════════════════════════

function debug() {
    console.log(`[STORE] Parties: ${parties.size} | Active: ${_partieActiveId || "aucune"}`);
    parties.forEach((p, id) => {
        console.log(`  → ${id.slice(0, 8)}… | ${p.nom} | ${p.statut} | ${p.joueurs.length} joueurs`);
    });
}

// ══════════════════════════════════════════════════════
module.exports = {
    creerPartie,
    getPartie,
    getPartieActive,
    getJoueurs,
    getScores,
    getGameState,
    setStatut,
    terminerPartie,
    ajouterJoueur,
    retirerJoueur,
    modifierScore,
    setScores,
    updateGameState,
    patchGameState,
    setHostSocket,
    getHostSocket,
    snapshotPartie,
    snapshotPublic,
    debug,
};