// /js/modules/invite.js
// ============================================
// 🔗 INVITE.JS - Système d'invitation de joueurs
// ============================================

import { GameState } from '../core/state.js';
import { addPlayer } from '../core/storage.js';
import { afficherJoueursSelectionnes } from './joueurs.js';
import { ouvrirModaleQR, _injecterModaleQR } from './parties.js';

// ── Constante storage key ────────────────────────────
const INVITE_KEY_PREFIX = 'invite_rejoint_';

// ── ID de session unique par partie ──────────────────
let partieSessionId = null;
let pollingInterval  = null;

// ======================================================
// 🆔 Générer ou récupérer l'ID de session
// ======================================================
const PARTIE_ID_KEY = 'minigame_partie_session_id';

export function getPartieSessionId() {
    if (!partieSessionId) {
        const stored = localStorage.getItem(PARTIE_ID_KEY);
        if (stored) {
            partieSessionId = stored;
        } else {
            partieSessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
            localStorage.setItem(PARTIE_ID_KEY, partieSessionId);
        }
    }
    return partieSessionId;
}

export function resetPartieSessionId() {
    partieSessionId = null;
    localStorage.removeItem(PARTIE_ID_KEY);
}

export function setPartieSessionId(id) {
    partieSessionId = id;
    localStorage.setItem(PARTIE_ID_KEY, id);
}

// ======================================================
// 🔗 Construire le lien d'invitation
// Le lien est UNIQUE ET STABLE pour chaque partie :
//   partieId = sessionId = alphanum généré une seule fois
// Le même lien fonctionne pour rejoindre ET reprendre.
// ======================================================
export function construireLienInvitation() {
    const id        = getPartieSessionId();
    const nom       = GameState.partieNom || "Partie";
    const jeu       = GameState.jeuActuel || GameState.jeu || "—";
    const createdAt = Date.now();
    const base      = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '');

    // Hôte = premier joueur sélectionné
    const hote = GameState.joueurs?.[0] || '';

    const params = new URLSearchParams({
        partieId:  id,
        // sessionId absent : partieId = sessionId pour les nouvelles parties.
        // Pour la reprise, parties.js l'ajoute. jeu.html le retrouve via fallback.
        partieNom: nom,
        jeu:       jeu,
        hote:      hote,
        createdAt: createdAt
    });

    return `${base}/jeu.html?${params.toString()}`;
}

// ======================================================
// 🔄 METTRE À JOUR LE LIEN AFFICHÉ
// ======================================================
export function mettreAJourLienInvitation() {
    const lien  = construireLienInvitation();
    const input = document.getElementById('invite-link-input');
    if (input) input.value = lien;
    const idEl = document.querySelector('.invite-id');
    if (idEl) idEl.textContent = getPartieSessionId();

    // Régénérer le QR si la modale est déjà injectée
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

    const copyBtn = document.getElementById('invite-copy-btn');
    if (copyBtn) {
        copyBtn.onclick = null;
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(lien).catch(() => {
                const inp = document.getElementById('invite-link-input');
                if (inp) { inp.select(); document.execCommand('copy'); }
            });
        });
    }
    console.log('[INVITE] 🔄 Lien mis à jour avec sessionId =', getPartieSessionId());
}

// ======================================================
// 📦 Clé localStorage pour les joueurs qui ont rejoint
// ======================================================
function cleStorage(sid) {
    return `${INVITE_KEY_PREFIX}${sid}`;
}

// ======================================================
// 🔄 Polling des nouveaux joueurs (côté hôte)
// ======================================================
export function demarrerPollingInvites() {
    if (pollingInterval) clearInterval(pollingInterval);

    const partieId = getPartieSessionId();

    // Snapshot initial (normalement vide grâce à nettoyerSession())
    let snapshotInitial;
    try {
        const rawInit = localStorage.getItem(cleStorage(partieId));
        snapshotInitial = new Set(rawInit ? JSON.parse(rawInit) : []);
    } catch {
        snapshotInitial = new Set();
    }

    const verifierNouveauxJoueurs = () => {
        const raw = localStorage.getItem(cleStorage(partieId));
        if (!raw) return;
        let joueurs;
        try { joueurs = JSON.parse(raw); } catch { return; }
        if (!Array.isArray(joueurs)) return;

        let nouveaux = false;
        joueurs.forEach(pseudo => {
            if (snapshotInitial.has(pseudo)) return;
            if (!GameState.joueurs.includes(pseudo)) {
                GameState.joueurs.push(pseudo);
                GameState.scores[pseudo] = GameState.scores[pseudo] ?? 0;
                addPlayer(pseudo);
                nouveaux = true;
                afficherNotifNouveauJoueur(pseudo);
            }
        });
        if (nouveaux) afficherJoueursSelectionnes("joueurs-selectionnes-container");
    };

    // Polling 1s + StorageEvent pour réaction instantanée
    pollingInterval = setInterval(verifierNouveauxJoueurs, 1000);
    window.addEventListener('storage', (e) => {
        if (e.key === cleStorage(partieId)) verifierNouveauxJoueurs();
    });
}

export function arreterPollingInvites() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
}

