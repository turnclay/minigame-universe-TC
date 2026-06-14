/**
 * ============================================
 * 🎭 mimedessine.js — v7.0 (WS, modèle Pictionary numérique)
 * ============================================
 * Hôte ORCHESTRATEUR (source de vérité = serveur server/games/mimedessine.js) :
 *   1. Charge la banque de mots (data/MimeDessine.json).
 *   2. L'hôte choisit un DESSINATEUR (invité connecté) + une catégorie + un mot.
 *   3. "Préparer la manche" → mimedessine:choix_mot (le mot part au dessinateur).
 *   4. "Lancer le dessin" → mimedessine:start_dessin (timer serveur tsPhaseEnd).
 *   5. Le dessinateur dessine sur son canvas (mime_player.js) → diffusé en WS ;
 *      l'hôte VOIT le dessin live + les devinettes en temps réel.
 *   6. "Révéler le mot" → mimedessine:reveler_mot ; "Classement" → mimedessine:force_resultats.
 *
 * Actions émises (HOST_ACTION) :
 *   mimedessine:defi { config, motsDisponibles }
 *   mimedessine:choix_mot { mot, drawerPseudo }
 *   mimedessine:start_dessin {}
 *   mimedessine:reveler_mot {}
 *   mimedessine:force_resultats {}
 *
 * Events écoutés :
 *   MIMEDESSSINE_DEFI, MIMEDESSSINE_PHASE, MIMEDESSSINE_DRAWING_DATA,
 *   MIMEDESSSINE_GUESS_IN  (scores globaux gérés par host_session via SCORES_UPDATE)
 */

import { socket }    from "../core/socket.js";
import { GameState } from "../core/state.js";

const $   = id => document.getElementById(id);
const esc = s => String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// ── État module ──────────────────────────────────────────────
let _bank        = [];      // [{cat:mot, …}, …]
let _cats        = [];      // catégories (clés)
let _catActive   = null;
let _motChoisi   = null;
let _drawer      = null;
let _phase       = 'menu';
let _manche      = 0;
let _tsPhaseEnd  = null;
let _motRevele   = null;
let _guesses     = [];      // { pseudo, guess, correct }
let _ctxHote     = null;    // contexte canvas hôte (lecture seule)
let _timerIv     = null;

const CONFIG = { tempsDessin: 90000, tempsReponse: 15000, scoreDessinateur: 3, scoreGuesseur: 2 };

// ============================================================
// 🚀 INITIALISATION
// ============================================================
export async function initialiserMimer() {
    console.log('[MIMEDESSINE] Initialisation (WS)');
    _phase = 'menu'; _manche = 0; _motChoisi = null; _drawer = null;
    _guesses = []; _tsPhaseEnd = null; _motRevele = null; _stopTimer();

    await _chargerDonnees();
    _brancherSocket();

    // Initialise la session serveur + banque de mots (liste plate).
    const motsDisponibles = _cats.flatMap(c => _bank.map(r => r[c])).filter(Boolean);
    try {
        socket.send('HOST_ACTION', {
            action: 'mimedessine:defi',
            data: { config: CONFIG, motsDisponibles },
        });
    } catch (e) { console.error('[MIMEDESSINE] defi:', e.message); }

    _render();
}
window.initialiserMimer = initialiserMimer;

async function _chargerDonnees() {
    try {
        const r = await fetch('data/MimeDessine.json');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        _bank = await r.json();
        _cats = _bank.length ? Object.keys(_bank[0]) : [];
        _catActive = _cats[0] || null;
        console.log('[MIMEDESSINE] Banque:', _bank.length, 'lignes,', _cats.length, 'catégories');
    } catch (e) {
        console.error('[MIMEDESSINE] Chargement banque échoué:', e);
        _bank = []; _cats = [];
    }
}

// ── Liste des dessinateurs possibles (invités connectés) ─────
function _joueurs() {
    const j = (GameState.joueurs || []).slice();
    return j.filter(p => p && typeof p === 'string');
}

