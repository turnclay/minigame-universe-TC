// ======================================================
// 🎮 public/js/games/quiz-client.js  — v4.0
// Client Quiz — Host & Player — MiniGame Universe
// ======================================================
//
// PARAMÈTRES URL :
//   ?partieId=xxx  — ID de la partie (obligatoire)
//   ?pseudo=yyy    — Pseudo du joueur (obligatoire)
//   ?role=host|player|host-player
//
// RÔLES :
//   host        → interface de contrôle uniquement
//   player      → interface de réponse uniquement
//   host-player → interface joueur + bandeau de contrôle flottant en bas
//
// SCORING AFFICHÉ :
//   +2 pts sans indice  /  +1 pt avec 1 indice  /  +0.5 pt avec 2 indices
//
// TIMER :
//   60 secondes par question — décompte dans #p-timer (injecté dynamiquement)
//   À l'expiration : champ désactivé, bouton désactivé
//
// DÉPENDANCES :
//   /js/core/socket.js  — GameSocket
// ======================================================

import { GameSocket } from '../core/socket.js';

// ─────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────

const S = {
    partieId : null,
    pseudo   : null,
    role     : 'player',
    isHost   : false,
    isPlayer : false,

    questionEnCours    : null,
    aRepondu           : false,
    scoreLocal         : 0,

    timerInterval      : null,
    timerSecondes      : 60,
    timerExpire        : false,

    totalQuestionsJSON : 0,
};

// ─────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────

const TIMER_DUREE = 60;

const HOST_PANELS = [
    'host-idle',
    'host-question-panel',
    'host-correction-panel',
    'host-fin-panel',
];
const PLAYER_PANELS = [
    'player-waiting',
    'player-texte-panel',
    'player-qcm-panel',
    'player-correction-panel',
    'player-fin-panel',
];

// ─────────────────────────────────────────────────────
// DOM HELPERS
// ─────────────────────────────────────────────────────

const $    = id => document.getElementById(id);
const show = id => { const e = $(id); if (e) e.hidden = false; };
const hide = id => { const e = $(id); if (e) e.hidden = true; };

function setText(id, txt) {
    const e = $(id);
    if (e) e.textContent = txt ?? '';
}

function setHTML(id, html) {
    const e = $(id);
    if (e) e.innerHTML = html;
}

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function showHostPanel(id) {
    HOST_PANELS.forEach(p => {
        const e = $(p);
        if (e) e.hidden = (p !== id);
    });
}

function showPlayerPanel(id) {
    PLAYER_PANELS.forEach(p => {
        const e = $(p);
        if (e) e.hidden = (p !== id);
    });
}

// ─────────────────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────────────────

function toast(msg, type = 'info', duration = 3000) {
    const COLORS = { success: '#22c55e', error: '#ef4444', warning: '#f59e0b', info: '#00d4ff' };
    const ICONS  = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };

    let c = $('toast-container');
    if (!c) {
        c = document.createElement('div');
        c.id = 'toast-container';
        c.style.cssText = [
            'position:fixed;top:1rem;right:1rem;z-index:9999',
            'display:flex;flex-direction:column;gap:.4rem',
            'max-width:310px;pointer-events:none',
        ].join(';');
        document.body.appendChild(c);
    }

    const el = document.createElement('div');
    el.style.cssText = [
        'display:flex;gap:.5rem;align-items:flex-start',
        'padding:.65rem .9rem;border-radius:8px',
        `background:#1e1e2e;color:#fff;border-left:3px solid ${COLORS[type] || COLORS.info}`,
        'box-shadow:0 4px 16px rgba(0,0,0,.5)',
        'opacity:0;transition:opacity .2s,transform .2s;transform:translateX(12px)',
        'font-size:.88rem;pointer-events:auto',
    ].join(';');
    el.innerHTML = `<span style="flex-shrink:0">${ICONS[type] || 'ℹ️'}</span><span>${esc(msg)}</span>`;
    c.appendChild(el);

    requestAnimationFrame(() => {
        el.style.opacity   = '1';
        el.style.transform = 'translateX(0)';
    });
    setTimeout(() => {
        el.style.opacity   = '0';
        el.style.transform = 'translateX(8px)';
        setTimeout(() => el.remove(), 220);
    }, duration);
}

// ─────────────────────────────────────────────────────
// TIMER JOUEUR
// ─────────────────────────────────────────────────────

