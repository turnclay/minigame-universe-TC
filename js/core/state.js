// /js/core/state.js

export const GameState = {
    mode: null,           // "solo" | "team"
    jeu: null,            // Jeu sélectionné
    jeuActuel: null,      // Jeu en cours
    partieNom: "",        // Nom de la partie
    joueurs: [],          // Liste des joueurs (mode solo)
    equipes: [],          // Liste des équipes (mode team)
    scores: {},           // Scores de la partie en cours { joueur/équipe: points }
    partieEnCoursChargee: false
};