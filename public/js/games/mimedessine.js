/**
 * ============================================
 * 🎭 MIMEDESSINE.JS - Jeu Mimer ou Dessiner
 * ============================================
 * Version: 2.0 - Système de tours
 */

import { GameState } from "../core/state.js";
import { modifierScore } from "../modules/scoreboard.js";
import { loadGame, saveGame } from "../core/storage.js";

// ============================================
// 📦 VARIABLES GLOBALES
// ============================================

let donneesJeu = [];
let categoriesDisponibles = [];
let derniereCategorie = null;
let timerInterval = null;
let tempsRestant = 180; // 3 minutes en secondes
let modeActuel = null; // "mimer" ou "dessiner"
let motActuel = null;
let categorieActuelle = null;

// 🆕 GESTION DES TOURS
let participantActuelIndex = 0;
let participants = []; // Liste des joueurs ou équipes
let scoresParParticipant = {}; // {nom: score}
let mancheEnCours = false;

// ============================================
// 🎯 INITIALISATION
// ============================================

export async function initialiserMimer() {
    console.log("[MIMEDESSINE] Initialisation du jeu");

    // Charger les données JSON
    await chargerDonnees();

    // Initialiser les participants
    initialiserParticipants();

    // Réinitialiser les variables
    resetJeu();

    // Afficher l'écran d'accueil
    afficherEcranAccueil();
}

// Fonction globale pour main.js
window.initialiserMimer = initialiserMimer;

// ============================================
// 👥 INITIALISATION DES PARTICIPANTS
// ============================================

function initialiserParticipants() {
    participants = [];
    scoresParParticipant = {};

    if (GameState.mode === "solo" && GameState.joueurs) {
        participants = [...GameState.joueurs];
    } else if (GameState.mode === "team" && GameState.equipes) {
        participants = GameState.equipes.map(equipe => equipe.nom);
    }

    // Initialiser les scores à 0
    participants.forEach(p => {
        scoresParParticipant[p] = 0;
    });

    console.log("[MIMEDESSINE] Participants initialisés:", participants);
}

// ============================================
// 📥 CHARGEMENT DES DONNÉES
// ============================================

async function chargerDonnees() {
    try {
        const response = await fetch("data/MimeDessine.json");

        if (!response.ok) {
            throw new Error(`Erreur HTTP: ${response.status}`);
        }

        donneesJeu = await response.json();

        // Extraire les catégories disponibles
        if (donneesJeu.length > 0) {
            categoriesDisponibles = Object.keys(donneesJeu[0]);
        }

        console.log("[MIMEDESSINE] Données chargées:", donneesJeu.length, "ensembles");
        console.log("[MIMEDESSINE] Catégories:", categoriesDisponibles);

    } catch (error) {
        console.error("[MIMEDESSINE] Erreur de chargement:", error);
        alert("Erreur lors du chargement des données du jeu.");
    }
}

// ============================================
// 🔄 RÉINITIALISATION
// ============================================

function resetJeu() {
    tempsRestant = 180;
    derniereCategorie = null;
    modeActuel = null;
    motActuel = null;
    categorieActuelle = null;
    participantActuelIndex = 0;
    mancheEnCours = false;

    // Réinitialiser les scores
    participants.forEach(p => {
        scoresParParticipant[p] = 0;
    });

    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }

    // Réinitialiser l'affichage
    const timerDisplay = document.getElementById("mimer-timer");
    if (timerDisplay) {
        timerDisplay.textContent = "03:00";
        timerDisplay.classList.remove("timer-alerte");
    }
}

// ============================================
// 🖥️ AFFICHAGE ÉCRAN D'ACCUEIL
// ============================================

function afficherEcranAccueil() {
    const content = document.getElementById("mimer-content");
    if (!content) return;

    const participantActuel = participants[participantActuelIndex];
    const tourInfo = `Tour ${participantActuelIndex + 1} / ${participants.length}`;

    content.innerHTML = `
        <div class="mimer-accueil">
            <div class="mimer-tour-info">${tourInfo}</div>
            <h2 class="mimer-participant">👤 ${participantActuel}</h2>
            <p class="mimer-instruction">C'est ton tour !</p>
            <p class="mimer-regles">
                ⏱️ Tu as <strong>3 minutes</strong><br>
                🎯 Fais deviner un maximum de mots<br>
                🚫 Tu ne peux pas choisir 2 fois la même catégorie d'affilée
            </p>
            <button id="mimer-demarrer" class="btn-primary btn-large">
                <span class="btn-icon">🚀</span>
                Commencer ma manche
            </button>
        </div>
    `;

    // Bouton démarrer
    const btnDemarrer = document.getElementById("mimer-demarrer");
    if (btnDemarrer) {
        btnDemarrer.onclick = () => demarrerManche();
    }
}

// ============================================
// 🎮 DÉMARRAGE D'UNE MANCHE
// ============================================

