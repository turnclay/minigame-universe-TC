# PATCH — Socle transversal · Lot « Sécuriser » (L2 + L3 + L4)

> Rôle : Architecte · Méthode : Analyse → **Propositions (ce document)** → Action après validation.
> Principe : non destructeur, source de vérité serveur préservée, aucune refonte.
> Statut : **proposition à valider** — rien n'est appliqué à ton projet (copies lecture seule).

Chaque édition est donnée en **AVANT → APRÈS** sur le code réel. Les chemins sont relatifs à `public/js/`.

---

## L3 — Lien d'invitation unifié sur l'URL serveur (faible risque)

**But** : faire du `joinUrl` renvoyé par le serveur (canonique, avec `code` court) la **source unique** du lien/QR, au lieu du lien reconstruit côté client (`/jeu.html?…` sans code). Le serveur l'envoie déjà dans `GAME_CREATED` et `HOST_REJOINED`.

### 1) `core/host_session.js` — alimenter invite.js avec le `joinUrl` serveur

**Handler `GAME_CREATED` — AVANT :**
```js
import('../modules/invite.js').then(m => {
    m.afficherBlocInvitation();
}).catch(err => console.warn('[HOST] ⚠️ Erreur invite.js:', err.message));
```
**APRÈS :**
```js
import('../modules/invite.js').then(m => {
    if (typeof m.setServerJoinUrl === 'function') m.setServerJoinUrl(joinUrl);
    m.afficherBlocInvitation();
}).catch(err => console.warn('[HOST] ⚠️ Erreur invite.js:', err.message));
```

**Handler `HOST_REJOINED` — AVANT :**
```js
import('../modules/invite.js').then(m => {
    m.afficherBlocInvitation();
}).catch(err => console.warn('[HOST] ⚠️ Erreur import invite.js:', err.message));
```
**APRÈS :**
```js
import('../modules/invite.js').then(m => {
    if (typeof m.setServerJoinUrl === 'function') m.setServerJoinUrl(joinUrl);
    m.afficherBlocInvitation();
}).catch(err => console.warn('[HOST] ⚠️ Erreur import invite.js:', err.message));
```

### 2) `modules/invite.js` — consommer l'URL serveur, fallback legacy

**AVANT (en-tête, sous les imports) :**
```js
import { GameState } from '../core/state.js';
import { getPartieId, setPartieId, clearPartieId } from '../core/partie_id.js';
```
**APRÈS :**
```js
import { GameState } from '../core/state.js';
import { getPartieId, setPartieId, clearPartieId } from '../core/partie_id.js';

// URL d'invitation canonique fournie par le serveur (GAME_CREATED / HOST_REJOINED).
// Source unique : porte le code court. Le builder legacy ci-dessous n'est plus
// qu'un fallback si le serveur n'a (pas encore) fourni d'URL.
let _serverJoinUrl = null;

/** Hôte → enregistre le joinUrl serveur (chemin relatif, ex: /jeu?…&code=…). */
export function setServerJoinUrl(url) {
    _serverJoinUrl = url || null;
    if (_serverJoinUrl) console.log('[INVITE] 🔗 joinUrl serveur enregistré :', _serverJoinUrl);
}
```

**`construireLienInvitation()` — AVANT :**
```js
export function construireLienInvitation() {
    const id = getPartieSessionId();
    if (!id) {
        console.warn('[INVITE] ⚠️ Pas de partieId — lien non généré');
        return null;
    }
    const params = new URLSearchParams({
        partieId  : id,
        partieNom : GameState.partieNom || 'Partie',
        jeu       : GameState.jeuActuel || GameState.jeu || '',
        hote      : (GameState.joueurs || [])[0] || '',
        createdAt : Date.now(),
    });
    return `${window.location.origin}/jeu.html?${params.toString()}`;
}
```
**APRÈS :**
```js
export function construireLienInvitation() {
    // 1) Priorité absolue : URL canonique serveur (avec code court).
    if (_serverJoinUrl) {
        return _serverJoinUrl.startsWith('http')
            ? _serverJoinUrl
            : `${window.location.origin}${_serverJoinUrl}`;
    }

    // 2) Fallback legacy (serveur indisponible) — conservé pour robustesse.
    const id = getPartieSessionId();
    if (!id) {
        console.warn('[INVITE] ⚠️ Pas de partieId — lien non généré');
        return null;
    }
    const params = new URLSearchParams({
        partieId  : id,
        partieNom : GameState.partieNom || 'Partie',
        jeu       : GameState.jeuActuel || GameState.jeu || '',
        hote      : (GameState.joueurs || [])[0] || '',
        createdAt : Date.now(),
    });
    return `${window.location.origin}/jeu?${params.toString()}`; // /jeu (aligné serveur), plus /jeu.html
}
```