function demarrerTimer() {
    arreterTimer();
    S.timerSecondes = TIMER_DUREE;
    S.timerExpire   = false;

    _afficherTimer(S.timerSecondes);

    S.timerInterval = setInterval(() => {
        S.timerSecondes--;
        if (S.timerSecondes <= 0) {
            S.timerSecondes = 0;
            _afficherTimer(0);
            _expirerTimer();
            arreterTimer();
        } else {
            _afficherTimer(S.timerSecondes);
        }
    }, 1000);
}

function arreterTimer() {
    if (S.timerInterval) {
        clearInterval(S.timerInterval);
        S.timerInterval = null;
    }
}

function _afficherTimer(secondes) {
    let el = $('p-timer');
    if (!el) {
        // Injecter le timer avant la zone de réponse
        const zone = $('p-texte-answer-zone');
        if (!zone) return;
        el = document.createElement('div');
        el.id = 'p-timer';
        zone.parentNode.insertBefore(el, zone);
    }

    el.textContent = `⏱ ${secondes}s`;
    el.className   = 'quiz-timer';

    if (secondes <= 10)      el.classList.add('timer-danger');
    else if (secondes <= 20) el.classList.add('timer-warning');
}

function _expirerTimer() {
    S.timerExpire = true;

    const input = $('p-answer-input');
    const btn   = $('p-btn-send');

    if (input) { input.disabled = true; input.placeholder = '⏱ Temps écoulé'; }
    if (btn)   { btn.disabled   = true; btn.textContent   = '⏱ Temps écoulé'; }

    const el = $('p-timer');
    if (el) { el.textContent = '⏱ 0s'; el.className = 'quiz-timer timer-danger'; }

    if (!S.aRepondu) toast('⏱ Temps écoulé !', 'warning', 3000);
}

// ─────────────────────────────────────────────────────
// WEBSOCKET
// ─────────────────────────────────────────────────────

const socket = new GameSocket();

