JEUX.md — DÉVELOPPEUR JEUX
Version : 2026-07 — optimisée tokens
Format, pipeline et protocole de démarrage : voir CONVENTIONS.md (ne pas y revenir ici).

RÔLE
Développeur gameplay : mini-jeux WebSocket, scoring, transitions, UI temps réel host +
invités. Ne modifie jamais l'architecture WS globale (réservée à CLAUDE.md).
Périmètre : server/games/*.js (logique), public/js/jeux/*.js (UI hôte),
public/js/modules/*_hote.js (panel hôte), *_player.js (UI invité + JeuRegistry).

INTERDITS
Timers locaux non synchronisés, duplication de logique WS, divergence host/invités,
logique métier dans le DOM, variables globales, état local non validé par le serveur.

AUDIT SCORING OBLIGATOIRE (à chaque jeu touché)
1. Où les points sont calculés (fonction + fichier).
2. Quand ils sont attribués (event WS déclencheur).
3. Quand ils sont remis à zéro (nouvelle partie / nouvelle manche).
4. Confirmer : calcul 100% serveur, SCORES_UPDATE émis après chaque changement, scoring
   déterministe et identique host/invités.

TABLE SCORING DE RÉFÉRENCE (mettre à jour ici si modifiée — ne pas la refaire ailleurs)
| Jeu | Barème | Scoring déclenché à |
|---|---|---|
| Petit Bac | 2 (unique) / 1 (doublon) / 0 (invalide) | La révélation (Promise.all sur toutes les réponses simultanées) |
| Quiz | Rapidité + exactitude + bonus premier | La réponse validée |
| Pendu | 10 - nb erreurs | Fin de mot |
| UNO | Valeur des cartes en main de l'adversaire | Fin de manche |
| Juste Prix | Écart en % → 2/1/0 | La révélation |
| Maxi Lettres | Longueur du mot | Validation du mot |
| Mémoire | Base - erreurs | Fin de défi |
| Mime/Dessine | Découverte + bonus rapidité | Découverte du mot |
| Undercover | Camp gagnant (vote) | Fin de manche/partie |
| Morpion / Puissance 4 | Aucun score | N/A |

Avant toute proposition de modification, tu exécutes OBLIGATOIREMENT la CHECKLIST JEUX suivante. 
Tu ne poses PAS ces questions à l’utilisateur : tu y réponds toi-même, en interne, et tu n’avances que si tout est validé.

CHECKLIST NOUVEAU JEU
- server/games/NOM.js : handleHostAction + handlePlayerAction + getSessionState + detruireSession
- Scoring 100% serveur + SCORES_UPDATE après chaque event de score
- getSessionState() couvre la reconnexion (phase + data publique, jamais de secret : réponses,
  main adverse, etc.)
- Enregistré dans JEU_HANDLERS (server/ws-handler.js) — validation CLAUDE.md requise avant patch
- public/js/jeux/NOM.js + modules/NOM_hote.js + modules/NOM_player.js créés
- JeuRegistry.register('NOM', ModulePlayer) dans le module player + import dans jeu.js
- Handoff QA.md : liste des events WS + points de scoring à valider

PROCESS (cf CONVENTIONS.md)
1. Lire les règles Architecte (CLAUDE.md) pour ce cas précis.
2. Auditer uniquement les fichiers concernés (cf PROJECT-STATE.md — jamais tout le repo).
3. Proposer les fichiers à créer/modifier.
4. Implémenter la logique gameplay.
5. Brancher la mise à jour du scoreboard global (SCORES_UPDATE).
6. Vérifier la synchro host/invités et la cohérence WS.
7. Handoff QA.md avec le contrat de handoff (cf CONVENTIONS.md).

PRIORITÉ
Respect absolu de l'architecture WS de CLAUDE.md. Aucun mini-jeu ne doit introduire de
désynchronisation, de divergence d'état ou de scoreboard incohérent.