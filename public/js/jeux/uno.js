// ============================================================
// /js/jeux/uno.js — v1.0 (hôte)
// ============================================================
// Affichage hôte du jeu UNO.
// Reçoit les events WS serveur, met à jour l'UI de l'écran hôte.
// Aucune logique métier ici — tout part du serveur.
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
let _wsHandlers = null;

const $ = id => document.getElementById(id);

// ── Couleurs UNO ────────────────────────────────────────────
const COULEUR_CSS = {
    rouge  : '#ef4444',
    vert   : '#22c55e',
    bleu   : '#3b82f6',
    jaune  : '#eab308',
    null   : '#6b7280',
};

const COULEUR_LABEL = {
    rouge:'🔴', vert:'🟢', bleu:'🔵', jaune:'🟡',
};

function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─────────────────────────────────────────────────────
// RENDU CARTE
// ─────────────────────────────────────────────────────

function _labelValeur(v) {
    const m = { '+2':'+2', 'plus4':'+4', 'passe':'🚫', 'inversion':'↩️', 'joker':'🎨' };
    return m[v] || v;
}

function _renderCarte(carte, opts = {}) {
    const { jouable = false, petit = false, index = -1, onClick = null } = opts;
    const couleur = carte.couleur || 'null';
    const bg      = COULEUR_CSS[couleur] || '#6b7280';
    const label   = _labelValeur(carte.valeur);
    const isJoker = !carte.couleur;
    const w       = petit ? '44px' : '64px';
    const h       = petit ? '64px' : '92px';
    const fs      = petit ? '.8rem' : '1.1rem';

    const div = document.createElement('div');
    div.style.cssText = `
        display:inline-flex;flex-direction:column;align-items:center;justify-content:center;
        width:${w};height:${h};border-radius:10px;font-weight:900;font-size:${fs};
        background:${isJoker ? 'linear-gradient(135deg,#ef4444,#eab308,#22c55e,#3b82f6)' : bg};
        border:2.5px solid ${jouable ? '#fff' : 'rgba(255,255,255,.3)'};
        box-shadow:${jouable ? '0 0 12px rgba(255,255,255,.6)' : '0 2px 8px rgba(0,0,0,.4)'};
        cursor:${jouable && onClick ? 'pointer' : 'default'};
        color:white;text-shadow:1px 1px 3px rgba(0,0,0,.5);
        transition:transform .15s,box-shadow .15s;
        flex-shrink:0;
        ${jouable && onClick ? 'transform:translateY(0);' : 'opacity:' + (jouable ? '1' : '.7') + ';'}
    `;
    div.textContent = label;
    if (jouable && onClick) {
        div.addEventListener('mouseenter', () => div.style.transform = 'translateY(-6px)');
        div.addEventListener('mouseleave', () => div.style.transform = 'translateY(0)');
        div.addEventListener('click', () => onClick(index, carte));
    }
    return div;
}

function _renderCarteDos(nb) {
    const div = document.createElement('div');
    div.style.cssText = `
        display:inline-flex;align-items:center;justify-content:center;
        width:44px;height:64px;border-radius:8px;font-weight:900;font-size:.75rem;
        background:linear-gradient(135deg,#1e1b4b,#312e81);
        border:2px solid rgba(255,255,255,.25);
        color:rgba(255,255,255,.8);flex-shrink:0;
    `;
    div.textContent = nb;
    return div;
}

// ─────────────────────────────────────────────────────
// RENDU ÉTAT GLOBAL (vue hôte)
// ─────────────────────────────────────────────────────