**`resetPartieSessionId()` — AVANT :**
```js
export function resetPartieSessionId() {
    clearPartieId();
    _viderBlocStatique();
    console.log('[INVITE] 🧹 partieSessionId réinitialisé');
}
```
**APRÈS :**
```js
export function resetPartieSessionId() {
    clearPartieId();
    _serverJoinUrl = null;          // éviter de réutiliser une URL périmée
    _viderBlocStatique();
    console.log('[INVITE] 🧹 partieSessionId réinitialisé');
}
```

**Risque** : minimal. Le serveur fournit déjà `joinUrl` ; on l'aligne sur l'affichage déjà fait par `_afficherLienJoin`. Le fallback préserve le comportement actuel.

---

## L2 — Purge des listeners WS en fin de partie (contrat uniforme)

**But** : combler le seul vrai leak (`undercover_hote`, dont `nettoyerPartie` n'est jamais appelé) en réutilisant le contrat **existant** `nettoyerPartieInvites()` + `MODULES_WS_HOTE`, déclenché à `GAME_ENDED` via `resetEtatJeuxHote()`. Hygiène complémentaire optionnelle pour `mimedessine`.

> Rappel : morpion, puissance4, mémoire, quiz sont migrés WS et ne possèdent pas de listeners hôte propres → **ne pas** les ajouter.

### 1) `modules/undercover_hote.js` — exposer `nettoyerPartieInvites()` (correctif réel)

Les handlers `_onPlayerActionWS` et `_onPlayerJoinedWS` existent déjà, `socket` est importé, `S` existe. **Ajouter** (par ex. juste après `_brancherWS()`):
```js
// Purge des listeners WS — appelée à GAME_ENDED via cleanup.resetEtatJeuxHote().
// Évite que les handlers undercover continuent de répondre pendant un autre jeu.
export function nettoyerPartieInvites() {
    socket.off('PLAYER_ACTION', _onPlayerActionWS);
    socket.off('PLAYER_JOINED', _onPlayerJoinedWS);
    socket.off('PLAYER_RECONNECTED', _onPlayerJoinedWS);
    S._wsBound = false;
    console.log('[UNDERCOVER_HOTE] 🧹 Listeners WS purgés');
}
```
> `nettoyerPartie` (cleanup localStorage + `publierEtat('fin')`) reste inchangé. On sépare « purge listeners » (nouveau, branché au cycle) de « cleanup d'état » (existant).

### 2) `core/cleanup.js` — compléter le registre de purge

**AVANT :**
```js
const MODULES_WS_HOTE = [
    '../modules/quiz_hote.js',
    '../modules/petitbac_hote.js',
    '../modules/pendu_hote.js',
    '../modules/lml_hote.js',
    '../modules/justeprix_hote.js',
];
```
**APRÈS :**
```js
const MODULES_WS_HOTE = [
    '../modules/quiz_hote.js',
    '../modules/petitbac_hote.js',
    '../modules/pendu_hote.js',
    '../modules/lml_hote.js',
    '../modules/justeprix_hote.js',
    '../modules/undercover_hote.js',  // L2 — listeners WS propres à purger
    '../jeux/mimedessine.js',         // L2 (hygiène) — voir §3 optionnel
];
```
> Si tu n'appliques pas le §3 optionnel, retire la ligne `mimedessine` : `resetEtatJeuxHote` ignore silencieusement les modules sans `nettoyerPartieInvites`, donc ce n'est pas bloquant, mais autant rester cohérent.

### 3) `jeux/mimedessine.js` — handlers nommés + purge (OPTIONNEL, hygiène)

`mimedessine` est déjà protégé contre les doublons (`socket._mimeHoteBound`), donc **pas un leak avéré**. Ce refactor le rend néanmoins purgeable, pour un contrat 100 % uniforme.

**AVANT :**
```js
function _brancherSocket() {
    if (socket._mimeHoteBound) return;
    socket._mimeHoteBound = true;

    socket.on('MIMEDESSSINE_PHASE', (p) => {
        _state = { ..._state, ...p };
        if (p.phase !== 'tour') _mot = null;
        _render();
        if (p.phase === 'tour' && p.tsTourEnd) _startTimer(); else _stopTimer();
    });

    socket.on('MIMEDESSSINE_MOT_A_DEVINER', (p) => {
        _mot = p.mot || null;
        if (_state.phase === 'tour') _render();
    });
}
```
**APRÈS :**
```js
function _onPhaseWS(p) {
    _state = { ..._state, ...p };
    if (p.phase !== 'tour') _mot = null;
    _render();
    if (p.phase === 'tour' && p.tsTourEnd) _startTimer(); else _stopTimer();
}
function _onMotWS(p) {
    _mot = p.mot || null;
    if (_state.phase === 'tour') _render();
}
function _brancherSocket() {
    if (socket._mimeHoteBound) return;
    socket._mimeHoteBound = true;
    socket.off('MIMEDESSSINE_PHASE', _onPhaseWS);
    socket.on('MIMEDESSSINE_PHASE', _onPhaseWS);
    socket.off('MIMEDESSSINE_MOT_A_DEVINER', _onMotWS);
    socket.on('MIMEDESSSINE_MOT_A_DEVINER', _onMotWS);
}

// Purge — appelée à GAME_ENDED via cleanup.resetEtatJeuxHote().
export function nettoyerPartieInvites() {
    socket.off('MIMEDESSSINE_PHASE', _onPhaseWS);
    socket.off('MIMEDESSSINE_MOT_A_DEVINER', _onMotWS);
    socket._mimeHoteBound = false;
    console.log('[MIMEDESSINE] 🧹 Listeners WS purgés');
}
```

**Risque** : faible. On réutilise le chemin de purge déjà déclenché à `GAME_ENDED`. Aucun nouveau flux.

---

## L4 — Musique globale, persistante, indépendante des jeux

**But** : un contrôleur unique (`core/musique.js`, fourni à part) ; état persistant `mgu_music` (on/off + volume) **non purgé** par cleanup ; synchro de tous les boutons et **entre les pages** index ↔ jeu (event `storage`) ; activation du contrôle invité (aujourd'hui désactivé) ; correction du bug dormant (`lancerMusique` jamais appelé).

### 0) Nouveau fichier : `core/musique.js`
→ Fourni séparément (`musique.js`). À déposer dans `public/js/core/`.

### 1) `main.js` (hôte) — initialiser le contrôleur + câbler le bouton

**AVANT (fonction complète) :**
```js
function lancerMusique() {
    const audio = document.getElementById("bg-music");
    if (!audio) return;
    audio.volume = 0.4;

    const toggle = document.getElementById("toggle-music");
    if (!toggle) return;
    toggle.onclick = function() {
        if (audio.paused) { audio.play(); toggle.textContent = "🔊"; }
        else { audio.pause(); toggle.textContent = "🔇"; }
    };
}
```
**APRÈS :**
```js
function lancerMusique() {
    Musique.init();
    // Le bouton principal suit l'état global (icône + aria) et le bascule au clic.
    Musique.bindBouton('toggle-music', { on: '🔊', off: '🔇' });
}
```

**Ajouter l'import** (avec les autres imports `core/`) :
```js
import Musique from "./core/musique.js";
```

**Appeler `lancerMusique()` dans la séquence d'init** (bug : elle n'est jamais appelée aujourd'hui). Dans `initAppliqueGlobale()`, ÉTAPE 5, **AVANT** `initNavigation();` :
```js
    initModeCards();
    initStartSolo();
    masquerUndercoverComplet();
    lancerMusique();              // ← AJOUT : initialise la musique globale
    initNavigation();
```

### 2) `jeu.html` (invité) — ajouter l'audio + un bouton dans la navbar

`jeu.html` n'a **aucun** `<audio>`. Dans la navbar invité existante :

**AVANT :**
```html
<nav class="invite-navbar" id="invite-navbar" aria-label="Navigation invité">
  <button class="invite-nav-btn" id="btn-home-permanent"
          aria-label="Retour à l'accueil">🏠</button>
  <button class="invite-nav-btn" id="btn-menu-permanent"
          aria-label="Ouvrir le menu">☰</button>
</nav>
```
**APRÈS :**
```html
<audio id="bg-music" src="audio/ambiance.mp3" loop></audio>

<nav class="invite-navbar" id="invite-navbar" aria-label="Navigation invité">
  <button class="invite-nav-btn" id="btn-home-permanent"
          aria-label="Retour à l'accueil">🏠</button>
  <button class="invite-nav-btn" id="btn-music-invite"
          aria-label="Activer ou couper la musique">🔇</button>
  <button class="invite-nav-btn" id="btn-menu-permanent"
          aria-label="Ouvrir le menu">☰</button>
</nav>
```
> Réutilise la classe existante `invite-nav-btn` → aucun CSS nouveau. L'icône initiale est reflétée par le contrôleur au `bindBouton`.

### 3) `jeu.js` (invité) — initialiser le contrôleur

**Ajouter l'import** en tête :
```js
import Musique from './core/musique.js';
```
Dans `_demarrer(session)`, après `window.jeuSocket = socket;` :
```js
        Musique.init();
        Musique.bindBouton('btn-music-invite', { on: '🔊', off: '🔇' });
```

### 4) `reglages.js` (hôte) — brancher le toggle réglages sur le contrôleur

Le bouton `#toggle-music-reglages` existe déjà. **Remplacer** son bloc de câblage (« ── Toggle musique ── », ~ligne 307) par :
```js
    // ── Toggle musique (état global persistant) ─────────
    Musique.bindBouton('toggle-music-reglages', { classeOn: 'on' });
```
**Ajouter l'import** en tête de `reglages.js` :
```js
import Musique from './core/musique.js';
```
> Supprime la logique `audio.muted` locale et la resynchro manuelle avec `#toggle-music` : tout passe par l'état global.

### 5) `navigation.js` (invité) — activer le toggle réglages invité

Dans `_ouvrirReglagesInvite()`, **remplacer** le bloc « 🚧 bientôt disponible » :

**AVANT :**
```html
                <div class="reglages-row" style="opacity:.35;filter:grayscale(100%);">
                    <span class="reglages-row-label" style="text-decoration:line-through;">Musique</span>
                    <button class="toggle-switch" disabled
                        style="cursor:not-allowed;pointer-events:none;">
                        <span class="toggle-switch-knob"></span>
                    </button>
                </div>
                <p style="font-size:.75rem;color:rgba(255,255,255,.35);margin-top:4px;">
                    🚧 Fonctionnalité bientôt disponible
                </p>
```
**APRÈS :**
```html
                <div class="reglages-row">
                    <span class="reglages-row-label">Musique</span>
                    <button class="toggle-switch" id="toggle-music-invite-reglages"
                        aria-label="Activer ou couper la musique">
                        <span class="toggle-switch-knob"></span>
                    </button>
                </div>
```
Puis, après `document.body.appendChild(panel);` (panneau injecté), **brancher** :
```js
    import('./core/musique.js').then(({ default: Musique }) => {
        Musique.bindBouton('toggle-music-invite-reglages', { classeOn: 'on' });
    });
```

**Risque** : L4 est local/UI, aucun flux WS. Point d'attention : l'autoplay navigateur — le contrôleur gère la reprise au 1er geste (déjà implémenté).

---

## Checklist de validation (alignée QA.md)

**L3**
- [ ] L'hôte crée une partie → le lien affiché et le QR pointent vers `/jeu?…&code=…` (code court présent).
- [ ] Un invité scanne le QR → arrive sur l'écran d'identification avec les métadonnées correctes.
- [ ] L'hôte rafraîchit (HOST_REJOIN) → le lien/QR reste identique (pas de divergence `/jeu` vs `/jeu.html`).

**L2**
- [ ] Jouer une partie undercover → la terminer → démarrer un autre jeu : aucun log undercover (`_publierEtatPublic`) ne se déclenche pendant le 2e jeu.
- [ ] Console : `[UNDERCOVER_HOTE] 🧹 Listeners WS purgés` à la fin de partie.
- [ ] (si §3) idem mimedessine, aucun doublon de rendu en enchaînant.

**L4**
- [ ] Activer la musique sur l'accueil → naviguer vers une partie : la musique **continue** (état conservé).
- [ ] Couper la musique côté invité (navbar) → l'état persiste après refresh de `jeu.html`.
- [ ] Les 3 contrôles (accueil, réglages hôte, invité) affichent le **même** état après chaque bascule.
- [ ] Terminer une partie / enchaîner : la musique ne se **réinitialise pas**.
- [ ] La clé `mgu_music` survit à `nettoyerSession()` (vérifier qu'elle n'est pas dans les préfixes/clés purgés — c'est le cas).

---

## Récapitulatif des fichiers touchés

| Fichier | Chantier | Nature |
|---|---|---|
| `core/musique.js` | L4 | **Nouveau** |
| `core/host_session.js` | L3 | 2 éditions (GAME_CREATED, HOST_REJOINED) |
| `modules/invite.js` | L3 | 3 éditions (setter, builder, reset) |
| `modules/undercover_hote.js` | L2 | 1 ajout (`nettoyerPartieInvites`) |
| `core/cleanup.js` | L2 | 1 édition (registre) |
| `jeux/mimedessine.js` | L2 (opt.) | refactor handlers nommés + purge |
| `main.js` | L4 | import + `lancerMusique` réécrite + appel dans init |
| `jeu.html` | L4 | audio + bouton navbar |
| `jeu.js` | L4 | import + init contrôleur |
| `reglages.js` | L4 | import + bind toggle |
| `navigation.js` | L4 | toggle invité activé + bind |