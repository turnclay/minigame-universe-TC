// /js/modules/migrations.js
// One-shot client-side migrations related to localStorage / parties

/**
 * Migrate saved parties to canonical shape:
 *  - ensure each party has a sessionId field (string)
 *  - ensure each party has a canonical name field nomPartie
 *  - write back updated parties only once and set a migration flag
 */
export function migratePartiesToCanonical() {
    try {
        const FLAG = 'migrations_parties_v1_done';
        if (localStorage.getItem(FLAG)) return false;

        const raw = localStorage.getItem('parties');
        if (!raw) { localStorage.setItem(FLAG, '1'); return false; }
        let list;
        try { list = JSON.parse(raw) || []; } catch { localStorage.setItem(FLAG, '1'); return false; }
        let changed = false;

        list = list.map(p => {
            const copy = { ...p };
            // Ensure sessionId exists: prefer existing sessionId, else fallback to p.sessionIdLegacy or String(p.id)
            if (!copy.sessionId) {
                copy.sessionId = copy.sessionId || copy.sessionIdLegacy || String(copy.id || '');
                changed = true;
            }
            // Ensure canonical name
            if (!copy.nomPartie) {
                copy.nomPartie = copy.nomPartie || copy.nom || copy.partieNom || '';
                changed = true;
            }
            return copy;
        });

        if (changed) {
            localStorage.setItem('parties', JSON.stringify(list));
            console.log('[MIGRATION] parties -> canonical: applied', list.length);
        } else {
            console.log('[MIGRATION] parties -> canonical: nothing to do');
        }
        localStorage.setItem(FLAG, '1');
        return changed;
    } catch (e) {
        console.warn('[MIGRATION] parties -> canonical: failed', e && e.message);
        return false;
    }
}
