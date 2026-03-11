// ======================================================
// 🟦 HOST.JS — Interface hôte v2 (corrigé)
// ======================================================
// Fix :
//  - socket.connect() appelé à l'init
//  - Lien de join généré dès GAME_CREATED
//  - Redirection vers game.js correct selon le jeu
//  - Écran spectateur après GAME_STARTED avec lien de jeu pour host
// ======================================================

import { GameSocket } from './core/socket.js';

const socket = new GameSocket();

// ── Constants ─────────────────────────────────────────
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

// ── DOM ───────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const show = (id) => { const el = $(id); if (el) el.hidden = false; };
const hide = (id) => { const el = $(id); if (el) el.hidden = true; };
const esc = (str) => String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── State ─────────────────────────────────────────────
const HostState = {
    partieId: null, partieNom: null, jeu: null, mode: 'solo',
    equipes: [], joueurs: [], scores: {}, statut: null,
    hostJoue: false, hostPseudo: null,
    partieEnCours: false, isConnecting: false,
};

// ══════════════════════════════════════════════════════
// WEBSOCKET
// ══════════════════════════════════════════════════════

function initSocket() {
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket.connect(`${wsProto}//${location.host}/ws`);

    socket.on('__connected__', () => {
        console.log('[HOST] ✅ WebSocket connecté');
        updateWsStatus(true);
        socket.send('HOST_AUTH', {});
    });

    socket.on('__disconnected__', () => {
        updateWsStatus(false);
        toast('Connexion perdue…', 'warning');
    });

    socket.on('AUTH_OK', () => {
        toast('Host connecté ✅', 'success', 2000);
        // Reprendre une partie si ?resume= dans l'URL
        checkResume();
    });

    socket.on('GAME_CREATED', ({ partieId, snapshot }) => {
        console.log('[HOST] ✅ Partie créée:', partieId);
        HostState.partieId = partieId;
        HostState.partieEnCours = true;
        HostState.isConnecting = false;
        applySnapshot(snapshot);
        sauvegarderPartieLocale(snapshot);

        const btn = $('h-btn-creer');
        if (btn) { btn.disabled = false; btn.textContent = '🎮 Créer la partie'; }

        show('panel-game');
        hide('form-creation');
        renderGamePanel();
        toast(`Partie "${HostState.partieNom}" créée ! Partagez le lien.`, 'success', 4000);
    });

    socket.on('PLAYER_JOINED', ({ pseudo, equipe, joueurs }) => {
        HostState.joueurs = joueurs;
        renderJoueursConnectes();
        renderScores();
        toast(`${pseudo} a rejoint 🎉`, 'info', 2000);
    });

    socket.on('PLAYER_LEFT', ({ pseudo, joueurs }) => {
        HostState.joueurs = joueurs;
        renderJoueursConnectes();
        renderScores();
        toast(`${pseudo} a quitté`, 'warning', 2000);
    });

    socket.on('SCORES_UPDATE', ({ scores }) => {
        HostState.scores = scores;
        renderScores();
    });

    socket.on('GAME_STARTED', ({ snapshot }) => {
        applySnapshot(snapshot);
        HostState.statut = 'en_cours';
        sauvegarderSessionHost(snapshot);
        afficherEcranSpectateur(snapshot);
        toast('Partie lancée ! 🚀', 'success', 2500);
    });

    socket.on('GAME_ENDED', ({ snapshot }) => {
        applySnapshot(snapshot);
        HostState.statut = 'terminee';
        HostState.partieEnCours = false;
        _setStatutBadgeSp('terminee');
        hide('sp-btn-end');
        show('sp-btn-nouvelle');
        renderScoresSp();
        renderResultatsSp();
        toast('Partie terminée 🏁', 'info');
    });

    socket.on('ERROR', ({ code, message }) => {
        const msgs = {
            NOT_HOST: 'Vous n\'êtes pas reconnu comme host.',
            HOST_ALREADY_HAS_GAME: 'Une partie est déjà active.',
            NO_ACTIVE_GAME: 'Aucune partie active.',
        };
        toast(msgs[code] || message || `Erreur: ${code}`, 'error');
        const btn = $('h-btn-creer');
        if (btn) { btn.disabled = false; btn.textContent = '🎮 Créer la partie'; }
        HostState.isConnecting = false;
    });
}

