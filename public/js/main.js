// /public/js/main.js  — v4.1
// ======================================================
// 🏠 MAIN — Navigation MiniGame Universe
// ======================================================
// Corrections v4.1 :
//
//   BUG CORRIGÉ — Bouton "Reprendre" → mauvaise destination
//   ─────────────────────────────────────────────────────
//   Avant : href="/host/?resume=..."
//   Le host reprend sa partie via /host/, mais un joueur
//   qui clique depuis "Mes parties" doit aller sur /join/
//   pour choisir son pseudo et rejoindre la bonne partie.
//   → Lien corrigé : href="/join/?resume=..."
//
//   AMÉLIORATION — Suppression par partieId (stable)
//   ─────────────────────────────────────────────────────
//   Avant : suppression par index numérique fragile
//   (l'index change si la liste est réordonnée)
//   → Suppression par partieId, stable quel que soit l'ordre.
//
//   AMÉLIORATION — Badges de statut complets
//   ─────────────────────────────────────────────────────
//   Ajout du badge "Lobby" pour les parties en attente,
//   en plus de "En cours" et "Terminée".
//
//   AMÉLIORATION — Nettoyage auto au chargement
//   ─────────────────────────────────────────────────────
//   cleanupLocalParties() retirera automatiquement les
//   entrées expirées ou dupliquées au démarrage.
//
//   TOUT LE RESTE EST INCHANGÉ (navigation, jeux, menu…)
// ======================================================

// ── Imports optionnels ────────────────────────────────
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

// ── Méta-données des 10 jeux ─────────────────────────────
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
        regles: "Trouvez le mot caché en proposant des lettres. Chaque lettre fausse rapproche le pendu.",
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
        regles: "Une séquence de symboles est affichée brièvement. Reproduisez-la fidèlement.",
    },
    {
        id: 'morpion',    nom: 'Morpion',         icon: '⭕',
        desc: 'Alignez 3 symboles en ligne, colonne ou diagonale',
        joueurs: '2',    duree: '5-10 min',
        regles: 'Placez vos symboles (X ou O) à tour de rôle sur la grille 3×3. Alignez 3 identiques en premier pour gagner.',
    },
    {
        id: 'puissance4', nom: 'Puissance 4',     icon: '🔴',
        desc: 'Alignez 4 jetons avant votre adversaire',
        joueurs: '2',    duree: '10-15 min',
        regles: 'Faites tomber vos jetons dans les colonnes. Alignez 4 de votre couleur pour gagner.',
    },
];

// ── DOM helpers ───────────────────────────────────────────
const $  = id  => document.getElementById(id);
const $$ = sel => document.querySelector(sel);

function esc(s) {
    return String(s || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

// ══════════════════════════════════════════════════════
// GESTION LOCALE DES PARTIES
// ══════════════════════════════════════════════════════

const LS_KEY      = 'mgu_parties';
const TTL_LOBBY   =  24 * 60 * 60 * 1000; //  1 jour
const TTL_COURS   =   7 * 24 * 60 * 60 * 1000; //  7 jours
const TTL_TERMINE =   2 * 24 * 60 * 60 * 1000; //  2 jours
const MAX_PARTIES = 50;

/**
 * Lit le tableau brut depuis localStorage.
 * @returns {object[]}
 */
function _lireParties() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

/**
 * Écrit le tableau dans localStorage.
 * @param {object[]} parties
 */
function _ecrireParties(parties) {
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(parties));
    } catch {
        // localStorage plein — on essaie après un nettoyage agressif
        try {
            const reduit = parties.slice(-20);
            localStorage.setItem(LS_KEY, JSON.stringify(reduit));
        } catch {}
    }
}

/**
 * Sauvegarde ou met à jour une entrée locale depuis un snapshot serveur.
 * Normalise les champs pour que main.js et host.js écrivent la même structure.
 *
 * @param {object} snapshot  - snapshot brut du serveur (id ou partieId, nom, jeu…)
 * @param {object} [extra]   - champs supplémentaires (code, lastSeen…)
 */
