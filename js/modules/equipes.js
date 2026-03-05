// /js/modules/equipes.js

import { $, $$, show, hide } from "../core/dom.js";
import { GameState } from "../core/state.js";
import {
    getPlayers,
    getAllParties,
    getScoresGlobaux,
    getAllPerformances
} from "../core/storage.js";


// ======================================================
// 📌 Helpers internes — Storage des équipes enregistrées
// ======================================================

function getEquipes() {
    return JSON.parse(localStorage.getItem("equipes_enregistrees") || "[]");
}

function saveEquipes(equipes) {
    localStorage.setItem("equipes_enregistrees", JSON.stringify(equipes));
}

function addEquipe(nom) {
    const equipes = getEquipes();
    if (!equipes.includes(nom)) {
        equipes.push(nom);
        saveEquipes(equipes);
    }
}

function supprimerEquipe(nom) {
    if (!confirm(`Supprimer l'équipe "${nom}" ? Son historique sera conservé.`)) return false;
    const equipes = getEquipes().filter(e => e !== nom);
    saveEquipes(equipes);
    return true;
}

function renommerEquipe(ancienNom, nouveauNom) {
    if (!nouveauNom || nouveauNom.trim() === "") return false;
    nouveauNom = nouveauNom.trim();

    const equipes = getEquipes();
    if (equipes.includes(nouveauNom)) {
        alert("Ce nom d'équipe est déjà utilisé.");
        return false;
    }

    const idx = equipes.indexOf(ancienNom);
    if (idx !== -1) equipes[idx] = nouveauNom;
    saveEquipes(equipes);

    const scoresGlobaux = getScoresGlobaux();
    if (scoresGlobaux[ancienNom]) {
        scoresGlobaux[nouveauNom] = scoresGlobaux[ancienNom];
        delete scoresGlobaux[ancienNom];
        localStorage.setItem("scores_globaux", JSON.stringify(scoresGlobaux));
    }

    const performances = JSON.parse(localStorage.getItem("performances") || "{}");
    if (performances[ancienNom]) {
        performances[nouveauNom] = performances[ancienNom];
        delete performances[ancienNom];
        localStorage.setItem("performances", JSON.stringify(performances));
    }

    const parties = JSON.parse(localStorage.getItem("parties") || "[]");
    parties.forEach(p => {
        if (Array.isArray(p.equipes)) {
            p.equipes = p.equipes.map(e =>
                e.nom === ancienNom ? { ...e, nom: nouveauNom } : e
            );
        }
        if (p.scores && p.scores[ancienNom] !== undefined) {
            p.scores[nouveauNom] = p.scores[ancienNom];
            delete p.scores[ancienNom];
        }
    });
    localStorage.setItem("parties", JSON.stringify(parties));

    const partieEnCours = JSON.parse(localStorage.getItem("partie_en_cours") || "null");
    if (partieEnCours) {
        if (Array.isArray(partieEnCours.equipes)) {
            partieEnCours.equipes = partieEnCours.equipes.map(e =>
                e.nom === ancienNom ? { ...e, nom: nouveauNom } : e
            );
        }
        if (partieEnCours.scores && partieEnCours.scores[ancienNom] !== undefined) {
            partieEnCours.scores[nouveauNom] = partieEnCours.scores[ancienNom];
            delete partieEnCours.scores[ancienNom];
        }
        localStorage.setItem("partie_en_cours", JSON.stringify(partieEnCours));
    }

    return true;
}

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}


// ======================================================
// 📌 État local du formulaire
// "joueurs" = membres nommés | "nombre" = juste un compteur
// ======================================================
let modeMembresCourant = "joueurs";


// ======================================================
// 📌 1. Initialisation du formulaire ÉQUIPES
//    Appelée depuis main.js → initModeCards()
// ======================================================
export function initFormEquipes() {
    const container = $("form-equipes");
    if (!container) return;

    GameState.equipes = [];
    GameState.mode = "team";
    modeMembresCourant = "joueurs";

    _syncToggleUI(container);
    _bindStaticEvents(container);
    _renderEquipesListe(container);
}


