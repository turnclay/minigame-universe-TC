// /public/js/main.js
// ======================================================
// 🏠 MAIN — Navigation MiniGame Universe v3.1
// ======================================================
// Corrections v3.1 :
//
//   BUG CORRIGÉ — Éléments DOM capturés au niveau module
//   ─────────────────────────────────────────────────────
//   Avant : const elBtnRetour = $('btn-retour-permanent') était exécuté
//   immédiatement au chargement du module ES6, AVANT que le DOM soit
//   complètement parsé si le script est en <head> ou chargé en avance.
//   Résultat : tous ces éléments étaient null → aucun event listener
//   ne se branchait, la navigation ne fonctionnait pas.
//   → Tous les $() et $$() sont maintenant appelés DANS init().
//
//   BUG CORRIGÉ — menu-home → afficherStatistiques()
//   ─────────────────────────────────────────────────────
//   Dans le HTML, ce bouton est intitulé "📊 Statistiques".
//   Il appelait afficherStatistiques() via le module importé.
//   Ce module peut ne pas exister → la navigation tombait en erreur.
//   → On tente d'appeler afficherStatistiques() mais on reste sur la
//     page d'accueil (goHome()) si le module n'est pas chargé.
//
//   Aucun changement dans la logique métier, les destinations de
//   navigation, ou la structure des écrans — tout est inchangé.
// ======================================================

// ── Imports optionnels — ne bloquent pas si les fichiers n'existent pas ──
let afficherStatistiques   = null;
let afficherGestionJoueurs = null;
let afficherGestionEquipes = null;

// Charge les modules menu en arrière-plan — ne bloque pas init()
Promise.allSettled([
    import('./menu/statistiques.js')
        .then(m => { afficherStatistiques   = m.afficherStatistiques;   })
        .catch(() => {}),
    import('./menu/joueurs.js')
        .then(m => { afficherGestionJoueurs = m.afficherGestionJoueurs; })
        .catch(() => {}),
    import('./menu/equipes.js')
        .then(m => { afficherGestionEquipes = m.afficherGestionEquipes; })
        .catch(() => {}),
]);

// ── Méta-données des 10 jeux ─────────────────────────────
const JEUX = [
    {
        id: 'quiz',       nom: 'Quiz',           icon: '❓',
        desc: 'Questions & réponses en équipe ou en solo',
        joueurs: '2-10', duree: '15-30 min',
        regles: 'Le host pose des questions à thème. Les joueurs répondent à l\'oral. Points attribués par le host en temps réel.',
    },
    {
        id: 'justeprix',  nom: 'Juste Prix',      icon: '💰',
        desc: 'Devinez le prix exact sans dépasser',
        joueurs: '2-8',  duree: '20-40 min',
        regles: 'Un produit et son vrai prix sont affichés après les enchères. Le joueur le plus proche sans dépasser remporte les points.',
    },
    {
        id: 'undercover', nom: 'Undercover',      icon: '🕵️',
        desc: 'Trouvez l\'espion parmi vous',
        joueurs: '4-10', duree: '15-25 min',
        regles: 'Chaque joueur reçoit un mot. Un imposteur reçoit un mot différent. Discutez pour débusquer l\'intrus sans vous trahir.',
    },
    {
        id: 'lml',        nom: 'Maxi Lettres',    icon: '📖',
        desc: 'Formez le mot le plus long possible',
        joueurs: '2-8',  duree: '10-20 min',
        regles: 'Des lettres aléatoires sont tirées. Chaque joueur forme le mot le plus long avec ces lettres. Le plus long non contesté gagne.',
    },
    {
        id: 'mimer',      nom: 'Mimer/Dessiner',  icon: '🎭',
        desc: 'Faites deviner sans parler',
        joueurs: '4-12', duree: '20-40 min',
        regles: 'Faites deviner un mot en le mimant ou en le dessinant, sans parler. Votre équipe marque un point si elle trouve avant le temps imparti.',
    },
    {
        id: 'pendu',      nom: 'Le Pendu',        icon: '🪢',
        desc: 'Devinez le mot lettre par lettre',
        joueurs: '2-8',  duree: '10-20 min',
        regles: 'Trouvez le mot caché en proposant des lettres. Chaque lettre fausse rapproche le pendu. Trouvez avant d\'épuiser vos tentatives.',
    },
    {
        id: 'petitbac',   nom: 'Petit Bac',       icon: '📝',
        desc: 'Une lettre, des catégories, le plus vite !',
        joueurs: '2-8',  duree: '15-30 min',
        regles: 'Une lettre est tirée. Trouvez le plus rapidement un mot par catégorie (prénom, ville, animal…) commençant par cette lettre.',
    },
    {
        id: 'memoire',    nom: 'Mémoire Flash',   icon: '🧠',
        desc: 'Mémorisez des séquences de plus en plus longues',
        joueurs: '1-6',  duree: '10-30 min',
        regles: 'Une séquence de symboles est affichée brièvement. Reproduisez-la fidèlement. Chaque round la séquence s\'allonge.',
    },
    {
        id: 'morpion',    nom: 'Morpion',         icon: '⭕',
        desc: 'Alignez 3 symboles en ligne, colonne ou diagonale',
        joueurs: '2',    duree: '5-10 min',
        regles: 'Placez vos symboles (X ou O) à tour de rôle sur la grille 3×3. Alignez 3 symboles identiques en premier pour gagner.',
    },
    {
        id: 'puissance4', nom: 'Puissance 4',     icon: '🔴',
        desc: 'Alignez 4 jetons avant votre adversaire',
        joueurs: '2',    duree: '10-15 min',
        regles: 'Faites tomber vos jetons dans les colonnes. Alignez 4 jetons de votre couleur (ligne, colonne ou diagonale) pour gagner.',
    },
];