function saveLocalPartie(snapshot, extra = {}) {
    if (!snapshot) return;
    const partieId = snapshot.id || snapshot.partieId;
    if (!partieId) return;

    const now = Date.now();
    const entry = {
        partieId,
        nom      : snapshot.nom     || '',
        jeu      : snapshot.jeu     || '',
        mode     : snapshot.mode    || 'solo',
        statut   : snapshot.statut  || 'lobby',
        scores   : snapshot.scores  || {},
        joueurs  : (snapshot.joueurs || []).map(j => ({
            pseudo: j.pseudo || j,
            equipe: j.equipe || null,
        })),
        equipes  : snapshot.equipes || [],
        code     : extra.code    || null,
        savedAt  : now,
        lastSeen : extra.lastSeen || now,
        createdAt: snapshot.createdAt || now,
    };

    const parties = _lireParties();
    const idx = parties.findIndex(p => p.partieId === partieId);
    if (idx >= 0) {
        parties[idx] = { ...parties[idx], ...entry, createdAt: parties[idx].createdAt || entry.createdAt };
    } else {
        parties.push(entry);
    }
    _ecrireParties(cleanupLocalParties(parties));
}

/**
 * Recherche locale par nom exact (insensible à la casse).
 * Retourne toutes les correspondances triées par pertinence.
 *
 * @param {string} query
 * @returns {object[]}
 */
function searchLocalParties(query) {
    if (!query || !query.trim()) return [];
    const q = query.trim().toLowerCase();
    return _lireParties().filter(p => (p.nom || '').toLowerCase() === q);
}

/**
 * Nettoie le tableau de parties :
 *   – supprime les expirées selon TTL par statut
 *   – dédoublonne sur partieId
 *   – limite à MAX_PARTIES entrées
 *
 * Peut être appelé avec un tableau en paramètre (interne)
 * ou sans (lit et écrit localStorage).
 *
 * @param {object[]} [arr]  - si fourni, retourne le tableau nettoyé sans I/O
 * @returns {object[]}
 */
function cleanupLocalParties(arr) {
    const now    = Date.now();
    const source = arr || _lireParties();

    // 1. Dédoublonner par partieId (garde le plus récent)
    const map = new Map();
    for (const p of source) {
        if (!p.partieId) continue;
        const existing = map.get(p.partieId);
        const tsNew = p.lastSeen || p.savedAt || 0;
        const tsOld = existing ? (existing.lastSeen || existing.savedAt || 0) : -1;
        if (!existing || tsNew > tsOld) map.set(p.partieId, p);
    }

    // 2. Filtrer par TTL
    const filtered = Array.from(map.values()).filter(p => {
        const age    = now - (p.savedAt || p.createdAt || 0);
        const statut = p.statut || 'lobby';
        if (statut === 'terminee' || statut === 'ended')  return age < TTL_TERMINE;
        if (statut === 'en_cours' || statut === 'started') return age < TTL_COURS;
        return age < TTL_LOBBY;
    });

    // 3. Trier : en_cours > lobby > terminée, puis par lastSeen DESC
    const ORDER = { en_cours: 0, started: 0, lobby: 1, waiting: 1, terminee: 2, ended: 2 };
    filtered.sort((a, b) => {
        const sa = ORDER[a.statut] ?? 9;
        const sb = ORDER[b.statut] ?? 9;
        if (sa !== sb) return sa - sb;
        return (b.lastSeen || b.savedAt || 0) - (a.lastSeen || a.savedAt || 0);
    });

    // 4. Limiter
    const result = filtered.slice(0, MAX_PARTIES);

    // Si appelé sans argument → écrire dans localStorage
    if (!arr) _ecrireParties(result);

    return result;
}

/**
 * Tente de reprendre une partie depuis une entrée locale.
 * Vérifie d'abord le serveur, redirige vers /join/?resume= si OK.
 *
 * @param {object} partie  - entrée locale (depuis _lireParties)
 */
