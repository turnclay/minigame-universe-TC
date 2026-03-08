// /public/js/host.js
// ======================================================
// 🟦 HOST.JS — Interface maître de jeu
// ======================================================

import { socket } from "./core/socket.js";
import { APP_CONFIG, showToast } from "./main.js";

// ── Helpers DOM ─────────────────────────────────────
const $  = id  => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);
const show = id  => { const el = $(id); if (el) el.hidden = false; };
const hide = id  => { const el = $(id); if (el) el.hidden = true; };
const esc  = str => String(str || "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");

// ── URL WebSocket ────────────────────────────────────
const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

// ======================================================
// 🗂️ STATE LOCAL DU HOST
// ======================================================

const HostState = {
    partieId:   null,
    partieNom:  null,
    jeu:        null,
    mode:       "solo",      // "solo" | "team"
    equipes:    [],          // [{ nom, membres: [] }]
    joueursSolo: [],         // joueurs ajoutés manuellement en mode solo
    joueurs:    [],          // joueurs connectés via WS [{ pseudo, equipe }]
    scores:     {},          // { nom: points }
    statut:     null,        // "lobby" | "en_cours" | "terminee"
    hostJoue:   false,       // Le host participe-t-il ?
    hostPseudo: null,        // Pseudo du host s'il joue
    partieActive: false,     // Une partie est-elle déjà créée ?
};

// ======================================================
// 🔌 INDICATEUR DE CONNEXION WS
// ======================================================

function initSocketStatus() {
    const dot   = $("ws-dot");
    const label = $("ws-label");

    socket.on("__connected__", () => {
        if (dot)   dot.className   = "ws-dot ws-ok";
        if (label) label.textContent = "Connecté";
        // Authentification automatique (sans mot de passe)
        socket.send("HOST_AUTH", {});
    });

    socket.on("__disconnected__", () => {
        if (dot)   dot.className   = "ws-dot ws-ko";
        if (label) label.textContent = "Déconnecté — reconnexion…";
    });

    socket.on("__reconnect_failed__", () => {
        if (dot)   dot.className   = "ws-dot ws-ko";
        if (label) label.textContent = "Connexion perdue";
        showToast("Connexion au serveur perdue. Rechargez la page.", "error", 6000);
    });
}

// ======================================================
// 🔐 AUTHENTIFICATION AUTOMATIQUE (sans mot de passe)
// ======================================================

function initAuth() {
    socket.on("AUTH_OK", () => {
        console.log("[HOST] ✅ Authentifié comme host");
        showToast("Connecté en tant que host", "success", 2000);
    });

    socket.on("AUTH_FAIL", ({ error }) => {
        console.error("[HOST] Auth échouée:", error);
        showToast(error || "Authentification échouée", "error");
    });
}

// ======================================================
// 🎮 MODE DE JEU — TOGGLE
// ======================================================

function initModeToggle() {
    const btnSolo   = $("btn-mode-solo");
    const btnEquipe = $("btn-mode-equipes");

    const setMode = (mode) => {
        HostState.mode = mode;
        btnSolo.classList.toggle("mode-btn-active",   mode === "solo");
        btnEquipe.classList.toggle("mode-btn-active", mode === "team");

        if (mode === "solo") {
            show("bloc-solo");
            hide("bloc-equipes");
        } else {
            hide("bloc-solo");
            show("bloc-equipes");
        }
    };

    btnSolo?.addEventListener("click",   () => setMode("solo"));
    btnEquipe?.addEventListener("click", () => setMode("team"));

    setMode("solo"); // Défaut
}

// ======================================================
// 👤 HOST JOUE — TOGGLE
// ======================================================

function initHostRoleToggle() {
    const checkbox  = $("h-host-joue");
    const pseudoWrap = $("h-host-pseudo-wrap");

    checkbox?.addEventListener("change", () => {
        HostState.hostJoue = checkbox.checked;
        if (pseudoWrap) pseudoWrap.hidden = !checkbox.checked;
    });
}

// ======================================================
// 👥 GESTION DES JOUEURS (mode solo — ajout manuel)
// ======================================================

