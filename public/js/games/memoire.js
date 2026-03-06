/**
 * ============================================
 * 🧠 MÉMOIRE.JS - Module de jeux de mémoire
 * ============================================
 * Architecture modulaire avec 4 défis variés
 * Version: 1.5 - Tooltip seuils d'erreurs par défi
 */

// ============================================
// 📦 IMPORTS
// ============================================

import { $, hide, show } from "../core/dom.js";
import { GameState } from "../core/state.js";
import { afficherAccueilJeux } from "../main.js";
import { afficherScoreboard, ajouterPoints } from "../modules/scoreboard.js";

// ============================================
// 🎯 CONFIGURATION DES DÉFIS
// ============================================

const DEFIS_CONFIG = {
    paires: {
        nom: "Retrouve les paires",
        icon: "🃏",
        description: "Mémorise les cartes et retrouve les paires identiques",
        difficultes: {
            facile:    { paires: 4, tempsAffichage: 5000, gridSize: "4x2", seuilErreurs: 1 },
            moyen:     { paires: 6, tempsAffichage: 6000, gridSize: "4x3", seuilErreurs: 2 },
            difficile: { paires: 8, tempsAffichage: 7000, gridSize: "4x4", seuilErreurs: 3 }
        }
    },
    suite: {
        nom: "Retiens la suite",
        icon: "🔢",
        description: "Mémorise la séquence de nombres ou symboles",
        difficultes: {
            facile:    { longueur: 7, tempsAffichage: 4500, type: "nombres",  seuilErreurs: 0 },
            moyen:     { longueur: 5, tempsAffichage: 5000, type: "symboles", seuilErreurs: 1 },
            difficile: { longueur: 7, tempsAffichage: 6000, type: "mixte",    seuilErreurs: 2 }
        }
    },
    couleurs: {
        nom: "Retiens les couleurs",
        icon: "🎨",
        description: "Mémorise l'ordre des couleurs affichées",
        difficultes: {
            facile:    { sequence: 4, tempsAffichage: 4000, vitesse: 1000, seuilErreurs: 1 },
            moyen:     { sequence: 6, tempsAffichage: 4500, vitesse: 1000, seuilErreurs: 2 },
            difficile: { sequence: 7, tempsAffichage: 5000, vitesse: 1000, seuilErreurs: 3 }
        }
    },
    symboles: {
        nom: "Mémorise les symboles",
        icon: "✨",
        description: "Retiens la position exacte de chaque symbole",
        difficultes: {
            facile:    { symboles: 4, grille: 3, tempsAffichage: 6000,  seuilErreurs: 1 },
            moyen:     { symboles: 6, grille: 4, tempsAffichage: 9000,  seuilErreurs: 2 },
            difficile: { symboles: 7, grille: 5, tempsAffichage: 10000, seuilErreurs: 3 }
        }
    }
};

// ============================================
// 🎨 BIBLIOTHÈQUES DE CONTENU
// ============================================

const BIBLIOTHEQUE = {
    symbolesPaires: ["🎮", "🎯", "🎲", "🎪", "🎨", "🎭", "🎬", "🎸", "🎹", "🎺", "🎻", "🥁", "🎤", "🎧", "📻", "🎼"],
    symbolesGrille: ["⭐", "❤️", "💎", "🌙", "☀️", "🔥", "💧", "🌸", "🍀", "🌺", "🦋", "🐝", "🎯", "⚡", "🌈", "✨"],
    symbolesSuite:  ["○", "△", "□", "◇", "☆", "♠", "♣", "♥", "♦", "●", "▲", "■"],
    couleurs: [
        { nom: "Rouge",  hex: "#e74c3c", rgb: "rgb(231, 76, 60)"  },
        { nom: "Bleu",   hex: "#3498db", rgb: "rgb(52, 152, 219)" },
        { nom: "Vert",   hex: "#2ecc71", rgb: "rgb(46, 204, 113)" },
        { nom: "Jaune",  hex: "#f39c12", rgb: "rgb(243, 156, 18)" },
        { nom: "Violet", hex: "#9b59b6", rgb: "rgb(155, 89, 182)" },
        { nom: "Orange", hex: "#e67e22", rgb: "rgb(230, 126, 34)" },
        { nom: "Rose",   hex: "#ec407a", rgb: "rgb(236, 64, 122)" },
        { nom: "Cyan",   hex: "#00d4ff", rgb: "rgb(0, 212, 255)"  }
    ]
};

