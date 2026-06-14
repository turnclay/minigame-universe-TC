/**
 * ============================================
 * 🎭 mimedessine.js — v8.0 (WS, mime « présentiel » tour par tour, SANS dessin)
 * ============================================
 * Hôte ORCHESTRATEUR (autorité serveur = server/games/mimedessine.js).
 * Flux : accueil → (Commencer) → tour [thème + mot + Trouvé/Passer/Finir]
 *        → fin_manche [Participant suivant] → … → classement → Rejouer.
 * Quand un invité est le participant actif, le même dispositif s'affiche
 * sur SON écran (mime_player.js) ; l'hôte voit le mot (validation) + scores.
 */

import { socket }    from "../core/socket.js";
import { GameState } from "../core/state.js";

const $   = id => document.getElementById(id);
const esc = s => String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

let _bank=[], _motsParCat={}, _cats=[];
let _state={ phase:'menu', manche:0, participant:null, index:0, nbParticipants:0,
             categorie:null, scores:{}, scoreManche:{}, motsManche:[], tsTourEnd:null };
let _mot=null;
let _timerIv=null;

const DUREE = 180000;

// ── Identité hôte / participants ─────────────────────────────
const _hostPseudo   = () => (GameState.joueurs || [])[0] || null;
const _participants = () => (GameState.joueurs || []).filter(p => p && typeof p === 'string');
const _hostActif    = () => _state.participant && _state.participant === _hostPseudo();

// ============================================================
export async function initialiserMimer() {
    console.log('[MIMEDESSINE] Initialisation (WS mime tour par tour)');
    _mot = null; _stopTimer();
    await _chargerDonnees();
    _brancherSocket();

    const participants = _participants();
    socket.send('HOST_ACTION', {
        action: 'mimedessine:config',
        data: { participants, motsParCategorie: _motsParCat, duree: DUREE },
    });
}
window.initialiserMimer = initialiserMimer;

async function _chargerDonnees() {
    try {
        const r = await fetch('data/MimeDessine.json');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        _bank = await r.json();
        _cats = _bank.length ? Object.keys(_bank[0]) : [];
        _motsParCat = {};
        _cats.forEach(c => { _motsParCat[c] = _bank.map(r => r[c]).filter(Boolean); });
        console.log('[MIMEDESSINE] Banque:', _bank.length, 'lignes,', _cats.length, 'catégories');
    } catch (e) {
        console.error('[MIMEDESSINE] Chargement banque échoué:', e);
        _bank = []; _cats = []; _motsParCat = {};
    }
}

// ── Socket ───────────────────────────────────────────────────
function _brancherSocket() {
    if (socket._mimeHoteBound) return;
    socket._mimeHoteBound = true;

    socket.on('MIMEDESSSINE_PHASE', (p) => {
        _state = { ..._state, ...p };
        if (p.phase !== 'tour') _mot = null;
        _render();
        if (p.phase === 'tour' && p.tsTourEnd) _startTimer(); else _stopTimer();
    });

    socket.on('MIMEDESSSINE_MOT_A_DEVINER', (p) => {
        _mot = p.mot || null;
        if (_state.phase === 'tour') _render();
    });
}

// ── Émissions ────────────────────────────────────────────────
const _envoyer = (cmd, data = {}) => {
    try { socket.send('HOST_ACTION', { action: 'mimedessine:' + cmd, data }); }
    catch (e) { console.error('[MIMEDESSINE] send', cmd, e.message); }
};

// ============================================================
// 🖼️ RENDU (#mimer-content)
// ============================================================
function _render() {
    const c = $('mimer-content');
    if (!c) return;
    switch (_state.phase) {
        case 'accueil':     _renderAccueil(c); break;
        case 'tour':        _renderTour(c);    break;
        case 'fin_manche':  _renderFin(c);     break;
        case 'classement':  _renderClassement(c); break;
        default:            _renderMenu(c);
    }
}