// ── DOM helpers ───────────────────────────────────────────
// ✅ FIX : fonctions utilitaires uniquement — pas d'appels DOM au niveau module
const $  = id  => document.getElementById(id);
const $$ = sel => document.querySelector(sel);

// ── État global ───────────────────────────────────────────
let currentScreen = 'home';
let currentJeu    = null;
let musicPlaying  = false;

// Ces références sont initialisées dans init() après que le DOM est prêt
let SCREENS        = {};
let elBtnRetour    = null;
let elBtnHome      = null;
let elBtnMenu      = null;
let elBreadcrumb   = null;
let elBtnMusic     = null;
let elBgMusic      = null;
let elMenuOverlay  = null;
let elMenuPanel    = null;
let elBtnCloseMenu = null;

// ══════════════════════════════════════════════════════
// SYSTÈME DE NAVIGATION
// ══════════════════════════════════════════════════════

function hideAllScreens() {
    Object.values(SCREENS).forEach(el => {
        if (el) el.hidden = true;
    });
}

function showScreen(name) {
    hideAllScreens();
    const el = SCREENS[name];
    if (!el) return;
    el.hidden = false;

    el.classList.remove('animate-in');
    void el.offsetWidth; // force reflow pour relancer l'animation
    el.classList.add('animate-in');

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateNav(screen, label = null) {
    currentScreen = screen;

    if (elBreadcrumb) {
        if (screen === 'home') {
            elBreadcrumb.innerHTML = '';
        } else if (screen === 'jeux') {
            elBreadcrumb.innerHTML = `<span class="breadcrumb-label">🎮 Tous les jeux</span>`;
        } else if (screen === 'detail' && label) {
            elBreadcrumb.innerHTML = `
                <button class="breadcrumb-back" id="bc-jeux">🎮 Jeux</button>
                <span class="breadcrumb-sep">›</span>
                <span class="breadcrumb-label">${label}</span>`;
            $('bc-jeux')?.addEventListener('click', goJeux);
        } else if (screen === 'parties') {
            elBreadcrumb.innerHTML = `<span class="breadcrumb-label">📋 Mes parties</span>`;
        }
    }

    if (elBtnRetour) elBtnRetour.hidden = (screen === 'home');
}

// ── Destinations de navigation ────────────────────────────

function goHome() {
    showScreen('home');
    updateNav('home');
    renderStatsBar();
}

function goJeux() {
    showScreen('jeux');
    updateNav('jeux');
    renderJeuxGrid();
}

function goDetail(jeuId) {
    const jeu = JEUX.find(j => j.id === jeuId);
    if (!jeu) return;
    currentJeu = jeu;
    renderDetail(jeu);
    showScreen('detail');
    updateNav('detail', jeu.nom);
}

function goParties() {
    showScreen('parties');
    updateNav('parties');
    renderPartiesContinuer();
}

function goHost(jeuId = null) {
    hideAllScreens();
    const url = jeuId ? `/host/?jeu=${jeuId}` : '/host/';
    window.location.href = url;
}

function retourContextuel() {
    if (currentScreen === 'detail')  return goJeux();
    if (currentScreen === 'jeux')    return goHome();
    if (currentScreen === 'parties') return goHome();
    goHome();
}

// ══════════════════════════════════════════════════════
// RENDU — Barre de stats accueil
// ══════════════════════════════════════════════════════

function renderStatsBar() {
    try {
        const parties    = JSON.parse(localStorage.getItem('mgu_parties') || '[]');
        const joueursRaw = localStorage.getItem('mgu_joueurs') ||
                           localStorage.getItem('mgu_players') || '[]';
        const joueurs    = JSON.parse(joueursRaw);

        const totalPts = parties.reduce((sum, p) =>
            sum + Object.values(p.scores || {}).reduce((s, v) => s + (v || 0), 0), 0);

        const elP   = $('stat-parties');
        const elJ   = $('stat-joueurs');
        const elPts = $('stat-points');

        if (elP)   elP.textContent   = parties.length;
        if (elJ)   elJ.textContent   = Array.isArray(joueurs) ? joueurs.length : 0;
        if (elPts) elPts.textContent = totalPts;
    } catch {
        // silencieux : pas bloquant pour l'UI
    }
}

// ══════════════════════════════════════════════════════
// RENDU — Grille des jeux
// ══════════════════════════════════════════════════════

function renderJeuxGrid() {
    const container = $('jeux-grid-container');
    if (!container) return;

    container.innerHTML = JEUX.map(j => `
        <button class="jeu-card" data-id="${j.id}" aria-label="Voir ${j.nom}">
            <div class="jeu-icon">${j.icon}</div>
            <div class="jeu-name">${j.nom}</div>
            <div class="jeu-desc">${j.desc}</div>
            <div class="jeu-meta">
                <span class="jeu-meta-item">👥 ${j.joueurs}</span>
                <span class="jeu-meta-item">⏱ ${j.duree}</span>
            </div>
        </button>`).join('');

    container.querySelectorAll('.jeu-card').forEach(btn => {
        btn.addEventListener('click', () => goDetail(btn.dataset.id));
    });
}

// ══════════════════════════════════════════════════════
// RENDU — Fiche détail d'un jeu
// ══════════════════════════════════════════════════════

function renderDetail(jeu) {
    const hero    = $('detail-hero-content');
    const regles  = $('detail-regles-content');
    const actions = $('detail-actions');

    if (hero) {
        hero.innerHTML = `
        <div class="detail-icon">${jeu.icon}</div>
        <div class="detail-nom">${jeu.nom}</div>
        <div class="detail-desc">${jeu.desc}</div>
        <div class="detail-infos">
            <div class="detail-info-item">
                <span class="detail-info-label">Joueurs</span>
                <span class="detail-info-val">👥 ${jeu.joueurs}</span>
            </div>
            <div class="detail-info-item">
                <span class="detail-info-label">Durée</span>
                <span class="detail-info-val">⏱ ${jeu.duree}</span>
            </div>
        </div>`;
    }

    if (regles) regles.textContent = jeu.regles;

    if (actions) {
        actions.innerHTML = `
        <button class="btn-primary btn-full btn-hero" id="btn-detail-lancer">
            🚀 Lancer une partie
        </button>
        <a href="/games/${jeu.id}/" class="btn-secondary btn-full">
            👁 Aperçu solo / démo
        </a>`;

        $('btn-detail-lancer')?.addEventListener('click', () => goHost(jeu.id));
    }
}

// ══════════════════════════════════════════════════════
// RENDU — Parties sauvegardées
// ══════════════════════════════════════════════════════

function renderPartiesContinuer() {
    const container = $('parties-continuer-list');
    if (!container) return;

    let parties = [];
    try {
        parties = JSON.parse(localStorage.getItem('mgu_parties') || '[]');
    } catch {
        parties = [];
    }

    parties.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    if (parties.length === 0) {
        container.innerHTML = `
            <div class="parties-vide">
                <div class="parties-vide-icon">📋</div>
                <p>Aucune partie sauvegardée pour l'instant.</p>
                <button class="btn-secondary" id="btn-pv-jeux">Lancer une première partie</button>
            </div>`;
        $('btn-pv-jeux')?.addEventListener('click', goJeux);
        return;
    }

    container.innerHTML = parties.slice(0, 20).map((p, i) => {
        const meta   = JEUX.find(j => j.id === p.jeu) || { icon: '🎮', nom: p.jeu || 'Partie' };
        const date   = p.createdAt ? new Date(p.createdAt).toLocaleDateString('fr-FR') : '';
        const joueurs = Object.keys(p.scores || {});
        const chips  = joueurs.slice(0, 4).map(j => `<span class="pc-joueur-chip">${j}</span>`).join('');
        const more   = joueurs.length > 4
            ? `<span class="pc-joueur-chip pc-joueur-more">+${joueurs.length - 4}</span>`
            : '';
        const statut = p.statut === 'terminee'
            ? `<span class="badge-statut badge-terminee">Terminée</span>`
            : `<span class="badge-statut badge-en-cours">En cours</span>`;

        return `
        <div class="partie-continue-card animate-in" style="animation-delay:${i * 0.05}s">
            <div class="partie-continue-icon">${meta.icon}</div>
            <div class="partie-continue-info">
                <div class="partie-continue-nom">${p.nom || meta.nom} ${statut}</div>
                <div class="partie-continue-meta">
                    <span>${meta.nom}</span>
                    ${date ? `<span>·</span><span>${date}</span>` : ''}
                    ${p.mode ? `<span>·</span><span>${p.mode === 'team' ? '🛡️ Équipes' : '👤 Solo'}</span>` : ''}
                </div>
                <div class="partie-continue-joueurs">${chips}${more}</div>
            </div>
            <div class="partie-continue-actions">
                <a href="/host/?resume=${encodeURIComponent(p.partieId || p.id)}" class="btn-primary btn-sm">▶ Reprendre</a>
                <button class="btn-ghost btn-sm btn-del-partie" data-idx="${i}" title="Supprimer">🗑</button>
            </div>
        </div>`;
    }).join('');

    container.querySelectorAll('.btn-del-partie').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!confirm('Supprimer cette partie de l\'historique local ?')) return;
            const idx = parseInt(btn.dataset.idx, 10);
            if (!Number.isNaN(idx)) {
                parties.splice(idx, 1);
                try { localStorage.setItem('mgu_parties', JSON.stringify(parties)); } catch {}
                renderPartiesContinuer();
            }
        });
    });
}

