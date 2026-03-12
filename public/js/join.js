// ======================================================
// 🎮 JOIN.JS v2.1 — ÉCRAN D'ATTENTE APRÈS JOIN_OK
// ======================================================
// Corrections v2.1 :
//
//   BUG CORRIGÉ — Redirection immédiate après JOIN_OK
//   ─────────────────────────────────────────────────────
//   Avant : JOIN_OK → redirect vers /games/xxx/ après 800ms.
//   La navigation fermait le socket WebSocket, ce qui déclenchait
//   ws.on('close') côté serveur → retirerJoueur() → PLAYER_LEFT
//   → l'host voyait le joueur disparaître instantanément.
//
//   Après : JOIN_OK → affiche un ÉCRAN D'ATTENTE dans la page /join/.
//   Le socket reste ouvert. Le joueur voit "En attente du host…".
//   Quand le host lance la partie (GAME_STARTED), ALORS on redirige
//   vers la page du jeu avec PLAYER_REJOIN pré-configuré en sessionStorage.
//
//   GAME_STARTED handler ajouté
//   ─────────────────────────────────────────────────────
//   Le socket reçoit GAME_STARTED → redirection immédiate vers le jeu.
//   La page du jeu enverra PLAYER_REJOIN (géré dans ws-handler.js)
//   pour ré-enregistrer le socket sans toucher à la liste des joueurs.
// ======================================================

import { GameSocket } from './core/socket.js';

const socket = new GameSocket();

// ── Config ────────────────────────────────────────────
const PSEUDO_REGEX = /^[a-zA-Z0-9_-]{2,20}$/;

const GAME_ICONS = {
    quiz: '❓', justeprix: '💰', undercover: '🕵️', lml: '📖',
    mimer: '🎭', pendu: '🪢', petitbac: '📝', memoire: '🧠',
    morpion: '⭕', puissance4: '🔴',
};

const JEU_PATHS = {
    quiz:       '/games/quiz/',
    justeprix:  '/games/justeprix/',
    undercover: '/games/undercover/',
    lml:        '/games/lml/',
    mimer:      '/games/mimer/',
    pendu:      '/games/pendu/',
    petitbac:   '/games/petitbac/',
    memoire:    '/games/memoire/',
    morpion:    '/games/morpion/',
    puissance4: '/games/puissance4/',
};

// ── DOM Helpers ───────────────────────────────────────
const $ = (id) => document.getElementById(id);
const esc = (str) => String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── State ─────────────────────────────────────────────
const state = {
    parties:          [],
    selectedPartieId: null,
    selectedPartie:   null,
    isConnecting:     false,
    refreshTimer:     null,
    // ✅ State post-JOIN_OK (écran d'attente)
    hasJoined:        false,
    joinedPseudo:     null,
    joinedEquipe:     null,
    joinedSnapshot:   null,
};

// ══════════════════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════════════════

