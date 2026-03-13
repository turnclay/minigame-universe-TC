// ======================================================
// 🎮 public/js/games/quiz-client.js
// Client Quiz — Host & Player — MiniGame Universe v4.1
// ======================================================
//
// PARAMÈTRES URL :
//   ?partieId=xxx  — ID de la partie (obligatoire)
//   ?pseudo=yyy    — Pseudo du joueur (obligatoire)
//   ?role=host|player|host-player
//
// RÔLES :
//   host        → voit uniquement l'interface de contrôle
//   player      → voit uniquement l'interface de réponse
//   host-player → voit l'interface joueur + bandeau de contrôle flottant
//
// DÉPENDANCES :
//   /js/core/socket.js  → GameSocket
// ======================================================

import { GameSocket } from '../core/socket.js';

// ─────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────

const S = {
    partieId : null,
    pseudo   : null,
    equipe   : null,
    role     : 'player',
    isHost   : false,
    isPlayer : false,

    // Quiz
    questionEnCours  : null,
    aRepondu         : false,
    choixSelectionne : null,
    scoreLocal       : 0,
};

// ─────────────────────────────────────────────────────
// DOM HELPERS
// ─────────────────────────────────────────────────────

const $  = id  => document.getElementById(id);
const show = id => { const e = $(id); if (e) e.hidden = false; };
const hide = id => { const e = $(id); if (e) e.hidden = true; };

function setText(id, txt) {
    const e = $(id);
    if (e) e.textContent = txt;
}

function esc(s) {
    return String(s || '')
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;');
}

// Panneaux host et player — un seul visible à la fois
const HOST_PANELS   = ['host-idle','host-question-panel','host-correction-panel','host-fin-panel'];
const PLAYER_PANELS = ['player-waiting','player-texte-panel','player-qcm-panel','player-correction-panel','player-fin-panel'];

