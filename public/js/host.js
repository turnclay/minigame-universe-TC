// ======================================================
// 🟦 HOST.JS v4.0 — CODE DE PARTIE AJOUTÉ
// ======================================================
// Nouveautés v4.0 :
//  - socket.on('CODE_GENERATED') : reçoit et affiche le code court
//  - renderCode() : affiche code + QR + lien sur base du code
//  - renderGamePanel() : génère le lien avec le code (?code=XXXXXX)
//  - HostState.code : stocke le code en mémoire
// Conservé de v3.3 :
//  - HOST_REJOIN après refresh page
//  - PLAYER_JOINED live avec anti-doublons
//  - Écran spectateur, scores, résultats
//  - Reset complet pour nouvelle partie
// ======================================================

import { GameSocket } from './core/socket.js';

const socket = new GameSocket();

const GAME_ICONS = {
    quiz: '❓', justeprix: '💰', undercover: '🕵️', lml: '📖',
    mimer: '🎭', pendu: '🪢', petitbac: '📝', memoire: '🧠',
    morpion: '⭕', puissance4: '🔴',
};
const JEU_PATHS = {
    quiz: '/games/quiz/', justeprix: '/games/justeprix/',
    undercover: '/games/undercover/', lml: '/games/lml/',
    mimer: '/games/mimer/', pendu: '/games/pendu/',
    petitbac: '/games/petitbac/', memoire: '/games/memoire/',
    morpion: '/games/morpion/', puissance4: '/games/puissance4/',
};
const PSEUDO_REGEX = /^[a-zA-Z0-9_-]{2,20}$/;
const PARTIE_NAME_REGEX = /^[a-zA-Z0-9_\s-]{2,30}$/;

const $ = id => document.getElementById(id);
const show = id => { const e = $(id); if (e) e.hidden = false; };
const hide = id => { const e = $(id); if (e) e.hidden = true; };
const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const HostState = {
    partieId: null, partieNom: null, jeu: null, mode: 'solo',
    equipes: [], joueurs: [], scores: {}, statut: null,
    hostJoue: false, hostPseudo: null,
    partieEnCours: false, isConnecting: false,
    code: null,               // ✅ NEW v4.0 : code court de la partie
    joueursTraites: new Set(), // 🔥 ANTI-DOUBLONS
};

// ══════════════════════════════════════════════════════
// SOCKET
// ══════════════════════════════════════════════════════

