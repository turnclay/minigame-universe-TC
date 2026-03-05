// server/store.js
// =============================================
// 🗄️ ÉTAT GLOBAL DU JEU (en mémoire serveur)
// Source de vérité unique — jamais le client
// =============================================

/**
 * Structure d'une partie :
 * {
 *   id: string,
 *   nom: string,
 *   jeu: string,
 *   mode: "solo"|"team",
 *   statut: "lobby"|"en_cours"|"terminee",
 *   equipes: [{ nom, membres: [pseudo], nbJoueurs }],
 *   scores: { [nomOuEquipe]: number },
 *   createdAt: Date,
 *   hostSocketId: string | null
 * }
 *
 * Structure d'un joueur connecté :
 * {
 *   socketId: string,
 *   pseudo: string,
 *   equipe: string | null,
 *   role: "host"|"player",
 *   partieId: string | null,
 *   connectedAt: Date
 * }
 */

class GameStore {
    constructor() {
        // Map<partieId, partie>
        this.parties = new Map();

        // Map<socketId, joueur>
        this.connexions = new Map();

        // Map<pseudo, socketId>  — pour détecter les doublons
        this.pseudoIndex = new Map();
    }

    // ──────────────────────────────────────────
    // PARTIES
    // ──────────────────────────────────────────

    creerPartie({ id, nom, jeu, mode, equipes = [], hostSocketId = null }) {
        if (this.parties.has(id)) return null;

        const scores = {};
        if (mode === "team") {
            equipes.forEach(e => { scores[e.nom] = 0; });
        }

        const partie = {
            id,
            nom,
            jeu,
            mode,
            statut: "lobby",
            equipes,
            scores,
            createdAt: new Date(),
            hostSocketId
        };

        this.parties.set(id, partie);
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
        p.statut = statut;
        return true;
    }

    ajouterPointsPartie(partieId, cible, delta) {
        const p = this.parties.get(partieId);
        if (!p) return false;
        if (!(cible in p.scores)) p.scores[cible] = 0;
        p.scores[cible] = Math.max(0, p.scores[cible] + delta);
        return true;
    }

    supprimerPartie(id) {
        return this.parties.delete(id);
    }

    // ──────────────────────────────────────────
    // CONNEXIONS
    // ──────────────────────────────────────────

    enregistrerConnexion(socketId, { pseudo, role, partieId = null, equipe = null }) {
        // Vérifie unicité du pseudo (sauf host)
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
    // SNAPSHOT pour diffusion (sans données sensibles)
    // ──────────────────────────────────────────

    snapshotPartie(partieId) {
        const p = this.parties.get(partieId);
        if (!p) return null;
        return {
            id: p.id,
            nom: p.nom,
            jeu: p.jeu,
            mode: p.mode,
            statut: p.statut,
            equipes: p.equipes,
            scores: p.scores,
            joueurs: this.getJoueursPartie(partieId).map(j => ({
                pseudo: j.pseudo,
                equipe: j.equipe
            }))
        };
    }
}

module.exports = new GameStore();
