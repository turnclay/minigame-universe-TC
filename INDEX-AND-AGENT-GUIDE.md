# MiniGameV2 — INDEX COMPLET & Guide agents

## 📚 Documentation complète (Étapes 1-6 terminées)

### 📖 Fichiers maîtres

| Fichier | Taille | Audience | Utilité |
|---------|--------|----------|---------|
| **ARCHITECTURE-OVERVIEW.md** | 5 KB | Tous | Vue d'ensemble simple + checklist |
| **GAMES-GUIDE-DETAILED.md** | 14 KB | JEUX.md | Per-game architecture + WS events |
| **STAGE-5-ISSUES-AND-STAGE-4-OPTIMIZATIONS.md** | 11 KB | CLAUDE.md, JEUX.md | Problèmes détectés + recommendations |
| **FULL-REPO-MATRIX.csv** | 12 KB | Analystes | Dépendances exhaustives (80+ lignes) |
| **DOCUMENTATION-FINAL-SUMMARY.md** | 9 KB | PM, Leads | Résumé audit + timeline |
| **arbo.txt** | Auto-generated | Tous | Tree structure |
| **auto-push.ps1** | Auto-generated | DevOps | Script regeneration arbo |

### 🤖 Prompts agents (Étape 4 optimisés)

- **CLAUDE.md** → Architecte WS (prêt + suggestions STAGE-5)
- **JEUX.md** → Développeur jeux (prêt + suggestions STAGE-5)
- **QA.md** → Testeur synchronisation (prêt + suggestions STAGE-5)

---

## 🗂️ Navigation rapide

### "Je dois comprendre l'archi en 5 min"
→ Lire: **ARCHITECTURE-OVERVIEW.md**

### "Je dois développer/modifier un jeu"
→ Lire: **GAMES-GUIDE-DETAILED.md** (section du jeu) + **JEUX.md**

### "Je dois vérifier si c'est bien synchronisé"
→ Lire: **QA.md** (optimisé dans STAGE-5) + tester checklist par domaine

### "Je dois modifier l'architecture WS"
→ Lire: **ARCHITECTURE-OVERVIEW.md** + **CLAUDE.md** + vérifier **STAGE-5-ISSUES**

### "Je dois auditer les dépendances"
→ Lire: **FULL-REPO-MATRIX.csv** ou grep patterns

### "Je dois vérifier les problèmes connus"
→ Lire: **STAGE-5-ISSUES-AND-STAGE-4-OPTIMIZATIONS.md** (section A)

---

## 🎯 Use Cases par agent

### CLAUDE.md (Architecte) — Tâches typiques

```
1. "Ajouter une nouvelle source de données"
   → ARCHITECTURE-OVERVIEW.md § Gestion des parties
   → Vérifier: store.js impact + cleanup.js impact

2. "Fixer une désynchronisation host ≠ guests"
   → STAGE-5-ISSUES § Scoring audit complet
   → Vérifier: SCORES_UPDATE broadcast + getSessionState()

3. "Implémenter reconnexion robuste"
   → GAMES-GUIDE-DETAILED.md § Reconnexion
   → Vérifier: getSessionState couvre la phase

4. "Optimiser WS messages"
   → FULL-REPO-MATRIX.csv § WS events produced/consumed
   → Chercher: broadcast excessive ou event duplication
```

### JEUX.md (Développeur) — Tâches typiques

```
1. "Créer nouveau jeu"
   → GAMES-GUIDE-DETAILED.md § Checklist développement
   → Copier template: server/games/NEWGAME.js

2. "Fixer scoring incohérent"
   → STAGE-5-ISSUES § Audit scoring complet
   → Vérifier: server calcule + SCORES_UPDATE broadcast

3. "Gérer reconnexion mid-game"
   → GAMES-GUIDE-DETAILED.md § Reconnexion (per-game)
   → Implémenter: getSessionState retourne snapshot complet

4. "Migrer jeu vers server-driven"
   → GAMES-GUIDE-DETAILED.md § Pattern: Server-driven
   → Exemple: petitbac.js (server-driven + Wikidata)
```

