// /js/modules/undercover_hote.js  (undercover.js)
// ============================================================
// 🕵️ UNDERCOVER_HOTE — Hôte : tirage → distribution → débat → vote
// ============================================================
// FLUX :
//   Confirmer  → initialiserPartie() → afficherEcranDistribution()
//   Chaque joueur retourne sa carte (cliquable uniquement par son proprio)
//   Tous prêts → demarrerDebat() → phase description
//   Hôte clique "Passer au vote" → ouvrirVote()
//   Votes reçus → eliminerJoueur() → vérification fin ou nouveau tour
// ============================================================

import { GameState } from '../core/state.js';
import { signalDemarrage } from '../core/signal.js';


// ──────────────────────────────────────────────────────────────
// 🔑 CLÉS LOCALSTORAGE
// ──────────────────────────────────────────────────────────────

function getSid() {
    return localStorage.getItem('minigame_partie_session_id') || '';
}
const cleQ = () => `partie_question_${getSid()}`;
const cleE = () => `partie_etat_${getSid()}`;
const cleS = () => `partie_scores_${getSid()}`;


// ──────────────────────────────────────────────────────────────
// 📂 CHARGEMENT DU JSON + TIRAGE
// ──────────────────────────────────────────────────────────────

const FALLBACK_MOTS = [
    { Civil: 'Chien',  Undercover: 'Loup',    Thème: 'Animaux' },
    { Civil: 'Café',   Undercover: 'Thé',     Thème: 'Cuisine' },
    { Civil: 'Plage',  Undercover: 'Piscine', Thème: 'Lieux'   },
];

async function chargerMotsJSON() {
    try {
        const res = await fetch('./data/undercover.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data) || !data.length) throw new Error('JSON vide');
        return data;
    } catch (err) {
        console.warn('[UC-HOTE] Fallback mots.', err.message);
        return FALLBACK_MOTS;
    }
}

function tirerMotsAleatoires(tableau) {
    const ligne = tableau[Math.floor(Math.random() * tableau.length)];
    return { civil: ligne['Civil'] ?? '', undercover: ligne['Undercover'] ?? '', theme: ligne['Thème'] ?? '' };
}


// ──────────────────────────────────────────────────────────────
// 🎲 ATTRIBUTION DES RÔLES (Fisher-Yates)
// ──────────────────────────────────────────────────────────────

function attribuerRoles(joueurs, nbUC, nbMW) {
    const total  = joueurs.length;
    const nUC    = Math.min(nbUC, Math.floor(total / 2));
    const nMW    = Math.min(nbMW, total - nUC - 1);
    const nCivil = total - nUC - nMW;

    const pool = [
        ...Array(nCivil).fill('Civil'),
        ...Array(nUC).fill('Undercover'),
        ...Array(nMW).fill('MisterWhite'),
    ];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const roles = {};
    joueurs.forEach((j, i) => { roles[j] = pool[i]; });
    console.log('[UC-HOTE] Rôles :', roles);
    return roles;
}


// ──────────────────────────────────────────────────────────────
// 📤 PUBLICATION D'ÉTAT
// ──────────────────────────────────────────────────────────────

export function publierEtat(etat) {
    const sid = getSid();
    if (sid) localStorage.setItem(cleE(), etat);
}

export function publierEtatJeu({ phase, roles, mots, theme, joueursEnJeu, voteOuvert, elimine, finMessage, finGagnant }) {
    const sid = getSid();
    if (!sid) return;
    localStorage.setItem(cleQ(), JSON.stringify({
        phase, roles: roles || {}, mots: mots || { civil: '', undercover: '' },
        theme: theme || '', joueursEnJeu: joueursEnJeu || [],
        voteOuvert: voteOuvert || false, elimine: elimine || null,
        finMessage: finMessage || null, finGagnant: finGagnant || null,
        ts: Date.now(),
    }));
}

function _pub(phase) {
    publierEtatJeu({
        phase, roles: S.roles, mots: S.mots, theme: S.theme,
        joueursEnJeu: S.joueursEnJeu, voteOuvert: S.voteOuvert,
        elimine: S.elimine, finMessage: S.finMessage, finGagnant: S.finGagnant,
    });
}


// ──────────────────────────────────────────────────────────────
// 🧠 STATE INTERNE
// ──────────────────────────────────────────────────────────────

const S = {
    roles: {}, mots: { civil: '', undercover: '' }, theme: '',
    joueursEnJeu: [], voteOuvert: false, elimine: null,
    finMessage: null, finGagnant: null,
    _rolesVus: new Set(),
    _stopEcoute: null,
    _stopEcouteVotes: null,
    _pseudoHote: '',
    _votes: {},          // { pseudo: cible } pour ce tour
    _elimines: [],       // historique des éliminés
    _voteRoundTs: 0,     // timestamp d'ouverture du vote — filtre les anciens votes
    _partieTs: 0,        // timestamp de démarrage de la partie — filtre tous les résidus
};

export function getState() { return { ...S }; }


// ──────────────────────────────────────────────────────────────
// 🚀 INITIALISATION
// ──────────────────────────────────────────────────────────────

export async function initialiserPartie({ joueurs, nbUndercover = 1, nbMisterWhite = 0 }) {
    const tableau    = await chargerMotsJSON();
    S.mots           = tirerMotsAleatoires(tableau);
    S.theme          = S.mots.theme;
    S.roles          = attribuerRoles(joueurs, nbUndercover, nbMisterWhite);
    S.joueursEnJeu   = [...joueurs];
    S.voteOuvert     = false;
    S.elimine        = null;
    S.finMessage     = null;
    S.finGagnant     = null;
    S._rolesVus      = new Set();
    S._votes         = {};
    S._elimines      = [];
    S._pseudoHote    = joueurs[0];
    S._voteRoundTs   = 0;

    // ── Purger TOUTES les clés de session résiduelles AVANT de horodater ──
    // Cela évite que des role_vu ou votes d'anciennes parties soient comptés
    _purgerToutesLesReponsesSession();

    // ── Horodater le démarrage — tout item sans ts >= _partieTs sera ignoré ──
    S._partieTs = Date.now();

    GameState.jeuActuel = 'undercover';
    GameState.joueurs   = [...joueurs];
    if (!GameState.scores) GameState.scores = {};
    joueurs.forEach(j => { if (GameState.scores[j] === undefined) GameState.scores[j] = 0; });

    _pub('distribution');
    console.log('[UC-HOTE] ✅ Partie initialisée | Mots:', S.mots, '| partieTs:', S._partieTs);
}

// Purge complète de toutes les clés partie_reponses_* (résidus d'anciennes parties)
function _purgerToutesLesReponsesSession() {
    const cles = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith('partie_reponses_')) cles.push(k);
    }
    cles.forEach(k => localStorage.removeItem(k));
    if (cles.length) console.log(`[UC-INIT] 🧹 ${cles.length} clé(s) partie_reponses_* supprimée(s)`);
}


// ──────────────────────────────────────────────────────────────
// 🃏 ÉCRAN DE DISTRIBUTION — MULTI-CARTES
// ──────────────────────────────────────────────────────────────

