// /js/jeux/pendu.js — Le Pendu (côté hôte, logique multijoueur)
// ============================================================
// Tous les joueurs (hôte + invités) jouent le MÊME mot en parallèle.
// L'hôte publie le mot → chacun joue sur son écran → révélation groupée.
// ============================================================
import { $ } from '../core/dom.js';
import { GameState } from '../core/state.js';
import { ajouterPoints, afficherScoreboard } from '../modules/scoreboard.js';

let MOTS_PENDU = [];
const MAX_ERREURS  = 7;
const POINTS_BASE  = 10;

// État de la partie de l'HÔTE (joue en parallèle)
let motSecret      = '';
let themeActuel    = '';
let motAffiche     = [];
let lettresUsees   = new Set();
let nombreErreurs  = 0;
let partieTerminee = false;
let hoteATermine   = false;
let themeVisible   = false;

// Fonctions déléguées (module hôte)
let _publierEtat     = () => {};
let _publierMot      = () => {};
let _publierScores   = () => {};
let _envoyerResultat = () => {};
let _lireReponses    = () => ({});
let _verifierTous    = () => {};
let _afficherReps    = () => {};
let _declencherRev   = () => {};

// ======================================================
// 📡 CHARGEMENT MODULE HÔTE
// ======================================================
async function chargerModuleHote() {
    try {
        const m = await import('../modules/pendu_hote.js');
        _publierEtat     = m.publierEtat;
        _publierMot      = m.publierMot;
        _publierScores   = m.publierScores;
        _envoyerResultat = m.envoyerResultatHote;
        _lireReponses    = m.lireReponses;
        _verifierTous    = m.verifierSiTousOntTermine;
        _afficherReps    = m.afficherReponsesInvitesSurHote;
        _declencherRev   = m.declencherRevelation;

        window._penduValiderAvecPoints = (pts) => {
            if (pts <= 0) return;
            const joueur = GameState.joueurs?.[0];
            if (joueur) { ajouterPoints(joueur, pts); _publierScores(); }
        };

        console.log('[PENDU] ✅ Module hôte chargé');
        return true;
    } catch (e) {
        console.warn('[PENDU] ⚠️ pendu_hote.js introuvable', e.message);
        return false;
    }
}

// ── Chargement mots ────────────────────────────────────────────
export async function chargerMotsPendu() { return chargerMots(); }

async function chargerMots() {
    if (MOTS_PENDU.length > 0) return;
    try {
        const r = await fetch('/data/pendu.json');
        const d = await r.json();
        MOTS_PENDU = d.map(e => ({ mot: e.MOT.toUpperCase(), theme: e.THEME.toUpperCase() }));
        console.log('[PENDU] ✅ Mots chargés :', MOTS_PENDU.length);
    } catch (e) { console.error('[PENDU] ❌', e); }
}

function choisirMot() {
    if (!MOTS_PENDU.length) return null;
    return MOTS_PENDU[Math.floor(Math.random() * MOTS_PENDU.length)];
}

// ── Initialisation ─────────────────────────────────────────────
export async function initialiserPendu() {
    if (!MOTS_PENDU.length) await chargerMots();
    const hoteActif = await chargerModuleHote();

    // Répondre aux demandes de re-sync des invités
    if (hoteActif) {
        const pid  = localStorage.getItem('minigame_partie_session_id');
        _publierEtat('en_cours');
        _publierScores();

        const cleD = `partie_demande_etat_${pid}`;
        let _tsVu  = 0;
        setInterval(() => {
            try {
                const raw = localStorage.getItem(cleD); if (!raw) return;
                const d   = JSON.parse(raw); if (d.ts <= _tsVu) return;
                _tsVu = d.ts;
                _publierEtat('en_cours');
                _publierScores();
                // Re-publier le mot courant pour le nouvel invité
                if (motSecret) _publierMot({ motSecret, theme: themeActuel });
            } catch {}
        }, 800);

        // Écouter les réponses des invités via StorageEvent
        const pid2 = pid;
        window.addEventListener('storage', (e) => {
            const cleR = `partie_reponses_${pid2}`;
            if (e.key === cleR) {
                _afficherReps('pendu-invites-reponses');
                _verifierTous();
            }
        });
        // Polling de secours
        setInterval(() => {
            _afficherReps('pendu-invites-reponses');
            _verifierTous();
        }, 2000);
    }

    _initialiserPartie(hoteActif);

    $('pendu-rejouer')?.addEventListener('click', () => _nouvellePartie(hoteActif));
    $('pendu-theme-toggle')?.addEventListener('click', _toggleTheme);
    document.addEventListener('keydown', e => {
        if ($('pendu')?.hidden || partieTerminee) return;
        const l = e.key.toUpperCase();
        if (/^[A-Z]$/.test(l) && !lettresUsees.has(l)) jouerLettre(l, hoteActif);
    });
}