### QA.md (Testeur) — Tâches typiques

```
1. "Valider nouvelle partie end-to-end"
   → STAGE-5-ISSUES § Tests cleanup anti-pollution
   → Checklist: Partie A listeners destroyed? Partie B clean start?

2. "Tester reconnexion"
   → STAGE-5-ISSUES § Tests reconnexion mid-game
   → Vérifier: Ancien DOM disparu? Snapshot reconstruit?

3. "Auditer localStorage"
   → STAGE-5-ISSUES § localStorage problems
   → Whitelist only: core/storage.js + core/musique.js

4. "Vérifier desynchronisation"
   → ARCHITECTURE-OVERVIEW.md § Checklist
   → Matrice: Server state == Host state == Guests state?
```

---

## 🔧 Workflows courants

### Workflow 1: Nouveau jeu (ex: Ludo)

1. **Lire**:
   - GAMES-GUIDE-DETAILED.md § Checklist développement nouveau jeu
   - ARCHITECTURE-OVERVIEW.md § Patterns

2. **Créer**:
   ```
   server/games/ludo.js              ← Décider: server-driven ou host-auth?
   public/js/jeux/ludo.js            ← Logique hôte
   public/js/modules/ludo_hote.js    ← Panel hôte
   public/js/modules/ludo_player.js  ← UI invité
   ```

3. **Enregistrer**:
   - JeuRegistry.register('ludo', ludoPlayer)
   - Import dynamique dans jeux.js

4. **Tester** (QA.md):
   - Synchro host ≠ guests?
   - Scoring correct?
   - Reconnexion OK?

### Workflow 2: Bug désynchronisation

1. **Localiser**:
   - FULL-REPO-MATRIX.csv grep le jeu concerné
   - Identifier: server event, client listener, state update

2. **Analyser**:
   - STAGE-5-ISSUES § Scoring audit?
   - localStorage polluant?
   - Listener multiple?

3. **Fixer**:
   - Server: émettre SCORES_UPDATE?
   - Client: écouter l'event?
   - Cleanup.js: purger listener?

4. **Valider**:
   - QA.md § Matrice desynchronisation
   - Tous les écrans = même state?

### Workflow 3: Optimiser localStorage

1. **Lire**:
   - STAGE-5-ISSUES § localStorage problems
   - ARCHITECTURE-OVERVIEW.md § Joueurs & Storage

2. **Refactor**:
   - Remplacer _hote.js localStorage par host_session.js snapshot
   - Test reconnexion

3. **Valider**:
   - QA.md § localStorage tests
   - Zéro divergence?

---

## 📊 Référence rapide: Patterns

### Server-driven (Pendu, Petitbac, Quiz, LML, Justeprix, Mémoire, Mime)
```javascript
// Serveur tire données + valide + calcule scores
export function handleHostAction(wss, ws, partieId, action, data, helpers) {
  // 1. Tire données (question, mot, produit, lettres, etc.)
  // 2. Broadcast GAME_EVENT_START
}

export function handlePlayerAction(...) {
  // 1. Reçoit réponse invité
  // 2. Valide
  // 3. Calcule score → store.modifierScore()
}

export function getSessionState(partieId) {
  // Return: phase + public data (omit: secret like answers)
}
```

### Host-authoritative (Morpion, Puissance4)
```javascript
// Hôte décide, serveur relaye
export function handleHostAction(...) {
  if (action === 'GAME:state') {
    setSessionState(partieId, data);
    broadcastToPlayers(wss, partieId, 'HOST_ACTION', { action, data });
  }
}

// Invités reçoivent + affichent (read-only)
```

### Server-authoritative (UNO)
```javascript
// Serveur gère TOUT (deck, effets, validation)
// Clients reçoivent main privée + état public
```

