// ======================================================
// 🎮 QUIZ-CLIENT.JS v2.0 — Interface Host & Joueur
// ======================================================
//
// Paramètres URL :
//   ?partieId=xxx  &pseudo=yyy  &role=host|player|host-player
//
// Rôle host :
//   - Voit l'interface de contrôle (bouton "Question suivante",
//     "Révéler la réponse", indices, passer)
//   - Ne voit PAS la réponse avant de la révéler
//   - Voit les chips des joueurs ayant répondu
//
// Rôle player :
//   - Reçoit la question et répond (texte libre OU QCM selon type)
//   - Voit le feedback immédiat après sa réponse
//   - Voit la correction après révélation du host
//
// Rôle host-player :
//   - Reçoit ET répond comme joueur (panel joueur affiché)
//   - MAIS voit aussi les contrôles host
//   - Solution : on affiche view-player par défaut, et on
//     injecte dynamiquement les contrôles host dans un bandeau flottant
//
// ======================================================

import { GameSocket } from '../core/socket.js';

const socket = new GameSocket();

// ─────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────

const S = {
    partieId:  null,
    pseudo:    null,
    equipe:    null,
    role:      'player',   // 'host' | 'player' | 'host-player'
    score:     0,
    isHost:    false,
    isPlayer:  false,

    // Quiz courant
    questionEnCours: null,   // payload QUIZ_QUESTION
    aRepondu:        false,
    choixSelectionne: null,  // pour QCM
};

// ─────────────────────────────────────────────────────
// HELPERS DOM
// ─────────────────────────────────────────────────────

const $ = id => document.getElementById(id);
const show = id => { const e = $(id); if (e) e.hidden = false; };
const hide = id => { const e = $(id); if (e) e.hidden = true; };
const setText = (id, txt) => { const e = $(id); if (e) e.textContent = txt; };
const esc = s => String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const PANNEAUX_HOST   = ['host-idle','host-question-panel','host-correction-panel','host-fin-panel'];
const PANNEAUX_PLAYER = ['player-waiting','player-texte-panel','player-qcm-panel','player-correction-panel','player-fin-panel'];

function showHostPanel(id)   { PANNEAUX_HOST.forEach(p => { const e=$(p); if(e) e.hidden = p!==id; }); }
function showPlayerPanel(id) { PANNEAUX_PLAYER.forEach(p => { const e=$(p); if(e) e.hidden = p!==id; }); }

const LETTRES = ['A','B','C','D','E','F'];

function toast(msg, type = 'info', duration = 3000) {
    const colors = { success:'#22c55e', error:'#ef4444', warning:'#f59e0b', info:'#00d4ff' };
    const icons  = { success:'✅', error:'❌', warning:'⚠️', info:'ℹ️' };
    let c = $('toast-container');
    if (!c) {
        c = document.createElement('div');
        c.id = 'toast-container';
        c.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:9999;display:flex;flex-direction:column;gap:.4rem;max-width:310px;';
        document.body.appendChild(c);
    }
    const el = document.createElement('div');
    el.style.cssText = `display:flex;gap:.5rem;align-items:flex-start;padding:.65rem .9rem;border-radius:8px;background:#1e1e2e;color:#fff;border-left:3px solid ${colors[type]||colors.info};box-shadow:0 4px 16px rgba(0,0,0,.5);opacity:0;transition:opacity .2s,transform .2s;transform:translateX(12px);font-size:.88rem;`;
    el.innerHTML = `<span style="flex-shrink:0">${icons[type]||'ℹ️'}</span><span>${esc(msg)}</span>`;
    c.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity='1'; el.style.transform='translateX(0)'; });
    setTimeout(() => {
        el.style.opacity='0'; el.style.transform='translateX(8px)';
        setTimeout(() => el.remove(), 220);
    }, duration);
}

// ─────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────

