// ============================================================
// /js/modules/uno_player.js — v2.0 — refonte présentation mobile
// ============================================================
// Module invité UNO. Auto-enregistré dans JeuRegistry de player.js.
// Interface : initPlayer / destroy / onWsEvent / onScores
//
// v2.0 : rendu par classes CSS (.uno-*, cf mgu-invite-pilote.css)
// au lieu de style.cssText inline. Main en fan scrollable
// horizontal (remplace le flex-wrap — le vrai problème mobile :
// retour à la ligne qui bouffe la hauteur d'écran). Aucun
// changement de logique, de payload WS ou de contrat d'events.
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
    rouge:'#ef4444', vert:'#22c55e', bleu:'#3b82f6', jaune:'#eab308', null:'#6b7280',
};
const COULEUR_LABEL = { rouge:'🔴', vert:'🟢', bleu:'🔵', jaune:'🟡' };
const COULEURS       = ['rouge', 'vert', 'bleu', 'jaune'];

function _labelValeur(v) {
    const m = { '+2':'+2','plus4':'+4','passe':'🚫','inversion':'↩️','joker':'🎨' };
    return m[v] || v;
}

function _classeCouleurCarte(carte) {
    return carte.couleur ? `uno-card--${carte.couleur}` : 'uno-card--joker';
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
    _delegationInstallee: false,

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

        this._installerDelegation();
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

    // ─────────────────────────────────────────────────
    // DÉLÉGATION D'EVENTS DOM (contestation UNO)
    // Un seul listener global posé une fois — survit à tous les
    // remplacements de innerHTML (pas de rebranchement par render).
    // ─────────────────────────────────────────────────
    _installerDelegation() {
        if (this._delegationInstallee) return;
        this._delegationInstallee = true;
        document.addEventListener('click', e => {
            const btn = e.target.closest('.uno-contre-btn');
            if (!btn || btn.disabled) return;
            const cible = btn.dataset.cible;
            if (!cible) return;
            this._contesterUno(cible);
            btn.disabled = true;
        });
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
                <p style="color:var(--mgu-encre-600);margin:0;">En attente du lancement…</p>
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
        const accu       = accumulateur > 0
            ? `<div class="uno-accu">⚠️ ${accumulateur} cartes à piocher</div>` : '';

        let carteTopHtml = '—';
        if (derniereCarteDefausse) {
            const cls = _classeCouleurCarte(derniereCarteDefausse);
            carteTopHtml = `<div class="uno-card uno-card--lg ${cls}">${esc(_labelValeur(derniereCarteDefausse.valeur))}</div>`;
        }

        // Section Joueurs — équivalent fonctionnel de la vue hôte.
        // unoAnnonces vient du serveur : tableau des pseudos ayant dit UNO.
        const unoAnnonces = new Set(this._etat.unoAnnonces || []);
        const joueursHtml = this._renderPlayers(
            cartesParJoueur || {}, tourActuel, moi, unoAnnonces
        );

        cont.innerHTML = `
            <div class="uno-board">
                <div class="uno-table-strip">
                    <div>
                        <div class="uno-discard-label">Défausse</div>
                        ${carteTopHtml}
                    </div>
                    <div class="uno-turn-info">
                        <span class="uno-color-dot" style="background:${COULEUR_CSS[couleurActive] || COULEUR_CSS.null};"></span>
                        ${monTour ? '⭐ C\'est ton tour !' : `Tour : <strong>${esc(tourActuel)}</strong>`}
                    </div>
                </div>

                <div>
                    <div class="uno-players-label">Joueurs</div>
                    <div class="uno-players-strip">${joueursHtml}</div>
                </div>

                ${accu}

                <!-- Ma main -->
                <div id="uno-player-main-wrap"></div>

                <!-- Log -->
                <div class="uno-log-panel">
                    <ul id="uno-player-log" style="list-style:none;margin:0;padding:0;"></ul>
                </div>
            </div>`;

        this._afficherMain();
    },

    // ─────────────────────────────────────────────────
    // Section Joueurs (pastilles horizontales, équivalent vue hôte)
    // + bouton ✖ CONTRE UNO! quand cible a 1 carte sans avoir
    // annoncé. Auto-contestation interdite (bouton absent sur soi).
    // ─────────────────────────────────────────────────
    _renderPlayers(cartesParJoueur, tourActuel, moi, unoAnnonces) {
        return Object.entries(cartesParJoueur).map(([j, nb]) => {
            const estLui    = j === tourActuel;
            const estMoi    = j === moi;
            const aDitUno   = unoAnnonces.has(j);
            const dejaConteste = this._challengesSent.has(j);
            const peutContester = nb === 1 && !aDitUno && !estMoi;

            const badge = (nb === 1 && aDitUno)
                ? `<span class="uno-badge-uno">⚠️ UNO !</span>` : '';

            const btnContre = peutContester
                ? `<button class="uno-contre-btn" data-cible="${esc(j)}" ${dejaConteste ? 'disabled' : ''}>
                    ✖ CONTRE UNO !</button>` : '';

            return `<div class="uno-player-pill ${estLui ? 'uno-player-pill--actif' : ''}">
                <span>${estLui ? '▶️ ' : ''}${esc(j)}${estMoi ? ' <em style="opacity:.6;font-style:normal;">(toi)</em>' : ''}</span>
                <span class="uno-player-count">${nb} 🃏</span>
                ${badge}
                ${btnContre}
            </div>`;
        }).join('');
    },

    _afficherChoixCouleur() {
        const existing = $('uno-choix-couleur');
        if (existing) existing.remove();

        const div = document.createElement('div');
        div.id = 'uno-choix-couleur';
        div.className = 'uno-modal-overlay';
        div.innerHTML = `
            <div class="uno-modal-card">
                <div class="uno-modal-title">🎨 Choisis la couleur active</div>
                <div class="uno-color-picker">
                    ${COULEURS.map(c => `
                        <button data-couleur="${c}" class="uno-color-btn uno-color-btn--${c}"
                            aria-label="Choisir ${c}">${COULEUR_LABEL[c]}</button>`).join('')}
                </div>
            </div>`;

        div.querySelectorAll('button[data-couleur]').forEach(btn => {
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
            <div class="uno-victory">
                <span style="font-size:3rem;">${gagnant === moi ? '🏆' : '🃏'}</span>
                <h2 style="margin:0;">
                    ${gagnant === moi ? 'Tu as gagné ! 🎉' : `${esc(gagnant)} remporte la partie !`}
                </h2>
                <div class="uno-victory-sub">Classement de la partie · 1ᵉʳ=3pts · 2ᵉ=2pts · 3ᵉ=1pt</div>
                <div class="uno-rank-list">
                    ${rangs.map((r, i) => {
                        const dPts = r.delta || 0;
                        const cum  = scores?.[r.pseudo] ?? 0;
                        return `
                        <div class="uno-rank-row ${r.pseudo === moi ? 'uno-rank-row--moi' : ''}">
                            <span style="display:flex;align-items:center;gap:8px;">
                                <span>${medals[i] || (i+1)+'.'} ${esc(r.pseudo)}</span>
                                ${r.pseudo === moi ? '<em style="font-size:.78rem;opacity:.6;font-style:normal;">(toi)</em>' : ''}
                                ${r.cartes != null ? `<span class="uno-players-label">${r.cartes} 🃏</span>` : ''}
                            </span>
                            <span style="display:flex;align-items:center;gap:8px;">
                                <span class="uno-rank-delta ${dPts > 0 ? 'uno-rank-delta--positif' : ''}">+${dPts}</span>
                                <span class="uno-rank-cum">(${cum} cumul)</span>
                            </span>
                        </div>`;
                    }).join('')}
                </div>
                <a href="/" class="uno-btn-accueil">🏠 Retour à l'accueil</a>
            </div>`;
    },

    _afficherMain() {
        const wrap = $('uno-player-main-wrap');
        if (!wrap) return;

        const moi     = this._session?.pseudo;
        const monTour = this._etat?.tourActuel === moi;

        if (!this._main.length) {
            wrap.innerHTML = '<p style="font-size:.8rem;color:var(--mgu-encre-600);text-align:center;">Aucune carte</p>';
            return;
        }

        wrap.innerHTML = `
            <div class="uno-hand-title">Ta main (${this._main.length} carte${this._main.length > 1 ? 's' : ''})</div>
            <div class="uno-hand-scroll" id="uno-player-hand-scroll"></div>
            <div class="uno-hand-actions" id="uno-player-hand-actions"></div>`;

        const scrollWrap = $('uno-player-hand-scroll');
        this._main.forEach((carte, i) => {
            const jouable = monTour && !this._attenteCouleur && this._jouablesIdx.includes(i);
            const div = document.createElement('div');
            div.className = `uno-card uno-card--md ${_classeCouleurCarte(carte)} ${jouable ? 'uno-card--jouable' : ''}`.trim();
            div.textContent = _labelValeur(carte.valeur);
            if (jouable) {
                div.setAttribute('role', 'button');
                div.setAttribute('tabindex', '0');
                div.setAttribute('aria-label', `Jouer ${_labelValeur(carte.valeur)}${carte.couleur ? ' ' + carte.couleur : ''}`);
                div.addEventListener('click', () => this._jouerCarte(i));
                div.addEventListener('keydown', e => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._jouerCarte(i); }
                });
            }
            scrollWrap.appendChild(div);
        });

        // Boutons d'action
        const actionsDiv = $('uno-player-hand-actions');

        if (monTour && !this._attenteCouleur && !this._drawPlayable) {
            const btnPioche = document.createElement('button');
            btnPioche.className = 'uno-btn';
            btnPioche.textContent = '📦 Piocher';
            btnPioche.addEventListener('click', () => this._piocher());
            actionsDiv.appendChild(btnPioche);
        }

        if (this._drawPlayable !== null) {
            const btnPass = document.createElement('button');
            btnPass.className = 'uno-btn';
            btnPass.textContent = '⏭️ Passer';
            btnPass.addEventListener('click', () => this._passer());
            actionsDiv.appendChild(btnPass);
        }

        // Bouton 🔔 UNO! — visible UNIQUEMENT à exactement 1 carte (règle UNO).
        // Désactivé après clic (ou si déjà annoncé selon unoAnnonces serveur).
        if (this._main.length === 1) {
            const moiPseudo = this._session?.pseudo;
            const dejaAnnonce = this._unoSaidByMe
                || (this._etat?.unoAnnonces || []).includes(moiPseudo);
            const btnUno = document.createElement('button');
            btnUno.className = 'uno-btn uno-btn--uno';
            btnUno.textContent = dejaAnnonce ? '🔔 UNO annoncé' : '🔔 UNO !';
            btnUno.disabled = dejaAnnonce;
            if (!dejaAnnonce) {
                btnUno.addEventListener('click', () => {
                    this._unoSaidByMe = true;
                    btnUno.disabled = true;
                    btnUno.textContent = '🔔 UNO annoncé';
                    this._direUno();
                });
            }
            actionsDiv.appendChild(btnUno);
        }
    },

    // ─────────────────────────────────────────────────
    // LOG / TOAST
    // ─────────────────────────────────────────────────
    _logEffect(payload) {
        const log = $('uno-player-log');
        if (!log) return;
        const li = document.createElement('li');
        li.className = 'uno-log-entry';
        li.textContent = payload.effet || '';
        log.prepend(li);
        while (log.children.length > 20) log.removeChild(log.lastChild);
    },

    _toast(msg, type = 'info') {
        const C = { success:'#22c55e', error:'#ef4444', warning:'#f59e0b', info:'var(--mgu-or-600)' };
        const I = { success:'✅', error:'❌', warning:'⚠️', info:'ℹ️' };
        let c = $('toast-container');
        if (!c) {
            c = document.createElement('div'); c.id = 'toast-container';
            c.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:9999;display:flex;flex-direction:column;gap:.4rem;max-width:310px;pointer-events:none;';
            document.body.appendChild(c);
        }
        const el = document.createElement('div');
        el.style.cssText = `display:flex;gap:.5rem;align-items:flex-start;padding:.65rem .9rem;
            border-radius:8px;background:#1e1e2e;color:#ffffff;
            border-left:3px solid ${C[type] || C.info};box-shadow:0 4px 16px rgba(0,0,0,.5);
            font-size:.88rem;pointer-events:auto;`;
        el.innerHTML = `<span>${I[type] || 'ℹ️'}</span><span>${esc(msg)}</span>`;
        c.appendChild(el);
        setTimeout(() => el.remove(), 3500);
    },
};

JeuRegistry.register('uno', UnoPlayerModule);
console.log('[UNO_PLAYER] ✅ UnoPlayerModule enregistré dans JeuRegistry');