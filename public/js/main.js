// /js/main.js
// ======================================================
// 🚀 MAIN.JS — Orchestrateur principal
// ======================================================

import { $, show, hide } from "./core/dom.js";
import { GameState } from "./core/state.js";
import { getPlayers, addPlayer, saveNewParty, loadGame } from "./core/storage.js";
import { initNavigation, naviguerVers, naviguerVersAccueil } from "./navigation.js";
import { afficherScoreboard, masquerScoreboard, resetScoreboard } from "./modules/scoreboard.js";
import { creerNouvellePartie } from "./modules/parties.js";

// ======================================================
// 🏠 ACCUEIL HUB
// ======================================================

export function initHomeHub() {
    const stats = _getQuickStats();

    const hub = $("home");
    if (!hub) return;

    hub.querySelector(".home-stat-parties")?.childNodes && null;

    const statParties = hub.querySelector("[data-stat='parties']");
    const statJoueurs = hub.querySelector("[data-stat='joueurs']");
    const statPoints  = hub.querySelector("[data-stat='points']");

    if (statParties) statParties.textContent = stats.parties;
    if (statJoueurs) statJoueurs.textContent = stats.joueurs;
    if (statPoints)  statPoints.textContent  = stats.points;
}

function _getQuickStats() {
    try {
        const parties = JSON.parse(localStorage.getItem("parties") || "[]");
        const players = JSON.parse(localStorage.getItem("players") || "[]");
        const scores  = JSON.parse(localStorage.getItem("scores_globaux") || "{}");
        let totalPts = 0;
        Object.values(scores).forEach(d => { totalPts += d.total || 0; });
        return { parties: parties.length, joueurs: players.length, points: totalPts };
    } catch { return { parties: 0, joueurs: 0, points: 0 }; }
}

// ======================================================
// 🎮 SÉLECTION DU JEU
// ======================================================

export function initChoixJeu() {
    document.querySelectorAll(".jeu-card[data-jeu]").forEach(card => {
        card.addEventListener("click", () => {
            GameState.jeu = card.dataset.jeu;
            naviguerVers("choix-mode", "choix-jeu");
        });
    });
}

// ======================================================
// 🔀 CHOIX DU MODE
// ======================================================

export function initChoixMode() {
    $("btn-mode-solo")?.addEventListener("click", () => {
        GameState.mode = "solo";
        naviguerVers("form-solo", "choix-mode");
        initFormSolo();
    });

    $("btn-mode-equipes")?.addEventListener("click", () => {
        GameState.mode = "team";
        naviguerVers("form-equipes", "choix-mode");
        initFormEquipes();
    });
}

// ======================================================
// 📝 FORMULAIRE SOLO
// ======================================================

export function initFormSolo() {
    _renderJoueursCheckboxes();

    $("btn-add-joueur-solo")?.addEventListener("click", () => {
        const input = $("input-new-joueur-solo");
        const pseudo = input?.value.trim();
        if (!pseudo) return;
        addPlayer(pseudo);
        input.value = "";
        _renderJoueursCheckboxes();
    });

    $("input-new-joueur-solo")?.addEventListener("keydown", e => {
        if (e.key === "Enter") $("btn-add-joueur-solo")?.click();
    });

    $("btn-start-solo")?.addEventListener("click", _lancerPartieSolo);
}

function _renderJoueursCheckboxes() {
    const container = $("liste-joueurs-solo");
    if (!container) return;

    const joueurs = getPlayers();

    if (joueurs.length === 0) {
        container.innerHTML = `<p class="empty-list">Aucun joueur — ajoutez-en ci-dessus</p>`;
        return;
    }

    container.innerHTML = joueurs.map(j => `
        <label class="joueur-checkbox-label">
            <input type="checkbox" name="joueur-solo" value="${_esc(j)}" checked>
            <span class="joueur-check-avatar">${j.charAt(0).toUpperCase()}</span>
            <span class="joueur-check-nom">${_esc(j)}</span>
        </label>
    `).join("");
}

