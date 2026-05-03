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

// ── Module hôte (chargé dynamiquement si partie multijoueur) ─
let _publierEtat   = () => {};
let _publierScores = () => {};
let _publierDefi   = () => {};
let _publierPhase  = () => {};
let _viderReponses = () => {};
let _crediterPts   = (pseudo, delta) => { ajouterPoints(pseudo, delta); };
let _stopEcoute    = null;
let _hoteActif     = false;
let _scoresSession = {};           // { pseudo: pts } — session mémoire en cours
let _resultatsRecus = {};          // { pseudo: { erreurs, score } } — réponses invités
let _nbReponsesRecues = 0;         // combien d'invités ont répondu

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
            moyen:     { paires: 6, tempsAffichage: 7000, gridSize: "4x3", seuilErreurs: 2 },
            difficile: { paires: 8, tempsAffichage: 10000, gridSize: "4x4", seuilErreurs: 3 }
        }
    },
    suite: {
        nom: "Retiens la suite",
        icon: "🔢",
        description: "Mémorise la séquence de nombres ou symboles",
        difficultes: {
            facile:    { longueur: 7, tempsAffichage: 4500, type: "nombres",  seuilErreurs: 0 },
            moyen:     { longueur: 5, tempsAffichage: 5000, type: "symboles", seuilErreurs: 1 },
            difficile: { longueur: 7, tempsAffichage: 8000, type: "mixte",    seuilErreurs: 2 }
        }
    },
    couleurs: {
        nom: "Retiens les couleurs",
        icon: "🎨",
        description: "Mémorise l'ordre des couleurs affichées",
        difficultes: {
            facile:    { sequence: 4, tempsAffichage: 4000, vitesse: 1000, seuilErreurs: 1 },
            moyen:     { sequence: 5, tempsAffichage: 4500, vitesse: 1500, seuilErreurs: 2 },
            difficile: { sequence: 7, tempsAffichage: 5000, vitesse: 2000, seuilErreurs: 3 }
        }
    },
    symboles: {
        nom: "Mémorise les symboles",
        icon: "✨",
        description: "Retiens la position exacte de chaque symbole",
        difficultes: {
            facile:    { symboles: 4, grille: 3, tempsAffichage: 6000,  seuilErreurs: 1 },
            moyen:     { symboles: 6, grille: 4, tempsAffichage: 9000,  seuilErreurs: 2 },
            difficile: { symboles: 7, grille: 5, tempsAffichage: 12000, seuilErreurs: 3 }
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

export async function initialiserMemoire() {
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

    await _chargerModuleHote();
    afficherMenuDefis();
    attacherEvenements();
}

window.initialiserMemoire = initialiserMemoire;

// ── Chargement dynamique de memoire_hote.js ──────────────────
async function _chargerModuleHote() {
    try {
        const m = await import('../modules/memoire_hote.js');
        _publierEtat   = m.publierEtat;
        _publierScores = m.publierScores;
        _publierDefi   = m.publierDefi;
        _publierPhase  = m.publierPhase;
        _viderReponses = m.viderReponses;
        _crediterPts   = m.crediterPoints;
        _hoteActif     = true;
        _publierEtat('en_cours');
        if (_stopEcoute) { _stopEcoute(); _stopEcoute = null; }
        _stopEcoute = m.ecouterReponsesInvites(_onReponseInvite);
        console.log('[MÉMOIRE] Module hôte chargé ✅');
    } catch (e) {
        console.warn('[MÉMOIRE] memoire_hote.js indisponible (mode solo):', e.message);
    }
}

// ── Réception d'une réponse d'un invité ──────────────────────
function _onReponseInvite({ pseudo, erreurs, score }) {
    if (_resultatsRecus[pseudo]) return; // doublon ignoré
    _resultatsRecus[pseudo] = { erreurs, score };
    _nbReponsesRecues++;
    console.log(`[MÉMOIRE] Réponse de ${pseudo} — ${erreurs} erreur(s), ${score} pt(s)`);

    // Créditer les points de l'invité
    if (score > 0) {
        _crediterPts(pseudo, score, null);
        _scoresSession[pseudo] = (_scoresSession[pseudo] || 0) + score;
        _publierScores(_scoresSession);
    }
    // Rafraîchir le tableau de suivi
    _majSuiviHote();
    // Tous les invités ont répondu ?
    const nbInvites = _nbInvites();
    if (_nbReponsesRecues >= nbInvites) {
        console.log('[MÉMOIRE] Tous les invités ont répondu — phase résultats');
        _publierPhase('resultats');
    }
}

// Nb d'invités = tous les joueurs sauf l'hôte (index 0)
function _nbInvites() {
    const tous = [
        ...(GameState.joueurs || []),
        ...((GameState.equipes || []).map(e => e.nom))
    ];
    return Math.max(0, tous.length - 1);
}

// ── Tableau de suivi temps réel (panneau hôte) ───────────────
function _majSuiviHote() {
    const el = document.getElementById('mem-suivi-hote');
    if (!el) return;
    const tous = [
        ...(GameState.joueurs || []),
        ...((GameState.equipes || []).map(e => e.nom))
    ].filter((p, i) => i > 0); // exclure l'hôte (index 0)

    if (tous.length === 0) {
        el.innerHTML = '<p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">Aucun invité connecté</p>';
        return;
    }

    el.innerHTML = tous.map(p => {
        const res = _resultatsRecus[p];
        const pts = _scoresSession[p] || 0;
        let statut, couleur;
        if (!res) {
            statut = '⏳ En cours…'; couleur = 'rgba(255,255,255,.5)';
        } else if (res.erreurs === 0) {
            statut = `✅ Parfait — ${res.score} pt(s)`; couleur = '#86efac';
        } else if (res.score > 0) {
            statut = `⚠️ ${res.erreurs} erreur(s) — ${res.score} pt(s)`; couleur = '#fbbf24';
        } else {
            statut = `❌ Trop d'erreurs — 0 pt`; couleur = '#fca5a5';
        }
        return `<div style="display:flex;justify-content:space-between;align-items:center;
            padding:7px 10px;background:rgba(255,255,255,.04);border-radius:8px;margin-bottom:4px;">
            <span style="font-weight:700;font-size:.88rem;">${p}</span>
            <span style="font-size:.82rem;color:${couleur};">${statut}</span>
            <span style="color:#00d4ff;font-weight:700;font-size:.82rem;min-width:38px;text-align:right;">${pts} pts</span>
        </div>`;
    }).join('');
}

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

    // Panneau suivi invités (visible seulement si hôte actif)
    if (_hoteActif) {
        const container = document.getElementById('memoire');
        if (container) {
            const suivi = document.createElement('div');
            suivi.style.cssText = 'margin-top:16px;padding:14px;background:rgba(0,212,255,.05);border:1px solid rgba(0,212,255,.2);border-radius:14px;';
            suivi.innerHTML = `<p style="font-size:.82rem;font-weight:700;color:#00d4ff;margin-bottom:8px;">📊 Suivi des joueurs</p>
                <div id="mem-suivi-hote"><p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">En attente du défi…</p></div>`;
            container.appendChild(suivi);
        }
        // Publier phase menu
        _publierDefi({ typeDefi: null, difficulte: etatMemoire.difficulte, donnees: null, phase: 'menu', nbAttendu: _nbInvites() });
    }
    // Reset compteurs pour ce nouveau défi
    _resultatsRecus = {};
    _nbReponsesRecues = 0;

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
    // Tooltip unique dans document.body — toujours au premier plan (z-index:9999)
    // Positionné via getBoundingClientRect → indépendant des contextes d'empilement
    let tooltip = document.getElementById("defi-tooltip-global");
    if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.id        = "defi-tooltip-global";
        tooltip.setAttribute("aria-hidden", "true");
        // Styles via CSS #defi-tooltip-global dans invite.css / style.css
        // Fallback inline si CSS non chargé
        tooltip.style.cssText =
            "position:fixed;z-index:99999;pointer-events:none;min-width:210px;max-width:260px;" +
            "background:rgba(15,10,40,0.97);border:1px solid rgba(0,212,255,0.35);" +
            "border-radius:14px;padding:14px 16px;" +
            "box-shadow:0 8px 32px rgba(0,0,0,.5),0 0 16px rgba(0,212,255,.12);" +
            "backdrop-filter:blur(10px);font-family:'Poppins',sans-serif;" +
            "opacity:0;visibility:hidden;transition:opacity .18s ease,visibility .18s ease;";
        document.body.appendChild(tooltip);
    }

    document.querySelectorAll(".memoire-defi-card").forEach(card => {
        card.addEventListener("mouseenter", () => {
            const keyDefi = card.dataset.defi;
            tooltip.innerHTML = construireTooltipDefi(keyDefi);
            tooltip.style.opacity    = "1";
            tooltip.style.visibility = "visible";

            // Positionner collé en haut à droite de la carte
            requestAnimationFrame(() => {
                const rect     = card.getBoundingClientRect();
                const tipW     = tooltip.offsetWidth;
                const tipH     = tooltip.offsetHeight;
                const margin   = 8;
                let left = rect.right + margin;
                let top  = rect.top;

                // Débord à droite → basculer à gauche
                if (left + tipW > window.innerWidth - 8) {
                    left = rect.left - tipW - margin;
                }
                // Débord en bas → remonter
                if (top + tipH > window.innerHeight - 8) {
                    top = window.innerHeight - tipH - 8;
                }
                tooltip.style.left = left + "px";
                tooltip.style.top  = top  + "px";
            });
        });

        card.addEventListener("mouseleave", (e) => {
            // Ignorer si la souris va vers un enfant de la carte (ex: bouton Jouer)
            if (e.relatedTarget && card.contains(e.relatedTarget)) return;
            tooltip.style.opacity    = "0";
            tooltip.style.visibility = "hidden";
        });
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
            // Masquer le tooltip avant de lancer (la carte va être détruite)
            const tt = document.getElementById("defi-tooltip-global");
            if (tt) { tt.style.opacity = "0"; tt.style.visibility = "hidden"; }
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
            if (_hoteActif) _publierPhase("jeu");
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
        if (_hoteActif) _publierPhase("jeu");
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
        if (_hoteActif) _publierPhase("jeu");
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
        if (_hoteActif) _publierPhase("jeu");
        activerClicSymboles();
    });
}

