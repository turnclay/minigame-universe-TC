/**
 * ============================================
 * 🎮 MAIN.JS - Gestionnaire principal du jeu
 * ============================================
 * Architecture modulaire optimisée
 * Version: 2.8 - Sauvegarde Undercover
 */

// ============================================
// 📦 IMPORTS
// ============================================

import { $, $$, show, hide } from "./core/dom.js";
import { GameState } from "./core/state.js";

import {
    getPlayers,
    addPlayer,
    getAllParties,
    saveNewParty,
    loadPartyById,
    loadGame,
    updatePartieScores
} from "./core/storage.js";

import {
    initContinueButton,
    afficherListeParties,
    chargerPartie,
    creerNouvellePartie
} from "./modules/parties.js";

import {
    initFormSolo,
    afficherJoueursSelectionnes
} from "./modules/joueurs.js";

import { initFormEquipes } from "./modules/equipes.js";

import {
    afficherScoreboard,
    masquerScoreboard,
    modifierScore,
    initScoreButtons,
    initToggleScoreboard
} from "./modules/scoreboard.js";

import { naviguerVers } from "./navigation.js";

// ============================================
// 🧪 TEST DEBUG SCOREBOARD
// ============================================

document.addEventListener("DOMContentLoaded", () => {
    const btn = $("toggle-scores");
    console.log("🔍 Test DOM : toggle-scores =", btn);

    if (!btn) {
        console.error("❌ Le bouton toggle-scores est introuvable dans le DOM !");
    } else {
        console.log("✅ Bouton trouvé, test de clic attaché.");
        btn.addEventListener("click", () => {
            console.log("🎉 CLIC détecté sur le bouton toggle-scores !");
        });
    }

    initToggleScoreboard();
    initScoreButtons();
});

// ============================================
// 🕹️ IMPORTS JEUX
// ============================================

import { initialiserUndercover } from "./jeux/undercover.js";
import { initialiserPendu, chargerMotsPendu } from "./jeux/pendu.js";
import { initialiserMemoire } from "./jeux/memoire.js";
import { initialiserPuissance4 } from "./jeux/puissance4.js";
import { initialiserMimer } from "./jeux/mimedessine.js";
import { initialiserPetitBac } from "./jeux/petitbac.js";

// ============================================
// 🎯 CONSTANTES
// ============================================

const SPLASH_DURATION = {
    SCREEN: 1500,
    LOADER: 2500,
    INIT: 2600
};

const FADE_DURATION = 800;

const ALL_MODULES = [
    "quiz", "justeprix", "undercover", "lml", "mimer",
    "blindtest", "pendu", "petitbac", "memoire", "morpion", "puissance4"
];

const GAME_INITIALIZERS = {
    quiz: "initialiserQuiz",
    quizz: "initialiserQuiz",
    "juste prix": "initialiserJustePrix",
    justeprix: "initialiserJustePrix",
    lml: "initialiserLML",
    mimer: "initialiserMimer",
    blindtest: "initialiserBlindTest",
    pendu: "initialiserPendu",
    memoire: "initialiserMemoire",
    petitbac: "initialiserPetitBac",
    morpion: "initialiserMorpion",
    puissance4: "initialiserPuissance4"
};

// ============================================
// 📖 RÈGLES DES JEUX
// ============================================

const REGLES_JEUX = {
    quiz: "Réponds aux questions et devinettes le plus rapidement possible. Chaque bonne réponse rapporte des points !",
    justeprix: "Trouve le prix exact ou le plus proche. Plus tu es proche, plus tu gagnes de points !",
    undercover: "Trouve qui est l'imposteur. Les civils ont un mot, l'Undercover en a un autre, et quelqu'un n'en a peut-être pas !",
    lml: "Forme le mot le plus long et rafle un max de points !",
    mimer: "Mime ou dessine le mot ou l'expression proposée ! Tu as 3 minutes pour en faire deviner un maximum.",
    pendu: "Trouve le mot caché lettre par lettre avant d'être pendu !",
    petitbac: "Trouve des mots commençant par la lettre tirée pour chaque catégorie avant la fin du temps !",
    memoire: "Teste ta mémoire avec 3 défis : retrouve les paires, retiens la suite logique, ou mémorise les symboles !",
    morpion: "Aligne 3 symboles identiques avant ton adversaire !",
    puissance4: "Aligne 4 jetons de ta couleur horizontalement, verticalement ou en diagonale !"
};

