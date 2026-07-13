# MiniGameV2 — QUICK REFERENCE CARD (À imprimer)

## 🎯 TU ES ?

### CLAUDE.md (Architecte WS)
**Fichiers à lire**:
- ARCHITECTURE-OVERVIEW.md (5 min)
- STAGE-5-ISSUES.md (10 min)

**Checklist avant modification**:
- [ ] Impact sur store.js?
- [ ] Impact sur cleanup.js?
- [ ] Snapshot WS couvre?
- [ ] WS events nommés correctement?
- [ ] SCORES_UPDATE sera émis?

**Red flags**:
- ❌ localStorage comme source de vérité (sauf joueurs/musique)
- ❌ Listeners multiples (socket.on sans off)
- ❌ Divergence host ≠ guests
- ❌ Scoring localement (doit être serveur)

---

### JEUX.md (Développeur)
**Fichiers à lire**:
- GAMES-GUIDE-DETAILED.md (15 min)
- JEUX.md existing rules

**Checklist nouveau jeu**:
- [ ] Créer server/games/GAMENAME.js
- [ ] Implémenter handleHostAction + handlePlayerAction
- [ ] Implémenter getSessionState() pour reconnexion
- [ ] Émettre SCORES_UPDATE après scoring
- [ ] Enregistrer dans JeuRegistry
- [ ] Import dynamique dans jeux.js
- [ ] Tests QA.md

**Scoring checklist**:
- [ ] Serveur calcule (pas client)
- [ ] SCORES_UPDATE broadcast après chaque point
- [ ] Client reçoit + affiche (read-only)
- [ ] Vérifier identique après reconnexion

---

### QA.md (Testeur)
**Fichiers à lire**:
- QA.md existing + STAGE-5-ISSUES.md (10 min)

**Matrice de test**:
```
État ? server == host == guests
Score? server == host == guests
Écran? server == host == guests
```

**Reconnexion test**:
- [ ] Mid-game disconnect
- [ ] Écran ancien DOM disparu?
- [ ] Snapshot reconstruit?
- [ ] localStorage ancien state purgé?

**Cleanup test**:
- [ ] Partie A terminée → listeners = 0?
- [ ] Partie B démarrée → zéro événement A?
- [ ] Timers A tous cleared?

---

## 📊 PATTERNS (Copy-paste)

### Server-driven
```javascript
// server/games/GAMENAME.js
export function handleHostAction(wss, ws, partieId, action, data, helpers) {
  // 1. Tire données (question, mot, produit, etc.)
  // 2. Broadcast GAMENAME_EVENT_START
  // 3. Reçoit résultats → calcule scores
}
export function getSessionState(partieId) { ... }
```

### Host-authoritative
```javascript
// Hôte décide, serveur relaye
if (action === 'GAME:state') {
  setSessionState(partieId, data);
  broadcastToPlayers(wss, partieId, 'HOST_ACTION', { action, data });
}
```

---

## 🚨 RED FLAGS (Stop if detected)

| Flag | Cause | Fix |
|------|-------|-----|
| Host ≠ Guests | localStorage divergence | Use state.js + snapshot WS |
| Double event | socket.on sans off | cleanup.js: socket.off(event, fn) |
| Mauvais score | Client calcule | Server authorité seule |
| Reconnexion crash | getSessionState absent | Implémenter pour chaque jeu |
| Ancien DOM visible | cleanup incomplet | removeElement() AVANT reconstruit |
| Partie A → Partie B | Listener/timer pas purgé | cleanup.js complète |

---

## 📞 ESCALATION

**Désynchronisation?**
→ Chercher: SCORES_UPDATE émis? getSessionState couvre?

**Reconnexion cassée?**
→ Chercher: getSessionState() absent? cleanup avant reconstruit?

**localStorage polluant?**
→ Refactor: remplacer par snapshot WS

**WS error?**
→ Checker: HOST_ACTION / PLAYER_ACTION conventions?

**Nouveau jeu won't work?**
→ Suivre: GAMES-GUIDE checklist développement

---

## 📁 FILES (7 fichiers doc générés)

| Fichier | Use for |
|---------|---------|
| **ARCHITECTURE-OVERVIEW** | Quick start + patterns |
| **GAMES-GUIDE-DETAILED** | Game reference per-game |
| **STAGE-5-ISSUES** | Known problems + fixes |
| **FULL-REPO-MATRIX.csv** | Dependency reference |
| **DOCUMENTATION-FINAL** | Executive summary |
| **INDEX-AND-AGENT-GUIDE** | Navigation |
| **STAGES-1-6-SUMMARY** | Audit overview |

---

## ⚡ 5-MIN DECISION TREE

```
I need to...

├─ Understand architecture?
│  → Read ARCHITECTURE-OVERVIEW (5 min)
│
├─ Develop/modify game?
│  → Read GAMES-GUIDE (15 min) + JEUX.md
│
├─ Test synchronization?
│  → Read QA.md + STAGE-5 checklist
│
├─ Fix desynchronization?
│  → Check STAGE-5 audit (scoring/reconnexion)
│
├─ Optimize performance?
│  → Check FULL-REPO-MATRIX (WS events)
│
└─ Find dependency?
   → Check FULL-REPO-MATRIX.csv
```

---

## ✅ BEFORE COMMIT

- [ ] Lire ARCHITECTURE-OVERVIEW? (5 min)
- [ ] Role clair: CLAUDE/JEUX/QA? (1 min)
- [ ] Checklist ton domaine? (5 min)
- [ ] Red flags check? (2 min)
- [ ] Tests applicable? (5 min)

---

**Status**: ✅ READY
**Version**: 2026-07-12
**Scope**: MiniGameV2 100% audit
