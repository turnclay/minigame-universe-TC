// ======================================================
// 🟦 HOST.JS — Interface hôte (Option A - WebSocket)
// ======================================================
// Responsabilités :
//   1. Connexion WebSocket au serveur /ws
//   2. Envoi HOST_AUTH pour s'authentifier
//   3. Création de parties via HOST_CREATE_GAME
//   4. Gestion des joueurs et scores
//   5. Contrôle du jeu (démarrage, arrêt)
// ======================================================

import { socket } from './core/socket.js';

// ── Constants ────────────────────────────────────────
const GAME_ICONS = {
    quiz: '❓',
    justeprix: '💰',
    undercover: '🕵️',
    lml: '📖',
    mimer: '🎭',
    pendu: '🪢',
    petitbac: '📝',
    memoire: '🧠',
    morpion: '⭕',
    puissance4: '🔴',
};

const JEU_PATHS = {
    quiz: '/games/quiz/',
    justeprix: '/games/justeprix/',
    undercover: '/games/undercover/',
    lml: '/games/lml/',
    mimer: '/games/mimer/',
    pendu: '/games/pendu/',
    petitbac: '/games/petitbac/',
    memoire: '/games/memoire/',
    morpion: '/games/morpion/',
    puissance4: '/games/puissance4/',
};

const PSEUDO_REGEX = /^[a-zA-Z0-9_-]{2,20}$/;
const PARTIE_NAME_REGEX = /^[a-zA-Z0-9_\s-]{2,30}$/;

const ERROR_CODES = {
    NOT_HOST: 'Vous n\'êtes pas host.',
    PSEUDO_INVALID: 'Pseudo invalide.',
    GAME_NOT_FOUND: 'Partie introuvable.',
    GAME_STARTED: 'Partie déjà en cours.',
    PSEUDO_TAKEN: 'Pseudo déjà utilisé.',
    MAX_PLAYERS: 'Partie pleine.',
    MISSING_FIELDS: 'Données manquantes.',
    HOST_ALREADY_HAS_GAME: 'Host a déjà une partie active.',
    NO_ACTIVE_GAME: 'Aucune partie active.',
};

// ── DOM Helpers ──────────────────────────────────────
const $ = (id) => document.getElementById(id);
const show = (id) => {
    const el = $(id);
    if (el) el.hidden = false;
};
const hide = (id) => {
    const el = $(id);
    if (el) el.hidden = true;
};
const esc = (str) => String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// ── State ────────────────────────────────────────────
const HostState = {
    partieId: null,
    partieNom: null,
    jeu: null,
    mode: 'solo',
    equipes: [],
    joueurs: [],
    scores: {},
    statut: null,
    hostJoue: false,
    hostPseudo: null,
    partieEnCours: false,
    isConnecting: false,
};

// ══════════════════════════════════════════════════════
// 🔌 SOCKET CONNECTION & EVENTS
// ══════════════════════════════════════════════════════

/**
 * Initialise la connexion WebSocket
 */
function initSocketConnection() {
    socket.on('__connected__', () => {
        console.log('✅ WebSocket connecté');
        updateConnectionStatus(true);

        // Envoyer l'authentification host
        socket.send('HOST_AUTH', {});
    });

    socket.on('__disconnected__', () => {
        console.warn('⚠️ WebSocket déconnecté');
        updateConnectionStatus(false);
        toast('Connexion perdue…', 'warning');
    });
}

/**
 * Initialise les événements du serveur
 */
