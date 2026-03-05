import { $, $$, show, hide } from "../core/dom.js";
import { GameState } from "../core/state.js";
import { ajouterPoints } from "../modules/scoreboard.js";

// ======================================================
// 🎯 LE MOT LE PLUS LONG — MODULE (VERSION 10 LETTRES)
// ======================================================

// Lettres possibles
const VOYELLES = ["A", "E", "I", "O", "U", "Y"];
const CONSONNES = "BCDFGHJKLMNPQRSTVWXZ".split("");

// Variables du jeu
let lettresLML = [];
let timerLML = null;
let tempsRestantLML = 60;
let lexique = new Set();

// ======================================================
// 🏆 AJOUT DES POINTS (SOLO / ÉQUIPES)
// ======================================================

function attribuerPointsLML(mot) {
    const points = mot.length;

    if (GameState.mode === "solo") {
        const joueur = GameState.joueurs[0];
        ajouterPoints(joueur, points);
    } else {
        const equipe = GameState.equipes[0].nom;
        ajouterPoints(equipe, points);
    }
}

// ======================================================
// 📚 CHARGEMENT DU LEXIQUE
// ======================================================

async function chargerLexique() {
    try {
        const response = await fetch('data/Lexique383.tsv');
        const texte = await response.text();

        const lignes = texte.split('\n');

        for (let i = 1; i < lignes.length; i++) {
            const colonnes = lignes[i].split('\t');
            if (colonnes[0]) {
                const mot = colonnes[0].trim().toUpperCase();
                if (mot.length >= 3) {
                    lexique.add(mot);
                }
            }
        }

        console.log(`📚 Lexique chargé : ${lexique.size} mots`);
    } catch (error) {
        console.error('❌ Erreur chargement lexique:', error);
    }
}

// ======================================================
// 🔍 TROUVER LE MOT LE PLUS LONG POSSIBLE
// ======================================================

function trouverMotLePlusLong(lettres) {
    const dispo = {};
    for (const l of lettres) {
        dispo[l] = (dispo[l] || 0) + 1;
    }

    let meilleur = "";

    for (const mot of lexique) {
        if (mot.length <= meilleur.length) continue;

        const temp = { ...dispo };
        let possible = true;

        for (const c of mot) {
            if (!temp[c]) {
                possible = false;
                break;
            }
            temp[c]--;
        }

        if (possible) {
            meilleur = mot;
        }
    }

    return meilleur;
}

// ======================================================
// ⏱️ FORMATAGE DU TEMPS
// ======================================================

function formatTime(seconds) {
    const m = String(Math.floor(seconds / 60)).padStart(2, "0");
    const s = String(seconds % 60).padStart(2, "0");
    return `${m}:${s}`;
}

// ======================================================
// 🎮 INITIALISATION DU MODULE
// ======================================================

async function initialiserLML() {
    if (lexique.size === 0) {
        await chargerLexique();
    }

    resetInterface();
    genererLettres();
    afficherLettres();
    demarrerTimerLML();

    $("retour")?.addEventListener("click", () => {
        afficherEcran("home");
    });
}

// ======================================================
// 🔤 GÉNÉRATION DES LETTRES
// ======================================================

function genererLettres() {
    lettresLML = [];

    for (let i = 0; i < 3; i++) {
        lettresLML.push(VOYELLES[Math.floor(Math.random() * VOYELLES.length)]);
    }

    for (let i = 0; i < 7; i++) {
        lettresLML.push(CONSONNES[Math.floor(Math.random() * CONSONNES.length)]);
    }

    lettresLML.sort(() => Math.random() - 0.5);
}

function afficherLettres() {
    const zone = $("lml-lettres");
    if (!zone) return;

    zone.innerHTML = lettresLML
        .map((l, i) =>
            `<span class="lettre" data-index="${i}" style="animation-delay:${i * 0.07}s">${l}</span>`
        )
        .join("");

    document.querySelectorAll("#lml-lettres .lettre").forEach(el => {
        el.addEventListener("click", () => ajouterLettreDepuisClick(el));
    });
}

