// /js/modules/joueurs.js

import { $, $$, show, hide } from "/js/core/dom.js";
import { GameState } from "../core/state.js";
import {
    getPlayers,
    addPlayer,
    getAllParties,
    getScoresGlobaux,
    getAllPerformances
} from "../core/storage.js";


// ======================================================
// 📌 1. Remplir la liste déroulante avec les joueurs existants
// ======================================================
export function remplirListeJoueurs(selectId) {
    const select = $(selectId);
    if (!select) return;

    const joueurs = getPlayers();
    select.innerHTML = "";

    joueurs.forEach(j => {
        const opt = document.createElement("option");
        opt.value = j;
        opt.textContent = j;
        select.appendChild(opt);
    });
}


// ======================================================
// 📌 2. Créer un nouveau joueur + mise à jour GameState
// ======================================================
export function creerNouveauJoueur(inputId, callback) {
    const input = $(inputId);
    if (!input) return;

    const pseudo = input.value.trim();
    if (pseudo === "") return;

    addPlayer(pseudo);

    if (!GameState.joueurs.includes(pseudo)) {
        GameState.joueurs.push(pseudo);
        GameState.scores[pseudo] = 0;
    }

    input.value = "";

    if (callback) callback(pseudo);
}


// ======================================================
// 📌 3. Ajouter un joueur existant depuis la liste
// ======================================================
export function ajouterJoueurDepuisListe(selectId) {
    const select = $(selectId);
    if (!select) return;

    const pseudo = select.value;
    if (!pseudo) return;

    if (!GameState.joueurs.includes(pseudo)) {
        GameState.joueurs.push(pseudo);
        GameState.scores[pseudo] = 0;
    }

    return pseudo;
}


// ======================================================
// 📌 4. Afficher les joueurs sélectionnés (tags + suppression)
// ======================================================
export function afficherJoueursSelectionnes(containerId) {
    const container = $(containerId);
    if (!container) return;

    container.innerHTML = "";

    GameState.joueurs.forEach(joueur => {
        const div = document.createElement("div");
        div.className = "joueur-tag";

        div.innerHTML = `
            <span class="nom">${joueur}</span>
            <span class="remove" data-joueur="${joueur}">✖</span>
        `;

        div.querySelector(".remove").onclick = () => {
            GameState.joueurs = GameState.joueurs.filter(j => j !== joueur);
            delete GameState.scores[joueur];
            afficherJoueursSelectionnes(containerId);
        };

        container.appendChild(div);
    });
}


// ======================================================
// 📌 5. Initialisation du formulaire SOLO
// ======================================================
export function initFormSolo() {
    remplirListeJoueurs("liste-joueurs");

    const btnCharger = $("charger-joueur");
    if (btnCharger) {
        btnCharger.onclick = () => {
            ajouterJoueurDepuisListe("liste-joueurs");
            afficherJoueursSelectionnes("joueurs-selectionnes-container");
        };
    }

    const btnCreer = $("creer-joueur");
    if (btnCreer) {
        btnCreer.onclick = () => {
            creerNouveauJoueur("pseudo-solo", () => {
                remplirListeJoueurs("liste-joueurs");
                afficherJoueursSelectionnes("joueurs-selectionnes-container");
            });
        };
    }
}


// ======================================================
// 📌 6. Validation du formulaire SOLO
// ======================================================
export function validerFormSolo() {
    if (!GameState.joueurs || GameState.joueurs.length === 0) {
        alert("Sélectionne au moins un joueur.");
        return false;
    }

    GameState.mode = "solo";
    console.log("✔ FORM SOLO VALIDÉ → joueurs =", GameState.joueurs);
    return true;
}


// ======================================================
// 🗑️ 7. Supprimer un joueur du storage
// ======================================================
function supprimerJoueur(pseudo) {
    if (!confirm(`Supprimer le joueur "${pseudo}" ? Ses scores seront conservés dans l'historique.`)) return false;

    const joueurs = getPlayers().filter(j => j !== pseudo);
    localStorage.setItem("players", JSON.stringify(joueurs));
    return true;
}