export function afficherEcranDistribution(pseudoHote, onTousVus) {
    _css();

    const joueurs = S.joueursEnJeu;
    const total   = joueurs.length;

    const _carteHTML = (pseudo) => {
        const estMoi = pseudo === pseudoHote;
        const role   = S.roles[pseudo];
        const cfg    = _cfg(role);
        const mot    = role === 'MisterWhite' ? null : role === 'Undercover' ? S.mots.undercover : S.mots.civil;

        const motFront = mot !== null
            ? `<div class="ucd-mot-wrap"><span class="ucd-mot-label">TON MOT</span><span class="ucd-mot-val">${_h(mot)}</span></div>`
            : `<div class="ucd-mot-wrap ucd-mot-vide"><span class="ucd-mot-label">TON MOT</span><span class="ucd-mot-val">???</span><span class="ucd-mot-hint">Pas de mot — improvise !</span></div>`;

        const themeFront = S.theme ? `<div class="ucd-card-theme">🏷️ ${_h(S.theme)}</div>` : '';

        const lockOverlay = estMoi ? '' : `
            <div class="ucd-lock-overlay">
                <span class="ucd-lock-icon">🔒</span>
                <span class="ucd-lock-txt">Réservée à<br><strong>${_h(pseudo)}</strong></span>
            </div>`;

        return `
        <div class="ucd-slot" data-pseudo="${_h(pseudo)}">
            <div class="ucd-slot-name ${estMoi ? 'ucd-slot-name--moi' : ''}">
                ${estMoi ? '👤 Toi' : `👤 ${_h(pseudo)}`}
            </div>

            <div class="ucd-scene ${estMoi ? 'ucd-scene--moi' : 'ucd-scene--autre'}"
                 id="ucd-scene-${_slug(pseudo)}"
                 ${estMoi ? `role="button" tabindex="0" aria-label="Retourne ta carte"` : `aria-hidden="true"`}>

                <div class="ucd-card" id="ucd-card-${_slug(pseudo)}">

                    <!-- DOS -->
                    <div class="ucd-face ucd-back">
                        <div class="ucd-back-inner">
                            <span class="ucd-back-logo">🕵️</span>
                            <span class="ucd-back-label">UNDERCOVER</span>
                            <div class="ucd-back-hatch"></div>
                        </div>
                        ${estMoi ? `<span class="ucd-back-hint">Appuie pour révéler</span>` : ''}
                        ${lockOverlay}
                    </div>

                    <!-- FACE -->
                    <div class="ucd-face ucd-front ucd-front--${cfg.cls}">
                        <div class="ucd-front-glow" style="background:${cfg.glow}"></div>
                        <div class="ucd-front-inner">
                            <div class="ucd-role-icon">${cfg.icon}</div>
                            <div class="ucd-role-name" style="color:${cfg.color}">${cfg.label}</div>
                            <div class="ucd-divider"></div>
                            ${motFront}
                            ${themeFront}
                        </div>
                    </div>

                </div>
            </div>

            ${estMoi ? `
            <div class="ucd-confirm" id="ucd-confirm-${_slug(pseudo)}" hidden>
                <p class="ucd-conseil">${cfg.conseil}</p>
                <button class="ucd-btn-ok" id="ucd-btn-ok-${_slug(pseudo)}">✅ C'est noté</button>
            </div>` : ''}

            <div class="ucd-statut" id="ucd-statut-${_slug(pseudo)}">⏳</div>
        </div>`;
    };

    const conteneur = document.getElementById('undercover-distribution');
    if (!conteneur) {
        console.error('[UC-HOTE] #undercover-distribution introuvable dans le DOM !');
        return;
    }

    conteneur.hidden        = false;
    conteneur.style.display = 'block';
    conteneur.innerHTML = `
        <div class="ucd-wrap">

            <div class="ucd-header">
                <h2 class="ucd-title">🃏 Distribution des rôles</h2>
                <p class="ucd-sub">
                    Chaque joueur retourne <strong>uniquement sa carte</strong>.
                    ${S.theme ? `<br>Thème : <strong class="ucd-theme-pill">🏷️ ${_h(S.theme)}</strong>` : ''}
                </p>
            </div>

            <div class="ucd-grille" id="ucd-grille">
                ${joueurs.map(j => _carteHTML(j)).join('')}
            </div>

            <div class="ucd-prog-section">
                <div class="ucd-prog-label">
                    <span>Joueurs prêts</span>
                    <span id="ucd-compteur">0 / ${total}</span>
                </div>
                <div class="ucd-prog-bar">
                    <div class="ucd-prog-fill" id="ucd-prog-fill" style="width:0%"></div>
                </div>
            </div>

            <button id="btn-ucd-lancer" class="ucd-btn-lancer" disabled>
                🎤 Lancer le débat
            </button>

        </div>`;

    _branquerCarte(pseudoHote);
    _ecouterRolesVus();

    document.getElementById('btn-ucd-lancer')?.addEventListener('click', () => {
        if (S._stopEcoute) { S._stopEcoute(); S._stopEcoute = null; }
        demarrerDebat();
        if (typeof onTousVus === 'function') onTousVus();
    });
}

function _branquerCarte(pseudo) {
    const scene    = document.getElementById(`ucd-scene-${_slug(pseudo)}`);
    const card     = document.getElementById(`ucd-card-${_slug(pseudo)}`);
    const confirm  = document.getElementById(`ucd-confirm-${_slug(pseudo)}`);
    const btnOk    = document.getElementById(`ucd-btn-ok-${_slug(pseudo)}`);

    if (!scene || !card) {
        console.warn(`[UC-HOTE] Carte introuvable pour ${pseudo}`);
        return;
    }
    if (scene.dataset.locked === 'true') return;

    let flipped = false;

    const flip = () => {
        if (flipped) return;
        flipped = true;
        card.classList.add('ucd-card--flipped');
        if (confirm) setTimeout(() => {
            confirm.hidden = false;
            requestAnimationFrame(() => confirm.classList.add('ucd-confirm--show'));
        }, 660);
    };

    scene.addEventListener('click',   flip);
    scene.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });

    btnOk?.addEventListener('click', () => {
        if (S._rolesVus.has(pseudo)) return; // déjà compté
        ajouterActionInvite(pseudo, 'role_vu', {});
        S._rolesVus.add(pseudo);
        _majProgression(); // lit S.joueursEnJeu.length directement
        if (confirm) confirm.innerHTML = `<p class="ucd-vu-msg">✅ Rôle mémorisé !</p>`;
        card.classList.add('ucd-card--vu');
    });
}

function _majProgression() {
    // Source de vérité : S._rolesVus (Set en mémoire) et S.joueursEnJeu.length
    // Ne jamais lire depuis le DOM — toujours écrire vers le DOM
    const nb    = S._rolesVus.size;
    const total = S.joueursEnJeu.length;
    const pct   = total > 0 ? Math.round((nb / total) * 100) : 0;

    // ── Barre dynamique dans le bloc distribution injecté ─────────────────
    const fill     = document.getElementById('ucd-prog-fill');
    const compteur = document.getElementById('ucd-compteur');
    const btnL     = document.getElementById('btn-ucd-lancer');
    if (fill)     fill.style.width     = `${pct}%`;
    if (compteur) compteur.textContent = `${nb} / ${total}`;

    // ── Éléments persistants dans index.html (toujours mis à jour) ────────
    const countEl = document.getElementById('uc-roles-vus-count');
    const totalEl = document.getElementById('uc-roles-total-invites');
    const suiviEl = document.getElementById('uc-suivi-invites');
    const barEl   = document.getElementById('uc-invites-status');

    if (countEl) countEl.textContent = String(nb);
    if (totalEl) totalEl.textContent = String(total);
    if (suiviEl) suiviEl.hidden = false;
    if (barEl) {
        barEl.innerHTML = `
            <div style="width:100%;height:4px;background:rgba(255,255,255,.08);border-radius:2px;margin-top:8px">
                <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,#6a5af9,#4ade80);border-radius:2px;transition:width .4s"></div>
            </div>`;
    }

    // ── Badges ✅ sur les cartes joueurs ──────────────────────────────────
    S._rolesVus.forEach(p => {
        const el = document.getElementById(`ucd-statut-${_slug(p)}`);
        if (el) { el.textContent = '✅'; el.classList.add('ucd-statut--ok'); }
    });

    // ── Activer le bouton Lancer quand tout le monde est prêt ─────────────
    if (nb >= total && total > 0 && btnL) {
        btnL.disabled = false;
        btnL.classList.add('ucd-btn-lancer--ready');
    }
}

function _ecouterRolesVus() {
    if (S._stopEcoute) { S._stopEcoute(); S._stopEcoute = null; }
    const partieTs = S._partieTs; // timestamp de démarrage — filtre les résidus d'anciennes parties

    const traiter = (raw) => {
        if (!raw) return;
        let arr; try { arr = JSON.parse(raw); } catch { return; }
        if (!Array.isArray(arr)) return;
        arr.forEach(item => {
            if (item.action !== 'role_vu') return;
            // Rejeter tout item sans timestamp ou antérieur au démarrage de la partie
            if ((item.ts || 0) < partieTs) return;
            // Rejeter les joueurs absents de la partie en cours (résidus d'autres parties)
            if (!S.joueursEnJeu.includes(item.pseudo)) return;
            // Anti-doublon en mémoire (Set)
            if (S._rolesVus.has(item.pseudo)) return;
            S._rolesVus.add(item.pseudo);
            _majProgression();
        });
    };

    const scan = () => {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k?.startsWith('partie_reponses_')) traiter(localStorage.getItem(k));
        }
    };

    const handler = e => { if (e.key?.startsWith('partie_reponses_')) scan(); };
    window.addEventListener('storage', handler);
    const iv = setInterval(scan, 600);
    S._stopEcoute = () => { window.removeEventListener('storage', handler); clearInterval(iv); };
    scan();
}

