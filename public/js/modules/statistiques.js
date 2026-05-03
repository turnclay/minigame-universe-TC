// /js/modules/statistiques.js

import { $, show, hide } from "../core/dom.js";
import { getAllParties, getPlayers } from "../core/storage.js";

// ============================================
// 📊 SYSTÈME DE STATISTIQUES
// ============================================

/**
 * Calcule les statistiques globales de toutes les parties
 */
export function calculerStatistiquesGlobales() {
    const parties = getAllParties();

    const stats = {
        totalParties: parties.length,
        partiesParJeu: {},
        partiesParMode: { solo: 0, team: 0 },
        joueursActifs: new Set(),
        equipesActives: new Set(),
        scoreTotal: 0,
        meilleurScore: { joueur: null, score: 0, jeu: null },
        tempsMoyenParJeu: {},
        performancesParJoueur: {}
    };

    parties.forEach(partie => {
        // Parties par jeu
        const jeu = partie.jeu || "inconnu";
        stats.partiesParJeu[jeu] = (stats.partiesParJeu[jeu] || 0) + 1;

        // Parties par mode
        if (partie.mode === "solo" || partie.mode === "team") {
            stats.partiesParMode[partie.mode]++;
        }

        // Scores
        if (partie.scores && typeof partie.scores === 'object') {
            Object.entries(partie.scores).forEach(([joueur, score]) => {
                // Tracking des joueurs actifs
                stats.joueursActifs.add(joueur);

                // Score total
                stats.scoreTotal += score;

                // Meilleur score
                if (score > stats.meilleurScore.score) {
                    stats.meilleurScore = {
                        joueur,
                        score,
                        jeu: partie.jeu,
                        date: partie.date
                    };
                }

                // Performances par joueur
                if (!stats.performancesParJoueur[joueur]) {
                    stats.performancesParJoueur[joueur] = {
                        totalScore: 0,
                        totalParties: 0,
                        jeuxJoues: new Set(),
                        meilleurScore: 0,
                        victories: 0
                    };
                }

                stats.performancesParJoueur[joueur].totalScore += score;
                stats.performancesParJoueur[joueur].totalParties++;
                stats.performancesParJoueur[joueur].jeuxJoues.add(partie.jeu);

                if (score > stats.performancesParJoueur[joueur].meilleurScore) {
                    stats.performancesParJoueur[joueur].meilleurScore = score;
                }
            });

            // Détecter le gagnant de la partie
            const gagnant = Object.entries(partie.scores).reduce((a, b) =>
                a[1] > b[1] ? a : b
            );
            if (gagnant && stats.performancesParJoueur[gagnant[0]]) {
                stats.performancesParJoueur[gagnant[0]].victories++;
            }
        }
    });

    return stats;
}

/**
 * Calcule les statistiques pour un joueur spécifique
 */
export function calculerStatistiquesJoueur(nomJoueur) {
    const parties = getAllParties();

    const stats = {
        nom: nomJoueur,
        totalParties: 0,
        totalScore: 0,
        scoreMoyen: 0,
        meilleurScore: 0,
        victories: 0,
        defaites: 0,
        jeuxJoues: {},
        performancesParJeu: {},
        historique: []
    };

    parties.forEach(partie => {
        if (!partie.scores || !partie.scores[nomJoueur]) return;

        stats.totalParties++;
        const score = partie.scores[nomJoueur];
        stats.totalScore += score;

        if (score > stats.meilleurScore) {
            stats.meilleurScore = score;
        }

        // Jeux joués
        const jeu = partie.jeu || "inconnu";
        stats.jeuxJoues[jeu] = (stats.jeuxJoues[jeu] || 0) + 1;

        // Performances par jeu
        if (!stats.performancesParJeu[jeu]) {
            stats.performancesParJeu[jeu] = {
                parties: 0,
                scoreTotal: 0,
                scoreMoyen: 0,
                meilleurScore: 0
            };
        }

        stats.performancesParJeu[jeu].parties++;
        stats.performancesParJeu[jeu].scoreTotal += score;
        stats.performancesParJeu[jeu].scoreMoyen =
            stats.performancesParJeu[jeu].scoreTotal / stats.performancesParJeu[jeu].parties;

        if (score > stats.performancesParJeu[jeu].meilleurScore) {
            stats.performancesParJeu[jeu].meilleurScore = score;
        }

        // Victoire ou défaite
        const scores = Object.values(partie.scores);
        const maxScore = Math.max(...scores);
        if (score === maxScore) {
            stats.victories++;
        } else {
            stats.defaites++;
        }

        // Historique
        stats.historique.push({
            jeu: partie.jeu,
            score,
            date: partie.date,
            mode: partie.mode
        });
    });

    stats.scoreMoyen = stats.totalParties > 0 ?
        Math.round(stats.totalScore / stats.totalParties) : 0;

    return stats;
}

