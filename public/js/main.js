// /js/main.js

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
import { initialiserQuiz } from "./jeux/quiz.js";

import { socket } from "./core/socket.js";

document.addEventListener("DOMContentLoaded", () => {
    initToggleScoreboard();
    initScoreButtons();
    const btn = $("toggle-scores");
    if (btn) btn.addEventListener("click", () => console.log("toggle-scores cliqué"));
});

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

const hideAll = (ids) => ids.forEach(hide);
const fadeOutAndRemove = (el, d = FADE_DURATION) => {
    if (!el) return;
    el.classList.add("fade-out");
    setTimeout(() => el.style.display = "none", d);
};

function masquerUndercoverComplet() {
    const ucConfig = document.getElementById("undercover-config");
    const ucGame   = document.getElementById("undercover");
    if (ucConfig) { ucConfig.hidden = true;  ucConfig.style.display  = "none"; }
    if (ucGame)   { ucGame.hidden   = true;  ucGame.style.display    = "none"; }
}

function lancerMusique() {
    const audio = document.getElementById("bg-music");
    if (!audio) return;
    audio.volume = 0.4;

    const toggle = document.getElementById("toggle-music");
    if (!toggle) return;
    toggle.onclick = function() {
        if (audio.paused) { audio.play(); toggle.textContent = "🔊"; }
        else { audio.pause(); toggle.textContent = "🔇"; }
    };
}

function initSplashScreen() {
    const splash = document.getElementById("splash-screen");
    if (!splash) return;
    setTimeout(() => {
        splash.classList.add("fade-out");
        setTimeout(() => splash.style.display = "none", FADE_DURATION);
    }, SPLASH_DURATION.SCREEN);
}

function afficherAccueilJeux() {
    naviguerVers("home", "choix-jeu");
}

function masquerModules() {
    const modules = [
        "quiz","justeprix","undercover","lml","mimer","pendu",
        "petitbac","memoire","morpion","puissance4","blindtest"
    ];
    modules.forEach(m => hide(m));
}

function initGameButtons() {
    const btns = $$(".game-btn");
    btns.forEach(btn => {
        btn.onclick = () => {
            const game = btn.dataset.game;
            if (!game) return;

            GameState.jeu = game;
            GameState.jeuActuel = game;
            naviguerVers("choix-mode", "choix-jeu");

            const input = $("nom-partie");
            if (input) {
                const defaultName = `${game.charAt(0).toUpperCase() + game.slice(1)}${Date.now() % 1000}`;
                input.value = defaultName;
                GameState.partieNom = defaultName;
            }
        };
    });
}

