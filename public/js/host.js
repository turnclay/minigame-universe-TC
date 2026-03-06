// public/js/host.js
// =============================================
// 🟦 INTERFACE HOST
// =============================================

import { socket } from "./core/socket.js";

// ── Helpers DOM ────────────────────────────────────
const $ = id => document.getElementById(id);
const show = id => { const el = $(id); if (el) el.hidden = false; };
const hide = id => { const el = $(id); if (el) el.hidden = true; };
const esc  = str => String(str || "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");

// ── État local HOST ────────────────────────────────
const state = {
    partieId:   null,
    partieNom:  null,
    jeu:        null,
    mode:       null,
    equipes:    [],   // [{ nom, membres }]
    joueurs:    [],   // [{ pseudo, equipe }]
    scores:     {},
    statut:     null  // "lobby" | "en_cours" | "terminee"
};

// ── URL WebSocket ──────────────────────────────────
const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

// =============================================
// 🔐 AUTHENTIFICATION
// =============================================
function initAuth() {
    const btnAuth = $("auth-btn");
    const input   = $("auth-password");

    // Log de debug pour vérifier l’envoi
    console.log("INIT AUTH — prêt à envoyer");

    const tenter = () => {
        const password = input.value;
        if (!password) return;

        console.log("ENVOI AUTH :", {
            type: "HOST_AUTH",
            payload: { password }
        });

        // 🔥 Envoi correct du message JSON
        socket.send(JSON.stringify({
            type: "HOST_AUTH",
            payload: { password }
        }));
    };

    btnAuth.onclick = tenter;

    input.onkeydown = e => {
        if (e.key === "Enter") tenter();
    };

    socket.on("AUTH_OK", () => {
        hide("host-auth");
        show("host-lobby");
        initLobby();
    });

    socket.on("AUTH_FAIL", ({ error }) => {
        const errEl = $("auth-error");
        errEl.textContent = error || "Mot de passe incorrect.";
        errEl.hidden = false;
        input.value = "";
        input.focus();
    });
}

// =============================================
// 🏠 LOBBY HOST
// =============================================
function initLobby() {
    // Mode toggle équipes
    $("h-mode").onchange = () => {
        const isTeam = $("h-mode").value === "team";
        $("h-equipes-bloc").hidden = !isTeam;
    };

    // Ajouter équipe
    const addEquipe = () => {
        const nom = $("h-equipe-input").value.trim();
        if (!nom) return;
        if (state.equipes.some(e => e.nom.toLowerCase() === nom.toLowerCase())) {
            alert("Ce nom d'équipe existe déjà."); return;
        }
        state.equipes.push({ nom, membres: [] });
        $("h-equipe-input").value = "";
        renderEquipesHost();
    };
    $("h-equipe-ajouter").onclick = addEquipe;
    $("h-equipe-input").onkeydown = e => { if (e.key === "Enter") addEquipe(); };

    // Créer la partie
    $("h-btn-creer").onclick = () => {
        const nom  = $("h-nom-partie").value.trim();
        const jeu  = $("h-jeu").value;
        const mode = $("h-mode").value;

        if (!nom) { alert("Donne un nom à la partie."); return; }
        if (mode === "team" && state.equipes.length < 2) {
            alert("Il faut au moins 2 équipes."); return;
        }

        socket.send("HOST_CREATE_GAME", {
            nom, jeu, mode,
            equipes: state.equipes
        });
    };

    socket.on("GAME_CREATED", ({ partieId, snapshot }) => {
        state.partieId = partieId;
        applySnapshot(snapshot);
        show("h-game-panel");
        renderGamePanel();
    });

    // Démarrer
    $("h-btn-start").onclick = () => {
        socket.send("HOST_START_GAME", {});
    };

    // Terminer
    $("h-btn-end").onclick = () => {
        if (!confirm("Terminer la partie ?")) return;
        socket.send("HOST_END_GAME", {});
    };
}

// ── Render liste équipes dans le formulaire ────────
function renderEquipesHost() {
    const liste = $("h-equipes-liste");
    liste.innerHTML = state.equipes.map((eq, i) => `
        <div class="h-equipe-row">
            <span>🛡️ ${esc(eq.nom)}</span>
            <button class="h-equipe-del" data-i="${i}">✖</button>
        </div>
    `).join("");

    liste.querySelectorAll(".h-equipe-del").forEach(btn => {
        btn.onclick = () => {
            state.equipes.splice(parseInt(btn.dataset.i), 1);
            renderEquipesHost();
        };
    });
}

// ── Render panneau partie active ───────────────────
function renderGamePanel() {
    $("h-info-nom").textContent    = state.partieNom || "";
    $("h-info-jeu").textContent    = state.jeu?.toUpperCase() || "";
    $("h-info-statut").textContent = state.statut === "en_cours" ? "● En cours"
        : state.statut === "terminee" ? "● Terminée" : "● Lobby";

    // Lien joueur
    const joinUrl = `${location.origin}/join?partieId=${state.partieId}`;
    const linkEl  = $("h-join-link");
    linkEl.href   = joinUrl;
    linkEl.textContent = joinUrl;

    renderJoueursHost();
    renderScoresHost();
}

