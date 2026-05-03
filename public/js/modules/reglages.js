// /js/modules/reglages.js
// ============================================
// ⚙️ REGLAGES.JS - Gestionnaire de thèmes
// ============================================
import { getPlayers } from '../core/storage.js';
import { GameState }  from '../core/state.js';

// ======================================================
// 🎨 DÉFINITION DES THÈMES
// ======================================================

const THEMES = {
    aurora: {
        label: "Aurora Glass",
        icon: "🌌",
        description: "Violet & Cyan néon",
        vars: {
            "--gradient-background": "linear-gradient(135deg, #4b2cff 0%, #8a2be2 33%, #00c6ff 66%, #4b2cff 100%)",
            "--gradient-button":     "linear-gradient(135deg, #6a5af9 0%, #8a2be2 100%)",
            "--gradient-accent":     "linear-gradient(135deg, #00c6ff 0%, #4b2cff 100%)",
            "--gradient-aurora":     "linear-gradient(135deg, rgba(138,43,226,0.3) 0%, rgba(75,44,255,0.3) 25%, rgba(0,198,255,0.3) 50%, rgba(138,43,226,0.3) 75%, rgba(255,0,128,0.3) 100%)",
            "--neon-cyan":           "#00d4ff",
            "--neon-purple":         "#8a2be2",
            "--neon-pink":           "#ff0080",
            "--neon-blue":           "#4b2cff",
            "--glow-cyan":           "rgba(0, 212, 255, 0.6)",
            "--glow-purple":         "rgba(138, 43, 226, 0.6)",
            "--glow-pink":           "rgba(255, 0, 128, 0.6)",
            "--aurora-primary":      "rgba(138, 43, 226, 0.2)",
            "--aurora-secondary":    "rgba(0, 212, 255, 0.2)",
            "--aurora-accent":       "rgba(255, 0, 128, 0.2)",
        }
    },
    sunset: {
        label: "Sunset Fire",
        icon: "🌅",
        description: "Orange & Rose ardent",
        vars: {
            "--gradient-background": "linear-gradient(135deg, #ff6b35 0%, #f7441d 33%, #ff0080 66%, #ff6b35 100%)",
            "--gradient-button":     "linear-gradient(135deg, #ff8c42 0%, #f7441d 100%)",
            "--gradient-accent":     "linear-gradient(135deg, #ff0080 0%, #ff6b35 100%)",
            "--gradient-aurora":     "linear-gradient(135deg, rgba(255,107,53,0.3) 0%, rgba(247,68,29,0.3) 25%, rgba(255,0,128,0.3) 50%, rgba(255,107,53,0.3) 75%, rgba(255,200,0,0.3) 100%)",
            "--neon-cyan":           "#ffd700",
            "--neon-purple":         "#ff0080",
            "--neon-pink":           "#ff6b35",
            "--neon-blue":           "#f7441d",
            "--glow-cyan":           "rgba(255, 215, 0, 0.6)",
            "--glow-purple":         "rgba(255, 0, 128, 0.6)",
            "--glow-pink":           "rgba(255, 107, 53, 0.6)",
            "--aurora-primary":      "rgba(255, 107, 53, 0.2)",
            "--aurora-secondary":    "rgba(255, 0, 128, 0.2)",
            "--aurora-accent":       "rgba(255, 215, 0, 0.2)",
        }
    },
    forest: {
        label: "Forest Neon",
        icon: "🌿",
        description: "Vert émeraude & Lime",
        vars: {
            "--gradient-background": "linear-gradient(135deg, #134e2a 0%, #1a6b35 33%, #00ff87 66%, #134e2a 100%)",
            "--gradient-button":     "linear-gradient(135deg, #22c55e 0%, #134e2a 100%)",
            "--gradient-accent":     "linear-gradient(135deg, #00ff87 0%, #22c55e 100%)",
            "--gradient-aurora":     "linear-gradient(135deg, rgba(19,78,42,0.3) 0%, rgba(26,107,53,0.3) 25%, rgba(0,255,135,0.3) 50%, rgba(19,78,42,0.3) 75%, rgba(163,230,53,0.3) 100%)",
            "--neon-cyan":           "#00ff87",
            "--neon-purple":         "#22c55e",
            "--neon-pink":           "#a3e635",
            "--neon-blue":           "#134e2a",
            "--glow-cyan":           "rgba(0, 255, 135, 0.6)",
            "--glow-purple":         "rgba(34, 197, 94, 0.6)",
            "--glow-pink":           "rgba(163, 230, 53, 0.6)",
            "--aurora-primary":      "rgba(19, 78, 42, 0.2)",
            "--aurora-secondary":    "rgba(0, 255, 135, 0.2)",
            "--aurora-accent":       "rgba(163, 230, 53, 0.2)",
        }
    },
    ocean: {
        label: "Deep Ocean",
        icon: "🌊",
        description: "Bleu abyssal & Turquoise",
        vars: {
            "--gradient-background": "linear-gradient(135deg, #0c1445 0%, #1a237e 33%, #006064 66%, #0c1445 100%)",
            "--gradient-button":     "linear-gradient(135deg, #0288d1 0%, #006064 100%)",
            "--gradient-accent":     "linear-gradient(135deg, #00bcd4 0%, #0288d1 100%)",
            "--gradient-aurora":     "linear-gradient(135deg, rgba(12,20,69,0.3) 0%, rgba(26,35,126,0.3) 25%, rgba(0,96,100,0.3) 50%, rgba(12,20,69,0.3) 75%, rgba(0,188,212,0.3) 100%)",
            "--neon-cyan":           "#00e5ff",
            "--neon-purple":         "#1a237e",
            "--neon-pink":           "#00bcd4",
            "--neon-blue":           "#0288d1",
            "--glow-cyan":           "rgba(0, 229, 255, 0.6)",
            "--glow-purple":         "rgba(26, 35, 126, 0.6)",
            "--glow-pink":           "rgba(0, 188, 212, 0.6)",
            "--aurora-primary":      "rgba(12, 20, 69, 0.2)",
            "--aurora-secondary":    "rgba(0, 229, 255, 0.2)",
            "--aurora-accent":       "rgba(0, 188, 212, 0.2)",
        }
    },
    gold: {
        label: "Royal Gold",
        icon: "👑",
        description: "Or & Bordeaux royal",
        vars: {
            "--gradient-background": "linear-gradient(135deg, #1a0a00 0%, #4a1c00 33%, #c8930a 66%, #1a0a00 100%)",
            "--gradient-button":     "linear-gradient(135deg, #f59e0b 0%, #92400e 100%)",
            "--gradient-accent":     "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
            "--gradient-aurora":     "linear-gradient(135deg, rgba(26,10,0,0.3) 0%, rgba(74,28,0,0.3) 25%, rgba(200,147,10,0.3) 50%, rgba(26,10,0,0.3) 75%, rgba(251,191,36,0.3) 100%)",
            "--neon-cyan":           "#fbbf24",
            "--neon-purple":         "#f59e0b",
            "--neon-pink":           "#fcd34d",
            "--neon-blue":           "#92400e",
            "--glow-cyan":           "rgba(251, 191, 36, 0.7)",
            "--glow-purple":         "rgba(245, 158, 11, 0.6)",
            "--glow-pink":           "rgba(252, 211, 77, 0.6)",
            "--aurora-primary":      "rgba(74, 28, 0, 0.2)",
            "--aurora-secondary":    "rgba(251, 191, 36, 0.2)",
            "--aurora-accent":       "rgba(200, 147, 10, 0.2)",
        }
    },
    cyber: {
        label: "Cyber Pink",
        icon: "🤖",
        description: "Rose cyber & Jaune acide",
        vars: {
            "--gradient-background": "linear-gradient(135deg, #1a0026 0%, #2d0057 33%, #ff0090 66%, #1a0026 100%)",
            "--gradient-button":     "linear-gradient(135deg, #ff0090 0%, #7c00e0 100%)",
            "--gradient-accent":     "linear-gradient(135deg, #f0ff00 0%, #ff0090 100%)",
            "--gradient-aurora":     "linear-gradient(135deg, rgba(26,0,38,0.3) 0%, rgba(45,0,87,0.3) 25%, rgba(255,0,144,0.3) 50%, rgba(26,0,38,0.3) 75%, rgba(240,255,0,0.3) 100%)",
            "--neon-cyan":           "#f0ff00",
            "--neon-purple":         "#ff0090",
            "--neon-pink":           "#ff66c4",
            "--neon-blue":           "#7c00e0",
            "--glow-cyan":           "rgba(240, 255, 0, 0.6)",
            "--glow-purple":         "rgba(255, 0, 144, 0.6)",
            "--glow-pink":           "rgba(255, 102, 196, 0.6)",
            "--aurora-primary":      "rgba(45, 0, 87, 0.2)",
            "--aurora-secondary":    "rgba(255, 0, 144, 0.2)",
            "--aurora-accent":       "rgba(240, 255, 0, 0.2)",
        }
    },
};

