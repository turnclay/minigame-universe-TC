// /js/modules/joueurs.js
// ======================================================
// 👥 MODULE GESTION DES JOUEURS
// ======================================================

import { show, hide } from "../core/dom.js";
import { getPlayers, addPlayer, getScoresGlobaux } from "../core/storage.js";
import { naviguerVers } from "../navigation.js";

export function afficherGestionJoueurs() {
    naviguerVers("gestion-joueurs-panel");
    _renderGestionJoueurs();
}

function _renderGestionJoueurs() {
    const panel = document.getElementById("gestion-joueurs-panel");
    if (!panel) return;

    const joueurs = getPlayers();
    const scoresGlob = getScoresGlobaux();

    panel.innerHTML = `
        <div class="gj-header">
            <h2 class="section-title">👥 Gestion des joueurs</h2>
        </div>

        <div class="gj-add-form">
            <input type="text" id="gj-input-pseudo" class="input-primary"
                   placeholder="Nouveau joueur…" maxlength="20"
                   autocomplete="off" autocorrect="off" autocapitalize="words">
            <button id="gj-btn-add" class="btn-primary">Ajouter</button>
        </div>

        <div class="gj-list" id="gj-list">
            ${joueurs.length === 0
                ? `<p class="gj-empty">Aucun joueur enregistré</p>`
                : joueurs.map(j => {
                    const pts = scoresGlob[j]?.total || 0;
                    return `
                        <div class="gj-item">
                            <div class="gj-avatar">${j.charAt(0).toUpperCase()}</div>
                            <span class="gj-nom">${_esc(j)}</span>
                            <span class="gj-pts">${pts} pts</span>
                        </div>
                    `;
                }).join("")
            }
        </div>

        <p class="gj-count">${joueurs.length} joueur${joueurs.length > 1 ? "s" : ""} enregistré${joueurs.length > 1 ? "s" : ""}</p>
    `;

    document.getElementById("gj-btn-add")?.addEventListener("click", () => {
        const input = document.getElementById("gj-input-pseudo");
        const pseudo = input?.value.trim();
        if (!pseudo) return;
        addPlayer(pseudo);
        input.value = "";
        _renderGestionJoueurs();
    });

    document.getElementById("gj-input-pseudo")?.addEventListener("keydown", e => {
        if (e.key === "Enter") document.getElementById("gj-btn-add")?.click();
    });
}

function _esc(str) {
    return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}