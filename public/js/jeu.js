// ================================================================
// public/js/jeu.js — v5.0 (point d'entrée pur)
// ================================================================
// Ce fichier est uniquement un point d'entrée.
// Toute la logique gameplay invité est dans player.js.
//
// Rôle :
//   1. Lire les paramètres URL
//   2. Afficher le formulaire pseudo si nécessaire
//   3. Connecter le socket WS
//   4. Déléguer à Player.init(session, socket)
//
// Aucune logique de jeu ici.
// ================================================================

import { socket }           from './core/socket.js';
import { Player }           from './modules/player.js';
// Import à effet de bord : enregistre les modules jeu dans JeuRegistry.
// Chaque jeu WS doit être listé ici pour que JeuRegistry.get(jeu) le trouve.
import                           './modules/petitbac_player.js';
import                           './modules/pendu_player.js';
import                           './modules/lml_player.js';
import                           './modules/justeprix_player.js';
import                           './modules/morpion_player.js';
import                           './modules/puissance4_player.js';
import                           './modules/memoire_player.js';
import                           './modules/mime_player.js';
import                           './modules/undercover_player.js';

// ── DOM utils ──────────────────────────────────────────────────
const $      = id => document.getElementById(id);
const setText = (id, t) => { const e = $(id); if (e) e.textContent = t ?? ''; };
const esc     = s => String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// ================================================================
// JEUAPP — point d'entrée
// ================================================================
const JeuApp = {

    session: null,

    init() {
        const params    = new URLSearchParams(window.location.search);
        const partieId  = params.get('partieId')  || params.get('sessionId') || null;
        const pseudo    = params.get('pseudo')     || null;
        const jeu       = params.get('jeu')        || null;
        const partieNom = params.get('partieNom')  || params.get('nom')       || null;
        const hote      = params.get('hote')       || null;
        const codeCourt = params.get('code')       || null;
        const createdAt = params.get('createdAt')  || null;

        if (!partieId) {
            const etat = $('id-etat');
            const sub  = $('id-subtitle');
            if (etat) etat.textContent = "Lien invalide — paramètre 'partieId' manquant.";
            if (sub)  sub.textContent  = "❌ Utilise le lien fourni par l'hôte.";
            return;
        }

        const session = {
            partieId,
            pseudo,
            jeu,
            partieNom   : partieNom || 'Partie',
            hote,
            codeCourt,
            createdAt,
            role        : 'player',
            needsPseudo : !pseudo,
        };

        try { sessionStorage.setItem('mgu_game_session', JSON.stringify(session)); } catch {}
        this.session = session;

        if (!pseudo) {
            this._afficherFormulairePseudo(session);
            return;
        }

        this._demarrer(session);
    },

    _afficherFormulairePseudo(session) {
        // Remplir la carte meta
        const LABELS = {
            quiz:'❓ Quiz', justeprix:'💰 Juste Prix', undercover:'🕵️ Undercover',
            lml:'📖 Maxi Lettres', mimer:'🎭 Mimer', mimedessine:'🎭 Mimer',
            pendu:'🪢 Pendu', petitbac:'📝 Petit Bac', memoire:'🧠 Mémoire',
            morpion:'⭕ Morpion', puissance4:'🔴 Puissance 4'
        };
        setText('id-meta-nom',  session.partieNom || '—');
        setText('id-meta-jeu',  session.jeu
            ? (LABELS[session.jeu.toLowerCase()] || session.jeu.toUpperCase()) : '—');
        setText('id-meta-id',   session.partieId  || '—');
        setText('id-meta-hote', session.hote      || '—');
        const rh = $('id-row-hote');
        if (rh) rh.style.display = session.hote ? '' : 'none';
        const rd = $('id-row-date');
        if (rd) {
            if (session.createdAt) {
                try {
                    const d = new Date(isNaN(session.createdAt)
                        ? session.createdAt : Number(session.createdAt));
                    setText('id-meta-date',
                        d.toLocaleDateString('fr-FR', {day:'2-digit',month:'2-digit',year:'numeric'})
                        + ' à ' + d.toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'}));
                    rd.style.display = '';
                } catch { rd.style.display = 'none'; }
            } else { rd.style.display = 'none'; }
        }

        // Lire les éléments statiques de jeu.html
        const etat  = $('id-etat');
        const input = $('id-pseudo');
        const btn   = $('btn-join');

        if (!input || !btn) {
            if (etat) etat.textContent = 'Erreur : formulaire introuvable dans jeu.html.';
            return;
        }

        input.value    = '';
        input.disabled = false;
        if (etat) etat.textContent = '';

        const valider = () => {
            const p = input.value.trim();
            if (p.length < 2) {
                if (etat) etat.textContent = 'Pseudo trop court (2 caractères minimum).';
                input.focus(); return;
            }
            if (!/^[a-zA-Z0-9_-]{2,20}$/.test(p)) {
                if (etat) etat.textContent = 'Lettres, chiffres, tiret ou underscore uniquement.';
                input.focus(); return;
            }
            btn.disabled    = true;
            btn.textContent = '⏳ Connexion…';
            input.disabled  = true;
            if (etat) etat.textContent = '';

            const sessionComplete = { ...session, pseudo: p, needsPseudo: false };
            try { sessionStorage.setItem('mgu_game_session', JSON.stringify(sessionComplete)); } catch {}
            this._demarrer(sessionComplete);
        };

        input.addEventListener('keydown', e => { if (e.key === 'Enter') valider(); });

        // Cloner pour nettoyer les anciens listeners
        btn.replaceWith(btn.cloneNode(true));
        $('btn-join').addEventListener('click', valider);

        setTimeout(() => input.focus(), 100);
    },

    _demarrer(session) {
        this.session = session;

        // Exposer sur window pour compatibilité modules existants
        window.JeuApp    = this;
        window.jeuSocket = socket;

        // Enregistrer les listeners Player AVANT de connecter le socket.
        // Si socket.connect() est appelé en premier, __connected__ peut
        // se déclencher avant que Player.init() ait enregistré son .once(),
        // et PLAYER_REJOIN ne serait jamais envoyé.
        Player.init(session, socket);

        // Connecter après — __connected__ sera émis après l'enregistrement
        socket.connect();
    },
};

document.addEventListener('DOMContentLoaded', () => JeuApp.init());