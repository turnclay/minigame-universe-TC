# PLAN D'INTERVENTION — Features transversales F1 + F2

> Architecte (CLAUDE.md) : intégration, navigation, source de vérité, points de branchement WS.
> Agent JEUX (JEUX.md) : audit + adaptation du scoring **par jeu**, sans toucher l'architecture WS.
> Méthode : Analyse → **Propositions (ce document)** → Action après validation.
> Statut : proposition. Fichiers projet en lecture seule — rien n'est appliqué.

---

# F1 — Boutons « Accueil » et « Réglages » fonctionnels (navbar invité)

## Analyse (Architecte)

- `jeu.html` a une navbar invité : `#btn-home-permanent` (🏠) et `#btn-menu-permanent` (☰).
- `player.js._initNavbar()` importe `navigation.js` et appelle **`initNavbarInvite()`** — **mais cette fonction n'existe pas** dans `navigation.js` (uniquement référencée). L'appel échoue silencieusement → **navbar invité morte**.
- `initBoutonAccueil()` / `naviguerVersAccueil()` sont de la logique **page hôte** (affichent la section `home`, font `_resetSessionComplete()`, importent `main.js`) → inopérants sur `jeu.html`.
- `_ouvrirMenuInvite()` et `_ouvrirReglagesInvite()` **existent déjà** mais ne sont câblés à aucun bouton de la page invité. Le menu invité ne contient que « Statistiques », pas « Réglages ».

## Proposition

Créer la fonction manquante `initNavbarInvite()` (que `player.js` appelle déjà) qui câble :
- **🏠 Accueil** → quitter la partie (confirmation si en cours) puis `window.location.href = '/'`.
- **☰ Menu** → `_ouvrirMenuInvite()`, enrichi d'une entrée **Réglages** (→ `_ouvrirReglagesInvite()`).

Aucune logique hôte réutilisée côté invité, aucun flux WS touché.

### 1) `navigation.js` — ajouter `initNavbarInvite()` (nouvel export)

À placer près de `_ouvrirMenuInvite` :
```js
// ======================================================
// 📱 NAVBAR INVITÉ — câblage des boutons de jeu.html
// Appelée par player.js._initNavbar(). Logique 100 % invité
// (ne réutilise PAS naviguerVersAccueil() qui est page-hôte).
// ======================================================
export function initNavbarInvite() {
    // 🏠 Accueil — quitte la partie et revient à l'accueil public.
    const btnHome = document.getElementById('btn-home-permanent');
    if (btnHome && !btnHome.dataset.bound) {
        btnHome.dataset.bound = '1';
        btnHome.addEventListener('click', () => {
            const enJeu = !document.getElementById('phase-jeu')?.hidden;
            if (enJeu && !confirm('Quitter la partie en cours et revenir à l\'accueil ?')) return;
            window.location.href = '/';
        });
    }

    // ☰ Menu — ouvre le panneau invité (Réglages + Statistiques).
    const btnMenu = document.getElementById('btn-menu-permanent');
    if (btnMenu && !btnMenu.dataset.bound) {
        btnMenu.dataset.bound = '1';
        btnMenu.addEventListener('click', () => _ouvrirMenuInvite());
    }

    console.log('[NAV] ✅ Navbar invité câblée');
}
```
> `dataset.bound` évite tout listener dupliqué si `_initNavbar()` est rappelée (reconnexion).

### 2) `navigation.js` — ajouter « Réglages » au menu invité

Dans `_ouvrirMenuInvite()`, **AVANT** le bouton Statistiques (`#imenu-stats`) :

**AVANT :**
```html
            <hr class="invite-menu-separator">

            <button class="invite-menu-item" id="imenu-stats">
                <span class="invite-menu-item-icon">📊</span>
                <span class="invite-menu-item-label">Statistiques</span>
            </button>
```
**APRÈS :**
```html
            <hr class="invite-menu-separator">

            <button class="invite-menu-item" id="imenu-reglages">
                <span class="invite-menu-item-icon">⚙️</span>
                <span class="invite-menu-item-label">Réglages</span>
            </button>

            <button class="invite-menu-item" id="imenu-stats">
                <span class="invite-menu-item-icon">📊</span>
                <span class="invite-menu-item-label">Statistiques</span>
            </button>
```
Puis, à côté du handler `#imenu-stats`, **ajouter** :
```js
    document.getElementById('imenu-reglages')?.addEventListener('click', () => {
        fermer();
        _ouvrirReglagesInvite();
    });
```

