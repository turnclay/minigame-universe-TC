/**
 * ============================================
 * 🔴 PUISSANCE 4
 * ============================================
 * Jeu de stratégie classique avec gravité
 * Version: 1.0
 */

import { GameState } from "../core/state.js";
import { modifierScore } from "../modules/scoreboard.js";
import { socket } from "../core/socket.js";

// ── Module hôte (chargé dynamiquement) ──
let _publierEtat    = () => {};
let _publierScores  = () => {};
let _publierGrille  = () => {};
let _crediterPoints = () => {};
let _viderCoup      = () => {};
let _stopEcouteP4   = null;
let _hoteActifP4    = false;
let _wsCoupHandlerP4   = null;
let _wsResyncHandlerP4 = null;

async function _chargerModuleHoteP4() {
    try {
        const m = await import('../modules/puissance4_hote.js');
        _publierEtat    = m.publierEtat;
        _publierScores  = m.publierScores;
        _publierGrille  = m.publierEtatGrille;
        _crediterPoints = m.crediterPoints;
        _viderCoup      = m.viderCoupInvite;
        console.log('[P4] ✅ Module hôte chargé');
        return m;
    } catch (e) {
        console.warn('[P4] ⚠️ puissance4_hote.js introuvable', e.message);
        return null;
    }
}

function _publierEtatGrilleP4() {
    if (!_hoteActifP4) return;
    socket.send('HOST_ACTION', {
        action: 'puissance4:state',
        data: {
            grille:         grille,
            joueurActuel:   joueurActuel,
            joueurs:        joueurs.map(nom => ({ nom, emoji: couleurs[nom] })),
            couleurs:       couleurs,
            partieTerminee: partieTerminee,
            gagnant:        _gagnantP4  || null,
            matchNul:       _matchNulP4 || false
        }
    });
}

let _gagnantP4  = null;
let _matchNulP4 = false;

// ============================================
// 🎯 CONSTANTES
// ============================================

const ROWS = 6;
const COLS = 7;
const COLORS = ['🔴', '🟡', '🔵'];

// ============================================
// 🎮 VARIABLES D'ÉTAT
// ============================================

let grille = [];
let joueurActuel = 0;
let joueurs = [];
let partieTerminee = false;
let couleurs = {};
let _animationEnCours = false;  // verrou anti-double-clic pendant la chute
let _pseudoHoteP4     = null;   // nom du joueur hôte (joueurs[0])

// ============================================
// 🎨 CRÉATION DE LA GRILLE
// ============================================

function creerGrille() {
    const grilleElement = document.getElementById("puissance4-grille");
    if (!grilleElement) return;

    grilleElement.innerHTML = "";
    grille = Array(ROWS).fill(null).map(() => Array(COLS).fill(null));

    // Créer les colonnes cliquables
    for (let col = 0; col < COLS; col++) {
        const colonne = document.createElement("div");
        colonne.className = "p4-colonne";
        colonne.dataset.col = col;

        // Créer les cellules de la colonne
        for (let row = 0; row < ROWS; row++) {
            const cellule = document.createElement("div");
            cellule.className = "p4-cellule";
            cellule.dataset.row = row;
            cellule.dataset.col = col;
            colonne.appendChild(cellule);
        }

        // Événement de clic sur la colonne
        colonne.addEventListener("click", () => jouerColonne(col));

        // Effet hover
        colonne.addEventListener("mouseenter", () => {
            if (!partieTerminee) {
                colonne.classList.add("p4-colonne-hover");
            }
        });

        colonne.addEventListener("mouseleave", () => {
            colonne.classList.remove("p4-colonne-hover");
        });

        grilleElement.appendChild(colonne);
    }
}

// ============================================
// 🎲 LOGIQUE DE JEU
// ============================================