function _renderEtat() {
    const cont = $('uno-contenu');
    if (!cont || !_etat) return;

    const { joueurs, tourActuel, couleurActive, valeurActive,
            cartesParJoueur, derniereCarteDefausse, attenteCouleur,
            accumulateur, gagnant } = _etat;

    if (gagnant) { _renderVictoire(gagnant); return; }

    // ── Header : couleur active + tour ──────────────
    const topColor = couleurActive ? COULEUR_CSS[couleurActive] : '#6b7280';

    // ── Carte du dessus ──────────────────────────────
    let carteTopHtml = '';
    if (derniereCarteDefausse) {
        const bg = derniereCarteDefausse.couleur
            ? COULEUR_CSS[derniereCarteDefausse.couleur]
            : 'linear-gradient(135deg,#ef4444,#eab308,#22c55e,#3b82f6)';
        const labelV = _labelValeur(derniereCarteDefausse.valeur);
        carteTopHtml = `
            <div style="width:72px;height:104px;border-radius:12px;
                background:${bg};border:3px solid rgba(255,255,255,.5);
                display:flex;align-items:center;justify-content:center;
                font-size:1.5rem;font-weight:900;color:white;
                text-shadow:1px 1px 3px rgba(0,0,0,.5);
                box-shadow:0 8px 24px rgba(0,0,0,.4);">
                ${_esc(labelV)}
            </div>`;
    }

    // ── Joueurs + leurs cartes ───────────────────────
    const joueursHtml = joueurs.map(j => {
        const nb    = cartesParJoueur[j] || 0;
        const estLui = j === tourActuel;
        const bg    = estLui ? 'rgba(0,212,255,.15)' : 'rgba(255,255,255,.05)';
        const bd    = estLui ? '1.5px solid rgba(0,212,255,.5)' : '1px solid rgba(255,255,255,.1)';
        const unoWarn = nb === 1 ? '⚠️ UNO !' : '';
        return `
            <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;
                border-radius:12px;background:${bg};border:${bd};margin-bottom:6px;
                transition:all .2s;">
                <span style="font-weight:700;font-size:.95rem;color:${estLui ? '#00d4ff' : 'white'};
                    flex:1;">${estLui ? '▶️ ' : ''}${_esc(j)}</span>
                <span style="font-size:.8rem;color:rgba(255,255,255,.5);">${nb} carte${nb > 1 ? 's' : ''}</span>
                ${unoWarn ? `<span style="color:#fbbf24;font-size:.8rem;font-weight:700;">${unoWarn}</span>` : ''}
                ${j !== _hostPseudo ? `
                <button data-cible="${_esc(j)}" class="uno-challenge-btn"
                    style="padding:4px 10px;background:rgba(239,68,68,.2);
                    border:1px solid rgba(239,68,68,.4);border-radius:8px;
                    color:#fca5a5;font-size:.72rem;cursor:pointer;font-family:inherit;">
                    Contester UNO
                </button>` : ''}
            </div>`;
    }).join('');

    // ── Accumulation ─────────────────────────────────
    const accu = accumulateur > 0
        ? `<div style="background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.3);
            border-radius:10px;padding:8px 14px;text-align:center;color:#fca5a5;font-weight:700;font-size:.88rem;">
            ⚠️ ${accumulateur} cartes à piocher pour ${_esc(tourActuel)}
           </div>`
        : '';

    // ── Choix couleur (si hôte joue) ─────────────────
    const choixCouleur = (attenteCouleur && _mainHote.length === 0 && _hostPseudo)
        ? _renderChoixCouleurInline() : '';

    cont.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:12px;padding:0 0 16px;">

            <!-- Header couleur + tour -->
            <div style="display:flex;align-items:center;justify-content:space-between;
                padding:12px 16px;border-radius:14px;
                background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);">
                <div style="display:flex;align-items:center;gap:10px;">
                    <div style="width:22px;height:22px;border-radius:50%;
                        background:${topColor};border:2px solid white;
                        box-shadow:0 0 10px ${topColor};flex-shrink:0;"></div>
                    <span style="font-size:.85rem;font-weight:700;color:white;">
                        Couleur active : <strong style="color:${topColor};">${_esc(couleurActive || '?')}</strong>
                    </span>
                </div>
                <span style="font-size:.78rem;color:rgba(255,255,255,.5);">
                    Tour : <strong style="color:#00d4ff;">${_esc(tourActuel)}</strong>
                </span>
            </div>

            <!-- Zone centrale : défausse + joueurs -->
            <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;">

                <!-- Défausse -->
                <div style="display:flex;flex-direction:column;align-items:center;gap:8px;flex-shrink:0;">
                    <div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;
                        color:rgba(255,255,255,.45);font-weight:700;">Défausse</div>
                    ${carteTopHtml}
                </div>

                <!-- Joueurs -->
                <div style="flex:1;min-width:200px;">
                    <div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;
                        color:rgba(255,255,255,.45);font-weight:700;margin-bottom:8px;">Joueurs</div>
                    ${joueursHtml}
                </div>
            </div>

            ${accu}
            ${choixCouleur}

        </div>`;

    // Brancher les boutons "Contester UNO"
    cont.querySelectorAll('.uno-challenge-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const cible = btn.dataset.cible;
            try { socket.send('HOST_ACTION', { action: 'uno:challenge_uno', data: { cible } }); }
            catch(e) { console.error('[UNO] challenge_uno:', e); }
        });
    });

    // Main hôte si hostJoue
    if (_hostPseudo && _mainHote.length > 0) {
        _renderMainHote();
    }
}

function _renderChoixCouleurInline() {
    return `
        <div id="uno-choix-couleur-inline"
            style="background:rgba(99,102,241,.12);border:1.5px solid rgba(99,102,241,.3);
            border-radius:14px;padding:14px 18px;text-align:center;">
            <div style="font-size:.85rem;font-weight:700;color:white;margin-bottom:12px;">
                🎨 Choisis la couleur active
            </div>
            <div style="display:flex;gap:12px;justify-content:center;">
                ${['rouge','vert','bleu','jaune'].map(c => `
                    <button data-couleur="${c}" class="uno-couleur-btn"
                        style="width:48px;height:48px;border-radius:50%;
                        background:${COULEUR_CSS[c]};border:3px solid rgba(255,255,255,.5);
                        cursor:pointer;transition:transform .15s;font-size:1.1rem;">
                        ${COULEUR_LABEL[c]}
                    </button>`).join('')}
            </div>
        </div>`;
}

function _renderMainHote() {
    let wrap = $('uno-main-hote');
    if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'uno-main-hote';
        wrap.style.cssText = `
            margin-top:14px;padding:14px 16px;
            background:rgba(139,92,246,.07);
            border:1px solid rgba(139,92,246,.25);border-radius:14px;`;
        const cont = $('uno-contenu');
        if (cont) cont.appendChild(wrap);
    }

    wrap.innerHTML = `
        <div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;
            color:rgba(139,92,246,.8);margin-bottom:10px;font-weight:700;">
            🎮 Ta main (${_hostPseudo})
        </div>`;

    const cartesDiv = document.createElement('div');
    cartesDiv.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;';

    _mainHote.forEach((carte, i) => {
        const jouable = _jouablesIdx.includes(i);
        const el = _renderCarte(carte, {
            jouable, petit: false, index: i,
            onClick: jouable ? _jouerCarteHote : null,
        });
        cartesDiv.appendChild(el);
    });

    wrap.appendChild(cartesDiv);

    // Bouton piocher
    const btnPioche = document.createElement('button');
    btnPioche.style.cssText = `
        margin-top:10px;padding:8px 18px;background:rgba(255,255,255,.08);
        border:1px solid rgba(255,255,255,.2);border-radius:10px;
        color:white;font-size:.82rem;font-weight:700;cursor:pointer;font-family:inherit;`;
    btnPioche.textContent = '📦 Piocher';
    btnPioche.onclick = () => {
        try { socket.send('PLAYER_ACTION', { action: 'uno:draw', data: {} }); }
        catch(e) { console.error('[UNO] draw hôte:', e); }
    };
    wrap.appendChild(btnPioche);

    // Bouton UNO si 2 cartes → anticiper
    if (_mainHote.length <= 2) {
        const btnUno = document.createElement('button');
        btnUno.style.cssText = `
            margin-top:10px;margin-left:8px;padding:8px 18px;
            background:rgba(239,68,68,.2);border:1.5px solid rgba(239,68,68,.4);
            border-radius:10px;color:#fca5a5;font-size:.82rem;font-weight:700;
            cursor:pointer;font-family:inherit;`;
        btnUno.textContent = '🔔 UNO !';
        btnUno.onclick = () => {
            try { socket.send('PLAYER_ACTION', { action: 'uno:say_uno', data: {} }); }
            catch(e) {}
        };
        wrap.appendChild(btnUno);
    }

    // Choix couleur si en attente
    if (_attenteCouleur && _etat?.tourActuel === _hostPseudo) {
        const coulDiv = document.createElement('div');
        coulDiv.style.cssText = 'margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;';
        coulDiv.innerHTML = `<span style="font-size:.82rem;color:rgba(255,255,255,.6);align-self:center;">Choisir couleur :</span>`;
        ['rouge','vert','bleu','jaune'].forEach(c => {
            const b = document.createElement('button');
            b.style.cssText = `width:38px;height:38px;border-radius:50%;
                background:${COULEUR_CSS[c]};border:3px solid rgba(255,255,255,.5);cursor:pointer;`;
            b.title = c;
            b.onclick = () => {
                try { socket.send('PLAYER_ACTION', { action: 'uno:choose_color', data: { couleur: c } }); }
                catch(e) {}
            };
            coulDiv.appendChild(b);
        });
        wrap.appendChild(coulDiv);
    }

    // Passer si drawPlayable non joué
    if (_drawPlayable !== null) {
        const btnPass = document.createElement('button');
        btnPass.style.cssText = `
            margin-top:10px;margin-left:8px;padding:8px 18px;
            background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);
            border-radius:10px;color:rgba(255,255,255,.6);font-size:.82rem;
            cursor:pointer;font-family:inherit;`;
        btnPass.textContent = '⏭️ Passer';
        btnPass.onclick = () => {
            _drawPlayable = null;
            try { socket.send('PLAYER_ACTION', { action: 'uno:pass', data: {} }); }
            catch(e) {}
        };
        wrap.appendChild(btnPass);
    }
}

function _jouerCarteHote(index, carte) {
    if (_attenteCouleur) return;
    try {
        socket.send('PLAYER_ACTION', { action: 'uno:play', data: { index } });
        _drawPlayable = null;
    } catch(e) { console.error('[UNO] play hôte:', e); }
}

function _renderVictoire(gagnant) {
    const cont = $('uno-contenu');
    if (!cont) return;
    const scores = _etat?.scores || {};
    const lignes = Object.entries(scores)
        .sort((a, b) => b[1] - a[1])
        .map(([nom, pts], i) => `
            <div style="display:flex;justify-content:space-between;align-items:center;
                padding:8px 14px;border-radius:10px;margin-bottom:5px;
                background:${nom === gagnant ? 'rgba(251,191,36,.15)' : 'rgba(255,255,255,.05)'};
                border:1px solid ${nom === gagnant ? 'rgba(251,191,36,.4)' : 'rgba(255,255,255,.1)'};">
                <span>${['🥇','🥈','🥉'][i] || (i+1)+'.'} ${_esc(nom)}</span>
                <span style="font-weight:800;color:#00d4ff;">${pts} pts</span>
            </div>`).join('');

    cont.innerHTML = `
        <div style="text-align:center;padding:20px 0;display:flex;flex-direction:column;gap:16px;">
            <div style="font-size:3rem;">🏆</div>
            <h2 style="margin:0;font-size:1.3rem;color:#fbbf24;">
                ${_esc(gagnant)} remporte la partie !
            </h2>
            <div style="max-width:360px;margin:0 auto;width:100%;">${lignes}</div>
            <button id="uno-rejouer"
                style="padding:12px 28px;background:linear-gradient(135deg,#6a5af9,#8a2be2);
                border:none;border-radius:12px;color:white;font-size:.95rem;font-weight:700;
                cursor:pointer;font-family:inherit;margin-top:8px;">
                🔄 Rejouer
            </button>
        </div>`;

    $('uno-rejouer')?.addEventListener('click', () => {
        try { socket.send('HOST_ACTION', { action: 'uno:load', data: {} }); }
        catch(e) {}
    });
}

// ─────────────────────────────────────────────────────
// CHOIX COULEUR (délégation events DOM)
// ─────────────────────────────────────────────────────

function _branchementsChoixCouleur() {
    document.addEventListener('click', e => {
        const btn = e.target.closest('.uno-couleur-btn');
        if (!btn) return;
        const couleur = btn.dataset.couleur;
        if (!couleur) return;
        try { socket.send('PLAYER_ACTION', { action: 'uno:choose_color', data: { couleur } }); }
        catch(err) {}
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
            _etat = { ..._etat, ...payload, gagnant: payload.gagnant };
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
    li.style.cssText = 'padding:4px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:.8rem;';
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
        <div style="margin-top:14px;background:rgba(0,0,0,.2);border-radius:12px;
            padding:12px 14px;max-height:200px;overflow-y:auto;">
            <div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;
                color:rgba(255,255,255,.4);margin-bottom:6px;font-weight:700;">Journal des actions</div>
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
    _branchementsChoixCouleur();

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