// /js/modules/undercover_hote.js
// ============================================================
// 🕵️ UNDERCOVER_HOTE — Distribution + Débat + Vote
// ============================================================
// FLUX :
//   Confirmer → initialiserPartie() → afficherDistribution()
//   Chaque joueur retourne SA carte (verrou sur les autres)
//   Tous prêts → hôte clique "Lancer" → demarrerDebat()
//   Débat → "Passer au vote" → ouvrirVote()
//   Votes comptés → eliminerJoueur() → vérif fin ou nouveau tour
// ============================================================

import { GameState } from '../core/state.js';
import { signalDemarrage } from '../core/signal.js';
import { socket } from '../core/socket.js';
import HostSession from '../core/host_session.js';

// ──────────────────────────────────────────────────────────────
// CLÉS LOCALSTORAGE
// ──────────────────────────────────────────────────────────────
function getSid() { return localStorage.getItem('minigame_partie_session_id') || ''; }
const cleQ = () => `partie_question_${getSid()}`;
const cleE = () => `partie_etat_${getSid()}`;
const cleS = () => `partie_scores_${getSid()}`;

// ──────────────────────────────────────────────────────────────
// CHARGEMENT JSON
// ──────────────────────────────────────────────────────────────
const FALLBACK = [
    { Civil:'Chien',  Undercover:'Loup',    Thème:'Animaux' },
    { Civil:'Café',   Undercover:'Thé',     Thème:'Cuisine' },
    { Civil:'Plage',  Undercover:'Piscine', Thème:'Lieux'   },
];

async function chargerJSON() {
    try {
        const r = await fetch('./data/undercover.json');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (!Array.isArray(d) || !d.length) throw new Error('vide');
        console.log(`[UC] JSON chargé : ${d.length} entrées`);
        return d;
    } catch (e) {
        console.warn('[UC] Fallback :', e.message);
        return FALLBACK;
    }
}

function tirerMots(tab) {
    const l = tab[Math.floor(Math.random() * tab.length)];
    return { civil: l['Civil'] ?? '', undercover: l['Undercover'] ?? '', theme: l['Thème'] ?? '' };
}

// ──────────────────────────────────────────────────────────────
// ATTRIBUTION DES RÔLES
// ──────────────────────────────────────────────────────────────
function attribuerRoles(joueurs, nbUC, nbMW) {
    const n     = joueurs.length;
    const nUC   = Math.min(nbUC, Math.floor(n / 2));
    const nMW   = Math.min(nbMW, n - nUC - 1);
    const nCiv  = n - nUC - nMW;
    const pool  = [...Array(nCiv).fill('Civil'), ...Array(nUC).fill('Undercover'), ...Array(nMW).fill('MisterWhite')];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const roles = {};
    joueurs.forEach((j, i) => { roles[j] = pool[i]; });
    console.log('[UC] Rôles :', roles);
    return roles;
}

// ──────────────────────────────────────────────────────────────
// STATE
// ──────────────────────────────────────────────────────────────
const S = {
    roles:{}, mots:{ civil:'', undercover:'' }, theme:'',
    joueursEnJeu:[], voteOuvert:false, elimine:null,
    finMessage:null, finGagnant:null,
    _rolesVus:        new Set(),
    _votes:           {},
    _stopEcoute:      null,
    _stopEcouteVotes: null,
    _pseudoHote:      '',
    _partieTs:        0,
    _voteRoundTs:     0,
    _phase:           null,
    _wsBound:         false,
    _suiviTotal:      0,
    _onTousVus:       null,
};

export function getState() { return { ...S }; }

// ──────────────────────────────────────────────────────────────
// PUBLICATION — WebSocket (source de vérité = serveur, cf. CLAUDE.md)
// L'état PUBLIC (sans rôles privés) est diffusé à tous les invités.
// Le rôle PRIVÉ de chaque invité est envoyé UNIQUEMENT à lui.
// Les anciennes fonctions localStorage sont conservées (no-op legacy)
// mais ne sont plus la source de vérité.
// ──────────────────────────────────────────────────────────────
export function publierEtat() { /* legacy localStorage — neutralisé (WS) */ }
export function publierEtatJeu() { /* legacy localStorage — neutralisé (WS) */ }

function _wsSend(action, data) {
    try { socket.send('HOST_ACTION', { action, data: data || {} }); }
    catch (e) { console.error('[UC-HOTE] WS send', action, e); }
}

function _tallyPublic() {
    const t = {};
    Object.entries(S._votes).forEach(([votant, cible]) => {
        if (S.joueursEnJeu.includes(votant) && S.joueursEnJeu.includes(cible)) {
            t[cible] = (t[cible] || 0) + 1;
        }
    });
    return t;
}

function _etatPublic(phase) {
    const enFin     = phase === 'fin';
    const attenteMW = !!(S.elimine && S.roles[S.elimine] === 'MisterWhite' && !S.finMessage);
    return {
        phase,
        theme        : S.theme,
        joueurs      : Object.keys(S.roles),
        joueursEnJeu : [...S.joueursEnJeu],
        voteOuvert   : S.voteOuvert,
        votesPublics : _tallyPublic(),
        votants      : Object.keys(S._votes),
        elimine      : S.elimine,
        elimineRole  : S.elimine ? (S.roles[S.elimine] || null) : null,
        attenteMW,
        finMessage   : S.finMessage,
        finGagnant   : S.finGagnant,
        rolesReveles : enFin ? { ...S.roles } : null,
        motsReveles  : enFin ? { civil: S.mots.civil, undercover: S.mots.undercover } : null,
        pseudoHote   : S._pseudoHote,
        ts           : Date.now(),
    };
}

function _publierEtatPublic() {
    if (!S._phase) return;
    _wsSend('undercover:state', _etatPublic(S._phase));
}

function _publierRolePrive(pseudo) {
    if (!pseudo || pseudo === S._pseudoHote) return; // l'hôte voit sa carte localement
    const role = S.roles[pseudo];
    if (!role) return;
    const mot = role === 'MisterWhite' ? null
              : role === 'Undercover'  ? S.mots.undercover
              : S.mots.civil;
    _wsSend('undercover:role', { pseudo, role, mot, theme: S.theme });
}

function _publierTousRolesPrives() {
    Object.keys(S.roles).forEach(p => _publierRolePrive(p));
}

function _pub(phase) {
    S._phase = phase;
    _publierEtatPublic();
}

// ── Écoute des actions invités (role_vu / vote / mw_guess / resync) ──
function _enrVoteRemote(pseudo, cible) {
    if (!S.voteOuvert || !cible) return;
    if (!S.joueursEnJeu.includes(pseudo)) return;
    if (!S.joueursEnJeu.includes(cible))  return;
    if (S._votes[pseudo]) return;
    S._votes[pseudo] = cible;
    _majTally();
    _publierEtatPublic(); // tally en direct pour tous
}

function _onPlayerActionWS(payload) {
    const { pseudo, action, data } = payload || {};
    if (!action || !action.startsWith('undercover:')) return;
    const cmd = action.split(':')[1];

    if (cmd === 'role_vu') {
        if (S.joueursEnJeu.includes(pseudo) && !S._rolesVus.has(pseudo)) {
            S._rolesVus.add(pseudo);
            _majSuivi(S._suiviTotal || S.joueursEnJeu.length, S._onTousVus);
        }
    } else if (cmd === 'vote') {
        _enrVoteRemote(pseudo, data && data.cible);
    } else if (cmd === 'mw_guess') {
        if (S.elimine && S.roles[S.elimine] === 'MisterWhite' && !S.finMessage) {
            verifierDevinetteMW(S.elimine, (data && data.mot) || '');
        }
    } else if (cmd === 'resync_role') {
        _publierRolePrive(pseudo);
        _publierEtatPublic();
    }
}