function toast(msg, type = 'info', duration = 3500) {
    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    let container = $('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:9999;display:flex;flex-direction:column;gap:0.5rem;pointer-events:none;';
        document.body.appendChild(container);
    }
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${esc(msg)}</span>`;
    el.style.cssText = 'display:flex;gap:0.5rem;align-items:center;padding:0.75rem 1rem;border-radius:8px;background:#1e1e2e;color:#fff;box-shadow:0 4px 12px rgba(0,0,0,.4);opacity:0;transition:opacity .25s;pointer-events:auto;min-width:200px;';
    container.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 300);
    }, duration);
}

// ══════════════════════════════════════════════════════
// ✅ ÉCRAN D'ATTENTE — affiché après JOIN_OK
// Remplace le contenu de la page au lieu de rediriger
// ══════════════════════════════════════════════════════

function afficherEcranAttente(pseudo, equipe, snapshot) {
    state.hasJoined   = true;
    state.joinedPseudo  = pseudo;
    state.joinedEquipe  = equipe;
    state.joinedSnapshot = snapshot;

    // Arrêter l'actualisation auto (plus besoin de charger les parties)
    if (state.refreshTimer) {
        clearInterval(state.refreshTimer);
        state.refreshTimer = null;
    }

    const jeuIcon = GAME_ICONS[snapshot.jeu] || '🎮';
    const modeLabel = snapshot.mode === 'team' ? '🛡️ Équipes' : '👤 Solo';

    // Injecter l'écran d'attente dans le <main> existant
    const main = document.querySelector('main.page') || document.querySelector('main') || document.body;
    main.innerHTML = `
        <div id="ecran-attente" style="
            display:flex;flex-direction:column;align-items:center;justify-content:center;
            min-height:60vh;text-align:center;padding:2rem;gap:1.5rem;">

            <!-- Indicateur de connexion établie -->
            <div style="
                background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.3);
                border-radius:12px;padding:.6rem 1.2rem;color:#4ade80;font-size:.85rem;font-weight:600;">
                ✅ Connecté à la partie
            </div>

            <!-- Infos de la partie -->
            <div style="
                background:rgba(0,212,255,.07);border:1px solid rgba(0,212,255,.2);
                border-radius:16px;padding:1.5rem 2rem;min-width:280px;max-width:400px;width:100%;">
                <div style="font-size:3rem;margin-bottom:.5rem;">${jeuIcon}</div>
                <div style="font-size:1.2rem;font-weight:700;margin-bottom:.25rem;">${esc(snapshot.nom)}</div>
                <div style="font-size:.85rem;opacity:.6;margin-bottom:1rem;">${(snapshot.jeu || '').toUpperCase()} · ${modeLabel}</div>

                <div style="background:rgba(255,255,255,.05);border-radius:8px;padding:.75rem;margin-bottom:.75rem;">
                    <div style="font-size:.75rem;color:#64748b;margin-bottom:.2rem;">VOTRE PSEUDO</div>
                    <div style="font-size:1.1rem;font-weight:700;color:#00d4ff;">${esc(pseudo)}</div>
                    ${equipe ? `<div style="font-size:.8rem;opacity:.6;margin-top:.2rem;">🛡️ Équipe : ${esc(equipe)}</div>` : ''}
                </div>

                <!-- Compteur de joueurs -->
                <div style="font-size:.85rem;opacity:.6;" id="attente-joueurs-count">
                    👥 ${snapshot.joueurs.length} joueur(s) connecté(s)
                </div>
            </div>

            <!-- Spinner d'attente -->
            <div style="display:flex;flex-direction:column;align-items:center;gap:.75rem;">
                <div style="
                    width:36px;height:36px;
                    border:3px solid rgba(0,212,255,.2);
                    border-top-color:#00d4ff;
                    border-radius:50%;
                    animation:spin .9s linear infinite;">
                </div>
                <p style="color:#64748b;font-size:.9rem;">En attente du lancement par le host…</p>
            </div>

            <!-- Bouton quitter -->
            <button id="btn-attente-quitter" style="
                background:none;border:1px solid rgba(255,255,255,.1);
                color:#64748b;border-radius:8px;padding:.5rem 1rem;
                cursor:pointer;font-size:.82rem;transition:all .15s;">
                Quitter la salle d'attente
            </button>
        </div>

        <style>
            @keyframes spin { to { transform: rotate(360deg); } }
        </style>`;

    // Bouton quitter
    $('btn-attente-quitter')?.addEventListener('click', () => {
        if (confirm('Quitter la salle d\'attente ?')) {
            window.location.href = '/join/';
        }
    });
}

// Met à jour le compteur de joueurs dans l'écran d'attente
function mettreAJourCompteurAttente(joueurs) {
    const el = $('attente-joueurs-count');
    if (el) el.textContent = `👥 ${joueurs.length} joueur(s) connecté(s)`;
}

// Redirige le joueur vers la page du jeu après GAME_STARTED
function redirectionVersJeu(snapshot) {
    if (!state.joinedPseudo || !state.selectedPartieId) return;

    // Sauvegarder la session pour que la page du jeu puisse envoyer PLAYER_REJOIN
    try {
        sessionStorage.setItem('mgu_game_session', JSON.stringify({
            partieId: state.selectedPartieId,
            pseudo:   state.joinedPseudo,
            equipe:   state.joinedEquipe || null,
            jeu:      snapshot.jeu,
            mode:     snapshot.mode,
            role:     'player',
        }));
    } catch {}

    const gamePath = JEU_PATHS[snapshot.jeu] || `/games/${snapshot.jeu}/`;
    window.location.href = `${gamePath}?partieId=${state.selectedPartieId}&pseudo=${encodeURIComponent(state.joinedPseudo)}`;
}

// ══════════════════════════════════════════════════════
// CHARGEMENT DES PARTIES
// ══════════════════════════════════════════════════════

async function loadParties() {
    // Ne pas rafraîchir si on est déjà dans la salle d'attente
    if (state.hasJoined) return;

    const container = $('join-parties-list');
    if (container && !state.selectedPartieId) {
        container.innerHTML = `<div style="text-align:center;padding:2rem;opacity:.6;">
            <div style="width:24px;height:24px;border:3px solid #444;border-top-color:#00d4ff;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto .5rem;"></div>
            <span>Chargement…</span>
        </div>`;
    }

    try {
        const res = await fetch('/api/parties', { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        state.parties = data.parties || data || [];
        renderParties(state.parties);
    } catch (err) {
        console.error('[JOIN] Erreur chargement parties:', err);
        if (container) {
            container.innerHTML = `<div style="text-align:center;padding:2rem;opacity:.6;">
                <p>❌ Impossible de charger les parties</p>
                <button onclick="window.location.reload()" style="margin-top:0.5rem;padding:0.4rem 1rem;border-radius:6px;border:1px solid #555;background:transparent;color:#aaa;cursor:pointer;">Réessayer</button>
            </div>`;
        }
    }
}

// ══════════════════════════════════════════════════════
// RENDU LISTE DES PARTIES
// ══════════════════════════════════════════════════════

function renderParties(parties) {
    if (state.hasJoined) return; // Ne pas toucher au DOM si en attente

    const filtered = parties.filter(p =>
        p.statut === 'lobby' || p.statut === 'waiting'
    );
    const container = $('join-parties-list');
    if (!container) return;

    if (filtered.length === 0) {
        container.innerHTML = `<div style="text-align:center;padding:2rem;opacity:.5;">
            <div style="font-size:2.5rem;margin-bottom:.5rem;">🎲</div>
            <p>Aucune partie disponible pour l'instant.</p>
            <p style="font-size:.85rem;margin-top:.25rem;">Demandez à votre host de créer une partie.</p>
        </div>`;
        return;
    }

    container.innerHTML = filtered.map(p => {
        const isSelected = p.id === state.selectedPartieId;
        const nbJoueurs  = (p.joueurs || []).length;
        const max        = p.maxJoueurs || 8;
        return `
        <div class="partie-item ${isSelected ? 'selected' : ''}" data-partie-id="${esc(p.id)}" style="
            display:flex;align-items:center;gap:0.75rem;padding:0.85rem 1rem;
            border-radius:10px;cursor:pointer;border:2px solid ${isSelected ? '#00d4ff' : 'transparent'};
            background:${isSelected ? 'rgba(0,212,255,.08)' : 'rgba(255,255,255,.04)'};
            transition:all .15s;margin-bottom:.5rem;">
            <span style="font-size:1.5rem;">${GAME_ICONS[p.jeu] || '🎮'}</span>
            <div style="flex:1;min-width:0;">
                <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(p.nom)}</div>
                <div style="font-size:.8rem;opacity:.6;">${(p.jeu || '').toUpperCase()} · ${p.mode === 'team' ? '🛡️ Équipes' : '👤 Solo'}</div>
            </div>
            <span style="font-size:.8rem;opacity:.7;white-space:nowrap;">${nbJoueurs}/${max} 👥</span>
            ${isSelected ? '<span style="color:#00d4ff;font-size:1.1rem;">✔</span>' : ''}
        </div>`;
    }).join('');

    container.querySelectorAll('.partie-item').forEach(el => {
        el.addEventListener('click', () => selectPartie(el.dataset.partieId));
    });
}

// ══════════════════════════════════════════════════════
// SÉLECTION D'UNE PARTIE
// ══════════════════════════════════════════════════════

function selectPartie(partieId) {
    state.selectedPartieId = partieId;
    state.selectedPartie   = state.parties.find(p => p.id === partieId);

    renderParties(state.parties);
    updateSelectedInfo();
    checkCanJoin();
}

function updateSelectedInfo() {
    const infoEl = $('join-selected-info');
    if (!infoEl) return;

    if (!state.selectedPartie) {
        infoEl.hidden = true;
        return;
    }

    infoEl.hidden = false;
    const p = state.selectedPartie;
    infoEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:.6rem;padding:.75rem 1rem;background:rgba(0,212,255,.07);border-radius:8px;border:1px solid rgba(0,212,255,.2);">
            <span style="font-size:1.4rem;">${GAME_ICONS[p.jeu] || '🎮'}</span>
            <div>
                <div style="font-weight:600;">${esc(p.nom)}</div>
                <div style="font-size:.8rem;opacity:.6;">${(p.jeu || '').toUpperCase()} · ${(p.joueurs || []).length} joueur(s)</div>
            </div>
        </div>`;
}

