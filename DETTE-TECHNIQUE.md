DETTE-TECHNIQUE.md
Maintenu manuellement. CLAUDE.md met à jour ce fichier après résolution d'un point —
jamais reformulé dans les 3 agents.

OUVERTE

L1 — parties.js non audité
signal.js supprimé logiquement, storage.js refactorisé en cache mémoire dérivé du serveur
(GET /api/parties). Fonctions dépréciées conservées en no-ops loggés en attente d'audit.
parties.js consomme probablement encore l'ancien schéma (getAllParties() / nomPartie).
Action : auditer parties.js, puis supprimer physiquement signal.js.

RÉSOLUE — UNO réenregistré dans JEU_HANDLERS
Le 2026-07-13T21:53:14.169+02:00, le fichier server/ws-handler.js a été vérifié et importe désormais server/games/uno.js. Les handlers UNO sont actifs et les actions préfixées "uno:" sont routées vers le handler dédié — le state UNO (deck, mains privées, effets +4) est géré côté serveur.
Action : entrée conservée pour historique. Voir PROJECT-STATE.md (commit 58faaef) pour la preuve de changement et le contexte de validation.

RÉSOLUE

L5 — Clés localStorage consolidées
3 clés (minigame_partie_session_id, ws_partie_id, minigame_partie_id) consolidées en une
clé canonique unique via partie_id.js + migration résiduelle one-shot. scoreboard.js migré
vers getPartieId().

L6 — STATUTS centralisés
STATUTS exporté depuis store.js (Object.freeze), propagé dans ws-handler.js et index.js.
Helpers estStatutTerminal / estStatutLobby utilisent STATUTS.*. Alias legacy supprimés.

PRINCIPES ISSUS DE LA DETTE (à ne pas redémontrer à chaque session)
- Priorité de chargement des dictionnaires Petit Bac : .bloom > .txt > lettre seule.
- "prenom" est la seule catégorie sans dico (lettre seule, prénoms étrangers autorisés).
- Scoring d'unicité Petit Bac : validation à la révélation (toutes les réponses
  simultanées), jamais à la soumission individuelle.
- Une régression sur un fichier déjà patché vient quasi systématiquement d'un repo non mis
  à jour entre sessions — toujours vérifier PROJECT-STATE.md avant de repatcher un fichier
  "déjà corrigé".

SUR L'HORIZON
- Suppression physique de signal.js
- Audit complet de parties.js
- Process de merge pour éviter les régressions répétées sur les mêmes fichiers
- Amélioration continue de la validation Wikidata (Petit Bac)