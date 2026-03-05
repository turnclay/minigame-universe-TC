/**
 * ============================================
 * 📝 PETITBAC.JS - Jeu du Petit Bac
 * ============================================
 * Version: 1.0
 */

import { GameState } from "../core/state.js";
import { modifierScore } from "../modules/scoreboard.js";

// ============================================
// 📦 VARIABLES GLOBALES
// ============================================

let timerInterval = null;
let tempsRestant = 120; // 2 minutes en secondes
let lettreActuelle = "";
let reponses = {};

// Catégories du Petit Bac
const CATEGORIES = [
    { id: "prenom", label: "Prénom", icon: "👤" },
    { id: "ville", label: "Ville", icon: "🏙️" },
    { id: "pays", label: "Pays", icon: "🌍" },
    { id: "animal", label: "Animal", icon: "🐾" },
    { id: "fruit", label: "Fruit/Légume", icon: "🍎" },
    { id: "metier", label: "Métier", icon: "💼" },
    { id: "objet", label: "Objet", icon: "📦" },
    { id: "marque", label: "Marque", icon: "🏷️" },
    { id: "personnage", label: "Personnage fictif", icon: "🧚" },
    { id: "celebrite", label: "Célébrité", icon: "🌟" }
];

// Lettres utilisables (sans Q, W, X, Y, Z pour faciliter)
const LETTRES = "ABCDEFGHIJKLMNOPRSTUVW".split("");

// ============================================
// 🎯 INITIALISATION
// ============================================

function initialiserPetitBac() {
    console.log("[PETITBAC] Initialisation du jeu");

    // Réinitialiser les variables
    resetJeu();

    // Tirer une lettre aléatoire
    tirerLettre();

    // Créer les champs de saisie pour chaque catégorie
    afficherCategories();

    // Démarrer le timer
    demarrerTimer();

    // Configurer le bouton de validation
    configurerBoutonValidation();
}

// Fonction globale pour main.js
window.initialiserPetitBac = initialiserPetitBac;

// ============================================
// 🔄 RÉINITIALISATION
// ============================================

function resetJeu() {
    tempsRestant = 120;
    lettreActuelle = "";
    reponses = {};

    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }

    // Réinitialiser l'affichage du timer
    const timerDisplay = document.getElementById("petitbac-timer");
    if (timerDisplay) {
        timerDisplay.textContent = "02:00";
        timerDisplay.classList.remove("clignote");
    }
}

// ============================================
// 🎲 TIRER UNE LETTRE
// ============================================

function tirerLettre() {
    lettreActuelle = LETTRES[Math.floor(Math.random() * LETTRES.length)];

    const lettreDisplay = document.getElementById("petitbac-lettre-actuelle");
    if (lettreDisplay) {
        lettreDisplay.textContent = lettreActuelle;
        lettreDisplay.style.animation = "none";
        setTimeout(() => {
            lettreDisplay.style.animation = "bounceIn 0.6s ease-out";
        }, 10);
    }

    console.log("[PETITBAC] Lettre tirée:", lettreActuelle);
}

// ============================================
// 🖥️ AFFICHER LES CATÉGORIES
// ============================================

function afficherCategories() {
    const container = document.getElementById("petitbac-categories");
    if (!container) return;

    container.innerHTML = "";

    CATEGORIES.forEach(categorie => {
        const categorieCard = document.createElement("div");
        categorieCard.className = "petitbac-categorie-card";

        categorieCard.innerHTML = `
            <div class="categorie-header">
                <span class="categorie-icon">${categorie.icon}</span>
                <h3 class="categorie-label">${categorie.label}</h3>
            </div>
            <input
                type="text"
                id="input-${categorie.id}"
                class="petitbac-input"
                placeholder="Votre réponse..."
                maxlength="30"
                autocomplete="off"
            >
            <div class="validation-feedback" id="feedback-${categorie.id}"></div>
        `;

        container.appendChild(categorieCard);

        // Ajouter un écouteur pour normaliser la saisie
        const input = document.getElementById(`input-${categorie.id}`);
        if (input) {
            input.addEventListener("input", (e) => {
                // Mettre en majuscule la première lettre
                if (e.target.value.length === 1) {
                    e.target.value = e.target.value.toUpperCase();
                }
            });
        }
    });
}

// ============================================
// ⏱️ GESTION DU TIMER
// ============================================

