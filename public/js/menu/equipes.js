// /js/modules/equipes.js
// ======================================================
// 🛡️ MODULE GESTION DES ÉQUIPES
// ======================================================

import { getPlayers } from "../core/storage.js";
import { naviguerVers } from "../navigation.js";
import { GameState } from "../core/state.js";

export function afficherGestionEquipes() {
    naviguerVers("gestion-equipes-panel");
    _renderGestionEquipes();
}

function _renderGestionEquipes() {
    const panel = document.getElementById("gestion-equipes-panel");
    if (!panel) return;

    const equipes = GameState.equipes || [];
    const joueurs = getPlayers();

    panel.innerHTML = `
        <div class="ge-header">
            <h2 class="section-title">🛡️ Gestion des équipes</h2>
        </div>

        <div class="ge-add-form">
            <input type="text" id="ge-input-nom" class="input-primary"
                   placeholder="Nom de l'équipe…" maxlength="20">
            <button id="ge-btn-add" class="btn-primary">Créer</button>
        </div>

        <div class="ge-list" id="ge-list">
            ${equipes.length === 0
                ? `<p class="ge-empty">Aucune équipe créée</p>`
                : equipes.map((eq, i) => `
                    <div class="ge-item">
                        <div class="ge-item-header">
                            <span class="ge-nom">🛡️ ${_esc(eq.nom)}</span>
                            <button class="ge-del-btn" data-i="${i}">✖</button>
                        </div>
                        <div class="ge-membres">
                            ${(eq.joueurs || []).map(j => `<span class="ge-membre-tag">${_esc(j)}</span>`).join("") || "<em>Aucun membre</em>"}
                        </div>
                        <div class="ge-add-membre">
                            <select class="select-primary ge-select-joueur" data-i="${i}">
                                <option value="">Ajouter un membre…</option>
                                ${joueurs.filter(j => !eq.joueurs?.includes(j)).map(j =>
                                    `<option value="${_esc(j)}">${_esc(j)}</option>`
                                ).join("")}
                            </select>
                        </div>
                    </div>
                `).join("")
            }
        </div>
    `;

    document.getElementById("ge-btn-add")?.addEventListener("click", () => {
        const input = document.getElementById("ge-input-nom");
        const nom = input?.value.trim();
        if (!nom) return;
        if (GameState.equipes.some(e => e.nom.toLowerCase() === nom.toLowerCase())) {
            alert("Ce nom d'équipe existe déjà."); return;
        }
        GameState.equipes.push({ nom, joueurs: [] });
        input.value = "";
        _renderGestionEquipes();
    });

    document.querySelectorAll(".ge-del-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            GameState.equipes.splice(parseInt(btn.dataset.i), 1);
            _renderGestionEquipes();
        });
    });

    document.querySelectorAll(".ge-select-joueur").forEach(sel => {
        sel.addEventListener("change", () => {
            const i = parseInt(sel.dataset.i);
            const joueur = sel.value;
            if (!joueur) return;
            if (!GameState.equipes[i].joueurs) GameState.equipes[i].joueurs = [];
            GameState.equipes[i].joueurs.push(joueur);
            _renderGestionEquipes();
        });
    });
}

function _esc(str) {
    return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}