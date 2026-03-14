// /public/js/main.js
// ======================================================
// 🏠 MAIN — Navigation MiniGame Universe
// ======================================================
// Changements v4.0 (gestion des parties locales) :
//
//   MODULE parties-store.js intégré
//   ─────────────────────────────────────────────────────
//   Toutes les lectures / écritures de mgu_parties passent
//   maintenant par les fonctions de parties-store.js.
//   Avantages :
//     - Structure canonique garantie
//     - Nettoyage automatique au chargement
//     - Tri intelligent (en_cours → lobby → terminée)
//     - Suppression par partieId (plus d'index fragile)
//     - Reprise fiable avec vérification serveur
//
//   RECHERCHE PAR NOM dans renderPartiesContinuer()
//   ─────────────────────────────────────────────────────
//   Un champ de recherche local filtre la liste sans
//   quitter la page. searchLocalParties() fait la
//   comparaison insensible à la casse.
//
//   NETTOYAGE AUTO au démarrage
//   ─────────────────────────────────────────────────────
//   cleanupLocalParties() est appelé dans init() pour
//   purger les entrées expirées / dupliquées dès l'ouverture.
//
//   REPRISE ROBUSTE via resumeFromLocal()
//   ─────────────────────────────────────────────────────
//   Le bouton ▶ Reprendre appelle resumeFromLocal() qui
//   vérifie le serveur avant de rediriger. Si la partie
//   est introuvable ou terminée, un message d'erreur clair
//   est affiché et l'entrée locale est mise à jour.
// ======================================================

import {
    getLocalParties,
    searchLocalParties,
    cleanupLocalParties,
    deleteLocalPartie,
    resumeFromLocal,
    getSortedLocalParties,
} from './core/parties-store.js';

// ── Imports optionnels — ne bloquent pas si les fichiers n'existent pas ──
let afficherStatistiques   = null;
let afficherGestionJoueurs = null;
let afficherGestionEquipes = null;

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

// ── Méta-données des jeux ─────────────────────────────
const JEUX = [
    {
        id: 'quiz',       nom: 'Quiz',           icon: '❓',
        desc: 'Questions & réponses en équipe ou en solo',
        joueurs: '2-10', duree: '15-30 min',
        regles: "Le host pose des questions à thème. Les joueurs répondent à l'oral. Points attribués par le host en temps réel.",
    },
    {
        id: 'justeprix',  nom: 'Juste Prix',      icon: '💰',
        desc: 'Devinez le prix exact sans dépasser',
        joueurs: '2-8',  duree: '20-40 min',
        regles: 'Un produit et son vrai prix sont affichés après les enchères. Le joueur le plus proche sans dépasser remporte les points.',
    },
    {
        id: 'undercover', nom: 'Undercover',      icon: '🕵️',
        desc: "Trouvez l'espion parmi vous",
        joueurs: '4-10', duree: '15-25 min',
        regles: "Chaque joueur reçoit un mot. Un imposteur reçoit un mot différent. Discutez pour débusquer l'intrus sans vous trahir.",
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
        regles: "Faites deviner un mot en le mimant ou en le dessinant, sans parler. Votre équipe marque un point si elle trouve avant le temps imparti.",
    },
    {
        id: 'pendu',      nom: 'Le Pendu',        icon: '🪢',
        desc: 'Devinez le mot lettre par lettre',
        joueurs: '2-8',  duree: '10-20 min',
        regles: "Trouvez le mot caché en proposant des lettres. Chaque lettre fausse rapproche le pendu. Trouvez avant d'épuiser vos tentatives.",
    },
    {
        id: 'petitbac',   nom: 'Petit Bac',       icon: '📝',
        desc: 'Une lettre, des catégories, le plus vite !',
        joueurs: '2-8',  duree: '15-30 min',
        regles: 'Une lettre est tirée. Trouvez le plus rapidement un mot par catégorie commençant par cette lettre.',
    },
    {
        id: 'memoire',    nom: 'Mémoire Flash',   icon: '🧠',
        desc: 'Mémorisez des séquences de plus en plus longues',
        joueurs: '1-6',  duree: '10-30 min',
        regles: "Une séquence de symboles est affichée brièvement. Reproduisez-la fidèlement. Chaque round la séquence s'allonge.",
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
        regles: 'Faites tomber vos jetons dans les colonnes. Alignez 4 jetons de votre couleur pour gagner.',
    },
];

// ── DOM helpers ───────────────────────────────────────────
const $  = id  => document.getElementById(id);
const $$ = sel => document.querySelector(sel);