function jouerColonne(col, fromInvite = false) {
    if (partieTerminee || _animationEnCours) return;
    // Clics UI : l'hôte ne peut jouer que quand c'est son tour
    if (!fromInvite && _hoteActifP4 && joueurs[joueurActuel] !== _pseudoHoteP4) {
        console.log('[P4] Clic UI ignoré — tour de ' + joueurs[joueurActuel] + ', pas de l\'hôte');
        return;
    }
    // Coup invité : vérifier que c'est bien son tour
    if (fromInvite && _hoteActifP4) {
        // déjà validé par _recevoirCoupInviteP4 — on passe
    }

    // Trouver la première case vide en partant du bas (gravité)
    let row = -1;
    for (let r = ROWS - 1; r >= 0; r--) {
        if (grille[r][col] === null) {
            row = r;
            break;
        }
    }

    // Colonne pleine
    if (row === -1) {
        animerColonnePleine(col);
        return;
    }

    // Poser le verrou : on bloque tout nouveau clic pendant la chute
    _animationEnCours = true;

    // Placer le jeton
    grille[row][col] = joueurActuel;
    const cellule = document.querySelector(
        `.p4-cellule[data-row="${row}"][data-col="${col}"]`
    );

    if (cellule) {
        // Animation de chute
        animerChute(cellule, row, couleurs[joueurs[joueurActuel]]);
    }

    // Vérifier la victoire
    if (verifierVictoire(row, col)) {
        setTimeout(() => {
            _animationEnCours = false;
            afficherVictoire(joueurs[joueurActuel]);
        }, 600);
        return;
    }

    // Vérifier match nul
    if (grilleComplete()) {
        setTimeout(() => {
            _animationEnCours = false;
            afficherMatchNul();
        }, 600);
        return;
    }

    // Joueur suivant — lever le verrou après la chute
    setTimeout(() => {
        _animationEnCours = false;
        joueurActuel = (joueurActuel + 1) % joueurs.length;
        mettreAJourStatus();
        // Publier le nouvel état pour les invités
        _publierEtatGrilleP4();
    }, 620);
}

// ============================================
// 🎬 ANIMATIONS
// ============================================

function animerChute(cellule, rowFinale, couleur) {
    // Créer un jeton qui tombe
    const jeton = document.createElement("div");
    jeton.className = "p4-jeton p4-jeton-chute";
    jeton.textContent = couleur;
    cellule.appendChild(jeton);

    // Déclencher l'animation
    setTimeout(() => {
        jeton.classList.remove("p4-jeton-chute");
        jeton.classList.add("p4-jeton-pose");
    }, 10);
}

function animerColonnePleine(col) {
    const colonne = document.querySelector(`.p4-colonne[data-col="${col}"]`);
    if (colonne) {
        colonne.classList.add("p4-colonne-pleine");
        setTimeout(() => {
            colonne.classList.remove("p4-colonne-pleine");
        }, 500);
    }
}

function animerVictoire(cellules) {
    cellules.forEach(({row, col}) => {
        const cellule = document.querySelector(
            `.p4-cellule[data-row="${row}"][data-col="${col}"]`
        );
        if (cellule) {
            const jeton = cellule.querySelector(".p4-jeton");
            if (jeton) {
                jeton.classList.add("p4-jeton-gagnant");
            }
        }
    });
}

// ============================================
// 🏆 VÉRIFICATION DE VICTOIRE
// ============================================

function verifierVictoire(row, col) {
    const directions = [
        {dr: 0, dc: 1},   // Horizontal
        {dr: 1, dc: 0},   // Vertical
        {dr: 1, dc: 1},   // Diagonal \
        {dr: 1, dc: -1}   // Diagonal /
    ];

    for (const {dr, dc} of directions) {
        const alignes = compterAlignes(row, col, dr, dc);
        if (alignes.length >= 4) {
            animerVictoire(alignes);
            return true;
        }
    }

    return false;
}

