// ======================================================
// 🎮 JOIN.JS v3.0 — CODE DE PARTIE AJOUTÉ
// ======================================================
// Nouveautés v3.0 :
//  - handleJoinByCode()      : rejoint via code 6 caractères
//  - PLAYER_JOIN_BY_CODE     : envoi WebSocket dédié
//  - Pré-remplissage depuis ?code=XXXXXX (QR code / lien)
//  - Validation REST /api/parties/code/:code avant WS
//  - Auto-focus pseudo si code déjà rempli
//  - Bouton #join-btn-code + champ #join-code (dans le HTML)
// Conservé de v2 :
//  - Recherche par nom exact (REST + local)
//  - Liste des parties avec sélection
//  - PLAYER_JOIN par partieId (flow original)
//  - JOIN_OK → redirection vers le jeu
//  - JOIN_ERROR → messages d'erreur clairs
//  - Actualisation auto toutes les 5s
// ======================================================

import { GameSocket } from './core/socket.js';

const socket = new GameSocket();

// ── Config ────────────────────────────────────────────
const PSEUDO_REGEX = /^[a-zA-Z0-9_-]{2,20}$/;
const CODE_REGEX   = /^[A-Z0-9]{6}$/;

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
    el.style.cssText = 'display:flex;gap:0.5rem;align-items:center;padding:0.75rem 1rem;border-radius:8px;background:#1e1e2e;color:#fff;box-shadow:0 4px 12px rgba(0,0,0,.4);opacity:0;transition:opacity .25s;pointer-events:auto;';
    container.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 300);
    }, duration);
}

// ══════════════════════════════════════════════════════
// CHARGEMENT DES PARTIES
// ══════════════════════════════════════════════════════