// ── activerClicSymboles : sélection par clic (hôte) ──────────
function activerClicSymboles() {
    let symboleSel = null;  // symbole actuellement sélectionné

    // Clic sur un symbole du panel
    document.querySelectorAll('#symboles-a-placer .symbole-a-placer').forEach(btn => {
        btn.addEventListener('click', () => {
            // Désélectionner tous
            document.querySelectorAll('#symboles-a-placer .symbole-a-placer')
                .forEach(b => b.style.boxShadow = '');
            if (symboleSel === btn.dataset.symbole) {
                symboleSel = null;
                return;
            }
            symboleSel = btn.dataset.symbole;
            btn.style.boxShadow = '0 0 0 3px var(--neon-cyan)';
        });
    });

    // Clic sur une case de la grille
    document.querySelectorAll('.memoire-symboles-grid .symbole-case').forEach(caseEl => {
        caseEl.addEventListener('click', () => {
            if (!symboleSel) return;

            // Retirer l'ancien symbole placé si présent → le remettre dans le panel
            const ancien = caseEl.querySelector('.symbole-place');
            if (ancien) {
                const as  = ancien.textContent.trim();
                const btn = document.querySelector(`#symboles-a-placer .symbole-a-placer[data-symbole="${as}"]`);
                if (btn) { btn.style.display = 'flex'; btn.style.opacity = '1'; }
                ancien.remove();
            }

            // Placer le symbole sélectionné
            const span = document.createElement('span');
            span.className   = 'symbole-place';
            span.textContent = symboleSel;
            caseEl.appendChild(span);

            // Masquer le bouton dans le panel
            const btnSel = document.querySelector(`#symboles-a-placer .symbole-a-placer[data-symbole="${symboleSel}"]`);
            if (btnSel) { btnSel.style.opacity = '0.3'; btnSel.style.pointerEvents = 'none'; }
            symboleSel = null;
            document.querySelectorAll('#symboles-a-placer .symbole-a-placer')
                .forEach(b => b.style.boxShadow = '');

            // Vérifier si tous placés
            const nbPlaces = document.querySelectorAll('.memoire-symboles-grid .symbole-place').length;
            if (nbPlaces === etatMemoire.donnees.positions.length) {
                setTimeout(() => validerSymboles(), 500);
            }
        });
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

// ============================================================
// 🔗 WRAPPERS *AvecDonnees — pour le mode multijoueur
// Identiques aux fonctions originales mais acceptent
// des données pré-générées (partagées avec les invités).
// ============================================================

function _afficherDefiPairesAvecDonnees(config, cartes) {
    const container = $("memoire");
    container.innerHTML = `
        <header class="game-header">
            <button id="btn-retour-memoire" class="btn-retour">⬅️</button>
            <h2>🃏 Retrouve les paires</h2>
        </header>
        <div class="memoire-timer"><div class="timer-bar" id="memoire-timer-bar"></div></div>
        <div class="memoire-paires-grid" style="grid-template-columns:repeat(${config.gridSize.split('x')[0]},1fr);">
            ${cartes.map((s, i) => `
                <div class="memoire-carte" data-index="${i}" data-symbole="${s}">
                    <div class="carte-front">${s}</div>
                    <div class="carte-back">?</div>
                </div>`).join('')}
        </div>
        <div class="memoire-status">Mémorise les cartes...</div>
        ${_hoteActif ? `<div style="margin-top:16px;background:rgba(0,212,255,.05);border:1px solid rgba(0,212,255,.2);border-radius:12px;padding:12px 14px;"><p style="font-size:.75rem;color:rgba(0,212,255,.8);font-weight:700;margin-bottom:6px;">📊 Invités</p><div id="mem-suivi-hote"></div></div>` : ''}
    `;
    etatMemoire.donnees = { cartes, pairesRestantes: config.paires, paireTrouvees: [], erreurs: 0, tailleSequence: config.paires, seuilErreurs: config.seuilErreurs };
    etatMemoire.seuilErreurs = config.seuilErreurs;
    setTimeout(() => {
        document.querySelectorAll(".memoire-carte").forEach(c => c.classList.add("retournee"));
        animerTimer(config.tempsAffichage, () => {
            document.querySelectorAll(".memoire-carte").forEach(c => c.classList.remove("retournee"));
            const s = document.querySelector(".memoire-status");
            if (s) s.textContent = "À toi de jouer ! (Erreurs : 0)";
            etatMemoire.phase = "jeu";
            if (_hoteActif) _publierPhase("jeu");
            activerClicCartes();
        });
    }, 500);
}

function _afficherDefiSuiteAvecDonnees(config, suite) {
    const container = $("memoire");
    container.innerHTML = `
        <header class="game-header">
            <button id="btn-retour-memoire" class="btn-retour">⬅️</button>
            <h2>🔢 Retiens la suite</h2>
        </header>
        <div class="memoire-timer"><div class="timer-bar" id="memoire-timer-bar"></div></div>
        <div id="memoire-suite-affichage" class="memoire-suite-affichage">
            ${suite.map(i => `<div class="suite-item">${i}</div>`).join('')}
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
        ${_hoteActif ? '<div style="margin-top:12px;" id="mem-suivi-wrap"><p style="font-size:.75rem;color:rgba(255,255,255,.4);text-align:center;margin-bottom:6px;">📊 Invités</p><div id="mem-suivi-hote"></div></div>' : ''}
    `;
    etatMemoire.donnees = { suite, reponse: [], erreurs: 0, tailleSequence: config.longueur, seuilErreurs: config.seuilErreurs };
    etatMemoire.seuilErreurs = config.seuilErreurs;
    animerTimer(config.tempsAffichage, () => {
        $("memoire-suite-affichage").style.display = "none";
        $("memoire-suite-input").style.display     = "block";
        etatMemoire.phase = "jeu";
        if (_hoteActif) _publierPhase("jeu");
        activerClavierSuite();
    });
}

function _afficherDefiCouleursAvecDonnees(config, couleurs) {
    const container = $("memoire");

    // ── Même structure que afficherDefiCouleurs (cercle animé) ──────
    // + résumé de la séquence visible après mémorisation
    // + panneau suivi invités si hôte actif
    container.innerHTML = `
        <header class="game-header">
            <button id="btn-retour-memoire" class="btn-retour">⬅️</button>
            <h2>🎨 Retiens les couleurs</h2>
        </header>

        <div class="memoire-couleurs-display">
            <div id="couleur-active" class="couleur-active"></div>
        </div>

        <div id="memoire-couleurs-input" class="memoire-couleurs-input" style="display:none;">
            <p class="instruction">Reconstitue la séquence (${couleurs.length} couleurs) :</p>
            <div class="couleurs-reponse" id="couleurs-reponse"></div>
            <div class="couleurs-palette">
                ${BIBLIOTHEQUE.couleurs.map(c => `<button class="couleur-btn" data-nom="${c.nom}" style="background:${c.hex};" title="${c.nom}"></button>`).join('')}
            </div>
            <div class="suite-actions">
                <button id="btn-effacer-couleurs" class="btn-secondary">🗑️ Effacer</button>
                <button id="btn-valider-couleurs" class="btn-primary">✅ Valider</button>
            </div>
        </div>

        ${_hoteActif ? `<div style="margin-top:16px;background:rgba(0,212,255,.05);border:1px solid rgba(0,212,255,.2);border-radius:12px;padding:12px 14px;"><p style="font-size:.75rem;color:rgba(0,212,255,.8);font-weight:700;margin-bottom:6px;">📊 Invités</p><div id="mem-suivi-hote"></div></div>` : ''}
    `;

    etatMemoire.donnees = { couleurs, reponse: [], indexActuel: 0, erreurs: 0, tailleSequence: config.sequence, seuilErreurs: config.seuilErreurs };
    etatMemoire.seuilErreurs = config.seuilErreurs;

    // Animer la séquence (cercle qui change de couleur)
    // puis afficher la palette de saisie
    animerSequenceCouleurs(couleurs, config.vitesse, () => {
        // Afficher un rappel numéroté discret au-dessus de la palette
        const rappel = $("couleurs-rappel");
        if (rappel) {
            rappel.innerHTML = couleurs.map((c, i) =>
                `<div title="${c.nom}" style="width:28px;height:28px;border-radius:50%;
                    background:${c.hex};border:2px solid white;
                    display:flex;align-items:center;justify-content:center;
                    font-size:.65rem;font-weight:900;color:white;
                    text-shadow:0 0 3px rgba(0,0,0,.8);">${i + 1}</div>`
            ).join('');
        }

        $("memoire-couleurs-input").style.display = "block";
        etatMemoire.phase = "jeu";
        if (_hoteActif) _publierPhase("jeu");
        activerPaletteCouleurs();
    });
}

function _afficherDefiSymbolesAvecDonnees(config, donnees) {
    const container = $("memoire");
    container.innerHTML = `
        <header class="game-header">
            <button id="btn-retour-memoire" class="btn-retour">⬅️</button>
            <h2>✨ Mémorise les symboles</h2>
        </header>
        <p style="text-align:center;font-size:.82rem;color:rgba(255,255,255,.6);margin-bottom:6px;">
            Mémorise la position de chaque symbole dans la grille…
        </p>
        <div class="memoire-timer"><div class="timer-bar" id="memoire-timer-bar"></div></div>
        <div class="memoire-symboles-grid" style="grid-template-columns:repeat(${donnees.grille},1fr);">
            ${Array.from({length: donnees.total}, (_, i) => {
                const pos = donnees.positions.find(p => p.position === i);
                return `<div class="symbole-case" data-index="${i}">
                    ${pos ? `<span class="symbole-display">${pos.symbole}</span>` : ''}
                </div>`;
            }).join('')}
        </div>
        <div id="memoire-symboles-input" class="memoire-symboles-input" style="display:none;">
            <p class="instruction">Clique sur la bonne case pour chaque symbole :</p>
            <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:14px;"
                id="symboles-a-placer">
                ${donnees.positions.map(p => `
                    <div class="symbole-a-placer active" data-symbole="${p.symbole}"
                        style="width:60px;height:60px;background:var(--gradient-button);
                            border:2px solid var(--glass-border-strong);border-radius:var(--radius-md);
                            display:flex;align-items:center;justify-content:center;
                            font-size:2rem;cursor:pointer;transition:all .2s;">
                        ${p.symbole}
                    </div>`).join('')}
            </div>
            <p style="text-align:center;font-size:.78rem;color:rgba(255,255,255,.5);">
                Sélectionne un symbole ci-dessus, puis clique sur sa case dans la grille
            </p>
        </div>
        ${_hoteActif ? `<div style="margin-top:16px;background:rgba(0,212,255,.05);border:1px solid rgba(0,212,255,.2);border-radius:12px;padding:12px 14px;"><p style="font-size:.75rem;color:rgba(0,212,255,.8);font-weight:700;margin-bottom:6px;">📊 Invités</p><div id="mem-suivi-hote"></div></div>` : ''}
    `;
    etatMemoire.donnees = { positions: donnees.positions, reponse: [], grille: donnees.grille, erreurs: 0, tailleSequence: config.symboles, seuilErreurs: config.seuilErreurs };
    etatMemoire.seuilErreurs = config.seuilErreurs;
    animerTimer(config.tempsAffichage, () => {
        document.querySelectorAll(".symbole-display").forEach(s => s.style.opacity = "0");
        $("memoire-symboles-input").style.display = "block";
        etatMemoire.phase = "jeu";
        if (_hoteActif) _publierPhase("jeu");
        activerClicSymboles();
    });
}


function lancerDefi(typeDefi) {
    etatMemoire.defiActuel = typeDefi;
    etatMemoire.tentatives++;
    etatMemoire.phase = "preparation";
    // Reset des réponses invités pour ce nouveau défi
    _resultatsRecus   = {};
    _nbReponsesRecues = 0;
    _viderReponses();

    // Publier le countdown aux invités
    if (_hoteActif) {
        _publierDefi({
            typeDefi, difficulte: etatMemoire.difficulte,
            donnees: null, phase: 'countdown', nbAttendu: _nbInvites()
        });
    }

    afficherCompteARebours(() => {
        etatMemoire.phase = "affichage";
        const config = DEFIS_CONFIG[typeDefi].difficultes[etatMemoire.difficulte];

        // ── Générer les données UNE SEULE FOIS ──────────────────
        let donnees = null;
        switch (typeDefi) {
            case "paires":   donnees = genererDefiPaires(config);   break;
            case "suite":    donnees = genererDefiSuite(config);    break;
            case "couleurs": donnees = { couleurs: genererDefiCouleurs(config) }; break;
            case "symboles": donnees = genererDefiSymboles(config); break;
        }

        // Publier aux invités avec les données partagées
        if (_hoteActif) {
            _publierDefi({
                typeDefi, difficulte: etatMemoire.difficulte,
                donnees, phase: 'affichage', nbAttendu: _nbInvites()
            });
        }

        // ── Afficher côté hôte avec les mêmes données ───────────
        switch (typeDefi) {
            case "paires":   _afficherDefiPairesAvecDonnees(config, donnees);            break;
            case "suite":    _afficherDefiSuiteAvecDonnees(config, donnees);             break;
            case "couleurs": _afficherDefiCouleursAvecDonnees(config, donnees.couleurs); break;
            case "symboles": _afficherDefiSymbolesAvecDonnees(config, donnees);          break;
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
        if (_hoteActif) {
            // Créditer l'hôte via le module hôte (GameState + globaux + scoreboard)
            _crediterPts(etatMemoire.joueurActif, scoreGagne, null);
            _scoresSession[etatMemoire.joueurActif] = (_scoresSession[etatMemoire.joueurActif] || 0) + scoreGagne;
            _publierScores(_scoresSession);
        } else {
            ajouterPoints(etatMemoire.joueurActif, scoreGagne);
        }
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

    $("btn-rejouer").onclick = () => {
        _resultatsRecus   = {};
        _nbReponsesRecues = 0;
        lancerDefi(etatMemoire.defiActuel);
    };
    $("btn-menu-defis").onclick = () => { afficherMenuDefis(); attacherEvenements(); };

    // Publier la phase résultats pour que les invités voient leur écran de fin
    if (_hoteActif) {
        _publierPhase('resultats');
        _publierScores(_scoresSession);
        _majSuiviHote();
    }

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