// /public/js/menu/statistiques.js
// ======================================================
// 📊 MODULE STATISTIQUES — Menu
// Affiche le dashboard stats dans un overlay plein écran
// ======================================================

const JEUX_META = {
    quiz:       { label: "Quiz",           icon: "❓", color: "#00d4ff" },
    justeprix:  { label: "Juste Prix",     icon: "💰", color: "#ffd700" },
    undercover: { label: "Undercover",     icon: "🕵️", color: "#a855f7" },
    lml:        { label: "Maxi Lettres",   icon: "📖", color: "#22c55e" },
    mimer:      { label: "Mimer/Dessiner", icon: "🎭", color: "#f97316" },
    pendu:      { label: "Le Pendu",       icon: "🪢", color: "#ef4444" },
    petitbac:   { label: "Petit Bac",      icon: "📝", color: "#06b6d4" },
    memoire:    { label: "Mémoire Flash",  icon: "🧠", color: "#8b5cf6" },
    morpion:    { label: "Morpion",        icon: "⭕", color: "#84cc16" },
    puissance4: { label: "Puissance 4",    icon: "🔴", color: "#fb923c" },
};

function esc(str) {
    return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getParties() {
    try { return JSON.parse(localStorage.getItem("mgu_parties") || "[]"); } catch { return []; }
}

function calculerStats() {
    const parties = getParties();
    let totalPoints = 0;
    const scoresParJoueur = {};
    const compteurJeux = {};

    parties.forEach(p => {
        const jeu = p.jeu || "inconnu";
        compteurJeux[jeu] = (compteurJeux[jeu] || 0) + 1;
        Object.entries(p.scores || {}).forEach(([nom, pts]) => {
            totalPoints += pts || 0;
            if (!scoresParJoueur[nom]) scoresParJoueur[nom] = { total: 0, parJeu: {} };
            scoresParJoueur[nom].total += pts || 0;
            scoresParJoueur[nom].parJeu[jeu] = (scoresParJoueur[nom].parJeu[jeu] || 0) + (pts || 0);
        });
    });

    const classement = Object.entries(scoresParJoueur)
        .map(([nom, d]) => ({ nom, total: d.total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

    const jeuPlusJoue = Object.entries(compteurJeux).sort((a, b) => b[1] - a[1])[0] || null;

    const statsParJeu = {};
    Object.keys(JEUX_META).forEach(jeu => {
        const partiesJeu = parties.filter(p => p.jeu === jeu);
        let meilleurScore = 0, meilleursJoueur = "-";
        partiesJeu.forEach(p => {
            Object.entries(p.scores || {}).forEach(([nom, s]) => {
                if (s > meilleurScore) { meilleurScore = s; meilleursJoueur = nom; }
            });
        });
        statsParJeu[jeu] = { nbParties: partiesJeu.length, meilleurScore, meilleursJoueur };
    });

    const maintenant = Date.now();
    const activiteRecente = parties.filter(p => {
        const d = p.createdAt ? new Date(p.createdAt).getTime() : 0;
        return (maintenant - d) < 7 * 24 * 3600 * 1000;
    }).length;

    const actParJour = Array(7).fill(0);
    parties.forEach(p => {
        if (p.createdAt) actParJour[new Date(p.createdAt).getDay()]++;
    });
    const joursSemaine = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
    const jourPlusActif = actParJour.indexOf(Math.max(...actParJour));

    return {
        totalParties: parties.length,
        totalPoints,
        jeuPlusJoue,
        classement,
        statsParJeu,
        activiteRecente,
        actParJour,
        joursSemaine,
        jourPlusActif,
        meilleurJoueur: classement[0]?.nom || "-",
        meilleurTotal: classement[0]?.total || 0,
    };
}

export function afficherStatistiques() {
    let overlay = document.getElementById("stats-overlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "stats-overlay";
        overlay.className = "menu-fullscreen-overlay";
        document.body.appendChild(overlay);
    }

    const stats = calculerStats();
    const medals = ["🥇", "🥈", "🥉"];
    const maxActJour = Math.max(...stats.actParJour, 1);

    const classementRows = stats.classement.length === 0
        ? `<p class="mfs-empty">Aucun score enregistré.</p>`
        : stats.classement.map((c, i) => {
            const pct = stats.classement[0].total > 0 ? Math.round((c.total / stats.classement[0].total) * 100) : 0;
            return `<div class="mfs-rank-row">
                <span class="mfs-rank-pos">${medals[i] || `#${i + 1}`}</span>
                <span class="mfs-rank-nom">${esc(c.nom)}</span>
                <div class="mfs-rank-bar-wrap"><div class="mfs-rank-bar" style="width:${pct}%"></div></div>
                <span class="mfs-rank-pts">${c.total} pts</span>
            </div>`;
        }).join("");

    const jeuxCards = Object.entries(JEUX_META).map(([jeu, meta]) => {
        const s = stats.statsParJeu[jeu];
        const pct = stats.totalParties > 0 ? Math.round((s.nbParties / stats.totalParties) * 100) : 0;
        return `<div class="mfs-jeu-card" style="--jeu-color:${meta.color}">
            <div class="mfs-jeu-icon">${meta.icon}</div>
            <div class="mfs-jeu-name">${meta.label}</div>
            <div class="mfs-jeu-count">${s.nbParties} partie${s.nbParties !== 1 ? "s" : ""}</div>
            ${s.meilleurScore > 0 ? `<div class="mfs-jeu-record">🏆 ${s.meilleurScore} pts — ${esc(s.meilleursJoueur)}</div>` : ""}
            <div class="mfs-jeu-bar-wrap"><div class="mfs-jeu-bar" style="width:${pct}%;background:${meta.color}"></div></div>
        </div>`;
    }).join("");

    const barChart = stats.joursSemaine.map((jour, i) => {
        const h = Math.round((stats.actParJour[i] / maxActJour) * 100);
        const isToday = i === new Date().getDay();
        const isBest = i === stats.jourPlusActif && stats.actParJour[i] > 0;
        return `<div class="mfs-bar-col">
            <div class="mfs-bar-val">${stats.actParJour[i] || ""}</div>
            <div class="mfs-bar${isToday ? " today" : ""}${isBest ? " best" : ""}" style="height:${h}%"></div>
            <div class="mfs-bar-label${isToday ? " today" : ""}">${jour}</div>
        </div>`;
    }).join("");

    overlay.innerHTML = `
    <div class="mfs-container">
        <div class="mfs-header">
            <h1 class="mfs-title">📊 Statistiques</h1>
            <button class="mfs-close" id="stats-close-btn">✕</button>
        </div>

        <div class="mfs-kpi-grid">
            <div class="mfs-kpi" style="--c:#00d4ff"><div class="mfs-kpi-icon">🎮</div><div class="mfs-kpi-val">${stats.totalParties}</div><div class="mfs-kpi-label">Parties jouées</div></div>
            <div class="mfs-kpi" style="--c:#ffd700"><div class="mfs-kpi-icon">⭐</div><div class="mfs-kpi-val">${stats.totalPoints}</div><div class="mfs-kpi-label">Points distribués</div></div>
            <div class="mfs-kpi" style="--c:#f97316"><div class="mfs-kpi-icon">🔥</div><div class="mfs-kpi-val">${stats.activiteRecente}</div><div class="mfs-kpi-label">Cette semaine</div></div>
            <div class="mfs-kpi" style="--c:#a855f7"><div class="mfs-kpi-icon">🏆</div><div class="mfs-kpi-val">${esc(stats.meilleurJoueur)}</div><div class="mfs-kpi-label">Meilleur joueur</div></div>
        </div>

        ${stats.jeuPlusJoue ? `
        <div class="mfs-highlight">
            <span class="mfs-highlight-icon">${JEUX_META[stats.jeuPlusJoue[0]]?.icon || "🎮"}</span>
            <span>Jeu favori : <strong style="color:${JEUX_META[stats.jeuPlusJoue[0]]?.color || "#fff"}">${JEUX_META[stats.jeuPlusJoue[0]]?.label || stats.jeuPlusJoue[0]}</strong> — <strong>${stats.jeuPlusJoue[1]} partie${stats.jeuPlusJoue[1] > 1 ? "s" : ""}</strong></span>
        </div>` : ""}

        <div class="mfs-section">
            <div class="mfs-section-title">🏆 Classement général</div>
            <div class="mfs-rank-list">${classementRows}</div>
        </div>

        <div class="mfs-section">
            <div class="mfs-section-title">📅 Activité par jour</div>
            <div class="mfs-barchart">${barChart}</div>
        </div>

        <div class="mfs-section">
            <div class="mfs-section-title">🎮 Par jeu</div>
            <div class="mfs-jeux-grid">${jeuxCards}</div>
        </div>
    </div>`;

    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add("mfs-visible"));

    document.getElementById("stats-close-btn")?.addEventListener("click", () => {
        overlay.classList.remove("mfs-visible");
        setTimeout(() => { overlay.hidden = true; }, 300);
    });
}