function connectSocket() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket.connect(`${proto}//${location.host}/ws`);

    socket.on('__connected__', () => {
        hide('disconnect-banner');
        if (S.isHost && !S.isPlayer) {
            socket.send('HOST_AUTH', {});
        } else {
            socket.send('PLAYER_REJOIN', { partieId: S.partieId, pseudo: S.pseudo });
            if (S.isHost) setTimeout(() => socket.send('HOST_AUTH', {}), 200);
        }
    });

    socket.on('__disconnected__', () => {
        show('disconnect-banner');
        arreterTimer();
    });

    socket.on('AUTH_OK', () => {
        if (S.isHost) socket.send('HOST_REJOIN', { partieId: S.partieId });
    });

    socket.on('HOST_REJOINED', ({ snapshot }) => {
        toast('Reconnecté comme host ✅', 'success', 2000);
        if (snapshot?.scores?.[S.pseudo] !== undefined) updateScore(snapshot.scores[S.pseudo]);
    });

    socket.on('REJOIN_OK', ({ snapshot }) => {
        updateScore(snapshot?.scores?.[S.pseudo] || 0);
        toast(`Reconnecté : ${S.pseudo}`, 'success', 2000);
    });

    socket.on('JOIN_ERROR', ({ code }) => {
        const msgs = {
            GAME_NOT_FOUND   : 'Partie introuvable.',
            PLAYER_NOT_FOUND : "Vous n'êtes plus dans cette partie.",
        };
        toast(msgs[code] || `Erreur connexion : ${code}`, 'error', 5000);
    });

    // ── Quiz events ──────────────────────────────────

    socket.on('QUIZ_READY', ({ total, message }) => {
        S.totalQuestionsJSON = total;
        setText('host-idle-total', `${total} question${total > 1 ? 's' : ''} chargée${total > 1 ? 's' : ''}`);
        _majProgressLabel(0, total);
        toast(message || 'Quiz prêt !', 'info', 2500);
    });

    socket.on('QUIZ_QUESTION', (payload) => {
        S.questionEnCours = payload;
        S.aRepondu        = false;
        if (payload.total) S.totalQuestionsJSON = payload.total;
        _majProgressLabel(payload.posees, payload.total ?? S.totalQuestionsJSON);

        if (S.isHost)   renderHostQuestion(payload);
        if (S.isPlayer) renderPlayerQuestion(payload);
    });

    socket.on('QUIZ_RESPONSE_IN', ({ pseudo, nbReponses, nbJoueurs, allAnswered }) => {
        setText('h-resp-counter', `${nbReponses} / ${nbJoueurs ?? '?'}`);
        const chips = $('h-reponses-live');
        if (chips && !chips.querySelector(`[data-p="${CSS.escape(pseudo)}"]`)) {
            const chip = document.createElement('span');
            chip.className   = 'resp-chip';
            chip.dataset.p   = pseudo;
            chip.textContent = pseudo;
            chips.appendChild(chip);
        }
        if (allAnswered) toast('Tous les joueurs ont répondu ! 🎉', 'success', 2500);
    });

    socket.on('QUIZ_ANSWER_ACK', ({ status, texte }) => {
        const btn = $('p-btn-send');
        if (btn) { btn.disabled = false; btn.textContent = '✉️ Envoyer'; }

        if (status === 'ok') {
            S.aRepondu = true;
            arreterTimer();
            confirmerEnvoi(texte);
        } else if (status === 'already_answered') {
            toast('Vous avez déjà répondu.', 'warning');
        } else if (status === 'too_late') {
            toast('Trop tard — la correction est affichée.', 'warning');
        } else if (status === 'invalid') {
            toast('Réponse invalide.', 'error');
        }
    });

    socket.on('QUIZ_INDICE', ({ num, texte }) => {
        if (S.isHost) {
            const el = $(`h-indice${num}`);
            if (el) {
                el.textContent = `💡 Indice ${num} : ${texte}`;
                el.hidden = false;
                el.classList.add('indice-visible');
            }
        }
        if (S.isPlayer) {
            [`p-indice${num}`, `p-qcm-indice${num}`].forEach(id => {
                const el = $(id);
                if (el) {
                    el.textContent = `💡 Indice ${num} : ${texte}`;
                    el.hidden = false;
                    el.classList.add('indice-visible');
                }
            });
            const msg = num === 1
                ? 'Indice révélé — réponse vaut maintenant 1 pt'
                : 'Indice 2 révélé — réponse vaut maintenant 0.5 pt';
            toast(msg, 'warning', 4000);
        }
    });

    socket.on('QUIZ_CORRECTION', (payload) => {
        arreterTimer();
        if (S.isHost)   renderHostCorrection(payload);
        if (S.isPlayer) renderPlayerCorrection(payload);
    });

    socket.on('QUIZ_END', ({ scores, total }) => {
        arreterTimer();
        if (S.isHost)   renderHostFin(scores, total);
        if (S.isPlayer) renderPlayerFin(scores);
    });

    socket.on('SCORES_UPDATE', ({ scores }) => {
        updateScore(scores?.[S.pseudo] ?? 0);
    });

    socket.on('GAME_ENDED', () => {
        toast('La partie est terminée.', 'info', 4000);
        setTimeout(() => { window.location.href = S.isHost ? '/host/' : '/join/'; }, 3000);
    });

    socket.on('KICKED', () => {
        toast('Vous avez été expulsé de la partie.', 'error', 5000);
        setTimeout(() => { window.location.href = '/join/'; }, 2500);
    });

    socket.on('HOST_DISCONNECTED', () => {
        toast("Le host s'est déconnecté.", 'warning', 6000);
        show('disconnect-banner');
    });

    socket.on('ERROR', ({ code, message }) => {
        const msgs = {
            QUIZ_BAD_STATE : message || 'Action impossible dans cet état.',
            NOT_HOST       : 'Non reconnu comme host.',
            NO_ACTIVE_GAME : 'Aucune partie active.',
        };
        toast(msgs[code] || `Erreur : ${code}`, 'error');
    });
}

// ─────────────────────────────────────────────────────
// CONTRÔLES HOST
// ─────────────────────────────────────────────────────