function initSocketEvents() {
    // ── AUTH_OK ──
    socket.on('AUTH_OK', ({ message }) => {
        console.log('✅ Host authentifié');
        toast('Connecté en tant que host', 'success', 2000);
    });

    // ── GAME_CREATED ──
    socket.on('GAME_CREATED', ({ partieId, snapshot }) => {
        console.log('✅ Partie créée:', partieId);
        HostState.partieId = partieId;
        HostState.partieEnCours = true;
        HostState.statut = 'lobby';
        applySnapshot(snapshot);
        sauvegarderPartieLocale(snapshot);

        show('panel-game');
        hide('form-creation');
        renderGamePanel();
        renderJoueursConnectes();
        renderScores();

        toast(`Partie "${HostState.partieNom}" créée !`, 'success');
    });

    // ── PLAYER_JOINED ──
    socket.on('PLAYER_JOINED', ({ pseudo, equipe, joueurs }) => {
        console.log(`${pseudo} a rejoint la partie`);
        HostState.joueurs = joueurs;
        renderJoueursConnectes();
        renderScoresSp();
        renderJoueursSp();
        toast(`${pseudo} a rejoint`, 'info', 1500);
    });

    // ── PLAYER_LEFT ──
    socket.on('PLAYER_LEFT', ({ pseudo, joueurs }) => {
        console.log(`${pseudo} a quitté la partie`);
        HostState.joueurs = joueurs;
        renderJoueursConnectes();
        renderScoresSp();
        renderJoueursSp();
        toast(`${pseudo} a quitté`, 'warning', 1500);
    });

    // ── SCORES_UPDATE ──
    socket.on('SCORES_UPDATE', ({ scores }) => {
        console.log('📊 Scores mis à jour:', scores);
        HostState.scores = scores;
        renderScores();
        renderScoresSp();
    });

    // ── GAME_STARTED ──
    socket.on('GAME_STARTED', ({ snapshot }) => {
        console.log('🚀 Partie démarrée');
        applySnapshot(snapshot);
        HostState.statut = 'en_cours';
        afficherEcranSpectateur(snapshot);
        sauvegarderSessionHost(snapshot);
        toast('Partie lancée !', 'success', 2000);
    });

    // ── GAME_ENDED ──
    socket.on('GAME_ENDED', ({ snapshot }) => {
        console.log('🏁 Partie terminée');
        applySnapshot(snapshot);
        HostState.statut = 'terminee';
        HostState.partieEnCours = false;
        _setStatutBadge('terminee');
        _setStatutBadgeSp('terminee');
        hide('sp-btn-end');
        show('sp-btn-nouvelle');
        renderScoresSp();
        renderResultatsSp();
        toast('Partie terminée !', 'info');
    });

    // ── ERROR ──
    socket.on('ERROR', ({ code, message }) => {
        console.error('Erreur serveur:', code, message);
        const msg = ERROR_CODES[code] || message || `Erreur: ${code}`;
        toast(msg, 'error');
    });
}

// ══════════════════════════════════════════════════════
// 🎮 CRÉATION DE PARTIE
// ══════════════════════════════════════════════════════

/**
 * Initialise le formulaire de création de partie
 */
function initCreerPartie() {
    const btnCreer = $('h-btn-creer');
    if (!btnCreer) return;

    btnCreer.addEventListener('click', () => {
        if (HostState.partieEnCours) {
            toast('Terminez votre partie en cours d\'abord.', 'warning');
            return;
        }

        const nom = $('h-nom-partie')?.value.trim();
        const jeu = $('h-jeu')?.value;
        const mode = HostState.mode;

        // Validations
        if (!nom) {
            toast('Donnez un nom à la partie.', 'warning');
            return;
        }

        if (!PARTIE_NAME_REGEX.test(nom)) {
            toast('Nom de partie invalide.', 'warning');
            return;
        }

        if (!jeu) {
            toast('Sélectionnez un jeu.', 'warning');
            return;
        }

        if (mode === 'team' && HostState.equipes.length < 2) {
            toast('Il faut au moins 2 équipes.', 'warning');
            return;
        }

        let hostPseudo = null;
        if (HostState.hostJoue) {
            hostPseudo = $('h-host-pseudo')?.value.trim();
            if (!hostPseudo) {
                toast('Entrez votre pseudo.', 'warning');
                return;
            }
            const pseudoValidation = validatePseudo(hostPseudo);
            if (!pseudoValidation.valid) {
                toast(pseudoValidation.error, 'warning');
                return;
            }
            HostState.hostPseudo = hostPseudo;
        }

        HostState.isConnecting = true;
        btnCreer.disabled = true;
        btnCreer.textContent = '⏳ Création…';

        // Envoi via WebSocket
        socket.send('HOST_CREATE_GAME', {
            nom,
            jeu,
            mode,
            equipes: HostState.equipes,
            hostJoue: HostState.hostJoue,
            hostPseudo,
        });

        setTimeout(() => {
            if (HostState.isConnecting) {
                HostState.isConnecting = false;
                btnCreer.disabled = false;
                btnCreer.textContent = '🎮 Créer la partie';
                toast('Délai d\'attente dépassé.', 'error');
            }
        }, 10000);
    });
}

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

