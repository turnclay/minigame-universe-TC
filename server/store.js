// server/store.js
// =============================================
// 🗄️ ÉTAT GLOBAL DU JEU (en mémoire serveur)
// Source de vérité unique — jamais le client
// =============================================

/**
 * Structure d'une partie :
 * {
 *   id:            string,
 *   nom:           string,
 *   jeu:           string,
 *   mode:          "solo" | "team",
 *   statut:        "lobby" | "en_cours" | "terminee",
 *   equipes:       [{ nom, membres: [pseudo] }],
 *   joueursSolo:   [string],          // joueurs ajoutés manuellement par le host
 *   scores:        { [nomOuEquipe]: number },
 *   gameState:     object | null,     // état interne du jeu actif (question, phase, etc.)
 *   createdAt:     Date,
 *   updatedAt:     Date,
 *   hostSocketId:  string | null,
 *   hostJoue:      boolean,           // le host participe-t-il ?
 *   hostPseudo:    string | null,     // pseudo du host s'il joue
 * }
 *
 * Structure d'un joueur connecté :
 * {
 *   socketId:    string,
 *   pseudo:      string,
 *   equipe:      string | null,
 *   role:        "host" | "player",
 *   partieId:    string | null,
 *   connectedAt: Date
 * }
 */

class GameStore {
    constructor() {
        /** @type {Map<string, object>} partieId → partie */
        this.parties = new Map();

        /** @type {Map<string, object>} socketId → joueur */
        this.connexions = new Map();

        /** @type {Map<string, string>} pseudo → socketId (évite les doublons) */
        this.pseudoIndex = new Map();
    }

    // ──────────────────────────────────────────
    // 🎮 PARTIES
    // ──────────────────────────────────────────

    /**
     * Crée une nouvelle partie.
     * Retourne null si l'id existe déjà (unicité garantie).
     */
    creerPartie({ id, nom, jeu, mode, equipes = [], joueursSolo = [], hostSocketId = null, hostJoue = false, hostPseudo = null }) {
        if (this.parties.has(id)) return null;

        // Initialiser les scores
        const scores = {};
        if (mode === "team") {
            equipes.forEach(e => { scores[e.nom] = 0; });
        } else {
            // Mode solo : joueurs ajoutés manuellement + host s'il joue
            joueursSolo.forEach(j => { scores[j] = 0; });
            if (hostJoue && hostPseudo && !scores[hostPseudo]) {
                scores[hostPseudo] = 0;
            }
        }

        const partie = {
            id,
            nom,
            jeu,
            mode,
            statut:       "lobby",
            equipes,
            joueursSolo,
            scores,
            gameState:    null,   // État interne du jeu (géré par les modules)
            createdAt:    new Date(),
            updatedAt:    new Date(),
            hostSocketId,
            hostJoue,
            hostPseudo
        };

        this.parties.set(id, partie);
        console.log(`[STORE] Partie créée : "${nom}" (${jeu}, ${mode}) — ${id}`);
        return partie;
    }

    getPartie(id) {
        return this.parties.get(id) || null;
    }

    getAllParties() {
        return [...this.parties.values()];
    }

    updatePartieStatut(id, statut) {
        const p = this.parties.get(id);
        if (!p) return false;
        p.statut    = statut;
        p.updatedAt = new Date();
        return true;
    }

    // ──────────────────────────────────────────
    // 🎯 ÉTAT DU JEU (gameState)
    // ──────────────────────────────────────────

    /**
     * Met à jour l'état interne d'un jeu.
     * Permet de persister la progression (question actuelle, phase, etc.)
     * @param {string} partieId
     * @param {object} gameState — objet libre, défini par chaque module de jeu
     */
    updateGameState(partieId, gameState) {
        const p = this.parties.get(partieId);
        if (!p) return false;
        p.gameState = { ...gameState, _updatedAt: Date.now() };
        p.updatedAt = new Date();
        return true;
    }

    /**
     * Retourne l'état interne du jeu, ou null.
     */
    getGameState(partieId) {
        return this.parties.get(partieId)?.gameState || null;
    }

    /**
     * Fusionne partiellement l'état du jeu (patch).
     */
    patchGameState(partieId, patch) {
        const p = this.parties.get(partieId);
        if (!p) return false;
        p.gameState = { ...(p.gameState || {}), ...patch, _updatedAt: Date.now() };
        p.updatedAt = new Date();
        return true;
    }

    // ──────────────────────────────────────────
    // 🏆 SCORES
    // ──────────────────────────────────────────

    ajouterPointsPartie(partieId, cible, delta) {
        const p = this.parties.get(partieId);
        if (!p) return false;
        if (!(cible in p.scores)) p.scores[cible] = 0;
        p.scores[cible] = Math.max(0, p.scores[cible] + delta);
        p.updatedAt     = new Date();
        return true;
    }

