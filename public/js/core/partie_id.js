// /js/core/partie_id.js
// ============================================================
// Helper unique pour l'ID de la partie courante côté hôte.
//
// Source de vérité = `minigame_partie_id` (clé canonique).
//
// Avant P4, trois clés cohabitaient dans localStorage :
//   - minigame_partie_id          (canonique, écrite par host_session)
//   - minigame_partie_session_id  (legacy, écrite par invite.js)
//   - ws_partie_id                (legacy, jamais écrite mais lue)
//
// La duplication faisait que chaque module avait sa propre logique
// de fallback à 2 ou 3 niveaux, source de bugs subtils si l'ordre des
// écritures variait.
//
// Pendant la transition P4→P5, ce helper :
//   1. lit en priorité la clé canonique, fallback sur les legacy
//      (migration douce — la première lecture promeut le legacy
//      en canonique) ;
//   2. à l'écriture, alimente aussi les 2 legacy en MIROIR pour que
//      les modules non-WS (pendu, morpion, lml, petitbac, puissance4,
//      mimedessine, justeprix, undercover) continuent à fonctionner
//      sans modification.
//
// Quand P5 aura migré tous les jeux vers WS-server-driven, les
// écritures miroir et la migration douce pourront être supprimées
// (ne garder que CANONICAL_KEY).
// ============================================================

const CANONICAL_KEY = 'minigame_partie_id';
const LEGACY_KEYS   = ['minigame_partie_session_id', 'ws_partie_id'];

// Retourne l'ID de la partie courante, ou null si aucune partie active.
// Migration douce : si la canonique est vide mais qu'une legacy existe,
// elle est promue (la lecture suivante la trouvera canonique).
export function getPartieId() {
    const id = localStorage.getItem(CANONICAL_KEY);
    if (id) return id;

    for (const k of LEGACY_KEYS) {
        const legacy = localStorage.getItem(k);
        if (legacy) {
            localStorage.setItem(CANONICAL_KEY, legacy);
            console.log(`[PARTIE_ID] 🔁 Migration douce : ${k} → ${CANONICAL_KEY}`);
            return legacy;
        }
    }
    return null;
}

// Écrit l'ID dans la clé canonique ET dans les 2 miroirs legacy
// (transition P4→P5 — voir bandeau).
export function setPartieId(id) {
    if (!id) return;
    localStorage.setItem(CANONICAL_KEY, id);
    LEGACY_KEYS.forEach(k => localStorage.setItem(k, id));
}

// Supprime toutes les clés (canonique + legacy) en une seule opération.
export function clearPartieId() {
    localStorage.removeItem(CANONICAL_KEY);
    LEGACY_KEYS.forEach(k => localStorage.removeItem(k));
}
