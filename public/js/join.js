// ======================================================
// 🎮 JOIN.JS — Rejoindre une partie
// ======================================================

import { socket } from './core/socket.js';

const PSEUDO_REGEX = /^[a-zA-Z0-9_-]{2,20}$/;
const PARTIE_NAME_REGEX = /^[a-zA-Z0-9_\s-]{2,30}$/;

const $$ = {
    partiesList: () => document.getElementById('join-parties-list'),
    pseudo: () => document.getElementById('join-pseudo'),
    pseudoCount: () => document.getElementById('join-pseudo-count'),
    partieName: () => document.getElementById('join-partie-name'),
    partieNameCount: () => document.getElementById('join-partie-name-count'),
    selectedInfo: () => document.getElementById('join-selected-info'),
    selectedName: () => document.getElementById('join-selected-name'),
    selectedGame: () => document.getElementById('join-selected-game'),
    errorMsg: () => document.getElementById('join-error-msg'),
    btnSubmit: () => document.getElementById('join-btn-submit'),
    btnRefresh: () => document.getElementById('join-btn-refresh'),
};

const state = {
    parties: [],
    selectedPartieId: null,
    selectedPartie: null,
    isConnecting: false,
};

const esc = (str) => String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const GAME_ICONS = {
    quiz: '❓', justeprix: '💰', undercover: '🕵️', lml: '📖',
    mimer: '🎭', pendu: '🪢', petitbac: '📝', memoire: '🧠',
    morpion: '⭕', puissance4: '🔴',
};

/**
 * Toast notification
 */
function toast(msg, type = 'info', duration = 3000) {
    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
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

/**
 * Charge la liste des parties
 */
async function loadParties() {
    const container = $$().partiesList();
    if (container) {
        container.className = 'parties-list';
        container.innerHTML = `
            <div class="loading-state">
                <div class="loading-spinner"></div>
                <span>Chargement…</span>
            </div>
        `;
    }

    try {
        const response = await fetch('/api/parties');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        state.parties = data.parties || data || [];

        renderParties(state.parties);
    } catch (err) {
        console.error('Erreur chargement parties:', err);
        if (container) {
            container.className = 'parties-list empty';
            container.innerHTML = `
                <div style="text-align:center;">
                    <p>❌ Impossible de charger les parties</p>
                </div>
            `;
        }
        toast('Erreur serveur', 'error');
    }
}

/**
 * Affiche la liste des parties
 */
function renderParties(parties) {
    const filtered = parties.filter(p => p.statut === 'lobby' || p.statut === 'waiting');
    const container = $$().partiesList();
    if (!container) return;

    if (filtered.length === 0) {
        container.className = 'parties-list empty';
        container.innerHTML = `
            <div style="text-align:center;">
                <p>🎲 Aucune partie disponible</p>
            </div>
        `;
        return;
    }

    container.className = 'parties-list';
    container.innerHTML = filtered.map(p => {
        const isSelected = p.id === state.selectedPartieId;
        return `
            <div class="partie-item ${isSelected ? 'selected' : ''}" data-partie-id="${esc(p.id)}">
                <span>${GAME_ICONS[p.jeu] || '🎮'}</span>
                <span>${esc(p.nom)}</span>
                <span>${(p.joueurs || []).length} joueurs</span>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.partie-item').forEach(el => {
        el.addEventListener('click', () => selectPartie(el.dataset.partieId));
    });
}

/**
 * Sélectionne une partie
 */
function selectPartie(partieId) {
    state.selectedPartieId = partieId;
    state.selectedPartie = state.parties.find(p => p.id === partieId);

    document.querySelectorAll('.partie-item').forEach(el => {
        el.classList.toggle('selected', el.dataset.partieId === partieId);
    });

    if (state.selectedPartie) {
        $$().selectedInfo().classList.add('show');
        $$().selectedName().textContent = `${GAME_ICONS[state.selectedPartie.jeu] || '🎮'} ${esc(state.selectedPartie.nom)}`;
        const partieName = $$().partieName();
        if (partieName) partieName.value = state.selectedPartie.nom;
    }

    checkCanJoin();
}

/**
 * Valide le pseudo
 */
function validatePseudo(pseudo) {
    const trimmed = pseudo.trim();
    if (trimmed.length < 2) return { valid: false, error: 'Minimum 2 caractères' };
    if (trimmed.length > 20) return { valid: false, error: 'Maximum 20 caractères' };
    if (!PSEUDO_REGEX.test(trimmed)) return { valid: false, error: 'Caractères invalides' };
    return { valid: true };
}

/**
 * Vérifie si on peut rejoindre
 */
function checkCanJoin() {
    const pseudo = $$().pseudo().value.trim();
    const hasPartie = state.selectedPartieId !== null;
    const isValid = validatePseudo(pseudo).valid && hasPartie;
    const btn = $$().btnSubmit();
    if (btn) btn.disabled = !isValid || state.isConnecting;
}

/**
 * Initialise WebSocket
 */
function initWebSocket() {
    socket.on('__connected__', () => {
        console.log('✅ WebSocket connecté');
    });

    socket.on('JOIN_OK', ({ pseudo, snapshot }) => {
        console.log('✅ Rejoint:', pseudo);

        try {
            sessionStorage.setItem('mgu_game_session', JSON.stringify({
                partieId: state.selectedPartieId,
                pseudo,
                jeu: snapshot.jeu,
                mode: snapshot.mode,
                role: 'player',
            }));
        } catch {}

        setTimeout(() => {
            window.location.href = `/games/${snapshot.jeu}/?partieId=${state.selectedPartieId}&pseudo=${encodeURIComponent(pseudo)}`;
        }, 500);
    });

    socket.on('JOIN_ERROR', ({ code }) => {
        state.isConnecting = false;
        const btn = $$().btnSubmit();
        if (btn) btn.disabled = false;

        const messages = {
            GAME_NOT_FOUND: 'Partie introuvable',
            PSEUDO_TAKEN: 'Pseudo déjà utilisé',
            GAME_STARTED: 'Partie déjà en cours',
            MAX_PLAYERS: 'Partie pleine',
        };
        toast(messages[code] || `Erreur: ${code}`, 'error');
    });
}

/**
 * Rejoint une partie
 */
function handleJoin() {
    const pseudo = $$().pseudo().value.trim();
    const validation = validatePseudo(pseudo);

    if (!validation.valid) {
        toast(validation.error, 'error');
        return;
    }

    if (!state.selectedPartieId) {
        toast('Sélectionnez une partie', 'error');
        return;
    }

    try {
        localStorage.setItem('mgu_last_pseudo', pseudo);
    } catch {}

    state.isConnecting = true;
    const btn = $$().btnSubmit();
    if (btn) btn.disabled = true;

    socket.send('PLAYER_JOIN', {
        pseudo,
        partieId: state.selectedPartieId,
    });

    setTimeout(() => {
        if (state.isConnecting) {
            state.isConnecting = false;
            if (btn) btn.disabled = false;
            toast('Timeout', 'error');
        }
    }, 10000);
}

/**
 * Init
 */
function init() {
    const pseudo = $$().pseudo();
    if (pseudo) {
        const last = localStorage.getItem('mgu_last_pseudo');
        if (last) pseudo.value = last;
        pseudo.addEventListener('input', checkCanJoin);
        pseudo.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !$$().btnSubmit().disabled) handleJoin();
        });
    }

    $$().btnSubmit()?.addEventListener('click', handleJoin);
    $$().btnRefresh()?.addEventListener('click', loadParties);

    initWebSocket();
    loadParties();
    setInterval(loadParties, 5000);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}