function esc(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── État global ───────────────────────────────────────────
let currentScreen = 'home';
let currentJeu    = null;
let musicPlaying  = false;

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

// ─────────────────────────────────────────────────────
// ÉTAT LOCAL : recherche dans les parties
// ─────────────────────────────────────────────────────
let _partiesSearchQuery = '';
let _partiesResuming    = new Set(); // partieId en cours de vérification

// ══════════════════════════════════════════════════════
// NAVIGATION
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
    void el.offsetWidth;
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
                <span class="breadcrumb-label">${esc(label)}</span>`;
            $('bc-jeux')?.addEventListener('click', goJeux);
        } else if (screen === 'parties') {
            elBreadcrumb.innerHTML = `<span class="breadcrumb-label">📋 Mes parties</span>`;
        }
    }

    if (elBtnRetour) elBtnRetour.hidden = (screen === 'home');
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

function goDetail(jeuId) {
    const jeu = JEUX.find(j => j.id === jeuId);
    if (!jeu) return;
    currentJeu = jeu;
    renderDetail(jeu);
    showScreen('detail');
    updateNav('detail', jeu.nom);
}

function goParties() {
    _partiesSearchQuery = '';
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
// STATS BAR
// ══════════════════════════════════════════════════════

function renderStatsBar() {
    try {
        const parties = getLocalParties();

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
        // silencieux
    }
}

// ══════════════════════════════════════════════════════
// GRILLE DES JEUX
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
// DÉTAIL JEU
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
// PARTIES SAUVEGARDÉES
// ══════════════════════════════════════════════════════

/**
 * Rend la liste des parties sauvegardées localement.
 *
 * Fonctionnalités :
 *   - Champ de recherche par nom exact (filtre en temps réel)
 *   - Badges de statut colorés
 *   - Tri : en_cours → lobby → terminée, puis par lastSeen DESC
 *   - Reprise robuste : vérification serveur avant redirect
 *   - Suppression par partieId (stable même si liste réordonnée)
 *   - Message d'état si reprise en cours
 */
function renderPartiesContinuer() {
    const container = $('parties-continuer-list');
    if (!container) return;

    // ── Zone de recherche ──────────────────────────────
    _renderSearchBar(container);

    // ── Récupérer les parties ──────────────────────────
    let parties = getSortedLocalParties();

    // Appliquer le filtre de recherche
    const q = _partiesSearchQuery.trim().toLowerCase();
    if (q) {
        parties = parties.filter(p => (p.nom || '').toLowerCase() === q);
    }

    // ── Cas liste vide ────────────────────────────────
    if (parties.length === 0) {
        const listEl = $('parties-list-body') || document.createElement('div');
        listEl.id = 'parties-list-body';
        listEl.innerHTML = q
            ? `<div class="parties-vide">
                <div class="parties-vide-icon">🔍</div>
                <p>Aucune partie nommée <strong>"${esc(q)}"</strong> dans l'historique local.</p>
               </div>`
            : `<div class="parties-vide">
                <div class="parties-vide-icon">📋</div>
                <p>Aucune partie sauvegardée pour l'instant.</p>
                <button class="btn-secondary" id="btn-pv-jeux">Lancer une première partie</button>
               </div>`;
        // S'assurer que listEl est dans le container
        if (!$('parties-list-body')) container.appendChild(listEl);
        $('btn-pv-jeux')?.addEventListener('click', goJeux);
        return;
    }

    // ── Rendu des cartes ─────────────────────────────
    const listHTML = parties.slice(0, 20).map(p => _renderPartieCard(p)).join('');

    // Injecter dans le corps de liste (après la barre de recherche)
    let listEl = $('parties-list-body');
    if (!listEl) {
        listEl = document.createElement('div');
        listEl.id = 'parties-list-body';
        container.appendChild(listEl);
    }
    listEl.innerHTML = listHTML;

    // ── Attacher les handlers ─────────────────────────
    listEl.querySelectorAll('.btn-reprendre').forEach(btn => {
        btn.addEventListener('click', () => {
            const partieId = btn.dataset.partieId;
            const partie   = parties.find(p => p.partieId === partieId);
            if (partie) _handleReprendre(btn, partie);
        });
    });

    listEl.querySelectorAll('.btn-del-partie').forEach(btn => {
        btn.addEventListener('click', () => {
            const partieId = btn.dataset.partieId;
            if (!confirm("Supprimer cette partie de l'historique local ?")) return;
            deleteLocalPartie(partieId);
            renderPartiesContinuer();
        });
    });
}

/**
 * Génère le HTML de la barre de recherche et l'injecte dans container.
 * Ne crée la barre qu'une seule fois.
 */
function _renderSearchBar(container) {
    if ($('parties-search-bar')) return; // déjà présente

    const bar = document.createElement('div');
    bar.id = 'parties-search-bar';
    bar.style.cssText = 'display:flex;gap:.5rem;margin-bottom:1rem;';
    bar.innerHTML = `
        <input
            id="parties-search-input"
            type="text"
            placeholder="Rechercher par nom exact…"
            autocomplete="off"
            style="flex:1;padding:.55rem .85rem;border-radius:8px;border:1px solid rgba(255,255,255,.1);
                   background:rgba(255,255,255,.05);color:inherit;font-size:.9rem;outline:none;"
            value="${esc(_partiesSearchQuery)}"
        >
        <button id="parties-search-btn" class="btn-secondary btn-sm"
            style="flex-shrink:0;padding:.5rem .9rem;">🔍</button>
        ${_partiesSearchQuery
            ? `<button id="parties-search-clear" class="btn-ghost btn-sm"
                style="flex-shrink:0;padding:.5rem .9rem;">✕</button>`
            : ''}`;

    container.prepend(bar);

    const input = $('parties-search-input');
    const doSearch = () => {
        _partiesSearchQuery = input?.value || '';
        // Supprimer puis recréer le corps de liste (pas la barre)
        const old = $('parties-list-body');
        if (old) old.remove();
        renderPartiesContinuer();
    };

    input?.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    $('parties-search-btn')?.addEventListener('click', doSearch);
    $('parties-search-clear')?.addEventListener('click', () => {
        _partiesSearchQuery = '';
        renderPartiesContinuer();
    });
}

/**
 * Génère le HTML d'une carte de partie.
 */
function _renderPartieCard(p) {
    const meta    = JEUX.find(j => j.id === p.jeu) || { icon: '🎮', nom: p.jeu || 'Partie' };
    const date    = _formatDate(p.lastSeen || p.savedAt || p.createdAt);
    const joueurs = (p.joueurs || []);
    const chips   = joueurs.slice(0, 4)
        .map(j => `<span class="pc-joueur-chip">${esc(j.pseudo || j)}</span>`).join('');
    const more    = joueurs.length > 4
        ? `<span class="pc-joueur-chip pc-joueur-more">+${joueurs.length - 4}</span>`
        : '';

    const statutBadge = _statutBadge(p.statut);
    const isResuming  = _partiesResuming.has(p.partieId);

    const reprendreLabel = isResuming ? '⏳ Vérification…' : '▶ Reprendre';
    const reprendreDisabled = isResuming ? 'disabled' : '';

    return `
    <div class="partie-continue-card animate-in" data-partie-id="${esc(p.partieId)}">
        <div class="partie-continue-icon">${meta.icon}</div>
        <div class="partie-continue-info">
            <div class="partie-continue-nom">
                ${esc(p.nom || meta.nom)}
                ${statutBadge}
            </div>
            <div class="partie-continue-meta">
                <span>${meta.nom}</span>
                ${date ? `<span>·</span><span>${date}</span>` : ''}
                ${p.mode ? `<span>·</span><span>${p.mode === 'team' ? '🛡️ Équipes' : '👤 Solo'}</span>` : ''}
                ${p.code ? `<span>·</span><span class="partie-code-badge">🔑 ${esc(p.code)}</span>` : ''}
            </div>
            <div class="partie-continue-joueurs">${chips}${more}</div>
        </div>
        <div class="partie-continue-actions">
            <button
                class="btn-primary btn-sm btn-reprendre"
                data-partie-id="${esc(p.partieId)}"
                ${reprendreDisabled}
            >${reprendreLabel}</button>
            <button
                class="btn-ghost btn-sm btn-del-partie"
                data-partie-id="${esc(p.partieId)}"
                title="Supprimer de l'historique"
            >🗑</button>
        </div>
    </div>`;
}

/**
 * Badge HTML coloré selon le statut.
 */
function _statutBadge(statut) {
    const map = {
        en_cours : ['badge-statut badge-en-cours',  'En cours'],
        started  : ['badge-statut badge-en-cours',  'En cours'],
        lobby    : ['badge-statut badge-lobby',      'Lobby'],
        waiting  : ['badge-statut badge-lobby',      'Lobby'],
        terminee : ['badge-statut badge-terminee',   'Terminée'],
        ended    : ['badge-statut badge-terminee',   'Terminée'],
    };
    const [cls, label] = map[statut] || ['badge-statut', statut || '?'];
    return `<span class="${cls}">${label}</span>`;
}

/**
 * Formate un timestamp en date courte française.
 */
function _formatDate(ts) {
    if (!ts) return '';
    try {
        return new Date(ts).toLocaleDateString('fr-FR', {
            day: '2-digit', month: 'short',
        });
    } catch { return ''; }
}

/**
 * Gère le clic sur "▶ Reprendre".
 * Affiche un état de chargement, vérifie le serveur, redirige ou affiche une erreur.
 */
async function _handleReprendre(btn, partie) {
    if (_partiesResuming.has(partie.partieId)) return;

    _partiesResuming.add(partie.partieId);
    btn.disabled    = true;
    btn.textContent = '⏳ Vérification…';

    try {
        const result = await resumeFromLocal(partie);

        if (result.ok && result.url) {
            window.location.href = result.url;
            return; // navigation en cours
        }

        // Erreur — mettre à jour la carte
        const msgs = {
            not_found : '⚠️ Partie introuvable sur le serveur.',
            ended     : '🏁 Cette partie est déjà terminée.',
            invalid   : '❌ Données invalides.',
        };
        const msg = msgs[result.reason] || `❌ Erreur : ${result.reason}`;
        _showCardError(partie.partieId, msg);
        renderPartiesContinuer(); // rafraîchir pour refléter le nouveau statut

    } catch (err) {
        _showCardError(partie.partieId, '❌ Erreur réseau.');
    } finally {
        _partiesResuming.delete(partie.partieId);
    }
}

/**
 * Affiche un message d'erreur inline dans la carte.
 */
function _showCardError(partieId, msg) {
    const card = document.querySelector(`.partie-continue-card[data-partie-id="${CSS.escape(partieId)}"]`);
    if (!card) return;

    const existing = card.querySelector('.partie-resume-error');
    if (existing) existing.remove();

    const el = document.createElement('p');
    el.className = 'partie-resume-error';
    el.style.cssText = 'color:#f87171;font-size:.8rem;margin:.4rem 0 0;grid-column:1/-1;';
    el.textContent = msg;
    card.appendChild(el);
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
// MUSIQUE
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
// INIT
// ══════════════════════════════════════════════════════

function init() {
    // ── Nettoyage automatique au démarrage ────────────
    // Supprime les entrées expirées / dupliquées sans bloquer l'UI
    setTimeout(() => cleanupLocalParties(), 500);

    // ── Références DOM ────────────────────────────────
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
        home    : $('screen-home'),
        jeux    : $('screen-jeux'),
        detail  : $('screen-jeu-detail'),
        parties : $('screen-parties'),
    };

    // ── Top-nav-bar ───────────────────────────────────
    elBtnRetour?.addEventListener('click', retourContextuel);
    elBtnHome?.addEventListener('click', goHome);
    elBtnMenu?.addEventListener('click', ouvrirMenu);
    elBtnMusic?.addEventListener('click', toggleMusique);

    $$('.top-nav-bar .topbar-logo')?.addEventListener('click', e => {
        e.preventDefault();
        goHome();
    });

    // ── Menu latéral ──────────────────────────────────
    elBtnCloseMenu?.addEventListener('click', fermerMenu);
    elMenuOverlay?.addEventListener('click', fermerMenu);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') fermerMenu(); });

    $('menu-reglages')?.addEventListener('click', () => { fermerMenu(); });

    $('menu-home')?.addEventListener('click', () => {
        fermerMenu();
        if (typeof afficherStatistiques === 'function') {
            afficherStatistiques();
        } else {
            goHome();
        }
    });

    $('menu-parties')?.addEventListener('click', () => { fermerMenu(); goParties(); });

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

    // ── CTA accueil ───────────────────────────────────
    $('btn-nouvelle-partie')?.addEventListener('click', () => goHost());
    $('btn-continuer')?.addEventListener('click', goParties);
    $('btn-voir-jeux')?.addEventListener('click', goJeux);
    $('btn-parties-nouvelle')?.addEventListener('click', () => goHost());

    // ── Boutons retour internes ───────────────────────
    $('btn-retour-jeux')?.addEventListener('click', goHome);
    $('btn-retour-detail')?.addEventListener('click', goJeux);
    $('btn-retour-parties')?.addEventListener('click', goHome);

    // ── État initial ──────────────────────────────────
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