function demarrerManche() {
    console.log("[MIMEDESSINE] Démarrage de la manche pour:", participants[participantActuelIndex]);

    mancheEnCours = true;
    tempsRestant = 180;

    // 🔥 Récupérer la partie en cours
    const partie = loadGame();
    if (partie) {
        partie.manche = participantActuelIndex + 1;
        partie.participantActuel = participants[participantActuelIndex];
        partie.scores = scoresParParticipant;

        saveGame(partie); // 🔥 Sauvegarde réelle
    }

    demarrerTimer();
    afficherNouveauDefi();
}

// ============================================
// ⏱️ GESTION DU TIMER
// ============================================

function demarrerTimer() {
    const timerDisplay = document.getElementById("mimer-timer");

    timerInterval = setInterval(() => {
        tempsRestant--;

        // Mise à jour de l'affichage
        const minutes = Math.floor(tempsRestant / 60);
        const secondes = tempsRestant % 60;

        if (timerDisplay) {
            timerDisplay.textContent =
                `${String(minutes).padStart(2, '0')}:${String(secondes).padStart(2, '0')}`;
        }

        // Temps écoulé
        if (tempsRestant <= 0) {
            finManche();
        }

        // Alerte visuelle quand il reste 30 secondes
        if (tempsRestant === 30 && timerDisplay) {
            timerDisplay.classList.add("timer-alerte");
        }

    }, 1000);
}

// ============================================
// 🎲 NOUVEAU DÉFI
// ============================================

function afficherNouveauDefi() {
    const content = document.getElementById("mimer-content");
    if (!content) return;

    // Tirer au sort "mimer" ou "dessiner"
    modeActuel = Math.random() < 0.5 ? "mimer" : "dessiner";

    // Sélectionner une catégorie (différente de la précédente)
    let categoriesPossibles = categoriesDisponibles.filter(cat => cat !== derniereCategorie);

    if (categoriesPossibles.length === 0) {
        categoriesPossibles = [...categoriesDisponibles];
    }

    categorieActuelle = categoriesPossibles[Math.floor(Math.random() * categoriesPossibles.length)];
    derniereCategorie = categorieActuelle;

    const participantActuel = participants[participantActuelIndex];

    // Afficher le mode et la catégorie
    content.innerHTML = `
        <div class="mimer-defi">
            <div class="mimer-participant-badge">🎯 ${participantActuel}</div>

            <div class="mimer-mode-badge ${modeActuel}">
                ${modeActuel === "mimer" ? "🎭 À MIMER" : "✏️ À DESSINER"}
            </div>

            <div class="mimer-categorie">
                <h3>Catégorie :</h3>
                <p class="categorie-nom">${categorieActuelle}</p>
            </div>

            <button id="mimer-reveler" class="btn-primary btn-large">
                <span class="btn-icon">👁️</span>
                Révéler le mot
            </button>
        </div>
    `;

    // Bouton révéler
    const btnReveler = document.getElementById("mimer-reveler");
    if (btnReveler) {
        btnReveler.onclick = () => revelerMot();
    }
}

// ============================================
// 👁️ RÉVÉLER LE MOT
// ============================================

function revelerMot() {
    const content = document.getElementById("mimer-content");
    if (!content) return;

    // Sélectionner un mot aléatoire dans cette catégorie
    const objetAleatoire = donneesJeu[Math.floor(Math.random() * donneesJeu.length)];
    motActuel = objetAleatoire[categorieActuelle];

    const participantActuel = participants[participantActuelIndex];
    const scoreActuel = scoresParParticipant[participantActuel];

    content.innerHTML = `
        <div class="mimer-mot-affiche">
            <div class="mimer-header-info">
                <div class="mimer-participant-badge">🎯 ${participantActuel}</div>
                <div class="mimer-score-mini">Score: ${scoreActuel}</div>
            </div>

            <div class="mimer-mode-badge ${modeActuel}">
                ${modeActuel === "mimer" ? "🎭 À MIMER" : "✏️ À DESSINER"}
            </div>

            <div class="mimer-categorie-mini">${categorieActuelle}</div>

            <div class="mimer-mot-carte">
                <h2>${motActuel}</h2>
            </div>

            <p class="mimer-consigne">
                ${modeActuel === "mimer"
                    ? "👉 Mime ce mot sans écrire ni parler !"
                    : "👉 Dessine ce mot sans écrire ni parler !"}
            </p>

            <div class="mimer-actions">
                <button id="mimer-cacher" class="btn-warning btn-large">
                    <span class="btn-icon">🙈</span>
                    Cacher le mot
                </button>

                <button id="mimer-afficher" class="btn-info btn-large" style="display:none">
                    <span class="btn-icon">👁️</span>
                    Afficher le mot
                </button>

                <button id="mimer-trouve" class="btn-success btn-large">
                    <span class="btn-icon">✅</span>
                    Trouvé !
                </button>

                <button id="mimer-passer" class="btn-secondary btn-large">
                    <span class="btn-icon">❌➡️</span>
                    Passer
                </button>
            </div>
        </div>
    `;

    // Boutons d'actions
    const btnTrouve = document.getElementById("mimer-trouve");
    const btnPasser = document.getElementById("mimer-passer");
    const btnCacher = document.getElementById("mimer-cacher");
    const btnAfficher = document.getElementById("mimer-afficher");

if (btnTrouve) {
    btnTrouve.onclick = () => {
        const participantActuel = participants[participantActuelIndex];

        // Incrémenter le score local
        scoresParParticipant[participantActuel]++;

        // Mettre à jour le scoreboard
        modifierScore(participantActuel, 5);

        // 🔥 Sauvegarder la partie
        const partie = loadGame();
        if (partie) {
            partie.scores = scoresParParticipant;
            saveGame(partie);
        }

        // Afficher le prochain défi
        afficherNouveauDefi();
    };
}


    if (btnPasser) {
        btnPasser.onclick = () => {
            afficherNouveauDefi();
        };
    }

    if (btnCacher) {
        btnCacher.onclick = () => {
            cacherMot();
        };
    }

    if (btnAfficher) {
        btnAfficher.onclick = () => {
            afficherMotOriginal();
        };
    }
}