// ======================================================
// 💾 PERSISTANCE
// ======================================================

const STORAGE_KEY = "minigame_theme";

function sauvegarderTheme(themeId) {
    localStorage.setItem(STORAGE_KEY, themeId);
}

function chargerThemeSauvegarde() {
    return localStorage.getItem(STORAGE_KEY) || "aurora";
}

// ======================================================
// 🎨 APPLICATION DU THÈME
// ======================================================

export function appliquerTheme(themeId) {
    const theme = THEMES[themeId];
    if (!theme) return;

    const root = document.documentElement;
    Object.entries(theme.vars).forEach(([prop, val]) => {
        root.style.setProperty(prop, val);
    });

    // Marquer le thème actif sur le body
    document.body.dataset.theme = themeId;
    sauvegarderTheme(themeId);

    // Mettre à jour les cartes dans le panel si ouvert
    document.querySelectorAll(".theme-card").forEach(card => {
        card.classList.toggle("active", card.dataset.theme === themeId);
    });

    console.log(`[REGLAGES] Thème appliqué : ${theme.label}`);
}

export function initThemeSauvegarde() {
    const saved = chargerThemeSauvegarde();
    appliquerTheme(saved);
}

// ======================================================
// 🖼️ PANNEAU RÉGLAGES
// ======================================================