// ══════════════════════════════════════════════════════
// 🛡️ MODE TOGGLE (SOLO / TEAM)
// ══════════════════════════════════════════════════════

/**
 * Initialise les toggles de mode
 */
function initModeToggle() {
    const btnSolo = $('btn-mode-solo');
    const btnTeam = $('btn-mode-equipes');

    const setMode = (mode) => {
        HostState.mode = mode;
        if (btnSolo) btnSolo.classList.toggle('active', mode === 'solo');
        if (btnTeam) btnTeam.classList.toggle('active', mode === 'team');

        const blocSolo = $('bloc-solo');
        const blocTeam = $('bloc-equipes');
        if (mode === 'solo') {
            if (blocSolo) blocSolo.hidden = false;
            if (blocTeam) blocTeam.hidden = true;
        } else {
            if (blocSolo) blocSolo.hidden = true;
            if (blocTeam) blocTeam.hidden = false;
        }
    };

    if (btnSolo) btnSolo.addEventListener('click', () => setMode('solo'));
    if (btnTeam) btnTeam.addEventListener('click', () => setMode('team'));

    setMode('solo');
}

// ══════════════════════════════════════════════════════
// 👤 HOST JOUE TOGGLE
// ══════════════════════════════════════════════════════

/**
 * Initialise le toggle "Host joue"
 */
function initHostRoleToggle() {
    const checkbox = $('h-host-joue');
    if (!checkbox) return;

    checkbox.addEventListener('change', (e) => {
        HostState.hostJoue = e.target.checked;
        const wrap = $('h-host-pseudo-wrap');
        if (wrap) wrap.hidden = !e.target.checked;
    });
}

// ══════════════════════════════════════════════════════
// 👥 ÉQUIPES
// ══════════════════════════════════════════════════════

/**
 * Initialise la gestion des équipes
 */
function initEquipes() {
    const input = $('h-equipe-input');
    const btn = $('h-equipe-ajouter');

    const ajouter = () => {
        const nom = input?.value.trim();
        if (!nom) return;

        if (HostState.equipes.some(e => e.nom.toLowerCase() === nom.toLowerCase())) {
            toast('Équipe déjà existante.', 'warning');
            return;
        }

        HostState.equipes.push({ nom, membres: [] });
        if (input) input.value = '';
        renderEquipesForm();
    };

    if (btn) btn.addEventListener('click', ajouter);
    if (input) input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') ajouter();
    });

    renderEquipesForm();
}

/**
 * Affiche la liste des équipes en édition
 */