function initSocket() {
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket.connect(`${wsProto}//${location.host}/ws`);

    socket.on('__connected__', () => {
        updateWsStatus(true);
        socket.send('HOST_AUTH', {});
    });

    socket.on('__disconnected__', () => {
        updateWsStatus(false);
        toast('Connexion perdue…', 'warning');
    });

    socket.on('AUTH_OK', () => {
        toast('Host connecté ✅', 'success', 2000);
        tryRejoin();
    });

socket.on('HOST_REJOINED', ({ partieId, snapshot }) => {
    console.log('[HOST] Rejoint la partie existante:', partieId);

    // --- Réhydratation complète du HostState ---
    HostState.partieId = partieId;
    HostState.partieEnCours = true;
    HostState.statut = snapshot.statut || 'lobby';
    HostState.partieNom = snapshot.nom;
    HostState.jeu = snapshot.jeu;
    HostState.mode = snapshot.mode;
    HostState.equipes = snapshot.equipes || [];
    HostState.joueurs = snapshot.joueurs || [];
    HostState.scores = snapshot.scores || {};
    HostState.joueursTraites.clear();

    // --- Appliquer le snapshot à l’UI ---
    applySnapshot(snapshot);

    // --- Sauvegarder la session host pour les refresh suivants ---
    sauvegarderSessionHost(snapshot);

    // --- Sauvegarder dans l’historique local (écran "Continuer") ---
    sauvegarderPartieLocale(snapshot);

    // --- Affichage selon l’état de la partie ---
    if (snapshot.statut === 'en_cours') {
        hide('form-creation');
        hide('panel-game');
        afficherEcranSpectateur(snapshot);
    } else {
        hide('form-creation');
        show('panel-game');
        renderGamePanel();
    }

    toast(`Partie "${HostState.partieNom}" récupérée`, 'info', 2500);
});

    socket.on('GAME_CREATED', ({ partieId, snapshot }) => {
        console.log('[HOST] GAME_CREATED:', partieId);
        HostState.partieId = partieId;
        HostState.partieEnCours = true;
        HostState.isConnecting = false;
        HostState.statut = 'lobby';
        HostState.joueursTraites.clear();
        applySnapshot(snapshot);
        sauvegarderPartieLocale(snapshot);

        const btn = $('h-btn-creer');
        if (btn) { btn.disabled = false; btn.textContent = '🎮 Créer la partie'; }

        hide('form-creation');
        show('panel-game');

        requestAnimationFrame(() => {
            renderGamePanel();
        });

        toast(`Partie "${HostState.partieNom}" créée ! Partagez le code.`, 'success', 4000);
        // Le code arrivera juste après via CODE_GENERATED
    });

    // ✅ NEW v4.0 : réception du code court
    socket.on('CODE_GENERATED', ({ code, partieId }) => {
        console.log('[HOST] 🔑 Code reçu:', code, 'pour partie:', partieId);

        // Vérifier que c'est bien notre partie
        if (partieId && partieId !== HostState.partieId) return;

        HostState.code = code;
        renderCode(code);
    });

    // ── JOUEUR REJOINT - AVEC ANTI-DOUBLONS CÔTÉ CLIENT ──
    socket.on('PLAYER_JOINED', ({ pseudo, equipe, joueurs }) => {
        console.log('[HOST] 🔹 PLAYER_JOINED reçu:', { pseudo, equipe, joueurs });

        // 🔥 VÉRIFIER LES DOUBLONS CÔTÉ CLIENT
        if (HostState.joueursTraites.has(pseudo)) {
            console.warn('[HOST] ⚠️ DOUBLON IGNORÉ (déjà traité):', pseudo);
            return;
        }

        HostState.joueursTraites.add(pseudo);
        console.log('[HOST] ✅ Joueur marqué comme traité:', pseudo);

        // Mise à jour STRICTE de l'état avec la liste complète du serveur
        HostState.joueurs = Array.isArray(joueurs) ? [...joueurs] : [];

        // Vérifier que le panel-game est visible
        const panelGame = $('panel-game');
        if (panelGame && panelGame.hidden) {
            show('panel-game');
        }

        requestAnimationFrame(() => {
            renderGamePanel();
            renderJoueursConnectes();
            renderScores();
        });

        toast(`🎉 ${pseudo} a rejoint ! (${joueurs.length})`, 'success', 2500);
    });

    socket.on('PLAYER_LEFT', ({ pseudo, joueurs }) => {
        console.log('[HOST] PLAYER_LEFT:', pseudo);
        HostState.joueursTraites.delete(pseudo);
        HostState.joueurs = Array.isArray(joueurs) ? [...joueurs] : [];

        requestAnimationFrame(() => {
            renderJoueursConnectes();
            renderScores();
        });

        toast(`${pseudo} a quitté`, 'warning', 2000);
    });

    socket.on('SCORES_UPDATE', ({ scores }) => {
        console.log('[HOST] SCORES_UPDATE:', scores);
        HostState.scores = scores;

        requestAnimationFrame(() => {
            renderScores();
            renderScoresSp();
        });
    });

    socket.on('GAME_STARTED', ({ snapshot }) => {
        console.log('[HOST] GAME_STARTED');
        applySnapshot(snapshot);
        HostState.statut = 'en_cours';
        sauvegarderSessionHost(snapshot);
        afficherEcranSpectateur(snapshot);
        toast('Partie lancée ! 🚀', 'success', 2500);
    });

    socket.on('GAME_ENDED', ({ snapshot }) => {
        console.log('[HOST] GAME_ENDED');
        applySnapshot(snapshot);
        HostState.statut = 'terminee';
        HostState.partieEnCours = false;
        HostState.joueursTraites.clear();
        HostState.code = null;
        _setStatutBadgeSp('terminee');
        hide('sp-btn-end');
        show('sp-btn-nouvelle');
        renderScoresSp();
        renderResultatsSp();
        try { sessionStorage.removeItem('mgu_host_session'); } catch {}
        toast('Partie terminée 🏁 Vous pouvez en créer une nouvelle.', 'info', 5000);
    });

    socket.on('ERROR', ({ code, message }) => {
        const msgs = {
            NOT_HOST: 'Non reconnu comme host.',
            HOST_ALREADY_HAS_GAME: 'Vous avez déjà une partie active.',
            NO_ACTIVE_GAME: 'Aucune partie active.',
            NAME_TAKEN: 'Ce nom de partie est déjà utilisé.',
            GAME_NOT_FOUND: 'Partie introuvable.',
        };
        toast(msgs[code] || message || `Erreur: ${code}`, 'error');
        const btn = $('h-btn-creer');
        if (btn) { btn.disabled = false; btn.textContent = '🎮 Créer la partie'; }
        HostState.isConnecting = false;
    });
}

