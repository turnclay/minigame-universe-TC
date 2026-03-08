// /public/js/modules/parties.js
// Stub de compatibilité pour les modules de jeu

import { GameState } from "../core/state.js";

/**
 * Crée une nouvelle partie (côté client — persisté en sessionStorage).
 * Dans la nouvelle architecture, la partie est créée via le host/WS.
 * Ce module maintient la compatibilité avec les jeux qui l'importent.
 */
export function creerNouvellePartie(config = {}) {
    const partie = {
        id:       config.id || Date.now(),
        jeu:      config.jeu       || GameState.jeu,
        mode:     config.mode      || GameState.mode,
        joueurs:  config.joueurs   || GameState.joueurs,
        equipes:  config.equipes   || GameState.equipes,
        scores:   config.scores    || {},
        nomPartie: config.nomPartie || "",
        date:     new Date().toISOString(),
    };

    try {
        sessionStorage.setItem("mgu_game_session", JSON.stringify({
            ...JSON.parse(sessionStorage.getItem("mgu_game_session") || "{}"),
            ...partie
        }));
    } catch {}

    return partie;
}