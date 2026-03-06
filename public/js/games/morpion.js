// ======================================================
// 🎮 MORPION - MODE CLASSIQUE & AVANCÉ (2-4 JOUEURS)
// ======================================================

import { $, $$, show, hide } from "/js/core/dom.js";
import { GameState } from "../core/state.js";
import { ajouterPoints } from "../modules/scoreboard.js";

// ======================================================
// 🎨 CONFIGURATION DES SYMBOLES
// ======================================================
const SYMBOLES = {
    joueur1: { symbol: "X", color: "#e74c3c", name: "X" },
    joueur2: { symbol: "O", color: "#3498db", name: "O" },
    joueur3: { symbol: "△", color: "#2ecc71", name: "△" },
    joueur4: { symbol: "□", color: "#f39c12", name: "□" }
};

// ======================================================
// 🎯 CLASSE PRINCIPALE MORPION
// ======================================================
class MorpionGame {
    constructor() {
        this.joueurs = [];
        this.equipes = [];
        this.grilleTaille = 3;
        this.alignementRequis = 3;
        this.plateau = [];
        this.tourActuel = 0;
        this.modeAvance = false;
        this.jetonsBloquage = {};
        this.partieTerminee = false;

        // ✔️ Nouveau container compatible avec ton HTML
        this.container = document.getElementById("morpion-container");
    }

    // ======================================================
    // 📋 INITIALISATION
    // ======================================================
    initialiser() {
        console.log("[MORPION] Initialisation du jeu");

        this.preparerJoueurs();
        this.afficherEcranConfiguration();
    }