// ──────────────────────────────────────────────────────────────
// 🎤 PHASE DÉBAT (description)
// ──────────────────────────────────────────────────────────────

export function demarrerDebat() {
    if (S._stopEcoute)      { S._stopEcoute();      S._stopEcoute = null; }
    if (S._stopEcouteVotes) { S._stopEcouteVotes(); S._stopEcouteVotes = null; }
    S.voteOuvert  = false;
    S._votes      = {};
    S._voteRoundTs = 0;
    _pub('debat');
    _afficherPanneauDebat();
}

function _afficherPanneauDebat() {
    const section = document.getElementById('undercover');
    if (!section) return;

    section.hidden        = false;
    section.style.display = 'block';

    const distrib = document.getElementById('undercover-distribution');
    if (distrib) { distrib.hidden = true; distrib.style.display = 'none'; }

    document.getElementById('undercover-phase-texte')
        ?.replaceChildren(document.createTextNode('🗣️ Phase de débat — chacun décrit son mot en 1 mot !'));

    const themeHote = document.getElementById('uc-theme-hote');
    const themeVal  = document.getElementById('uc-theme-valeur');
    if (themeHote) themeHote.hidden = false;
    if (themeVal)  themeVal.textContent = S.theme;

    _afficherListeJoueurs();

    // Masquer tout ce qui concerne le vote
    const votesRecap = document.getElementById('uc-votes-recap');
    if (votesRecap) votesRecap.hidden = true;
    const voteWrap = document.getElementById('uc-vote-hote-wrap');
    if (voteWrap) { voteWrap.hidden = true; voteWrap.innerHTML = ''; }
    const votesDetail = document.getElementById('uc-votes-detail');
    if (votesDetail) votesDetail.innerHTML = '';

    _bindBtnVoter('🗳️ Passer au vote', () => ouvrirVote());
}

// ── Helper : remplace #undercover-voter par un clone propre et y attache UN seul handler ──
function _bindBtnVoter(label, handler) {
    const old = document.getElementById('undercover-voter');
    if (!old) return;
    const btn = old.cloneNode(false); // clone sans enfants ni listeners
    btn.id          = 'undercover-voter';
    btn.className   = old.className;
    btn.textContent = label;
    btn.style.display = 'block';
    btn.disabled    = false;
    btn.addEventListener('click', handler);
    old.replaceWith(btn);
}

function _afficherListeJoueurs() {
    const conteneur = document.getElementById('undercover-joueurs');
    if (!conteneur) return;

    const tous = Object.keys(S.roles);
    conteneur.innerHTML = tous.map(pseudo => {
        const enJeu = S.joueursEnJeu.includes(pseudo);
        const role  = S.roles[pseudo];
        return `
            <div class="uc-joueur-item ${enJeu ? '' : 'uc-joueur-elimine'}">
                <span class="uc-j-badge">${enJeu ? '🟢' : '🔴'}</span>
                <span class="uc-j-nom">${_h(pseudo)}</span>
                ${!enJeu ? `<span class="uc-j-role">${_labelRole(role)}</span>` : ''}
            </div>`;
    }).join('');
}


// ──────────────────────────────────────────────────────────────
// 🗳️ PHASE DE VOTE
// ──────────────────────────────────────────────────────────────

export function ouvrirVote() {
    // Arrêter toutes les écoutes actives
    if (S._stopEcoute)      { S._stopEcoute();      S._stopEcoute = null; }
    if (S._stopEcouteVotes) { S._stopEcouteVotes(); S._stopEcouteVotes = null; }

    // ── 1. Reset complet de l'état vote ──────────────────────────────────
    S.voteOuvert   = true;
    S._votes       = {};

    // ── 2. Purger TOUTES les clés partie_reponses_* de leurs votes ───────
    _purgerTousLesVotes();

    // ── 3. Timestamp APRÈS la purge — tout vote reçu après est valide ────
    S._voteRoundTs = Date.now();

    // ── 4. Publier la phase vote aux invités ──────────────────────────────
    _pub('vote');

    // ── 5. Afficher le panneau ────────────────────────────────────────────
    _afficherPanneauVote();
}

function _purgerTousLesVotes() {
    const cles = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith('partie_reponses_')) cles.push(k);
    }
    let nbPurges = 0;
    cles.forEach(cle => {
        let actions = [];
        try { actions = JSON.parse(localStorage.getItem(cle) || '[]'); } catch { return; }
        if (!Array.isArray(actions)) return;
        const apres = actions.filter(a => a.action !== 'vote');
        nbPurges += actions.length - apres.length;
        localStorage.setItem(cle, JSON.stringify(apres));
    });
    console.log(`[UC-VOTE] 🧹 ${nbPurges} vote(s) purgé(s) dans ${cles.length} clé(s)`);
}

function _afficherPanneauVote() {
    // Phase texte
    const phaseTexte = document.getElementById('undercover-phase-texte');
    if (phaseTexte) phaseTexte.textContent = '🗳️ Phase de vote — qui suspectes-tu ?';

    // Reset compteur
    const votesRecap  = document.getElementById('uc-votes-recap');
    const votesCount  = document.getElementById('uc-votes-recus-count');
    const votesTotal  = document.getElementById('uc-votes-total');
    const votesDetail = document.getElementById('uc-votes-detail');
    if (votesRecap)  votesRecap.hidden = false;
    if (votesCount)  votesCount.textContent = '0';
    if (votesTotal)  votesTotal.textContent = String(S.joueursEnJeu.length);
    if (votesDetail) votesDetail.innerHTML  = '';

    // ── Zone vote hôte : reconstruire entièrement le conteneur ────────────
    const voteWrap = document.getElementById('uc-vote-hote-wrap');
    if (voteWrap) {
        voteWrap.hidden = false;
        // Reconstruire innerHTML → garantit 0 listener résiduel sur les boutons
        voteWrap.innerHTML = `
            <div class="uc-section-label">Ton vote (hôte)</div>
            <div id="uc-vote-hote-select" class="uc-vote-hote-select"></div>`;

        const selectEl  = document.getElementById('uc-vote-hote-select');
        const candidats = S.joueursEnJeu.filter(j => j !== S._pseudoHote);

        candidats.forEach(j => {
            const btn = document.createElement('button');
            btn.type        = 'button';
            btn.className   = 'uc-vote-btn';
            btn.textContent = `👤 ${j}`;
            // Listener unique directement sur le bouton — pas de délégation
            btn.addEventListener('click', () => {
                if (S._votes[S._pseudoHote]) return; // déjà voté
                _enregistrerVoteHote(j);
                // Feedback visuel immédiat
                selectEl.querySelectorAll('.uc-vote-btn').forEach(b => {
                    b.disabled = true;
                    b.classList.toggle('uc-vote-btn--choisi', b.textContent.trim() === `👤 ${j}`);
                });
            });
            selectEl.appendChild(btn);
        });
    }

    // Bouton "Valider les votes" — clone propre
    _bindBtnVoter('✅ Valider les votes', () => _validerVotes());

    // Démarrer l'écoute des votes invités
    _ecouterVotesInvites();
}

function _enregistrerVoteHote(cible) {
    if (S._votes[S._pseudoHote]) return;
    S._votes[S._pseudoHote] = cible;

    // Persister avec ts >= _voteRoundTs
    const sid = getSid();
    if (sid) {
        const cle = `partie_reponses_${sid}`;
        let actions = [];
        try { actions = JSON.parse(localStorage.getItem(cle) || '[]'); } catch {}
        if (!Array.isArray(actions)) actions = [];
        actions = actions.filter(a => !(a.pseudo === S._pseudoHote && a.action === 'vote'));
        actions.push({ pseudo: S._pseudoHote, action: 'vote', data: { cible }, ts: Date.now() });
        localStorage.setItem(cle, JSON.stringify(actions));
    }
    _mettreAJourRecapVotes();
    console.log(`[UC-VOTE] 🗳️ Hôte (${S._pseudoHote}) → ${cible}`);
}

