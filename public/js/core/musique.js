// /js/core/musique.js
// Contrôleur de musique global et persistant

const Musique = {
    _audio: null,
    _volume: 0.4,
    _muted: false,
    _initDone: false,
    _storageKey: 'mgu_music_state', // minigame_universal_music_state

    init() {
        if (this._initDone) return;
        this._initDone = true;

        this._audio = document.getElementById('bg-music');
        if (!this._audio) {
            console.warn('[MUSIQUE] Élément #bg-music non trouvé.');
            return;
        }

        this._loadState();
        this._audio.volume = this._volume;
        this._audio.muted = this._muted;

        // Tenter de jouer la musique. Si autoplay bloqué, on gère au premier clic.
        this._audio.play().catch(e => {
            console.log('[MUSIQUE] Autoplay bloqué, attend le premier geste utilisateur.', e.message);
            document.body.addEventListener('click', this._handleFirstInteraction.bind(this), { once: true });
            document.body.addEventListener('keydown', this._handleFirstInteraction.bind(this), { once: true });
        });

        // Synchronisation entre onglets/fenêtres
        window.addEventListener('storage', this._handleStorageChange.bind(this));
        console.log(`[MUSIQUE] Initialisé. Volume: ${this._volume}, Muted: ${this._muted}`);
    },

    _handleFirstInteraction() {
        if (this._audio.paused && !this._muted) {
            this._audio.play().catch(e => console.warn('[MUSIQUE] Échec lecture après interaction:', e.message));
        }
    },

    _loadState() {
        try {
            const savedState = JSON.parse(localStorage.getItem(this._storageKey));
            if (savedState) {
                if (typeof savedState.volume === 'number') this._volume = savedState.volume;
                if (typeof savedState.muted === 'boolean') this._muted = savedState.muted;
            }
        } catch (e) {
            console.warn('[MUSIQUE] Erreur lecture état localStorage:', e);
        }
    },

    _saveState() {
        try {
            localStorage.setItem(this._storageKey, JSON.stringify({
                volume: this._volume,
                muted: this._muted,
            }));
        } catch (e) {
            console.warn('[MUSIQUE] Erreur écriture état localStorage:', e);
        }
    },

    _handleStorageChange(event) {
        if (event.key === this._storageKey && event.newValue) {
            const newState = JSON.parse(event.newValue);
            if (newState.muted !== this._muted) {
                this._muted = newState.muted;
                if (this._audio) {
                    this._audio.muted = this._muted;
                    if (!this._muted && this._audio.paused) {
                        this._audio.play().catch(e => console.warn('[MUSIQUE] Échec lecture après synchro:', e.message));
                    }
                }
                this._updateBoundButtons();
            }
            if (newState.volume !== this._volume) {
                this._volume = newState.volume;
                if (this._audio) this._audio.volume = this._volume;
            }
            console.log('[MUSIQUE] État synchronisé via storage event.');
        }
    },

    toggleMute() {
        if (!this._audio) return;
        this._muted = !this._muted;
        this._audio.muted = this._muted;
        this._saveState();
        this._updateBoundButtons();
        console.log('[MUSIQUE] Mute basculé:', this._muted);
    },

    setVolume(vol) {
        if (!this._audio) return;
        this._volume = Math.max(0, Math.min(1, vol));
        this._audio.volume = this._volume;
        this._saveState();
        console.log('[MUSIQUE] Volume défini:', this._volume);
    },

    get isMuted() {
        return this._muted;
    },

    get currentVolume() {
        return this._volume;
    },

    // ----------------------------------------------------------
    // Gestion des boutons liés (UI)
    // ----------------------------------------------------------
    _boundButtons: new Map(), // Map<elementId, { element, options }>

    bindBouton(elementId, options = {}) {
        const el = document.getElementById(elementId);
        if (!el) {
            console.warn(`[MUSIQUE] Bouton #${elementId} non trouvé pour le bind.`);
            return;
        }

        // Supprimer l'ancien listener si déjà lié
        const existing = this._boundButtons.get(elementId);
        if (existing) {
            existing.element.removeEventListener('click', existing.handler);
        }

        const handler = () => this.toggleMute();
        el.addEventListener('click', handler);
        this._boundButtons.set(elementId, { element: el, options, handler });
        this._updateButton(el, options);
        console.log(`[MUSIQUE] Bouton #${elementId} lié.`);
    },

    _updateBoundButtons() {
        this._boundButtons.forEach(({ element, options }) => {
            this._updateButton(element, options);
        });
    },

    _updateButton(el, options) {
        if (!el) return;
        const { on, off, classeOn, classeOff } = options;

        // Gérer le texte/icône
        if (on && off) {
            el.textContent = this._muted ? off : on;
        }

        // Gérer les classes
        if (classeOn && classeOff) {
            el.classList.toggle(classeOn, !this._muted);
            el.classList.toggle(classeOff, this._muted);
        } else if (classeOn) { // Si seule classeOn est définie, on l'active/désactive
            el.classList.toggle(classeOn, !this._muted);
        }

        // Gérer aria-pressed pour l'accessibilité
        el.setAttribute('aria-pressed', !this._muted);
    }
};

export default Musique;