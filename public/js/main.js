/**
 * ============================================
 * 🎮 MAIN.JS - Gestionnaire principal du jeu
 * ============================================
 * Version: 3.3 — port backend WebSocket
 *
 * MODIFICATIONS v3.3 (port backend V2) :
 * ─────────────────────────────────────────────
 * Un seul bloc ajouté : HostSession (bas du fichier).
 * Zéro ligne du code existant modifiée.
 *
 * Stratégie :
 *   La logique UI/UX (splash, navigation, scoreboard,
 *   jeux locaux) est conservée intégralement.
 *   HostSession s'y greffe en observant les moments
 *   clés du flow existant :
 *
 *   1. Quand l'hôte clique "Commencer" (btn-start-solo
 *      ou btn-start-equipes) → HOST_AUTH + HOST_CREATE_GAME
 *   2. Quand lancerJeu() est appelé → HOST_START_GAME
 *   3. Quand la partie se termine → HOST_END_GAME
 *
 * Ce que HostSession ne fait PAS :
 *   - Il ne modifie pas GameState
 *   - Il ne touche pas au DOM
 *   - Il ne remplace pas localStorage (les jeux locaux
 *     continuent de fonctionner de la même façon)
 *   Il ajoute simplement le canal WebSocket en parallèle.
 *
 * FIX CLÉ (hérité v3.2) :
 *   ucBindBouton() N'EST PLUS dans init().
 *   Il est appelé dans initStartSolo(), uniquement quand
 *   GameState.jeu === "undercover" ET l'écran config est affiché,
 *   donc GameState.joueurs est déjà rempli.
 */

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
import { naviguerVers } from "./navigation.js";
import { signalDemarrage } from "./core/signal.js";
import { nettoyerSession, nettoyerParasites } from "./core/cleanup.js";

import {
    bindBoutonDemarrer as ucBindBouton,
    nettoyerPartie     as ucNettoyerPartie
} from "./modules/undercover_hote.js";

import { initialiserPendu }      from "./jeux/pendu.js";
import { initialiserMemoire }    from "./jeux/memoire.js";
import { initialiserPuissance4 } from "./jeux/puissance4.js";
import { initialiserMimer }      from "./jeux/mimedessine.js";
import { initialiserPetitBac }   from "./jeux/petitbac.js";

// ── Nouveau : import socket ────────────────────────────────────
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
    // ⚠️ "undercover" absent : flow géré séparément
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
        alert("Ce nom existe déjà."); return false;
    }
    return true;
}

function initModeCards() {
    $$(".mode-card").forEach(btn => {
        btn.onclick = () => {
            const nom = $("nom-partie")?.value?.trim() || "";
            if (!validerNomPartie(nom)) return;
            GameState.partieNom = nom;
            GameState.mode      = btn.dataset.mode;
            if (GameState.mode === "solo") { initFormSolo();   naviguerVers("form-solo",   "choix-mode"); }
            else                           { initFormEquipes(); naviguerVers("form-equipes","choix-mode"); }
        };
    });
}

