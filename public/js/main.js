// /public/js/main.js
// ======================================================
// 🚀 MAIN.JS — Point d'entrée & orchestrateur global
// ======================================================

import { $, show, hide, fadeIn, fadeOut } from "./core/dom.js";
import { GameState } from "./core/state.js";
import { socket } from "./core/socket.js";

// ======================================================
// ⚙️ CONFIGURATION GLOBALE
// ======================================================

export const APP_CONFIG = {
    version: "2.0.0",
    appName: "MiniGame Universe",
    wsUrl: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
    routes: {
        host:   "/host/",
        join:   "/join/",
        main:   "/main/",
    },
    // Jeux disponibles
    jeux: [
        { id: "quiz",       icon: "❓", nom: "Quiz",           desc: "Questions & réponses" },
        { id: "justeprix",  icon: "💰", nom: "Juste Prix",     desc: "Devine les prix" },
        { id: "undercover", icon: "🕵️", nom: "Undercover",     desc: "Déniche l'espion" },
        { id: "lml",        icon: "📖", nom: "Maxi Lettres",   desc: "Mot le plus long" },
        { id: "mimer",      icon: "🎭", nom: "Mimer/Dessiner", desc: "Fais deviner !" },
        { id: "pendu",      icon: "🪢", nom: "Le Pendu",       desc: "Devine le mot" },
        { id: "petitbac",   icon: "📝", nom: "Petit Bac",      desc: "Une lettre, tous les thèmes" },
        { id: "memoire",    icon: "🧠", nom: "Mémoire Flash",  desc: "Mémorise vite !" },
        { id: "morpion",    icon: "⭕", nom: "Morpion",        desc: "2-4 joueurs" },
        { id: "puissance4", icon: "🔴", nom: "Puissance 4",    desc: "Aligne 4 jetons" },
    ],
    theme: {
        default: "dark",
        storageKey: "mgu_theme"
    }
};

// ======================================================
// 🌍 ÉTAT GLOBAL DE L'APPLICATION
// ======================================================

export const AppState = {
    initialized: false,
    currentPage: null,       // "home" | "host" | "join"
    currentScreen: null,     // Écran actif dans la page
    isOnline: navigator.onLine,
    theme: localStorage.getItem(APP_CONFIG.theme.storageKey) || APP_CONFIG.theme.default,
    errors: [],
    loadingAssets: false,
    assetsLoaded: false,
};

// ======================================================
// 🎨 GESTION DU THÈME
// ======================================================

export function setTheme(theme) {
    AppState.theme = theme;
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(APP_CONFIG.theme.storageKey, theme);
}

function initTheme() {
    setTheme(AppState.theme);
}

// ======================================================
// 🧭 NAVIGATION GLOBALE (inter-pages)
// ======================================================

/**
 * Redirige vers une page de l'application
 * @param {"host"|"join"|"main"} page
 * @param {Object} params - Paramètres URL optionnels
 */
export function naviguerPage(page, params = {}) {
    const base = APP_CONFIG.routes[page];
    if (!base) {
        console.error("[MAIN] Page inconnue:", page);
        return;
    }

    const url = new URL(base, location.origin);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    console.log(`[MAIN] Navigation → ${url.pathname}`);
    location.href = url.toString();
}

/**
 * Détecte sur quelle page on se trouve
 */
export function detecterPageActuelle() {
    const path = location.pathname.replace(/\/+$/, "");
    if (path === "" || path === "/main" || path.startsWith("/main")) return "main";
    if (path.startsWith("/host")) return "host";
    if (path.startsWith("/join")) return "join";
    return "unknown";
}

/**
 * Récupère les paramètres URL
 */
export function getUrlParams() {
    const params = {};
    new URLSearchParams(location.search).forEach((v, k) => { params[k] = v; });
    return params;
}

// ======================================================
// 🌐 GESTION DE LA CONNEXION RÉSEAU
// ======================================================

function initNetworkStatus() {
    const updateStatus = (online) => {
        AppState.isOnline = online;
        document.body.classList.toggle("offline", !online);

        const banner = document.getElementById("offline-banner");
        if (banner) {
            banner.hidden = online;
        }

        if (!online) {
            console.warn("[MAIN] Connexion perdue");
        } else {
            console.log("[MAIN] Connexion rétablie");
        }
    };

    window.addEventListener("online",  () => updateStatus(true));
    window.addEventListener("offline", () => updateStatus(false));
    updateStatus(navigator.onLine);
}

