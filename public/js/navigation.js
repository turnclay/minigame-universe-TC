// /js/navigation.js
import { afficherReglages, initThemeSauvegarde } from './modules/reglages.js';

import { $, show, hide } from "./core/dom.js";
import { afficherListeParties } from "./modules/parties.js";
import { masquerScoreboard } from "./modules/scoreboard.js";
import {
    getAllParties,
    getScoresGlobaux,
    getAllPerformances,
    getPlayers
} from "./core/storage.js";
import { nettoyerSession } from "./core/cleanup.js";

// ======================================================
// 🗺️ HISTORIQUE DE NAVIGATION
// ======================================================
let navigationStack = [];

// ======================================================
// 🛑 CONFIRMATION AVANT DE QUITTER UN JEU
// ======================================================
function demanderQuitterPartie() {
    return confirm("Es-tu sûr de vouloir quitter la partie en cours ?");
}

function estEcranJeu(ecran) {
    return [
        "undercover", "quiz", "justeprix", "lml", "mimer",
        "pendu", "petitbac", "memoire", "morpion", "puissance4"
    ].includes(ecran);
}

// ======================================================
// 🔄 BOUTON RESET PERMANENT (entre ⬅️ et 🏠)
// ======================================================
// Nettoie la session et ramène à l'accueil sans demander de confirmation.
// Utilisé pour démarrer une nouvelle partie proprement.
export function initBoutonReset() {
    const btnReset = $("btn-reset-permanent");
    if (!btnReset) return;
    btnReset.addEventListener("click", () => {
        fermerMenu();
        // Confirmation uniquement si une partie de jeu est en cours
        const ecranActuel = getEcranActuel();
        if (estEcranJeu(ecranActuel)) {
            if (!confirm("Réinitialiser la session et revenir à l'accueil ?")) return;
        }
        naviguerVersAccueil();
    });
}

// ======================================================
// 🏠 BOUTON ACCUEIL PERMANENT
// ======================================================
import { nettoyerSession, resetEtatQuizHote } from "./core/cleanup.js";
import { HostSession } from "./core/host-session.js";

export function initBoutonAccueil() {
    const btnHome = $("btn-home-permanent");
    if (!btnHome) return;

    btnHome.addEventListener("click", () => {
        fermerMenu();

        // Confirmation si une partie est en cours
        const ecranActuel = getEcranActuel();
        if (estEcranJeu(ecranActuel)) {
            if (!demanderQuitterPartie()) return;
        }

        // 🧹 Reset complet AVANT reload
        try { HostSession.reset(); } catch {}
        try { resetEtatQuizHote(); } catch {}
        try { nettoyerSession(); } catch {}

        // 🔄 Recharge la page (équivalent logique d’un hard reload)
        location.reload();
    });
}



// ======================================================
// ⬅️ BOUTON RETOUR PERMANENT
// ======================================================
export function initBoutonRetour() {
    const btnRetour = $("btn-retour-permanent");
    if (!btnRetour) return;
    btnRetour.addEventListener("click", () => retourArriere());
}



// ======================================================
// 🎯 NAVIGATION VERS UNE SECTION
// ======================================================
export function naviguerVers(section, depuis = null) {
    if (depuis) navigationStack.push(depuis);

    const tousLesEcrans = [
        "home", "choix-jeu", "choix-mode", "form-solo", "form-equipes",
        "container", "liste-parties", "quiz", "justeprix", "undercover",
        "undercover-config", "undercover-distribution", "lml", "mimer",
        "pendu", "petitbac", "memoire", "morpion", "puissance4",
        "stats-dashboard", "gestion-joueurs-panel", "gestion-equipes-panel"
    ];

    tousLesEcrans.forEach(id => hide(id));
    show(section);

    const btnRetour = $("btn-retour-permanent");
    if (btnRetour) btnRetour.hidden = section === "home";
}



// ======================================================
// 🏠 NAVIGATION VERS L'ACCUEIL
// ======================================================
export function naviguerVersAccueil() {
    navigationStack = [];

    const tousLesEcrans = [
        "choix-jeu", "choix-mode", "form-solo", "form-equipes", "container",
        "liste-parties", "quiz", "justeprix", "undercover", "undercover-config",
        "undercover-distribution", "lml", "mimer", "pendu", "petitbac",
        "memoire", "morpion", "puissance4", "stats-dashboard",
        "gestion-joueurs-panel", "gestion-equipes-panel"
    ];
    tousLesEcrans.forEach(id => hide(id));

    masquerScoreboard();
    show("home");

    // Reset complet de la session
    _resetSessionComplete();

    // Recharger le hub d'accueil
    import('./main.js')
        .then(m => { if (typeof m.initHomeHub === 'function') m.initHomeHub(); })
        .catch(() => { if (typeof window.initHomeHub === 'function') window.initHomeHub(); });

    const btnRetour = $("btn-retour-permanent");
    if (btnRetour) btnRetour.hidden = true;
}



