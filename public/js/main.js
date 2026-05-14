// /js/main.js — v3.9 (FIX: Re-bind btn-start-solo at every form-solo entrance)

/**
 * ============================================
 * 🎮 MAIN.JS — Gestionnaire principal du jeu
 * ============================================
 * Version: 3.9 — Fix re-bind btn-start-solo pour chaque création de partie
 *
 * CORRECTIONS v3.9:
 * ✅ initStartSolo() rappelée à chaque entrée sur form-solo
 * ✅ Clonage + listener réassocié SANS accumulation WS
 * ✅ HostSession.reset() AVANT creerPartie()
 * ✅ resetEtatQuizHote() EN MÊME TEMPS que reset()
 */
import HostSession from './core/host_session.js';

import { $, $$, show, hide } from "./core/dom.js";
import { GameState } from "./core/state.js";
import {
    getAllParties, loadGame
} from "./core/storage.js";
import {
    afficherListeParties,
    creerNouvellePartie
} from "./modules/parties.js";
import {
    initFormSolo,
    afficherJoueursSelectionnes
} from "./modules/joueurs.js";
import { initFormEquipes } from "./modules/equipes.js";
import {
    afficherScoreboard,
    initScoreButtons,
    initToggleScoreboard
} from "./modules/scoreboard.js";
import { naviguerVers, initNavigation } from "./navigation.js";
import { signalDemarrage } from "./core/signal.js";
import {
    nettoyerSession,
    nettoyerParasites,
    resetEtatQuizHote
} from "./core/cleanup.js";

import {
    bindBoutonDemarrer as ucBindBouton,
    nettoyerPartie     as ucNettoyerPartie
} from "./modules/undercover_hote.js";

import { initialiserPendu }      from "./jeux/pendu.js";
import { initialiserMemoire }    from "./jeux/memoire.js";
import { initialiserPuissance4 } from "./jeux/puissance4.js";
import { initialiserMimer }      from "./jeux/mimedessine.js";
import { initialiserPetitBac }   from "./jeux/petitbac.js";

import { socket } from "./core/socket.js";

// ============================================
// DEBUG SCOREBOARD
// ============================================
document.addEventListener("DOMContentLoaded", () => {
    initToggleScoreboard();
    initScoreButtons();
    const btn = $("toggle-scores");
    if (btn) btn.addEventListener("click", () => console.log("toggle-scores cliqué"));
});

// ============================================
// CONSTANTES
// ============================================
const SPLASH_DURATION = { SCREEN: 1500, LOADER: 2500, INIT: 2600 };
const FADE_DURATION   = 800;

const ALL_MODULES = [
    "quiz","justeprix","undercover","lml","mimer",
    "blindtest","pendu","petitbac","memoire","morpion","puissance4"
];

const GAME_INITIALIZERS = {
    quiz:"initialiserQuiz", quizz:"initialiserQuiz",
    "juste prix":"initialiserJustePrix", justeprix:"initialiserJustePrix",
    lml:"initialiserLML", mimer:"initialiserMimer",
    blindtest:"initialiserBlindTest", pendu:"initialiserPendu",
    memoire:"initialiserMemoire", petitbac:"initialiserPetitBac",
    morpion:"initialiserMorpion", puissance4:"initialiserPuissance4"
};

const REGLES_JEUX = {
    quiz:"Réponds aux questions le plus rapidement !",
    justeprix:"Trouve le prix exact ou le plus proche.",
    undercover:"Trouve l'imposteur. Les civils ont un mot, l'Undercover un autre, Mister White aucun.",
    lml:"Forme le mot le plus long !",
    mimer:"Mime et fais deviner un max de mots !",
    pendu:"Trouve le mot caché lettre par lettre !",
    petitbac:"Mots commençant par la lettre tirée pour chaque catégorie !",
    memoire:"Teste ta mémoire !",
    morpion:"Aligne 3 symboles identiques !",
    puissance4:"Aligne 4 jetons de ta couleur !"
};

// ============================================
// UTILITAIRES
// ============================================
const hideAll = (ids) => ids.forEach(hide);
const fadeOutAndRemove = (el, d = FADE_DURATION) => {
    if (!el) return;
    el.classList.add("fade-out");
    setTimeout(() => el.style.display = "none", d);
};

// ============================================
// MASQUAGE UNDERCOVER
// ============================================
function masquerUndercoverComplet() {
    const ucConfig = document.getElementById("undercover-config");
    const ucGame   = document.getElementById("undercover");
    if (ucConfig) { ucConfig.hidden = true;  ucConfig.style.display  = "none"; }
    if (ucGame)   { ucGame.hidden   = true;  ucGame.style.display    = "none"; }
}