async function loadParties() {
    const container = $('join-parties-list');
    if (container && !state.selectedPartieId) {
        container.innerHTML = `<div class="loading-state" style="text-align:center;padding:2rem;opacity:.6;">
            <div class="loading-spinner" style="margin:0 auto 0.5rem;width:24px;height:24px;border:3px solid #444;border-top-color:#00d4ff;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
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
    const nameInput = $('join-partie-name');
    if (!nameInput) return;
    const nom = nameInput.value.trim();
    if (!nom) {
        toast('Entrez le nom exact de la partie.', 'warning');
        return;
    }

    // Cherche dans la liste chargée
    const found = state.parties.find(
        p => p.nom.toLowerCase() === nom.toLowerCase() &&
             (p.statut === 'lobby' || p.statut === 'waiting')
    );

    if (found) {
        selectPartie(found.id);
        toast(`Partie "${found.nom}" trouvée !`, 'success', 2000);
        return;
    }

    // Pas trouvé localement → rafraîchit puis cherche à nouveau
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
// ✅ NEW v3.0 — REJOINDRE PAR CODE COURT
// Résolution REST /api/parties/code/:code (validation UX rapide),
// puis envoi WebSocket PLAYER_JOIN_BY_CODE.
// ══════════════════════════════════════════════════════

async function handleJoinByCode() {
    const codeEl   = $('join-code');
    const pseudoEl = $('join-pseudo');
    if (!codeEl || !pseudoEl) return;

    const code   = codeEl.value.trim().toUpperCase();
    const pseudo = pseudoEl.value.trim();

    // ── Validation du code ──────────────────────────
    if (!CODE_REGEX.test(code)) {
        toast('Code invalide — 6 caractères alphanumériques (ex : AB3X7K).', 'error');
        codeEl.focus();
        return;
    }

    // ── Validation du pseudo ────────────────────────
    const vPseudo = validatePseudo(pseudo);
    if (!vPseudo.valid) {
        toast(vPseudo.error, 'error');
        pseudoEl.focus();
        return;
    }

    // ── Vérification REST (UX : erreur avant d'ouvrir WS) ──
    try {
        const res = await fetch(`/api/parties/code/${code}`, {
            signal: AbortSignal.timeout(4000),
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            toast(errData.error || 'Code invalide ou expiré.', 'error');
            return;
        }

        const partieData = await res.json();

        // Vérification pseudo côté client
        if ((partieData.joueurs || []).some(j => j.pseudo.toLowerCase() === pseudo.toLowerCase())) {
            toast('Ce pseudo est déjà utilisé dans cette partie.', 'error');
            return;
        }

        // Pré-sélectionner la partie pour cohérence avec le reste de l'UI
        if (!state.parties.find(p => p.id === partieData.id)) {
            state.parties.push(partieData);
        }
        state.selectedPartieId = partieData.id;
        state.selectedPartie   = partieData;
        renderParties(state.parties);
        updateSelectedInfo();

    } catch (err) {
        console.error('[JOIN] Erreur vérification code:', err);
        toast('Impossible de vérifier le code. Vérifiez votre connexion.', 'error');
        return;
    }

    // ── Envoi WebSocket ─────────────────────────────
    state.isConnecting = true;
    const btn = $('join-btn-code');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Connexion…'; }

    socket.send('PLAYER_JOIN_BY_CODE', { code, pseudo });

    // Timeout de sécurité
    setTimeout(() => {
        if (state.isConnecting) {
            state.isConnecting = false;
            if (btn) { btn.disabled = false; btn.textContent = '→ Rejoindre'; }
            toast('Délai dépassé. Vérifiez la connexion.', 'error');
        }
    }, 10000);
}

// ══════════════════════════════════════════════════════
// VALIDATION PSEUDO
// ══════════════════════════════════════════════════════

function validatePseudo(pseudo) {
    const t = pseudo.trim();
    if (t.length < 2)  return { valid: false, error: 'Minimum 2 caractères.' };
    if (t.length > 20) return { valid: false, error: 'Maximum 20 caractères.' };
    if (!PSEUDO_REGEX.test(t)) return { valid: false, error: 'Lettres, chiffres, tiret, underscore uniquement.' };
    return { valid: true };
}

function checkCanJoin() {
    const pseudoEl = $('join-pseudo');
    const btn      = $('join-btn-submit');
    if (!pseudoEl || !btn) return;

    const pseudo = pseudoEl.value.trim();
    const ok     = validatePseudo(pseudo).valid && !!state.selectedPartieId;
    btn.disabled = !ok || state.isConnecting;
}

// ══════════════════════════════════════════════════════
// REJOINDRE PAR LISTE / NOM (flow original)
// ══════════════════════════════════════════════════════

function handleJoin() {
    const pseudoEl = $('join-pseudo');
    if (!pseudoEl) return;

    const pseudo     = pseudoEl.value.trim();
    const validation = validatePseudo(pseudo);

    if (!validation.valid) { toast(validation.error, 'error'); return; }
    if (!state.selectedPartieId) { toast('Sélectionnez ou cherchez une partie.', 'error'); return; }

    // Vérif locale : pseudo déjà dans la partie ?
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
        if (state.isConnecting) {
            state.isConnecting = false;
            if (btn) { btn.disabled = false; btn.textContent = '🎮 Rejoindre'; }
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
    });

    socket.on('PARTIES_LIST', ({ parties }) => {
        if (parties) {
            state.parties = parties;
            renderParties(state.parties);
        }
    });

    // ✅ Commun aux deux flows (PLAYER_JOIN et PLAYER_JOIN_BY_CODE)
    socket.on('JOIN_OK', ({ pseudo, equipe, snapshot }) => {
        state.isConnecting = false;
        console.log('[JOIN] ✅ Rejoint:', pseudo, 'équipe:', equipe);

        try {
            sessionStorage.setItem('mgu_game_session', JSON.stringify({
                partieId: state.selectedPartieId,
                pseudo,
                equipe:   equipe || null,
                jeu:      snapshot.jeu,
                mode:     snapshot.mode,
                role:     'player',
            }));
        } catch {}

        toast(`Bienvenue ${pseudo} ! Redirection…`, 'success', 1500);

        // Redirection vers le bon jeu
        const gamePath = JEU_PATHS[snapshot.jeu] || `/games/${snapshot.jeu}/`;
        setTimeout(() => {
            window.location.href = `${gamePath}?partieId=${state.selectedPartieId}&pseudo=${encodeURIComponent(pseudo)}`;
        }, 800);
    });

    socket.on('JOIN_ERROR', ({ code }) => {
        state.isConnecting = false;

        // Réactiver tous les boutons possibles
        const btnSubmit = $('join-btn-submit');
        if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.textContent = '🎮 Rejoindre la partie'; }
        const btnCode = $('join-btn-code');
        if (btnCode) { btnCode.disabled = false; btnCode.textContent = '→ Rejoindre'; }

        const messages = {
            GAME_NOT_FOUND:       'Partie introuvable ou terminée.',
            CODE_INVALID:         'Code invalide ou expiré. Demandez le code à votre host.',
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
        setTimeout(() => window.location.href = '/join/', 2000);
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
    console.log('[JOIN] Initialisation v3.0');

    // Connexion WebSocket
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket.connect(`${wsProto}//${location.host}/ws`);
    initSocketEvents();

    // ── Champ pseudo ────────────────────────────────
    const pseudoEl = $('join-pseudo');
    if (pseudoEl) {
        const last = localStorage.getItem('mgu_last_pseudo');
        if (last) pseudoEl.value = last;
        pseudoEl.addEventListener('input', checkCanJoin);
        pseudoEl.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !$('join-btn-submit')?.disabled) handleJoin();
        });
    }

    // ── Champ nom de partie ──────────────────────────
    const nameInput = $('join-partie-name');
    if (nameInput) {
        nameInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') handleSearchByName();
        });
    }

    // ── Champ code court ─────────────────────────────
    const codeInput = $('join-code');
    if (codeInput) {
        // Forcer majuscules à la frappe
        codeInput.addEventListener('input', e => {
            e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        });
        // Entrée = rejoindre par code
        codeInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') handleJoinByCode();
        });
    }

    // ── Boutons ──────────────────────────────────────
    $('join-btn-search')?.addEventListener('click', handleSearchByName);
    $('join-btn-submit')?.addEventListener('click', handleJoin);
    $('join-btn-code')?.addEventListener('click', handleJoinByCode);
    $('join-btn-refresh')?.addEventListener('click', () => {
        state.selectedPartieId = null;
        state.selectedPartie   = null;
        loadParties();
    });

    // ── ✅ NEW v3.0 : pré-remplissage depuis l'URL ───
    // Le QR code et les liens partagés incluent ?code=XXXXXX
    const urlParams = new URLSearchParams(location.search);
    const codeParam = urlParams.get('code');
    if (codeParam) {
        const cleaned = codeParam.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
        if (codeInput && cleaned) {
            codeInput.value = cleaned;
            // Focus sur le pseudo si le code est valide
            if (CODE_REGEX.test(cleaned)) {
                toast('Code de partie détecté — entrez votre pseudo !', 'info', 3500);
                setTimeout(() => $('join-pseudo')?.focus(), 300);
            }
        }
    }

    // Pré-remplir pseudo depuis localStorage
    if (pseudoEl && !pseudoEl.value) {
        const last = localStorage.getItem('mgu_last_pseudo');
        if (last) pseudoEl.value = last;
    }

    // ── Chargement initial des parties ──────────────
    loadParties();

    // Actualisation auto toutes les 5s
    state.refreshTimer = setInterval(() => {
        if (!state.isConnecting) loadParties();
    }, 5000);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}