function _onPlayerJoinedWS() {
    // Un invité (re)joint / recharge → renvoi de l'état public + son rôle privé
    _publierEtatPublic();
    _publierTousRolesPrives();
}

function _brancherWS() {
    socket.off('PLAYER_ACTION', _onPlayerActionWS);
    socket.on('PLAYER_ACTION', _onPlayerActionWS);
    socket.off('PLAYER_JOINED', _onPlayerJoinedWS);
    socket.on('PLAYER_JOINED', _onPlayerJoinedWS);
    socket.off('PLAYER_RECONNECTED', _onPlayerJoinedWS);
    socket.on('PLAYER_RECONNECTED', _onPlayerJoinedWS);
    S._wsBound = true;
}

// Purge des listeners WS — appelée à GAME_ENDED via cleanup.resetEtatJeuxHote().
// Évite que les handlers undercover continuent de répondre pendant un autre jeu.
export function nettoyerPartieInvites() {
    socket.off('PLAYER_ACTION', _onPlayerActionWS);
    socket.off('PLAYER_JOINED', _onPlayerJoinedWS);
    socket.off('PLAYER_RECONNECTED', _onPlayerJoinedWS);
    S._wsBound = false;
    console.log('[UNDERCOVER_HOTE] 🧹 Listeners WS purgés');
}

// ──────────────────────────────────────────────────────────────
// INITIALISATION
// ──────────────────────────────────────────────────────────────
export async function initialiserPartie({ joueurs, nbUndercover=1, nbMisterWhite=0 }) {
    const tab        = await chargerJSON();
    S.mots           = tirerMots(tab);
    S.theme          = S.mots.theme;
    S.roles          = attribuerRoles(joueurs, nbUndercover, nbMisterWhite);
    S.joueursEnJeu        = [...joueurs];
    S.voteOuvert          = false;  S.elimine  = null;
    S.finMessage          = null;   S.finGagnant = null;
    S._rolesVus           = new Set();
    S._votes              = {};
    S._pseudoHote         = joueurs[0];
    S._voteRoundTs        = 0;

    // Arrêter toutes les écoutes résiduelles
    if (S._stopEcoute)      { S._stopEcoute();      S._stopEcoute = null; }
    if (S._stopEcouteVotes) { S._stopEcouteVotes(); S._stopEcouteVotes = null; }

    // Purge TOTALE de toutes les clés de session undercover
    _purgerToutSession();

    // Horodater APRÈS la purge — tout item antérieur sera ignoré
    S._partieTs = Date.now();

    GameState.jeuActuel = 'undercover';
    GameState.joueurs   = [...joueurs];
    if (!GameState.scores) GameState.scores = {};
    joueurs.forEach(j => { if (GameState.scores[j] === undefined) GameState.scores[j] = 0; });

    _brancherWS();
    _pub('distribution');
    _publierTousRolesPrives();
    console.log('[UC] Partie init | mots:', S.mots);
}

// ──────────────────────────────────────────────────────────────
// PURGE SESSION
// ──────────────────────────────────────────────────────────────

// Purge complète : toutes les clés de session UC (reponses, question, etat, signal)
function _purgerToutSession() {
    const prefixes = ['partie_reponses_', 'partie_question_', 'partie_etat_',
                      'partie_scores_', 'partie_revelation_'];
    const exact = ['partie:signal'];
    const cles = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (prefixes.some(p => k.startsWith(p)) || exact.includes(k)) cles.push(k);
    }
    cles.forEach(k => localStorage.removeItem(k));
    console.log(`[UC-INIT] 🧹 ${cles.length} clé(s) session purgée(s)`);
}

// Purge uniquement les votes (conserve role_vu) dans toutes les clés
function _purgerVotesSession() {
    const cles = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith('partie_reponses_')) cles.push(k);
    }
    let nb = 0;
    cles.forEach(cle => {
        let arr = []; try { arr = JSON.parse(localStorage.getItem(cle) || '[]'); } catch {}
        if (!Array.isArray(arr)) return;
        const apres = arr.filter(a => a.action !== 'vote');
        nb += arr.length - apres.length;
        localStorage.setItem(cle, JSON.stringify(apres));
    });
    if (nb) console.log(`[UC-VOTE] 🧹 ${nb} vote(s) purgé(s)`);
}

