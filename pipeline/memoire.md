# Documentation — Pipeline du jeu **Mémoire** (MiniGame Universe)

> **Avertissement factuel préalable (règle : ne rien inventer).**
> Après analyse des fichiers fournis, **le jeu Mémoire — comme l'ensemble du projet MiniGame Universe — ne comporte aucun pipeline IA** : pas d'appel à un modèle de langage, pas de prompt, pas d'« arbitre IA », aucun `fetch` vers une API de modèle (`api.anthropic.com`, OpenAI, etc.). Les données sont **soit tirées de fichiers JSON statiques** (quiz, pendu, undercover, mimedessine…), **soit générées localement de façon déterministe** (Mémoire). La validation et le score reposent sur des **formules déterministes**, et la synchronisation sur **WebSocket**.
> Les fichiers `CLAUDE.md`, `JEUX.md`, `QA.md` sont des **agents de processus de développement** (rôles Architecte / Développeur de jeux / QA pour l'assistant qui code), **pas** des agents IA exécutés pendant une partie.
>
> En conséquence, ce document décrit le **pipeline réel de traitement et de synchronisation** de Mémoire. Là où le plan demandé présuppose une étape IA (prompt, appel modèle, arbitre IA), l'absence est **signalée explicitement** et l'élément déterministe qui en tient lieu est identifié.

---

## A. Présentation générale du jeu

- **Nom** : Mémoire (libellé d'accueil « Mémoire Flash »).
- **Fichiers principaux** :
  - `public/js/jeux/memoire.js` — module **hôte** (logique de jeu + transport).
  - `public/js/modules/memoire_player.js` — module **invité** (rejoue le défi côté invité).
  - `server/games/memoire.js` — **handler serveur** (autorité : timing, scores, transition `resultats`).
  - `public/js/modules/memoire_hote.js` — **module hôte legacy** (synchro `localStorage`), **superseded** par la migration WS (voir §G).
  - `public/index.html` — section `#memoire` (conteneur hôte).
  - `public/jeu.html` + `public/js/jeu.js` — point d'entrée invité (`#jeu-contenu`).
- **Objectif** : mémoriser puis reproduire une information affichée brièvement, à travers **4 défis** × **3 difficultés**.
  - `paires` (mémoriser des cartes, retrouver les paires),
  - `suite` (mémoriser une séquence de nombres/symboles),
  - `couleurs` (mémoriser un ordre de couleurs),
  - `symboles` (mémoriser la position de symboles sur une grille).
  - Score selon le nombre d'**erreurs** comparé à un **seuil** par difficulté (`DEFIS_CONFIG`).
- **Rôles impliqués** :
  - **Hôte** : choisit défi + difficulté, **génère les données une seule fois**, joue lui aussi, pilote les transitions (`memoire.js`).
  - **Invité(s)** : reçoivent les mêmes données, rejouent en parallèle, soumettent leur résultat (`memoire_player.js`).
  - **Serveur (arbitre déterministe, PAS une IA)** : horodate la mémorisation (`tsAffichageFin`), crédite les scores (`store`), décide la transition `resultats` quand tous ont soumis (`server/games/memoire.js`).
  - **Scoreboard** : affichage des scores (`public/js/modules/scoreboard.js`, fonctions `afficherScoreboard`, `ajouterPoints`).
- **Résumé du fonctionnement** : jeu **simultané, piloté serveur**. L'hôte génère la grille/séquence une fois ; le serveur la rediffuse à tous (mêmes données) ; chacun joue sur son écran ; chacun calcule ses erreurs et son score (même formule) et le soumet ; le serveur crédite et diffuse les scores ; quand **tous** ont soumis, le serveur déclenche la phase de classement.

---

## B. Pipeline — vue d'ensemble

Chaîne d'étapes réelle (l'étape « appel modèle IA » est **absente** ; remplacée par une décision déterministe) :

1. **Entrée joueur** — choix défi/difficulté (hôte) ; clics de jeu (hôte & invités).
2. **Collecte / relais backend** — actions `HOST_ACTION` / `PLAYER_ACTION` via WebSocket → `server/ws-handler.js` → `server/games/memoire.js`.
3. **Construction du prompt** — **❌ INEXISTANT** (aucun prompt). À la place : **génération déterministe des données** côté hôte (`genererDefi*`) + sérialisation dans l'action `memoire:defi`.
4. **Appel au modèle IA** — **❌ INEXISTANT**. À la place : **arbitrage déterministe serveur** (horodatage `tsAffichageFin`, validation des résultats, crédit `store`).
5. **Traitement de la réponse** — chaque client calcule ses **erreurs** puis son **score** par formule (`calculerScore` hôte / formule identique invité) ; le serveur valide et crédite.
6. **Mise à jour de l'état du jeu** — `phase` serveur (`menu → countdown → affichage → jeu → resultats`), scores `store`, `resultats[pseudo]`.
7. **Diffusion multi-écran** — `MEMOIRE_DEFI`, `MEMOIRE_PHASE`, `MEMOIRE_RESULT_IN`, `SCORES_UPDATE` (WebSocket).
8. **Boucle suivante** — « Rejouer » (hôte) → nouveau `memoire:defi` phase `countdown` (manche++, reset).

---

## C. Détails du pipeline (étape par étape)

### Étape 1 — Entrée joueur
- **Description** : l'hôte sélectionne la difficulté (`diff-btn`) et clique une carte de défi (`jouer-defi`) dans le menu ; les joueurs cliquent ensuite sur les cartes/cases/touches du défi.
- **Fichiers** : `public/js/jeux/memoire.js` (`afficherMenuDefis`, `attacherEvenementsMenu`), `public/js/modules/memoire_player.js` (handlers de clic par défi).
- **Fonctions** : `afficherMenuDefis()`, `attacherEvenementsMenu()`, `lancerDefi(typeDefi)`.
- **Données échangées** : aucune encore vers le serveur (préparation locale).
- **Rôle IA** : aucun. **Rôle backend** : aucun à ce stade. **Rôle écrans** : rendu du menu (`#memoire`).

### Étape 2 — Génération des données (tient lieu de « construction du prompt »)
- **Description** : après un compte à rebours visuel, l'hôte **génère les données une seule fois** (mêmes données pour tous).
- **Fichiers** : `memoire.js`.
- **Fonctions** : `afficherCompteARebours(cb)` puis, dans le callback, `genererDefiPaires`, `genererDefiSuite`, `genererDefiCouleurs`, `genererDefiSymboles` ; `shuffleArray`.
- **Données** : `donnees` (tableau de symboles / séquence / `{couleurs:[…]}` / `{positions, grille, total}`) ; `config` (issu de `DEFIS_CONFIG[type].difficultes[diff]`).
- **Rôle IA** : **❌ aucun prompt, aucune génération par modèle** — génération pseudo-aléatoire locale (`Math.random` via `shuffleArray`).

### Étape 3 — Publication / relais backend
- **Description** : l'hôte publie le défi (phase `countdown` puis `affichage`) ; le serveur rediffuse à tous.
- **Fichiers** : `memoire.js` (stubs transport `_publierDefi`, `_publierPhase`), `server/ws-handler.js` (routage), `server/games/memoire.js` (`handleHostAction`).
- **Fonctions / actions** :
  - Hôte → `socket.send('HOST_ACTION', { action:'memoire:defi', data:{ typeDefi, difficulte, donnees, phase, config, base } })`.
  - Serveur `handleHostAction` case `'defi'` → calcule `tsAffichageFin` (si `affichage`) → `broadcastToGame('MEMOIRE_DEFI', …)`.
- **Données** : `{ typeDefi, difficulte, donnees, phase, config, base, tsAffichageFin, manche, scores }`.
- **Rôle backend (arbitre déterministe)** : **horodatage autoritaire** de la fin de mémorisation (`_dureeMemo`), conservation de l'état de session.

### Étape 4 — Réception & rendu côté invité
- **Description** : l'invité reçoit `MEMOIRE_DEFI` et rejoue **le même défi** dans `#jeu-contenu`.
- **Fichiers** : `public/js/modules/player.js` (relais `gameEvents` → `onWsEvent`), `memoire_player.js`.
- **Fonctions** : `MemoireModule.onWsEvent('MEMOIRE_DEFI')` → `_onDefi()` → `_demarrer(phase, reste)` → `_renderPaires/_renderSuite/_renderCouleurs/_renderSymboles`.
- **Données** : identiques à l'hôte ; `reste = tsAffichageFin - Date.now()` (temps de mémorisation restant, **source serveur**).
- **Rôle écrans** : affichage mémorisation puis bascule en saisie (timer local **borné par `tsAffichageFin`**).

### Étape 5 — Saisie, validation & score (tient lieu de « traitement réponse IA »)
- **Description** : chaque joueur reproduit, le client compte les **erreurs** et calcule le **score**.
- **Fichiers** : `memoire.js` (hôte), `memoire_player.js` (invité).
- **Fonctions** :
  - Hôte : `activerClicCartes`, `validerSuite`, `validerCouleurs`, `validerSymboles` → `afficherResultat` → `calculerScore`.
  - Invité : `_pairesEnable`, `_suiteEnable`, `_couleursEnable`, `_symbolesEnable`/`_validerSymboles` → `_submit(erreurs)`.
- **Formule (identique des deux côtés)** : `score = erreurs > seuil ? 0 : (erreurs === 0 ? base : 1)`.
- **Rôle IA** : **❌ aucun** — validation purement déterministe.

### Étape 6 — Soumission & crédit (arbitrage serveur)
- **Description** : chaque résultat est envoyé au serveur, qui crédite et diffuse.
- **Fichiers** : `server/games/memoire.js` (`_enregistrerResultat`), `memoire.js` (stub `_crediterPts`), `memoire_player.js` (`_submit`).
- **Fonctions / actions** :
  - Invité → `PLAYER_ACTION { action:'memoire:result', data:{ erreurs, score } }`.
  - Hôte → `HOST_ACTION { action:'memoire:result', data:{ pseudo, erreurs, score } }`.
  - Serveur → `store.modifierScore(partieId, pseudo, score)` ; `MEMOIRE_RESULT_ACK` (auteur), `MEMOIRE_RESULT_IN` (hôte), `SCORES_UPDATE` (tous).
- **Rôle backend** : **seule autorité des scores** (anti double-crédit, idempotence via `s.resultats[pseudo]`).

### Étape 7 — Mise à jour d'état & diffusion multi-écran
- **Description** : l'état serveur évolue ; les écrans se synchronisent.
- **Fichiers** : `server/games/memoire.js`, `memoire.js` (écoute `MEMOIRE_RESULT_IN`, `SCORES_UPDATE`), `memoire_player.js` (`onScores`, `_onPhase`), `player.js` (relais `SCORES_UPDATE` → `onScores`).
- **Transition clé** : si `allDone` (tous ont soumis) → serveur passe `phase='resultats'` et `broadcastToGame('MEMOIRE_PHASE',{phase:'resultats'})`.

### Étape 8 — Boucle suivante
- **Description** : « Rejouer ce défi » (hôte) relance le pipeline.
- **Fichiers / fonctions** : `memoire.js` `afficherResultat` → bouton `#btn-rejouer` → `lancerDefi(defiActuel)` → `memoire:defi` phase `countdown` (serveur : `manche++`, `resultats={}`, `donnees=null`).

---

## D. États du jeu et transitions

| État | Entrée | Sortie | Événement déclencheur | Rôle serveur (arbitre, pas IA) |
|---|---|---|---|---|
| `menu` | init / retour menu | l'hôte lance un défi | `afficherMenuDefis` (hôte) ; `memoire:defi {phase:'menu'}` | rediffuse `MEMOIRE_DEFI` (donnees nulles) |
| `countdown` | hôte lance un défi | fin du compte à rebours | `lancerDefi` → `memoire:defi {phase:'countdown'}` | `manche++`, reset `resultats`/`donnees`/`tsAffichageFin` |
| `affichage` | données générées | fin de mémorisation | `memoire:defi {phase:'affichage', donnees}` | fixe `tsAffichageFin = now + _dureeMemo` |
| `jeu` | mémorisation terminée | tous ont soumis | hôte `memoire:phase {phase:'jeu'}` (indicatif) ; timer local invité | conserve la phase ; accepte les résultats |
| `resultats` | **tous** ont soumis | nouvelle manche / menu | **serveur** sur `allDone` → `MEMOIRE_PHASE {phase:'resultats'}` | **décision déterministe de transition** |

- **Conditions d'entrée/sortie** : la progression `menu→countdown→affichage→jeu` est pilotée par l'hôte ; **`resultats` est piloté par le serveur** (déterministe, sur `allDone = nbResults >= nbJoueurs`).
- **Rôle de l'IA dans les transitions** : **aucun**. Toutes les transitions sont déterministes.

---

## E. Prompts et agents IA

- **Prompts** : **❌ INEXISTANTS.** Aucun fichier ne construit ni n'envoie de prompt. Aucune variable dynamique de prompt. (À signaler explicitement comme demandé.)
- **Appel modèle / arbitre IA** : **❌ INEXISTANT.** L'« arbitre » est le **handler serveur déterministe** `server/games/memoire.js` :
  - *rôle* : autorité timing + scores + transition `resultats` ;
  - *structure* : `handleHostAction` / `handlePlayerAction` / `_enregistrerResultat` / `getSessionState` ;
  - *variables dynamiques* : `partieId`, `pseudo`, `erreurs`, `score`, `config`, `donnees`, `manche` ;
  - *risques* : confiance au `score` calculé client (voir §G) ;
  - *améliorations* : recalcul serveur du score (voir §H).
- **Agents `.md`** : `CLAUDE.md` (Architecte), `JEUX.md` (Développeur de jeux), `QA.md` (QA) décrivent des **rôles de développement** (contraintes : serveur source de vérité, pas de timers locaux non synchronisés, pas de listeners dupliqués, robustesse reconnexion…). Ils **n'interviennent pas à l'exécution** du jeu. À ne pas confondre avec des agents IA runtime.

---

## F. Synchronisation multi-écran

### Messages WebSocket (contrat vérifié 1:1)
- **Client → Serveur** :
  - `HOST_ACTION memoire:defi { typeDefi, difficulte, donnees, phase, config, base }`
  - `HOST_ACTION memoire:phase { phase }` (`countdown`/`affichage`/`jeu` ; `resultats` **ignoré** côté serveur car autoritaire)
  - `HOST_ACTION memoire:result { pseudo, erreurs, score }`
  - `PLAYER_ACTION memoire:result { erreurs, score }`
- **Serveur → Clients** :
  - `MEMOIRE_DEFI { typeDefi, difficulte, donnees, phase, config, base, tsAffichageFin, manche, scores }` (tous)
  - `MEMOIRE_PHASE { phase, manche }` (tous)
  - `MEMOIRE_RESULT_IN { pseudo, erreurs, score, nbResults, nbJoueurs, allDone }` (hôte)
  - `MEMOIRE_RESULT_ACK { status }` (auteur)
  - `SCORES_UPDATE { scores }` (tous)

### Flux
- **Hôte → backend → invités** : `memoire:defi`/`memoire:phase` → `ws-handler` (routage par préfixe `memoire:`) → `handleHostAction` → `broadcastToGame` → `player.js` relaie `MEMOIRE_*` à `MemoireModule.onWsEvent`.
- **« IA » → backend → écrans** : **N/A** (pas d'IA). Le **backend déterministe** → `MEMOIRE_RESULT_IN`/`SCORES_UPDATE` → hôte (suivi + scoreboard) et invités (`onScores`).

### Gestion des erreurs
- `MEMOIRE_RESULT_ACK { status: 'too_late' | 'invalid' | 'already' | 'ok' }`.
- `ws-handler.js` enveloppe `handleHostAction`/`handlePlayerAction` dans un `try/catch` qui **logge sans renvoyer `INTERNAL_ERROR`** (le jeu continue).
- Envois bornés (`Math.max/Math.min`) côté serveur sur `erreurs`/`score`.

### Gestion des déconnexions / refresh
- **Reprise d'état** : `getSessionState(partieId)` renvoie `{ phase, typeDefi, difficulte, donnees, config, base, tsAffichageFin, manche, scores }`.
- **Invité** : `initPlayer(gameState)` → `_onDefi(gameState)` rejoue la phase courante :
  - `affichage` → mémorisation du **temps restant** via `tsAffichageFin` ;
  - `jeu` → **saisie directe** (mémo déjà passée) ;
  - `resultats` → écran de **classement**.
- **Hôte** : transport recâblé idempotent (`socket._memoireHoteBound`) ; mode **solo** intact si `_nbInvites() <= 0`.

---

## G. Analyse critique (factuelle)

**Bugs / manques corrigés lors de la migration WS** (référence, déjà traités) :
1. Reconnexion invité en phase `jeu` : restait bloqué (l'ancien `_onDefi` ne gérait que `affichage`). **Corrigé** (saisie directe).
2. Transition non déterministe : l'hôte forçait `resultats` à sa fin, coupant les invités. **Corrigé** (serveur sur `allDone`).
3. Timing non autoritaire : durée d'affichage purement locale. **Corrigé** (`tsAffichageFin` serveur).
4. Timers concurrents possibles côté invité. **Corrigé** (garde de génération `_gen` + registre `_timers`).

**Points encore ouverts / à surveiller :**
- **`memoire_hote.js` (legacy `localStorage`) toujours présent** : superseded par le transport WS de `memoire.js`. **Manque** : il n'est plus importé par le chemin WS → **code mort** à retirer pour éviter la confusion (risque qu'un futur contributeur le recâble). *Signalé, non supprimé ici.*
- **Score calculé côté client puis crédité par le serveur** : le serveur **fait confiance** au `score` reçu (il borne mais ne recalcule pas). Incohérence possible si un client modifie le score. *Voir §H (recalcul serveur).*
- **Timer de mémorisation de l'hôte** : l'hôte utilise son `animerTimer(config.tempsAffichage)` **local** (non aligné sur `tsAffichageFin`), seuls les invités s'alignent sur l'horloge serveur. Écart = latence réseau (sous-seconde) ; **pas de divergence d'état** (chaque joueur joue son propre plateau) mais légère asymétrie d'équité. *Signalé.*
- **Reconnexion invité pendant `couleurs`/`affichage`** : l'animation de séquence est rejouée **en entier** (pas de reprise partielle de l'index), faute de position de séquence dans l'état serveur. *Manque mineur, signalé.*
- **`allDone` dépend de `partie.joueurs.length`** : si l'hôte est compté différemment des invités, ou si un invité se déconnecte sans soumettre, `resultats` peut ne jamais se déclencher automatiquement. **Manque** : pas de « révélation forcée » par l'hôte pour Mémoire (contrairement au Pendu). *Signalé.*
- **Aucune IA** : conforme à l'état du code (à confirmer si une IA était attendue — elle n'existe nulle part).

