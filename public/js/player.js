// /public/js/player.js
// ======================================================
// 🎮 PLAYER.JS — Page /join/
// ======================================================
// Responsabilités :
//   1. Charger la liste des parties actives via WebSocket
//      → alimenter le <select id="p-partie-select">
//   2. Gérer le formulaire join (pseudo + partie)
//   3. Afficher l'écran lobby en attendant le lancement
//   4. Au GAME_STARTED → masquer lobby et charger
//      dynamiquement le game.js correspondant au jeu
//   5. Afficher les résultats finaux (GAME_ENDED)
// ======================================================

import { socket } from './core/socket.js';

// ── DOM helpers ──────────────────────────────────────────
const $    = id  => document.getElementById(id);
const show = id  => { const el = $(id); if (el) el.hidden = false; };
const hide = id  => { const el = $(id); if (el) el.hidden = true;  };
const esc  = str => String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── Chemin des game.js par jeu ───────────────────────────
// Chaque jeu expose window.initGame(session) dans son game.js
const GAME_SCRIPTS = {
    quiz:       '/games/quiz/game.js',
    justeprix:  '/games/justeprix/game.js',
    undercover: '/games/undercover/game.js',
    lml:        '/games/lml/game.js',
    mimer:      '/games/mimer/game.js',
    pendu:      '/games/pendu/game.js',
    petitbac:   '/games/petitbac/game.js',
    memoire:    '/games/memoire/game.js',
    morpion:    '/games/morpion/game.js',
    puissance4: '/games/puissance4/game.js',
};

const JEU_ICONS = {
    quiz:'❓', justeprix:'💰', undercover:'🕵️', lml:'📖',
    mimer:'🎭', pendu:'🪢', petitbac:'📝', memoire:'🧠',
    morpion:'⭕', puissance4:'🔴',
};

// ── État du joueur ───────────────────────────────────────
const PlayerState = {
    pseudo:   null,
    partieId: null,
    jeu:      null,
    mode:     null,
    equipe:   null,
    joueurs:  [],
    scores:   {},
};