// ============================================
// 🎮 ÉTAT DU JEU
// ============================================

let etatMemoire = {
    defiActuel:       null,
    difficulte:       "moyen",
    phase:            "menu",
    donnees:          null,
    reponseJoueur:    [],
    score:            0,
    tentatives:       0,
    tempsDebut:       null,
    timer:            null,
    joueurActif:      null,
    indexJoueurActif: 0,
    seuilErreurs:     0
};

// ============================================
// 🚀 INITIALISATION
// ============================================

export function initialiserMemoire() {
    console.log("[MÉMOIRE] Initialisation du module");

    etatMemoire = {
        defiActuel:       null,
        difficulte:       "moyen",
        phase:            "menu",
        donnees:          null,
        reponseJoueur:    [],
        score:            0,
        tentatives:       0,
        tempsDebut:       null,
        timer:            null,
        joueurActif:      null,
        indexJoueurActif: 0,
        seuilErreurs:     0
    };

    if (GameState.mode === "solo" && GameState.joueurs.length > 0) {
        etatMemoire.joueurActif = GameState.joueurs[etatMemoire.indexJoueurActif];
    } else if (GameState.mode === "team" && GameState.equipes.length > 0) {
        etatMemoire.joueurActif = GameState.equipes[etatMemoire.indexJoueurActif].nom;
    }

    afficherMenuDefis();
    attacherEvenements();
}

window.initialiserMemoire = initialiserMemoire;

// ============================================
// 🎯 MENU DE SÉLECTION DES DÉFIS
// ============================================

function afficherMenuDefis() {
    const container = $("memoire");

    container.innerHTML = `
        <header class="game-header">
            <h2 class="section-title">🧠 Choisis ton défi</h2>
        </header>

        <div class="memoire-difficulte-selector">
            <label>Niveau :</label>
            <div class="difficulte-buttons">
                <button class="diff-btn ${etatMemoire.difficulte === 'facile'    ? 'active' : ''}" data-diff="facile">
                    😊 Facile (3 pts)
                </button>
                <button class="diff-btn ${etatMemoire.difficulte === 'moyen'     ? 'active' : ''}" data-diff="moyen">
                    🤔 Moyen (5 pts)
                </button>
                <button class="diff-btn ${etatMemoire.difficulte === 'difficile' ? 'active' : ''}" data-diff="difficile">
                    🔥 Difficile (10 pts)
                </button>
            </div>
            <p class="difficulte-info">Attention ⚠️: 0 point si seuil d'erreurs dépassé</p>
        </div>

        <div class="memoire-defis-grid">
            ${Object.entries(DEFIS_CONFIG).map(([key, defi]) => `
                <div class="memoire-defi-card" data-defi="${key}">
                    <div class="defi-icon">${defi.icon}</div>
                    <h3 class="defi-nom">${defi.nom}</h3>
                    <p class="defi-description">${defi.description}</p>
                    <button class="btn-jouer-defi">Jouer</button>
                </div>
            `).join('')}
        </div>

        <div class="memoire-stats">
            <p>Tentatives: <span id="memoire-tentatives">${etatMemoire.tentatives}</span></p>
        </div>

    `;

    attacherEvenementsMenu();
}

// ============================================
// 💬 TOOLTIP – SEUIL D'ERREURS PAR DÉFI
// ============================================

/**
 * Retourne la classe CSS de couleur du badge selon le seuil d'erreurs.
 */
function classeBadgeSeuil(seuil) {
    if (seuil === 0) return "zero";
    if (seuil === 1) return "low";
    if (seuil <= 2)  return "medium";
    return "high";
}

/**
 * Construit le HTML du tooltip pour une carte de défi donnée,
 * en fonction du niveau actuellement sélectionné.
 */
function construireTooltipDefi(keyDefi) {
    const defi       = DEFIS_CONFIG[keyDefi];
    const diffNom    = etatMemoire.difficulte;
    const seuil      = defi.difficultes[diffNom].seuilErreurs;
    const classBadge = classeBadgeSeuil(seuil);
    const labelsDiff = { facile: "😊 Facile", moyen: "🤔 Moyen", difficile: "🔥 Difficile" };
    const msgSeuil   = seuil === 0
        ? `<strong>Aucune</strong> erreur tolérée`
        : `<strong>${seuil}</strong> erreur${seuil > 1 ? "s" : ""} tolérée${seuil > 1 ? "s" : ""}`;

    return `
        <div class="defi-tooltip-header">
            ${defi.icon} ${defi.nom} &mdash; ${labelsDiff[diffNom]}
        </div>
        <div class="defi-tooltip-seuil">
            <div class="defi-tooltip-seuil-badge ${classBadge}">${seuil}</div>
            <div class="defi-tooltip-seuil-texte">${msgSeuil}</div>
        </div>
        <div class="defi-tooltip-footer">Au-delà du seuil → 0 point 💀</div>
    `;
}