// ══════════════════════════════════════════════════════
// REJOIN APRÈS REFRESH
// ══════════════════════════════════════════════════════

function tryRejoin() {
    const params = new URLSearchParams(location.search);
    const resumeId = params.get('resume');

    if (resumeId) {
        socket.send('HOST_REJOIN', { partieId: resumeId });
        return;
    }

    try {
        const session = JSON.parse(sessionStorage.getItem('mgu_host_session') || 'null');
        if (session?.partieId && session?.role === 'host') {
            console.log('[HOST] Tentative rejoin:', session.partieId);
            socket.send('HOST_REJOIN', { partieId: session.partieId });
        }
    } catch {}
}

// ══════════════════════════════════════════════════════
// CRÉATION DE PARTIE
// ══════════════════════════════════════════════════════

function initCreerPartie() {
    const btn = $('h-btn-creer');
    if (!btn) return;

    btn.addEventListener('click', () => {
        if (HostState.partieEnCours) {
            toast('Terminez votre partie en cours d\'abord.', 'warning');
            return;
        }

        const nom = $('h-nom-partie')?.value.trim();
        const jeu = $('h-jeu')?.value;
        const mode = HostState.mode;

        if (!nom || !PARTIE_NAME_REGEX.test(nom)) {
            toast('Nom de partie invalide (2-30 caractères, lettres/chiffres/espaces).', 'warning'); return;
        }
        if (!jeu) { toast('Sélectionnez un jeu.', 'warning'); return; }
        if (mode === 'team' && HostState.equipes.length < 2) {
            toast('Il faut au moins 2 équipes.', 'warning'); return;
        }

        let hostPseudo = null;
        if (HostState.hostJoue) {
            hostPseudo = $('h-host-pseudo')?.value.trim();
            if (!hostPseudo || !PSEUDO_REGEX.test(hostPseudo)) {
                toast('Pseudo host invalide.', 'warning'); return;
            }
            HostState.hostPseudo = hostPseudo;
        }

        HostState.jeu = jeu;
        HostState.partieNom = nom;
        HostState.isConnecting = true;
        btn.disabled = true;
        btn.textContent = '⏳ Création…';

        socket.send('HOST_CREATE_GAME', {
            nom, jeu, mode,
            equipes: HostState.equipes,
            hostJoue: HostState.hostJoue,
            hostPseudo,
        });

        setTimeout(() => {
            if (HostState.isConnecting) {
                HostState.isConnecting = false;
                btn.disabled = false;
                btn.textContent = '🎮 Créer la partie';
                toast('Délai dépassé. Vérifiez la connexion.', 'error');
            }
        }, 10000);
    });
}

// ══════════════════════════════════════════════════════
// MODE SOLO / ÉQUIPES
// ══════════════════════════════════════════════════════

function initModeToggle() {
    const btnSolo = $('btn-mode-solo');
    const btnTeam = $('btn-mode-equipes');
    const setMode = (mode) => {
        HostState.mode = mode;
        btnSolo?.classList.toggle('active', mode === 'solo');
        btnTeam?.classList.toggle('active', mode === 'team');
        const bs = $('bloc-solo'), bt = $('bloc-equipes');
        if (bs) bs.hidden = (mode === 'team');
        if (bt) bt.hidden = (mode === 'solo');
    };
    btnSolo?.addEventListener('click', () => setMode('solo'));
    btnTeam?.addEventListener('click', () => setMode('team'));
    setMode('solo');
}

function initHostRoleToggle() {
    const cb = $('h-host-joue');
    if (!cb) return;
    cb.addEventListener('change', e => {
        HostState.hostJoue = e.target.checked;
        const wrap = $('h-host-pseudo-wrap');
        if (wrap) wrap.hidden = !e.target.checked;
    });
}

// ══════════════════════════════════════════════════════
// ÉQUIPES
// ══════════════════════════════════════════════════════

function initEquipes() {
    const input = $('h-equipe-input');
    const btn   = $('h-equipe-ajouter');
    const add   = () => {
        const nom = input?.value.trim();
        if (!nom) return;
        if (HostState.equipes.some(e => e.nom.toLowerCase() === nom.toLowerCase())) {
            toast('Équipe déjà existante.', 'warning'); return;
        }
        HostState.equipes.push({ nom, membres: [] });
        if (input) input.value = '';
        renderEquipesForm();
    };
    btn?.addEventListener('click', add);
    input?.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
    renderEquipesForm();
}

