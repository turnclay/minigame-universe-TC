// /public/js/host.js
// ======================================================
// 🟦 HOST.JS v3 — Interface maître de jeu
// ======================================================

import { socket } from "./core/socket.js";

// ── Helpers DOM ───────────────────────────────────────
const $    = id  => document.getElementById(id);
const show = id  => { const el = $(id); if (el) el.hidden = false; };
const hide = id  => { const el = $(id); if (el) el.hidden = true; };
const esc  = str => String(str || "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");

const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

// ── Toast local (pas d'import main.js pour éviter conflits) ──
function toast(msg, type = "info", ms = 3000) {
    const container = $("toast-container") || (() => {
        const d = document.createElement("div");
        d.id = "toast-container"; d.className = "toast-container";
        document.body.appendChild(d); return d;
    })();
    const icons = { info:"ℹ️", success:"✅", error:"❌", warning:"⚠️" };
    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    el.innerHTML = `<span>${icons[type]||"ℹ️"}</span><span>${esc(msg)}</span>`;
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add("toast-visible"));
    setTimeout(() => {
        el.classList.remove("toast-visible");
        el.classList.add("toast-hiding");
        setTimeout(() => el.remove(), 400);
    }, ms);
}

// ======================================================
// 🗂️ STATE
// ======================================================

const HostState = {
    partieId:     null,
    partieNom:    null,
    jeu:          null,
    mode:         "solo",
    equipes:      [],
    joueursSolo:  [],
    joueurs:      [],
    scores:       {},
    statut:       null,
    hostJoue:     false,
    hostPseudo:   null,
    partieActive: false,
};

// ======================================================
// 💾 PERSISTENCE LOCALE DES PARTIES CRÉÉES
// ======================================================

function sauvegarderPartieLocale(snapshot) {
    try {
        const parties = JSON.parse(localStorage.getItem("mgu_parties") || "[]");
        const idx = parties.findIndex(p => p.partieId === snapshot.id);
        const entry = {
            partieId:  snapshot.id,
            id:        snapshot.id,
            nom:       snapshot.nom,
            jeu:       snapshot.jeu,
            mode:      snapshot.mode,
            equipes:   snapshot.equipes || [],
            joueurs:   snapshot.joueurs || [],
            scores:    snapshot.scores  || {},
            statut:    snapshot.statut,
            createdAt: Date.now(),
        };
        if (idx >= 0) parties[idx] = { ...parties[idx], ...entry };
        else parties.push(entry);
        localStorage.setItem("mgu_parties", JSON.stringify(parties));
    } catch(e) { console.warn("[HOST] Sauvegarde locale échouée:", e); }
}

function mettreAJourStatutLocal(partieId, statut, scores) {
    try {
        const parties = JSON.parse(localStorage.getItem("mgu_parties") || "[]");
        const idx = parties.findIndex(p => p.partieId === partieId || p.id === partieId);
        if (idx >= 0) {
            parties[idx].statut = statut;
            if (scores) parties[idx].scores = scores;
            localStorage.setItem("mgu_parties", JSON.stringify(parties));
        }
    } catch(e) {}
}

// ======================================================
// 🔌 SOCKET STATUS
// ======================================================

function initSocketStatus() {
    const dot   = $("ws-dot");
    const label = $("ws-label");

    socket.on("__connected__", () => {
        if (dot)   dot.className     = "ws-dot ws-ok";
        if (label) label.textContent = "Connecté";
        socket.send("HOST_AUTH", {});
    });

    socket.on("__disconnected__", () => {
        if (dot)   dot.className     = "ws-dot ws-ko";
        if (label) label.textContent = "Déconnecté — reconnexion…";
    });

    socket.on("__reconnect_failed__", () => {
        if (dot)   dot.className     = "ws-dot ws-ko";
        if (label) label.textContent = "Connexion perdue";
        toast("Connexion perdue. Rechargez la page.", "error", 0);
    });
}