function init() {
    const params   = new URLSearchParams(location.search);
    S.partieId = params.get('partieId');
    S.pseudo   = params.get('pseudo');
    S.role     = params.get('role') || 'player';
    S.isHost   = S.role === 'host' || S.role === 'host-player';
    S.isPlayer = S.role === 'player' || S.role === 'host-player';

    if (!S.partieId || !S.pseudo) {
        document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#f87171;font-size:1.1rem;text-align:center;padding:2rem;">❌ Paramètres manquants.<br>Utilisez le lien fourni par le host.</div>';
        return;
    }

    // Afficher la bonne vue selon le rôle
    if (S.role === 'host') {
        show('view-host');
        hide('view-player');
        show('topbar-progress');
        hide('topbar-score');
        showHostPanel('host-idle');
    } else if (S.role === 'host-player') {
        // Host-joueur : interface joueur + bandeau contrôle host en bas
        hide('view-host');
        show('view-player');
        show('topbar-score');
        show('topbar-progress');
        showPlayerPanel('player-waiting');
        injecterBandeauHostPlayer();
    } else {
        hide('view-host');
        show('view-player');
        show('topbar-score');
        hide('topbar-progress');
        showPlayerPanel('player-waiting');
    }

    // Bouton retour
    $('btn-back')?.addEventListener('click', () => {
        if (confirm('Quitter le jeu ?')) {
            window.location.href = S.isHost ? '/host/' : '/join/';
        }
    });

    connectSocket();

    if (S.isHost)   initControlesHost();
    if (S.isPlayer) initControlesPlayer();
}

// ─────────────────────────────────────────────────────
// BANDEAU HOST-PLAYER (flottant en bas)
// ─────────────────────────────────────────────────────

function injecterBandeauHostPlayer() {
    const bandeau = document.createElement('div');
    bandeau.id = 'host-player-bar';
    bandeau.style.cssText = `
        position: fixed; bottom: 0; left: 0; right: 0; z-index: 200;
        background: var(--c-surface);
        border-top: 1px solid var(--c-border);
        padding: .65rem 1rem;
        display: flex; flex-wrap: wrap; gap: .5rem; justify-content: center;
    `;
    bandeau.innerHTML = `
        <button id="hp-btn-next"    class="btn-primary btn-sm"   style="min-width:160px;">➡ Question suivante</button>
        <button id="hp-btn-indice1" class="btn-secondary btn-sm">💡 Indice 1</button>
        <button id="hp-btn-indice2" class="btn-secondary btn-sm">🔥 Indice 2</button>
        <button id="hp-btn-reveal"  class="btn-success  btn-sm"  style="min-width:140px;">✅ Révéler</button>
        <button id="hp-btn-skip"    class="btn-secondary btn-sm" style="color:#f59e0b;border-color:#f59e0b40;">⏭ Passer</button>
    `;
    document.body.appendChild(bandeau);

    // Ajouter de la marge au bas du contenu
    const viewPlayer = $('view-player');
    if (viewPlayer) viewPlayer.style.paddingBottom = '4rem';
}

// ─────────────────────────────────────────────────────
// CONNEXION WEBSOCKET
// ─────────────────────────────────────────────────────