// ======================================================
// ✏️ 8. Renommer un joueur dans tout le storage
// ======================================================
function renommerJoueur(ancienNom, nouveauNom) {
    if (!nouveauNom || nouveauNom.trim() === "") return false;
    nouveauNom = nouveauNom.trim();

    const joueurs = getPlayers();
    if (joueurs.includes(nouveauNom)) {
        alert("Ce nom est déjà utilisé.");
        return false;
    }

    // Joueurs list
    const idx = joueurs.indexOf(ancienNom);
    if (idx !== -1) joueurs[idx] = nouveauNom;
    localStorage.setItem("players", JSON.stringify(joueurs));

    // Scores globaux
    const scoresGlobaux = getScoresGlobaux();
    if (scoresGlobaux[ancienNom]) {
        scoresGlobaux[nouveauNom] = scoresGlobaux[ancienNom];
        delete scoresGlobaux[ancienNom];
        localStorage.setItem("scores_globaux", JSON.stringify(scoresGlobaux));
    }

    // Performances
    const performances = JSON.parse(localStorage.getItem("performances") || "{}");
    if (performances[ancienNom]) {
        performances[nouveauNom] = performances[ancienNom];
        delete performances[ancienNom];
        localStorage.setItem("performances", JSON.stringify(performances));
    }

    // Parties
    const parties = JSON.parse(localStorage.getItem("parties") || "[]");
    parties.forEach(p => {
        if (Array.isArray(p.joueurs)) {
            p.joueurs = p.joueurs.map(j => j === ancienNom ? nouveauNom : j);
        }
        if (p.scores && p.scores[ancienNom] !== undefined) {
            p.scores[nouveauNom] = p.scores[ancienNom];
            delete p.scores[ancienNom];
        }
    });
    localStorage.setItem("parties", JSON.stringify(parties));

    return true;
}


// ======================================================
// 📊 9. Calcul des stats d'un joueur
// ======================================================
function calculerStatsJoueur(pseudo) {
    const parties = getAllParties();
    const scoresGlobaux = getScoresGlobaux();
    const performances = getAllPerformances();

    const partiesJoueur = parties.filter(p =>
        (p.joueurs || []).includes(pseudo) ||
        (p.equipes || []).some(e => (e.membres || []).includes(pseudo))
    );

    const scoreGlobal = scoresGlobaux[pseudo]?.total || 0;
    const parJeu = scoresGlobaux[pseudo]?.parJeu || {};
    const perfsJoueur = performances[pseudo] || {};

    // Calcul du rang global
    const classement = Object.entries(scoresGlobaux)
        .map(([nom, d]) => ({ nom, total: d.total || 0 }))
        .sort((a, b) => b.total - a.total);
    const rangGlobal = classement.findIndex(c => c.nom === pseudo) + 1;

    // Stats par jeu
    const statsParJeu = {};
    Object.keys(parJeu).forEach(jeu => {
        const perf = perfsJoueur[jeu] || {};
        const partiesJeu = partiesJoueur.filter(p => p.jeu === jeu);

        // Rang dans ce jeu
        const scoresJeu = Object.entries(scoresGlobaux)
            .map(([nom, d]) => ({ nom, score: d.parJeu?.[jeu] || 0 }))
            .filter(e => e.score > 0)
            .sort((a, b) => b.score - a.score);
        const rangJeu = scoresJeu.findIndex(e => e.nom === pseudo) + 1;

        statsParJeu[jeu] = {
            score: parJeu[jeu] || 0,
            parties: partiesJeu.length,
            rang: rangJeu,
            totalJoueurs: scoresJeu.length,
            victories: perf.victoires || 0,
            meilleurScore: perf.meilleurScore || 0,
            moyenneScore: perf.parties > 0
                ? Math.round((perf.scoreTotal || 0) / perf.parties)
                : 0
        };
    });

    return {
        pseudo,
        scoreGlobal,
        rangGlobal,
        totalJoueurs: classement.length,
        totalParties: partiesJoueur.length,
        statsParJeu
    };
}