function _lancerPartieSolo() {
    const checked = [...document.querySelectorAll('input[name="joueur-solo"]:checked')]
        .map(cb => cb.value);

    if (checked.length === 0) {
        alert("Sélectionne au moins un joueur."); return;
    }

    GameState.joueurs = checked;
    GameState.scores  = {};

    const nomPartie = $("input-nom-partie-solo")?.value.trim() || `${GameState.jeu} — Solo`;

    const partie = creerNouvellePartie({
        jeu:       GameState.jeu,
        mode:      "solo",
        nomPartie,
        joueurs:   checked,
        equipes:   [],
    });

    resetScoreboard();
    lancerJeu(GameState.jeu);
}

// ======================================================
// 📝 FORMULAIRE ÉQUIPES
// ======================================================

export function initFormEquipes() {
    GameState.equipes = [];
    _renderEquipesForm();

    $("btn-add-equipe")?.addEventListener("click", () => {
        const input = $("input-nom-equipe");
        const nom = input?.value.trim();
        if (!nom) return;
        if (GameState.equipes.some(e => e.nom.toLowerCase() === nom.toLowerCase())) {
            alert("Ce nom existe déjà."); return;
        }
        GameState.equipes.push({ nom, joueurs: [] });
        input.value = "";
        _renderEquipesForm();
    });

    $("input-nom-equipe")?.addEventListener("keydown", e => {
        if (e.key === "Enter") $("btn-add-equipe")?.click();
    });

    $("btn-start-equipes")?.addEventListener("click", _lancerPartieEquipes);
}

function _renderEquipesForm() {
    const container = $("liste-equipes-form");
    if (!container) return;

    const joueurs = getPlayers();

    if (GameState.equipes.length === 0) {
        container.innerHTML = `<p class="empty-list">Créez au moins 2 équipes</p>`;
        return;
    }

    container.innerHTML = GameState.equipes.map((eq, i) => `
        <div class="equipe-form-item">
            <div class="equipe-form-header">
                <span class="equipe-form-nom">🛡️ ${_esc(eq.nom)}</span>
                <button class="btn-del-equipe" data-i="${i}">✖</button>
            </div>
            <div class="equipe-form-membres">
                ${(eq.joueurs || []).map(j => `
                    <span class="equipe-membre-tag">
                        ${_esc(j)}
                        <button class="btn-del-membre" data-equipe="${i}" data-joueur="${_esc(j)}">×</button>
                    </span>
                `).join("")}
            </div>
            <div class="equipe-form-add">
                <select class="select-primary equipe-select-joueur" data-i="${i}">
                    <option value="">＋ Ajouter un membre</option>
                    ${joueurs.filter(j => !eq.joueurs?.includes(j)).map(j =>
                        `<option value="${_esc(j)}">${_esc(j)}</option>`
                    ).join("")}
                </select>
            </div>
        </div>
    `).join("");

    // Supprimer équipe
    container.querySelectorAll(".btn-del-equipe").forEach(btn => {
        btn.addEventListener("click", () => {
            GameState.equipes.splice(parseInt(btn.dataset.i), 1);
            _renderEquipesForm();
        });
    });

    // Supprimer membre
    container.querySelectorAll(".btn-del-membre").forEach(btn => {
        btn.addEventListener("click", () => {
            const i = parseInt(btn.dataset.equipe);
            GameState.equipes[i].joueurs = GameState.equipes[i].joueurs.filter(j => j !== btn.dataset.joueur);
            _renderEquipesForm();
        });
    });

    // Ajouter membre
    container.querySelectorAll(".equipe-select-joueur").forEach(sel => {
        sel.addEventListener("change", () => {
            const i = parseInt(sel.dataset.i);
            const joueur = sel.value;
            if (!joueur) return;
            if (!GameState.equipes[i].joueurs) GameState.equipes[i].joueurs = [];
            if (!GameState.equipes[i].joueurs.includes(joueur)) {
                GameState.equipes[i].joueurs.push(joueur);
            }
            _renderEquipesForm();
        });
    });
}

