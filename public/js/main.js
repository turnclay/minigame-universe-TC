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
import HostSession from './core/host-session.js';

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
// 🔌 HostSession — couche WebSocket host
// ============================================
const HostSession = {

    _partieId      : null,
    _snapshot      : null,
    _authenticated : false,
    _pendingStart  : false,

    // Réinitialiser avant une nouvelle partie
    // Appelé dans initStartSolo() avant chaque creerPartie().
    reset() {
        this._partieId    = null;
        this._snapshot    = null;
        this._pendingStart = false;
        console.log('[HOST] 🔄 HostSession reset (nouvelle partie)');
    },

    // Connexion initiale
    init() {
        try {
            socket.connect();

            socket.once('__connected__', () => {
                console.log('[HOST] Socket connecté — authentification...');
                socket.send('HOST_AUTH');
            });

            socket.on('AUTH_OK', () => {
                console.log('[HOST] ✅ Authentifié');
                this._authenticated = true;

                const savedId = localStorage.getItem('minigame_partie_id');
                if (savedId) {
                    console.log('[HOST] 🔄 HOST_REJOIN —', savedId);
                    socket.send('HOST_REJOIN', { partieId: savedId });
                    return;
                }
                console.log('[HOST] ℹ️ Pas de partie sauvegardée — prêt à créer');
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

                localStorage.setItem('minigame_partie_id', partieId);

                import('./modules/invite.js').then(m => {
                    m.setPartieSessionId(partieId);
                    m.mettreAJourLienInvitation();
                }).catch(err => console.warn('[HOST] ⚠️ Erreur import invite.js:', err.message));

                this._afficherLienJoin(joinUrl, snapshot?.codeCourt);

                if (this._pendingStart) {
                    this._pendingStart = false;
                    socket.send('HOST_START_GAME', { partieId });
                    console.log('[HOST] 📤 HOST_START_GAME différé —', partieId);
                }
            });

            socket.on('PLAYER_JOINED', ({ pseudo, joueurs }) => {
                console.log(`[HOST] 👤 Joueur rejoint: ${pseudo} (${joueurs.length} total)`);
                this._afficherCompteurJoueurs(joueurs.length);
                HostSession._syncJoueurRejoint(pseudo);
                HostSession._toastHote(`🎉 ${pseudo} a rejoint la partie !`, 'success');
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
            });

            socket.on('GAME_ENDED', ({ snapshot }) => {
                console.log('[HOST] 🏁 Partie terminée (WS)');

                // Réinitialiser TOUT l'état de la partie terminée
                this._partieId    = null;
                this._snapshot    = null;
                this._pendingStart = false;

                localStorage.removeItem('minigame_partie_id');
                localStorage.removeItem('minigame_partie_session_id');

                // Réinitialiser quiz_hote
                resetEtatQuizHote();

                import('./modules/invite.js')
                    .then(m => m.resetPartieSessionId())
                    .catch(err => console.warn('[HOST] ⚠️ Erreur reset invite.js:', err.message));
            });

            socket.on('ERROR', ({ code, message }) => {
                console.warn('[HOST] ⚠️ Erreur WS:', code, message || '');

                if (code === 'GAME_NOT_FOUND') {
                    console.log('[HOST] 🧹 ID périmé supprimé — prêt pour une nouvelle partie');
                    localStorage.removeItem('minigame_partie_id');
                    localStorage.removeItem('minigame_partie_session_id');
                    this._partieId = null;
                    this._snapshot = null;
                    import('./modules/invite.js')
                        .then(m => m.resetPartieSessionId())
                        .catch(err => console.warn('[HOST] ⚠️ Erreur reset invite.js:', err.message));
                    if (GameState.joueurs && GameState.joueurs.length > 0 && GameState.jeu) {
                        this.creerPartie();
                    }
                }

                if (code === 'HOST_ALREADY_HAS_GAME') {
                    console.log('[HOST] ℹ️ Partie déjà active côté serveur — attente HOST_REJOINED');
                }

                if (code === 'NAME_TAKEN') {
                    console.warn('[HOST] ⚠️ Nom de partie déjà pris :', GameState.partieNom);
                    this._partieId = null;
                    this._toastHote('Ce nom de partie est déjà utilisé. Change le nom et réessaie.', 'error');
                }

                if (code === 'INTERNAL_ERROR') {
                    console.error('[HOST] ❌ INTERNAL_ERROR — vérifier logs serveur');
                    this._toastHote('Erreur serveur temporaire. Réessaie dans quelques secondes.', 'error');
                }
            });

        } catch (err) {
            console.warn('[HOST] Socket non disponible — mode local uniquement:', err.message);
        }
    },

    // Créer la partie côté serveur
    creerPartie() {
        if (!this._authenticated) {
            console.warn('[HOST] creerPartie() ignoré — pas authentifié');
            return;
        }
        if (this._partieId) {
            console.log('[HOST] creerPartie() ignoré — partie déjà créée:', this._partieId);
            return;
        }

        const nom        = GameState.partieNom || 'Partie';
        const jeu        = GameState.jeu       || 'quiz';
        const mode       = GameState.mode      || 'solo';
        const hostPseudo = (GameState.joueurs && GameState.joueurs.length > 0)
            ? String(GameState.joueurs[0]).trim()
            : null;

        try {
            socket.send('HOST_CREATE_GAME', {
                nom,
                jeu,
                mode,
                equipes    : [],
                hostJoue   : !!hostPseudo,
                hostPseudo : hostPseudo || null,
            });
            console.log(`[HOST] 📤 HOST_CREATE_GAME — ${nom} / ${jeu} / ${mode} / hostPseudo: ${hostPseudo}`);
        } catch (err) {
            console.error('[HOST] ❌ Erreur send HOST_CREATE_GAME:', err.message);
            this._toastHote('Erreur de connexion. Vérifie ta connexion internet.', 'error');
        }
    },

    // Notifier le démarrage
    notifierDemarrage() {
        if (!this._authenticated) {
            console.warn('[HOST] notifierDemarrage() ignoré — pas authentifié');
            return;
        }
        if (this._partieId) {
            try {
                socket.send('HOST_START_GAME', { partieId: this._partieId });
                console.log('[HOST] 📤 HOST_START_GAME —', this._partieId);
            } catch (err) {
                console.error('[HOST] ❌ Erreur send HOST_START_GAME:', err.message);
            }
        } else {
            console.warn('[HOST] ⏳ Pas de partieId — attente de GAME_CREATED pour démarrer');
            this._pendingStart = true;
            if (this._authenticated && !this._partieId) {
                this.creerPartie();
            }
        }
    },

    // Terminer la partie
    terminer() {
        if (!this._authenticated || !this._partieId) return;
        try {
            socket.send('HOST_END_GAME');
            console.log('[HOST] 📤 HOST_END_GAME');
        } catch (err) {
            console.error('[HOST] ❌ Erreur send HOST_END_GAME:', err.message);
        }
    },

    // Sync joueur dans GameState + DOM
    _syncJoueurRejoint(pseudo) {
        if (!pseudo) return;
        if (!GameState.joueurs.includes(pseudo)) {
            GameState.joueurs.push(pseudo);
            GameState.scores[pseudo] = GameState.scores[pseudo] ?? 0;
        }

        const container = document.getElementById('joueurs-selectionnes-container');
        if (!container) return;
        if (container.querySelector(`[data-joueur="${CSS.escape(pseudo)}"]`)) return;

        const div = document.createElement('div');
        div.className = 'joueur-tag';
        div.dataset.joueurWs = pseudo;
        div.innerHTML = `
            <span class="nom">${_escHtml(pseudo)}</span>
            <span class="remove" data-joueur="${_escHtml(pseudo)}">✖</span>`;

        div.querySelector('.remove').addEventListener('click', () => {
            if (HostSession._partieId) {
                try { socket.send('HOST_KICK_PLAYER', { pseudo }); }
                catch (err) { console.error('[HOST] ❌ Erreur send HOST_KICK_PLAYER:', err.message); }
            }
            HostSession._syncJoueurParti(pseudo);
        });

        container.appendChild(div);
        console.log(`[HOST] ✅ Joueur affiché dans le lobby: ${pseudo}`);
    },

    _syncJoueurParti(pseudo) {
        if (!pseudo) return;
        GameState.joueurs = (GameState.joueurs || []).filter(j => j !== pseudo);
        delete GameState.scores[pseudo];

        const container = document.getElementById('joueurs-selectionnes-container');
        if (!container) return;
        const tag = container.querySelector(`[data-joueur="${CSS.escape(pseudo)}"]`);
        tag?.closest('.joueur-tag')?.remove();
        console.log(`[HOST] ✅ Joueur retiré du lobby: ${pseudo}`);
    },

    // Toast hôte
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

    // Lien / QR
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

    _afficherCompteurJoueurs(count) {
        const el = document.getElementById('ws-joueurs-count');
        if (!el) return;
        el.textContent = `${count} joueur${count > 1 ? 's' : ''} connecté${count > 1 ? 's' : ''}`;
    },
};

function _escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

window.HostSession = HostSession;
window.jeuSocket   = socket;

window._hostCreerPartieQuandPret = function() {
    if (HostSession._authenticated && !HostSession._partieId) {
        HostSession.creerPartie();
    }
};