// ======================================================
// 🔐 AUTH
// ======================================================

function initAuth() {
    socket.on("AUTH_OK", () => {
        toast("Connecté en tant que host", "success", 2000);
    });

    socket.on("AUTH_FAIL", ({ error }) => {
        toast(error || "Auth échouée", "error");
    });

    // ✅ FIX PRINCIPAL : La restauration automatique est désactivée côté serveur
    // (store.resetStore() au démarrage). Côté client, on ignore GAME_RESTORED
    // sauf si on vient explicitement de "continuer une partie".
    socket.on("GAME_RESTORED", ({ partieId, snapshot }) => {
        // Ne restaurer que si l'URL contient un partieId correspondant
        const urlParams = new URLSearchParams(location.search);
        const urlPartieId = urlParams.get("partieId");
        if (urlPartieId && urlPartieId === partieId) {
            HostState.partieActive = true;
            applySnapshot(snapshot);
            show("panel-game");
            hide("alerte-partie-active");
            renderGamePanel();
            toast("Partie restaurée ✓", "info", 3000);
        }
        // Sinon on ignore silencieusement
    });
}

// ======================================================
// 🎮 MODE TOGGLE
// ======================================================

function initModeToggle() {
    const btnSolo   = $("btn-mode-solo");
    const btnEquipe = $("btn-mode-equipes");

    const setMode = (mode) => {
        HostState.mode = mode;
        btnSolo?.classList.toggle("mode-btn-active",   mode === "solo");
        btnEquipe?.classList.toggle("mode-btn-active", mode === "team");
        if (mode === "solo") { show("bloc-solo"); hide("bloc-equipes"); }
        else                 { hide("bloc-solo"); show("bloc-equipes"); }
    };

    btnSolo?.addEventListener("click",   () => setMode("solo"));
    btnEquipe?.addEventListener("click", () => setMode("team"));
    setMode("solo");
}

// ======================================================
// 👤 HOST JOUE TOGGLE
// ======================================================

function initHostRoleToggle() {
    const checkbox   = $("h-host-joue");
    const pseudoWrap = $("h-host-pseudo-wrap");
    checkbox?.addEventListener("change", () => {
        HostState.hostJoue = checkbox.checked;
        if (pseudoWrap) pseudoWrap.hidden = !checkbox.checked;
    });
}

// ======================================================
// 👥 JOUEURS SOLO
// ======================================================

function initJoueursSolo() {
    const input  = $("h-joueur-input");
    const btnAdd = $("h-joueur-ajouter");

    const ajouter = () => {
        const nom = input?.value.trim();
        if (!nom) return;
        if (HostState.joueursSolo.includes(nom)) { toast("Joueur déjà existant.", "warning"); return; }
        HostState.joueursSolo.push(nom);
        if (input) input.value = "";
        renderJoueursSoloForm();
    };

    btnAdd?.addEventListener("click", ajouter);
    input?.addEventListener("keydown", e => { if (e.key === "Enter") ajouter(); });
    renderJoueursSoloForm();
}

function renderJoueursSoloForm() {
    const container = $("h-joueurs-list");
    if (!container) return;

    if (HostState.joueursSolo.length === 0) {
        container.innerHTML = `<p class="list-empty">Aucun joueur — rejoignez via le lien</p>`;
        return;
    }
    container.innerHTML = HostState.joueursSolo.map((j, i) => `
        <div class="joueur-tag">
            <span class="joueur-tag-avatar">${j.charAt(0).toUpperCase()}</span>
            <span class="joueur-tag-nom">${esc(j)}</span>
            <button class="btn-remove" data-i="${i}">×</button>
        </div>
    `).join("");

    container.querySelectorAll(".btn-remove").forEach(btn => {
        btn.addEventListener("click", () => {
            HostState.joueursSolo.splice(parseInt(btn.dataset.i), 1);
            renderJoueursSoloForm();
        });
    });
}