// ============================================================
// 📡 SOCKET (écoute serveur)
// ============================================================
function _brancherSocket() {
    if (socket._mimeHoteBound) return;
    socket._mimeHoteBound = true;

    socket.on('MIMEDESSSINE_DEFI', (p) => {
        if (p.phase) _phase = p.phase;
        if (p.manche != null) _manche = p.manche;
        if (p.drawerPseudo !== undefined) _drawer = p.drawerPseudo;
        _render();
    });

    socket.on('MIMEDESSSINE_PHASE', (p) => {
        if (p.phase) _phase = p.phase;
        if (p.manche != null) _manche = p.manche;
        if (p.tsPhaseEnd !== undefined) _tsPhaseEnd = p.tsPhaseEnd;
        if (p.drawerPseudo !== undefined) _drawer = p.drawerPseudo;
        if (p.motADeviner) _motRevele = p.motADeviner;
        if (p.phase === 'dessin') { _guesses = []; _motRevele = null; }
        _render();
        if (p.phase === 'dessin' && _tsPhaseEnd) _startTimer(); else _stopTimer();
    });

    socket.on('MIMEDESSSINE_DRAWING_DATA', (p) => {
        if (_phase === 'dessin' || _phase === 'reponse') _dessinerRecu(p.data);
    });

    socket.on('MIMEDESSSINE_GUESS_IN', (p) => {
        _guesses.push({ pseudo: p.pseudo, guess: p.guess, correct: !!p.correct });
        _majGuesses();
    });
}

// ============================================================
// 🖼️ RENDU (#mimer-content)
// ============================================================
function _render() {
    const c = $('mimer-content');
    if (!c) return;

    if (_phase === 'menu' || _phase === 'resultats') { _renderMenu(c); return; }
    if (_phase === 'choix_mot')                      { _renderPrep(c); return; }
    if (_phase === 'dessin' || _phase === 'reponse') { _renderDessin(c); return; }
    _renderMenu(c);
}

function _renderMenu(c) {
    const joueurs = _joueurs();
    const optsJ = joueurs.length
        ? joueurs.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('')
        : '';
    const optsC = _cats.map(cat => `<option value="${esc(cat)}"${cat === _catActive ? ' selected' : ''}>${esc(cat)}</option>`).join('');

    c.innerHTML = `
    <div class="mime-hote" style="display:flex;flex-direction:column;gap:14px;max-width:560px;margin:0 auto;">
        ${_phase === 'resultats' ? `<p style="text-align:center;color:#86efac;">🏁 Manche ${_manche} terminée — prépare la suivante.</p>` : ''}
        <h3 style="text-align:center;margin:0;color:#c4b5fd;">🎭 Préparer une manche</h3>

        ${joueurs.length ? '' : `<p style="text-align:center;color:#fca5a5;">Aucun invité connecté — partage le lien d'invitation pour qu'un joueur puisse dessiner.</p>`}

        <label style="display:flex;flex-direction:column;gap:4px;">Dessinateur (invité)
            <select id="mime-drawer" class="mime-select" style="padding:10px;border-radius:10px;">${optsJ}</select>
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;">Catégorie
            <select id="mime-cat" class="mime-select" style="padding:10px;border-radius:10px;">${optsC}</select>
        </label>

        <div style="display:flex;gap:10px;align-items:center;justify-content:center;">
            <button id="mime-nouveau-mot" class="btn-secondary">🎲 Nouveau mot</button>
            <span id="mime-mot-affiche" style="font-weight:700;color:#fff;">${_motChoisi ? esc(_motChoisi) : '—'}</span>
        </div>

        <button id="mime-preparer" class="btn-primary" ${(!joueurs.length || !_motChoisi) ? 'disabled' : ''}>
            ✅ Préparer la manche
        </button>
    </div>`;

    const selC = $('mime-cat');
    if (selC) selC.onchange = () => { _catActive = selC.value; _motChoisi = null; _render(); };

    const selD = $('mime-drawer');
    if (selD && _drawer && joueurs.includes(_drawer)) selD.value = _drawer;

    const bMot = $('mime-nouveau-mot');
    if (bMot) bMot.onclick = () => {
        _catActive = ($('mime-cat')?.value) || _catActive;
        const mots = _bank.map(r => r[_catActive]).filter(Boolean);
        _motChoisi = mots.length ? mots[Math.floor(Math.random() * mots.length)] : null;
        const span = $('mime-mot-affiche');
        if (span) span.textContent = _motChoisi || '—';
        const bp = $('mime-preparer'); if (bp) bp.disabled = (!_joueurs().length || !_motChoisi);
    };

    const bPrep = $('mime-preparer');
    if (bPrep) bPrep.onclick = () => {
        const drawer = ($('mime-drawer')?.value) || null;
        if (!drawer || !_motChoisi) return;
        _drawer = drawer;
        socket.send('HOST_ACTION', {
            action: 'mimedessine:choix_mot',
            data: { mot: _motChoisi, drawerPseudo: drawer },
        });
    };
}

