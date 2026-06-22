// ============================================================
// /js/jeux/pendu.js — v2.0 WS-server-driven (P5.2)
// ============================================================
// Le serveur tire le mot et le diffuse via PENDU_MOT_START.
// Chaque écran (hôte + invités) joue le mot en parallèle avec
// sa propre logique locale (clavier, erreurs, dessin). À la fin
// chacun envoie son résultat. L'hôte révèle quand il le souhaite.
// ============================================================

import { $ } from '../core/dom.js';
import { GameState } from '../core/state.js';
import { socket } from '../core/socket.js';
import { afficherScoreboard } from '../modules/scoreboard.js';

const MAX_ERREURS = 7;

// ── État local de la partie hôte (joue en parallèle) ───────────
let motSecret      = '';
let themeActuel    = '';
let motAffiche     = [];
let lettresUsees   = new Set();
let nombreErreurs  = 0;
let partieTerminee = false;
let themeVisible   = false;
let _resultEnvoye  = false;

// Normalise une lettre : retire les accents (É→E, Ç→C…) pour matcher le clavier A-Z.
function _normLettre(c) {
    return String(c || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ── Stubs module hôte (panneau invités) ────────────────────────
let _injecterPanneauHote = () => {};
let _hoteActif           = false;

async function chargerModuleHote() {
    try {
        const m = await import('../modules/pendu_hote.js');
        _injecterPanneauHote = m.injecterPanneauHote || (() => {});
        _hoteActif = true;
        console.log('[PENDU] ✅ Module hôte chargé');
        return true;
    } catch (e) {
        console.warn('[PENDU] ⚠️ pendu_hote.js indisponible :', e.message);
        return false;
    }
}

// ── Handlers events serveur ───────────────────────────────────

function _onMotStart(payload) {
    motSecret      = String(payload.motSecret || '').toUpperCase();
    themeActuel    = String(payload.theme     || '').toUpperCase();
    themeVisible   = false;
    partieTerminee = false;
    _resultEnvoye  = false;
    motAffiche     = Array(motSecret.length).fill('_');
    lettresUsees.clear();
    nombreErreurs  = 0;

    if (payload.scores) {
        GameState.scores = GameState.scores || {};
        Object.assign(GameState.scores, payload.scores);
    }

    // Révéler 1ère + dernière lettre (toutes occurrences, accents normalisés)
    const reveler = new Set([
        _normLettre(motSecret[0]),
        _normLettre(motSecret[motSecret.length - 1])
    ]);
    for (let i = 0; i < motSecret.length; i++) {
        if (reveler.has(_normLettre(motSecret[i]))) {
            motAffiche[i] = motSecret[i];                // révèle la lettre accentuée
            lettresUsees.add(_normLettre(motSecret[i])); // mémorise la lettre de base
        }
    }

    _afficherMot();
    _afficherDessin();
    _afficherTheme();
    _creerClavier();

    const nb = $('pendu-nb-erreurs'); if (nb) nb.textContent = '0';
    const tgl = $('pendu-theme-toggle');
    if (tgl) { tgl.textContent = '🎯 Afficher le thème'; tgl.disabled = false; }
    const btnR = $('pendu-rejouer'); if (btnR) btnR.hidden = true;

    // Désactiver bouton "Afficher résultats"
    const btnRes = document.getElementById('pendu-btn-resultats');
    if (btnRes) { btnRes.disabled = true; btnRes.style.opacity = '0.4'; btnRes.style.cursor = 'not-allowed'; }

    setTimeout(() => {
        document.querySelectorAll('.btn-lettre').forEach(b => {
            if (lettresUsees.has(b.dataset.lettre)) {
                b.disabled = true;
                b.classList.add('correcte');
            }
        });
    }, 50);

    console.log(`[PENDU] 🎲 Manche ${payload.manche} — mot caché reçu`);
}

function _onRevelation(payload) {
    if (payload.scores) {
        GameState.scores = GameState.scores || {};
        Object.assign(GameState.scores, payload.scores);
    }
    try { afficherScoreboard(); } catch {}

    // Activer "Nouveau mot"
    const btnR = $('pendu-rejouer');
    if (btnR) {
        btnR.hidden     = false;
        btnR.textContent = '🔄 Nouveau mot';
        btnR.onclick = () => {
            try { socket.send('HOST_ACTION', { action: 'pendu:next_mot', data: {} }); }
            catch (err) { console.error('[PENDU] send next_mot:', err.message); }
        };
    }
}

// ── Affichage ─────────────────────────────────────────────────

function _afficherMot() {
    const el = $('pendu-mot'); if (!el) return;
    el.innerHTML = motAffiche.map(l => `<span class="lettre-case">${l}</span>`).join('');
}

function _afficherTheme() {
    const el = $('pendu-theme-display'); if (!el) return;
    if (themeVisible) { el.textContent = themeActuel; el.style.display = 'block'; }
    else { el.textContent = ''; el.style.display = 'none'; }
}

function _toggleTheme() {
    themeVisible = !themeVisible;
    _afficherTheme();
    const btn = $('pendu-theme-toggle');
    if (btn) btn.textContent = themeVisible ? '🔒 Masquer le thème' : '🎯 Afficher le thème';
}

function _creerClavier() {
    const el = $('pendu-clavier'); if (!el) return;
    el.innerHTML = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l =>
        `<button class="btn-lettre" data-lettre="${l}" aria-label="${l}">${l}</button>`
    ).join('');
    el.querySelectorAll('.btn-lettre').forEach(b => {
        b.addEventListener('click', () => {
            if (!partieTerminee) jouerLettre(b.dataset.lettre);
        });
    });
}

const DESSINS = [
    `<svg viewBox="0 0 200 250" class="pendu-svg"><line x1="10" y1="230" x2="150" y2="230" stroke="#fff" stroke-width="4"/></svg>`,
    `<svg viewBox="0 0 200 250" class="pendu-svg"><line x1="10" y1="230" x2="150" y2="230" stroke="#fff" stroke-width="4"/><line x1="50" y1="230" x2="50" y2="20" stroke="#fff" stroke-width="4"/></svg>`,
    `<svg viewBox="0 0 200 250" class="pendu-svg"><line x1="10" y1="230" x2="150" y2="230" stroke="#fff" stroke-width="4"/><line x1="50" y1="230" x2="50" y2="20" stroke="#fff" stroke-width="4"/><line x1="50" y1="20" x2="130" y2="20" stroke="#fff" stroke-width="4"/></svg>`,
    `<svg viewBox="0 0 200 250" class="pendu-svg"><line x1="10" y1="230" x2="150" y2="230" stroke="#fff" stroke-width="4"/><line x1="50" y1="230" x2="50" y2="20" stroke="#fff" stroke-width="4"/><line x1="50" y1="20" x2="130" y2="20" stroke="#fff" stroke-width="4"/><line x1="130" y1="20" x2="130" y2="50" stroke="#fff" stroke-width="2"/></svg>`,
    `<svg viewBox="0 0 200 250" class="pendu-svg"><line x1="10" y1="230" x2="150" y2="230" stroke="#fff" stroke-width="4"/><line x1="50" y1="230" x2="50" y2="20" stroke="#fff" stroke-width="4"/><line x1="50" y1="20" x2="130" y2="20" stroke="#fff" stroke-width="4"/><line x1="130" y1="20" x2="130" y2="50" stroke="#fff" stroke-width="2"/><circle cx="130" cy="70" r="20" stroke="#fff" stroke-width="3" fill="none"/></svg>`,
    `<svg viewBox="0 0 200 250" class="pendu-svg"><line x1="10" y1="230" x2="150" y2="230" stroke="#fff" stroke-width="4"/><line x1="50" y1="230" x2="50" y2="20" stroke="#fff" stroke-width="4"/><line x1="50" y1="20" x2="130" y2="20" stroke="#fff" stroke-width="4"/><line x1="130" y1="20" x2="130" y2="50" stroke="#fff" stroke-width="2"/><circle cx="130" cy="70" r="20" stroke="#fff" stroke-width="3" fill="none"/><line x1="130" y1="90" x2="130" y2="150" stroke="#fff" stroke-width="3"/></svg>`,
    `<svg viewBox="0 0 200 250" class="pendu-svg"><line x1="10" y1="230" x2="150" y2="230" stroke="#fff" stroke-width="4"/><line x1="50" y1="230" x2="50" y2="20" stroke="#fff" stroke-width="4"/><line x1="50" y1="20" x2="130" y2="20" stroke="#fff" stroke-width="4"/><line x1="130" y1="20" x2="130" y2="50" stroke="#fff" stroke-width="2"/><circle cx="130" cy="70" r="20" stroke="#fff" stroke-width="3" fill="none"/><line x1="130" y1="90" x2="130" y2="150" stroke="#fff" stroke-width="3"/><line x1="130" y1="100" x2="100" y2="120" stroke="#fff" stroke-width="3"/><line x1="130" y1="100" x2="160" y2="120" stroke="#fff" stroke-width="3"/><line x1="130" y1="150" x2="110" y2="190" stroke="#fff" stroke-width="3"/><line x1="130" y1="150" x2="150" y2="190" stroke="#fff" stroke-width="3"/></svg>`
];

function _afficherDessin() {
    const el = $('pendu-dessin'); if (!el) return;
    el.innerHTML = DESSINS[Math.min(nombreErreurs, 6)];
}

// ── Logique locale ──────────────────────────────────────────

function jouerLettre(lettre) {
    if (lettresUsees.has(lettre) || partieTerminee) return;
    lettresUsees.add(lettre);
    const btn = document.querySelector(`[data-lettre="${lettre}"]`);
    if (btn) btn.disabled = true;

    // Comparaison sans accents : « E » révèle É/È/Ê… et affiche la lettre accentuée.
    let trouve = false;
    for (let i = 0; i < motSecret.length; i++) {
        if (_normLettre(motSecret[i]) === lettre) {
            motAffiche[i] = motSecret[i];
            trouve = true;
        }
    }
    if (trouve) {
        if (btn) btn.classList.add('correcte');
        _afficherMot();
        if (!motAffiche.includes('_')) _terminerPartie(true);
    } else {
        if (btn) btn.classList.add('incorrecte');
        nombreErreurs++;
        const nb = $('pendu-nb-erreurs'); if (nb) nb.textContent = nombreErreurs;
        _afficherDessin();
        if (nombreErreurs >= MAX_ERREURS) _terminerPartie(false);
    }
}

function _terminerPartie(victoire) {
    if (partieTerminee) return;
    partieTerminee = true;
    themeVisible   = true;
    _afficherTheme();
    document.querySelectorAll('.btn-lettre').forEach(b => b.disabled = true);
    const tgl = $('pendu-theme-toggle'); if (tgl) tgl.disabled = true;

    const joueur   = GameState.joueurs?.[0] || null;
    const penduMot = $('pendu-mot');
    const pseudo   = joueur || 'Hôte';

    if (victoire) {
        if (penduMot) penduMot.innerHTML = `
            <div class="message-victoire">
                🎉 ${pseudo ? `Bravo ${pseudo} !` : 'Bravo !'}<br>
                Le mot était : <strong>${motSecret}</strong><br>
                <em class="theme-info">Thème : ${themeActuel}</em>
            </div>`;
    } else {
        if (penduMot) penduMot.innerHTML = `
            <div class="message-defaite">
                😢 ${pseudo ? `Perdu ${pseudo} !` : 'Perdu !'}<br>
                Le mot était : <strong>${motSecret}</strong><br>
                <em class="theme-info">Thème : ${themeActuel}</em>
            </div>`;
    }

    // Soumettre le résultat au serveur (idempotent côté serveur)
    if (!_resultEnvoye) {
        _resultEnvoye = true;
        try {
            socket.send('HOST_ACTION', {
                action: 'pendu:result',
                data: { pseudo: joueur, victoire, erreurs: nombreErreurs },
            });
            console.log(`[PENDU] 📨 Résultat hôte envoyé : victoire=${victoire}, erreurs=${nombreErreurs}`);
        } catch (err) {
            console.error('[PENDU] send result:', err.message);
        }
    }
}

// ── Abonnements WS ──────────────────────────────────────────

function _abonnerEvenements() {
    socket.on('PENDU_MOT_START',  payload => { try { _onMotStart(payload); }  catch (e) { console.warn('[PENDU] MOT_START', e.message); } });
    socket.on('PENDU_REVELATION', payload => { try { _onRevelation(payload); } catch (e) { console.warn('[PENDU] REVELATION', e.message); } });
    socket.on('SCORES_UPDATE', ({ scores }) => {
        if (scores) {
            GameState.scores = GameState.scores || {};
            Object.assign(GameState.scores, scores);
        }
        try { afficherScoreboard(); } catch {}
    });
}

// ── Initialisation principale ───────────────────────────────

export async function initialiserPendu() {
    console.log('[PENDU] Initialisation WS');
    _abonnerEvenements();
    const hoteActif = await chargerModuleHote();
    if (hoteActif) _injecterPanneauHote();

    // Listener clavier global (une seule fois — idempotent via flag DOM)
    if (!document._penduKeydownInstalled) {
        document._penduKeydownInstalled = true;
        document.addEventListener('keydown', e => {
            if ($('pendu')?.hidden || partieTerminee) return;
            const l = e.key.toUpperCase();
            if (/^[A-Z]$/.test(l) && !lettresUsees.has(l)) jouerLettre(l);
        });
    }

    $('pendu-theme-toggle')?.addEventListener('click', _toggleTheme);

    try {
        socket.send('HOST_ACTION', { action: 'pendu:load', data: {} });
        console.log('[PENDU] 📡 pendu:load envoyé');
    } catch (err) {
        console.error('[PENDU] send load:', err.message);
        alert('Impossible de démarrer le Pendu. Vérifie la connexion.');
    }
}

window.initialiserPendu = initialiserPendu;