// ══════════════════════════════════════════════════════
// RECHERCHE PAR NOM EXACT
// ══════════════════════════════════════════════════════

function handleSearchByName() {
    if (state.hasJoined) return;
    const nameInput = $('join-partie-name');
    if (!nameInput) return;
    const nom = nameInput.value.trim();
    if (!nom) {
        toast('Entrez le nom exact de la partie.', 'warning');
        return;
    }

    const found = state.parties.find(
        p => p.nom.toLowerCase() === nom.toLowerCase() &&
             (p.statut === 'lobby' || p.statut === 'waiting')
    );

    if (found) {
        selectPartie(found.id);
        toast(`Partie "${found.nom}" trouvée !`, 'success', 2000);
        return;
    }

    toast('Recherche en cours…', 'info', 1500);
    fetch('/api/parties')
        .then(r => r.json())
        .then(data => {
            state.parties = data.parties || data || [];
            renderParties(state.parties);
            const fresh = state.parties.find(
                p => p.nom.toLowerCase() === nom.toLowerCase() &&
                     (p.statut === 'lobby' || p.statut === 'waiting')
            );
            if (fresh) {
                selectPartie(fresh.id);
                toast(`Partie "${fresh.nom}" trouvée !`, 'success');
            } else {
                toast(`Aucune partie ouverte nommée "${nom}".`, 'error');
            }
        })
        .catch(() => toast('Erreur de connexion au serveur.', 'error'));
}

