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
    statut:   null,
    jeu:      null,
    mode:     null,
};

// =============================================
// 📋 FORMULAIRE D'INSCRIPTION
// =============================================
async function initJoin() {
    await chargerParties();

    // Pré-sélection via ?partieId=xxx dans l'URL
    const urlParams  = new URLSearchParams(location.search);
    const partieIdUrl = urlParams.get("partieId");
    if (partieIdUrl) {
        setTimeout(() => {
            const select = $("p-partie-select");
            if ([...select.options].some(o => o.value === partieIdUrl)) {
                select.value = partieIdUrl;
                onPartieChange();
            }
        }, 300);
    }

    $("p-partie-select").onchange = onPartieChange;

    $("p-btn-refresh").onclick = async () => {
        $("p-btn-refresh").textContent = "⏳ Chargement…";
        await chargerParties();
        $("p-btn-refresh").textContent = "🔄 Actualiser les parties";
    };

    $("p-btn-join").onclick = tenterRejoindre;
    $("p-pseudo").onkeydown = e => { if (e.key === "Enter") tenterRejoindre(); };
}

function tenterRejoindre() {
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

    // ✅ Utilisation correcte de socket.send(type, payload)
    socket.send("PLAYER_JOIN", { pseudo, partieId, equipe });
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

        select.innerHTML = `<option value="">-- Choisir une partie --</option>` +
            list.map(p => `
                <option value="${esc(p.id)}"
                        data-mode="${esc(p.mode)}"
                        data-jeu="${esc(p.jeu)}"
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

    const mode      = opt.dataset.mode;
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
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    setTimeout(() => { el.hidden = true; }, 4000);
}

// =============================================
// 🏠 LOBBY JOUEUR
// =============================================
function afficherLobby(snapshot) {
    afficherEcran("player-lobby");

    state.jeu  = snapshot?.jeu;
    state.mode = snapshot?.mode;

    $("p-avatar").textContent         = (state.pseudo || "?").charAt(0).toUpperCase();
    $("p-pseudo-display").textContent = state.pseudo || "";
    $("p-equipe-display").textContent = state.equipe ? `🛡️ Équipe : ${state.equipe}` : "";

    const badgeJeu  = $("p-lobby-jeu");
    const badgeMode = $("p-lobby-mode");
    if (badgeJeu)  badgeJeu.textContent  = snapshot?.jeu?.toUpperCase() || "";
    if (badgeMode) badgeMode.textContent = snapshot?.mode === "team" ? "👥 Équipes" : "👤 Solo";

    renderAutresJoueurs(snapshot?.joueurs || []);
}

function renderAutresJoueurs(joueurs) {
    const liste = $("p-liste-joueurs");
    if (!liste) return;
    liste.innerHTML = joueurs.map(j => `
        <span class="lobby-joueur-tag">
            ${esc(j.pseudo)}
            ${j.equipe ? `<small>🛡️ ${esc(j.equipe)}</small>` : ""}
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
    state.scores = scores;
}

// =============================================
// 🏁 RÉSULTATS
// =============================================
function afficherResultats(snapshot) {
    afficherEcran("player-results");

    const entries = Object.entries(snapshot?.scores || {}).sort((a, b) => b[1] - a[1]);
    const medals  = ["🥇", "🥈", "🥉"];
    const cible   = state.equipe || state.pseudo;

    $("p-results-content").innerHTML = entries.length === 0
        ? `<p class="h-empty">Aucun score enregistré.</p>`
        : entries.map(([nom, pts], i) => `
            <div class="result-row ${nom === cible ? "result-me" : ""}">
                <span class="result-pos">${medals[i] || `${i+1}.`}</span>
                <span class="result-nom">${esc(nom)}</span>
                <span class="result-pts"><strong>${pts} pts</strong></span>
            </div>
        `).join("");

    $("p-btn-rejouer").onclick = () => {
        // Réinitialiser l'état
        state.pseudo = state.equipe = state.partieId = state.jeu = state.mode = null;
        state.scores = {};
        chargerParties();
        afficherEcran("player-join");
    };
}

// =============================================
// 📡 ÉVÉNEMENTS WEBSOCKET ENTRANTS
// =============================================
function initSocketEvents() {

    // ── Connexion/déconnexion WS ──────────────────────
    socket.on("__connected__", () => {
        const banner = document.querySelector(".player-disconnect-banner");
        if (banner) banner.hidden = true;
    });

    socket.on("__disconnected__", () => {
        const banner = document.querySelector(".player-disconnect-banner");
        if (banner) banner.hidden = false;
    });

    // ── Rejoindre ─────────────────────────────────────
    socket.on("JOIN_OK", ({ pseudo, equipe, snapshot }) => {
        state.pseudo   = pseudo;
        state.equipe   = equipe;
        state.partieId = snapshot?.id;
        afficherLobby(snapshot);
    });

    socket.on("JOIN_FAIL", ({ error }) => {
        afficherErreur(error || "Impossible de rejoindre la partie.");
    });

    // ── Mise à jour lobby ─────────────────────────────
    socket.on("PLAYER_JOINED", ({ joueurs }) => {
        if (!$("player-lobby")?.hidden) {
            renderAutresJoueurs(joueurs);
        }
    });

    socket.on("PLAYER_LEFT", ({ joueurs }) => {
        if (!$("player-lobby")?.hidden) {
            renderAutresJoueurs(joueurs);
        }
    });

    // ── Jeu ───────────────────────────────────────────
    socket.on("GAME_STARTED", ({ snapshot }) => {
        afficherJeu(snapshot);
    });

    socket.on("SCORES_UPDATE", ({ scores }) => {
        mettreAJourScore(scores);
    });

    socket.on("GAME_ENDED", ({ snapshot }) => {
        afficherResultats(snapshot);
    });

    // ── Expulsion ─────────────────────────────────────
    socket.on("PLAYER_KICKED", ({ reason }) => {
        alert(`Tu as été expulsé : ${reason || "sans raison."}`);
        state.pseudo = state.equipe = state.partieId = null;
        chargerParties();
        afficherEcran("player-join");
    });

    // ── Erreurs ───────────────────────────────────────
    socket.on("ERROR", ({ code }) => {
        const messages = {
            RATE_LIMIT: "Trop de messages envoyés. Ralentis !",
        };
        if (messages[code]) afficherErreur(messages[code]);
        else console.warn("[PLAYER] Erreur serveur :", code);
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