// ======================================================
// 🔌 Bind des éléments statiques du HTML
//    (clonage pour éviter les doublons de listeners)
// ======================================================
function _bindStaticEvents(container) {

    // ── Créer une équipe ───────────────────────────────
    const inputNom    = container.querySelector("#eq-input-nom");
    const btnCreer    = container.querySelector("#eq-btn-creer");
    const btnCreerNew = btnCreer.cloneNode(true);
    btnCreer.replaceWith(btnCreerNew);

btnCreerNew.onclick = () => {
    const nom = inputNom.value.trim();
    if (!nom) return;

    // Vérifie dans la session en cours
    if (GameState.equipes.some(e => e.nom.toLowerCase() === nom.toLowerCase())) {
        alert("Ce nom d'équipe existe déjà dans cette partie.");
        return;
    }

    // Vérifie dans le registre persistant (localStorage)
    if (getEquipes().some(e => e.toLowerCase() === nom.toLowerCase())) {
        alert("Ce nom d'équipe existe déjà dans le registre.");
        return;
    }

    GameState.equipes.push({ nom, membres: [], nbJoueurs: 2 });
    inputNom.value = "";
    _renderEquipesListe(container);
};
    inputNom.onkeydown = e => {
        if (e.key === "Enter") btnCreerNew.click();
    };

    // ── Toggle mode membres ────────────────────────────
    const btnTglJoueurs = container.querySelector("#eq-toggle-joueurs");
    const btnTglNombre  = container.querySelector("#eq-toggle-nombre");

    if (btnTglJoueurs) {
        const newBtn = btnTglJoueurs.cloneNode(true);
        btnTglJoueurs.replaceWith(newBtn);
        newBtn.onclick = () => {
            modeMembresCourant = "joueurs";
            _syncToggleUI(container);
            _renderEquipesListe(container);
        };
    }

    if (btnTglNombre) {
        const newBtn = btnTglNombre.cloneNode(true);
        btnTglNombre.replaceWith(newBtn);
        newBtn.onclick = () => {
            modeMembresCourant = "nombre";
            _syncToggleUI(container);
            _renderEquipesListe(container);
        };
    }

    // ── Lancer la partie ───────────────────────────────
    const btnStart    = container.querySelector("#btn-start-equipes");
    const btnStartNew = btnStart.cloneNode(true);
    btnStart.replaceWith(btnStartNew);

    btnStartNew.onclick = () => {
        if (GameState.equipes.length < 2) {
            alert("Il faut au moins 2 équipes.");
            return;
        }

        if (modeMembresCourant === "joueurs") {
            const sansMembres = GameState.equipes.filter(e => (e.membres || []).length === 0);
            if (sansMembres.length > 0) {
                alert(`Ces équipes n'ont aucun membre : ${sansMembres.map(e => e.nom).join(", ")}`);
                return;
            }
        } else {
            const sansNombre = GameState.equipes.filter(e => !e.nbJoueurs || e.nbJoueurs < 1);
            if (sansNombre.length > 0) {
                alert(`Définis le nombre de joueurs pour : ${sansNombre.map(e => e.nom).join(", ")}`);
                return;
            }
        }

        GameState.equipes.forEach(e => addEquipe(e.nom));

        GameState.scores = {};
        GameState.equipes.forEach(e => { GameState.scores[e.nom] = 0; });

        console.log("✔ FORM ÉQUIPES VALIDÉ →", GameState.equipes);

        import("../main.js").then(({ lancerJeu }) => {
            lancerJeu(GameState.jeuActuel);
        });
    };
}


// ======================================================
// 🔄 Synchronise l'UI des boutons toggle
// ======================================================
function _syncToggleUI(container) {
    const btnJoueurs = container.querySelector("#eq-toggle-joueurs");
    const btnNombre  = container.querySelector("#eq-toggle-nombre");
    if (!btnJoueurs || !btnNombre) return;
    btnJoueurs.classList.toggle("active", modeMembresCourant === "joueurs");
    btnNombre.classList.toggle("active",  modeMembresCourant === "nombre");
}