function initJoueursSolo() {
    const input  = $("h-joueur-input");
    const btnAdd = $("h-joueur-ajouter");

    const ajouter = () => {
        const nom = input?.value.trim();
        if (!nom) return;

        if (HostState.joueursSolo.includes(nom)) {
            showToast("Ce joueur existe déjà.", "warning"); return;
        }

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
        container.innerHTML = `<p class="list-empty">Aucun joueur ajouté — les joueurs peuvent rejoindre via le lien</p>`;
        return;
    }

    container.innerHTML = HostState.joueursSolo.map((j, i) => `
        <div class="joueur-tag">
            <span class="joueur-tag-avatar">${j.charAt(0).toUpperCase()}</span>
            <span class="joueur-tag-nom">${esc(j)}</span>
            <button class="btn-remove" data-i="${i}" title="Retirer">×</button>
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
// 🛡️ GESTION DES ÉQUIPES (mode team)
// ======================================================

function initEquipes() {
    const input  = $("h-equipe-input");
    const btnAdd = $("h-equipe-ajouter");

    const ajouter = () => {
        const nom = input?.value.trim();
        if (!nom) return;

        if (HostState.equipes.some(e => e.nom.toLowerCase() === nom.toLowerCase())) {
            showToast("Ce nom d'équipe existe déjà.", "warning"); return;
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
                <span class="equipe-form-icon">🛡️</span>
                <span class="equipe-form-nom">${esc(eq.nom)}</span>
                <button class="btn-remove btn-del-equipe" data-i="${i}" title="Supprimer">×</button>
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
// 🚀 CRÉATION DE PARTIE
// ======================================================

function initCreerPartie() {
    $("h-btn-creer")?.addEventListener("click", () => {
        // Vérification : partie déjà active
        if (HostState.partieActive) {
            showToast("Terminez la partie en cours avant d'en créer une nouvelle.", "warning");
            show("alerte-partie-active");
            return;
        }

        const nom  = $("h-nom-partie")?.value.trim();
        const jeu  = $("h-jeu")?.value;
        const mode = HostState.mode;

        if (!nom) { showToast("Donnez un nom à la partie.", "warning"); return; }

        if (mode === "team" && HostState.equipes.length < 2) {
            showToast("Il faut au moins 2 équipes.", "warning"); return;
        }

        // Pseudo du host s'il joue
        let hostPseudo = null;
        if (HostState.hostJoue) {
            hostPseudo = $("h-host-pseudo")?.value.trim();
            if (!hostPseudo) { showToast("Entrez votre pseudo pour jouer.", "warning"); return; }
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
// 📡 ÉVÉNEMENTS WEBSOCKET ENTRANTS
// ======================================================

function initSocketEvents() {

    // ── Partie créée ─────────────────────────────────
    socket.on("GAME_CREATED", ({ partieId, snapshot }) => {
        HostState.partieId    = partieId;
        HostState.partieActive = true;
        applySnapshot(snapshot);

        show("panel-game");
        hide("alerte-partie-active");
        renderGamePanel();

        showToast(`Partie "${HostState.partieNom}" créée !`, "success");
        console.log("[HOST] Partie créée :", partieId);
    });

    // ── Joueur rejoint ────────────────────────────────
    socket.on("PLAYER_JOINED", ({ pseudo, equipe, joueurs }) => {
        HostState.joueurs = joueurs;
        renderJoueursConnectes();
        renderScores();
        showToast(`${pseudo} a rejoint la partie`, "info", 2000);
    });

    // ── Joueur parti ──────────────────────────────────
    socket.on("PLAYER_LEFT", ({ pseudo, joueurs }) => {
        HostState.joueurs = joueurs;
        renderJoueursConnectes();
        showToast(`${pseudo} a quitté la partie`, "warning", 2000);
    });

    // ── Scores mis à jour ─────────────────────────────
    socket.on("SCORES_UPDATE", ({ scores }) => {
        HostState.scores = scores;
        renderScores();
    });

    // ── Partie démarrée ───────────────────────────────
    socket.on("GAME_STARTED", ({ snapshot }) => {
        applySnapshot(snapshot);
        HostState.statut = "en_cours";

        _setStatutBadge("en_cours");
        hide("h-btn-start");
        show("h-btn-end");

        showToast("La partie est lancée !", "success");
    });

    // ── Partie terminée ───────────────────────────────
    socket.on("GAME_ENDED", ({ snapshot }) => {
        applySnapshot(snapshot);
        HostState.statut = "terminee";
        HostState.partieActive = false;

        _setStatutBadge("terminee");
        hide("h-btn-end");
        show("h-btn-nouvelle");

        renderResultats();
        showToast("Partie terminée !", "info");
    });

    // ── Actions joueurs ───────────────────────────────
    socket.on("PLAYER_ACTION", ({ pseudo, equipe, action }) => {
        console.log("[HOST] Action joueur :", pseudo, action);
        if (typeof window.onPlayerAction === "function") {
            window.onPlayerAction({ pseudo, equipe, action });
        }
    });

    // ── Erreurs serveur ───────────────────────────────
    socket.on("ERROR", ({ code }) => {
        const messages = {
            NOT_HOST:       "Accès refusé.",
            NO_ACTIVE_GAME: "Aucune partie active.",
            MISSING_FIELDS: "Données manquantes.",
            GAME_EXISTS:    "Une partie est déjà en cours sur ce serveur.",
        };
        const msg = messages[code] || `Erreur serveur (${code})`;
        showToast(msg, "error");
        console.error("[HOST] Erreur serveur :", code);
    });
}

// ======================================================
// 🎮 CONTRÔLES DE LA PARTIE
// ======================================================

function initControles() {
    // Démarrer
    $("h-btn-start")?.addEventListener("click", () => {
        if (!HostState.partieId) return;
        socket.send("HOST_START_GAME", {});
    });

    // Terminer
    $("h-btn-end")?.addEventListener("click", () => {
        if (!confirm("Terminer la partie ?")) return;
        socket.send("HOST_END_GAME", {});
    });

    // Nouvelle partie (après fin)
    $("h-btn-nouvelle")?.addEventListener("click", () => {
        // Reset state
        HostState.partieId    = null;
        HostState.partieNom   = null;
        HostState.jeu         = null;
        HostState.joueurs     = [];
        HostState.scores      = {};
        HostState.statut      = null;
        HostState.partieActive = false;

        // Reset UI
        hide("panel-game");
        hide("h-btn-nouvelle");
        hide("alerte-partie-active");
        show("h-btn-start");

        // Vider le formulaire
        const nomInput = $("h-nom-partie");
        if (nomInput) nomInput.value = "";

        showToast("Prêt pour une nouvelle partie !", "info");
    });

    // Copier le lien
    $("h-btn-copy")?.addEventListener("click", () => {
        const link = $("h-join-link");
        if (!link?.href) return;
        navigator.clipboard.writeText(link.href)
            .then(() => showToast("Lien copié !", "success", 1500))
            .catch(() => showToast("Copie impossible", "error"));
    });
}

// ======================================================
// 🎨 RENDU UI
// ======================================================

function renderGamePanel() {
    const joinUrl = `${location.origin}/join/?partieId=${HostState.partieId}`;

    // Infos
    const infoNom  = $("h-info-nom");
    const infoJeu  = $("h-info-jeu");
    const infoMode = $("h-info-mode");
    if (infoNom)  infoNom.textContent  = HostState.partieNom || "—";
    if (infoJeu)  infoJeu.textContent  = (HostState.jeu || "—").toUpperCase();
    if (infoMode) infoMode.textContent = HostState.mode === "team" ? "🛡️ Équipes" : "👤 Solo";

    _setStatutBadge("lobby");

    // Lien
    const link = $("h-join-link");
    if (link) { link.href = joinUrl; link.textContent = joinUrl; }

    // QR Code
    _renderQR(joinUrl);

    // Afficher le bon bloc (joueurs ou équipes)
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

    // Compteur
    if (counter) counter.textContent = HostState.joueurs.length;

    if (HostState.mode === "team") {
        // Affichage par équipes
        const equipesCont = $("h-equipes-connectees");
        const nbEquipes   = $("h-nb-equipes");

        const equipesAvecMembres = {};
        HostState.equipes.forEach(eq => { equipesAvecMembres[eq.nom] = []; });
        HostState.joueurs.forEach(j => {
            const eq = j.equipe || "Sans équipe";
            if (!equipesAvecMembres[eq]) equipesAvecMembres[eq] = [];
            equipesAvecMembres[eq].push(j.pseudo);
        });

        const nbEq = Object.keys(equipesAvecMembres).length;
        if (nbEquipes) nbEquipes.textContent = nbEq;

        if (equipesCont) {
            equipesCont.innerHTML = Object.entries(equipesAvecMembres).map(([nom, membres]) => `
                <div class="equipe-connectee-card">
                    <div class="equipe-connectee-header">
                        <span class="equipe-connectee-icon">🛡️</span>
                        <span class="equipe-connectee-nom">${esc(nom)}</span>
                        <span class="equipe-connectee-count">${membres.length} joueur${membres.length > 1 ? "s" : ""}</span>
                    </div>
                    <div class="equipe-connectee-membres">
                        ${membres.length > 0
                            ? membres.map(m => `
                                <span class="membre-chip">
                                    <span class="membre-avatar">${m.charAt(0).toUpperCase()}</span>
                                    ${esc(m)}
                                </span>`).join("")
                            : `<span class="membre-empty">Aucun joueur</span>`
                        }
                    </div>
                </div>
            `).join("") || `<p class="list-empty">En attente de joueurs…</p>`;
        }
        return;
    }

    // Mode solo
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
        container.innerHTML = `<p class="list-empty">Aucun score pour l'instant</p>`;
        return;
    }

    const max    = entries[0]?.[1] || 1;
    const medals = ["🥇", "🥈", "🥉"];

    container.innerHTML = entries.map(([nom, pts], i) => {
        const pct = max > 0 ? Math.round((pts / max) * 100) : 0;
        return `
            <div class="score-row">
                <span class="score-medal">${medals[i] || `${i + 1}.`}</span>
                <span class="score-nom">${esc(nom)}</span>
                <div class="score-bar-wrap">
                    <div class="score-bar" style="width: ${pct}%"></div>
                </div>
                <span class="score-pts">${pts} <small>pts</small></span>
                <div class="score-actions">
                    <button class="btn-pts btn-plus"  data-cible="${esc(nom)}" data-delta="1"  title="+1">＋</button>
                    <button class="btn-pts btn-minus" data-cible="${esc(nom)}" data-delta="-1" title="-1">－</button>
                </div>
            </div>
        `;
    }).join("");

    container.querySelectorAll(".btn-pts").forEach(btn => {
        btn.addEventListener("click", () => {
            const delta = parseInt(btn.dataset.delta);
            const cible = btn.dataset.cible;
            const type  = delta > 0 ? "HOST_ADD_POINTS" : "HOST_REMOVE_POINTS";
            socket.send(type, { cible, points: 1 });
        });
    });
}

