// /js/modules/invite.js — v2.0 (ID serveur uniquement)
// ============================================================
// 🔗 INVITE.JS — Système d'invitation de joueurs
// ============================================================
//
// RÈGLE ABSOLUE : aucun ID n'est jamais généré localement.
// Le seul partieId valide est celui reçu de GAME_CREATED
// via HostSession dans main.js, qui appelle setPartieSessionId().
//
// Flux correct :
//   1. Hôte crée la partie → HOST_CREATE_GAME → serveur
//   2. Serveur répond GAME_CREATED { partieId: UUID }
//   3. main.js → HostSession.on(GAME_CREATED) → setPartieSessionId(UUID)
//   4. invite.js → afficherBlocInvitation() → construireLienInvitation()
//      → utilise UUID serveur → lien correct
//   5. Invité ouvre le lien avec le bon partieId → PLAYER_JOIN → JOIN_OK
// ============================================================

import { GameState } from '../core/state.js';
import { ouvrirModaleQR, _injecterModaleQR } from './parties.js';

const INVITE_KEY_PREFIX = 'invite_rejoint_';
const PARTIE_ID_KEY     = 'minigame_partie_session_id';

let partieSessionId = null;
let pollingInterval = null;

// ── Getters / setters ─────────────────────────────────────
// JAMAIS de génération locale. Retourne null si pas d'ID serveur.
export function getPartieSessionId() {
    if (partieSessionId) return partieSessionId;
    const stored = localStorage.getItem(PARTIE_ID_KEY);
    if (stored) { partieSessionId = stored; return stored; }
    return null;  // ← pas de génération ici
}

export function setPartieSessionId(id) {
    if (!id) return;
    partieSessionId = id;
    localStorage.setItem(PARTIE_ID_KEY, id);
    console.log('[INVITE] ✅ partieId serveur enregistré :', id);
}

export function resetPartieSessionId() {
    partieSessionId = null;
    localStorage.removeItem(PARTIE_ID_KEY);
    // Masquer et réinitialiser le bloc statique
    const bloc = document.getElementById('bloc-invitation');
    if (bloc) {
        bloc.hidden = true;
        const input = document.getElementById('invite-link-input');
        if (input) input.value = '';
        ['invite-meta-hote','invite-meta-nom','invite-meta-jeu',
         'invite-meta-date','invite-meta-id'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '—';
        });
        const btnCopy = document.getElementById('invite-copy-btn');
        const btnQR   = document.getElementById('invite-showqr-btn');
        if (btnCopy) { btnCopy.disabled = true; btnCopy.onclick = null; }
        if (btnQR)   { btnQR.disabled   = true; btnQR.onclick   = null; }
    }
    console.log('[INVITE] 🧹 partieSessionId réinitialisé — bloc masqué');
}

// ── Construire le lien d'invitation ──────────────────────
// Retourne null si aucun ID serveur n'est disponible.
export function construireLienInvitation() {
    const id = getPartieSessionId();
    if (!id) {
        console.warn('[INVITE] ⚠️ Aucun partieId serveur disponible — lien non généré');
        return null;
    }

    const nom  = GameState.partieNom || 'Partie';
    const jeu  = GameState.jeuActuel || GameState.jeu || '';
    const hote = (GameState.joueurs || [])[0] || '';
    const base = window.location.origin;

    const params = new URLSearchParams({
        partieId  : id,
        partieNom : nom,
        jeu       : jeu,
        hote      : hote,
        createdAt : Date.now(),
    });

    return `${base}/jeu.html?${params.toString()}`;
}

// ── Mettre à jour le lien et les métadonnées du bloc statique ──
// Appelé par main.js après GAME_CREATED.
export function mettreAJourLienInvitation() {
    const lien     = construireLienInvitation();
    const partieId = getPartieSessionId();
    if (!lien || !partieId) return;

    // Mettre à jour le champ lien
    const input = document.getElementById('invite-link-input');
    if (input) input.value = lien;

    // Mettre à jour l'ID affiché
    const idEl = document.getElementById('invite-meta-id');
    if (idEl) idEl.textContent = partieId;
    // Compat : ancien selector .invite-id (conservé si présent ailleurs)
    document.querySelectorAll('.invite-id').forEach(el => { el.textContent = partieId; });

    // Activer les boutons si le bloc est visible
    const btnCopy = document.getElementById('invite-copy-btn');
    const btnQR   = document.getElementById('invite-showqr-btn');
    if (btnCopy) { btnCopy.disabled = false; btnCopy.onclick = _onCopierLien; }
    if (btnQR)   {
        btnQR.disabled = false;
        btnQR.onclick  = () => {
            if (!document.getElementById('modale-qr')) _injecterModaleQR();
            ouvrirModaleQR(lien, GameState.partieNom || 'Partie');
        };
    }

    // QR code (si div présent — modale externe)
    const qrDiv = document.getElementById('invite-qr-div');
    if (qrDiv) {
        qrDiv.innerHTML = '';
        try {
            if (typeof window.QRCode !== 'undefined') {
                new window.QRCode(qrDiv, {
                    text: lien, width: 160, height: 160,
                    colorDark: '#ffffff', colorLight: 'transparent',
                    correctLevel: window.QRCode.CorrectLevel.M
                });
            }
        } catch {}
    }

    // Rendre le bloc visible s'il ne l'est pas déjà
    const bloc = document.getElementById('bloc-invitation');
    if (bloc) bloc.hidden = false;

    console.log('[INVITE] 🔗 Lien mis à jour :', lien);
}