async function resumeFromLocal(partie) {
    if (!partie?.partieId) return;

    // Vérifier côté serveur
    try {
        const res = await fetch(`/api/parties/${partie.partieId}`, {
            signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) {
            // 404 → partie introuvable → nettoyer local
            if (res.status === 404) {
                const parties = _lireParties().map(p =>
                    p.partieId === partie.partieId ? { ...p, statut: 'terminee' } : p
                );
                _ecrireParties(parties);
                alert('Cette partie n\'existe plus sur le serveur.');
                renderPartiesContinuer();
                return;
            }
            throw new Error(`HTTP ${res.status}`);
        }
        const data   = await res.json();
        const statut = data.statut || data.partie?.statut;
        if (statut === 'terminee' || statut === 'ended') {
            const parties = _lireParties().map(p =>
                p.partieId === partie.partieId ? { ...p, statut: 'terminee' } : p
            );
            _ecrireParties(parties);
            alert('Cette partie est déjà terminée.');
            renderPartiesContinuer();
            return;
        }
    } catch (err) {
        // Pas de réseau → on tente quand même (offline-first)
        console.warn('[MAIN] Vérification serveur impossible:', err.message);
    }

    // Rediriger vers /join/ avec le partieId en paramètre resume
    // → join.js pré-sélectionnera la partie et affichera le champ pseudo
    window.location.href = `/join/?resume=${encodeURIComponent(partie.partieId)}`;
}

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
        const parties    = cleanupLocalParties();
        const joueursRaw = localStorage.getItem('mgu_joueurs') ||
                           localStorage.getItem('mgu_players') || '[]';
        const joueurs    = JSON.parse(joueursRaw);
        const totalPts   = parties.reduce((sum, p) =>
            sum + Object.values(p.scores || {}).reduce((s, v) => s + (v || 0), 0), 0);

        const elP   = $('stat-parties');
        const elJ   = $('stat-joueurs');
        const elPts = $('stat-points');

        if (elP)   elP.textContent   = parties.length;
        if (elJ)   elJ.textContent   = Array.isArray(joueurs) ? joueurs.length : 0;
        if (elPts) elPts.textContent = totalPts;
    } catch {}
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

function renderPartiesContinuer() {
    const container = $('parties-continuer-list');
    if (!container) return;

    // Nettoyage + tri au moment du rendu
    const parties = cleanupLocalParties();

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
        const meta    = JEUX.find(j => j.id === p.jeu) || { icon: '🎮', nom: p.jeu || 'Partie' };
        const date    = _formatDate(p.lastSeen || p.savedAt || p.createdAt);
        const joueurs = p.joueurs || [];
        const chips   = joueurs.slice(0, 4)
            .map(j => `<span class="pc-joueur-chip">${esc(j.pseudo || j)}</span>`).join('');
        const more    = joueurs.length > 4
            ? `<span class="pc-joueur-chip pc-joueur-more">+${joueurs.length - 4}</span>`
            : '';
        const statutBadge = _statutBadge(p.statut);

        return `
        <div class="partie-continue-card animate-in" style="animation-delay:${i * 0.05}s">
            <div class="partie-continue-icon">${meta.icon}</div>
            <div class="partie-continue-info">
                <div class="partie-continue-nom">
                    ${esc(p.nom || meta.nom)} ${statutBadge}
                </div>
                <div class="partie-continue-meta">
                    <span>${esc(meta.nom)}</span>
                    ${date ? `<span>·</span><span>${date}</span>` : ''}
                    ${p.mode ? `<span>·</span><span>${p.mode === 'team' ? '🛡️ Équipes' : '👤 Solo'}</span>` : ''}
                </div>
                <div class="partie-continue-joueurs">${chips}${more}</div>
            </div>
            <div class="partie-continue-actions">
                <button
                    class="btn-primary btn-sm btn-reprendre"
                    data-partie-id="${esc(p.partieId)}"
                >▶ Rejoindre</button>
                <button
                    class="btn-ghost btn-sm btn-del-partie"
                    data-partie-id="${esc(p.partieId)}"
                    title="Supprimer de l'historique"
                >🗑</button>
            </div>
        </div>`;
    }).join('');

    // ── Handler "Rejoindre" ───────────────────────────
    // Redirige vers /join/?resume=<partieId>
    // join.js se chargera de pré-sélectionner la partie
    // et de demander le pseudo avant de rejoindre.
    container.querySelectorAll('.btn-reprendre').forEach(btn => {
        btn.addEventListener('click', async () => {
            const partieId = btn.dataset.partieId;
            const partie   = parties.find(p => p.partieId === partieId);
            if (!partie) return;

            btn.disabled    = true;
            btn.textContent = '⏳…';

            await resumeFromLocal(partie);

            // Si on revient ici c'est qu'il y avait une erreur
            btn.disabled    = false;
            btn.textContent = '▶ Rejoindre';
        });
    });

    // ── Handler "Supprimer" ───────────────────────────
    container.querySelectorAll('.btn-del-partie').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!confirm("Supprimer cette partie de l'historique local ?")) return;
            const partieId = btn.dataset.partieId;
            const parties  = _lireParties().filter(p => p.partieId !== partieId);
            _ecrireParties(parties);
            renderPartiesContinuer();
        });
    });
}

