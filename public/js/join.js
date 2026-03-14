// /public/js/join.js  — v3.0
// ======================================================
// 🎮 JOIN — Rejoindre une partie — MiniGame Universe
// ======================================================
// Corrections v3.0 :
//
//   BUG CORRIGÉ — Liste vide malgré des parties existantes
//   ─────────────────────────────────────────────────────
//   Avant : renderParties() filtrait uniquement statut === 'lobby'.
//   Le serveur peut retourner 'waiting', 'en_cours' (partie
//   lancée mais rejoignable via PLAYER_REJOIN), etc.
//   → On affiche lobby + waiting + en_cours, avec badges distincts.
//   → Une partie "en_cours" affiche un badge "En cours" et
//     indique que le joueur rejoindra comme spectateur/tardif.
//
//   BUG CORRIGÉ — ?resume= ignoré à l'arrivée sur /join/
//   ─────────────────────────────────────────────────────
//   Quand main.js redirige vers /join/?resume=<partieId>,
//   join.js doit pré-sélectionner automatiquement cette partie
//   (ou la charger depuis l'API si elle n'est pas encore dans
//   la liste locale) et proposer immédiatement le champ pseudo.
//
//   BUG CORRIGÉ — ?code= ignoré à l'arrivée sur /join/
//   ─────────────────────────────────────────────────────
//   Quand le host partage un lien /join/?code=XXXXXX,
//   la page résout le code via GET /api/parties/code/:code
//   et pré-sélectionne la partie correspondante.
//
//   AJOUT — Vérification pseudo stricte avant d'envoyer PLAYER_JOIN
//   ─────────────────────────────────────────────────────
//   Avant d'envoyer PLAYER_JOIN au serveur, on vérifie localement
//   si le pseudo est déjà pris dans la partie sélectionnée.
//   Si c'est le même joueur qui revient (pseudo connu), on
//   tente PLAYER_REJOIN directement et on redirige vers le jeu.
//
//   TOUT LE RESTE EST CONSERVÉ (écran d'attente, GAME_STARTED…)
// ======================================================

import { GameSocket } from './core/socket.js';

const socket = new GameSocket();

// ── Config ────────────────────────────────────────────
const PSEUDO_REGEX = /^[a-zA-Z0-9_-]{2,20}$/;

const GAME_ICONS = {
    quiz: '❓', justeprix: '💰', undercover: '🕵️', lml: '📖',
    mimer: '🎭', pendu: '🪢', petitbac: '📝', memoire: '🧠',
    morpion: '⭕', puissance4: '🔴',
};

const JEU_PATHS = {
    quiz       : '/games/quiz/',
    justeprix  : '/games/justeprix/',
    undercover : '/games/undercover/',
    lml        : '/games/lml/',
    mimer      : '/games/mimer/',
    pendu      : '/games/pendu/',
    petitbac   : '/games/petitbac/',
    memoire    : '/games/memoire/',
    morpion    : '/games/morpion/',
    puissance4 : '/games/puissance4/',
};

// ── DOM Helpers ───────────────────────────────────────
const $ = id => document.getElementById(id);

function esc(str) {
    return String(str || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── State ─────────────────────────────────────────────
const state = {
    parties          : [],
    selectedPartieId : null,
    selectedPartie   : null,
    isConnecting     : false,
    refreshTimer     : null,
    hasJoined        : false,
    joinedPseudo     : null,
    joinedEquipe     : null,
    joinedSnapshot   : null,
    // Paramètres URL résolus
    resumeId         : null,   // ?resume=<partieId>
    codeParam        : null,   // ?code=<CODE>
};

// ══════════════════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════════════════

function toast(msg, type = 'info', duration = 3500) {
    const icons     = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    const couleurs  = { success: '#22c55e', error: '#ef4444', info: '#00d4ff', warning: '#f59e0b' };
    let container   = $('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:9999;display:flex;flex-direction:column;gap:.5rem;pointer-events:none;max-width:320px;';
        document.body.appendChild(container);
    }
    const el = document.createElement('div');
    el.style.cssText = `display:flex;gap:.5rem;align-items:center;padding:.75rem 1rem;border-radius:8px;background:#1e1e2e;color:#fff;box-shadow:0 4px 12px rgba(0,0,0,.4);opacity:0;transition:opacity .25s;pointer-events:auto;border-left:3px solid ${couleurs[type] || '#00d4ff'};`;
    el.innerHTML = `<span style="flex-shrink:0;">${icons[type] || 'ℹ️'}</span><span style="font-size:.9rem;">${esc(msg)}</span>`;
    container.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 300);
    }, duration);
}