function compterAlignes(row, col, dr, dc) {
    const joueur = grille[row][col];
    const alignes = [{row, col}];

    // Vérifier dans une direction
    for (let i = 1; i < 4; i++) {
        const r = row + dr * i;
        const c = col + dc * i;
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) break;
        if (grille[r][c] !== joueur) break;
        alignes.push({row: r, col: c});
    }

    // Vérifier dans l'autre direction
    for (let i = 1; i < 4; i++) {
        const r = row - dr * i;
        const c = col - dc * i;
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) break;
        if (grille[r][c] !== joueur) break;
        alignes.push({row: r, col: c});
    }

    return alignes;
}

function grilleComplete() {
    return grille[0].every(cell => cell !== null);
}

// ============================================
// 📊 AFFICHAGE
// ============================================

function mettreAJourStatus() {
    const status = document.getElementById("puissance4-status");
    if (status && !partieTerminee) {
        const nomJoueur = joueurs[joueurActuel];
        const couleur   = couleurs[nomJoueur];
        const estTourHote = !_hoteActifP4 || nomJoueur === _pseudoHoteP4;
        const suffixe     = estTourHote ? '' : ' ⏳ (en attente…)';
        status.textContent = `Au tour de : ${couleur} ${nomJoueur}${suffixe}`;
        status.className   = "puissance4-status";
    }
    // Griser les colonnes quand c'est le tour d'un invité
    const grilleEl = document.getElementById('puissance4-grille');
    if (grilleEl && _hoteActifP4) {
        const estTourHote = joueurs[joueurActuel] === _pseudoHoteP4;
        grilleEl.style.opacity = estTourHote ? '1' : '0.45';
        grilleEl.style.pointerEvents = estTourHote ? '' : 'none';
    }
}

function afficherVictoire(gagnant, cellulesGagnantes = []) {
    partieTerminee = true;
    const status = document.getElementById("puissance4-status");

    // Mise à jour du texte de victoire
    if (status) {
        const couleur = couleurs[gagnant];
        status.textContent = `🎉 ${gagnant} a gagné ! ${couleur}`;
        status.className = "puissance4-status puissance4-victoire";
    }
    // Réactiver la grille (fin de partie affichée à tous)
    const grilleEnd = document.getElementById("puissance4-grille");
    if (grilleEnd) { grilleEnd.style.opacity = "1"; grilleEnd.style.pointerEvents = ""; }

    // 🎨 Appliquer la classe d’animation selon la couleur du gagnant
    const classeWin = couleurs[gagnant] === "jaune" ? "win-yellow" : "win-red";

    cellulesGagnantes.forEach(cell => {
        if (cell) cell.classList.add(classeWin);
    });

    // Publier la fin de partie
    _gagnantP4 = gagnant; _matchNulP4 = false;
    _publierEtatGrilleP4();

    // Ajouter des points au gagnant
    if (_hoteActifP4) {
        _crediterPoints([gagnant], 4);
    } else if (GameState.mode === "solo") {
        modifierScore(gagnant, 4);
    } else if (GameState.mode === "team") {
        const equipeGagnante = GameState.equipes.find(eq =>
            eq.joueurs.includes(gagnant)
        );
        if (equipeGagnante) {
            modifierScore(equipeGagnante.nom, 10);
        }
    }

    // Afficher le bouton rejouer
    const btnRejouer = document.getElementById("puissance4-rejouer");
    if (btnRejouer) {
        btnRejouer.style.display = "block";
    }
}

function afficherMatchNul() {
    partieTerminee = true;
    const status = document.getElementById("puissance4-status");

    if (status) {
        status.textContent = "🤝 Match nul !";
        status.className = "puissance4-status puissance4-nul";
    }

    _matchNulP4 = true; _gagnantP4 = null;
    _publierEtatGrilleP4();

    const btnRejouer = document.getElementById("puissance4-rejouer");
    if (btnRejouer) {
        btnRejouer.style.display = "block";
    }
}

// ============================================
// 🔄 NOUVELLE PARTIE
// ============================================