// ======================================================
// 🎨 10. Icônes et couleurs par jeu
// ======================================================
const JEUX_META = {
    quiz:       { label: "Quiz",           icon: "❓", color: "#00d4ff" },
    justeprix:  { label: "Le Bon Prix",    icon: "💰", color: "#ffd700" },
    undercover: { label: "Undercover",     icon: "🕵️", color: "#a855f7" },
    lml:        { label: "Maxi Lettres",   icon: "📖", color: "#22c55e" },
    mimer:      { label: "Mimer",          icon: "🎭", color: "#f97316" },
    pendu:      { label: "Le Pendu",       icon: "🪢", color: "#ef4444" },
    petitbac:   { label: "Petit Bac",      icon: "📝", color: "#06b6d4" },
    memoire:    { label: "Mémoire Flash",  icon: "🧠", color: "#8b5cf6" },
    morpion:    { label: "Morpion",        icon: "⭕", color: "#84cc16" },
    puissance4: { label: "Puissance 4",    icon: "🔴", color: "#fb923c" }
};


// ======================================================
// 🖥️ 11. Rendu HTML du dashboard joueur
// ======================================================
function buildDashboardJoueurHTML(stats, filtre = "tous") {
    const { pseudo, scoreGlobal, rangGlobal, totalJoueurs, totalParties, statsParJeu } = stats;

    const medailleRang = rangGlobal === 1 ? "🥇" : rangGlobal === 2 ? "🥈" : rangGlobal === 3 ? "🥉" : `#${rangGlobal}`;

    // Filtrage par jeu
    const jeuxDisponibles = Object.keys(statsParJeu);
    let jeuxAffiches = jeuxDisponibles;
    if (filtre !== "tous") jeuxAffiches = jeuxDisponibles.filter(j => j === filtre);

    const cartes = jeuxAffiches.map(jeu => {
        const s = statsParJeu[jeu];
        const meta = JEUX_META[jeu] || { label: jeu, icon: "🎮", color: "#00d4ff" };
        const pctRang = s.totalJoueurs > 1
            ? Math.round((1 - (s.rang - 1) / (s.totalJoueurs - 1)) * 100)
            : 100;
        return `
            <div class="gj-jeu-card" style="--jeu-color: ${meta.color}">
                <div class="gj-jeu-header">
                    <span class="gj-jeu-icon">${meta.icon}</span>
                    <span class="gj-jeu-name">${meta.label}</span>
                </div>
                <div class="gj-jeu-stats">
                    <div class="gj-stat-row">
                        <span class="gj-stat-label">Score total</span>
                        <span class="gj-stat-val" style="color: ${meta.color}">${s.score} pts</span>
                    </div>
                    <div class="gj-stat-row">
                        <span class="gj-stat-label">Parties jouées</span>
                        <span class="gj-stat-val">${s.parties}</span>
                    </div>
                    <div class="gj-stat-row">
                        <span class="gj-stat-label">Meilleur score</span>
                        <span class="gj-stat-val">${s.meilleurScore} pts</span>
                    </div>
                    <div class="gj-stat-row">
                        <span class="gj-stat-label">Moyenne</span>
                        <span class="gj-stat-val">${s.moyenneScore} pts</span>
                    </div>
                    ${s.victories > 0 ? `
                    <div class="gj-stat-row">
                        <span class="gj-stat-label">Victoires</span>
                        <span class="gj-stat-val gj-victories">🏆 ${s.victories}</span>
                    </div>` : ""}
                </div>
                <div class="gj-rang-block">
                    <span class="gj-rang-label">Classement</span>
                    <span class="gj-rang-val">${s.rang > 0 ? `${s.rang}/${s.totalJoueurs}` : "N/A"}</span>
                </div>
                <div class="gj-rang-bar-wrap">
                    <div class="gj-rang-bar" data-pct="${pctRang}" style="background: ${meta.color}; width: 0%"></div>
                </div>
            </div>
        `;
    }).join("");

    const filtreOptions = [
        { val: "tous", label: "Tous les jeux" },
        ...jeuxDisponibles.map(j => ({
            val: j,
            label: JEUX_META[j]?.label || j
        }))
    ].map(opt => `
        <button class="gj-filtre-btn ${filtre === opt.val ? "active" : ""}"
                data-filtre="${opt.val}">
            ${JEUX_META[opt.val]?.icon ? JEUX_META[opt.val].icon + " " : ""}${opt.label}
        </button>
    `).join("");

    const emptyState = jeuxAffiches.length === 0
        ? `<p class="gj-empty">Aucune donnée pour ce jeu.</p>`
        : "";

    return `
        <div class="gj-dashboard">
            <div class="gj-player-header">
                <div class="gj-avatar">${pseudo.charAt(0).toUpperCase()}</div>
                <div class="gj-player-info">
                    <h2 class="gj-player-name">${escapeHtml(pseudo)}</h2>
                    <div class="gj-kpi-row">
                        <div class="gj-kpi">
                            <span class="gj-kpi-val">${scoreGlobal}</span>
                            <span class="gj-kpi-label">pts totaux</span>
                        </div>
                        <div class="gj-kpi">
                            <span class="gj-kpi-val">${medailleRang}</span>
                            <span class="gj-kpi-label">rang global</span>
                        </div>
                        <div class="gj-kpi">
                            <span class="gj-kpi-val">${totalParties}</span>
                            <span class="gj-kpi-label">parties</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="gj-filtres">
                ${filtreOptions}
            </div>

            <div class="gj-jeux-grid">
                ${cartes || emptyState}
            </div>
        </div>
    `;
}


