// ======================================================
// 📦 STORE.JS — Gestion en mémoire des parties et joueurs
// ======================================================

const crypto = require('crypto');

class Store {
    constructor() {
        this.parties = new Map(); // { partieId → partie }
        this.hostSockets = new Map(); // { partieId → hostSocket }
        this.joueurSockets = new Map(); // { partieId → Map<pseudo, socket> }
        this.joueurTracker = new Map(); // { partieId → Set<pseudo> } - anti-doublons
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
        this.joueurTracker.set(partie.id, new Set());
        this.joueurSockets.set(partie.id, new Map());

        console.log(`[STORE] ✅ Partie créée: ${partie.id} (${partie.nom})`);

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
     * Ajoute un joueur à une partie (avec protection anti-doublons)
     */
    ajouterJoueur(partieId, joueur) {
        const partie = this.getPartie(partieId);
        if (!partie) {
            console.error(`[STORE] ❌ Partie non trouvée: ${partieId}`);
            return null;
        }

        // 🔴 ANTI-DOUBLONS: Vérifier que le joueur n'est pas déjà présent
        const tracker = this.joueurTracker.get(partieId);
        if (tracker && tracker.has(joueur.pseudo)) {
            console.warn(`[STORE] ⚠️ Joueur DÉJÀ PRÉSENT (doublons ignoré): ${joueur.pseudo} dans ${partieId}`);
            return null; // Ignorer le doublons
        }

        if (!partie.joueurs) partie.joueurs = [];

        // Vérifier aussi dans la liste réelle (sécurité)
        const existe = partie.joueurs.some(j => j.pseudo === joueur.pseudo);
        if (existe) {
            console.warn(`[STORE] ⚠️ Joueur DÉJÀ dans la liste: ${joueur.pseudo}`);
            return null;
        }

        partie.joueurs.push(joueur);
        tracker.add(joueur.pseudo);

        if (!partie.scores[joueur.pseudo]) {
            partie.scores[joueur.pseudo] = 0;
        }

        console.log(`[STORE] ✅ Joueur ajouté: ${joueur.pseudo} → ${partie.joueurs.length} joueurs`);
        return joueur;
    }

    /**
     * Retire un joueur d'une partie
     */
    retirerJoueur(partieId, pseudo) {
        const partie = this.getPartie(partieId);
        if (!partie) {
            console.error(`[STORE] ❌ Partie non trouvée: ${partieId}`);
            return null;
        }

        const avant = partie.joueurs.length;
        partie.joueurs = partie.joueurs.filter(j => j.pseudo !== pseudo);
        const apres = partie.joueurs.length;

        // Mettre à jour le tracker
        const tracker = this.joueurTracker.get(partieId);
        if (tracker) {
            tracker.delete(pseudo);
        }

        delete partie.scores[pseudo];

        console.log(`[STORE] ✅ Joueur retiré: ${pseudo} (${avant} → ${apres} joueurs)`);
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

        console.log(`[STORE] 📊 Score ${pseudo}: +${delta} = ${partie.scores[pseudo]}`);
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

        console.log(`[STORE] 🔄 Statut: ${partie.statut} → ${statut}`);
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
        console.log(`[STORE] 🔌 Host socket enregistré: ${partieId}`);
    }

    /**
     * Récupère le socket host d'une partie
     */
    getHostSocket(partieId) {
        return this.hostSockets.get(partieId) || null;
    }

    /**
     * Enregistre le socket d'un joueur
     */
    setJoueurSocket(partieId, pseudo, socket) {
        let joueurs = this.joueurSockets.get(partieId);
        if (!joueurs) {
            joueurs = new Map();
            this.joueurSockets.set(partieId, joueurs);
        }
        joueurs.set(pseudo, socket);
        console.log(`[STORE] 🔌 Joueur socket enregistré: ${pseudo} dans ${partieId}`);
    }

    /**
     * Récupère le socket d'un joueur
     */
    getJoueurSocket(partieId, pseudo) {
        const joueurs = this.joueurSockets.get(partieId);
        return joueurs ? joueurs.get(pseudo) : null;
    }

    /**
     * Termine une partie
     */
    terminerPartie(partieId) {
        const partie = this.getPartie(partieId);
        if (!partie) return null;

        console.log(`[STORE] ⏹️ Partie terminée: ${partieId}`);
        partie.statut = 'terminee';
        this.hostSockets.delete(partieId);
        this.joueurSockets.delete(partieId);
        this.joueurTracker.delete(partieId);

        return partie;
    }

    /**
     * Réinitialise le store
     */
    resetStore() {
        this.parties.clear();
        this.hostSockets.clear();
        this.joueurSockets.clear();
        this.joueurTracker.clear();
        console.log('[STORE] 🔄 Store réinitialisé');
    }

    /**
     * Affiche l'état actuel du store (DEBUG)
     */
    debug(partieId) {
        const partie = this.getPartie(partieId);
        if (!partie) {
            console.log(`[STORE] ❌ Partie non trouvée: ${partieId}`);
            return;
        }

        console.log(`\n[STORE] 📋 DEBUG - ${partie.id}`);
        console.log(`  Nom: ${partie.nom}`);
        console.log(`  Statut: ${partie.statut}`);
        console.log(`  Joueurs: ${partie.joueurs.length}`);
        console.log(`  Liste: ${partie.joueurs.map(j => j.pseudo).join(', ')}`);
        console.log(`  Tracker: ${Array.from(this.joueurTracker.get(partieId) || new Set()).join(', ')}`);
        console.log('');
    }
}

module.exports = new Store();