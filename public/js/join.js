// ======================================================
// 🎮 JOIN.JS — Interface de connexion aux parties
// ======================================================
// Responsabilités :
//   1. Charger la liste des parties via GET /api/parties
//   2. Permettre au joueur de saisir son pseudo et le nom de la partie
//   3. Valider les champs (pseudo, nom de partie)
//   4. Appeler POST /api/parties/join pour rejoindre
//   5. Gérer les erreurs et rediriger vers l'URL renvoyée
// ======================================================

// ── Constants ────────────────────────────────────────
const GAME_ICONS = {
    quiz: '❓',
    justeprix: '💰',
    undercover: '🕵️',
    lml: '📖',
    mimer: '��',
    pendu: '🪢',
    petitbac: '📝',
    memoire: '🧠',
    morpion: '⭕',
    puissance4: '🔴',
};

const PSEUDO_REGEX = /^[a-zA-Z0-9_-]{2,20}$/;
const PARTIE_NAME_REGEX = /^[a-zA-Z0-9_\s-]{2,30}$/;

// ── DOM Elements ─────────────────────────────────────
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

/**
 * Échappe les caractères HTML pour éviter les XSS
 */
const esc = (str) => String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Affiche une notification toast
 */
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

/**
 * Affiche un message d'erreur
 */
function showError(msg) {
    const el = $$().errorMsg();
    if (el) {
        el.textContent = msg;
        el.classList.add('show');
    }
}

/**
 * Masque le message d'erreur
 */
function hideError() {
    const el = $$().errorMsg();
    if (el) {
        el.classList.remove('show');
        el.textContent = '';
    }
}

/**
 * Affiche un message de succès
 */
function showSuccess(msg) {
    const el = $$().successMsg();
    if (el) {
        el.textContent = msg;
        el.classList.add('show');
    }
}

/**
 * Masque le message de succès
 */
function hideSuccess() {
    const el = $$().successMsg();
    if (el) {
        el.classList.remove('show');
        el.textContent = '';
    }
}

// ── Validation Functions ─────────────────��───────────

/**
 * Valide le pseudo
 */
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

/**
 * Valide le nom de la partie
 */
function validatePartieName(name) {
    const trimmed = name.trim();

    if (trimmed.length < 2) {
        return { valid: false, error: 'Le nom de la partie doit faire au moins 2 caractères.' };
    }
    if (trimmed.length > 30) {
        return { valid: false, error: 'Le nom de la partie ne peut pas dépasser 30 caractères.' };
    }
    if (!PARTIE_NAME_REGEX.test(trimmed)) {
        return { valid: false, error: 'Le nom de la partie peut contenir des lettres, chiffres, espaces, tirets et underscores.' };
    }

    return { valid: true };
}

// ── Partie Selection ─────────────────────────────────

/**
 * Sélectionne une partie
 */
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
        const joueurs = state.selectedPartie.joueurs?.length || 0;
        $$().selectedGame().textContent = `${esc((state.selectedPartie.jeu || '').toUpperCase())} · ${joueurs} joueur${joueurs !== 1 ? 's' : ''}`;

        // Pré-remplir le nom de la partie
        const partieNameInput = $$().partieName();
        if (partieNameInput) {
            partieNameInput.value = state.selectedPartie.nom;
            if ($$().partieNameCount()) {
                $$().partieNameCount().textContent = state.selectedPartie.nom.length;
            }
        }
    } else {
        $$().selectedInfo().classList.remove('show');
    }

    checkCanJoin();
}

// ── Join Validation ─────────────────────────────────

/**
 * Vérifie si le formulaire est valide pour rejoindre
 */
function checkCanJoin() {
    const pseudo = $$().pseudo().value.trim();
    const partieName = $$().partieName().value.trim();

    const pseudoValid = validatePseudo(pseudo).valid;
    const partieNameValid = validatePartieName(partieName).valid;
    const hasSelectedPartie = state.selectedPartieId !== null;
    const isValid = pseudoValid && partieNameValid && hasSelectedPartie;

    $$().btnSubmit().disabled = !isValid || state.isConnecting;
}

// ── Render Parties ──────────────────────────────────

/**
 * Affiche la liste des parties disponibles
 */