function renderEquipesForm() {
    const container = $('h-equipes-list');
    if (!container) return;

    if (HostState.equipes.length === 0) {
        container.innerHTML = '<p class="list-empty">Créez au moins 2 équipes pour démarrer</p>';
        return;
    }

    container.innerHTML = HostState.equipes.map((eq, i) => `
        <div class="equipe-form-item">
            <div class="equipe-form-header">
                <span class="equipe-icon">🛡️</span>
                <span class="equipe-form-nom">${esc(eq.nom)}</span>
                <button class="btn-remove btn-del-equipe" data-i="${i}" type="button">×</button>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('.btn-del-equipe').forEach(btn => {
        btn.addEventListener('click', () => {
            HostState.equipes.splice(parseInt(btn.dataset.i), 1);
            renderEquipesForm();
        });
    });
}

// ══════════════════════════════════════════════════════
// 🕹️ CONTRÔLES DE JEU
// ══════════════════════════════════════════════════════

/**
 * Initialise les contrôles du jeu
 */
function initControles() {
    // Démarrer la partie
    const btnStart = $('h-btn-start');
    if (btnStart) {
        btnStart.addEventListener('click', () => {
            if (!HostState.partieId) return;
            socket.send('HOST_START_GAME', {});
        });
    }

    // Terminer la partie (lobby)
    const btnEnd = $('h-btn-end');
    if (btnEnd) {
        btnEnd.addEventListener('click', () => {
            if (confirm('Êtes-vous sûr de vouloir terminer la partie ?')) {
                socket.send('HOST_END_GAME', {});
            }
        });
    }

    // Nouvelle partie
    const btnNouvelle = $('h-btn-nouvelle');
    if (btnNouvelle) {
        btnNouvelle.addEventListener('click', resetPourNouvellePartie);
    }

    // Copier le lien
    const btnCopy = $('h-btn-copy');
    if (btnCopy) {
        btnCopy.addEventListener('click', () => {
            const link = $('h-join-link');
            if (!link?.href || link.href === '#') return;
            navigator.clipboard.writeText(link.href)
                .then(() => toast('✅ Lien copié !', 'success', 1500))
                .catch(() => toast('Impossible de copier le lien', 'error'));
        });
    }

    // Accueil
    const btnHome = $('btn-go-home');
    if (btnHome) {
        btnHome.addEventListener('click', () => {
            window.location.href = '/';
        });
    }

    // ── Contrôles spectateur ──

    // Terminer (spectateur)
    const spBtnEnd = $('sp-btn-end');
    if (spBtnEnd) {
        spBtnEnd.addEventListener('click', () => {
            if (confirm('Êtes-vous sûr de vouloir terminer la partie ?')) {
                socket.send('HOST_END_GAME', {});
            }
        });
    }

    // Nouvelle partie (spectateur)
    const spBtnNouvelle = $('sp-btn-nouvelle');
    if (spBtnNouvelle) {
        spBtnNouvelle.addEventListener('click', () => {
            hide('host-spectateur');
            show('host-lobby');
            resetPourNouvellePartie();
        });
    }

    // Accueil (spectateur)
    const spBtnHome = $('sp-btn-home');
    if (spBtnHome) {
        spBtnHome.addEventListener('click', () => {
            window.location.href = '/';
        });
    }
}

/**
 * Réinitialise l'état pour une nouvelle partie
 */
function resetPourNouvellePartie() {
    Object.assign(HostState, {
        partieId: null,
        partieNom: null,
        jeu: null,
        equipes: [],
        joueurs: [],
        scores: {},
        statut: null,
        partieEnCours: false,
        hostJoue: false,
        hostPseudo: null,
    });

    hide('panel-game');
    hide('h-btn-nouvelle');
    show('form-creation');
    show('h-btn-start');

    const nomInput = $('h-nom-partie');
    if (nomInput) nomInput.value = '';

    const checkbox = $('h-host-joue');
    if (checkbox) checkbox.checked = false;

    const pseudoWrap = $('h-host-pseudo-wrap');
    if (pseudoWrap) pseudoWrap.hidden = true;

    renderEquipesForm();
    toast('Prêt pour une nouvelle partie !', 'info');
}

// ═════════════════════════════════════════════���════════
// 🖥️ ÉCRAN SPECTATEUR
// ══════════════════════════════════════════════════════

/**
 * Affiche l'écran spectateur après le lancement
 */
function afficherEcranSpectateur(snapshot) {
    hide('host-lobby');
    show('host-spectateur');

    const joinUrl = `${location.origin}/join/?partieId=${HostState.partieId}`;

    // QR Code
    const spQr = $('sp-qr');
    if (spQr) {
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(joinUrl)}&bgcolor=0d0d1a&color=00d4ff&margin=2`;
        spQr.innerHTML = `<img src="${qrUrl}" alt="QR Code" class="qr-img" onerror="this.closest('.qr-container').innerHTML='<p>QR indisponible</p>'">`;
    }

    // Bouton pour que le host rejoigne le jeu
    if (HostState.hostJoue && HostState.hostPseudo) {
        const spActions = document.querySelector('.sp-actions');
        if (spActions && !$('sp-btn-join-game')) {
            const gameUrl = JEU_PATHS[HostState.jeu] || '/games/';
            const btnJoin = document.createElement('a');
            btnJoin.id = 'sp-btn-join-game';
            btnJoin.href = gameUrl;
            btnJoin.className = 'btn btn-primary';
            btnJoin.style.marginBottom = '1rem';
            btnJoin.innerHTML = `🎮 Rejoindre le jeu (${esc(HostState.hostPseudo)})`;
            spActions.insertBefore(btnJoin, spActions.firstChild);
        }
    }

    renderSpectateur(snapshot);
}

