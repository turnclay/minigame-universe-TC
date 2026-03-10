// /public/js/menu/parties.js
// ======================================================
// 📜 MODULE PARTIES — Menu
// Affiche l'écran "Continuer une partie" (screen-parties)
// ======================================================

/**
 * Navigue vers l'écran screen-parties depuis le menu.
 * Appelle renderPartiesContinuer() si disponible dans main.js
 */
export function afficherParties() {
    // Masquer tous les écrans
    const ecrans = [
        "screen-home", "screen-jeux", "screen-jeu-detail", "screen-parties"
    ];
    ecrans.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.hidden = true;
    });

    // Afficher l'écran parties
    const target = document.getElementById("screen-parties");
    if (target) {
        target.hidden = false;
        target.classList.remove("animate-in");
        void target.offsetWidth;
        target.classList.add("animate-in");
    }

    // Mettre à jour le breadcrumb si disponible
    const bc = document.getElementById("topbar-breadcrumb");
    if (bc) {
        bc.innerHTML = `
            <button class="breadcrumb-back" id="breadcrumb-back-btn">← Retour</button>
            <span class="breadcrumb-sep">/</span>
            <span class="breadcrumb-label">📋 Mes parties</span>`;
        document.getElementById("breadcrumb-back-btn")?.addEventListener("click", () => {
            afficherAccueil();
        });
    }

    // Déclencher le rendu de la liste si la fonction existe dans le scope global
    if (typeof window.renderPartiesContinuer === "function") {
        window.renderPartiesContinuer();
    } else {
        // Fallback : chercher et appeler via import dynamique
        import("../main.js").then(m => {
            if (typeof m.renderPartiesContinuer === "function") {
                m.renderPartiesContinuer();
            }
        }).catch(() => {
            // renderPartiesContinuer est une fonction interne de main.js
            // Elle sera appelée via l'événement custom
        });
        // Émettre un événement pour que main.js puisse réagir
        window.dispatchEvent(new CustomEvent("mgu:afficher-parties"));
    }
}

function afficherAccueil() {
    ["screen-jeux", "screen-jeu-detail", "screen-parties"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.hidden = true;
    });
    const home = document.getElementById("screen-home");
    if (home) home.hidden = false;
}