function _renderMenu(c) {
    c.innerHTML = `<div style="text-align:center;padding:1rem;color:rgba(255,255,255,.7);">
        Préparation du jeu… ${_participants().length ? '' : '(en attente d\u2019invités)'}</div>`;
}

function _renderAccueil(c) {
    const tour = `Tour ${(_state.index||0)+1} / ${_state.nbParticipants||_participants().length}`;
    const actif = _state.participant;
    const estHote = _hostActif();
    c.innerHTML = `
    <div class="mimer-accueil" style="text-align:center;display:flex;flex-direction:column;gap:14px;max-width:520px;margin:0 auto;">
        <div class="mimer-tour-info">${esc(tour)}</div>
        <h2 class="mimer-participant" style="color:#00d4ff;">👤 ${esc(actif || '—')}</h2>
        <p class="mimer-instruction">${estHote ? "C'est ton tour !" : `C'est le tour de <strong>${esc(actif || '')}</strong>`}</p>
        <p class="mimer-regles">⏱️ 3 minutes · 🎯 les autres devinent · 🚫 pas 2× la même catégorie d'affilée</p>
        <button id="mimer-demarrer" class="btn-primary btn-large">🚀 Commencer la manche</button>
    </div>`;
    $('mimer-demarrer')?.addEventListener('click', () => _envoyer('commencer'));
}

function _renderTour(c) {
    const estHote = _hostActif();
    const scores = _miniScores();

    if (estHote) {
        c.innerHTML = `
        <div class="mimer-mot-affiche" style="text-align:center;display:flex;flex-direction:column;gap:14px;max-width:560px;margin:0 auto;">
            <div class="mimer-categorie-mini" style="color:#c4b5fd;font-weight:700;">${esc(_state.categorie || '')}</div>
            <div class="mimer-mot-carte"><h2 style="margin:0;">${esc(_mot || '…')}</h2></div>
            <div class="mimer-actions" style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
                <button id="mimer-trouve" class="btn-success btn-large">✅ Trouvé !</button>
                <button id="mimer-passer" class="btn-secondary btn-large">➡️ Passer</button>
                <button id="mimer-fin" class="btn-warning btn-large">⏹ Finir ma manche</button>
            </div>
        </div>`;
        $('mimer-trouve')?.addEventListener('click', () => _envoyer('trouve'));
        $('mimer-passer')?.addEventListener('click', () => _envoyer('passer'));
        $('mimer-fin')?.addEventListener('click', () => _envoyer('fin_manche'));
    } else {
        c.innerHTML = `
        <div class="mimer-accueil" style="text-align:center;display:flex;flex-direction:column;gap:14px;max-width:560px;margin:0 auto;">
            <h2 class="mimer-participant" style="color:#fbbf24;">🎭 ${esc(_state.participant || '')} joue !</h2>
            <div class="mimer-categorie-mini" style="color:#c4b5fd;font-weight:700;">Thème : ${esc(_state.categorie || '')}</div>
            <div class="mimer-mot-carte"><h2 style="margin:0;">${esc(_mot || '…')}</h2>
                <p style="font-size:.8rem;color:rgba(255,255,255,.5);margin:.3rem 0 0;">(mot visible par toi, hôte — pour valider)</p></div>
            <div id="mimer-hote-scores" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;">${scores}</div>
            <button id="mimer-fin" class="btn-secondary">⏹ Forcer la fin de manche</button>
        </div>`;
        $('mimer-fin')?.addEventListener('click', () => _envoyer('fin_manche'));
    }
}

function _renderFin(c) {
    const participant = _state.participant;
    const score = (_state.scoreManche || {})[participant] || 0;
    const mots = _state.motsManche || [];
    const total = mots.length;
    const pl = score > 1 ? 's' : '';
    const liste = total
        ? mots.map(m => `<li style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,.06);display:flex;justify-content:space-between;gap:10px;">
            <span style="font-weight:700;color:${m.trouve ? '#16a34a' : '#999'};">${m.trouve ? '✅ ' : '❌ '}${esc(m.mot)}</span>
            <span style="font-size:.72rem;color:#888;white-space:nowrap;">${esc(m.categorie || '')}</span></li>`).join('')
        : '<li style="color:#999;font-style:italic;padding:8px 0;">Aucun mot passé</li>';
    const encore = (_state.index || 0) < (_state.nbParticipants || _participants().length) - 1;

    c.innerHTML = `
    <div class="mimer-fin" style="max-width:560px;margin:0 auto;text-align:center;">
        <h2 class="mimer-fin-titre">🏁 Manche terminée</h2>
        <div class="mimer-score-final" style="background:#fff;border-radius:14px;padding:14px;color:#1e1e2e;">
            <p style="margin:.2rem 0;font-weight:700;">👤 ${esc(participant || '')}</p>
            <h1 style="margin:.2rem 0;color:#1e1e2e;">${score}<span style="font-size:1.1rem;opacity:.5;">/${total}</span></h1>
            <p style="color:#444;margin:.2rem 0;">mot${pl} deviné${pl} sur ${total}</p>
            <ul style="list-style:none;padding:12px 16px;margin:14px 0 0;text-align:left;background:rgba(0,0,0,.04);border-radius:12px;max-height:180px;overflow-y:auto;">${liste}</ul>
        </div>
        ${encore
            ? `<button id="mimer-suivant" class="btn-primary btn-large" style="margin-top:14px;">➡️ Participant suivant</button>`
            : `<button id="mimer-classement" class="btn-primary btn-large" style="margin-top:14px;">🏆 Voir le classement final</button>`}
    </div>`;
    $('mimer-suivant')?.addEventListener('click', () => _envoyer('suivant'));
    $('mimer-classement')?.addEventListener('click', () => _envoyer('classement'));
}

function _renderClassement(c) {
    const scores = _state.scores || {};
    const rows = _participants().map(p => ({ nom: p, score: scores[p] || 0 }))
        .sort((a, b) => b.score - a.score);
    const lignes = rows.map((it, i) => {
        const m = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1) + '.';
        const pl = it.score > 1 ? 's' : '';
        return `<div class="classement-item ${i === 0 ? 'winner' : ''}" style="display:flex;justify-content:space-between;gap:10px;padding:8px 12px;">
            <span>${m} ${esc(it.nom)}</span><span>${it.score} pt${pl}</span></div>`;
    }).join('');
    c.innerHTML = `
    <div class="mimer-fin" style="max-width:520px;margin:0 auto;text-align:center;">
        <h2 class="mimer-fin-titre">🏆 Classement final</h2>
        <div class="mimer-classement">${lignes}</div>
        <button id="mimer-rejouer" class="btn-primary btn-large" style="margin-top:14px;">🔄 Rejouer</button>
    </div>`;
    $('mimer-rejouer')?.addEventListener('click', () => _envoyer('rejouer'));
}

function _miniScores() {
    const sc = _state.scoreManche || {};
    return _participants().map(p =>
        `<span style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:20px;padding:4px 12px;font-size:.78rem;font-weight:700;color:rgba(255,255,255,.8);">${esc(p)} : ${sc[p] || 0}</span>`
    ).join('');
}

// ── Timer (#mimer-timer) ─────────────────────────────────────
function _startTimer() {
    _stopTimer();
    const t = $('mimer-timer');
    const upd = () => {
        if (!_state.tsTourEnd) return;
        const reste = Math.max(0, Math.round((_state.tsTourEnd - Date.now()) / 1000));
        const m = String(Math.floor(reste / 60)).padStart(2, '0');
        const s = String(reste % 60).padStart(2, '0');
        if (t) { t.textContent = `${m}:${s}`; t.classList.toggle('timer-alerte', reste <= 30); }
        if (reste <= 0) _stopTimer();
    };
    upd();
    _timerIv = setInterval(upd, 500);
}
function _stopTimer() {
    if (_timerIv) { clearInterval(_timerIv); _timerIv = null; }
    const t = $('mimer-timer'); if (t) t.classList.remove('timer-alerte');
}