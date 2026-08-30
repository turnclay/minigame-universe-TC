// ============================================================
// /js/jeux/uno.js — v2.0 (hôte) — refonte présentation mobile
// ============================================================
// Affichage hôte du jeu UNO.
// Reçoit les events WS serveur, met à jour l'UI de l'écran hôte.
// Aucune logique métier ici — tout part du serveur.
//
// v2.0 : rendu par classes CSS (.uno-*, cf mgu-jeux-pilote.css)
// au lieu de style.cssText inline. Main hôte en fan scrollable
// horizontal (remplace le flex-wrap — le vrai problème mobile).
// Choix de couleur unifié sur un seul mécanisme délégué. Aucun
// changement de logique, de payload WS ou de contrat d'events.
//
// Events WS reçus :
//   UNO_STATE         — état complet public (à chaque action)
//   UNO_HAND          — reçu si l'hôte joue (hostJoue)
//   UNO_TURN          — changement de tour
//   UNO_EFFECT        — effet d'une carte
//   UNO_UNO_SAID      — annonce UNO
//   UNO_PENALTY       — pénalité UNO
//   UNO_WINNER        — fin de partie + scores
//   UNO_COLOR_CHOSEN  — couleur choisie post-joker
//   UNO_CHOOSE_COLOR  — hôte doit choisir la couleur (si hostJoue)
//   UNO_DRAW_PLAYABLE — hôte a pioché une carte jouable
//   SCORES_UPDATE     — scoreboard global
//
// Events WS envoyés (HOST_ACTION) :
//   uno:load            — démarrer la partie
//   uno:challenge_uno   — contester un joueur sans UNO
//
// Events WS envoyés (PLAYER_ACTION si hostJoue) :
//   uno:play | uno:draw | uno:say_uno | uno:choose_color | uno:pass
// ============================================================

import { GameState }  from '../core/state.js';
import { socket }     from '../core/socket.js';
import { afficherScoreboard } from '../modules/scoreboard.js';

// ── État local affichage (lecture seule depuis serveur) ─────
let _etat            = null;
let _mainHote        = [];
let _jouablesIdx     = [];
let _attenteCouleur  = false;
let _drawPlayable    = null; // { carte, index }
let _hostPseudo      = null;

// Références aux handlers WS — conservées pour pouvoir faire socket.off()
// lors d'un enchaînement de parties (cleanup.js → nettoyerPartieInvites).
// Sans ça, chaque initialiserUno() empilerait un nouveau listener par event.
let _wsHandlers          = null;
let _delegationInstallee = false;

const $ = id => document.getElementById(id);

// ── Couleurs UNO (identité du jeu — hors palette --mgu-*) ───
const COULEUR_CSS = {
    rouge:'#ef4444', vert:'#22c55e', bleu:'#3b82f6', jaune:'#eab308', null:'#6b7280',
};
const COULEUR_LABEL = { rouge:'🔴', vert:'🟢', bleu:'🔵', jaune:'🟡' };
const COULEURS      = ['rouge', 'vert', 'bleu', 'jaune'];

function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─────────────────────────────────────────────────────
// RENDU CARTE (classes .uno-card, plus de style inline calculé)
// ─────────────────────────────────────────────────────

function _labelValeur(v) {
    const m = { '+2':'+2', 'plus4':'+4', 'passe':'🚫', 'inversion':'↩️', 'joker':'🎨' };
    return m[v] || v;
}

function _classeCouleurCarte(carte) {
    return carte.couleur ? `uno-card--${carte.couleur}` : 'uno-card--joker';
}

function _renderCarte(carte, opts = {}) {
    const { jouable = false, taille = 'md', index = -1, onClick = null } = opts;
    const div = document.createElement('div');
    div.className = `uno-card uno-card--${taille} ${_classeCouleurCarte(carte)} ${jouable ? 'uno-card--jouable' : ''}`.trim();
    div.textContent = _labelValeur(carte.valeur);
    if (jouable && onClick) {
        div.setAttribute('role', 'button');
        div.setAttribute('tabindex', '0');
        div.setAttribute('aria-label', `Jouer ${_labelValeur(carte.valeur)}${carte.couleur ? ' ' + carte.couleur : ''}`);
        div.addEventListener('click', () => onClick(index, carte));
        div.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(index, carte); }
        });
    }
    return div;
}