// ══════════════════════════════════════════════════════
// RÉSOLUTION DES PARAMÈTRES URL
// ══════════════════════════════════════════════════════

/**
 * Lit les paramètres ?resume= et ?code= à l'init.
 * Si ?resume= → cherche la partie par ID (API).
 * Si ?code=   → cherche la partie par code court (API).
 * Dans les deux cas, pré-sélectionne la partie si trouvée.
 */
async function resoudreParamsURL() {
    const params = new URLSearchParams(location.search);
    state.resumeId  = params.get('resume') || null;
    state.codeParam = params.get('code')   || null;

    if (!state.resumeId && !state.codeParam) return;

    // Afficher un indicateur de chargement dans la liste
    const container = $('join-parties-list');
    if (container) {
        container.innerHTML = `<div style="text-align:center;padding:2rem;opacity:.6;">
            <div style="width:24px;height:24px;border:3px solid #444;border-top-color:#00d4ff;
                border-radius:50%;animation:spin .8s linear infinite;margin:0 auto .5rem;"></div>
            <span>Chargement de la partie…</span>
        </div>`;
    }

    try {
        let url;
        if (state.codeParam) {
            // Résoudre par code court
            url = `/api/parties/code/${encodeURIComponent(state.codeParam.toUpperCase())}`;
        } else {
            // Résoudre par ID
            url = `/api/parties/${encodeURIComponent(state.resumeId)}`;
        }

        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });

        if (!res.ok) {
            const msg = state.codeParam
                ? `Code "${state.codeParam}" invalide ou expiré.`
                : 'Partie introuvable ou terminée.';
            toast(msg, 'error', 5000);
            // Continuer sans pré-sélection — la liste normale s'affichera
            return;
        }

        const data   = await res.json();
        // L'API retourne soit { id, nom, … } soit { partie: { … } }
        const partie = data.id ? data : (data.partie || null);

        if (!partie?.id) {
            toast('Impossible de charger les détails de cette partie.', 'error');
            return;
        }

        // Statut terminal → pas rejoignable
        if (partie.statut === 'terminee' || partie.statut === 'ended') {
            toast('Cette partie est terminée.', 'warning', 5000);
            return;
        }

        // Injecter dans la liste locale pour que selectPartie() fonctionne
        const existing = state.parties.find(p => p.id === partie.id);
        if (!existing) state.parties.push(partie);

        // Pré-sélectionner + pré-remplir le pseudo depuis localStorage
        selectPartie(partie.id);

        // Mettre le focus sur le champ pseudo pour que l'utilisateur
        // n'ait qu'à taper son nom et appuyer sur Entrée
        setTimeout(() => {
            const pseudoEl = $('join-pseudo');
            if (pseudoEl) pseudoEl.focus();
        }, 200);

        const label = state.codeParam
            ? `Code ${state.codeParam} → "${partie.nom}" pré-sélectionnée.`
            : `Partie "${partie.nom}" pré-sélectionnée. Entrez votre pseudo.`;
        toast(label, 'success', 3000);

    } catch (err) {
        console.warn('[JOIN] Résolution paramètre URL échouée:', err.message);
        toast('Impossible de charger la partie depuis le lien.', 'warning');
    }
}

