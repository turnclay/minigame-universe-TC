// ======================================================
// 📖 server/games/dictionnaires.js — v3.0 (TXT uniquement)
// ======================================================
// Version simplifiée :
//   - Suppression complète du support BloomFilter
//   - Chargement uniquement des .txt
//   - Mode dégradé si aucun fichier trouvé
// ======================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.join(__dirname, '../data');

// Nom logique → basename de fichier (sans extension).
const BASENAMES = {
    general    : 'fr-words',
    pays       : 'pays',
    celebrite  : 'celebrites',
};

const _dicos = new Map(); // nom → { type:'set'|'none', set?, pret }

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
        const txtPath = path.join(DATA_DIR, base + '.txt');

        try {
            if (fs.existsSync(txtPath)) {
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
                console.warn(`[DICO] ⚠️ ${nom} indisponible (${base}.txt absent) — catégorie tolérée (lettre seule)`);
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
    return d.set.has(n);
}

// Pré-chargement au démarrage.
chargerTousDictionnaires();