function renderEquipesForm() {
    const c = $('h-equipes-list');
    if (!c) return;
    if (HostState.equipes.length === 0) {
        c.innerHTML = '<p style="opacity:.5;font-size:.9rem;padding:.5rem 0;">Créez au moins 2 équipes.</p>';
        return;
    }
    c.innerHTML = HostState.equipes.map((eq, i) => `
        <div style="display:flex;align-items:center;gap:.5rem;padding:.45rem .75rem;background:rgba(255,255,255,.05);border-radius:6px;margin-bottom:.4rem;">
            <span>🛡️</span>
            <span style="flex:1;">${esc(eq.nom)}</span>
            <button class="btn-del-eq" data-i="${i}" style="background:none;border:none;color:#f87171;cursor:pointer;font-size:1.1rem;line-height:1;">×</button>
        </div>`).join('');
    c.querySelectorAll('.btn-del-eq').forEach(b => {
        b.addEventListener('click', () => { HostState.equipes.splice(+b.dataset.i, 1); renderEquipesForm(); });
    });
}

// ══════════════════════════════════════════════════════
// CONTRÔLES
// ══════════════════════════════════════════════════════

function initControles() {
    $('h-btn-start')?.addEventListener('click', () => {
        if (!HostState.partieId) return;
        if (HostState.joueurs.length === 0) {
            toast('Attendez qu\'au moins un joueur rejoigne.', 'warning'); return;
        }
        socket.send('HOST_START_GAME', {});
    });

    $('h-btn-end')?.addEventListener('click', () => {
        if (confirm('Terminer la partie ?')) socket.send('HOST_END_GAME', {});
    });

    $('h-btn-nouvelle')?.addEventListener('click', resetPourNouvellePartie);

    // ✅ Copie le lien avec code
    $('h-btn-copy')?.addEventListener('click', () => {
        const link = $('h-join-link');
        if (!link?.href || link.href === '#') return;
        navigator.clipboard.writeText(link.href)
            .then(() => toast('Lien copié ! 📋', 'success', 1500))
            .catch(() => toast('Impossible de copier.', 'error'));
    });

    // ✅ NEW v4.0 : copie du code seul
    document.addEventListener('click', e => {
        if (e.target.id === 'h-btn-copy-code') {
            const codeEl = $('h-code-value');
            if (!codeEl) return;
            navigator.clipboard.writeText(codeEl.textContent.trim())
                .then(() => toast('Code copié ! 🔑', 'success', 1500))
                .catch(() => toast('Impossible de copier.', 'error'));
        }
    });

    $('btn-go-home')?.addEventListener('click', () => { window.location.href = '/'; });

    $('sp-btn-end')?.addEventListener('click', () => {
        if (confirm('Terminer la partie ?')) socket.send('HOST_END_GAME', {});
    });
    $('sp-btn-nouvelle')?.addEventListener('click', () => {
        hide('host-spectateur');
        show('host-lobby');
        resetPourNouvellePartie();
    });
    $('sp-btn-home')?.addEventListener('click', () => { window.location.href = '/'; });
}

function initButtonStates() {
    const checkInterval = setInterval(() => {
        const btn = $('h-btn-start');
        if (!btn) {
            clearInterval(checkInterval);
            return;
        }

        const canStart = HostState.partieId &&
                        HostState.joueurs.length > 0 &&
                        HostState.statut === 'lobby';

        btn.disabled = !canStart;
        btn.style.opacity = canStart ? '1' : '0.5';
        btn.style.cursor = canStart ? 'pointer' : 'not-allowed';
        btn.title = !canStart ?
            (HostState.joueurs.length === 0 ? '⏳ En attente d\'un joueur...' : '⏳ Traitement...')
            : '✅ Cliquez pour lancer !';
    }, 300);
}

function resetPourNouvellePartie() {
    Object.assign(HostState, {
        partieId: null, partieNom: null, jeu: null,
        equipes: [], joueurs: [], scores: {}, statut: null,
        partieEnCours: false, hostJoue: false, hostPseudo: null,
        isConnecting: false, code: null,
    });
    HostState.joueursTraites.clear();

    const url = new URL(location.href);
    url.searchParams.delete('resume');
    window.history.replaceState({}, '', url.toString());

    const nomInput = $('h-nom-partie');
    if (nomInput) nomInput.value = '';
    const cb = $('h-host-joue');
    if (cb) cb.checked = false;
    const pseudoInput = $('h-host-pseudo');
    if (pseudoInput) pseudoInput.value = '';
    const pseudoWrap = $('h-host-pseudo-wrap');
    if (pseudoWrap) pseudoWrap.hidden = true;

    $('sp-btn-join-game')?.remove();

    // ✅ Nettoyer l'affichage du code
    const codeEl = $('h-code-court');
    if (codeEl) codeEl.remove();

    renderEquipesForm();

    hide('host-spectateur');
    hide('panel-game');
    show('host-lobby');
    show('form-creation');
    hide('h-btn-nouvelle');
    show('h-btn-start');

    toast('Prêt pour une nouvelle partie !', 'info', 2500);
}

