// /js/modules/invite.js — v2.3 (FIXED — bloc-invitation apparaît correctement)

import { GameState } from '../core/state.js';
import { ouvrirModaleQR, _injecterModaleQR } from './parties.js';

const PARTIE_ID_KEY = 'minigame_partie_session_id';

let _partieSessionId = null;

export function getPartieSessionId() {
    if (_partieSessionId) return _partieSessionId;
    const stored = localStorage.getItem(PARTIE_ID_KEY)
                || localStorage.getItem('ws_partie_id')
                || localStorage.getItem('minigame_partie_id');
    if (stored) { _partieSessionId = stored; return stored; }
    return null;
}

export function setPartieSessionId(id) {
    if (!id) {
        console.warn('[INVITE] ⚠️ setPartieSessionId appelé avec ID null');
        return;
    }
    _partieSessionId = id;
    localStorage.setItem(PARTIE_ID_KEY, id);
    console.log('[INVITE] ✅ partieId serveur enregistré :', id);
}

export function resetPartieSessionId() {
    _partieSessionId = null;
    localStorage.removeItem(PARTIE_ID_KEY);
    _viderBlocStatique();
    console.log('[INVITE] 🧹 partieSessionId réinitialisé');
}

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

const JEUX_LABELS = {
    quiz:'❓ Quiz', justeprix:'💰 Juste Prix', undercover:'🕵️ Undercover',
    lml:'📖 Maxi Lettres', mimer:'🎭 Mimer', mimedessine:'🎭 Mimer',
    pendu:'🪢 Pendu', petitbac:'📝 Petit Bac', memoire:'🧠 Mémoire',
    morpion:'⭕ Morpion', puissance4:'🔴 Puissance 4'
};

export function afficherBlocInvitation() {
    const bloc = document.getElementById('bloc-invitation');
    if (!bloc) {
        console.warn('[INVITE] ❌ bloc-invitation non trouvé en DOM');
        return;
    }

    const lien     = construireLienInvitation();
    const partieId = getPartieSessionId();

    if (!lien || !partieId) {
        console.warn('[INVITE] ⚠️ Pas de lien ou partieId — bloc masqué');
        bloc.hidden = true;
        return;
    }

    _remplirBloc(lien, partieId);
    bloc.hidden = false;
    console.log('[INVITE] ✅ Bloc invitation affiché — partieId :', partieId);
}

export function mettreAJourLienInvitation() {
    const lien     = construireLienInvitation();
    const partieId = getPartieSessionId();

    if (!lien || !partieId) {
        console.warn('[INVITE] ⚠️ Impossible de mettre à jour — pas de lien ou partieId');
        return;
    }

    _remplirBloc(lien, partieId);
    const bloc = document.getElementById('bloc-invitation');
    if (bloc) {
        bloc.hidden = false;
        console.log('[INVITE] 🔗 Lien mis à jour et bloc affiché :', lien);
    }
}

function _remplirBloc(lien, partieId) {
    const jeu      = GameState.jeuActuel || GameState.jeu || '';
    const hote     = (GameState.joueurs || [])[0] || '';
    const jeuLabel = JEUX_LABELS[jeu.toLowerCase()] || jeu.toUpperCase() || '—';
    const d        = new Date();
    const dateStr  = d.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' })
                    + ' à ' + d.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });

    _setText('invite-meta-hote',  hote || '—');
    _setText('invite-meta-nom',   GameState.partieNom || '—');
    _setText('invite-meta-jeu',   jeuLabel);
    _setText('invite-meta-date',  dateStr);
    _setText('invite-meta-id',    partieId || '—');

    const rowHote = document.getElementById('invite-row-hote');
    if (rowHote) rowHote.hidden = !hote;

    const input = document.getElementById('invite-link-input');
    if (input) input.value = lien || '';

    const btnCopy = document.getElementById('invite-copy-btn');
    const btnQR   = document.getElementById('invite-showqr-btn');
    if (btnCopy) { btnCopy.disabled = !lien; btnCopy.onclick = () => _copierLien(lien); }
    if (btnQR)   { btnQR.disabled   = !lien; btnQR.onclick   = () => _ouvrirQR(lien); }
}

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

function _ouvrirQR(lien) {
    if (!document.getElementById('modale-qr')) _injecterModaleQR();
    ouvrirModaleQR(lien, GameState.partieNom || 'Partie');
}

function _setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text ?? '—';
}

export function demarrerPollingInvites() {
    console.log('[INVITE] ℹ️ demarrerPollingInvites() → délégué à HostSession WS');
}

export function arreterPollingInvites() {}

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