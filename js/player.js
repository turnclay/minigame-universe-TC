// public/js/player.js
// =============================================
// 🟩 INTERFACE PLAYER
// =============================================

import { socket } from "./core/socket.js";

// ── Helpers DOM ────────────────────────────────────
const $ = id => document.getElementById(id);
const show = id => { const el = $(id); if (el) el.hidden = false; };
const hide = id => { const el = $(id); if (el) el.hidden = true; };
const esc  = str => String(str || "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");

// ── URL WebSocket ──────────────────────────────────
const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

// ── Écrans ─────────────────────────────────────────
const SCREENS = ["player-join", "player-lobby", "player-game", "player-results"];
function afficherEcran(id) {
    SCREENS.forEach(s => { const el = $(s); if (el) el.hidden = (s !== id); });
}

// ── État local joueur ──────────────────────────────
const state = {
    pseudo:   null,
    equipe:   null,
    partieId: null,
    scores:   {},
    statut:   null
};

// =============================================
// 📋 FORMULAIRE D'INSCRIPTION
// =============================================
async function initJoin() {
    // Récupère la liste des parties en lobby via REST
    await chargerParties();

    // Si partieId en URL (?partieId=xxx), pré-sélectionner
    const urlParams = new URLSearchParams(location.search);
    const partieIdUrl = urlParams.get("partieId");
    if (partieIdUrl) {
        const select = $("p-partie-select");
        // Attend que le select soit rempli
        setTimeout(() => {
            if ([...select.options].some(o => o.value === partieIdUrl)) {
                select.value = partieIdUrl;
                onPartieChange();
            }
        }, 300);
    }

    $("p-partie-select").onchange = onPartieChange;

    $("p-btn-join").onclick = () => {
        const pseudo   = $("p-pseudo").value.trim();
        const partieId = $("p-partie-select").value;
        const equipe   = $("p-equipe-select")?.value || null;

        if (!pseudo) {
            afficherErreur("Entre ton pseudo."); return;
        }
        if (!partieId) {
            afficherErreur("Sélectionne une partie."); return;
        }

        state.pseudo   = pseudo;
        state.partieId = partieId;
        state.equipe   = equipe || null;

        socket.send("PLAYER_JOIN", { pseudo, partieId, equipe });
    };

    $("p-pseudo").onkeydown = e => {
        if (e.key === "Enter") $("p-btn-join").click();
    };
}

async function chargerParties() {
    const select = $("p-partie-select");
    try {
        const res  = await fetch("/api/parties");
        const list = await res.json();

        if (list.length === 0) {
            select.innerHTML = `<option value="">Aucune partie disponible</option>`;
            return;
        }

        select.innerHTML = list.map(p => `
            <option value="${esc(p.id)}"
                    data-mode="${esc(p.mode)}"
                    data-equipes='${JSON.stringify(p.equipes || [])}'>
                ${esc(p.nom)} — ${esc(p.jeu.toUpperCase())}
                (${p.nbJoueurs} joueur${p.nbJoueurs > 1 ? "s" : ""})
            </option>
        `).join("");
    } catch {
        select.innerHTML = `<option value="">Erreur de chargement</option>`;
    }
}

function onPartieChange() {
    const select = $("p-partie-select");
    const opt    = select.options[select.selectedIndex];
    if (!opt || !opt.value) return;

    const mode   = opt.dataset.mode;
    const equipeBloc = $("p-equipe-bloc");

    if (mode === "team") {
        let equipes = [];
        try { equipes = JSON.parse(opt.dataset.equipes || "[]"); } catch {}

        const eqSelect = $("p-equipe-select");
        eqSelect.innerHTML = `<option value="">-- Choisir une équipe --</option>`
            + equipes.map(e => `<option value="${esc(e.nom)}">${esc(e.nom)}</option>`).join("");

        equipeBloc.hidden = false;
    } else {
        equipeBloc.hidden = true;
    }
}

function afficherErreur(msg) {
    const el = $("p-join-error");
    el.textContent = msg;
    el.hidden = false;
    setTimeout(() => { el.hidden = true; }, 4000);
}

// =============================================
// 🏠 LOBBY JOUEUR
// =============================================
function afficherLobby(snapshot) {
    afficherEcran("player-lobby");

    $("p-avatar").textContent        = state.pseudo?.charAt(0).toUpperCase() || "?";
    $("p-pseudo-display").textContent = state.pseudo || "";
    $("p-equipe-display").textContent = state.equipe
        ? `🛡️ Équipe : ${state.equipe}` : "";

    renderAutresJoueurs(snapshot?.joueurs || []);
}

