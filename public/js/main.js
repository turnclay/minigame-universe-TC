// /public/js/main.js
// ======================================================
// 🏠 MAIN — Navigation MiniGame Universe
// Gère : top-nav-bar permanente, menu latéral (☰ uniquement),
//        routing entre écrans, breadcrumb, musique
// ======================================================

import { afficherStatistiques }   from './menu/statistiques.js';
import { afficherGestionJoueurs } from './menu/joueurs.js';
import { afficherGestionEquipes } from './menu/equipes.js';

// ── Données des jeux ─────────────────────────────────────
const JEUX = [
    { id: 'quiz',       nom: 'Quiz',           icon: '❓', desc: 'Questions & réponses',  joueurs: '2-10', duree: '15-30 min',
      regles: 'Le host pose des questions à thème. Les joueurs répondent à l\'oral. Points attribués par le host.' },
    { id: 'justeprix',  nom: 'Juste Prix',      icon: '💰', desc: 'Devinez le prix',       joueurs: '2-8',  duree: '20-40 min',
      regles: 'Un produit est affiché. Les joueurs proposent un prix. Le plus proche sans dépasser gagne.' },
    { id: 'undercover', nom: 'Undercover',      icon: '🕵️', desc: 'Trouvez les espions',   joueurs: '4-10', duree: '15-25 min',
      regles: 'Chaque joueur reçoit un mot. Un imposteur a un mot différent. Discutez sans vous trahir.' },
    { id: 'lml',        nom: 'Maxi Lettres',    icon: '📖', desc: 'Formez le plus long mot', joueurs: '2-8', duree: '10-20 min',
      regles: 'Des lettres sont tirées. Formez le mot le plus long possible avec ces lettres.' },
    { id: 'mimer',      nom: 'Mimer/Dessiner',  icon: '🎭', desc: 'Mimez ou dessinez',     joueurs: '4-12', duree: '20-40 min',
      regles: 'Faites deviner un mot en mimant ou dessinant, sans parler.' },
    { id: 'pendu',      nom: 'Le Pendu',        icon: '🪢', desc: 'Devinez le mot',        joueurs: '2-8',  duree: '10-20 min',
      regles: 'Trouvez le mot caché lettre par lettre avant d\'épuiser vos tentatives.' },
    { id: 'petitbac',   nom: 'Petit Bac',       icon: '📝', desc: 'Catégories & lettres',  joueurs: '2-8',  duree: '15-30 min',
      regles: 'Une lettre est tirée. Trouvez un mot par catégorie commençant par cette lettre.' },
    { id: 'memoire',    nom: 'Mémoire Flash',   icon: '🧠', desc: 'Testez votre mémoire',  joueurs: '1-6',  duree: '10-30 min',
      regles: 'Mémorisez des séquences de plus en plus longues. Reproduisez-les fidèlement.' },
    { id: 'morpion',    nom: 'Morpion',         icon: '⭕', desc: 'Alignez 3 symboles',   joueurs: '2',    duree: '5-10 min',
      regles: 'Placez vos symboles en alternance. Alignez 3 en ligne, colonne ou diagonale.' },
    { id: 'puissance4', nom: 'Puissance 4',     icon: '🔴', desc: 'Alignez 4 jetons',     joueurs: '2',    duree: '10-15 min',
      regles: 'Faites tomber vos jetons dans la grille. Alignez 4 jetons de votre couleur.' },
];

const JEU_PATHS = {
    quiz:'/games/quiz/', justeprix:'/games/justeprix/', undercover:'/games/undercover/',
    lml:'/games/lml/', mimer:'/games/mimer/', pendu:'/games/pendu/',
    petitbac:'/games/petitbac/', memoire:'/games/memoire/',
    morpion:'/games/morpion/', puissance4:'/games/puissance4/',
};

// ── Éléments DOM ─────────────────────────────────────────
const $  = id => document.getElementById(id);
const $$ = sel => document.querySelector(sel);

// Nav bar
const elBtnRetour    = $('btn-retour-permanent');
const elBtnHome      = $('btn-home-permanent');
const elBtnMenu      = $('btn-menu-permanent');
const elBreadcrumb   = $('topbar-breadcrumb');
const elBtnMusic     = $('toggle-music');
const elBgMusic      = $('bg-music');