---

## H. Pipeline recommandé (version propre et optimisée)

Objectif : stabilité, modularité, séparation des rôles, prêt pour de nouveaux jeux — **sans introduire d'IA** (aucune n'est requise par le gameplay).

1. **Machine à états centralisée côté serveur** (déjà amorcée) : `phase` unique source de vérité ; transitions `menu→countdown→affichage→jeu→resultats` ; **toutes** les transitions sensibles (notamment `resultats`) décidées serveur. Ajouter une transition de secours : « révélation forcée par l'hôte » (action `memoire:force_resultats`) pour éviter le blocage si un invité ne soumet pas.
2. **Score recalculé côté serveur** : envoyer seulement `{ erreurs }` ; le serveur calcule `score = erreurs > seuil ? 0 : (erreurs===0 ? base : 1)` à partir du `config` qu'il détient déjà → supprime la confiance au client (cohérence + anti-triche). La formule reste **unique** (côté serveur).
3. **Position de mémorisation dans l'état** : pour `couleurs`, stocker l'index courant / `tsDebutAffichage` afin de permettre une **reprise partielle** propre à la reconnexion.
4. **Suppression du legacy** : retirer `memoire_hote.js` (`localStorage`) une fois la migration validée ; ne conserver que le transport WS.
5. **Contrat d'événements documenté et figé** : `MEMOIRE_DEFI / MEMOIRE_PHASE / MEMOIRE_RESULT_IN / MEMOIRE_RESULT_ACK / SCORES_UPDATE` — exactement le set actuel.
6. **Patron réutilisable « jeu simultané »** : `server/games/<jeu>.js` exposant `handleHostAction / handlePlayerAction / getSessionState / detruireSession`, + module hôte (transport stubs) + module invité (`initPlayer/onWsEvent/onScores/destroy`, garde de génération). Mémoire devient ainsi un gabarit pour Pendu/LML et futurs jeux.

