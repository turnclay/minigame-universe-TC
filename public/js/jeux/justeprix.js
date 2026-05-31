// ============================================================
// /js/jeux/justeprix.js — v2.1 WS-server-driven (P5.4)
// ============================================================
// Le serveur tire les produits et calcule les points. Le client
// hôte affiche le produit reçu via JUSTEPRIX_PRODUIT_START, soumet
// son estimation, déclenche la révélation.
//
// v2.1 : #jp-produit-prix n'est plus un déclencheur de révélation
//        (chemin caché et redondant). La révélation passe uniquement
//        par #jp-btn-afficher-prix (câblé dans justeprix_hote.js).
//        #jp-produit-prix reste un simple porteur de texte du prix.
// ============================================================

import { $ } from '../core/dom.js';
import { GameState } from '../core/state.js';
import { socket } from '../core/socket.js';
import { afficherScoreboard } from '../modules/scoreboard.js';

let _produitCourant = null;   // payload public reçu (sans prix)
let _tsDebut        = 0;
let _dureeMs        = 60_000;
let _timerLocal     = null;
let _estimationEnvoyee = false;

let _injecterPanneauHote = () => {};

async function chargerModuleHote() {
    try {
        const m = await import('../modules/justeprix_hote.js');
        _injecterPanneauHote = m.injecterPanneauHote || (() => {});
        console.log('[JP] ✅ Module hôte chargé');
        return true;
    } catch (e) {
        console.warn('[JP] ⚠️ justeprix_hote.js indisponible :', e.message);
        return false;
    }
}

// ── Handlers events serveur ────────────────────────────────────

function _onProduitStart(payload) {
    _arreterTimer();
    _produitCourant     = payload.produit || null;
    _tsDebut            = payload.tsDebut || Date.now();
    _dureeMs            = payload.dureeMs || 60_000;
    _estimationEnvoyee  = false;

    if (payload.scores) {
        GameState.scores = GameState.scores || {};
        Object.assign(GameState.scores, payload.scores);
    }

    _afficherProduit(_produitCourant);
    _resetBoutonsHote();
    _demarrerTimer();
    console.log(`[JP] 🎲 Manche ${payload.manche} — produit reçu (sans prix)`);
}

function _onRevelation(payload) {
    _arreterTimer();
    const { produit, scores } = payload;
    if (scores) {
        GameState.scores = GameState.scores || {};
        Object.assign(GameState.scores, scores);
    }
    try { afficherScoreboard(); } catch {}

    // Afficher le vrai prix sur la carte produit (porteur de texte)
    const prixEl = $('jp-produit-prix');
    if (prixEl) {
        prixEl.textContent  = produit?.prix || '';
        prixEl._revealed    = true;
        prixEl.style.display = 'block';
    }

    // Bouton "Produit suivant" actif (déjà présent dans le DOM existant)
    // Repointer btn-next-jp / jp-btn-next vers next_produit serveur
    ['btn-next-jp', 'jp-btn-next'].forEach(id => {
        const el = $(id);
        if (el) {
            el.onclick = () => {
                try { socket.send('HOST_ACTION', { action: 'justeprix:next_produit', data: {} }); }
                catch (err) { console.error('[JP] send next_produit:', err.message); }
            };
        }
    });
}

function _onTimerExpired() {
    if (!_estimationEnvoyee) {
        const inp = $('jp-input-hote');
        const val = inp ? inp.value.trim() : '';
        if (val) _soumettreEstimation(val);
    }
}

// ── Affichage produit ─────────────────────────────────────────

function _afficherProduit(p) {
    if (!p) return;

    const nomEl = $('jp-produit-nom');
    if (nomEl) nomEl.textContent = p.nom || '';

    const descEl = $('jp-produit-description');
    if (descEl) descEl.textContent = p.description || '';

    const catEl = $('jp-categorie');
    if (catEl) {
        catEl.textContent = p.categorie || '';
        catEl.style.animation = 'none';
        void catEl.offsetWidth;
        catEl.style.animation = 'bounceIn 0.8s ease-out';
    }

    const imgEl = $('jp-produit-image');
    if (imgEl) {
        const src = (p.imageSrc && p.imageSrc.trim() !== '') ? p.imageSrc : `images/produit_${p.id}.jpg`;
        imgEl.src   = src;
        imgEl.alt   = p.nom || 'Produit';
        imgEl.style.display = 'block';
    }

    const lienEl = $('jp-produit-lien');
    if (lienEl) {
        const q = encodeURIComponent(`${p.marque || ''} ${p.nom || ''} ${p.description || ''}`.trim());
        lienEl.href = `https://www.google.com/search?tbm=shop&q=${q}`;
    }

    // #jp-produit-prix : simple porteur de texte, caché tant que pas révélé.
    // La révélation est déclenchée uniquement par #jp-btn-afficher-prix.
    const prixEl = $('jp-produit-prix');
    if (prixEl) {
        prixEl.textContent   = '';
        prixEl._revealed     = false;
        prixEl.onclick       = null;
        prixEl.style.display = 'none';
    }
}

