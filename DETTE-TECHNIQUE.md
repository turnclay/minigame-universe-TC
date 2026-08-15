DETTE-TECHNIQUE.md
Maintenu manuellement. CLAUDE.md met à jour ce fichier après résolution d'un point —
jamais reformulé dans les 3 agents.

OUVERTE

L1b — Ancien schéma getAllParties()/nomPartie (storage.js)
Constat 2026-08-01 : le schéma localStorage 'parties' (storage.js : getAllParties, saveNewParty, loadPartyById, saveGame, deleteParty) est consommé par 4 fichiers, pas seulement parties.js : modules/equipes.js (L387, L590), modules/joueurs.js (L237), modules/statistiques.js (L14, L94, L171). migrations.js fait un correctif one-shot (sessionId + nomPartie) mais ne touche à rien d'autre. Un refactor de parties.js seul casserait équipes/joueurs/statistiques.
Action : en attente. Nécessite equipes.js, joueurs.js, statistiques.js pour scoper un refactor complet.

L1c — Contournement de partie_id.js (LOT-PARTIE-ID-BYPASS)
Constat 2026-08-01 : 6 fichiers lisent minigame_partie_session_id en dur au lieu de passer par getPartieId() (core/partie_id.js) : parties.js (L186), undercover_hote.js (getSid(), L20), memoire_hote.js (L28-30), morpion_hote.js (L16-18), puissance4_hote.js (L15-17). Les 3 derniers portent en plus un commentaire erroné ("Lire ws_partie_id — source de vérité") — partie_id.js documente lui-même ws_partie_id comme legacy jamais écrite ; la vraie clé canonique est minigame_partie_id.
Action : en attente. Fix mécanique (faire pointer vers getPartieId()), risque faible, 6 fichiers à traiter. Indépendant de L1b — peut être déclenché seul.