// ─────────────────────────────────────────────────────
// RENDU ÉTAT GLOBAL (vue hôte)
// ─────────────────────────────────────────────────────

function _renderEtat() {
    const cont = $('uno-contenu');
    if (!cont || !_etat) return;

    const { joueurs, tourActuel, couleurActive,
            cartesParJoueur, derniereCarteDefausse, attenteCouleur,
            accumulateur, gagnant, unoAnnonces = [] } = _etat;
    const unoSet = new Set(unoAnnonces);

    if (gagnant) { _renderVictoire(gagnant); return; }

    // ── Carte du dessus ──────────────────────────────
    let carteTopHtml = '<span class="uno-players-label">—</span>';
    if (derniereCarteDefausse) {
        const cls = _classeCouleurCarte(derniereCarteDefausse);
        carteTopHtml = `<div class="uno-card uno-card--lg ${cls}">${_esc(_labelValeur(derniereCarteDefausse.valeur))}</div>`;
    }

    // ── Joueurs (pastilles horizontales) ─────────────
    const joueursHtml = joueurs.map(j => {
        const nb      = cartesParJoueur[j] || 0;
        const estLui  = j === tourActuel;
        const aDitUno = unoSet.has(j);
        const unoBadge = (nb === 1 && aDitUno)
            ? '<span class="uno-badge-uno">⚠️ UNO !</span>' : '';
        const peutContester = nb === 1 && !aDitUno && j !== _hostPseudo;
        return `
            <div class="uno-player-pill ${estLui ? 'uno-player-pill--actif' : ''}">
                <span>${estLui ? '▶️ ' : ''}${_esc(j)}</span>
                <span class="uno-player-count">${nb} 🃏</span>
                ${unoBadge}
                ${peutContester ? `<button data-cible="${_esc(j)}" class="uno-challenge-btn">✖ CONTRE UNO !</button>` : ''}
            </div>`;
    }).join('');

    const accu = accumulateur > 0
        ? `<div class="uno-accu">⚠️ ${accumulateur} cartes à piocher pour ${_esc(tourActuel)}</div>`
        : '';

    // Choix couleur inline (cas hôte joue mais main vide — édge case
    // conservé à l'identique de la version précédente)
    const choixCouleur = (attenteCouleur && _mainHote.length === 0 && _hostPseudo)
        ? _renderChoixCouleurHtml() : '';

    cont.innerHTML = `
        <div class="uno-board">
            <div class="uno-table-strip">
                <div class="uno-discard">
                    <div>
                        <div class="uno-discard-label">Défausse</div>
                        ${carteTopHtml}
                    </div>
                </div>
                <div class="uno-turn-info">
                    <span class="uno-color-dot" style="background:${COULEUR_CSS[couleurActive] || COULEUR_CSS.null};"></span>
                    Tour : <strong>${_esc(tourActuel)}</strong>
                </div>
            </div>

            <div>
                <div class="uno-players-label">Joueurs</div>
                <div class="uno-players-strip">${joueursHtml}</div>
            </div>

            ${accu}
            ${choixCouleur}
        </div>
        <div id="uno-main-hote"></div>`;

    // Main hôte si hostJoue
    if (_hostPseudo && _mainHote.length > 0) {
        _renderMainHote();
    }
}

function _renderChoixCouleurHtml() {
    return `
        <div class="uno-color-inline">
            <div class="uno-color-picker-label" style="margin-bottom:10px;">🎨 Choisis la couleur active</div>
            <div class="uno-color-picker">
                ${COULEURS.map(c => `
                    <button data-couleur="${c}" class="uno-color-btn uno-color-btn--${c}"
                        aria-label="Choisir ${c}">${COULEUR_LABEL[c]}</button>`).join('')}
            </div>
        </div>`;
}

