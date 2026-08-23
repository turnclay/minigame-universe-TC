// ======================================================
// server/games/wikidata-validator.js — v1.0
// ======================================================
// Validation live Wikidata pour catégories dynamiques :
//   - celebrite  : humain réel, sitelinks ≥ 20, occupation publique
//   - personnage : personnage fictif, sitelinks ≥ 10, œuvre connue
//
// Pipeline : wbsearchentities → filtrage lettre → ASK SPARQL → cache
// Latence cible : < 300 ms (cache chaud), < 500 ms (miss)
// ======================================================

import https from 'https';

// ─────────────────────────────────────────────────────
// CACHE (TTL 24h, LRU simplifié par Map insertion-order)
// ─────────────────────────────────────────────────────

const CACHE_TTL_MS  = 24 * 60 * 60 * 1000; // 24h
const CACHE_MAX     = 5000;                  // entrées max

class TtlCache {
    constructor(ttl = CACHE_TTL_MS, max = CACHE_MAX) {
        this._map = new Map();
        this._ttl = ttl;
        this._max = max;
    }

    get(key) {
        const entry = this._map.get(key);
        if (!entry) return undefined;
        if (Date.now() > entry.exp) { this._map.delete(key); return undefined; }
        return entry.val;
    }

    set(key, val) {
        if (this._map.size >= this._max) {
            // Éviction FIFO : supprimer la plus ancienne entrée
            this._map.delete(this._map.keys().next().value);
        }
        this._map.set(key, { val, exp: Date.now() + this._ttl });
    }

    has(key) { return this.get(key) !== undefined; }

    stats() {
        return { size: this._map.size, max: this._max };
    }
}

// Cache QID → résultat de validation
const qidCache   = new TtlCache();
// Cache label_normalisé → { qid, valid, reason }
const labelCache = new TtlCache();

// ─────────────────────────────────────────────────────
// HELPERS HTTP
// ─────────────────────────────────────────────────────

function httpGet(url, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': 'MiniGameUniverse/1.0' } }, res => {
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error('JSON parse error')); }
            });
        });
        req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Timeout')); });
        req.on('error', reject);
    });
}

// ─────────────────────────────────────────────────────
// NORMALISATION (identique à dictionnaires.js)
// ─────────────────────────────────────────────────────

function normaliser(mot) {
    return String(mot || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/['']/g, '')
        .trim();
}

