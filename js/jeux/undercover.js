// ======================================================
// 🕵️ UNDERCOVER – MODULE CENTRALISÉ (VERSION JSON)
// ======================================================

import { GameState } from "../core/state.js";
import { creerNouvellePartie } from "../modules/parties.js";
import { registerSuccess } from "../modules/scoreboard.js";
import { saveGame, loadGame, updateGameState } from "../core/storage.js";

export function initialiserUndercover() {
    console.log("[UC] ===== INITIALISATION D'UNDERCOVER =====");

    // --- Sélecteurs principaux ---
    const configScreen       = document.getElementById("undercover-config");
    const distributionScreen = document.getElementById("undercover-distribution");
    const gameScreen         = document.getElementById("undercover");

    const btnStartConfig     = document.getElementById("btn-start-undercover-config");

    const inputNbMW          = document.getElementById("uc-nb-misterwhite");
    const inputNbUC          = document.getElementById("uc-nb-undercover");

    const cartesContainer    = document.getElementById("undercover-cartes-joueurs");

    const zoneJoueursJeu     = document.getElementById("undercover-joueurs");
    const phaseTexte         = document.getElementById("undercover-phase-texte");

    let btnStartGame = null;
    let btnVote      = null;
    let btnRejouer   = null;

    let joueurs      = [];
    let joueursEnJeu = [];

    // 🔥 Variable pour stocker les duos chargés depuis le JSON
    let DUOS_MOTS = [];

    const state = {
        roles: {},
        mots: { civil: "", undercover: "" },
        theme: "",
        vus: new Set(),
        cartesRetournees: {},
        misterWhiteDevine: false
    };

    // ======================================================
    // 🔥 FONCTION POUR SAUVEGARDER L'ÉTAT COMPLET
    // ======================================================
    window.sauvegarderEtatUndercover = function() {
        const etatUndercover = {
            roles: state.roles,
            mots: state.mots,
            theme: state.theme,
            joueursEnJeu: joueursEnJeu,
            cartesRetournees: state.cartesRetournees,
            vus: Array.from(state.vus),
            misterWhiteDevine: state.misterWhiteDevine,
            phase: getCurrentPhase()
        };

        updateGameState(etatUndercover);
        console.log("[UC] 💾 État sauvegardé:", etatUndercover);
    };

    // ======================================================
    // 🔥 FONCTION HELPER POUR DÉTERMINER LA PHASE ACTUELLE
    // ======================================================
    function getCurrentPhase() {
        if (gameScreen && !gameScreen.hidden && gameScreen.style.display !== "none") {
            return "jeu";
        }
        if (distributionScreen && !distributionScreen.hidden && distributionScreen.style.display !== "none") {
            return "distribution";
        }
        if (configScreen && !configScreen.hidden && configScreen.style.display !== "none") {
            return "config";
        }
        return "config";
    }

    // ======================================================
    // 🔥 API PUBLIQUE POUR CHARGER UNE PARTIE
    // ======================================================
    window.initUndercoverConfig = function(partie) {
        console.log("[UC] 🔁 Reprise d'une partie Undercover :", partie);

        // 1. Remettre les joueurs dans le GameState
        GameState.joueurs = [...(partie.joueurs || [])];
        GameState.partieEnCoursChargee = true;

        // 2. Remettre les joueurs dans l'état local du module
        joueurs = [...GameState.joueurs];
        joueursEnJeu = [...joueurs];

        // 3. 🔥 NOUVEAU : Charger l'état spécifique si disponible
        if (partie.gameState) {
            const etat = partie.gameState;

            state.roles = etat.roles || {};
            state.mots = etat.mots || { civil: "", undercover: "" };
            state.theme = etat.theme || "";
            state.misterWhiteDevine = etat.misterWhiteDevine || false;
            state.cartesRetournees = etat.cartesRetournees || {};
            state.vus = new Set(etat.vus || []);

            if (etat.joueursEnJeu) {
                joueursEnJeu = [...etat.joueursEnJeu];
            }

            console.log("[UC] ✅ État spécifique rechargé:", etat);

            // 🔥 Rediriger vers la bonne phase
            if (etat.phase === "jeu") {
                reprendrePartieEnJeu();
                return;
            } else if (etat.phase === "distribution") {
                reprendreDistribution();
                return;
            }
        }

        // 4. Reset de l'état si pas d'état sauvegardé
        state.vus.clear();
        state.cartesRetournees = {};
        state.misterWhiteDevine = false;

        // 5. Mettre à jour l'affichage du nombre de joueurs
        const spanNbJoueurs = document.getElementById("uc-nb-joueurs");
        if (spanNbJoueurs) {
            spanNbJoueurs.textContent = joueurs.length;
        }

        // 6. S'assurer que les bons écrans sont visibles
        masquerTousLesEcrans();

        const container = document.getElementById("container");
        if (container) {
            container.hidden = false;
            container.style.display = "block";
        }

        if (configScreen) {
            configScreen.hidden = false;
            configScreen.style.display = "block";
        }

        console.log("[UC] ✅ Config Undercover prête pour reprise");
    };

    // ======================================================
    // 🔥 REPRENDRE UNE PARTIE EN COURS DE JEU
    // ======================================================
    function reprendrePartieEnJeu() {
        console.log("[UC] 🎮 Reprise de la partie en jeu");

        masquerTousLesEcrans();

        const container = document.getElementById("container");
        if (container) {
            container.hidden = false;
            container.style.display = "block";
        }

        if (gameScreen) {
            gameScreen.hidden = false;
            gameScreen.style.display = "block";
        }

        afficherJoueursEnJeu();

        btnVote = document.getElementById("undercover-voter");
        if (btnVote) {
            btnVote.onclick = lancerVote;
        }

        console.log("[UC] ✅ Partie en jeu restaurée");
    }

    // ======================================================
    // 🔥 REPRENDRE LA PHASE DE DISTRIBUTION
    // ======================================================
    function reprendreDistribution() {
        console.log("[UC] 🎴 Reprise de la distribution");

        masquerTousLesEcrans();

        const container = document.getElementById("container");
        if (container) {
            container.hidden = false;
            container.style.display = "block";
        }

        if (distributionScreen) {
            distributionScreen.hidden = false;
            distributionScreen.style.display = "block";
        }

        afficherCartesJoueurs();

        // Si tous les joueurs ont déjà vu leur rôle, afficher le bouton
        if (state.vus.size === joueurs.length) {
            afficherBoutonCommencerPartie();
        }

        console.log("[UC] ✅ Distribution restaurée");
    }

    // ======================================================
    // 🔥 MASQUER TOUS LES ÉCRANS UNDERCOVER
    // ======================================================
    function masquerTousLesEcrans() {
        if (configScreen) {
            configScreen.hidden = true;
            configScreen.style.display = "none";
        }
        if (distributionScreen) {
            distributionScreen.hidden = true;
            distributionScreen.style.display = "none";
        }
        if (gameScreen) {
            gameScreen.hidden = true;
            gameScreen.style.display = "none";
        }
    }

    // ======================================================
    // 📚 CHARGEMENT DES DUOS DEPUIS LE JSON
    // ======================================================
    async function chargerDuosMots() {
        try {
            console.log("[UC] 🔄 Chargement des duos de mots depuis undercover.json...");

            const response = await fetch("../../data/undercover.json");

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            DUOS_MOTS = data.map(item => ({
                civil: item.Civil,
                undercover: item.Undercover,
                theme: item.Thème
            }));

            console.log(`[UC] ✅ ${DUOS_MOTS.length} duos de mots chargés avec succès`);
            console.log("[UC] 📊 Thèmes disponibles:", [...new Set(DUOS_MOTS.map(d => d.theme))]);

            return true;
        } catch (error) {
            console.error("[UC] ❌ Erreur lors du chargement du JSON:", error);

            // 🔥 FALLBACK : Duos par défaut en cas d'erreur
            DUOS_MOTS = [
                { civil: "Pomme",    undercover: "Poire",     theme: "Cuisine" },
                { civil: "Chien",    undercover: "Loup",      theme: "Animaux" },
                { civil: "Bière",    undercover: "Vin",       theme: "Cuisine" },
                { civil: "Plage",    undercover: "Piscine",   theme: "Lieux" },
                { civil: "Voiture",  undercover: "Moto",      theme: "Transport" },
                { civil: "Café",     undercover: "Thé",       theme: "Cuisine" },
                { civil: "Chat",     undercover: "Tigre",     theme: "Animaux" },
                { civil: "Piano",    undercover: "Guitare",   theme: "Musique" },
                { civil: "Été",      undercover: "Printemps", theme: "Nature" },
                { civil: "Mer",      undercover: "Océan",     theme: "Nature" }
            ];

            console.warn("[UC] ⚠️ Utilisation des duos par défaut (10 duos)");
            return false;
        }
    }

    // ======================================================
    // 🎲 PIOCHER UN DUO ALÉATOIRE
    // ======================================================
    const piocherDuoAleatoire = () => {
        if (DUOS_MOTS.length === 0) {
            console.error("[UC] ❌ Aucun duo disponible !");
            return { civil: "???", undercover: "???", theme: "Erreur" };
        }
        return DUOS_MOTS[Math.floor(Math.random() * DUOS_MOTS.length)];
    };

    // ======================================================
    // 🔀 MÉLANGER UN TABLEAU
    // ======================================================
    const melanger = arr =>
        arr.map(v => ({ v, r: Math.random() }))
           .sort((a, b) => a.r - b.r)
           .map(x => x.v);

    // ======================================================
    // 🎯 VÉRIFIER LA FIN DE LA PARTIE
    // ======================================================
    function verifierFinPartie() {
        console.log("[UC] Vérification de la fin de partie...");

        const joueursActifs = joueursEnJeu.filter(j => !j.startsWith("~~"));

        const rolesActifs = {
            civil: 0,
            undercover: 0,
            misterWhite: 0
        };

        joueursActifs.forEach(j => {
            const role = state.roles[j];
            if (role === "Civil") rolesActifs.civil++;
            else if (role === "Undercover") rolesActifs.undercover++;
            else if (role === "Mister White") rolesActifs.misterWhite++;
        });

        console.log("[UC] Rôles actifs:", rolesActifs);

        // 1. Mister White gagne s'il devine
        if (state.misterWhiteDevine === true) {
            afficherFinPartie("🟨 Mister White a gagné en devinant le mot !", "misterwhite");
            return true;
        }

        // 2. Victoire des Civils : plus d'Undercover ET plus de Mister White
        if (rolesActifs.undercover === 0 && rolesActifs.misterWhite === 0) {
            afficherFinPartie("🟩 Les Civils ont gagné !", "civil");
            return true;
        }

        // 3. Victoire des Undercover : ils deviennent majoritaires
        if (rolesActifs.undercover >= (rolesActifs.civil + rolesActifs.misterWhite)) {
            afficherFinPartie("🟥 Les Undercover ont gagné !", "undercover");
            return true;
        }

        console.log("[UC] La partie continue...");
        return false;
    }

    // ======================================================
    // 🏆 AFFICHER L'ÉCRAN DE FIN DE PARTIE
    // ======================================================
    function afficherFinPartie(message, gagnant) {
        if (!zoneJoueursJeu || !phaseTexte) return;

        console.log("[UC] 🏆 Fin de partie:", message);

        // Attribution automatique des points
        let gagnants = [];

        if (gagnant === "civil") {
            gagnants = joueurs.filter(j => state.roles[j] === "Civil");
        }
        else if (gagnant === "undercover") {
            gagnants = joueurs.filter(j => state.roles[j] === "Undercover");
        }
        else if (gagnant === "misterwhite") {
            gagnants = joueurs.filter(j => state.roles[j] === "Mister White");
        }

        gagnants.forEach(joueur => {
            registerSuccess("undercover", joueur);
        });

        // 🔥 SAUVEGARDE DE L'ÉTAT DE FIN
        window.sauvegarderEtatUndercover();

        // Masquer complètement le bouton vote
        if (btnVote) {
            btnVote.hidden = true;
            btnVote.style.display = "none";
        }

        phaseTexte.innerHTML = `<strong>${message}</strong>`;
        phaseTexte.className = "undercover-phase-texte uc-fin-partie";

        zoneJoueursJeu.innerHTML = "";

        joueurs.forEach(j => {
            const role = state.roles[j];
            const mot = role === "Civil" ? state.mots.civil :
                       role === "Undercover" ? state.mots.undercover :
                       "???";

            const estElimine = joueursEnJeu.find(je =>
                je === `~~${j}~~` || je === j
            )?.startsWith("~~");

            const div = document.createElement("div");
            div.className = `uc-joueur-final
                ${gagnant === "civil" && role === "Civil" ? "uc-gagnant" : ""}
                ${gagnant === "undercover" && role !== "Civil" ? "uc-gagnant" : ""}
                ${gagnant === "misterwhite" && role === "Mister White" ? "uc-gagnant" : ""}
            `;

            div.innerHTML = `
                ${estElimine ? "<s>" : ""}
                <strong>${j}</strong> : ${role} (${mot})
                ${estElimine ? "</s>" : ""}
            `;

            zoneJoueursJeu.appendChild(div);
        });

        afficherBoutonRejouer();
    }

    // ======================================================
    // 🔄 BOUTON REJOUER
    // ======================================================
    function afficherBoutonRejouer() {
        if (!gameScreen) return;

        console.log("[UC] Affichage du bouton Rejouer");

        if (!btnRejouer) {
            btnRejouer = document.createElement("button");
            btnRejouer.id = "btn-rejouer-undercover";
            btnRejouer.className = "btn-primary btn-rejouer";
            btnRejouer.innerHTML = `<span>🔄</span> Rejouer avec les mêmes joueurs`;

            btnRejouer.onclick = () => {
                console.log("[UC] 🔄 Retour à l'écran de configuration Undercover");

                state.vus.clear();
                state.cartesRetournees = {};
                state.misterWhiteDevine = false;
                joueursEnJeu = [...joueurs];

                if (gameScreen) {
                    gameScreen.hidden = true;
                    gameScreen.style.display = "none";
                }

                if (distributionScreen) {
                    distributionScreen.hidden = true;
                    distributionScreen.style.display = "none";
                }

                if (zoneJoueursJeu) zoneJoueursJeu.innerHTML = "";
                if (phaseTexte) {
                    phaseTexte.textContent = "";
                    phaseTexte.className = "undercover-phase-texte";
                }

                if (btnVote) {
                    btnVote.hidden = false;
                    btnVote.style.display = "block";
                    btnVote.textContent = "Passer au vote";
                    btnVote.onclick = lancerVote;
                }

                if (btnRejouer) {
                    btnRejouer.remove();
                    btnRejouer = null;
                }

                if (btnStartGame) {
                    btnStartGame.remove();
                    btnStartGame = null;
                }

                const container = document.getElementById("container");
                if (container) {
                    container.hidden = false;
                    container.style.display = "block";
                }

                const ucConfig = document.getElementById("undercover-config");
                if (ucConfig) {
                    ucConfig.hidden = false;
                    ucConfig.style.display = "block";
                }

                console.log("[UC] ✅ Retour à la configuration effectué");
            };

            const phaseDiv = document.getElementById("undercover-phase");
            if (phaseDiv) {
                phaseDiv.appendChild(btnRejouer);
            }
        }

        btnRejouer.hidden = false;
    }

    // ======================================================
    // 📌 1. CONFIGURATION
    // ======================================================
    if (!btnStartConfig) {
        console.error("[UC] ERREUR : btn-start-undercover-config introuvable !");
        return;
    }

    if (btnStartConfig.dataset.ucInit === "1") {
        console.log("[UC] Déjà initialisé, on sort");
        return;
    }
    btnStartConfig.dataset.ucInit = "1";

    btnStartConfig.addEventListener("click", () => {
        console.log("[UC] 🎯 Clic sur Confirmer (config)");

        joueurs      = [...(GameState.joueurs || [])];
        joueursEnJeu = [...joueurs];

        const nbJ  = joueurs.length;
        const nbMW = parseInt(inputNbMW?.value ?? "0", 10);
        const nbUC = parseInt(inputNbUC?.value ?? "0", 10);

        console.log("[UC] Configuration:", { nbJ, nbMW, nbUC });

        if (nbJ < 3) return alert("Il faut au moins 3 joueurs.");
        if (!inputNbMW || !inputNbUC) return alert("Champs de configuration manquants.");
        if (Number.isNaN(nbMW) || Number.isNaN(nbUC)) return alert("Valeurs incorrectes.");
        if (nbMW < 0 || nbUC < 1) return alert("Valeurs incorrectes.");
        if (nbMW + nbUC >= nbJ) return alert("Trop de rôles spéciaux.");

        const nbCivils = nbJ - nbMW - nbUC;
        if (nbCivils < 1) return alert("Il doit rester au moins 1 Civil.");

        const duo = piocherDuoAleatoire();
        state.mots = { civil: duo.civil, undercover: duo.undercover };
        state.theme = duo.theme;
        state.misterWhiteDevine = false;

        console.log("[UC] Duo de mots:", state.mots);
        console.log("[UC] Thème:", state.theme);

        let rolesArray = [
            ...Array(nbMW).fill("Mister White"),
            ...Array(nbUC).fill("Undercover"),
            ...Array(nbCivils).fill("Civil")
        ];

        rolesArray = melanger(rolesArray);

        state.roles = {};
        joueurs.forEach((j, i) => (state.roles[j] = rolesArray[i]));
        console.log("[UC] Rôles attribués:", state.roles);

        state.vus.clear();
        state.cartesRetournees = {};

        // 🔥 SAUVEGARDE APRÈS CONFIGURATION
        window.sauvegarderEtatUndercover();

        if (!cartesContainer) {
            console.error("[UC] ERREUR : undercover-cartes-joueurs introuvable !");
            return;
        }

        afficherCartesJoueurs();

        if (!distributionScreen) {
            console.error("[UC] ERREUR : undercover-distribution introuvable !");
            return;
        }

        distributionScreen.hidden = false;
        distributionScreen.style.display = "block";

        console.log("[UC] ✅ Distribution affichée");
    });

    // ======================================================
    // 📌 2. AFFICHAGE DES CARTES RETOURNABLES
    // ======================================================
    function afficherCartesJoueurs() {
        if (!cartesContainer) return;

        console.log("[UC] Création des cartes retournables");
        cartesContainer.innerHTML = "";

        joueurs.forEach(pseudo => {
            const role = state.roles[pseudo];
            const mot = role === "Civil" ? state.mots.civil :
                       role === "Undercover" ? state.mots.undercover :
                       "???";

            // Restaurer l'état de la carte si elle était retournée
            const estRetournee = state.cartesRetournees[pseudo] || false;

            const carteWrapper = document.createElement("div");
            carteWrapper.className = "uc-carte-wrapper";
            carteWrapper.dataset.joueur = pseudo;

            const carte = document.createElement("div");
            carte.className = "uc-carte";

            // 🔥 Appliquer l'état retourné si nécessaire
            if (estRetournee) {
                carte.classList.add("retournee");
            }

            const faceRecto = document.createElement("div");
            faceRecto.className = "uc-carte-face uc-carte-recto";
            faceRecto.innerHTML = `
                <div class="uc-carte-nom-recto">${pseudo}</div>
                <div class="uc-carte-hint">👆</div>
            `;

            const faceVerso = document.createElement("div");
            faceVerso.className = "uc-carte-face uc-carte-verso";
            faceVerso.innerHTML = `
                <div class="uc-carte-role-nom">${role}</div>
                <div class="uc-carte-mot-titre">Ton mot :</div>
                <div class="uc-carte-mot-valeur">${mot}</div>
                <div class="uc-carte-hint">👆</div>
            `;

            carte.appendChild(faceRecto);
            carte.appendChild(faceVerso);
            carteWrapper.appendChild(carte);

            carteWrapper.addEventListener("click", () => {
                toggleCarte(pseudo, carte);
            });

            cartesContainer.appendChild(carteWrapper);
        });

        console.log("[UC] ✅", joueurs.length, "cartes créées");
    }

    // ======================================================
    // 📌 3. RETOURNER UNE CARTE
    // ======================================================
    function toggleCarte(pseudo, carteElement) {
        const estRetournee = state.cartesRetournees[pseudo];

        if (estRetournee) {
            carteElement.classList.remove("retournee");
            state.cartesRetournees[pseudo] = false;
            console.log("[UC] Carte de", pseudo, "cachée");
        } else {
            carteElement.classList.add("retournee");
            state.cartesRetournees[pseudo] = true;
            console.log("[UC] Carte de", pseudo, "révélée");

            if (!state.vus.has(pseudo)) {
                state.vus.add(pseudo);
                console.log("[UC] Joueur", pseudo, "a vu son rôle (", state.vus.size, "/", joueurs.length, ")");

                // 🔥 SAUVEGARDE APRÈS CHAQUE CARTE VUE
                window.sauvegarderEtatUndercover();

                if (state.vus.size === joueurs.length) {
                    console.log("[UC] ✅ Tous les joueurs ont vu leur rôle");
                    afficherBoutonCommencerPartie();
                }
            }
        }
    }

    // ======================================================
    // 📌 4. BOUTON "COMMENCER LA PARTIE"
    // ======================================================
    function afficherBoutonCommencerPartie() {
        if (!distributionScreen) return;

        console.log("[UC] Affichage du bouton Commencer");

        if (!btnStartGame) {
            btnStartGame = document.createElement("button");
            btnStartGame.className = "btn-valider-equipes";
            btnStartGame.innerHTML = `<span>🚀</span> Commencer la partie`;

            btnStartGame.onclick = () => {
                console.log("[UC] 🚀 Démarrage de la partie");

                if (configScreen) {
                    configScreen.hidden = true;
                    configScreen.style.display = "none";
                }

                if (distributionScreen) {
                    distributionScreen.hidden = true;
                    distributionScreen.style.display = "none";
                }

                const container = document.getElementById("container");
                if (container) {
                    container.hidden = false;
                    container.style.display = "block";
                    console.log("[UC] ✅ Container affiché");
                }

                if (gameScreen) {
                    gameScreen.hidden = false;
                    gameScreen.style.display = "block";
                    console.log("[UC] ✅ Écran de jeu affiché");
                }

                // 🔥 SAUVEGARDE AVANT DE COMMENCER LA PARTIE
                window.sauvegarderEtatUndercover();

                afficherJoueursEnJeu();

                btnVote = document.getElementById("undercover-voter");
                if (!btnVote) {
                    console.error("[UC] ERREUR : bouton undercover-voter introuvable !");
                    return;
                }
                btnVote.onclick = lancerVote;
            };

            distributionScreen.appendChild(btnStartGame);
        }

        btnStartGame.hidden = false;
    }

    // ======================================================
    // 📌 5. AFFICHER LES JOUEURS (DÉBAT)
    // ======================================================
    function afficherJoueursEnJeu() {
        if (!zoneJoueursJeu || !phaseTexte) return;

        console.log("[UC] Affichage des joueurs en jeu");
        zoneJoueursJeu.innerHTML = "";

        joueursEnJeu.forEach(j => {
            const div = document.createElement("div");
            div.className = "uc-joueur";

            if (j.startsWith("~~") && j.endsWith("~~")) {
                div.innerHTML = `<s>${j.replace(/~~/g, "")}</s>`;
            } else {
                div.textContent = j;
            }

            zoneJoueursJeu.appendChild(div);
        });

        phaseTexte.textContent = "🗣️ Phase de débat en cours...";
    }

    // ======================================================
    // 📌 6. PASSER AU VOTE
    // ======================================================
    function lancerVote() {
        if (!zoneJoueursJeu || !phaseTexte || !btnVote) return;

        console.log("[UC] 🗳️ Passage au vote");
        phaseTexte.textContent = "🗳️ Phase de vote";
        zoneJoueursJeu.innerHTML = "";

        const joueursActifs = joueursEnJeu.filter(j => !j.startsWith("~~"));

        joueursActifs.forEach(joueur => {
            const ligne = document.createElement("div");
            ligne.className = "uc-joueur-vote";

            const label = document.createElement("span");
            label.textContent = `${joueur} vote pour : `;

            const select = document.createElement("select");
            select.dataset.votant = joueur;

            joueursActifs.forEach(cible => {
                if (cible !== joueur) {
                    const opt = document.createElement("option");
                    opt.value = cible;
                    opt.textContent = cible;
                    select.appendChild(opt);
                }
            });

            ligne.appendChild(label);
            ligne.appendChild(select);
            zoneJoueursJeu.appendChild(ligne);
        });

        btnVote.textContent = "Valider les votes";
        btnVote.onclick = validerVotes;

        // 🔥 SAUVEGARDE APRÈS PASSAGE AU VOTE
        window.sauvegarderEtatUndercover();
    }

    // ======================================================
    // 📌 7. VALIDER LES VOTES
    // ======================================================
    function validerVotes() {
        if (!zoneJoueursJeu) return;

        console.log("[UC] ✅ Validation des votes");

        const votes   = {};
        const selects = zoneJoueursJeu.querySelectorAll("select");

        selects.forEach(sel => {
            votes[sel.dataset.votant] = sel.value;
        });

        console.log("[UC] Votes:", votes);

        const compteur = {};
        joueursEnJeu.forEach(j => {
            if (!j.startsWith("~~")) {
                compteur[j] = 0;
            }
        });

        Object.values(votes).forEach(cible => {
            if (compteur[cible] !== undefined) {
                compteur[cible]++;
            }
        });

        console.log("[UC] Compteur:", compteur);

        let elimine  = null;
        let maxVotes = -1;

        for (const joueur in compteur) {
            if (compteur[joueur] > maxVotes) {
                maxVotes = compteur[joueur];
                elimine  = joueur;
            }
        }

        if (!elimine) {
            console.warn("[UC] Aucun joueur éliminé");
            return;
        }

        console.log("[UC] Éliminé:", elimine, "avec", maxVotes, "vote(s)");
        afficherElimination(elimine, true);
    }

    // ======================================================
    // 📌 8. ÉLIMINATION + POPUP + VÉRIFICATION FIN
    // ======================================================
    function afficherElimination(joueur, elimParVote = false) {
        console.log("[UC] ⚰️ Élimination de:", joueur);

        const role = state.roles[joueur];

        const popup = document.createElement("div");
        popup.className = "uc-popup-elimination";
        popup.innerHTML = `
            <div class="uc-popup-content">
                <h2>⚰️ ${joueur} a été éliminé !</h2>
                <div class="uc-popup-role">Rôle : <strong>${role}</strong></div>
            </div>
        `;
        document.body.appendChild(popup);

        setTimeout(() => {
            popup.remove();

            if (role === "Mister White" && elimParVote === true) {
                state.misterWhiteDevine = false;

                const guess = prompt("💬 Mister White, entre le mot des civils pour tenter de gagner :");

                if (!guess) {
                    alert("❌ Aucun mot entré. Mister White est éliminé.");
                    eliminationClassique(joueur);
                    return;
                }

                if (guess.trim().toLowerCase() === state.mots.civil.toLowerCase()) {
                    alert("🏆 Mister White a deviné le mot ! Il gagne la partie !");
                    state.misterWhiteDevine = true;

                    joueursEnJeu = joueursEnJeu.map(j =>
                        j === joueur ? j : `~~${j}~~`
                    );

                    afficherFinPartie("🏆 Mister White a gagné !", "misterwhite");
                    return;
                }

                alert("❌ Mauvaise réponse ! Mister White est éliminé.");
                eliminationClassique(joueur);
                return;
            }

            eliminationClassique(joueur);

        }, 3000);
    }

    // ======================================================
    // 📌 ÉLIMINATION CLASSIQUE
    // ======================================================
    function eliminationClassique(joueur) {
        const index = joueursEnJeu.indexOf(joueur);
        if (index !== -1) {
            joueursEnJeu[index] = `~~${joueur}~~`;
        }

        // 🔥 SAUVEGARDE APRÈS ÉLIMINATION
        window.sauvegarderEtatUndercover();

        if (state.misterWhiteDevine === true) return;

        if (verifierFinPartie()) return;

        afficherJoueursEnJeu();

        if (phaseTexte) {
            phaseTexte.textContent = "🗣️ Nouveau débat";
        }

        if (btnVote) {
            btnVote.textContent = "Passer au vote";
            btnVote.onclick = lancerVote;
        }
    }

    // ======================================================
    // 🚀 CHARGEMENT INITIAL DES DONNÉES
    // ======================================================
    chargerDuosMots().then(success => {
        if (success) {
            console.log("[UC] ✅ Prêt à jouer avec", DUOS_MOTS.length, "duos");
        } else {
            console.warn("[UC] ⚠️ Mode dégradé avec duos par défaut");
        }
    });

    console.log("[UC] ===== INITIALISATION TERMINÉE =====");
}

// ======================================================
// 🚀 Initialisation automatique du module Undercover
// ======================================================
initialiserUndercover();