// Menu latéral
const elMenuOverlay  = $('menu-overlay');
const elMenuPanel    = $('menu-panel');
const elBtnCloseMenu = $('btn-close-menu');

// Écrans
const SCREENS = {
    home:    $('screen-home'),
    jeux:    $('screen-jeux'),
    detail:  $('screen-jeu-detail'),
    parties: $('screen-parties'),
};

// ── State ────────────────────────────────────────────────
let currentScreen = 'home';
let currentJeu    = null;
let musicPlaying  = false;

// ══════════════════════════════════════════════════════
// NAVIGATION ÉCRANS
// ══════════════════════════════════════════════════════

function hideAllScreens() {
    Object.values(SCREENS).forEach(el => { if (el) el.hidden = true; });
}

function showScreen(name) {
    hideAllScreens();
    const el = SCREENS[name];
    if (!el) return;
    el.hidden = false;
    el.classList.remove('animate-in');
    void el.offsetWidth; // reflow pour relancer l'animation
    el.classList.add('animate-in');
}

function updateNav(screen, label = null) {
    currentScreen = screen;

    // Breadcrumb
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

    // Bouton ⬅ retour — caché uniquement sur home
    if (elBtnRetour) elBtnRetour.hidden = (screen === 'home');
}

// ── Destinations ─────────────────────────────────────────
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

// Exposé globalement pour les modules menu/parties.js
window.renderPartiesContinuer = renderPartiesContinuer;
window.addEventListener('mgu:afficher-parties', () => goParties());

// Retour contextuel (bouton ⬅)
function retourContextuel() {
    if (currentScreen === 'detail')  return goJeux();
    if (currentScreen === 'jeux')    return goHome();
    if (currentScreen === 'parties') return goHome();
    goHome();
}

// ══════════════════════════════════════════════════════
// RENDU — Stats bar accueil
// ══════════════════════════════════════════════════════
function renderStatsBar() {
    try {
        const parties = JSON.parse(localStorage.getItem('mgu_parties') || '[]');
        const joueurs = JSON.parse(localStorage.getItem('mgu_joueurs') || '[]');
        const elP = $('stat-parties');
        const elJ = $('stat-joueurs');
        if (elP) elP.textContent = parties.length;
        if (elJ) elJ.textContent = joueurs.length;
    } catch {}
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

    container.querySelectorAll('.jeu-card').forEach(btn =>
        btn.addEventListener('click', () => goDetail(btn.dataset.id)));
}

