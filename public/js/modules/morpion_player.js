// ============================================================
// /js/modules/morpion_player.js — v1.0 (P5.5)
// ============================================================
// Module invité Morpion. Auto-enregistré dans JeuRegistry.
// Le jeu est piloté par l'hôte (modes, jetons, équipes, tailles) :
// l'hôte diffuse l'état complet via HOST_ACTION 'morpion:state',
// l'invité l'affiche et renvoie ses coups via PLAYER_ACTION
// 'morpion:move' { row, col }. Aucune logique de jeu côté invité.
// ============================================================

import { JeuRegistry } from './player.js';

const $   = id => document.getElementById(id);
const esc = s => String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const MorpionModule = {
    _session : null,
    _socket  : null,
    _state   : null,
    _attente : false,   // coup envoyé, en attente du prochain état

    initPlayer(session, sock /*, gameState, snapshot */) {
        this._session = session;
        this._socket  = sock;
        this._state   = null;
        this._attente = false;
        this._afficherAttente();
        // Jeu host-authoritative : pas d'état serveur au rejoin.
        // L'hôte re-diffuse l'état courant sur PLAYER_JOINED / RECONNECTED.
    },

    destroy() {},

    // Relais depuis player.js : socket.on('HOST_ACTION', → module.onHostAction)
    onHostAction(action, data) {
        if (action !== 'morpion:state' || !data) return;
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
                <div style="font-size:2.5rem;">⭕</div>
                <h2 style="margin:0;font-size:1.1rem;">Morpion</h2>
                <p style="color:var(--mgu-encre-600);margin:0;">
                    En attente de l'hôte…
                </p>
            </div>`;
    },

    _render() {
        const cont = $('jeu-contenu');
        const s    = this._state;
        if (!cont || !s || !Array.isArray(s.plateau)) return;

        const moi     = this._session?.pseudo;
        const len     = (s.joueurs || []).length || 1;
        const courant = (s.joueurs || [])[s.tourActuel % len] || null;
        const estMonTour = !s.partieTerminee && courant && courant.nom === moi && !this._attente;
        const taille  = s.taille || (s.plateau.length);

        let banniere, sousTitre;
        if (s.partieTerminee) {
            banniere  = s.matchNul ? '🤝 Match nul !' : `🏆 ${esc(s.gagnant || courant?.nom || '')} a gagné !`;
            sousTitre = 'Partie terminée.';
        } else if (estMonTour) {
            banniere  = '🎯 À toi de jouer';
            sousTitre = 'Touche une case libre.';
        } else {
            banniere  = `⏳ Tour de ${esc(courant?.nom || '—')}`;
            sousTitre = this._attente ? 'Coup envoyé…' : 'En attente…';
        }

        let cases = '';
        for (let i = 0; i < taille; i++) {
            for (let j = 0; j < taille; j++) {
                const v   = s.plateau[i] ? s.plateau[i][j] : null;
                const sym = v ? v.symbole : '';
                const col = v ? v.color : '#fff';
                const libre = !v;
                cases += `<div class="mp-case" data-row="${i}" data-col="${j}"
                    style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;
                    font-size:1.9rem;font-weight:800;border-radius:10px;
                    background:${v ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.03)'};
                    border:1px solid var(--mgu-carton-line);color:${col};
                    cursor:${(libre && estMonTour) ? 'pointer' : 'default'};
                    transition:background .15s;">${esc(sym)}</div>`;
            }
        }

        const largeur = Math.min(taille * 90, 360);
        cont.innerHTML = `
            <div style="padding:1rem 0;display:flex;flex-direction:column;gap:1rem;align-items:center;">
                <div style="text-align:center;font-weight:700;font-size:1rem;color:var(--mgu-encre-900);
                    background:rgba(99,102,241,.18);border:1px solid rgba(99,102,241,.4);
                    border-radius:10px;padding:.6rem 1rem;width:100%;box-sizing:border-box;">
                    ${banniere}
                </div>
                <div id="mp-grille" style="display:grid;gap:8px;width:100%;max-width:${largeur}px;
                    grid-template-columns:repeat(${taille},1fr);
                    opacity:${estMonTour ? '1' : '.6'};
                    pointer-events:${estMonTour ? 'auto' : 'none'};">
                    ${cases}
                </div>
                <p style="font-size:.8rem;color:var(--mgu-encre-600);margin:0;text-align:center;">
                    ${sousTitre}
                </p>
            </div>`;

        if (estMonTour) {
            cont.querySelectorAll('.mp-case').forEach(el => {
                el.addEventListener('click', () => {
                    const row = +el.dataset.row, col = +el.dataset.col;
                    if (s.plateau[row][col] !== null) return;
                    this._envoyerCoup(row, col);
                });
            });
        }
    },

    _envoyerCoup(row, col) {
        if (this._attente) return;
        this._attente = true;
        try {
            this._socket.send('PLAYER_ACTION', { action: 'morpion:move', data: { row, col } });
        } catch (e) {
            console.error('[MPP] send move:', e.message);
            this._attente = false;
            return;
        }
        // Verrouillage optimiste : on grise en attendant le prochain 'morpion:state'.
        const g = $('mp-grille');
        if (g) { g.style.opacity = '.5'; g.style.pointerEvents = 'none'; }
    },
};

JeuRegistry.register('morpion', MorpionModule);
console.log('[MPP] ✅ MorpionModule enregistré dans JeuRegistry');