// ──────────────────────────────────────────────────────────────
// 🃏 ÉCRAN DE DISTRIBUTION
// ──────────────────────────────────────────────────────────────
export function afficherDistribution(pseudoHote, onTousVus) {
    _injecterCSS();

    const joueurs = S.joueursEnJeu;
    const total   = joueurs.length;

    // ── 1. Rendre visible la section distribution ─────────────
    const distrib = document.getElementById('undercover-distribution');
    if (!distrib) {
        console.error('[UC] #undercover-distribution introuvable !');
        return;
    }
    distrib.hidden        = false;
    distrib.style.display = 'block';

    // ── 2. Réinitialiser compteur + badges + progression ──────
    const countEl = document.getElementById('uc-roles-vus-count');
    const totalEl = document.getElementById('uc-roles-total-invites');
    const suiviEl = document.getElementById('uc-suivi-invites');
    const barEl   = document.getElementById('uc-invites-status');

    // Reset interne
    S._rolesVus = new Set();

    // Reset compteur
    if (countEl) countEl.textContent = '0';
    if (totalEl) totalEl.textContent = String(total);

    // Reset barre progression
    if (barEl) {
        barEl.innerHTML = `
            <div style="width:100%;height:4px;background:rgba(255,255,255,.08);border-radius:2px;margin-top:8px">
                <div style="width:0%;height:100%;background:linear-gradient(90deg,#6a5af9,#4ade80);border-radius:2px;transition:width .4s"></div>
            </div>`;
    }

    // Afficher le bloc de suivi
    if (suiviEl) suiviEl.hidden = false;

    // Reset badges (si grille existait déjà)
    joueurs.forEach(p => {
        const st = document.getElementById(`uc-statut-${_s(p)}`);
        if (st) {
            st.textContent = '⏳';
            st.classList.remove('uc-badge-ok');
        }
    });

    // ── 3. Générer les cartes ────────────────────────────────
    const grille = document.getElementById('undercover-cartes-joueurs');
    if (!grille) {
        console.error('[UC] #undercover-cartes-joueurs introuvable !');
        return;
    }

    grille.innerHTML = joueurs.map(pseudo => {
        const estMoi = pseudo === pseudoHote;
        const role   = S.roles[pseudo];
        const cfg    = _cfg(role);
        const mot    = role === 'MisterWhite' ? null
            : role === 'Undercover' ? S.mots.undercover
            : S.mots.civil;

        const motHTML = mot !== null
            ? `<div class="uc-mot-bloc"><span class="uc-mot-lab">TON MOT</span><span class="uc-mot-val">${_h(mot)}</span></div>`
            : `<div class="uc-mot-bloc uc-mot-mw"><span class="uc-mot-lab">TON MOT</span><span class="uc-mot-val">???</span><span class="uc-mot-sub">Pas de mot — improvise !</span></div>`;

        const themeHTML = S.theme
            ? `<div class="uc-theme-pill">🏷️ ${_h(S.theme)}</div>` : '';

        const verrou = estMoi ? '' : `
            <div class="uc-verrou">
                <span class="uc-verrou-icon">🔒</span>
                <span class="uc-verrou-nom">${_h(pseudo)}</span>
            </div>`;

        return `
        <div class="uc-carte-slot" data-pseudo="${_h(pseudo)}">

            <div class="uc-carte-nom ${estMoi ? 'uc-carte-nom--moi' : ''}">
                ${estMoi ? '👤 Moi' : `👤 ${_h(pseudo)}`}
            </div>

            <div class="uc-scene ${estMoi ? 'uc-scene--moi' : 'uc-scene--autre'}"
                 id="uc-scene-${_s(pseudo)}"
                 ${estMoi ? 'role="button" tabindex="0"' : 'aria-hidden="true"'}>

                <div class="uc-card3d" id="uc-card-${_s(pseudo)}">

                    <div class="uc-face uc-dos">
                        <div class="uc-dos-inner">
                            <span class="uc-dos-logo">🕵️</span>
                            <span class="uc-dos-label">UNDERCOVER</span>
                        </div>
                        ${estMoi ? '<span class="uc-dos-hint">Appuie pour révéler</span>' : verrou}
                    </div>

                    <div class="uc-face uc-face-front uc-face-front--${cfg.cls}">
                        <div class="uc-face-glow" style="background:${cfg.glow}"></div>
                        <div class="uc-face-inner">
                            <div class="uc-role-icon">${cfg.icon}</div>
                            <div class="uc-role-name" style="color:${cfg.color}">${cfg.label}</div>
                            <div class="uc-sep"></div>
                            ${motHTML}
                            ${themeHTML}
                        </div>
                    </div>

                </div>
            </div>

            ${estMoi ? `
            <div class="uc-confirm-bloc" id="uc-confirm-${_s(pseudo)}" hidden>
                <p class="uc-conseil">${cfg.conseil}</p>
                <button class="uc-btn-ok" id="uc-btnok-${_s(pseudo)}">✅ C'est noté</button>
            </div>` : ''}

            <div class="uc-badge-statut" id="uc-statut-${_s(pseudo)}">⏳</div>

        </div>`;
    }).join('');

    // ── 4. Bouton "Lancer le débat" ───────────────────────────
    let btnLancer = document.getElementById('uc-btn-lancer-debat');
    if (!btnLancer) {
        btnLancer = document.createElement('button');
        btnLancer.id        = 'uc-btn-lancer-debat';
        btnLancer.className = 'uc-btn-lancer';
        btnLancer.disabled  = true;
        btnLancer.textContent = '🎤 Lancer le débat';
        distrib.appendChild(btnLancer);
    } else {
        btnLancer.disabled = true;
        btnLancer.className = 'uc-btn-lancer';
    }

    btnLancer.onclick = () => {
        if (S._stopEcoute) { S._stopEcoute(); S._stopEcoute = null; }
        demarrerDebat();
        if (typeof onTousVus === 'function') onTousVus();
    };

    // Mémoriser le total + callback pour le suivi WS des role_vu
    S._suiviTotal = total;
    S._onTousVus  = onTousVus;

    // ── 5. Flip de la carte de l'hôte ─────────────────────────
    _branquerFlip(pseudoHote, total, onTousVus);

    // ── 6. (Re)publier l'état + les rôles privés (invités déjà chargés) ──
    _pub('distribution');
    _publierTousRolesPrives();
}


// ──────────────────────────────────────────────────────────────
// FLIP CARTE HÔTE
// ──────────────────────────────────────────────────────────────
function _branquerFlip(pseudo, total, onTousVus) {
    const scene   = document.getElementById(`uc-scene-${_s(pseudo)}`);
    const card    = document.getElementById(`uc-card-${_s(pseudo)}`);
    const confirm = document.getElementById(`uc-confirm-${_s(pseudo)}`);
    const btnOk   = document.getElementById(`uc-btnok-${_s(pseudo)}`);

    if (!scene || !card) return;
    if (scene.classList.contains('uc-scene--autre')) return;

    let flipped = false;

    const flip = () => {
        if (flipped) return;
        flipped = true;
        card.classList.add('uc-card3d--flip');

        if (confirm) {
            setTimeout(() => {
                confirm.hidden = false;
                confirm.style.opacity    = '0';
                confirm.style.transform  = 'translateY(10px)';
                confirm.style.transition = 'opacity .35s, transform .35s';
                requestAnimationFrame(() => {
                    confirm.style.opacity   = '1';
                    confirm.style.transform = 'translateY(0)';
                });
            }, 650);
        }
    };

    scene.addEventListener('click', flip);
    scene.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); }
    });

    btnOk?.addEventListener('click', () => {
        // L'hôte marque sa propre carte localement (pas de WS nécessaire)
        S._rolesVus.add(pseudo);
        _majSuivi(total, onTousVus);

        if (confirm) confirm.innerHTML = '<p class="uc-vu-msg">✅ Rôle mémorisé !</p>';
        card.classList.add('uc-card3d--vu');
    });
}


// ──────────────────────────────────────────────────────────────
// MAJ COMPTEUR + BADGES + PROGRESSION
// ──────────────────────────────────────────────────────────────
function _majSuivi(total, onTousVus) {
    const nb = S._rolesVus.size;

    const countEl = document.getElementById('uc-roles-vus-count');
    if (countEl) countEl.textContent = String(nb);

    S._rolesVus.forEach(p => {
        const el = document.getElementById(`uc-statut-${_s(p)}`);
        if (el && el.textContent === '⏳') {
            el.textContent = '✅';
            el.classList.add('uc-badge-ok');
        }
    });

    const suiviInvites = document.getElementById('uc-invites-status');
    if (suiviInvites) {
        const pct = Math.round((nb / total) * 100);
        suiviInvites.innerHTML = `
            <div style="width:100%;height:4px;background:rgba(255,255,255,.08);border-radius:2px;margin-top:8px">
                <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,#6a5af9,#4ade80);border-radius:2px;transition:width .4s"></div>
            </div>`;
    }

    const btnL = document.getElementById('uc-btn-lancer-debat');
    if (btnL && nb >= total) {
        btnL.disabled = false;
        btnL.classList.add('uc-btn-lancer--go');
    }

    if (nb >= total) {
        const wrap = document.getElementById('uc-btn-commencer-wrap');
        if (wrap) wrap.hidden = false;
    }
}


// ──────────────────────────────────────────────────────────────
// ÉCOUTE DES role_vu (FILTRÉ PAR SESSION + ANTI-DOUBLONS)
// ──────────────────────────────────────────────────────────────
function _ecouterRolesVus(total, onTousVus) {
    // Stopper une écoute précédente si elle existe
    if (S._stopEcoute) {
        S._stopEcoute();
        S._stopEcoute = null;
    }

    const sid      = getSid();
    const cle      = `partie_reponses_${sid}`;
    const partieTs = S._partieTs;

    const traiter = raw => {
        if (!raw) return;
        let arr; try { arr = JSON.parse(raw); } catch { return; }
        if (!Array.isArray(arr)) return;
        arr.forEach(item => {
            if (item.action !== 'role_vu') return;
            if ((item.ts || 0) < partieTs) return;              // résidu ancienne partie
            if (!S.joueursEnJeu.includes(item.pseudo)) return;  // joueur inconnu
            if (S._rolesVus.has(item.pseudo)) return;           // anti-doublon
            S._rolesVus.add(item.pseudo);
            _majSuivi(total, onTousVus);
        });
    };

    const scan = () => { const raw = localStorage.getItem(cle); if (raw) traiter(raw); };
    const handler = e => { if (e.key === cle) scan(); };
    window.addEventListener('storage', handler);
    const iv = setInterval(scan, 600);
    S._stopEcoute = () => { window.removeEventListener('storage', handler); clearInterval(iv); };
    scan();
}