Structure cible (inchangée en fichiers, durcie en logique) :
```
server/games/memoire.js      (arbitre déterministe : timing, score, transitions)
public/js/jeux/memoire.js     (hôte : génération données + UI + transport WS)
public/js/modules/memoire_player.js (invité : rejoue défi, soumet)
public/js/modules/player.js   (relais gameEvents MEMOIRE_*)
server/ws-handler.js          (routage préfixe memoire:)
```

---

## I. Résumé final

- Mémoire est un **jeu de mémoire simultané, piloté serveur, 100 % déterministe** : **il n'y a pas d'IA, pas de prompt, pas d'arbitre IA** dans le projet. Toute mention « IA » du plan est, pour ce jeu, **sans objet** et signalée comme telle.
- Le **pipeline réel** : entrée joueur → génération déterministe des données (hôte) → diffusion WS → rendu/saisie identiques chez tous → calcul d'erreurs/score → **arbitrage serveur** (timing `tsAffichageFin`, scores `store`, transition `resultats` sur `allDone`) → diffusion multi-écran → boucle.
- **Points forts** : source de vérité serveur, contrat WS cohérent 1:1, reprise après refresh/reconnexion (`getSessionState`), pas de listeners dupliqués, garde anti-timers concurrents côté invité.
- **À corriger/étendre en priorité** : (1) recalcul du score côté serveur ; (2) retrait du legacy `memoire_hote.js` ; (3) transition de secours « révélation forcée » pour éviter tout blocage ; (4) reprise partielle de l'animation `couleurs` ; (5) alignement optionnel du timer hôte sur `tsAffichageFin`.
- Le code actuel est **exploitable et conforme** aux agents Architecte/JEUX/QA ; les évolutions ci-dessus le rendraient pleinement anti-triche et inattaquable sur les cas limites de déconnexion.