> `player.js._initNavbar()` appelle déjà `initNavbarInvite()` — **aucune modification de player.js nécessaire**. F1 est complète avec ces deux éditions.

---

# F2 — Scoreboard transversal (points par jeu + affichage + bouton navbar hôte/invité)

## Analyse (Architecte) — point d'intégration

Le serveur EST déjà la source de vérité des scores :
`HOST_ADD_POINTS` → `store.modifierScore()` → `broadcastToGame('SCORES_UPDATE', store.getScores())`.

**Deux ruptures empêchent le scoreboard de refléter le serveur :**
1. `host_session.js` reçoit `SCORES_UPDATE` mais **ne fait que `console.log`** → `GameState.scores` et le board ne sont jamais rafraîchis depuis le serveur.
2. **morpion / puissance4 / undercover** créditent en **local** (`GameState.scores` + localStorage `scores_globaux`), **sans passer par le serveur** → leurs points n'atteignent ni le store ni les invités.
3. Les **invités n'ont aucun scoreboard** (`jeu.html` n'a pas d'élément score).

### Décision d'architecture (point de branchement pour l'agent JEUX)

> **`SCORES_UPDATE` (= `store.getScores()`) est LA source de vérité du scoreboard de partie.**
> - Tout scoring de partie passe par le serveur via **`HOST_ADD_POINTS`** (flux existant — l'agent JEUX ne crée aucun transport).
> - Hôte ET invités dérivent leur board de `SCORES_UPDATE`.
> - localStorage `scores_globaux` reste le **cumul inter-parties** (stats long terme), distinct du board de partie. Il continue d'être alimenté à chaque crédit, mais n'est plus la source du board courant.

Cela respecte CLAUDE.md (source de vérité serveur, pas d'état parallèle) et JEUX.md (scoring déterministe, identique hôte/invités, board reflétant le serveur, robuste aux reprises).

---

## Partie ARCHITECTE — branchements & affichage (code prêt)

### A1) `host_session.js` — brancher SCORES_UPDATE sur le board

**AVANT :**
```js
socket.on('SCORES_UPDATE', ({ scores }) => {
    console.log('[HOST] 📊 Scores mis à jour:', scores);
});
```
**APRÈS :**
```js
socket.on('SCORES_UPDATE', ({ scores }) => {
    if (scores && typeof scores === 'object') {
        GameState.scores = { ...scores };           // serveur = autorité du board de partie
    }
    import('../modules/scoreboard.js').then(m => m.afficherScoreboard()).catch(() => {});
});
```
> Nécessite que `GameState` soit importé dans `host_session.js` (vérifier l'import ; l'ajouter si absent : `import { GameState } from './state.js';`).

### A2) Bouton navbar permanent — HÔTE (`index.html`)

Dans `.top-nav-bar` (à côté de `#btn-menu-permanent`), **ajouter** :
```html
    <button class="btn-scores-permanent" id="btn-scores-permanent"
            aria-label="Afficher le tableau des scores" title="Scores">🏆</button>
```
> Réutilise le style des autres `btn-*-permanent`. Câblage dans `navigation.js` (A4).

### A3) Bouton navbar permanent — INVITÉ (`jeu.html`)

Dans `.invite-navbar`, **ajouter** (entre Accueil et Menu) :
```html
  <button class="invite-nav-btn" id="btn-scores-invite"
          aria-label="Afficher le tableau des scores">🏆</button>
```

### A4) `scoreboard.js` — affichage enrichi + panneau partagé hôte/invité

**Refonte de l'affichage** (classement avec médailles, toi-surligné, lecture seule côté invité) et **rendu réutilisable** à partir d'un objet `scores` quelconque (serveur).

Remplacer `afficherScoreboard()` par une version qui délègue à un rendu commun :
```js
// Rendu commun d'un classement, réutilisable hôte + invité.
// scores : { pseudo: points }  · opts : { cumul:bool, controles:bool, moi:string }
export function rendreClassement(elId, scores, opts = {}) {
    const el = document.getElementById(elId);
    if (!el) return;
    const entrees = Object.entries(scores || {}).sort((a, b) => b[1] - a[1]);
    if (!entrees.length) {
        el.innerHTML = '<p style="opacity:.5;font-size:.85rem;text-align:center;padding:8px;">Aucun score</p>';
        return;
    }
    const medailles = ['🥇', '🥈', '🥉'];
    let cumuls = {};
    if (opts.cumul) {
        try { cumuls = JSON.parse(localStorage.getItem('scores_globaux') || '{}'); } catch {}
    }
    el.innerHTML = entrees.map(([nom, pts], i) => {
        const estMoi = opts.moi && nom === opts.moi;
        const cumul = opts.cumul
            ? (cumuls[nom]?.total ?? (typeof cumuls[nom] === 'number' ? cumuls[nom] : 0))
            : null;
        const ctrl = opts.controles ? `
            <button class="score-btn" data-action="minus" data-nom="${escHtml(nom)}" aria-label="Retirer un point">–</button>
            <button class="score-btn" data-action="plus"  data-nom="${escHtml(nom)}" aria-label="Ajouter un point">+</button>` : '';
        return `
            <div class="score-entry${estMoi ? ' score-moi' : ''}" role="listitem">
                <span class="score-rang">${medailles[i] || (i + 1) + '.'}</span>
                <span class="score-name">${escHtml(nom)}${estMoi ? ' <em style="opacity:.6;">(toi)</em>' : ''}</span>
                <span class="score-points">${pts}${cumul !== null
                    ? `&nbsp;<span class="score-sep">/</span>&nbsp;<span class="score-global">${cumul}</span>` : ''}&nbsp;pts</span>
                ${ctrl}
            </div>`;
    }).join('');
}

// Board HÔTE — dérive de GameState.scores (alimenté par SCORES_UPDATE) + cumul + contrôles.
export function afficherScoreboard() {
    rendreClassement('score-list', GameState.scores || {}, { cumul: true, controles: true });
}
```
> `initScoreButtons()` reste valable (délégation sur `#score-list`, `data-action`/`data-nom`). Le CSS `.score-moi` / `.score-rang` peut réutiliser les variables de thème existantes (à ajouter dans `style.css`/`invite.css`).

### A5) `navigation.js` — câbler le bouton 🏆 (hôte + invité)

Côté **hôte**, dans `initNavigation()` (après `initBoutonMenu();`) :
```js
    initBoutonScores();
```
et ajouter l'export :
```js
export function initBoutonScores() {
    const btn = document.getElementById('btn-scores-permanent');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
        import('./modules/scoreboard.js').then(m => {
            const sb = document.getElementById('scoreboard');
            if (sb) sb.classList.toggle('reduit');   // ou show/hide selon ton CSS
            m.afficherScoreboard();
        });
    });
}
```

Côté **invité**, dans `initNavbarInvite()` (F1), **ajouter** le câblage :
```js
    const btnScores = document.getElementById('btn-scores-invite');
    if (btnScores && !btnScores.dataset.bound) {
        btnScores.dataset.bound = '1';
        btnScores.addEventListener('click', () => _ouvrirScoresInvite());
    }
```
et créer le panneau invité (lecture seule, même rendu) :
```js
function _ouvrirScoresInvite() {
    document.getElementById('scores-invite-panel')?.remove();
    document.getElementById('scores-invite-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'scores-invite-overlay';
    overlay.className = 'reglages-overlay';
    document.body.appendChild(overlay);

    const panel = document.createElement('div');
    panel.id = 'scores-invite-panel';
    panel.className = 'reglages-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Tableau des scores');
    panel.innerHTML = `
        <div class="reglages-header">
            <h2 class="reglages-title">🏆 Scores</h2>
            <button class="reglages-close" id="scores-invite-close" aria-label="Fermer">✖</button>
        </div>
        <div class="reglages-body"><div id="scores-invite-list" class="score-list" role="list"></div></div>`;
    document.body.appendChild(panel);
    requestAnimationFrame(() => { panel.classList.add('open'); overlay.classList.add('open'); });

    // Rendu à partir du dernier SCORES_UPDATE reçu (exposé par player.js — voir A6)
    import('./modules/scoreboard.js').then(m => {
        const scores = window.Player?.derniersScores || {};
        const moi    = window.Player?.session?.pseudo || null;
        m.rendreClassement('scores-invite-list', scores, { cumul: false, controles: false, moi });
    });

    const fermer = () => {
        panel.classList.remove('open'); overlay.classList.remove('open');
        setTimeout(() => { panel.remove(); overlay.remove(); }, 350);
    };
    document.getElementById('scores-invite-close')?.addEventListener('click', fermer);
    overlay.addEventListener('click', fermer);
}
```

### A6) `player.js` — mémoriser le dernier board reçu (pour le panneau invité)

Dans le handler `SCORES_UPDATE` existant, **ajouter** la mémorisation du board complet :

**AVANT :**
```js
socket.on('SCORES_UPDATE', ({ scores }) => {
    if (scores && this.session?.pseudo) {
        this.scoreLocal = scores[this.session.pseudo] ?? this.scoreLocal;
    }
    this.module?.onScores?.(scores);
    ...
});
```
**APRÈS :** (ajouter une ligne)
```js
socket.on('SCORES_UPDATE', ({ scores }) => {
    this.derniersScores = scores || {};        // board complet pour le panneau invité
    if (scores && this.session?.pseudo) {
        this.scoreLocal = scores[this.session.pseudo] ?? this.scoreLocal;
    }
    this.module?.onScores?.(scores);
    // …si le panneau est ouvert, le rafraîchir en direct :
    const liste = document.getElementById('scores-invite-list');
    if (liste) import('./modules/scoreboard.js').then(m =>
        m.rendreClassement('scores-invite-list', this.derniersScores, { cumul:false, controles:false, moi:this.session?.pseudo }));
    ...
});
```

---

## Partie AGENT JEUX — audit & unification du scoring par jeu

### Audit des scores par jeu (JEUX.md §SCORING)

| Jeu | Crédit des points | Source actuelle | Conforme « serveur autoritatif » ? | Action JEUX |
|---|---|---|---|---|
| Quiz | serveur (handler) → SCORES_UPDATE | serveur | ✅ | RAS |
| Petit Bac | serveur → SCORES_UPDATE | serveur | ✅ | RAS |
| Pendu | serveur → SCORES_UPDATE | serveur | ✅ | RAS |
| Maxi Lettres (lml) | serveur → SCORES_UPDATE | serveur | ✅ | RAS |
| Juste Prix | serveur → SCORES_UPDATE | serveur | ✅ | RAS |
| Mémoire | `ajouterPoints` local + écoute SCORES_UPDATE | mixte | ⚠️ partiel | router crédit via `HOST_ADD_POINTS` quand WS actif |
| **Morpion** | `crediterPoints` → localStorage | **local** | ❌ | **router via `HOST_ADD_POINTS`** |
| **Puissance 4** | `crediterPoints` → localStorage | **local** | ❌ | **router via `HOST_ADD_POINTS`** |
| **Undercover** | `crediterPoints` → localStorage | **local** | ❌ | **router via `HOST_ADD_POINTS`** |

### Pattern unifié (fourni par l'Architecte ; appliqué par l'agent JEUX)

Émettre l'intention de scoring au serveur quand une partie WS est active ; repli local en solo (aucune partie WS). **L'agent JEUX ne crée pas de transport** — il utilise `HOST_ADD_POINTS` (existant).

Helper proposé dans `scoreboard.js` (utilisable par tous les jeux) :
```js
import { socket } from "../core/socket.js";

// Crédite des points : serveur si partie WS active (→ SCORES_UPDATE),
// sinon local (solo). 'jeu' alimente le cumul global scores_globaux.
export function crediterScore(nom, points, jeu) {
    if (!nom || typeof points !== 'number' || points === 0) return;
    const enWS = !!localStorage.getItem('ws_partie_id') && socket?.connected;
    // Cumul inter-parties (stats long terme) — toujours, indépendant du board.
    try { ajouterPointsGlobaux(nom, points, jeu || GameState.jeuActuel || 'inconnu'); } catch {}
    if (enWS) {
        socket.send('HOST_ADD_POINTS', { cible: nom, points }); // → store → SCORES_UPDATE
    } else {
        ajouterPoints(nom, points);                              // board local (solo)
    }
}
```

### Diffs gameplay (à valider — modifie le comportement de scoring)

**`morpion.js` (≈ ligne 828) — AVANT :**
```js
if (this._hoteActif && _crediterPoints) {
    _crediterPoints(gagnants, 3);
} else {
    gagnants.forEach(nomJoueur => ajouterPoints(nomJoueur, 3));
}
```
**APRÈS :**
```js
gagnants.forEach(nomJoueur => crediterScore(nomJoueur, 3, 'morpion'));
```
> Supprime la double-écriture localStorage de `morpion_hote.crediterPoints` ; le board devient serveur-autoritatif et atteint les invités. `morpion_hote.crediterPoints` peut être conservé (legacy) ou neutralisé.

**`puissance4.js`** : remplacer les appels `_crediterPoints(gagnants, 4)` / `ajouterPoints(...)` par `crediterScore(nom, 4, 'puissance4')` (même schéma que morpion).

**`undercover_hote.js` (≈ ligne 848)** — remplacer `crediterPoints(p, pts)` par `crediterScore(p, pts, 'undercover')` (import depuis `scoreboard.js`), et retirer l'écriture localStorage de `crediterPoints`.

**`memoire.js`** : aux points de crédit (`ajouterPoints(...)`), remplacer par `crediterScore(..., 'memoire')` pour router via le serveur quand une partie WS est active (repli solo conservé).

### Vérifications JEUX (processus §6-8)
- Scoring déterministe et identique hôte/invités (tous via SCORES_UPDATE).
- Pas d'état local non validé : le board de partie ne lit plus que `GameState.scores` (alimenté serveur) ; `scores_globaux` reste cumul stats.
- Robustesse reprise/enchaînement : à `HOST_REJOIN`/`GAME_STARTED`, le snapshot serveur ré-émet les scores → board cohérent, pas de pollution d'ancienne partie.

---

## Checklist de validation

**F1**
- [ ] Invité : 🏠 → confirmation si en jeu → retour à `/`.
- [ ] Invité : ☰ → menu avec **Réglages** (audio) et **Statistiques**, tous deux fonctionnels.
- [ ] Aucun listener dupliqué après reconnexion (dataset.bound).

**F2 — Architecte**
- [ ] Hôte : un point ajouté par un jeu serveur (quiz…) rafraîchit le board (plus de simple log).
- [ ] Bouton 🏆 présent et fonctionnel côté hôte ET invité.
- [ ] Panneau invité : classement live, surlignage « (toi) », lecture seule.
- [ ] Le board invité se met à jour en direct sur `SCORES_UPDATE`.

**F2 — JEUX**
- [ ] Morpion : une victoire crédite via le serveur → visible chez l'hôte ET les invités.
- [ ] Puissance 4 : idem.
- [ ] Undercover : idem.
- [ ] Mode solo (sans partie WS) : le scoring local fonctionne toujours.
- [ ] Enchaîner deux parties : aucun report de scores de l'ancienne (board = `store.getScores` courant).

---

## Récapitulatif des fichiers

| Fichier | Feature | Rôle | Nature |
|---|---|---|---|
| `navigation.js` | F1 + F2 | Architecte | `initNavbarInvite`, menu Réglages, `initBoutonScores`, panneau invité |
| `player.js` | F2 | Architecte | mémoriser `derniersScores` (1 ligne) — F1 ne touche pas player.js |
| `host_session.js` | F2 | Architecte | brancher SCORES_UPDATE sur le board |
| `scoreboard.js` | F2 | Architecte + JEUX | `rendreClassement`, `afficherScoreboard`, helper `crediterScore` |
| `index.html` | F2 | Architecte | bouton 🏆 hôte |
| `jeu.html` | F2 | Architecte | bouton 🏆 invité |
| `style.css` / `invite.css` | F2 | Architecte | classes `.score-moi`, `.score-rang` |
| `morpion.js` | F2 | **JEUX** | scoring via `crediterScore` |
| `puissance4.js` | F2 | **JEUX** | scoring via `crediterScore` |
| `undercover_hote.js` | F2 | **JEUX** | scoring via `crediterScore` |
| `memoire.js` | F2 | **JEUX** | scoring via `crediterScore` (repli solo) |

> **Point de validation requis avant l'étape 3 :** les diffs gameplay (morpion/p4/undercover/mémoire) modifient le comportement réel de scoring. Conformément à JEUX.md (audit → proposition → implémentation après accord), je ne les fige qu'après ta validation du pattern `crediterScore` et de la décision « board de partie = serveur ».