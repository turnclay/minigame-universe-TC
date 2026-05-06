// /js/modules/invite.js — v2.1 (bloc statique, ID serveur uniquement)
// ============================================================
// RÈGLE ABSOLUE : aucun ID n'est jamais généré localement.
// Le seul partieId valide est celui reçu via GAME_CREATED.
// Le bloc #bloc-invitation est défini statiquement dans index.html.
// Ce fichier ne crée aucun élément DOM — il met à jour les champs.
// ============================================================

import { GameState } from '../core/state.js';
import { ouvrirModaleQR, _injecterModaleQR } from './parties.js';

const PARTIE_ID_KEY = 'minigame_partie_session_id';

let _partieSessionId = null;  // mémoire module — UUID reçu de GAME_CREATED

// ══════════════════════════════════════════════════════════════
// ID DE PARTIE — source de vérité : serveur uniquement
// ══════════════════════════════════════════════════════════════

/** Retourne l'UUID serveur ou null — jamais ne génère localement. */
export function getPartieSessionId() {
    if (_partieSessionId) return _partieSessionId;
    const stored = localStorage.getItem(PARTIE_ID_KEY);
    if (stored) { _partieSessionId = stored; return stored; }
    return null;
}

/** Appelé par main.js sur GAME_CREATED — seul point d'écriture autorisé. */
export function setPartieSessionId(id) {
    if (!id) return;
    _partieSessionId = id;
    localStorage.setItem(PARTIE_ID_KEY, id);
    console.log('[INVITE] ✅ partieId serveur enregistré :', id);
}

/** Appelé sur GAME_ENDED / ERROR GAME_NOT_FOUND / retour accueil. */
export function resetPartieSessionId() {
    _partieSessionId = null;
    localStorage.removeItem(PARTIE_ID_KEY);
    _viderBlocStatique();
    console.log('[INVITE] 🧹 partieSessionId réinitialisé');
}

// ══════════════════════════════════════════════════════════════
// CONSTRUCTION DU LIEN
// ══════════════════════════════════════════════════════════════

/** Construit le lien /jeu.html avec les paramètres de la partie.
 *  Retourne null si aucun UUID serveur n'est disponible. */
export function construireLienInvitation() {
    const id = getPartieSessionId();
    if (!id) {
        console.warn('[INVITE] ⚠️ Pas de partieId — lien non généré');
        return null;
    }
    const params = new URLSearchParams({
        partieId  : id,
        partieNom : GameState.partieNom || 'Partie',
        jeu       : GameState.jeuActuel || GameState.jeu || '',
        hote      : (GameState.joueurs || [])[0] || '',
        createdAt : Date.now(),
    });
    return `${window.location.origin}/jeu.html?${params.toString()}`;
}

// ══════════════════════════════════════════════════════════════
// BLOC INVITATION STATIQUE — mise à jour des champs HTML
// Le bloc #bloc-invitation est déclaré dans index.html.
// Ces fonctions ne créent aucun élément DOM.
// ══════════════════════════════════════════════════════════════

const JEUX_LABELS = {
    quiz:'❓ Quiz', justeprix:'💰 Juste Prix', undercover:'🕵️ Undercover',
    lml:'📖 Maxi Lettres', mimer:'🎭 Mimer', mimedessine:'🎭 Mimer',
    pendu:'🪢 Pendu', petitbac:'📝 Petit Bac', memoire:'🧠 Mémoire',
    morpion:'⭕ Morpion', puissance4:'🔴 Puissance 4'
};

/**
 * Remplit les champs du bloc statique et le rend visible.
 * Appelé par joueurs.js dès qu'un joueur est sélectionné
 * ET que l'UUID serveur est disponible.
 * Sans UUID → bloc masqué, pas d'affichage.
 */
export function afficherBlocInvitation() {
    const bloc = document.getElementById('bloc-invitation');
    if (!bloc) return;

    const lien     = construireLienInvitation();
    const partieId = getPartieSessionId();

    if (!lien || !partieId) {
        bloc.hidden = true;
        console.warn('[INVITE] ⚠️ Pas de partieId — bloc masqué');
        return;
    }

    _remplirBloc(lien, partieId);
    bloc.hidden = false;
    console.log('[INVITE] ✅ Bloc invitation affiché — partieId :', partieId);
}

/**
 * Met à jour le lien et les métadonnées sans toucher à la visibilité.
 * Appelé par main.js immédiatement après GAME_CREATED.
 */