// ======================================================
// 🛡️ ÉQUIPES
// ======================================================

function initEquipes() {
    const input  = $("h-equipe-input");
    const btnAdd = $("h-equipe-ajouter");

    const ajouter = () => {
        const nom = input?.value.trim();
        if (!nom) return;
        if (HostState.equipes.some(e => e.nom.toLowerCase() === nom.toLowerCase())) {
            toast("Équipe déjà existante.", "warning"); return;
        }
        HostState.equipes.push({ nom, membres: [] });
        if (input) input.value = "";
        renderEquipesForm();
    };

    btnAdd?.addEventListener("click", ajouter);
    input?.addEventListener("keydown", e => { if (e.key === "Enter") ajouter(); });
    renderEquipesForm();
}

function renderEquipesForm() {
    const container = $("h-equipes-list");
    if (!container) return;

    if (HostState.equipes.length === 0) {
        container.innerHTML = `<p class="list-empty">Créez au moins 2 équipes</p>`;
        return;
    }
    container.innerHTML = HostState.equipes.map((eq, i) => `
        <div class="equipe-form-item">
            <div class="equipe-form-header">
                <span>🛡️</span>
                <span class="equipe-form-nom">${esc(eq.nom)}</span>
                <button class="btn-remove btn-del-equipe" data-i="${i}">×</button>
            </div>
        </div>
    `).join("");

    container.querySelectorAll(".btn-del-equipe").forEach(btn => {
        btn.addEventListener("click", () => {
            HostState.equipes.splice(parseInt(btn.dataset.i), 1);
            renderEquipesForm();
        });
    });
}

// ======================================================
// 🚀 CRÉER PARTIE
// ======================================================

function initCreerPartie() {
    $("h-btn-creer")?.addEventListener("click", () => {
        if (HostState.partieActive) {
            show("alerte-partie-active");
            toast("Terminez la partie en cours d'abord.", "warning");
            return;
        }

        const nom  = $("h-nom-partie")?.value.trim();
        const jeu  = $("h-jeu")?.value;
        const mode = HostState.mode;

        if (!nom) { toast("Donnez un nom à la partie.", "warning"); return; }
        if (mode === "team" && HostState.equipes.length < 2) {
            toast("Il faut au moins 2 équipes.", "warning"); return;
        }

        let hostPseudo = null;
        if (HostState.hostJoue) {
            hostPseudo = $("h-host-pseudo")?.value.trim();
            if (!hostPseudo) { toast("Entrez votre pseudo.", "warning"); return; }
            HostState.hostPseudo = hostPseudo;
        }

        socket.send("HOST_CREATE_GAME", {
            nom, jeu, mode,
            equipes:     HostState.equipes,
            joueursSolo: HostState.joueursSolo,
            hostJoue:    HostState.hostJoue,
            hostPseudo
        });
    });
}

// ======================================================
// 📡 SOCKET EVENTS
// ======================================================