// ══════════════════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════════════════
function toast(msg, type = 'info', ms = 3000) {
    const icons = { info:'ℹ️', success:'✅', error:'❌', warning:'⚠️' };
    const c = $('toast-container') || (() => {
        const d = document.createElement('div');
        d.id = 'toast-container'; d.className = 'toast-container';
        document.body.appendChild(d); return d;
    })();
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${esc(msg)}</span>`;
    c.appendChild(el);
    requestAnimationFrame(() => el.classList.add('toast-visible'));
    setTimeout(() => {
        el.classList.remove('toast-visible');
        el.classList.add('toast-hiding');
        setTimeout(() => el.remove(), 400);
    }, ms);
}

// ══════════════════════════════════════════════════════
// 1. CHARGER LA LISTE DES PARTIES ACTIVES
//    → remplit le <select id="p-partie-select">
// ══════════════════════════════════════════════════════

function peuplerSelectParties(parties) {
    const sel = $('p-partie-select');
    if (!sel) return;

    // Parties actives = non terminées
    const actives = (parties || []).filter(p =>
        p.statut !== 'terminee' && p.statut !== 'ended'
    );

    if (actives.length === 0) {
        sel.innerHTML = `<option value="">Aucune partie disponible</option>`;
        const loading = $('p-parties-loading');
        if (loading) { loading.textContent = 'Aucune partie en cours.'; loading.hidden = false; }
        return;
    }

    sel.innerHTML = `<option value="">-- Choisir une partie --</option>` +
        actives.map(p => {
            const icon = JEU_ICONS[p.jeu] || '🎮';
            const joueurs = p.joueurs?.length || 0;
            return `<option value="${esc(p.id)}">${icon} ${esc(p.nom || p.id)} · ${esc(p.jeu?.toUpperCase() || '?')} · ${joueurs} joueur${joueurs !== 1 ? 's' : ''}</option>`;
        }).join('');

    const loading = $('p-parties-loading');
    if (loading) loading.hidden = true;
}

/** Demande la liste des parties au serveur via WebSocket */
function demanderListeParties() {
    const loading = $('p-parties-loading');
    if (loading) { loading.textContent = 'Chargement…'; loading.hidden = false; }
    socket.send('GET_PARTIES', {});
}

/** Actualisation manuelle (bouton 🔄) */
function rafraichirParties() {
    const sel = $('p-partie-select');
    if (sel) sel.innerHTML = `<option value="">Chargement…</option>`;
    demanderListeParties();
}

// ══════════════════════════════════════════════════════
// 2. REJOINDRE UNE PARTIE
// ══════════════════════════════════════════════════════

function rejoindrePartie() {
    const pseudo   = $('p-pseudo')?.value.trim();
    const partieId = $('p-partie-select')?.value;

    // Validation
    const errEl = $('p-join-error');
    if (errEl) errEl.hidden = true;

    if (!partieId) {
        afficherErreurJoin('Sélectionnez une partie dans la liste.');
        return;
    }
    if (!pseudo || pseudo.length < 2) {
        afficherErreurJoin('Votre pseudo doit faire au moins 2 caractères.');
        return;
    }
    if (pseudo.length > 20) {
        afficherErreurJoin('Votre pseudo ne peut pas dépasser 20 caractères.');
        return;
    }

    PlayerState.pseudo   = pseudo;
    PlayerState.partieId = partieId;

    // Sauvegarder le pseudo pour la prochaine fois
    try { localStorage.setItem('mgu_last_pseudo', pseudo); } catch {}

    // Désactiver le bouton pendant la requête
    const btnJoin = $('p-btn-join');
    if (btnJoin) { btnJoin.disabled = true; btnJoin.textContent = 'Connexion…'; }

    socket.send('PLAYER_JOIN', { pseudo, partieId });
}

function afficherErreurJoin(msg) {
    const el = $('p-join-error');
    if (el) { el.textContent = msg; el.hidden = false; }
    const btnJoin = $('p-btn-join');
    if (btnJoin) { btnJoin.disabled = false; btnJoin.textContent = 'Rejoindre'; }
}

// ══════════════════════════════════════════════════════
// 3. ÉCRAN LOBBY — attente du lancement
// ══════════════════════════════════════════════════════

function afficherLobby(snapshot) {
    hide('player-join');
    hide('player-game');
    show('player-lobby');

    // Infos joueur
    const avatarEl = $('lobby-avatar-letter');
    if (avatarEl) avatarEl.textContent = (PlayerState.pseudo || '?').charAt(0).toUpperCase();
    const pseudoEl = $('lobby-pseudo-text');
    if (pseudoEl) pseudoEl.textContent = PlayerState.pseudo;
    const equipeEl = $('lobby-equipe-text');
    if (equipeEl) equipeEl.textContent = PlayerState.equipe ? `Équipe : ${PlayerState.equipe}` : '';

    // Infos jeu
    const jeuBadge  = $('lobby-badge-jeu');
    const modeBadge = $('lobby-badge-mode');
    if (jeuBadge)  jeuBadge.textContent  = `${JEU_ICONS[snapshot.jeu] || '🎮'} ${(snapshot.jeu || '').toUpperCase()}`;
    if (modeBadge) modeBadge.textContent = snapshot.mode === 'team' ? '🛡️ Équipes' : '👤 Solo';

    PlayerState.jeu  = snapshot.jeu;
    PlayerState.mode = snapshot.mode;

    renderJoueursLobby(snapshot.joueurs || []);
}

function renderJoueursLobby(joueurs) {
    PlayerState.joueurs = joueurs;
    const liste = $('lobby-joueurs-liste');
    if (!liste) return;

    if (joueurs.length === 0) {
        liste.innerHTML = `<span class="lobby-joueur-empty">En attente d'autres joueurs…</span>`;
        return;
    }
    liste.innerHTML = joueurs.map(j => {
        const isMoi = j.pseudo === PlayerState.pseudo;
        return `<span class="lobby-joueur-tag ${isMoi ? 'lobby-joueur-moi' : ''}">
            <span class="lobby-joueur-avatar">${j.pseudo.charAt(0).toUpperCase()}</span>
            ${esc(j.pseudo)}
            ${isMoi ? '<span class="lobby-moi-badge">moi</span>' : ''}
        </span>`;
    }).join('');
}

// ══════════════════════════════════════════════════════
// 4. DÉMARRAGE DU JEU — charger game.js dynamiquement
// ══════════════════════════════════════════════════════