function _renderMainHote() {
    const cont = $('uno-contenu');
    const zone = $('uno-main-hote');
    if (!zone || !cont) return;

    const cartesHtml = _mainHote.map((carte, i) => {
        const jouable = _jouablesIdx.includes(i);
        return { carte, i, jouable };
    });

    zone.innerHTML = `
        <div class="uno-hand-panel">
            <div class="uno-hand-title">🎮 Ta main (${_esc(_hostPseudo)})</div>
            <div class="uno-hand-scroll" id="uno-hand-scroll-hote"></div>
            <div class="uno-hand-actions" id="uno-hand-actions-hote"></div>
        </div>`;

    const scrollWrap = $('uno-hand-scroll-hote');
    cartesHtml.forEach(({ carte, i, jouable }) => {
        scrollWrap.appendChild(_renderCarte(carte, { jouable, taille: 'md', index: i, onClick: _jouerCarteHote }));
    });

    const actions = $('uno-hand-actions-hote');

    const btnPioche = document.createElement('button');
    btnPioche.className = 'uno-btn';
    btnPioche.textContent = '📦 Piocher';
    btnPioche.addEventListener('click', () => {
        try { socket.send('PLAYER_ACTION', { action: 'uno:draw', data: {} }); }
        catch(e) { console.error('[UNO] draw hôte:', e); }
    });
    actions.appendChild(btnPioche);

    if (_mainHote.length <= 2) {
        const btnUno = document.createElement('button');
        btnUno.className = 'uno-btn uno-btn--uno';
        btnUno.textContent = '🔔 UNO !';
        btnUno.addEventListener('click', () => {
            try { socket.send('PLAYER_ACTION', { action: 'uno:say_uno', data: {} }); }
            catch(e) {}
        });
        actions.appendChild(btnUno);
    }

    if (_attenteCouleur && _etat?.tourActuel === _hostPseudo) {
        const wrap = document.createElement('div');
        wrap.className = 'uno-color-picker';
        wrap.style.width = '100%';
        COULEURS.forEach(c => {
            const b = document.createElement('button');
            b.className = `uno-color-btn uno-color-btn--${c}`;
            b.dataset.couleur = c;
            b.setAttribute('aria-label', `Choisir ${c}`);
            wrap.appendChild(b);
        });
        actions.appendChild(wrap);
    }

    if (_drawPlayable !== null) {
        const btnPass = document.createElement('button');
        btnPass.className = 'uno-btn';
        btnPass.textContent = '⏭️ Passer';
        btnPass.addEventListener('click', () => {
            _drawPlayable = null;
            try { socket.send('PLAYER_ACTION', { action: 'uno:pass', data: {} }); }
            catch(e) {}
        });
        actions.appendChild(btnPass);
    }
}

function _jouerCarteHote(index) {
    if (_attenteCouleur) return;
    try {
        socket.send('PLAYER_ACTION', { action: 'uno:play', data: { index } });
        _drawPlayable = null;
    } catch(e) { console.error('[UNO] play hôte:', e); }
}

