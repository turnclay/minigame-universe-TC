// /public/js/player.js
// ======================================================
// 🎮 PLAYER.JS v3 — Interface joueur
// ======================================================

import { socket } from "./core/socket.js";

// ── Helpers ───────────────────────────────────────────
const $    = id => document.getElementById(id);
const show = id => { const el = $(id); if (el) el.hidden = false; };
const hide = id => { const el = $(id); if (el) el.hidden = true; };
const esc  = str => String(str||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

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
// 🗂️ ÉTAT JOUEUR
// ======================================================

const PlayerState = {
    pseudo:    null,
    equipe:    null,
    partieId:  null,
    score:     0,
    connected: false,
};

// ======================================================
// 📺 ÉCRANS
// ======================================================

function showScreen(id) {
    ["player-join","player-lobby","player-game","player-results"].forEach(s => {
        const el = $(s);
        if (el) el.hidden = true;
    });
    const target = $(id);
    if (target) target.hidden = false;
}

// ======================================================
// 📡 CHARGEMENT DES PARTIES DISPONIBLES
// ======================================================

async function chargerParties() {
    const select  = $("p-partie-select");
    const loading = $("p-parties-loading");
    const empty   = $("p-parties-empty");

    if (loading) loading.hidden = false;
    if (empty)   empty.hidden   = true;
    if (select)  select.innerHTML = "";

    try {
        const res = await fetch("/api/parties");
        if (!res.ok) throw new Error("Erreur réseau");
        const parties = await res.json();

        if (loading) loading.hidden = true;

        if (!parties || parties.length === 0) {
            if (empty) empty.hidden = false;
            if (select) select.innerHTML = `<option value="">Aucune partie disponible</option>`;
            return;
        }

        if (select) {
            select.innerHTML = `<option value="">-- Choisir une partie --</option>` +
                parties.map(p => `<option value="${esc(p.id)}" data-mode="${esc(p.mode)}" data-equipes='${JSON.stringify(p.equipes||[])}'>${esc(p.nom)} · ${esc(p.jeu?.toUpperCase())} · ${p.nbJoueurs} joueur${p.nbJoueurs>1?"s":""}</option>`).join("");
        }

        // Écouter changement pour afficher/masquer sélection équipe
        select?.addEventListener("change", () => onPartieSelectChange(parties));

        // Pré-sélectionner si URL contient partieId
        const urlParams = new URLSearchParams(location.search);
        const urlPartieId = urlParams.get("partieId");
        if (urlPartieId && select) {
            select.value = urlPartieId;
            onPartieSelectChange(parties);
        }

    } catch(e) {
        if (loading) loading.hidden = true;
        if (empty)   { empty.hidden = false; empty.textContent = "Impossible de charger les parties."; }
        console.error("[PLAYER] Erreur chargement parties:", e);
    }
}

function onPartieSelectChange(parties) {
    const select = $("p-partie-select");
    const id     = select?.value;
    const partie = parties.find(p => p.id === id);

    const equipeBloc   = $("p-equipe-bloc");
    const equipeSelect = $("p-equipe-select");

    if (!partie) {
        if (equipeBloc) equipeBloc.hidden = true;
        return;
    }

    if (partie.mode === "team" && partie.equipes?.length > 0) {
        if (equipeBloc) equipeBloc.hidden = false;
        if (equipeSelect) {
            equipeSelect.innerHTML =
                `<option value="">-- Choisir une équipe --</option>` +
                partie.equipes.map(eq => `<option value="${esc(eq.nom)}">${esc(eq.nom)}</option>`).join("");
        }
    } else {
        if (equipeBloc) equipeBloc.hidden = true;
    }
}

// ======================================================
// 🔌 CONNEXION WS + REJOINDRE
// ======================================================

function initJoinForm() {
    const btnJoin    = $("p-btn-join");
    const btnRefresh = $("p-btn-refresh");

    // ✅ Pré-remplir depuis sessionStorage (partie sauvegardée)
    const partieACharger = sessionStorage.getItem("mgu_partie_a_charger");
    if (partieACharger) {
        try {
            const p = JSON.parse(partieACharger);
            // Pré-remplir le pseudo depuis la dernière session si dispo
            const lastPseudo = localStorage.getItem("mgu_last_pseudo");
            if (lastPseudo) {
                const pseudoInput = $("p-pseudo");
                if (pseudoInput) pseudoInput.value = lastPseudo;
            }
            // On affichera la partie une fois les parties chargées
        } catch(e) {}
    }

    btnJoin?.addEventListener("click", rejoindrePartie);
    btnRefresh?.addEventListener("click", () => { chargerParties(); toast("Actualisation…", "info", 1500); });

    $("p-pseudo")?.addEventListener("keydown", e => { if (e.key === "Enter") rejoindrePartie(); });
}

function rejoindrePartie() {
    const pseudo  = $("p-pseudo")?.value.trim();
    const partieId = $("p-partie-select")?.value;
    const equipe   = $("p-equipe-select")?.value || null;

    hideError();

    if (!pseudo)   { showError("Entrez votre pseudo."); return; }
    if (!partieId) { showError("Sélectionnez une partie."); return; }

    PlayerState.pseudo   = pseudo;
    PlayerState.partieId = partieId;
    PlayerState.equipe   = equipe;

    // Sauvegarder le pseudo pour pré-remplissage futur
    localStorage.setItem("mgu_last_pseudo", pseudo);

    if (!socket.connected) {
        socket.connect(WS_URL);
        socket.on("__connected__", () => {
            socket.send("PLAYER_JOIN", { pseudo, partieId, equipe });
        });
    } else {
        socket.send("PLAYER_JOIN", { pseudo, partieId, equipe });
    }

    // Nettoyer la partie à charger
    sessionStorage.removeItem("mgu_partie_a_charger");
}

// ======================================================
// 📡 SOCKET EVENTS JOUEUR
// ======================================================

function initSocketEvents() {

    socket.on("__disconnected__", () => {
        const banner = $("player-disconnect-banner");
        if (banner) banner.hidden = false;
    });

    socket.on("__connected__", () => {
        const banner = $("player-disconnect-banner");
        if (banner) banner.hidden = true;
    });

    socket.on("JOIN_OK", ({ pseudo, partieId, snapshot }) => {
        PlayerState.pseudo   = pseudo;
        PlayerState.partieId = partieId;
        PlayerState.connected = true;

        // Remplir lobby
        const avatarEl  = $("p-avatar");
        const pseudoEl  = $("p-pseudo-display");
        const equipeEl  = $("p-equipe-display");
        const headerEl  = $("p-header-pseudo");
        const hEquipeEl = $("p-header-equipe");

        if (avatarEl)  avatarEl.textContent  = pseudo.charAt(0).toUpperCase();
        if (pseudoEl)  pseudoEl.textContent  = pseudo;
        if (equipeEl)  equipeEl.textContent  = PlayerState.equipe ? `🛡️ ${PlayerState.equipe}` : "";
        if (headerEl)  headerEl.textContent  = pseudo;
        if (hEquipeEl) hEquipeEl.textContent = PlayerState.equipe ? `🛡️ ${PlayerState.equipe}` : "";

        // Jeu + mode
        if (snapshot) {
            const jeuEl  = $("p-lobby-jeu");
            const modeEl = $("p-lobby-mode");
            if (jeuEl)  jeuEl.textContent  = snapshot.jeu?.toUpperCase() || "";
            if (modeEl) modeEl.textContent = snapshot.mode === "team" ? "🛡️ Équipes" : "👤 Solo";
            renderLobbyJoueurs(snapshot.joueurs || []);
        }

        showScreen("player-lobby");
        toast(`Bienvenue ${pseudo} !`, "success", 2000);
    });

    socket.on("JOIN_FAIL", ({ error }) => {
        showError(error || "Impossible de rejoindre.");
        toast(error || "Rejoindre échoué.", "error");
    });

    socket.on("PLAYER_JOINED", ({ joueurs }) => {
        renderLobbyJoueurs(joueurs);
    });

    socket.on("PLAYER_LEFT", ({ joueurs }) => {
        renderLobbyJoueurs(joueurs);
    });

    socket.on("GAME_STARTED", ({ snapshot }) => {
        showScreen("player-game");
        toast("La partie commence !", "success", 2000);
    });

    socket.on("SCORES_UPDATE", ({ scores }) => {
        const myScore = scores[PlayerState.pseudo]
            ?? scores[PlayerState.equipe]
            ?? 0;
        PlayerState.score = myScore;
        const el = $("p-header-score");
        if (el) el.textContent = `${myScore} pts`;
    });

    socket.on("GAME_ENDED", ({ snapshot }) => {
        renderResultats(snapshot?.scores || {});
        showScreen("player-results");
        toast("Partie terminée !", "info");
    });

    socket.on("PLAYER_KICKED", ({ reason }) => {
        toast(reason || "Vous avez été expulsé.", "error", 5000);
        setTimeout(() => showScreen("player-join"), 2000);
    });
}

// ======================================================
// 🎨 RENDU LOBBY
// ======================================================

function renderLobbyJoueurs(joueurs) {
    const container = $("p-liste-joueurs");
    if (!container) return;

    if (!joueurs || joueurs.length === 0) {
        container.innerHTML = `<span class="lobby-joueur-empty">En attente d'autres joueurs…</span>`;
        return;
    }

    container.innerHTML = joueurs.map(j => {
        const pseudo = typeof j === "string" ? j : j.pseudo;
        const equipe = typeof j === "object" ? j.equipe : null;
        const isMe   = pseudo === PlayerState.pseudo;
        return `
            <span class="lobby-joueur-tag ${isMe ? "lobby-joueur-moi" : ""}">
                <span class="lobby-joueur-avatar">${pseudo.charAt(0).toUpperCase()}</span>
                ${esc(pseudo)}
                ${equipe ? `<small>🛡️ ${esc(equipe)}</small>` : ""}
                ${isMe ? `<span class="lobby-moi-badge">Moi</span>` : ""}
            </span>`;
    }).join("");
}

// ======================================================
// 🏁 RÉSULTATS
// ======================================================

function renderResultats(scores) {
    const container = $("p-results-content");
    if (!container) return;

    const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const medals  = ["🥇","🥈","🥉"];

    if (entries.length === 0) {
        container.innerHTML = `<p class="list-empty">Aucun score disponible.</p>`;
        return;
    }

    container.innerHTML = entries.map(([nom, pts], i) => {
        const isMe = nom === PlayerState.pseudo || nom === PlayerState.equipe;
        return `
            <div class="result-row ${i===0?"result-winner":""} ${isMe?"result-me":""}">
                <span>${medals[i] || `${i+1}.`}</span>
                <span>${esc(nom)}</span>
                <span>${pts} pts</span>
            </div>`;
    }).join("");
}

// ======================================================
// ❗ ERREUR FORM
// ======================================================

function showError(msg) {
    const el = $("p-join-error");
    if (el) { el.textContent = msg; el.hidden = false; }
}

function hideError() {
    const el = $("p-join-error");
    if (el) el.hidden = true;
}

// ======================================================
// 🔄 BOUTON REJOUER
// ======================================================

function initRejouer() {
    $("p-btn-rejouer")?.addEventListener("click", () => {
        PlayerState.pseudo    = null;
        PlayerState.partieId  = null;
        PlayerState.equipe    = null;
        PlayerState.score     = 0;
        PlayerState.connected = false;
        chargerParties();
        showScreen("player-join");
    });
}

// ======================================================
// 🚀 INIT
// ======================================================

document.addEventListener("DOMContentLoaded", () => {
    initJoinForm();
    initSocketEvents();
    initRejouer();

    socket.connect(WS_URL);

    chargerParties();

    showScreen("player-join");

    console.log("[PLAYER] 🎮 v3 initialisé");
});

window.PlayerState = PlayerState;