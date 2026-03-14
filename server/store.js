// ======================================================
// 📦 STORE.JS — Gestion en mémoire des parties et joueurs
// ======================================================

import crypto from 'crypto';

class Store {
    constructor() {
        this.parties = new Map();
        this.hostSockets = new Map();
        this.joueurSockets = new Map();
        this.joueurTracker = new Map();
    }

    // ─────────────────────────────────────────────────────
    // 🔑 CODES DE PARTIE
    // ─────────────────────────────────────────────────────

    genererCode(partieId) {
        const partie = this.getPartie(partieId);
        if (!partie) return null;

        if (partie.code) return partie.code;

        const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code, attempts = 0;

        do {
            code = Array.from({ length: 6 }, () =>
                CHARS[Math.floor(Math.random() * CHARS.length)]
            ).join('');
            attempts++;
        } while (this._codeExiste(code) && attempts < 10);

        partie.code = code;
        console.log(`[STORE] 🔑 Code généré: ${code} → ${partieId}`);
        return code;
    }

    _codeExiste(code) {
        return Array.from(this.parties.values()).some(
            p => p.code === code && p.statut !== 'terminee' && p.statut !== 'ended'
        );
    }

    getPartieByCode(code) {
        if (!code) return null;
        const upper = code.toUpperCase().trim();
        return Array.from(this.parties.values()).find(
            p => p.code === upper &&
                 p.statut !== 'terminee' &&
                 p.statut !== 'ended'
        ) || null;
    }

    // ─────────────────────────────────────────────────────
    // 🧩 PARTIES & JOUEURS
    // ─────────────────────────────────────────────────────

    creerPartie(data) {
        const { nom, jeu, mode, equipes = [], hostJoue, hostPseudo } = data;

        const partie = {
            id: crypto.randomUUID(),
            nom,
            jeu,
            mode,
            statut: 'lobby',
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

    getPartie(partieId) {
        return this.parties.get(partieId) || null;
    }

    getAllParties() {
        return Array.from(this.parties.values());
    }

    ajouterJoueur(partieId, joueur) {
        const partie = this.getPartie(partieId);
        if (!partie) return null;

        const tracker = this.joueurTracker.get(partieId);
        if (tracker && tracker.has(joueur.pseudo)) {
            console.warn(`[STORE] ⚠️ Joueur déjà présent: ${joueur.pseudo}`);
            return null;
        }

        if (!partie.joueurs) partie.joueurs = [];

        const existe = partie.joueurs.some(j => j.pseudo === joueur.pseudo);
        if (existe) return null;

        partie.joueurs.push(joueur);
        tracker.add(joueur.pseudo);

        if (!partie.scores[joueur.pseudo]) {
            partie.scores[joueur.pseudo] = 0;
        }

        console.log(`[STORE] ➕ Joueur ajouté: ${joueur.pseudo}`);
        return joueur;
    }

    retirerJoueur(partieId, pseudo) {
        const partie = this.getPartie(partieId);
        if (!partie) return null;

        partie.joueurs = partie.joueurs.filter(j => j.pseudo !== pseudo);

        const tracker = this.joueurTracker.get(partieId);
        if (tracker) tracker.delete(pseudo);

        delete partie.scores[pseudo];

        console.log(`[STORE] ➖ Joueur retiré: ${pseudo}`);
        return partie;
    }

    getJoueurs(partieId) {
        const partie = this.getPartie(partieId);
        return partie ? partie.joueurs || [] : [];
    }

    modifierScore(partieId, pseudo, delta) {
        const partie = this.getPartie(partieId);
        if (!partie) return null;

        if (!partie.scores[pseudo]) partie.scores[pseudo] = 0;
        partie.scores[pseudo] = Math.max(0, partie.scores[pseudo] + delta);

        console.log(`[STORE] 📊 Score ${pseudo}: ${partie.scores[pseudo]}`);
        return partie.scores[pseudo];
    }

    getScores(partieId) {
        const partie = this.getPartie(partieId);
        return partie ? partie.scores || {} : {};
    }

    setStatut(partieId, statut) {
        const partie = this.getPartie(partieId);
        if (!partie) return null;

        partie.statut = statut;
        return partie;
    }

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

    setHostSocket(partieId, socket) {
        this.hostSockets.set(partieId, socket);
    }

    getHostSocket(partieId) {
        return this.hostSockets.get(partieId) || null;
    }

    setJoueurSocket(partieId, pseudo, socket) {
        let joueurs = this.joueurSockets.get(partieId);
        if (!joueurs) {
            joueurs = new Map();
            this.joueurSockets.set(partieId, joueurs);
        }
        joueurs.set(pseudo, socket);
    }

    getJoueurSocket(partieId, pseudo) {
        const joueurs = this.joueurSockets.get(partieId);
        return joueurs ? joueurs.get(pseudo) : null;
    }

    terminerPartie(partieId) {
        const partie = this.getPartie(partieId);
        if (!partie) return null;

        partie.statut = 'terminee';
        this.hostSockets.delete(partieId);
        this.joueurSockets.delete(partieId);
        this.joueurTracker.delete(partieId);

        return partie;
    }

    resetStore() {
        this.parties.clear();
        this.hostSockets.clear();
        this.joueurSockets.clear();
        this.joueurTracker.clear();
    }

    debug(partieId) {
        const partie = this.getPartie(partieId);
        if (!partie) return;

        console.log(`\n[STORE] DEBUG - ${partie.id}`);
        console.log(`  Nom: ${partie.nom}`);
        console.log(`  Statut: ${partie.statut}`);
        console.log(`  Joueurs: ${partie.joueurs.length}`);
        console.log(`  Liste: ${partie.joueurs.map(j => j.pseudo).join(', ')}`);
        console.log(`  Tracker: ${Array.from(this.joueurTracker.get(partieId) || []).join(', ')}`);
    }
}

const store = new Store();
export default store;