export function mettreAJourLienInvitation() {
    const lien     = construireLienInvitation();
    const partieId = getPartieSessionId();
    if (!lien || !partieId) return;

    _remplirBloc(lien, partieId);

    // Rendre visible si masqué
    const bloc = document.getElementById('bloc-invitation');
    if (bloc) bloc.hidden = false;

    console.log('[INVITE] 🔗 Lien mis à jour :', lien);
}

/** Remplit tous les champs du bloc statique. */
function _remplirBloc(lien, partieId) {
    const jeu      = GameState.jeuActuel || GameState.jeu || '';
    const hote     = (GameState.joueurs || [])[0] || '';
    const jeuLabel = JEUX_LABELS[jeu.toLowerCase()] || jeu.toUpperCase() || '—';
    const d        = new Date();
    const dateStr  = d.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' })
                   + ' à ' + d.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });

    // Métadonnées
    _setText('invite-meta-hote',  hote || '—');
    _setText('invite-meta-nom',   GameState.partieNom || '—');
    _setText('invite-meta-jeu',   jeuLabel);
    _setText('invite-meta-date',  dateStr);
    _setText('invite-meta-id',    partieId);

    // Ligne hôte : visible seulement si hôte présent
    const rowHote = document.getElementById('invite-row-hote');
    if (rowHote) rowHote.hidden = !hote;

    // Champ lien
    const input = document.getElementById('invite-link-input');
    if (input) input.value = lien;

    // Boutons : activer (ils sont disabled par défaut dans le HTML)
    const btnCopy = document.getElementById('invite-copy-btn');
    const btnQR   = document.getElementById('invite-showqr-btn');
    if (btnCopy) { btnCopy.disabled = false; btnCopy.onclick = () => _copierLien(lien); }
    if (btnQR)   { btnQR.disabled   = false; btnQR.onclick   = () => _ouvrirQR(lien); }
}

/** Remet le bloc à son état initial (masqué, champs vides). */
function _viderBlocStatique() {
    const bloc = document.getElementById('bloc-invitation');
    if (!bloc) return;
    bloc.hidden = true;

    ['invite-meta-hote','invite-meta-nom','invite-meta-jeu',
     'invite-meta-date','invite-meta-id'].forEach(id => _setText(id, '—'));

    const input = document.getElementById('invite-link-input');
    if (input) input.value = '';

    const btnCopy = document.getElementById('invite-copy-btn');
    const btnQR   = document.getElementById('invite-showqr-btn');
    if (btnCopy) { btnCopy.disabled = true; btnCopy.onclick = null; }
    if (btnQR)   { btnQR.disabled   = true; btnQR.onclick   = null; }
}

// ── Copier le lien ────────────────────────────────────────
function _copierLien(lien) {
    if (!lien) return;
    navigator.clipboard.writeText(lien).then(() => {
        const msg = document.getElementById('invite-copy-confirm');
        if (msg) { msg.hidden = false; setTimeout(() => { msg.hidden = true; }, 2500); }
    }).catch(() => {
        const inp = document.getElementById('invite-link-input');
        if (inp) { inp.select(); document.execCommand('copy'); }
    });
}

// ── Ouvrir la modale QR ───────────────────────────────────
function _ouvrirQR(lien) {
    if (!document.getElementById('modale-qr')) _injecterModaleQR();
    ouvrirModaleQR(lien, GameState.partieNom || 'Partie');
}

// ── Utilitaire DOM ────────────────────────────────────────
function _setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text ?? '—';
}

// ══════════════════════════════════════════════════════════════
// COMPAT — fonctions conservées pour les appels existants
// ══════════════════════════════════════════════════════════════

/** Remplacé par l'écoute WS dans HostSession (main.js). */
export function demarrerPollingInvites() {
    console.log('[INVITE] ℹ️ demarrerPollingInvites() → délégué à HostSession WS');
}

export function arreterPollingInvites() {}

/** Toast "X a rejoint" — utilisé par main.js si nécessaire. */
export function afficherNotifNouveauJoueur(pseudo) {
    const notif = document.createElement('div');
    notif.className = 'invite-notif';
    notif.innerHTML = `✅ <strong>${_esc(pseudo)}</strong> a rejoint la partie !`;
    document.body.appendChild(notif);
    requestAnimationFrame(() => notif.classList.add('show'));
    setTimeout(() => { notif.classList.remove('show'); setTimeout(() => notif.remove(), 400); }, 3000);
}

function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}