// ======================================================
// 🖥️ 12. Interface de gestion des joueurs
// ======================================================
export function afficherGestionJoueurs() {
    let panel = document.getElementById("gestion-joueurs-panel");
    if (!panel) {
        panel = document.createElement("section");
        panel.id = "gestion-joueurs-panel";
        panel.className = "screen gj-panel";
        document.body.appendChild(panel);
    }

    renderGestionJoueurs(panel);
    show("gestion-joueurs-panel");

    // Cacher les autres écrans
    ["home", "choix-jeu", "choix-mode", "form-solo", "form-equipes",
    "container", "liste-parties", "stats-dashboard",
    "gestion-equipes-panel"].forEach(id => hide(id));

    const btnRetour = $("btn-retour-permanent");
    if (btnRetour) btnRetour.hidden = false;
}


function renderGestionJoueurs(panel, joueurSelectId = null, filtre = "tous") {
    const joueurs = getPlayers();

    const listeHTML = joueurs.length === 0
        ? `<p class="gj-empty">Aucun joueur enregistré. Crée le premier !</p>`
        : joueurs.map((j, i) => `
            <div class="gj-joueur-row" data-pseudo="${escapeHtml(j)}">
                <div class="gj-joueur-avatar">${j.charAt(0).toUpperCase()}</div>
                <span class="gj-joueur-nom">${escapeHtml(j)}</span>
                <div class="gj-joueur-actions">
                    <button class="gj-btn-dashboard" data-joueur="${escapeHtml(j)}" title="Tableau de bord">📊</button>
                    <button class="gj-btn-edit" data-joueur="${escapeHtml(j)}" title="Renommer">✏️</button>
                    <button class="gj-btn-delete" data-joueur="${escapeHtml(j)}" title="Supprimer">🗑️</button>
                </div>
            </div>
        `).join("");

    // Dashboard du joueur sélectionné
    let dashboardHTML = "";
    if (joueurSelectId) {
        const stats = calculerStatsJoueur(joueurSelectId);
        dashboardHTML = buildDashboardJoueurHTML(stats, filtre);
    }

    panel.innerHTML = `
        <h1 class="gj-title">👤 Gestion des joueurs</h1>

        <div class="gj-layout">
            <!-- Colonne gauche : liste + ajout -->
            <div class="gj-sidebar">
                <div class="gj-add-block">
                    <h3>Nouveau joueur</h3>
                    <div class="gj-add-row">
                        <input type="text" id="gj-input-nouveau" class="input-primary"
                               placeholder="Nom du joueur…" maxlength="20" />
                        <button id="gj-btn-ajouter" class="btn-primary gj-btn-add">✨＋</button>
                    </div>
                </div>

                <div class="gj-liste-block">
                    <h3>Joueurs enregistrés <span class="gj-count">${joueurs.length}</span></h3>
                    <div class="gj-liste">
                        ${listeHTML}
                    </div>
                </div>
            </div>

            <!-- Colonne droite : dashboard -->
            <div class="gj-main" id="gj-main-content">
                ${dashboardHTML || `
                    <div class="gj-placeholder">
                        <span class="gj-placeholder-icon">📊</span>
                        <p>Clique sur 📊 pour voir le tableau de bord d'un joueur</p>
                    </div>
                `}
            </div>
        </div>
    `;

    // === Events ===

    // Ajouter un joueur
    const inputNouveau = panel.querySelector("#gj-input-nouveau");
    panel.querySelector("#gj-btn-ajouter").onclick = () => {
        const pseudo = inputNouveau.value.trim();
        if (!pseudo) return;
        if (getPlayers().includes(pseudo)) {
            alert("Ce joueur existe déjà.");
            return;
        }
        addPlayer(pseudo);
        renderGestionJoueurs(panel, joueurSelectId, filtre);
    };
    inputNouveau.addEventListener("keydown", e => {
        if (e.key === "Enter") panel.querySelector("#gj-btn-ajouter").click();
    });

    // Actions sur chaque joueur
    panel.querySelectorAll(".gj-btn-dashboard").forEach(btn => {
        btn.onclick = () => {
            renderGestionJoueurs(panel, btn.dataset.joueur, "tous");
        };
    });

    panel.querySelectorAll(".gj-btn-edit").forEach(btn => {
        btn.onclick = () => {
            const ancienNom = btn.dataset.joueur;
            const row = btn.closest(".gj-joueur-row");
            const nomSpan = row.querySelector(".gj-joueur-nom");

            // Inline edit
            const input = document.createElement("input");
            input.type = "text";
            input.value = ancienNom;
            input.className = "gj-inline-input";
            nomSpan.replaceWith(input);
            input.focus();
            input.select();

            const valider = () => {
                const nouveauNom = input.value.trim();
                if (nouveauNom && nouveauNom !== ancienNom) {
                    if (renommerJoueur(ancienNom, nouveauNom)) {
                        renderGestionJoueurs(panel,
                            joueurSelectId === ancienNom ? nouveauNom : joueurSelectId,
                            filtre
                        );
                    } else {
                        renderGestionJoueurs(panel, joueurSelectId, filtre);
                    }
                } else {
                    renderGestionJoueurs(panel, joueurSelectId, filtre);
                }
            };

            input.addEventListener("blur", valider);
            input.addEventListener("keydown", e => {
                if (e.key === "Enter") valider();
                if (e.key === "Escape") renderGestionJoueurs(panel, joueurSelectId, filtre);
            });
        };
    });

    panel.querySelectorAll(".gj-btn-delete").forEach(btn => {
        btn.onclick = () => {
            const pseudo = btn.dataset.joueur;
            if (supprimerJoueur(pseudo)) {
                renderGestionJoueurs(panel,
                    joueurSelectId === pseudo ? null : joueurSelectId,
                    filtre
                );
            }
        };
    });

    // Filtres du dashboard
    panel.querySelectorAll(".gj-filtre-btn").forEach(btn => {
        btn.onclick = () => {
            renderGestionJoueurs(panel, joueurSelectId, btn.dataset.filtre);
        };
    });

    // Animation des barres
    requestAnimationFrame(() => {
        panel.querySelectorAll(".gj-rang-bar").forEach(bar => {
            setTimeout(() => {
                bar.style.width = `${bar.dataset.pct}%`;
            }, 300);
        });
    });
}

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}