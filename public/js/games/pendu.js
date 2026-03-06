/**
 * ============================================
 * 🪢 PENDU.JS - Jeu du Pendu
 * ============================================
 * Jeu classique du pendu avec clavier virtuel
 */

import { $ } from '../core/dom.js';
import { GameState } from '../core/state.js';
import { modifierScore } from '../modules/scoreboard.js';

// ============================================
// 📦 CONFIGURATION
// ============================================

let MOTS_PENDU = []; // sera rempli dynamiquement

const MAX_ERREURS = 7;

// Nouveau système de points
const POINTS_SANS_ERREUR = 10;   // 10 points si 0 erreur
const PENALITE_ERREUR = 1;       // -1 point par erreur

// ============================================
// 📥 CHARGEMENT DU FICHIER JSON
// ============================================

export async function chargerMotsPendu() {
    try {
        const response = await fetch("/data/pendu.json");
        if (!response.ok) {
            throw new Error("Impossible de charger pendu.json");
        }

        const data = await response.json();

        // Normalisation : on stocke les objets complets {MOT, THEME}
        MOTS_PENDU = data.map(entry => ({
            mot: entry.MOT.toUpperCase(),
            theme: entry.THEME.toUpperCase()
        }));

        console.log("✅ Mots du pendu chargés :", MOTS_PENDU.length);
    } catch (err) {
        console.error("❌ Erreur chargement pendu.json :", err);
    }
}

// ============================================
// 🎯 FONCTION POUR CHOISIR UN MOT
// ============================================

export function choisirMotPendu() {
    if (MOTS_PENDU.length === 0) {
        console.warn("⚠️ MOTS_PENDU est vide ! As-tu appelé chargerMotsPendu() ?");
        return null;
    }

    const index = Math.floor(Math.random() * MOTS_PENDU.length);
    return MOTS_PENDU[index];
}

// ============================================
// 🎯 VARIABLES D'ÉTAT
// ============================================

let motObjet = null;
let motSecret = '';
let themeActuel = '';
let motAffiche = [];
let lettresUtilisees = new Set();
let nombreErreurs = 0;
let partieTerminee = false;
let joueurActuelIndex = 0;
let themeVisible = false;

// ============================================
// 🎮 INITIALISATION DU JEU
// ============================================

export async function initialiserPendu() {
    console.log("[PENDU] Initialisation du jeu");

    if (MOTS_PENDU.length === 0) {
        await chargerMotsPendu();
    }

    joueurActuelIndex = 0;
    initialiserPartie();

    const btnRejouer = $("pendu-rejouer");
    if (btnRejouer) {
        btnRejouer.onclick = nouvellePartie;
    }

    const btnTheme = $("pendu-theme-toggle");
    if (btnTheme) {
        btnTheme.onclick = toggleTheme;
    }

    document.addEventListener("keydown", gererClavierPhysique);
}

function gererClavierPhysique(e) {
    const sectionPendu = $("pendu");
    if (!sectionPendu || sectionPendu.hidden || partieTerminee) return;

    const lettre = e.key.toUpperCase();
    if (/^[A-Z]$/.test(lettre) && !lettresUtilisees.has(lettre)) {
        jouerLettre(lettre);
    }
}

function nouvellePartie() {
    if (GameState.joueurs && GameState.joueurs.length > 0) {
        joueurActuelIndex = (joueurActuelIndex + 1) % GameState.joueurs.length;
    }

    initialiserPartie();
}

function initialiserPartie() {
    motObjet = choisirMotPendu();

    if (!motObjet) {
        console.error("❌ Impossible de choisir un mot !");
        return;
    }

    motSecret = motObjet.mot;
    themeActuel = motObjet.theme;
    themeVisible = false;

    console.log(`🎯 Nouveau mot: ${motSecret} (Thème: ${themeActuel})`);

    motAffiche = Array(motSecret.length).fill('_');

    lettresUtilisees.clear();
    nombreErreurs = 0;
    partieTerminee = false;

    const premiere = motSecret[0];
    const derniere = motSecret[motSecret.length - 1];

    for (let i = 0; i < motSecret.length; i++) {
        if (motSecret[i] === premiere || motSecret[i] === derniere) {
            motAffiche[i] = motSecret[i];
            lettresUtilisees.add(motSecret[i]);
        }
    }

    afficherMot();
    afficherDessin();
    afficherTheme();
    creerClavier();

    const penduNbErreurs = $("pendu-nb-erreurs");
    if (penduNbErreurs) {
        penduNbErreurs.textContent = '0';
    }

    const btnRejouer = $("pendu-rejouer");
    if (btnRejouer) {
        btnRejouer.hidden = true;
    }

    const btnTheme = $("pendu-theme-toggle");
    if (btnTheme) {
        btnTheme.textContent = "🎯 Afficher le thème";
        btnTheme.disabled = false;
    }

    setTimeout(() => {
        document.querySelectorAll('.btn-lettre').forEach(btn => {
            const lettre = btn.dataset.lettre;
            if (lettresUtilisees.has(lettre)) {
                btn.disabled = true;
                btn.classList.add('correcte');
            }
        });
    }, 50);
}