function connectSocket() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket.connect(`${proto}//${location.host}/ws`);

    socket.on('__connected__', () => {
        hide('disconnect-banner');
        if (S.isHost && !S.isPlayer) {
            socket.send('HOST_AUTH', {});
        } else {
            // Joueur ou host-player : on se reconnecte comme joueur
            socket.send('PLAYER_REJOIN', { partieId: S.partieId, pseudo: S.pseudo });
            if (S.isHost) {
                // En plus, s'authentifier comme host
                setTimeout(() => socket.send('HOST_AUTH', {}), 200);
            }
        }
    });

    socket.on('__disconnected__', () => {
        show('disconnect-banner');
    });

    socket.on('AUTH_OK', () => {
        if (S.isHost) socket.send('HOST_REJOIN', { partieId: S.partieId });
    });

    socket.on('HOST_REJOINED', ({ snapshot }) => {
        toast('Reconnecté comme host ✅', 'success', 2000);
    });

    socket.on('REJOIN_OK', ({ equipe, snapshot }) => {
        S.equipe = equipe;
        updateScore(snapshot.scores?.[S.pseudo] || 0);
        toast(`Reconnecté : ${S.pseudo}`, 'success', 2000);
    });

    socket.on('JOIN_ERROR', ({ code }) => {
        const msgs = {
            GAME_NOT_FOUND:   'Partie introuvable.',
            PLAYER_NOT_FOUND: 'Vous n\'êtes plus dans cette partie.',
        };
        toast(msgs[code] || `Erreur connexion : ${code}`, 'error', 5000);
    });

    // ── Événements Quiz ───────────────────────────────

    socket.on('QUIZ_READY', ({ total, message }) => {
        // Host : mettre à jour le label de progression et activer le bouton
        const idleTotal = $('host-idle-total');
        if (idleTotal) idleTotal.textContent = `${total} questions chargées`;
        setText('progress-label', `Q 0/${total}`);
        toast(message || 'Quiz prêt !', 'info', 2500);
    });

    socket.on('QUIZ_QUESTION', (payload) => {
        S.questionEnCours  = payload;
        S.aRepondu         = false;
        S.choixSelectionne = null;
        setText('progress-label', `Q ${payload.idx + 1}/${payload.total}`);

        if (S.isHost)   renderHostQuestion(payload);
        if (S.isPlayer) renderPlayerQuestion(payload);
    });

    // Réponse d'un joueur arrivée (host uniquement)
    socket.on('QUIZ_RESPONSE_IN', ({ pseudo, nbReponses, nbJoueurs, allAnswered }) => {
        const counter = $('h-resp-counter');
        if (counter) counter.textContent = `${nbReponses} / ${nbJoueurs}`;

        const chips = $('h-reponses-live');
        if (chips) {
            const exists = chips.querySelector(`[data-p="${CSS.escape(pseudo)}"]`);
            if (!exists) {
                const chip = document.createElement('span');
                chip.className = 'resp-chip';
                chip.dataset.p = pseudo;
                chip.textContent = pseudo;
                chips.appendChild(chip);
            }
        }

        if (allAnswered) toast('Tous les joueurs ont répondu !', 'success', 2000);
    });

    socket.on('QUIZ_ANSWER_ACK', ({ status, texte }) => {
        if (status === 'ok') {
            S.aRepondu = true;
            confirmerEnvoi(texte);
        } else if (status === 'already_answered') {
            toast('Vous avez déjà répondu.', 'warning');
        } else if (status === 'too_late') {
            toast('Trop tard — la question est terminée.', 'warning');
        }
    });

    // Indice révélé par le host → affiché côté joueur
    socket.on('QUIZ_INDICE', ({ num, texte }) => {
        // Côté host : révéler l'indice dans le panneau question
        if (S.isHost) {
            const el = $(`h-indice${num}`);
            if (el) { el.textContent = texte; el.hidden = false; el.classList.add('indice-visible'); }
        }
        // Côté joueur : révéler dans les panneaux texte et qcm
        if (S.isPlayer) {
            const texteEl = $(`p-indice${num}`);
            const qcmEl   = $(`p-qcm-indice${num}`);
            if (texteEl) { texteEl.textContent = texte; texteEl.hidden = false; texteEl.classList.add('indice-visible'); }
            if (qcmEl)   { qcmEl.textContent   = texte; qcmEl.hidden   = false; qcmEl.classList.add('indice-visible'); }
            toast(`💡 Indice ${num} : ${texte}`, 'info', 4500);
        }
    });

    socket.on('QUIZ_CORRECTION', (payload) => {
        if (S.isHost)   renderHostCorrection(payload);
        if (S.isPlayer) renderPlayerCorrection(payload);
    });

    socket.on('QUIZ_END', ({ scores, total }) => {
        if (S.isHost)   renderHostFin(scores, total);
        if (S.isPlayer) renderPlayerFin(scores);
    });

    socket.on('SCORES_UPDATE', ({ scores }) => {
        updateScore(scores?.[S.pseudo] || 0);
    });

    socket.on('GAME_ENDED', () => {
        toast('La partie a été terminée.', 'info', 4000);
        setTimeout(() => {
            window.location.href = S.isHost ? '/host/' : '/join/';
        }, 3000);
    });

    socket.on('KICKED', () => {
        toast('Vous avez été expulsé.', 'error', 5000);
        setTimeout(() => { window.location.href = '/join/'; }, 2500);
    });

    socket.on('HOST_DISCONNECTED', () => {
        toast('Le host s\'est déconnecté.', 'warning', 6000);
    });

    socket.on('ERROR', ({ code, message }) => {
        const msgs = {
            QUIZ_BAD_STATE: message || 'Action impossible dans cet état.',
            NOT_HOST:       'Non reconnu comme host.',
            NO_ACTIVE_GAME: 'Aucune partie active.',
        };
        toast(msgs[code] || `Erreur : ${code}`, 'error');
    });
}

