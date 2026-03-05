import { $, $$, show, hide } from "../core/dom.js";
import { GameState } from "../core/state.js";
import { ajouterPoints } from "../modules/scoreboard.js";

// ======================================================
// 🎯 MODULE JUSTE PRIX — VARIABLES
// ======================================================

let jpProduits = [];
let jpOrdre = [];
let jpIndex = 0;

// Timer
let timerJP = null;
let tempsRestantJP = 60;

// ======================================================
// 🏆 AJOUT DES POINTS (SOLO / ÉQUIPES)
// ======================================================

function gagnerPointJP() {
    const points = 2;

    if (GameState.mode === "solo") {
        const joueur = GameState.joueurs[0];
        ajouterPoints(joueur, points);
    } else {
        const equipe = GameState.equipes[0].nom;
        ajouterPoints(equipe, points);
    }
}

// ======================================================
// 🔧 OUTILS
// ======================================================

function melangerTableau(tab) {
    for (let i = tab.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tab[i], tab[j]] = [tab[j], tab[i]];
    }
    return tab;
}

function getProduitCourant() {
    return jpProduits[jpOrdre[jpIndex]];
}

// ======================================================
// ⏱️ TIMER JUSTE PRIX
// ======================================================

function afficherTimerJP() {
    const t = $("jp-timer");
    if (!t) return;

    const minutes = String(Math.floor(tempsRestantJP / 60)).padStart(2, "0");
    const secondes = String(tempsRestantJP % 60).padStart(2, "0");

    t.textContent = `${minutes}:${secondes}`;
}

function demarrerTimerJP() {
    clearInterval(timerJP);
    tempsRestantJP = 60;

    const t = $("jp-timer");
    t.classList.remove("clignote");
    afficherTimerJP();

    timerJP = setInterval(() => {
        tempsRestantJP--;
        afficherTimerJP();

        if (tempsRestantJP <= 5 && tempsRestantJP > 0) {
            t.classList.add("clignote");
        }

        if (tempsRestantJP <= 0) {
            clearInterval(timerJP);
            t.textContent = "00:00";
            t.classList.remove("clignote");
        }
    }, 1000);
}

function arreterTimerJP() {
    clearInterval(timerJP);
}

// ======================================================
// 📝 AFFICHAGE DU PRODUIT
// ======================================================

function afficherProduit() {
    const p = getProduitCourant();
    if (!p) return;

    $("jp-produit-nom").textContent = p.Nom;
    $("jp-produit-description").textContent = p.Description || "";

    const imgElement = $("jp-produit-image");
    if (imgElement) {
        const imageUrl = (p.Image && p.Image.trim() !== "")
            ? p.Image
            : `images/produit_${p.ID}.jpg`;

        imgElement.src = imageUrl.trim() !== "" ? imageUrl : "images/placeholder.png";
        imgElement.alt = p.Nom || "Produit";
    }

    const lienElement = $("jp-produit-lien");
    if (lienElement) {
        const marque = p.Marque || "";
        const nom = p.Nom || "";
        const desc = p.Description || "";
        const query = encodeURIComponent(`${marque} ${nom} ${desc}`.trim());
        lienElement.href = `https://www.google.com/search?tbm=shop&q=${query}`;
    }

    const cat = $("jp-categorie");
    if (cat) {
        cat.textContent = p.Catégorie || "";
        cat.style.animation = "none";
        void cat.offsetWidth;
        cat.style.animation = "bounceIn 0.8s ease-out";
    }

    const prixElement = $("jp-produit-prix");
    if (prixElement) {
        prixElement.textContent = "Afficher prix";
    }

    demarrerTimerJP();
}

// ======================================================
// 💵 AFFICHER LE PRIX
// ======================================================

function afficherPrix() {
    const p = getProduitCourant();
    if (!p) return;

    const prixElement = $("jp-produit-prix");
    if (!prixElement) return;

    prixElement.textContent = p.Prix || "Prix indisponible";

    // 🏆 AJOUT DES POINTS ICI
    gagnerPointJP();
}

// ======================================================
// 🔄 NAVIGATION
// ======================================================

function produitSuivant() {
    jpIndex = (jpIndex + 1) % jpOrdre.length;
    afficherProduit();
}

function produitPrecedent() {
    jpIndex = (jpIndex - 1 + jpOrdre.length) % jpOrdre.length;
    afficherProduit();
}

["btn-next-jp", "btn-next-arrow"].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener("click", produitSuivant);
});

// ======================================================
// 📥 CHARGEMENT DU JSON
// ======================================================

function initialiserJustePrix() {
    fetch("data/justeprix.json")
        .then(r => r.json())
        .then(data => {
            jpProduits = data;
            jpOrdre = melangerTableau([...Array(jpProduits.length).keys()]);
            jpIndex = 0;
            afficherProduit();
            demarrerTimerJP();
        })
        .catch(err => console.error("Erreur JSON Juste Prix :", err));
}

// ======================================================
// 🎮 ÉVÉNEMENTS
// ======================================================

$("jp-btn-next").addEventListener("click", produitSuivant);
$("jp-btn-prev").addEventListener("click", produitPrecedent);
$("jp-produit-prix").addEventListener("click", afficherPrix);

// ======================================================
// 🚀 LANCEMENT
// ======================================================

initialiserJustePrix();