/**
 * Crée UN seul tooltip global dans document.body
 * et le positionne en haut à droite de la carte survolée
 * via getBoundingClientRect (indépendant de tout parent DOM).
 */
function attacherTooltipDefis() {
    // Tooltip unique dans le body — jamais enfant d'une carte
    let tooltip = document.getElementById("defi-tooltip-global");
    if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.id        = "defi-tooltip-global";
        tooltip.className = "defi-tooltip";
        tooltip.setAttribute("aria-hidden", "true");
        document.body.appendChild(tooltip);
    }

    function afficher(card) {
        const keyDefi = card.dataset.defi;
        tooltip.innerHTML = construireTooltipDefi(keyDefi);
        tooltip.classList.add("visible");

        // Positionne juste après le rendu pour avoir offsetWidth/Height
        requestAnimationFrame(() => {
            const rect   = card.getBoundingClientRect();
            const margin = 10;
            let x = rect.right  + margin + window.scrollX;
            let y = rect.top              + window.scrollY;

            // Si ça déborde à droite, on passe à gauche de la carte
            if (rect.right + margin + tooltip.offsetWidth > window.innerWidth) {
                x = rect.left - tooltip.offsetWidth - margin + window.scrollX;
            }

            tooltip.style.left = x + "px";
            tooltip.style.top  = y + "px";
        });
    }

    function masquer() {
        tooltip.classList.remove("visible");
    }

    document.querySelectorAll(".memoire-defi-card").forEach(card => {
        card.addEventListener("mouseenter", () => afficher(card));
        card.addEventListener("mouseleave", masquer);
    });
}

// ============================================
// 🎮 GESTIONNAIRES D'ÉVÉNEMENTS
// ============================================

function attacherEvenements() {
    const btnRetour = $("btn-retour-memoire");
    if (btnRetour) {
        btnRetour.onclick = () => {
            nettoyerTimer();
            afficherMenuDefis();
            attacherEvenements();
        };
    }
}

function attacherEvenementsMenu() {
    // Sélection difficulté
    document.querySelectorAll(".diff-btn").forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll(".diff-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            etatMemoire.difficulte = btn.dataset.diff;
            // Le tooltip se met à jour automatiquement au prochain mouseenter
            // car il lit etatMemoire.difficulte au moment du survol
        };
    });

    // Lancement des défis
    document.querySelectorAll(".btn-jouer-defi").forEach(btn => {
        btn.onclick = (e) => {
            const card = e.target.closest(".memoire-defi-card");
            lancerDefi(card.dataset.defi);
        };
    });

    // Tooltips sur les cartes
    attacherTooltipDefis();
}

// ============================================
// 🎯 DÉFI 1: RETROUVE LES PAIRES
// ============================================

function genererDefiPaires(config) {
    const { paires } = config;
    const symbolesDisponibles = [...BIBLIOTHEQUE.symbolesPaires];
    const symbolesSelectionnes = [];

    for (let i = 0; i < paires; i++) {
        const index = Math.floor(Math.random() * symbolesDisponibles.length);
        symbolesSelectionnes.push(symbolesDisponibles.splice(index, 1)[0]);
    }

    return shuffleArray([...symbolesSelectionnes, ...symbolesSelectionnes]);
}