function _lancerPartieEquipes() {
    if (GameState.equipes.length < 2) {
        alert("Il faut au moins 2 équipes."); return;
    }

    const joueursSolo = GameState.equipes.flatMap(e => e.joueurs || []);
    const nomPartie = $("input-nom-partie-equipes")?.value.trim() || `${GameState.jeu} — Équipes`;

    GameState.joueurs = joueursSolo;
    GameState.scores  = {};

    creerNouvellePartie({
        jeu:       GameState.jeu,
        mode:      "team",
        nomPartie,
        joueurs:   joueursSolo,
        equipes:   GameState.equipes,
    });

    resetScoreboard();
    lancerJeu(GameState.jeu);
}

// ======================================================
// 🎮 LANCEMENT DES JEUX
// ======================================================

export async function lancerJeu(jeu) {
    GameState.jeuActuel = jeu;

    // Cacher tous les écrans de formulaire
    ["choix-jeu", "choix-mode", "form-solo", "form-equipes", "liste-parties"].forEach(id => hide(id));

    // Afficher le conteneur principal
    show("container");

    // Cas spécial : Undercover a ses propres sous-écrans
    if (jeu === "undercover") {
        _lancerUndercover();
        return;
    }

    // Afficher l'écran du jeu
    const ecranJeu = jeu === "mimer" ? "mimer" : jeu;
    show(ecranJeu);

    // Afficher le scoreboard
    const participants = GameState.mode === "team"
        ? GameState.equipes.map(e => e.nom)
        : GameState.joueurs;
    participants.forEach(p => { if (!GameState.scores[p]) GameState.scores[p] = 0; });
    afficherScoreboard();

    // Initialiser le jeu
    try {
        switch (jeu) {
            case "quiz":       await _importAndInit("./games/quiz.js",       "initialiserQuiz");       break;
            case "justeprix":  await _importAndInit("./games/justeprix.js",  "initialiserJustePrix");  break;
            case "lml":        await _importAndInit("./games/lml.js",        "initialiserLML");        break;
            case "pendu":      await _importAndInit("./games/pendu.js",      "initialiserPendu");      break;
            case "petitbac":   await _importAndInit("./games/petitbac.js",   "initialiserPetitBac");   break;
            case "memoire":    await _importAndInit("./games/memoire.js",    "initialiserMemoire");    break;
            case "morpion":    await _importAndInit("./games/morpion.js",    "initialiserMorpion");    break;
            case "puissance4": await _importAndInit("./games/puissance4.js", "initialiserPuissance4"); break;
            case "mimer":      await _importAndInit("./games/mimedessine.js","initialiserMimer");      break;
            default:
                console.warn("[MAIN] Jeu inconnu:", jeu);
        }
    } catch (err) {
        console.error("[MAIN] Erreur lancement jeu:", err);
    }
}

async function _importAndInit(path, fnName) {
    // Essayer window.* d'abord (jeux avec window export)
    if (typeof window[fnName] === "function") {
        await window[fnName]();
        return;
    }
    // Sinon import dynamique
    const mod = await import(path);
    if (typeof mod[fnName] === "function") {
        await mod[fnName]();
    } else {
        console.warn(`[MAIN] ${fnName} introuvable dans ${path}`);
    }
}

function _lancerUndercover() {
    show("undercover-config");
    const { initialiserUndercover } = window;
    if (typeof initialiserUndercover === "function") {
        // Déjà initialisé automatiquement dans le module
    }
}

// Expose pour modules externes
window._mainModule = { lancerJeu };
window.lancerJeu   = lancerJeu;
window.afficherAccueilJeux = naviguerVersAccueil;

// ======================================================
// 🔒 PRIVÉ
// ======================================================

function _esc(str) {
    return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ======================================================
// 🚀 INIT AU CHARGEMENT
// ======================================================

document.addEventListener("DOMContentLoaded", () => {
    initNavigation();

    // Boutons accueil → Jouer
    $("btn-jouer")?.addEventListener("click", () => naviguerVers("choix-jeu", "home"));

    // Boutons home
    $("btn-home-stats")?.addEventListener("click", () => {
        import("./navigation.js").then(m => m.afficherStatsDashboard());
    });

    initChoixJeu();
    initChoixMode();
    initHomeHub();

    // Restaurer partie en cours si disponible
    const partieEnCours = loadGame();
    if (partieEnCours) {
        console.log("[MAIN] Partie en cours détectée:", partieEnCours.id);
    }
});