// ============================================
// MUSIQUE
// ============================================
function lancerMusique() {
    const audio = document.getElementById("bg-music");
    if (!audio) return;
    audio.volume = 0.4;
    audio.play().catch(() => {});
}
document.addEventListener("DOMContentLoaded", () => {
    const toggleBtn = document.getElementById("toggle-music");
    const audio     = document.getElementById("bg-music");
    if (toggleBtn && audio) {
        toggleBtn.onclick = () => {
            audio.muted = !audio.muted;
            toggleBtn.textContent = audio.muted ? "🔇" : "🔊";
        };
    }
});
document.addEventListener("click", lancerMusique, { once: true });

// ============================================
// SPLASH
// ============================================
function initSplashScreen() {
    const splash = $("splash-screen");
    const loader = $("loader");
    setTimeout(() => fadeOutAndRemove(splash), SPLASH_DURATION.SCREEN);
    setTimeout(() => fadeOutAndRemove(loader),  SPLASH_DURATION.LOADER);
    setTimeout(() => { lancerMusique(); initHomeHub(); show("home"); }, SPLASH_DURATION.INIT);
}

// ============================================
// NAVIGATION
// ============================================
function initNavigationButtons() {
    const btn = $("btn-nouveau-jeu");
    if (btn) btn.onclick = () => { naviguerVers("choix-jeu", "home"); masquerUndercoverComplet(); };
}

// ============================================
// ACCUEIL
// ============================================
function initHomeHub() {
    const sauvegarde = loadGame();
    show("hub-accueil");
    hide("choix-jeu");
    masquerUndercoverComplet();

    const cb = $("continue-block");
    if (cb) cb.hidden = false;

    const btnC = $("btn-continuer");

    if (sauvegarde) {
        const el = $("resume-partie");
        if (el) {
            el.textContent =
                `${sauvegarde.nomPartie || "(Sans nom)"} • ${String(sauvegarde.jeu || "").toUpperCase()} • ${sauvegarde.mode}`;
        }
        if (btnC) {
            btnC.classList.remove("btn-disabled");
            btnC.style.pointerEvents = "auto";
            btnC.style.opacity = "1";
            btnC.onclick = () => afficherListeParties();
        }
    } else {
        if (btnC) {
            btnC.classList.add("btn-disabled");
            btnC.style.pointerEvents = "none";
            btnC.style.opacity = "0.4";
            btnC.onclick = null;
        }
        const el = $("resume-partie");
        if (el) el.textContent = "Aucune partie enregistrée";
    }
}

export function afficherAccueilJeux() {
    hideAll(["form-solo","form-equipes","choix-mode","container","choix-jeu","liste-parties"]);
    masquerModules();
    masquerUndercoverComplet();
    show("home");
    initHomeHub();
}

export function masquerModules() { hideAll(ALL_MODULES); }

// ============================================
// SÉLECTION JEU
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
            GameState.jeu = GameState.jeuActuel = btn.dataset.game;
            naviguerVers("choix-mode", "choix-jeu");
            GameState.joueurs = [];
            GameState.equipes = [];

            const c = $("joueurs-selectionnes-container");
            if (c) c.innerHTML = "";
            const n = $("nom-partie");
            if (n) n.value = "";

            masquerUndercoverComplet();
            initModeCards();

            const t = $("titre-mode-jeu");
            if (t) t.textContent = btn.textContent.trim();

            const cardTeam = document.querySelector('.mode-card[data-mode="team"]');
            if (cardTeam) {
                cardTeam.classList.add("mode-card--disabled");
                cardTeam.style.pointerEvents = "none";
                cardTeam.style.opacity = "0.4";
                cardTeam.style.filter = "grayscale(100%)";
            }
        };
    });
}

// ============================================
// CHOIX DU MODE
// ============================================
function validerNomPartie(nom) {
    if (!nom) { alert("Merci d'indiquer un nom de partie"); return false; }
    if (getAllParties().some(p => (p.nomPartie || "").toLowerCase() === nom.toLowerCase())) {
        alert("Ce nom existe déjà."); return false; }
    return true;
}

function initModeCards() {
    $$(".mode-card").forEach(btn => {
        btn.onclick = () => {
            const nom = $("nom-partie")?.value?.trim() || "";
            if (!validerNomPartie(nom)) return;

            GameState.partieNom = nom;
            GameState.mode      = btn.dataset.mode;

            if (GameState.mode === "solo") {
                initFormSolo();

                // Re-bind systématique du bouton start
                initStartSolo();

                naviguerVers("form-solo", "choix-mode");
            } else {
                initFormEquipes();
                naviguerVers("form-equipes", "choix-mode");
            }
        };
    });
}


