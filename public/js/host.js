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
    equipes:    [],
    joueurs:    [],
    scores:     {},
    statut:     null
};

// ── URL WebSocket ──────────────────────────────────
const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

// =============================================
// 🔐 AUTHENTIFICATION — VERSION CORRIGÉE
// =============================================
function initAuth() {
    const btnAuth = $("auth-btn");
    const input   = $("auth-password");

    let ready = false;

    // Quand la socket est connectée → on autorise l’envoi
    socket.on("__connected__", () => {
        console.log("[HOST] WebSocket connectée, AUTH possible");
        ready = true;
    });

    const tenter = () => {
        const password = input.value;
        if (!password) return;

        if (!ready) {
            console.warn("[HOST] Tentative AUTH avant connexion WS");
            return;
        }

        console.log("[HOST] ENVOI AUTH :", password);

        socket.send(JSON.stringify({
            type: "HOST_AUTH",
            payload: { password }
        }));
    };

    btnAuth.onclick = tenter;
    input.onkeydown = e => { if (e.key === "Enter") tenter(); };

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

    $("h-mode").onchange = () => {
        const isTeam = $("h-mode").value === "team";
        $("h-equipes-bloc").hidden = !isTeam;
    };

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

    $("h-btn-start").onclick = () => {
        socket.send("HOST_START_GAME", {});
    };

    $("h-btn-end").onclick = () => {
        if (!confirm("Terminer la partie ?")) return;
        socket.send("HOST_END_GAME", {});
    };
}

// =============================================
// 📡 ÉVÉNEMENTS WEBSOCKET ENTRANTS
// =============================================
function initSocketEvents() {

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

    socket.on("PLAYER_JOINED", ({ pseudo, equipe, joueurs }) => {
        state.joueurs = joueurs;
        renderJoueursHost();
        const cible = state.mode === "team" ? equipe : pseudo;
        if (cible && !(cible in state.scores)) {
            state.scores[cible] = 0;
            renderScoresHost();
        }
    });

    socket.on("PLAYER_LEFT", ({ pseudo, joueurs }) => {
        state.joueurs = joueurs;
        renderJoueursHost();
    });

    socket.on("SCORES_UPDATE", ({ scores }) => {
        state.scores = scores;
        renderScoresHost();
    });

    socket.on("GAME_STARTED", ({ snapshot }) => {
        applySnapshot(snapshot);
        state.statut = "en_cours";
        hide("h-btn-start");
        show("h-btn-end");
        $("h-info-statut").textContent = "● En cours";
    });

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
    initAuth();
});