    /**
     * Remplace complètement le tableau des scores.
     */
    setScores(partieId, scores) {
        const p = this.parties.get(partieId);
        if (!p) return false;
        p.scores    = { ...scores };
        p.updatedAt = new Date();
        return true;
    }

    /**
     * Ajoute un participant au tableau des scores s'il n'y est pas.
     */
    initialiserScoreParticipant(partieId, cible) {
        const p = this.parties.get(partieId);
        if (!p) return false;
        if (!(cible in p.scores)) {
            p.scores[cible] = 0;
            p.updatedAt     = new Date();
        }
        return true;
    }

    supprimerPartie(id) {
        return this.parties.delete(id);
    }

    // ──────────────────────────────────────────
    // 🔌 CONNEXIONS
    // ──────────────────────────────────────────

    enregistrerConnexion(socketId, { pseudo, role, partieId = null, equipe = null }) {
        // Unicité du pseudo (joueurs uniquement)
        if (role === "player" && this.pseudoIndex.has(pseudo)) {
            return { ok: false, error: "PSEUDO_DEJA_PRIS" };
        }

        const joueur = {
            socketId,
            pseudo,
            role,
            partieId,
            equipe,
            connectedAt: new Date()
        };

        this.connexions.set(socketId, joueur);
        if (role === "player") this.pseudoIndex.set(pseudo, socketId);

        return { ok: true, joueur };
    }

    getConnexion(socketId) {
        return this.connexions.get(socketId) || null;
    }

    supprimerConnexion(socketId) {
        const joueur = this.connexions.get(socketId);
        if (!joueur) return;
        if (joueur.role === "player") this.pseudoIndex.delete(joueur.pseudo);
        this.connexions.delete(socketId);
    }

    getJoueursPartie(partieId) {
        return [...this.connexions.values()].filter(
            c => c.partieId === partieId && c.role === "player"
        );
    }

    assignerEquipe(socketId, equipe) {
        const joueur = this.connexions.get(socketId);
        if (!joueur) return false;
        joueur.equipe = equipe;
        return true;
    }

    pseudoDisponible(pseudo) {
        return !this.pseudoIndex.has(pseudo);
    }

    // ──────────────────────────────────────────
    // 📸 SNAPSHOT (diffusion sécurisée)
    // ──────────────────────────────────────────

    /**
     * Retourne un snapshot de la partie à diffuser aux clients.
     * N'expose jamais les données internes sensibles (hostSocketId, etc.)
     *
     * @param {string}  partieId
     * @param {boolean} avecGameState — inclure l'état du jeu (pour le host uniquement)
     */
    snapshotPartie(partieId, avecGameState = false) {
        const p = this.parties.get(partieId);
        if (!p) return null;

        const snapshot = {
            id:      p.id,
            nom:     p.nom,
            jeu:     p.jeu,
            mode:    p.mode,
            statut:  p.statut,
            equipes: p.equipes,
            scores:  p.scores,
            joueurs: this.getJoueursPartie(partieId).map(j => ({
                pseudo: j.pseudo,
                equipe: j.equipe
            })),
            // Infos host (sans les données sensibles)
            hostJoue:   p.hostJoue,
            hostPseudo: p.hostPseudo,
        };

        // L'état du jeu n'est partagé qu'au host (ou si explicitement demandé)
        if (avecGameState && p.gameState) {
            snapshot.gameState = p.gameState;
        }

        return snapshot;
    }

    /**
     * Snapshot allégé pour les joueurs (pas de gameState, pas de hostPseudo).
     */
    snapshotPublic(partieId) {
        const p = this.parties.get(partieId);
        if (!p) return null;
        return {
            id:      p.id,
            nom:     p.nom,
            jeu:     p.jeu,
            mode:    p.mode,
            statut:  p.statut,
            equipes: p.equipes.map(e => ({ nom: e.nom })), // membres masqués
            scores:  p.scores,
            joueurs: this.getJoueursPartie(partieId).map(j => ({
                pseudo: j.pseudo,
                equipe: j.equipe
            }))
        };
    }

    // ──────────────────────────────────────────
    // 🛠️ UTILITAIRES
    // ──────────────────────────────────────────

    /**
     * Retourne un résumé de l'état du store (debug / monitoring).
     */
    debug() {
        return {
            parties:    this.parties.size,
            connexions: this.connexions.size,
            pseudos:    this.pseudoIndex.size,
            detail: [...this.parties.values()].map(p => ({
                id:      p.id,
                nom:     p.nom,
                jeu:     p.jeu,
                statut:  p.statut,
                joueurs: this.getJoueursPartie(p.id).length,
                scores:  p.scores
            }))
        };
    }
}

module.exports = new GameStore();