function afficherDefiPaires(config) {
    const cartes    = genererDefiPaires(config);
    const container = $("memoire");

    container.innerHTML = `
        <header class="game-header">
            <button id="btn-retour-memoire" class="btn-retour">⬅️</button>
            <h2>🃏 Retrouve les paires</h2>
        </header>

        <div class="memoire-timer">
            <div class="timer-bar" id="memoire-timer-bar"></div>
        </div>

        <div class="memoire-paires-grid" style="grid-template-columns: repeat(${config.gridSize.split('x')[0]}, 1fr);">
            ${cartes.map((symbole, index) => `
                <div class="memoire-carte" data-index="${index}" data-symbole="${symbole}">
                    <div class="carte-front">${symbole}</div>
                    <div class="carte-back">?</div>
                </div>
            `).join('')}
        </div>

        <div class="memoire-status">Mémorise les cartes...</div>
    `;

    etatMemoire.donnees = {
        cartes,
        pairesRestantes: config.paires,
        paireTrouvees:   [],
        erreurs:         0,
        tailleSequence:  config.paires,
        seuilErreurs:    config.seuilErreurs
    };
    etatMemoire.seuilErreurs = config.seuilErreurs;

    setTimeout(() => {
        document.querySelectorAll(".memoire-carte").forEach(c => c.classList.add("retournee"));

        animerTimer(config.tempsAffichage, () => {
            document.querySelectorAll(".memoire-carte").forEach(c => c.classList.remove("retournee"));
            const statusEl = document.querySelector(".memoire-status");
            if (statusEl) statusEl.textContent = "À toi de jouer ! (Erreurs : 0)";
            etatMemoire.phase = "jeu";
            activerClicCartes();
        });
    }, 500);
}

function activerClicCartes() {
    let carteSelectionnee = null;
    let bloque = false;

    document.querySelectorAll(".memoire-carte").forEach(carte => {
        carte.onclick = () => {
            if (bloque || carte.classList.contains("trouvee") || carte === carteSelectionnee) return;

            carte.classList.add("retournee");

            if (!carteSelectionnee) { carteSelectionnee = carte; return; }

            bloque = true;
            const s1 = carteSelectionnee.dataset.symbole;
            const s2 = carte.dataset.symbole;

            if (s1 === s2) {
                setTimeout(() => {
                    carteSelectionnee.classList.add("trouvee");
                    carte.classList.add("trouvee");
                    etatMemoire.donnees.pairesRestantes--;
                    if (etatMemoire.donnees.pairesRestantes === 0) afficherResultat(true, "Bravo ! Toutes les paires trouvées !");
                    carteSelectionnee = null;
                    bloque = false;
                }, 400);
            } else {
                etatMemoire.donnees.erreurs++;
                document.querySelector(".memoire-status").textContent = `Erreurs : ${etatMemoire.donnees.erreurs}`;
                setTimeout(() => {
                    carteSelectionnee.classList.remove("retournee");
                    carte.classList.remove("retournee");
                    carteSelectionnee = null;
                    bloque = false;
                }, 1000);
            }
        };
    });
}

// ============================================
// 🎯 DÉFI 2: RETIENS LA SUITE LOGIQUE
// ============================================

function genererDefiSuite(config) {
    const { longueur, type } = config;
    const suite = [];

    if (type === "nombres") {
        for (let i = 0; i < longueur; i++) suite.push(Math.floor(Math.random() * 10));
    } else if (type === "symboles") {
        for (let i = 0; i < longueur; i++) suite.push(BIBLIOTHEQUE.symbolesSuite[Math.floor(Math.random() * BIBLIOTHEQUE.symbolesSuite.length)]);
    } else {
        for (let i = 0; i < longueur; i++) {
            if (Math.random() > 0.5) suite.push(Math.floor(Math.random() * 10));
            else suite.push(BIBLIOTHEQUE.symbolesSuite[Math.floor(Math.random() * BIBLIOTHEQUE.symbolesSuite.length)]);
        }
    }
    return suite;
}

function afficherDefiSuite(config) {
    const suite     = genererDefiSuite(config);
    const container = $("memoire");

    container.innerHTML = `
        <header class="game-header">
            <button id="btn-retour-memoire" class="btn-retour">⬅️</button>
            <h2>🔢 Retiens la suite</h2>
        </header>

        <div class="memoire-timer">
            <div class="timer-bar" id="memoire-timer-bar"></div>
        </div>

        <div id="memoire-suite-affichage" class="memoire-suite-affichage">
            ${suite.map(item => `<div class="suite-item">${item}</div>`).join('')}
        </div>

        <div id="memoire-suite-input" class="memoire-suite-input" style="display:none;">
            <p class="instruction">Reconstitue la suite :</p>
            <div class="suite-reponse" id="suite-reponse"></div>
            <div class="suite-clavier">${genererClavierSuite(config.type)}</div>
            <div class="suite-actions">
                <button id="btn-effacer" class="btn-secondary">🗑️ Effacer</button>
                <button id="btn-valider-suite" class="btn-primary">✅ Valider</button>
            </div>
        </div>
    `;

    etatMemoire.donnees = { suite, reponse: [], erreurs: 0, tailleSequence: config.longueur, seuilErreurs: config.seuilErreurs };
    etatMemoire.seuilErreurs = config.seuilErreurs;

    animerTimer(config.tempsAffichage, () => {
        $("memoire-suite-affichage").style.display = "none";
        $("memoire-suite-input").style.display     = "block";
        etatMemoire.phase = "jeu";
        activerClavierSuite();
    });
}

