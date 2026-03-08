// /public/js/main.js
// ======================================================
// 🚀 MAIN.JS — Accueil & Orchestrateur
// ======================================================

import { $, $$, show, hide, fadeIn, fadeOut } from "./core/dom.js";
import { GameState } from "./core/state.js";

// ======================================================
// ⚙️ CONFIG GLOBALE
// ======================================================

export const APP_CONFIG = {
    version: "3.0.0",
    appName: "MiniGame Universe",
    wsUrl: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
    routes: {
        host: "/host/",
        join: "/join/",
        main: "/main/",
    },
    jeux: [
        {
            id: "quiz", icon: "❓", nom: "Quiz",
            desc: "Questions & réponses sur des thèmes variés.",
            regles: "Le host pose des questions, les joueurs répondent. Des indices peuvent être donnés progressivement. 1 pt par bonne réponse.",
            joueurs: "2–20", duree: "15–30 min", difficulte: "⭐⭐"
        },
        {
            id: "justeprix", icon: "💰", nom: "Juste Prix",
            desc: "Devine le prix d'un produit.",
            regles: "Le host affiche un produit, les joueurs estiment son prix. Plus tu es proche, plus tu marques de points.",
            joueurs: "2–15", duree: "10–20 min", difficulte: "⭐"
        },
        {
            id: "undercover", icon: "🕵️", nom: "Undercover",
            desc: "Déniche l'espion parmi les joueurs.",
            regles: "Chaque joueur reçoit un mot. Un espion a un mot différent. Décrivez votre mot sans le dire, puis votez pour éliminer l'espion.",
            joueurs: "4–12", duree: "10–20 min", difficulte: "⭐⭐⭐"
        },
        {
            id: "lml", icon: "📖", nom: "Maxi Lettres",
            desc: "Forme le mot le plus long possible.",
            regles: "Un tirage de lettres est révélé. Chaque joueur forme le mot le plus long en utilisant ces lettres. Le plus long mot valide gagne.",
            joueurs: "2–10", duree: "10–15 min", difficulte: "⭐⭐"
        },
        {
            id: "mimer", icon: "🎭", nom: "Mimer/Dessiner",
            desc: "Fais deviner un mot sans parler.",
            regles: "Le joueur actif mime ou dessine un mot. Son équipe doit deviner avant la fin du chrono. 1 pt par bonne réponse.",
            joueurs: "4–20", duree: "15–25 min", difficulte: "⭐"
        },
        {
            id: "pendu", icon: "🪢", nom: "Le Pendu",
            desc: "Devine le mot lettre par lettre.",
            regles: "Proposez des lettres pour révéler un mot secret. Chaque erreur rapproche la défaite. Trouvez le mot avant d'épuiser vos essais.",
            joueurs: "2–10", duree: "5–15 min", difficulte: "⭐⭐"
        },
        {
            id: "petitbac", icon: "📝", nom: "Petit Bac",
            desc: "Une lettre, tous les thèmes.",
            regles: "Une lettre est tirée. Remplissez un maximum de catégories (prénom, pays, animal…) avec des mots commençant par cette lettre.",
            joueurs: "2–15", duree: "10–20 min", difficulte: "⭐⭐"
        },
        {
            id: "memoire", icon: "🧠", nom: "Mémoire Flash",
            desc: "Mémorise des séquences rapidement.",
            regles: "Une séquence est affichée brièvement. Mémorisez-la et reproduisez-la exactement. La difficulté augmente à chaque manche.",
            joueurs: "1–10", duree: "10–20 min", difficulte: "⭐⭐⭐"
        },
        {
            id: "morpion", icon: "⭕", nom: "Morpion",
            desc: "Aligne 3 symboles pour gagner.",
            regles: "À tour de rôle, placez votre symbole sur la grille 3×3. Le premier à aligner 3 symboles en ligne, colonne ou diagonale gagne.",
            joueurs: "2–4", duree: "5–10 min", difficulte: "⭐"
        },
        {
            id: "puissance4", icon: "🔴", nom: "Puissance 4",
            desc: "Aligne 4 jetons avant l'adversaire.",
            regles: "À tour de rôle, faites tomber un jeton dans une colonne. Alignez 4 jetons de votre couleur horizontalement, verticalement ou en diagonale.",
            joueurs: "2–4", duree: "5–15 min", difficulte: "⭐⭐"
        },
    ],
    theme: {
        default: "dark",
        storageKey: "mgu_theme"
    }
};