function initControlesHost() {
    const lancerQuestion = () =>
        socket.send('HOST_ACTION', { action: 'quiz:next_question', data: {} });

    const reveler = () =>
        socket.send('HOST_ACTION', { action: 'quiz:reveal', data: {} });

    const passer = () => {
        if (confirm('Passer cette question sans attribuer de points ?'))
            socket.send('HOST_ACTION', { action: 'quiz:skip', data: {} });
    };

    const revelerIndice = (num) => {
        if (!S.questionEnCours) return;
        if (!S.questionEnCours[`hasIndice${num}`]) {
            toast(`Pas d'indice ${num} pour cette question.`, 'warning');
            return;
        }
        socket.send('HOST_ACTION', { action: 'quiz:reveal_indice', data: { num } });
    };

    const terminerPartie = () => {
        if (confirm('Terminer la partie pour tous les joueurs ?'))
            socket.send('HOST_END_GAME', {});
    };

    ['host-btn-next', 'h-btn-next-q', 'hp-btn-next'].forEach(id =>
        $(id)?.addEventListener('click', lancerQuestion));
    ['h-btn-reveal', 'hp-btn-reveal'].forEach(id =>
        $(id)?.addEventListener('click', reveler));
    ['h-btn-skip', 'hp-btn-skip'].forEach(id =>
        $(id)?.addEventListener('click', passer));
    ['h-btn-indice1', 'hp-btn-indice1'].forEach(id =>
        $(id)?.addEventListener('click', () => revelerIndice(1)));
    ['h-btn-indice2', 'hp-btn-indice2'].forEach(id =>
        $(id)?.addEventListener('click', () => revelerIndice(2)));
    ['h-btn-end-quiz', 'h-fin-end'].forEach(id =>
        $(id)?.addEventListener('click', terminerPartie));
}

// ─────────────────────────────────────────────────────
// CONTRÔLES PLAYER
// ─────────────────────────────────────────────────────

function initControlesPlayer() {
    $('p-btn-send')?.addEventListener('click', envoyerTexte);
    $('p-answer-input')?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) envoyerTexte();
    });
}

function envoyerTexte() {
    if (S.aRepondu || S.timerExpire) return;
    const input = $('p-answer-input');
    const texte = input?.value.trim();
    if (!texte) { toast("Écrivez votre réponse avant d'envoyer.", 'warning'); return; }
    const btn = $('p-btn-send');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Envoi…'; }
    socket.send('PLAYER_ACTION', { action: 'quiz:answer', data: { texte } });
}

// ─────────────────────────────────────────────────────
// RENDER HOST — question
// ─────────────────────────────────────────────────────

function renderHostQuestion(payload) {
    showHostPanel('host-question-panel');

    setText('h-theme',         payload.theme    || '—');
    setText('h-progress',      `Q ${payload.posees} / ${payload.total ?? S.totalQuestionsJSON}`);
    setText('h-question-text', payload.question);

    const typeBadge = $('h-type-badge');
    if (typeBadge) { typeBadge.textContent = '✍️ Texte libre'; typeBadge.dataset.type = 'texte'; }

    // Réinitialiser indices
    [1, 2].forEach(n => {
        const el = $(`h-indice${n}`);
        if (el) { el.textContent = ''; el.hidden = true; el.classList.remove('indice-visible'); }
        const has = Boolean(payload[`hasIndice${n}`]);
        [$(`h-btn-indice${n}`), $(`hp-btn-indice${n}`)].forEach(b => { if (b) b.disabled = !has; });
    });

    setText('h-resp-counter', '0 / ?');
    setHTML('h-reponses-live', '');

    [$('h-btn-reveal'), $('hp-btn-reveal')].forEach(btn => {
        if (btn) btn.textContent = '✅ Révéler la réponse (+2/+1/+0.5)';
    });
}

// ─────────────────────────────────────────────────────
// RENDER HOST — correction
// ─────────────────────────────────────────────────────

function renderHostCorrection(payload) {
    showHostPanel('host-correction-panel');

    setText('h-corr-theme',    payload.theme || '—');
    setText('h-corr-progress', `Q ${payload.posees} / ${payload.total ?? S.totalQuestionsJSON}`);
    setText('h-corr-question', payload.question);
    setText('h-corr-reponse',  `✅ ${payload.reponse}`);

    const container = $('h-corr-reponses');
    if (!container) return;

    if (!payload.reponses?.length) {
        container.innerHTML = '<p class="corr-empty">Aucune réponse reçue.</p>';
    } else {
        const medals = ['🥇', '🥈', '🥉'];
        let ci = 0;
        container.innerHTML = payload.reponses.map(r => {
            const cls      = r.correct ? 'correct' : 'incorrect';
            const medal    = r.correct ? (medals[ci++] || '✅') : '❌';
            const ptsEl    = r.correct
                ? `<span class="corr-pts">+${r.points}pt${r.points !== 1 ? 's' : ''}</span>`
                : '';
            const indEl    = r.indicesVus > 0
                ? `<span class="corr-indice">(${r.indicesVus} indice${r.indicesVus > 1 ? 's' : ''})</span>`
                : '';
            return `<div class="corr-row ${cls}">
                <span class="corr-medal">${medal}</span>
                <span class="corr-pseudo">${esc(r.pseudo)}</span>
                <span class="corr-texte">${esc(r.texte)}</span>
                ${indEl}${ptsEl}
            </div>`;
        }).join('');
    }

    const btnNext = $('h-btn-next-q');
    if (btnNext) {
        const isLast = payload.posees >= (payload.total ?? S.totalQuestionsJSON);
        btnNext.textContent = isLast ? '🏁 Voir les résultats finaux' : '➡ Question suivante';
    }
}

