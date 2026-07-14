import { JeuRegistry } from './player.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const MotdepassePlayer = {
    _session: null,
    _socket: null,
    _timer: null,
    _answered: false,

    initPlayer(session, socket, gameState) {
        this._session = session;
        this._socket = socket;
        this._answered = false;
        this._renderWaiting();
        if (gameState) this._rehydrate(gameState);
    },

    destroy() {
        this._stopTimer();
        this._session = null;
        this._socket = null;
    },

    onWsEvent(event, payload) {
        if (event === 'MOTDEPASSE_ROUND_START') this._onRoundStart(payload);
        if (event === 'MOTDEPASSE_ANSWER_ACK') this._onAnswerAck(payload);
        if (event === 'MOTDEPASSE_REVELATION') this._onReveal(payload);
    },

    onScores() {},

    _send(action, data = {}) {
        this._socket?.send('PLAYER_ACTION', { action, data });
    },

    _renderWaiting() {
        const cont = $('jeu-contenu');
        if (!cont) return;
        cont.innerHTML = `
            <div class="motdepasse-player-card">
                <span class="motdepasse-player-icon">MDP</span>
                <h2>Mot de passe</h2>
                <p>En attente de la prochaine manche...</p>
            </div>`;
    },

    _onRoundStart(payload) {
        this._answered = false;
        const cont = $('jeu-contenu');
        if (!cont) return;
        cont.innerHTML = `
            <div class="motdepasse-player-card">
                <div class="motdepasse-round-top">
                    <span class="motdepasse-badge">Manche ${payload.manche}</span>
                    <div id="mdp-player-timer" class="motdepasse-timer">--</div>
                </div>
                <div class="motdepasse-indice">
                    <span>Indice</span>
                    <strong>${esc(payload.indice)}</strong>
                </div>
                <div class="motdepasse-player-form" id="mdp-player-form">
                    <input id="mdp-player-answer" type="text" maxlength="80" autocomplete="off" placeholder="Ton mot de passe...">
                    <button id="mdp-player-send" class="btn-primary">Envoyer</button>
                </div>
                <div id="mdp-player-status" class="motdepasse-muted"></div>
            </div>`;

        $('mdp-player-send')?.addEventListener('click', () => this._submit());
        $('mdp-player-answer')?.addEventListener('keydown', event => {
            if (event.key === 'Enter') this._submit();
        });
        setTimeout(() => $('mdp-player-answer')?.focus(), 100);
        this._startTimer(payload.endsAt);
    },

    _onAnswerAck(payload) {
        const status = $('mdp-player-status');
        if (payload.status === 'ok') {
            this._answered = true;
            const form = $('mdp-player-form');
            if (form) form.hidden = true;
            if (status) {
                status.innerHTML = `Réponse envoyée : <strong>${esc(payload.texte)}</strong>. En attente de la révélation.`;
            }
            return;
        }
        if (status) {
            const messages = {
                too_late: 'Temps écoulé.',
                empty: 'Écris une réponse avant d’envoyer.',
                already_answered: 'Tu as déjà répondu.',
            };
            status.textContent = messages[payload.status] || 'Réponse refusée.';
        }
    },

    _onReveal(payload) {
        this._stopTimer();
        const cont = $('jeu-contenu');
        if (!cont) return;
        const mine = (payload.reponses || []).find(r => r.pseudo === this._session?.pseudo);
        const result = mine
            ? mine.correct
                ? `<div class="motdepasse-result is-correct">Correct : +${mine.points || 0} pt${(mine.points || 0) > 1 ? 's' : ''}</div>`
                : `<div class="motdepasse-result">Réponse envoyée : ${esc(mine.texte)}. +0 pt</div>`
            : '<div class="motdepasse-result">Tu n’as pas répondu à temps. +0 pt</div>';

        cont.innerHTML = `
            <div class="motdepasse-player-card">
                <div class="motdepasse-reveal">
                    <span class="motdepasse-badge">Révélation</span>
                    <p>Mot secret</p>
                    <h2>${esc(payload.mot)}</h2>
                </div>
                ${result}
                <p class="motdepasse-muted">En attente de la manche suivante...</p>
            </div>`;
    },

    _submit() {
        if (this._answered) return;
        const input = $('mdp-player-answer');
        const texte = input?.value?.trim() || '';
        if (!texte) {
            const status = $('mdp-player-status');
            if (status) status.textContent = 'Écris une réponse avant d’envoyer.';
            return;
        }
        const btn = $('mdp-player-send');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Envoi...';
        }
        this._send('motdepasse:answer', { texte });
    },

    _rehydrate(gameState) {
        if (gameState.phase === 'round') {
            this._onRoundStart(gameState);
            if (gameState.maReponse) this._onAnswerAck({ status: 'ok', texte: gameState.maReponse.texte });
        } else if (gameState.phase === 'reveal') {
            this._onReveal(gameState);
        }
    },

    _startTimer(endsAt) {
        this._stopTimer();
        const tick = () => {
            const left = Math.max(0, Math.ceil((Number(endsAt) - Date.now()) / 1000));
            const el = $('mdp-player-timer');
            if (el) el.textContent = `${left}s`;
            if (left <= 0) {
                this._stopTimer();
                const input = $('mdp-player-answer');
                const btn = $('mdp-player-send');
                if (input) input.disabled = true;
                if (btn) {
                    btn.disabled = true;
                    btn.textContent = 'Temps écoulé';
                }
            }
        };
        tick();
        this._timer = setInterval(tick, 250);
    },

    _stopTimer() {
        if (this._timer) clearInterval(this._timer);
        this._timer = null;
    },
};

JeuRegistry.register('motdepasse', MotdepassePlayer);