/**
 * Génère un badge HTML coloré selon le statut.
 */
function _statutBadge(statut) {
    const map = {
        en_cours  : ['badge-statut badge-en-cours', 'En cours'],
        started   : ['badge-statut badge-en-cours', 'En cours'],
        lobby     : ['badge-statut badge-lobby',    'Lobby'],
        waiting   : ['badge-statut badge-lobby',    'Lobby'],
        terminee  : ['badge-statut badge-terminee', 'Terminée'],
        ended     : ['badge-statut badge-terminee', 'Terminée'],
    };
    const [cls, label] = map[statut] || ['badge-statut', statut || '?'];
    return `<span class="${cls}">${label}</span>`;
}

/**
 * Formate un timestamp en date courte lisible.
 */
function _formatDate(ts) {
    if (!ts) return '';
    try {
        return new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    } catch { return ''; }
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
    // Nettoyage silencieux au démarrage
    setTimeout(() => cleanupLocalParties(), 300);

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

    elBtnRetour?.addEventListener('click', retourContextuel);
    elBtnHome?.addEventListener('click', goHome);
    elBtnMenu?.addEventListener('click', ouvrirMenu);
    elBtnMusic?.addEventListener('click', toggleMusique);

    $$('.top-nav-bar .topbar-logo')?.addEventListener('click', e => {
        e.preventDefault();
        goHome();
    });

    elBtnCloseMenu?.addEventListener('click', fermerMenu);
    elMenuOverlay?.addEventListener('click', fermerMenu);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') fermerMenu(); });

    $('menu-reglages')?.addEventListener('click', () => { fermerMenu(); });

    $('menu-home')?.addEventListener('click', () => {
        fermerMenu();
        if (typeof afficherStatistiques === 'function') afficherStatistiques();
        else goHome();
    });

    $('menu-parties')?.addEventListener('click', () => { fermerMenu(); goParties(); });

    $('menu-joueurs')?.addEventListener('click', () => {
        fermerMenu();
        if (typeof afficherGestionJoueurs === 'function') afficherGestionJoueurs();
        else console.warn('[MAIN] menu/joueurs.js non chargé');
    });

    $('menu-equipes')?.addEventListener('click', () => {
        fermerMenu();
        if (typeof afficherGestionEquipes === 'function') afficherGestionEquipes();
        else console.warn('[MAIN] menu/equipes.js non chargé');
    });

    $('btn-nouvelle-partie')?.addEventListener('click', () => goHost());
    $('btn-continuer')?.addEventListener('click', goParties);
    $('btn-voir-jeux')?.addEventListener('click', goJeux);
    $('btn-parties-nouvelle')?.addEventListener('click', () => goHost());

    $('btn-retour-jeux')?.addEventListener('click', goHome);
    $('btn-retour-detail')?.addEventListener('click', goJeux);
    $('btn-retour-parties')?.addEventListener('click', goHome);

    [SCREENS.jeux, SCREENS.detail, SCREENS.parties].forEach(el => {
        if (el) el.hidden = true;
    });
    currentScreen = 'home';
    if (elBtnRetour) elBtnRetour.hidden = true;
    renderStatsBar();
}

// ── Exposition pour les modules externes ──────────────────
window.saveLocalPartie        = saveLocalPartie;
window.renderPartiesContinuer = renderPartiesContinuer;
window.addEventListener('mgu:afficher-parties', () => goParties());

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}