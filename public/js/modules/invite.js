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
import { addPlayer } from '../core/storage.js';
import { afficherJoueursSelectionnes } from './joueurs.js';
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

// ── Mettre à jour le lien affiché ────────────────────────
export function mettreAJourLienInvitation() {
    const lien = construireLienInvitation();
    if (!lien) return; // pas d'ID serveur → ne rien afficher

    const input = document.getElementById('invite-link-input');
    if (input) input.value = lien;

    const idEl = document.querySelector('.invite-id');
    if (idEl) idEl.textContent = getPartieSessionId();

    // QR code
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

    // Bouton copier
    const copyBtn = document.getElementById('invite-copy-btn');
    if (copyBtn) {
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(lien).catch(() => {
                const inp = document.getElementById('invite-link-input');
                if (inp) { inp.select(); document.execCommand('copy'); }
            });
        };
    }

    console.log('[INVITE] 🔗 Lien mis à jour :', lien);
}

// ── Afficher le bloc invitation ───────────────────────────
export function afficherBlocInvitation() {
    document.getElementById('bloc-invitation')?.remove();

    const lien     = construireLienInvitation();
    const partieId = getPartieSessionId();
    if (!lien || !partieId) {
        console.warn('[INVITE] ⚠️ afficherBlocInvitation() ignoré — pas de partieId serveur');
        return;
    }

    const nomPartie = GameState.partieNom || 'Partie';
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

    const bloc = document.createElement('div');
    bloc.id        = 'bloc-invitation';
    bloc.className = 'bloc-invitation';
    bloc.innerHTML = `
        <div class="invite-header">
            <span class="invite-icon">📱</span>
            <div>
                <h3 class="invite-title">Inviter des joueurs</h3>
                <p class="invite-subtitle">Partage le lien ou scanne le QR</p>
            </div>
        </div>
        <div class="invite-meta">
            ${hote ? `<span class="invite-meta-item"><span class="invite-meta-label">Hôte :</span> <span class="invite-meta-val" style="color:#c4b5fd;">${esc(hote)}</span></span>` : ''}
            <span class="invite-meta-item"><span class="invite-meta-label">Partie :</span> <span class="invite-meta-val">${esc(nomPartie)}</span></span>
            <span class="invite-meta-item"><span class="invite-meta-label">Jeu :</span> <span class="invite-meta-val">${esc(jeuLabel)}</span></span>
            <span class="invite-meta-item"><span class="invite-meta-label">Créée le :</span> <span class="invite-meta-val" style="font-size:.78rem;">${dateStr}</span></span>
            <span class="invite-meta-item"><span class="invite-meta-label">ID :</span> <span class="invite-meta-val invite-id">${partieId}</span></span>
        </div>
        <div class="invite-link-row">
            <input id="invite-link-input" class="invite-link-input" type="text" readonly
                   value="${esc(lien)}" aria-label="Lien d'invitation">
            <button id="invite-copy-btn" class="invite-copy-btn" title="Copier le lien">📋</button>
            <button id="invite-showqr-btn" class="invite-copy-btn" title="Afficher le QR">📷</button>
        </div>
        <p id="invite-copy-confirm" class="invite-copy-confirm" hidden>✅ Lien copié !</p>
    `;

    const formSolo = document.getElementById('form-solo');
    const btnStart = document.getElementById('btn-start-solo');
    if (formSolo && btnStart) formSolo.insertBefore(bloc, btnStart);
    else document.body.appendChild(bloc);

    // Copier
    document.getElementById('invite-copy-btn').addEventListener('click', () => {
        navigator.clipboard.writeText(lien).then(() => {
            const msg = document.getElementById('invite-copy-confirm');
            if (msg) { msg.hidden = false; setTimeout(() => { msg.hidden = true; }, 2500); }
        }).catch(() => {
            const inp = document.getElementById('invite-link-input');
            if (inp) { inp.select(); document.execCommand('copy'); }
        });
    });

    // QR
    document.getElementById('invite-showqr-btn').addEventListener('click', () => {
        if (!document.getElementById('modale-qr')) _injecterModaleQR();
        ouvrirModaleQR(lien, nomPartie);
    });

    // Démarrer l'écoute WS des joueurs (plus de polling localStorage)
    demarrerEcouteWS();
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