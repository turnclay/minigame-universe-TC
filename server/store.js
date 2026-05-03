// ======================================================
// 📦 STORE.JS — Gestion persistante des parties et joueurs
// ======================================================
// Portage V3 → V2 : AUCUNE modification.
// Ce fichier est identique à server/store.js de la V3.
// Il est autonome et ne dépend d'aucune route ni logique V2.
//
// CORRECTIONS v6.0 (reportées depuis V3) :
//   ✅ Statut initial 'lobby' (au lieu de 'en_attente')
//   ✅ modifierScore et getScores indexés par pseudo
//   ✅ ajouterJoueur idempotent (retourne le joueur existant)
//   ✅ Persistance sur disque via store-data.json (auto-sauvegarde 5min)
// ======================================================

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// En production sur Render, le disque persistant est monté sur /data.
// En développement local, on écrit dans server/store-data.json.
const STORE_FILE = process.env.NODE_ENV === 'production'
    ? '/data/store-data.json'
    : path.join(__dirname, 'store-data.json');

class Store {
    constructor() {
        this.parties       = new Map();
        this.hostSockets   = new Map();
        this.joueurSockets = new Map();

        this.loadFromDisk().catch(console.error);
        setInterval(() => this.saveToDisk(), 5 * 60 * 1000);
    }

    // ─────────────────────────────────────────────────────
    // 💾 PERSISTANCE
    // ─────────────────────────────────────────────────────

    async loadFromDisk() {
        try {
            const data   = await fs.readFile(STORE_FILE, 'utf-8');
            const parsed = JSON.parse(data);

            parsed.parties.forEach(partie => {
                if (partie.createdAt)    partie.createdAt    = new Date(partie.createdAt);
                if (partie.lastActivity) partie.lastActivity = new Date(partie.lastActivity);
                // Migration : ancien statut 'en_attente' → 'lobby'
                if (partie.statut === 'en_attente') partie.statut = 'lobby';
                this.parties.set(partie.id, partie);
            });

            console.log(`[STORE] 💾 ${parsed.parties.length} partie(s) chargée(s)`);
        } catch (err) {
            if (err.code === 'ENOENT') {
                console.log('[STORE] Aucune donnée persistée trouvée — démarrage propre');
            } else {
                console.error('[STORE] Erreur chargement:', err);
            }
        }
    }

    async saveToDisk() {
        try {
            const data = {
                parties : Array.from(this.parties.values()),
                savedAt : new Date().toISOString(),
            };
            await fs.writeFile(STORE_FILE, JSON.stringify(data, null, 2));
            console.log(`[STORE] 💾 ${data.parties.length} partie(s) sauvegardée(s)`);
        } catch (err) {
            console.error('[STORE] Erreur sauvegarde:', err);
        }
    }

    // ─────────────────────────────────────────────────────
    // 🔑 CODES DE PARTIE
    // ─────────────────────────────────────────────────────

    genererCodeCourt(partieId) {
        const partie = this.getPartie(partieId);
        if (!partie) return null;
        if (partie.codeCourt) return partie.codeCourt;

        const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code, attempts = 0;
        do {
            code = Array.from({ length: 6 }, () =>
                CHARS[Math.floor(Math.random() * CHARS.length)]
            ).join('');
            attempts++;
        } while (this._codeCourtExiste(code) && attempts < 10);

        partie.codeCourt = code;
        console.log(`[STORE] 🔑 Code généré: ${code} → ${partieId}`);
        return code;
    }

    _codeCourtExiste(code) {
        return Array.from(this.parties.values()).some(
            p => p.codeCourt === code && p.statut !== 'terminee'
        );
    }

    getPartieByCode(code) {
        if (!code) return null;
        const upper = code.toUpperCase().trim();
        return Array.from(this.parties.values()).find(
            p => p.codeCourt === upper && p.statut !== 'terminee'
        ) || null;
    }

    // ─────────────────────────────────────────────────────
    // 🧩 PARTIES & JOUEURS
    // ─────────────────────────────────────────────────────