// ──────────────────────────────────────────────────────────────
// PHASE DÉBAT
// ──────────────────────────────────────────────────────────────
// Helper : clone propre du bouton principal, 0 listener résiduel
function _bindBtn(id, label, handler) {
    const old = document.getElementById(id);
    if (!old) return;
    const btn = old.cloneNode(false);
    btn.id = id; btn.className = old.className;
    btn.textContent = label; btn.style.display = 'block'; btn.disabled = false;
    btn.addEventListener('click', handler);
    old.replaceWith(btn);
}

export function demarrerDebat() {
    if (S._stopEcoute)      { S._stopEcoute();      S._stopEcoute = null; }
    if (S._stopEcouteVotes) { S._stopEcouteVotes(); S._stopEcouteVotes = null; }
    S.voteOuvert = false;
    S._votes     = {};
    _pub('debat');

    const pt = document.getElementById('undercover-phase-texte');
    if (pt) pt.textContent = '🗣️ Phase de débat — chacun donne un indice !';

    const th = document.getElementById('uc-theme-hote');
    const tv = document.getElementById('uc-theme-valeur');
    if (th) th.hidden = false;
    if (tv) tv.textContent = S.theme;

    _majListeJoueurs();

    const vr = document.getElementById('uc-votes-recap');
    if (vr) vr.hidden = true;
    const vw = document.getElementById('uc-vote-hote-wrap');
    if (vw) { vw.hidden = true; vw.innerHTML = ''; }

    _bindBtn('undercover-voter', '🗳️ Passer au vote', () => ouvrirVote());
}

function _majListeJoueurs() {
    const c = document.getElementById('undercover-joueurs');
    if (!c) return;
    c.innerHTML = Object.keys(S.roles).map(p => {
        const en = S.joueursEnJeu.includes(p);
        return `<div class="uc-joueur-item ${en ? '' : 'uc-joueur-elimine'}">
            <span>${en ? '🟢' : '❌'}</span>
            <span class="uc-j-nom">${_h(p)}</span>
            ${!en ? `<span class="uc-j-role">${_lr(S.roles[p])}</span>` : ''}
        </div>`;
    }).join('');
}

// ──────────────────────────────────────────────────────────────
// PHASE VOTE
// ──────────────────────────────────────────────────────────────
export function ouvrirVote() {
    if (S._stopEcoute)      { S._stopEcoute();      S._stopEcoute = null; }
    if (S._stopEcouteVotes) { S._stopEcouteVotes(); S._stopEcouteVotes = null; }

    S.voteOuvert = true;
    S._votes     = {};

    // Purger les votes résiduels PUIS horodater
    _purgerVotesSession();
    S._voteRoundTs = Date.now();

    _pub('vote');

    const pt = document.getElementById('undercover-phase-texte');
    if (pt) pt.textContent = '🗳️ Phase de vote — qui suspectes-tu ?';

    const vr  = document.getElementById('uc-votes-recap');
    const cnt = document.getElementById('uc-votes-recus-count');
    const tot = document.getElementById('uc-votes-total');
    const det = document.getElementById('uc-votes-detail');
    if (vr)  vr.hidden = false;
    if (cnt) cnt.textContent = '0';
    if (tot) tot.textContent = String(S.joueursEnJeu.length);
    if (det) det.innerHTML   = '';

    // Reconstruire la zone de vote hôte — garantit 0 listener résiduel
    const vw = document.getElementById('uc-vote-hote-wrap');
    if (vw) {
        vw.hidden = false;
        vw.innerHTML = `
            <div class="uc-section-label">Ton vote (hôte)</div>
            <div id="uc-vote-hote-select" class="uc-vote-hote-select"></div>`;
        const vs    = document.getElementById('uc-vote-hote-select');
        const cands = S.joueursEnJeu.filter(j => j !== S._pseudoHote);
        cands.forEach(j => {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'uc-vote-btn'; b.textContent = `👤 ${j}`;
            b.dataset.cible = j;
            b.addEventListener('click', () => {
                if (S._votes[S._pseudoHote]) return;
                _enrVote(S._pseudoHote, j);
                vs.querySelectorAll('.uc-vote-btn').forEach(x => {
                    x.disabled = true;
                    x.classList.toggle('uc-vote-btn--on', x.dataset.cible === j);
                });
            });
            vs.appendChild(b);
        });
    }

    _bindBtn('undercover-voter', '✅ Valider les votes', () => _validerVotes());
    // Les votes des invités arrivent désormais via WS (_onPlayerActionWS)
}

function _enrVote(pseudo, cible) {
    if (S._votes[pseudo]) return;
    S._votes[pseudo] = cible;
    _majTally();
    _publierEtatPublic(); // diffuser le tally à tous (hôte + invités)
}

function _majTally() {
    // Filtre défensif : votant ET cible doivent être en jeu
    const valides = Object.fromEntries(
        Object.entries(S._votes).filter(([votant, cible]) =>
            S.joueursEnJeu.includes(votant) && S.joueursEnJeu.includes(cible)
        )
    );
    const nb  = Object.keys(valides).length;
    const tot = S.joueursEnJeu.length;

    const cnt   = document.getElementById('uc-votes-recus-count');
    const totEl = document.getElementById('uc-votes-total');
    const det   = document.getElementById('uc-votes-detail');
    if (cnt)   cnt.textContent   = String(nb);
    if (totEl) totEl.textContent = String(tot);
    if (!det) return;

    const t = {};
    Object.values(valides).forEach(c => { t[c] = (t[c]||0)+1; });
    det.innerHTML = Object.entries(t).sort((a,b)=>b[1]-a[1]).map(([n,v]) => `
        <div class="uc-vote-tally">
            <div class="uc-vt-bar-bg">
                <div class="uc-vt-bar-fill" style="width:${Math.round((v/tot)*100)}%"></div>
            </div>
            <div class="uc-vt-content">
                <span class="uc-vt-nom">${_h(n)}</span>
                <span class="uc-vt-count">${v} vote${v>1?'s':''}</span>
            </div>
        </div>`).join('');
}

