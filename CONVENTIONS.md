CONVENTIONS.md
Version : 2026-07 — optimisée tokens
Ce fichier est la SEULE source des règles de forme. CLAUDE.md, JEUX.md et QA.md ne les
répètent jamais — ils y renvoient. Si une règle ci-dessous est absente d'un agent, c'est
volontaire : elle vit ici.

PIPELINE OBLIGATOIRE
ARCHITECTE (CLAUDE.md) → JEUX (JEUX.md) → QA (QA.md)
Aucun agent ne saute l'étape précédente sauf instruction explicite de Clayton.

CONTRAT DE HANDOFF ENTRE AGENTS
CLAUDE → JEUX : fichiers concernés, flux WS impliqués, risques, plan d'action.
JEUX → QA     : events WS ajoutés/modifiés, points de scoring touchés, fichiers livrés.
QA → CLAUDE/JEUX : anomalie, fichier(s), étapes de repro, cause probable, agent responsable.

PROTOCOLE DE DÉMARRAGE DE SESSION (réduction tokens — priorité absolue)
1. Lire PROJECT-STATE.md en premier. Jamais relire tout le repo par défaut.
2. Se limiter aux fichiers listés "modifiés depuis le push précédent" dans PROJECT-STATE.md
   + aux fichiers explicitement visés par la demande de Clayton.
3. Un audit complet du repo n'est déclenché que sur demande explicite ("audit complet",
   "relis tout", "reprends depuis zéro").
4. Ne jamais redemander à Clayton un fichier déjà présent dans les Project files.
5. Consulter DETTE-TECHNIQUE.md pour le contexte historique au lieu de le faire répéter
   par Clayton à chaque session.
6. Si PROJECT-STATE.md indique une régression sur un fichier "déjà corrigé" : la cause
   quasi certaine est un repo non mis à jour entre sessions, pas un nouveau bug — vérifier
   avant de repartir sur un diagnostic complet.

FORMAT DE LIVRAISON
- Fichiers complets (jamais de diffs partiels), sans commentaires inline ni explications
  intercalées dans le code livré.
- Scripts de patch Python : assertion "exactement 1 match" par remplacement + node --check
  après patch.
- Style de réponse : ultra-direct, structuré, français, zéro blabla.
- Une proposition = Audit → Options (2-3, avec risques) → Implémentation après validation
  explicite de Clayton.

RÈGLE /simplify
Autorisé uniquement pour clarifier du code ou un rapport (lisibilité, duplication réduite,
fonctions trop complexes). Jamais pour :
- changer un flux WS, un état partagé, une transition, le scoring
- introduire une divergence host/invités
Toute simplification doit rester validée par CLAUDE.md si elle touche un module sensible.

SOURCE DE VÉRITÉ
Serveur / WebSocket / store.js. Aucun client ne maintient de state parallèle. UI toujours
dérivée de l'état serveur (snapshot, getSessionState, SCORES_UPDATE).

RÈGLES DE SÉCURITÉ (les 3 agents)
Ne jamais : supprimer un fichier sans justification écrite, casser la synchro WS, introduire
une nouvelle source de vérité côté client, modifier la structure globale sans plan validé,
introduire un comportement non déterministe.