// ============================================
// 🎨 AFFICHAGE
// ============================================

function afficherMot() {
    const penduMot = $("pendu-mot");
    if (!penduMot) return;

    penduMot.innerHTML = motAffiche
        .map(lettre => `<span class="lettre-case">${lettre}</span>`)
        .join('');
}

function afficherTheme() {
    const penduThemeDisplay = $("pendu-theme-display");
    if (!penduThemeDisplay) return;

    if (themeVisible) {
        penduThemeDisplay.textContent = themeActuel;
        penduThemeDisplay.style.display = 'block';
    } else {
        penduThemeDisplay.textContent = '';
        penduThemeDisplay.style.display = 'none';
    }
}

function toggleTheme() {
    themeVisible = !themeVisible;
    afficherTheme();

    const btnTheme = $("pendu-theme-toggle");
    if (btnTheme) {
        btnTheme.textContent = themeVisible ? "🔒 Masquer le thème" : "🎯 Afficher le thème";
    }
}

function creerClavier() {
    const lettres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const penduClavier = $("pendu-clavier");

    if (!penduClavier) return;

    penduClavier.innerHTML = lettres
        .map(lettre => `
            <button
                class="btn-lettre"
                data-lettre="${lettre}"
                aria-label="Lettre ${lettre}"
            >
                ${lettre}
            </button>
        `)
        .join('');

    document.querySelectorAll('.btn-lettre').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!partieTerminee) {
                jouerLettre(btn.dataset.lettre);
            }
        });
    });
}

function afficherDessin() {
    const penduDessin = $("pendu-dessin");
    if (!penduDessin) return;

    const dessins = [
        `<svg viewBox="0 0 200 250" class="pendu-svg">
            <line x1="10" y1="230" x2="150" y2="230" stroke="#fff" stroke-width="4"/>
        </svg>`,

        `<svg viewBox="0 0 200 250" class="pendu-svg">
            <line x1="10" y1="230" x2="150" y2="230" stroke="#fff" stroke-width="4"/>
            <line x1="50" y1="230" x2="50" y2="20" stroke="#fff" stroke-width="4"/>
        </svg>`,

        `<svg viewBox="0 0 200 250" class="pendu-svg">
            <line x1="10" y1="230" x2="150" y2="230" stroke="#fff" stroke-width="4"/>
            <line x1="50" y1="230" x2="50" y2="20" stroke="#fff" stroke-width="4"/>
            <line x1="50" y1="20" x2="130" y2="20" stroke="#fff" stroke-width="4"/>
        </svg>`,

        `<svg viewBox="0 0 200 250" class="pendu-svg">
            <line x1="10" y1="230" x2="150" y2="230" stroke="#fff" stroke-width="4"/>
            <line x1="50" y1="230" x2="50" y2="20" stroke="#fff" stroke-width="4"/>
            <line x1="50" y1="20" x2="130" y2="20" stroke="#fff" stroke-width="4"/>
            <line x1="130" y1="20" x2="130" y2="50" stroke="#fff" stroke-width="2"/>
        </svg>`,

        `<svg viewBox="0 0 200 250" class="pendu-svg">
            <line x1="10" y1="230" x2="150" y2="230" stroke="#fff" stroke-width="4"/>
            <line x1="50" y1="230" x2="50" y20="20" stroke="#fff" stroke-width="4"/>
            <line x1="50" y1="20" x2="130" y2="20" stroke="#fff" stroke-width="4"/>
            <line x1="130" y1="20" x2="130" y2="50" stroke="#fff" stroke-width="2"/>
            <circle cx="130" cy="70" r="20" stroke="#fff" stroke-width="3" fill="none"/>
        </svg>`,

        `<svg viewBox="0 0 200 250" class="pendu-svg">
            <line x1="10" y1="230" x2="150" y2="230" stroke="#fff" stroke-width="4"/>
            <line x1="50" y1="230" x2="50" y2="20" stroke="#fff" stroke-width="4"/>
            <line x1="50" y1="20" x2="130" y2="20" stroke="#fff" stroke-width="4"/>
            <line x1="130" y1="20" x2="130" y2="50" stroke="#fff" stroke-width="2"/>
            <circle cx="130" cy="70" r="20" stroke="#fff" stroke-width="3" fill="none"/>
            <line x1="130" y1="90" x2="130" y2="150" stroke="#fff" stroke-width="3"/>
        </svg>`,

        `<svg viewBox="0 0 200 250" class="pendu-svg">
            <line x1="10" y1="230" x2="150" y2="230" stroke="#fff" stroke-width="4"/>
            <line x1="50" y1="230" x2="50" y2="20" stroke="#fff" stroke-width="4"/>
            <line x1="50" y1="20" x2="130" y2="20" stroke="#fff" stroke-width="4"/>
            <line x1="130" y1="20" x2="130" y2="50" stroke="#fff" stroke-width="2"/>
            <circle cx="130" cy="70" r="20" stroke="#fff" stroke-width="3" fill="none"/>
            <line x1="130" y1="90" x2="130" y2="150" stroke="#fff" stroke-width="3"/>
            <line x1="130" y1="100" x2="100" y2="120" stroke="#fff" stroke-width="3"/>
            <line x1="130" y1="100" x2="160" y2="120" stroke="#fff" stroke-width="3"/>
            <line x1="130" y1="150" x2="110" y2="190" stroke="#fff" stroke-width="3"/>
            <line x1="130" y1="150" x2="150" y2="190" stroke="#fff" stroke-width="3"/>
        </svg>`
    ];

    penduDessin.innerHTML = dessins[nombreErreurs];
}