export function afficherReglages() {
    // Supprimer un panel existant
    const existant = document.getElementById("reglages-panel");
    if (existant) existant.remove();

    const themeActuel = chargerThemeSauvegarde();

    const panel = document.createElement("div");
    panel.id = "reglages-panel";
    panel.className = "reglages-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Réglages");

    panel.innerHTML = `
        <div class="reglages-header">
            <h2 class="reglages-title">⚙️ Réglages</h2>
            <button class="reglages-close" id="reglages-close" aria-label="Fermer">✖</button>
        </div>

        <div class="reglages-body">

            <div class="reglages-section">
                <h3 class="reglages-section-title">🎨 Thème de l'application</h3>
                <p class="reglages-section-desc">Change les couleurs de toute l'interface en un clic.</p>

                <div class="themes-grid">
                    ${Object.entries(THEMES).map(([id, t]) => `
                        <button
                            class="theme-card ${id === themeActuel ? 'active' : ''}"
                            data-theme="${id}"
                            aria-label="Thème ${t.label}"
                            title="${t.description}"
                        >
                            <span class="theme-preview theme-preview--${id}"></span>
                            <span class="theme-icon">${t.icon}</span>
                            <span class="theme-label">${t.label}</span>
                            <span class="theme-desc">${t.description}</span>
                            ${id === themeActuel ? '<span class="theme-active-badge">✓ Actif</span>' : ''}
                        </button>
                    `).join('')}
                </div>
            </div>

            <div class="reglages-section">
                <h3 class="reglages-section-title">🔊 Audio</h3>
                <div class="reglages-row">
                    <span class="reglages-row-label">Musique</span>
                    <button class="toggle-switch" id="toggle-music-reglages" aria-label="Activer/Désactiver la musique">
                        <span class="toggle-knob"></span>
                    </button>
                </div>
            </div>

            <div class="reglages-section">
                <h3 class="reglages-section-title">⚠️ Données</h3>
                <button class="btn-danger-reglages" id="btn-reset-scores">
                    🗑️ Réinitialiser tous les scores
                </button>
                <button class="btn-danger-reglages" id="btn-reset-joueurs" style="margin-top:10px;">
                    👥 Réinitialiser tous les joueurs
                </button>
            </div>

        </div>
    `;

    document.body.appendChild(panel);

    // Overlay
    const overlay = document.createElement("div");
    overlay.id = "reglages-overlay";
    overlay.className = "reglages-overlay";
    document.body.appendChild(overlay);

    // Animation d'entrée
    requestAnimationFrame(() => {
        panel.classList.add("open");
        overlay.classList.add("open");
    });

    // ── Fermeture ──────────────────────────────────────
    function fermer() {
        panel.classList.remove("open");
        overlay.classList.remove("open");
        setTimeout(() => {
            panel.remove();
            overlay.remove();
        }, 350);
    }

    document.getElementById("reglages-close").addEventListener("click", fermer);
    overlay.addEventListener("click", fermer);

    // ── Sélection de thème ─────────────────────────────
    panel.querySelectorAll(".theme-card").forEach(card => {
        card.addEventListener("click", () => {
            const themeId = card.dataset.theme;
            appliquerTheme(themeId);

            // Mettre à jour les badges actifs
            panel.querySelectorAll(".theme-card").forEach(c => {
                const badge = c.querySelector(".theme-active-badge");
                if (c.dataset.theme === themeId) {
                    c.classList.add("active");
                    if (!badge) {
                        const b = document.createElement("span");
                        b.className = "theme-active-badge";
                        b.textContent = "✓ Actif";
                        c.appendChild(b);
                    }
                } else {
                    c.classList.remove("active");
                    if (badge) badge.remove();
                }
            });
        });
    });

    // ── Toggle musique ─────────────────────────────────
    const toggleMusic = document.getElementById("toggle-music-reglages");
    const audio = document.getElementById("bg-music");

    if (toggleMusic && audio) {
        // Sync état initial
        toggleMusic.classList.toggle("on", !audio.muted);

        toggleMusic.addEventListener("click", () => {
            audio.muted = !audio.muted;
            toggleMusic.classList.toggle("on", !audio.muted);

            // Sync avec le bouton principal
            const btnMusicPrincipal = document.getElementById("toggle-music");
            if (btnMusicPrincipal) {
                btnMusicPrincipal.textContent = audio.muted ? "🔇" : "🔊";
            }
        });
    }

    // ── Reset scores ───────────────────────────────────
    const btnReset = document.getElementById("btn-reset-scores");
    if (btnReset) {
        btnReset.addEventListener("click", () => {
            if (!confirm("⚠️ Cette action supprimera définitivement tous les scores et classements. Continuer ?")) return;

            localStorage.removeItem("scores_globaux");
            localStorage.removeItem("parties");
            localStorage.removeItem("partie_en_cours");

            fermer();
            alert("✅ Scores réinitialisés.");
        });
    }

    // ── Reset joueurs ───────────────────────────────────
    const btnResetJoueurs = document.getElementById("btn-reset-joueurs");
    if (btnResetJoueurs) {
        btnResetJoueurs.addEventListener("click", () => {
            const nb = getPlayers().length;
            if (nb === 0) { alert("Aucun joueur enregistré."); return; }
            if (!confirm(`Supprimer les ${nb} joueur(s) enregistré(s) et leurs équipes ? Irréversible.`)) return;

            // Supprimer du localStorage
            localStorage.removeItem("players");
            localStorage.removeItem("equipes_enregistrees");

            // Vider le GameState (accessible via import ES module)
            GameState.joueurs = [];
            GameState.equipes = [];
            GameState.scores  = {};

            // Rafraîchir les listes visibles si présentes dans le DOM
            const gjListe = document.querySelector(".gj-liste");
            if (gjListe) gjListe.innerHTML = '<p class="gj-empty">Aucun joueur enregistré. Crée le premier !</p>';
            const gjCount = document.querySelector(".gj-count");
            if (gjCount) gjCount.textContent = "0";

            const selEl = document.getElementById("joueurs-selectionnes-container");
            if (selEl) selEl.innerHTML = "";

            const joueursListEl = document.getElementById("joueurs-list");
            if (joueursListEl) joueursListEl.innerHTML = '<p class="eq-empty">∅ Aucun joueur enregistré</p>';

            // Feedback visuel (panneau reste ouvert)
            btnResetJoueurs.innerHTML    = "✅ Joueurs supprimés !";
            btnResetJoueurs.style.background  = "rgba(34,197,94,.15)";
            btnResetJoueurs.style.borderColor = "rgba(34,197,94,.35)";
            btnResetJoueurs.style.color       = "#86efac";
            setTimeout(() => {
                btnResetJoueurs.innerHTML       = "👥 Réinitialiser tous les joueurs";
                btnResetJoueurs.style.background  = "";
                btnResetJoueurs.style.borderColor = "";
                btnResetJoueurs.style.color       = "";
            }, 2500);

            console.log("[REGLAGES] 👥 Tous les joueurs supprimés.");
        });
    }
}