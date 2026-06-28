// ============================================================
// /js/modules/uno_player.js — v1.0
// ============================================================
// Module invité UNO. Auto-enregistré dans JeuRegistry de player.js.
// Interface : initPlayer / destroy / onWsEvent / onScores
//
// Events WS reçus (via onWsEvent) :
//   UNO_STATE         — état complet public
//   UNO_HAND          — main privée du joueur
//   UNO_TURN          — changement de tour
//   UNO_EFFECT        — effet joué
//   UNO_UNO_SAID      — annonce UNO
//   UNO_PENALTY       — pénalité
//   UNO_WINNER        — fin + scores
//   UNO_COLOR_CHOSEN  — couleur choisie
//   UNO_CHOOSE_COLOR  — ce joueur doit choisir la couleur
//   UNO_DRAW_PLAYABLE — carte piochée jouable
//   UNO_ERROR         — erreur action
//
// Events WS envoyés (PLAYER_ACTION) :
//   uno:play | uno:draw | uno:say_uno | uno:choose_color | uno:pass
// ============================================================

import { JeuRegistry } from './player.js';

const $   = id => document.getElementById(id);
const esc = s => String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const COULEUR_CSS = {
    rouge:'#ef4444', vert:'#22c55e', bleu:'#3b82f6', jaune:'#eab308',
};
const COULEUR_LABEL = { rouge:'🔴', vert:'🟢', bleu:'🔵', jaune:'🟡' };

function _labelValeur(v) {
    const m = { '+2':'+2','plus4':'+4','passe':'🚫','inversion':'↩️','joker':'🎨' };
    return m[v] || v;
}