// ══════════════════════════════════════════════════════
// VALIDATION
// ══════════════════════════════════════════════════════

function validatePseudo(pseudo) {
    const t = pseudo.trim();
    if (t.length < 2)  return { valid: false, error: 'Minimum 2 caractères.' };
    if (t.length > 20) return { valid: false, error: 'Maximum 20 caractères.' };
    if (!PSEUDO_REGEX.test(t)) return { valid: false, error: 'Lettres, chiffres, tiret, underscore uniquement.' };
    return { valid: true };
}

function checkCanJoin() {
    if (state.hasJoined) return;
    const pseudoEl = $('join-pseudo');
    const btn      = $('join-btn-submit');
    if (!pseudoEl || !btn) return;

    const pseudo = pseudoEl.value.trim();
    const ok     = validatePseudo(pseudo).valid && !!state.selectedPartieId;
    btn.disabled = !ok || state.isConnecting;
}

// ══════════════════════════════════════════════════════
// REJOINDRE UNE PARTIE
// ══════════════════════════════════════════════════════

function handleJoin() {
    if (state.hasJoined) return;

    const pseudoEl = $('join-pseudo');
    if (!pseudoEl) return;

    const pseudo     = pseudoEl.value.trim();
    const validation = validatePseudo(pseudo);

    if (!validation.valid) { toast(validation.error, 'error'); return; }
    if (!state.selectedPartieId) { toast('Sélectionnez ou cherchez une partie.', 'error'); return; }

    const partie = state.selectedPartie;
    if (partie && (partie.joueurs || []).some(j => j.pseudo.toLowerCase() === pseudo.toLowerCase())) {
        toast('Ce pseudo est déjà utilisé dans cette partie.', 'error');
        return;
    }

    try { localStorage.setItem('mgu_last_pseudo', pseudo); } catch {}

    state.isConnecting = true;
    const btn = $('join-btn-submit');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Connexion…'; }

    socket.send('PLAYER_JOIN', {
        pseudo,
        partieId: state.selectedPartieId,
    });

    // Timeout de sécurité
    setTimeout(() => {
        if (state.isConnecting && !state.hasJoined) {
            state.isConnecting = false;
            if (btn) { btn.disabled = false; btn.textContent = '🎮 Rejoindre la partie'; }
            toast('Délai d\'attente dépassé. Vérifiez la connexion.', 'error');
        }
    }, 10000);
}

// ══════════════════════════════════════════════════════
// EVENTS WEBSOCKET
// ══════════════════════════════════════════════════════