// ══════════════════════════════════════════════════════
// REPRISE DE PARTIE (URL ?resume=)
// ══════════════════════════════════════════════════════

function checkResume() {
    const params = new URLSearchParams(location.search);
    const resumeId = params.get('resume');
    if (!resumeId) return;

    try {
        const parties = JSON.parse(localStorage.getItem('mgu_parties') || '[]');
        const saved = parties.find(p => p.partieId === resumeId);
        if (saved) {
            toast(`Reprise de "${saved.nom}"…`, 'info');
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
            toast('Nom de partie invalide (2-30 caractères).', 'warning');
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
            if (!hostPseudo || !PSEUDO_REGEX.test(hostPseudo)) {
                toast('Pseudo host invalide.', 'warning');
                return;
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
        const blocSolo = $('bloc-solo');
        const blocTeam = $('bloc-equipes');
        if (blocSolo) blocSolo.hidden = (mode === 'team');
        if (blocTeam) blocTeam.hidden = (mode === 'solo');
    };

    btnSolo?.addEventListener('click', () => setMode('solo'));
    btnTeam?.addEventListener('click', () => setMode('team'));
    setMode('solo');
}

// ══════════════════════════════════════════════════════
// HOST JOUE TOGGLE
// ══════════════════════════════════════════════════════

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
    const btn = $('h-equipe-ajouter');

    const ajouter = () => {
        const nom = input?.value.trim();
        if (!nom) return;
        if (HostState.equipes.some(e => e.nom.toLowerCase() === nom.toLowerCase())) {
            toast('Équipe déjà existante.', 'warning'); return;
        }
        HostState.equipes.push({ nom, membres: [] });
        if (input) input.value = '';
        renderEquipesForm();
    };

    btn?.addEventListener('click', ajouter);
    input?.addEventListener('keydown', e => { if (e.key === 'Enter') ajouter(); });
    renderEquipesForm();
}

function renderEquipesForm() {
    const container = $('h-equipes-list');
    if (!container) return;
    if (HostState.equipes.length === 0) {
        container.innerHTML = '<p class="list-empty" style="opacity:.5;font-size:.9rem;">Créez au moins 2 équipes.</p>';
        return;
    }
    container.innerHTML = HostState.equipes.map((eq, i) => `
        <div style="display:flex;align-items:center;gap:.5rem;padding:.5rem .75rem;background:rgba(255,255,255,.05);border-radius:6px;margin-bottom:.4rem;">
            <span>🛡️</span>
            <span style="flex:1;">${esc(eq.nom)}</span>
            <button class="btn-del-equipe" data-i="${i}" style="background:none;border:none;color:#f87171;cursor:pointer;font-size:1.1rem;">×</button>
        </div>`).join('');

    container.querySelectorAll('.btn-del-equipe').forEach(btn => {
        btn.addEventListener('click', () => {
            HostState.equipes.splice(parseInt(btn.dataset.i), 1);
            renderEquipesForm();
        });
    });
}

// ══════════════════════════════════════════════════════
// CONTRÔLES DU JEU
// ══════════════════════════════════════════════════════

function initControles() {
    $('h-btn-start')?.addEventListener('click', () => {
        if (!HostState.partieId) return;
        if (HostState.joueurs.length === 0) {
            toast('Attendez qu\'au moins un joueur rejoigne.', 'warning');
            return;
        }
        socket.send('HOST_START_GAME', {});
    });

    $('h-btn-end')?.addEventListener('click', () => {
        if (confirm('Terminer la partie ?')) socket.send('HOST_END_GAME', {});
    });

    $('h-btn-nouvelle')?.addEventListener('click', resetPourNouvellePartie);

    $('h-btn-copy')?.addEventListener('click', () => {
        const link = $('h-join-link');
        if (!link?.href || link.href === '#') return;
        navigator.clipboard.writeText(link.href)
            .then(() => toast('Lien copié ! 📋', 'success', 1500))
            .catch(() => toast('Impossible de copier.', 'error'));
    });

    $('btn-go-home')?.addEventListener('click', () => { window.location.href = '/'; });

    // Spectateur
    $('sp-btn-end')?.addEventListener('click', () => {
        if (confirm('Terminer la partie ?')) socket.send('HOST_END_GAME', {});
    });
    $('sp-btn-nouvelle')?.addEventListener('click', () => {
        hide('host-spectateur');
        show('host-lobby');
        resetPourNouvellePartie();
    });
    $('sp-btn-home')?.addEventListener('click', () => { window.location.href = '/'; });

    $('sp-btn-copy')?.addEventListener('click', () => {
        const url = `${location.origin}/join/?partieId=${HostState.partieId}`;
        navigator.clipboard.writeText(url)
            .then(() => toast('Lien copié !', 'success', 1500))
            .catch(() => {});
    });
}

function resetPourNouvellePartie() {
    Object.assign(HostState, {
        partieId: null, partieNom: null, jeu: null,
        equipes: [], joueurs: [], scores: {}, statut: null,
        partieEnCours: false, hostJoue: false, hostPseudo: null,
    });
    hide('panel-game');
    hide('h-btn-nouvelle');
    show('form-creation');
    show('h-btn-start');
    const nom = $('h-nom-partie');
    if (nom) nom.value = '';
    const cb = $('h-host-joue');
    if (cb) cb.checked = false;
    const wrap = $('h-host-pseudo-wrap');
    if (wrap) wrap.hidden = true;
    renderEquipesForm();
    toast('Prêt pour une nouvelle partie !', 'info');
}

// ══════════════════════════════════════════════════════
// PANEL LOBBY (après création)
// ══════════════════════════════════════════════════════

function renderGamePanel() {
    // ✅ FIX PRINCIPAL : Génère le lien de join
    const joinUrl = `${location.origin}/join/?partieId=${HostState.partieId}`;

    if ($('h-info-nom')) $('h-info-nom').textContent = HostState.partieNom || '—';
    if ($('h-info-jeu')) $('h-info-jeu').textContent = (HostState.jeu || '—').toUpperCase();
    if ($('h-info-mode')) $('h-info-mode').textContent = HostState.mode === 'team' ? '🛡️ Équipes' : '👤 Solo';

    _setStatutBadge('lobby');

    // Lien et QR
    const linkEl = $('h-join-link');
    if (linkEl) {
        linkEl.href = joinUrl;
        linkEl.textContent = joinUrl;
    }
    _renderQR(joinUrl, 'h-qr');

    // Affichage bloc joueurs/équipes
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
    const counter = $('h-nb-joueurs');
    if (counter) counter.textContent = HostState.joueurs.length;

    if (!container) return;

    if (HostState.joueurs.length === 0) {
        container.innerHTML = '<p style="opacity:.5;text-align:center;padding:1rem;">En attente de joueurs…</p>';
        return;
    }

    container.innerHTML = HostState.joueurs.map(j => `
        <div style="display:flex;align-items:center;gap:.5rem;padding:.5rem .75rem;background:rgba(255,255,255,.05);border-radius:6px;margin-bottom:.4rem;">
            <span style="width:28px;height:28px;border-radius:50%;background:#00d4ff22;display:flex;align-items:center;justify-content:center;font-weight:700;color:#00d4ff;">${(j.pseudo || '?').charAt(0).toUpperCase()}</span>
            <span style="flex:1;">${esc(j.pseudo)}</span>
            ${j.equipe ? `<span style="font-size:.75rem;opacity:.6;">🛡️ ${esc(j.equipe)}</span>` : ''}
            <button class="btn-kick" data-pseudo="${esc(j.pseudo)}" style="background:none;border:none;color:#f87171;cursor:pointer;" title="Expulser">✖</button>
        </div>`).join('');

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

function _renderScoresIn(containerId, scores) {
    const container = $(containerId);
    if (!container) return;
    const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) {
        container.innerHTML = '<p style="opacity:.5;font-size:.9rem;">Aucun score encore.</p>';
        return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    const max = entries[0]?.[1] || 1;
    container.innerHTML = entries.map(([nom, pts], i) => {
        const pct = max > 0 ? Math.round((pts / max) * 100) : 0;
        return `<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem;">
            <span style="width:1.5rem;">${medals[i] || `${i + 1}.`}</span>
            <span style="flex:1;font-weight:500;">${esc(nom)}</span>
            <div style="width:80px;height:6px;background:#ffffff20;border-radius:3px;overflow:hidden;">
                <div style="width:${pct}%;height:100%;background:#00d4ff;border-radius:3px;"></div>
            </div>
            <span style="font-size:.9rem;min-width:40px;text-align:right;">${pts} pts</span>
            <div>
                <button class="btn-pts" data-cible="${esc(nom)}" data-delta="1" style="background:#00d4ff22;border:none;color:#00d4ff;padding:.2rem .4rem;border-radius:4px;cursor:pointer;">＋</button>
                <button class="btn-pts" data-cible="${esc(nom)}" data-delta="-1" style="background:#f8717120;border:none;color:#f87171;padding:.2rem .4rem;border-radius:4px;cursor:pointer;">－</button>
            </div>
        </div>`;
    }).join('');

    container.querySelectorAll('.btn-pts').forEach(btn => {
        btn.addEventListener('click', () => {
            const delta = parseInt(btn.dataset.delta);
            const type = delta > 0 ? 'HOST_ADD_POINTS' : 'HOST_REMOVE_POINTS';
            socket.send(type, { cible: btn.dataset.cible, points: 1 });
        });
    });
}

// ══════════════════════════════════════════════════════
// ÉCRAN SPECTATEUR (après démarrage)
// ══════════════════════════════════════════════════════

function afficherEcranSpectateur(snapshot) {
    hide('host-lobby');
    show('host-spectateur');

    const joinUrl = `${location.origin}/join/?partieId=${HostState.partieId}`;
    _renderQR(joinUrl, 'sp-qr');

    if ($('sp-nom')) $('sp-nom').textContent = HostState.partieNom || '—';
    if ($('sp-jeu')) $('sp-jeu').textContent = (HostState.jeu || '—').toUpperCase();
    if ($('sp-mode')) $('sp-mode').textContent = HostState.mode === 'team' ? '🛡️ Équipes' : '👤 Solo';
    _setStatutBadgeSp('en_cours');

    // Lien copie spectateur
    const spLink = $('sp-join-link');
    if (spLink) { spLink.href = joinUrl; spLink.textContent = joinUrl; }

    // ✅ Si le host joue → bouton pour rejoindre le jeu
    if (HostState.hostJoue && HostState.hostPseudo) {
        const spActions = document.querySelector('.sp-actions');
        if (spActions && !$('sp-btn-join-game')) {
            const gameUrl = JEU_PATHS[HostState.jeu] || '/games/';
            const btn = document.createElement('a');
            btn.id = 'sp-btn-join-game';
            btn.href = `${gameUrl}?partieId=${HostState.partieId}&pseudo=${encodeURIComponent(HostState.hostPseudo)}`;
            btn.className = 'btn btn-primary';
            btn.style.cssText = 'display:block;margin-bottom:1rem;text-align:center;';
            btn.innerHTML = `🎮 Rejoindre comme ${esc(HostState.hostPseudo)}`;
            spActions.insertBefore(btn, spActions.firstChild);
        }
    }

    renderScoresSp();
    renderJoueursSp();
}

function renderJoueursSp() {
    const container = $('sp-joueurs');
    if (!container) return;
    if (HostState.joueurs.length === 0) {
        container.innerHTML = '<p style="opacity:.5;">En attente de joueurs…</p>';
        return;
    }
    container.innerHTML = HostState.joueurs.map(j => `
        <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.4rem;">
            <span style="width:26px;height:26px;border-radius:50%;background:#00d4ff22;display:flex;align-items:center;justify-content:center;font-weight:700;color:#00d4ff;font-size:.8rem;">${j.pseudo.charAt(0).toUpperCase()}</span>
            <span>${esc(j.pseudo)}</span>
            ${j.equipe ? `<span style="font-size:.75rem;opacity:.5;">· ${esc(j.equipe)}</span>` : ''}
            <button class="btn-kick" data-pseudo="${esc(j.pseudo)}" style="margin-left:auto;background:none;border:none;color:#f87171;cursor:pointer;font-size:.85rem;" title="Expulser">✖</button>
        </div>`).join('');

    container.querySelectorAll('.btn-kick').forEach(btn => {
        btn.addEventListener('click', () => {
            if (confirm(`Expulser ${btn.dataset.pseudo} ?`)) {
                socket.send('HOST_KICK_PLAYER', { pseudo: btn.dataset.pseudo });
            }
        });
    });
}

function renderResultatsSp() {
    const entries = Object.entries(HostState.scores).sort((a, b) => b[1] - a[1]);
    const medals = ['🥇', '🥈', '🥉'];
    const el = $('sp-scores');
    if (!el) return;
    el.insertAdjacentHTML('afterend', `
        <div style="margin-top:1.5rem;padding:1rem;background:rgba(255,255,255,.05);border-radius:10px;">
            <h3 style="margin:0 0 .75rem;font-size:1rem;">🏁 Résultats finaux</h3>
            ${entries.map(([nom, pts], i) => `
                <div style="display:flex;align-items:center;gap:.5rem;padding:.4rem;${i===0?'font-weight:700;color:#ffd700;':''}">
                    <span>${medals[i] || `${i + 1}.`}</span>
                    <span style="flex:1;">${esc(nom)}</span>
                    <span>${pts} pts</span>
                </div>`).join('')}
        </div>`);
}

// ══════════════════════════════════════════════════════
// HELPERS UI
// ══════════════════════════════════════════════════════

function _renderQR(url, containerId) {
    const container = $(containerId);
    if (!container) return;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(url)}&bgcolor=0d0d1a&color=00d4ff&margin=2`;
    container.innerHTML = `<img src="${qrUrl}" alt="QR Code" style="border-radius:8px;" onerror="this.closest('[id]').innerHTML='<p style=opacity:.5>QR indisponible</p>'">`;
}

function _setStatutBadge(statut) {
    const badge = $('h-statut-badge');
    if (!badge) return;
    const map = { lobby: '● Lobby', en_cours: '● En cours', terminee: '● Terminée' };
    badge.textContent = map[statut] || statut;
    badge.className = `statut-badge statut-${statut}`;
}

function _setStatutBadgeSp(statut) {
    const badge = $('sp-statut-badge');
    if (!badge) return;
    const map = { lobby: '● Lobby', en_cours: '● En cours', terminee: '● Terminée' };
    badge.textContent = map[statut] || statut;
    badge.className = `statut-badge statut-${statut}`;
}

function updateWsStatus(connected) {
    const dot = $('ws-dot');
    const label = $('ws-label');
    if (dot) dot.style.background = connected ? '#22c55e' : '#ef4444';
    if (label) label.textContent = connected ? 'Connecté' : 'Déconnecté';
}

function applySnapshot(snap) {
    if (!snap) return;
    if (snap.id !== undefined) HostState.partieId = snap.id;
    if (snap.nom !== undefined) HostState.partieNom = snap.nom;
    if (snap.jeu !== undefined) HostState.jeu = snap.jeu;
    if (snap.mode !== undefined) HostState.mode = snap.mode;
    if (snap.equipes !== undefined) HostState.equipes = snap.equipes;
    if (snap.scores !== undefined) HostState.scores = snap.scores;
    if (snap.statut !== undefined) HostState.statut = snap.statut;
    if (snap.joueurs !== undefined) HostState.joueurs = snap.joueurs;
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
    let container = $('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:9999;display:flex;flex-direction:column;gap:.5rem;';
        document.body.appendChild(container);
    }
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.style.cssText = 'display:flex;gap:.5rem;align-items:center;padding:.75rem 1rem;border-radius:8px;background:#1e1e2e;color:#fff;box-shadow:0 4px 12px rgba(0,0,0,.4);opacity:0;transition:opacity .25s;';
    el.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${esc(msg)}</span>`;
    container.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, duration);
}

// ══════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════

function init() {
    console.log('[HOST] Initialisation');
    initSocket();
    initModeToggle();
    initHostRoleToggle();
    initEquipes();
    initCreerPartie();
    initControles();

    // Pré-sélectionner le jeu si ?jeu= dans l'URL
    const params = new URLSearchParams(location.search);
    const jeuId = params.get('jeu');
    if (jeuId) {
        const sel = $('h-jeu');
        if (sel?.querySelector(`option[value="${jeuId}"]`)) sel.value = jeuId;
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

window.HostState = HostState;