// ======================================================
// 🆕 AJOUTER UNE LETTRE AU MOT
// ======================================================

function ajouterLettreDepuisClick(el) {
    if (el.classList.contains("utilisee")) return;

    const lettre = el.textContent.trim();
    const input = $("lml-input");

    input.value += lettre;
    el.classList.add("utilisee");
}

// ======================================================
// 🔄 MÉLANGER LES LETTRES
// ======================================================

function melangerLettres() {
    lettresLML.sort(() => Math.random() - 0.5);
    afficherLettres();
}

// ======================================================
// ⏱️ TIMER
// ======================================================

function demarrerTimerLML() {
    clearInterval(timerLML);
    tempsRestantLML = 60;

    const t = $("lml-timer");
    t.textContent = formatTime(tempsRestantLML);
    t.classList.remove('clignote');

    timerLML = setInterval(() => {
        tempsRestantLML--;
        t.textContent = formatTime(tempsRestantLML);

        if (tempsRestantLML <= 10 && tempsRestantLML > 0) {
            t.classList.add('clignote');
        }

        if (tempsRestantLML <= 0) {
            clearInterval(timerLML);
            t.textContent = "00:00";
            verifierMot(false);
        }
    }, 1000);
}

// ======================================================
// 📝 VALIDATION DU MOT
// ======================================================

function verifierMot(depuisBouton = false) {
    clearInterval(timerLML);

    document.querySelectorAll("#lml-lettres .lettre").forEach(el => {
        el.classList.remove("utilisee");
    });

    const mot = $("lml-input").value.trim().toUpperCase();
    const resultat = $("lml-resultat");

    if (!mot) {
        resultat.textContent = "⛔ Aucun mot proposé";
        if (depuisBouton) afficherMotLePlusLong();
        return;
    }

    const lettresDispo = [...lettresLML];

    for (const lettre of mot) {
        const index = lettresDispo.indexOf(lettre);
        if (index === -1) {
            resultat.textContent = "❌ Mot impossible avec ces lettres";
            if (depuisBouton) afficherMotLePlusLong();
            return;
        }
        lettresDispo.splice(index, 1);
    }

    if (!lexique.has(mot)) {
        resultat.textContent = `❌ "${mot}" n'existe pas dans le dictionnaire`;
        if (depuisBouton) afficherMotLePlusLong();
        return;
    }

    resultat.textContent = `✅ Mot valide ! Score : ${mot.length} points`;

    // 🏆 AJOUT DES POINTS ICI
    attribuerPointsLML(mot);

    if (depuisBouton) afficherMotLePlusLong();
}

// ======================================================
// 🏆 AFFICHER LE MOT LE PLUS LONG
// ======================================================

function afficherMotLePlusLong() {
    const resultat = $("lml-resultat");
    const motMax = trouverMotLePlusLong(lettresLML);

    if (motMax) {
        setTimeout(() => {
            resultat.innerHTML += `<br><br>💎 Le mot le plus long était : <strong>${motMax}</strong> (${motMax.length} lettres)`;
        }, 500);
    }
}

// ======================================================
// 🔄 REJOUER
// ======================================================

function resetInterface() {
    $("lml-input").value = "";
    $("lml-resultat").textContent = "";
    $("lml-timer").classList.remove('clignote');

    document.querySelectorAll("#lml-lettres .lettre").forEach(el => {
        el.classList.remove("utilisee");
    });
}

// ======================================================
// 🎮 ÉVÉNEMENTS
// ======================================================

window.addEventListener("DOMContentLoaded", () => {
    $("lml-valider")?.addEventListener("click", () => verifierMot(true));
    $("lml-rejouer")?.addEventListener("click", initialiserLML);
    $("lml-melanger")?.addEventListener("click", melangerLettres);

    $("lml-input")?.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            verifierMot(true);
        }
    });
});
window.initialiserLML = initialiserLML;