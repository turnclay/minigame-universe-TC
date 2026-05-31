// ============================================================
// /js/modules/puissance4_player.js — v1.0 (P5.5)
// ============================================================
// Module invité Puissance 4. Auto-enregistré dans JeuRegistry.
// Le jeu est piloté par l'hôte : l'hôte diffuse la grille complète
// via HOST_ACTION 'puissance4:state', l'invité l'affiche et renvoie
// ses coups via PLAYER_ACTION 'puissance4:move' { col }.
// Aucune logique de jeu côté invité.
// ============================================================

import { JeuRegistry } from './player.js';

const $   = id => document.getElementById(id);
const esc = s => String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const ROWS = 6;
const COLS = 7;

const Puissance4Module = {
    _session : null,
    _socket  : null,
    _state   : null,
    _attente : false,

    initPlayer(session, sock /*, gameState, snapshot */) {
        this._session = session;
        this._socket  = sock;
        this._state   = null;
        this._attente = false;
        this._afficherAttente();
    },

    destroy() {},

    onHostAction(action, data) {
        if (action !== 'puissance4:state' || !data) return;
        this._state   = data;
        this._attente = false;
        this._render();
    },

    onWsEvent() {},
    onScores()  {},

    // ─────────────────────────────────────────────────────

    _afficherAttente() {
        const cont = $('jeu-contenu');
        if (!cont) return;
        cont.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;
                justify-content:center;min-height:50vh;gap:1.25rem;
                text-align:center;padding:2rem;">
                <div style="font-size:2.5rem;">🔴</div>
                <h2 style="margin:0;font-size:1.1rem;">Puissance 4</h2>
                <p style="color:rgba(255,255,255,.5);margin:0;">
                    En attente de l'hôte…
                </p>
            </div>`;
    },

    _render() {
        const cont = $('jeu-contenu');
        const s    = this._state;
        if (!cont || !s || !Array.isArray(s.grille)) return;

        const moi     = this._session?.pseudo;
        const courant = (s.joueurs || [])[s.joueurActuel] || null;
        const estMonTour = !s.partieTerminee && courant && courant.nom === moi && !this._attente;

        let banniere, sousTitre;
        if (s.partieTerminee) {
            banniere  = s.matchNul ? '🤝 Match nul !' : `🎉 ${esc(s.gagnant || '')} a gagné !`;
            sousTitre = 'Partie terminée.';
        } else if (estMonTour) {
            banniere  = '🎯 À toi de jouer';
            sousTitre = 'Touche une colonne.';
        } else {
            banniere  = `⏳ Tour de ${esc(courant?.nom || '—')}`;
            sousTitre = this._attente ? 'Coup envoyé…' : 'En attente…';
        }

        let cells = '';
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const idx   = s.grille[r] ? s.grille[r][c] : null;
                const nom   = (idx !== null && idx !== undefined) ? (s.joueurs[idx]?.nom) : null;
                const emoji = nom ? (s.couleurs?.[nom] || '⚪') : '';
                cells += `<div class="p4p-cell" data-col="${c}"
                    style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;
                    font-size:1.4rem;border-radius:50%;
                    background:${emoji ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.04)'};
                    border:1px solid rgba(255,255,255,.12);
                    cursor:${estMonTour ? 'pointer' : 'default'};">${emoji}</div>`;
            }
        }

        cont.innerHTML = `
            <div style="padding:1rem 0;display:flex;flex-direction:column;gap:1rem;align-items:center;">
                <div style="text-align:center;font-weight:700;font-size:1rem;color:#fff;
                    background:rgba(37,99,235,.2);border:1px solid rgba(37,99,235,.45);
                    border-radius:10px;padding:.6rem 1rem;width:100%;box-sizing:border-box;">
                    ${banniere}
                </div>
                <div id="p4p-grille" style="display:grid;gap:6px;width:100%;max-width:340px;
                    grid-template-columns:repeat(${COLS},1fr);padding:8px;
                    background:rgba(37,99,235,.12);border-radius:12px;
                    opacity:${estMonTour ? '1' : '.6'};
                    pointer-events:${estMonTour ? 'auto' : 'none'};">
                    ${cells}
                </div>
                <p style="font-size:.8rem;color:rgba(255,255,255,.4);margin:0;text-align:center;">
                    ${sousTitre}
                </p>
            </div>`;

        if (estMonTour) {
            cont.querySelectorAll('.p4p-cell').forEach(el => {
                el.addEventListener('click', () => this._envoyerCoup(+el.dataset.col));
            });
        }
    },

    _envoyerCoup(col) {
        if (this._attente) return;
        // Colonne pleine ? (ligne du haut occupée) → ignorer côté UI
        const s = this._state;
        if (s && s.grille && s.grille[0] && s.grille[0][col] !== null && s.grille[0][col] !== undefined) return;
        this._attente = true;
        try {
            this._socket.send('PLAYER_ACTION', { action: 'puissance4:move', data: { col } });
        } catch (e) {
            console.error('[P4P] send move:', e.message);
            this._attente = false;
            return;
        }
        const g = $('p4p-grille');
        if (g) { g.style.opacity = '.5'; g.style.pointerEvents = 'none'; }
    },
};

JeuRegistry.register('puissance4', Puissance4Module);
console.log('[P4P] ✅ Puissance4Module enregistré dans JeuRegistry');