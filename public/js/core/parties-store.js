// ======================================================
// 📦 public/js/core/parties-store.js — v1.0
// Gestion locale des parties (localStorage)
// MiniGame Universe
// ======================================================
//
// RESPONSABILITÉS :
//   – Lire / écrire mgu_parties dans localStorage
//   – Structure canonique de chaque entrée
//   – Nettoyage automatique (expiration, doublons, terminées)
//   – Recherche locale et distante par nom exact ou ID
//   – Reprise de partie (local → serveur)
//
// STRUCTURE CANONIQUE d'une entrée :
// {
//   partieId  : string   — UUID côté serveur
//   nom       : string   — nom de la partie
//   jeu       : string   — identifiant du jeu (ex: "quiz")
//   mode      : string   — "solo" | "team"
//   statut    : string   — "lobby" | "en_cours" | "terminee"
//   scores    : object   — { [pseudo]: number }
//   joueurs   : object[] — [{ pseudo, equipe }]
//   equipes   : object[] — [{ nom }]
//   code      : string|null — code court de la partie
//   savedAt   : number   — Date.now() à la sauvegarde
//   lastSeen  : number   — Date.now() au dernier accès / join
//   createdAt : number   — timestamp de création (serveur)
// }
//
// STRATÉGIE DE NETTOYAGE :
//   – Terminées depuis > TTL_TERMINEE (2j) : supprimées
//   – En cours depuis > TTL_EN_COURS (7j)  : marquées terminées
//   – Lobby depuis > TTL_LOBBY (24h)       : supprimées
//   – Doublons sur partieId               : seule la plus récente survit
//   – Maximum MAX_ENTRIES entrées          : les plus vieilles sautent
//
// DÉPENDANCES :
//   – Aucune. Module pur, zéro dépendance externe.
// ======================================================

// ─────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────

const KEY              = 'mgu_parties';
const MAX_ENTRIES      = 50;

const TTL = {
    lobby     :  24 * 60 * 60 * 1000,  //  1 jour
    en_cours  :   7 * 24 * 60 * 60 * 1000,  //  7 jours
    terminee  :   2 * 24 * 60 * 60 * 1000,  //  2 jours
};

// ─────────────────────────────────────────────────────
// I/O BRUTE
// ─────────────────────────────────────────────────────