// ============================================
// 🔧 UTILITAIRES
// ============================================

const hideAll = (ids) => ids.forEach(hide);
const showAll = (ids) => ids.forEach(show);

const fadeOutAndRemove = (element, duration = FADE_DURATION) => {
    if (!element) return;
    element.classList.add("fade-out");
    setTimeout(() => element.style.display = "none", duration);
};

const functionExists = (functionName) => typeof window[functionName] === 'function';

// ============================================
// 🕵️ MASQUAGE COMPLET UNDERCOVER
// ============================================

function masquerUndercoverComplet() {
    const ucConfig = document.getElementById("undercover-config");
    const ucDistrib = document.getElementById("undercover-distribution");
    const ucGame = document.getElementById("undercover");

    if (ucConfig) {
        ucConfig.hidden = true;
        ucConfig.style.display = "none";
    }

    if (ucDistrib) {
        ucDistrib.hidden = true;
        ucDistrib.style.display = "none";
    }

    if (ucGame) {
        ucGame.hidden = true;
        ucGame.style.display = "none";
    }
}

// ============================================
// 🎵 MUSIQUE
// ============================================

function lancerMusique() {
    const audio = document.getElementById("bg-music");
    if (!audio) return;

    audio.volume = 0.4;
    audio.play().catch(() => {
        console.warn("Lecture audio bloquée par le navigateur.");
    });
}

// Bouton mute/unmute
document.addEventListener("DOMContentLoaded", () => {
    const toggleBtn = document.getElementById("toggle-music");
    const audio = document.getElementById("bg-music");

    if (toggleBtn && audio) {
        toggleBtn.onclick = () => {
            audio.muted = !audio.muted;
            toggleBtn.textContent = audio.muted ? "🔇" : "🔊";
        };
    }
});

// Fallback Chrome : démarre la musique au premier clic
document.addEventListener("click", () => {
    lancerMusique();
}, { once: true });

// ============================================
// 🎬 ÉCRAN DE CHARGEMENT
// ============================================

function initSplashScreen() {
    const splash = $("splash-screen");
    const loader = $("loader");

    setTimeout(() => fadeOutAndRemove(splash, FADE_DURATION), SPLASH_DURATION.SCREEN);
    setTimeout(() => fadeOutAndRemove(loader, FADE_DURATION), SPLASH_DURATION.LOADER);

    setTimeout(() => {
        lancerMusique();
        initHomeHub();
        show("home");
    }, SPLASH_DURATION.INIT);
}

// ============================================
// 🗺️ NAVIGATION
// ============================================

function initNavigationButtons() {
    const btnNouveauJeu = $("btn-nouveau-jeu");
    if (btnNouveauJeu) {
        btnNouveauJeu.onclick = () => {
            naviguerVers("choix-jeu", "home");
            masquerUndercoverComplet();
        };
    }
}

// ============================================
// 🏠 GESTION DE L'ACCUEIL
// ============================================

function initHomeHub() {
    const sauvegarde = loadGame();

    show("hub-accueil");
    hide("choix-jeu");
    masquerUndercoverComplet();

    const continueBlock = $("continue-block");
    if (continueBlock) {
        continueBlock.hidden = false;
    }

    if (sauvegarde) {
        const resumeElement = $("resume-partie");
        if (resumeElement) {
            const nomJeu = String(sauvegarde.jeu || "").toUpperCase();
            const nomPartie = sauvegarde.nomPartie || "(Sans nom)";
            resumeElement.textContent =
                `${nomPartie} • ${nomJeu} • Mode : ${sauvegarde.mode}`;
        }
    }

    const btnContinuer = $("btn-continuer");
    if (btnContinuer) {
        btnContinuer.onclick = () => afficherListeParties();
    }
}

function afficherAccueilJeux() {
    hideAll([
        "form-solo", "form-equipes", "choix-mode", "container",
        "choix-jeu", "liste-parties"
    ]);

    masquerModules();
    masquerUndercoverComplet();
    show("home");
    initHomeHub();
}