// ======================================================
// 🔄 RESET COMPLET DE LA SESSION
// ======================================================
function _resetSessionComplete() {

    // 1. Nettoyer localStorage
    try { nettoyerSession(); } catch {}

    // 2. Réinitialiser HostSession
    try {
        if (window.HostSession) {
            if (typeof window.HostSession.terminer === 'function') {
                window.HostSession.terminer(); // HOST_END_GAME si partie active
            }
            window.HostSession._partieId = null;
            window.HostSession._snapshot = null;
            window.HostSession._pendingStart = false;
        }
    } catch {}

    // 3. Réinitialiser invite.js
    import('./modules/invite.js')
        .then(m => { if (typeof m.resetPartieSessionId === 'function') m.resetPartieSessionId(); })
        .catch(() => {});

    // 4. Réinitialiser GameState
    try {
        if (window.GameState) {
            window.GameState.mode                 = null;
            window.GameState.jeu                  = null;
            window.GameState.jeuActuel            = null;
            window.GameState.partieNom            = '';
            window.GameState.joueurs              = [];
            window.GameState.equipes              = [];
            window.GameState.scores               = {};
            window.GameState.partieEnCoursChargee = false;
        }
    } catch {}

    console.log('[NAV] 🧹 Session réinitialisée — prêt pour une nouvelle partie');
}


// ======================================================
// ⬅️ RETOUR ARRIÈRE
// ======================================================
export function retourArriere() {
    const ecranCourant = getEcranActuel();
    if (estEcranJeu(ecranCourant)) {
        if (!demanderQuitterPartie()) return;
    }

    switch (ecranCourant) {
        case "choix-jeu":               naviguerVersAccueil(); break;
        case "choix-mode":              naviguerVers("choix-jeu", "choix-mode"); break;
        case "form-solo":
        case "form-equipes":            naviguerVers("choix-mode", ecranCourant); break;
        case "liste-parties":           naviguerVersAccueil(); break;
        case "stats-dashboard":         naviguerVersAccueil(); break;
        case "gestion-joueurs-panel":   naviguerVersAccueil(); break;
        case "gestion-equipes-panel":   naviguerVersAccueil(); break;
        case "undercover-config":       naviguerVers("form-solo", "undercover-config"); break;
        default:
            masquerScoreboard();
            naviguerVersAccueil();
    }
}

// ======================================================
// 🔍 DÉTECTER L'ÉCRAN ACTUEL
// ======================================================
function getEcranActuel() {
    const ecrans = [
        "home", "choix-jeu", "choix-mode", "form-solo", "form-equipes",
        "liste-parties", "undercover-config", "undercover", "quiz", "justeprix",
        "lml", "mimer", "pendu", "petitbac", "memoire", "morpion", "puissance4",
        "stats-dashboard", "gestion-joueurs-panel", "gestion-equipes-panel"
    ];
    for (const ecran of ecrans) {
        const el = $(ecran);
        if (el && !el.hidden) return ecran;
    }
    return "home";
}

// ======================================================
// ☰ BOUTON MENU
// ======================================================
export function initBoutonMenu() {
    const btnMenu = $("btn-menu-permanent");
    const menuPanel = $("menu-panel");
    const btnCloseMenu = $("btn-close-menu");
    if (!btnMenu || !menuPanel) return;

    btnMenu.addEventListener("click", ouvrirMenu);
    btnCloseMenu?.addEventListener("click", fermerMenu);
    $("menu-overlay")?.addEventListener("click", fermerMenu);
}

// ======================================================
// 📊 ACTIONS DU MENU
// ======================================================
export function initMenuActions() {

    // ── Parties ────────────────────────────────────────
const menuParties = $("menu-parties");
if (menuParties) {
    menuParties.addEventListener("click", () => {
        fermerMenu();
        // Masque tous les écrans via naviguerVers avant d'afficher la liste
        naviguerVers("liste-parties");
        afficherListeParties();
    });
}

    // ── Gestion des joueurs ────────────────────────────
    const menuJoueurs = $("menu-joueurs");
    if (menuJoueurs) {
        menuJoueurs.addEventListener("click", () => {
            fermerMenu();
            import("./modules/joueurs.js").then(m => {
                m.afficherGestionJoueurs();
            }).catch(err => {
                console.error("Erreur chargement module joueurs :", err);
            });
        });
    }

    // ── Gestion des équipes ────────────────────────────
    const menuEquipes = $("menu-equipes");
    if (menuEquipes) {
        menuEquipes.addEventListener("click", () => {
            fermerMenu();
            import("./modules/equipes.js").then(m => {
                m.afficherGestionEquipes();
            }).catch(err => {
                console.error("Erreur chargement module équipes :", err);
            });
        });
    }

    // ── Réglages ───────────────────────────────────────
    const menuReglages = $("menu-reglages");
    if (menuReglages) {
        menuReglages.addEventListener("click", () => {
            fermerMenu();
            afficherReglages();
        });
    }

    // ── Stats dashboard ────────────────────────────────
    const menuHome = $("menu-home");
    if (menuHome) {
        menuHome.addEventListener("click", () => {
            fermerMenu();
            afficherStatsDashboard();
        });
    }
}

// ======================================================
// 🔧 FONCTIONS UTILITAIRES MENU
// ======================================================
function ouvrirMenu() {
    show("menu-panel");
    show("menu-overlay");
}

function fermerMenu() {
    hide("menu-panel");
    hide("menu-overlay");
}

// ======================================================
// 📊 TABLEAU DE BORD STATISTIQUES
// ======================================================