function _load() {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function _save(parties) {
    try {
        localStorage.setItem(KEY, JSON.stringify(parties));
    } catch (e) {
        // localStorage plein — on tente de libérer de la place
        console.warn('[PartiesStore] localStorage plein, nettoyage forcé');
        const cleaned = _nettoyerInterne(parties, { force: true });
        try {
            localStorage.setItem(KEY, JSON.stringify(cleaned));
        } catch {
            // Abandon silencieux : pas bloquant pour l'UI
        }
    }
}

// ─────────────────────────────────────────────────────
// NETTOYAGE INTERNE
// ─────────────────────────────────────────────────────

/**
 * Nettoie un tableau de parties en mémoire.
 * Appelé lors du chargement ET à chaque sauvegarde.
 * @param {object[]} parties
 * @param {{ force?: boolean }} opts
 * @returns {object[]} parties nettoyées
 */
function _nettoyerInterne(parties, { force = false } = {}) {
    const now = Date.now();

    // 1. Dédoublonner par partieId — garde la plus récente (lastSeen DESC)
    const map = new Map();
    for (const p of parties) {
        if (!p.partieId) continue;
        const existing = map.get(p.partieId);
        if (!existing || (p.lastSeen || p.savedAt || 0) > (existing.lastSeen || existing.savedAt || 0)) {
            map.set(p.partieId, p);
        }
    }

    // 2. Filtrer les expirées
    const filtered = Array.from(map.values()).filter(p => {
        const age = now - (p.savedAt || p.createdAt || 0);
        const statut = p.statut || 'lobby';

        // Parties terminées : TTL court
        if (statut === 'terminee' || statut === 'ended') {
            return age < TTL.terminee;
        }
        // En cours : TTL long
        if (statut === 'en_cours' || statut === 'started') {
            if (age > TTL.en_cours) {
                // Marquer comme expirée plutôt que supprimer (conserve l'historique)
                p.statut = 'terminee';
                p._expired = true;
                return age < TTL.terminee;
            }
            return true;
        }
        // Lobby : TTL 1 jour
        return age < TTL.lobby;
    });

    // 3. Trier : en_cours → lobby → terminée / plus récent en premier
    const ORDER = { en_cours: 0, started: 0, lobby: 1, waiting: 1, terminee: 2, ended: 2 };
    filtered.sort((a, b) => {
        const sa = ORDER[a.statut] ?? 9;
        const sb = ORDER[b.statut] ?? 9;
        if (sa !== sb) return sa - sb;
        return (b.lastSeen || b.savedAt || 0) - (a.lastSeen || a.savedAt || 0);
    });

    // 4. Limiter le nombre d'entrées
    const limit = force ? Math.floor(MAX_ENTRIES / 2) : MAX_ENTRIES;
    return filtered.slice(0, limit);
}

// ─────────────────────────────────────────────────────
// API PUBLIQUE — LECTURE
// ─────────────────────────────────────────────────────

/**
 * Retourne toutes les parties locales (après nettoyage).
 * @returns {object[]}
 */
export function getLocalParties() {
    const raw     = _load();
    const cleaned = _nettoyerInterne(raw);
    // Persister le nettoyage si quelque chose a changé
    if (cleaned.length !== raw.length) _save(cleaned);
    return cleaned;
}

/**
 * Retourne une partie locale par son ID.
 * @param {string} partieId
 * @returns {object|null}
 */
export function getLocalPartie(partieId) {
    if (!partieId) return null;
    return getLocalParties().find(p => p.partieId === partieId) || null;
}

// ─────────────────────────────────────────────────────
// API PUBLIQUE — RECHERCHE
// ─────────────────────────────────────────────────────

/**
 * Recherche des parties locales par nom exact (insensible à la casse).
 *
 * Tri de pertinence :
 *   1. En cours   (actives en priorité)
 *   2. Lobby      (ouverte mais pas encore lancée)
 *   3. Terminée
 *   4. À égalité de statut → plus récente en premier
 *
 * Gestion des collisions :
 *   Si plusieurs parties portent le même nom (rare),
 *   elles sont toutes retournées triées — c'est à l'appelant
 *   de proposer un choix à l'utilisateur.
 *
 * @param {string} query — nom exact à chercher
 * @returns {object[]}   — tableau trié, peut être vide
 */
export function searchLocalParties(query) {
    if (!query || !query.trim()) return [];

    const q = query.trim().toLowerCase();
    return getLocalParties()
        .filter(p => (p.nom || '').toLowerCase() === q);
    // Déjà triées par _nettoyerInterne (en_cours > lobby > terminée)
}

/**
 * Recherche côté serveur par nom exact via l'API REST.
 * Retourne le premier résultat non-terminé, ou null.
 *
 * @param {string} nom
 * @returns {Promise<object|null>}
 */
export async function searchServerPartieByName(nom) {
    if (!nom || !nom.trim()) return null;

    try {
        // Essaie d'abord la route dédiée
        const encoded = encodeURIComponent(nom.trim());
        const res = await fetch(`/api/parties/by-name/${encoded}`, {
            signal: AbortSignal.timeout(5000),
        });

        if (res.ok) {
            const data = await res.json();
            const partie = data.partie || data;
            if (partie?.id || partie?.partieId) return partie;
        }

        // Fallback : liste complète + filtre local
        const res2 = await fetch('/api/parties', { signal: AbortSignal.timeout(5000) });
        if (!res2.ok) return null;
        const data2 = await res2.json();
        const all   = data2.parties || data2 || [];

        return all.find(
            p => (p.nom || '').toLowerCase() === nom.trim().toLowerCase() &&
                 p.statut !== 'terminee' && p.statut !== 'ended'
        ) || null;

    } catch (err) {
        console.warn('[PartiesStore] searchServerPartieByName erreur:', err.message);
        return null;
    }
}

// ─────────────────────────────────────────────────────
// API PUBLIQUE — ÉCRITURE
// ─────────────────────────────────────────────────────

/**
 * Sauvegarde ou met à jour une partie locale à partir d'un snapshot serveur.
 *
 * Canonise les champs pour unifier les conventions de nommage
 * (snapshot.id || snapshot.partieId, etc.)
 *
 * @param {object} snapshot — snapshot brut du serveur ou objet partiel
 * @param {object} [extra]  — champs supplémentaires (code, lastSeen…)
 */
export function saveLocalPartie(snapshot, extra = {}) {
    if (!snapshot) return;

    const partieId = snapshot.id || snapshot.partieId;
    if (!partieId) {
        console.warn('[PartiesStore] saveLocalPartie: partieId manquant');
        return;
    }

    const now = Date.now();

    const entry = {
        partieId,
        nom      : snapshot.nom       || '',
        jeu      : snapshot.jeu       || '',
        mode     : snapshot.mode      || 'solo',
        statut   : snapshot.statut    || 'lobby',
        scores   : snapshot.scores    || {},
        joueurs  : (snapshot.joueurs  || []).map(j => ({ pseudo: j.pseudo, equipe: j.equipe || null })),
        equipes  : snapshot.equipes   || [],
        code     : extra.code         || null,
        savedAt  : now,
        lastSeen : extra.lastSeen     || now,
        createdAt: snapshot.createdAt || now,
        ...extra,
    };

    const parties = _load();
    const idx = parties.findIndex(p => p.partieId === partieId);

    if (idx >= 0) {
        // Fusionner : ne pas écraser createdAt d'origine
        parties[idx] = {
            ...parties[idx],
            ...entry,
            createdAt: parties[idx].createdAt || entry.createdAt,
        };
    } else {
        parties.push(entry);
    }

    _save(_nettoyerInterne(parties));
}

/**
 * Marque une partie locale comme terminée (sans la supprimer immédiatement).
 * @param {string} partieId
 */
export function markLocalPartieTerminee(partieId) {
    if (!partieId) return;
    const parties = _load();
    const p = parties.find(p => p.partieId === partieId);
    if (p) {
        p.statut  = 'terminee';
        p.savedAt = Date.now();
        _save(parties);
    }
}

/**
 * Supprime une partie locale par son index dans le tableau trié.
 * (Utilisé par le bouton 🗑 dans l'UI)
 * @param {string} partieId
 */
export function deleteLocalPartie(partieId) {
    if (!partieId) return;
    const parties = _load().filter(p => p.partieId !== partieId);
    _save(parties);
}

// ─────────────────────────────────────────────────────
// API PUBLIQUE — NETTOYAGE
// ─────────────────────────────────────────────────────

/**
 * Nettoie localStorage : expiration, doublons, limite max.
 * Idempotent, sans effet de bord si rien à faire.
 * @returns {{ avant: number, apres: number }}
 */
export function cleanupLocalParties() {
    const raw     = _load();
    const cleaned = _nettoyerInterne(raw);
    _save(cleaned);
    console.log(`[PartiesStore] Nettoyage : ${raw.length} → ${cleaned.length} entrées`);
    return { avant: raw.length, apres: cleaned.length };
}

// ─────────────────────────────────────────────────────
// API PUBLIQUE — REPRISE DE PARTIE
// ─────────────────────────────────────────────────────

/**
 * Reprend une partie locale : vérifie son statut côté serveur,
 * met à jour l'entrée locale, et retourne l'URL de reprise.
 *
 * Gestion des erreurs :
 *   'not_found'  — partie introuvable sur le serveur
 *   'ended'      — partie terminée
 *   'no_host'    — partie accessible mais sans host actif (on tente quand même)
 *
 * @param {object} partie       — entrée locale (depuis getLocalParties)
 * @returns {Promise<{ ok: boolean, url?: string, reason?: string }>}
 */
export async function resumeFromLocal(partie) {
    if (!partie?.partieId) {
        return { ok: false, reason: 'invalid' };
    }

    // 1. Vérifier côté serveur
    try {
        const res = await fetch(`/api/parties/${partie.partieId}`, {
            signal: AbortSignal.timeout(5000),
        });

        if (!res.ok) {
            if (res.status === 404) {
                markLocalPartieTerminee(partie.partieId);
                return { ok: false, reason: 'not_found' };
            }
            return { ok: false, reason: `server_error_${res.status}` };
        }

        const data = await res.json();
        const snap = data.partie || data;

        // Partie terminée
        if (snap.statut === 'terminee' || snap.statut === 'ended') {
            markLocalPartieTerminee(partie.partieId);
            return { ok: false, reason: 'ended' };
        }

        // Mettre à jour l'entrée locale avec les données fraîches
        saveLocalPartie(snap, { lastSeen: Date.now() });

    } catch (err) {
        // Pas de réseau — on tente quand même de rejoindre (offline-first)
        console.warn('[PartiesStore] Impossible de vérifier côté serveur:', err.message);
    }

    // 2. Construire l'URL de reprise
    const url = buildResumeUrl(partie.partieId, partie.jeu);
    return { ok: true, url };
}

/**
 * Reprend une partie depuis un paramètre URL `?resume=<partieId>`.
 * À appeler dans init() des pages host/join.
 *
 * @returns {Promise<{ ok: boolean, url?: string, reason?: string }|null>}
 *   null si pas de paramètre resume
 */
export async function resumeFromUrl() {
    const params   = new URLSearchParams(location.search);
    const partieId = params.get('resume');
    if (!partieId) return null;

    // Chercher dans le local d'abord
    const local = getLocalPartie(partieId);
    if (local) return resumeFromLocal(local);

    // Pas en local → stub minimal
    return resumeFromLocal({ partieId });
}

/**
 * Construit l'URL de reprise host.
 * @param {string} partieId
 * @param {string} [jeu]
 * @returns {string}
 */
export function buildResumeUrl(partieId, jeu) {
    return `/host/?resume=${encodeURIComponent(partieId)}`;
}

// ─────────────────────────────────────────────────────
// API PUBLIQUE — TRI INTELLIGENT
// ─────────────────────────────────────────────────────

/**
 * Retourne les parties locales triées selon la priorité UX :
 *   1. En cours (actif)
 *   2. Lobby (ouvert)
 *   3. Terminée récemment
 *   Dans chaque groupe : plus récent (lastSeen) en premier.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.excludeTerminee=false] — exclure les terminées
 * @param {string}  [opts.jeu]                   — filtrer par jeu
 * @returns {object[]}
 */
export function getSortedLocalParties({ excludeTerminee = false, jeu = null } = {}) {
    let parties = getLocalParties();

    if (excludeTerminee) {
        parties = parties.filter(p => p.statut !== 'terminee' && p.statut !== 'ended');
    }
    if (jeu) {
        parties = parties.filter(p => p.jeu === jeu);
    }

    return parties;
    // getLocalParties() retourne déjà trié via _nettoyerInterne
}