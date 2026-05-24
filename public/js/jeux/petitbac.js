// ============================================================
// /js/jeux/petitbac.js — v2.0 WS-server-driven (P5.1)
// ============================================================
// Toute la logique métier (tirage de lettre, timer, scoring,
// révélation) est désormais SERVEUR. Ce module ne gère plus que
// l'affichage hôte et l'envoi/réception des actions WS.
// ============================================================

import { GameState } from '../core/state.js';
import { socket } from '../core/socket.js';
import { afficherScoreboard } from '../modules/scoreboard.js';

// ── État local (affichage uniquement) ──────────────────────────
let _lettreActuelle = '';
let _categories     = [];
let _timerLocal     = null;
let _tsDebut        = 0;
let _dureeMs        = 120_000;
let _reponseSoumise = false;

// ── Stubs module hôte ────────────────────────────────────────
let _viderPanneau                   = () => {};
let _injecterPanneauHote            = () => {};
let _afficherReponsesInvitesSurHote = () => {};
let _hoteActif                      = false;

async function chargerModuleHote() {
    try {
        const m = await import('../modules/petitbac_hote.js');
        _viderPanneau                   = m.viderPanneau                  || (() => {});
        _injecterPanneauHote            = m.injecterPanneauHote           || (() => {});
        _afficherReponsesInvitesSurHote = m.afficherReponsesInvitesSurHote || (() => {});
        _hoteActif = true;
        console.log('[PETITBAC] ✅ Module hôte chargé');
        return true;
    } catch (e) {
        console.warn('[PETITBAC] ⚠️ petitbac_hote.js indisponible :', e.message);
        return false;
    }
}

// ── Handlers events serveur ─────────────────────────────────

function _onMancheStart(payload) {
    _arreterTimerVisuel();
    _lettreActuelle = payload.lettre || '';
    _categories     = Array.isArray(payload.categories) ? payload.categories : [];
    _tsDebut        = payload.tsDebut || Date.now();
    _dureeMs        = payload.dureeMs || 120_000;
    _reponseSoumise = false;

    // Mettre à jour les scores depuis le serveur
    if (payload.scores) {
        GameState.scores = GameState.scores || {};
        Object.assign(GameState.scores, payload.scores);
    }

    const elL = document.getElementById('petitbac-lettre-actuelle');
    if (elL) {
        elL.textContent = _lettreActuelle;
        elL.style.animation = 'none';
        setTimeout(() => { elL.style.animation = 'bounceIn 0.6s ease-out'; }, 10);
    }
    _afficherCategories();
    _demarrerTimerVisuel();
    _reactiverBoutonValidation();

    try { _viderPanneau(); } catch {}

    console.log(`[PETITBAC] 🎲 Manche ${payload.manche} — lettre: ${_lettreActuelle}`);
}

function _onRevelation(payload) {
    _arreterTimerVisuel();
    const { lettre, reponses, scores, manche } = payload;

    if (scores) {
        GameState.scores = GameState.scores || {};
        Object.assign(GameState.scores, scores);
    }
    try { afficherScoreboard(); } catch {}

    // Activer le bouton "Nouvelle manche" (reuse petitbac-valider)
    const btn = document.getElementById('petitbac-valider');
    if (btn) {
        btn.disabled    = false;
        btn.textContent = '🔄 Nouvelle manche';
        btn.className   = 'btn-primary btn-rejouer';
        btn.onclick = () => {
            try { socket.send('HOST_ACTION', { action: 'petitbac:next_manche', data: {} }); }
            catch (err) { console.error('[PETITBAC] send next_manche:', err.message); }
        };
    }

    // Panneau résultats (rempli par petitbac_hote.js via event)
    try { _afficherReponsesInvitesSurHote('pb-invites-reponses', reponses); } catch {}

    console.log(`[PETITBAC] 🎯 Révélation manche ${manche} — lettre: ${lettre}`);
}

function _onTimerExpired({ nbReponses, nbJoueurs }) {
    console.log(`[PETITBAC] ⏱ Timer expiré — ${nbReponses}/${nbJoueurs}`);
    // L'hôte peut maintenant cliquer "Révéler" même si tout le monde n'a pas soumis.
    const btn = document.getElementById('pb-btn-resultats');
    if (btn) {
        btn.disabled       = false;
        btn.style.opacity  = '1';
        btn.style.cursor   = 'pointer';
        btn.title          = '⏱ Temps écoulé — Cliquez pour révéler';
        btn.style.animation = 'btnPulse .6s ease infinite alternate';
    }
}

// ── Affichage local ─────────────────────────────────────────

function _afficherCategories() {
    const container = document.getElementById('petitbac-categories');
    if (!container) return;
    container.innerHTML = '';
    _categories.forEach(cat => {
        const card = document.createElement('div');
        card.className = 'petitbac-categorie-card';
        card.innerHTML = `
            <div class="categorie-header">
                <span class="categorie-icon">${cat.icon}</span>
                <h3 class="categorie-label">${cat.label}</h3>
            </div>
            <input type="text" id="input-${cat.id}" class="petitbac-input"
                placeholder="Votre réponse…" maxlength="30" autocomplete="off">
            <div class="validation-feedback" id="feedback-${cat.id}"></div>`;
        container.appendChild(card);
        const input = document.getElementById(`input-${cat.id}`);
        if (input) {
            input.addEventListener('input', (e) => {
                if (e.target.value.length === 1) e.target.value = e.target.value.toUpperCase();
            });
        }
    });
}