function renderResultats() {
    const entries = Object.entries(HostState.scores).sort((a, b) => b[1] - a[1]);
    const medals  = ["🥇", "🥈", "🥉"];

    const html = `
        <div class="resultats-finaux">
            <h3 class="resultats-titre">🏁 Résultats finaux</h3>
            ${entries.map(([nom, pts], i) => `
                <div class="resultat-row ${i === 0 ? "resultat-winner" : ""}">
                    <span class="resultat-medal">${medals[i] || `${i + 1}.`}</span>
                    <span class="resultat-nom">${esc(nom)}</span>
                    <span class="resultat-pts">${pts} pts</span>
                </div>
            `).join("")}
        </div>
    `;

    const scoresSection = $("h-scores-liste");
    if (scoresSection) {
        scoresSection.insertAdjacentHTML("afterend", html);
    }
}

// ── QR Code ──────────────────────────────────────────
function _renderQR(url) {
    const container = $("h-qr");
    if (!container) return;

    // Utiliser une API QR simple (compatible sans lib externe)
    const size = 120;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}&bgcolor=1a1a2e&color=00d4ff&margin=2`;

    container.innerHTML = `
        <img src="${qrUrl}" alt="QR Code pour rejoindre" class="qr-img"
             onerror="this.closest('.qr-container').innerHTML='<p class=\\'qr-error\\'>QR indisponible</p>'">
    `;
}

// ── Badge statut ──────────────────────────────────────
function _setStatutBadge(statut) {
    const badge = $("h-statut-badge");
    if (!badge) return;

    const map = {
        lobby:     { text: "● Lobby",     cls: "statut-lobby" },
        en_cours:  { text: "● En cours",  cls: "statut-en-cours" },
        terminee:  { text: "● Terminée",  cls: "statut-terminee" },
    };
    const info = map[statut] || map.lobby;
    badge.textContent = info.text;
    badge.className   = `statut-badge ${info.cls}`;
}

// ======================================================
// 🔄 APPLIQUER UN SNAPSHOT SERVEUR
// ======================================================

function applySnapshot(snapshot) {
    if (!snapshot) return;
    HostState.partieId  = snapshot.id      ?? HostState.partieId;
    HostState.partieNom = snapshot.nom     ?? HostState.partieNom;
    HostState.jeu       = snapshot.jeu     ?? HostState.jeu;
    HostState.mode      = snapshot.mode    ?? HostState.mode;
    HostState.equipes   = snapshot.equipes ?? HostState.equipes;
    HostState.scores    = snapshot.scores  ?? HostState.scores;
    HostState.statut    = snapshot.statut  ?? HostState.statut;
    HostState.joueurs   = snapshot.joueurs ?? HostState.joueurs;
}

// ======================================================
// 🚀 INIT
// ======================================================

document.addEventListener("DOMContentLoaded", () => {
    initSocketStatus();
    initAuth();
    initSocketEvents();
    initModeToggle();
    initHostRoleToggle();
    initJoueursSolo();
    initEquipes();
    initCreerPartie();
    initControles();

    // Connexion WebSocket
    socket.connect(WS_URL);

    console.log("[HOST] 🎮 Interface host initialisée");
});

// Exposer l'état pour les modules jeux
window.HostState = HostState;