function _ecouterVotes() {
    const partieTs = S._partieTs;
    const roundTs  = S._voteRoundTs;
    let lastScan   = 0;

    const traiter = raw => {
        if (!raw) return;
        let arr; try { arr = JSON.parse(raw); } catch { return; }
        if (!Array.isArray(arr)) return;
        arr.forEach(item => {
            if (item.action !== 'vote') return;
            if ((item.ts || 0) < partieTs) return;                // ancienne partie
            if ((item.ts || 0) < roundTs)  return;                // ancien round
            if (!S.joueursEnJeu.includes(item.pseudo)) return;    // joueur inconnu
            if (!item.data?.cible) return;
            if (!S.joueursEnJeu.includes(item.data.cible)) return; // cible invalide
            if (S._votes[item.pseudo]) return;                     // déjà compté
            S._votes[item.pseudo] = item.data.cible;
            _majTally();
        });
    };

    const scan = () => {
        const now = Date.now();
        if (now - lastScan < 200) return;
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
    scan();
}

function _validerVotes() {
    if (!Object.keys(S._votes).length) { alert('Aucun vote reçu !'); return; }
    if (S._stopEcouteVotes) { S._stopEcouteVotes(); S._stopEcouteVotes = null; }
    const t = {};
    Object.values(S._votes).forEach(c => { t[c]=(t[c]||0)+1; });
    const [elim] = Object.entries(t).sort((a,b)=>b[1]-a[1])[0];
    console.log('[UC-VOTE] ✅ Valider → éliminé :', elim, '| tally :', t);
    eliminerJoueur(elim);
}

// ──────────────────────────────────────────────────────────────
// ÉLIMINATION
// ──────────────────────────────────────────────────────────────
export function eliminerJoueur(pseudo) {
    if (!pseudo) return;
    S.elimine      = pseudo;
    S.joueursEnJeu = S.joueursEnJeu.filter(j => j !== pseudo);
    S.voteOuvert   = false;
    S._votes       = {};

    if (S.roles[pseudo] === 'MisterWhite') {
        _pub('elimination');
        _afficherDevinetteMW(pseudo); return;
    }

    const fin = _checkFin();
    if (fin) _terminer(fin.msg, fin.who);
    else     { _pub('elimination'); _afficherPostElim(pseudo); }
}

function _afficherPostElim(pseudo) {
    const pt = document.getElementById('undercover-phase-texte');
    if (pt) pt.innerHTML = `❌ <strong>${_h(pseudo)}</strong> éliminé — rôle : ${_lr(S.roles[pseudo])}`;
    _majListeJoueurs();
    const vr = document.getElementById('uc-votes-recap'); if (vr) vr.hidden = true;
    const vw = document.getElementById('uc-vote-hote-wrap'); if (vw) vw.hidden = true;
    _bindBtn('undercover-voter', '🎤 Nouveau tour', () => demarrerDebat());
}

function _afficherDevinetteMW(pseudo) {
    const pt = document.getElementById('undercover-phase-texte');
    if (pt) pt.innerHTML = `🎩 <strong>${_h(pseudo)}</strong> éliminé — peut deviner le mot Civil !`;
    const vw = document.getElementById('uc-vote-hote-wrap');
    if (vw) {
        vw.hidden = false;
        vw.innerHTML = `
            <div class="uc-section-label">🎩 Devinette Mister White</div>
            <div style="display:flex;gap:8px;margin-top:8px">
                <input id="uc-mw-inp" class="input-primary" type="text"
                    placeholder="Quel est le mot Civil ?" autocomplete="off" style="flex:1">
                <button id="uc-mw-btn" class="btn-primary">🎯 Valider</button>
            </div>`;
        document.getElementById('uc-mw-btn')?.addEventListener('click', () => {
            const v = document.getElementById('uc-mw-inp')?.value?.trim();
            if (v) verifierDevinetteMW(pseudo, v);
        });
    }
}

export function verifierDevinetteMW(pseudo, rep) {
    if (S.roles[pseudo] !== 'MisterWhite') return;
    const ok = rep.trim().toLowerCase() === S.mots.civil.trim().toLowerCase();
    if (ok) _terminer(`🎩 ${pseudo} (Mister White) a deviné ! Il gagne !`, 'MisterWhite');
    else {
        const fin = _checkFin();
        if (fin) _terminer(fin.msg, fin.who);
        else     { _pub('elimination'); _afficherPostElim(pseudo); }
    }
}

function _checkFin() {
    const nUC  = S.joueursEnJeu.filter(j=>S.roles[j]==='Undercover').length;
    const nCiv = S.joueursEnJeu.filter(j=>S.roles[j]==='Civil').length;
    const nMW  = S.joueursEnJeu.filter(j=>S.roles[j]==='MisterWhite').length;
    if (nUC===0 && nMW===0) return { msg:'🎉 Les Civils ont gagné !', who:'Civils' };
    if (nUC>=nCiv)          return { msg:'🕵️ Les Undercovers ont gagné !', who:'Undercovers' };
    return null;
}

function _terminer(msg, who) {
    S.finMessage = msg; S.finGagnant = who;
    _pub('fin');
    Object.keys(S.roles).forEach(p => {
        const r=S.roles[p]; let pts=0;
        if (who==='Civils' && r==='Civil') pts=3;
        if (who==='Undercovers' && r==='Undercover') pts=5;
        if (who==='MisterWhite' && r==='MisterWhite') pts=4;
        if (pts>0) crediterPoints(p, pts);
    });
    publierScores(GameState.scores);

    const pt = document.getElementById('undercover-phase-texte');
    if (pt) pt.innerHTML = `<strong>${_h(msg)}</strong><br><small>Mots — Civil : <em>${_h(S.mots.civil)}</em> / Undercover : <em>${_h(S.mots.undercover)}</em></small>`;
    const btn = document.getElementById('undercover-voter'); if (btn) btn.style.display='none';

    const jl = document.getElementById('undercover-joueurs');
    if (jl) jl.innerHTML = Object.entries(S.roles).map(([p,r])=>
        `<div class="uc-joueur-item uc-joueur-fin">
            <span class="uc-j-nom">${_h(p)}</span>
            <span class="uc-j-role">${_lr(r)}</span>
            <span style="color:#a78bfa;font-size:.78rem">${r==='Civil'?S.mots.civil:r==='Undercover'?S.mots.undercover:'???'}</span>
        </div>`
    ).join('');

    // ── Bouton "Nouvelle partie" ─────────────────────────────
    // Retire l'ancien s'il existe, injecte un bouton frais
    document.getElementById('uc-btn-nouvelle-partie')?.remove();
    const btnNP = document.createElement('button');
    btnNP.id        = 'uc-btn-nouvelle-partie';
    btnNP.className = 'uc-btn-lancer uc-btn-lancer--go';
    btnNP.style.cssText = 'margin-top:20px;display:block;width:min(420px,90vw);margin-left:auto;margin-right:auto;';
    btnNP.textContent = '🔄 Nouvelle partie (mêmes joueurs)';
    btnNP.addEventListener('click', () => _allerVersConfig());
    // Insérer après la liste des joueurs ou après le bouton voter
    const ref = document.getElementById('undercover-joueurs') || document.getElementById('undercover-voter');
    if (ref) ref.insertAdjacentElement('afterend', btnNP);
    else document.getElementById('undercover')?.appendChild(btnNP);
}

// ── Relancer une partie avec les mêmes joueurs ─────────────────
async function lancerNouvellePartie() {
    const joueurs = Object.keys(S.roles); // tous les joueurs de la partie précédente
    if (!joueurs.length) return;

    document.getElementById('uc-btn-nouvelle-partie')?.remove();

    const nbUC = Math.max(1, parseInt(document.getElementById('uc-nb-undercover')?.value ?? '1', 10) || 1);
    const nbMW = Math.max(0, parseInt(document.getElementById('uc-nb-misterwhite')?.value ?? '0', 10) || 0);

    // Réinitialiser la section principale
    const pt = document.getElementById('undercover-phase-texte');
    if (pt) pt.textContent = '⏳ Nouveau tirage en cours…';
    const btnVoter = document.getElementById('undercover-voter');
    if (btnVoter) btnVoter.style.display = 'none';
    const jl = document.getElementById('undercover-joueurs');
    if (jl) jl.innerHTML = '';
    const vr = document.getElementById('uc-votes-recap'); if (vr) vr.hidden = true;
    const vw = document.getElementById('uc-vote-hote-wrap'); if (vw) { vw.hidden = true; vw.innerHTML = ''; }

    // Réinitialiser les compteurs suivi
    const countEl = document.getElementById('uc-roles-vus-count'); if (countEl) countEl.textContent = '0';
    const totalEl = document.getElementById('uc-roles-total-invites'); if (totalEl) totalEl.textContent = String(joueurs.length);
    const barEl   = document.getElementById('uc-invites-status'); if (barEl) barEl.innerHTML = '';
    const suiviEl = document.getElementById('uc-suivi-invites'); if (suiviEl) suiviEl.hidden = false;

    // Nouveau tirage
    await initialiserPartie({ joueurs, nbUndercover: nbUC, nbMisterWhite: nbMW });

    // Signal de démarrage pour les invités
    try {
        const sid = getSid();
        const { signalDemarrage } = await import('../core/signal.js');
        signalDemarrage(sid, 'undercover');
        localStorage.setItem('partie_etat_' + sid, 'en_cours');
    } catch (e) { console.error('[UC] Signal nouvelle partie :', e); }

    // Afficher la distribution
    afficherDistribution(joueurs[0]);
}

// ──────────────────────────────────────────────────────────────
// ACTIONS INVITÉS
// ──────────────────────────────────────────────────────────────
export function ajouterActionInvite(pseudo, action, data={}) {
    const sid = getSid(); const cle = sid ? `partie_reponses_${sid}` : null; if (!cle) return;
    let a=[]; try { a=JSON.parse(localStorage.getItem(cle)||'[]'); } catch {}
    if (!Array.isArray(a)) a=[];
    a = a.filter(x=>!(x.pseudo===pseudo && x.action===action));
    a.push({ pseudo, action, data, ts:Date.now() });
    localStorage.setItem(cle, JSON.stringify(a));
}

export function ecouterActionsInvites(onAction) {
    const vus=new Set();
    const tr=raw=>{
        if(!raw) return; let arr; try{arr=JSON.parse(raw);}catch{return;}
        if(!Array.isArray(arr)) return;
        arr.forEach(item=>{
            const k=`${item.pseudo}_${item.action}_${item.ts}`;
            if(vus.has(k)) return; vus.add(k);
            try{onAction(item);}catch(e){console.error(e);}
        });
    };
    const scan=()=>{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith('partie_reponses_'))tr(localStorage.getItem(k));}};
    const h=e=>{if(e.key?.startsWith('partie_reponses_'))scan();};
    window.addEventListener('storage',h);
    const iv=setInterval(scan,500);
    return ()=>{window.removeEventListener('storage',h);clearInterval(iv);};
}