// ══════════════════════════════════════════════════════
// ✅ NEW v4.0 — AFFICHAGE DU CODE COURT
// ══════════════════════════════════════════════════════

/**
 * Affiche le code court, le QR et le lien partageable dans le panel-game.
 * Met également à jour l'écran spectateur.
 * @param {string} code - Le code 6 caractères
 */
function renderCode(code) {
    if (!code || !HostState.partieId) return;

    // Construire l'URL avec le code (les joueurs arrivent directement sur /join/?code=XXXXXX)
    const joinUrl = `${location.origin}/join/?code=${code}`;

    // ── Mettre à jour le lien dans join-block ───────────────
    const linkEl = $('h-join-link');
    if (linkEl) {
        linkEl.href = joinUrl;
        linkEl.textContent = joinUrl;
    }

    // ── Bloc code court — créé dynamiquement s'il n'existe pas ──
    let codeEl = $('h-code-court');
    if (!codeEl) {
        codeEl = document.createElement('div');
        codeEl.id = 'h-code-court';
        codeEl.className = 'join-code-block';
        // Insérer dans join-block, avant le QR container
        const joinBlock = document.querySelector('.join-block');
        const qrEl = $('h-qr');
        if (joinBlock && qrEl) {
            joinBlock.insertBefore(codeEl, qrEl);
        } else if (joinBlock) {
            joinBlock.appendChild(codeEl);
        }
    }

    codeEl.innerHTML = `
        <p class="join-code-label">📱 Code de la partie</p>
        <div class="join-code-value-row">
            <span class="join-code-value" id="h-code-value">${esc(code)}</span>
            <button class="btn-copy-code" id="h-btn-copy-code" title="Copier le code">📋</button>
        </div>
        <p class="join-code-hint">Les joueurs tapent ce code sur la page <strong>Rejoindre</strong></p>`;

    // ── QR code lobby ────────────────────────────────────────
    _renderQR(joinUrl, 'h-qr');

    // ── Écran spectateur : code + QR ────────────────────────
    const spQr = $('sp-qr');
    if (spQr) {
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(joinUrl)}&bgcolor=0d0d1a&color=00d4ff&margin=2`;
        spQr.innerHTML = `
            <div class="sp-code-mini">
                <span class="join-code-label">Code :</span>
                <strong class="join-code-value">${esc(code)}</strong>
            </div>
            <img src="${qrUrl}" alt="QR Code" width="150" height="150"
                 style="border-radius:8px;display:block;margin-top:.5rem;"
                 onerror="this.style.display='none'">`;
    }

    // ── Lien spectateur ──────────────────────────────────────
    const spLink = $('sp-join-link');
    if (spLink) { spLink.href = joinUrl; spLink.textContent = joinUrl; }
}

// ══════════════════════════════════════════════════════
// PANEL LOBBY
// ══════════════════════════════════════════════════════

function renderGamePanel() {
    console.log('[RENDER] renderGamePanel - Joueurs:', HostState.joueurs.length);

    // ✅ v4.0 : URL de base — sera enrichie par renderCode() si code disponible
    const joinUrl = HostState.code
        ? `${location.origin}/join/?code=${HostState.code}`
        : `${location.origin}/join/?partieId=${HostState.partieId}`;

    const nomEl = $('h-info-nom');
    if (nomEl) nomEl.textContent = HostState.partieNom || '—';

    const jeuEl = $('h-info-jeu');
    if (jeuEl) jeuEl.textContent = (HostState.jeu || '—').toUpperCase();

    const modeEl = $('h-info-mode');
    if (modeEl) modeEl.textContent = HostState.mode === 'team' ? '🛡️ Équipes' : '👤 Solo';

    _setStatutBadge('lobby');

    const linkEl = $('h-join-link');
    if (linkEl) {
        linkEl.href = joinUrl;
        linkEl.textContent = joinUrl;
    }

    // Rendu du QR avec le bon lien
    _renderQR(joinUrl, 'h-qr');

    // ✅ v4.0 : si le code est déjà connu, l'afficher immédiatement
    if (HostState.code) {
        renderCode(HostState.code);
    }

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

function renderJoueursConnectes() {
    const container = $('h-joueurs-connectes');
    const counter   = $('h-nb-joueurs');

    if (counter) counter.textContent = HostState.joueurs.length;
    if (!container) return;

    if (HostState.joueurs.length === 0) {
        container.innerHTML = `<div style="text-align:center;padding:1.5rem;opacity:.5;">
            <div style="font-size:1.5rem;margin-bottom:.3rem;">👀</div>
            <p>En attente de joueurs…</p>
            <p style="font-size:.8rem;margin-top:.25rem;">Partagez le code ou le QR</p>
        </div>`;
        return;
    }

    container.innerHTML = HostState.joueurs.map(j => {
        const initiale = (j.pseudo || '?').charAt(0).toUpperCase();
        return `
        <div style="display:flex;align-items:center;gap:.6rem;padding:.5rem .75rem;background:rgba(255,255,255,.04);border-radius:8px;margin-bottom:.4rem;animation:fadein .3s;">
            <span style="width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#00d4ff22,#7c3aed22);display:flex;align-items:center;justify-content:center;font-weight:700;color:#00d4ff;">${initiale}</span>
            <span style="flex:1;font-weight:500;">${esc(j.pseudo)}</span>
            ${j.equipe ? `<span style="font-size:.75rem;opacity:.6;background:rgba(255,255,255,.06);padding:.2rem .5rem;border-radius:4px;">🛡️ ${esc(j.equipe)}</span>` : ''}
            <button class="btn-kick" data-pseudo="${esc(j.pseudo)}" style="background:none;border:1px solid #f8717140;color:#f87171;padding:.2rem .5rem;border-radius:5px;cursor:pointer;font-size:.8rem;" title="Expulser">✖</button>
        </div>`;
    }).join('');

    container.querySelectorAll('.btn-kick').forEach(btn => {
        btn.addEventListener('click', () => {
            if (confirm(`Expulser ${btn.dataset.pseudo} ?`)) {
                socket.send('HOST_KICK_PLAYER', { pseudo: btn.dataset.pseudo });
            }
        });
    });
}

function renderScores() {
    _renderScoresIn('h-scores-liste', HostState.scores);
}
function renderScoresSp() {
    _renderScoresIn('sp-scores', HostState.scores);
}

function _renderScoresIn(id, scores) {
    const c = $(id);
    if (!c) return;
    const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) {
        c.innerHTML = '<p style="opacity:.5;font-size:.9rem;">Aucun score encore.</p>';
        return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    const max = entries[0]?.[1] || 1;
    c.innerHTML = entries.map(([nom, pts], i) => {
        const pct = max > 0 ? Math.round((pts / max) * 100) : 0;
        return `<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem;">
            <span style="width:1.5rem;">${medals[i] || `${i + 1}.`}</span>
            <span style="flex:1;font-weight:500;">${esc(nom)}</span>
            <div style="width:70px;height:5px;background:#ffffff15;border-radius:3px;overflow:hidden;">
                <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,#00d4ff,#7c3aed);border-radius:3px;"></div>
            </div>
            <span style="font-size:.85rem;min-width:44px;text-align:right;opacity:.9;">${pts}pts</span>
            <button class="bpt" data-c="${esc(nom)}" data-d="1" style="background:#00d4ff15;border:none;color:#00d4ff;padding:.15rem .4rem;border-radius:4px;cursor:pointer;font-size:.9rem;">＋</button>
            <button class="bpt" data-c="${esc(nom)}" data-d="-1" style="background:#f8717115;border:none;color:#f87171;padding:.15rem .4rem;border-radius:4px;cursor:pointer;font-size:.9rem;">－</button>
        </div>`;
    }).join('');
    c.querySelectorAll('.bpt').forEach(btn => {
        btn.addEventListener('click', () => {
            const d = parseInt(btn.dataset.d);
            socket.send(d > 0 ? 'HOST_ADD_POINTS' : 'HOST_REMOVE_POINTS', { cible: btn.dataset.c, points: 1 });
        });
    });
}

// ══════════════════════════════════════════════════════
// ÉCRAN SPECTATEUR
// ══════════════════════════════════════════════════════

function afficherEcranSpectateur(snapshot) {
    hide('host-lobby');
    show('host-spectateur');

    // ✅ v4.0 : utiliser le lien avec code si disponible
    const joinUrl = HostState.code
        ? `${location.origin}/join/?code=${HostState.code}`
        : `${location.origin}/join/?partieId=${HostState.partieId}`;

    if ($('sp-nom'))  $('sp-nom').textContent  = HostState.partieNom || '—';
    if ($('sp-jeu'))  $('sp-jeu').textContent  = (HostState.jeu || '—').toUpperCase();
    if ($('sp-mode')) $('sp-mode').textContent = HostState.mode === 'team' ? '🛡️ Équipes' : '👤 Solo';
    _setStatutBadgeSp('en_cours');

    const spLink = $('sp-join-link');
    if (spLink) { spLink.href = joinUrl; spLink.textContent = joinUrl; }

    // Afficher code + QR dans spectateur
    if (HostState.code) {
        renderCode(HostState.code);
    } else {
        _renderQR(joinUrl, 'sp-qr');
    }

    if (HostState.hostJoue && HostState.hostPseudo) {
        const spActions = document.querySelector('.sp-actions');
        if (spActions && !$('sp-btn-join-game')) {
            const gameUrl = JEU_PATHS[HostState.jeu] || `/games/${HostState.jeu}/`;
            const fullUrl = `${gameUrl}?partieId=${HostState.partieId}&pseudo=${encodeURIComponent(HostState.hostPseudo)}&role=host-player`;

            const btn = document.createElement('a');
            btn.id = 'sp-btn-join-game';
            btn.href = fullUrl;
            btn.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:.5rem;padding:.85rem 1.5rem;background:linear-gradient(135deg,#00d4ff,#7c3aed);color:#000;font-weight:700;border-radius:10px;text-decoration:none;margin-bottom:1rem;font-size:1rem;';
            btn.innerHTML = `🎮 Rejoindre comme joueur (${esc(HostState.hostPseudo)})`;
            spActions.insertBefore(btn, spActions.firstChild);
        }
    }

    renderScoresSp();
    renderJoueursSp();
}

function renderJoueursSp() {
    const c = $('sp-joueurs');
    if (!c) return;
    if (HostState.joueurs.length === 0) {
        c.innerHTML = '<p style="opacity:.5;">En attente de joueurs…</p>';
        return;
    }
    c.innerHTML = HostState.joueurs.map(j => `
        <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.4rem;padding:.4rem .6rem;background:rgba(255,255,255,.04);border-radius:6px;">
            <span style="width:24px;height:24px;border-radius:50%;background:#00d4ff22;display:flex;align-items:center;justify-content:center;font-weight:700;color:#00d4ff;font-size:.8rem;">${j.pseudo.charAt(0).toUpperCase()}</span>
            <span style="flex:1;">${esc(j.pseudo)}</span>
            ${j.equipe ? `<span style="font-size:.75rem;opacity:.5;">· ${esc(j.equipe)}</span>` : ''}
            <button class="btn-kick-sp" data-pseudo="${esc(j.pseudo)}" style="background:none;border:none;color:#f8717180;cursor:pointer;font-size:.85rem;" title="Expulser">✖</button>
        </div>`).join('');
    c.querySelectorAll('.btn-kick-sp').forEach(btn => {
        btn.addEventListener('click', () => {
            if (confirm(`Expulser ${btn.dataset.pseudo} ?`)) {
                socket.send('HOST_KICK_PLAYER', { pseudo: btn.dataset.pseudo });
            }
        });
    });
}

function renderResultatsSp() {
    const entries = Object.entries(HostState.scores).sort((a, b) => b[1] - a[1]);
    const medals  = ['🥇', '🥈', '🥉'];
    const existing = $('resultats-finaux');
    if (existing) existing.remove();

    const spScores = $('sp-scores');
    if (!spScores) return;

    const div = document.createElement('div');
    div.id = 'resultats-finaux';
    div.style.cssText = 'margin-top:1.5rem;padding:1.25rem;background:rgba(255,255,255,.05);border-radius:12px;border:1px solid rgba(255,255,255,.08);';
    div.innerHTML = `
        <h3 style="margin:0 0 .75rem;font-size:1rem;">🏁 Résultats finaux</h3>
        ${entries.map(([nom, pts], i) => `
            <div style="display:flex;align-items:center;gap:.5rem;padding:.4rem 0;${i===0?'font-weight:700;':''}">
                <span style="font-size:1.1rem;">${medals[i] || `${i+1}.`}</span>
                <span style="flex:1;">${esc(nom)}</span>
                <span style="color:${i===0?'#ffd700':'inherit'};">${pts} pts</span>
            </div>`).join('')}`;
    spScores.after(div);
}

// ══════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════

function _renderQR(url, id) {
    const c = $(id);
    if (!c) return;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(url)}&bgcolor=0d0d1a&color=00d4ff&margin=2`;
    c.innerHTML = `<img src="${qrUrl}" alt="QR Code" style="border-radius:8px;display:block;" onerror="this.parentElement.innerHTML='<p style=opacity:.4;font-size:.8rem>QR indisponible</p>'">`;
}