function _resetBoutonsHote() {
    const btnEnv = $('jp-btn-envoyer-hote');
    if (btnEnv) {
        btnEnv.disabled      = false;
        btnEnv._sent         = false;
        btnEnv.style.opacity = '';
        btnEnv.textContent   = '✅ Envoyer mon estimation';
    }
    const input = $('jp-input-hote');
    if (input) { input.value = ''; input.disabled = false; }
}

// ── Timer ─────────────────────────────────────────────────────

function _demarrerTimer() {
    _arreterTimer();
    const t = $('jp-timer');
    const compute = () => Math.max(0, Math.ceil((_tsDebut + _dureeMs - Date.now()) / 1000));
    const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    let last = compute();
    if (t) { t.textContent = fmt(last); t.classList.remove('clignote'); }
    _timerLocal = setInterval(() => {
        const r = compute();
        if (r !== last) {
            last = r;
            if (t) {
                t.textContent = fmt(r);
                if (r <= 5 && r > 0) t.classList.add('clignote');
            }
        }
        if (r <= 0) {
            _arreterTimer();
            if (t) t.classList.remove('clignote');
        }
    }, 250);
}

function _arreterTimer() {
    if (_timerLocal) { clearInterval(_timerLocal); _timerLocal = null; }
}

// ── Soumission estimation ─────────────────────────────────────

function _soumettreEstimation(valeur) {
    if (_estimationEnvoyee || !valeur) return;
    _estimationEnvoyee = true;
    const pseudoHote = (GameState?.joueurs?.[0]) || null;
    try {
        socket.send('HOST_ACTION', {
            action: 'justeprix:host_answer',
            data: { pseudo: pseudoHote, estimation: valeur },
        });
        console.log(`[JP] 📨 Estimation hôte envoyée: ${valeur}`);
    } catch (err) {
        console.error('[JP] send host_answer:', err.message);
    }
    const btn = $('jp-btn-envoyer-hote');
    if (btn) {
        btn.disabled = true;
        btn._sent    = true;
        btn.style.opacity = '0.45';
        btn.textContent = '⏳ Envoyé';
    }
    const inp = $('jp-input-hote');
    if (inp) inp.disabled = true;
}

// ── Listeners ─────────────────────────────────────────────────

function _attacherListeners() {
    const btnEnv = $('jp-btn-envoyer-hote');
    if (btnEnv) {
        btnEnv.onclick = () => {
            if (btnEnv._sent) return;
            const inp = $('jp-input-hote');
            const val = inp ? inp.value.trim() : '';
            if (!val) return;
            _soumettreEstimation(val);
        };
    }

    // btn-prev local : avant de migrer "produit précédent" en WS, on l'inhibe
    // (puisque le serveur fait le tirage avec mémoire séquentielle).
    const prev = $('jp-btn-prev');
    if (prev) { prev.disabled = true; prev.style.opacity = '0.3'; prev.title = 'Désactivé en mode WS'; }
}

// ── Abonnements WS ────────────────────────────────────────────

function _abonnerEvenements() {
    socket.on('JUSTEPRIX_PRODUIT_START', payload => { try { _onProduitStart(payload); } catch (e) { console.warn('[JP] PRODUIT_START', e.message); } });
    socket.on('JUSTEPRIX_REVELATION',    payload => { try { _onRevelation(payload); }   catch (e) { console.warn('[JP] REVELATION', e.message); } });
    socket.on('JUSTEPRIX_TIMER_EXPIRED', ()      => { try { _onTimerExpired(); }        catch (e) { console.warn('[JP] TIMER_EXPIRED', e.message); } });
    socket.on('SCORES_UPDATE', ({ scores }) => {
        if (scores) {
            GameState.scores = GameState.scores || {};
            Object.assign(GameState.scores, scores);
        }
        try { afficherScoreboard(); } catch {}
    });
}

// ── Init ──────────────────────────────────────────────────────

export async function initialiserJustePrix() {
    console.log('[JP] Initialisation WS');
    _abonnerEvenements();
    const hoteActif = await chargerModuleHote();
    if (hoteActif) _injecterPanneauHote();
    _attacherListeners();

    try {
        socket.send('HOST_ACTION', { action: 'justeprix:load', data: {} });
        console.log('[JP] 📡 justeprix:load envoyé');
    } catch (err) {
        console.error('[JP] send load:', err.message);
        alert('Impossible de démarrer Juste Prix. Vérifie la connexion.');
    }
}

window.initialiserJustePrix = initialiserJustePrix;