/**
 * Calcule les statistiques pour un jeu spécifique
 */
export function calculerStatistiquesJeu(nomJeu) {
    const parties = getAllParties().filter(p => p.jeu === nomJeu);

    const stats = {
        jeu: nomJeu,
        totalParties: parties.length,
        joueursUniques: new Set(),
        scoreTotal: 0,
        scoreMoyen: 0,
        meilleurScore: { joueur: null, score: 0, date: null },
        performancesParJoueur: {}
    };

    parties.forEach(partie => {
        if (!partie.scores) return;

        Object.entries(partie.scores).forEach(([joueur, score]) => {
            stats.joueursUniques.add(joueur);
            stats.scoreTotal += score;

            if (score > stats.meilleurScore.score) {
                stats.meilleurScore = {
                    joueur,
                    score,
                    date: partie.date
                };
            }

            if (!stats.performancesParJoueur[joueur]) {
                stats.performancesParJoueur[joueur] = {
                    parties: 0,
                    scoreTotal: 0,
                    scoreMoyen: 0
                };
            }

            stats.performancesParJoueur[joueur].parties++;
            stats.performancesParJoueur[joueur].scoreTotal += score;
            stats.performancesParJoueur[joueur].scoreMoyen =
                stats.performancesParJoueur[joueur].scoreTotal /
                stats.performancesParJoueur[joueur].parties;
        });
    });

    const totalScores = parties.reduce((sum, p) => {
        return sum + Object.values(p.scores || {}).reduce((a, b) => a + b, 0);
    }, 0);

    stats.scoreMoyen = parties.length > 0 ?
        Math.round(totalScores / parties.length) : 0;

    return stats;
}

/**
 * Affiche l'écran des statistiques
 */
export function afficherStatistiques() {
    const stats = calculerStatistiquesGlobales();
    const container = $("statistiques-container");

    if (!container) {
        console.error("Container statistiques-container introuvable");
        return;
    }

    // Conversion des Sets en Arrays pour l'affichage
    const joueursActifs = Array.from(stats.joueursActifs);
    const topJoueurs = Object.entries(stats.performancesParJoueur)
        .map(([nom, perf]) => ({
            nom,
            scoreTotal: perf.totalScore,
            scoreMoyen: Math.round(perf.totalScore / perf.totalParties),
            victories: perf.victories
        }))
        .sort((a, b) => b.scoreTotal - a.scoreTotal)
        .slice(0, 5);

    container.innerHTML = `
        <header class="stats-header">
            <h1>📊 Statistiques</h1>
        </header>

        <div class="stats-grid">
            <!-- Vue d'ensemble -->
            <div class="stats-card">
                <h2>🎮 Vue d'ensemble</h2>
                <div class="stats-content">
                    <p><strong>Total parties :</strong> ${stats.totalParties}</p>
                    <p><strong>Joueurs actifs :</strong> ${joueursActifs.length}</p>
                    <p><strong>Score total cumulé :</strong> ${stats.scoreTotal}</p>
                </div>
            </div>

            <!-- Meilleur score -->
            <div class="stats-card highlight">
                <h2>🏆 Meilleur score</h2>
                <div class="stats-content">
                    ${stats.meilleurScore.joueur ? `
                        <p><strong>${stats.meilleurScore.joueur}</strong></p>
                        <p class="big-number">${stats.meilleurScore.score}</p>
                        <p class="small-text">${stats.meilleurScore.jeu?.toUpperCase()}</p>
                        <p class="small-text">${new Date(stats.meilleurScore.date).toLocaleDateString()}</p>
                    ` : '<p>Aucune partie jouée</p>'}
                </div>
            </div>

            <!-- Parties par jeu -->
            <div class="stats-card">
                <h2>🎲 Parties par jeu</h2>
                <div class="stats-content">
                    ${Object.entries(stats.partiesParJeu)
                        .sort((a, b) => b[1] - a[1])
                        .map(([jeu, count]) => `
                            <div class="stat-bar">
                                <span>${jeu.toUpperCase()}</span>
                                <span><strong>${count}</strong></span>
                            </div>
                        `).join('')}
                </div>
            </div>

            <!-- Top joueurs -->
            <div class="stats-card">
                <h2>🌟 Top Joueurs</h2>
                <div class="stats-content">
                    ${topJoueurs.map((joueur, index) => `
                        <div class="stat-bar">
                            <span>${index + 1}. ${joueur.nom}</span>
                            <span>
                                <strong>${joueur.scoreTotal}</strong> pts
                                (moy: ${joueur.scoreMoyen})
                                🏆 ${joueur.victories}
                            </span>
                        </div>
                    `).join('')}
                </div>
            </div>

            <!-- Modes de jeu -->
            <div class="stats-card">
                <h2>👥 Modes de jeu</h2>
                <div class="stats-content">
                    <div class="stat-bar">
                        <span>Solo</span>
                        <span><strong>${stats.partiesParMode.solo}</strong></span>
                    </div>
                    <div class="stat-bar">
                        <span>Équipe</span>
                        <span><strong>${stats.partiesParMode.team}</strong></span>
                    </div>
                </div>
            </div>
        </div>

        <!-- Boutons d'action -->
        <div class="stats-actions">
            <button id="btn-stats-par-joueur" class="btn-primary">
                👤 Stats par joueur
            </button>
            <button id="btn-stats-par-jeu" class="btn-secondary">
                🎮 Stats par jeu
            </button>
            <button id="btn-retour-stats" class="btn-retour">
                ⬅️ Retour
            </button>
        </div>
    `;

    // Attacher les événements
    $("btn-stats-par-joueur").onclick = () => afficherSelectionJoueur();
    $("btn-stats-par-jeu").onclick = () => afficherSelectionJeu();
    $("btn-retour-stats").onclick = () => {
        hide("statistiques-container");
        show("home");
    };

    hide("home");
    show("statistiques-container");
}