function renderParties(parties) {
    // Filtrer les parties en attente
    const filtered = (parties || []).filter(p =>
        p.statut === 'waiting' || p.statut === 'lobby' || p.statut === 'en_attente'
    );
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
        const maxPlayers = partie.maxJoueurs || 8;

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
                        <span class="partie-badge">${esc((partie.jeu || 'UNKNOWN').toUpperCase())}</span>
                        ${partie.mode === 'team' ? '<span class="partie-badge">🛡️ Équipes</span>' : '<span class="partie-badge">👤 Solo</span>'}
                    </div>
                </div>
                <div class="partie-joueurs">
                    <span>${joueurs.length}/${maxPlayers}</span>
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

    // Attacher les gestionnaires d'événements
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

/**
 * Charge la liste des parties via GET /api/parties
 */
async function loadParties() {
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

    try {
        const response = await fetch('/api/parties');
        if (!response.ok) {
            throw new Error(`Erreur HTTP ${response.status}`);
        }

        const data = await response.json();
        renderParties(data.parties || data);
    } catch (err) {
        console.error('Erreur lors du chargement des parties:', err);
        if (container) {
            container.className = 'parties-list empty';
            container.innerHTML = `
                <div style="text-align: center;">
                    <p style="font-size: 1.2rem; margin-bottom: 0.5rem;">⚠️</p>
                    <p>Impossible de charger les parties.</p>
                    <p style="font-size: 0.85rem; opacity: 0.7; margin-top: 0.5rem;">Vérifiez votre connexion.</p>
                </div>
            `;
        }
        toast('Erreur lors du chargement des parties', 'error');
    }
}

// ── Join Handler ─────────────────────────────────────

/**
 * Gère la soumission du formulaire pour rejoindre une partie
 */
async function handleJoin() {
    hideError();
    hideSuccess();

    const pseudo = $$().pseudo().value.trim();
    const partieName = $$().partieName().value.trim();

    // Validation pseudo
    const pseudoValidation = validatePseudo(pseudo);
    if (!pseudoValidation.valid) {
        showError(pseudoValidation.error);
        return;
    }

    // Validation nom de partie
    const partieNameValidation = validatePartieName(partieName);
    if (!partieNameValidation.valid) {
        showError(partieNameValidation.error);
        return;
    }

    // Vérification que la partie est sélectionnée
    if (!state.selectedPartieId) {
        showError('Sélectionnez une partie dans la liste.');
        return;
    }

    // Vérification que le nom de la partie saisie correspond à la sélectionnée
    if (state.selectedPartie && state.selectedPartie.nom !== partieName) {
        showError('Le nom de la partie ne correspond pas à celle sélectionnée.');
        return;
    }

    // Sauvegarde du pseudo en localStorage
    try {
        localStorage.setItem('mgu_last_pseudo', pseudo);
    } catch (err) {
        console.warn('Impossible de sauvegarder le pseudo:', err);
    }

    state.isConnecting = true;
    const btnSubmit = $$().btnSubmit();
    btnSubmit.disabled = true;
    const originalText = btnSubmit.textContent;
    btnSubmit.innerHTML = '<span class="loading-spinner" style="display:inline-block;"></span> Connexion…';

    try {
        // Appel POST /api/parties/join
        const response = await fetch('/api/parties/join', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                pseudo,
                partieName,
                partieId: state.selectedPartieId,
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            // Erreur du serveur
            const errorMessage = data.error || data.message || 'Erreur inconnue';
            showError(errorMessage);
            toast(errorMessage, 'error');
            state.isConnecting = false;
            btnSubmit.disabled = false;
            btnSubmit.textContent = originalText;
            return;
        }

        // Succès
        showSuccess(`✅ Bienvenue ${pseudo}!`);
        toast(`Bienvenue ${pseudo}!`, 'success');

        // Sauvegarde de la session
        try {
            sessionStorage.setItem('mgu_game_session', JSON.stringify({
                partieId: state.selectedPartieId,
                pseudo,
                partieName,
                role: 'player',
            }));
        } catch (err) {
            console.warn('Impossible de sauvegarder la session:', err);
        }

        // Redirection vers l'URL renvoyée par le serveur
        if (data.redirectUrl) {
            setTimeout(() => {
                window.location.href = data.redirectUrl;
            }, 1000);
        } else {
            console.warn('Pas de redirectUrl fournie par le serveur');
            // Redirection par défaut
            setTimeout(() => {
                window.location.href = '/games/';
            }, 1000);
        }

    } catch (err) {
        console.error('Erreur lors de la connexion:', err);
        const errorMsg = err.message || 'Erreur de connexion';
        showError(errorMsg);
        toast(errorMsg, 'error');
        state.isConnecting = false;
        btnSubmit.disabled = false;
        btnSubmit.textContent = originalText;
    }
}

// ── Event Listeners ──────────────────────────────────

/**
 * Attache les écouteurs d'événements au formulaire
 */
function attachEventListeners() {
    // Pseudo input
    const pseudo = $$().pseudo();
    if (pseudo) {
        pseudo.addEventListener('input', (e) => {
            if ($$().pseudoCount()) {
                $$().pseudoCount().textContent = e.target.value.length;
            }
            checkCanJoin();
        });
        pseudo.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !$$().btnSubmit().disabled) {
                handleJoin();
            }
        });

        // Charger le dernier pseudo
        const lastPseudo = localStorage.getItem('mgu_last_pseudo');
        if (lastPseudo) {
            pseudo.value = lastPseudo;
            if ($$().pseudoCount()) {
                $$().pseudoCount().textContent = lastPseudo.length;
            }
        }
    }

    // Partie name input
    const partieName = $$().partieName();
    if (partieName) {
        partieName.addEventListener('input', (e) => {
            if ($$().partieNameCount()) {
                $$().partieNameCount().textContent = e.target.value.length;
            }
            checkCanJoin();
        });
        partieName.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !$$().btnSubmit().disabled) {
                handleJoin();
            }
        });
    }

    // Submit button
    const btnSubmit = $$().btnSubmit();
    if (btnSubmit) {
        btnSubmit.addEventListener('click', handleJoin);
    }

    // Create button
    const btnCreate = $$().btnCreate();
    if (btnCreate) {
        btnCreate.addEventListener('click', () => {
            window.location.href = '/host/';
        });
    }

    // Refresh button
    const btnRefresh = $$().btnRefresh();
    if (btnRefresh) {
        btnRefresh.addEventListener('click', loadParties);
    }

    // Form submission
    const form = $$().form();
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
        });
    }
}

// ── Init ─────────────────────────────────────────────

/**
 * Initialise le module
 */
function init() {
    attachEventListeners();

    // Charger les parties au démarrage
    loadParties();

    // Charger les parties toutes les 5 secondes (actualisation auto)
    setInterval(loadParties, 5000);
}

// Lancer l'initialisation au chargement du DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}