function initSocketEvents() {

    socket.on("GAME_CREATED", ({ partieId, snapshot }) => {
        HostState.partieId     = partieId;
        HostState.partieActive = true;
        applySnapshot(snapshot);

        // ✅ Sauvegarder localement pour "Continuer une partie"
        sauvegarderPartieLocale(snapshot);

        show("panel-game");
        hide("alerte-partie-active");
        renderGamePanel();
        toast(`Partie "${HostState.partieNom}" créée !`, "success");
    });

    socket.on("PLAYER_JOINED", ({ pseudo, equipe, joueurs }) => {
        HostState.joueurs = joueurs;
        renderJoueursConnectes();
        renderScores();
        toast(`${pseudo} a rejoint`, "info", 2000);
    });

    socket.on("PLAYER_LEFT", ({ pseudo, joueurs }) => {
        HostState.joueurs = joueurs;
        renderJoueursConnectes();
        toast(`${pseudo} a quitté`, "warning", 2000);
    });

    socket.on("SCORES_UPDATE", ({ scores }) => {
        HostState.scores = scores;
        renderScores();
        mettreAJourStatutLocal(HostState.partieId, HostState.statut, scores);
    });

    socket.on("GAME_STARTED", ({ snapshot }) => {
        applySnapshot(snapshot);
        HostState.statut = "en_cours";
        _setStatutBadge("en_cours");
        hide("h-btn-start");
        show("h-btn-end");
        mettreAJourStatutLocal(HostState.partieId, "en_cours", null);
        toast("Partie lancée !", "success");
    });

    socket.on("GAME_ENDED", ({ snapshot }) => {
        applySnapshot(snapshot);
        HostState.statut       = "terminee";
        HostState.partieActive = false;
        _setStatutBadge("terminee");
        hide("h-btn-end");
        show("h-btn-nouvelle");
        mettreAJourStatutLocal(HostState.partieId, "terminee", snapshot.scores);
        renderResultats();
        toast("Partie terminée !", "info");
    });

    socket.on("PLAYER_ACTION", ({ pseudo, equipe, action }) => {
        if (typeof window.onPlayerAction === "function") {
            window.onPlayerAction({ pseudo, equipe, action });
        }
    });

    socket.on("ERROR", ({ code }) => {
        const messages = {
            NOT_HOST:       "Accès refusé.",
            NO_ACTIVE_GAME: "Aucune partie active.",
            MISSING_FIELDS: "Données manquantes.",
            GAME_EXISTS:    "Une partie est déjà active sur le serveur.",
        };
        if (code === "GAME_EXISTS") {
            HostState.partieActive = true;
            show("alerte-partie-active");
        }
        toast(messages[code] || `Erreur (${code})`, "error");
    });
}

// ======================================================
// 🎮 CONTRÔLES
// ======================================================

function initControles() {
    $("h-btn-start")?.addEventListener("click", () => {
        if (!HostState.partieId) return;
        socket.send("HOST_START_GAME", {});
    });

    $("h-btn-end")?.addEventListener("click", () => {
        if (!confirm("Terminer la partie ?")) return;
        socket.send("HOST_END_GAME", {});
    });

    $("h-btn-nouvelle")?.addEventListener("click", () => {
        // Reset
        Object.assign(HostState, {
            partieId: null, partieNom: null, jeu: null,
            joueurs: [], scores: {}, statut: null, partieActive: false
        });
        hide("panel-game");
        hide("h-btn-nouvelle");
        hide("alerte-partie-active");
        show("h-btn-start");
        const nomInput = $("h-nom-partie");
        if (nomInput) nomInput.value = "";
        toast("Prêt pour une nouvelle partie !", "info");
    });

    $("h-btn-copy")?.addEventListener("click", () => {
        const link = $("h-join-link");
        if (!link?.href || link.href === "#") return;
        navigator.clipboard.writeText(link.href)
            .then(() => toast("Lien copié !", "success", 1500))
            .catch(() => toast("Copie impossible", "error"));
    });

    $("btn-go-home")?.addEventListener("click", () => {
        location.href = "/main/";
    });
}

// ======================================================
// 🎨 RENDU UI
// ======================================================

function renderGamePanel() {
    const joinUrl = `${location.origin}/join/?partieId=${HostState.partieId}`;

    const infoNom  = $("h-info-nom");
    const infoJeu  = $("h-info-jeu");
    const infoMode = $("h-info-mode");
    if (infoNom)  infoNom.textContent  = HostState.partieNom || "—";
    if (infoJeu)  infoJeu.textContent  = (HostState.jeu || "—").toUpperCase();
    if (infoMode) infoMode.textContent = HostState.mode === "team" ? "🛡️ Équipes" : "👤 Solo";

    _setStatutBadge(HostState.statut || "lobby");

    const link = $("h-join-link");
    if (link) { link.href = joinUrl; link.textContent = joinUrl; }

    _renderQR(joinUrl);

    if (HostState.mode === "team") {
        hide("bloc-joueurs-connectes");
        show("bloc-equipes-connectees");
    } else {
        show("bloc-joueurs-connectes");
        hide("bloc-equipes-connectees");
    }

    renderJoueursConnectes();
    renderScores();
}