function premiereLettre(v) {
    return String(v || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .charAt(0).toUpperCase();
}

// ─────────────────────────────────────────────────────
// ÉTAPE 1 : Recherche de candidats Wikidata
// ─────────────────────────────────────────────────────

/**
 * Cherche des entités Wikidata dont le label commence par `lettre`.
 * Retourne jusqu'à 5 QID candidats (au lieu d'un seul) — un nom ambigu
 * (patronyme, marque, filiale légale...) retourne plusieurs entités
 * homonymes ; se limiter au 1er résultat de recherche fait rejeter à tort
 * des réponses valides si la "bonne" entité n'est pas en tête de liste.
 */
async function rechercherCandidats(valeur, lettre) {
    const cacheKey = `search:${normaliser(valeur)}`;
    const cached = labelCache.get(cacheKey);
    if (cached !== undefined) return cached; // tableau, peut être vide

    const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities`
        + `&search=${encodeURIComponent(valeur)}&language=fr&type=item&limit=20&format=json`;

    let data;
    try { data = await httpGet(url); }
    catch (e) { console.warn('[WIKIDATA] wbsearchentities échoué:', e.message); return []; }

    const lettreMaj = lettre.toUpperCase();

    // Filtrer : label ou alias doit commencer par la lettre
    const candidats = (data.search || []).filter(item => {
        const lbl = item.label || '';
        const alt = (item.aliases || []).join(' ');
        return premiereLettre(lbl) === lettreMaj
            || alt.split(' ').some(a => premiereLettre(a) === lettreMaj);
    }).slice(0, 5).map(item => item.id);

    labelCache.set(cacheKey, candidats);
    return candidats;
}

// ─────────────────────────────────────────────────────
// ÉTAPE 2 : ASK SPARQL
// ─────────────────────────────────────────────────────

async function sparqlAsk(query) {
    const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
    try {
        const data = await httpGet(url, 5000);
        return data?.boolean === true;
    } catch (e) {
        console.warn('[WIKIDATA] SPARQL ASK échoué:', e.message);
        return null; // null = indéterminé → dégradation gracieuse
    }
}

// ─────────────────────────────────────────────────────
// ÉTAPE 3 : Validateurs par catégorie
// ─────────────────────────────────────────────────────

// Occupations publiques reconnues pour "célébrité"
const OCCUPATIONS_CELEBRITE = [
    'wd:Q33999',   // acteur
    'wd:Q10800557', // acteur de film
    'wd:Q177220',  // chanteur
    'wd:Q639669',  // musicien
    'wd:Q82955',   // politicien
    'wd:Q36180',   // écrivain
    'wd:Q482980',  // auteur
    'wd:Q937857',  // footballeur
    'wd:Q2066131', // athlète
    'wd:Q3665646', // sportif
    'wd:Q10843263', // chanteur populaire
    'wd:Q12362622', // acteur de télévision
    'wd:Q2526255',  // réalisateur de film
    'wd:Q28389',    // scénariste
    'wd:Q1231865',  // personnalité télévisuelle
    'wd:Q245068',   // acteur comique
    'wd:Q10798782', // acteur américain
    'wd:Q4610556',  // influenceur
    'wd:Q14089670', // youtuber
    'wd:Q488111',   // chef d'État
].join(' ');

// Types fictifs reconnus
const TYPES_FICTIF = [
    'wd:Q95074',     // personnage de fiction
    'wd:Q21070598',  // personnage fictif
    'wd:Q15709879',  // personnage de dessin animé
    'wd:Q1404417',   // personnage de manga
    'wd:Q4194195',   // personnage de jeu vidéo
].join(' ');

// Types de lieux vérifiés en direct (P31 exact).
// Q484170 "commune de France" est un statut ADMINISTRATIF — sous-classe de
// "administrative territorial entity of France" (Q192498), PAS de
// "établissement humain" (Q486972). Le check transitif seul ne matche donc
// jamais une commune française réelle (~35 000 entités) : c'était la cause
// exacte du rejet de Juvisy-sur-Orge. D'où le check direct ci-dessous, en
// complément du fallback transitif pour les lieux hors France.
const TYPES_LIEU_DIRECT = [
    'wd:Q484170',   // commune de France
    'wd:Q515',      // ville (city)
    'wd:Q3957',     // ville (town)
    'wd:Q532',      // village
    'wd:Q1549591',  // grande ville
    'wd:Q5119',     // capitale
].join(' ');
const TYPE_ETABLISSEMENT_HUMAIN = 'wd:Q486972';

// Types "marque" reconnus. Constat terrain : les marques importées via
// registres légaux (ex: SIRENE pour la France) sont souvent typées
// génériquement "organisation" plutôt que "marque" au sens strict —
// d'où l'inclusion de Q43229 en filet large, + fallback transitif vers
// "marque" (Q431289) et "entreprise" (Q4830453) pour les sous-classes
// spécifiques (maison de couture, marque de mode, etc.) non listées ici.
const TYPES_MARQUE_DIRECT = ['wd:Q43229'].join(' '); // organisation

async function validerCelebrite(qid) {
    const cached = qidCache.get(`cel:${qid}`);
    if (cached !== undefined) return cached;

    // Test 1 : est un humain
    const estHumain = await sparqlAsk(
        `ASK { wd:${qid} wdt:P31 wd:Q5 }`
    );
    if (estHumain === false) {
        const r = { valid: false, reason: 'Pas un humain' };
        qidCache.set(`cel:${qid}`, r); return r;
    }

    // Tests en parallèle pour gagner du temps
    const [aSitelinks, aOccupation] = await Promise.all([
        sparqlAsk(`ASK { wd:${qid} wikibase:sitelinks ?s . FILTER(?s >= 20) }`),
        sparqlAsk(`ASK { wd:${qid} wdt:P106 ?occ . VALUES ?occ { ${OCCUPATIONS_CELEBRITE} } }`),
    ]);

    let valid, reason;

    if (estHumain === null || aSitelinks === null) {
        // API indisponible → dégradation gracieuse : accepter
        valid  = true;
        reason = 'Indéterminé (API Wikidata injoignable) — accepté par défaut';
    } else if (!aSitelinks) {
        valid  = false;
        reason = 'Notoriété insuffisante (sitelinks < 20)';
    } else if (!aOccupation) {
        // Sitelinks OK mais occupation non reconnue : toléré (célébrité atypique)
        valid  = true;
        reason = 'Célébrité tolérée (occupation non listée mais notoriété suffisante)';
    } else {
        valid  = true;
        reason = 'Célébrité validée';
    }

    const r = { valid, reason, qid };
    qidCache.set(`cel:${qid}`, r);
    return r;
}

async function validerPersonnage(qid) {
    const cached = qidCache.get(`per:${qid}`);
    if (cached !== undefined) return cached;

    // Tests en parallèle
    const [estFictif, aSitelinks, aOeuvre] = await Promise.all([
        sparqlAsk(`ASK { wd:${qid} wdt:P31 ?t . VALUES ?t { ${TYPES_FICTIF} } }`),
        sparqlAsk(`ASK { wd:${qid} wikibase:sitelinks ?s . FILTER(?s >= 10) }`),
        sparqlAsk(`ASK { wd:${qid} (wdt:P1441|wdt:P1080) ?work }`),
    ]);

    let valid, reason;

    if (estFictif === null || aSitelinks === null) {
        valid  = true;
        reason = 'Indéterminé (API Wikidata injoignable) — accepté par défaut';
    } else if (!estFictif) {
        valid  = false;
        reason = 'Pas un personnage fictif reconnu';
    } else if (!aSitelinks) {
        valid  = false;
        reason = 'Notoriété insuffisante (sitelinks < 10)';
    } else if (!aOeuvre) {
        // Fictif + notoriété mais pas d'œuvre connue : toléré
        valid  = true;
        reason = 'Personnage fictif toléré (œuvre non indexée)';
    } else {
        valid  = true;
        reason = 'Personnage fictif validé';
    }

    const r = { valid, reason, qid };
    qidCache.set(`per:${qid}`, r);
    return r;
}

async function validerVille(qid) {
    const cached = qidCache.get(`vil:${qid}`);
    if (cached !== undefined) return cached;

    const estLieu = await sparqlAsk(
        `ASK {
            { wd:${qid} wdt:P31 ?t . VALUES ?t { ${TYPES_LIEU_DIRECT} } }
            UNION
            { wd:${qid} wdt:P31/wdt:P279* ${TYPE_ETABLISSEMENT_HUMAIN} }
        }`
    );

    let valid, reason;

    if (estLieu === null) {
        valid  = true;
        reason = 'Indéterminé (API Wikidata injoignable) — accepté par défaut';
    } else if (!estLieu) {
        valid  = false;
        reason = 'Pas un lieu habité reconnu';
    } else {
        valid  = true;
        reason = 'Ville/lieu habité validé';
    }

    const r = { valid, reason, qid };
    qidCache.set(`vil:${qid}`, r);
    return r;
}

async function validerMarque(qid) {
    const cached = qidCache.get(`mar:${qid}`);
    if (cached !== undefined) return cached;

    const estMarque = await sparqlAsk(
        `ASK {
            { wd:${qid} wdt:P31 ?t . VALUES ?t { ${TYPES_MARQUE_DIRECT} } }
            UNION
            { wd:${qid} wdt:P31/wdt:P279* wd:Q431289 }
            UNION
            { wd:${qid} wdt:P31/wdt:P279* wd:Q4830453 }
        }`
    );

    let valid, reason;

    if (estMarque === null) {
        valid  = true;
        reason = 'Indéterminé (API Wikidata injoignable) — accepté par défaut';
    } else if (!estMarque) {
        valid  = false;
        reason = 'Pas une marque/entreprise reconnue';
    } else {
        valid  = true;
        reason = 'Marque validée';
    }

    const r = { valid, reason, qid };
    qidCache.set(`mar:${qid}`, r);
    return r;
}

// ─────────────────────────────────────────────────────
// API PUBLIQUE
// ─────────────────────────────────────────────────────

/**
 * Valide une réponse joueur pour une catégorie dynamique Wikidata.
 * Teste jusqu'à 5 candidats homonymes en parallèle, accepte dès que l'un
 * d'eux correspond à la catégorie (cf rechercherCandidats).
 *
 * @param {'celebrite'|'personnage'|'ville'|'marque'} categorie
 * @param {string} valeur  - Réponse brute du joueur
 * @param {string} lettre  - Lettre imposée (ex: 'M')
 * @returns {Promise<{ valid: boolean, reason?: string, qid?: string }>}
 */
export async function validerWikidata(categorie, valeur, lettre) {
    const v = String(valeur || '').trim();
    if (!v) return { valid: false, reason: 'Réponse vide' };
    if (premiereLettre(v) !== lettre.toUpperCase()) {
        return { valid: false, reason: `Ne commence pas par ${lettre}` };
    }

    const VALIDATEURS = {
        celebrite  : validerCelebrite,
        personnage : validerPersonnage,
        ville      : validerVille,
        marque     : validerMarque,
    };
    const validate = VALIDATEURS[categorie];
    if (!validate) return { valid: false, reason: `Catégorie inconnue: ${categorie}` };

    const candidats = await rechercherCandidats(v, lettre);
    if (candidats.length === 0) return { valid: false, reason: 'Introuvable sur Wikidata' };

    const resultats = await Promise.all(candidats.map(qid => validate(qid)));

    const trouve = resultats.find(r => r.valid);
    if (trouve) return trouve;

    // Aucun candidat valide → dégradation gracieuse si l'API a été injoignable
    // pour au moins un candidat, sinon rejet avec la raison du 1er candidat
    const indetermine = resultats.find(r => r.reason?.startsWith('Indéterminé'));
    return indetermine || resultats[0] || { valid: false, reason: 'Aucun candidat valide' };
}

export function cacheStats() {
    return { qid: qidCache.stats(), label: labelCache.stats() };
}