// ======================================================
// 🔔 Notification visuelle joueur rejoint
// ======================================================
function afficherNotifNouveauJoueur(pseudo) {
    const notif = document.createElement('div');
    notif.className = 'invite-notif';
    notif.innerHTML = `✅ <strong>${pseudo}</strong> a rejoint la partie !`;
    document.body.appendChild(notif);
    requestAnimationFrame(() => notif.classList.add('show'));
    setTimeout(() => {
        notif.classList.remove('show');
        setTimeout(() => notif.remove(), 400);
    }, 3000);
}

// ======================================================
// 🖼️ INJECTER LE BLOC INVITATION (lien + QR)
// ======================================================
export function afficherBlocInvitation() {
    document.getElementById('bloc-invitation')?.remove();

    const lien      = construireLienInvitation();
    const partieId  = getPartieSessionId();
    const nomPartie = GameState.partieNom || "Partie";

    const bloc = document.createElement('div');
    bloc.id = 'bloc-invitation';
    bloc.className = 'bloc-invitation';

    // ── Données enrichies ──────────────────────────────────
    const JEUX_LABELS = {
        quiz:'❓ Quiz', justeprix:'💰 Juste Prix', undercover:'🕵️ Undercover',
        lml:'📖 Maxi Lettres', mimer:'🎭 Mimer', pendu:'🪢 Pendu',
        petitbac:'📝 Petit Bac', memoire:'🧠 Mémoire', morpion:'⭕ Morpion', puissance4:'🔴 Puissance 4'
    };
    const jeu       = GameState.jeuActuel || GameState.jeu || '';
    const hote      = GameState.joueurs?.[0] || '';
    const createdAt = Date.now(); // moment de génération du lien

    // Hôte
    const hoteLabel = hote
        ? `<span class="invite-meta-item">
                <span class="invite-meta-label">Hôte :</span>
                <span class="invite-meta-val" style="color:#c4b5fd;">${escHtml(hote)}</span>
            </span>`
        : '';

    // Jeu
    const jeuLabel = jeu
        ? `<span class="invite-meta-item">
                <span class="invite-meta-label">Jeu :</span>
                <span class="invite-meta-val">${escHtml(JEUX_LABELS[jeu] || jeu)}</span>
            </span>`
        : '';

    // Date de création
    const _d = new Date();
    const dateFormatee = _d.toLocaleDateString('fr-FR', {day:'2-digit',month:'2-digit',year:'numeric'})
        + ' à ' + _d.toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'});
    const dateLabel = `<span class="invite-meta-item">
            <span class="invite-meta-label">Créée le :</span>
            <span class="invite-meta-val" style="font-size:.78rem;">${dateFormatee}</span>
        </span>`;

    bloc.innerHTML = `
        <div class="invite-header">
            <span class="invite-icon">📱</span>
            <div>
                <h3 class="invite-title">Inviter des joueurs</h3>
                <p class="invite-subtitle">Partage le lien ou scanne le QR</p>
            </div>
        </div>

        <div class="invite-meta">
            ${hoteLabel}
            <span class="invite-meta-item">
                <span class="invite-meta-label">Partie :</span>
                <span class="invite-meta-val">${escHtml(nomPartie)}</span>
            </span>
            ${jeuLabel}
            ${dateLabel}
            <span class="invite-meta-item">
                <span class="invite-meta-label">ID :</span>
                <span class="invite-meta-val invite-id">${partieId}</span>
            </span>
        </div>

        <div class="invite-link-row">
            <input
                id="invite-link-input"
                class="invite-link-input"
                type="text"
                readonly
                value="${escHtml(lien)}"
                aria-label="Lien d'invitation"
            />
            <button id="invite-copy-btn" class="invite-copy-btn" aria-label="Copier le lien" title="Copier le lien">
                📋
            </button>
            <button id="invite-showqr-btn" class="invite-copy-btn" aria-label="Afficher le QR Code" title="Afficher le QR Code">
                📷
            </button>
        </div>
        <p id="invite-copy-confirm" class="invite-copy-confirm" hidden>✅ Lien copié !</p>
    `;

    const formSolo = document.getElementById('form-solo');
    const btnStart = document.getElementById('btn-start-solo');
    if (formSolo && btnStart) {
        formSolo.insertBefore(bloc, btnStart);
    } else {
        document.body.appendChild(bloc);
    }

    // Copier le lien
    document.getElementById('invite-copy-btn').addEventListener('click', () => {
        navigator.clipboard.writeText(lien).then(() => {
            const msg = document.getElementById('invite-copy-confirm');
            if (msg) { msg.hidden = false; setTimeout(() => { msg.hidden = true; }, 2500); }
        }).catch(() => {
            const inp = document.getElementById('invite-link-input');
            if (inp) { inp.select(); document.execCommand('copy'); }
        });
    });

    // ✅ Bouton QR : s'assure que la modale existe puis l'ouvre
    // La modale est partagée avec la liste des parties (même QR, même logique).
    document.getElementById('invite-showqr-btn').addEventListener('click', () => {
        // Injecter la modale si elle n'existe pas encore
        if (!document.getElementById('modale-qr')) {
            _injecterModaleQR();
        }
        ouvrirModaleQR(lien, nomPartie);
    });

    // Démarrer le polling
    demarrerPollingInvites();
}

// ======================================================
// 🔒 Escape HTML
// ======================================================
function escHtml(str) {
    return String(str || '')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}