function initNavigationButtons() {
    const btnHome = $("btn-home-permanent");
    const btnMenu = $("btn-menu-permanent");
    const btnRetour = $("btn-retour-permanent");
    const btnCloseMenu = $("btn-close-menu");
    const menuOverlay = $("menu-overlay");
    const menuPanel = $("menu-panel");

    if (btnHome) btnHome.addEventListener("click", afficherAccueilJeux);

    if (btnMenu) {
        btnMenu.addEventListener("click", () => {
            if (menuPanel) menuPanel.hidden = false;
            if (menuOverlay) menuOverlay.hidden = false;
        });
    }

    if (btnCloseMenu) {
        btnCloseMenu.addEventListener("click", () => {
            if (menuPanel) menuPanel.hidden = true;
            if (menuOverlay) menuOverlay.hidden = true;
        });
    }

    if (menuOverlay) {
        menuOverlay.addEventListener("click", () => {
            menuPanel.hidden = true;
            menuOverlay.hidden = true;
        });
    }

    const menuItems = $$(".menu-item");
    const menuMap = {
        "menu-reglages": { screen: "home", special: null },
        "menu-parties": { screen: "liste-parties", special: null },
        "menu-joueurs": { screen: "home", special: null },
        "menu-equipes": { special: null },
        "menu-home": { screen: "home", special: null }
    };

    menuItems.forEach(item => {
        const action = menuMap[item.id];
        if (!action) return;
        item.addEventListener("click", () => {
            if (menuPanel) menuPanel.hidden = true;
            if (menuOverlay) menuOverlay.hidden = true;
            if (action.screen) {
                naviguerVers(action.screen, "home");
            }
        });
    });

    const btnNouveau = $("btn-nouveau-jeu");
    if (btnNouveau) {
        btnNouveau.addEventListener("click", () => {
            naviguerVers("choix-jeu", "home");
        });
    }

    if (btnRetour) {
        btnRetour.addEventListener("click", () => {
            history.back();
        });
    }

    const modeCards = $$(".mode-card");
    modeCards.forEach(card => {
        card.addEventListener("click", (e) => {
            const cardTeam = $$(".mode-card")[1];
            if (e.target.closest(".mode-card") === cardTeam) {
                if (cardTeam) {
                    cardTeam.classList.add("mode-card--disabled");
                    cardTeam.style.pointerEvents = "none";
                    cardTeam.style.opacity = "0.4";
                    cardTeam.style.filter = "grayscale(100%)";
                }
            }
        });
    });
}

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
                initStartSolo();
                naviguerVers("form-solo", "choix-mode");
            } else {
                initFormEquipes();
                naviguerVers("form-equipes", "choix-mode");
            }
        };
    });
}

// Registry des initialiseurs de jeux (sans window)
const GAME_INIT_FNS = {
    quiz       : (sock) => initialiserQuiz(sock),
    quizz      : (sock) => initialiserQuiz(sock),
    pendu      : ()     => initialiserPendu(),
    memoire    : ()     => initialiserMemoire(),
    puissance4 : ()     => initialiserPuissance4(),
    mimer      : ()     => initialiserMimer(),
    mimedessine: ()     => initialiserMimer(),
    petitbac   : ()     => initialiserPetitBac(),
    morpion    : ()     => { /* handled separately */ },
};

function _callGameInit(key) {
    const fn = GAME_INIT_FNS[key];
    if (!fn) return;
    if (key === 'quiz' || key === 'quizz') {
        fn(socket).catch(err => console.error('[MAIN] ❌ initialiserQuiz:', err));
    } else {
        try { fn(); } catch(err) { console.error('[MAIN] ❌ init', key, err); }
    }
}

function lancerJeuLocal(game) {
    GameState.jeuActuel = game;

    nettoyerSession();

    hideAll(["home","choix-mode","form-solo","form-equipes","choix-jeu","liste-parties"]);
    masquerUndercoverComplet();
    masquerModules();
    show("container");
    show("scoreboard");
    afficherScoreboard();

    const key  = game.toLowerCase();
    if (!GAME_INITIALIZERS[key]) { afficherAccueilJeux(); return; }

    if (key === "morpion") {
        _callGameInit(key);
        show("morpion"); return;
    }

    _countdown(() => {
        show(key.replace(/\s+/g,""));
        _callGameInit(key);
    });
}

function _afficherEtatCreation() {
    const btnStart = $("btn-start-solo");
    if (btnStart) {
        btnStart.disabled      = true;
        btnStart.style.opacity = '0.5';
        btnStart.textContent   = '⏳ Création en cours…';
    }
}

function _restaurerBoutonStart() {
    const btnStart = $("btn-start-solo");
    if (btnStart) {
        btnStart.disabled      = false;
        btnStart.style.opacity = '1';
        btnStart.textContent   = '🚀 Commencer la partie';
    }
}