// ======================================================
// 🃏 Rendu dynamique de la liste des équipes
// ======================================================
function _renderEquipesListe(container) {
    const liste = container.querySelector("#eq-equipes-liste");
    if (!liste) return;

    const equipes      = GameState.equipes;
    const joueurs      = getPlayers();
    const joueursPris  = equipes.flatMap(e => e.membres || []);
    const joueursDispos = joueurs.filter(j => !joueursPris.includes(j));

    if (equipes.length === 0) {
        liste.innerHTML = `<p class="eq-empty">Aucune équipe créée. Ajoute une équipe !</p>`;
        return;
    }

    liste.innerHTML = equipes.map((eq, idx) => {

        let membresBloc = "";

        if (modeMembresCourant === "joueurs") {
            // Tags membres existants
            const tagsHTML = (eq.membres || []).map(m => `
                <span class="eq-membre-tag">
                    ${escapeHtml(m)}
                    <span class="eq-membre-remove"
                          data-idx="${idx}"
                          data-membre="${escapeHtml(m)}">✖</span>
                </span>
            `).join("");

            const emptyMsg = eq.membres.length === 0
                ? `<span class="eq-empty-membres">Aucun membre pour l'instant</span>`
                : "";

            // Select d'ajout
            let selectHTML = "";
            if (joueursDispos.length > 0) {
                selectHTML = `
                    <div class="eq-add-membre-row">
                        <select class="select-primary eq-select-membre" data-idx="${idx}">
                            <option value="">-- Ajouter un joueur --</option>
                            ${joueursDispos.map(j =>
                                `<option value="${escapeHtml(j)}">${escapeHtml(j)}</option>`
                            ).join("")}
                        </select>
                        <button class="btn-primary eq-btn-add-membre" data-idx="${idx}">＋</button>
                    </div>
                `;
            } else if (eq.membres.length === 0) {
                selectHTML = `<p class="eq-no-more">Tous les joueurs ont déjà été assignés.</p>`;
            }

            membresBloc = `
                <div class="eq-membres">${tagsHTML}${emptyMsg}</div>
                ${selectHTML}
            `;

        } else {
            // Mode nombre uniquement
            membresBloc = `
                <div class="eq-nombre-bloc">
                    <span class="eq-nombre-label">Nombre de joueurs :</span>
                    <div class="eq-nombre-row">
                        <button class="eq-nombre-btn eq-nombre-moins" data-idx="${idx}">−</button>
                        <span class="eq-nombre-val">${eq.nbJoueurs || 2}</span>
                        <button class="eq-nombre-btn eq-nombre-plus"  data-idx="${idx}">＋</button>
                    </div>
                </div>
            `;
        }

        return `
            <div class="eq-equipe-card" data-idx="${idx}">
                <div class="eq-equipe-header">
                    <span class="eq-equipe-icon">🛡️</span>
                    <span class="eq-equipe-nom">${escapeHtml(eq.nom)}</span>
                    <button class="eq-btn-remove-equipe" data-idx="${idx}" title="Supprimer">✖</button>
                </div>
                ${membresBloc}
            </div>
        `;
    }).join("");

    // ── Events délégués ────────────────────────────────

    liste.querySelectorAll(".eq-btn-remove-equipe").forEach(btn => {
        btn.onclick = () => {
            GameState.equipes.splice(parseInt(btn.dataset.idx), 1);
            _renderEquipesListe(container);
        };
    });

    liste.querySelectorAll(".eq-membre-remove").forEach(span => {
        span.onclick = () => {
            const idx    = parseInt(span.dataset.idx);
            const membre = span.dataset.membre;
            GameState.equipes[idx].membres =
                GameState.equipes[idx].membres.filter(m => m !== membre);
            _renderEquipesListe(container);
        };
    });

    liste.querySelectorAll(".eq-btn-add-membre").forEach(btn => {
        btn.onclick = () => {
            const idx    = parseInt(btn.dataset.idx);
            const select = liste.querySelector(`.eq-select-membre[data-idx="${idx}"]`);
            const membre = select?.value;
            if (!membre) return;
            if (!GameState.equipes[idx].membres.includes(membre)) {
                GameState.equipes[idx].membres.push(membre);
                _renderEquipesListe(container);
            }
        };
    });

    liste.querySelectorAll(".eq-nombre-moins").forEach(btn => {
        btn.onclick = () => {
            const idx     = parseInt(btn.dataset.idx);
            const current = GameState.equipes[idx].nbJoueurs || 2;
            if (current > 1) {
                GameState.equipes[idx].nbJoueurs = current - 1;
                _renderEquipesListe(container);
            }
        };
    });

    liste.querySelectorAll(".eq-nombre-plus").forEach(btn => {
        btn.onclick = () => {
            const idx = parseInt(btn.dataset.idx);
            GameState.equipes[idx].nbJoueurs = (GameState.equipes[idx].nbJoueurs || 2) + 1;
            _renderEquipesListe(container);
        };
    });
}