// ============================================
// 🙈 CACHER LE MOT
// ============================================

function cacherMot() {
    const carteMot = document.querySelector(".mimer-mot-carte");
    const btnCacher = document.getElementById("mimer-cacher");
    const btnAfficher = document.getElementById("mimer-afficher");

    if (carteMot) {
        carteMot.style.display = "none";
    }
    if (btnCacher) {
        btnCacher.style.display = "none";
    }
    if (btnAfficher) {
        btnAfficher.style.display = "inline-flex";
    }
}

// ============================================
// 👁️ AFFICHER LE MOT
// ============================================

function afficherMotOriginal() {
    const carteMot = document.querySelector(".mimer-mot-carte");
    const btnCacher = document.getElementById("mimer-cacher");
    const btnAfficher = document.getElementById("mimer-afficher");

    if (carteMot) {
        carteMot.style.display = "block";
    }
    if (btnCacher) {
        btnCacher.style.display = "inline-flex";
    }
    if (btnAfficher) {
        btnAfficher.style.display = "none";
    }
}

// ============================================
// 🏁 FIN DE MANCHE
// ============================================

function finManche() {
    // Arrêter le timer
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }

    mancheEnCours = false;

    const participantActuel = participants[participantActuelIndex];
    const scoreActuel = scoresParParticipant[participantActuel];

    // Afficher l'écran de fin de manche
    const content = document.getElementById("mimer-content");
    if (!content) return;

    const timerDisplay = document.getElementById("mimer-timer");
    if (timerDisplay) {
        timerDisplay.classList.remove("timer-alerte");
    }

    content.innerHTML = `
        <div class="mimer-fin">
            <h2 class="mimer-fin-titre">⏱️ Temps écoulé !</h2>

            <div class="mimer-score-final">
                <p class="mimer-participant-nom">👤 ${participantActuel}</p>
                <h1>${scoreActuel}</h1>
                <p class="mimer-score-label">mot${scoreActuel > 1 ? 's' : ''} deviné${scoreActuel > 1 ? 's' : ''}</p>
            </div>

            ${participantActuelIndex < participants.length - 1 ? `
                <button id="mimer-suivant" class="btn-primary btn-large">
                    <span class="btn-icon">➡️</span>
                    Participant suivant
                </button>
            ` : `
                <button id="mimer-classement" class="btn-primary btn-large">
                    <span class="btn-icon">🏆</span>
                    Voir le classement final
                </button>
            `}
        </div>
    `;

    // Bouton participant suivant
    const btnSuivant = document.getElementById("mimer-suivant");
    if (btnSuivant) {
        btnSuivant.onclick = () => {
            participantActuelIndex++;
            derniereCategorie = null; // Reset pour le prochain joueur
            afficherEcranAccueil();
        };
    }

    // Bouton classement final
    const btnClassement = document.getElementById("mimer-classement");
    if (btnClassement) {
        btnClassement.onclick = () => {
            afficherClassementFinal();
        };
    }
}

// ============================================
// 🏆 CLASSEMENT FINAL
// ============================================

function afficherClassementFinal() {
    const content = document.getElementById("mimer-content");
    if (!content) return;

    // Créer le classement
    const classement = participants
        .map(p => ({ nom: p, score: scoresParParticipant[p] }))
        .sort((a, b) => b.score - a.score);

    const listeClassement = classement
        .map((item, index) => {
            const medaille = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`;
            return `
                <div class="classement-item ${index === 0 ? 'winner' : ''}">
                    <span class="classement-position">${medaille}</span>
                    <span class="classement-nom">${item.nom}</span>
                    <span class="classement-score">${item.score} mot${item.score > 1 ? 's' : ''}</span>
                </div>
            `;
        })
        .join('');

    content.innerHTML = `
        <div class="mimer-fin">
            <h2 class="mimer-fin-titre">🏆 Classement Final</h2>

            <div class="mimer-classement">
                ${listeClassement}
            </div>

            <button id="mimer-rejouer" class="btn-primary btn-large">
                <span class="btn-icon">🔄</span>
                Rejouer
            </button>
        </div>
    `;

    // Bouton rejouer
    const btnRejouer = document.getElementById("mimer-rejouer");
    if (btnRejouer) {
        btnRejouer.onclick = () => {
            resetJeu();
            afficherEcranAccueil();
        };
    }
}