    // ======================================================
    // 👥 PRÉPARATION DES JOUEURS
    // ======================================================
    preparerJoueurs() {
        const nbJoueurs = GameState.joueurs.length;

        console.log("[MORPION] Nombre de joueurs:", nbJoueurs);
        console.log("[MORPION] Mode:", GameState.mode);

        if (GameState.mode === "solo") {
            // Mode SOLO
            this.joueurs = GameState.joueurs.map((nom, index) => ({
                nom: nom,
                symbole: SYMBOLES[`joueur${index + 1}`],
                equipe: null,
                index: index
            }));
        } else {
            // Mode ÉQUIPES
            if (nbJoueurs === 4) {
                // 4 joueurs = obligatoirement 2v2
                const equipe1 = GameState.equipes[0];
                const equipe2 = GameState.equipes[1];

                this.equipes = [
                    { nom: equipe1.nom, membres: equipe1.joueurs },
                    { nom: equipe2.nom, membres: equipe2.joueurs }
                ];

                // Créer les joueurs avec alternance équipe A/B/A/B
                this.joueurs = [
                    {
                        nom: equipe1.joueurs[0],
                        symbole: SYMBOLES.joueur1,
                        equipe: 0,
                        equipeNom: equipe1.nom,
                        index: 0
                    },
                    {
                        nom: equipe2.joueurs[0],
                        symbole: SYMBOLES.joueur2,
                        equipe: 1,
                        equipeNom: equipe2.nom,
                        index: 1
                    },
                    {
                        nom: equipe1.joueurs[1],
                        symbole: SYMBOLES.joueur3,
                        equipe: 0,
                        equipeNom: equipe1.nom,
                        index: 2
                    },
                    {
                        nom: equipe2.joueurs[1],
                        symbole: SYMBOLES.joueur4,
                        equipe: 1,
                        equipeNom: equipe2.nom,
                        index: 3
                    }
                ];

                // Initialiser les jetons de blocage pour chaque équipe
                this.jetonsBloquage = { 0: 1, 1: 1 };
            } else {
                // 2 ou 3 joueurs = chacun pour soi (même en mode équipe)
                this.joueurs = GameState.joueurs.map((nom, index) => ({
                    nom: nom,
                    symbole: SYMBOLES[`joueur${index + 1}`],
                    equipe: null,
                    index: index
                }));
            }
        }

        console.log("[MORPION] Joueurs préparés:", this.joueurs);
    }

// ======================================================
// 🎛️ ÉCRAN DE CONFIGURATION
// ======================================================
afficherEcranConfiguration() {
    this.container.innerHTML = `
        <!-- 🔙 Bouton Retour en haut -->

        <section class="game-section">
            <h2>Configuration</h2>
            
            <div class="config-block">
                <h3>👥 Joueurs (${this.joueurs.length})</h3>
                <div class="joueurs-list">
                    ${this.joueurs.map(j => `
                        <div class="joueur-item">
                            <span class="joueur-symbole" style="color: ${j.symbole.color}; font-size: 24px;">
                                ${j.symbole.symbol}
                            </span>
                            <span class="joueur-nom">${j.nom}</span>
                            ${j.equipe !== null ? `<span class="joueur-equipe">(${j.equipeNom})</span>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="config-block">
                <h3>📐 Taille de la grille</h3>
                <div class="taille-options">
                    ${this.genererOptionsTaille()}
                </div>
            </div>

            <div class="config-block">
                <h3>🎮 Mode de jeu</h3>
                <div class="mode-options">
                    <button class="mode-btn" data-mode="classique">
                        <span class="mode-icon">🟢</span>
                        <span class="mode-title">Mode Classique</span>
                        <span class="mode-desc">Règles standards</span>
                    </button>
                    <button class="mode-btn" data-mode="avance">
                        <span class="mode-icon">🔵</span>
                        <span class="mode-title">Mode Avancé</span>
                        <span class="mode-desc">Règles tactiques</span>
                    </button>
                </div>
            </div>

            <button id="btn-start-morpion" class="btn-primary">
                <span>🚀</span> Commencer la partie
            </button>
        </section>
    `;

    // 🔧 Initialisation des listeners internes
    this.initConfigListeners();

    // 🔙 Activation du bouton retour
    const btnRetour = document.getElementById("btn-retour-morpion");
    if (btnRetour) {
        btnRetour.onclick = () => {

            // On vide le contenu dynamique du Morpion
            this.container.innerHTML = "";

            // On masque l'écran Morpion
            hide("morpion");

            // On masque le scoreboard si nécessaire
            if (typeof masquerScoreboard === "function") {
                masquerScoreboard();
            }

            // On revient à l'écran précédent (form-solo ou choix-jeu)
            show("form-solo");
        };
    }
}

// ======================================================
// 📏 GÉNÉRER LES OPTIONS DE TAILLE
// ======================================================
genererOptionsTaille() {
    const nbJoueurs = this.joueurs.length;
    let options = [];

    switch (nbJoueurs) {
        case 2:
            options = [
                { taille: 3, obligatoire: true },
                { taille: 4, obligatoire: false },
                { taille: 5, obligatoire: false }
            ];
            break;

        case 3:
            options = [
                { taille: 4, obligatoire: true },
                { taille: 5, obligatoire: false }
            ];
            break;

        case 4:
            options = [
                { taille: 5, obligatoire: true }
            ];
            break;
    }

    return options
        .map(opt => `
            <button class="taille-btn ${opt.obligatoire ? 'selected' : ''}" data-taille="${opt.taille}">
                ${opt.taille}×${opt.taille}
                ${opt.obligatoire ? '<span class="badge">Recommandé</span>' : ''}
            </button>
        `)
        .join('');
}

// ======================================================
// 🎧 LISTENERS DE CONFIGURATION
// ======================================================
initConfigListeners() {

    // Sélection de la taille
    document.querySelectorAll('.taille-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.taille-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');

            this.grilleTaille = parseInt(btn.dataset.taille);

            // ✔ Toujours aligner 3, quelle que soit la taille
            this.alignementRequis = 3;

            console.log("[MORPION] Taille sélectionnée:", this.grilleTaille);
        };
    });

    // Sélection du mode
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            this.modeAvance = btn.dataset.mode === 'avance';
            console.log("[MORPION] Mode avancé:", this.modeAvance);
        };
    });

    // Démarrer la partie
    const btnStart = document.getElementById('btn-start-morpion');
    if (btnStart) {
        btnStart.onclick = () => this.demarrerPartie();
    }

    // Sélection par défaut
    const nbJoueurs = this.joueurs.length;

    if (nbJoueurs === 2) this.grilleTaille = 3;
    else if (nbJoueurs === 3) this.grilleTaille = 4;
    else this.grilleTaille = 5;

    // ✔ Toujours aligner 3, même si la grille change
    this.alignementRequis = 3;
}

    // ======================================================
    // 🎮 DÉMARRER LA PARTIE
    // ======================================================
    demarrerPartie() {
        console.log("[MORPION] Démarrage de la partie");
        console.log("[MORPION] Grille:", `${this.grilleTaille}×${this.grilleTaille}`);
        console.log("[MORPION] Alignement requis:", this.alignementRequis);
        console.log("[MORPION] Mode avancé:", this.modeAvance);

        // Initialiser le plateau
        this.plateau = Array(this.grilleTaille).fill(null).map(() =>
            Array(this.grilleTaille).fill(null)
        );

        this.tourActuel = 0;
        this.partieTerminee = false;

        this.afficherPlateau();
    }

    // ======================================================
    // 🎨 AFFICHER LE PLATEAU DE JEU
    // ======================================================
    afficherPlateau() {
        const joueurActuel = this.joueurs[this.tourActuel % this.joueurs.length];

        this.container.innerHTML = `
            <section id="morpion-game" class="game-section">
                <div class="morpion-header">
                    <h2>Morpion ${this.grilleTaille}×${this.grilleTaille}</h2>
                    <div class="mode-badge">${this.modeAvance ? '🔵 Mode Avancé' : '🟢 Mode Classique'}</div>
                </div>

                <div class="tour-actuel">
                    <span>Tour de</span>
                    <span class="joueur-actuel" style="color: ${joueurActuel.symbole.color}">
                        ${joueurActuel.symbole.symbol} ${joueurActuel.nom}
                    </span>
                    ${joueurActuel.equipe !== null ? `<span class="equipe-nom">(${joueurActuel.equipeNom})</span>` : ''}
                </div>

                ${this.modeAvance && this.joueurs.length === 4 ? this.afficherJetonsBloquage() : ''}

                <div class="morpion-grille" style="
                    grid-template-columns: repeat(${this.grilleTaille}, 1fr);
                    grid-template-rows: repeat(${this.grilleTaille}, 1fr);
                ">
                    ${this.genererCases()}
                </div>

                <button id="btn-restart-morpion" class="btn-secondary">
                    🔄 Recommencer
                </button>
            </section>
        `;

        this.initPlateauListeners();
    }

    // ======================================================
    // 🎟️ AFFICHER LES JETONS DE BLOCAGE
    // ======================================================
    afficherJetonsBloquage() {
        return `
            <div class="jetons-bloquage">
                <div class="jeton-equipe">
                    <span class="jeton-label">${this.equipes[0].nom}</span>
                    <span class="jeton-count">${this.jetonsBloquage[0]} 🎟️</span>
                </div>
                <div class="jeton-equipe">
                    <span class="jeton-label">${this.equipes[1].nom}</span>
                    <span class="jeton-count">${this.jetonsBloquage[1]} 🎟️</span>
                </div>
            </div>
        `;
    }

    // ======================================================
    // 🎲 GÉNÉRER LES CASES DU PLATEAU
    // ======================================================
    genererCases() {
        let html = '';
        for (let i = 0; i < this.grilleTaille; i++) {
            for (let j = 0; j < this.grilleTaille; j++) {
                const valeur = this.plateau[i][j];
                const symbole = valeur ? valeur.symbole : '';
                const color = valeur ? valeur.color : '';

                html += `
                    <div class="morpion-case ${valeur ? 'occupied' : ''}" 
                         data-row="${i}" 
                         data-col="${j}"
                         style="${valeur ? `color: ${color}` : ''}">
                        ${symbole}
                    </div>
                `;
            }
        }
        return html;
    }

    // ======================================================
    // 🎧 LISTENERS DU PLATEAU
    // ======================================================
    initPlateauListeners() {
        document.querySelectorAll('.morpion-case').forEach(caseDiv => {
            caseDiv.onclick = () => {
                if (this.partieTerminee) return;

                const row = parseInt(caseDiv.dataset.row);
                const col = parseInt(caseDiv.dataset.col);

                this.jouerCoup(row, col);
            };
        });

        const btnRestart = document.getElementById('btn-restart-morpion');
        if (btnRestart) {
            btnRestart.onclick = () => this.afficherEcranConfiguration();
        }
    }

    // ======================================================
    // 🎯 JOUER UN COUP
    // ======================================================
    jouerCoup(row, col) {
        // Vérifier si la case est vide
        if (this.plateau[row][col] !== null) {
            alert("⚠️ Cette case est déjà occupée !");
            return;
        }

        const joueur = this.joueurs[this.tourActuel % this.joueurs.length];

        // MODE AVANCÉ : Vérifier l'interdiction du blocage pur
        if (this.modeAvance) {
            const coupsGagnants = this.trouverCoupsGagnants(joueur);

            if (coupsGagnants.length > 0) {
                // Le joueur a au moins un coup gagnant
                const estCoupGagnant = coupsGagnants.some(
                    coup => coup.row === row && coup.col === col
                );

                if (!estCoupGagnant) {
                    // Coup non gagnant alors qu'il existe un coup gagnant

                    // En 2v2, possibilité d'utiliser un jeton de blocage
                    if (this.joueurs.length === 4 && joueur.equipe !== null) {
                        const equipe = joueur.equipe;

                        if (this.jetonsBloquage[equipe] > 0) {
                            const utiliserJeton = confirm(
                                `⚠️ Tu as un coup gagnant disponible !\n\n` +
                                `Veux-tu utiliser ton jeton de blocage (${this.jetonsBloquage[equipe]} restant) ` +
                                `pour jouer ce coup défensif ?`
                            );

                            if (utiliserJeton) {
                                this.jetonsBloquage[equipe]--;
                                console.log("[MORPION] Jeton de blocage utilisé par l'équipe", equipe);
                            } else {
                                alert("❌ Tu dois jouer un coup gagnant ou utiliser un jeton de blocage !");
                                return;
                            }
                        } else {
                            alert("❌ Tu as un coup gagnant disponible ! Tu dois le jouer.");
                            return;
                        }
                    } else {
                        alert("❌ Tu as un coup gagnant disponible ! Tu dois le jouer.");
                        return;
                    }
                }
            }
        }

        // Jouer le coup
        this.plateau[row][col] = {
            symbole: joueur.symbole.symbol,
            color: joueur.symbole.color,
            joueur: joueur.index,
            equipe: joueur.equipe
        };

        console.log("[MORPION] Coup joué:", { row, col, joueur: joueur.nom });

        // Vérifier la victoire
        if (this.verifierVictoire(joueur)) {
            this.afficherPlateau();
            this.gererVictoire(joueur);
            return;
        }

        // Vérifier le match nul
        if (this.verifierMatchNul()) {
            this.afficherPlateau();
            this.gererMatchNul();
            return;
        }

        // Passer au joueur suivant
        this.tourActuel++;
        this.afficherPlateau();
    }

    // ======================================================
    // 🔍 TROUVER LES COUPS GAGNANTS
    // ======================================================
    trouverCoupsGagnants(joueur) {
        const coupsGagnants = [];

        for (let i = 0; i < this.grilleTaille; i++) {
            for (let j = 0; j < this.grilleTaille; j++) {
                if (this.plateau[i][j] === null) {
                    // Simuler le coup
                    this.plateau[i][j] = {
                        symbole: joueur.symbole.symbol,
                        color: joueur.symbole.color,
                        joueur: joueur.index,
                        equipe: joueur.equipe
                    };

                    // Vérifier si c'est gagnant
                    if (this.verifierVictoire(joueur)) {
                        coupsGagnants.push({ row: i, col: j });
                    }

                    // Annuler le coup
                    this.plateau[i][j] = null;
                }
            }
        }

        return coupsGagnants;
    }

    // ======================================================
    // 🏆 VÉRIFIER LA VICTOIRE
    // ======================================================
    verifierVictoire(joueur) {
        // En équipe, les symboles des coéquipiers comptent
        const symbolesAllies = this.obtenirSymbolesAllies(joueur);

        // Vérifier toutes les lignes
        for (let i = 0; i < this.grilleTaille; i++) {
            if (this.verifierLigne(i, symbolesAllies)) return true;
        }

        // Vérifier toutes les colonnes
        for (let j = 0; j < this.grilleTaille; j++) {
            if (this.verifierColonne(j, symbolesAllies)) return true;
        }

        // Vérifier les diagonales
        if (this.verifierDiagonales(symbolesAllies)) return true;

        return false;
    }

    // ======================================================
    // 👥 OBTENIR LES SYMBOLES ALLIÉS
    // ======================================================
    obtenirSymbolesAllies(joueur) {
        if (joueur.equipe === null) {
            // Joueur seul
            return [joueur.index];
        } else {
            // Équipe : tous les joueurs de la même équipe
            return this.joueurs
                .filter(j => j.equipe === joueur.equipe)
                .map(j => j.index);
        }
    }

    // ======================================================
    // 📏 VÉRIFICATIONS D'ALIGNEMENT
    // ======================================================
    verifierLigne(row, symbolesAllies) {
        for (let col = 0; col <= this.grilleTaille - this.alignementRequis; col++) {
            let count = 0;
            for (let k = 0; k < this.alignementRequis; k++) {
                const cell = this.plateau[row][col + k];
                if (cell && symbolesAllies.includes(cell.joueur)) {
                    count++;
                }
            }
            if (count === this.alignementRequis) return true;
        }
        return false;
    }

    verifierColonne(col, symbolesAllies) {
        for (let row = 0; row <= this.grilleTaille - this.alignementRequis; row++) {
            let count = 0;
            for (let k = 0; k < this.alignementRequis; k++) {
                const cell = this.plateau[row + k][col];
                if (cell && symbolesAllies.includes(cell.joueur)) {
                    count++;
                }
            }
            if (count === this.alignementRequis) return true;
        }
        return false;
    }

    verifierDiagonales(symbolesAllies) {
        // Diagonales descendantes
        for (let row = 0; row <= this.grilleTaille - this.alignementRequis; row++) {
            for (let col = 0; col <= this.grilleTaille - this.alignementRequis; col++) {
                let count = 0;
                for (let k = 0; k < this.alignementRequis; k++) {
                    const cell = this.plateau[row + k][col + k];
                    if (cell && symbolesAllies.includes(cell.joueur)) {
                        count++;
                    }
                }
                if (count === this.alignementRequis) return true;
            }
        }

        // Diagonales montantes
        for (let row = this.alignementRequis - 1; row < this.grilleTaille; row++) {
            for (let col = 0; col <= this.grilleTaille - this.alignementRequis; col++) {
                let count = 0;
                for (let k = 0; k < this.alignementRequis; k++) {
                    const cell = this.plateau[row - k][col + k];
                    if (cell && symbolesAllies.includes(cell.joueur)) {
                        count++;
                    }
                }
                if (count === this.alignementRequis) return true;
            }
        }

        return false;
    }

    // ======================================================
    // 🤝 VÉRIFIER LE MATCH NUL
    // ======================================================
    verifierMatchNul() {
        return this.plateau.every(row => row.every(cell => cell !== null));
    }

    // ======================================================
    // 🎉 GÉRER LA VICTOIRE
    // ======================================================
    gererVictoire(joueur) {
        this.partieTerminee = true;

        let message = '';
        let gagnants = [];

        if (joueur.equipe === null) {
            // Victoire individuelle
            message = `🏆 ${joueur.nom} a gagné !`;
            gagnants = [joueur.nom];
        } else {
            // Victoire d'équipe
            const equipe = this.equipes[joueur.equipe];
            message = `🏆 L'équipe ${equipe.nom} a gagné !`;
            gagnants = equipe.membres;
        }

        setTimeout(() => {
            alert(message);

            // Attribuer les points
            gagnants.forEach(nomJoueur => {
                ajouterPoints(nomJoueur, 3);
            });

            console.log("[MORPION] Victoire:", gagnants);
        }, 100);
    }

    // ======================================================
    // 😐 GÉRER LE MATCH NUL
    // ======================================================
    gererMatchNul() {
        this.partieTerminee = true;

        setTimeout(() => {
            alert("🤝 Match nul ! La grille est pleine.");
            console.log("[MORPION] Match nul");
        }, 100);
    }
}

// ======================================================
// 🚀 FONCTION D'INITIALISATION GLOBALE
// ======================================================
export function initialiserMorpion() {
    console.log("[MORPION] ===== INITIALISATION =====");

    const game = new MorpionGame();
    game.initialiser();
}

// Export global pour compatibility
window.initialiserMorpion = initialiserMorpion;