function renderJoueursConnectes() {
    const container = $("h-joueurs-connectes");
    const counter   = $("h-nb-joueurs");
    if (!container) return;

    if (counter) counter.textContent = HostState.joueurs.length;

    if (HostState.mode === "team") {
        const equipesCont = $("h-equipes-connectees");
        const nbEquipes   = $("h-nb-equipes");

        const equipesAvecMembres = {};
        HostState.equipes.forEach(eq => { equipesAvecMembres[eq.nom] = []; });
        HostState.joueurs.forEach(j => {
            const eq = j.equipe || "Sans équipe";
            if (!equipesAvecMembres[eq]) equipesAvecMembres[eq] = [];
            equipesAvecMembres[eq].push(j.pseudo);
        });

        if (nbEquipes) nbEquipes.textContent = Object.keys(equipesAvecMembres).length;

        if (equipesCont) {
            equipesCont.innerHTML = Object.entries(equipesAvecMembres).map(([nom, membres]) => `
                <div class="equipe-connectee-card">
                    <div class="equipe-connectee-header">
                        <span>🛡️</span>
                        <span class="equipe-connectee-nom">${esc(nom)}</span>
                        <span class="equipe-connectee-count">${membres.length} joueur${membres.length > 1 ? "s" : ""}</span>
                    </div>
                    <div class="equipe-connectee-membres">
                        ${membres.length > 0
                            ? membres.map(m => `<span class="membre-chip"><span class="membre-avatar">${m.charAt(0).toUpperCase()}</span>${esc(m)}</span>`).join("")
                            : `<span class="membre-empty">Aucun joueur</span>`
                        }
                    </div>
                </div>
            `).join("") || `<p class="list-empty">En attente…</p>`;
        }
        return;
    }

    if (HostState.joueurs.length === 0) {
        container.innerHTML = `<p class="list-empty">En attente de joueurs…</p>`;
        return;
    }

    container.innerHTML = HostState.joueurs.map(j => `
        <div class="joueur-connecte-item">
            <span class="joueur-connecte-avatar">${(j.pseudo || "?").charAt(0).toUpperCase()}</span>
            <span class="joueur-connecte-pseudo">${esc(j.pseudo)}</span>
            <button class="btn-kick" data-pseudo="${esc(j.pseudo)}" title="Expulser">✖</button>
        </div>
    `).join("");

    container.querySelectorAll(".btn-kick").forEach(btn => {
        btn.addEventListener("click", () => {
            if (confirm(`Expulser ${btn.dataset.pseudo} ?`)) {
                socket.send("HOST_KICK_PLAYER", { pseudo: btn.dataset.pseudo });
            }
        });
    });
}

function renderScores() {
    const container = $("h-scores-liste");
    if (!container) return;

    const entries = Object.entries(HostState.scores).sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) {
        container.innerHTML = `<p class="list-empty">Aucun score</p>`;
        return;
    }

    const max    = entries[0]?.[1] || 1;
    const medals = ["🥇","🥈","🥉"];

    container.innerHTML = entries.map(([nom, pts], i) => {
        const pct = max > 0 ? Math.round((pts / max) * 100) : 0;
        return `
            <div class="score-row">
                <span class="score-medal">${medals[i] || `${i+1}.`}</span>
                <span class="score-nom">${esc(nom)}</span>
                <div class="score-bar-wrap"><div class="score-bar" style="width:${pct}%"></div></div>
                <span class="score-pts">${pts}<small> pts</small></span>
                <div class="score-actions">
                    <button class="btn-pts btn-plus"  data-cible="${esc(nom)}" data-delta="1">＋</button>
                    <button class="btn-pts btn-minus" data-cible="${esc(nom)}" data-delta="-1">－</button>
                </div>
            </div>
        `;
    }).join("");

    container.querySelectorAll(".btn-pts").forEach(btn => {
        btn.addEventListener("click", () => {
            const delta = parseInt(btn.dataset.delta);
            socket.send(delta > 0 ? "HOST_ADD_POINTS" : "HOST_REMOVE_POINTS", {
                cible: btn.dataset.cible, points: 1
            });
        });
    });
}