// ── Afficher et remplir le bloc invitation statique ──────
// Le bloc #bloc-invitation est défini dans index.html (statique).
// Cette fonction le rend visible et met à jour ses champs.
// Elle ne crée AUCUN élément DOM.
export function afficherBlocInvitation() {
    const bloc = document.getElementById('bloc-invitation');
    if (!bloc) return; // le bloc doit être dans index.html

    const lien     = construireLienInvitation();
    const partieId = getPartieSessionId();

    if (!lien || !partieId) {
        // Pas encore d'ID serveur — masquer le bloc et attendre GAME_CREATED
        bloc.hidden = true;
        console.warn('[INVITE] ⚠️ Pas de partieId serveur — bloc masqué');
        return;
    }

    // Remplir les métadonnées statiques
    const JEUX_LABELS = {
        quiz:'❓ Quiz', justeprix:'💰 Juste Prix', undercover:'🕵️ Undercover',
        lml:'📖 Maxi Lettres', mimer:'🎭 Mimer', mimedessine:'🎭 Mimer',
        pendu:'🪢 Pendu', petitbac:'📝 Petit Bac', memoire:'🧠 Mémoire',
        morpion:'⭕ Morpion', puissance4:'🔴 Puissance 4'
    };
    const jeu      = GameState.jeuActuel || GameState.jeu || '';
    const hote     = (GameState.joueurs || [])[0] || '';
    const jeuLabel = JEUX_LABELS[jeu] || jeu.toUpperCase() || '—';
    const d        = new Date();
    const dateStr  = d.toLocaleDateString('fr-FR', {day:'2-digit',month:'2-digit',year:'numeric'})
                   + ' à ' + d.toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'});

    _setText('invite-meta-hote', hote || '—');
    _setText('invite-meta-nom',  GameState.partieNom || '—');
    _setText('invite-meta-jeu',  jeuLabel);
    _setText('invite-meta-date', dateStr);
    _setText('invite-meta-id',   partieId);

    // Masquer la ligne hôte si absent
    const ligneHote = document.getElementById('invite-meta-hote')?.closest('.invite-meta-item');
    if (ligneHote) ligneHote.style.display = hote ? '' : 'none';

    // Remplir et activer le champ lien
    const input = document.getElementById('invite-link-input');
    if (input) { input.value = lien; }

    // Activer les boutons (désactivés par défaut dans le HTML)
    const btnCopy = document.getElementById('invite-copy-btn');
    const btnQR   = document.getElementById('invite-showqr-btn');
    if (btnCopy) { btnCopy.disabled = false; btnCopy.onclick = _onCopierLien; }
    if (btnQR)   { btnQR.disabled   = false; btnQR.onclick   = () => {
        if (!document.getElementById('modale-qr')) _injecterModaleQR();
        ouvrirModaleQR(lien, GameState.partieNom || 'Partie');
    }; }

    // Rendre le bloc visible
    bloc.hidden = false;

    console.log('[INVITE] ✅ Bloc invitation affiché — partieId :', partieId);
}

// ── Gestionnaire copier (réutilisé par mettreAJourLienInvitation) ──
function _onCopierLien() {
    const lien = construireLienInvitation();
    if (!lien) return;
    navigator.clipboard.writeText(lien).then(() => {
        const msg = document.getElementById('invite-copy-confirm');
        if (msg) { msg.hidden = false; setTimeout(() => { msg.hidden = true; }, 2500); }
    }).catch(() => {
        const inp = document.getElementById('invite-link-input');
        if (inp) { inp.select(); document.execCommand('copy'); }
    });
}

function _setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text ?? '—';
}

// ── Écoute WS des joueurs qui rejoignent ──────────────────
// L'hôte reçoit PLAYER_JOINED via HostSession dans main.js.
// Cette fonction est un no-op : la logique est dans main.js.
// Conservée pour compatibilité avec les appels existants.
export function demarrerPollingInvites() {
    // Remplacé par l'écoute WS dans HostSession (main.js)
    // Aucune génération d'ID locale ici
    console.log('[INVITE] ℹ️ demarrerPollingInvites() → géré par HostSession WS');
}

export function arreterPollingInvites() {
    if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
}

function demarrerEcouteWS() {
    // HostSession dans main.js gère déjà PLAYER_JOINED.
    // Pas de double écoute ici.
    console.log('[INVITE] ✅ Écoute joueurs déléguée à HostSession');
}

// ── Notification toast joueur rejoint ────────────────────
export function afficherNotifNouveauJoueur(pseudo) {
    const notif = document.createElement('div');
    notif.className = 'invite-notif';
    notif.innerHTML = `✅ <strong>${esc(pseudo)}</strong> a rejoint la partie !`;
    document.body.appendChild(notif);
    requestAnimationFrame(() => notif.classList.add('show'));
    setTimeout(() => {
        notif.classList.remove('show');
        setTimeout(() => notif.remove(), 400);
    }, 3000);
}

function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}