function _renderPrep(c) {
    c.innerHTML = `
    <div class="mime-hote" style="display:flex;flex-direction:column;gap:16px;max-width:520px;margin:0 auto;text-align:center;">
        <h3 style="color:#c4b5fd;margin:0;">Manche ${_manche} prête</h3>
        <p>Dessinateur : <strong>${esc(_drawer || '—')}</strong></p>
        <p>Mot : <strong>${esc(_motChoisi || '—')}</strong> <span style="color:rgba(255,255,255,.5);">(visible seulement par le dessinateur)</span></p>
        <button id="mime-lancer" class="btn-primary">▶️ Lancer le dessin</button>
        <button id="mime-annuler" class="btn-secondary">↩️ Changer</button>
    </div>`;

    const bL = $('mime-lancer');
    if (bL) bL.onclick = () => socket.send('HOST_ACTION', { action: 'mimedessine:start_dessin', data: {} });

    const bA = $('mime-annuler');
    if (bA) bA.onclick = () => { _phase = 'menu'; _render(); };
}

function _renderDessin(c) {
    const fini = (_phase === 'reponse');
    c.innerHTML = `
    <div class="mime-hote" style="display:flex;flex-direction:column;gap:12px;max-width:680px;margin:0 auto;">
        <p style="text-align:center;color:#fff;margin:0;">
            ✏️ <strong>${esc(_drawer || '')}</strong> dessine${fini ? ' — terminé' : '…'}
            ${fini && _motRevele ? ` · Mot : <strong>${esc(_motRevele)}</strong>` : ''}
        </p>
        <div style="display:flex;justify-content:center;">
            <canvas id="mime-canvas-hote" width="600" height="400"
                style="max-width:100%;background:#fff;border-radius:10px;pointer-events:none;"></canvas>
        </div>
        <div id="mime-guesses" style="min-height:60px;display:flex;flex-direction:column;gap:4px;font-size:.9rem;"></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
            ${fini ? '' : `<button id="mime-reveler" class="btn-secondary">💡 Révéler le mot</button>`}
            <button id="mime-suivant" class="btn-primary">⏭️ Manche suivante</button>
            <button id="mime-classement" class="btn-secondary">🏁 Classement</button>
        </div>
    </div>`;

    const cv = $('mime-canvas-hote');
    _ctxHote = cv ? cv.getContext('2d') : null;
    _majGuesses();

    const bR = $('mime-reveler');
    if (bR) bR.onclick = () => socket.send('HOST_ACTION', { action: 'mimedessine:reveler_mot', data: {} });

    const bS = $('mime-suivant');
    if (bS) bS.onclick = () => { _stopTimer(); _phase = 'menu'; _motChoisi = null; _render(); };

    const bC = $('mime-classement');
    if (bC) bC.onclick = () => socket.send('HOST_ACTION', { action: 'mimedessine:force_resultats', data: {} });
}

function _majGuesses() {
    const g = $('mime-guesses');
    if (!g) return;
    g.innerHTML = _guesses.length
        ? _guesses.slice(-8).map(x =>
            `<div>${x.correct ? '✅' : '❔'} <strong>${esc(x.pseudo)}</strong> : ${esc(x.guess)}</div>`).join('')
        : `<div style="color:rgba(255,255,255,.5);text-align:center;">En attente des devinettes…</div>`;
}

// ── Canvas hôte (lecture seule) ──────────────────────────────
function _dessinerRecu(data) {
    if (!_ctxHote) {
        const cv = $('mime-canvas-hote');
        _ctxHote = cv ? cv.getContext('2d') : null;
        if (!_ctxHote) return;
    }
    const cv = _ctxHote.canvas;
    if (Array.isArray(data) && data.length === 0) { _ctxHote.clearRect(0, 0, cv.width, cv.height); return; }
    if (typeof data !== 'string') return;
    const img = new Image();
    img.onload = () => { _ctxHote.clearRect(0, 0, cv.width, cv.height); _ctxHote.drawImage(img, 0, 0, cv.width, cv.height); };
    img.src = data;
}

// ── Timer (#mimer-timer) basé sur tsPhaseEnd serveur ─────────
function _startTimer() {
    _stopTimer();
    const t = $('mimer-timer');
    const upd = () => {
        if (!_tsPhaseEnd) return;
        const reste = Math.max(0, Math.round((_tsPhaseEnd - Date.now()) / 1000));
        const m = String(Math.floor(reste / 60)).padStart(2, '0');
        const s = String(reste % 60).padStart(2, '0');
        if (t) t.textContent = `${m}:${s}`;
        if (reste <= 0) _stopTimer();
    };
    upd();
    _timerIv = setInterval(upd, 500);
}
function _stopTimer() {
    if (_timerIv) { clearInterval(_timerIv); _timerIv = null; }
}