function _mettreAJourRecapVotes() {
    // Ne compter que les votes de joueurs encore en jeu (filtre défensif)
    const votesValides = Object.fromEntries(
        Object.entries(S._votes).filter(([pseudo, cible]) =>
            S.joueursEnJeu.includes(pseudo) && S.joueursEnJeu.includes(cible)
        )
    );
    const nb    = Object.keys(votesValides).length;
    const total = S.joueursEnJeu.length;

    const countEl  = document.getElementById('uc-votes-recus-count');
    const totalEl  = document.getElementById('uc-votes-total');
    const detailEl = document.getElementById('uc-votes-detail');

    if (countEl) countEl.textContent = String(nb);
    if (totalEl) totalEl.textContent = String(total);
    if (!detailEl) return;

    const tally = {};
    Object.values(votesValides).forEach(c => { tally[c] = (tally[c] || 0) + 1; });

    detailEl.innerHTML = Object.entries(tally)
        .sort((a, b) => b[1] - a[1])
        .map(([nom, n]) => `
            <div class="uc-vote-tally">
                <div class="uc-vt-bar-bg">
                    <div class="uc-vt-bar-fill" style="width:${Math.round((n / total) * 100)}%"></div>
                </div>
                <div class="uc-vt-content">
                    <span class="uc-vt-nom">${_h(nom)}</span>
                    <span class="uc-vt-count">${n} vote${n > 1 ? 's' : ''}</span>
                </div>
            </div>`)
        .join('');
}

function _ecouterVotesInvites() {
    const roundTs = S._voteRoundTs;
    let lastScan  = 0;

    const traiter = (raw) => {
        if (!raw) return;
        let arr; try { arr = JSON.parse(raw); } catch { return; }
        if (!Array.isArray(arr)) return;
        arr.forEach(item => {
            if (item.action !== 'vote') return;
            if ((item.ts || 0) < roundTs) return;          // antérieur à ce round
            if ((item.ts || 0) < S._partieTs) return;      // antérieur à cette partie
            if (!S.joueursEnJeu.includes(item.pseudo)) return; // joueur inconnu / ancienne partie
            if (S._votes[item.pseudo]) return;              // déjà compté
            if (!item.data?.cible) return;
            // Vérifier que la cible est un joueur encore en jeu
            if (!S.joueursEnJeu.includes(item.data.cible)) return;
            S._votes[item.pseudo] = item.data.cible;
            _mettreAJourRecapVotes();
        });
    };

    const scan = () => {
        const now = Date.now();
        if (now - lastScan < 200) return; // anti-rebond
        lastScan = now;
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k?.startsWith('partie_reponses_')) traiter(localStorage.getItem(k));
        }
    };

    const handler = e => { if (e.key?.startsWith('partie_reponses_')) scan(); };
    window.addEventListener('storage', handler);
    const iv = setInterval(scan, 600);

    S._stopEcouteVotes = () => {
        window.removeEventListener('storage', handler);
        clearInterval(iv);
    };

    scan(); // lecture immédiate
}

function _validerVotes() {
    if (Object.keys(S._votes).length === 0) {
        alert('Aucun vote reçu ! Attends que les joueurs votent.');
        return;
    }
    if (S._stopEcouteVotes) { S._stopEcouteVotes(); S._stopEcouteVotes = null; }

    const tally = {};
    Object.values(S._votes).forEach(c => { tally[c] = (tally[c] || 0) + 1; });
    const [elimine] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
    console.log('[UC-VOTE] Tally final :', tally, '→ éliminé :', elimine);
    eliminerJoueur(elimine);
}


// ──────────────────────────────────────────────────────────────
// ❌ ÉLIMINATION ET FIN
// ──────────────────────────────────────────────────────────────

export function eliminerJoueur(pseudo) {
    if (!pseudo) return;
    S.elimine      = pseudo;
    S.joueursEnJeu = S.joueursEnJeu.filter(j => j !== pseudo);
    S._elimines.push(pseudo);
    S.voteOuvert   = false;
    S._votes       = {};
    console.log(`[UC-HOTE] ❌ Éliminé : ${pseudo} (${S.roles[pseudo]})`);

    if (S.roles[pseudo] === 'MisterWhite') {
        _pub('elimination');
        _afficherDevinetteMW(pseudo);
        return;
    }

    const fin = _checkFin();
    if (fin) _terminer(fin.message, fin.gagnant);
    else     { _pub('elimination'); _afficherElimination(pseudo); }
}

function _afficherElimination(pseudo) {
    const phaseTexte = document.getElementById('undercover-phase-texte');
    if (phaseTexte) {
        phaseTexte.innerHTML = `
            ❌ <strong>${_h(pseudo)}</strong> a été éliminé !
            <br><small style="color:rgba(255,255,255,.55)">Rôle : ${_labelRole(S.roles[pseudo])}</small>`;
    }
    _afficherListeJoueurs();

    const voteWrap = document.getElementById('uc-vote-hote-wrap');
    if (voteWrap) voteWrap.hidden = true;
    const votesRecap = document.getElementById('uc-votes-recap');
    if (votesRecap) votesRecap.hidden = true;

    _bindBtnVoter('🎤 Nouveau tour de description', () => demarrerDebat());
}

function _afficherDevinetteMW(pseudo) {
    const phaseTexte = document.getElementById('undercover-phase-texte');
    if (phaseTexte) {
        phaseTexte.innerHTML = `
            🎩 <strong>${_h(pseudo)}</strong> (Mister White) est éliminé !<br>
            Il peut tenter de deviner le mot des Civils.`;
    }
    _afficherListeJoueurs();

    const votesRecap = document.getElementById('uc-votes-recap');
    if (votesRecap) votesRecap.hidden = true;

    const voteWrap = document.getElementById('uc-vote-hote-wrap');
    if (voteWrap) {
        voteWrap.hidden = false;
        voteWrap.innerHTML = `
            <div class="uc-section-label">🎩 Devinette Mister White</div>
            <div style="display:flex;gap:8px;margin-top:8px;">
                <input id="uc-mw-input" class="input-primary" type="text"
                    placeholder="Quel est le mot Civil ?" autocomplete="off" style="flex:1">
                <button id="uc-mw-btn" class="btn-primary">🎯 Valider</button>
            </div>`;
        document.getElementById('uc-mw-btn')?.addEventListener('click', () => {
            const rep = document.getElementById('uc-mw-input')?.value?.trim();
            if (rep) verifierDevinetteMW(pseudo, rep);
        });
    }

    const btnVoter = document.getElementById('undercover-voter');
    if (btnVoter) btnVoter.style.display = 'none';
}

export function verifierDevinetteMW(pseudo, reponse) {
    if (S.roles[pseudo] !== 'MisterWhite') return;
    const ok = (reponse || '').trim().toLowerCase() === (S.mots.civil || '').trim().toLowerCase();
    if (ok) _terminer(`🎩 ${pseudo} (Mister White) a deviné le mot Civil ! Il gagne !`, 'MisterWhite');
    else {
        const fin = _checkFin();
        if (fin) _terminer(fin.message, fin.gagnant);
        else { _pub('elimination'); _afficherElimination(pseudo); }
    }
}

function _checkFin() {
    const enJeu   = S.joueursEnJeu;
    const nbUC    = enJeu.filter(j => S.roles[j] === 'Undercover').length;
    const nbCivil = enJeu.filter(j => S.roles[j] === 'Civil').length;
    const nbMW    = enJeu.filter(j => S.roles[j] === 'MisterWhite').length;
    if (nbUC === 0 && nbMW === 0) return { message: '🎉 Les Civils ont gagné !', gagnant: 'Civils' };
    if (nbUC >= nbCivil)           return { message: '🕵️ Les Undercovers ont gagné !', gagnant: 'Undercovers' };
    return null;
}

