// /public/js/menu/joueurs.js
// ======================================================
// 👤 MODULE GESTION DES JOUEURS — Menu
// Overlay plein écran pour gérer la liste des joueurs
// ======================================================

function esc(str) {
    return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getJoueurs() {
    try { return JSON.parse(localStorage.getItem("mgu_joueurs") || "[]"); } catch { return []; }
}

function saveJoueurs(liste) {
    try { localStorage.setItem("mgu_joueurs", JSON.stringify(liste)); } catch {}
}

function getScoresGlobaux() {
    try {
        const parties = JSON.parse(localStorage.getItem("mgu_parties") || "[]");
        const scores = {};
        parties.forEach(p => {
            Object.entries(p.scores || {}).forEach(([nom, pts]) => {
                scores[nom] = (scores[nom] || 0) + pts;
            });
        });
        return scores;
    } catch { return {}; }
}

function renderJoueurs(overlay) {
    const joueurs = getJoueurs();
    const scores = getScoresGlobaux();
    const liste = overlay.querySelector("#gj-list");
    const counter = overlay.querySelector("#gj-count");

    if (counter) counter.textContent = `${joueurs.length} joueur${joueurs.length !== 1 ? "s" : ""} enregistré${joueurs.length !== 1 ? "s" : ""}`;

    if (!liste) return;
    if (joueurs.length === 0) {
        liste.innerHTML = `<p class="mfs-empty">Aucun joueur enregistré.</p>`;
        return;
    }

    liste.innerHTML = joueurs.map((j, i) => `
        <div class="mfs-joueur-item">
            <div class="mfs-joueur-avatar">${j.charAt(0).toUpperCase()}</div>
            <span class="mfs-joueur-nom">${esc(j)}</span>
            <span class="mfs-joueur-pts">${scores[j] || 0} pts</span>
            <button class="mfs-del-btn" data-i="${i}" title="Supprimer">✖</button>
        </div>
    `).join("");

    liste.querySelectorAll(".mfs-del-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const i = parseInt(btn.dataset.i);
            const updated = getJoueurs();
            updated.splice(i, 1);
            saveJoueurs(updated);
            renderJoueurs(overlay);
        });
    });
}

export function afficherGestionJoueurs() {
    let overlay = document.getElementById("joueurs-overlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "joueurs-overlay";
        overlay.className = "menu-fullscreen-overlay";
        document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
    <div class="mfs-container">
        <div class="mfs-header">
            <h1 class="mfs-title">👤 Gestion des joueurs</h1>
            <button class="mfs-close" id="joueurs-close-btn">✕</button>
        </div>

        <div class="mfs-add-form">
            <input type="text" id="gj-input" class="input-primary mfs-input"
                   placeholder="Nouveau joueur…" maxlength="20"
                   autocomplete="off" autocorrect="off" autocapitalize="words">
            <button id="gj-btn-add" class="btn-primary">Ajouter</button>
        </div>

        <p id="gj-count" class="mfs-count"></p>
        <div id="gj-list" class="mfs-list"></div>
    </div>`;

    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add("mfs-visible"));

    renderJoueurs(overlay);

    const input = overlay.querySelector("#gj-input");
    const btnAdd = overlay.querySelector("#gj-btn-add");

    const ajouter = () => {
        const pseudo = input?.value.trim();
        if (!pseudo) return;
        const joueurs = getJoueurs();
        if (joueurs.includes(pseudo)) { input.value = ""; return; }
        joueurs.push(pseudo);
        saveJoueurs(joueurs);
        input.value = "";
        renderJoueurs(overlay);
    };

    btnAdd?.addEventListener("click", ajouter);
    input?.addEventListener("keydown", e => { if (e.key === "Enter") ajouter(); });

    overlay.querySelector("#joueurs-close-btn")?.addEventListener("click", () => {
        overlay.classList.remove("mfs-visible");
        setTimeout(() => { overlay.hidden = true; }, 300);
    });
}