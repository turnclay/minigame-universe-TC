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
    _etat          : null,   // état public serveur (contient unoAnnonces)
    _main          : [],     // cartes du joueur
    _jouablesIdx   : [],
    _attenteCouleur: false,
    _drawPlayable  : null,   // { carte, index }
    _scores        : {},
    _unoSaidByMe   : false,  // protège contre double clic 🔔 UNO!
    _challengesSent: new Set(), // pseudos déjà contestés (pour griser bouton)

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
        this._unoSaidByMe    = false;
        this._challengesSent = new Set();

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
        this._unoSaidByMe    = false;
        this._challengesSent = new Set();
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
            case 'UNO_CHALLENGE_OK':  this._onChallengeOk(payload);  break;
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
        const oldLen = this._main.length;
        this._main        = payload.main || [];
        this._jouablesIdx = payload.jouablesIdx || [];
        // Si je ne suis plus à 1 carte (joué/pioché), réinitialiser le flag
        // local — il sera re-positionné par UNO_UNO_SAID si je reclique.
        if (this._main.length !== 1 && oldLen !== this._main.length) {
            this._unoSaidByMe = false;
        }
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
        const moi = this._session?.pseudo;
        if (joueur === moi) this._unoSaidByMe = true;
        // Purger le challenge éventuel sur ce joueur (il s'est annoncé)
        this._challengesSent.delete(joueur);
        this._toast(`🔔 ${joueur} dit UNO !`, joueur === moi ? 'success' : 'info');
        // unoAnnonces côté serveur sera reflété par UNO_STATE qui suit.
        this._afficherEtat();
    },

    _onPenalty({ joueur, nb, raison }) {
        this._toast(`⚠️ ${joueur} pioche ${nb} (${raison})`, 'warning');
    },

    _onChallengeOk({ joueur, contestePar, nb }) {
        const moi = this._session?.pseudo;
        const type = joueur === moi ? 'error' : (contestePar === moi ? 'success' : 'info');
        const txt = contestePar
            ? `✖ ${contestePar} a contesté ${joueur} → +${nb} cartes`
            : `✖ ${joueur} contesté → +${nb} cartes`;
        this._toast(txt, type, 3500);
        // unoAnnonces / cartesParJoueur seront rafraîchis par le UNO_STATE
        // qui suit côté serveur (_annoncer dans _traiterChallenge).
    },

    _onWinner({ gagnant, scores, delta, classement }) {
        this._scores = scores;
        this._afficherVictoire(gagnant, scores, delta || {}, classement || []);
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

        // Section Joueurs — équivalent fonctionnel de la vue hôte.
        // unoAnnonces vient du serveur : tableau des pseudos ayant dit UNO.
        const unoAnnonces = new Set(this._etat.unoAnnonces || []);
        const autresHtml = this._renderPlayers(
            cartesParJoueur || {}, tourActuel, moi, unoAnnonces
        );

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

                <!-- Défausse + Joueurs -->
                <div style="display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap;">
                    <div style="flex-shrink:0;">
                        <div style="font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;
                            color:rgba(255,255,255,.4);margin-bottom:6px;font-weight:700;">Défausse</div>
                        ${carteTopHtml}
                    </div>
                    <div style="flex:1;min-width:160px;">
                        <div style="font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;
                            color:rgba(255,255,255,.4);margin-bottom:6px;font-weight:700;">Joueurs</div>
                        ${autresHtml}
                    </div>
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

        // Brancher les boutons ✖ CONTRE UNO! générés par _renderPlayers
        cont.querySelectorAll('.uno-contre-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const cible = btn.dataset.cible;
                if (!cible) return;
                this._contesterUno(cible);
                btn.disabled = true;
                btn.style.opacity = '.4';
                btn.style.cursor  = 'not-allowed';
            });
        });

        this._afficherMain();
    },

    // ─────────────────────────────────────────────────
    // Section Joueurs (équivalent vue hôte) — UNO badge
    // + bouton ✖ CONTRE UNO! quand cible a 1 carte sans
    // avoir annoncé. Auto-contestation interdite (bouton
    // absent sur soi-même).
    // ─────────────────────────────────────────────────
    _renderPlayers(cartesParJoueur, tourActuel, moi, unoAnnonces) {
        return Object.entries(cartesParJoueur).map(([j, nb]) => {
            const estLui    = j === tourActuel;
            const estMoi    = j === moi;
            const aDitUno   = unoAnnonces.has(j);
            const dejaConteste = this._challengesSent.has(j);
            const peutContester = nb === 1 && !aDitUno && !estMoi;

            const badge = (nb === 1 && aDitUno)
                ? `<span class="uno-badge" style="display:inline-flex;align-items:center;gap:4px;
                    padding:3px 8px;border-radius:8px;background:rgba(251,191,36,.18);
                    border:1px solid rgba(251,191,36,.45);color:#fbbf24;font-size:.7rem;
                    font-weight:800;white-space:nowrap;">⚠️ UNO !</span>`
                : '';

            const btnContre = peutContester
                ? `<button class="uno-contre-btn" data-cible="${esc(j)}"
                    ${dejaConteste ? 'disabled' : ''}
                    style="padding:4px 9px;background:rgba(239,68,68,.2);
                    border:1px solid rgba(239,68,68,.45);border-radius:8px;
                    color:#fca5a5;font-size:.7rem;font-weight:700;cursor:${dejaConteste ? 'not-allowed' : 'pointer'};
                    opacity:${dejaConteste ? '.4' : '1'};font-family:inherit;white-space:nowrap;">
                    ✖ CONTRE UNO !
                </button>`
                : '';

            return `<div style="display:flex;align-items:center;gap:8px;padding:7px 12px;
                border-radius:10px;font-size:.82rem;font-weight:600;margin-bottom:5px;
                background:${estLui ? 'rgba(0,212,255,.1)' : 'rgba(255,255,255,.04)'};
                border:1px solid ${estLui ? 'rgba(0,212,255,.35)' : 'rgba(255,255,255,.07)'};">
                <span style="flex:1;color:${estLui ? '#00d4ff' : 'white'};
                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                    ${estLui ? '▶️ ' : ''}${esc(j)}${estMoi ? ' <em style="opacity:.55;font-style:normal;">(toi)</em>' : ''}
                </span>
                <span style="color:rgba(255,255,255,.5);font-size:.78rem;white-space:nowrap;">${nb} 🃏</span>
                ${badge}
                ${btnContre}
            </div>`;
        }).join('');
    },

    // Envoyer la contestation au serveur (PLAYER_ACTION).
    _contesterUno(cible) {
        if (this._challengesSent.has(cible)) return;
        this._challengesSent.add(cible);
        try {
            this._socket.send('PLAYER_ACTION', {
                action: 'uno:challenge_uno', data: { cible },
            });
        } catch(e) { console.error('[UNO_PLAYER] challenge_uno:', e); }
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

        // Bouton 🔔 UNO! — visible UNIQUEMENT à exactement 1 carte (règle UNO).
        // Désactivé après clic (ou si déjà annoncé selon unoAnnonces serveur).
        if (this._main.length === 1) {
            const moi = this._session?.pseudo;
            const dejaAnnonce = this._unoSaidByMe
                || (this._etat?.unoAnnonces || []).includes(moi);
            const btnUno = document.createElement('button');
            btnUno.style.cssText = `padding:9px 16px;background:rgba(239,68,68,.2);
                border:1.5px solid rgba(239,68,68,.4);border-radius:10px;color:#fca5a5;
                font-size:.82rem;font-weight:700;cursor:${dejaAnnonce ? 'not-allowed' : 'pointer'};
                font-family:inherit;opacity:${dejaAnnonce ? '.45' : '1'};`;
            btnUno.textContent = dejaAnnonce ? '🔔 UNO annoncé' : '🔔 UNO !';
            btnUno.disabled = dejaAnnonce;
            if (!dejaAnnonce) {
                btnUno.addEventListener('click', () => {
                    this._unoSaidByMe = true;
                    btnUno.disabled = true;
                    btnUno.style.opacity = '.45';
                    btnUno.style.cursor  = 'not-allowed';
                    btnUno.textContent = '🔔 UNO annoncé';
                    this._direUno();
                });
            }
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

    _afficherVictoire(gagnant, scores, delta, classement) {
        const cont = $('jeu-contenu');
        if (!cont) return;
        const moi = this._session?.pseudo;
        const medals = ['🥇','🥈','🥉'];

        // Classement de la partie (par cartes restantes). Si manquant
        // (compat reconnexion sur ancienne session), reconstruire depuis scores.
        const rangs = (classement && classement.length)
            ? classement
            : Object.entries(scores || {}).sort((a,b) => b[1] - a[1])
                .map(([pseudo]) => ({ pseudo, cartes: null, delta: delta?.[pseudo] || 0 }));

        cont.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;
                justify-content:center;min-height:55vh;text-align:center;
                padding:2rem;gap:1.5rem;">
                <span style="font-size:3rem;">${gagnant === moi ? '🏆' : '🃏'}</span>
                <h2 style="margin:0;">
                    ${gagnant === moi ? 'Tu as gagné ! 🎉' : `${esc(gagnant)} remporte la partie !`}
                </h2>
                <div style="font-size:.78rem;color:rgba(255,255,255,.45);
                    text-transform:uppercase;letter-spacing:.08em;">
                    Classement de la partie · 1ᵉʳ=3pts · 2ᵉ=2pts · 3ᵉ=1pt
                </div>
                <div style="display:flex;flex-direction:column;gap:.5rem;width:100%;max-width:340px;">
                    ${rangs.map((r, i) => {
                        const dPts = r.delta || 0;
                        const cum  = scores?.[r.pseudo] ?? 0;
                        return `
                        <div style="display:flex;justify-content:space-between;align-items:center;
                            padding:.7rem 1rem;border-radius:10px;
                            background:${r.pseudo === moi ? 'rgba(0,212,255,.12)' : 'rgba(255,255,255,.04)'};
                            ${r.pseudo === moi ? 'outline:2px solid rgba(0,212,255,.4);' : ''}">
                            <span style="display:flex;align-items:center;gap:8px;">
                                <span>${medals[i] || (i+1)+'.'} ${esc(r.pseudo)}</span>
                                ${r.pseudo === moi ? '<em style="font-size:.78rem;opacity:.6;font-style:normal;">(toi)</em>' : ''}
                                ${r.cartes != null ? `<span style="font-size:.72rem;color:rgba(255,255,255,.5);">${r.cartes} 🃏</span>` : ''}
                            </span>
                            <span style="display:flex;align-items:center;gap:8px;">
                                <span style="font-weight:800;color:${dPts > 0 ? '#22c55e' : 'rgba(255,255,255,.4)'};">
                                    +${dPts}
                                </span>
                                <span style="font-size:.78rem;color:rgba(255,255,255,.45);">(${cum} cumul)</span>
                            </span>
                        </div>`;
                    }).join('')}
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