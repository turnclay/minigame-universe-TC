// ======================================================
// 📦 STORE.JS — Gestion en mémoire des parties et joueurs
// ======================================================

const crypto = require('crypto');

class Store {
    constructor() {
        this.parties = new Map(); // { partieId → partie }
        this.hostSockets = new Map(); // { partieId → hostSocket }
    }

    /**
     * Crée une nouvelle partie
     */
    creerPartie(data) {
        const { nom, jeu, mode, equipes = [], hostJoue, hostPseudo } = data;

        const partie = {
            id: crypto.randomUUID(),
            nom,
            jeu,
            mode,
            statut: 'lobby', // lobby, en_cours, terminee
            equipes: equipes || [],
            joueurs: [],
            scores: {},
            maxJoueurs: 8,
            hostJoue: hostJoue || false,
            hostPseudo: hostPseudo || null,
            createdAt: Date.now(),
        };

        this.parties.set(partie.id, partie);
        console.log(`[STORE] Partie créée: ${partie.id}`);

        return partie;
    }

    /**
     * Récupère une partie par ID
     */
    getPartie(partieId) {
        return this.parties.get(partieId) || null;
    }

    /**
     * Récupère toutes les parties
     */
    getAllParties() {
        return Array.from(this.parties.values());
    }

    /**
     * Ajoute un joueur à une partie
     */
    ajouterJoueur(partieId, joueur) {
        const partie = this.getPartie(partieId);
        if (!partie) return null;

        if (!partie.joueurs) partie.joueurs = [];
        partie.joueurs.push(joueur);

        if (!partie.scores[joueur.pseudo]) {
            partie.scores[joueur.pseudo] = 0;
        }

        return joueur;
    }

    /**
     * Retire un joueur d'une partie
     */
    retirerJoueur(partieId, pseudo) {
        const partie = this.getPartie(partieId);
        if (!partie) return null;

        partie.joueurs = partie.joueurs.filter(j => j.pseudo !== pseudo);
        delete partie.scores[pseudo];

        return partie;
    }

    /**
     * Récupère tous les joueurs d'une partie
     */
    getJoueurs(partieId) {
        const partie = this.getPartie(partieId);
        return partie ? partie.joueurs || [] : [];
    }

    /**
     * Modifie le score d'un joueur
     */
    modifierScore(partieId, pseudo, delta) {
        const partie = this.getPartie(partieId);
        if (!partie) return null;

        if (!partie.scores[pseudo]) partie.scores[pseudo] = 0;
        partie.scores[pseudo] += delta;
        partie.scores[pseudo] = Math.max(0, partie.scores[pseudo]);

        return partie.scores[pseudo];
    }

    /**
     * Récupère les scores d'une partie
     */
    getScores(partieId) {
        const partie = this.getPartie(partieId);
        return partie ? partie.scores || {} : {};
    }

    /**
     * Définit le statut d'une partie
     */
    setStatut(partieId, statut) {
        const partie = this.getPartie(partieId);
        if (!partie) return null;

        partie.statut = statut;
        return partie;
    }

    /**
     * Crée un snapshot public d'une partie
     */
    snapshotPartie(partieId) {
        const partie = this.getPartie(partieId);
        if (!partie) return null;

        return {
            id: partie.id,
            nom: partie.nom,
            jeu: partie.jeu,
            mode: partie.mode,
            statut: partie.statut,
            joueurs: partie.joueurs || [],
            equipes: partie.equipes || [],
            scores: partie.scores || {},
        };
    }

    /**
     * Associe un socket host à une partie
     */
    setHostSocket(partieId, socket) {
        this.hostSockets.set(partieId, socket);
    }

    /**
     * Récupère le socket host d'une partie
     */
    getHostSocket(partieId) {
        return this.hostSockets.get(partieId) || null;
    }

    /**
     * Termine une partie
     */
    terminerPartie(partieId) {
        const partie = this.getPartie(partieId);
        if (!partie) return null;

        partie.statut = 'terminee';
        this.hostSockets.delete(partieId);

        return partie;
    }

    /**
     * Réinitialise le store
     */
    resetStore() {
        this.parties.clear();
        this.hostSockets.clear();
        console.log('[STORE] Store réinitialisé');
    }
}

module.exports = new Store();