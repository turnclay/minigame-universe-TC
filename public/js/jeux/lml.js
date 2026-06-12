// ============================================================
// /js/jeux/lml.js — v2.0 WS-server-driven (P5.3)
// ============================================================
// Le serveur tire les 10 lettres et valide les mots contre le
// Lexique383. Le client gère uniquement l'affichage local des
// lettres + saisie + timer visuel.
// ============================================================

import { $ } from '../core/dom.js';
import { GameState } from '../core/state.js';
import { socket } from '../core/socket.js';
import { afficherScoreboard } from '../modules/scoreboard.js';

let _lettres        = [];
let _tsDebut        = 0;
let _dureeMs        = 60_000;
let _timerLocal     = null;
let _motEnvoye      = false;

let _injecterPanneauHote      = () => {};
let _enregistrerSoumissionHote = () => {}; // maj directe du panneau au clic

async function chargerModuleHote() {
    try {
        const m = await import('../modules/lml_hote.js');
        _injecterPanneauHote       = m.injecterPanneauHote   || (() => {});
        _enregistrerSoumissionHote = m.enregistrerSoumission || (() => {});
        console.log('[LML] ✅ Module hôte chargé');
        return true;
    } catch (e) {
        console.warn('[LML] ⚠️ lml_hote.js indisponible :', e.message);
        return false;
    }
}

// ── Handlers events serveur ───────────────────────────────────

function _onMancheStart(payload) {
    _arreterTimer();
    _lettres   = Array.isArray(payload.lettres) ? payload.lettres : [];
    _tsDebut   = payload.tsDebut || Date.now();
    _dureeMs   = payload.dureeMs || 60_000;
    _motEnvoye = false;

    if (payload.scores) {
        GameState.scores = GameState.scores || {};
        Object.assign(GameState.scores, payload.scores);
    }

    _afficherLettres();
    _resetUI();
    _demarrerTimer();
    console.log(`[LML] 🎲 Manche ${payload.manche} — lettres: ${_lettres.join('')}`);
}

function _onRevelation(payload) {
    _arreterTimer();
    if (payload.scores) {
        GameState.scores = GameState.scores || {};
        Object.assign(GameState.scores, payload.scores);
    }
    try { afficherScoreboard(); } catch {}

    const btnR = $('lml-rejouer');
    if (btnR) {
        btnR.hidden      = false;
        btnR.textContent = '🔄 Nouvelles lettres';
        // Handler unique attaché dans _attacherListeners (pas de doublon :
        // ne pas ré-attacher de onclick ici, sinon lml:next_manche partirait
        // deux fois au clic).
    }
}

function _onTimerExpired() {
    // Auto-envoi du mot en cours si l'hôte n'a pas validé
    if (!_motEnvoye) {
        const inp = $('lml-input');
        const mot = inp ? inp.value.toUpperCase().trim() : '';
        _soumettreMotHote(mot);
    }
}

// ── Affichage ─────────────────────────────────────────────────

function _afficherLettres() {
    const z = $('lml-lettres');
    if (!z) return;
    z.innerHTML = _lettres.map((l, i) =>
        `<span class="lettre" data-index="${i}" style="animation-delay:${i * .07}s">${l}</span>`
    ).join('');
    z.querySelectorAll('.lettre').forEach(el => {
        el.addEventListener('click', () => {
            if (el.classList.contains('utilisee')) return;
            const inp = $('lml-input');
            if (inp && !inp.disabled && inp.value.length < 10) {
                inp.value += el.textContent.trim();
                el.classList.add('utilisee');
            }
        });
    });
}

function _resetUI() {
    const inp = $('lml-input');
    if (inp) { inp.value = ''; inp.disabled = false; }
    const res = $('lml-resultat');
    if (res) res.textContent = '';
    $('lml-lettres')?.querySelectorAll('.lettre').forEach(e => e.classList.remove('utilisee'));

    const be = $('lml-btn-envoyer-hote');
    if (be) { be.disabled = false; be._sent = false; be.style.opacity = ''; be.textContent = '✅ Envoyer mon mot'; }

    const btnR = $('lml-rejouer'); if (btnR) btnR.hidden = true;
}

function _demarrerTimer() {
    _arreterTimer();
    const t = $('lml-timer');
    const compute = () => Math.max(0, Math.ceil((_tsDebut + _dureeMs - Date.now()) / 1000));
    const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    let last = compute();
    if (t) { t.textContent = fmt(last); t.classList.remove('clignote'); }
    _timerLocal = setInterval(() => {
        const r = compute();
        if (r !== last) {
            last = r;
            if (t) {
                t.textContent = fmt(r);
                if (r <= 10 && r > 0) t.classList.add('clignote');
            }
        }
        if (r <= 0) {
            _arreterTimer();
            if (t) { t.textContent = '00:00'; t.classList.remove('clignote'); }
        }
    }, 250);
}

function _arreterTimer() {
    if (_timerLocal) { clearInterval(_timerLocal); _timerLocal = null; }
}

// ── Soumission du mot hôte ────────────────────────────────────

// Logique de clic centralisée : appelée par le bouton ET par la touche Entrée.
function _clicEnvoyerMotHote() {
    const be = $('lml-btn-envoyer-hote');
    if (be && be._sent) return;
    if (_motEnvoye) return;
    const inp = $('lml-input');
    const mot = (inp ? inp.value : '').toUpperCase().trim();
    if (!mot) return;
    _soumettreMotHote(mot);
}