// ─────────────────────────────────────────────────────
// CONTRÔLES HOST
// ─────────────────────────────────────────────────────

function initControlesHost() {

    // ── Bouton "Question suivante" ────────────────────
    // Utilisé depuis le panel idle ET le panel correction
    function lancerQuestion() {
        socket.send('HOST_ACTION', { action: 'quiz:next_question', data: {} });
    }

    // Panneau idle
    $('host-btn-next')?.addEventListener('click', () => {
        // Au premier clic : on lance quiz:start implicitement
        // (le serveur crée la session si elle n'existe pas)
        lancerQuestion();
    });

    // Panneau correction
    $('h-btn-next-q')?.addEventListener('click', lancerQuestion);

    // Bandeau host-player
    $('hp-btn-next')?.addEventListener('click', lancerQuestion);

    // ── Révéler la réponse ────────────────────────────
    function reveler() {
        socket.send('HOST_ACTION', { action: 'quiz:reveal', data: {} });
    }
    $('h-btn-reveal')?.addEventListener('click', reveler);
    $('hp-btn-reveal')?.addEventListener('click', reveler);

    // ── Passer ────────────────────────────────────────
    function passer() {
        if (confirm('Passer cette question sans attribuer de points ?')) {
            socket.send('HOST_ACTION', { action: 'quiz:skip', data: {} });
        }
    }
    $('h-btn-skip')?.addEventListener('click', passer);
    $('hp-btn-skip')?.addEventListener('click', passer);

    // ── Indices ───────────────────────────────────────
    function revelerIndice(num) {
        if (!S.questionEnCours) return;
        const cle = `indice${num}`;
        if (!S.questionEnCours[cle]) {
            toast(`Pas d'indice ${num} pour cette question.`, 'warning'); return;
        }
        socket.send('HOST_ACTION', { action: 'quiz:reveal_indice', data: { num } });
    }
    $('h-btn-indice1')?.addEventListener('click', () => revelerIndice(1));
    $('h-btn-indice2')?.addEventListener('click', () => revelerIndice(2));
    $('hp-btn-indice1')?.addEventListener('click', () => revelerIndice(1));
    $('hp-btn-indice2')?.addEventListener('click', () => revelerIndice(2));

    // ── Terminer le quiz (panneau correction) ─────────
    $('h-btn-end-quiz')?.addEventListener('click', () => {
        if (confirm('Terminer le quiz maintenant et afficher les résultats ?')) {
            socket.send('HOST_END_GAME', {});
        }
    });

    // ── Bouton fin de partie (panneau résultats) ──────
    $('h-fin-end')?.addEventListener('click', () => {
        if (confirm('Terminer la partie pour tous les joueurs ?')) {
            socket.send('HOST_END_GAME', {});
        }
    });
}

// ─────────────────────────────────────────────────────
// CONTRÔLES JOUEUR
// ─────────────────────────────────────────────────────

function initControlesPlayer() {
    // Texte libre
    $('p-btn-send')?.addEventListener('click', envoyerTexte);
    $('p-answer-input')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') envoyerTexte();
    });
}

function envoyerTexte() {
    if (S.aRepondu) return;
    const input = $('p-answer-input');
    const texte = input?.value.trim();
    if (!texte) { toast('Écrivez votre réponse.', 'warning'); return; }

    const btn = $('p-btn-send');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Envoi…'; }

    socket.send('PLAYER_ACTION', { action: 'quiz:answer', data: { texte } });
}

