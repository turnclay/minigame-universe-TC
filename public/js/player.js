// ======================================================
// 🎮 JOIN.JS — Interface de connexion aux parties
// ======================================================
// Responsabilités :
//   1. Afficher la liste des parties disponibles
//   2. Permettre au joueur de saisir son pseudo
//   3. Valider et rejoindre une partie
//   4. Rediriger vers le lobby ou le jeu
// ======================================================

import { socket } from '../js/core/socket.js';

// ── Constants ────────────────────────────────────────
const GAME_ICONS = {
    quiz: '❓', justeprix: '💰', undercover: '🕵️', lml: '📖',
    mimer: '🎭', pendu: '🪢', petitbac: '📝', memoire: '🧠',
    morpion: '⭕', puissance4: '🔴',
};

const PSEUDO_REGEX = /^[a-zA-Z0-9_-]{2,20}$/;

// ── DOM Elements ─────────────────────────────────────
const $$ = {
    partiesList: () => document.getElementById('join-parties-list'),
    pseudo: () => document.getElementById('join-pseudo'),
    pseudoCount: () => document.getElementById('join-pseudo-count'),
    selectedInfo: () => document.getElementById('join-selected-info'),
    selectedName: () => document.getElementById('join-selected-name'),
    selectedGame: () => document.getElementById('join-selected-game'),
    errorMsg: () => document.getElementById('join-error-msg'),
    successMsg: () => document.getElementById('join-success-msg'),
    btnSubmit: () => document.getElementById('join-btn-submit'),
    btnCreate: () => document.getElementById('join-btn-create'),
    btnRefresh: () => document.getElementById('join-btn-refresh'),
    form: () => document.getElementById('join-form'),
};

// ── State ────────────────────────────────────────────
const state = {
    parties: [],
    selectedPartieId: null,
    selectedPartie: null,
    isConnecting: false,
};

