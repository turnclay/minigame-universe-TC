import { $, $$, show, hide } from "../core/dom.js";
import { GameState } from "../core/state.js";
import { ajouterPoints } from "../modules/scoreboard.js";

let jpProduits = [];
let jpOrdre = [];
let jpIndex = 0;
let timerJP = null;
let tempsRestantJP = 60;

function gagnerPointJP() {
    const points = 2;
    if (GameState.mode === "solo") {
        ajouterPoints(GameState.joueurs[0], points);
    } else {
        ajouterPoints(GameState.equipes[0].nom, points);
    }
}

function melangerTableau(tab) {
    for (let i = tab.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tab[i], tab[j]] = [tab[j], tab[i]];
    }
    return tab;
}

function getProduitCourant() { return jpProduits[jpOrdre[jpIndex]]; }

function afficherTimerJP() {
    const t = $("jp-timer");
    if (!t) return;
    const m = String(Math.floor(tempsRestantJP / 60)).padStart(2, "0");
    const s = String(tempsRestantJP % 60).padStart(2, "0");
    t.textContent = `${m}:${s}`;
}

function demarrerTimerJP() {
    clearInterval(timerJP);
    tempsRestantJP = 60;
    const t = $("jp-timer");
    if (t) t.classList.remove("clignote");
    afficherTimerJP();
    timerJP = setInterval(() => {
        tempsRestantJP--;
        afficherTimerJP();
        if (tempsRestantJP <= 5 && tempsRestantJP > 0) {
            const t2 = $("jp-timer");
            if (t2) t2.classList.add("clignote");
        }
        if (tempsRestantJP <= 0) {
            clearInterval(timerJP);
            const t3 = $("jp-timer");
            if (t3) { t3.textContent = "00:00"; t3.classList.remove("clignote"); }
        }
    }, 1000);
}

function afficherProduit() {
    const p = getProduitCourant();
    if (!p) return;

    const nom = $("jp-produit-nom");
    if (nom) nom.textContent = p.Nom;

    const desc = $("jp-produit-description");
    if (desc) desc.textContent = p.Description || "";

    const img = $("jp-produit-image");
    if (img) {
        img.src = (p.Image && p.Image.trim()) ? p.Image.trim() : "images/placeholder.png";
        img.alt = p.Nom || "Produit";
    }

    const lien = $("jp-produit-lien");
    if (lien) {
        const q = encodeURIComponent(`${p.Marque||""} ${p.Nom||""} ${p.Description||""}`.trim());
        lien.href = `https://www.google.com/search?tbm=shop&q=${q}`;
    }

    const cat = $("jp-categorie");
    if (cat) cat.textContent = p.Catégorie || "";

    const prix = $("jp-produit-prix");
    if (prix) prix.textContent = "💶 Afficher le prix";

    demarrerTimerJP();
}

function afficherPrix() {
    const p = getProduitCourant();
    if (!p) return;
    const prixEl = $("jp-produit-prix");
    if (prixEl) prixEl.textContent = p.Prix || "Prix indisponible";
    gagnerPointJP();
}

function produitSuivant() { jpIndex = (jpIndex + 1) % jpOrdre.length; afficherProduit(); }
function produitPrecedent() { jpIndex = (jpIndex - 1 + jpOrdre.length) % jpOrdre.length; afficherProduit(); }

export function initialiserJustePrix() {
    fetch("data/justeprix.json")
        .then(r => r.json())
        .then(data => {
            jpProduits = data;
            jpOrdre = melangerTableau([...Array(jpProduits.length).keys()]);
            jpIndex = 0;
            afficherProduit();

            // Attach events
            $("jp-btn-next")?.addEventListener("click", produitSuivant);
            $("jp-btn-prev")?.addEventListener("click", produitPrecedent);
            $("jp-produit-prix")?.addEventListener("click", afficherPrix);
        })
        .catch(err => console.error("Erreur JSON Juste Prix:", err));
}

window.initialiserJustePrix = initialiserJustePrix;