function _soumettreMotHote(mot) {
    if (_motEnvoye) return;
    _motEnvoye = true;
    const pseudoHote = (GameState?.joueurs?.[0]) || null;
    try {
        socket.send('HOST_ACTION', {
            action: 'lml:host_answer',
            data: { pseudo: pseudoHote, mot: mot || '' },
        });
        console.log(`[LML] 📨 Mot hôte envoyé: "${mot}"`);
    } catch (err) {
        console.error('[LML] send host_answer:', err.message);
        _motEnvoye = false; // permet une nouvelle tentative si l'envoi a échoué
        return;
    }

    // Mise à jour DIRECTE du panneau #panneau-invites-lml dès le clic
    // (optimiste). Le LML_RESPONSE_IN serveur viendra reconfirmer ensuite.
    if (pseudoHote) { try { _enregistrerSoumissionHote(pseudoHote); } catch {} }

    const be = $('lml-btn-envoyer-hote');
    if (be) { be.disabled = true; be._sent = true; be.style.opacity = '0.45'; be.textContent = '⏳ Envoyé'; }
    const inp = $('lml-input');
    if (inp) inp.disabled = true;
}

// ── Boutons hôte (statiques .lml-hote-row, ou injectés en secours) ──

function _injecterBoutons() {
    const section = $('lml'); if (!section) return;

    let btnEnv = document.getElementById('lml-btn-envoyer-hote');

    // Le bouton est normalement présent statiquement dans index.html
    // (.lml-hote-row). S'il est absent, on le crée en secours.
    if (!btnEnv) {
        const wrap = document.createElement('div');
        wrap.id = 'lml-actions-hote';
        wrap.style.cssText = 'display:flex;gap:10px;margin-top:10px;flex-wrap:wrap;';

        btnEnv = document.createElement('button');
        btnEnv.id = 'lml-btn-envoyer-hote';
        btnEnv.style.cssText = [
            'flex:1;padding:12px;border-radius:12px;font-size:.9rem;font-weight:700;',
            'background:rgba(34,197,94,.2);border:1.5px solid rgba(34,197,94,.45);',
            'color:white;cursor:pointer;font-family:inherit;transition:opacity .2s;min-width:140px;'
        ].join('');
        btnEnv.textContent = '✅ Envoyer mon mot';
        wrap.appendChild(btnEnv);

        const inputEl = $('lml-input');
        if (inputEl?.parentElement) inputEl.parentElement.insertAdjacentElement('afterend', wrap);
        else section.appendChild(wrap);
    }

    // CORRECTIF : attache le handler de clic UNE seule fois, que le bouton
    // soit statique (index.html) ou injecté. L'ancien code sortait sans rien
    // attacher quand le bouton existait déjà → l'hôte ne pouvait pas envoyer.
    if (!btnEnv._lmlBound) {
        btnEnv._lmlBound = true;
        btnEnv.addEventListener('click', _clicEnvoyerMotHote);
    }
}

function _attacherListeners() {
    // Bouton "Nouvelle manche / Nouvelles lettres" piloté serveur — handler unique.
    $('lml-rejouer')?.addEventListener('click', () => {
        try { socket.send('HOST_ACTION', { action: 'lml:next_manche', data: {} }); }
        catch (err) { console.error('[LML] send next_manche:', err.message); }
    });

    // Mélange = local (n'affecte pas les invités)
    $('lml-melanger')?.addEventListener('click', () => {
        _lettres.sort(() => Math.random() - .5);
        _afficherLettres();
    });

    // Entrée → soumission directe (ne dépend plus d'un .click() sur un bouton
    // potentiellement non câblé).
    $('lml-input')?.addEventListener('keypress', e => {
        if (e.key === 'Enter') { e.preventDefault(); _clicEnvoyerMotHote(); }
    });
    $('lml-input')?.addEventListener('input', e => {
        e.target.value = e.target.value.toUpperCase();
    });
}

// ── Abonnements WS ────────────────────────────────────────────

function _abonnerEvenements() {
    socket.on('LML_MANCHE_START',  payload => { try { _onMancheStart(payload); } catch (e) { console.warn('[LML] MANCHE_START', e.message); } });
    socket.on('LML_REVELATION',    payload => { try { _onRevelation(payload); }  catch (e) { console.warn('[LML] REVELATION',   e.message); } });
    socket.on('LML_TIMER_EXPIRED', ()      => { try { _onTimerExpired(); }       catch (e) { console.warn('[LML] TIMER_EXPIRED', e.message); } });
    socket.on('SCORES_UPDATE', ({ scores }) => {
        if (scores) {
            GameState.scores = GameState.scores || {};
            Object.assign(GameState.scores, scores);
        }
        try { afficherScoreboard(); } catch {}
    });
}

// ── Init ─────────────────────────────────────────────────────

export async function initialiserLML() {
    console.log('[LML] Initialisation WS');
    _abonnerEvenements();
    const hoteActif = await chargerModuleHote();
    if (hoteActif) _injecterPanneauHote();
    _injecterBoutons();
    _attacherListeners();

    try {
        socket.send('HOST_ACTION', { action: 'lml:load', data: {} });
        console.log('[LML] 📡 lml:load envoyé');
    } catch (err) {
        console.error('[LML] send load:', err.message);
        alert('Impossible de démarrer LML. Vérifie la connexion.');
    }
}

window.initialiserLML = initialiserLML;