function _nouvellePartie(hoteActif) {
    _initialiserPartie(hoteActif);
}

function _initialiserPartie(hoteActif) {
    const obj = choisirMot(); if (!obj) return;
    motSecret = obj.mot; themeActuel = obj.theme;
    themeVisible   = false;
    partieTerminee = false;
    hoteATermine   = false;
    motAffiche     = Array(motSecret.length).fill('_');
    lettresUsees.clear();
    nombreErreurs  = 0;

    // Révéler 1ère et dernière lettre + TOUTES leurs occurrences dans le mot
    // (évite de bloquer la lettre au clavier si elle apparaît ailleurs)
    const lettresRevélées = new Set([motSecret[0], motSecret[motSecret.length - 1]]);
    for (let i = 0; i < motSecret.length; i++) {
        if (lettresRevélées.has(motSecret[i])) {
            motAffiche[i] = motSecret[i];
            lettresUsees.add(motSecret[i]);
        }
    }

    _afficherMot();
    _afficherDessin();
    _afficherTheme();
    _creerClavier(hoteActif);

    const nb = $('pendu-nb-erreurs'); if (nb) nb.textContent = '0';
    const btnRejouer = $('pendu-rejouer'); if (btnRejouer) btnRejouer.hidden = true;
    const tgl = $('pendu-theme-toggle'); if (tgl) { tgl.textContent = '🎯 Afficher le thème'; tgl.disabled = false; }

    // Cacher le bouton résultats au départ
    const btnRes = document.getElementById('pendu-btn-resultats');
    if (btnRes) { btnRes.disabled = true; btnRes.style.opacity = '0.4'; btnRes.style.cursor = 'not-allowed'; }

    // Vider le panneau invités
    const reps = document.getElementById('pendu-invites-reponses');
    if (reps) reps.innerHTML = '<p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">En attente des résultats…</p>';

    setTimeout(() => {
        document.querySelectorAll('.btn-lettre').forEach(b => {
            if (lettresUsees.has(b.dataset.lettre)) { b.disabled = true; b.classList.add('correcte'); }
        });
    }, 50);

    // Publier le mot pour les invités
    if (hoteActif) {
        _publierMot({ motSecret, theme: themeActuel });
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
    themeVisible = !themeVisible; _afficherTheme();
    const btn = $('pendu-theme-toggle');
    if (btn) btn.textContent = themeVisible ? '🔒 Masquer le thème' : '🎯 Afficher le thème';
}

function _creerClavier(hoteActif) {
    const el = $('pendu-clavier'); if (!el) return;
    el.innerHTML = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l =>
        `<button class="btn-lettre" data-lettre="${l}" aria-label="${l}">${l}</button>`
    ).join('');
    el.querySelectorAll('.btn-lettre').forEach(b => {
        b.addEventListener('click', () => { if (!partieTerminee) jouerLettre(b.dataset.lettre, hoteActif); });
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

// ── Jouer une lettre (logique hôte) ───────────────────────────
function jouerLettre(lettre, hoteActif) {
    if (lettresUsees.has(lettre)) return;
    lettresUsees.add(lettre);
    const btn = document.querySelector(`[data-lettre="${lettre}"]`);
    if (btn) btn.disabled = true;

    if (motSecret.includes(lettre)) {
        if (btn) btn.classList.add('correcte');
        for (let i = 0; i < motSecret.length; i++) {
            if (motSecret[i] === lettre) motAffiche[i] = lettre;
        }
        _afficherMot();
        if (!motAffiche.includes('_')) _terminerPartie(true, hoteActif);
    } else {
        if (btn) btn.classList.add('incorrecte');
        nombreErreurs++;
        const nb = $('pendu-nb-erreurs'); if (nb) nb.textContent = nombreErreurs;
        _afficherDessin();
        if (nombreErreurs >= MAX_ERREURS) _terminerPartie(false, hoteActif);
    }
}

// ── Fin de partie hôte ────────────────────────────────────────
function _terminerPartie(victoire, hoteActif) {
    partieTerminee = true;
    hoteATermine   = true;
    themeVisible   = true;
    _afficherTheme();
    document.querySelectorAll('.btn-lettre').forEach(b => b.disabled = true);
    const tgl = $('pendu-theme-toggle'); if (tgl) tgl.disabled = true;

    const joueur    = GameState.joueurs?.[0] || null;
    const pts       = victoire ? Math.max(1, POINTS_BASE - nombreErreurs) : 0;
    const penduMot  = $('pendu-mot');

    if (victoire) {
        if (joueur) ajouterPoints(joueur, pts);
        if (penduMot) penduMot.innerHTML = `
            <div class="message-victoire">
                🎉 ${joueur ? `Bravo ${joueur} !` : 'Bravo !'}<br>
                Le mot était : <strong>${motSecret}</strong><br>
                <em class="theme-info">Thème : ${themeActuel}</em><br>
                <em class="points-info">+${pts} point${pts > 1 ? 's' : ''}</em>
            </div>`;
    } else {
        if (penduMot) penduMot.innerHTML = `
            <div class="message-defaite">
                😢 ${joueur ? `Perdu ${joueur} !` : 'Perdu !'}<br>
                Le mot était : <strong>${motSecret}</strong><br>
                <em class="theme-info">Thème : ${themeActuel}</em>
            </div>`;
        afficherScoreboard();
    }

    const btnRejouer = $('pendu-rejouer');
    if (btnRejouer) btnRejouer.hidden = false;

    // Envoyer le résultat de l'hôte + activer bouton résultats
    if (hoteActif) {
        _envoyerResultat({ victoire, erreurs: nombreErreurs, points: pts });
        _publierScores();
        setTimeout(() => {
            _afficherReps('pendu-invites-reponses');
            _verifierTous();
        }, 300);

        // Injecter le bouton "Afficher les résultats" si pas encore présent
        _injecterBoutonResultats();
    }
}

// ── Bouton "Résultats" ────────────────────────────────────────
function _injecterBoutonResultats() {
    if (document.getElementById('pendu-btn-resultats')) return;
    const section = $('pendu'); if (!section) return;

    // Injecter le style pulse une seule fois
    if (!document.getElementById('style-pendu-pulse')) {
        const s = document.createElement('style');
        s.id = 'style-pendu-pulse';
        s.textContent = '@keyframes lmlPulse{0%{transform:scale(1)}50%{transform:scale(1.06)}100%{transform:scale(1)}}';
        document.head.appendChild(s);
    }

    const btn = document.createElement('button');
    btn.id = 'pendu-btn-resultats';
    btn.style.cssText = [
        'width:100%;padding:13px;border-radius:12px;font-size:.92rem;font-weight:700;',
        'background:rgba(167,139,250,.18);border:1.5px solid rgba(167,139,250,.45);',
        'color:white;cursor:not-allowed;opacity:.4;margin-top:12px;font-family:inherit;',
        'transition:opacity .2s,transform .15s;'
    ].join('');
    btn.textContent = '📊 Afficher les résultats';
    btn.disabled    = true;
    btn.title       = 'En attente que tous les joueurs aient terminé…';

    btn.addEventListener('click', () => {
        if (btn.disabled) return;
        btn.disabled = true;
        btn.style.opacity = '0.45';
        _declencherRev(POINTS_BASE);
    });

    section.appendChild(btn);
    _verifierTous();
}

// ── Panneau invités ────────────────────────────────────────────
function _injecterPanneauInvites() {
    if (document.getElementById('panneau-invites-pendu')) return;
    const section = $('pendu'); if (!section) return;
    const p = document.createElement('div');
    p.id = 'panneau-invites-pendu';
    p.style.cssText = 'margin-top:16px;background:rgba(167,139,250,.06);border:1px solid rgba(167,139,250,.25);border-radius:14px;padding:14px 16px;';
    p.innerHTML = '<div style="font-size:.78rem;text-transform:uppercase;letter-spacing:.1em;color:rgba(167,139,250,.8);margin-bottom:10px;font-weight:700;">🎮 Résultats des joueurs</div>'
        + '<div id="pendu-invites-reponses"><p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">En attente des résultats…</p></div>';
    section.appendChild(p);
}

window.initialiserPendu = async function() {
    _injecterPanneauInvites();
    await initialiserPendu();
};