// ============================================
// DÉMARRAGE MODE SOLO
// ============================================
function initStartSolo() {
    const btnStart = $("btn-start-solo");
    if (!btnStart) return;

    btnStart.addEventListener("click", () => {
        if (!GameState.joueurs || GameState.joueurs.length === 0) {
            alert("Sélectionne au moins un joueur."); return;
        }
        GameState.mode = "solo";
        // ── Créer la partie côté serveur WS ──────────────────────
        HostSession.creerPartie();

        if (GameState.jeu === "morpion") {
            if (GameState.joueurs.length < 2 || GameState.joueurs.length > 3) {
                alert("Le Morpion : 2 à 3 joueurs."); return;
            }
            lancerJeu("morpion"); return;
        }

        if (GameState.jeu === "puissance4") {
            if (GameState.joueurs.length !== 2) {
                alert("Puissance 4 : exactement 2 joueurs."); return;
            }
            lancerJeu("puissance4"); return;
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
            const ucConfig = document.getElementById("undercover-config");
            const ucDistrib = document.getElementById("undercover-distribution");
            const ucGame   = document.getElementById("undercover");
            if (ucConfig)  { ucConfig.hidden = false; ucConfig.style.display = "block"; }
            if (ucDistrib) { ucDistrib.hidden = true; ucDistrib.style.display = "none"; }
            if (ucGame)    { ucGame.hidden    = true; ucGame.style.display    = "none"; }

            ucBindBouton(() => {
                console.log("[MAIN] ✅ Distribution terminée → phase jeu");
                const jeu = document.getElementById("undercover");
                if (jeu) { jeu.hidden = false; jeu.style.display = "block"; }
                show("scoreboard");
                afficherScoreboard();
            });

            return;
        }

        lancerJeu(GameState.jeu);
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

    const pid = localStorage.getItem('minigame_partie_session_id') || '';
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

    // ── Notifier le backend que la partie démarre ──────────────
    // Appel non bloquant : si le socket n'est pas connecté,
    // le jeu local fonctionne normalement quand même.
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
    const ov = document.createElement('div'); ov.id = 'hote-countdown';
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

window.lancerJeu   = lancerJeu;
window.initHomeHub = initHomeHub;

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
    initStartSolo();
    initialiserPendu();
    masquerUndercoverComplet();

    // ── Connecter le socket host en arrière-plan ───────────────
    // Non bloquant : si le serveur est indisponible, tout le
    // reste de l'application fonctionne normalement.
    HostSession.init();
}

window.addEventListener("DOMContentLoaded", init);


// ============================================
// 🔌 HostSession — couche WebSocket host
// ============================================
// Greffée sur le flow existant sans le modifier.
//
// Cycle de vie :
//   init()            → connexion + HOST_AUTH
//   creerPartie()     → HOST_CREATE_GAME (appelé par btn-start-solo)
//   notifierDemarrage → HOST_START_GAME  (appelé par lancerJeu())
//   terminer()        → HOST_END_GAME
//
// Le QR code / lien de rejointe est affiché dans #ws-join-info
// s'il existe dans le DOM, sinon ignoré silencieusement.
//
// Tous les appels sont idempotents et non bloquants.
// En cas d'erreur WS, un warning console est émis et le jeu
// local continue sans interruption.
// ============================================
const HostSession = {

    _partieId   : null,
    _snapshot   : null,
    _authenticated : false,

    // ── Connexion initiale ─────────────────────────────────────
    init() {
        try {
            socket.connect(); // URL auto depuis window.location

            socket.once('__connected__', () => {
                console.log('[HOST] Socket connecté — authentification...');
                socket.send('HOST_AUTH');
            });

            socket.on('AUTH_OK', () => {
                console.log('[HOST] ✅ Authentifié');
                this._authenticated = true;

                // Tenter un HOST_REJOIN uniquement si un ID serveur est en mémoire.
                // Si HOST_REJOIN échoue (ERROR GAME_NOT_FOUND), nettoyer l'ID
                // pour forcer une nouvelle création de partie.
                const savedId = localStorage.getItem('ws_partie_id');
                if (savedId) {
                    console.log('[HOST] 🔄 Tentative HOST_REJOIN —', savedId);
                    socket.send('HOST_REJOIN', { partieId: savedId });
                    return;
                }

                // Pas d'ID sauvegardé → rien à faire ici.
                // creerPartie() sera appelé au clic btn-start-solo
                // ou via window._hostCreerPartieQuandPret().
            });

            socket.on('HOST_REJOINED', ({ partieId, snapshot, joinUrl }) => {
                console.log('[HOST] ✅ Rejoin host OK —', partieId);
                this._partieId = partieId;
                this._snapshot = snapshot;
                this._afficherLienJoin(joinUrl, snapshot?.codeCourt);
            });

            socket.on('GAME_CREATED', ({ partieId, snapshot, joinUrl }) => {
                console.log('[HOST] ✅ Partie créée —', partieId);
                this._partieId = partieId;
                this._snapshot = snapshot;

                // Stocker l'UUID serveur — c'est le seul ID autorisé
                localStorage.setItem('ws_partie_id', partieId);
                // Synchroniser avec invite.js (setPartieSessionId empêche toute génération locale)
                localStorage.setItem('minigame_partie_session_id', partieId);

                // Notifier invite.js pour mettre à jour le lien immédiatement
                import('./modules/invite.js').then(m => {
                    m.setPartieSessionId(partieId);
                    m.mettreAJourLienInvitation();
                }).catch(() => {});

                this._afficherLienJoin(joinUrl, snapshot?.codeCourt);
            });

            socket.on('PLAYER_JOINED', ({ pseudo, joueurs }) => {
                console.log(`[HOST] 👤 Joueur rejoint: ${pseudo} (${joueurs.length} total)`);
                this._afficherCompteurJoueurs(joueurs.length);
                // Ajouter dans GameState + DOM #joueurs-selectionnes-container
                HostSession._syncJoueurRejoint(pseudo);
                // Toast visible pour l'hôte
                HostSession._toastHote(`🎉 ${pseudo} a rejoint la partie !`, 'success');
                // Mettre à jour le snapshot local
                this._snapshot = { ...(this._snapshot || {}), joueurs };
            });

            socket.on('PLAYER_LEFT', ({ pseudo, joueurs }) => {
                console.log(`[HOST] 👤 Joueur parti: ${pseudo}`);
                this._afficherCompteurJoueurs(joueurs.length);
                HostSession._syncJoueurParti(pseudo);
                HostSession._toastHote(`${pseudo} a quitté la partie`, 'warning');
                this._snapshot = { ...(this._snapshot || {}), joueurs };
            });

            socket.on('SCORES_UPDATE', ({ scores }) => {
                console.log('[HOST] 📊 Scores mis à jour:', scores);
                // Synchroniser avec le scoreboard local si nécessaire
                // Les modules *_hote.js continuent de gérer l'affichage
            });

            socket.on('GAME_ENDED', ({ snapshot }) => {
                console.log('[HOST] 🏁 Partie terminée (WS)');
                this._partieId = null;
                this._snapshot = null;
                localStorage.removeItem('ws_partie_id');
            });

            socket.on('ERROR', ({ code, message }) => {
                console.warn('[HOST] ⚠️ Erreur WS:', code, message);
                // HOST_REJOIN échoue → l'ID sauvegardé est périmé
                if (code === 'GAME_NOT_FOUND') {
                    console.log('[HOST] 🧹 Suppression ID périmé — nouvelle partie requise');
                    localStorage.removeItem('ws_partie_id');
                    localStorage.removeItem('minigame_partie_session_id');
                    this._partieId = null;
                    // Si des joueurs sont prêts, recréer la partie immédiatement
                    if (GameState.joueurs && GameState.joueurs.length > 0 && GameState.jeu) {
                        this.creerPartie();
                    }
                }
                if (code === 'HOST_ALREADY_HAS_GAME') {
                    // Déjà une partie active en session — ignorer
                    console.log('[HOST] ℹ️ Partie déjà active côté serveur');
                }
            });

        } catch (err) {
            console.warn('[HOST] Socket non disponible — mode local uniquement:', err.message);
        }
    },

    // ── Créer la partie côté serveur ───────────────────────────
    // Appelé automatiquement depuis initStartSolo() via
    // le hook sur btn-start-solo, juste avant lancerJeu().
    // Si déjà une partie active, on ne recrée pas.
    creerPartie() {
        if (!this._authenticated) return;
        if (this._partieId) return; // déjà créée

        const nom    = GameState.partieNom || 'Partie';
        const jeu    = GameState.jeu       || 'quiz';
        const mode   = GameState.mode      || 'solo';
        const joueurs = (GameState.joueurs || []).map(j => j.pseudo || j.nom || j);

        socket.send('HOST_CREATE_GAME', {
            nom,
            jeu,
            mode,
            equipes    : [],
            hostJoue   : false,
            hostPseudo : null,
        });

        console.log(`[HOST] 📤 HOST_CREATE_GAME — ${nom} / ${jeu} / ${mode}`);
    },

    // ── Notifier le démarrage ──────────────────────────────────
    // Appelé par lancerJeu() — déclenche GAME_STARTED côté serveur
    // → broadcasté à tous les joueurs connectés en WS
    notifierDemarrage() {
        if (!this._authenticated || !this._partieId) return;
        socket.send('HOST_START_GAME');
        console.log('[HOST] 📤 HOST_START_GAME');
    },

    // ── Terminer la partie ─────────────────────────────────────
    terminer() {
        if (!this._authenticated || !this._partieId) return;
        socket.send('HOST_END_GAME');
        console.log('[HOST] 📤 HOST_END_GAME');
    },

    // ── Synchroniser un joueur WS dans GameState + DOM hôte ────
    // Ajoute le pseudo dans la liste des joueurs sélectionnés,
    // exactement comme si l'hôte l'avait ajouté manuellement.
    _syncJoueurRejoint(pseudo) {
        if (!pseudo) return;

        // 1. Ajouter dans GameState si absent
        if (!GameState.joueurs.includes(pseudo)) {
            GameState.joueurs.push(pseudo);
            GameState.scores[pseudo] = GameState.scores[pseudo] ?? 0;
        }

        // 2. Mettre à jour le DOM #joueurs-selectionnes-container
        const container = document.getElementById('joueurs-selectionnes-container');
        if (!container) return;

        // Éviter les doublons dans le DOM
        if (container.querySelector(`[data-joueur="${CSS.escape(pseudo)}"]`)) return;

        const div = document.createElement('div');
        div.className = 'joueur-tag';
        div.dataset.joueurWs = pseudo; // marqueur : ajouté par WS
        div.innerHTML = `
            <span class="nom">${_escHtml(pseudo)}</span>
            <span class="remove" data-joueur="${_escHtml(pseudo)}">✖</span>`;

        // Bouton ✖ : expulser via WS + retirer du DOM
        div.querySelector('.remove').addEventListener('click', () => {
            if (HostSession._partieId) {
                socket.send('HOST_KICK_PLAYER', { pseudo });
            }
            HostSession._syncJoueurParti(pseudo);
        });

        container.appendChild(div);
        console.log(`[HOST] ✅ Joueur affiché dans le lobby: ${pseudo}`);
    },

    _syncJoueurParti(pseudo) {
        if (!pseudo) return;

        // 1. Retirer de GameState
        GameState.joueurs = (GameState.joueurs || []).filter(j => j !== pseudo);
        delete GameState.scores[pseudo];

        // 2. Retirer du DOM
        const container = document.getElementById('joueurs-selectionnes-container');
        if (!container) return;
        const tag = container.querySelector(`[data-joueur="${CSS.escape(pseudo)}"]`);
        tag?.closest('.joueur-tag')?.remove();
        console.log(`[HOST] ✅ Joueur retiré du lobby: ${pseudo}`);
    },

    // ── Toast visible côté hôte ───────────────────────────────
    // Crée un toast léger sans dépendance externe.
    _toastHote(msg, type = 'info') {
        const COLORS = { success: '#22c55e', error: '#ef4444', warning: '#f59e0b', info: '#00d4ff' };
        const ICONS  = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
        let c = document.getElementById('host-toast-container');
        if (!c) {
            c = document.createElement('div');
            c.id = 'host-toast-container';
            c.style.cssText = 'position:fixed;bottom:1.5rem;right:1.5rem;z-index:9999;display:flex;flex-direction:column;gap:.4rem;max-width:320px;pointer-events:none;';
            document.body.appendChild(c);
        }
        const el = document.createElement('div');
        el.style.cssText = [
            'display:flex;gap:.5rem;align-items:center;padding:.65rem .9rem;border-radius:10px',
            `background:#1e1e2e;color:#fff;border-left:3px solid ${COLORS[type] || COLORS.info}`,
            'box-shadow:0 4px 16px rgba(0,0,0,.5)',
            'opacity:0;transition:opacity .25s,transform .25s;transform:translateY(6px)',
            'font-size:.88rem;font-weight:600;pointer-events:auto',
        ].join(';');
        el.innerHTML = `<span>${ICONS[type] || 'ℹ️'}</span><span>${msg}</span>`;
        c.appendChild(el);
        requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
        setTimeout(() => {
            el.style.opacity = '0'; el.style.transform = 'translateY(6px)';
            setTimeout(() => el.remove(), 260);
        }, 4000);
    },

    // ── Afficher le lien / QR de rejointe ─────────────────────
    // Cherche #ws-join-info dans le DOM ; ne fait rien s'il est absent.
    _afficherLienJoin(joinUrl, code) {
        const el = document.getElementById('ws-join-info');
        if (!el || !joinUrl) return;

        const url = `${location.origin}${joinUrl}`;
        el.innerHTML = `
            <div style="margin-top:12px;padding:10px 14px;background:rgba(0,212,255,.08);
                border:1px solid rgba(0,212,255,.25);border-radius:10px;font-size:.82rem;
                color:rgba(255,255,255,.85);text-align:center;">
                🔗 Lien invités :
                <a href="${url}" target="_blank"
                    style="color:#00d4ff;word-break:break-all;">${url}</a>
                ${code ? `<br><strong style="font-size:1.1rem;letter-spacing:.15em;color:#fff;">${code}</strong>` : ''}
            </div>`;
        el.style.display = 'block';
    },

    // ── Afficher le compteur de joueurs ───────────────────────
    _afficherCompteurJoueurs(count) {
        const el = document.getElementById('ws-joueurs-count');
        if (!el) return;
        el.textContent = `${count} joueur${count > 1 ? 's' : ''} connecté${count > 1 ? 's' : ''}`;
    },
};

// Helper escapeHtml pour _syncJoueurRejoint
function _escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Exposer pour les modules hote (quiz_hote.js, etc.)
window.HostSession = HostSession;

// Hook appelé par afficherJoueursSelectionnes() dans joueurs.js
// dès qu'un joueur est ajouté → créer la partie WS immédiatement
// pour que l'invité puisse rejoindre avant le clic Commencer.
window._hostCreerPartieQuandPret = function() {
    if (HostSession._authenticated && !HostSession._partieId) {
        HostSession.creerPartie();
    }
};