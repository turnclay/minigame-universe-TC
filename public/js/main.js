// /public/js/main.js
// ======================================================
// 🏠 MAIN — Navigation MiniGame Universe (Optimisé Render)
// ======================================================

import { afficherStatistiques }   from './menu/statistiques.js';
import { afficherGestionJoueurs } from './menu/joueurs.js';
import { afficherGestionEquipes } from './menu/equipes.js';

// ───────────────────────────────────────────────────────
// Données des jeux
// ───────────────────────────────────────────────────────
const JEUX = [
  { id:'quiz', nom:'Quiz', icon:'❓', desc:'Questions & réponses en équipe ou en solo', joueurs:'2-10', duree:'15-30 min',
    regles:`Le host pose des questions à thème. Les joueurs répondent à l'oral.` },
  { id:'justeprix', nom:'Juste Prix', icon:'💰', desc:'Devinez le prix exact sans dépasser', joueurs:'2-8', duree:'20-40 min',
    regles:`Un produit et son vrai prix sont affichés après les enchères.` },
  { id:'undercover', nom:'Undercover', icon:'🕵️', desc:'Trouvez l'espion parmi vous', joueurs:'4-10', duree:'15-25 min',
    regles:`Chaque joueur reçoit un mot. Un imposteur reçoit un mot différent.` },
  { id:'lml', nom:'Maxi Lettres', icon:'📖', desc:'Formez le mot le plus long possible', joueurs:'2-8', duree:'10-20 min',
    regles:`Des lettres aléatoires sont tirées. Formez le mot le plus long.` },
  { id:'mimer', nom:'Mimer/Dessiner', icon:'🎭', desc:'Faites deviner sans parler', joueurs:'4-12', duree:'20-40 min',
    regles:`Mimez ou dessinez un mot sans parler.` },
  { id:'pendu', nom:'Le Pendu', icon:'🪢', desc:'Devinez le mot lettre par lettre', joueurs:'2-8', duree:'10-20 min',
    regles:`Trouvez le mot caché avant d'épuiser les tentatives.` },
  { id:'petitbac', nom:'Petit Bac', icon:'📝', desc:'Une lettre, des catégories, le plus vite !', joueurs:'2-8', duree:'15-30 min',
    regles:`Une lettre est tirée. Trouvez un mot par catégorie.` },
  { id:'memoire', nom:'Mémoire Flash', icon:'🧠', desc:'Mémorisez des séquences', joueurs:'1-6', duree:'10-30 min',
    regles:`Reproduisez une séquence de symboles qui s'allonge.` },
  { id:'morpion', nom:'Morpion', icon:'⭕', desc:'Alignez 3 symboles', joueurs:'2', duree:'5-10 min',
    regles:`Alignez 3 symboles identiques sur la grille.` },
  { id:'puissance4', nom:'Puissance 4', icon:'🔴', desc:'Alignez 4 jetons', joueurs:'2', duree:'10-15 min',
    regles:`Faites tomber vos jetons pour aligner 4.` }
];

// ───────────────────────────────────────────────────────
// Helpers DOM
// ───────────────────────────────────────────────────────
const $  = id  => document.getElementById(id);
const $$ = sel => document.querySelector(sel);

// ───────────────────────────────────────────────────────
// Références DOM
// ───────────────────────────────────────────────────────
const elBtnRetour    = $('btn-retour-permanent');
const elBtnHome      = $('btn-home-permanent');
const elBtnMenu      = $('btn-menu-permanent');
const elBreadcrumb   = $('topbar-breadcrumb');
const elBtnMusic     = $('toggle-music');
const elBgMusic      = $('bg-music');

const elMenuOverlay  = $('menu-overlay');
const elMenuPanel    = $('menu-panel');
const elBtnCloseMenu = $('btn-close-menu');

const SCREENS = {
  home:    $('screen-home'),
  jeux:    $('screen-jeux'),
  detail:  $('screen-jeu-detail'),
  parties: $('screen-parties'),
};

let currentScreen = 'home';
let currentJeu    = null;
let musicPlaying  = false;

// ══════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════
function hideAllScreens() {
  Object.values(SCREENS).forEach(el => el.hidden = true);
}