// ─────────────────────────────────────────────────────
// RENDER HOST — fin
// ─────────────────────────────────────────────────────

function renderHostFin(scores, total) {
    showHostPanel('host-fin-panel');
    hide('topbar-progress');
    setText('h-fin-total', `${total} question${total > 1 ? 's' : ''} posées`);

    const container = $('h-fin-scores');
    if (!container) return;

    const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const medals  = ['🥇', '🥈', '🥉'];

    container.innerHTML = entries.length
        ? entries.map(([nom, pts], i) => `
            <div class="podium-row ${i === 0 ? 'first' : ''}">
                <span class="podium-medal">${medals[i] || `${i + 1}.`}</span>
                <span class="podium-nom">${esc(nom)}</span>
                <span class="podium-pts">${pts} pt${pts !== 1 ? 's' : ''}</span>
            </div>`).join('')
        : '<p class="corr-empty">Aucun score enregistré.</p>';

    toast(`🏁 Quiz terminé — ${total} question${total > 1 ? 's' : ''} !`, 'success', 4000);
}

// ─────────────────────────────────────────────────────
// RENDER PLAYER — question
// ─────────────────────────────────────────────────────

function renderPlayerQuestion(payload) {
    S.aRepondu = false;
    renderPlayerTexte(payload);
}

function renderPlayerTexte(payload) {
    showPlayerPanel('player-texte-panel');

    setText('p-theme',         payload.theme    || '—');
    setText('p-progress',      `Q ${payload.posees} / ${payload.total ?? S.totalQuestionsJSON}`);
    setText('p-question-text', payload.question);

    _resetIndices('p-indice1', 'p-indice2');

    const input = $('p-answer-input');
    if (input) { input.value = ''; input.disabled = false; input.placeholder = 'Votre réponse…'; }

    const btn = $('p-btn-send');
    if (btn) { btn.disabled = false; btn.textContent = '✉️ Envoyer'; }

    show('p-texte-answer-zone');
    hide('p-texte-sent');

    // Supprimer l'ancien timer puis en recréer un
    const oldTimer = $('p-timer');
    if (oldTimer) oldTimer.remove();
    demarrerTimer();

    setTimeout(() => $('p-answer-input')?.focus(), 150);
}

function _resetIndices(id1, id2) {
    [id1, id2].forEach(id => {
        const el = $(id);
        if (!el) return;
        el.textContent = '';
        el.hidden = true;
        el.classList.remove('indice-visible');
    });
}

// ─────────────────────────────────────────────────────
// RENDER PLAYER — confirmation d'envoi
// ─────────────────────────────────────────────────────

function confirmerEnvoi(texte) {
    hide('p-texte-answer-zone');
    show('p-texte-sent');
    setHTML('p-texte-sent',
        `✅ Réponse envoyée : <strong>${esc(texte)}</strong>
         <br><small>En attente de la correction…</small>`
    );
    toast('Réponse envoyée !', 'success', 2000);
}

// ─────────────────────────────────────────────────────
// RENDER PLAYER — correction
// ─────────────────────────────────────────────────────

function renderPlayerCorrection(payload) {
    showPlayerPanel('player-correction-panel');

    setText('p-corr-theme',     payload.theme    || '—');
    setText('p-corr-question',  payload.question);
    setText('p-corr-bonne-rep', payload.reponse);

    const maReponse = payload.reponses?.find(r => r.pseudo === S.pseudo);
    const resultEl  = $('p-corr-result');
    if (!resultEl) return;

    if (!maReponse) {
        resultEl.className = 'corr-feedback corr-noAnswer';
        resultEl.innerHTML = "😶 Vous n'avez pas répondu à temps.";
    } else if (maReponse.correct) {
        const pts      = maReponse.points;
        const indLabel = maReponse.indicesVus > 0
            ? ` (avec ${maReponse.indicesVus} indice${maReponse.indicesVus > 1 ? 's' : ''})`
            : ' (sans indice 🎯)';
        resultEl.className = 'corr-feedback corr-correct';
        resultEl.innerHTML = `🎉 Bonne réponse ! <strong>+${pts} pt${pts !== 1 ? 's' : ''}</strong><span class="corr-indice-info">${indLabel}</span>`;
    } else {
        resultEl.className = 'corr-feedback corr-incorrect';
        resultEl.innerHTML = `❌ Mauvaise réponse. Vous avez écrit : <em>${esc(maReponse.texte)}</em>`;
    }
}