const JEUX_META = {
    quiz:       { label: "Quiz",             icon: "❓", color: "#00d4ff" },
    justeprix:  { label: "Le Bon Prix",      icon: "💰", color: "#ffd700" },
    undercover: { label: "Undercover",       icon: "🕵️", color: "#a855f7" },
    lml:        { label: "Maxi Lettres",     icon: "📖", color: "#22c55e" },
    mimer:      { label: "Mimer/Dessiner",   icon: "🎭", color: "#f97316" },
    pendu:      { label: "Le Pendu",         icon: "🪢", color: "#ef4444" },
    petitbac:   { label: "Petit Bac",        icon: "📝", color: "#06b6d4" },
    memoire:    { label: "Mémoire Flash",    icon: "🧠", color: "#8b5cf6" },
    morpion:    { label: "Morpion",          icon: "⭕", color: "#84cc16" },
    puissance4: { label: "Puissance 4",      icon: "🔴", color: "#fb923c" },
};

function calculerStats() {
    const parties     = getAllParties();
    const scoresGlob  = getScoresGlobaux();
    const perfs       = getAllPerformances();
    const joueurs     = getPlayers();

    // ── Totaux globaux ──────────────────────────────────
    const totalParties = parties.length;
    const totalJoueurs = joueurs.length;

    // Points totaux toutes parties
    let totalPoints = 0;
    Object.values(scoresGlob).forEach(d => { totalPoints += d.total || 0; });

    // Jeu le plus joué
    const compteurJeux = {};
    parties.forEach(p => {
        const j = p.jeu || "inconnu";
        compteurJeux[j] = (compteurJeux[j] || 0) + 1;
    });
    const jeuPlusJoue = Object.entries(compteurJeux)
        .sort((a, b) => b[1] - a[1])[0] || null;

    // ── Classement global ───────────────────────────────
    const classement = Object.entries(scoresGlob)
        .map(([nom, d]) => ({
            nom,
            total: d.total || 0,
            parJeu: d.parJeu || {}
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

    // ── Stats par jeu ───────────────────────────────────
    const statsParJeu = {};
    Object.keys(JEUX_META).forEach(jeu => {
        const partiesJeu = parties.filter(p => p.jeu === jeu);
        const nbParties  = partiesJeu.length;

        let meilleurScore = 0;
        let meilleursJoueur = "-";
        let totalScoreJeu = 0;

        partiesJeu.forEach(p => {
            if (p.scores) {
                Object.entries(p.scores).forEach(([nom, score]) => {
                    totalScoreJeu += score;
                    if (score > meilleurScore) {
                        meilleurScore = score;
                        meilleursJoueur = nom;
                    }
                });
            }
        });

        // Complète avec scores globaux si besoin
        if (meilleurScore === 0 && scoresGlob) {
            Object.entries(scoresGlob).forEach(([nom, d]) => {
                const s = d.parJeu?.[jeu] || 0;
                if (s > meilleurScore) {
                    meilleurScore = s;
                    meilleursJoueur = nom;
                }
            });
        }

        statsParJeu[jeu] = { nbParties, meilleurScore, meilleursJoueur };
    });

    // ── Activité récente (7 derniers jours) ─────────────
    const maintenant = Date.now();
    const activiteRecente = parties
        .filter(p => (maintenant - new Date(p.date).getTime()) < 7 * 24 * 3600 * 1000)
        .length;

    // ── Jour le plus actif ──────────────────────────────
    const joursSemaine = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
    const actParJour = Array(7).fill(0);
    parties.forEach(p => {
        const j = new Date(p.date).getDay();
        actParJour[j]++;
    });
    const jourPlusActif = actParJour.indexOf(Math.max(...actParJour));

    // ── Meilleur joueur global ──────────────────────────
    let meilleurJoueurGlobal = "-";
    let meilleurTotalGlobal  = 0;
    classement.forEach(c => {
        if (c.total > meilleurTotalGlobal) {
            meilleurTotalGlobal = c.total;
            meilleurJoueurGlobal = c.nom;
        }
    });

    return {
        totalParties, totalJoueurs, totalPoints,
        jeuPlusJoue, classement, statsParJeu,
        activiteRecente, actParJour, joursSemaine,
        jourPlusActif, meilleurJoueurGlobal, meilleurTotalGlobal
    };
}

export function afficherStatsDashboard() {
    let dashboard = document.getElementById("stats-dashboard");
    if (!dashboard) {
        dashboard = document.createElement("section");
        dashboard.id = "stats-dashboard";
        dashboard.className = "screen";
        dashboard.setAttribute("aria-labelledby", "stats-title");
        document.body.appendChild(dashboard);
    }

    const stats = calculerStats();
    dashboard.innerHTML = buildDashboardHTML(stats);

    naviguerVers("stats-dashboard");

    requestAnimationFrame(() => {
        animerCompteurs(stats);
        animerBarChart(stats);
        animerJauges(stats);
    });
}

// ======================================================
// 🏗️ CONSTRUCTION DU HTML DU DASHBOARD
// ======================================================
function buildDashboardHTML(stats) {
    const { totalParties, totalJoueurs, totalPoints,
            jeuPlusJoue, classement, statsParJeu,
            activiteRecente, actParJour, joursSemaine,
            jourPlusActif } = stats;

    const maxActJour = Math.max(...actParJour, 1);

    // KPI Cards
    const kpiCards = [
        { icon: "🎮", label: "Parties jouées",      val: totalParties,    id: "kpi-parties",  color: "#00d4ff" },
        { icon: "👥", label: "Joueurs enregistrés", val: totalJoueurs,    id: "kpi-joueurs",  color: "#a855f7" },
        { icon: "⭐", label: "Points distribués",   val: totalPoints,     id: "kpi-points",   color: "#ffd700" },
        { icon: "🔥", label: "Parties cette semaine", val: activiteRecente, id: "kpi-recents", color: "#f97316" },
    ].map(k => `
        <div class="dash-kpi-card" style="--kpi-color: ${k.color}">
            <div class="dash-kpi-icon">${k.icon}</div>
            <div class="dash-kpi-val" id="${k.id}" data-target="${k.val}">0</div>
            <div class="dash-kpi-label">${k.label}</div>
            <div class="dash-kpi-glow"></div>
        </div>
    `).join("");

    // Classement joueurs
    const medals = ["🥇", "🥈", "🥉"];
    const classementRows = classement.length === 0
        ? `<p class="dash-empty">Aucun score enregistré pour l'instant.</p>`
        : classement.map((c, i) => {
            const pct = classement[0].total > 0
                ? Math.round((c.total / classement[0].total) * 100) : 0;
            return `
                <div class="dash-rank-row" style="animation-delay: ${i * 0.07}s">
                    <span class="dash-rank-pos">${medals[i] || `#${i + 1}`}</span>
                    <span class="dash-rank-nom">${escapeHtml(c.nom)}</span>
                    <div class="dash-rank-bar-wrap">
                        <div class="dash-rank-bar" data-pct="${pct}" style="width:0%"></div>
                    </div>
                    <span class="dash-rank-score" data-target="${c.total}">0 pts</span>
                </div>
            `;
        }).join("");

    // Jeux joués — mini cartes avec jauge
    const jeuxCards = Object.entries(JEUX_META).map(([jeu, meta]) => {
        const s = statsParJeu[jeu];
        const pct = totalParties > 0
            ? Math.round((s.nbParties / totalParties) * 100) : 0;
        return `
            <div class="dash-jeu-card" style="--jeu-color: ${meta.color}">
                <div class="dash-jeu-icon">${meta.icon}</div>
                <div class="dash-jeu-name">${meta.label}</div>
                <div class="dash-jeu-stats">
                    <span>${s.nbParties} partie${s.nbParties > 1 ? "s" : ""}</span>
                    ${s.meilleurScore > 0
                        ? `<span class="dash-jeu-record">🏆 ${s.meilleurScore} pts (${escapeHtml(s.meilleursJoueur)})</span>`
                        : ""}
                </div>
                <div class="dash-jeu-jauge-wrap">
                    <div class="dash-jeu-jauge" data-pct="${pct}" style="width:0%; background: ${meta.color}"></div>
                </div>
                <div class="dash-jeu-pct">${pct}% des parties</div>
            </div>
        `;
    }).join("");

    // Bar chart activité par jour
    const barChart = joursSemaine.map((jour, i) => {
        const h = Math.round((actParJour[i] / maxActJour) * 100);
        const isToday = i === new Date().getDay();
        const isBest  = i === stats.jourPlusActif && actParJour[i] > 0;
        return `
            <div class="dash-bar-col">
                <div class="dash-bar-value">${actParJour[i] || ""}</div>
                <div class="dash-bar" data-h="${h}"
                     style="height:0%; ${isBest ? "background: linear-gradient(180deg,#ffd700,#f97316);" : ""}"
                     ${isToday ? 'class="dash-bar today"' : ''}></div>
                <div class="dash-bar-label ${isToday ? "today" : ""}">${jour}</div>
            </div>
        `;
    }).join("");

    // Jeu favori
    const favJeu = jeuPlusJoue
        ? `<span style="color:${JEUX_META[jeuPlusJoue[0]]?.color || '#fff'}">
               ${JEUX_META[jeuPlusJoue[0]]?.icon || "🎮"} ${JEUX_META[jeuPlusJoue[0]]?.label || jeuPlusJoue[0]}
           </span> avec <strong>${jeuPlusJoue[1]} partie${jeuPlusJoue[1] > 1 ? "s" : ""}</strong>`
        : "Aucune partie jouée";

    return `
    <style>
    /* ═══════════════════════════════════════════════════
       📊 DASHBOARD STATS — STYLES INLINE SCOPED
    ═══════════════════════════════════════════════════ */
    #stats-dashboard {
        max-width: 900px;
        padding: 30px 20px 60px;
        font-family: var(--font-secondary, 'Poppins', sans-serif);
    }

    .dash-title {
        text-align: center;
        font-size: clamp(1.5rem, 4vw, 2.2rem);
        font-weight: 700;
        margin-bottom: 8px;
        background: linear-gradient(135deg, #fff 0%, #00d4ff 50%, #a855f7 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        letter-spacing: 0.05em;
    }

    .dash-subtitle {
        text-align: center;
        font-size: 0.95rem;
        opacity: 0.6;
        margin-bottom: 36px;
    }

    /* ── KPI ─────────────────────────────────────────── */
    .dash-kpi-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 16px;
        margin-bottom: 36px;
    }

    .dash-kpi-card {
        position: relative;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 18px;
        padding: 24px 16px;
        text-align: center;
        overflow: hidden;
        transition: transform 0.25s ease, box-shadow 0.25s ease;
        animation: fadeInUp 0.5s ease-out both;
    }

    .dash-kpi-card:hover {
        transform: translateY(-4px);
        box-shadow: 0 8px 30px color-mix(in srgb, var(--kpi-color) 30%, transparent);
    }

    .dash-kpi-glow {
        position: absolute;
        inset: 0;
        background: radial-gradient(circle at 50% 120%, color-mix(in srgb, var(--kpi-color) 20%, transparent), transparent 70%);
        pointer-events: none;
    }

    .dash-kpi-icon {
        font-size: 2.2rem;
        margin-bottom: 8px;
        filter: drop-shadow(0 0 8px var(--kpi-color));
    }

    .dash-kpi-val {
        font-size: 2.4rem;
        font-weight: 800;
        color: var(--kpi-color);
        font-family: var(--font-primary, 'Orbitron', sans-serif);
        line-height: 1;
        margin-bottom: 4px;
        text-shadow: 0 0 20px color-mix(in srgb, var(--kpi-color) 50%, transparent);
    }

    .dash-kpi-label {
        font-size: 0.8rem;
        opacity: 0.75;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        line-height: 1.3;
    }

    /* ── SECTIONS ────────────────────────────────────── */
    .dash-section {
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 20px;
        padding: 24px;
        margin-bottom: 24px;
        animation: fadeInUp 0.5s ease-out both;
    }

    .dash-section-title {
        font-size: 1.1rem;
        font-weight: 700;
        margin-bottom: 20px;
        display: flex;
        align-items: center;
        gap: 10px;
        color: rgba(255,255,255,0.9);
        border-bottom: 1px solid rgba(255,255,255,0.08);
        padding-bottom: 12px;
    }

    .dash-section-title span { font-size: 1.4rem; }

    .dash-empty {
        text-align: center;
        opacity: 0.5;
        font-style: italic;
        padding: 20px;
    }

    /* ── CLASSEMENT ──────────────────────────────────── */
    .dash-rank-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .dash-rank-row {
        display: grid;
        grid-template-columns: 40px 1fr 2fr 90px;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        background: rgba(255,255,255,0.04);
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.06);
        transition: background 0.2s ease;
        animation: slideInRight 0.4s ease-out both;
    }

    .dash-rank-row:hover { background: rgba(255,255,255,0.09); }

    .dash-rank-pos { font-size: 1.3rem; text-align: center; }

    .dash-rank-nom {
        font-weight: 600;
        font-size: 0.95rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .dash-rank-bar-wrap {
        background: rgba(255,255,255,0.08);
        border-radius: 20px;
        height: 8px;
        overflow: hidden;
    }

    .dash-rank-bar {
        height: 100%;
        background: linear-gradient(90deg, #00d4ff, #a855f7);
        border-radius: 20px;
        transition: width 0.8s cubic-bezier(0.22, 1, 0.36, 1);
    }

    .dash-rank-score {
        font-size: 0.85rem;
        font-weight: 700;
        color: #00d4ff;
        text-align: right;
        font-family: var(--font-primary, 'Orbitron', sans-serif);
    }

    /* ── GRILLE JEUX ─────────────────────────────────── */
    .dash-jeux-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: 14px;
    }

    .dash-jeu-card {
        background: rgba(255,255,255,0.04);
        border: 1px solid color-mix(in srgb, var(--jeu-color) 20%, transparent);
        border-radius: 14px;
        padding: 16px 14px;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        animation: fadeInUp 0.5s ease-out both;
    }

    .dash-jeu-card:hover {
        transform: translateY(-3px) scale(1.02);
        box-shadow: 0 6px 20px color-mix(in srgb, var(--jeu-color) 25%, transparent);
    }

    .dash-jeu-icon {
        font-size: 1.8rem;
        margin-bottom: 6px;
        filter: drop-shadow(0 0 6px var(--jeu-color));
    }

    .dash-jeu-name {
        font-size: 0.85rem;
        font-weight: 700;
        margin-bottom: 6px;
        color: var(--jeu-color);
    }

    .dash-jeu-stats {
        font-size: 0.78rem;
        opacity: 0.75;
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin-bottom: 10px;
    }

    .dash-jeu-record { color: #ffd700; font-size: 0.75rem; }

    .dash-jeu-jauge-wrap {
        background: rgba(255,255,255,0.08);
        border-radius: 20px;
        height: 5px;
        overflow: hidden;
        margin-bottom: 4px;
    }

    .dash-jeu-jauge {
        height: 100%;
        border-radius: 20px;
        transition: width 1s cubic-bezier(0.22, 1, 0.36, 1);
    }

    .dash-jeu-pct { font-size: 0.7rem; opacity: 0.55; }

    /* ── BAR CHART ───────────────────────────────────── */
    .dash-barchart {
        display: flex;
        align-items: flex-end;
        gap: 8px;
        height: 140px;
        padding: 0 4px;
    }

    .dash-bar-col {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-end;
        gap: 4px;
        height: 100%;
    }

    .dash-bar-value {
        font-size: 0.72rem;
        font-weight: 700;
        opacity: 0.8;
        min-height: 14px;
        color: #00d4ff;
    }

    .dash-bar {
        width: 100%;
        background: linear-gradient(180deg, #6366f1, #4b2cff);
        border-radius: 6px 6px 0 0;
        transition: height 0.9s cubic-bezier(0.22, 1, 0.36, 1);
        min-height: 3px;
    }

    .dash-bar.today { background: linear-gradient(180deg, #00d4ff, #0099cc); }

    .dash-bar-label { font-size: 0.72rem; opacity: 0.7; font-weight: 600; }
    .dash-bar-label.today { color: #00d4ff; opacity: 1; }

    /* ── HIGHLIGHT BANNER ────────────────────────────── */
    .dash-highlight {
        background: linear-gradient(135deg, rgba(0,212,255,0.08), rgba(168,85,247,0.08));
        border: 1px solid rgba(0,212,255,0.2);
        border-radius: 14px;
        padding: 16px 20px;
        display: flex;
        align-items: center;
        gap: 14px;
        font-size: 0.95rem;
        flex-wrap: wrap;
    }

    .dash-highlight-icon { font-size: 1.6rem; }
    .dash-highlight strong { color: #ffd700; }

    /* ── ANIMATIONS ──────────────────────────────────── */
    @keyframes fadeInUp {
        from { opacity: 0; transform: translateY(18px); }
        to   { opacity: 1; transform: translateY(0); }
    }

    @keyframes slideInRight {
        from { opacity: 0; transform: translateX(-14px); }
        to   { opacity: 1; transform: translateX(0); }
    }

    @keyframes countUp {
        from { opacity: 0; }
        to   { opacity: 1; }
    }

    /* ── RESPONSIVE ──────────────────────────────────── */
    @media (max-width: 600px) {
        .dash-rank-row { grid-template-columns: 32px 1fr 80px; }
        .dash-rank-bar-wrap { display: none; }
        .dash-jeux-grid { grid-template-columns: repeat(2, 1fr); }
        .dash-kpi-grid  { grid-template-columns: repeat(2, 1fr); }
    }
    </style>

    <h1 class="dash-title">📊 Statistiques</h1>
    <p class="dash-subtitle">Historique complet de tes parties et performances</p>

    <!-- KPI -->
    <div class="dash-kpi-grid">
        ${kpiCards}
    </div>

    <!-- Jeu favori -->
    <div class="dash-section" style="animation-delay:0.1s">
        <div class="dash-highlight">
            <span class="dash-highlight-icon">🏅</span>
            <div>
                <strong>Jeu favori :</strong> ${favJeu}
                ${stats.meilleurJoueurGlobal !== "-"
                    ? `&nbsp;·&nbsp; <strong>Meilleur joueur :</strong>
                       ${escapeHtml(stats.meilleurJoueurGlobal)}
                       (${stats.meilleurTotalGlobal} pts)`
                    : ""}
            </div>
        </div>
    </div>

    <!-- Classement global -->
    <div class="dash-section" style="animation-delay:0.15s">
        <div class="dash-section-title">
            <span>🏆</span> Classement général
        </div>
        <div class="dash-rank-list">
            ${classementRows}
        </div>
    </div>

    <!-- Activité par jour -->
    <div class="dash-section" style="animation-delay:0.2s">
        <div class="dash-section-title">
            <span>📅</span> Activité par jour de la semaine
        </div>
        <div class="dash-barchart">
            ${barChart}
        </div>
    </div>

    <!-- Stats par jeu -->
    <div class="dash-section" style="animation-delay:0.25s">
        <div class="dash-section-title">
            <span>🎮</span> Statistiques par jeu
        </div>
        <div class="dash-jeux-grid">
            ${jeuxCards}
        </div>
    </div>
    `;
}

// ======================================================
// 🎬 ANIMATIONS JAVASCRIPT
// ======================================================
function animerCompteurs(stats) {
    const kpiIds = ["kpi-parties", "kpi-joueurs", "kpi-points", "kpi-recents"];
    kpiIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const target = parseInt(el.dataset.target) || 0;
        animCounter(el, 0, target, 1200, v => {
            el.textContent = v >= 1000
                ? (v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : `${(v / 1000).toFixed(1)}k`)
                : v;
        });
    });

    document.querySelectorAll(".dash-rank-score").forEach(el => {
        const target = parseInt(el.dataset.target) || 0;
        animCounter(el, 0, target, 1000, v => { el.textContent = `${v} pts`; });
    });
}

function animCounter(el, from, to, duration, render) {
    const start = performance.now();
    function step(now) {
        const t = Math.min((now - start) / duration, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        const val = Math.round(from + (to - from) * ease);
        render(val);
        if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

function animerBarChart() {
    document.querySelectorAll(".dash-bar").forEach(bar => {
        const h = bar.dataset.h || 0;
        setTimeout(() => { bar.style.height = `${h}%`; }, 300);
    });
}

function animerJauges() {
    document.querySelectorAll(".dash-rank-bar").forEach(bar => {
        const pct = bar.dataset.pct || 0;
        setTimeout(() => { bar.style.width = `${pct}%`; }, 400);
    });

    document.querySelectorAll(".dash-jeu-jauge").forEach(bar => {
        const pct = bar.dataset.pct || 0;
        setTimeout(() => { bar.style.width = `${pct}%`; }, 500);
    });
}

// ======================================================
// 🔒 SÉCURITÉ HTML
// ======================================================
function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")

        .replace(/"/g, "&quot;");
}

// ======================================================
// 🚀 INITIALISATION COMPLÈTE
// ======================================================

// ── Auto-affichage du thème pendu (remplace le bouton toggle supprimé) ──
// Lit data.theme depuis partie_question_* et l'affiche directement dans #pendu-theme-display
function _initPenduThemeAuto() {
    const display = document.getElementById('pendu-theme-display');
    if (!display) return;

    const _lireTheme = () => {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k || !k.startsWith('partie_question_')) continue;
            try {
                const data = JSON.parse(localStorage.getItem(k) || 'null');
                if (data && data.theme) {
                    display.textContent = '🎯 ' + data.theme;
                    display.style.display = '';
                    return;
                }
            } catch {}
        }
    };

    // Lecture immédiate au lancement
    _lireTheme();

    // Écouter les mises à jour localStorage (pendu.js publie le thème dans partie_question_*)
    window.addEventListener('storage', e => {
        if (e.key && e.key.startsWith('partie_question_')) _lireTheme();
    });

    // Polling de secours 1s (même onglet — storageEvent ne se déclenche pas en same-tab)
    setInterval(_lireTheme, 1000);
}

export function initNavigation() {
    // Auto-afficher le thème du pendu dès qu'il est disponible (bouton supprimé)
    _initPenduThemeAuto();
    initThemeSauvegarde();
    initBoutonReset();
    initBoutonAccueil();
    initBoutonRetour();
    initBoutonMenu();
    initMenuActions();
    // reset joueurs géré dans reglages.js
}

// ======================================================
// 📱 BARRE DE NAVIGATION PERMANENTE — INVITÉ (jeu.html)
// ======================================================

/**
 * Initialise la navbar invité dans jeu.html.
 * Appelée par jeu.js après que #phase-jeu devient visible.
 */


export function initNavbarInvite() {
    const navbar = document.getElementById('invite-navbar');
    if (!navbar) return;

    // Rendre la navbar visible
    navbar.classList.add('visible');

    // ── Bouton Accueil ─────────────────────────────────
    const btnHome = document.getElementById('btn-home-permanent');
    if (btnHome) {
        btnHome.addEventListener('click', () => {
            const ok = confirm('Quitter la partie et retourner à l\'accueil ?');
            if (!ok) return;
            window.location.href = 'index.html';
        });
    }

    // ── Bouton Musique ─────────────────────────────────
    const btnMusic = document.getElementById('toggle-music');
    const audio    = document.getElementById('bg-music');

    if (btnMusic && audio) {
        // Tenter lecture automatique (peut échouer sans interaction)
        audio.volume = 0.35;
        audio.play().catch(() => {
            // Silencieux — l'utilisateur peut l'activer manuellement
            audio.muted = true;
            btnMusic.textContent = '🔇';
            btnMusic.classList.add('muted');
        });

        btnMusic.addEventListener('click', () => {
            if (audio.paused) {
                audio.muted = false;
                audio.play().catch(() => {});
                btnMusic.textContent = '🔊';
                btnMusic.classList.remove('muted');
            } else {
                audio.muted = !audio.muted;
                btnMusic.textContent = audio.muted ? '🔇' : '🔊';
                btnMusic.classList.toggle('muted', audio.muted);
            }
        });
    }

    // ── Bouton Menu ────────────────────────────────────
    const btnMenu = document.getElementById('btn-menu-permanent');
    if (btnMenu) {
        btnMenu.addEventListener('click', () => _ouvrirMenuInvite());
    }
}

// ── Construire et ouvrir le menu invité ────────────────
function _ouvrirMenuInvite() {
    // Supprimer un menu déjà ouvert
    document.getElementById('invite-menu-panel')?.remove();
    document.getElementById('invite-menu-overlay')?.remove();

    // Overlay
    const overlay = document.createElement('div');
    overlay.id = 'invite-menu-overlay';
    overlay.className = 'invite-menu-overlay';
    document.body.appendChild(overlay);

    // Panel
    const panel = document.createElement('div');
    panel.id = 'invite-menu-panel';
    panel.className = 'invite-menu-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Menu invité');

    panel.innerHTML = `
        <div class="invite-menu-header">
            <h2 class="invite-menu-title">☰ Menu</h2>
            <button class="invite-menu-close" id="invite-menu-close" aria-label="Fermer">✖</button>
        </div>
        <div class="invite-menu-items">

            <div style="padding:14px 16px;background:rgba(167,139,250,.08);border:1px solid rgba(167,139,250,.22);border-radius:14px;text-align:center;">
                <p style="font-size:1rem;margin:0 0 6px;">👋</p>
                <p style="font-size:.85rem;font-weight:700;color:#c4b5fd;margin:0 0 4px;">Tu joues en invité</p>
                <p style="font-size:.78rem;color:rgba(255,255,255,.45);line-height:1.6;margin:0;">
                    Retrouve + de réglages dans l'interface de l'<strong style="color:rgba(255,255,255,.65);">hôte</strong> 🎮
                </p>
            </div>

            <hr class="invite-menu-separator">

            <button class="invite-menu-item" id="imenu-stats">
                <span class="invite-menu-item-icon">📊</span>
                <span class="invite-menu-item-label">Statistiques</span>
            </button>

        </div>
    `;

    document.body.appendChild(panel);

    const fermer = () => {
        panel.classList.remove('open');
        overlay.classList.remove('open');
        setTimeout(() => { panel.remove(); overlay.remove(); }, 360);
    };

    // Animation d'entrée
    requestAnimationFrame(() => {
        panel.classList.add('open');
        overlay.classList.add('open');
    });

    document.getElementById('invite-menu-close')?.addEventListener('click', fermer);
    overlay.addEventListener('click', fermer);

    // ── Réglages (sans reset scores / joueurs) ──────────
    // ── Statistiques ────────────────────────────────────
    document.getElementById('imenu-stats')?.addEventListener('click', () => {
        fermer();
        _ouvrirStatsInvite();
    });
}

// ── Réglages invité (audio uniquement — thème retiré) ─────
function _ouvrirReglagesInvite() {
    document.getElementById('reglages-panel')?.remove();
    document.getElementById('reglages-overlay')?.remove();

    const panel = document.createElement('div');
    panel.id = 'reglages-panel';
    panel.className = 'reglages-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Réglages');

    panel.innerHTML = `
        <div class="reglages-header">
            <h2 class="reglages-title">⚙️ Réglages</h2>
            <button class="reglages-close" id="reglages-close" aria-label="Fermer">✖</button>
        </div>
        <div class="reglages-body">
            <div class="reglages-section">
                <h3 class="reglages-section-title">🔊 Audio</h3>
                <div class="reglages-row" style="opacity:.35;filter:grayscale(100%);">
                    <span class="reglages-row-label" style="text-decoration:line-through;">Musique</span>
                    <button class="toggle-switch" disabled
                        style="cursor:not-allowed;pointer-events:none;">
                        <span class="toggle-knob"></span>
                    </button>
                </div>
                <p style="font-size:.75rem;color:rgba(255,255,255,.35);margin-top:4px;">
                    🚧 Fonctionnalité bientôt disponible
                </p>
            </div>
        </div>`;

    document.body.appendChild(panel);

    const overlay = document.createElement('div');
    overlay.id = 'reglages-overlay';
    overlay.className = 'reglages-overlay';
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
        panel.classList.add('open');
        overlay.classList.add('open');
    });

    const fermer = () => {
        panel.classList.remove('open');
        overlay.classList.remove('open');
        setTimeout(() => { panel.remove(); overlay.remove(); }, 350);
    };

    document.getElementById('reglages-close')?.addEventListener('click', fermer);
    overlay.addEventListener('click', fermer);
}

// ── Stats invité (lecture seule, dans un panneau modal) ─
function _ouvrirStatsInvite() {
    import('./navigation.js').then(m => {
        // Ouvrir le dashboard stats dans un panneau flottant
        // On injecte le dashboard dans une modale légère plutôt que de naviguer
        document.getElementById('invite-stats-modal')?.remove();
        document.getElementById('invite-stats-overlay')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'invite-stats-overlay';
        overlay.className = 'invite-menu-overlay';
        document.body.appendChild(overlay);

        const modal = document.createElement('div');
        modal.id = 'invite-stats-modal';
        modal.style.cssText = `
            position:fixed; inset:0; z-index:720;
            overflow-y:auto; background:rgba(10,5,30,0.97);
            backdrop-filter:blur(20px); padding:20px 16px 80px;
            color:white; font-family:'Segoe UI',system-ui,sans-serif;
            animation: slideInFromRight .35s cubic-bezier(.4,0,.2,1);
        `;

        const fermer = () => {
            overlay.classList.remove('open');
            modal.style.opacity = '0';
            modal.style.transition = 'opacity .3s';
            setTimeout(() => { modal.remove(); overlay.remove(); }, 320);
        };

        const btnFermer = document.createElement('button');
        btnFermer.textContent = '✖ Fermer';
        btnFermer.style.cssText = `
            display:block; margin:0 auto 24px;
            padding:10px 24px; border-radius:12px;
            background:rgba(255,255,255,.1); border:1px solid rgba(255,255,255,.2);
            color:white; font-size:.9rem; font-weight:700; cursor:pointer; font-family:inherit;
        `;
        btnFermer.addEventListener('click', fermer);
        modal.appendChild(btnFermer);

        // Conteneur du dashboard
        const dashContainer = document.createElement('div');
        dashContainer.id = 'stats-dashboard-invite';
        modal.appendChild(dashContainer);

        document.body.appendChild(modal);
        requestAnimationFrame(() => overlay.classList.add('open'));

        overlay.addEventListener('click', fermer);

        // Générer le dashboard dans le conteneur invité
        if (typeof m.afficherStatsDashboard === 'function') {
            // Hack : rediriger temporairement le rendu dans notre conteneur
            const origGetById = document.getElementById.bind(document);
            m.afficherStatsDashboard();
            // Le dashboard s'est injecté dans #stats-dashboard — on le déplace
            setTimeout(() => {
                const dash = document.getElementById('stats-dashboard');
                if (dash) {
                    dashContainer.innerHTML = dash.innerHTML;
                    dash.innerHTML = '';
                    dash.hidden = true;
                }
            }, 50);
        }
    }).catch(err => console.error('[INVITE-MENU] Erreur stats :', err));
}