function envoyerQCM(choix) {
    if (S.aRepondu) return;
    S.choixSelectionne = choix;
    S.aRepondu = true;

    // Surligner le choix sélectionné
    document.querySelectorAll('.btn-choix').forEach(btn => {
        btn.disabled = true;
        if (btn.dataset.val === choix) btn.classList.add('selected');
    });

    socket.send('PLAYER_ACTION', { action: 'quiz:answer', data: { texte: choix } });
}

// ─────────────────────────────────────────────────────
// RENDU HOST — question en cours
// ─────────────────────────────────────────────────────

function renderHostQuestion(payload) {
    showHostPanel('host-question-panel');

    setText('h-theme',    payload.theme    || '—');
    setText('h-progress', `Q ${payload.idx + 1} / ${payload.total}`);
    setText('h-question-text', payload.question);

    // Badge type
    const typeBadge = $('h-type-badge');
    if (typeBadge) {
        typeBadge.textContent = payload.type === 'qcm' ? '🔵 QCM' : '✍️ Texte libre';
    }

    // Reset indices
    const i1 = $('h-indice1'), i2 = $('h-indice2');
    if (i1) { i1.textContent = payload.indice1 || ''; i1.hidden = !payload.indice1; i1.classList.remove('indice-visible'); }
    if (i2) { i2.textContent = payload.indice2 || ''; i2.hidden = !payload.indice2; i2.classList.remove('indice-visible'); }

    // Boutons indices actifs / inactifs
    const btn1 = $('h-btn-indice1'), btn2 = $('h-btn-indice2');
    if (btn1) btn1.disabled = !payload.indice1;
    if (btn2) btn2.disabled = !payload.indice2;
    const hp1 = $('hp-btn-indice1'), hp2 = $('hp-btn-indice2');
    if (hp1) hp1.disabled = !payload.indice1;
    if (hp2) hp2.disabled = !payload.indice2;

    // Reset réponses
    const counter = $('h-resp-counter');
    if (counter) counter.textContent = `0 / ${payload.total ? '?' : '?'}`;
    const chips = $('h-reponses-live');
    if (chips) chips.innerHTML = '';

    // Label bouton révéler
    const btnReveal = $('h-btn-reveal');
    if (btnReveal) btnReveal.textContent = `✅ Révéler la réponse (${payload.points} pts)`;
    const hpReveal = $('hp-btn-reveal');
    if (hpReveal) hpReveal.textContent = `✅ Révéler (${payload.points} pts)`;
}

// ─────────────────────────────────────────────────────
// RENDU HOST — correction
// ─────────────────────────────────────────────────────

function renderHostCorrection(payload) {
    showHostPanel('host-correction-panel');

    setText('h-corr-theme',    payload.theme    || '—');
    setText('h-corr-progress', `Q ${payload.idx + 1} / ${payload.total}`);
    setText('h-corr-question', payload.question);
    setText('h-corr-reponse',  `✅ ${payload.reponse}`);

    const container = $('h-corr-reponses');
    if (!container) return;

    if (!payload.reponses?.length) {
        container.innerHTML = '<p style="font-size:.82rem;color:var(--c-text-mute);font-style:italic;">Aucune réponse reçue.</p>';
    } else {
        const medals = ['🥇','🥈','🥉'];
        let correctIdx = 0;
        container.innerHTML = payload.reponses.map(r => {
            const cls   = r.correct ? 'correct' : 'incorrect';
            const medal = r.correct ? (medals[correctIdx++] || '✅') : '❌';
            const pts   = r.correct ? `<span style="color:#10b981;font-size:.78rem;font-weight:700;margin-left:auto;">+${payload.points}pts</span>` : '';
            return `<div class="corr-row ${cls}">
                <span>${medal}</span>
                <span style="font-weight:600;flex:1;">${esc(r.pseudo)}</span>
                <span style="opacity:.8;font-style:italic;">${esc(r.texte)}</span>
                ${pts}
            </div>`;
        }).join('');
    }

    // Adapter le label "Question suivante"
    const btnNext = $('h-btn-next-q');
    if (btnNext) {
        const derniereQuestion = payload.idx + 1 >= payload.total;
        btnNext.textContent = derniereQuestion ? '🏁 Voir les résultats finaux' : '➡ Question suivante';
    }
}