function masquerModules() {
    hideAll(ALL_MODULES);
}

// ============================================
// 🎮 SÉLECTION DES JEUX
// ============================================

function initGameButtons() {
    $$(".game-btn").forEach(btn => {

        btn.addEventListener("mouseenter", () => {
            const jeu = btn.dataset.game;
            if (REGLES_JEUX[jeu]) afficherRegles(jeu, btn);
        });

        btn.addEventListener("mouseleave", cacherRegles);

        btn.onclick = () => {
            cacherRegles();

            GameState.jeu = btn.dataset.game;
            GameState.jeuActuel = btn.dataset.game;

            naviguerVers("choix-mode", "choix-jeu");

            // Réinitialisation des joueurs et équipes
            GameState.joueurs = [];
            GameState.equipes = [];

            const contSolo = $("joueurs-selectionnes-container");
            if (contSolo) contSolo.innerHTML = "";

            const inputNom = $("nom-partie");
            if (inputNom) inputNom.value = "";

            masquerUndercoverComplet();

            initModeCards();

            const titreMode = $("titre-mode-jeu");
            if (titreMode) titreMode.textContent = btn.textContent.trim();

            const cardTeam = document.querySelector('.mode-card[data-mode="team"]');

            if (cardTeam) {
                const jeuxSansEquipes = ["undercover", "puissance4", "morpion"];

                if (jeuxSansEquipes.includes(GameState.jeu)) {
                    cardTeam.classList.add("disabled");
                    cardTeam.style.pointerEvents = "none";
                    cardTeam.style.opacity = "0.4";
                } else {
                    cardTeam.classList.remove("disabled");
                    cardTeam.style.pointerEvents = "auto";
                    cardTeam.style.opacity = "1";
                }
            }
        };
    });
}

// ============================================
// 🎯 CHOIX DU MODE DE JEU
// ============================================

function validerNomPartie(nomPartie) {
    if (!nomPartie || typeof nomPartie !== "string") {
        alert("Merci d'indiquer un nom de partie");
        return false;
    }

    const parties = getAllParties();

    if (parties.some(p =>
        String(p.nomPartie || "").toLowerCase() === nomPartie.toLowerCase()
    )) {
        alert("Ce nom de partie existe déjà. Choisis un autre nom.");
        return false;
    }

    return true;
}

function initModeCards() {
    $$(".mode-card").forEach(btn => {
        btn.onclick = () => {

            // 🔥 Récupération du nom de partie (commun aux 2 modes)
            const nomPartieInput = $("nom-partie");
            const nomPartie = nomPartieInput?.value?.trim() || "";

            // 🔥 Validation du nom
            if (!validerNomPartie(nomPartie)) return;

            // 🔥 Enregistrement du nom dans GameState
            GameState.partieNom = nomPartie;

            // 🔥 Enregistrement du mode choisi
            GameState.mode = btn.dataset.mode;

            // 🔥 Navigation selon le mode
            if (GameState.mode === "solo") {
                initFormSolo();
                naviguerVers("form-solo", "choix-mode");
            } else {
                initFormEquipes();
                naviguerVers("form-equipes", "choix-mode");
            }
        };
    });
}

// ============================================
// 🏁 DÉMARRAGE MODE SOLO
// ============================================