// ======================================================
// 🔠 GESTION DES ERREURS GLOBALES
// ======================================================

function initErrorHandling() {
    window.addEventListener("error", (event) => {
        console.error("[MAIN] Erreur globale:", event.error);
        AppState.errors.push({
            message: event.message,
            filename: event.filename,
            timestamp: Date.now()
        });
    });

    window.addEventListener("unhandledrejection", (event) => {
        console.error("[MAIN] Promise rejetée:", event.reason);
        AppState.errors.push({
            message: String(event.reason),
            type: "unhandledRejection",
            timestamp: Date.now()
        });
    });
}

// ======================================================
// 🖼️ CHARGEMENT DES ASSETS
// ======================================================

export async function preloadAssets(assets = []) {
    AppState.loadingAssets = true;

    const promises = assets.map(src => new Promise(resolve => {
        if (src.endsWith(".png") || src.endsWith(".jpg") || src.endsWith(".webp") || src.endsWith(".svg")) {
            const img = new Image();
            img.onload  = resolve;
            img.onerror = resolve; // Ne pas bloquer sur erreur
            img.src = src;
        } else {
            resolve(); // Type non géré → résoudre immédiatement
        }
    }));

    await Promise.allSettled(promises);
    AppState.loadingAssets = false;
    AppState.assetsLoaded  = true;
    console.log("[MAIN] Assets chargés.");
}

// ======================================================
// 🔔 SYSTÈME DE NOTIFICATIONS TOAST
// ======================================================

let _toastContainer = null;

function initToasts() {
    _toastContainer = document.getElementById("toast-container");
    if (!_toastContainer) {
        _toastContainer = document.createElement("div");
        _toastContainer.id = "toast-container";
        _toastContainer.className = "toast-container";
        document.body.appendChild(_toastContainer);
    }
}

/**
 * Affiche un toast de notification
 * @param {string} message
 * @param {"info"|"success"|"error"|"warning"} type
 * @param {number} duration - ms
 */
export function showToast(message, type = "info", duration = 3000) {
    if (!_toastContainer) initToasts();

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${{
            info:    "ℹ️",
            success: "✅",
            error:   "❌",
            warning: "⚠️"
        }[type] || "ℹ️"}</span>
        <span class="toast-msg">${_esc(message)}</span>
    `;

    _toastContainer.appendChild(toast);

    // Animation entrée
    requestAnimationFrame(() => toast.classList.add("toast-visible"));

    setTimeout(() => {
        toast.classList.remove("toast-visible");
        toast.classList.add("toast-hiding");
        setTimeout(() => toast.remove(), 400);
    }, duration);
}

// ======================================================
// 🎮 ACTIONS DE NAVIGATION DEPUIS L'ACCUEIL
// ======================================================

function initHomeActions() {
    // Bouton "Host" → /host/
    document.getElementById("btn-go-host")?.addEventListener("click", () => {
        naviguerPage("host");
    });

    // Bouton "Rejoindre" → /join/
    document.getElementById("btn-go-join")?.addEventListener("click", () => {
        naviguerPage("join");
    });
}

// ======================================================
// 🔒 PRIVÉ
// ======================================================

function _esc(str) {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// ======================================================
// 🚀 INITIALISATION PRINCIPALE
// ======================================================

async function init() {
    if (AppState.initialized) return;

    console.log(`[MAIN] 🚀 MiniGame Universe v${APP_CONFIG.version} — démarrage`);

    // 1. Thème
    initTheme();

    // 2. Gestion des erreurs
    initErrorHandling();

    // 3. Réseau
    initNetworkStatus();

    // 4. Toasts
    initToasts();

    // 5. Détecter la page
    AppState.currentPage = detecterPageActuelle();
    console.log(`[MAIN] Page actuelle : ${AppState.currentPage}`);

    // 6. Précharger les assets de base
    await preloadAssets([
        "/images/LogoMiniGame.png"
    ]);

    // 7. Actions de la page d'accueil si applicable
    if (AppState.currentPage === "main" || AppState.currentPage === "unknown") {
        initHomeActions();
    }

    AppState.initialized = true;
    document.body.classList.add("app-ready");
    console.log("[MAIN] ✅ Application initialisée.");
}

// Lancement dès que le DOM est prêt
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}

// Exposer globalement pour les modules qui en ont besoin
window.AppConfig = APP_CONFIG;
window.AppState  = AppState;
window.showToast = showToast;
window.naviguerPage = naviguerPage;