function renderResultats() {
    const entries = Object.entries(HostState.scores).sort((a, b) => b[1] - a[1]);
    const medals  = ["🥇","🥈","🥉"];
    const html = `
        <div class="resultats-finaux">
            <h3 class="resultats-titre">🏁 Résultats finaux</h3>
            ${entries.map(([nom, pts], i) => `
                <div class="resultat-row ${i===0?"resultat-winner":""}">
                    <span class="resultat-medal">${medals[i] || `${i+1}.`}</span>
                    <span class="resultat-nom">${esc(nom)}</span>
                    <span class="resultat-pts">${pts} pts</span>
                </div>
            `).join("")}
        </div>`;
    $("h-scores-liste")?.insertAdjacentHTML("afterend", html);
}

function _renderQR(url) {
    const container = $("h-qr");
    if (!container) return;
    const size = 120;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}&bgcolor=0d0d1a&color=00d4ff&margin=2`;
    container.innerHTML = `<img src="${qrUrl}" alt="QR Code" class="qr-img" onerror="this.closest('.qr-container').innerHTML='<p style=color:var(--c-text-mute)>QR indisponible</p>'">`;
}

function _setStatutBadge(statut) {
    const badge = $("h-statut-badge");
    if (!badge) return;
    const map = {
        lobby:    { text: "● Lobby",    cls: "statut-lobby"    },
        en_cours: { text: "● En cours", cls: "statut-en-cours" },
        terminee: { text: "● Terminée", cls: "statut-terminee" },
    };
    const info = map[statut] || map.lobby;
    badge.textContent = info.text;
    badge.className   = `statut-badge ${info.cls}`;
}

// ======================================================
// 🔄 SNAPSHOT
// ======================================================

function applySnapshot(snap) {
    if (!snap) return;
    HostState.partieId  = snap.id      ?? HostState.partieId;
    HostState.partieNom = snap.nom     ?? HostState.partieNom;
    HostState.jeu       = snap.jeu     ?? HostState.jeu;
    HostState.mode      = snap.mode    ?? HostState.mode;
    HostState.equipes   = snap.equipes ?? HostState.equipes;
    HostState.scores    = snap.scores  ?? HostState.scores;
    HostState.statut    = snap.statut  ?? HostState.statut;
    HostState.joueurs   = snap.joueurs ?? HostState.joueurs;
}

// ======================================================
// 📥 PRÉ-REMPLISSAGE DEPUIS URL (jeu présélectionné)
// ======================================================

function initFromUrl() {
    const params = new URLSearchParams(location.search);
    const jeuId = params.get("jeu");
    if (jeuId) {
        const select = $("h-jeu");
        if (select) select.value = jeuId;
    }
}

// ======================================================
// 🚀 INIT
// ======================================================

document.addEventListener("DOMContentLoaded", () => {
    hide("alerte-partie-active");

    initSocketStatus();
    initAuth();
    initSocketEvents();
    initModeToggle();
    initHostRoleToggle();
    initJoueursSolo();
    initEquipes();
    initCreerPartie();
    initControles();
    initFromUrl();

    socket.connect(WS_URL);

    console.log("[HOST] 🎮 v3 initialisé");
});

window.HostState = HostState;