function _demarrerTimerVisuel() {
    _arreterTimerVisuel();
    const t = document.getElementById('petitbac-timer');
    const compute = () => Math.max(0, Math.ceil((_tsDebut + _dureeMs - Date.now()) / 1000));
    let last = compute();
    if (t) {
        const m = String(Math.floor(last / 60)).padStart(2, '0');
        const s = String(last % 60).padStart(2, '0');
        t.textContent = `${m}:${s}`;
    }
    _timerLocal = setInterval(() => {
        const remaining = compute();
        if (remaining !== last) {
            last = remaining;
            if (t) {
                const m = String(Math.floor(remaining / 60)).padStart(2, '0');
                const s = String(remaining % 60).padStart(2, '0');
                t.textContent = `${m}:${s}`;
                if (remaining <= 30 && remaining > 0) t.classList.add('clignote');
            }
        }
        if (remaining <= 0) {
            _arreterTimerVisuel();
            if (t) { t.textContent = '00:00'; t.classList.remove('clignote'); }
        }
    }, 250);
}

function _arreterTimerVisuel() {
    if (_timerLocal) { clearInterval(_timerLocal); _timerLocal = null; }
    const t = document.getElementById('petitbac-timer');
    if (t) t.classList.remove('clignote');
}

function _reactiverBoutonValidation() {
    const btn = document.getElementById('petitbac-valider');
    if (!btn) return;
    btn.disabled    = false;
    btn.textContent = 'Valider mes réponses';
    btn.className   = 'btn-primary';
    btn.onclick     = _soumettreReponsesHote;
}

function _soumettreReponsesHote() {
    if (_reponseSoumise) return;
    _reponseSoumise = true;
    _arreterTimerVisuel();

    const reponses = {};
    _categories.forEach(cat => {
        const input = document.getElementById(`input-${cat.id}`);
        if (!input) return;
        reponses[cat.id] = input.value.trim();
        input.disabled = true;
    });

    const pseudoHote = (GameState?.joueurs?.[0]) || null;
    try {
        socket.send('HOST_ACTION', {
            action: 'petitbac:host_answer',
            data: { pseudo: pseudoHote, reponses },
        });
        console.log('[PETITBAC] 📨 Réponses hôte envoyées');
    } catch (err) {
        console.error('[PETITBAC] ❌ send host_answer:', err.message);
    }

    // Désactiver le bouton "Valider" et activer "Révéler" (panneau hôte)
    const btn = document.getElementById('petitbac-valider');
    if (btn) {
        btn.disabled    = true;
        btn.textContent = '⏳ Réponses soumises';
    }
}

// ── Abonnements WS ──────────────────────────────────────────

function _abonnerEvenements() {
    socket.on('PETITBAC_MANCHE_START',  payload => { try { _onMancheStart(payload); }  catch (e) { console.warn('[PETITBAC] MANCHE_START', e.message); } });
    socket.on('PETITBAC_REVELATION',    payload => { try { _onRevelation(payload); }   catch (e) { console.warn('[PETITBAC] REVELATION', e.message); } });
    socket.on('PETITBAC_TIMER_EXPIRED', payload => { try { _onTimerExpired(payload); } catch (e) { console.warn('[PETITBAC] TIMER_EXPIRED', e.message); } });
    socket.on('PETITBAC_RESPONSE_IN',   payload => {
        // Délégué au module hôte pour mise à jour du panneau
        try { _afficherReponsesInvitesSurHote('pb-invites-reponses'); } catch {}
    });
    socket.on('SCORES_UPDATE', ({ scores }) => {
        if (scores) {
            GameState.scores = GameState.scores || {};
            Object.assign(GameState.scores, scores);
        }
        try { afficherScoreboard(); } catch {}
    });
}

// ── Initialisation principale ───────────────────────────────

export async function initialiserPetitBac() {
    console.log('[PETITBAC] Initialisation WS');
    _abonnerEvenements();
    const hoteActif = await chargerModuleHote();
    if (hoteActif) _injecterPanneauHote();

    // Réinitialiser l'UI
    const elL = document.getElementById('petitbac-lettre-actuelle');
    if (elL) elL.textContent = '—';
    const t = document.getElementById('petitbac-timer');
    if (t) { t.textContent = '02:00'; t.classList.remove('clignote'); }
    const container = document.getElementById('petitbac-categories');
    if (container) container.innerHTML = '';

    // Demander au serveur de démarrer une session + tirer la 1re lettre
    try {
        socket.send('HOST_ACTION', { action: 'petitbac:load', data: {} });
        console.log('[PETITBAC] 📡 petitbac:load envoyé');
    } catch (err) {
        console.error('[PETITBAC] ❌ send load:', err.message);
        alert('Impossible de démarrer le Petit Bac. Vérifie la connexion.');
    }
}

// Compat : appelée par le registry main.js (window.initialiserPetitBac).
export function resetJeu() {
    _arreterTimerVisuel();
    _lettreActuelle = '';
    _categories     = [];
    _reponseSoumise = false;
}

// Expose pour le registry GAME_INIT_FNS de main.js (compat window.*)
window.initialiserPetitBac = initialiserPetitBac;