function renderJoueursHost() {
    const liste = $("h-joueurs-liste");
    $("h-nb-joueurs").textContent = state.joueurs.length;

    if (state.joueurs.length === 0) {
        liste.innerHTML = `<p class="h-empty">En attente de joueurs…</p>`;
        return;
    }

    liste.innerHTML = state.joueurs.map(j => `
        <div class="h-joueur-row">
            <span class="h-joueur-pseudo">${esc(j.pseudo)}</span>
            ${j.equipe ? `<span class="h-joueur-equipe">🛡️ ${esc(j.equipe)}</span>` : ""}
            <button class="h-joueur-kick" data-pseudo="${esc(j.pseudo)}" title="Expulser">✖</button>
        </div>
    `).join("");

    liste.querySelectorAll(".h-joueur-kick").forEach(btn => {
        btn.onclick = () => {
            if (!confirm(`Expulser ${btn.dataset.pseudo} ?`)) return;
            socket.send("HOST_KICK_PLAYER", { pseudo: btn.dataset.pseudo });
        };
    });
}

function renderScoresHost() {
    const liste = $("h-scores-liste");
    const entries = Object.entries(state.scores).sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) {
        liste.innerHTML = `<p class="h-empty">Aucun score pour l'instant.</p>`;
        return;
    }

    liste.innerHTML = entries.map(([cible, pts]) => `
        <div class="h-score-row">
            <span class="h-score-nom">${esc(cible)}</span>
            <span class="h-score-pts">${pts} pts</span>
            <div class="h-score-btns">
                <button class="h-score-plus"  data-cible="${esc(cible)}">+1</button>
                <button class="h-score-moins" data-cible="${esc(cible)}">−1</button>
            </div>
        </div>
    `).join("");

    liste.querySelectorAll(".h-score-plus").forEach(btn => {
        btn.onclick = () => socket.send("HOST_ADD_POINTS", { cible: btn.dataset.cible, points: 1 });
    });
    liste.querySelectorAll(".h-score-moins").forEach(btn => {
        btn.onclick = () => socket.send("HOST_REMOVE_POINTS", { cible: btn.dataset.cible, points: 1 });
    });
}

// ── Appliquer un snapshot serveur ─────────────────
function applySnapshot(snap) {
    if (!snap) return;
    state.partieId  = snap.id;
    state.partieNom = snap.nom;
    state.jeu       = snap.jeu;
    state.mode      = snap.mode;
    state.statut    = snap.statut;
    state.equipes   = snap.equipes  || [];
    state.joueurs   = snap.joueurs  || [];
    state.scores    = snap.scores   || {};
}

// =============================================
// 📡 ÉVÉNEMENTS WEBSOCKET ENTRANTS
// =============================================
function initSocketEvents() {
    // Indicateur de connexion
    socket.on("__connected__", () => {
        $("ws-indicator").className = "ws-dot ws-connected";
        $("ws-label").textContent = "Connecté";
    });

    socket.on("__disconnected__", () => {
        $("ws-indicator").className = "ws-dot ws-disconnected";
        $("ws-label").textContent = "Déconnecté — reconnexion…";
    });

    socket.on("__reconnect_failed__", () => {
        $("ws-label").textContent = "Connexion perdue";
    });

    // Joueur rejoint
    socket.on("PLAYER_JOINED", ({ pseudo, equipe, joueurs }) => {
        state.joueurs = joueurs;
        renderJoueursHost();
        // Initialise score si absent
        const cible = state.mode === "team" ? equipe : pseudo;
        if (cible && !(cible in state.scores)) {
            state.scores[cible] = 0;
            renderScoresHost();
        }
    });

    // Joueur parti
    socket.on("PLAYER_LEFT", ({ pseudo, joueurs }) => {
        state.joueurs = joueurs;
        renderJoueursHost();
    });

    // Scores mis à jour
    socket.on("SCORES_UPDATE", ({ scores }) => {
        state.scores = scores;
        renderScoresHost();
    });

    // Partie démarrée
    socket.on("GAME_STARTED", ({ snapshot }) => {
        applySnapshot(snapshot);
        state.statut = "en_cours";
        hide("h-btn-start");
        show("h-btn-end");
        $("h-info-statut").textContent = "● En cours";
    });

    // Partie terminée
    socket.on("GAME_ENDED", ({ snapshot }) => {
        applySnapshot(snapshot);
        hide("h-btn-end");
        $("h-info-statut").textContent = "● Terminée";
    });

    socket.on("ERROR", ({ code }) => {
        console.error("[HOST] Erreur serveur :", code);
    });
}

// =============================================
// 🚀 INIT
// =============================================
document.addEventListener("DOMContentLoaded", () => {
    initSocketEvents();
    socket.connect(WS_URL);

    // Connexion établie → montre l'écran auth
    socket.on("__connected__", () => {
        // Si déjà sur le lobby (reconnexion), ne pas réafficher l'auth
        if (!$("host-auth").hidden) return;
    });

    initAuth();
});