function _setStatutBadge(s) {
    const b = $('h-statut-badge');
    if (!b) return;
    const m = { lobby: '● Lobby', en_cours: '● En cours', terminee: '● Terminée' };
    b.textContent = m[s] || s;
    b.className = `statut-badge statut-${s}`;
}
function _setStatutBadgeSp(s) {
    const b = $('sp-statut-badge');
    if (!b) return;
    const m = { lobby: '● Lobby', en_cours: '● En cours', terminee: '● Terminée' };
    b.textContent = m[s] || s;
    b.className = `statut-badge statut-${s}`;
}

function updateWsStatus(connected) {
    const dot   = $('ws-dot');
    const label = $('ws-label');
    if (dot)   dot.style.background = connected ? '#22c55e' : '#ef4444';
    if (label) label.textContent = connected ? 'Connecté' : 'Déconnecté';
}

function applySnapshot(snap) {
    if (!snap) return;
    if (snap.id      !== undefined) HostState.partieId  = snap.id;
    if (snap.nom     !== undefined) HostState.partieNom = snap.nom;
    if (snap.jeu     !== undefined) HostState.jeu       = snap.jeu;
    if (snap.mode    !== undefined) HostState.mode      = snap.mode;
    if (snap.equipes !== undefined) HostState.equipes   = snap.equipes;
    if (snap.scores  !== undefined) HostState.scores    = snap.scores;
    if (snap.statut  !== undefined) HostState.statut    = snap.statut;
    if (snap.joueurs !== undefined) HostState.joueurs   = snap.joueurs;
}

