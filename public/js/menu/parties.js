// /js/modules/parties.js
// ======================================================
// 📋 MODULE GESTION DES PARTIES
// ======================================================

import { $, show, hide } from "../core/dom.js";
import { GameState } from "../core/state.js";
import {
    getAllParties, saveNewParty, deleteParty, loadPartyById
} from "../core/storage.js";
import { naviguerVers } from "../navigation.js";
import { resetScoreboard } from "./scoreboard.js";

// ======================================================
// 📌 CRÉER UNE NOUVELLE PARTIE
// ======================================================

export function creerNouvellePartie(data) {
    const partie = saveNewParty(data);

    // Mettre à jour GameState
    GameState.mode       = data.mode;
    GameState.jeu        = data.jeu;
    GameState.partieNom  = data.nomPartie || "";
    GameState.joueurs    = data.joueurs || [];
    GameState.equipes    = data.equipes || [];
    GameState.scores     = {};
    GameState.partieEnCoursChargee = false;

    console.log("[PARTIES] Nouvelle partie créée:", partie.id);
    return partie;
}

// ======================================================
// 📋 AFFICHER LA LISTE DES PARTIES
// ======================================================

export function afficherListeParties() {
    const parties = getAllParties();
    const container = $("liste-parties-content");
    if (!container) return;

    if (parties.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📂</div>
                <p>Aucune partie enregistrée</p>
                <button class="btn-primary" onclick="document.getElementById('menu-btn-nouvelle').click()">
                    Créer une partie
                </button>
            </div>
        `;
        return;
    }

    const sorted = [...parties].sort((a, b) =>
        new Date(b.date) - new Date(a.date)
    );

    const JEUX_ICONS = {
        quiz: "❓", justeprix: "💰", undercover: "🕵️", lml: "📖",
        mimer: "🎭", pendu: "🪢", petitbac: "📝", memoire: "🧠",
        morpion: "⭕", puissance4: "🔴"
    };

    container.innerHTML = sorted.map(p => {
        const date = new Date(p.date).toLocaleDateString("fr-FR", {
            day: "2-digit", month: "short", year: "numeric",
            hour: "2-digit", minute: "2-digit"
        });
        const icon = JEUX_ICONS[p.jeu] || "🎮";
        const participants = p.mode === "team"
            ? (p.equipes || []).map(e => e.nom).join(", ")
            : (p.joueurs || []).join(", ");

        const topScore = Object.entries(p.scores || {})
            .sort((a, b) => b[1] - a[1])[0];

        return `
            <div class="partie-card" data-id="${p.id}">
                <div class="partie-card-header">
                    <span class="partie-icon">${icon}</span>
                    <div class="partie-info">
                        <h3 class="partie-nom">${_esc(p.nomPartie || p.jeu)}</h3>
                        <span class="partie-jeu">${_esc(p.jeu?.toUpperCase())}</span>
                    </div>
                    <span class="partie-mode-badge ${p.mode}">${p.mode === "team" ? "👥 Équipes" : "👤 Solo"}</span>
                </div>
                <div class="partie-card-body">
                    <div class="partie-meta">
                        <span class="partie-date">📅 ${date}</span>
                        <span class="partie-joueurs">👥 ${_esc(participants)}</span>
                    </div>
                    ${topScore ? `
                        <div class="partie-top-score">
                            🏆 <strong>${_esc(topScore[0])}</strong> — ${topScore[1]} pts
                        </div>
                    ` : ""}
                </div>
                <div class="partie-card-actions">
                    <button class="btn-reprendre" data-id="${p.id}">▶ Reprendre</button>
                    <button class="btn-supprimer" data-id="${p.id}">🗑️</button>
                </div>
            </div>
        `;
    }).join("");

    // Événements
    container.querySelectorAll(".btn-reprendre").forEach(btn => {
        btn.addEventListener("click", () => reprendrePartie(btn.dataset.id));
    });

    container.querySelectorAll(".btn-supprimer").forEach(btn => {
        btn.addEventListener("click", () => {
            if (confirm("Supprimer cette partie ?")) {
                deleteParty(btn.dataset.id);
                afficherListeParties();
            }
        });
    });
}

// ======================================================
// ▶ REPRENDRE UNE PARTIE
// ======================================================

function reprendrePartie(id) {
    const partie = loadPartyById(id);
    if (!partie) return alert("Partie introuvable.");

    GameState.mode       = partie.mode;
    GameState.jeu        = partie.jeu;
    GameState.partieNom  = partie.nomPartie || "";
    GameState.joueurs    = partie.joueurs || [];
    GameState.equipes    = partie.equipes || [];
    GameState.scores     = { ...partie.scores };
    GameState.partieEnCoursChargee = true;

    resetScoreboard();

    // Lancer le jeu
    const { lancerJeu } = window._mainModule || {};
    if (lancerJeu) lancerJeu(partie.jeu);
    else console.warn("[PARTIES] lancerJeu non disponible");
}

// ======================================================
// 🔒 PRIVÉ
// ======================================================

function _esc(str) {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}