export function viderReponses() {
    const d=[];
    for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith('partie_reponses_'))d.push(k);}
    d.forEach(k=>localStorage.removeItem(k));
}

// ──────────────────────────────────────────────────────────────
// SCORES
// ──────────────────────────────────────────────────────────────
export function crediterPoints(pseudo, delta) {
    if(!pseudo||!delta||delta<=0) return;
    if(GameState.scores[pseudo]===undefined) GameState.scores[pseudo]=0;
    GameState.scores[pseudo]=+((GameState.scores[pseudo]+delta).toFixed(2));
    try {
        const sg=JSON.parse(localStorage.getItem('scores_globaux')||'{}');
        if(!sg[pseudo]) sg[pseudo]={total:0,parJeu:{}};
        sg[pseudo].total=+((sg[pseudo].total||0)+delta).toFixed(2);
        sg[pseudo].parJeu.undercover=+((sg[pseudo].parJeu.undercover||0)+delta).toFixed(2);
        localStorage.setItem('scores_globaux',JSON.stringify(sg));
    } catch {}
    if(typeof window.afficherScoreboard==='function') window.afficherScoreboard();
}

export function publierScores(scores) {
    const sid=getSid(); if(sid) localStorage.setItem(cleS(),JSON.stringify(scores||{}));
}

// ──────────────────────────────────────────────────────────────
// NETTOYAGE
// ──────────────────────────────────────────────────────────────
export function nettoyerPartie() {
    if(S._stopEcoute){S._stopEcoute();S._stopEcoute=null;}
    viderReponses();
    const sid=getSid();
    if(sid){localStorage.removeItem(`partie_question_${sid}`);localStorage.removeItem(`partie_scores_${sid}`);}
    publierEtat('fin');
}

// ──────────────────────────────────────────────────────────────
// 🔌 BOUTON CONFIRMER — appelé par main.js dans initStartSolo()
// ──────────────────────────────────────────────────────────────
export function bindBoutonDemarrer(onTousVus) {
    const btn = document.getElementById('btn-start-undercover-config');
    if (!btn) {
        console.warn('[UC] #btn-start-undercover-config introuvable');
        return;
    }

    // Éviter les double-bindings si l'utilisateur revient en arrière
    if (btn._ucBound) {
        btn._ucBound = false;
        btn.replaceWith(btn.cloneNode(true)); // retire tous les anciens listeners
    }
    const freshBtn = document.getElementById('btn-start-undercover-config');

    freshBtn._ucBound = true;
    freshBtn.addEventListener('click', async () => {

        // ───────────────────────────────────────────────
        // 1) Vérifications de base
        // ───────────────────────────────────────────────
        const joueurs = GameState.joueurs || [];
        if (joueurs.length < 3) {
            alert('Il faut au moins 3 joueurs !');
            return;
        }

        const nbUC = Math.max(1, parseInt(document.getElementById('uc-nb-undercover')?.value ?? '1', 10) || 1);
        const nbMW = Math.max(0, parseInt(document.getElementById('uc-nb-misterwhite')?.value ?? '0', 10) || 0);

        const orig = freshBtn.innerHTML;
        freshBtn.disabled  = true;
        freshBtn.innerHTML = '<span class="btn-icon">⏳</span> Tirage en cours…';

        // ───────────────────────────────────────────────
        // 2) Tirage des rôles
        // ───────────────────────────────────────────────
        await initialiserPartie({ joueurs, nbUndercover: nbUC, nbMisterWhite: nbMW });

        // 2b) Démarrer la partie côté serveur → les invités reçoivent
        //     GAME_STARTED et chargent le module invité undercover_player.js.
        try { HostSession.notifierDemarrage(); }
        catch (e) { console.error('[UC] notifierDemarrage:', e); }

        // ───────────────────────────────────────────────
        // 3) Signal start + état en cours
        // ───────────────────────────────────────────────
        try {
            const sid = GameState.sessionId;
            signalDemarrage(sid, "undercover");
            localStorage.setItem("partie_etat_" + sid, "en_cours");
        } catch (e) {
            console.error("[UC] Impossible de publier le signal start :", e);
        }

        freshBtn.disabled  = false;
        freshBtn.innerHTML = orig;

        // ───────────────────────────────────────────────
        // 4) Réinitialisation complète de l'état visuel
        // ───────────────────────────────────────────────
        S._rolesVus = new Set();

        // Réinitialiser les statuts individuels
        joueurs.forEach(p => {
            const st = document.getElementById(`uc-statut-${_s(p)}`);
            if (st) {
                st.textContent = '⏳';
                st.classList.remove('uc-badge-ok');
            }
        });

        // Réinitialiser le compteur
        const countEl = document.getElementById('uc-roles-vus-count');
        if (countEl) countEl.textContent = '0';

        // Réinitialiser le total
        const totalEl = document.getElementById('uc-roles-total-invites');
        if (totalEl) totalEl.textContent = String(joueurs.length);

        // Réinitialiser la barre de progression
        const suiviInvites = document.getElementById('uc-invites-status');
        if (suiviInvites) suiviInvites.innerHTML = '';

        // Réinitialiser le bouton “Lancer le débat”
        const btnLancer = document.getElementById('uc-btn-lancer-debat');
        if (btnLancer) {
            btnLancer.disabled = true;
            btnLancer.classList.remove('uc-btn-lancer--go');
        }

        // ───────────────────────────────────────────────
        // 5) Masquer la configuration
        // ───────────────────────────────────────────────
        const grid    = document.querySelector('#undercover-config .config-grid');
        const btnConf = document.getElementById('btn-start-undercover-config');
        const titre   = document.getElementById('undercover-config-title');

        if (grid)    grid.style.display   = 'none';
        if (btnConf) btnConf.style.display = 'none';
        if (titre)   titre.style.display  = 'none';

        // ───────────────────────────────────────────────
        // 6) Afficher l'écran de distribution
        // ───────────────────────────────────────────────
        afficherDistribution(joueurs[0], onTousVus);
    });
}





