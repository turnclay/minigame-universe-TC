const $ = id => document.getElementById(id);
const esc = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const MotdepasseHote = {
    _socket: null,
    _state: null,
    _timer: null,

    init(socket) {
        this._socket = socket;
        this._state = { phase: 'idle', manche: 0 };
        this._renderIdle();
    },

    destroy() {
        this._stopTimer();
        this._socket = null;
        this._state = null;
    },

    onWsEvent(event, payload) {
        if (event === 'MOTDEPASSE_ROUND_START') this._onRoundStart(payload);
        if (event === 'MOTDEPASSE_ANSWER_IN') this._onAnswerIn(payload);
        if (event === 'MOTDEPASSE_REVELATION') this._onReveal(payload);
    },

    onScores() {},

    _send(action, data = {}) {
        this._socket?.send('HOST_ACTION', { action, data });
    },

    _container() {
        return $('motdepasse-contenu') || $('motdepasse');
    },

    _renderIdle() {
        const cont = this._container();
        if (!cont) return;
        cont.innerHTML = `
            <div class="motdepasse-panel">
                <div class="motdepasse-header">
                    <span class="motdepasse-badge">Mot de passe</span>
                    <h2>Préparer une manche</h2>
                    <p>Choisis un mot secret et un indice. Les joueurs doivent retrouver exactement le mot.</p>
                </div>

                <div class="motdepasse-form">
                    <label>
                        Mot secret
                        <input id="mdp-host-mot" type="text" maxlength="80" autocomplete="off" placeholder="Ex: volcan">
                    </label>
                    <label>
                        Indice visible par tous
                        <input id="mdp-host-indice" type="text" maxlength="140" autocomplete="off" placeholder="Ex: Il peut dormir pendant des siècles">
                    </label>
                    <label>
                        Durée
                        <select id="mdp-host-duration">
                            <option value="30">30 secondes</option>
                            <option value="60" selected>60 secondes</option>
                            <option value="90">90 secondes</option>
                            <option value="120">120 secondes</option>
                        </select>
                    </label>
                </div>

                <div class="motdepasse-actions">
                    <button id="mdp-btn-start" class="btn-primary">Lancer la manche</button>
                    <button id="mdp-btn-random" class="btn-secondary">Mot aléatoire</button>
                </div>
            </div>`;

        $('mdp-btn-start')?.addEventListener('click', () => {
            this._send('motdepasse:start', {
                mot: $('mdp-host-mot')?.value || '',
                indice: $('mdp-host-indice')?.value || '',
                duration: Number($('mdp-host-duration')?.value || 60),
            });
        });

        $('mdp-btn-random')?.addEventListener('click', () => {
            this._send('motdepasse:start', {
                mot: '',
                indice: $('mdp-host-indice')?.value || '',
                duration: Number($('mdp-host-duration')?.value || 60),
            });
        });
    },

    _onRoundStart(payload) {
        this._state = { ...payload, phase: 'round', answeredCount: 0 };
        const cont = this._container();
        if (!cont) return;
        cont.innerHTML = `
            <div class="motdepasse-panel">
                <div class="motdepasse-round-top">
                    <span class="motdepasse-badge">Manche ${payload.manche}</span>
                    <div id="mdp-host-timer" class="motdepasse-timer">--</div>
                </div>
                <div class="motdepasse-indice">
                    <span>Indice</span>
                    <strong>${esc(payload.indice)}</strong>
                </div>
                <div class="motdepasse-progress">
                    <div id="mdp-host-progress-text">0 / ${(payload.joueurs || []).length} réponses</div>
                    <div class="motdepasse-progress-bar"><div id="mdp-host-progress-fill"></div></div>
                </div>
                <div id="mdp-host-answers" class="motdepasse-answer-list"></div>
                <div class="motdepasse-actions">
                    <button id="mdp-btn-reveal" class="btn-primary">Révéler</button>
                    <button id="mdp-btn-new" class="btn-secondary">Nouvelle manche</button>
                </div>
            </div>`;

        $('mdp-btn-reveal')?.addEventListener('click', () => this._send('motdepasse:reveal'));
        $('mdp-btn-new')?.addEventListener('click', () => this._renderIdle());
        this._updateProgress();
        this._startTimer(payload.endsAt);
    },

    _onAnswerIn(payload) {
        if (!this._state) return;
        this._state.answeredCount = payload.answeredCount || 0;
        this._updateProgress();
    },

    _onReveal(payload) {
        this._stopTimer();
        this._state = { ...payload, phase: 'reveal' };
        const cont = this._container();
        if (!cont) return;
        const rows = (payload.reponses || []).map(r => `
            <div class="motdepasse-answer-row ${r.correct ? 'is-correct' : ''}">
                <span>${esc(r.pseudo)}</span>
                <strong>${esc(r.texte || '-')}</strong>
                <em>${r.points || 0} pt${(r.points || 0) > 1 ? 's' : ''}</em>
            </div>`).join('');

        cont.innerHTML = `
            <div class="motdepasse-panel">
                <div class="motdepasse-reveal">
                    <span class="motdepasse-badge">Révélation</span>
                    <p>Mot secret</p>
                    <h2>${esc(payload.mot)}</h2>
                </div>
                <div class="motdepasse-answer-list">${rows || '<p class="motdepasse-muted">Aucune réponse reçue.</p>'}</div>
                <div class="motdepasse-actions">
                    <button id="mdp-btn-next" class="btn-primary">Manche suivante</button>
                </div>
            </div>`;

        $('mdp-btn-next')?.addEventListener('click', () => this._renderIdle());
    },

    _updateProgress() {
        const total = this._state?.joueurs?.length || 0;
        const count = this._state?.answeredCount || this._state?.answered?.length || 0;
        const text = $('mdp-host-progress-text');
        const fill = $('mdp-host-progress-fill');
        if (text) text.textContent = `${count} / ${total} réponses`;
        if (fill) fill.style.width = `${total ? Math.min(100, (count / total) * 100) : 0}%`;
    },

    _startTimer(endsAt) {
        this._stopTimer();
        const tick = () => {
            const left = Math.max(0, Math.ceil((Number(endsAt) - Date.now()) / 1000));
            const el = $('mdp-host-timer');
            if (el) el.textContent = `${left}s`;
            if (left <= 0) this._stopTimer();
        };
        tick();
        this._timer = setInterval(tick, 250);
    },

    _stopTimer() {
        if (this._timer) clearInterval(this._timer);
        this._timer = null;
    },
};