// ── Utility Functions ────────────────────────────────
const esc = (str) => String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function toast(msg, type = 'info', duration = 3000) {
    const icons = {
        success: '✅',
        error: '❌',
        info: 'ℹ️',
        warning: '⚠️',
    };

    const container = document.getElementById('toast-container') || (() => {
        const div = document.createElement('div');
        div.id = 'toast-container';
        div.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:9999;display:flex;flex-direction:column;gap:0.5rem;';
        document.body.appendChild(div);
        return div;
    })();

    const toastEl = document.createElement('div');
    toastEl.className = `toast toast-${type}`;
    toastEl.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${esc(msg)}</span>`;
    container.appendChild(toastEl);

    requestAnimationFrame(() => toastEl.classList.add('show'));

    setTimeout(() => {
        toastEl.classList.remove('show');
        setTimeout(() => toastEl.remove(), 300);
    }, duration);
}

function showError(msg) {
    const el = $$().errorMsg();
    if (el) {
        el.textContent = msg;
        el.classList.add('show');
    }
}

function hideError() {
    const el = $$().errorMsg();
    if (el) {
        el.classList.remove('show');
        el.textContent = '';
    }
}

function showSuccess(msg) {
    const el = $$().successMsg();
    if (el) {
        el.textContent = msg;
        el.classList.add('show');
    }
}

function hideSuccess() {
    const el = $$().successMsg();
    if (el) {
        el.classList.remove('show');
        el.textContent = '';
    }
}

// ── Pseudo Validation ────────────────────────────────
function validatePseudo(pseudo) {
    const trimmed = pseudo.trim();

    if (trimmed.length < 2) {
        return { valid: false, error: 'Le pseudo doit faire au moins 2 caractères.' };
    }
    if (trimmed.length > 20) {
        return { valid: false, error: 'Le pseudo ne peut pas dépasser 20 caractères.' };
    }
    if (!PSEUDO_REGEX.test(trimmed)) {
        return { valid: false, error: 'Le pseudo peut contenir des lettres, chiffres, tirets et underscores.' };
    }

    return { valid: true };
}

// ── Partie Selection ─────────────────────────────────
function selectPartie(partieId) {
    state.selectedPartieId = partieId;
    state.selectedPartie = state.parties.find(p => p.id === partieId);

    // Update UI
    document.querySelectorAll('.partie-item').forEach(el => {
        el.classList.toggle('selected', el.dataset.partieId === partieId);
    });

    if (state.selectedPartie) {
        $$().selectedInfo().classList.add('show');
        $$().selectedName().textContent = `${GAME_ICONS[state.selectedPartie.jeu] || '🎮'} ${esc(state.selectedPartie.nom)}`;
        $$().selectedGame().textContent = `${esc(state.selectedPartie.jeu.toUpperCase())} · ${state.selectedPartie.joueurs?.length || 0} joueur${(state.selectedPartie.joueurs?.length || 0) !== 1 ? 's' : ''}`;
    } else {
        $$().selectedInfo().classList.remove('show');
    }

    checkCanJoin();
}

// ── Join Validation ─────────────────────────────────
function checkCanJoin() {
    const pseudo = $$().pseudo().value.trim();
    const hasPartie = state.selectedPartieId !== null;
    const isValid = validatePseudo(pseudo).valid && hasPartie;

    $$().btnSubmit().disabled = !isValid || state.isConnecting;
}

// ── Render Parties ──────────────────────────────────
function renderParties(parties) {
    const filtered = (parties || []).filter(p => p.statut === 'waiting' || p.statut === 'lobby');
    state.parties = filtered;

    const container = $$().partiesList();
    if (!container) return;

    if (filtered.length === 0) {
        container.className = 'parties-list empty';
        container.innerHTML = `
            <div style="text-align: center;">
                <p style="font-size: 1.2rem; margin-bottom: 0.5rem;">🎲</p>
                <p>Aucune partie disponible pour le moment.</p>
                <p style="font-size: 0.85rem; opacity: 0.7; margin-top: 0.5rem;">Créez-en une ou attendez qu'un hôte en crée.</p>
            </div>
        `;
        return;
    }

    container.className = 'parties-list';
    container.innerHTML = filtered.map(partie => {
        const joueurs = partie.joueurs || [];
        const isSelected = partie.id === state.selectedPartieId;
        const icon = GAME_ICONS[partie.jeu] || '🎮';

        return `
            <div
                class="partie-item ${isSelected ? 'selected' : ''}"
                data-partie-id="${esc(partie.id)}"
                role="button"
                tabindex="0"
                aria-label="Sélectionner ${esc(partie.nom)}"
            >
                <div class="partie-icon">${icon}</div>
                <div class="partie-info">
                    <div class="partie-nom">${esc(partie.nom)}</div>
                    <div class="partie-meta">
                        <span class="partie-badge">${esc(partie.jeu.toUpperCase())}</span>
                        ${partie.mode === 'team' ? '<span class="partie-badge">🛡️ Équipes</span>' : '<span class="partie-badge">👤 Solo</span>'}
                    </div>
                </div>
                <div class="partie-joueurs">
                    <span>${joueurs.length}/${partie.maxJoueurs || 8}</span>
                </div>
                <div class="partie-joueurs-avatars">
                    ${joueurs.slice(0, 3).map(j =>
                        `<div class="avatar-mini" title="${esc(j.pseudo)}">${j.pseudo.charAt(0).toUpperCase()}</div>`
                    ).join('')}
                    ${joueurs.length > 3 ? `<div class="avatar-mini">+${joueurs.length - 3}</div>` : ''}
                </div>
            </div>
        `;
    }).join('');

    // Attach click handlers
    container.querySelectorAll('.partie-item').forEach(el => {
        el.addEventListener('click', () => selectPartie(el.dataset.partieId));
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                selectPartie(el.dataset.partieId);
            }
        });
    });
}

// ── Load Parties ─────────────────────────────────────
function loadParties() {
    const container = $$().partiesList();
    if (container) {
        container.className = 'parties-list';
        container.innerHTML = `
            <div class="loading-state">
                <div class="loading-spinner"></div>
                <span>Chargement des parties…</span>
            </div>
        `;
    }
    socket.send('GET_PARTIES', {});
}

// ── Join Handler ─────────────────────────────────────
async function handleJoin() {
    hideError();
    hideSuccess();

    const pseudo = $$().pseudo().value.trim();
    const validation = validatePseudo(pseudo);

    if (!validation.valid) {
        showError(validation.error);
        return;
    }

    if (!state.selectedPartieId) {
        showError('Sélectionnez une partie dans la liste.');
        return;
    }

    // Save pseudo to localStorage
    try {
        localStorage.setItem('mgu_last_pseudo', pseudo);
    } catch {}

    state.isConnecting = true;
    $$().btnSubmit().disabled = true;
    $$().btnSubmit().innerHTML = '<span class="loading-spinner" style="display:inline-block;"></span> Connexion…';

    // Send join request
    socket.send('PLAYER_JOIN', {
        pseudo,
        partieId: state.selectedPartieId,
    });

    // Timeout protection
    setTimeout(() => {
        if (state.isConnecting) {
            state.isConnecting = false;
            showError('Délai d\'attente dépassé. Vérifiez la connexion.');
            $$().btnSubmit().disabled = false;
            $$().btnSubmit().textContent = '🚀 Rejoindre la partie';
        }
    }, 10000);
}

// ── Socket Events ────────────────────────────────────
function initSocketEvents() {
    socket.on('__connected__', () => {
        loadParties();
        hideError();
    });

    socket.on('__disconnected__', () => {
        toast('Connexion perdue…', 'warning');
    });

    socket.on('PARTIES_LIST', ({ parties }) => {
        renderParties(parties);
    });

    socket.on('JOIN_OK', ({ pseudo, equipe, snapshot }) => {
        state.isConnecting = false;

        // Save session
        const session = {
            partieId: state.selectedPartieId,
            pseudo,
            equipe,
            jeu: snapshot.jeu,
            mode: snapshot.mode,
            role: 'player',
        };

        try {
            sessionStorage.setItem('mgu_game_session', JSON.stringify(session));
        } catch {}

        toast(`✅ Bienvenue ${pseudo}!`, 'success');

        // Redirect to game
        setTimeout(() => {
            const gameRoute = `/games/${snapshot.jeu}/`;
            window.location.href = gameRoute;
        }, 800);
    });

    socket.on('JOIN_ERROR', ({ code }) => {
        state.isConnecting = false;
        $$().btnSubmit().disabled = false;
        $$().btnSubmit().textContent = '🚀 Rejoindre la partie';

        const messages = {
            GAME_NOT_FOUND: 'Partie introuvable ou terminée.',
            ALREADY_JOINED: 'Vous avez déjà rejoint cette partie.',
            GAME_STARTED: 'La partie est déjà en cours.',
            PSEUDO_TAKEN: 'Ce pseudo est déjà utilisé dans cette partie.',
            PSEUDO_INVALID: 'Le pseudo n\'est pas valide.',
            MISSING_FIELDS: 'Données incomplètes.',
            MAX_PLAYERS: 'Cette partie est complète.',
        };

        showError(messages[code] || `Erreur: ${code}`);
        toast(messages[code] || `Erreur: ${code}`, 'error');
    });

    socket.on('ERROR', ({ message }) => {
        toast(message || 'Erreur serveur', 'error');
    });
}

// ── Event Listeners ──────────────────────────────────
function attachEventListeners() {
    const pseudo = $$().pseudo();
    if (pseudo) {
        pseudo.addEventListener('input', (e) => {
            $$().pseudoCount().textContent = e.target.value.length;
            checkCanJoin();
        });
        pseudo.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !$$().btnSubmit().disabled) {
                handleJoin();
            }
        });

        // Load last pseudo
        const lastPseudo = localStorage.getItem('mgu_last_pseudo');
        if (lastPseudo) {
            pseudo.value = lastPseudo;
            $$().pseudoCount().textContent = lastPseudo.length;
        }
    }

    $$().btnSubmit().addEventListener('click', handleJoin);
    $$().btnCreate().addEventListener('click', () => {
        window.location.href = '/host/';
    });
    $$().btnRefresh().addEventListener('click', loadParties);

    const form = $$().form();
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
        });
    }
}

// ── Init ─────────────────────────────────────────────
function init() {
    attachEventListeners();
    initSocketEvents();

    // Load parties once connected
    if (socket.isConnected?.()) {
        loadParties();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}