---

## 🚨 Red flags (à corriger si détectés)

| Red flag | Cause | Fix |
|----------|-------|-----|
| Host ≠ Guests state | localStorage divergence | Utiliser state.js + snapshot WS |
| Double événement | socket.on sans off | cleanup.js: socket.off(event, fn) |
| Scoring incorrect | Server + Client calculent différent | Serveur authorité, client affiche seulement |
| Reconnexion crash | getSessionState absent | Implémenter pour chaque jeu |
| Ancien DOM visible | cleanup avant reconstruction | cleanup.js: removeElement() PUIS reconstruit |
| Partie A affecte partie B | localStorage/timer pas purgé | cleanup.js complète: off() + clear() + remove() |

---

## 📞 Escalation tree

```
Problem: ???
│
├─ Désynchronisation?
│  └─ STAGE-5 § Scoring audit
│     └─ Chercher: SCORES_UPDATE missing?
│        └─ CLAUDE.md (WS routing issue) ou JEUX.md (scoring logic)
│
├─ Reconnexion cassée?
│  └─ GAMES-GUIDE § Reconnexion
│     └─ Chercher: getSessionState() absent?
│        └─ CLAUDE.md (session management) ou JEUX.md (game state)
│
├─ localStorage polluant?
│  └─ STAGE-5 § localStorage problems
│     └─ Refactor: remplacer par snapshot WS
│        └─ CLAUDE.md (architecture) ou JEUX.md (game impl)
│
├─ WS message error?
│  └─ ARCHITECTURE-OVERVIEW § Routing
│     └─ Checker: action naming? HOST_ACTION / PLAYER_ACTION?
│        └─ CLAUDE.md (WS protocol)
│
└─ New game won't work?
   └─ GAMES-GUIDE § Checklist développement
      └─ Suivre template + tester
         └─ JEUX.md (game dev patterns)
```

---

## 💾 File locations

```
C:\Users\clayt\PycharmProjects\MiniGameV2\
├── ARCHITECTURE-OVERVIEW.md .................. Start here
├── GAMES-GUIDE-DETAILED.md .................. Game reference
├── STAGE-5-ISSUES-AND-STAGE-4-OPTIMIZATIONS.md .... Improvements
├── FULL-REPO-MATRIX.csv ..................... Dependencies
├── DOCUMENTATION-FINAL-SUMMARY.md ........... Executive summary
├── arbo.txt ................................ Tree structure
├── auto-push.ps1 ............................ Regenerate arbo
├── CLAUDE.md ................................ Architect rules (optimized)
├── JEUX.md .................................. Game dev rules (optimized)
├── QA.md .................................... Testing rules (optimized)
├── server/
│   ├── index.js
│   ├── ws-handler.js
│   ├── store.js
│   └── games/ (12 handlers)
└── public/
    ├── js/
    │   ├── core/ (11 modules)
    │   ├── jeux/ (11 games)
    │   └── modules/ (25+ modules)
    ├── css/
    └── *.html
```

---

## ✅ Checklist avant commit/push

- [ ] Lu ARCHITECTURE-OVERVIEW (5 min)?
- [ ] Ton rôle clair: CLAUDE/JEUX/QA/PM?
- [ ] Tâche identifiée dans "Workflows courants"?
- [ ] Bon fichier de référence sélectionné?
- [ ] Red flags checklist complétée?
- [ ] Tests QA.md applicable?
- [ ] Escalation path compris?

---

## 📅 Next phases

1. **Week 1**: Code review STAGE-5 recommendations
2. **Week 2**: Refactor localStorage _hote.js (if prioritized)
3. **Week 3**: Per-game QA checklists
4. **Week 4+**: Monitoring + new features

---

**Generated**: 2026-07-12
**Status**: ✅ COMPLETE
**Scope**: MiniGameV2 100% audit + documentation
**Audience**: CLAUDE.md, JEUX.md, QA.md agents + PMs