// ══════════════════════════════════════════════════════
// MENU LATÉRAL
// ══════════════════════════════════════════════════════

function ouvrirMenu() {
    if (elMenuOverlay) elMenuOverlay.hidden = false;
    if (elMenuPanel)   elMenuPanel.hidden   = false;
    document.body.style.overflow = 'hidden';
}

function fermerMenu() {
    if (elMenuOverlay) elMenuOverlay.hidden = true;
    if (elMenuPanel)   elMenuPanel.hidden   = true;
    document.body.style.overflow = '';
}

// ══════════════════════════════════════════════════════
// MUSIQUE DE FOND
// ══════════════════════════════════════════════════════

function toggleMusique() {
    if (!elBgMusic) return;
    musicPlaying = !musicPlaying;
    if (musicPlaying) {
        elBgMusic.volume = 0.35;
        elBgMusic.play().catch(() => { musicPlaying = false; });
        if (elBtnMusic) elBtnMusic.textContent = '🔊';
    } else {
        elBgMusic.pause();
        if (elBtnMusic) elBtnMusic.textContent = '🔇';
    }
}

// ══════════════════════════════════════════════════════
// INIT — DOM garanti disponible ici
// ══════════════════════════════════════════════════════

function init() {
    // ✅ FIX : capturer les éléments DOM ICI, pas au niveau module
    elBtnRetour    = $('btn-retour-permanent');
    elBtnHome      = $('btn-home-permanent');
    elBtnMenu      = $('btn-menu-permanent');
    elBreadcrumb   = $('topbar-breadcrumb');
    elBtnMusic     = $('toggle-music');
    elBgMusic      = $('bg-music');
    elMenuOverlay  = $('menu-overlay');
    elMenuPanel    = $('menu-panel');
    elBtnCloseMenu = $('btn-close-menu');

    SCREENS = {
        home:    $('screen-home'),
        jeux:    $('screen-jeux'),
        detail:  $('screen-jeu-detail'),
        parties: $('screen-parties'),
    };

    // ── Top-nav-bar ───────────────────────────────────────
    elBtnRetour?.addEventListener('click', retourContextuel);
    elBtnHome?.addEventListener('click', goHome);
    elBtnMenu?.addEventListener('click', ouvrirMenu);
    elBtnMusic?.addEventListener('click', toggleMusique);

    $$('.top-nav-bar .topbar-logo')?.addEventListener('click', e => {
        e.preventDefault();
        goHome();
    });

    // ── Menu latéral ──────────────────────────────────────
    elBtnCloseMenu?.addEventListener('click', fermerMenu);
    elMenuOverlay?.addEventListener('click', fermerMenu);

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') fermerMenu();
    });

    $('menu-reglages')?.addEventListener('click', () => {
        fermerMenu();
        // futur overlay réglages
    });

    // ✅ FIX : appel conditionnel — si le module stats n'est pas chargé,
    // on revient à l'accueil plutôt que de rien faire
    $('menu-home')?.addEventListener('click', () => {
        fermerMenu();
        if (typeof afficherStatistiques === 'function') {
            afficherStatistiques();
        } else {
            goHome();
        }
    });

    $('menu-parties')?.addEventListener('click', () => {
        fermerMenu();
        goParties();
    });

    $('menu-joueurs')?.addEventListener('click', () => {
        fermerMenu();
        if (typeof afficherGestionJoueurs === 'function') {
            afficherGestionJoueurs();
        } else {
            console.warn('[MAIN] menu/joueurs.js non chargé');
        }
    });

    $('menu-equipes')?.addEventListener('click', () => {
        fermerMenu();
        if (typeof afficherGestionEquipes === 'function') {
            afficherGestionEquipes();
        } else {
            console.warn('[MAIN] menu/equipes.js non chargé');
        }
    });

    // ── CTA accueil ───────────────────────────────────────
    $('btn-nouvelle-partie')?.addEventListener('click', () => goHost());
    $('btn-continuer')?.addEventListener('click', goParties);
    $('btn-voir-jeux')?.addEventListener('click', goJeux);
    $('btn-parties-nouvelle')?.addEventListener('click', () => goHost());

    // ── Boutons retour internes ───────────────────────────
    $('btn-retour-jeux')?.addEventListener('click', goHome);
    $('btn-retour-detail')?.addEventListener('click', goJeux);
    $('btn-retour-parties')?.addEventListener('click', goHome);

    // ── État initial ──────────────────────────────────────
    // screen-home est déjà visible dans le HTML (pas de hidden)
    // On masque les autres écrans proprement
    [SCREENS.jeux, SCREENS.detail, SCREENS.parties].forEach(el => {
        if (el) el.hidden = true;
    });
    currentScreen = 'home';
    if (elBtnRetour) elBtnRetour.hidden = true;
    renderStatsBar();
}

// ── Exposition pour les modules externes ──────────────────
window.renderPartiesContinuer = renderPartiesContinuer;
window.addEventListener('mgu:afficher-parties', () => goParties());

// ── Point d'entrée ────────────────────────────────────────
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}