function showScreen(name) {
  hideAllScreens();
  const el = SCREENS[name];
  if (!el) return;

  el.hidden = false;
  el.classList.remove('animate-in');
  void el.offsetWidth;
  el.classList.add('animate-in');
  window.scrollTo({ top: 0 });
}

function updateNav(screen, label = null) {
  currentScreen = screen;

  if (screen === 'home') {
    elBreadcrumb.innerHTML = '';
  } else if (screen === 'jeux') {
    elBreadcrumb.innerHTML = `<span class="breadcrumb-label">🎮 Tous les jeux</span>`;
  } else if (screen === 'detail') {
    elBreadcrumb.innerHTML = `
      <button class="breadcrumb-back" id="bc-jeux">🎮 Jeux</button>
      <span class="breadcrumb-sep">›</span>
      <span class="breadcrumb-label">${label}</span>`;
    $('bc-jeux')?.addEventListener('click', goJeux);
  } else if (screen === 'parties') {
    elBreadcrumb.innerHTML = `<span class="breadcrumb-label">📋 Mes parties</span>`;
  }

  elBtnRetour.hidden = (screen === 'home');
}

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

function goDetail(id) {
  const jeu = JEUX.find(j => j.id === id);
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

function retourContextuel() {
  if (currentScreen === 'detail') return goJeux();
  if (currentScreen === 'jeux')   return goHome();
  if (currentScreen === 'parties')return goHome();
  goHome();
}

// ══════════════════════════════════════════════════════
// RENDU — Stats accueil
// ══════════════════════════════════════════════════════
function renderStatsBar() {
  const parties = JSON.parse(localStorage.getItem('mgu_parties') || '[]');
  const joueurs = JSON.parse(localStorage.getItem('mgu_joueurs') || '[]');

  const totalPts = parties.reduce((sum, p) =>
    sum + Object.values(p.scores || {}).reduce((s, v) => s + (v || 0), 0)
  , 0);

  $('stat-parties').textContent = parties.length;
  $('stat-joueurs').textContent = joueurs.length;
  $('stat-points').textContent  = totalPts;
}

// ══════════════════════════════════════════════════════
// RENDU — Grille des jeux
// ══════════════════════════════════════════════════════
function renderJeuxGrid() {
  const container = $('jeux-grid-container');
  container.innerHTML = JEUX.map(j => `
    <button class="jeu-card" data-id="${j.id}">
      <div class="jeu-icon">${j.icon}</div>
      <div class="jeu-name">${j.nom}</div>
      <div class="jeu-desc">${j.desc}</div>
      <div class="jeu-meta">
        <span>👥 ${j.joueurs}</span>
        <span>⏱ ${j.duree}</span>
      </div>
    </button>
  `).join('');

  container.querySelectorAll('.jeu-card').forEach(btn =>
    btn.addEventListener('click', () => goDetail(btn.dataset.id))
  );
}

// ══════════════════════════════════════════════════════
// RENDU — Détail d’un jeu
// ══════════════════════════════════════════════════════
function renderDetail(j) {
  $('detail-hero-content').innerHTML = `
    <div class="detail-icon">${j.icon}</div>
    <div class="detail-nom">${j.nom}</div>
    <div class="detail-desc">${j.desc}</div>
    <div class="detail-infos">
      <div><span>👥</span> ${j.joueurs}</div>
      <div><span>⏱</span> ${j.duree}</div>
    </div>
  `;

  $('detail-regles-content').textContent = j.regles;

  $('detail-actions').innerHTML = `
    <a href="/host/?jeu=${j.id}" class="btn-primary btn-full btn-hero">🚀 Lancer une partie</a>
    <a href="/games/${j.id}/" class="btn-secondary btn-full">👁 Aperçu solo / démo</a>
  `;
}

// ══════════════════════════════════════════════════════
// RENDU — Parties sauvegardées
// ══════════════════════════════════════════════════════
function renderPartiesContinuer() {
  const container = $('parties-continuer-list');
  let parties = JSON.parse(localStorage.getItem('mgu_parties') || '[]');

  if (parties.length === 0) {
    container.innerHTML = `
      <div class="parties-vide">
        <div class="parties-vide-icon">📋</div>
        <p>Aucune partie sauvegardée.</p>
        <button class="btn-secondary" id="btn-pv-jeux">Lancer une première partie</button>
      </div>`;
    $('btn-pv-jeux')?.addEventListener('click', goJeux);
    return;
  }

  parties.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  container.innerHTML = parties.map((p, i) => {
    const meta = JEUX.find(j => j.id === p.jeu) || { icon:'🎮', nom:p.jeu };
    const date = p.createdAt ? new Date(p.createdAt).toLocaleDateString('fr-FR') : '';
    const joueurs = Object.keys(p.scores || {});
    const chips = joueurs.slice(0,4).map(j => `<span class="pc-joueur-chip">${j}</span>`).join('');
    const more  = joueurs.length > 4 ? `<span class="pc-joueur-chip pc-joueur-more">+${joueurs.length-4}</span>` : '';

    return `
      <div class="partie-continue-card animate-in" style="animation-delay:${i*0.05}s">
        <div class="partie-continue-icon">${meta.icon}</div>
        <div class="partie-continue-info">
          <div class="partie-continue-nom">${p.nom || meta.nom}</div>
          <div class="partie-continue-meta">
            <span>${meta.nom}</span>
            ${date ? `<span>·</span><span>${date}</span>` : ''}
          </div>
          <div class="partie-continue-joueurs">${chips}${more}</div>
        </div>
        <div class="partie-continue-actions">
          <a href="/host/?resume=${encodeURIComponent(p.partieId || p.id)}" class="btn-primary btn-sm">▶ Reprendre</a>
          <button class="btn-ghost btn-sm btn-del-partie" data-idx="${i}">🗑</button>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.btn-del-partie').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Supprimer cette partie ?')) return;
      const idx = parseInt(btn.dataset.idx);
      parties.splice(idx, 1);
      localStorage.setItem('mgu_parties', JSON.stringify(parties));
      renderPartiesContinuer();
    });
  });
}

// ══════════════════════════════════════════════════════
// MENU LATÉRAL
// ══════════════════════════════════════════════════════
function ouvrirMenu() {
  elMenuOverlay.hidden = false;
  elMenuPanel.hidden   = false;
  document.body.style.overflow = 'hidden';
}

function fermerMenu() {
  elMenuOverlay.hidden = true;
  elMenuPanel.hidden   = true;
  document.body.style.overflow = '';
}

// ══════════════════════════════════════════════════════
// MUSIQUE
// ══════════════════════════════════════════════════════
function toggleMusique() {
  musicPlaying = !musicPlaying;

  if (musicPlaying) {
    elBgMusic.volume = 0.35;
    elBgMusic.play().catch(() => musicPlaying = false);
    elBtnMusic.textContent = '🔊';
  } else {
    elBgMusic.pause();
    elBtnMusic.textContent = '🔇';
  }
}

// ══════════════════════════════════════════════════════
// INIT — Optimisé pour Render
// ══════════════════════════════════════════════════════
function init() {
  // Navigation
  elBtnRetour.addEventListener('click', retourContextuel);
  elBtnHome.addEventListener('click', goHome);
  elBtnMenu.addEventListener('click', ouvrirMenu);
  elBtnMusic.addEventListener('click', toggleMusique);

  $$('.top-nav-bar .topbar-logo')?.addEventListener('click', e => {
    e.preventDefault();
    goHome();
  });

  // Menu latéral
  elBtnCloseMenu.addEventListener('click', fermerMenu);
  elMenuOverlay.addEventListener('click', fermerMenu);
  document.addEventListener('keydown', e => e.key === 'Escape' && fermerMenu());

  $('menu-reglages')?.addEventListener('click', fermerMenu);
  $('menu-home')?.addEventListener('click', () => { fermerMenu(); afficherStatistiques(); });
  $('menu-parties')?.addEventListener('click', () => { fermerMenu(); goParties(); });
  $('menu-joueurs')?.addEventListener('click', () => { fermerMenu(); afficherGestionJoueurs(); });
  $('menu-equipes')?.addEventListener('click', () => { fermerMenu(); afficherGestionEquipes(); });

  // CTA accueil
  $('btn-voir-jeux')?.addEventListener('click', goJeux);
  $('btn-continuer')?.addEventListener('click', goParties);

  // Affichage initial
  goHome();
}

// ══════════════════════════════════════════════════════
// Lancement — robuste pour Render
// ══════════════════════════════════════════════════════
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}