// /public/js/main.js
// ======================================================
// 🏠 MAIN — MiniGame Universe
// Ce fichier gère UNIQUEMENT :
//   • Les imports des modules menu (stats, joueurs, équipes)
//   • Le branchement des boutons menu latéral qui appellent
//     ces modules
//
// ⚠️  La logique de navigation SPA (showScreen, goHome,
//     goJeux, goDetail, goParties, goHost…) est gérée
//     par le script inline dans index.html via window.MGU.
//     Ce fichier ne doit PAS redéfinir showScreen() ou
//     hideAllScreens() car cela créerait des conflits.
// ======================================================

// ── Imports des modules menu ─────────────────────────
// Ces imports sont optionnels : si les fichiers n'existent
// pas encore, on catch silencieusement pour ne pas bloquer
// la navigation.

let afficherStatistiques   = null;
let afficherGestionJoueurs = null;
let afficherGestionEquipes = null;

async function chargerModulesMenu() {
    try {
        const m = await import('./menu/statistiques.js');
        afficherStatistiques = m.afficherStatistiques;
    } catch { /* module pas encore créé */ }

    try {
        const m = await import('./menu/joueurs.js');
        afficherGestionJoueurs = m.afficherGestionJoueurs;
    } catch { /* module pas encore créé */ }

    try {
        const m = await import('./menu/equipes.js');
        afficherGestionEquipes = m.afficherGestionEquipes;
    } catch { /* module pas encore créé */ }
}

// ── Branchement des actions de menu qui nécessitent les modules ─
function bindMenuModules() {
    const menuHome    = document.getElementById('menu-home');
    const menuJoueurs = document.getElementById('menu-joueurs');
    const menuEquipes = document.getElementById('menu-equipes');

    if (menuHome) {
        menuHome.addEventListener('click', () => {
            // Fermer le menu (via MGU ou fallback)
            const ov = document.getElementById('menu-overlay');
            const mp = document.getElementById('menu-panel');
            if (ov) ov.hidden = true;
            if (mp) mp.hidden = true;
            document.body.style.overflow = '';

            if (typeof afficherStatistiques === 'function') {
                afficherStatistiques();
            } else {
                // Fallback : navigation vers accueil si pas de module stats
                window.MGU?.goHome?.();
            }
        });
    }

    if (menuJoueurs) {
        menuJoueurs.addEventListener('click', () => {
            const ov = document.getElementById('menu-overlay');
            const mp = document.getElementById('menu-panel');
            if (ov) ov.hidden = true;
            if (mp) mp.hidden = true;
            document.body.style.overflow = '';

            if (typeof afficherGestionJoueurs === 'function') {
                afficherGestionJoueurs();
            }
        });
    }

    if (menuEquipes) {
        menuEquipes.addEventListener('click', () => {
            const ov = document.getElementById('menu-overlay');
            const mp = document.getElementById('menu-panel');
            if (ov) ov.hidden = true;
            if (mp) mp.hidden = true;
            document.body.style.overflow = '';

            if (typeof afficherGestionEquipes === 'function') {
                afficherGestionEquipes();
            }
        });
    }
}

// ── Exposition pour compatibilité ─────────────────────
// Certains modules (joueurs.js, equipes.js) peuvent appeler
// window.renderPartiesContinuer() ou dispatchez des events.
window.renderPartiesContinuer = () => window.MGU?.renderPartiesContinuer?.();
window.addEventListener('mgu:afficher-parties', () => window.MGU?.goParties?.());

// ── Init ──────────────────────────────────────────────
async function init() {
    await chargerModulesMenu();
    bindMenuModules();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}