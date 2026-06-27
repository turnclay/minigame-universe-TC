// ======================================================
// 📖 server/games/dictionnaires.js — v2.0 (Set OU Bloom par dico)
// ======================================================
// Registre MULTI-DICTIONNAIRES serveur (anti-triche Petit Bac).
//
// Chaque dico logique a DEUX backends possibles, choisis automatiquement :
//   - <base>.bloom  → filtre de Bloom (dicos VOLUMINEUX, ~2 Mo RAM,
//                     faux positifs ~0,5 %). Priorité si présent.
//   - <base>.txt    → Set exact (lookup O(1)).
//   - aucun         → mode dégradé : motExisteDans() renvoie true
//                     (catégorie tolérée en « lettre seule »).
//
// Normalisation identique partout : NFD → sans accents → minuscules
// → sans apostrophes. JAMAIS exposé au client.
//
// Sources : general=fr-words(MIT) · pays(CC0/FR) · ville(GeoNames CC BY)
//           marque/personnage(Wikidata CC0, .txt) · celebrite(Wikidata
//           CC0, .bloom généré par scripts/generer-celebrites-wikidata.mjs).
// ======================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BloomFilter } from './bloom.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.join(__dirname, '../data');

// Nom logique → basename de fichier (sans extension).
const BASENAMES = {
    general    : 'fr-words',
    pays       : 'pays',
    ville      : 'villes',
    marque     : 'marques',
    personnage : 'personnages',
    celebrite  : 'celebrites',
};

const _dicos = new Map(); // nom → { type:'set'|'bloom'|'none', set?, bloom?, pret }

function _normaliser(mot) {
    return String(mot || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/['’]/g, '')
        .trim();
}

function _charger(nom) {
    if (_dicos.has(nom)) return _dicos.get(nom);
    const entry = { type: 'none', pret: false };
    const base  = BASENAMES[nom];

    if (base) {
        const bloomPath = path.join(DATA_DIR, base + '.bloom');
        const txtPath   = path.join(DATA_DIR, base + '.txt');
        try {
            if (fs.existsSync(bloomPath)) {
                entry.bloom = BloomFilter.fromBuffer(fs.readFileSync(bloomPath));
                entry.type  = 'bloom';
                entry.pret  = true;
                console.log(`[DICO] ✅ ${nom}: bloom m=${entry.bloom.m} k=${entry.bloom.k} (${base}.bloom)`);
            } else if (fs.existsSync(txtPath)) {
                const set = new Set();
                const raw = fs.readFileSync(txtPath, 'utf-8');
                for (const ligne of raw.split('\n')) {
                    const n = _normaliser(ligne);
                    if (n) set.add(n);
                }
                entry.set  = set;
                entry.type = 'set';
                entry.pret = true;
                console.log(`[DICO] ✅ ${nom}: ${set.size} entrées (${base}.txt)`);
            } else {
                console.warn(`[DICO] ⚠️ ${nom} indisponible (${base}.bloom/.txt absent) — catégorie tolérée (lettre seule)`);
            }
        } catch (e) {
            console.warn(`[DICO] ⚠️ ${nom} erreur chargement (${e.message}) — catégorie tolérée (lettre seule)`);
        }
    }

    _dicos.set(nom, entry);
    return entry;
}

export function chargerTousDictionnaires() {
    for (const nom of Object.keys(BASENAMES)) _charger(nom);
}

export function dictionnairePret(nom) {
    return _charger(nom).pret;
}

// Renvoie true si le mot existe dans le dico nommé.
// Mode dégradé (aucun fichier) → true (ne bloque pas le jeu).
export function motExisteDans(nom, mot) {
    const d = _charger(nom);
    if (!d.pret) return true;
    const n = _normaliser(mot);
    return d.type === 'bloom' ? d.bloom.has(n) : d.set.has(n);
}

// Pré-chargement au démarrage.
chargerTousDictionnaires();