// ============================================
// LANCEMENT DES AUTRES JEUX
// ============================================
export function lancerJeu(game, options = {}) {
    const fromLoad = options.fromLoad === true;
    GameState.jeuActuel = game;

    if (game.toLowerCase() === "undercover") return;

    if (!fromLoad) {
        nettoyerSession();

        if (!GameState.partieEnCoursChargee) {
            const p = loadGame();
            if (!p || p.nomPartie !== GameState.partieNom) creerNouvellePartie();
        }
    }

    const pid = localStorage.getItem('minigame_partie_id') || '';
    hideAll(["home","choix-mode","form-solo","form-equipes","choix-jeu","liste-parties"]);
    masquerUndercoverComplet();
    masquerModules();
    show("container");
    show("scoreboard");
    afficherScoreboard();

    const key  = game.toLowerCase();
    const init = GAME_INITIALIZERS[key];
    if (!init) { afficherAccueilJeux(); return; }

    if (key === "morpion") {
        if (typeof window[init] === "function") window[init]();
        show("morpion"); return;
    }

    if (pid) {
        localStorage.setItem(`partie_etat_${pid}`, 'en_cours');
        signalDemarrage(pid, game);
    }

    HostSession.notifierDemarrage();

    if (key === 'petitbac' && typeof window._petitbacPublierManche === 'function') {
        window._petitbacPublierManche();
    }

    _countdown(() => {
        if (typeof window[init] === "function") window[init]();
        show(key.replace(/\s+/g,""));
    });
}

function _countdown(onEnd) {
    document.getElementById('hote-countdown')?.remove();
    if (!document.getElementById('style-cd')) {
        const s = document.createElement('style');
        s.id = 'style-cd';
        s.textContent = `
            @keyframes cdFI{from{opacity:0}to{opacity:1}}
            @keyframes cdPop{0%{transform:scale(1.5);opacity:0}60%{transform:scale(.92)}100%{transform:scale(1);opacity:1}}
            #hote-countdown{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;background:rgba(0,0,0,.78);backdrop-filter:blur(10px);animation:cdFI .3s}
            .cd-n{font-size:6rem;font-weight:900;color:white;text-shadow:0 0 50px rgba(0,212,255,.9);font-family:"Segoe UI",sans-serif;animation:cdPop .45s cubic-bezier(.4,0,.2,1)}
            .cd-l{font-size:1rem;color:rgba(255,255,255,.75);font-weight:700;letter-spacing:.1em;text-transform:uppercase;font-family:"Segoe UI",sans-serif}`;
        document.head.appendChild(s);
    }
    const ov  = document.createElement('div'); ov.id = 'hote-countdown';
    const nEl = document.createElement('div'); nEl.className = 'cd-n'; nEl.textContent = '3';
    const lEl = document.createElement('div'); lEl.className = 'cd-l'; lEl.textContent = 'La partie commence…';
    ov.append(nEl, lEl); document.body.appendChild(ov);
    let n = 3;
    const iv = setInterval(() => {
        n--;
        if (n > 0) {
            nEl.style.animation = 'none';
            nEl.textContent = String(n);
            requestAnimationFrame(() => nEl.style.animation = 'cdPop .45s cubic-bezier(.4,0,.2,1)');
        } else {
            clearInterval(iv);
            ov.style.transition = 'opacity .3s'; ov.style.opacity = '0';
            setTimeout(() => { ov.remove(); onEnd(); }, 300);
        }
    }, 1000);
}

window.lancerJeu    = lancerJeu;
window.initHomeHub  = initHomeHub;
window.initStartSolo = initStartSolo; // [FIX v3.9] Appelé depuis initModeCards à chaque création de partie

window.initialiserPendu      = initialiserPendu;
window.initialiserMemoire    = initialiserMemoire;
window.initialiserPuissance4 = initialiserPuissance4;
window.initialiserMimer      = initialiserMimer;
window.initialiserPetitBac   = initialiserPetitBac;

// ============================================
// TOOLTIPS
// ============================================
let tooltipActif = null;
function afficherRegles(jeu, btn) {
    cacherRegles();
    const t = document.createElement("div");
    t.className = "tooltip-regles";
    t.textContent = REGLES_JEUX[jeu] || "Règles à venir...";
    document.body.appendChild(t);
    const r = btn.getBoundingClientRect();
    t.style.left = `${r.right + 10}px`;
    t.style.top  = `${r.top}px`;
    tooltipActif = t;
}
function cacherRegles() {
    if (tooltipActif) { tooltipActif.remove(); tooltipActif = null; }
}

