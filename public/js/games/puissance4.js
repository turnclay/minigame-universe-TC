/**
 * ============================================
 * 🔴 PUISSANCE 4
 * ============================================
 * Jeu de stratégie classique avec gravité
 * Version: 1.0
 */

import { GameState } from "../core/state.js";
import { modifierScore } from "../modules/scoreboard.js";

// ============================================
// 🎯 CONSTANTES
// ============================================

const ROWS = 6;
const COLS = 7;
const COLORS = ['🔴', '🟡', '🔵'];

// ============================================
// 🎮 VARIABLES D'ÉTAT
// ============================================

let grille = [];
let joueurActuel = 0;
let joueurs = [];
let partieTerminee = false;
let couleurs = {};

// ============================================
// 🎨 CRÉATION DE LA GRILLE
// ============================================

function creerGrille() {
    const grilleElement = document.getElementById("puissance4-grille");
    if (!grilleElement) return;

    grilleElement.innerHTML = "";
    grille = Array(ROWS).fill(null).map(() => Array(COLS).fill(null));

    // Créer les colonnes cliquables
    for (let col = 0; col < COLS; col++) {
        const colonne = document.createElement("div");
        colonne.className = "p4-colonne";
        colonne.dataset.col = col;

        // Créer les cellules de la colonne
        for (let row = 0; row < ROWS; row++) {
            const cellule = document.createElement("div");
            cellule.className = "p4-cellule";
            cellule.dataset.row = row;
            cellule.dataset.col = col;
            colonne.appendChild(cellule);
        }

        // Événement de clic sur la colonne
        colonne.addEventListener("click", () => jouerColonne(col));

        // Effet hover
        colonne.addEventListener("mouseenter", () => {
            if (!partieTerminee) {
                colonne.classList.add("p4-colonne-hover");
            }
        });

        colonne.addEventListener("mouseleave", () => {
            colonne.classList.remove("p4-colonne-hover");
        });

        grilleElement.appendChild(colonne);
    }
}

// ============================================
// 🎲 LOGIQUE DE JEU
// ============================================

function jouerColonne(col) {
    if (partieTerminee) return;

    // Trouver la première case vide en partant du bas (gravité)
    let row = -1;
    for (let r = ROWS - 1; r >= 0; r--) {
        if (grille[r][col] === null) {
            row = r;
            break;
        }
    }

    // Colonne pleine
    if (row === -1) {
        animerColonnePleine(col);
        return;
    }

    // Placer le jeton
    grille[row][col] = joueurActuel;
    const cellule = document.querySelector(
        `.p4-cellule[data-row="${row}"][data-col="${col}"]`
    );

    if (cellule) {
        // Animation de chute
        animerChute(cellule, row, couleurs[joueurs[joueurActuel]]);
    }

    // Vérifier la victoire
    if (verifierVictoire(row, col)) {
        setTimeout(() => {
            afficherVictoire(joueurs[joueurActuel]);
        }, 600);
        return;
    }

    // Vérifier match nul
    if (grilleComplete()) {
        setTimeout(() => {
            afficherMatchNul();
        }, 600);
        return;
    }

    // Joueur suivant
    joueurActuel = (joueurActuel + 1) % joueurs.length;
    mettreAJourStatus();
}

// ============================================
// 🎬 ANIMATIONS
// ============================================

function animerChute(cellule, rowFinale, couleur) {
    // Créer un jeton qui tombe
    const jeton = document.createElement("div");
    jeton.className = "p4-jeton p4-jeton-chute";
    jeton.textContent = couleur;
    cellule.appendChild(jeton);

    // Déclencher l'animation
    setTimeout(() => {
        jeton.classList.remove("p4-jeton-chute");
        jeton.classList.add("p4-jeton-pose");
    }, 10);
}

function animerColonnePleine(col) {
    const colonne = document.querySelector(`.p4-colonne[data-col="${col}"]`);
    if (colonne) {
        colonne.classList.add("p4-colonne-pleine");
        setTimeout(() => {
            colonne.classList.remove("p4-colonne-pleine");
        }, 500);
    }
}

function animerVictoire(cellules) {
    cellules.forEach(({row, col}) => {
        const cellule = document.querySelector(
            `.p4-cellule[data-row="${row}"][data-col="${col}"]`
        );
        if (cellule) {
            const jeton = cellule.querySelector(".p4-jeton");
            if (jeton) {
                jeton.classList.add("p4-jeton-gagnant");
            }
        }
    });
}

// ============================================
// 🏆 VÉRIFICATION DE VICTOIRE
// ============================================

function verifierVictoire(row, col) {
    const directions = [
        {dr: 0, dc: 1},   // Horizontal
        {dr: 1, dc: 0},   // Vertical
        {dr: 1, dc: 1},   // Diagonal \
        {dr: 1, dc: -1}   // Diagonal /
    ];

    for (const {dr, dc} of directions) {
        const alignes = compterAlignes(row, col, dr, dc);
        if (alignes.length >= 4) {
            animerVictoire(alignes);
            return true;
        }
    }

    return false;
}

