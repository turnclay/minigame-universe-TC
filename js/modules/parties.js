// /js/modules/parties.js

import { $, show, hide } from "../core/dom.js";
import { GameState } from "../core/state.js";
import { naviguerVersAccueil } from "../navigation.js";
import {
    getAllParties,
    saveNewParty,
    loadPartyById,
    loadGame,
    saveGame,
    getScoresGlobaux
} from "../core/storage.js";

// ======================================================
// 🎮 Bouton "Continuer"
// ======================================================
export function initContinueButton() {
    const partie = loadGame();
    if (partie) show("continue-block");
    else hide("continue-block");
}

// ======================================================
// 🧱 Conteneur liste des parties
// ======================================================
function ensureContainer() {
    let zone = $("liste-parties");
    if (!zone) {
        zone = document.createElement("div");
        zone.id = "liste-parties";
        zone.className = "liste-parties";
        document.body.appendChild(zone);
    }
    return zone;
}

// ======================================================
// 🟦 Suggestions de parties (datalist)
// ======================================================
export function remplirSuggestionsParties() {
    const datalist = document.getElementById("suggestions-parties");
    if (!datalist) return;

    const parties = getAllParties();
    datalist.innerHTML = "";
    parties.forEach(p => {
        const option = document.createElement("option");
        option.value = p.nomPartie;
        datalist.appendChild(option);
    });
}

// ======================================================
// 🏆 Calcul du meilleur score d'une partie
// Cherche d'abord dans les scores sauvegardés de la partie,
// puis dans les scores globaux si la partie a des scores à 0.
// ======================================================
function getBestScorePartie(p) {
    // 1. Scores directs dans la partie
    if (p.scores && Object.keys(p.scores).length > 0) {
        const maxLocal = Math.max(...Object.values(p.scores));
        if (maxLocal > 0) return maxLocal;
    }

    // 2. Fallback : scores globaux filtrés par les participants de cette partie
    const scoresGlobaux = getScoresGlobaux();
    const participants = p.mode === "team"
        ? (p.equipes || []).map(e => e.nom)
        : (p.joueurs || []);

    if (participants.length === 0) return 0;

    const jeu = p.jeu || "";
    let maxGlobal = 0;

    participants.forEach(nom => {
        if (scoresGlobaux[nom]) {
            // Score pour ce jeu spécifique si disponible
            const scoreJeu = scoresGlobaux[nom]?.parJeu?.[jeu] || 0;
            maxGlobal = Math.max(maxGlobal, scoreJeu);
        }
    });

    return maxGlobal;
}

