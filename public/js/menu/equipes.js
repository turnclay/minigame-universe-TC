// /public/js/menu/equipes.js
// ======================================================
// ⚔️ MODULE GESTION DES ÉQUIPES — Menu
// Overlay plein écran pour gérer les équipes
// ======================================================

function esc(str) {
    return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getEquipes() {
    try { return JSON.parse(localStorage.getItem("mgu_equipes") || "[]"); } catch { return []; }
}

function saveEquipes(liste) {
    try { localStorage.setItem("mgu_equipes", JSON.stringify(liste)); } catch {}
}

function getJoueurs() {
    try { return JSON.parse(localStorage.getItem("mgu_joueurs") || "[]"); } catch { return []; }
}

function renderEquipes(overlay) {
    const equipes = getEquipes();
    const joueurs = getJoueurs();
    const liste = overlay.querySelector("#ge-list");
    const counter = overlay.querySelector("#ge-count");

    if (counter) counter.textContent = `${equipes.length} équipe${equipes.length !== 1 ? "s" : ""} enregistrée${equipes.length !== 1 ? "s" : ""}`;
    if (!liste) return;

    if (equipes.length === 0) {
        liste.innerHTML = `<p class="mfs-empty">Aucune équipe créée.</p>`;
        return;
    }

    liste.innerHTML = equipes.map((eq, i) => {
        const membres = eq.membres || [];
        const disponibles = joueurs.filter(j => !membres.includes(j));
        return `
        <div class="mfs-equipe-item">
            <div class="mfs-equipe-header">
                <span class="mfs-equipe-icon">🛡️</span>
                <span class="mfs-equipe-nom">${esc(eq.nom)}</span>
                <span class="mfs-equipe-nb">${membres.length} membre${membres.length !== 1 ? "s" : ""}</span>
                <button class="mfs-del-btn" data-i="${i}" title="Supprimer l'équipe">✖</button>
            </div>
            <div class="mfs-equipe-membres">
                ${membres.length === 0
                    ? `<em class="mfs-empty-small">Aucun membre</em>`
                    : membres.map((m, mi) => `
                        <span class="mfs-membre-chip">
                            ${esc(m)}
                            <button class="mfs-remove-membre" data-ei="${i}" data-mi="${mi}">×</button>
                        </span>`).join("")}
            </div>
            ${disponibles.length > 0 ? `
            <div class="mfs-add-membre-row">
                <select class="select-primary mfs-select-membre" data-i="${i}">
                    <option value="">Ajouter un joueur…</option>
                    ${disponibles.map(j => `<option value="${esc(j)}">${esc(j)}</option>`).join("")}
                </select>
            </div>` : ""}
        </div>`;
    }).join("");

    // Supprimer équipe
    liste.querySelectorAll(".mfs-del-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const updated = getEquipes();
            updated.splice(parseInt(btn.dataset.i), 1);
            saveEquipes(updated);
            renderEquipes(overlay);
        });
    });

    // Retirer membre
    liste.querySelectorAll(".mfs-remove-membre").forEach(btn => {
        btn.addEventListener("click", () => {
            const updated = getEquipes();
            const ei = parseInt(btn.dataset.ei);
            const mi = parseInt(btn.dataset.mi);
            updated[ei].membres.splice(mi, 1);
            saveEquipes(updated);
            renderEquipes(overlay);
        });
    });

    // Ajouter membre via select
    liste.querySelectorAll(".mfs-select-membre").forEach(sel => {
        sel.addEventListener("change", () => {
            const joueur = sel.value;
            if (!joueur) return;
            const updated = getEquipes();
            const i = parseInt(sel.dataset.i);
            if (!updated[i].membres) updated[i].membres = [];
            updated[i].membres.push(joueur);
            saveEquipes(updated);
            renderEquipes(overlay);
        });
    });
}

export function afficherGestionEquipes() {
    let overlay = document.getElementById("equipes-overlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "equipes-overlay";
        overlay.className = "menu-fullscreen-overlay";
        document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
    <div class="mfs-container">
        <div class="mfs-header">
            <h1 class="mfs-title">⚔️ Gestion des équipes</h1>
            <button class="mfs-close" id="equipes-close-btn">✕</button>
        </div>

        <div class="mfs-add-form">
            <input type="text" id="ge-input" class="input-primary mfs-input"
                   placeholder="Nom de l'équipe…" maxlength="20" autocomplete="off">
            <button id="ge-btn-add" class="btn-primary">Créer</button>
        </div>

        <p id="ge-count" class="mfs-count"></p>
        <div id="ge-list" class="mfs-list"></div>
    </div>`;

    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add("mfs-visible"));

    renderEquipes(overlay);

    const input = overlay.querySelector("#ge-input");
    const btnAdd = overlay.querySelector("#ge-btn-add");

    const ajouter = () => {
        const nom = input?.value.trim();
        if (!nom) return;
        const equipes = getEquipes();
        if (equipes.some(e => e.nom.toLowerCase() === nom.toLowerCase())) { input.value = ""; return; }
        equipes.push({ nom, membres: [] });
        saveEquipes(equipes);
        input.value = "";
        renderEquipes(overlay);
    };

    btnAdd?.addEventListener("click", ajouter);
    input?.addEventListener("keydown", e => { if (e.key === "Enter") ajouter(); });

    overlay.querySelector("#equipes-close-btn")?.addEventListener("click", () => {
        overlay.classList.remove("mfs-visible");
        setTimeout(() => { overlay.hidden = true; }, 300);
    });
}