// ============================================
// 🎯 LOGIQUE DU JEU
// ============================================

function jouerLettre(lettre) {
    if (lettresUtilisees.has(lettre)) {
        return;
    }

    lettresUtilisees.add(lettre);

    const btn = document.querySelector(`[data-lettre="${lettre}"]`);
    if (btn) {
        btn.disabled = true;
    }

    if (motSecret.includes(lettre)) {
        if (btn) btn.classList.add('correcte');

        for (let i = 0; i < motSecret.length; i++) {
            if (motSecret[i] === lettre) {
                motAffiche[i] = lettre;
            }
        }

        afficherMot();

        if (!motAffiche.includes('_')) {
            terminerPartie(true);
        }
    } else {
        if (btn) btn.classList.add('incorrecte');
        nombreErreurs++;

        const penduNbErreurs = $("pendu-nb-erreurs");
        if (penduNbErreurs) {
            penduNbErreurs.textContent = nombreErreurs;
        }

        afficherDessin();

        if (nombreErreurs >= MAX_ERREURS) {
            terminerPartie(false);
        }
    }
}

// ============================================
// 🏁 FIN DE PARTIE + NOUVEAU SYSTÈME DE POINTS
// ============================================

function terminerPartie(victoire) {
    partieTerminee = true;
    themeVisible = true;
    afficherTheme();

    const penduMot = $("pendu-mot");
    const btnRejouer = $("pendu-rejouer");
    const btnTheme = $("pendu-theme-toggle");

    document.querySelectorAll('.btn-lettre').forEach(btn => {
        btn.disabled = true;
    });

    if (btnTheme) {
        btnTheme.disabled = true;
    }

    if (GameState.joueurs && GameState.joueurs.length > 0) {
        const joueurActuel = GameState.joueurs[joueurActuelIndex];

        if (victoire) {

            // 🎯 Nouveau calcul des points :
            // 10 points si 0 erreur
            // -1 point par erreur
            let points = POINTS_SANS_ERREUR - (nombreErreurs * PENALITE_ERREUR);

            // Empêcher les scores négatifs (optionnel)
            points = Math.max(points, 0);

            modifierScore(joueurActuel, points);

            if (penduMot) {
                penduMot.innerHTML = `
                    <div class="message-victoire">
                        🎉 Bravo ${joueurActuel} !<br>
                        Le mot était : <strong>${motSecret}</strong><br>
                        <em class="theme-info">Thème : ${themeActuel}</em><br>
                        <em class="points-info">+${points} points</em>
                    </div>
                `;
            }
        } else {
            motAffiche = motSecret.split('');

            if (penduMot) {
                penduMot.innerHTML = `
                    <div class="message-defaite">
                        😢 Perdu ${joueurActuel} !<br>
                        Le mot était : <strong>${motSecret}</strong><br>
                        <em class="theme-info">Thème : ${themeActuel}</em>
                    </div>
                `;
            }
        }
    } else {
        if (victoire) {
            if (penduMot) {
                penduMot.innerHTML = `
                    <div class="message-victoire">
                        🎉 Bravo ! Vous avez gagné !<br>
                        Le mot était : <strong>${motSecret}</strong><br>
                        <em class="theme-info">Thème : ${themeActuel}</em>
                    </div>
                `;
            }
        } else {
            if (penduMot) {
                penduMot.innerHTML = `
                    <div class="message-defaite">
                        😢 Perdu !<br>
                        Le mot était : <strong>${motSecret}</strong><br>
                        <em class="theme-info">Thème : ${themeActuel}</em>
                    </div>
                `;
            }
        }
    }

    if (btnRejouer) {
        btnRejouer.hidden = false;
    }
}