async function demarrerJeu(snapshot) {
    hide('player-join');
    hide('player-lobby');
    show('player-game');

    PlayerState.jeu    = snapshot.jeu;
    PlayerState.scores = snapshot.scores || {};

    // Sauvegarder la session pour que game.js y accède
    const session = {
        partieId: PlayerState.partieId,
        pseudo:   PlayerState.pseudo,
        role:     'player',
        jeu:      PlayerState.jeu,
        mode:     PlayerState.mode || snapshot.mode,
        equipe:   PlayerState.equipe,
        joueurs:  snapshot.joueurs || [],
        equipes:  snapshot.equipes || [],
        scores:   PlayerState.scores,
    };
    try { sessionStorage.setItem('mgu_game_session', JSON.stringify(session)); } catch {}

    // Header de l'écran jeu
    const headerJeu  = $('player-game-jeu');
    const headerMode = $('player-game-mode');
    if (headerJeu)  headerJeu.textContent  = `${JEU_ICONS[snapshot.jeu] || '🎮'} ${(snapshot.jeu || '').toUpperCase()}`;
    if (headerMode) headerMode.textContent = snapshot.mode === 'team' ? '🛡️ Équipes' : '👤 Solo';

    // Charger le game.js du jeu correspondant
    const scriptSrc = GAME_SCRIPTS[snapshot.jeu];
    if (!scriptSrc) {
        $('player-game-area').innerHTML = `
            <div style="text-align:center;padding:2rem;color:var(--c-text-mute)">
                <p>Module de jeu « ${esc(snapshot.jeu)} » non disponible.</p>
                <p style="margin-top:.5rem;font-size:.85rem">Le host contrôle la partie.</p>
            </div>`;
        return;
    }

    try {
        // Import dynamique du module game.js du jeu
        const gameModule = await import(scriptSrc);
        // Convention : chaque game.js exporte initGame(session, socket)
        if (typeof gameModule.initGame === 'function') {
            gameModule.initGame(session, socket);
        } else if (typeof window.initGame === 'function') {
            // Fallback : game.js expose window.initGame (script classique)
            window.initGame(session, socket);
        }
    } catch (err) {
        console.warn('[PLAYER] game.js non chargé :', err);
        $('player-game-area').innerHTML = `
            <div style="text-align:center;padding:2rem;color:var(--c-text-mute)">
                <p>En attente des instructions du host…</p>
                <p style="margin-top:.5rem;font-size:.85rem;opacity:.6">Le jeu se pilote depuis l'écran hôte.</p>
            </div>`;
    }
}

// ══════════════════════════════════════════════════════
// 5. RÉSULTATS FINAUX
// ══════════════════════════════════════════════════════

function afficherResultats(snapshot) {
    hide('player-game');
    show('player-results');

    const scores  = snapshot.scores || {};
    const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const medals  = ['🥇', '🥈', '🥉'];

    const myScore = scores[PlayerState.pseudo] ?? null;
    const myRank  = entries.findIndex(([nom]) => nom === PlayerState.pseudo) + 1;
    const isWinner = myRank === 1 && entries.length > 0;

    // Message personnalisé
    const msgEl = $('results-message');
    if (msgEl) {
        msgEl.textContent = isWinner
            ? `🏆 Félicitations ${PlayerState.pseudo}, vous avez gagné !`
            : myScore !== null
                ? `Vous avez terminé ${myRank}${myRank === 2 ? 'ème' : 'ème'} avec ${myScore} pts`
                : 'Partie terminée !';
    }

    // Liste des scores
    const liste = $('results-liste');
    if (liste) {
        liste.innerHTML = entries.length === 0
            ? `<p style="text-align:center;opacity:.5">Aucun score.</p>`
            : entries.map(([nom, pts], i) => {
                const isMoi = nom === PlayerState.pseudo;
                const isWin = i === 0;
                return `<div class="result-row ${isWin ? 'result-winner' : ''} ${isMoi ? 'result-me' : ''}">
                    <span>${medals[i] || `${i + 1}.`}</span>
                    <span>${esc(nom)} ${isMoi ? '<em>(vous)</em>' : ''}</span>
                    <span>${pts} pts</span>
                </div>`;
            }).join('');
    }
}