/**
 * Affiche la sélection de joueur pour les stats détaillées
 */
function afficherSelectionJoueur() {
    const joueurs = getPlayers();
    const container = $("statistiques-container");

    container.innerHTML = `
        <header class="stats-header">
            <h1>👤 Choisir un joueur</h1>
        </header>

        <div class="joueurs-selection">
            ${joueurs.map(joueur => `
                <button class="joueur-btn" data-joueur="${joueur}">
                    ${joueur}
                </button>
            `).join('')}
        </div>

        <button id="btn-retour-selection" class="btn-retour">
            ⬅️ Retour
        </button>
    `;

    document.querySelectorAll(".joueur-btn").forEach(btn => {
        btn.onclick = () => {
            const joueur = btn.dataset.joueur;
            afficherStatistiquesJoueur(joueur);
        };
    });

    $("btn-retour-selection").onclick = () => afficherStatistiques();
}

/**
 * Affiche les statistiques détaillées d'un joueur
 */
function afficherStatistiquesJoueur(nomJoueur) {
    const stats = calculerStatistiquesJoueur(nomJoueur);
    const container = $("statistiques-container");

    const tauxVictoire = stats.totalParties > 0 ?
        Math.round((stats.victories / stats.totalParties) * 100) : 0;

    container.innerHTML = `
        <header class="stats-header">
            <h1>👤 ${stats.nom}</h1>
        </header>

        <div class="stats-grid">
            <!-- Résumé -->
            <div class="stats-card highlight">
                <h2>📈 Résumé</h2>
                <div class="stats-content">
                    <p><strong>Parties jouées :</strong> ${stats.totalParties}</p>
                    <p><strong>Score total :</strong> ${stats.totalScore}</p>
                    <p><strong>Score moyen :</strong> ${stats.scoreMoyen}</p>
                    <p><strong>Meilleur score :</strong> ${stats.meilleurScore}</p>
                    <p><strong>Victoires :</strong> ${stats.victories} (${tauxVictoire}%)</p>
                </div>
            </div>

            <!-- Performances par jeu -->
            <div class="stats-card">
                <h2>🎮 Performances par jeu</h2>
                <div class="stats-content">
                    ${Object.entries(stats.performancesParJeu)
                        .sort((a, b) => b[1].scoreTotal - a[1].scoreTotal)
                        .map(([jeu, perf]) => `
                            <div class="stat-bar">
                                <span>${jeu.toUpperCase()}</span>
                                <span>
                                    ${perf.parties} parties
                                    | Moy: ${Math.round(perf.scoreMoyen)}
                                    | Max: ${perf.meilleurScore}
                                </span>
                            </div>
                        `).join('')}
                </div>
            </div>

            <!-- Historique récent -->
            <div class="stats-card">
                <h2>📅 Historique récent</h2>
                <div class="stats-content">
                    ${stats.historique
                        .slice(-10)
                        .reverse()
                        .map(partie => `
                            <div class="stat-bar">
                                <span>${partie.jeu.toUpperCase()}</span>
                                <span>
                                    <strong>${partie.score}</strong> pts
                                    <small>${new Date(partie.date).toLocaleDateString()}</small>
                                </span>
                            </div>
                        `).join('')}
                </div>
            </div>
        </div>

        <button id="btn-retour-joueur" class="btn-retour">
            ⬅️ Retour
        </button>
    `;

    $("btn-retour-joueur").onclick = () => afficherSelectionJoueur();
}