// ======================================================
// 📊 2. Calcul des stats d'une équipe enregistrée
// ======================================================
function calculerStatsEquipe(nomEquipe) {
    const parties       = getAllParties();
    const scoresGlobaux = getScoresGlobaux();

    const partiesEquipe = parties.filter(p =>
        p.mode === "team" &&
        (p.equipes || []).some(e => e.nom === nomEquipe)
    );

    const scoreGlobal = scoresGlobaux[nomEquipe]?.total || 0;
    const parJeu      = scoresGlobaux[nomEquipe]?.parJeu || {};

    const classement = Object.entries(scoresGlobaux)
        .map(([nom, d]) => ({ nom, total: d.total || 0 }))
        .sort((a, b) => b.total - a.total);
    const rangGlobal = classement.findIndex(c => c.nom === nomEquipe) + 1;

    const statsParJeu = {};
    Object.keys(parJeu).forEach(jeu => {
        const partiesJeu = partiesEquipe.filter(p => p.jeu === jeu);

        const scoresJeu = Object.entries(scoresGlobaux)
            .map(([nom, d]) => ({ nom, score: d.parJeu?.[jeu] || 0 }))
            .filter(e => e.score > 0)
            .sort((a, b) => b.score - a.score);
        const rangJeu = scoresJeu.findIndex(e => e.nom === nomEquipe) + 1;

        let meilleurScore = 0;
        partiesJeu.forEach(p => {
            const s = p.scores?.[nomEquipe] || 0;
            if (s > meilleurScore) meilleurScore = s;
        });

        statsParJeu[jeu] = {
            score: parJeu[jeu] || 0,
            parties: partiesJeu.length,
            rang: rangJeu,
            totalEquipes: scoresJeu.length,
            meilleurScore
        };
    });

    const tousLesMembres = new Set();
    partiesEquipe.forEach(p => {
        const eq = (p.equipes || []).find(e => e.nom === nomEquipe);
        if (eq && Array.isArray(eq.membres)) {
            eq.membres.forEach(m => tousLesMembres.add(m));
        }
    });

    return {
        nomEquipe,
        scoreGlobal,
        rangGlobal,
        totalEquipes: classement.length,
        totalParties: partiesEquipe.length,
        membres: [...tousLesMembres],
        statsParJeu
    };
}