// ======================================================
// 🌍 ÉTAT DE L'APPLI
// ======================================================

export const AppState = {
    initialized: false,
    currentScreen: "home",
    theme: localStorage.getItem(APP_CONFIG.theme.storageKey) || APP_CONFIG.theme.default,
    isOnline: navigator.onLine,
};

// ======================================================
// 🎨 THÈME
// ======================================================

export function setTheme(theme) {
    AppState.theme = theme;
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(APP_CONFIG.theme.storageKey, theme);
}

// ======================================================
// 🔔 TOASTS
// ======================================================

let _toastContainer = null;

export function showToast(message, type = "info", duration = 3000) {
    if (!_toastContainer) {
        _toastContainer = document.getElementById("toast-container");
        if (!_toastContainer) {
            _toastContainer = document.createElement("div");
            _toastContainer.id = "toast-container";
            _toastContainer.className = "toast-container";
            document.body.appendChild(_toastContainer);
        }
    }
    const icons = { info: "ℹ️", success: "✅", error: "❌", warning: "⚠️" };
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${icons[type] || "ℹ️"}</span><span>${_esc(message)}</span>`;
    _toastContainer.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("toast-visible"));
    setTimeout(() => {
        toast.classList.remove("toast-visible");
        toast.classList.add("toast-hiding");
        setTimeout(() => toast.remove(), 400);
    }, duration);
}

// ======================================================
// 🧭 NAVIGATION ENTRE ÉCRANS
// ======================================================

const SCREENS = ["screen-home", "screen-jeux", "screen-parties", "screen-jeu-detail"];

export function afficherEcran(id, opts = {}) {
    SCREENS.forEach(s => {
        const el = document.getElementById(s);
        if (el) el.hidden = true;
    });
    const target = document.getElementById(id);
    if (target) {
        target.hidden = false;
        target.classList.remove("animate-in");
        void target.offsetWidth;
        target.classList.add("animate-in");
    }
    AppState.currentScreen = id;

    // Breadcrumb
    const bc = document.getElementById("topbar-breadcrumb");
    const labels = {
        "screen-home":       "",
        "screen-jeux":       "🎮 Les Jeux",
        "screen-parties":    "📋 Continuer une partie",
        "screen-jeu-detail": opts.breadcrumb || "🎮 Détail",
    };
    if (bc) {
        bc.innerHTML = labels[id]
            ? `<button class="breadcrumb-back" id="breadcrumb-back-btn">← Retour</button>
               <span class="breadcrumb-sep">/</span>
               <span class="breadcrumb-label">${labels[id]}</span>`
            : "";
        document.getElementById("breadcrumb-back-btn")?.addEventListener("click", () => {
            afficherEcran("screen-home");
        });
    }
    fermerMenu();
}

// ======================================================
// 🗂️ NAVIGATION INTER-PAGES
// ======================================================

export function naviguerPage(page, params = {}) {
    const base = APP_CONFIG.routes[page];
    if (!base) return;
    const url = new URL(base, location.origin);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    location.href = url.toString();
}

// ======================================================
// 🃏 ÉCRAN JEUX — Liste + Détail
// ======================================================

function renderJeuxList() {
    const container = document.getElementById("jeux-grid");
    if (!container) return;

    container.innerHTML = APP_CONFIG.jeux.map(j => `
        <button class="jeu-card" data-jeu="${j.id}" aria-label="${j.nom}">
            <span class="jeu-icon">${j.icon}</span>
            <span class="jeu-name">${j.nom}</span>
            <span class="jeu-desc">${j.desc}</span>
            <div class="jeu-meta">
                <span class="jeu-meta-item">👥 ${j.joueurs}</span>
                <span class="jeu-meta-item">⏱ ${j.duree}</span>
            </div>
        </button>
    `).join("");

    container.querySelectorAll(".jeu-card").forEach(btn => {
        btn.addEventListener("click", () => {
            const jeu = APP_CONFIG.jeux.find(j => j.id === btn.dataset.jeu);
            if (jeu) afficherDetailJeu(jeu);
        });
    });
}

function afficherDetailJeu(jeu) {
    const container = document.getElementById("jeu-detail-content");
    if (!container) return;

    container.innerHTML = `
        <div class="detail-hero">
            <span class="detail-icon">${jeu.icon}</span>
            <h2 class="detail-nom">${jeu.nom}</h2>
            <p class="detail-desc">${jeu.desc}</p>
        </div>
        <div class="detail-infos">
            <div class="detail-info-item">
                <span class="detail-info-label">Joueurs</span>
                <span class="detail-info-val">👥 ${jeu.joueurs}</span>
            </div>
            <div class="detail-info-item">
                <span class="detail-info-label">Durée</span>
                <span class="detail-info-val">⏱ ${jeu.duree}</span>
            </div>
            <div class="detail-info-item">
                <span class="detail-info-label">Difficulté</span>
                <span class="detail-info-val">${jeu.difficulte}</span>
            </div>
        </div>
        <div class="detail-regles">
            <h3>📜 Règles</h3>
            <p>${jeu.regles}</p>
        </div>
        <div class="detail-actions">
            <button class="btn-primary btn-hero" id="btn-detail-host" data-jeu="${jeu.id}">
                🚀 Créer une partie
            </button>
            <button class="btn-ghost" id="btn-detail-back">
                ← Tous les jeux
            </button>
        </div>
    `;

    document.getElementById("btn-detail-host")?.addEventListener("click", () => {
        naviguerPage("host", { jeu: jeu.id });
    });
    document.getElementById("btn-detail-back")?.addEventListener("click", () => {
        afficherEcran("screen-jeux");
    });

    afficherEcran("screen-jeu-detail", { breadcrumb: `${jeu.icon} ${jeu.nom}` });
}

// ======================================================
// 📋 ÉCRAN CONTINUER UNE PARTIE
// ======================================================

function renderPartiesContinuer() {
    const container = document.getElementById("parties-continuer-list");
    if (!container) return;

    const parties = getParties();

    if (parties.length === 0) {
        container.innerHTML = `
            <div class="parties-vide">
                <span class="parties-vide-icon">📭</span>
                <p>Aucune partie enregistrée.</p>
                <button class="btn-primary" id="btn-vide-nouvelle">🚀 Créer une partie</button>
            </div>`;
        document.getElementById("btn-vide-nouvelle")?.addEventListener("click", () => {
            naviguerPage("host");
        });
        return;
    }

    container.innerHTML = parties.slice().reverse().map((p, i) => {
        const date = p.createdAt
            ? new Date(p.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })
            : "—";
        const jeuInfo = APP_CONFIG.jeux.find(j => j.id === p.jeu);
        return `
            <div class="partie-continue-card" data-index="${parties.length - 1 - i}">
                <div class="partie-continue-icon">${jeuInfo?.icon || "🎮"}</div>
                <div class="partie-continue-info">
                    <div class="partie-continue-nom">${_esc(p.nom || p.nomPartie || "Partie sans nom")}</div>
                    <div class="partie-continue-meta">
                        <span>${jeuInfo?.nom || p.jeu || "—"}</span>
                        <span>·</span>
                        <span>${p.mode === "team" ? "🛡️ Équipes" : "👤 Solo"}</span>
                        <span>·</span>
                        <span>${date}</span>
                    </div>
                    <div class="partie-continue-joueurs">
                        ${(p.joueurs || []).slice(0, 5).map(j =>
                            `<span class="pc-joueur-chip">${_esc(typeof j === "string" ? j : j.pseudo || "")}</span>`
                        ).join("")}
                        ${(p.joueurs || []).length > 5 ? `<span class="pc-joueur-chip pc-joueur-more">+${p.joueurs.length - 5}</span>` : ""}
                    </div>
                </div>
                <div class="partie-continue-actions">
                    <button class="btn-primary btn-sm btn-charger" data-id="${p.id || p.partieId || i}" title="Charger">
                        ▶ Charger
                    </button>
                    <button class="btn-ghost btn-sm btn-suppr" data-id="${p.id || p.partieId || i}" title="Supprimer">
                        🗑
                    </button>
                </div>
            </div>
        `;
    }).join("");

    // Charger → aller vers /join avec les infos de la partie
    container.querySelectorAll(".btn-charger").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.dataset.id;
            const partie = parties.find(p => String(p.id || p.partieId) === String(id))
                || parties[parseInt(id)];
            if (!partie) return;

            // Stocker la partie à charger pour la page join
            sessionStorage.setItem("mgu_partie_a_charger", JSON.stringify(partie));
            naviguerPage("join", { partieId: partie.partieId || partie.id, mode: "continue" });
        });
    });

    container.querySelectorAll(".btn-suppr").forEach(btn => {
        btn.addEventListener("click", () => {
            if (!confirm("Supprimer cette partie ?")) return;
            const id = btn.dataset.id;
            supprimerPartie(id);
            renderPartiesContinuer();
            chargerStats();
            showToast("Partie supprimée.", "info", 2000);
        });
    });
}

// ======================================================
// 💾 LOCALSTORAGE
// ======================================================

function getParties() {
    try { return JSON.parse(localStorage.getItem("mgu_parties") || "[]"); } catch { return []; }
}

function supprimerPartie(id) {
    const parties = getParties().filter(p =>
        String(p.id || p.partieId) !== String(id)
    );
    localStorage.setItem("mgu_parties", JSON.stringify(parties));
}

function getJoueurs() {
    try { return JSON.parse(localStorage.getItem("mgu_joueurs") || "[]"); } catch { return []; }
}

// ======================================================
// 📊 STATS
// ======================================================

function chargerStats() {
    const parties = getParties();
    const joueurs = getJoueurs();
    let totalPoints = 0;
    parties.forEach(p => {
        Object.values(p.scores || {}).forEach(v => { totalPoints += (v || 0); });
    });
    const elP  = document.getElementById("stat-parties");
    const elJ  = document.getElementById("stat-joueurs");
    const elPt = document.getElementById("stat-points");
    if (elP)  elP.textContent  = parties.length;
    if (elJ)  elJ.textContent  = joueurs.length;
    if (elPt) elPt.textContent = totalPoints;
}

// ======================================================
// 🍔 MENU
// ======================================================

function ouvrirMenu() {
    const panel   = document.getElementById("menu-panel");
    const overlay = document.getElementById("menu-overlay");
    if (panel)   panel.hidden   = false;
    if (overlay) overlay.hidden = false;
}

function fermerMenu() {
    const panel   = document.getElementById("menu-panel");
    const overlay = document.getElementById("menu-overlay");
    if (panel)   panel.hidden   = true;
    if (overlay) overlay.hidden = true;
}

// ======================================================
// 🔒 PRIVÉ
// ======================================================

function _esc(str) {
    return String(str || "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ======================================================
// 🚀 INIT
// ======================================================

document.addEventListener("DOMContentLoaded", () => {
    setTheme(AppState.theme);

    // ── Stats bar ──
    chargerStats();

    // ── Render listes ──
    renderJeuxList();

    // ── Accueil — Boutons CTA ──
    document.getElementById("btn-go-host")?.addEventListener("click", () => naviguerPage("host"));
    document.getElementById("btn-voir-jeux")?.addEventListener("click", () => afficherEcran("screen-jeux"));
    document.getElementById("btn-continuer")?.addEventListener("click", () => {
        renderPartiesContinuer();
        afficherEcran("screen-parties");
    });

    // ── Menu ──
    document.getElementById("btn-menu-permanent")?.addEventListener("click", ouvrirMenu);
    document.getElementById("btn-close-menu")?.addEventListener("click", fermerMenu);
    document.getElementById("menu-overlay")?.addEventListener("click", fermerMenu);

    document.getElementById("menu-btn-host")?.addEventListener("click", () => naviguerPage("host"));
    document.getElementById("menu-btn-join")?.addEventListener("click", () => naviguerPage("join"));
    document.getElementById("menu-btn-jeux")?.addEventListener("click", () => {
        afficherEcran("screen-jeux");
    });
    document.getElementById("menu-btn-parties")?.addEventListener("click", () => {
        renderPartiesContinuer();
        afficherEcran("screen-parties");
    });

    // ── Logo ──
    document.querySelectorAll(".topbar-logo").forEach(el => {
        el.addEventListener("click", e => {
            e.preventDefault();
            afficherEcran("screen-home");
        });
    });

    // ── Écran initial ──
    afficherEcran("screen-home");

    // ── Online/Offline ──
    window.addEventListener("online",  () => document.getElementById("offline-banner")?.setAttribute("hidden", ""));
    window.addEventListener("offline", () => document.getElementById("offline-banner")?.removeAttribute("hidden"));

    AppState.initialized = true;
    document.body.classList.add("app-ready");
    console.log("[MAIN] ✅ Accueil v3 initialisé");
});

window.showToast = showToast;
window.naviguerPage = naviguerPage;
window.AppConfig = APP_CONFIG;