function compterAlignes(row, col, dr, dc) {
    const joueur = grille[row][col];
    const alignes = [{row, col}];

    // Vérifier dans une direction
    for (let i = 1; i < 4; i++) {
        const r = row + dr * i;
        const c = col + dc * i;
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) break;
        if (grille[r][c] !== joueur) break;
        alignes.push({row: r, col: c});
    }

    // Vérifier dans l'autre direction
    for (let i = 1; i < 4; i++) {
        const r = row - dr * i;
        const c = col - dc * i;
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) break;
        if (grille[r][c] !== joueur) break;
        alignes.push({row: r, col: c});
    }

    return alignes;
}

function grilleComplete() {
    return grille[0].every(cell => cell !== null);
}

// ============================================
// 📊 AFFICHAGE
// ============================================

function mettreAJourStatus() {
    const status = document.getElementById("puissance4-status");
    if (status && !partieTerminee) {
        const nomJoueur = joueurs[joueurActuel];
        const couleur = couleurs[nomJoueur];
        status.textContent = `Au tour de : ${couleur} ${nomJoueur}`;
        status.className = "puissance4-status";
    }
}

function afficherVictoire(gagnant, cellulesGagnantes = []) {
    partieTerminee = true;
    const status = document.getElementById("puissance4-status");

    // Mise à jour du texte de victoire
    if (status) {
        const couleur = couleurs[gagnant];
        status.textContent = `🎉 ${gagnant} a gagné ! ${couleur}`;
        status.className = "puissance4-status puissance4-victoire";
    }

    // 🎨 Appliquer la classe d’animation selon la couleur du gagnant
    const classeWin = couleurs[gagnant] === "jaune" ? "win-yellow" : "win-red";

    cellulesGagnantes.forEach(cell => {
        if (cell) cell.classList.add(classeWin);
    });

    // Ajouter des points au gagnant
    if (GameState.mode === "solo") {
        modifierScore(gagnant, 4);
    } else if (GameState.mode === "team") {
        const equipeGagnante = GameState.equipes.find(eq =>
            eq.joueurs.includes(gagnant)
        );
        if (equipeGagnante) {
            modifierScore(equipeGagnante.nom, 10);
        }
    }

    // Afficher le bouton rejouer
    const btnRejouer = document.getElementById("puissance4-rejouer");
    if (btnRejouer) {
        btnRejouer.style.display = "block";
    }
}

function afficherMatchNul() {
    partieTerminee = true;
    const status = document.getElementById("puissance4-status");

    if (status) {
        status.textContent = "🤝 Match nul !";
        status.className = "puissance4-status puissance4-nul";
    }

    const btnRejouer = document.getElementById("puissance4-rejouer");
    if (btnRejouer) {
        btnRejouer.style.display = "block";
    }
}

// ============================================
// 🔄 NOUVELLE PARTIE
// ============================================

function nouvellePartie() {
    partieTerminee = false;
    joueurActuel = 0;
    creerGrille();
    mettreAJourStatus();

    const btnRejouer = document.getElementById("puissance4-rejouer");
    if (btnRejouer) {
        btnRejouer.style.display = "none";
    }
}

// ============================================
// 🚀 INITIALISATION
// ============================================

function initialiserPuissance4() {
    console.log("[PUISSANCE4] Initialisation");

    // Récupérer les joueurs
    if (GameState.mode === "solo") {
        joueurs = [...GameState.joueurs];
    } else if (GameState.mode === "team") {
        joueurs = GameState.equipes.map(eq => eq.nom);
    }

    // Limiter à 3 joueurs maximum
    if (joueurs.length > 3) {
        joueurs = joueurs.slice(0, 3);
    }

    // Minimum 2 joueurs
    if (joueurs.length < 2) {
        alert("Il faut au moins 2 joueurs pour jouer à Puissance 4.");
        window.afficherAccueilJeux();
        return;
    }

    // Assigner des couleurs
    couleurs = {};
    joueurs.forEach((joueur, index) => {
        couleurs[joueur] = COLORS[index % COLORS.length];
    });

    // Initialiser le bouton rejouer
    const btnRejouer = document.getElementById("puissance4-rejouer");
    if (btnRejouer) {
        btnRejouer.style.display = "none";
        btnRejouer.onclick = nouvellePartie;
    }

    // Démarrer la partie
    nouvellePartie();

    console.log("[PUISSANCE4] Joueurs:", joueurs);
    console.log("[PUISSANCE4] Couleurs:", couleurs);
}

// ============================================
// 📤 EXPORTS
// ============================================

window.initialiserPuissance4 = initialiserPuissance4;

export { initialiserPuissance4 };