function initSocketEvents() {
    socket.on('__connected__', () => {
        console.log('[JOIN] ✅ WebSocket connecté');
        updateWsStatus(true);
        socket.send('GET_PARTIES', {});
    });

    socket.on('__disconnected__', () => {
        updateWsStatus(false);
        // Ne pas afficher d'erreur si on est déjà dans la salle d'attente
        // (déconnexion temporaire → reconnexion automatique gérée par GameSocket)
    });

    socket.on('PARTIES_LIST', ({ parties }) => {
        if (parties && !state.hasJoined) {
            state.parties = parties;
            renderParties(state.parties);
        }
    });

    // ✅ FIX PRINCIPAL : ne plus rediriger ici, afficher l'écran d'attente
    socket.on('JOIN_OK', ({ pseudo, equipe, snapshot }) => {
        state.isConnecting = false;
        console.log('[JOIN] ✅ Rejoint:', pseudo, 'équipe:', equipe);

        // Mémoriser l'ID de partie pour la redirection future
        // (state.selectedPartieId est déjà set)

        // Afficher l'écran d'attente — le socket reste ouvert
        afficherEcranAttente(pseudo, equipe, snapshot);
        toast(`Bienvenue ${pseudo} ! En attente du lancement…`, 'success', 3000);
    });

    // ✅ Mis à jour du compteur quand d'autres joueurs rejoignent
    socket.on('PLAYER_JOINED', ({ joueurs }) => {
        if (state.hasJoined && joueurs) {
            mettreAJourCompteurAttente(joueurs);
        }
    });

    // ✅ Un autre joueur quitte — mettre à jour le compteur
    socket.on('PLAYER_LEFT', ({ joueurs }) => {
        if (state.hasJoined && joueurs) {
            mettreAJourCompteurAttente(joueurs);
        }
    });

    // ✅ Le host lance la partie → on redirige MAINTENANT vers le jeu
    // Le socket WebSocket reste ouvert pendant la navigation (quelques ms),
    // puis ws-handler.js ignorera le close grâce au délai de grâce (_joinedAt).
    socket.on('GAME_STARTED', ({ snapshot }) => {
        console.log('[JOIN] 🚀 GAME_STARTED reçu — redirection vers le jeu');
        if (state.hasJoined && state.joinedPseudo) {
            toast('La partie commence ! Redirection…', 'success', 1500);
            setTimeout(() => redirectionVersJeu(snapshot), 500);
        }
    });

    socket.on('JOIN_ERROR', ({ code }) => {
        state.isConnecting = false;
        const btn = $('join-btn-submit');
        if (btn) { btn.disabled = false; btn.textContent = '🎮 Rejoindre la partie'; }

        const messages = {
            GAME_NOT_FOUND:       'Partie introuvable ou terminée.',
            PSEUDO_TAKEN:         'Ce pseudo est déjà utilisé dans cette partie.',
            PSEUDO_INVALID:       'Pseudo invalide.',
            GAME_STARTED:         'La partie a déjà commencé.',
            MAX_PLAYERS:          'La partie est complète.',
            PLAYER_ALREADY_EXISTS:'Vous êtes déjà dans cette partie.',
        };
        toast(messages[code] || `Erreur : ${code}`, 'error');
    });

    socket.on('KICKED', ({ reason }) => {
        toast(`Vous avez été expulsé : ${reason || 'par le host'}`, 'error', 5000);
        // Réinitialiser l'état et revenir à la page de join
        state.hasJoined = false;
        setTimeout(() => window.location.href = '/join/', 2000);
    });

    socket.on('GAME_ENDED', () => {
        if (state.hasJoined) {
            toast('La partie a été annulée par le host.', 'warning', 5000);
            state.hasJoined = false;
            setTimeout(() => window.location.href = '/join/', 2500);
        }
    });

    socket.on('HOST_DISCONNECTED', () => {
        if (state.hasJoined) {
            toast('Le host s\'est déconnecté. La partie est suspendue.', 'warning', 5000);
        }
    });
}

function updateWsStatus(connected) {
    const dot   = $('ws-dot');
    const label = $('ws-label');
    if (dot)   dot.style.background = connected ? '#22c55e' : '#ef4444';
    if (label) label.textContent    = connected ? 'Connecté' : 'Déconnecté';
}

// ══════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════

function init() {
    console.log('[JOIN] Initialisation v2.1');

    // Connexion WebSocket — AVANT les events pour ne pas rater de messages
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket.connect(`${wsProto}//${location.host}/ws`);
    initSocketEvents();

    // Pré-remplir le pseudo depuis localStorage
    const pseudoEl = $('join-pseudo');
    if (pseudoEl) {
        const last = localStorage.getItem('mgu_last_pseudo');
        if (last) pseudoEl.value = last;
        pseudoEl.addEventListener('input', checkCanJoin);
        pseudoEl.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !$('join-btn-submit')?.disabled) handleJoin();
        });
    }

    const nameInput = $('join-partie-name');
    if (nameInput) {
        nameInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') handleSearchByName();
        });
    }

    $('join-btn-search')?.addEventListener('click', handleSearchByName);
    $('join-btn-submit')?.addEventListener('click', handleJoin);
    $('join-btn-refresh')?.addEventListener('click', () => {
        if (state.hasJoined) return;
        state.selectedPartieId = null;
        state.selectedPartie   = null;
        loadParties();
    });

    // Charger la liste des parties
    loadParties();

    // Actualisation auto toutes les 5s (stoppée après JOIN_OK)
    state.refreshTimer = setInterval(() => {
        if (!state.isConnecting && !state.hasJoined) loadParties();
    }, 5000);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}