    creerPartie(data) {
        const {
            nom, jeu, mode, equipes = [],
            hostJoue, hostPseudo, hostId, maxJoueurs = 8,
        } = data;

        const maintenant = new Date();

        const partie = {
            id           : crypto.randomUUID(),
            nom,
            jeu,
            mode,
            statut       : 'lobby',
            equipes      : equipes.map(e => ({
                id      : crypto.randomUUID(),
                nom     : e.nom,
                couleur : e.couleur || this._genererCouleurEquipe(),
            })),
            joueurs      : [],
            scores       : {},
            maxJoueurs,
            hostJoue     : hostJoue   || false,
            hostPseudo   : hostPseudo || null,
            hostId       : hostId     || null,
            codeCourt    : null,
            createdAt    : maintenant,
            lastActivity : maintenant,
        };

        this.parties.set(partie.id, partie);
        this.joueurSockets.set(partie.id, new Map());

        console.log(`[STORE] ✅ Partie créée: ${partie.id} (${partie.nom})`);
        this.saveToDisk();
        return partie;
    }

    _genererCouleurEquipe() {
        const couleurs = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
            '#FFEEAD', '#D4A5A5', '#9B59B6', '#3498DB',
            '#E67E22', '#2ECC71', '#E74C3C', '#1ABC9C',
        ];
        return couleurs[Math.floor(Math.random() * couleurs.length)];
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

        // Idempotent : retourner le joueur existant si déjà présent
        const dejaDedans = partie.joueurs.find(j => j.pseudo === joueur.pseudo);
        if (dejaDedans) {
            console.log(`[STORE] ℹ️ Joueur déjà présent: ${joueur.pseudo}`);
            return dejaDedans;
        }

        if (partie.joueurs.length >= partie.maxJoueurs) {
            console.warn(`[STORE] ⚠️ Partie complète: ${partieId}`);
            return null;
        }

        const nouveauJoueur = {
            id          : crypto.randomUUID(),
            pseudo      : joueur.pseudo,
            equipe      : joueur.equipe  || null,
            estPret     : joueur.estPret || false,
            statut      : joueur.statut  || 'connected',
            dateArrivee : new Date(),
        };

        partie.joueurs.push(nouveauJoueur);

        if (partie.scores[joueur.pseudo] === undefined) {
            partie.scores[joueur.pseudo] = 0;
        }