function showHostPanel(id)   {
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

const LETTRES = ['A','B','C','D','E','F'];

// ─────────────────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────────────────

function toast(msg, type = 'info', duration = 3000) {
    const COLORS = { success:'#22c55e', error:'#ef4444', warning:'#f59e0b', info:'#00d4ff' };
    const ICONS  = { success:'✅', error:'❌', warning:'⚠️', info:'ℹ️' };

    let c = $('toast-container');
    if (!c) {
        c = document.createElement('div');
        c.id = 'toast-container';
        c.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:9999;display:flex;flex-direction:column;gap:.4rem;max-width:310px;pointer-events:none;';
        document.body.appendChild(c);
    }

    const el = document.createElement('div');
    el.style.cssText = [
        'display:flex;gap:.5rem;align-items:flex-start',
        'padding:.65rem .9rem;border-radius:8px',
        `background:#1e1e2e;color:#fff;border-left:3px solid ${COLORS[type] || COLORS.info}`,
        'box-shadow:0 4px 16px rgba(0,0,0,.5)',
        'opacity:0;transition:opacity .2s,transform .2s;transform:translateX(12px)',
        'font-size:.88rem;pointer-events:auto;',
    ].join(';');
    el.innerHTML = `<span style="flex-shrink:0">${ICONS[type] || 'ℹ️'}</span><span>${esc(msg)}</span>`;
    c.appendChild(el);

    requestAnimationFrame(() => { el.style.opacity='1'; el.style.transform='translateX(0)'; });
    setTimeout(() => {
        el.style.opacity='0'; el.style.transform='translateX(8px)';
        setTimeout(() => el.remove(), 220);
    }, duration);
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
            // Rôle host pur : authentification + rejoin
            socket.send('HOST_AUTH', {});
        } else {
            // Rôle player ou host-player : rejoindre comme joueur
            socket.send('PLAYER_REJOIN', { partieId: S.partieId, pseudo: S.pseudo });
            if (S.isHost) {
                // En plus, s'authentifier en tant que host (délai pour ordre garanti)
                setTimeout(() => socket.send('HOST_AUTH', {}), 200);
            }
        }
    });

    socket.on('__disconnected__', () => {
        show('disconnect-banner');
    });

    // ── Auth host ─────────────────────────────────────
    socket.on('AUTH_OK', () => {
        if (S.isHost) socket.send('HOST_REJOIN', { partieId: S.partieId });
    });

    socket.on('HOST_REJOINED', ({ snapshot }) => {
        toast('Reconnecté comme host ✅', 'success', 2000);
        if (snapshot?.scores?.[S.pseudo] !== undefined) {
            updateScore(snapshot.scores[S.pseudo]);
        }
    });

    // ── Rejoindre comme joueur ────────────────────────
    socket.on('REJOIN_OK', ({ equipe, snapshot }) => {
        S.equipe = equipe;
        updateScore(snapshot?.scores?.[S.pseudo] || 0);
        toast(`Reconnecté : ${S.pseudo}`, 'success', 2000);
    });

    socket.on('JOIN_ERROR', ({ code }) => {
        const msgs = {
            GAME_NOT_FOUND   : 'Partie introuvable.',
            PLAYER_NOT_FOUND : 'Vous n\'êtes plus dans cette partie.',
        };
        toast(msgs[code] || `Erreur connexion : ${code}`, 'error', 5000);
    });

    // ── Événements Quiz ───────────────────────────────

    socket.on('QUIZ_READY', ({ total, message }) => {
        setText('host-idle-total', `${total} questions chargées`);
        setText('progress-label', `Q 0/${total}`);
        toast(message || 'Quiz prêt !', 'info', 2500);
    });

    socket.on('QUIZ_QUESTION', (payload) => {
        S.questionEnCours  = payload;
        S.aRepondu         = false;
        S.choixSelectionne = null;
        setText('progress-label', `Q ${payload.idx + 1} / ${payload.total}`);

        if (S.isHost)   renderHostQuestion(payload);
        if (S.isPlayer) renderPlayerQuestion(payload);
    });

    // Réponse d'un joueur notifiée au host
    socket.on('QUIZ_RESPONSE_IN', ({ pseudo, nbReponses, nbJoueurs, allAnswered }) => {
        const counter = $('h-resp-counter');
        if (counter) counter.textContent = `${nbReponses} / ${nbJoueurs ?? '?'}`;

        const chips = $('h-reponses-live');
        if (chips && !chips.querySelector(`[data-p="${CSS.escape(pseudo)}"]`)) {
            const chip = document.createElement('span');
            chip.className = 'resp-chip';
            chip.dataset.p = pseudo;
            chip.textContent = pseudo;
            chips.appendChild(chip);
        }

        if (allAnswered) toast('Tous les joueurs ont répondu ! 🎉', 'success', 2500);
    });

    // Accusé de réception d'une réponse
    socket.on('QUIZ_ANSWER_ACK', ({ status, texte }) => {
        if (status === 'ok') {
            S.aRepondu = true;
            confirmerEnvoi(texte);
        } else if (status === 'already_answered') {
            toast('Vous avez déjà répondu.', 'warning');
        } else if (status === 'too_late') {
            toast('Trop tard — la correction est affichée.', 'warning');
        } else if (status === 'invalid') {
            toast('Réponse invalide.', 'error');
        }
    });

    // Indice révélé par le host
    socket.on('QUIZ_INDICE', ({ num, texte }) => {
        if (S.isHost) {
            const el = $(`h-indice${num}`);
            if (el) { el.textContent = texte; el.hidden = false; el.classList.add('indice-visible'); }
        }
        if (S.isPlayer) {
            [`p-indice${num}`, `p-qcm-indice${num}`].forEach(id => {
                const el = $(id);
                if (el) { el.textContent = texte; el.hidden = false; el.classList.add('indice-visible'); }
            });
            toast(`💡 Indice ${num} : ${texte}`, 'info', 5000);
        }
    });

    // Correction révélée
    socket.on('QUIZ_CORRECTION', (payload) => {
        if (S.isHost)   renderHostCorrection(payload);
        if (S.isPlayer) renderPlayerCorrection(payload);
    });

    // Fin du quiz
    socket.on('QUIZ_END', ({ scores, total }) => {
        if (S.isHost)   renderHostFin(scores, total);
        if (S.isPlayer) renderPlayerFin(scores);
    });

    // Mise à jour des scores en cours de partie
    socket.on('SCORES_UPDATE', ({ scores }) => {
        updateScore(scores?.[S.pseudo] || 0);
    });

    // Fin de partie globale (HOST_END_GAME)
    socket.on('GAME_ENDED', () => {
        toast('La partie est terminée.', 'info', 4000);
        setTimeout(() => {
            window.location.href = S.isHost ? '/host/' : '/join/';
        }, 3000);
    });

    // Expulsion
    socket.on('KICKED', () => {
        toast('Vous avez été expulsé de la partie.', 'error', 5000);
        setTimeout(() => { window.location.href = '/join/'; }, 2500);
    });

    // Host déconnecté
    socket.on('HOST_DISCONNECTED', () => {
        toast('Le host s\'est déconnecté.', 'warning', 6000);
        show('disconnect-banner');
    });

    // Erreurs
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

    function lancerQuestion() {
        socket.send('HOST_ACTION', { action: 'quiz:next_question', data: {} });
    }
    function reveler() {
        socket.send('HOST_ACTION', { action: 'quiz:reveal', data: {} });
    }
    function passer() {
        if (confirm('Passer cette question sans attribuer de points ?')) {
            socket.send('HOST_ACTION', { action: 'quiz:skip', data: {} });
        }
    }
    function revelerIndice(num) {
        if (!S.questionEnCours) return;
        if (!S.questionEnCours[`indice${num}`]) {
            toast(`Pas d'indice ${num} pour cette question.`, 'warning'); return;
        }
        socket.send('HOST_ACTION', { action: 'quiz:reveal_indice', data: { num } });
    }
    function terminerPartie() {
        if (confirm('Terminer la partie pour tous les joueurs ?')) {
            socket.send('HOST_END_GAME', {});
        }
    }

    // Bouton "Question suivante" (panel idle + correction + bandeau)
    ['host-btn-next', 'h-btn-next-q', 'hp-btn-next'].forEach(id =>
        $(id)?.addEventListener('click', lancerQuestion)
    );
    // Révéler
    ['h-btn-reveal', 'hp-btn-reveal'].forEach(id =>
        $(id)?.addEventListener('click', reveler)
    );
    // Passer
    ['h-btn-skip', 'hp-btn-skip'].forEach(id =>
        $(id)?.addEventListener('click', passer)
    );
    // Indices
    ['h-btn-indice1', 'hp-btn-indice1'].forEach(id =>
        $(id)?.addEventListener('click', () => revelerIndice(1))
    );
    ['h-btn-indice2', 'hp-btn-indice2'].forEach(id =>
        $(id)?.addEventListener('click', () => revelerIndice(2))
    );
    // Terminer
    ['h-btn-end-quiz', 'h-fin-end'].forEach(id =>
        $(id)?.addEventListener('click', terminerPartie)
    );
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
    if (S.aRepondu) return;

    const input = $('p-answer-input');
    const texte = input?.value.trim();

    if (!texte) { toast('Écrivez votre réponse avant d\'envoyer.', 'warning'); return; }

    const btn = $('p-btn-send');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Envoi…'; }

    socket.send('PLAYER_ACTION', { action: 'quiz:answer', data: { texte } });
}