// ============================================
// INIT
// ============================================
function init() {
    nettoyerParasites();
    initSplashScreen();
    initNavigationButtons();
    initGameButtons();
    initModeCards();
    initStartSolo();  // Appelé UNE FOIS au démarrage (sans effet à ce stade)
    masquerUndercoverComplet();
    initNavigation();  // Initialiser navigation UNE SEULE FOIS
    HostSession.init();
}

window.addEventListener("DOMContentLoaded", init);

// ============================================
// 🚀 DÉMARRAGE MODE SOLO (VERSION CORRIGÉE)
// ============================================
// Empêche toute double création de partie WS.
// Attend réellement la fin de la partie précédente.
// Supprime les listeners doublons.
// ============================================

function initStartSolo() {
    const btnStart = $("btn-start-solo");
    if (!btnStart) return;

    // Toujours s'assurer que le bouton est visible et actif
    btnStart.hidden        = false;
    btnStart.disabled      = false;
    btnStart.style.display = 'block';

    // Cloner pour supprimer TOUS les anciens listeners
    const clone = btnStart.cloneNode(true);
    btnStart.parentNode.replaceChild(clone, btnStart);
    const btn = $("btn-start-solo");

    btn.addEventListener("click", () => {

        // Vérification joueurs
        if (!GameState.joueurs || GameState.joueurs.length === 0) {
            alert("Sélectionne au moins un joueur.");
            return;
        }

        GameState.mode = "solo";

        // 1️⃣ Si une partie existe → demander la fin
        if (HostSession._partieId) {
            HostSession.terminer();
        }

        // 2️⃣ Attendre réellement la fin de la partie précédente
        const attendreFin = () => {
            if (HostSession._partieId === null) {

                // 3️⃣ Reset complet AVANT création
                HostSession.reset();
                resetEtatQuizHote();

                // 4️⃣ Créer la nouvelle partie WS
                HostSession.creerPartie();

                // 5️⃣ Gestion des jeux spéciaux
                if (GameState.jeu === "morpion") {
                    if (GameState.joueurs.length < 2 || GameState.joueurs.length > 3) {
                        alert("Le Morpion : 2 à 3 joueurs.");
                        return;
                    }
                    lancerJeu("morpion");
                    return;
                }

                if (GameState.jeu === "puissance4") {
                    if (GameState.joueurs.length !== 2) {
                        alert("Puissance 4 : exactement 2 joueurs.");
                        return;
                    }
                    lancerJeu("puissance4");
                    return;
                }

                if (GameState.jeu === "undercover") {
                    if (GameState.joueurs.length < 3) {
                        alert("Undercover : il faut au moins 3 joueurs.");
                        return;
                    }
                    if (!GameState.partieEnCoursChargee) creerNouvellePartie();

                    const spanNb = $("uc-nb-joueurs");
                    if (spanNb) spanNb.textContent = GameState.joueurs.length;

                    hide("form-solo");
                    show("container");

                    const ucConfig  = document.getElementById("undercover-config");
                    const ucDistrib = document.getElementById("undercover-distribution");
                    const ucGame    = document.getElementById("undercover");

                    if (ucConfig)  { ucConfig.hidden = false; ucConfig.style.display = "block"; }
                    if (ucDistrib) { ucDistrib.hidden = true;  ucDistrib.style.display = "none"; }
                    if (ucGame)    { ucGame.hidden    = true;  ucGame.style.display    = "none"; }

                    ucBindBouton(() => {
                        console.log("[MAIN] ✅ Distribution terminée → phase jeu");
                        const jeu = document.getElementById("undercover");
                        if (jeu) { jeu.hidden = false; jeu.style.display = "block"; }
                        show("scoreboard");
                        afficherScoreboard();
                    });

                    return;
                }

                // 6️⃣ Lancer le jeu normal
                lancerJeu(GameState.jeu);

            } else {
                // Attendre la fin réelle (GAME_ENDED)
                requestAnimationFrame(attendreFin);
            }
        };

        attendreFin();
    });
}

// Exposition globale
window.HostSession = HostSession;
window.jeuSocket   = socket;

window._hostCreerPartieQuandPret = function() {
    if (HostSession._authenticated && !HostSession._partieId) {
        HostSession.creerPartie();
    }
};