// ══════════════════════════════════════════════════════
// RENDU — Détail jeu
// ══════════════════════════════════════════════════════
function renderDetail(jeu) {
    const hero    = $('detail-hero-content');
    const regles  = $('detail-regles-content');
    const actions = $('detail-actions');

    if (hero) hero.innerHTML = `
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

    if (regles) regles.textContent = jeu.regles;

    if (actions) actions.innerHTML = `
        <a href="/host/?jeu=${jeu.id}" class="btn-primary btn-full btn-hero">🎮 Lancer une partie</a>
        <a href="${JEU_PATHS[jeu.id] || '#'}" class="btn-secondary btn-full">👁 Mode solo</a>`;
}

// ══════════════════════════════════════════════════════
// RENDU — Parties à continuer
// ══════════════════════════════════════════════════════
function renderPartiesContinuer() {
    const container = $('parties-continuer-list');
    if (!container) return;

    let parties = [];
    try { parties = JSON.parse(localStorage.getItem('mgu_parties') || '[]'); } catch {}
    parties.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    if (parties.length === 0) {
        container.innerHTML = `
            <div class="parties-vide">
                <div class="parties-vide-icon">📋</div>
                <p>Aucune partie enregistrée pour l'instant.</p>
                <button class="btn-secondary" id="btn-pv-jeux">Lancer une partie</button>
            </div>`;
        $('btn-pv-jeux')?.addEventListener('click', goJeux);
        return;
    }

    container.innerHTML = parties.slice(0, 20).map((p, i) => {
        const meta  = JEUX.find(j => j.id === p.jeu) || { icon: '🎮', nom: p.jeu || 'Partie' };
        const jours = p.createdAt ? new Date(p.createdAt).toLocaleDateString('fr-FR') : '';
        const joueurs = Object.keys(p.scores || {});
        const chips = joueurs.slice(0, 4).map(j => `<span class="pc-joueur-chip">${j}</span>`).join('');
        const more  = joueurs.length > 4 ? `<span class="pc-joueur-chip pc-joueur-more">+${joueurs.length - 4}</span>` : '';

        return `
        <div class="partie-continue-card animate-in" style="animation-delay:${i * 0.05}s">
            <div class="partie-continue-icon">${meta.icon}</div>
            <div class="partie-continue-info">
                <div class="partie-continue-nom">${p.nom || meta.nom}</div>
                <div class="partie-continue-meta">
                    <span>${meta.nom}</span>
                    ${jours ? `<span>·</span><span>${jours}</span>` : ''}
                    ${p.mode ? `<span>·</span><span>${p.mode}</span>` : ''}
                </div>
                <div class="partie-continue-joueurs">${chips}${more}</div>
            </div>
            <div class="partie-continue-actions">
                <a href="/host/?resume=${p.id}" class="btn-primary btn-sm">▶ Reprendre</a>
                <button class="btn-ghost btn-sm" data-del="${i}" title="Supprimer">🗑</button>
            </div>
        </div>`;
    }).join('');

    container.querySelectorAll('[data-del]').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.del);
            parties.splice(idx, 1);
            try { localStorage.setItem('mgu_parties', JSON.stringify(parties)); } catch {}
            renderPartiesContinuer();
        });
    });
}

// ══════════════════════════════════════════════════════
// MENU LATÉRAL — s'ouvre UNIQUEMENT via le bouton ☰
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
// MUSIQUE
// ══════════════════════════════════════════════════════
function toggleMusique() {
    if (!elBgMusic) return;
    musicPlaying = !musicPlaying;
    if (musicPlaying) {
        elBgMusic.play().catch(() => { musicPlaying = false; });
        if (elBtnMusic) elBtnMusic.textContent = '🔊';
    } else {
        elBgMusic.pause();
        if (elBtnMusic) elBtnMusic.textContent = '🔇';
    }
}

// ══════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════
function init() {

    // ── Top-nav-bar ────────────────────────────────────
    elBtnRetour?.addEventListener('click', retourContextuel);
    elBtnHome?.addEventListener('click', goHome);
    elBtnMenu?.addEventListener('click', ouvrirMenu);
    elBtnMusic?.addEventListener('click', toggleMusique);
    $$('.top-nav-bar .topbar-logo')?.addEventListener('click', goHome);

    // ── Menu latéral ───────────────────────────────────
    // Le panneau est hidden="true" dans le HTML → invisible au chargement
    elBtnCloseMenu?.addEventListener('click', fermerMenu);
    elMenuOverlay?.addEventListener('click', fermerMenu);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') fermerMenu(); });

    // Items du menu latéral
    $('menu-reglages')?.addEventListener('click', () => { fermerMenu(); /* TODO réglages */ });
    $('menu-home')?.addEventListener('click',     () => { fermerMenu(); afficherStatistiques(); });
    $('menu-parties')?.addEventListener('click',  () => { fermerMenu(); goParties(); });
    $('menu-joueurs')?.addEventListener('click',  () => { fermerMenu(); afficherGestionJoueurs(); });
    $('menu-equipes')?.addEventListener('click',  () => { fermerMenu(); afficherGestionEquipes(); });

    // ── Boutons page d'accueil ─────────────────────────
    // "Voir tous les jeux" → grille des jeux (masque home)
    $('btn-voir-jeux')?.addEventListener('click', goJeux);
    // "Continuer une partie" → liste parties (masque home)
    $('btn-continuer')?.addEventListener('click', goParties);

    // ── Boutons de retour dans les écrans internes ─────
    $('btn-retour-jeux')?.addEventListener('click',    goHome);
    $('btn-retour-detail')?.addEventListener('click',  goJeux);
    $('btn-retour-parties')?.addEventListener('click', goHome);

    // ── État initial : accueil ─────────────────────────
    goHome();
}

document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();