/**
 * Affiche les infos du spectateur
 */
function renderSpectateur(snapshot) {
    const snap = snapshot || {};

    if ($('sp-nom')) $('sp-nom').textContent = HostState.partieNom || '—';
    if ($('sp-jeu')) $('sp-jeu').textContent = (HostState.jeu || '—').toUpperCase();
    if ($('sp-mode')) $('sp-mode').textContent = HostState.mode === 'team' ? '🛡️ Équipes' : '👤 Solo';

    _setStatutBadgeSp('en_cours');
    renderScoresSp();
    renderJoueursSp();
}

/**
 * Affiche les scores sur l'écran spectateur
 */
function renderScoresSp() {
    const container = $('sp-scores');
    if (!container) return;

    const entries = Object.entries(HostState.scores).sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) {
        container.innerHTML = '<p class="list-empty">Aucun score pour l\'instant</p>';
        return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    const max = entries[0]?.[1] || 1;

    container.innerHTML = entries.map(([nom, pts], i) => {
        const pct = max > 0 ? Math.round((pts / max) * 100) : 0;
        return `
            <div class="score-row">
                <span class="score-medal">${medals[i] || `${i + 1}.`}</span>
                <span class="score-nom">${esc(nom)}</span>
                <div class="score-bar-wrap"><div class="score-bar" style="width:${pct}%"></div></div>
                <span class="score-pts">${pts} <small>pts</small></span>
                <div class="score-actions">
                    <button class="btn-pts btn-plus" data-cible="${esc(nom)}" data-delta="1">＋</button>
                    <button class="btn-pts btn-minus" data-cible="${esc(nom)}" data-delta="-1">－</button>
                </div>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.btn-pts').forEach(btn => {
        btn.addEventListener('click', () => {
            const delta = parseInt(btn.dataset.delta);
            const cible = btn.dataset.cible;
            if (delta > 0) {
                socket.send('HOST_ADD_POINTS', { cible, points: 1 });
            } else {
                socket.send('HOST_REMOVE_POINTS', { cible, points: 1 });
            }
        });
    });
}

/**
 * Affiche les joueurs connectés sur l'écran spectateur
 */
function renderJoueursSp() {
    const container = $('sp-joueurs');
    if (!container) return;

    if (HostState.joueurs.length === 0) {
        container.innerHTML = '<p class="list-empty">En attente de joueurs…</p>';
        return;
    }

    container.innerHTML = HostState.joueurs.map(j => `
        <div class="joueur-connecte-item">
            <span class="joueur-connecte-avatar">${(j.pseudo || '?').charAt(0).toUpperCase()}</span>
            <span class="joueur-connecte-pseudo">${esc(j.pseudo)}</span>
            <button class="btn-kick" data-pseudo="${esc(j.pseudo)}" type="button" title="Expulser">✖</button>
        </div>
    `).join('');

    container.querySelectorAll('.btn-kick').forEach(btn => {
        btn.addEventListener('click', () => {
            const pseudo = btn.dataset.pseudo;
            if (confirm(`Expulser ${pseudo} ?`)) {
                socket.send('HOST_KICK_PLAYER', { pseudo });
            }
        });
    });
}

/**
 * Affiche les résultats finaux
 */
function renderResultatsSp() {
    const entries = Object.entries(HostState.scores).sort((a, b) => b[1] - a[1]);
    const medals = ['🥇', '🥈', '🥉'];

    const html = `
        <div class="resultats-finaux" style="margin-top: 2rem; padding: 1rem; background: #f0f0f0; border-radius: 8px;">
            <h3 class="resultats-titre">🏁 Résultats finaux</h3>
            ${entries.map(([nom, pts], i) => `
                <div class="resultat-row ${i === 0 ? 'resultat-winner' : ''}" style="padding: 0.5rem; margin: 0.25rem 0;">
                    <span class="resultat-medal">${medals[i] || `${i + 1}.`}</span>
                    <span class="resultat-nom">${esc(nom)}</span>
                    <span class="resultat-pts">${pts} pts</span>
                </div>
            `).join('')}
        </div>
    `;

    const scoresEl = $('sp-scores');
    if (scoresEl) {
        scoresEl.insertAdjacentHTML('afterend', html);
    }
}

// ══════════════════════════════════════════════════════
// 🎨 RENDU UI — Panel Lobby
// ══════════════════════════════════════════════════════

/**
 * Affiche les infos du panel jeu (lobby)
 */
function renderGamePanel() {
    const joinUrl = `${location.origin}/join/?partieId=${HostState.partieId}`;

    if ($('h-info-nom')) $('h-info-nom').textContent = HostState.partieNom || '—';
    if ($('h-info-jeu')) $('h-info-jeu').textContent = (HostState.jeu || '—').toUpperCase();
    if ($('h-info-mode')) $('h-info-mode').textContent = HostState.mode === 'team' ? '🛡️ Équipes' : '👤 Solo';

    _setStatutBadge(HostState.statut || 'lobby');

    const link = $('h-join-link');
    if (link) {
        link.href = joinUrl;
        link.textContent = joinUrl;
    }

    _renderQR(joinUrl);

    if (HostState.mode === 'team') {
        hide('bloc-joueurs-connectes');
        show('bloc-equipes-connectees');
    } else {
        show('bloc-joueurs-connectes');
        hide('bloc-equipes-connectees');
    }

    renderJoueursConnectes();
    renderScores();
}

/**
 * Affiche les joueurs connectés (lobby)
 */
function renderJoueursConnectes() {
    const container = $('h-joueurs-connectes');
    const counter = $('h-nb-joueurs');

    if (!container) return;

    if (counter) counter.textContent = HostState.joueurs.length;

    if (HostState.mode === 'team') {
        const ecContainer = $('h-equipes-connectees');
        const nbEquipes = $('h-nb-equipes');

        const map = {};
        HostState.equipes.forEach(eq => {
            map[eq.nom] = [];
        });

        HostState.joueurs.forEach(j => {
            const eq = j.equipe || 'Sans équipe';
            if (!map[eq]) map[eq] = [];
            map[eq].push(j.pseudo);
        });

        if (nbEquipes) nbEquipes.textContent = Object.keys(map).length;

        if (ecContainer) {
            ecContainer.innerHTML = Object.entries(map).map(([nom, membres]) => `
                <div class="equipe-connectee-card">
                    <div class="equipe-connectee-header">
                        <span class="equipe-icon">🛡️</span>
                        <span class="equipe-connectee-nom">${esc(nom)}</span>
                        <span class="equipe-connectee-count">${membres.length}</span>
                    </div>
                    <div class="equipe-connectee-membres">
                        ${membres.length > 0 ? membres.map(m => `
                            <span class="membre-chip">
                                <span class="membre-avatar">${m.charAt(0).toUpperCase()}</span>
                                ${esc(m)}
                            </span>
                        `).join('') : '<span class="membre-empty">Aucun joueur</span>'}
                    </div>
                </div>
            `).join('');
        }
        return;
    }

    if (HostState.joueurs.length === 0) {
        container.innerHTML = '<p class="list-empty">En attente de joueurs…</p>';
        return;
    }

    container.innerHTML = HostState.joueurs.map(j => `
        <div class="joueur-connecte-item">
            <span class="joueur-connecte-avatar">${(j.pseudo || '?').charAt(0).toUpperCase()}</span>
            <span class="joueur-connecte-pseudo">${esc(j.pseudo)}</span>
            <button class="btn-kick" data-pseudo="${esc(j.pseudo)}" type="button" title="Expulser">✖</button>
        </div>
    `).join('');

    container.querySelectorAll('.btn-kick').forEach(btn => {
        btn.addEventListener('click', () => {
            const pseudo = btn.dataset.pseudo;
            if (confirm(`Expulser ${pseudo} ?`)) {
                socket.send('HOST_KICK_PLAYER', { pseudo });
            }
        });
    });
}

/**
 * Affiche les scores (lobby)
 */
function renderScores() {
    const container = $('h-scores-liste');
    if (!container) return;

    const entries = Object.entries(HostState.scores).sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) {
        container.innerHTML = '<p class="list-empty">Aucun score</p>';
        return;
    }

    const max = entries[0]?.[1] || 1;
    const medals = ['🥇', '🥈', '🥉'];

    container.innerHTML = entries.map(([nom, pts], i) => {
        const pct = max > 0 ? Math.round((pts / max) * 100) : 0;
        return `
            <div class="score-row">
                <span class="score-medal">${medals[i] || `${i + 1}.`}</span>
                <span class="score-nom">${esc(nom)}</span>
                <div class="score-bar-wrap"><div class="score-bar" style="width:${pct}%"></div></div>
                <span class="score-pts">${pts} <small>pts</small></span>
                <div class="score-actions">
                    <button class="btn-pts btn-plus" data-cible="${esc(nom)}" data-delta="1">＋</button>
                    <button class="btn-pts btn-minus" data-cible="${esc(nom)}" data-delta="-1">－</button>
                </div>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.btn-pts').forEach(btn => {
        btn.addEventListener('click', () => {
            const delta = parseInt(btn.dataset.delta);
            const cible = btn.dataset.cible;
            if (delta > 0) {
                socket.send('HOST_ADD_POINTS', { cible, points: 1 });
            } else {
                socket.send('HOST_REMOVE_POINTS', { cible, points: 1 });
            }
        });
    });
}

