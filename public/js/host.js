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

// ── URL WebSocket ──────────────────────────────────
const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

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

// =============================================
// 🔌 INDICATEUR DE CONNEXION WS
// =============================================
function initSocketStatus() {
    socket.on("__connected__", () => {
        $("ws-indicator").className = "ws-dot ws-connected";
        $("ws-label").textContent = "Connecté";
    });

    socket.on("__disconnected__", () => {
        $("ws-indicator").className = "ws-dot ws-disconnected";
        $("ws-label").textContent = "Déconnecté — reconnexion…";
    });

    socket.on("__reconnect_failed__", () => {
        $("ws-indicator").className = "ws-dot ws-disconnected";
        $("ws-label").textContent = "Connexion perdue";
    });
}

// =============================================
// 🔐 AUTHENTIFICATION
// =============================================
function initAuth() {
    const btnAuth = $("auth-btn");
    const input   = $("auth-password");

    const tenter = () => {
        const password = input.value;
        if (!password) return;

        if (!socket.connected) {
            afficherErreurAuth("Connexion au serveur en cours, réessaie dans un instant…");
            return;
        }

        // ✅ Utilisation correcte de socket.send(type, payload)
        socket.send("HOST_AUTH", { password });
    };

    btnAuth.onclick = tenter;
    input.onkeydown = e => { if (e.key === "Enter") tenter(); };

    socket.on("AUTH_OK", () => {
        hide("host-auth");
        show("host-lobby");
        initLobby();
    });

    socket.on("AUTH_FAIL", ({ error }) => {
        afficherErreurAuth(error || "Mot de passe incorrect.");
        input.value = "";
        input.focus();
    });
}

function afficherErreurAuth(msg) {
    const errEl = $("auth-error");
    if (!errEl) return;
    errEl.textContent = msg;
    errEl.hidden = false;
    setTimeout(() => { errEl.hidden = true; }, 4000);
}