function renderAutresJoueurs(joueurs) {
    const liste = $("p-liste-joueurs");
    liste.innerHTML = joueurs.map(j => `
        <span class="lobby-joueur-tag">
            ${esc(j.pseudo)}
            ${j.equipe ? `<small>🛡️${esc(j.equipe)}</small>` : ""}
        </span>
    `).join("") || `<p class="h-empty">Tu es le premier !</p>`;
}

// =============================================
// 🎮 JEU EN COURS
// =============================================
function afficherJeu(snapshot) {
    afficherEcran("player-game");

    $("p-header-pseudo").textContent = state.pseudo || "";
    $("p-header-equipe").textContent = state.equipe ? `🛡️ ${state.equipe}` : "";

    const monScore = snapshot?.scores?.[state.equipe || state.pseudo] ?? 0;
    $("p-header-score").textContent = `${monScore} pts`;
}

function mettreAJourScore(scores) {
    const cible    = state.equipe || state.pseudo;
    const monScore = scores?.[cible] ?? 0;
    const el = $("p-header-score");
    if (el) el.textContent = `${monScore} pts`;
}

// =============================================
// 🏁 RÉSULTATS
// =============================================
function afficherResultats(snapshot) {
    afficherEcran("player-results");

    const entries = Object.entries(snapshot?.scores || {})
        .sort((a, b) => b[1] - a[1]);

    const medals = ["🥇", "🥈", "🥉"];
    const cible  = state.equipe || state.pseudo;

    $("p-results-content").innerHTML = entries.map(([nom, pts], i) => `
        <div class="result-row ${nom === cible ? "result-me" : ""}">
            <span>${medals[i] || `${i+1}.`}</span>
            <span>${esc(nom)}</span>
            <span><strong>${pts} pts</strong></span>
        </div>
    `).join("");

    $("p-btn-rejouer").onclick = () => {
        // Reset état et retour au formulaire
        state.pseudo = state.equipe = state.partieId = null;
        chargerParties();
        afficherEcran("player-join");
    };
}

// =============================================
// 📡 ÉVÉNEMENTS WEBSOCKET ENTRANTS
// =============================================
function initSocketEvents() {
    socket.on("JOIN_OK", ({ pseudo, equipe, snapshot }) => {
        state.pseudo   = pseudo;
        state.equipe   = equipe;
        state.partieId = snapshot?.id;
        afficherLobby(snapshot);
    });

    socket.on("JOIN_FAIL", ({ error }) => {
        afficherErreur(error || "Impossible de rejoindre la partie.");
    });

    socket.on("PLAYER_JOINED", ({ joueurs }) => {
        // Mise à jour de la liste dans le lobby
        if (!$("player-lobby").hidden) {
            renderAutresJoueurs(joueurs);
        }
    });

    socket.on("PLAYER_LEFT", ({ joueurs }) => {
        if (!$("player-lobby").hidden) {
            renderAutresJoueurs(joueurs);
        }
    });

    socket.on("GAME_STARTED", ({ snapshot }) => {
        afficherJeu(snapshot);
    });

    socket.on("SCORES_UPDATE", ({ scores }) => {
        mettreAJourScore(scores);
    });

    socket.on("GAME_ENDED", ({ snapshot }) => {
        afficherResultats(snapshot);
    });

    socket.on("PLAYER_KICKED", ({ reason }) => {
        alert(`Tu as été expulsé : ${reason}`);
        afficherEcran("player-join");
    });

    socket.on("__disconnected__", () => {
        // Affiche un bandeau discret sans bloquer le jeu
        const banner = document.querySelector(".player-disconnect-banner");
        if (banner) banner.hidden = false;
    });

    socket.on("__connected__", () => {
        const banner = document.querySelector(".player-disconnect-banner");
        if (banner) banner.hidden = true;
    });

    socket.on("ERROR", ({ code }) => {
        if (code === "RATE_LIMIT") {
            afficherErreur("Trop de messages envoyés. Ralentis !");
        }
    });
}

// =============================================
// 🚀 INIT
// =============================================
document.addEventListener("DOMContentLoaded", () => {
    initSocketEvents();
    socket.connect(WS_URL);
    afficherEcran("player-join");
    initJoin();
});