function genererClavierSuite(type) {
    if (type === "nombres") {
        return Array.from({length: 10}, (_, i) => i).map(n => `<button class="clavier-btn" data-val="${n}">${n}</button>`).join('');
    } else if (type === "mixte") {
        const chiffres = Array.from({length: 10}, (_, i) => i).map(n => `<button class="clavier-btn" data-val="${n}">${n}</button>`).join('');
        const symboles = BIBLIOTHEQUE.symbolesSuite.slice(0, 12).map(s => `<button class="clavier-btn" data-val="${s}">${s}</button>`).join('');
        return chiffres + symboles;
    } else {
        return BIBLIOTHEQUE.symbolesSuite.slice(0, 12).map(s => `<button class="clavier-btn" data-val="${s}">${s}</button>`).join('');
    }
}

function activerClavierSuite() {
    const reponseDiv = $("suite-reponse");

    document.querySelectorAll(".clavier-btn").forEach(btn => {
        btn.onclick = () => {
            etatMemoire.donnees.reponse.push(btn.dataset.val);
            const item = document.createElement("div");
            item.className   = "suite-item";
            item.textContent = btn.dataset.val;
            reponseDiv.appendChild(item);
        };
    });

    $("btn-effacer").onclick       = () => { etatMemoire.donnees.reponse = []; reponseDiv.innerHTML = ""; };
    $("btn-valider-suite").onclick = () => validerSuite();
}

function validerSuite() {
    const { suite, reponse } = etatMemoire.donnees;
    const norm = reponse.map(r => isNaN(r) ? r : parseInt(r));
    let erreurs = 0;
    for (let i = 0; i < suite.length; i++) { if (suite[i] !== norm[i]) erreurs++; }
    etatMemoire.donnees.erreurs = erreurs;
    if (erreurs === 0) afficherResultat(true, "Parfait ! Suite correcte !");
    else afficherResultat(false, `La bonne suite était : ${suite.join(' ')}`);
}

// ============================================
// 🎯 DÉFI 3: RETIENS LES COULEURS
// ============================================

function genererDefiCouleurs(config) {
    return Array.from({length: config.sequence}, () =>
        BIBLIOTHEQUE.couleurs[Math.floor(Math.random() * BIBLIOTHEQUE.couleurs.length)]
    );
}

function afficherDefiCouleurs(config) {
    const couleurs  = genererDefiCouleurs(config);
    const container = $("memoire");

    container.innerHTML = `
        <header class="game-header">
            <button id="btn-retour-memoire" class="btn-retour">⬅️</button>
            <h2>🎨 Retiens les couleurs</h2>
        </header>

        <div class="memoire-couleurs-display">
            <div id="couleur-active" class="couleur-active"></div>
        </div>

        <div id="memoire-couleurs-input" class="memoire-couleurs-input" style="display:none;">
            <p class="instruction">Reconstitue la séquence de couleurs :</p>
            <div class="couleurs-reponse" id="couleurs-reponse"></div>
            <div class="couleurs-palette">
                ${BIBLIOTHEQUE.couleurs.map(c => `
                    <button class="couleur-btn" data-nom="${c.nom}" style="background:${c.hex};" title="${c.nom}"></button>
                `).join('')}
            </div>
            <div class="suite-actions">
                <button id="btn-effacer-couleurs" class="btn-secondary">🗑️ Effacer</button>
                <button id="btn-valider-couleurs" class="btn-primary">✅ Valider</button>
            </div>
        </div>
    `;

    etatMemoire.donnees = { couleurs, reponse: [], indexActuel: 0, erreurs: 0, tailleSequence: config.sequence, seuilErreurs: config.seuilErreurs };
    etatMemoire.seuilErreurs = config.seuilErreurs;

    animerSequenceCouleurs(couleurs, config.vitesse, () => {
        $("memoire-couleurs-input").style.display = "block";
        etatMemoire.phase = "jeu";
        activerPaletteCouleurs();
    });
}