// ─────────────────────────────────────────────────────
// RENDU HOST — fin
// ─────────────────────────────────────────────────────

function renderHostFin(scores, total) {
    showHostPanel('host-fin-panel');
    hide('topbar-progress');
    setText('h-fin-total', `${total} question${total > 1 ? 's' : ''} posées`);

    const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const medals  = ['🥇','🥈','🥉'];
    const container = $('h-fin-scores');
    if (!container) return;

    container.innerHTML = entries.map(([nom, pts], i) => `
        <div class="podium-row ${i === 0 ? 'first' : ''}">
            <span style="font-size:1.2rem;">${medals[i] || `${i+1}.`}</span>
            <span style="flex:1;font-weight:600;">${esc(nom)}</span>
            <span style="font-family:var(--font-display);font-weight:700;color:${i===0?'gold':'var(--c-accent)'};">${pts} pts</span>
        </div>`).join('');

    toast(`Quiz terminé — ${total} questions !`, 'success', 4000);
}

// ─────────────────────────────────────────────────────
// RENDU JOUEUR — question (aiguillage texte / qcm)
// ─────────────────────────────────────────────────────

function renderPlayerQuestion(payload) {
    S.aRepondu = false;
    S.choixSelectionne = null;

    if (payload.type === 'qcm') {
        renderPlayerQCM(payload);
    } else {
        renderPlayerTexte(payload);
    }
}

function renderPlayerTexte(payload) {
    showPlayerPanel('player-texte-panel');

    setText('p-theme',         payload.theme    || '—');
    setText('p-progress',      `Q ${payload.idx + 1} / ${payload.total}`);
    setText('p-question-text', payload.question);

    // Reset indices
    resetIndices('p-indice1', 'p-indice2');

    // Reset champ
    const input = $('p-answer-input');
    if (input) { input.value = ''; }
    const btn = $('p-btn-send');
    if (btn) { btn.disabled = false; btn.textContent = '✉️ Envoyer ma réponse'; }
    show('p-texte-answer-zone');
    hide('p-texte-sent');

    // Focus auto
    setTimeout(() => $('p-answer-input')?.focus(), 100);
}

function renderPlayerQCM(payload) {
    showPlayerPanel('player-qcm-panel');

    setText('p-qcm-theme',    payload.theme    || '—');
    setText('p-qcm-progress', `Q ${payload.idx + 1} / ${payload.total}`);
    setText('p-qcm-question', payload.question);

    // Reset indices
    resetIndices('p-qcm-indice1', 'p-qcm-indice2');

    hide('p-qcm-sent');

    // Générer les boutons choix
    const container = $('p-qcm-choix');
    if (!container) return;

    container.innerHTML = (payload.choix || []).map((choix, i) => `
        <button class="btn-choix" data-val="${esc(choix)}">
            <span class="choix-lettre">${LETTRES[i] || i + 1}</span>
            <span>${esc(choix)}</span>
        </button>`).join('');

    container.querySelectorAll('.btn-choix').forEach(btn => {
        btn.addEventListener('click', () => envoyerQCM(btn.dataset.val));
    });
}

function resetIndices(id1, id2) {
    const i1 = $(id1), i2 = $(id2);
    if (i1) { i1.textContent = ''; i1.hidden = true; i1.classList.remove('indice-visible'); }
    if (i2) { i2.textContent = ''; i2.hidden = true; i2.classList.remove('indice-visible'); }
}

// ─────────────────────────────────────────────────────
// CONFIRMATION ENVOI JOUEUR
// ─────────────────────────────────────────────────────