// ── Redirection vers l'écran de configuration (Nouvelle partie) ──
function _allerVersConfig() {
    // Retirer le bouton Nouvelle partie
    document.getElementById('uc-btn-nouvelle-partie')?.remove();

    // Masquer les sections jeu et distribution
    const ucGame   = document.getElementById('undercover');
    const ucDistrib = document.getElementById('undercover-distribution');
    if (ucGame)    { ucGame.hidden = true;    ucGame.style.display = 'none'; }
    if (ucDistrib) { ucDistrib.hidden = true; ucDistrib.style.display = 'none'; }

    // Afficher la config
    const ucConfig = document.getElementById('undercover-config');
    if (ucConfig) {
        ucConfig.hidden = false;
        ucConfig.style.display = 'block';
    }

    // Réafficher les éléments de config masqués
    const grid    = document.querySelector('#undercover-config .config-grid');
    const btnConf = document.getElementById('btn-start-undercover-config');
    const titre   = document.getElementById('undercover-config-title');
    if (grid)    grid.style.display    = '';
    if (btnConf) btnConf.style.display = '';
    if (titre)   titre.style.display   = '';

    // Afficher le conteneur principal si masqué
    const container = document.getElementById('container');
    if (container) { container.hidden = false; container.style.display = 'block'; }

    // Masquer home / liste-parties
    const home  = document.getElementById('home');
    const liste = document.getElementById('liste-parties');
    if (home)  home.hidden = true;
    if (liste) liste.hidden = true;

    // Pré-remplir le nombre de joueurs
    const spanNb = document.getElementById('uc-nb-joueurs');
    if (spanNb) spanNb.textContent = String(Object.keys(S.roles).length);

    console.log('[UC] 🔄 Retour à la configuration');
}

// ──────────────────────────────────────────────────────────────
// UTILITAIRES
// ──────────────────────────────────────────────────────────────
const _h  = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const _s  = s => String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'_');
const _lr = r => ({Civil:'🟢 Civil',Undercover:'🔴 Undercover',MisterWhite:'🎩 Mister White'})[r]||r;

function _cfg(role) {
    return ({
        Civil:       { cls:'civil',      icon:'🟢', label:'Civil',        color:'#4ade80', glow:'radial-gradient(circle at 50% 0%,rgba(74,222,128,.4) 0%,transparent 65%)',  conseil:'Tu es un <strong>Civil</strong>. Décris ton mot sans le dire. Repère l\'imposteur !' },
        Undercover:  { cls:'undercover', icon:'🔴', label:'Undercover',   color:'#f87171', glow:'radial-gradient(circle at 50% 0%,rgba(248,113,113,.4) 0%,transparent 65%)', conseil:'Tu es l\'<strong>Undercover</strong>. Ton mot est légèrement différent. Blends-toi !' },
        MisterWhite: { cls:'mw',         icon:'🎩', label:'Mister White', color:'#fbbf24', glow:'radial-gradient(circle at 50% 0%,rgba(251,191,36,.4) 0%,transparent 65%)',  conseil:'Tu es le <strong>Mister White</strong>. Pas de mot. Écoute et improvise !' },
    })[role] ?? { cls:'civil', icon:'❓', label:role, color:'white', glow:'', conseil:'' };
}