function animerSequenceCouleurs(couleurs, vitesse, callback) {
    let index = 0;
    const display = $("couleur-active");

    function montrerCouleur() {
        if (index >= couleurs.length) {
            display.style.background = "transparent";
            display.textContent      = "";
            callback();
            return;
        }
        const couleur = couleurs[index];
        display.style.background = "transparent";
        display.textContent = "";
        setTimeout(() => {
            display.style.background = couleur.hex;
            display.textContent      = couleur.nom;
            index++;
            setTimeout(montrerCouleur, vitesse);
        }, 80);
    }
    montrerCouleur();
}

function activerPaletteCouleurs() {
    const reponseDiv = $("couleurs-reponse");

    document.querySelectorAll(".couleur-btn").forEach(btn => {
        btn.onclick = () => {
            const couleur = BIBLIOTHEQUE.couleurs.find(c => c.nom === btn.dataset.nom);
            etatMemoire.donnees.reponse.push(couleur);
            const item = document.createElement("div");
            item.className        = "couleur-item";
            item.style.background = couleur.hex;
            item.textContent      = couleur.nom;
            reponseDiv.appendChild(item);
        };
    });

    $("btn-effacer-couleurs").onclick = () => { etatMemoire.donnees.reponse = []; reponseDiv.innerHTML = ""; };
    $("btn-valider-couleurs").onclick = () => validerCouleurs();
}

function validerCouleurs() {
    const { couleurs, reponse } = etatMemoire.donnees;
    let erreurs = 0;
    for (let i = 0; i < couleurs.length; i++) {
        if (!reponse[i] || couleurs[i].nom !== reponse[i].nom) erreurs++;
    }
    etatMemoire.donnees.erreurs = erreurs;
    if (erreurs === 0) afficherResultat(true, "Excellent ! Séquence parfaite !");
    else afficherResultat(false, `La bonne séquence était : ${couleurs.map(c => c.nom).join(' → ')}`);
}

// ============================================
// 🎯 DÉFI 4: MÉMORISE LES SYMBOLES
// ============================================

function genererDefiSymboles(config) {
    const { symboles, grille } = config;
    const total               = grille * grille;
    const symbolesDisponibles = [...BIBLIOTHEQUE.symbolesGrille];
    const symbolesChoisis     = [];
    const positions           = [];

    for (let i = 0; i < symboles; i++) {
        const idx = Math.floor(Math.random() * symbolesDisponibles.length);
        symbolesChoisis.push(symbolesDisponibles.splice(idx, 1)[0]);
    }
    while (positions.length < symboles) {
        const pos = Math.floor(Math.random() * total);
        if (!positions.find(p => p.position === pos)) {
            positions.push({ position: pos, symbole: symbolesChoisis[positions.length] });
        }
    }
    return { positions, grille, total };
}

function afficherDefiSymboles(config) {
    const donnees   = genererDefiSymboles(config);
    const container = $("memoire");

    container.innerHTML = `
        <header class="game-header">
            <button id="btn-retour-memoire" class="btn-retour">⬅️</button>
            <h2>✨ Mémorise les symboles</h2>
        </header>

        <div class="memoire-timer">
            <div class="timer-bar" id="memoire-timer-bar"></div>
        </div>

        <div class="memoire-symboles-grid" style="grid-template-columns: repeat(${donnees.grille}, 1fr);">
            ${Array.from({length: donnees.total}, (_, i) => {
                const pos = donnees.positions.find(p => p.position === i);
                return `<div class="symbole-case" data-index="${i}">${pos ? `<span class="symbole-display">${pos.symbole}</span>` : ''}</div>`;
            }).join('')}
        </div>

        <div id="memoire-symboles-input" class="memoire-symboles-input" style="display:none;">
            <p class="instruction">Replace les symboles aux bonnes positions :</p>
            <div class="symboles-disponibles">
                ${donnees.positions.map(p => `
                    <div class="symbole-draggable" draggable="true" data-symbole="${p.symbole}">${p.symbole}</div>
                `).join('')}
            </div>
        </div>
    `;

    etatMemoire.donnees = { positions: donnees.positions, reponse: [], grille: donnees.grille, erreurs: 0, tailleSequence: config.symboles, seuilErreurs: config.seuilErreurs };
    etatMemoire.seuilErreurs = config.seuilErreurs;

    animerTimer(config.tempsAffichage, () => {
        document.querySelectorAll(".symbole-display").forEach(s => s.style.opacity = "0");
        $("memoire-symboles-input").style.display = "block";
        etatMemoire.phase = "jeu";
        activerDragDropSymboles();
    });
}