// ======================================================
// 🎨 3. Icônes et couleurs par jeu
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
// 🖥️ 4. Rendu HTML du dashboard équipe
// ======================================================
function buildDashboardEquipeHTML(stats, filtre = "tous") {
    const { nomEquipe, scoreGlobal, rangGlobal, totalEquipes,
            totalParties, membres, statsParJeu } = stats;

    const medailleRang = rangGlobal === 1 ? "🥇" : rangGlobal === 2 ? "🥈"
        : rangGlobal === 3 ? "🥉" : `#${rangGlobal}`;

    const jeuxDisponibles = Object.keys(statsParJeu);
    const jeuxAffiches    = filtre === "tous"
        ? jeuxDisponibles
        : jeuxDisponibles.filter(j => j === filtre);

    const cartes = jeuxAffiches.map(jeu => {
        const s    = statsParJeu[jeu];
        const meta = JEUX_META[jeu] || { label: jeu, icon: "🎮", color: "#00d4ff" };
        const pctRang = s.totalEquipes > 1
            ? Math.round((1 - (s.rang - 1) / (s.totalEquipes - 1)) * 100)
            : 100;
        return `
            <div class="gj-jeu-card" style="--jeu-color:${meta.color}">
                <div class="gj-jeu-header">
                    <span class="gj-jeu-icon">${meta.icon}</span>
                    <span class="gj-jeu-name">${meta.label}</span>
                </div>
                <div class="gj-jeu-stats">
                    <div class="gj-stat-row">
                        <span class="gj-stat-label">Score total</span>
                        <span class="gj-stat-val" style="color:${meta.color}">${s.score} pts</span>
                    </div>
                    <div class="gj-stat-row">
                        <span class="gj-stat-label">Parties jouées</span>
                        <span class="gj-stat-val">${s.parties}</span>
                    </div>
                    <div class="gj-stat-row">
                        <span class="gj-stat-label">Meilleur score</span>
                        <span class="gj-stat-val">${s.meilleurScore} pts</span>
                    </div>
                </div>
                <div class="gj-rang-block">
                    <span class="gj-rang-label">Classement équipes</span>
                    <span class="gj-rang-val">${s.rang > 0 ? `${s.rang}/${s.totalEquipes}` : "N/A"}</span>
                </div>
                <div class="gj-rang-bar-wrap">
                    <div class="gj-rang-bar" data-pct="${pctRang}"
                         style="background:${meta.color}; width:0%"></div>
                </div>
            </div>
        `;
    }).join("");

    const filtreOptions = [
        { val: "tous", label: "Tous les jeux" },
        ...jeuxDisponibles.map(j => ({ val: j, label: JEUX_META[j]?.label || j }))
    ].map(opt => `
        <button class="gj-filtre-btn ${filtre === opt.val ? "active" : ""}"
                data-filtre="${opt.val}">
            ${JEUX_META[opt.val]?.icon ? JEUX_META[opt.val].icon + " " : ""}${opt.label}
        </button>
    `).join("");

    const membresHTML = membres.length > 0
        ? membres.map(m => `<span class="gj-membre-badge">${escapeHtml(m)}</span>`).join("")
        : `<span class="gj-empty">Aucun membre connu</span>`;

    return `
        <div class="gj-dashboard">
            <div class="gj-player-header gj-team-header">
                <div class="gj-avatar gj-avatar-team">🛡️</div>
                <div class="gj-player-info">
                    <h2 class="gj-player-name">${escapeHtml(nomEquipe)}</h2>
                    <div class="gj-membres-row">${membresHTML}</div>
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
            <div class="gj-filtres">${filtreOptions}</div>
            <div class="gj-jeux-grid">
                ${cartes || `<p class="gj-empty">Aucune donnée pour ce filtre.</p>`}
            </div>
        </div>
    `;
}


// ======================================================
// 🖥️ 5. Interface de gestion des équipes enregistrées
// ======================================================
export function afficherGestionEquipes() {
    let panel = document.getElementById("gestion-equipes-panel");
    if (!panel) {
        panel = document.createElement("section");
        panel.id = "gestion-equipes-panel";
        panel.className = "screen gj-panel";
        document.body.appendChild(panel);
    }

    renderGestionEquipes(panel);
    show("gestion-equipes-panel");

    ["home", "choix-jeu", "choix-mode", "form-solo", "form-equipes",
     "container", "liste-parties", "stats-dashboard",
     "gestion-joueurs-panel"].forEach(id => hide(id));

    const btnRetour = $("btn-retour-permanent");
    if (btnRetour) btnRetour.hidden = false;
}