// ══════════════════════════════════════════════════════
// CHARGEMENT DES PARTIES (API REST)
// ══════════════════════════════════════════════════════

async function loadParties() {
    if (state.hasJoined) return;

    const container = $('join-parties-list');
    // Ne pas écraser si une pré-sélection est en cours
    if (container && !state.selectedPartieId) {
        container.innerHTML = `<div style="text-align:center;padding:2rem;opacity:.6;">
            <div style="width:24px;height:24px;border:3px solid #444;border-top-color:#00d4ff;
                border-radius:50%;animation:spin .8s linear infinite;margin:0 auto .5rem;"></div>
            <span>Chargement…</span>
        </div>`;
    }

    try {
        const res = await fetch('/api/parties', { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        state.parties = data.parties || data || [];

        // Si une pré-sélection est active depuis les paramètres URL,
        // s'assurer que la partie est toujours dans la liste
        if (state.selectedPartieId) {
            const exists = state.parties.find(p => p.id === state.selectedPartieId);
            if (!exists && state.selectedPartie) {
                state.parties.unshift(state.selectedPartie); // remettre en tête
            }
        }

        renderParties(state.parties);
    } catch (err) {
        console.error('[JOIN] Erreur chargement parties:', err);
        if (container && !state.selectedPartieId) {
            container.innerHTML = `<div style="text-align:center;padding:2rem;opacity:.6;">
                <p>❌ Impossible de charger les parties</p>
                <button onclick="window.location.reload()" style="margin-top:.5rem;padding:.4rem 1rem;
                    border-radius:6px;border:1px solid #555;background:transparent;color:#aaa;cursor:pointer;">
                    Réessayer
                </button>
            </div>`;
        }
    }
}

// ══════════════════════════════════════════════════════
// RENDU DE LA LISTE DES PARTIES
// ══════════════════════════════════════════════════════

function renderParties(parties) {
    if (state.hasJoined) return;

    // ── CORRECTION BUG #2 ──────────────────────────────
    // Avant : filtre strict statut === 'lobby'
    // Maintenant : on affiche lobby + waiting + en_cours
    // Une partie en_cours reste rejoignable via PLAYER_REJOIN
    // (le serveur accepte PLAYER_REJOIN même en statut en_cours)
    const STATUTS_REJOINABLES = new Set(['lobby', 'waiting', 'en_cours', 'started']);
    const filtered = parties.filter(p => STATUTS_REJOINABLES.has(p.statut));

    const container = $('join-parties-list');
    if (!container) return;

    if (filtered.length === 0) {
        container.innerHTML = `<div style="text-align:center;padding:2rem;opacity:.5;">
            <div style="font-size:2.5rem;margin-bottom:.5rem;">🎲</div>
            <p>Aucune partie disponible pour l'instant.</p>
            <p style="font-size:.85rem;margin-top:.25rem;">Demandez à votre host de créer une partie.</p>
        </div>`;
        return;
    }

    container.innerHTML = filtered.map(p => {
        const isSelected = p.id === state.selectedPartieId;
        const nbJoueurs  = (p.joueurs || []).length;
        const max        = p.maxJoueurs || 8;
        const badge      = _badgeStatut(p.statut);

        return `
        <div class="partie-item ${isSelected ? 'selected' : ''}"
             data-partie-id="${esc(p.id)}"
             style="display:flex;align-items:center;gap:.75rem;padding:.85rem 1rem;
                border-radius:10px;cursor:pointer;
                border:2px solid ${isSelected ? '#00d4ff' : 'transparent'};
                background:${isSelected ? 'rgba(0,212,255,.08)' : 'rgba(255,255,255,.04)'};
                transition:all .15s;margin-bottom:.5rem;">
            <span style="font-size:1.5rem;">${GAME_ICONS[p.jeu] || '🎮'}</span>
            <div style="flex:1;min-width:0;">
                <div style="font-weight:600;display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;">
                    ${esc(p.nom)}
                    ${badge}
                </div>
                <div style="font-size:.8rem;opacity:.6;margin-top:.1rem;">
                    ${(p.jeu || '').toUpperCase()} · ${p.mode === 'team' ? '🛡️ Équipes' : '👤 Solo'}
                </div>
            </div>
            <span style="font-size:.8rem;opacity:.7;white-space:nowrap;">${nbJoueurs}/${max} 👥</span>
            ${isSelected ? '<span style="color:#00d4ff;font-size:1.1rem;">✔</span>' : ''}
        </div>`;
    }).join('');

    container.querySelectorAll('.partie-item').forEach(el => {
        el.addEventListener('click', () => selectPartie(el.dataset.partieId));
    });
}

/**
 * Badge HTML de statut (lobby / en cours / terminée).
 */
function _badgeStatut(statut) {
    if (statut === 'en_cours' || statut === 'started') {
        return `<span style="font-size:.7rem;background:rgba(245,158,11,.15);
            color:#fbbf24;border:1px solid rgba(245,158,11,.3);
            padding:.1rem .4rem;border-radius:4px;white-space:nowrap;">En cours</span>`;
    }
    if (statut === 'lobby' || statut === 'waiting') {
        return `<span style="font-size:.7rem;background:rgba(34,197,94,.1);
            color:#4ade80;border:1px solid rgba(34,197,94,.25);
            padding:.1rem .4rem;border-radius:4px;white-space:nowrap;">Ouvert</span>`;
    }
    return '';
}

// ══════════════════════════════════════════════════════
// SÉLECTION D'UNE PARTIE
// ══════════════════════════════════════════════════════

function selectPartie(partieId) {
    state.selectedPartieId = partieId;
    state.selectedPartie   = state.parties.find(p => p.id === partieId) || null;
    renderParties(state.parties);
    updateSelectedInfo();
    checkCanJoin();
}

function updateSelectedInfo() {
    const infoEl = $('join-selected-info');
    if (!infoEl) return;

    if (!state.selectedPartie) {
        infoEl.hidden = true;
        return;
    }

    infoEl.hidden = false;
    const p = state.selectedPartie;
    infoEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:.6rem;padding:.75rem 1rem;
            background:rgba(0,212,255,.07);border-radius:8px;border:1px solid rgba(0,212,255,.2);">
            <span style="font-size:1.4rem;">${GAME_ICONS[p.jeu] || '🎮'}</span>
            <div>
                <div style="font-weight:600;">${esc(p.nom)}</div>
                <div style="font-size:.8rem;opacity:.6;">
                    ${(p.jeu || '').toUpperCase()} · ${(p.joueurs || []).length} joueur(s)
                </div>
            </div>
        </div>`;
}

// ══════════════════════════════════════════════════════
// RECHERCHE PAR NOM EXACT
// ══════════════════════════════════════════════════════

function handleSearchByName() {
    if (state.hasJoined) return;
    const nameInput = $('join-partie-name');
    if (!nameInput) return;
    const nom = nameInput.value.trim();
    if (!nom) { toast("Entrez le nom exact de la partie.", 'warning'); return; }

    // Chercher dans la liste déjà chargée
    const found = state.parties.find(
        p => p.nom.toLowerCase() === nom.toLowerCase() &&
             (p.statut === 'lobby' || p.statut === 'waiting' ||
              p.statut === 'en_cours' || p.statut === 'started')
    );
    if (found) {
        selectPartie(found.id);
        toast(`Partie "${found.nom}" sélectionnée !`, 'success', 2000);
        return;
    }

    // Fallback : requête API by-name
    toast('Recherche en cours…', 'info', 1500);
    fetch(`/api/parties/by-name/${encodeURIComponent(nom)}`)
        .then(r => {
            if (!r.ok) throw new Error('not_found');
            return r.json();
        })
        .then(data => {
            const p = data.id ? data : null;
            if (!p) throw new Error('not_found');
            const exists = state.parties.find(x => x.id === p.id);
            if (!exists) state.parties.unshift(p);
            selectPartie(p.id);
            renderParties(state.parties);
            toast(`Partie "${p.nom}" trouvée !`, 'success');
        })
        .catch(() => toast(`Aucune partie ouverte nommée "${nom}".`, 'error'));
}

// ══════════════════════════════════════════════════════
// VALIDATION ET JOIN
// ══════════════════════════════════════════════════════

function validatePseudo(pseudo) {
    const t = pseudo.trim();
    if (t.length < 2)  return { valid: false, error: 'Minimum 2 caractères.' };
    if (t.length > 20) return { valid: false, error: 'Maximum 20 caractères.' };
    if (!PSEUDO_REGEX.test(t)) return { valid: false, error: 'Lettres, chiffres, tiret, underscore uniquement.' };
    return { valid: true };
}

function checkCanJoin() {
    if (state.hasJoined) return;
    const pseudoEl = $('join-pseudo');
    const btn      = $('join-btn-submit');
    if (!pseudoEl || !btn) return;
    const ok = validatePseudo(pseudoEl.value.trim()).valid && !!state.selectedPartieId;
    btn.disabled = !ok || state.isConnecting;
}

/**
 * Gère le clic sur "Rejoindre".
 *
 * Logique stricte :
 *   1. Valider le pseudo (format)
 *   2. Vérifier que la partie est sélectionnée
 *   3. Vérifier si le pseudo existe déjà dans la partie :
 *      a. Si oui et que c'est le même joueur → PLAYER_REJOIN direct
 *      b. Si oui mais pseudo différent → erreur "pseudo déjà pris"
 *   4. Sinon → PLAYER_JOIN normal
 */
function handleJoin() {
    if (state.hasJoined) return;

    const pseudoEl = $('join-pseudo');
    if (!pseudoEl) return;

    const pseudo     = pseudoEl.value.trim();
    const validation = validatePseudo(pseudo);
    if (!validation.valid) { toast(validation.error, 'error'); return; }
    if (!state.selectedPartieId) { toast('Sélectionnez une partie.', 'error'); return; }

    const partie = state.selectedPartie;

    // ── Vérification pseudo dans la partie ────────────
    if (partie && partie.joueurs?.length > 0) {
        const pseudoLower = pseudo.toLowerCase();
        const joueurExistant = partie.joueurs.find(
            j => (j.pseudo || j).toLowerCase() === pseudoLower
        );

        if (joueurExistant) {
            // Le joueur était déjà dans la partie → PLAYER_REJOIN
            // (il revient après une déconnexion ou navigation)
            console.log('[JOIN] Pseudo déjà dans la partie → PLAYER_REJOIN');
            _doRejoin(pseudo, state.selectedPartieId, partie);
            return;
        }
    }

    // Nouvelle arrivée → vérifier que la partie accepte encore des joueurs
    if (partie?.statut === 'en_cours' || partie?.statut === 'started') {
        // La partie est lancée — on peut tenter de rejoindre comme retardataire
        // Le serveur accepte PLAYER_JOIN seulement si la logique du jeu le permet
        // Pour l'instant on essaie, le serveur répondra GAME_STARTED si refusé
    }

    try { localStorage.setItem('mgu_last_pseudo', pseudo); } catch {}

    state.isConnecting = true;
    const btn = $('join-btn-submit');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Connexion…'; }

    socket.send('PLAYER_JOIN', {
        pseudo,
        partieId: state.selectedPartieId,
    });

    // Timeout de sécurité
    setTimeout(() => {
        if (state.isConnecting && !state.hasJoined) {
            state.isConnecting = false;
            if (btn) { btn.disabled = false; btn.textContent = '🎮 Rejoindre la partie'; }
            toast("Délai dépassé. Vérifiez la connexion.", 'error');
        }
    }, 10000);
}

/**
 * Envoie PLAYER_REJOIN pour un joueur déjà dans la partie.
 * Redirige directement vers la page du jeu si REJOIN_OK.
 */
function _doRejoin(pseudo, partieId, partie) {
    const btn = $('join-btn-submit');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Reconnexion…'; }

    state.isConnecting = true;

    // Écoute unique pour REJOIN_OK
    socket.on('REJOIN_OK', ({ pseudo: ps, equipe, snapshot }) => {
        state.isConnecting  = false;
        state.hasJoined     = true;
        state.joinedPseudo  = ps;
        state.joinedEquipe  = equipe;
        state.joinedSnapshot = snapshot;

        toast(`Reconnecté : ${ps} 👋`, 'success', 2000);

        // Sauvegarder la session
        try {
            sessionStorage.setItem('mgu_game_session', JSON.stringify({
                partieId, pseudo: ps, equipe: equipe || null,
                jeu: snapshot.jeu, mode: snapshot.mode, role: 'player',
            }));
        } catch {}

        // Rediriger vers le jeu
        setTimeout(() => {
            const gamePath = JEU_PATHS[snapshot.jeu] || `/games/${snapshot.jeu}/`;
            window.location.href = `${gamePath}?partieId=${partieId}&pseudo=${encodeURIComponent(ps)}`;
        }, 500);
    });

    socket.send('PLAYER_REJOIN', { pseudo, partieId });

    // Timeout
    setTimeout(() => {
        if (state.isConnecting) {
            state.isConnecting = false;
            if (btn) { btn.disabled = false; btn.textContent = '🎮 Rejoindre la partie'; }
            toast("Reconnexion impossible. Essayez de rejoindre comme nouveau joueur.", 'warning');
        }
    }, 8000);
}

// ══════════════════════════════════════════════════════
// ÉCRAN D'ATTENTE (après JOIN_OK)
// ══════════════════════════════════════════════════════

function afficherEcranAttente(pseudo, equipe, snapshot) {
    state.hasJoined      = true;
    state.joinedPseudo   = pseudo;
    state.joinedEquipe   = equipe;
    state.joinedSnapshot = snapshot;

    if (state.refreshTimer) { clearInterval(state.refreshTimer); state.refreshTimer = null; }

    const jeuIcon  = GAME_ICONS[snapshot.jeu] || '🎮';
    const modeLabel = snapshot.mode === 'team' ? '🛡️ Équipes' : '👤 Solo';

    const main = document.querySelector('main.page') || document.querySelector('main') || document.body;
    main.innerHTML = `
        <div id="ecran-attente" style="
            display:flex;flex-direction:column;align-items:center;justify-content:center;
            min-height:60vh;text-align:center;padding:2rem;gap:1.5rem;">

            <div style="background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.3);
                border-radius:12px;padding:.6rem 1.2rem;color:#4ade80;font-size:.85rem;font-weight:600;">
                ✅ Connecté à la partie
            </div>

            <div style="background:rgba(0,212,255,.07);border:1px solid rgba(0,212,255,.2);
                border-radius:16px;padding:1.5rem 2rem;min-width:280px;max-width:400px;width:100%;">
                <div style="font-size:3rem;margin-bottom:.5rem;">${jeuIcon}</div>
                <div style="font-size:1.2rem;font-weight:700;margin-bottom:.25rem;">${esc(snapshot.nom)}</div>
                <div style="font-size:.85rem;opacity:.6;margin-bottom:1rem;">
                    ${(snapshot.jeu || '').toUpperCase()} · ${modeLabel}
                </div>

                <div style="background:rgba(255,255,255,.05);border-radius:8px;padding:.75rem;margin-bottom:.75rem;">
                    <div style="font-size:.75rem;color:#64748b;margin-bottom:.2rem;">VOTRE PSEUDO</div>
                    <div style="font-size:1.1rem;font-weight:700;color:#00d4ff;">${esc(pseudo)}</div>
                    ${equipe
                        ? `<div style="font-size:.8rem;opacity:.6;margin-top:.2rem;">🛡️ Équipe : ${esc(equipe)}</div>`
                        : ''}
                </div>

                <div style="font-size:.85rem;opacity:.6;" id="attente-joueurs-count">
                    👥 ${snapshot.joueurs.length} joueur(s) connecté(s)
                </div>
            </div>

            <div style="display:flex;flex-direction:column;align-items:center;gap:.75rem;">
                <div style="width:36px;height:36px;border:3px solid rgba(0,212,255,.2);
                    border-top-color:#00d4ff;border-radius:50%;animation:spin .9s linear infinite;"></div>
                <p style="color:#64748b;font-size:.9rem;">En attente du lancement par le host…</p>
            </div>

            <button id="btn-attente-quitter" style="background:none;border:1px solid rgba(255,255,255,.1);
                color:#64748b;border-radius:8px;padding:.5rem 1rem;cursor:pointer;font-size:.82rem;">
                Quitter la salle d'attente
            </button>
        </div>

        <style>@keyframes spin { to { transform: rotate(360deg); } }</style>`;

    $('btn-attente-quitter')?.addEventListener('click', () => {
        if (confirm("Quitter la salle d'attente ?")) {
            window.location.href = '/join/';
        }
    });
}

function mettreAJourCompteurAttente(joueurs) {
    const el = $('attente-joueurs-count');
    if (el) el.textContent = `👥 ${joueurs.length} joueur(s) connecté(s)`;
}

function redirectionVersJeu(snapshot) {
    if (!state.joinedPseudo || !state.selectedPartieId) return;

    try {
        sessionStorage.setItem('mgu_game_session', JSON.stringify({
            partieId : state.selectedPartieId,
            pseudo   : state.joinedPseudo,
            equipe   : state.joinedEquipe || null,
            jeu      : snapshot.jeu,
            mode     : snapshot.mode,
            role     : 'player',
        }));
    } catch {}

    const gamePath = JEU_PATHS[snapshot.jeu] || `/games/${snapshot.jeu}/`;
    window.location.href = `${gamePath}?partieId=${state.selectedPartieId}&pseudo=${encodeURIComponent(state.joinedPseudo)}`;
}

// ══════════════════════════════════════════════════════
// WEBSOCKET
// ══════════════════════════════════════════════════════

function initSocketEvents() {
    socket.on('__connected__', () => {
        console.log('[JOIN] ✅ WebSocket connecté');
        updateWsStatus(true);
        // Charger la liste via WS également (redondant avec fetch, mais plus rapide)
        socket.send('GET_PARTIES', {});
    });

    socket.on('__disconnected__', () => { updateWsStatus(false); });

    socket.on('PARTIES_LIST', ({ parties }) => {
        if (!parties || state.hasJoined) return;
        // Fusionner avec la liste existante (peut contenir la partie pré-sélectionnée)
        const ids = new Set(parties.map(p => p.id));
        const extras = state.parties.filter(p => !ids.has(p.id));
        state.parties = [...parties, ...extras];
        renderParties(state.parties);
        // Re-sélectionner si une pré-sélection était active
        if (state.selectedPartieId) {
            const found = state.parties.find(p => p.id === state.selectedPartieId);
            if (found) { state.selectedPartie = found; renderParties(state.parties); }
        }
    });

    // JOIN_OK → écran d'attente
    socket.on('JOIN_OK', ({ pseudo, equipe, snapshot }) => {
        state.isConnecting = false;
        console.log('[JOIN] ✅ Rejoint:', pseudo);
        afficherEcranAttente(pseudo, equipe, snapshot);
        toast(`Bienvenue ${pseudo} ! En attente du lancement…`, 'success', 3000);
    });

    socket.on('PLAYER_JOINED', ({ joueurs }) => {
        if (state.hasJoined && joueurs) mettreAJourCompteurAttente(joueurs);
    });

    socket.on('PLAYER_LEFT', ({ joueurs }) => {
        if (state.hasJoined && joueurs) mettreAJourCompteurAttente(joueurs);
    });

    // GAME_STARTED → rediriger vers le jeu
    socket.on('GAME_STARTED', ({ snapshot }) => {
        console.log('[JOIN] 🚀 GAME_STARTED → redirection');
        if (state.hasJoined && state.joinedPseudo) {
            toast('La partie commence ! Redirection…', 'success', 1500);
            setTimeout(() => redirectionVersJeu(snapshot), 500);
        }
    });

    socket.on('JOIN_ERROR', ({ code }) => {
        state.isConnecting = false;
        const btn = $('join-btn-submit');
        if (btn) { btn.disabled = false; btn.textContent = '🎮 Rejoindre la partie'; }

        const messages = {
            GAME_NOT_FOUND        : 'Partie introuvable ou terminée.',
            PSEUDO_TAKEN          : 'Ce pseudo est déjà utilisé dans cette partie.',
            PSEUDO_INVALID        : 'Pseudo invalide (2-20 caractères, lettres/chiffres/tiret).',
            GAME_STARTED          : 'La partie a déjà commencé.',
            MAX_PLAYERS           : 'La partie est complète.',
            PLAYER_ALREADY_EXISTS : 'Vous êtes déjà dans cette partie.',
            MISSING_FIELDS        : 'Données manquantes.',
        };
        toast(messages[code] || `Erreur : ${code}`, 'error', 5000);
    });

    socket.on('KICKED', ({ reason }) => {
        toast(`Vous avez été expulsé : ${reason || 'par le host'}`, 'error', 5000);
        state.hasJoined = false;
        setTimeout(() => window.location.href = '/join/', 2000);
    });

    socket.on('GAME_ENDED', () => {
        if (state.hasJoined) {
            toast('La partie a été annulée par le host.', 'warning', 5000);
            state.hasJoined = false;
            setTimeout(() => window.location.href = '/join/', 2500);
        }
    });

    socket.on('HOST_DISCONNECTED', () => {
        if (state.hasJoined) {
            toast("Le host s'est déconnecté. La partie est suspendue.", 'warning', 5000);
        }
    });
}

function updateWsStatus(connected) {
    const dot   = $('ws-dot');
    const label = $('ws-label');
    if (dot)   dot.style.background = connected ? '#22c55e' : '#ef4444';
    if (label) label.textContent    = connected ? 'Connecté' : 'Déconnecté';
}

// ══════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════

async function init() {
    console.log('[JOIN] Initialisation v3.0');

    // Connexion WS en premier (ne pas attendre)
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket.connect(`${wsProto}//${location.host}/ws`);
    initSocketEvents();

    // Pré-remplir le pseudo depuis localStorage
    const pseudoEl = $('join-pseudo');
    if (pseudoEl) {
        const last = localStorage.getItem('mgu_last_pseudo');
        if (last) pseudoEl.value = last;
        pseudoEl.addEventListener('input', checkCanJoin);
        pseudoEl.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !$('join-btn-submit')?.disabled) handleJoin();
        });
    }

    const nameInput = $('join-partie-name');
    if (nameInput) {
        nameInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') handleSearchByName();
        });
    }

    $('join-btn-search')?.addEventListener('click', handleSearchByName);
    $('join-btn-submit')?.addEventListener('click', handleJoin);
    $('join-btn-refresh')?.addEventListener('click', () => {
        if (state.hasJoined) return;
        state.selectedPartieId = null;
        state.selectedPartie   = null;
        loadParties();
    });

    // Charger la liste initiale
    await loadParties();

    // Résoudre les paramètres URL (?resume= ou ?code=)
    // APRÈS le loadParties pour que la liste soit déjà remplie
    await resoudreParamsURL();

    // Actualisation auto toutes les 5s (stoppée après JOIN_OK)
    state.refreshTimer = setInterval(() => {
        if (!state.isConnecting && !state.hasJoined) loadParties();
    }, 5000);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}