function initStartSolo() {
    const btnStart = $("btn-start-solo");
    if (!btnStart) return;

    btnStart.addEventListener("click", () => {

        if (!GameState.joueurs || GameState.joueurs.length === 0) {
            alert("Sélectionne au moins un joueur.");
            return;
        }

        GameState.mode = "solo";

        console.log("✔ FORM SOLO VALIDÉ → joueurs =", GameState.joueurs);

        // MORPION
        if (GameState.jeu === "morpion") {
            if (GameState.joueurs.length < 2 || GameState.joueurs.length > 3) {
                alert("Le Morpion se joue minimum à 2 et maximum 3 joueurs.");
                return;
            }
            lancerJeu("morpion");
            return;
        }

        // PUISSANCE 4
        if (GameState.jeu === "puissance4") {
            if (GameState.joueurs.length !== 2) {
                alert("Le Puissance 4 se joue obligatoirement à 2 joueurs.");
                return;
            }
            lancerJeu("puissance4");
            return;
        }

        // UNDERCOVER
        if (GameState.jeu === "undercover") {
            if (GameState.joueurs.length < 3) {
                alert("Il faut au moins 3 joueurs pour jouer à Undercover.");
                return;
            }

            console.log("[MAIN] Passage à l'écran de configuration Undercover");

            // 🔥 NOUVEAU : Créer la partie AVANT d'afficher la config
            if (!GameState.partieEnCoursChargee) {
                creerNouvellePartie();
                console.log("[MAIN] ✅ Partie Undercover créée");
            }

            const spanNb = $("uc-nb-joueurs");
            if (spanNb) {
                spanNb.textContent = GameState.joueurs.length;
            }

            hide("form-solo");
            show("container");

            const ucConfig = document.getElementById("undercover-config");
            if (ucConfig) {
                ucConfig.hidden = false;
                ucConfig.style.display = "block";
            }

            const ucDistrib = document.getElementById("undercover-distribution");
            if (ucDistrib) {
                ucDistrib.hidden = true;
                ucDistrib.style.display = "none";
            }

            const ucGame = document.getElementById("undercover");
            if (ucGame) {
                ucGame.hidden = true;
                ucGame.style.display = "none";
            }

            return;
        }

        // AUTRES JEUX
        lancerJeu(GameState.jeu);
    });
}

// ============================================
// 🎮 LANCEMENT DU JEU
// ============================================

function lancerJeu(game, options = {}) {
    const fromLoad = options.fromLoad === true;

    console.log("[MAIN] lancerJeu appelé avec:", game);

    GameState.jeuActuel = game;

    hideAll([
        "home", "choix-mode", "form-solo", "form-equipes",
        "choix-jeu", "liste-parties"
    ]);

    masquerUndercoverComplet();
    masquerModules();

    show("container");
    show("scoreboard");
    afficherScoreboard();

    const gameLower = game.toLowerCase();
    const initializerName = GAME_INITIALIZERS[gameLower];

    if (!initializerName) {
        console.warn("⚠️ Jeu inconnu :", game);
        afficherAccueilJeux();
        return;
    }

    // Initialiser le module
    if (typeof window[initializerName] === "function") {
        window[initializerName]();
    } else {
        console.warn(`⚠️ Fonction ${initializerName} non trouvée`);
    }

    // Afficher le module
    const moduleId = gameLower.replace(/\s+/g, "");
    show(moduleId);

    // Créer une partie seulement si ce n'est pas un chargement
    if (!fromLoad && !GameState.partieEnCoursChargee) {
        const partieEnCours = loadGame();
        if (!partieEnCours || partieEnCours.nomPartie !== GameState.partieNom) {
            creerNouvellePartie();
        }
    }
}

window.lancerJeu = lancerJeu;

// ============================================
// 💡 TOOLTIPS DES RÈGLES
// ============================================

let tooltipActif = null;

function afficherRegles(jeu, btn) {
    cacherRegles();

    const tooltip = document.createElement("div");
    tooltip.className = "tooltip-regles";
    tooltip.textContent = REGLES_JEUX[jeu] || "Règles à venir...";
    document.body.appendChild(tooltip);

    const rect = btn.getBoundingClientRect();
    tooltip.style.left = `${rect.right + 10}px`;
    tooltip.style.top = `${rect.top}px`;

    tooltipActif = tooltip;
}

function cacherRegles() {
    if (tooltipActif) {
        tooltipActif.remove();
        tooltipActif = null;
    }
}

// ============================================
// 🚀 INITIALISATION PRINCIPALE
// ============================================

function init() {
    console.log("[MAIN] Initialisation de l'application");
    initSplashScreen();
    initNavigationButtons();
    initGameButtons();
    initModeCards();
    initStartSolo();
    initialiserUndercover();
    initialiserPendu();
    masquerUndercoverComplet();
    console.log("[MAIN] Initialisation terminée");
}

window.addEventListener("DOMContentLoaded", init);

// ============================================
// 📤 EXPORTS
// ============================================

export {
    lancerJeu,
    afficherAccueilJeux,
    masquerModules,
    initHomeHub
};