// ──────────────────────────────────────────────────────────────
// CSS (injecté une seule fois)
// ──────────────────────────────────────────────────────────────
function _injecterCSS() {
    if (document.getElementById('uc-dist-css')) return;
    const s = document.createElement('style');
    s.id = 'uc-dist-css';
    s.textContent = `

/* ── GRILLE DE CARTES ─────────────────────────────── */
.undercover-cartes-joueurs {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    justify-content: center;
    padding: 16px 0;
    width: 100%;
}

/* ── SLOT ─────────────────────────────────────────── */
.uc-carte-slot {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
}

.uc-carte-nom {
    font-size: .72rem;
    font-weight: 700;
    letter-spacing: .07em;
    color: rgba(255,255,255,.45);
    text-transform: uppercase;
}
.uc-carte-nom--moi { color: #c4b5fd; }

/* ── SCÈNE 3D ─────────────────────────────────────── */
.uc-scene {
    border-radius: 16px;
    /* Cartes des autres : petites */
    width: 120px;
    height: 168px;
    perspective: 900px;
}
/* Carte de l'hôte : plus grande et cliquable */
.uc-scene--moi {
    width: 168px;
    height: 230px;
    cursor: pointer;
    outline: none;
    -webkit-tap-highlight-color: transparent;
}
.uc-scene--moi:focus-visible {
    box-shadow: 0 0 0 3px rgba(167,139,250,.6);
    border-radius: 16px;
}
/* Cartes des autres : verrou absolu */
.uc-scene--autre {
    opacity: .65;
    filter: saturate(.4);
    cursor: default;
    pointer-events: none; /* ← IMPOSSIBLE de cliquer */
}

/* ── CARTE ────────────────────────────────────────── */
.uc-card3d {
    width: 100%;
    height: 100%;
    position: relative;
    transform-style: preserve-3d;
    transition: transform .65s cubic-bezier(.4,0,.2,1);
    border-radius: 16px;
}
.uc-card3d--flip { transform: rotateY(180deg); }
.uc-card3d--vu   {
    box-shadow: 0 0 0 2px rgba(74,222,128,.55),
                0 0 16px rgba(74,222,128,.2);
}

.uc-face {
    position: absolute;
    inset: 0;
    border-radius: 16px;
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
    overflow: hidden;
}

/* ── DOS ──────────────────────────────────────────── */
.uc-dos {
    background: linear-gradient(150deg, #1e1240 0%, #0b0718 100%);
    border: 1.5px solid rgba(167,139,250,.22);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    box-shadow: 0 10px 32px rgba(0,0,0,.5);
}
.uc-dos-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    user-select: none;
}
.uc-dos-logo {
    font-size: 2.2rem;
    filter: drop-shadow(0 0 12px rgba(167,139,250,.6));
    animation: uc-float 3s ease-in-out infinite;
}
@keyframes uc-float { 0%,100%{ transform:translateY(0) } 50%{ transform:translateY(-5px) } }

.uc-dos-label {
    font-size: .6rem;
    font-weight: 800;
    letter-spacing: .2em;
    color: rgba(167,139,250,.45);
    text-transform: uppercase;
}
.uc-dos-hint {
    position: absolute;
    bottom: 12px;
    font-size: .6rem;
    font-weight: 700;
    letter-spacing: .12em;
    color: rgba(255,255,255,.28);
    text-transform: uppercase;
    animation: uc-blink 2.4s ease-in-out infinite;
}
@keyframes uc-blink { 0%,100%{opacity:.28} 50%{opacity:.7} }

/* Overlay verrou */
.uc-verrou {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: rgba(0,0,0,.32);
    backdrop-filter: blur(2px);
}
.uc-verrou-icon { font-size: 1.4rem; opacity: .55; }
.uc-verrou-nom  {
    font-size: .58rem;
    font-weight: 700;
    letter-spacing: .08em;
    color: rgba(255,255,255,.4);
    text-transform: uppercase;
    text-align: center;
    padding: 0 8px;
}

/* ── FACE RECTO ───────────────────────────────────── */
.uc-face-front {
    transform: rotateY(180deg);
    border: 1.5px solid rgba(255,255,255,.1);
    box-shadow: 0 10px 32px rgba(0,0,0,.5);
    display: flex;
    align-items: stretch;
}
.uc-face-front--civil      { background:linear-gradient(160deg,#0d2218 0%,#060e0b 100%); border-color:rgba(74,222,128,.28); }
.uc-face-front--undercover { background:linear-gradient(160deg,#22100d 0%,#0e0606 100%); border-color:rgba(248,113,113,.28); }
.uc-face-front--mw         { background:linear-gradient(160deg,#21180a 0%,#0e0d05 100%); border-color:rgba(251,191,36,.28); }

.uc-face-glow {
    position: absolute;
    inset: 0;
    pointer-events: none;
    border-radius: 14px;
}
.uc-face-inner {
    position: relative;
    z-index: 1;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 9px;
    padding: 16px 10px;
    box-sizing: border-box;
}
.uc-role-icon { font-size: 1.9rem; line-height: 1; }
.uc-role-name {
    font-size: .85rem;
    font-weight: 900;
    letter-spacing: .04em;
    text-transform: uppercase;
    text-align: center;
}
.uc-sep { width: 32px; height: 1.5px; background: rgba(255,255,255,.1); border-radius: 2px; }

.uc-mot-bloc {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    background: rgba(255,255,255,.05);
    border: 1px solid rgba(255,255,255,.08);
    border-radius: 10px;
    padding: 9px 10px;
    width: 100%;
    box-sizing: border-box;
    text-align: center;
}
.uc-mot-mw    { border-color:rgba(251,191,36,.18); background:rgba(251,191,36,.04); }
.uc-mot-lab   { font-size:.52rem; font-weight:800; letter-spacing:.2em; color:rgba(255,255,255,.35); text-transform:uppercase; }
.uc-mot-val   { font-size:1.05rem; font-weight:900; color:white; word-break:break-word; }
.uc-mot-sub   { font-size:.62rem; color:rgba(251,191,36,.65); font-style:italic; }
.uc-theme-pill{ font-size:.62rem; font-weight:600; color:rgba(255,255,255,.38); background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.07); border-radius:14px; padding:2px 8px; }

/* ── CONFIRMATION ─────────────────────────────────── */
.uc-confirm-bloc {
    width: 168px;
}
.uc-conseil {
    font-size: .78rem;
    color: rgba(255,255,255,.55);
    text-align: center;
    line-height: 1.6;
    margin: 0 0 10px;
}
.uc-conseil strong { color: rgba(255,255,255,.9); }
.uc-vu-msg {
    font-size: .8rem;
    color: rgba(74,222,128,.85);
    text-align: center;
    padding: 8px 0;
    margin: 0;
}
.uc-btn-ok {
    display: block;
    width: 100%;
    padding: 11px;
    background: linear-gradient(135deg, #059669, #047857);
    border: none;
    border-radius: 12px;
    color: white;
    font-size: .85rem;
    font-weight: 800;
    cursor: pointer;
    font-family: inherit;
    box-shadow: 0 3px 12px rgba(5,150,105,.3);
    transition: transform .15s, box-shadow .15s;
}
.uc-btn-ok:hover { transform:translateY(-2px); box-shadow:0 5px 18px rgba(5,150,105,.45); }

/* ── STATUT BADGE ─────────────────────────────────── */
.uc-badge-statut { font-size: .95rem; min-height: 1.3rem; }
.uc-badge-ok     { animation: uc-pop .3s cubic-bezier(.4,0,.2,1); }
@keyframes uc-pop { 0%{transform:scale(1.6)} 100%{transform:scale(1)} }

/* ── BOUTON LANCER ────────────────────────────────── */
.uc-btn-lancer {
    display: block;
    width: min(420px, 90vw);
    margin: 16px auto 0;
    padding: 15px;
    background: rgba(99,102,241,.2);
    border: 1.5px solid rgba(99,102,241,.3);
    border-radius: 14px;
    color: white;
    font-size: 1rem;
    font-weight: 800;
    cursor: not-allowed;
    font-family: inherit;
    opacity: .4;
    transition: background .2s, border-color .2s, opacity .2s, transform .15s, box-shadow .15s;
}
.uc-btn-lancer:not(:disabled) { cursor: pointer; opacity: 1; }
.uc-btn-lancer--go {
    background: linear-gradient(135deg, #6a5af9, #8a2be2) !important;
    border-color: transparent !important;
    box-shadow: 0 4px 18px rgba(138,43,226,.4) !important;
    animation: uc-pulse 2s ease-in-out infinite;
}
@keyframes uc-pulse { 0%,100%{box-shadow:0 4px 18px rgba(138,43,226,.4)} 50%{box-shadow:0 6px 28px rgba(138,43,226,.65)} }

/* ── PHASE JEU (liste joueurs, votes) ────────────── */
.uc-joueur-item {
    display:flex;align-items:center;gap:10px;
    padding:10px 14px;border-radius:12px;
    background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);
    margin-bottom:8px;font-size:.9rem;
}
.uc-joueur-elimine { opacity:.5; }
.uc-j-nom  { flex:1;font-weight:700; }
.uc-j-role { font-size:.78rem;color:rgba(255,255,255,.5); }
.uc-joueur-fin { background:rgba(255,255,255,.04); }

.uc-vote-btn {
    display:block;width:100%;padding:12px 18px;
    background:rgba(255,255,255,.06);border:1.5px solid rgba(255,255,255,.12);
    border-radius:12px;color:white;font-size:.9rem;font-weight:700;
    cursor:pointer;font-family:inherit;text-align:left;margin-bottom:8px;
    transition:background .18s,border-color .18s,transform .12s;
}
.uc-vote-btn:hover:not(:disabled) {
    background:rgba(248,113,113,.14);border-color:rgba(248,113,113,.38);transform:translateX(4px);
}
.uc-vote-btn--on  { background:rgba(99,102,241,.25) !important;border-color:rgba(99,102,241,.5) !important; }
.uc-vote-btn:disabled { opacity:.5;cursor:not-allowed; }

.uc-tally {
    display:flex;align-items:center;gap:10px;
    padding:8px 12px;background:rgba(255,255,255,.04);
    border-radius:10px;margin-bottom:6px;
}
.uc-t-nom { flex:1;font-weight:700;font-size:.88rem; }
.uc-t-v   { font-size:.78rem;color:#a78bfa; }

/* ── TALLY BARRES ────────────────────────────────── */
.uc-vote-tally {
    position:relative;overflow:hidden;border-radius:10px;
    margin-bottom:6px;background:rgba(255,255,255,.04);
    border:1px solid rgba(255,255,255,.08);
}
.uc-vt-bar-bg  { position:absolute;inset:0; }
.uc-vt-bar-fill {
    height:100%;background:rgba(99,102,241,.18);
    transition:width .45s cubic-bezier(.4,0,.2,1);border-radius:10px;
}
.uc-vt-content {
    position:relative;z-index:1;display:flex;align-items:center;
    gap:10px;padding:10px 14px;
}
.uc-vt-nom   { flex:1;font-weight:700;font-size:.88rem; }
.uc-vt-count { font-size:.82rem;color:#a78bfa;font-weight:700;flex-shrink:0; }

    `;
    document.head.appendChild(s);
}