// ══════════════════════════════════════════════════════
// GESTION DES MESSAGES WEBSOCKET
// ══════════════════════════════════════════════════════
function initSocketEvents() {

    // Connexion établie → demander immédiatement la liste des parties
    socket.on('__connected__', () => {
        demanderListeParties();
        // Si on arrive avec ?partieId= dans l'URL, préremplir le select
        const params    = new URLSearchParams(location.search);
        const partieUrl = params.get('partieId');
        if (partieUrl) {
            const sel = $('p-partie-select');
            if (sel) sel.value = partieUrl;
            PlayerState.partieId = partieUrl;
        }
    });

    socket.on('__disconnected__', () => {
        toast('Connexion perdue — tentative de reconnexion…', 'warning');
    });

    // Liste des parties disponibles (réponse à GET_PARTIES)
    socket.on('PARTIES_LIST', ({ parties }) => {
        peuplerSelectParties(parties);
        // Préremplir si URL contient ?partieId=
        const params    = new URLSearchParams(location.search);
        const partieUrl = params.get('partieId');
        if (partieUrl) {
            const sel = $('p-partie-select');
            if (sel && sel.querySelector(`option[value="${partieUrl}"]`)) {
                sel.value = partieUrl;
            }
        }
    });

    // Join accepté → afficher lobby
    socket.on('JOIN_OK', ({ pseudo, equipe, snapshot }) => {
        PlayerState.equipe = equipe || null;
        afficherLobby(snapshot);
        toast(`Bienvenue ${pseudo} ! En attente du lancement…`, 'success');
    });

    // Erreur de join
    socket.on('JOIN_ERROR', ({ code }) => {
        const messages = {
            GAME_NOT_FOUND:   'Partie introuvable ou terminée.',
            ALREADY_JOINED:   'Vous avez déjà rejoint cette partie.',
            GAME_STARTED:     'La partie est déjà en cours.',
            PSEUDO_TAKEN:     'Ce pseudo est déjà utilisé dans cette partie.',
            MISSING_FIELDS:   'Données incomplètes.',
        };
        afficherErreurJoin(messages[code] || `Erreur (${code})`);
    });

    // Un joueur supplémentaire rejoint → MAJ liste lobby
    socket.on('PLAYER_JOINED', ({ joueurs }) => {
        renderJoueursLobby(joueurs);
    });

    // Un joueur quitte
    socket.on('PLAYER_LEFT', ({ pseudo, joueurs }) => {
        renderJoueursLobby(joueurs);
        toast(`${pseudo} a quitté la partie`, 'warning', 2500);
    });

    // 🚀 LA PARTIE DÉMARRE — cœur du déclenchement côté joueur
    socket.on('GAME_STARTED', ({ snapshot }) => {
        demarrerJeu(snapshot);
        toast('La partie commence !', 'success');
    });

    // MAJ des scores pendant la partie
    socket.on('SCORES_UPDATE', ({ scores }) => {
        PlayerState.scores = scores;
        // Si le game.js écoute cet événement via window, le notifier
        if (typeof window.onScoresUpdate === 'function') {
            window.onScoresUpdate(scores);
        }
        // MAJ du mini-scoreboard en haut du player-game si présent
        _renderMiniScoreboard(scores);
    });

    // Action reçue du host (ex: nouvelle question, mot à deviner…)
    socket.on('PLAYER_ACTION', ({ pseudo, equipe, action }) => {
        if (typeof window.onPlayerAction === 'function') {
            window.onPlayerAction({ pseudo, equipe, action });
        }
    });

    // Action envoyée par le host à tous (ex : afficher une question)
    socket.on('HOST_ACTION', ({ action, data }) => {
        if (typeof window.onHostAction === 'function') {
            window.onHostAction({ action, data });
        }
    });

    // Fin de partie → résultats
    socket.on('GAME_ENDED', ({ snapshot }) => {
        afficherResultats(snapshot);
        toast('Partie terminée !', 'info');
    });

    // Expulsion
    socket.on('KICKED', () => {
        hide('player-lobby');
        hide('player-game');
        show('player-join');
        afficherErreurJoin('Vous avez été expulsé de la partie par le host.');
    });

    // Erreur générique
    socket.on('ERROR', ({ code, message }) => {
        toast(message || `Erreur : ${code}`, 'error');
    });
}

// ── Mini scoreboard dans l'écran jeu ─────────────────────
function _renderMiniScoreboard(scores) {
    const sb = $('player-mini-scoreboard');
    if (!sb) return;
    const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const medals  = ['🥇', '🥈', '🥉'];
    sb.innerHTML = entries.map(([nom, pts], i) => {
        const isMoi = nom === PlayerState.pseudo;
        return `<div class="sb-row ${isMoi ? 'sb-moi' : ''}">
            <span class="sb-medal">${medals[i] || `${i + 1}.`}</span>
            <span class="sb-nom">${esc(nom)}</span>
            <span class="sb-pts">${pts}</span>
        </div>`;
    }).join('');
    sb.hidden = entries.length === 0;
}

// ══════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════
function init() {
    // Pré-remplir le pseudo depuis le localStorage
    const lastPseudo = localStorage.getItem('mgu_last_pseudo');
    const pseudoInput = $('p-pseudo');
    if (pseudoInput && lastPseudo) pseudoInput.value = lastPseudo;

    // Bouton rejoindre
    $('p-btn-join')?.addEventListener('click', rejoindrePartie);
    // Valider avec Entrée
    $('p-pseudo')?.addEventListener('keydown', e => { if (e.key === 'Enter') rejoindrePartie(); });
    $('p-partie-select')?.addEventListener('keydown', e => { if (e.key === 'Enter') rejoindrePartie(); });

    // Bouton rafraîchir la liste des parties
    $('p-btn-refresh')?.addEventListener('click', rafraichirParties);

    // Bouton « Rejoindre à nouveau » depuis l'écran résultats
    $('btn-rejoin')?.addEventListener('click', () => {
        hide('player-results');
        show('player-join');
        // Réinitialiser state
        PlayerState.pseudo   = null;
        PlayerState.partieId = null;
        PlayerState.jeu      = null;
        demanderListeParties();
    });

    // Initialiser les événements socket
    initSocketEvents();

    // Gérer l'écran initial (si ?partieId= dans l'URL → garder le join visible)
    // C'est __connected__ qui préremplira le select
}

document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();