function envoyerQCM(choix) {
    if (S.aRepondu) return;
    S.choixSelectionne = choix;
    S.aRepondu = true;

    document.querySelectorAll('.btn-choix').forEach(btn => {
        btn.disabled = true;
        if (btn.dataset.val === choix) btn.classList.add('selected');
    });

    socket.send('PLAYER_ACTION', { action: 'quiz:answer', data: { texte: choix } });
}

// ─────────────────────────────────────────────────────
// RENDER HOST — question
// ─────────────────────────────────────────────────────

function renderHostQuestion(payload) {
    showHostPanel('host-question-panel');

    setText('h-theme',         payload.theme    || '—');
    setText('h-progress',      `Q ${payload.idx + 1} / ${payload.total}`);
    setText('h-question-text', payload.question);

    const typeBadge = $('h-type-badge');
    if (typeBadge) {
        typeBadge.textContent = payload.type === 'qcm' ? '🔵 QCM' : '✍️ Texte libre';
        typeBadge.dataset.type = payload.type;
    }

    // Indices : afficher le conteneur, masquer le texte jusqu'à la révélation
    ['h-indice1','h-indice2'].forEach((id, i) => {
        const el = $(id);
        if (!el) return;
        const texte = payload[`indice${i + 1}`];
        el.textContent = texte || '';
        el.hidden = true;
        el.classList.remove('indice-visible');
    });

    // Boutons indices : actifs seulement si l'indice existe
    const btn1 = $('h-btn-indice1'), btn2 = $('h-btn-indice2');
    const hp1  = $('hp-btn-indice1'), hp2 = $('hp-btn-indice2');
    if (btn1) btn1.disabled = !payload.indice1;
    if (btn2) btn2.disabled = !payload.indice2;
    if (hp1)  hp1.disabled  = !payload.indice1;
    if (hp2)  hp2.disabled  = !payload.indice2;

    // Compteur de réponses
    const counter = $('h-resp-counter');
    if (counter) counter.textContent = '0 / ?';
    const chips = $('h-reponses-live');
    if (chips) chips.innerHTML = '';

    // Label du bouton révéler avec les points
    const pts = payload.points ?? 1;
    [$('h-btn-reveal'), $('hp-btn-reveal')].forEach(btn => {
        if (btn) btn.textContent = `✅ Révéler la réponse (${pts} pt${pts > 1 ? 's' : ''})`;
    });
}