/**
 * Affiche la sélection de jeu pour les stats détaillées
 */
function afficherSelectionJeu() {
    const stats = calculerStatistiquesGlobales();
    const container = $("statistiques-container");

    const jeux = Object.keys(stats.partiesParJeu);

    container.innerHTML = `
        <header class="stats-header">
            <h1>🎮 Choisir un jeu</h1>
        </header>

        <div class="jeux-selection">
            ${jeux.map(jeu => `
                <button class="jeu-btn" data-jeu="${jeu}">
                    ${jeu.toUpperCase()}
                    <small>${stats.partiesParJeu[jeu]} parties</small>
                </button>
            `).join('')}
        </div>

        <button id="btn-retour-selection" class="btn-retour">
            ⬅️ Retour
        </button>
    `;

    document.querySelectorAll(".jeu-btn").forEach(btn => {
        btn.onclick = () => {
            const jeu = btn.dataset.jeu;
            afficherStatistiquesJeu(jeu);
        };
    });

    $("btn-retour-selection").onclick = () => afficherStatistiques();
}

/**
 * Affiche les statistiques détaillées d'un jeu
 */
function afficherStatistiquesJeu(nomJeu) {
    const stats = calculerStatistiquesJeu(nomJeu);
    const container = $("statistiques-container");

    const topJoueurs = Object.entries(stats.performancesParJoueur)
        .map(([nom, perf]) => ({ nom, ...perf }))
        .sort((a, b) => b.scoreTotal - a.scoreTotal)
        .slice(0, 10);

    container.innerHTML = `
        <header class="stats-header">
            <h1>🎮 ${stats.jeu.toUpperCase()}</h1>
        </header>

        <div class="stats-grid">
            <!-- Vue d'ensemble -->
            <div class="stats-card highlight">
                <h2>📊 Vue d'ensemble</h2>
                <div class="stats-content">
                    <p><strong>Parties jouées :</strong> ${stats.totalParties}</p>
                    <p><strong>Joueurs uniques :</strong> ${stats.joueursUniques.size}</p>
                    <p><strong>Score moyen :</strong> ${stats.scoreMoyen}</p>
                </div>
            </div>

            <!-- Meilleur score -->
            <div class="stats-card">
                <h2>🏆 Record</h2>
                <div class="stats-content">
                    ${stats.meilleurScore.joueur ? `
                        <p><strong>${stats.meilleurScore.joueur}</strong></p>
                        <p class="big-number">${stats.meilleurScore.score}</p>
                        <p class="small-text">${new Date(stats.meilleurScore.date).toLocaleDateString()}</p>
                    ` : '<p>Aucun score enregistré</p>'}
                </div>
            </div>

            <!-- Classement -->
            <div class="stats-card">
                <h2>🌟 Classement</h2>
                <div class="stats-content">
                    ${topJoueurs.map((joueur, index) => `
                        <div class="stat-bar">
                            <span>${index + 1}. ${joueur.nom}</span>
                            <span>
                                <strong>${joueur.scoreTotal}</strong> pts
                                (moy: ${Math.round(joueur.scoreMoyen)})
                            </span>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>

        <button id="btn-retour-jeu" class="btn-retour">
            ⬅️ Retour
        </button>
    `;

    $("btn-retour-jeu").onclick = () => afficherSelectionJeu();
}