// =============================================
// 🏠 LOBBY HOST — CRÉATION DE PARTIE
// =============================================
function initLobby() {

    // Toggle bloc équipes selon le mode
    $("h-mode").onchange = () => {
        const isTeam = $("h-mode").value === "team";
        $("h-equipes-bloc").hidden = !isTeam;
    };

    // Ajouter une équipe
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

// =============================================
// 📡 ÉVÉNEMENTS WEBSOCKET ENTRANTS
// =============================================
function initSocketEvents() {

    // ── Partie créée ──────────────────────────────────
    socket.on("GAME_CREATED", ({ partieId, snapshot }) => {
        state.partieId = partieId;
        applySnapshot(snapshot);

        // Afficher le panel de gestion
        show("h-game-panel");
        renderGamePanel();

        console.log("[HOST] Partie créée :", partieId);
    });

    // ── Joueur rejoint ────────────────────────────────
    socket.on("PLAYER_JOINED", ({ pseudo, equipe, joueurs }) => {
        state.joueurs = joueurs;
        renderJoueursHost();

        // Ajouter le score si absent
        const cible = state.mode === "team" ? equipe : pseudo;
        if (cible && !(cible in state.scores)) {
            state.scores[cible] = 0;
            renderScoresHost();
        }
    });

    // ── Joueur parti ──────────────────────────────────
    socket.on("PLAYER_LEFT", ({ pseudo, joueurs }) => {
        state.joueurs = joueurs;
        renderJoueursHost();
    });

    // ── Mise à jour des scores ────────────────────────
    socket.on("SCORES_UPDATE", ({ scores }) => {
        state.scores = scores;
        renderScoresHost();
    });

    // ── Partie démarrée ───────────────────────────────
    socket.on("GAME_STARTED", ({ snapshot }) => {
        applySnapshot(snapshot);
        state.statut = "en_cours";
        hide("h-btn-start");
        show("h-btn-end");
        $("h-info-statut").textContent = "● En cours";
        $("h-info-statut").className = "h-info-statut statut-en-cours";
    });

    // ── Partie terminée ───────────────────────────────
    socket.on("GAME_ENDED", ({ snapshot }) => {
        applySnapshot(snapshot);
        state.statut = "terminee";
        hide("h-btn-end");
        $("h-info-statut").textContent = "● Terminée";
        $("h-info-statut").className = "h-info-statut statut-terminee";
        renderResultats(snapshot);
    });

    // ── Actions joueurs (reçues par le host) ──────────
    socket.on("PLAYER_ACTION", ({ pseudo, equipe, action }) => {
        console.log("[HOST] Action reçue :", pseudo, action);
        // Déléguer à la logique de jeu active si besoin
        if (typeof window.onPlayerAction === "function") {
            window.onPlayerAction({ pseudo, equipe, action });
        }
    });

    // ── Erreurs ───────────────────────────────────────
    socket.on("ERROR", ({ code }) => {
        console.error("[HOST] Erreur serveur :", code);
        const messages = {
            NOT_HOST:       "Accès refusé — non authentifié comme host.",
            NO_ACTIVE_GAME: "Aucune partie active.",
            MISSING_FIELDS: "Données manquantes pour créer la partie.",
        };
        if (messages[code]) alert(messages[code]);
    });
}

// =============================================
// 🎨 RENDU DU PANEL DE JEU
// =============================================
function renderGamePanel() {
    if (!state.partieId) return;

    // Infos partie
    $("h-info-nom").textContent  = state.partieNom || "";
    $("h-info-jeu").textContent  = state.jeu?.toUpperCase() || "";
    $("h-info-statut").textContent = "● Lobby";
    $("h-info-statut").className = "h-info-statut statut-lobby";

    // Lien joueur
    const joinUrl = `${location.origin}/join?partieId=${state.partieId}`;
    const link = $("h-join-link");
    if (link) { link.href = joinUrl; link.textContent = joinUrl; }

    // QR Code (si librairie disponible)
    const qrContainer = $("h-qr");
    if (qrContainer && typeof QRCode !== "undefined") {
        qrContainer.innerHTML = "";
        new QRCode(qrContainer, { text: joinUrl, width: 120, height: 120 });
    }

    renderJoueursHost();
    renderScoresHost();
}

function renderEquipesHost() {
    const liste = $("h-equipes-liste");
    if (!liste) return;

    if (state.equipes.length === 0) {
        liste.innerHTML = `<p class="h-empty">Aucune équipe créée</p>`;
        return;
    }

    liste.innerHTML = state.equipes.map((eq, i) => `
        <div class="h-equipe-tag">
            <span>🛡️ ${esc(eq.nom)}</span>
            <button class="btn-del-equipe" data-i="${i}" title="Supprimer">✖</button>
        </div>
    `).join("");

    liste.querySelectorAll(".btn-del-equipe").forEach(btn => {
        btn.onclick = () => {
            state.equipes.splice(parseInt(btn.dataset.i), 1);
            renderEquipesHost();
        };
    });
}

function renderJoueursHost() {
    const liste  = $("h-joueurs-liste");
    const counter = $("h-nb-joueurs");
    if (!liste) return;

    if (counter) counter.textContent = state.joueurs.length;

    if (state.joueurs.length === 0) {
        liste.innerHTML = `<p class="h-empty">En attente de joueurs…</p>`;
        return;
    }

    liste.innerHTML = state.joueurs.map(j => `
        <div class="h-joueur-item">
            <span class="h-joueur-avatar">${(j.pseudo || "?").charAt(0).toUpperCase()}</span>
            <span class="h-joueur-pseudo">${esc(j.pseudo)}</span>
            ${j.equipe ? `<span class="h-joueur-equipe">🛡️ ${esc(j.equipe)}</span>` : ""}
            <button class="btn-kick" data-pseudo="${esc(j.pseudo)}" title="Expulser">✖</button>
        </div>
    `).join("");

    liste.querySelectorAll(".btn-kick").forEach(btn => {
        btn.onclick = () => {
            if (confirm(`Expulser ${btn.dataset.pseudo} ?`)) {
                socket.send("HOST_KICK_PLAYER", { pseudo: btn.dataset.pseudo });
            }
        };
    });
}

function renderScoresHost() {
    const liste = $("h-scores-liste");
    if (!liste) return;

    const entries = Object.entries(state.scores).sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) {
        liste.innerHTML = `<p class="h-empty">Aucun score pour l'instant</p>`;
        return;
    }

    const max = entries[0]?.[1] || 1;
    const medals = ["🥇", "🥈", "🥉"];

    liste.innerHTML = entries.map(([nom, pts], i) => {
        const pct = max > 0 ? Math.round((pts / max) * 100) : 0;
        return `
            <div class="h-score-row">
                <span class="h-score-medal">${medals[i] || `${i+1}.`}</span>
                <span class="h-score-nom">${esc(nom)}</span>
                <div class="h-score-bar-wrap">
                    <div class="h-score-bar" style="width: ${pct}%"></div>
                </div>
                <span class="h-score-pts">${pts} pts</span>
                <div class="h-score-actions">
                    <button class="btn-pts btn-plus" data-cible="${esc(nom)}" data-delta="1" title="+1">＋</button>
                    <button class="btn-pts btn-minus" data-cible="${esc(nom)}" data-delta="-1" title="-1">－</button>
                </div>
            </div>
        `;
    }).join("");

    // Boutons +/- points
    liste.querySelectorAll(".btn-pts").forEach(btn => {
        btn.onclick = () => {
            const delta = parseInt(btn.dataset.delta);
            const cible = btn.dataset.cible;
            const type  = delta > 0 ? "HOST_ADD_POINTS" : "HOST_REMOVE_POINTS";
            socket.send(type, { cible, points: Math.abs(delta) });
        };
    });
}

function renderResultats(snapshot) {
    // Optionnel : afficher un récapitulatif final dans le panel
    const entries = Object.entries(snapshot?.scores || {}).sort((a, b) => b[1] - a[1]);
    const medals  = ["🥇", "🥈", "🥉"];

    let html = `<div class="h-resultats"><h3>🏁 Résultats finaux</h3>`;
    html += entries.map(([nom, pts], i) =>
        `<div class="h-resultat-row">${medals[i] || `${i+1}.`} <strong>${esc(nom)}</strong> — ${pts} pts</div>`
    ).join("");
    html += `</div>`;

    // Ajouter après les scores
    const scoresSection = $("h-scores-liste");
    if (scoresSection) scoresSection.insertAdjacentHTML("afterend", html);
}

// =============================================
// 🔄 APPLIQUER UN SNAPSHOT SERVEUR
// =============================================
function applySnapshot(snapshot) {
    if (!snapshot) return;
    state.partieId  = snapshot.id    ?? state.partieId;
    state.partieNom = snapshot.nom   ?? state.partieNom;
    state.jeu       = snapshot.jeu   ?? state.jeu;
    state.mode      = snapshot.mode  ?? state.mode;
    state.equipes   = snapshot.equipes ?? state.equipes;
    state.scores    = snapshot.scores  ?? state.scores;
    state.statut    = snapshot.statut  ?? state.statut;
    state.joueurs   = snapshot.joueurs ?? state.joueurs;
}

// =============================================
// 🚀 INIT
// =============================================
document.addEventListener("DOMContentLoaded", () => {
    initSocketStatus();
    initSocketEvents();
    socket.connect(WS_URL);
    initAuth();
});