function confirmerEnvoi(texte) {
    const q = S.questionEnCours;
    if (!q) return;

    if (q.type === 'qcm') {
        // Marquer tous les boutons comme envoyés (désactivés)
        document.querySelectorAll('.btn-choix').forEach(btn => btn.disabled = true);
        show('p-qcm-sent');
        const sent = $('p-qcm-sent');
        if (sent) sent.innerHTML = `✅ Votre choix : <strong>${esc(texte)}</strong><br><small style="opacity:.6">En attente du host…</small>`;
    } else {
        hide('p-texte-answer-zone');
        show('p-texte-sent');
        const sent = $('p-texte-sent');
        if (sent) sent.innerHTML = `✅ Votre réponse : <strong>${esc(texte)}</strong><br><small style="opacity:.6">En attente du host…</small>`;
    }

    toast('Réponse envoyée !', 'success', 2000);
}

// ─────────────────────────────────────────────────────
// RENDU JOUEUR — correction
// ─────────────────────────────────────────────────────

function renderPlayerCorrection(payload) {
    showPlayerPanel('player-correction-panel');

    setText('p-corr-theme',    payload.theme    || '—');
    setText('p-corr-question', payload.question);
    setText('p-corr-bonne-rep', payload.reponse);

    // Si QCM : mettre en couleur les boutons avant de switcher de panneau
    // (on les colore dans le panneau QCM puis on switch — animation rapide)
    if (payload.type === 'qcm') {
        document.querySelectorAll('.btn-choix').forEach(btn => {
            btn.disabled = true;
            if (btn.dataset.val === payload.reponse) {
                btn.classList.add('correct');
            } else if (btn.dataset.val === S.choixSelectionne && S.choixSelectionne !== payload.reponse) {
                btn.classList.add('incorrect');
            }
        });
        // Délai court pour montrer la couleur avant de switch
        setTimeout(() => afficherCorrectionJoueur(payload), 800);
    } else {
        afficherCorrectionJoueur(payload);
    }
}

function afficherCorrectionJoueur(payload) {
    showPlayerPanel('player-correction-panel');

    const maReponse = payload.reponses?.find(r => r.pseudo === S.pseudo);
    const resultEl  = $('p-corr-result');
    if (!resultEl) return;

    if (!maReponse) {
        resultEl.style.cssText = 'background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);color:#fca5a5;padding:.8rem 1rem;border-radius:6px;';
        resultEl.innerHTML = '😶 Vous n\'avez pas répondu';
    } else if (maReponse.correct) {
        resultEl.style.cssText = 'background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.25);color:#6ee7b7;padding:.8rem 1rem;border-radius:6px;';
        resultEl.innerHTML = `🎉 Bonne réponse ! <strong>+${payload.points} pts</strong>`;
    } else {
        resultEl.style.cssText = 'background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);color:#fca5a5;padding:.8rem 1rem;border-radius:6px;';
        resultEl.innerHTML = `❌ Votre réponse : <em>${esc(maReponse.texte)}</em>`;
    }
}

// ─────────────────────────────────────────────────────
// RENDU JOUEUR — fin
// ─────────────────────────────────────────────────────

function renderPlayerFin(scores) {
    showPlayerPanel('player-fin-panel');
    hide('topbar-score');

    const entries   = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const medals    = ['🥇','🥈','🥉'];
    const container = $('p-fin-scores');
    if (!container) return;

    container.innerHTML = entries.map(([nom, pts], i) => {
        const isMe = nom === S.pseudo;
        return `<div class="result-row${i===0?' result-winner':''}${isMe?' result-me':''}">
            <span>${medals[i] || `${i+1}.`}</span>
            <span style="flex:1;">
                ${esc(nom)}
                ${isMe ? '<strong style="font-size:.72rem;background:var(--c-accent);color:#000;border-radius:3px;padding:0 .3rem;margin-left:.3rem;">MOI</strong>' : ''}
            </span>
            <span style="font-weight:700;">${pts} pts</span>
        </div>`;
    }).join('');

    // Bandeau host-player : masquer
    const bar = $('host-player-bar');
    if (bar) bar.hidden = true;
}

// ─────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────

function updateScore(pts) {
    S.score = pts;
    setText('pg-score-val', `${pts} pts`);
}

// ─────────────────────────────────────────────────────
// POINT D'ENTRÉE
// ─────────────────────────────────────────────────────

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}