function _terminer(message, gagnant) {
    S.finMessage = message;
    S.finGagnant = gagnant;
    _pub('fin');
    _attribuerPoints(gagnant);
    publierScores(GameState.scores);

    const phaseTexte = document.getElementById('undercover-phase-texte');
    if (phaseTexte) phaseTexte.innerHTML = `<strong>${_h(message)}</strong>`;

    const btnVoter = document.getElementById('undercover-voter');
    if (btnVoter) btnVoter.style.display = 'none';

    const voteWrap = document.getElementById('uc-vote-hote-wrap');
    if (voteWrap) voteWrap.hidden = true;
    const votesRecap = document.getElementById('uc-votes-recap');
    if (votesRecap) votesRecap.hidden = true;

    // Révéler tous les rôles + mots
    const joueursList = document.getElementById('undercover-joueurs');
    if (joueursList) {
        joueursList.innerHTML = Object.entries(S.roles).map(([p, r]) => {
            const mot = r === 'Civil' ? S.mots.civil : r === 'Undercover' ? S.mots.undercover : '???';
            const gagne = (gagnant === 'Civils' && r === 'Civil')
                       || (gagnant === 'Undercovers' && r === 'Undercover')
                       || (gagnant === 'MisterWhite' && r === 'MisterWhite');
            return `
                <div class="uc-joueur-item uc-joueur-fin ${gagne ? 'uc-joueur-gagnant' : ''}">
                    <span class="uc-j-badge">${gagne ? '🏆' : '😔'}</span>
                    <span class="uc-j-nom">${_h(p)}</span>
                    <span class="uc-j-role">${_labelRole(r)}</span>
                    <span class="uc-j-mot">${_h(mot)}</span>
                </div>`;
        }).join('');
    }

    console.log(`[UC-HOTE] 🏁 Fin — ${gagnant}`);
}

function _attribuerPoints(gagnant) {
    Object.keys(S.roles).forEach(p => {
        const r = S.roles[p];
        let pts = 0;
        if (gagnant === 'Civils'       && r === 'Civil')        pts = 3;
        if (gagnant === 'Undercovers'  && r === 'Undercover')   pts = 5;
        if (gagnant === 'MisterWhite'  && r === 'MisterWhite')  pts = 4;
        if (pts > 0) crediterPoints(p, pts);
    });
}


// ──────────────────────────────────────────────────────────────
// 📡 ACTIONS INVITÉS
// ──────────────────────────────────────────────────────────────

export function ecouterActionsInvites(onAction) {
    const vus = new Set();
    const traiter = (raw) => {
        if (!raw) return;
        let arr; try { arr = JSON.parse(raw); } catch { return; }
        if (!Array.isArray(arr)) return;
        arr.forEach(item => {
            const k = `${item.pseudo}_${item.action}_${item.ts}`;
            if (vus.has(k)) return; vus.add(k);
            try { onAction(item); } catch(e) { console.error(e); }
        });
    };
    const scan = () => {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k?.startsWith('partie_reponses_')) traiter(localStorage.getItem(k));
        }
    };
    const handler = e => { if (e.key?.startsWith('partie_reponses_')) scan(); };
    window.addEventListener('storage', handler);
    const iv = setInterval(scan, 500);
    return () => { window.removeEventListener('storage', handler); clearInterval(iv); };
}

export function ajouterActionInvite(pseudo, action, data = {}) {
    const sid = getSid();
    const cle = sid ? `partie_reponses_${sid}` : null;
    if (!cle) return;
    let actions = [];
    try { actions = JSON.parse(localStorage.getItem(cle) || '[]'); } catch {}
    if (!Array.isArray(actions)) actions = [];
    // Dédupliquer : un seul role_vu par pseudo, un seul vote par pseudo
    actions = actions.filter(a => !(a.pseudo === pseudo && a.action === action));
    actions.push({ pseudo, action, data, ts: Date.now() });
    localStorage.setItem(cle, JSON.stringify(actions));
}

export function viderReponses() {
    const del = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith('partie_reponses_')) del.push(k);
    }
    del.forEach(k => localStorage.removeItem(k));
}


// ──────────────────────────────────────────────────────────────
// 💰 SCORES
// ──────────────────────────────────────────────────────────────

export function crediterPoints(pseudo, delta) {
    if (!pseudo || !delta || delta <= 0) return;
    if (GameState.scores[pseudo] === undefined) GameState.scores[pseudo] = 0;
    GameState.scores[pseudo] = +((GameState.scores[pseudo] + delta).toFixed(2));
    try {
        const sg = JSON.parse(localStorage.getItem('scores_globaux') || '{}');
        if (!sg[pseudo]) sg[pseudo] = { total: 0, parJeu: {} };
        sg[pseudo].total             = +((sg[pseudo].total             || 0) + delta).toFixed(2);
        sg[pseudo].parJeu.undercover = +((sg[pseudo].parJeu.undercover || 0) + delta).toFixed(2);
        localStorage.setItem('scores_globaux', JSON.stringify(sg));
    } catch {}
    if (typeof window.afficherScoreboard === 'function') window.afficherScoreboard();
}

export function publierScores(scores) {
    const sid = getSid();
    if (sid) localStorage.setItem(cleS(), JSON.stringify(scores || {}));
}


// ──────────────────────────────────────────────────────────────
// 🧹 NETTOYAGE
// ──────────────────────────────────────────────────────────────

export function nettoyerPartie() {
    if (S._stopEcoute)       { S._stopEcoute();       S._stopEcoute = null; }
    if (S._stopEcouteVotes)  { S._stopEcouteVotes();  S._stopEcouteVotes = null; }
    viderReponses();
    const sid = getSid();
    if (sid) {
        localStorage.removeItem(`partie_question_${sid}`);
        localStorage.removeItem(`partie_scores_${sid}`);
    }
    publierEtat('fin');
}


// ──────────────────────────────────────────────────────────────
// 🔌 BOUTON CONFIRMER — branché par main.js dans initStartSolo()
// ──────────────────────────────────────────────────────────────

export function bindBoutonDemarrer(onTousVus) {
    const btn =
        document.getElementById('btn-start-undercover-config') ||
        document.getElementById('btn-uc-lancer')               ||
        document.getElementById('btn-start-solo');

    if (!btn) {
        console.warn('[UC-HOTE] Bouton confirmer introuvable.');
        return;
    }

    if (btn._ucBound) {
        console.log('[UC-HOTE] Bouton déjà bindé, skip.');
        return;
    }
    btn._ucBound = true;

    btn.addEventListener('click', async () => {
        const joueurs = GameState.joueurs || [];
        if (joueurs.length < 3) {
            alert('Il faut au moins 3 joueurs pour jouer à Undercover !');
            return;
        }

        const nbUC = Math.max(1, parseInt(document.getElementById('uc-nb-undercover')?.value  ?? '1', 10) || 1);
        const nbMW = Math.max(0, parseInt(document.getElementById('uc-nb-misterwhite')?.value ?? '0', 10) || 0);

        const orig = btn.innerHTML;
        btn.disabled  = true;
        btn.innerHTML = '<span class="btn-icon">⏳</span> Tirage en cours…';

        await initialiserPartie({ joueurs, nbUndercover: nbUC, nbMisterWhite: nbMW });

        // Signal démarrage
        try {
            const sid = getSid();
            signalDemarrage(sid, 'undercover');
            localStorage.setItem('partie_etat_' + sid, 'en_cours');
        } catch (e) {
            console.error('[UC] Signal start :', e);
        }

        const ucConfig = document.getElementById('undercover-config');
        // Masquer la grille de config mais pas la section entière (distribution y est)
        const grid    = ucConfig?.querySelector('.config-grid');
        const btnConf = document.getElementById('btn-start-undercover-config');
        const titre   = document.getElementById('undercover-config-title');
        if (grid)    grid.style.display    = 'none';
        if (btnConf) btnConf.style.display = 'none';
        if (titre)   titre.style.display   = 'none';

        btn.disabled  = false;
        btn.innerHTML = orig;
        btn._ucBound  = false;

        afficherEcranDistribution(joueurs[0], onTousVus);
    });
}


// ──────────────────────────────────────────────────────────────
// 🛠️ UTILITAIRES
// ──────────────────────────────────────────────────────────────

const _h = str => String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const _slug = str => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '_');

const _labelRole = r => ({ Civil: '🟢 Civil', Undercover: '🔴 Undercover', MisterWhite: '🎩 Mister White' })[r] || r;

function _cfg(role) {
    return ({
        Civil:       { cls:'civil',       icon:'🟢', label:'Civil',        color:'#4ade80', glow:'radial-gradient(circle at 50% 0%,rgba(74,222,128,.38) 0%,transparent 65%)',  conseil:'Tu es un <strong>Civil</strong>. Décris ton mot sans le dire. Débusque l\'imposteur !' },
        Undercover:  { cls:'undercover',  icon:'🔴', label:'Undercover',   color:'#f87171', glow:'radial-gradient(circle at 50% 0%,rgba(248,113,113,.38) 0%,transparent 65%)', conseil:'Tu es l\'<strong>Undercover</strong>. Ton mot est légèrement différent. Fonds-toi dans la masse !' },
        MisterWhite: { cls:'misterwhite', icon:'🎩', label:'Mister White', color:'#fbbf24', glow:'radial-gradient(circle at 50% 0%,rgba(251,191,36,.38) 0%,transparent 65%)',  conseil:'Tu es le <strong>Mister White</strong>. Tu n\'as aucun mot. Écoute et improvise !' },
    })[role] ?? { cls:'civil', icon:'❓', label:role, color:'white', glow:'', conseil:'' };
}