const UnoPlayerModule = {
    _session       : null,
    _socket        : null,
    _etat          : null,   // état public serveur
    _main          : [],     // cartes du joueur
    _jouablesIdx   : [],
    _attenteCouleur: false,
    _drawPlayable  : null,   // { carte, index }
    _scores        : {},

    // ─────────────────────────────────────────────────
    // INIT
    // ─────────────────────────────────────────────────
    initPlayer(session, sock, gameState, snapshot) {
        this._session        = session;
        this._socket         = sock;
        this._main           = [];
        this._jouablesIdx    = [];
        this._attenteCouleur = false;
        this._drawPlayable   = null;
        this._scores         = snapshot?.scores || {};

        this._afficherAttente();

        if (gameState) {
            this._etat = gameState;
            // Reconnexion : le serveur a inclus la main privée dans gameState._hand
            // (cf. server/games/uno.js#getSessionState). Rehydrate avant le rendu
            // pour que l'invité reprenne avec ses cartes immédiatement visibles.
            if (gameState._hand) {
                this._main        = gameState._hand.main || [];
                this._jouablesIdx = gameState._hand.jouablesIdx || [];
            }
            this._afficherEtat();
        }
    },

    destroy() {
        this._etat           = null;
        this._main           = [];
        this._attenteCouleur = false;
    },

    // ─────────────────────────────────────────────────
    // RELAY WS → switch
    // ─────────────────────────────────────────────────
    onWsEvent(evt, payload) {
        switch (evt) {
            case 'UNO_STATE':         this._onState(payload);        break;
            case 'UNO_HAND':          this._onHand(payload);         break;
            case 'UNO_TURN':          this._onTurn(payload);         break;
            case 'UNO_EFFECT':        this._onEffect(payload);       break;
            case 'UNO_UNO_SAID':      this._onUnoSaid(payload);      break;
            case 'UNO_PENALTY':       this._onPenalty(payload);      break;
            case 'UNO_WINNER':        this._onWinner(payload);       break;
            case 'UNO_COLOR_CHOSEN':  this._onColorChosen(payload);  break;
            case 'UNO_CHOOSE_COLOR':  this._onChooseColor(payload);  break;
            case 'UNO_DRAW_PLAYABLE': this._onDrawPlayable(payload); break;
            case 'UNO_ERROR':         this._toast(payload.message || 'Erreur UNO', 'error'); break;
        }
    },

    onScores(scores) {
        if (scores) this._scores = scores;
    },

    // ─────────────────────────────────────────────────
    // HANDLERS
    // ─────────────────────────────────────────────────
    _onState(payload) {
        this._etat           = payload;
        this._attenteCouleur = payload.attenteCouleur || false;
        this._afficherEtat();
    },

    _onHand(payload) {
        this._main        = payload.main || [];
        this._jouablesIdx = payload.jouablesIdx || [];
        this._afficherMain();
    },

    _onTurn(payload) {
        if (!this._etat) return;
        this._etat.tourActuel    = payload.tourActuel;
        this._etat.couleurActive = payload.couleurActive;
        this._etat.accumulateur  = payload.accumulateur || 0;
        this._afficherEtat();
    },

    _onEffect(payload) {
        this._logEffect(payload);
    },

    _onUnoSaid({ joueur }) {
        this._toast(`🔔 ${joueur} dit UNO !`, joueur === this._session?.pseudo ? 'success' : 'info');
    },

    _onPenalty({ joueur, nb, raison }) {
        this._toast(`⚠️ ${joueur} pioche ${nb} (${raison})`, 'warning');
    },

    _onWinner({ gagnant, scores }) {
        this._scores = scores;
        this._afficherVictoire(gagnant, scores);
    },

    _onColorChosen({ couleur, joueur }) {
        this._attenteCouleur = false;
        this._toast(`🎨 ${joueur} choisit ${couleur}`, 'info');
        if (this._etat) this._etat.couleurActive = couleur;
        this._afficherEtat();
    },

    _onChooseColor() {
        this._attenteCouleur = true;
        this._afficherChoixCouleur();
    },

    _onDrawPlayable({ carte, index }) {
        this._drawPlayable = { carte, index };
        this._afficherMain();
    },

    // ─────────────────────────────────────────────────
    // ACTIONS JOUEUR
    // ─────────────────────────────────────────────────
    _jouerCarte(index) {
        if (this._attenteCouleur) return;
        try {
            this._socket.send('PLAYER_ACTION', { action: 'uno:play', data: { index } });
            this._drawPlayable = null;
        } catch(e) { console.error('[UNO_PLAYER] play:', e); }
    },

    _piocher() {
        try {
            this._socket.send('PLAYER_ACTION', { action: 'uno:draw', data: {} });
        } catch(e) {}
    },

    _passer() {
        this._drawPlayable = null;
        try { this._socket.send('PLAYER_ACTION', { action: 'uno:pass', data: {} }); } catch(e) {}
    },

    _direUno() {
        try { this._socket.send('PLAYER_ACTION', { action: 'uno:say_uno', data: {} }); } catch(e) {}
    },

    _choisirCouleur(couleur) {
        try {
            this._socket.send('PLAYER_ACTION', { action: 'uno:choose_color', data: { couleur } });
            this._attenteCouleur = false;
        } catch(e) {}
    },

    // ─────────────────────────────────────────────────
    // UI
    // ─────────────────────────────────────────────────
    _afficherAttente() {
        const cont = $('jeu-contenu');
        if (!cont) return;
        cont.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;
                justify-content:center;min-height:50vh;gap:1.25rem;
                text-align:center;padding:2rem;">
                <div style="font-size:2.5rem;">🃏</div>
                <h2 style="margin:0;font-size:1.1rem;">UNO</h2>
                <p style="color:rgba(255,255,255,.5);margin:0;">En attente du lancement…</p>
            </div>`;
    },

    _afficherEtat() {
        const cont = $('jeu-contenu');
        if (!cont || !this._etat) return;
        const { tourActuel, couleurActive, cartesParJoueur,
                derniereCarteDefausse, accumulateur, gagnant } = this._etat;

        if (gagnant) { this._afficherVictoire(gagnant, this._scores); return; }

        const moi        = this._session?.pseudo;
        const monTour    = tourActuel === moi;
        const topColor   = couleurActive ? COULEUR_CSS[couleurActive] : '#6b7280';
        const accu       = accumulateur > 0
            ? `<div style="background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);
                border-radius:8px;padding:8px 12px;font-size:.8rem;font-weight:700;color:#fca5a5;">
                ⚠️ ${accumulateur} cartes à piocher
               </div>` : '';

        // Carte du dessus
        let carteTopHtml = '—';
        if (derniereCarteDefausse) {
            const bg = derniereCarteDefausse.couleur
                ? COULEUR_CSS[derniereCarteDefausse.couleur]
                : 'linear-gradient(135deg,#ef4444,#eab308,#22c55e,#3b82f6)';
            carteTopHtml = `<div style="width:60px;height:88px;border-radius:10px;
                background:${bg};border:2.5px solid rgba(255,255,255,.5);
                display:inline-flex;align-items:center;justify-content:center;
                font-size:1.3rem;font-weight:900;color:white;
                text-shadow:1px 1px 3px rgba(0,0,0,.5);">
                ${esc(_labelValeur(derniereCarteDefausse.valeur))}
            </div>`;
        }

        // Autres joueurs
        const autresHtml = Object.entries(cartesParJoueur || {})
            .filter(([j]) => j !== moi)
            .map(([j, nb]) => {
                const estLui = j === tourActuel;
                return `<div style="display:flex;align-items:center;gap:8px;padding:7px 12px;
                    border-radius:10px;font-size:.82rem;font-weight:600;
                    background:${estLui ? 'rgba(0,212,255,.1)' : 'rgba(255,255,255,.04)'};
                    border:1px solid ${estLui ? 'rgba(0,212,255,.35)' : 'rgba(255,255,255,.07)'};">
                    <span style="flex:1;color:${estLui ? '#00d4ff' : 'white'};">
                        ${estLui ? '▶️ ' : ''}${esc(j)}
                    </span>
                    <span style="color:rgba(255,255,255,.5);">${nb} 🃏</span>
                    ${nb === 1 ? '<span style="color:#fbbf24;font-size:.72rem;">⚠️UNO</span>' : ''}
                </div>`;
            }).join('');

        cont.innerHTML = `
            <div style="display:flex;flex-direction:column;gap:10px;padding:0 0 12px;">

                <!-- Tour + couleur -->
                <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;
                    border-radius:12px;
                    background:${monTour ? 'rgba(0,212,255,.1)' : 'rgba(255,255,255,.05)'};
                    border:1px solid ${monTour ? 'rgba(0,212,255,.35)' : 'rgba(255,255,255,.1)'};">
                    <div style="width:18px;height:18px;border-radius:50%;
                        background:${topColor};border:2px solid white;flex-shrink:0;"></div>
                    <span style="font-size:.85rem;font-weight:700;color:white;flex:1;">
                        ${monTour ? '⭐ C\'est ton tour !' : `Tour : <strong>${esc(tourActuel)}</strong>`}
                    </span>
                </div>

                <!-- Défausse -->
                <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
                    <div>
                        <div style="font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;
                            color:rgba(255,255,255,.4);margin-bottom:6px;font-weight:700;">Défausse</div>
                        ${carteTopHtml}
                    </div>
                    <div style="flex:1;min-width:140px;">${autresHtml}</div>
                </div>

                ${accu}

                <!-- Ma main -->
                <div id="uno-player-main-wrap"></div>

                <!-- Log -->
                <div style="background:rgba(0,0,0,.15);border-radius:10px;
                    padding:8px 12px;max-height:120px;overflow-y:auto;margin-top:4px;">
                    <ul id="uno-player-log" style="list-style:none;margin:0;padding:0;"></ul>
                </div>
            </div>`;

        this._afficherMain();
    },

    _afficherMain() {
        const wrap = $('uno-player-main-wrap');
        if (!wrap) return;

        const moi     = this._session?.pseudo;
        const monTour = this._etat?.tourActuel === moi;
        wrap.innerHTML = '';

        if (!this._main.length) {
            wrap.innerHTML = '<p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">Aucune carte</p>';
            return;
        }

        const titre = document.createElement('div');
        titre.style.cssText = 'font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;color:rgba(255,255,255,.4);margin-bottom:8px;font-weight:700;';
        titre.textContent = `Ta main (${this._main.length} carte${this._main.length > 1 ? 's' : ''})`;
        wrap.appendChild(titre);

        const cartesDiv = document.createElement('div');
        cartesDiv.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;';

        this._main.forEach((carte, i) => {
            const jouable = monTour && !this._attenteCouleur && this._jouablesIdx.includes(i);
            const bg = carte.couleur
                ? COULEUR_CSS[carte.couleur]
                : 'linear-gradient(135deg,#ef4444,#eab308,#22c55e,#3b82f6)';
            const label = _labelValeur(carte.valeur);

            const div = document.createElement('div');
            div.style.cssText = `
                display:inline-flex;flex-direction:column;align-items:center;justify-content:center;
                width:56px;height:80px;border-radius:10px;font-weight:900;font-size:1rem;
                background:${bg};
                border:2.5px solid ${jouable ? '#fff' : 'rgba(255,255,255,.2)'};
                box-shadow:${jouable ? '0 0 14px rgba(255,255,255,.5)' : '0 2px 8px rgba(0,0,0,.4)'};
                cursor:${jouable ? 'pointer' : 'default'};
                color:white;text-shadow:1px 1px 3px rgba(0,0,0,.5);
                opacity:${jouable ? '1' : '.6'};
                transition:transform .15s;flex-shrink:0;`;
            div.textContent = label;
            if (jouable) {
                div.addEventListener('mouseenter', () => div.style.transform = 'translateY(-8px)');
                div.addEventListener('mouseleave', () => div.style.transform = 'translateY(0)');
                div.addEventListener('click', () => this._jouerCarte(i));
            }
            cartesDiv.appendChild(div);
        });

        wrap.appendChild(cartesDiv);

        // Boutons d'action
        const actionsDiv = document.createElement('div');
        actionsDiv.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;';

        if (monTour && !this._attenteCouleur && !this._drawPlayable) {
            const btnPioche = document.createElement('button');
            btnPioche.style.cssText = `padding:9px 16px;background:rgba(255,255,255,.08);
                border:1px solid rgba(255,255,255,.2);border-radius:10px;color:white;
                font-size:.82rem;font-weight:700;cursor:pointer;font-family:inherit;`;
            btnPioche.textContent = '📦 Piocher';
            btnPioche.addEventListener('click', () => this._piocher());
            actionsDiv.appendChild(btnPioche);
        }

        if (this._drawPlayable !== null) {
            const btnPass = document.createElement('button');
            btnPass.style.cssText = `padding:9px 16px;background:rgba(255,255,255,.06);
                border:1px solid rgba(255,255,255,.12);border-radius:10px;
                color:rgba(255,255,255,.6);font-size:.82rem;cursor:pointer;font-family:inherit;`;
            btnPass.textContent = '⏭️ Passer';
            btnPass.addEventListener('click', () => this._passer());
            actionsDiv.appendChild(btnPass);
        }

        if (this._main.length <= 2 && monTour) {
            const btnUno = document.createElement('button');
            btnUno.style.cssText = `padding:9px 16px;background:rgba(239,68,68,.2);
                border:1.5px solid rgba(239,68,68,.4);border-radius:10px;color:#fca5a5;
                font-size:.82rem;font-weight:700;cursor:pointer;font-family:inherit;`;
            btnUno.textContent = '🔔 UNO !';
            btnUno.addEventListener('click', () => this._direUno());
            actionsDiv.appendChild(btnUno);
        }

        if (actionsDiv.children.length) wrap.appendChild(actionsDiv);
    },

    _afficherChoixCouleur() {
        const cont = $('jeu-contenu');
        if (!cont) return;

        // Injecter au-dessus de la main
        const existing = $('uno-choix-couleur');
        if (existing) existing.remove();

        const div = document.createElement('div');
        div.id = 'uno-choix-couleur';
        div.style.cssText = `
            position:fixed;inset:0;z-index:800;
            display:flex;align-items:center;justify-content:center;
            background:rgba(0,0,0,.75);backdrop-filter:blur(8px);`;
        div.innerHTML = `
            <div style="background:rgba(15,10,35,.97);border:1px solid rgba(255,255,255,.15);
                border-radius:20px;padding:30px 32px;text-align:center;
                box-shadow:0 20px 60px rgba(0,0,0,.5);">
                <div style="font-size:1.1rem;font-weight:800;margin-bottom:20px;color:white;">
                    🎨 Choisis la couleur active
                </div>
                <div style="display:flex;gap:16px;justify-content:center;">
                    ${['rouge','vert','bleu','jaune'].map(c => `
                        <button data-couleur="${c}"
                            style="width:56px;height:56px;border-radius:50%;
                            background:${COULEUR_CSS[c]};border:3px solid rgba(255,255,255,.5);
                            cursor:pointer;font-size:1.3rem;transition:transform .15s;
                            display:flex;align-items:center;justify-content:center;">
                            ${COULEUR_LABEL[c]}
                        </button>`).join('')}
                </div>
            </div>`;

        div.querySelectorAll('button[data-couleur]').forEach(btn => {
            btn.addEventListener('mouseenter', () => btn.style.transform = 'scale(1.15)');
            btn.addEventListener('mouseleave', () => btn.style.transform = 'scale(1)');
            btn.addEventListener('click', () => {
                this._choisirCouleur(btn.dataset.couleur);
                div.remove();
            });
        });

        document.body.appendChild(div);
    },

    _afficherVictoire(gagnant, scores) {
        const cont = $('jeu-contenu');
        if (!cont) return;
        const moi = this._session?.pseudo;
        const entries = Object.entries(scores || {}).sort((a, b) => b[1] - a[1]);
        const medals = ['🥇','🥈','🥉'];
        cont.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;
                justify-content:center;min-height:55vh;text-align:center;
                padding:2rem;gap:1.5rem;">
                <span style="font-size:3rem;">${gagnant === moi ? '🏆' : '🃏'}</span>
                <h2 style="margin:0;">
                    ${gagnant === moi ? 'Tu as gagné ! 🎉' : `${esc(gagnant)} remporte la partie !`}
                </h2>
                <div style="display:flex;flex-direction:column;gap:.5rem;width:100%;max-width:320px;">
                    ${entries.map(([nom, pts], i) => `
                        <div style="display:flex;justify-content:space-between;align-items:center;
                            padding:.7rem 1rem;border-radius:10px;
                            background:${nom === moi ? 'rgba(0,212,255,.12)' : 'rgba(255,255,255,.04)'};
                            ${nom === moi ? 'outline:2px solid rgba(0,212,255,.4);' : ''}">
                            <span>${medals[i] || (i+1)+'.'} ${esc(nom)}
                                ${nom === moi ? '<em style="font-size:.78rem;opacity:.6;"> (toi)</em>' : ''}
                            </span>
                            <span style="font-weight:700;color:${nom === moi ? '#00d4ff' : 'white'}">
                                ${pts} pts
                            </span>
                        </div>`).join('')}
                </div>
                <a href="/" style="display:inline-block;padding:.75rem 2rem;
                    background:linear-gradient(135deg,#6a5af9,#8a2be2);
                    border-radius:10px;color:white;text-decoration:none;font-weight:700;margin-top:.5rem;">
                    🏠 Retour à l'accueil
                </a>
            </div>`;
    },

    // ─────────────────────────────────────────────────
    // LOG / TOAST
    // ─────────────────────────────────────────────────
    _logEffect(payload) {
        const log = $('uno-player-log');
        if (!log) return;
        const li = document.createElement('li');
        li.style.cssText = 'padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:.75rem;color:rgba(255,255,255,.6);';
        li.textContent = payload.effet || '';
        log.prepend(li);
        while (log.children.length > 20) log.removeChild(log.lastChild);
    },

    _toast(msg, type = 'info') {
        const C = { success:'#22c55e', error:'#ef4444', warning:'#f59e0b', info:'#00d4ff' };
        const I = { success:'✅', error:'❌', warning:'⚠️', info:'ℹ️' };
        let c = $('toast-container');
        if (!c) {
            c = document.createElement('div'); c.id = 'toast-container';
            c.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:9999;display:flex;flex-direction:column;gap:.4rem;max-width:310px;pointer-events:none;';
            document.body.appendChild(c);
        }
        const el = document.createElement('div');
        el.style.cssText = `display:flex;gap:.5rem;align-items:flex-start;padding:.65rem .9rem;
            border-radius:8px;background:#1e1e2e;color:#fff;
            border-left:3px solid ${C[type] || C.info};box-shadow:0 4px 16px rgba(0,0,0,.5);
            font-size:.88rem;`;
        el.innerHTML = `<span>${I[type] || 'ℹ️'}</span><span>${esc(msg)}</span>`;
        c.appendChild(el);
        setTimeout(() => el.remove(), 3500);
    },
};

JeuRegistry.register('uno', UnoPlayerModule);
console.log('[UNO_PLAYER] ✅ UnoPlayerModule enregistré dans JeuRegistry');