        partie.lastActivity = new Date();
        console.log(`[STORE] ➕ Joueur ajouté: ${nouveauJoueur.pseudo}`);
        this.saveToDisk();
        return nouveauJoueur;
    }

    retirerJoueur(partieId, pseudo) {
        const partie = this.getPartie(partieId);
        if (!partie) return null;

        const joueur = partie.joueurs.find(j => j.pseudo === pseudo);
        if (!joueur) return null;

        partie.joueurs = partie.joueurs.filter(j => j.pseudo !== pseudo);

        const sockets = this.joueurSockets.get(partieId);
        if (sockets) sockets.delete(pseudo);

        partie.lastActivity = new Date();
        console.log(`[STORE] ➖ Joueur retiré: ${pseudo}`);
        this.saveToDisk();
        return partie;
    }

    getJoueurs(partieId) {
        const partie = this.getPartie(partieId);
        return partie ? partie.joueurs || [] : [];
    }

    getJoueur(partieId, joueurId) {
        const partie = this.getPartie(partieId);
        if (!partie) return null;
        return partie.joueurs.find(j => j.id === joueurId) || null;
    }

    getJoueurByPseudo(partieId, pseudo) {
        const partie = this.getPartie(partieId);
        if (!partie) return null;
        return partie.joueurs.find(j => j.pseudo === pseudo) || null;
    }

    modifierScore(partieId, pseudo, delta) {
        const partie = this.getPartie(partieId);
        if (!partie) return null;
        if (partie.scores[pseudo] === undefined) partie.scores[pseudo] = 0;
        partie.scores[pseudo] = Math.max(0, partie.scores[pseudo] + delta);
        partie.lastActivity   = new Date();
        console.log(`[STORE] 📊 Score ${pseudo}: ${partie.scores[pseudo]}`);
        this.saveToDisk();
        return partie.scores[pseudo];
    }

    getScores(partieId) {
        const partie = this.getPartie(partieId);
        return partie ? { ...partie.scores } : {};
    }

    setStatut(partieId, statut) {
        const partie = this.getPartie(partieId);
        if (!partie) return null;
        partie.statut       = statut;
        partie.lastActivity = new Date();
        this.saveToDisk();
        return partie;
    }

    snapshotPartie(partieId) {
        const partie = this.getPartie(partieId);
        if (!partie) return null;
        return {
            id           : partie.id,
            nom          : partie.nom,
            jeu          : partie.jeu,
            mode         : partie.mode,
            statut       : partie.statut,
            joueurs      : partie.joueurs || [],
            equipes      : partie.equipes || [],
            scores       : this.getScores(partieId),
            codeCourt    : partie.codeCourt,
            hostId       : partie.hostId,
            hostPseudo   : partie.hostPseudo,
            createdAt    : partie.createdAt,
            lastActivity : partie.lastActivity,
        };
    }

    setHostSocket(partieId, socket) { this.hostSockets.set(partieId, socket); }
    getHostSocket(partieId)         { return this.hostSockets.get(partieId) || null; }

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
        partie.statut       = 'terminee';
        partie.lastActivity = new Date();
        console.log(`[STORE] 🏁 Partie terminée: ${partie.nom} (${partieId})`);
        this.saveToDisk();
        return partie;
    }

    supprimerPartie(partieId) {
        if (!this.parties.has(partieId)) return false;
        this.parties.delete(partieId);
        this.hostSockets.delete(partieId);
        this.joueurSockets.delete(partieId);
        console.log(`[STORE] 🗑️ Partie supprimée: ${partieId}`);
        this.saveToDisk();
        return true;
    }

    // Alias pour compatibilité avec index.js V3
    deletePartie(partieId) { return this.supprimerPartie(partieId); }

    updatePartie(partieId, updates) {
        const partie = this.getPartie(partieId);
        if (!partie) return null;
        Object.assign(partie, updates);
        partie.lastActivity = new Date();
        this.saveToDisk();
        return partie;
    }

    getPartiesActives() {
        return Array.from(this.parties.values()).filter(p => p.statut !== 'terminee');
    }

    nettoyerPartiesAnciennes(ageMaxHeures = 24) {
        const now    = Date.now();
        const ageMax = ageMaxHeures * 60 * 60 * 1000;
        let supprimees = 0;

        this.parties.forEach((partie, id) => {
            const lastActivity = partie.lastActivity?.getTime() || partie.createdAt?.getTime() || 0;
            if (partie.statut === 'terminee' && (now - lastActivity > ageMax)) {
                this.parties.delete(id);
                this.hostSockets.delete(id);
                this.joueurSockets.delete(id);
                supprimees++;
            }
        });

        if (supprimees > 0) {
            console.log(`[STORE] 🧹 ${supprimees} partie(s) ancienne(s) supprimée(s)`);
            this.saveToDisk();
        }
    }

    resetStore() {
        this.parties.clear();
        this.hostSockets.clear();
        this.joueurSockets.clear();
    }

    debug(partieId) {
        const partie = this.getPartie(partieId);
        if (!partie) { console.log(`[STORE] DEBUG — Partie ${partieId} introuvable`); return; }
        console.log(`\n[STORE] DEBUG — ${partie.id}`);
        console.log(`  Nom: ${partie.nom} | Statut: ${partie.statut} | Code: ${partie.codeCourt}`);
        console.log(`  Joueurs (${partie.joueurs.length}): ${partie.joueurs.map(j => j.pseudo).join(', ')}`);
        console.log(`  Scores: ${JSON.stringify(partie.scores)}`);
    }
}

const store = new Store();
export default store;