// ──────────────────────────────────────────────────────────────
// 🎨 STYLES (injectés une seule fois)
// ──────────────────────────────────────────────────────────────

function _css() {
    if (document.getElementById('ucd-css')) return;
    const s = document.createElement('style');
    s.id = 'ucd-css';
    s.textContent = `

/* ── WRAPPER ─────────────────────────────── */
.ucd-wrap {
    display:flex;flex-direction:column;align-items:center;
    gap:24px;padding:24px 16px 48px;
    color:white;font-family:"Segoe UI",system-ui,sans-serif;
    min-height:100%;box-sizing:border-box;
}
.ucd-header { text-align:center;max-width:500px; }
.ucd-title  { font-size:1.4rem;font-weight:900;margin:0 0 8px; }
.ucd-sub    { font-size:.88rem;color:rgba(255,255,255,.6);line-height:1.65;margin:0; }
.ucd-sub strong { color:white; }
.ucd-theme-pill { color:#c4b5fd;font-size:.82rem; }

/* ── GRILLE ──────────────────────────────── */
.ucd-grille {
    display:flex;flex-wrap:wrap;gap:18px;
    justify-content:center;width:100%;max-width:780px;
}

/* ── SLOT ────────────────────────────────── */
.ucd-slot {
    display:flex;flex-direction:column;align-items:center;gap:8px;
}
.ucd-slot-name {
    font-size:.72rem;font-weight:700;letter-spacing:.07em;
    color:rgba(255,255,255,.45);text-transform:uppercase;
}
.ucd-slot-name--moi { color:#c4b5fd; }

/* ── SCÈNE 3D ────────────────────────────── */
.ucd-scene {
    border-radius:16px;
    width:155px;height:210px;
    perspective:900px;
}
.ucd-scene--moi {
    width:190px;height:256px;
    cursor:pointer;outline:none;
    -webkit-tap-highlight-color:transparent;
}
.ucd-scene--moi:focus-visible {
    box-shadow:0 0 0 3px rgba(167,139,250,.6);border-radius:16px;
}
.ucd-scene--autre {
    opacity:.68;filter:saturate(.45);
    cursor:default;pointer-events:none;
}

/* ── CARTE ───────────────────────────────── */
.ucd-card {
    width:100%;height:100%;position:relative;
    transform-style:preserve-3d;
    transition:transform .65s cubic-bezier(.4,0,.2,1);
    border-radius:16px;
}
.ucd-card--flipped { transform:rotateY(180deg); }
.ucd-card--vu      { box-shadow:0 0 0 2px rgba(74,222,128,.5),0 0 18px rgba(74,222,128,.18); }

.ucd-face {
    position:absolute;inset:0;border-radius:16px;
    backface-visibility:hidden;-webkit-backface-visibility:hidden;overflow:hidden;
}

/* ── DOS ─────────────────────────────────── */
.ucd-back {
    background:linear-gradient(150deg,#1e1240 0%,#0b0718 100%);
    border:1.5px solid rgba(167,139,250,.22);
    display:flex;flex-direction:column;
    align-items:center;justify-content:center;
    box-shadow:0 12px 40px rgba(0,0,0,.5),inset 0 0 60px rgba(99,102,241,.06);
}
.ucd-back-inner {
    display:flex;flex-direction:column;align-items:center;gap:10px;user-select:none;
}
.ucd-back-logo {
    font-size:2.4rem;
    filter:drop-shadow(0 0 16px rgba(167,139,250,.55));
    animation:ucd-float 3s ease-in-out infinite;
}
@keyframes ucd-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
.ucd-back-label {
    font-size:.65rem;font-weight:800;letter-spacing:.2em;
    color:rgba(167,139,250,.45);text-transform:uppercase;
}
.ucd-back-hatch {
    position:absolute;inset:0;opacity:.04;pointer-events:none;
    background-image:
        repeating-linear-gradient(45deg,white 0,white 1px,transparent 0,transparent 50%),
        repeating-linear-gradient(-45deg,white 0,white 1px,transparent 0,transparent 50%);
    background-size:14px 14px;
}
.ucd-back-hint {
    position:absolute;bottom:14px;
    font-size:.62rem;font-weight:700;letter-spacing:.14em;
    color:rgba(255,255,255,.28);text-transform:uppercase;
    animation:ucd-blink 2.4s ease-in-out infinite;
}
@keyframes ucd-blink{0%,100%{opacity:.28}50%{opacity:.7}}

.ucd-lock-overlay {
    position:absolute;inset:0;
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
    background:rgba(0,0,0,.3);backdrop-filter:blur(2px);
}
.ucd-lock-icon { font-size:1.5rem;opacity:.55; }
.ucd-lock-txt  {
    font-size:.58rem;font-weight:700;letter-spacing:.08em;
    color:rgba(255,255,255,.38);text-transform:uppercase;text-align:center;padding:0 8px;line-height:1.4;
}

/* ── FACE ────────────────────────────────── */
.ucd-front {
    transform:rotateY(180deg);
    border:1.5px solid rgba(255,255,255,.1);
    box-shadow:0 12px 40px rgba(0,0,0,.5);
    display:flex;align-items:stretch;
}
.ucd-front--civil      {background:linear-gradient(160deg,#0d2218 0%,#060e0b 100%);border-color:rgba(74,222,128,.28);}
.ucd-front--undercover {background:linear-gradient(160deg,#22100d 0%,#0e0606 100%);border-color:rgba(248,113,113,.28);}
.ucd-front--misterwhite{background:linear-gradient(160deg,#21180a 0%,#0e0d05 100%);border-color:rgba(251,191,36,.28);}

.ucd-front-glow   { position:absolute;inset:0;pointer-events:none;border-radius:14px; }
.ucd-front-inner  {
    position:relative;z-index:1;width:100%;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    gap:10px;padding:18px 12px;box-sizing:border-box;
}
.ucd-role-icon  { font-size:2rem;line-height:1; }
.ucd-role-name  { font-size:.95rem;font-weight:900;letter-spacing:.04em;text-transform:uppercase;text-align:center; }
.ucd-divider    { width:36px;height:1.5px;background:rgba(255,255,255,.1);border-radius:2px; }

.ucd-mot-wrap {
    display:flex;flex-direction:column;align-items:center;gap:4px;
    background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);
    border-radius:10px;padding:10px 12px;width:100%;box-sizing:border-box;text-align:center;
}
.ucd-mot-vide   { border-color:rgba(251,191,36,.18);background:rgba(251,191,36,.04); }
.ucd-mot-label  { font-size:.55rem;font-weight:800;letter-spacing:.2em;color:rgba(255,255,255,.35);text-transform:uppercase; }
.ucd-mot-val    { font-size:1.15rem;font-weight:900;color:white;word-break:break-word; }
.ucd-mot-hint   { font-size:.65rem;color:rgba(251,191,36,.65);font-style:italic;line-height:1.4; }
.ucd-card-theme { font-size:.65rem;font-weight:600;color:rgba(255,255,255,.38);background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:3px 10px; }

/* ── CONFIRMATION ────────────────────────── */
.ucd-confirm {
    width:190px;
    opacity:0;transform:translateY(10px);
    transition:opacity .35s,transform .35s;pointer-events:none;
}
.ucd-confirm--show { opacity:1;transform:translateY(0);pointer-events:auto; }
.ucd-conseil {
    font-size:.78rem;color:rgba(255,255,255,.55);text-align:center;
    line-height:1.6;margin:0 0 10px;
}
.ucd-conseil strong { color:rgba(255,255,255,.9); }
.ucd-vu-msg { font-size:.8rem;color:rgba(74,222,128,.8);text-align:center;padding:10px 0;margin:0; }

.ucd-btn-ok {
    display:block;width:100%;padding:12px;
    background:linear-gradient(135deg,#059669,#047857);
    border:none;border-radius:12px;color:white;
    font-size:.88rem;font-weight:800;cursor:pointer;font-family:inherit;
    box-shadow:0 4px 14px rgba(5,150,105,.3);
    transition:transform .15s,box-shadow .15s;
}
.ucd-btn-ok:hover { transform:translateY(-2px);box-shadow:0 6px 20px rgba(5,150,105,.45); }

/* ── STATUT INDIVIDUEL ───────────────────── */
.ucd-statut { font-size:.95rem;min-height:1.3rem; }
.ucd-statut--ok { animation:ucd-pop .35s cubic-bezier(.4,0,.2,1); }
@keyframes ucd-pop{0%{transform:scale(1.6)}100%{transform:scale(1)}}

/* ── PROGRESSION ─────────────────────────── */
.ucd-prog-section { width:min(420px,90vw); }
.ucd-prog-label {
    display:flex;justify-content:space-between;
    font-size:.75rem;font-weight:600;color:rgba(255,255,255,.4);margin-bottom:8px;
}
.ucd-prog-bar { height:6px;background:rgba(255,255,255,.08);border-radius:3px;overflow:hidden; }
.ucd-prog-fill {
    height:100%;background:linear-gradient(90deg,#6a5af9,#4ade80);
    border-radius:3px;transition:width .5s cubic-bezier(.4,0,.2,1);
}

/* ── BOUTON LANCER ───────────────────────── */
.ucd-btn-lancer {
    width:min(420px,90vw);padding:15px;
    background:rgba(99,102,241,.2);border:1.5px solid rgba(99,102,241,.3);
    border-radius:14px;color:white;font-size:1rem;font-weight:800;
    cursor:not-allowed;font-family:inherit;opacity:.4;
    transition:background .2s,border-color .2s,opacity .2s,transform .15s,box-shadow .15s;
}
.ucd-btn-lancer:not(:disabled) { cursor:pointer;opacity:1; }
.ucd-btn-lancer--ready {
    background:linear-gradient(135deg,#6a5af9,#8a2be2) !important;
    border-color:transparent !important;
    box-shadow:0 4px 18px rgba(138,43,226,.4) !important;
    animation:ucd-pulse 2s ease-in-out infinite;
}
@keyframes ucd-pulse{0%,100%{box-shadow:0 4px 18px rgba(138,43,226,.4)}50%{box-shadow:0 6px 28px rgba(138,43,226,.65)}}

/* ── JOUEURS UNDERCOVER (phase jeu) ─────── */
.uc-joueur-item {
    display:flex;align-items:center;gap:10px;
    padding:10px 14px;border-radius:12px;
    background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);
    margin-bottom:8px;font-size:.9rem;
}
.uc-joueur-elimine { opacity:.55; }
.uc-joueur-gagnant { background:rgba(74,222,128,.08);border-color:rgba(74,222,128,.28); }
.uc-j-badge { font-size:1rem;flex-shrink:0; }
.uc-j-nom   { flex:1;font-weight:700; }
.uc-j-role  { font-size:.78rem;color:rgba(255,255,255,.5); }
.uc-j-mot   { font-size:.75rem;color:#a78bfa;margin-left:4px; }
.uc-joueur-fin { background:rgba(255,255,255,.04); }

/* ── BOUTONS DE VOTE (hôte) ──────────────── */
.uc-vote-btn {
    display:block;width:100%;padding:12px 18px;
    background:rgba(255,255,255,.06);border:1.5px solid rgba(255,255,255,.12);
    border-radius:12px;color:white;font-size:.92rem;font-weight:700;
    cursor:pointer;font-family:inherit;text-align:left;margin-bottom:8px;
    transition:background .18s,border-color .18s,transform .12s;
}
.uc-vote-btn:hover:not(:disabled) {
    background:rgba(248,113,113,.14);border-color:rgba(248,113,113,.38);transform:translateX(4px);
}
.uc-vote-btn--choisi {
    background:rgba(99,102,241,.25) !important;border-color:rgba(99,102,241,.5) !important;
}
.uc-vote-btn:disabled { opacity:.5;cursor:not-allowed; }

/* ── TALLY VOTES ─────────────────────────── */
.uc-vote-tally {
    position:relative;overflow:hidden;
    border-radius:10px;margin-bottom:6px;
    background:rgba(255,255,255,.04);
    border:1px solid rgba(255,255,255,.08);
}
.uc-vt-bar-bg {
    position:absolute;inset:0;background:transparent;
}
.uc-vt-bar-fill {
    height:100%;background:rgba(99,102,241,.15);
    transition:width .5s cubic-bezier(.4,0,.2,1);
    border-radius:10px;
}
.uc-vt-content {
    position:relative;z-index:1;
    display:flex;align-items:center;gap:10px;
    padding:10px 14px;
}
.uc-vt-nom   { flex:1;font-weight:700;font-size:.88rem; }
.uc-vt-count { font-size:.82rem;color:#a78bfa;font-weight:700;flex-shrink:0; }

/* ── THEME HOTE ──────────────────────────── */
.uc-theme-hote {
    display:inline-flex;align-items:center;gap:8px;
    background:rgba(167,139,250,.1);border:1px solid rgba(167,139,250,.25);
    border-radius:10px;padding:7px 14px;margin-bottom:12px;
}
.uc-theme-label { font-size:.75rem;font-weight:700;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.08em; }
.uc-theme-valeur { font-size:.88rem;font-weight:800;color:#c4b5fd; }

/* ── SECTION LABEL ───────────────────────── */
.uc-section-label {
    font-size:.72rem;font-weight:800;letter-spacing:.12em;
    color:rgba(255,255,255,.45);text-transform:uppercase;margin-bottom:8px;
}

/* ── VOTES RECAP ─────────────────────────── */
.uc-votes-recap {
    background:rgba(255,255,255,.04);
    border:1px solid rgba(255,255,255,.1);
    border-radius:14px;padding:14px 16px;margin-bottom:12px;
}
.uc-votes-recap-header {
    display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;
}
.uc-votes-compteur { font-size:.9rem;font-weight:800;color:#a78bfa; }
.uc-votes-detail { display:flex;flex-direction:column;gap:0; }

/* ── VOTE HOTE WRAP ──────────────────────── */
.uc-vote-hote-wrap {
    background:rgba(255,255,255,.04);
    border:1px solid rgba(255,255,255,.1);
    border-radius:14px;padding:14px 16px;margin-bottom:12px;
}

/* ── BTN VOTE ────────────────────────────── */
.uc-btn-vote {
    width:100%;padding:14px;
    background:linear-gradient(135deg,#6a5af9,#8a2be2);
    border:none;border-radius:13px;color:white;
    font-size:.95rem;font-weight:800;cursor:pointer;font-family:inherit;
    box-shadow:0 4px 18px rgba(138,43,226,.35);
    transition:transform .15s,box-shadow .15s;margin-top:6px;
}
.uc-btn-vote:hover { transform:translateY(-2px);box-shadow:0 6px 24px rgba(138,43,226,.5); }

/* ── INVITE CARD ─────────────────────────── */
.uc-invite-card { display:flex;flex-direction:column;gap:0; }
.uc-invite-header {
    font-size:.75rem;font-weight:800;letter-spacing:.1em;
    color:rgba(167,139,250,.6);text-transform:uppercase;margin-bottom:12px;
}

/* ── ÉCRANS ATTENTE ──────────────────────── */
.uc-screen-attente {
    display:flex;flex-direction:column;align-items:center;
    gap:10px;padding:24px 0;text-align:center;
}
.uc-big-icon { font-size:2.8rem;line-height:1; }
.uc-screen-titre { font-size:1.1rem;font-weight:800; }
.uc-screen-sub { font-size:.88rem;color:rgba(255,255,255,.6);line-height:1.6; }

/* ── BANNIÈRES DE PHASE ──────────────────── */
.uc-phase-banner {
    display:flex;align-items:center;gap:10px;
    padding:10px 14px;border-radius:12px;margin-bottom:12px;
    font-weight:800;font-size:.9rem;
}
.uc-phase-debat   { background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.3);color:#a78bfa; }
.uc-phase-vote    { background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.3);color:#f87171; }
.uc-phase-elim    { background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);color:#fca5a5; }
.uc-phase-icon { font-size:1.1rem; }
.uc-phase-nom  { font-size:.9rem;font-weight:800; }

/* ── RÔLE RAPPEL COMPACT ─────────────────── */
.uc-role-rappel-compact {
    display:flex;align-items:center;gap:8px;
    padding:8px 12px;border-radius:10px;
    background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);
    margin-bottom:10px;
}
.uc-role-badge {
    font-size:.78rem;font-weight:700;padding:3px 10px;border-radius:8px;
    background:rgba(255,255,255,.08);
}
.uc-role-civil       { color:#4ade80;border:1px solid rgba(74,222,128,.3); }
.uc-role-undercover  { color:#f87171;border:1px solid rgba(248,113,113,.3); }
.uc-role-misterwhite { color:#fbbf24;border:1px solid rgba(251,191,36,.3); }
.uc-mot-rappel {
    font-size:.88rem;font-weight:800;color:#c4b5fd;
    background:rgba(167,139,250,.1);padding:3px 10px;border-radius:8px;
}

/* ── JOUEURS LISTE (invite) ──────────────── */
.uc-joueurs-section { margin-bottom:10px; }
.uc-joueurs-liste { display:flex;flex-direction:column;gap:4px; }
.uc-joueur-actif {
    background:rgba(74,222,128,.05);border:1px solid rgba(74,222,128,.15);
    padding:8px 12px;border-radius:10px;
    display:flex;align-items:center;gap:8px;font-size:.9rem;
}
.uc-joueur-moi { border-color:rgba(167,139,250,.35);background:rgba(167,139,250,.08); }
.uc-moi-badge {
    font-size:.65rem;font-weight:700;color:#c4b5fd;
    background:rgba(167,139,250,.15);padding:2px 8px;border-radius:6px;
}
.uc-badge-elimine { font-size:.75rem;opacity:.7; }
.uc-j-badge { font-size:.95rem;flex-shrink:0; }

/* ── DÉBAT ───────────────────────────────── */
.uc-debat-wrap  { display:flex;flex-direction:column;gap:0; }
.uc-debat-conseil {
    background:rgba(99,102,241,.06);border:1px solid rgba(99,102,241,.15);
    border-radius:10px;padding:10px 14px;margin-bottom:10px;
    font-size:.82rem;color:rgba(255,255,255,.6);line-height:1.7;
}
.uc-debat-conseil p { margin:0; }
.uc-waiting-msg { font-size:.82rem;color:rgba(255,255,255,.4);text-align:center;padding:6px 0; }

/* ── VOTE ────────────────────────────────── */
.uc-vote-wrap  { display:flex;flex-direction:column;gap:0; }
.uc-vote-instruction { font-size:.9rem;font-weight:700;margin-bottom:10px;color:rgba(255,255,255,.8); }
.uc-vote-liste { display:flex;flex-direction:column;gap:4px;margin-bottom:8px; }
.uc-vote-btn-inv {
    display:flex;align-items:center;justify-content:space-between;
    width:100%;padding:13px 16px;
    background:rgba(255,255,255,.06);border:1.5px solid rgba(255,255,255,.12);
    border-radius:12px;color:white;font-size:.92rem;font-weight:700;
    cursor:pointer;font-family:inherit;
    transition:background .18s,border-color .18s,transform .12s;
}
.uc-vote-btn-inv:hover:not(:disabled) {
    background:rgba(248,113,113,.14);border-color:rgba(248,113,113,.4);transform:translateX(3px);
}
.uc-vote-selectionne {
    background:rgba(99,102,241,.3) !important;border-color:rgba(99,102,241,.6) !important;
}
.uc-vote-btn-inv:disabled { opacity:.5;cursor:not-allowed; }
.uc-vote-nom   { font-size:.9rem; }
.uc-vote-arrow { font-size:.85rem;opacity:.5; }
.uc-vote-hint  { font-size:.75rem;color:rgba(255,255,255,.35);text-align:center;padding:4px 0; }

/* ── ÉLIMINATION ─────────────────────────── */
.uc-elim-wrap  { display:flex;flex-direction:column;gap:0; }
.uc-elim-annonce {
    text-align:center;padding:16px;
    background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.2);
    border-radius:14px;margin-bottom:12px;
}
.uc-elim-nom  { font-size:1.3rem;font-weight:900;margin:0 0 4px; }
.uc-elim-sub  { font-size:.85rem;color:rgba(255,255,255,.55);margin:0 0 8px; }
.uc-elim-role { display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap; }
.uc-elim-mot  { font-size:.85rem;color:rgba(255,255,255,.6);font-style:italic; }

.uc-elim-moi { margin-bottom:12px; }
.uc-elim-moi-card {
    text-align:center;padding:14px 16px;
    background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);
    border-radius:12px;
}
.uc-elim-moi-msg { font-size:.92rem;font-weight:700;margin:0 0 4px;color:#fca5a5; }
.uc-elim-moi-sub { font-size:.8rem;color:rgba(255,255,255,.5);margin:0; }

/* ── OBSERVATEUR (joueur éliminé) ────────── */
.uc-obs-banner {
    display:flex;align-items:center;gap:8px;
    background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.25);
    border-radius:10px;padding:9px 14px;
    font-size:.82rem;font-weight:700;color:#fca5a5;
}
.uc-obs-icon { font-size:1rem; }

/* ── MISTER WHITE GUESS ──────────────────── */
.uc-mw-guess-wrap {
    background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.25);
    border-radius:12px;padding:14px 16px;margin-bottom:12px;
}
.uc-mw-guess-titre { font-size:.95rem;font-weight:800;color:#fbbf24;margin:0 0 4px; }
.uc-mw-guess-sub { font-size:.82rem;color:rgba(255,255,255,.6);margin:0 0 10px; }
.uc-mw-form { display:flex;gap:8px; }
.uc-mw-input {
    flex:1;padding:11px 14px;
    background:rgba(255,255,255,.08);border:1.5px solid rgba(255,255,255,.18);
    border-radius:10px;color:white;font-size:.9rem;outline:none;font-family:inherit;
    transition:border-color .2s;
}
.uc-mw-input:focus { border-color:#fbbf24; }
.uc-mw-btn {
    padding:11px 16px;background:rgba(251,191,36,.2);
    border:1.5px solid rgba(251,191,36,.4);border-radius:10px;
    color:white;font-size:.85rem;font-weight:700;cursor:pointer;
    white-space:nowrap;font-family:inherit;transition:background .2s;
}
.uc-mw-btn:hover { background:rgba(251,191,36,.38); }
.uc-mw-sent { font-size:.85rem;color:rgba(74,222,128,.8);margin:0;padding:8px 0; }

/* ── FIN ─────────────────────────────────── */
.uc-fin-wrap  { display:flex;flex-direction:column;gap:12px; }
.uc-fin-result {
    text-align:center;padding:20px;border-radius:16px;
}
.uc-fin-victoire { background:rgba(74,222,128,.1);border:1px solid rgba(74,222,128,.3); }
.uc-fin-defaite  { background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2); }
.uc-fin-titre   { font-size:1.2rem;font-weight:900;margin:8px 0 4px; }
.uc-fin-message { font-size:.88rem;color:rgba(255,255,255,.6);margin:0; }

/* ── RECAP TABLE ─────────────────────────── */
.uc-recap-table { display:flex;flex-direction:column;gap:0; }
.uc-recap-ligne {
    display:flex;align-items:center;gap:8px;
    padding:9px 12px;border-radius:10px;margin-bottom:4px;
    background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);
    font-size:.85rem;
}
.uc-recap-gagnant { background:rgba(74,222,128,.08);border-color:rgba(74,222,128,.2); }
.uc-recap-nom    { flex:1;font-weight:700; }
.uc-recap-role   { font-size:.75rem;color:rgba(255,255,255,.55); }
.uc-recap-mot    { font-size:.75rem;color:#a78bfa; }
.uc-recap-trophy { font-size:1rem; }

/* ── ATTENTE DISTRIBUTION (invité) ──────── */
.ucd-inv-distrib { display:flex;flex-direction:column;align-items:center;gap:12px; }
.ucd-inv-intro {
    font-size:.84rem;color:rgba(255,255,255,.6);text-align:center;
    line-height:1.65;margin:0;
}
.ucd-inv-intro strong { color:white; }
.ucd-inv-role-vu { display:flex;flex-direction:column;align-items:center;gap:10px; }
.ucd-inv-waiting {
    font-size:.82rem;color:rgba(255,255,255,.5);text-align:center;margin:0;
}

    `;
    document.head.appendChild(s);
}