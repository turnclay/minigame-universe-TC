// /js/core/storage.js

// ======================================================
// 📌 Gestion des joueurs
// ======================================================

export function getPlayers() {
    return JSON.parse(localStorage.getItem("players") || "[]");
}

export function addPlayer(pseudo) {
    const players = getPlayers();
    if (!players.includes(pseudo)) {
        players.push(pseudo);
        localStorage.setItem("players", JSON.stringify(players));
    }
}

// ======================================================
// 🏆 SCORES GLOBAUX CUMULATIFS
// Structure : {
//   "Alice": { total: 120, parJeu: { quiz: 40, pendu: 80 } }
// }
// ======================================================

export function getScoresGlobaux() {
    return JSON.parse(localStorage.getItem("scores_globaux") || "{}");
}

function saveScoresGlobaux(scores) {
    localStorage.setItem("scores_globaux", JSON.stringify(scores));
}

export function getScoreGlobalJoueur(nom) {
    const scores = getScoresGlobaux();
    return scores[nom]?.total || 0;
}

export function getClassementGlobal() {
    const scores = getScoresGlobaux();
    return Object.entries(scores)
        .map(([nom, data]) => ({
            nom,
            total: data.total || 0,
            parJeu: data.parJeu || {}
        }))
        .sort((a, b) => b.total - a.total);
}

/**
 * ✅ SEUL point d'entrée pour créditer des points au global.
 * Appelée UNIQUEMENT quand un joueur marque un point (bouton +1, registerSuccess…).
 * JAMAIS appelée au chargement d'une partie.
 *
 * @param {string} nom   - Joueur ou équipe
 * @param {number} delta - Points à ajouter (doit être > 0)
 * @param {string} jeu   - Identifiant du jeu
 */
export function ajouterPointsGlobaux(nom, delta, jeu) {
    if (!nom || typeof delta !== "number" || delta <= 0) return;

    const scores = getScoresGlobaux();

    if (!scores[nom]) {
        scores[nom] = { total: 0, parJeu: {} };
    }

    scores[nom].total = (scores[nom].total || 0) + delta;

    if (jeu) {
        scores[nom].parJeu = scores[nom].parJeu || {};
        scores[nom].parJeu[jeu] = (scores[nom].parJeu[jeu] || 0) + delta;
    }

    saveScoresGlobaux(scores);
}

// ======================================================
// 📌 Gestion des parties
// ======================================================

export function getAllParties() {
    return JSON.parse(localStorage.getItem("parties") || "[]");
}

/**
 * Crée et sauvegarde une nouvelle partie.
 * Les scores partent toujours de 0 — le cumul vit dans scores_globaux.
 */
export function saveNewParty(data) {
    const parties = getAllParties();

    // Initialise les scores à 0 pour chaque participant
    const scoresInitiaux = {};
    const participants = data.mode === "team"
        ? (data.equipes || []).map(e => e.nom)
        : (data.joueurs || []);
    participants.forEach(p => { scoresInitiaux[p] = 0; });

    const nouvellePartie = {
        id: Date.now(),
        jeu: data.jeu,
        mode: data.mode,
        nomPartie: data.nomPartie || "",
        joueurs: data.joueurs || [],
        equipes: data.equipes || [],
        scores: scoresInitiaux,
        date: new Date().toISOString(),
        gameState: data.gameState || null,
        metadata: {
            dureePartie: 0,
            defisCompletes: 0,
            erreursTotales: 0,
            difficulte: data.difficulte || "moyen"
        }
    };

    parties.push(nouvellePartie);
    localStorage.setItem("parties", JSON.stringify(parties));
    localStorage.setItem("partie_en_cours", JSON.stringify(nouvellePartie));

    return nouvellePartie;
}

export function loadPartyById(id) {
    return getAllParties().find(p => String(p.id) === String(id)) || null;
}

export function loadGame() {
    return JSON.parse(localStorage.getItem("partie_en_cours") || "null");
}

/**
 * Sauvegarde l'état d'une partie (scores, gameState…).
 * ⚠️ NE touche PAS aux scores globaux — voir ajouterPointsGlobaux().
 */
export function saveGame(partie) {
    if (!partie || !partie.id) return;

    localStorage.setItem("partie_en_cours", JSON.stringify(partie));

    const parties = getAllParties().map(p =>
        String(p.id) === String(partie.id) ? partie : p
    );
    localStorage.setItem("parties", JSON.stringify(parties));
}

/**
 * Recopie GameState.scores dans la partie en cours et sauvegarde.
 * ⚠️ NE touche PAS aux scores globaux.
 */
export function updatePartieScores() {
    const partie = loadGame();
    if (!partie) return;

    if (window.GameState && window.GameState.scores) {
        partie.scores = { ...window.GameState.scores };
    }

    saveGame(partie);
}

export function updateGameState(gameState) {
    const partie = loadGame();
    if (!partie) return;
    partie.gameState = gameState;
    saveGame(partie);
}

export function updatePartieMetadata(metadata) {
    const partie = loadGame();
    if (!partie) return;
    partie.metadata = { ...partie.metadata, ...metadata };
    saveGame(partie);
}

export function deleteParty(id) {
    const parties = getAllParties().filter(p => String(p.id) !== String(id));
    localStorage.setItem("parties", JSON.stringify(parties));

    const partieEnCours = loadGame();
    if (partieEnCours && String(partieEnCours.id) === String(id)) {
        localStorage.removeItem("partie_en_cours");
    }
}

// ======================================================
// 📊 Statistiques par joueur
// ======================================================

export function enregistrerPerformance(joueur, jeu, data) {
    const performances = JSON.parse(localStorage.getItem("performances") || "{}");

    if (!performances[joueur]) performances[joueur] = {};
    if (!performances[joueur][jeu]) {
        performances[joueur][jeu] = {
            parties: 0, scoreTotal: 0, meilleurScore: 0,
            tempsTotal: 0, erreursTotales: 0, victoires: 0
        };
    }

    const perf = performances[joueur][jeu];
    perf.parties++;
    perf.scoreTotal += data.score || 0;
    perf.meilleurScore = Math.max(perf.meilleurScore, data.score || 0);
    perf.tempsTotal += data.temps || 0;
    perf.erreursTotales += data.erreurs || 0;
    perf.victoires += data.victoire ? 1 : 0;

    localStorage.setItem("performances", JSON.stringify(performances));
}

export function getPerformancesJoueur(joueur) {
    const performances = JSON.parse(localStorage.getItem("performances") || "{}");
    return performances[joueur] || {};
}

export function getAllPerformances() {
    return JSON.parse(localStorage.getItem("performances") || "{}");
}

// ======================================================
// 💾 Export / Import / Reset
// ======================================================

export function exporterDonnees() {
    return {
        players: getPlayers(),
        parties: getAllParties(),
        performances: getAllPerformances(),
        scores_globaux: getScoresGlobaux(),
        date: new Date().toISOString()
    };
}

export function importerDonnees(data) {
    if (data.players)        localStorage.setItem("players",        JSON.stringify(data.players));
    if (data.parties)        localStorage.setItem("parties",        JSON.stringify(data.parties));
    if (data.performances)   localStorage.setItem("performances",   JSON.stringify(data.performances));
    if (data.scores_globaux) localStorage.setItem("scores_globaux", JSON.stringify(data.scores_globaux));
}

export function resetAllData() {
    ["players", "parties", "partie_en_cours", "performances", "scores_globaux"]
        .forEach(k => localStorage.removeItem(k));
}