// ======================================================
// 📜 Afficher la liste des parties
// ======================================================
export function afficherListeParties() {
    const zone = ensureContainer();
    const parties = getAllParties();

    hide("home");
    zone.innerHTML = "";

    const header = document.createElement("div");
    header.className = "parties-header";

    const titre = document.createElement("h1");
    titre.className = "titre-partie";
    titre.textContent = "Charger une partie";
    header.appendChild(titre);
    zone.appendChild(header);

    if (parties.length === 0) {
        const p = document.createElement("p");
        p.textContent = "Aucune partie enregistrée.";
        zone.appendChild(p);
        show("liste-parties");

        const btnRetour = $("btn-retour-permanent");
        if (btnRetour) btnRetour.hidden = false;
        return;
    }

    parties.forEach(p => {
        const div = document.createElement("div");
        div.className = "partie-item";

        const dateObj  = new Date(p.date);
        const dateStr  = dateObj.toLocaleDateString("fr-FR");
        const heureStr = dateObj.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

        // ✅ FIX : calcul intelligent du meilleur score
        const meilleurScore = getBestScorePartie(p);
        const bestScore = meilleurScore > 0 ? `${meilleurScore} pts` : "Aucun score encore";

        const nomJeu    = String(p.jeu || "").toUpperCase();
        const modeLabel = p.mode === "team" ? "Équipes" : "Solo";

        let participantsLabel = "";
        if (p.mode === "team" && Array.isArray(p.equipes) && p.equipes.length > 0) {
            participantsLabel = p.equipes.map(e => e.nom).join(", ");
        } else if (Array.isArray(p.joueurs) && p.joueurs.length > 0) {
            participantsLabel = p.joueurs.join(", ");
        }

        // Calcul de la durée depuis la création
        const maintenant = new Date();
        const diffMs = maintenant - dateObj;
        const diffMin = Math.floor(diffMs / 60000);
        const diffH = Math.floor(diffMin / 60);
        const diffJ = Math.floor(diffH / 24);
        let anciennete = "";
        if (diffJ > 0) anciennete = `il y a ${diffJ}j`;
        else if (diffH > 0) anciennete = `il y a ${diffH}h`;
        else if (diffMin > 0) anciennete = `il y a ${diffMin}min`;
        else anciennete = "à l'instant";

        div.innerHTML = `
            <h3>${p.nomPartie}
                <span class="date-partie-mini"> — le ${dateStr} à ${heureStr} (${anciennete})</span>
            </h3>
            <p>${nomJeu} • Mode : ${modeLabel} • Meilleur score : <strong class="best-score-badge">${bestScore}</strong></p>
            ${participantsLabel ? `<p class="participants-resume">Participant(s) : ${participantsLabel}</p>` : ""}
        `;

        // ── Bouton Charger ──────────────────────────────────
        const btnLoad = document.createElement("button");
        btnLoad.className = "btn-load";
        btnLoad.textContent = "Charger";
        btnLoad.dataset.id = p.id;

        btnLoad.onclick = () => {
            const partie = chargerPartie(p.id);
            if (!partie) return alert("Partie introuvable");

            console.log("[PARTIES] Chargement de la partie:", partie);

            // Undercover : retour à l'écran de config
            if (partie.jeu === "undercover") {
                hide("liste-parties");
                hide("home");
                show("container");

                const ucConfig = document.getElementById("undercover-config");
                const ucDistrib = document.getElementById("undercover-distribution");
                const ucGame   = document.getElementById("undercover");

                if (ucDistrib) { ucDistrib.hidden = true;  ucDistrib.style.display = "none"; }
                if (ucGame)    { ucGame.hidden = true;     ucGame.style.display = "none"; }
                if (ucConfig)  { ucConfig.hidden = false;  ucConfig.style.display = "block"; }

                const spanNbJoueurs = document.getElementById("uc-nb-joueurs");
                if (spanNbJoueurs) spanNbJoueurs.textContent = partie.joueurs.length;

                console.log("[PARTIES] ✅ Undercover prêt à être configuré");
                return;
            }

            // Autres jeux
            window.lancerJeu(partie.jeu, { fromLoad: true });
            hide("liste-parties");
        };

        div.appendChild(btnLoad);

        // ── Bouton Supprimer ────────────────────────────────
        const btnDelete = document.createElement("button");
        btnDelete.className = "btn-delete noselect";
        btnDelete.dataset.id = p.id;
        btnDelete.innerHTML = `<span class="text">Supprimer</span><span class="icon">🗑️</span>`;

        btnDelete.onclick = () => {
            if (!confirm("Supprimer cette partie ?")) return;

            let list = getAllParties().filter(partie => String(partie.id) !== String(p.id));
            localStorage.setItem("parties", JSON.stringify(list));

            const partieEnCours = loadGame();
            if (partieEnCours && String(partieEnCours.id) === String(p.id)) {
                localStorage.removeItem("partie_en_cours");
            }

            initContinueButton();
            afficherListeParties();
        };

        div.appendChild(btnDelete);
        zone.appendChild(div);
    });

    show("liste-parties");

    const btnRetour = $("btn-retour-permanent");
    if (btnRetour) btnRetour.hidden = false;
}

// ======================================================
// 📥 Charger une partie
// Restaure GameState depuis la partie sauvegardée.
// ⚠️ N'appelle PAS saveGame() pour éviter de déclencher
//    une sync globale inutile.
// ======================================================
export function chargerPartie(id) {
    const partie = loadPartyById(id);
    if (!partie) return null;

    // Restaure le GameState depuis la sauvegarde
    GameState.jeuActuel  = partie.jeu;
    GameState.mode       = partie.mode;
    GameState.partieNom  = partie.nomPartie;
    GameState.scores     = { ...partie.scores };   // copie des scores sauvegardés
    GameState.partieEnCoursChargee = true;

    if (partie.mode === "team") {
        GameState.equipes = partie.equipes || [];
        GameState.joueurs = [];
    } else {
        GameState.joueurs = partie.joueurs || [];
        GameState.equipes = [];
    }

    // Met à jour "partie_en_cours" dans le storage SANS sync globale
    localStorage.setItem("partie_en_cours", JSON.stringify(partie));

    return partie;
}

// ======================================================
// 🆕 Créer une nouvelle partie
// ======================================================
export function creerNouvellePartie() {
    const data = {
        jeu:       GameState.jeuActuel,
        mode:      GameState.mode,
        nomPartie: GameState.partieNom,
    };

    if (GameState.mode === "team") {
        data.equipes = GameState.equipes || [];
        data.joueurs = [];
    } else {
        data.joueurs = GameState.joueurs || [];
        data.equipes = [];
    }

    const nouvellePartie = saveNewParty(data);

    // Synchronise GameState.scores avec les scores initiaux (tous à 0)
    GameState.scores = { ...nouvellePartie.scores };

    initContinueButton();
}