LOT-PETITBAC-CLIENT — groupé le 2026-07-19, à traiter ensemble (validation Clayton requise pour déclenchement)
  PB1 — Listeners WS non nettoyés (public/js/jeux/petitbac.js)
  _abonnerEvenements() souscrit 5 events serveur sans garde d'idempotence ni fonction off()/cleanup. resetJeu() ne réinitialise que des variables locales.
  Fix proposé : garde d'idempotence + fonction de nettoyage (socket.off) sur le modèle de petitbac_hote.js.

  PB2 — Double listener WS jeux/petitbac.js ↔ modules/petitbac_hote.js
  PETITBAC_MANCHE_START, PETITBAC_REVELATION, PETITBAC_RESPONSE_IN sont chacun écoutés à deux endroits, causant un double rendu du panneau résultats à chaque event (hérité aussi par le flux d'invalidation PB7).
  Fix proposé : centraliser l'abonnement dans un seul des deux modules.

  PB6 — Normalisation apostrophe/espace/tiret divergente (3 fonctions)
  dictionnaires.js._normaliser strip apostrophe droite ET courbe. wikidata-validator.js.normaliser et petitbac.js._normCmp ne strippent que l'apostrophe droite. petitbac.js._normCmp strip en plus espaces/tirets pour l'unicité.
  Fix proposé : harmoniser sur la version dictionnaires.js dans les 3 fichiers.

PB8 — Invalidation post-révélation sans recalcul cascade de l'unicité
Constat 2026-07-19 : invalider la réponse d'un joueur compté en doublon ne repasse pas l'autre joueur en 'unique'. Comportement volontaire assumé pour cette livraison.
Action : en attente de décision Clayton — cascade ou pas.

DETTE MINEURE — cleE() mort dans undercover_hote.js
Constat 2026-08-01 : const cleE = () => `partie_etat_${getSid()}` (L22, après résolution L1a) est défini mais jamais appelé — dead code résiduel, distinct des appels signalDemarrage/partie_etat_ déjà retirés. Faible priorité, non traité (hors validation explicite reçue).
Action : en attente, optionnel.

RÉSOLUE

L1a — signal.js + public/js/jeux/undercover.js (legacy) supprimés
Résolu le 2026-08-01 : diagnostic complet croisé sur undercover_hote.js (actuel, WS), undercover.js (jeux/, legacy pré-WS) et undercover_player.js. Aucun des 3 fichiers n'appelle ecouterSignal() — personne n'écoute partie:signal, les écritures signalDemarrage() étaient inertes. Le vrai mécanisme de démarrage est déjà 100% WS (HostSession.notifierDemarrage() → GAME_STARTED), déjà en place à côté des appels signal.js morts. public/js/jeux/undercover.js confirmé non référencé (grep PowerShell de Clayton, zéro résultat) — c'était une version legacy quasi-complète (2604 lignes de diff) de undercover_hote.js, jamais nettoyée après la migration WS.
Action :
  - public/js/jeux/undercover.js supprimé (fichier mort).
  - public/js/core/signal.js supprimé (fichier mort, plus aucun appelant).
  - undercover_hote.js : import signalDemarrage retiré, 2 blocs d'appel retirés (lancerNouvellePartie() + flux principal de lancement), y compris les écritures localStorage.setItem('partie_etat_'+sid, 'en_cours') aux mêmes emplacements (même patron mort, même passe).
  - cleanup.js : 'partie:signal' retiré de CLES_EXACTES_BASE (clé plus jamais écrite).
  node --check validé sur undercover_hote.js et cleanup.js.
Note : l'entrée L1 originale attribuait à tort cette dépendance à parties.js — corrigé lors du diagnostic (voir L1b/L1c pour les vrais problèmes de parties.js, non résolus).

PB7 — Contrôle post-révélation (invalidation manuelle) + visibilité des réponses hôte côté invités
Résolu le 2026-07-19 : server/games/petitbac.js — HOST_ACTION petitbac:invalidate (phase 'resultats'), statut → 'annule', points → 0, recalcul r.score, store.modifierScore(delta négatif), fonctionne aussi sur le pseudo de l'hôte. petitbac_hote.js — bouton 🚫 par chip, listener délégué unique. petitbac_player.js — capture snapshot.hostPseudo, section "Réponses de l'hôte" affichée si l'hôte a joué. Voir PB8 pour une limite connue (pas de recalcul cascade).

PB4 — Catégorie "celebrite" : Wikidata retiré, lettre seule conservée
Résolu le 2026-07-19 : célébrité reste active dans CATEGORIES, absente de CAT_DICO et CAT_WIKIDATA → validée sur la première lettre uniquement (même mécanisme que "prenom"). Débat de validité entre joueurs, hors app, corrigeable a posteriori via PB7.

PB5 — PETITBAC_TIMER_EXPIRED n'atteignait jamais les invités
Résolu le 2026-07-19 : broadcastToHost → broadcastToGame (petitbac.js). Un invité n'ayant pas validé à temps disparaissait de la révélation faute d'auto-soumission reçue.

PB3 — Ambiguïté validation catégorie "personnage" (dico statique vs Wikidata)
Résolu le 2026-07-19 (analyse) : fallback volontaire et documenté dans _estValideAsync (priorité dico statique > Wikidata > lettre seule). Rien à corriger.

RÉSOLUE — UNO réenregistré dans JEU_HANDLERS
Le 2026-07-13T21:53:14.169+02:00, server/ws-handler.js importe désormais server/games/uno.js. Handlers UNO actifs, state géré côté serveur.

L5 — Clés localStorage consolidées
3 clés (minigame_partie_session_id, ws_partie_id, minigame_partie_id) consolidées en une
clé canonique unique via partie_id.js + migration résiduelle one-shot. scoreboard.js migré
vers getPartieId().

L6 — STATUTS centralisés
STATUTS exporté depuis store.js (Object.freeze), propagé dans ws-handler.js et index.js.
Helpers estStatutTerminal / estStatutLobby utilisent STATUTS.*. Alias legacy supprimés.

PRINCIPES ISSUS DE LA DETTE (à ne pas redémontrer à chaque session)
- Dictionnaires Petit Bac : TXT uniquement depuis v3.0 (dictionnaires.js). Support Bloom
  supprimé — ne plus référencer .bloom comme priorité de chargement.
- Priorité de validation par catégorie (petitbac.js._estValideAsync) : dico statique >
  Wikidata live (personnage uniquement, si dico absent) > lettre seule (prenom, celebrite).
- Petit Bac : 10 catégories actives. Célébrité = lettre seule, validation sociale entre
  joueurs, corrigeable a posteriori via le contrôle d'invalidation hôte (PB7/PB8).
- Scoring d'unicité Petit Bac : validation à la révélation, jamais à la soumission
  individuelle. Invalidation post-révélation sans recalcul cascade (PB8).
- Une régression sur un fichier déjà patché vient quasi systématiquement d'un repo non mis
  à jour entre sessions — toujours vérifier PROJECT-STATE.md avant de repatcher un fichier
  "déjà corrigé".
- Undercover : signal.js et son mécanisme localStorage cross-tab sont morts depuis la
  migration WS (HostSession.notifierDemarrage() est la vraie source). Vérifier ce même
  patron ("legacy jamais nettoyé après migration WS") sur d'autres jeux avant de conclure
  trop vite qu'un ancien mécanisme est encore actif.
- Le contournement de partie_id.js par lecture brute de minigame_partie_session_id est
  répandu (6 fichiers, L1c) — toujours vérifier getPartieId() en premier avant d'ajouter
  un nouveau fallback localStorage dans un module hôte.

SUR L'HORIZON
- L1b — refactor getAllParties()/nomPartie (storage.js), 4 fichiers, en attente
- L1c — LOT-PARTIE-ID-BYPASS, 6 fichiers, en attente
- LOT-PETITBAC-CLIENT (PB1/PB2/PB6) — groupé, en attente de déclenchement Clayton
- PB8 — décision cascade unicité sur invalidation, en attente
- DETTE MINEURE — cleE() mort dans undercover_hote.js, en attente (optionnel)
- Process de merge pour éviter les régressions répétées sur les mêmes fichiers