// ─────────────────────────────────────────────────────
// RENDER HOST — correction
// ─────────────────────────────────────────────────────

function renderHostCorrection(payload) {
    showHostPanel('host-correction-panel');

    setText('h-corr-theme',    payload.theme || '—');
    setText('h-corr-progress', `Q ${payload.idx + 1} / ${payload.total}`);
    setText('h-corr-question', payload.question);
    setText('h-corr-reponse',  `✅ ${payload.reponse}`);

    const container = $('h-corr-reponses');
    if (!container) return;

    if (!payload.reponses?.length) {
        container.innerHTML = '<p class="corr-empty">Aucune réponse reçue.</p>';
    } else {
        const medals = ['🥇','🥈','🥉'];
        let correctCount = 0;

        container.innerHTML = payload.reponses.map(r => {
            const cls   = r.correct ? 'correct' : 'incorrect';
            const medal = r.correct ? (medals[correctCount++] || '✅') : '❌';
            const ptsEl = r.correct
                ? `<span class="corr-pts">+${payload.points}pt${payload.points > 1 ? 's' : ''}</span>`
                : '';
            return `<div class="corr-row ${cls}">
                <span class="corr-medal">${medal}</span>
                <span class="corr-pseudo">${esc(r.pseudo)}</span>
                <span class="corr-texte">${esc(r.texte)}</span>
                ${ptsEl}
            </div>`;
        }).join('');
    }

    // Adapter le label "Suivant"
    const btnNext = $('h-btn-next-q');
    if (btnNext) {
        const isLast = (payload.idx + 1 >= payload.total);
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
    const medals  = ['🥇','🥈','🥉'];

    container.innerHTML = entries.map(([nom, pts], i) => `
        <div class="podium-row ${i === 0 ? 'first' : ''}">
            <span class="podium-medal">${medals[i] || `${i + 1}.`}</span>
            <span class="podium-nom">${esc(nom)}</span>
            <span class="podium-pts">${pts} pts</span>
        </div>`).join('');

    toast(`🏁 Quiz terminé ! ${total} question${total > 1 ? 's' : ''}.`, 'success', 4000);
}

// ─────────────────────────────────────────────────────
// RENDER PLAYER — question (aiguillage texte / qcm)
// ─────────────────────────────────────────────────────

function renderPlayerQuestion(payload) {
    S.aRepondu         = false;
    S.choixSelectionne = null;

    if (payload.type === 'qcm') {
        renderPlayerQCM(payload);
    } else {
        renderPlayerTexte(payload);
    }
}

function renderPlayerTexte(payload) {
    showPlayerPanel('player-texte-panel');

    setText('p-theme',         payload.theme || '—');
    setText('p-progress',      `Q ${payload.idx + 1} / ${payload.total}`);
    setText('p-question-text', payload.question);

    _resetIndices('p-indice1', 'p-indice2');

    const input = $('p-answer-input');
    if (input) input.value = '';

    const btn = $('p-btn-send');
    if (btn) { btn.disabled = false; btn.textContent = '✉️ Envoyer ma réponse'; }

    show('p-texte-answer-zone');
    hide('p-texte-sent');

    setTimeout(() => $('p-answer-input')?.focus(), 150);
}

function renderPlayerQCM(payload) {
    showPlayerPanel('player-qcm-panel');

    setText('p-qcm-theme',    payload.theme || '—');
    setText('p-qcm-progress', `Q ${payload.idx + 1} / ${payload.total}`);
    setText('p-qcm-question', payload.question);

    _resetIndices('p-qcm-indice1', 'p-qcm-indice2');

    hide('p-qcm-sent');

    const container = $('p-qcm-choix');
    if (!container) return;

    container.innerHTML = (payload.choix || []).map((choix, i) => `
        <button class="btn-choix" data-val="${esc(choix)}">
            <span class="choix-lettre">${LETTRES[i] || i + 1}</span>
            <span class="choix-texte">${esc(choix)}</span>
        </button>`).join('');

    container.querySelectorAll('.btn-choix').forEach(btn => {
        btn.addEventListener('click', () => envoyerQCM(btn.dataset.val));
    });
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
// RENDER PLAYER — confirmation envoi
// ─────────────────────────────────────────────────────

function confirmerEnvoi(texte) {
    const q = S.questionEnCours;
    if (!q) return;

    if (q.type === 'qcm') {
        document.querySelectorAll('.btn-choix').forEach(btn => btn.disabled = true);
        show('p-qcm-sent');
        const sent = $('p-qcm-sent');
        if (sent) sent.innerHTML = `✅ Votre choix : <strong>${esc(texte)}</strong><br><small>En attente de la correction…</small>`;
    } else {
        hide('p-texte-answer-zone');
        show('p-texte-sent');
        const sent = $('p-texte-sent');
        if (sent) sent.innerHTML = `✅ Votre réponse : <strong>${esc(texte)}</strong><br><small>En attente de la correction…</small>`;
    }

    toast('Réponse envoyée !', 'success', 2000);
}

// ─────────────────────────────────────────────────────
// RENDER PLAYER — correction
// ─────────────────────────────────────────────────────

function renderPlayerCorrection(payload) {
    // Pour QCM : montrer brièvement la couleur sur les boutons avant de switcher
    if (payload.type === 'qcm') {
        document.querySelectorAll('.btn-choix').forEach(btn => {
            btn.disabled = true;
            if (btn.dataset.val === payload.reponse) {
                btn.classList.add('correct');
            } else if (btn.dataset.val === S.choixSelectionne) {
                btn.classList.add('incorrect');
            }
        });
        setTimeout(() => _afficherCorrectionPlayer(payload), 800);
    } else {
        _afficherCorrectionPlayer(payload);
    }
}

function _afficherCorrectionPlayer(payload) {
    showPlayerPanel('player-correction-panel');

    setText('p-corr-theme',    payload.theme || '—');
    setText('p-corr-question', payload.question);
    setText('p-corr-bonne-rep', payload.reponse);

    const maReponse = payload.reponses?.find(r => r.pseudo === S.pseudo);
    const resultEl  = $('p-corr-result');
    if (!resultEl) return;

    if (!maReponse) {
        resultEl.className = 'corr-feedback corr-noAnswer';
        resultEl.innerHTML = '😶 Vous n\'avez pas répondu à temps.';
    } else if (maReponse.correct) {
        resultEl.className = 'corr-feedback corr-correct';
        resultEl.innerHTML = `🎉 Bonne réponse ! <strong>+${payload.points} pt${payload.points > 1 ? 's' : ''}</strong>`;
    } else {
        resultEl.className = 'corr-feedback corr-incorrect';
        resultEl.innerHTML = `❌ Votre réponse : <em>${esc(maReponse.texte)}</em>`;
    }
}

// ─────────────────────────────────────────────────────
// RENDER PLAYER — fin
// ─────────────────────────────────────────────────────

function renderPlayerFin(scores) {
    showPlayerPanel('player-fin-panel');
    hide('topbar-score');

    const entries  = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const medals   = ['🥇','🥈','🥉'];
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
            <span class="result-pts">${pts} pts</span>
        </div>`;
    }).join('');

    // Masquer le bandeau host-player si présent
    const bar = $('host-player-bar');
    if (bar) bar.hidden = true;

    toast('🏆 Résultats finaux !', 'success', 4000);
}

// ─────────────────────────────────────────────────────
// BANDEAU HOST-PLAYER (flottant en bas, rôle hybrid)
// ─────────────────────────────────────────────────────

function injecterBandeauHostPlayer() {
    const bandeau = document.createElement('div');
    bandeau.id = 'host-player-bar';
    bandeau.innerHTML = `
        <button id="hp-btn-next"    class="btn-primary btn-sm">➡ Question suivante</button>
        <button id="hp-btn-indice1" class="btn-secondary btn-sm" disabled>💡 Indice 1</button>
        <button id="hp-btn-indice2" class="btn-secondary btn-sm" disabled>🔥 Indice 2</button>
        <button id="hp-btn-reveal"  class="btn-success btn-sm">✅ Révéler</button>
        <button id="hp-btn-skip"    class="btn-warning btn-sm">⏭ Passer</button>
    `;
    document.body.appendChild(bandeau);

    // Padding bas pour que le contenu ne soit pas caché par le bandeau
    const viewPlayer = $('view-player');
    if (viewPlayer) viewPlayer.style.paddingBottom = '4.5rem';
}

// ─────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────

function updateScore(pts) {
    S.scoreLocal = pts;
    setText('pg-score-val', `${pts} pt${pts > 1 ? 's' : ''}`);
}

// ─────────────────────────────────────────────────────
// INITIALISATION
// ─────────────────────────────────────────────────────

function init() {
    const params = new URLSearchParams(location.search);
    S.partieId = params.get('partieId');
    S.pseudo   = params.get('pseudo');
    S.role     = params.get('role') || 'player';
    S.isHost   = S.role === 'host' || S.role === 'host-player';
    S.isPlayer = S.role === 'player' || S.role === 'host-player';

    // Validation des paramètres obligatoires
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

    // Affichage selon le rôle
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

    // Pseudo dans la topbar
    setText('pg-pseudo', S.pseudo);

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
// DÉMARRAGE
// ─────────────────────────────────────────────────────

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}