function _renderVictoire(gagnant) {
    const cont = $('uno-contenu');
    if (!cont) return;
    const scores     = _etat?.scores || {};
    const delta      = _etat?.delta || {};
    const classement = _etat?.classement || [];

    const rangs = (classement.length)
        ? classement
        : Object.entries(scores).sort((a,b) => b[1] - a[1])
            .map(([pseudo]) => ({ pseudo, cartes: null, delta: delta[pseudo] || 0 }));

    const medals = ['🥇','🥈','🥉'];
    const lignes = rangs.map((r, i) => {
        const dPts = r.delta || 0;
        const cum  = scores[r.pseudo] ?? 0;
        return `
            <div class="uno-rank-row ${r.pseudo === gagnant ? 'uno-rank-row--winner' : ''}">
                <span style="display:flex;align-items:center;gap:8px;">
                    <span>${medals[i] || (i+1)+'.'} ${_esc(r.pseudo)}</span>
                    ${r.cartes != null ? `<span class="uno-players-label">${r.cartes} 🃏</span>` : ''}
                </span>
                <span style="display:flex;align-items:center;gap:8px;">
                    <span class="uno-rank-delta ${dPts > 0 ? 'uno-rank-delta--positif' : ''}">+${dPts}</span>
                    <span class="uno-rank-cum">(${cum} cumul)</span>
                </span>
            </div>`;
    }).join('');

    cont.innerHTML = `
        <div class="uno-victory">
            <div style="font-size:3rem;">🏆</div>
            <h2 class="uno-victory-title">${_esc(gagnant)} remporte la partie !</h2>
            <div class="uno-victory-sub">Classement · 1ᵉʳ=3pts · 2ᵉ=2pts · 3ᵉ=1pt · suivants=0</div>
            <div class="uno-rank-list">${lignes}</div>
            <button id="uno-rejouer" class="uno-btn-rejouer">🔄 Rejouer</button>
        </div>`;

    $('uno-rejouer')?.addEventListener('click', () => {
        try { socket.send('HOST_ACTION', { action: 'uno:load', data: {} }); }
        catch(e) {}
    });
}

// ─────────────────────────────────────────────────────
// DÉLÉGATION D'EVENTS DOM (choix couleur + contestation UNO)
// Un seul listener global, posé une fois — survit à tous les
// remplacements de innerHTML (pas de rebranchement par render).
// ─────────────────────────────────────────────────────

function _installerDelegation() {
    if (_delegationInstallee) return;
    _delegationInstallee = true;

    document.addEventListener('click', e => {
        const btnCouleur = e.target.closest('.uno-color-btn');
        if (btnCouleur) {
            const couleur = btnCouleur.dataset.couleur;
            if (!couleur) return;
            try { socket.send('PLAYER_ACTION', { action: 'uno:choose_color', data: { couleur } }); }
            catch(err) {}
            return;
        }

        const btnChallenge = e.target.closest('.uno-challenge-btn');
        if (btnChallenge) {
            const cible = btnChallenge.dataset.cible;
            if (!cible) return;
            try { socket.send('HOST_ACTION', { action: 'uno:challenge_uno', data: { cible } }); }
            catch(err) { console.error('[UNO] challenge_uno:', err); }
        }
    });
}

// ─────────────────────────────────────────────────────
// LISTENERS WS
// ─────────────────────────────────────────────────────

function _abonnerEvents() {
    // Si des handlers précédents sont restés (relance UNO sans navigation),
    // on les retire AVANT d'en ré-enregistrer — sinon empilement silencieux.
    nettoyerPartieInvites();

    _wsHandlers = {
        UNO_STATE: payload => {
            _etat           = payload;
            _attenteCouleur = payload.attenteCouleur || false;
            _renderEtat();
            try { afficherScoreboard(); } catch {}
        },
        UNO_HAND: payload => {
            if (!_hostPseudo) return;
            _mainHote    = payload.main || [];
            _jouablesIdx = payload.jouablesIdx || [];
            _renderMainHote();
        },
        UNO_TURN: payload => {
            if (!_etat) return;
            _etat.tourActuel    = payload.tourActuel;
            _etat.couleurActive = payload.couleurActive;
            _etat.accumulateur  = payload.accumulateur || 0;
        },
        UNO_EFFECT: payload => _afficherToastEffect(payload),
        UNO_UNO_SAID: ({ joueur }) =>
            _afficherToastEffect({ effet: `🔔 UNO annoncé par ${joueur} !`, joueur }),
        UNO_PENALTY: ({ joueur, nb, raison }) =>
            _afficherToastEffect({ effet: `⚠️ ${joueur} pioche ${nb} (${raison})`, joueur }),
        UNO_COLOR_CHOSEN: ({ couleur, joueur }) => {
            _attenteCouleur = false;
            _afficherToastEffect({ effet: `🎨 ${joueur} choisit ${couleur}`, joueur });
        },
        UNO_CHOOSE_COLOR: () => {
            _attenteCouleur = true;
            if (_hostPseudo) _renderMainHote();
        },
        UNO_DRAW_PLAYABLE: payload => {
            _drawPlayable = payload;
            if (_hostPseudo) _renderMainHote();
        },
        UNO_WINNER: payload => {
            // payload contient gagnant, scores, delta, classement, mains
            _etat = { ..._etat, ...payload };
            _renderVictoire(payload.gagnant);
        },
        SCORES_UPDATE: ({ scores }) => {
            if (_etat) _etat.scores = scores;
            try { afficherScoreboard(); } catch {}
        },
    };

    for (const [evt, fn] of Object.entries(_wsHandlers)) socket.on(evt, fn);
}