function sauvegarderSessionHost(snapshot) {
    try {
        sessionStorage.setItem('mgu_host_session', JSON.stringify({
            partieId: HostState.partieId, partieNom: HostState.partieNom,
            pseudo: HostState.hostPseudo, jeu: HostState.jeu,
            mode: HostState.mode, role: 'host', timestamp: Date.now(),
        }));
    } catch {}
}

function sauvegarderPartieLocale(snapshot) {
    try {
        const parties = JSON.parse(localStorage.getItem('mgu_parties') || '[]');
        const entry = {
            partieId: snapshot.id, nom: snapshot.nom, jeu: snapshot.jeu,
            mode: snapshot.mode, equipes: snapshot.equipes || [],
            joueurs: snapshot.joueurs || [], scores: snapshot.scores || {},
            statut: snapshot.statut, createdAt: Date.now(),
        };
        const idx = parties.findIndex(p => p.partieId === snapshot.id);
        if (idx >= 0) parties[idx] = { ...parties[idx], ...entry };
        else parties.push(entry);
        localStorage.setItem('mgu_parties', JSON.stringify(parties));
    } catch {}
}

// ══════════════════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════════════════

function toast(msg, type = 'info', duration = 3000) {
    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    let c = $('toast-container');
    if (!c) {
        c = document.createElement('div');
        c.id = 'toast-container';
        c.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:9999;display:flex;flex-direction:column;gap:.5rem;max-width:320px;';
        document.body.appendChild(c);
    }
    const el = document.createElement('div');
    el.style.cssText = `display:flex;gap:.5rem;align-items:flex-start;padding:.75rem 1rem;border-radius:9px;background:#1e1e2e;color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.5);opacity:0;transition:opacity .2s,transform .2s;transform:translateX(16px);border-left:3px solid ${type==='success'?'#22c55e':type==='error'?'#f87171':type==='warning'?'#f59e0b':'#00d4ff'};`;
    el.innerHTML = `<span style="flex-shrink:0;">${icons[type] || 'ℹ️'}</span><span style="font-size:.9rem;">${esc(msg)}</span>`;
    c.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateX(0)'; });
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(8px)';
        setTimeout(() => el.remove(), 250);
    }, duration);
}

// ══════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════

function init() {
    initSocket();
    initModeToggle();
    initHostRoleToggle();
    initEquipes();
    initCreerPartie();
    initControles();
    initButtonStates();

    const params = new URLSearchParams(location.search);
    const jeuId  = params.get('jeu');
    if (jeuId) {
        const sel = $('h-jeu');
        if (sel?.querySelector(`option[value="${jeuId}"]`)) sel.value = jeuId;
    }

    if (!document.getElementById('host-animations')) {
        const style = document.createElement('style');
        style.id = 'host-animations';
        style.textContent = `@keyframes fadein { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:none; } }`;
        document.head.appendChild(style);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

window.HostState = HostState;