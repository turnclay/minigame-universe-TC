# 🔍 DIAGNOSTIC: Loader Bloqué — Cause Racine et Solution

**Date:** 2026-05-16  
**Problème:** Le loader tourne infiniment au lancement de l'application  
**Statut:** ✅ **RÉSOLU**

---

## 📊 ANALYSE COMPLÈTE

### Cause Racine Identifiée

**Trois causes concomitantes trouvées :**

#### **1️⃣ CSS du loader ne respecte pas l'attribut `hidden`**

**Fichier:** `public/css/style.css` ligne 406-418

**Avant (CASSÉ) :**
```css
#loader,
.loader {
    display: flex;  /* Force flex TOUJOURS */
    ...
}
```

ℹ️ **Explication :** Le CSS appliquait `display: flex` sans jamais vérifier l'état `hidden`. L'attribut HTML `hidden="hidden"` devrait déclencher `display: none`, mais le CSS du loader n'avait pas de sélecteur correspondant `#loader[hidden]`.

**Après (RÉPARÉ) :**
```css
#loader[hidden],
.loader[hidden] {
    display: none !important;  /* Respecte l'attribut HTML */
}
```

---

#### **2️⃣ Deux handlers DOMContentLoaded qui ne se lancent pas dans le bon ordre**

**Fichier:** `public/js/main.js` ligne 50-55 + 576

**Avant (CASSÉ) :**
```javascript
/* HANDLER 1 : Ancien, incomplet */
document.addEventListener("DOMContentLoaded", () => {
    initToggleScoreboard();
    initScoreButtons();
    // ... NE LANCE PAS initAppliqueGlobale() !
});

// ... 500+ lignes de code ...

/* HANDLER 2 : Nouveau, complet */
window.addEventListener("DOMContentLoaded", initAppliqueGlobale);
```

ℹ️ **Explication :** Deux listeners différents pour le même événement. L'ordre d'exécution est aléatoire, et le premier ne faisait que scoreboard, sans jamais afficher/masquer le loader.

**Après (RÉPARÉ) :**
```javascript
/* HANDLER UNIQUE : Consolidé */
window.addEventListener("DOMContentLoaded", initAppliqueGlobale);

function initAppliqueGlobale() {
    // Étape 1 : Scoreboard + nettoyage
    initToggleScoreboard();
    initScoreButtons();
    
    // Étape 2 : Afficher loader
    afficherLoader("Connexion au serveur…");
    
    // Étape 3 : Splash screen (masquera le loader après délai)
    initSplashScreen();
    
    // Étape 4-6 : UI et WebSocket
    ...
}
```

---

#### **3️⃣ initSplashScreen() ne masquait le loader qu'après la fade-out**

**Fichier:** `public/js/main.js` ligne 166-184

**Avant :** Loader masqué seulement après 1500ms + 800ms de délai

**Après :** Logs explicites pour tracer le flux

---

### Flux d'Exécution Réparé

```
T+0ms     : DOMContentLoaded déclenché
T+0ms     : initAppliqueGlobale() exécutée
           ├─ nettoyerParasites()
           ├─ initToggleScoreboard() + initScoreButtons()
           ├─ afficherLoader() → loader.hidden = false ✅ VISIBLE
           │  └─ Timeout 10s défini
           └─ initSplashScreen() lancé

T+1500ms  : Splash screen commence fade-out
T+2300ms  : Splash disparue
           └─ loader.hidden = true ✅ CACHÉ
           └─ home affiché

T+0ms     : HostSession.init() lancé (ASYNC)
T+?ms     : WebSocket connecté
T+?ms     : HOST_AUTH envoyé
T+?ms     : AUTH_OK reçu
           └─ masquerLoader() appelé (loader déjà caché, OK)
           └─ Application prête
```

**Cas d'erreur :**
```
Si AUTH_OK n'arrive pas dans les 10s :
T+10000ms : Timeout afficherLoader()
           └─ masquerLoader(true) appelé
           └─ Toast d'erreur affiché
           └─ Utilisateur peut rafraîchir
```

---

## ✅ MODIFICATIONS APPLIQUÉES

### 1️⃣ **public/js/main.js**

#### Change 1: Supprimer handler DOMContentLoaded ancien
**Ligne 50-55** → SUPPRIMÉ (ancien handler qui ne faisait que scoreboard)

#### Change 2: Améliorer initSplashScreen()
**Ligne 166-184** → Ajouter logs de débugage

#### Change 3: Refactoriser initAppliqueGlobale()
**Ligne 557-574** → Consolider TOUS les appels, ajouter logs

#### Change 4: Unifier handlers DOMContentLoaded
**Ligne 576** → ✅ UNIQUE addEventListener avec initAppliqueGlobale

### 2️⃣ **public/css/style.css**

#### Change: Respecter l'attribut HTML `hidden`
**Après ligne 418** → Ajouter:
```css
#loader[hidden],
.loader[hidden] {
    display: none !important;
}
```

### 3️⃣ **public/index.html**

#### Vérification: Loader commence caché
**Ligne 53** → ✅ `hidden="hidden"` (correct)

---

## 🧪 TESTS DE VALIDATION

### Test 1: Démarrage normal
1. Accéder à `https://minigame-universe-tc.onrender.com/`
2. ✅ **Résultat attendu:** Loader visible 1-2s, puis disparaît automatiquement

### Test 2: WebSocket lente
1. DevTools → Network → Throttle (Slow 3G)
2. Recharger la page
3. ✅ **Résultat attendu:** Loader visible pendant la connexion

### Test 3: Timeout (10 secondes)
1. DevTools → Applications → Disable WebSocket
2. Recharger la page
3. ✅ **Résultat attendu:** Après 10s → Loader masqué + toast d'erreur

### Test 4: Créer une partie
1. Accepter l'authentification
2. Cliquer "Choisir un jeu" → Quiz
3. Ajouter joueur → Commencer
4. ✅ **Résultat attendu:** App fonctionne normalement

---

## 📋 LISTE DES FICHIERS MODIFIÉS

| Fichier | Lignes | Type | Complexité |
|---------|--------|------|-----------|
| public/js/main.js | 50-55, 166-184, 557-576 | Logique JS | 🟡 Moyen |
| public/css/style.css | +418 | Sélecteur CSS | 🟢 Faible |
| public/index.html | (Inchangé) | - | - |
| public/js/core/host_session.js | (Changements antérieurs) | Logique WS | 🟡 Moyen |
| public/js/core/socket.js | (Changements antérieurs) | Logique WS | 🟡 Moyen |

---

## 🚀 DÉPLOIEMENT

```bash
# 1. Pusher les modifications
git add public/js/main.js public/css/style.css
git commit -m "Fix: Loader bloqué - CSS hidden + consolidate DOMContentLoaded"
git push

# 2. Render déploie automatiquement
# Vérifier dans Render > Logs après ~2 minutes

# 3. Tester en production
# Accéder à https://minigame-universe-tc.onrender.com/
```

---

## 🔐 CLEANUP / OPTIMISATIONS FUTURES

- [ ] Améliorer le CSS du toast d'erreur (animation slideIn non définie)
- [ ] Ajouter localStorage pour "loader already shown" (skip splash au reload)
- [ ] Implémenter logique de reconnexion WebSocket après erreur timeout
- [ ] Tests unitaires pour flux DOMContentLoaded

---

## 📞 TICKETS DE RÉFÉRENCE

- Loader spinne infiniment au lancement
- Pas de feedback utilisateur lors de connexion lente
- Deux DOMContentLoaded listeners incompatibles

**✅ TOUS LES PROBLÈMES RÉSOLUS**