function activerDragDropSymboles() {
    let symboleEnCours = null;

    function activerDragSur(el) {
        el.ondragstart = (e) => { symboleEnCours = e.target.dataset.symbole; e.target.style.opacity = "0.5"; };
        el.ondragend   = (e) => { e.target.style.opacity = "1"; };
    }

    document.querySelectorAll(".symbole-draggable").forEach(activerDragSur);

    document.querySelectorAll(".symbole-case").forEach(caseEl => {
        caseEl.ondragover  = (e) => { e.preventDefault(); caseEl.classList.add("hover"); };
        caseEl.ondragleave = ()  => { caseEl.classList.remove("hover"); };

        caseEl.ondrop = (e) => {
            e.preventDefault();
            caseEl.classList.remove("hover");
            if (!symboleEnCours) return;

            const ancien = caseEl.querySelector(".symbole-place");
            if (ancien) {
                const as = ancien.textContent;
                const liste = document.querySelector(".symboles-disponibles");
                const r = document.createElement("div");
                r.className = "symbole-draggable"; r.draggable = true; r.dataset.symbole = as; r.textContent = as;
                liste.appendChild(r); activerDragSur(r); ancien.remove();
            }

            const span = document.createElement("span");
            span.className = "symbole-place"; span.textContent = symboleEnCours;
            caseEl.appendChild(span);

            const el = document.querySelector(`.symbole-draggable[data-symbole="${symboleEnCours}"]`);
            if (el) el.remove();

            verifierSymbolesTermines();
        };

        caseEl.onclick = () => {
            const ancien = caseEl.querySelector(".symbole-place");
            if (!ancien) return;
            const as    = ancien.textContent;
            const liste = document.querySelector(".symboles-disponibles");
            const r     = document.createElement("div");
            r.className = "symbole-draggable"; r.draggable = true; r.dataset.symbole = as; r.textContent = as;
            liste.appendChild(r); activerDragSur(r); ancien.remove();
        };
    });
}

function verifierSymbolesTermines() {
    if (document.querySelectorAll(".symbole-place").length === etatMemoire.donnees.positions.length) {
        setTimeout(() => validerSymboles(), 500);
    }
}

function validerSymboles() {
    const { positions } = etatMemoire.donnees;
    let erreurs = 0;

    document.querySelectorAll(".symbole-case").forEach((caseEl, index) => {
        const place   = caseEl.querySelector(".symbole-place");
        const attendu = positions.find(p => p.position === index);

        if (place && attendu) {
            if (place.textContent === attendu.symbole) caseEl.classList.add("correct");
            else { caseEl.classList.add("incorrect"); erreurs++; }
        } else if (attendu || place) { erreurs++; }
    });

    etatMemoire.donnees.erreurs = erreurs;
    if (erreurs === 0) afficherResultat(true, "Parfait ! Tous les symboles bien placés !");
    else afficherResultat(false, `${erreurs} symbole(s) mal placé(s)`);
}

// ============================================
// ⏱️ COMPTE À REBOURS
// ============================================

function afficherCompteARebours(callback) {
    const container = $("memoire");
    const defiInfo  = DEFIS_CONFIG[etatMemoire.defiActuel];

    container.innerHTML = `
        <div class="compte-a-rebours-overlay">
            <div class="compte-a-rebours-content">
                <div class="defi-info-preview">
                    <span class="defi-icon-large">${defiInfo.icon}</span>
                    <h3>${defiInfo.nom}</h3>
                </div>
                <div class="countdown-number">3</div>
                <p class="countdown-text">Prépare-toi...</p>
            </div>
        </div>
    `;

    let compteur   = 3;
    const numberEl = document.querySelector(".countdown-number");
    const textEl   = document.querySelector(".countdown-text");
    const messages = { 3: "Prépare-toi...", 2: "Concentre-toi...", 1: "C'est parti !", 0: "GO !" };

    const interval = setInterval(() => {
        compteur--;
        if (compteur >= 0) {
            numberEl.textContent = compteur;
            textEl.textContent   = messages[compteur];
            numberEl.classList.add("pulse");
            setTimeout(() => numberEl.classList.remove("pulse"), 500);
            if (compteur === 0) {
                numberEl.classList.add("go");
                setTimeout(() => { clearInterval(interval); callback(); }, 800);
            }
        }
    }, 1000);
}

// ============================================
// 🎮 GESTION DU JEU
// ============================================