function initStartSolo() {
    const btnStart = $("btn-start-solo");
    if (!btnStart) return;

    btnStart.hidden        = false;
    btnStart.disabled      = false;
    btnStart.style.display = 'block';

    const clone = btnStart.cloneNode(true);
    btnStart.parentNode.replaceChild(clone, btnStart);
    const btn = $("btn-start-solo");

    btn.addEventListener("click", () => {
        if (!GameState.joueurs || GameState.joueurs.length === 0) {
            alert("Sélectionne au moins un joueur."); return;
        }
        GameState.mode = "solo";

        if (HostSession._partieStarted) {
            if (HostSession._partieId) HostSession.terminer();
            HostSession.reset();
            resetEtatQuizHote();
        }

        if (GameState.jeu === "morpion") {
            if (GameState.joueurs.length < 2 || GameState.joueurs.length > 3) {
                alert("Le Morpion : 2 à 3 joueurs."); return;
            }
            lancerJeuLocal("morpion"); return;
        }

        if (GameState.jeu === "puissance4") {
            if (GameState.joueurs.length !== 2) {
                alert("Puissance 4 : exactement 2 joueurs."); return;
            }
            lancerJeuLocal("puissance4"); return;
        }

        if (GameState.jeu === "undercover") {
            if (GameState.joueurs.length < 3) {
                alert("Undercover : il faut au moins 3 joueurs."); return;
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
            if (ucDistrib) { ucDistrib.hidden = true; ucDistrib.style.display = "none"; }
            if (ucGame)    { ucGame.hidden    = true; ucGame.style.display    = "none"; }

            ucBindBouton(() => {
                const jeu = document.getElementById("undercover");
                if (jeu) { jeu.hidden = false; jeu.style.display = "block"; }
                show("scoreboard");
                afficherScoreboard();
            });
            return;
        }

        if (HostSession._partieId) {
            HostSession._partieStarted = true;
            HostSession.notifierDemarrage();
            lancerJeu(GameState.jeu, { fromServer: true });
        } else {
            nettoyerSession();
            HostSession._pendingGame = GameState.jeu;
            HostSession.creerPartie();
            _afficherEtatCreation();
        }
    });
}

function lancerJeu(game, options = {}) {
    const fromLoad = options.fromLoad === true;
    GameState.jeuActuel = game;

    if (game.toLowerCase() === "undercover") return;

    if (!fromLoad) {
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
    const gameInitName = GAME_INITIALIZERS[key];
    if (!gameInitName) { afficherAccueilJeux(); return; }

    if (key === "morpion") {
        _callGameInit(key);
        show("morpion");
        return;
    }

    if (pid) {
        localStorage.setItem(`partie_etat_${pid}`, 'en_cours');
        signalDemarrage(pid, game);
    }

    _countdown(() => {
        show(key.replace(/\s+/g,""));
        _callGameInit(key);
    });
}

function _countdown(callback) {
    const overlay = document.querySelector(".compte-a-rebours-overlay");
    if (!overlay) {
        callback();
        return;
    }
    overlay.style.display = "flex";
    let count = 3;
    const countEl = overlay.querySelector(".countdown-number");
    const interval = setInterval(() => {
        count--;
        if (countEl) countEl.textContent = count;
        if (count === 0) {
            clearInterval(interval);
            overlay.style.display = "none";
            callback();
        }
    }, 1000);
}

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

function initAppliqueGlobale() {
    nettoyerParasites();
    initSplashScreen();
    initNavigationButtons();
    initGameButtons();
    initModeCards();
    initStartSolo();
    masquerUndercoverComplet();
    initNavigation();
    HostSession.init();
}

window.addEventListener("DOMContentLoaded", initAppliqueGlobale);

// Injecter les callbacks dans HostSession (évite window.xxx dans host_session.js)
HostSession.setCallbacks({
    restaurerBouton : _restaurerBoutonStart,
    lancerJeu       : lancerJeu,
});

// Exposer _hostCreerPartieQuandPret pour joueurs.js (sera supprimé quand joueurs.js sera migré)
window._hostCreerPartieQuandPret = function() {
    if (HostSession._authenticated && !HostSession._partieId && !HostSession._creationEnCours) {
        HostSession.creerPartie();
    }
};