function demarrerTimer() {
    const timerDisplay = document.getElementById("petitbac-timer");

    timerInterval = setInterval(() => {
        tempsRestant--;

        // Mise à jour de l'affichage
        const minutes = Math.floor(tempsRestant / 60);
        const secondes = tempsRestant % 60;

        if (timerDisplay) {
            timerDisplay.textContent =
                `${String(minutes).padStart(2, '0')}:${String(secondes).padStart(2, '0')}`;
        }

        // Alerte visuelle à 30 secondes
        if (tempsRestant === 30 && timerDisplay) {
            timerDisplay.classList.add("clignote");
        }

        // Temps écoulé
        if (tempsRestant <= 0) {
            finPartieAutomatique();
        }

    }, 1000);
}

// ============================================
// ✅ VALIDATION DES RÉPONSES
// ============================================

function configurerBoutonValidation() {
    const btnValider = document.getElementById("petitbac-valider");
    if (!btnValider) return;

    btnValider.onclick = () => {
        validerReponses();
    };
}

function validerReponses() {
    console.log("[PETITBAC] Validation des réponses");

    // Arrêter le timer
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }

    let score = 0;
    reponses = {};

    // Parcourir chaque catégorie
    CATEGORIES.forEach(categorie => {
        const input = document.getElementById(`input-${categorie.id}`);
        const feedback = document.getElementById(`feedback-${categorie.id}`);

        if (!input || !feedback) return;

        const valeur = input.value.trim();
        reponses[categorie.id] = valeur;

        // Validation
        if (valeur === "") {
            // Vide
            feedback.innerHTML = '<span class="feedback-vide">❌ Vide</span>';
            feedback.className = "validation-feedback vide";
        } else if (valeur.charAt(0).toUpperCase() !== lettreActuelle) {
            // Mauvaise lettre
            feedback.innerHTML = `<span class="feedback-invalide">❌ Ne commence pas par ${lettreActuelle}</span>`;
            feedback.className = "validation-feedback invalide";
        } else {
            // Valide
            score += 1;
            feedback.innerHTML = '<span class="feedback-valide">✅ Valide (+10 pts)</span>';
            feedback.className = "validation-feedback valide";
        }

        // Désactiver l'input
        input.disabled = true;
    });

    // Afficher le score
    afficherResultat(score);

    // Enregistrer le score dans le scoreboard
    enregistrerScore(score);
}

// ============================================
// 🏁 FIN DE PARTIE AUTOMATIQUE
// ============================================

function finPartieAutomatique() {
    console.log("[PETITBAC] Fin automatique - Temps écoulé");

    // Arrêter le timer
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }

    // Valider automatiquement
    validerReponses();
}

// ============================================
// 📊 AFFICHAGE DU RÉSULTAT
// ============================================

function afficherResultat(score) {
    const btnValider = document.getElementById("petitbac-valider");
    if (!btnValider) return;

    // Remplacer le bouton valider par un bouton rejouer
    btnValider.textContent = `🎉 Score : ${score} points - Rejouer`;
    btnValider.className = "btn-primary btn-rejouer";

    btnValider.onclick = () => {
        resetJeu();
        tirerLettre();
        afficherCategories();
        demarrerTimer();

        // Réinitialiser le bouton
        btnValider.textContent = "Valider mes réponses";
        btnValider.className = "btn-primary";
        btnValider.onclick = () => validerReponses();
    };
}

// ============================================
// 💾 ENREGISTREMENT DU SCORE
// ============================================

function enregistrerScore(score) {
    // Déterminer le participant actuel
    let participant = null;

    if (GameState.mode === "solo" && GameState.joueurs && GameState.joueurs.length > 0) {
        // En mode solo, on peut faire tourner les joueurs ou prendre le premier
        // Pour simplifier, on prend le premier joueur
        participant = GameState.joueurs[0];
    } else if (GameState.mode === "team" && GameState.equipes && GameState.equipes.length > 0) {
        // En mode équipe, prendre la première équipe
        participant = GameState.equipes[0].nom;
    }

    if (participant) {
        modifierScore(participant, score);
        console.log(`[PETITBAC] Score de ${score} ajouté pour ${participant}`);
    } else {
        console.warn("[PETITBAC] Aucun participant trouvé pour enregistrer le score");
    }
}

// ============================================
// 🎨 ANIMATIONS
// ============================================

// Les animations sont gérées par le CSS

// ============================================
// 📤 EXPORTS
// ============================================

export {
    initialiserPetitBac,
    resetJeu
};