function lancerDefi(typeDefi) {
    etatMemoire.defiActuel = typeDefi;
    etatMemoire.tentatives++;
    etatMemoire.phase = "preparation";

    afficherCompteARebours(() => {
        etatMemoire.phase = "affichage";
        const config = DEFIS_CONFIG[typeDefi].difficultes[etatMemoire.difficulte];
        switch (typeDefi) {
            case "paires":   afficherDefiPaires(config);   break;
            case "suite":    afficherDefiSuite(config);    break;
            case "couleurs": afficherDefiCouleurs(config); break;
            case "symboles": afficherDefiSymboles(config); break;
        }
        attacherEvenements();
    });
}

// ============================================
// 🎯 Calcul du score
// ============================================

function calculerScore() {
    const pointsBase   = { facile: 2, moyen: 3, difficile: 4 };
    const base         = pointsBase[etatMemoire.difficulte] || 3;
    const erreurs      = etatMemoire.donnees.erreurs || 0;
    const seuilErreurs = etatMemoire.seuilErreurs    || 2;

    if (erreurs > seuilErreurs) {
        console.log(`[MÉMOIRE] Trop d'erreurs : ${erreurs} > ${seuilErreurs} → 0 point`);
        return 0;
    }
    return erreurs === 0 ? base : 1;
}

// ============================================
// 🎯 Mise à jour du score + scoreboard
// ============================================

function majScorePartiel(points) {
    etatMemoire.score += points;
    if (GameState.mode === "solo" && GameState.joueurs.length > 0) {
        ajouterPoints(GameState.joueurs[0], points);
    } else if (GameState.mode === "team" && GameState.equipes.length > 0) {
        ajouterPoints(GameState.equipes[0].nom, points);
    }
    afficherScoreboard();
}

// ============================================
// 🧠 Affichage du résultat
// ============================================

function afficherResultat(succes, message) {
    const container  = $("memoire");
    const scoreGagne = calculerScore();

    if (scoreGagne > 0 && etatMemoire.joueurActif) {
        ajouterPoints(etatMemoire.joueurActif, scoreGagne);
        console.log(`[MÉMOIRE] +${scoreGagne} points pour ${etatMemoire.joueurActif}`);
    }

    const erreurs      = etatMemoire.donnees.erreurs;
    const seuilErreurs = etatMemoire.seuilErreurs;

    let scoreDetail;
    if (erreurs === 0)             scoreDetail = `✅ Score parfait : ${scoreGagne} points !`;
    else if (erreurs > seuilErreurs) scoreDetail = `❌ Trop d'erreurs (${erreurs} > ${seuilErreurs}) : 0 point`;
    else if (scoreGagne > 0)       scoreDetail = `⚠️ Quelques erreurs : ${scoreGagne} point(s)`;
    else                            scoreDetail = `❌ 0 point`;

    container.innerHTML = `
        <header class="game-header">
            <h2>🧠 Résultat</h2>
        </header>

        <div class="memoire-resultat ${succes ? 'succes' : 'echec'}">
            <div class="resultat-icon">${succes ? '✅' : '❌'}</div>
            <h3 class="resultat-message">${message}</h3>
            <p class="resultat-joueur">🎯 ${etatMemoire.joueurActif}</p>
            <p class="resultat-erreurs">Erreur(s) : ${erreurs} / Seuil : ${seuilErreurs}</p>
            <p class="resultat-score">${scoreDetail}</p>
        </div>

        <div class="resultat-actions">
            <button id="btn-rejouer" class="btn-primary">🔄 Rejouer ce défi</button>
            <button id="btn-menu-defis" class="btn-secondary">🏠 Menu des défis</button>
        </div>
    `;

    $("btn-rejouer").onclick    = () => lancerDefi(etatMemoire.defiActuel);
    $("btn-menu-defis").onclick = () => { afficherMenuDefis(); attacherEvenements(); };

    attacherEvenements();
}

// ============================================
// 🛠️ UTILITAIRES
// ============================================

function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function animerTimer(duree, callback) {
    const bar = $("memoire-timer-bar");
    if (!bar) return callback();

    let temps = 0;
    const increment = 50;

    const intervalle = setInterval(() => {
        temps += increment;
        bar.style.width = ((temps / duree) * 100) + "%";
        if (temps >= duree) { clearInterval(intervalle); callback(); }
    }, increment);

    etatMemoire.timer = intervalle;
}

function nettoyerTimer() {
    if (etatMemoire.timer) { clearInterval(etatMemoire.timer); etatMemoire.timer = null; }
}