function nouvellePartie() {
    partieTerminee = false;
    // Premier joueur aléatoire : peut être n'importe quel joueur
    joueurActuel = joueurs.length > 0 ? Math.floor(Math.random() * joueurs.length) : 0;
    _animationEnCours = false;
    _gagnantP4 = null;
    _matchNulP4 = false;
    // Remettre le pseudo hôte si les joueurs sont déjà chargés
    if (joueurs.length > 0) _pseudoHoteP4 = joueurs[0];
    creerGrille();
    mettreAJourStatus();
    // Publier l'état initial pour les invités
    _publierEtatGrilleP4();

    const btnRejouer = document.getElementById("puissance4-rejouer");
    if (btnRejouer) {
        btnRejouer.style.display = "none";
    }
}

// ============================================
// 🚀 INITIALISATION
// ============================================

async function initialiserPuissance4() {
    console.log("[PUISSANCE4] Initialisation");

    // Récupérer les joueurs
    if (GameState.mode === "solo") {
        joueurs = [...GameState.joueurs];
    } else if (GameState.mode === "team") {
        joueurs = GameState.equipes.map(eq => eq.nom);
    }

    // Limiter à 3 joueurs maximum
    if (joueurs.length > 3) {
        joueurs = joueurs.slice(0, 3);
    }

    // Minimum 2 joueurs
    if (joueurs.length < 2) {
        alert("Il faut au moins 2 joueurs pour jouer à Puissance 4.");
        window.afficherAccueilJeux();
        return;
    }

    // Assigner des couleurs + mémoriser le pseudo hôte
    couleurs = {};
    joueurs.forEach((joueur, index) => {
        couleurs[joueur] = COLORS[index % COLORS.length];
    });
    _pseudoHoteP4 = joueurs[0]; // l'hôte est toujours le premier joueur

    // Initialiser le bouton rejouer
    const btnRejouer = document.getElementById("puissance4-rejouer");
    if (btnRejouer) {
        btnRejouer.style.display = "none";
        btnRejouer.onclick = nouvellePartie;
    }

    console.log("[PUISSANCE4] Joueurs:", joueurs);
    console.log("[PUISSANCE4] Couleurs:", couleurs);

    // Charger le module hôte (pour crediterPoints / scores globaux)
    await _chargerModuleHoteP4();

    // Transport WS : l'hôte garde la logique, diffuse l'état complet
    // (puissance4:state) et reçoit les coups (puissance4:move). Le serveur
    // relaie génériquement HOST_ACTION → invités et PLAYER_ACTION → hôte.
    if (_publierScores) { try { _publierScores(); } catch {} }

    if (!_wsCoupHandlerP4) {
        _wsCoupHandlerP4 = (payload) => {
            if (!payload || payload.action !== 'puissance4:move') return;
            _recevoirCoupInviteP4({ pseudo: payload.pseudo, col: payload.data?.col });
        };
    }
    if (!_wsResyncHandlerP4) {
        _wsResyncHandlerP4 = () => _publierEtatGrilleP4();
    }
    socket.off('PLAYER_ACTION', _wsCoupHandlerP4);
    socket.on('PLAYER_ACTION', _wsCoupHandlerP4);
    socket.off('PLAYER_JOINED', _wsResyncHandlerP4);
    socket.on('PLAYER_JOINED', _wsResyncHandlerP4);
    socket.off('PLAYER_RECONNECTED', _wsResyncHandlerP4);
    socket.on('PLAYER_RECONNECTED', _wsResyncHandlerP4);
    _hoteActifP4 = true;

    // Démarrer la partie
    nouvellePartie();
}

function _recevoirCoupInviteP4(coup) {
    if (partieTerminee) return;
    const joueurCourant = joueurs[joueurActuel];
    if (coup.pseudo !== joueurCourant) {
        console.log('[P4] Coup ignoré — pas le tour de', coup.pseudo, '(attendu:', joueurCourant, ')');
        return;
    }
    _viderCoup();
    console.log('[P4] Coup invité accepté col:', coup.col);
    jouerColonne(coup.col, true); // fromInvite=true → bypass garde UI
}

// ============================================
// 📤 EXPORTS
// ============================================

window.initialiserPuissance4 = initialiserPuissance4;

export { initialiserPuissance4 };