/**
 * Génère et affiche un QR code
 */
function _renderQR(url) {
    const container = $('h-qr');
    if (!container) return;

    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(url)}&bgcolor=0d0d1a&color=00d4ff&margin=2`;
    container.innerHTML = `<img src="${qrUrl}" alt="QR Code" class="qr-img" onerror="this.closest('.qr-container').innerHTML='<p>QR indisponible</p>'">`;
}

/**
 * Met à jour le badge de statut (lobby)
 */
function _setStatutBadge(statut) {
    const badge = $('h-statut-badge');
    if (!badge) return;

    const map = {
        lobby: { text: '● Lobby', cls: 'statut-lobby' },
        en_cours: { text: '● En cours', cls: 'statut-en-cours' },
        terminee: { text: '● Terminée', cls: 'statut-terminee' },
    };

    const info = map[statut] || map.lobby;
    badge.textContent = info.text;
    badge.className = `statut-badge ${info.cls}`;
}

/**
 * Met à jour le badge de statut (spectateur)
 */
function _setStatutBadgeSp(statut) {
    const badge = $('sp-statut-badge');
    if (!badge) return;

    const map = {
        lobby: { text: '● Lobby', cls: 'statut-lobby' },
        en_cours: { text: '● En cours', cls: 'statut-en-cours' },
        terminee: { text: '● Terminée', cls: 'statut-terminee' },
    };

    const info = map[statut] || map.lobby;
    badge.textContent = info.text;
    badge.className = `statut-badge ${info.cls}`;
}

// ══════════════════════════════════════════════════════
// 🔄 SNAPSHOT & STATE
// ══════════════════════════════════════════════════════

/**
 * Applique un snapshot du serveur à l'état local
 */
function applySnapshot(snap) {
    if (!snap) return;

    HostState.partieId = snap.id ?? HostState.partieId;
    HostState.partieNom = snap.nom ?? HostState.partieNom;
    HostState.jeu = snap.jeu ?? HostState.jeu;
    HostState.mode = snap.mode ?? HostState.mode;
    HostState.equipes = snap.equipes ?? HostState.equipes;
    HostState.scores = snap.scores ?? HostState.scores;
    HostState.statut = snap.statut ?? HostState.statut;
    HostState.joueurs = snap.joueurs ?? HostState.joueurs;
}

/**
 * Sauvegarde la session du host
 */
function sauvegarderSessionHost(snapshot) {
    try {
        const session = {
            partieId: HostState.partieId,
            partieNom: HostState.partieNom,
            pseudo: HostState.hostPseudo,
            jeu: HostState.jeu,
            mode: HostState.mode,
            role: 'host',
            timestamp: Date.now(),
        };
        sessionStorage.setItem('mgu_host_session', JSON.stringify(session));
    } catch (err) {
        console.warn('Impossible de sauvegarder la session host:', err);
    }
}

/**
 * Sauvegarde la partie en localStorage
 */
function sauvegarderPartieLocale(snapshot) {
    try {
        const parties = JSON.parse(localStorage.getItem('mgu_parties') || '[]');
        const entry = {
            partieId: snapshot.id,
            nom: snapshot.nom,
            jeu: snapshot.jeu,
            mode: snapshot.mode,
            equipes: snapshot.equipes || [],
            joueurs: snapshot.joueurs || [],
            scores: snapshot.scores || {},
            statut: snapshot.statut,
            createdAt: Date.now(),
        };
        const idx = parties.findIndex(p => p.partieId === snapshot.id);
        if (idx >= 0) {
            parties[idx] = { ...parties[idx], ...entry };
        } else {
            parties.push(entry);
        }
        localStorage.setItem('mgu_parties', JSON.stringify(parties));
    } catch (err) {
        console.warn('Impossible de sauvegarder la partie:', err);
    }
}

/**
 * Met à jour le statut de connexion
 */
function updateConnectionStatus(isConnected) {
    const dot = $('ws-dot');
    const label = $('ws-label');

    if (dot) {
        dot.className = isConnected ? 'ws-dot ws-ok' : 'ws-dot ws-ko';
    }

    if (label) {
        label.textContent = isConnected ? 'Connecté' : 'Déconnecté';
    }
}

// ══════════════════════════════════════════════════════
// 💬 TOAST NOTIFICATIONS
// ══════════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════════
// 🚀 INITIALISATION
// ══════════════════════════════════════════════════════

/**
 * Initialise le module host
 */
function init() {
    console.log('🟦 Initialisation de host.js');

    // Connexion WebSocket
    initSocketConnection();
    initSocketEvents();

    // Configuration UI
    initModeToggle();
    initHostRoleToggle();
    initEquipes();
    initCreerPartie();
    initControles();

    // Pré-remplissage depuis l'URL
    const params = new URLSearchParams(location.search);
    const jeuId = params.get('jeu');
    if (jeuId) {
        const select = $('h-jeu');
        if (select && select.querySelector(`option[value="${jeuId}"]`)) {
            select.value = jeuId;
        }
    }

    console.log('✅ host.js initialisé');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Export de l'état pour débogage
window.HostState = HostState;