// ─────────────────────────────────────────────────────
// RENDER PLAYER — fin
// ─────────────────────────────────────────────────────

function renderPlayerFin(scores) {
    showPlayerPanel('player-fin-panel');
    hide('topbar-score');

    const entries   = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const medals    = ['🥇', '🥈', '🥉'];
    const container = $('p-fin-scores');
    if (!container) return;

    container.innerHTML = entries.map(([nom, pts], i) => {
        const isMe = nom === S.pseudo;
        return `<div class="result-row${i === 0 ? ' result-winner' : ''}${isMe ? ' result-me' : ''}">
            <span>${medals[i] || `${i + 1}.`}</span>
            <span class="result-nom">
                ${esc(nom)}
                ${isMe ? '<span class="badge-moi">MOI</span>' : ''}
            </span>
            <span class="result-pts">${pts} pt${pts !== 1 ? 's' : ''}</span>
        </div>`;
    }).join('');

    const bar = $('host-player-bar');
    if (bar) bar.hidden = true;

    toast('🏆 Résultats finaux !', 'success', 4000);
}

// ─────────────────────────────────────────────────────
// BANDEAU HOST-PLAYER
// ─────────────────────────────────────────────────────

function injecterBandeauHostPlayer() {
    const bandeau = document.createElement('div');
    bandeau.id = 'host-player-bar';
    bandeau.innerHTML = `
        <button id="hp-btn-next"    class="btn-primary btn-sm">➡ Suivant</button>
        <button id="hp-btn-indice1" class="btn-secondary btn-sm" disabled>💡 Indice 1</button>
        <button id="hp-btn-indice2" class="btn-secondary btn-sm" disabled>🔥 Indice 2</button>
        <button id="hp-btn-reveal"  class="btn-success btn-sm">✅ Révéler</button>
        <button id="hp-btn-skip"    class="btn-warning btn-sm">⏭ Passer</button>
    `;
    document.body.appendChild(bandeau);
    const vp = $('view-player');
    if (vp) vp.style.paddingBottom = '4.5rem';
}

// ─────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────

function updateScore(pts) {
    S.scoreLocal = pts;
    setText('pg-score-val', `${pts} pt${pts !== 1 ? 's' : ''}`);
}

function _majProgressLabel(posees, total) {
    setText('progress-label', `Q ${posees} / ${total}`);
}

// ─────────────────────────────────────────────────────
// INITIALISATION
// ─────────────────────────────────────────────────────

function init() {
    const params = new URLSearchParams(location.search);
    S.partieId   = params.get('partieId');
    S.pseudo     = params.get('pseudo');
    S.role       = params.get('role') || 'player';
    S.isHost     = S.role === 'host' || S.role === 'host-player';
    S.isPlayer   = S.role === 'player' || S.role === 'host-player';

    if (!S.partieId || !S.pseudo) {
        document.body.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:center;
                height:100vh;color:#f87171;font-size:1.1rem;text-align:center;padding:2rem;">
                ❌ Paramètres manquants.<br>
                <small style="opacity:.6;margin-top:.5rem;display:block;">
                    Utilisez le lien fourni par le host.
                </small>
            </div>`;
        return;
    }

    if (S.role === 'host') {
        show('view-host');
        hide('view-player');
        show('topbar-progress');
        hide('topbar-score');
        showHostPanel('host-idle');
    } else if (S.role === 'host-player') {
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

    setText('pg-pseudo', S.pseudo);

    $('btn-back')?.addEventListener('click', () => {
        if (confirm('Quitter le jeu ?'))
            window.location.href = S.isHost ? '/host/' : '/join/';
    });

    connectSocket();
    if (S.isHost)   initControlesHost();
    if (S.isPlayer) initControlesPlayer();
}

// ─────────────────────────────────────────────────────
// DÉMARRAGE
// ─────────────────────────────────────────────────────

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}