// Désabonnement explicite — appelé par cleanup.js#resetEtatJeuxHote et
// par _abonnerEvents() lui-même (idempotent). Évite que SCORES_UPDATE
// continue à mettre à jour _etat d'une partie UNO terminée pendant qu'un
// autre jeu tourne.
export function nettoyerPartieInvites() {
    if (!_wsHandlers) return;
    for (const [evt, fn] of Object.entries(_wsHandlers)) socket.off(evt, fn);
    _wsHandlers = null;
}

// ─────────────────────────────────────────────────────
// TOAST / LOG
// ─────────────────────────────────────────────────────

function _afficherToastEffect(payload) {
    const log = $('uno-log');
    if (!log) return;
    const li = document.createElement('li');
    li.className = 'uno-log-entry';
    li.textContent = payload.effet || (payload.joueur + ' agit');
    log.prepend(li);
    // Garder max 30 entrées
    while (log.children.length > 30) log.removeChild(log.lastChild);
}

// ─────────────────────────────────────────────────────
// INJECTION DU PANNEAU HÔTE
// ─────────────────────────────────────────────────────

function _injecterPanneau() {
    const section = $('uno');
    if (!section) return;
    if ($('uno-contenu')) return; // déjà injecté

    section.innerHTML = `
        <header class="game-header">
            <h2 style="font-size:1.1rem;font-weight:800;">🃏 UNO</h2>
        </header>

        <!-- Contenu dynamique -->
        <div id="uno-contenu" style="min-height:200px;"></div>

        <!-- Log des actions -->
        <div class="uno-log-panel">
            <div class="uno-log-title">Journal des actions</div>
            <ul id="uno-log" style="list-style:none;margin:0;padding:0;"></ul>
        </div>
    `;
}

// ─────────────────────────────────────────────────────
// INITIALISATION
// ─────────────────────────────────────────────────────

export async function initialiserUno() {
    console.log('[UNO] Initialisation hôte');

    _etat           = null;
    _mainHote       = [];
    _jouablesIdx    = [];
    _attenteCouleur = false;
    _drawPlayable   = null;

    // Source de vérité serveur : snapshot.hostPseudo (réplique store.snapshotPartie).
    // Présent uniquement si l'hôte joue (hostJoue = true) — sinon null et l'hôte
    // n'affiche pas de main. GameState.joueurs est conservé comme fallback de
    // dernier recours (cas où le snapshot n'aurait pas encore été reçu).
    const snap = window.HostSession?._snapshot || null;
    _hostPseudo = snap?.hostPseudo || GameState?.joueurs?.[0] || null;

    _injecterPanneau();
    _abonnerEvents();
    _installerDelegation();

    // Initialiser la partie côté serveur
    try {
        socket.send('HOST_ACTION', { action: 'uno:load', data: {} });
        console.log('[UNO] 📡 uno:load envoyé');
    } catch(e) {
        console.error('[UNO] ❌ send load:', e.message);
        alert('Impossible de démarrer UNO. Vérifie la connexion.');
    }
}

window.initialiserUno = initialiserUno;