function renderGestionEquipes(panel, equipeSelectNom = null, filtre = "tous") {

    const partiesAll    = getAllParties();
    const equipesSet    = new Set(getEquipes());
    const scoresGlobaux = getScoresGlobaux();

    partiesAll.forEach(p => {
        (p.equipes || []).forEach(e => { if (e.nom) equipesSet.add(e.nom); });
    });
    Object.keys(scoresGlobaux).forEach(nom => {
        const estEquipe = partiesAll.some(p =>
            p.mode === "team" && (p.equipes || []).some(e => e.nom === nom)
        );
        if (estEquipe) equipesSet.add(nom);
    });

    const listeEquipes = [...equipesSet];

    const listeHTML = listeEquipes.length === 0
        ? `<p class="gj-empty">Aucune équipe enregistrée. Crée la première !</p>`
        : listeEquipes.map(nom => `
            <div class="gj-joueur-row" data-nom="${escapeHtml(nom)}">
                <div class="gj-joueur-avatar gj-avatar-team-mini">🛡️</div>
                <span class="gj-joueur-nom">${escapeHtml(nom)}</span>
                <div class="gj-joueur-actions">
                    <button class="gj-btn-dashboard" data-equipe="${escapeHtml(nom)}" title="Tableau de bord">📊</button>
                    <button class="gj-btn-edit"      data-equipe="${escapeHtml(nom)}" title="Renommer">✏️</button>
                    <button class="gj-btn-delete"    data-equipe="${escapeHtml(nom)}" title="Supprimer">🗑️</button>
                </div>
            </div>
        `).join("");

    let dashboardHTML = "";
    if (equipeSelectNom) {
        const stats = calculerStatsEquipe(equipeSelectNom);
        dashboardHTML = buildDashboardEquipeHTML(stats, filtre);
    }

    panel.innerHTML = `
        <h1 class="gj-title">⚔️ Gestion des équipes</h1>

        <div class="gj-layout">
            <div class="gj-sidebar">
                <div class="gj-add-block">
                    <h3>Nouvelle équipe</h3>
                    <div class="gj-add-row">
                        <input type="text" id="gj-input-nouveau" class="input-primary"
                               placeholder="Nom de l'équipe…" maxlength="20" />
                        <button id="gj-btn-ajouter" class="btn-primary gj-btn-add">✨＋</button>
                    </div>
                </div>
                <div class="gj-liste-block">
                    <h3>Équipes enregistrées <span class="gj-count">${listeEquipes.length}</span></h3>
                    <div class="gj-liste">${listeHTML}</div>
                </div>
            </div>

            <div class="gj-main" id="gj-main-content">
                ${dashboardHTML || `
                    <div class="gj-placeholder">
                        <span class="gj-placeholder-icon">⚔️</span>
                        <p>Clique sur 📊 pour voir les stats d'une équipe</p>
                    </div>
                `}
            </div>
        </div>
    `;

    const inputNouveau = panel.querySelector("#gj-input-nouveau");
    panel.querySelector("#gj-btn-ajouter").onclick = () => {
        const nom = inputNouveau.value.trim();
        if (!nom) return;
        if (getEquipes().includes(nom)) {
            alert("Cette équipe existe déjà.");
            return;
        }
        addEquipe(nom);
        renderGestionEquipes(panel, equipeSelectNom, filtre);
    };
    inputNouveau.onkeydown = e => {
        if (e.key === "Enter") panel.querySelector("#gj-btn-ajouter").click();
    };

    panel.querySelectorAll(".gj-btn-dashboard").forEach(btn => {
        btn.onclick = () => renderGestionEquipes(panel, btn.dataset.equipe, "tous");
    });

    panel.querySelectorAll(".gj-btn-edit").forEach(btn => {
        btn.onclick = () => {
            const ancienNom = btn.dataset.equipe;
            const row       = btn.closest(".gj-joueur-row");
            const nomSpan   = row.querySelector(".gj-joueur-nom");

            const input = document.createElement("input");
            input.type      = "text";
            input.value     = ancienNom;
            input.className = "gj-inline-input";
            nomSpan.replaceWith(input);
            input.focus();
            input.select();

            const valider = () => {
                const nouveauNom = input.value.trim();
                if (nouveauNom && nouveauNom !== ancienNom) {
                    if (renommerEquipe(ancienNom, nouveauNom)) {
                        renderGestionEquipes(
                            panel,
                            equipeSelectNom === ancienNom ? nouveauNom : equipeSelectNom,
                            filtre
                        );
                    } else {
                        renderGestionEquipes(panel, equipeSelectNom, filtre);
                    }
                } else {
                    renderGestionEquipes(panel, equipeSelectNom, filtre);
                }
            };

            input.addEventListener("blur", valider);
            input.onkeydown = e => {
                if (e.key === "Enter")  valider();
                if (e.key === "Escape") renderGestionEquipes(panel, equipeSelectNom, filtre);
            };
        };
    });

    panel.querySelectorAll(".gj-btn-delete").forEach(btn => {
        btn.onclick = () => {
            const nom = btn.dataset.equipe;
            if (supprimerEquipe(nom)) {
                renderGestionEquipes(
                    panel,
                    equipeSelectNom === nom ? null : equipeSelectNom,
                    filtre
                );
            }
        };
    });

    panel.querySelectorAll(".gj-filtre-btn").forEach(btn => {
        btn.onclick = () => renderGestionEquipes(panel, equipeSelectNom, btn.dataset.filtre);
    });

    requestAnimationFrame(() => {
        panel.querySelectorAll(".gj-rang-bar").forEach(bar => {
            setTimeout(() => { bar.style.width = `${bar.dataset.pct}%`; }, 300);
        });
    });
}