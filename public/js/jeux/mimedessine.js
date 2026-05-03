/**
 * ============================================
 * 🎭 MIMEDESSINE.JS — Version 6.0
 * ============================================
 * RÈGLES :
 *  - Le joueur actif voit le mot DIRECTEMENT (pas de bouton Révéler)
 *  - Il mime/dessine — PAS de bouton Trouvé ni Cacher
 *  - Les autres (hôte ou invités) devinent via un champ de saisie
 *  - Si un devineur trouve → le MIMEUR gagne 1 point
 *  - L'hôte peut aussi deviner quand c'est le tour d'un invité
 *  - Fin de manche : liste les mots trouvés dans mimer-score-final
 */

import { GameState } from "../core/state.js";
import { modifierScore } from "../modules/scoreboard.js";
import { loadGame, saveGame } from "../core/storage.js";

// ── Variables globales ───────────────────────────────────────
let donneesJeu            = [];
let categoriesDisponibles = [];
let derniereCategorie     = null;
let timerInterval         = null;
let tempsRestant          = 180;
let modeActuel            = null;
let motActuel             = null;
let categorieActuelle     = null;
let participantActuelIndex = 0;
let participants          = [];
let scoresParParticipant  = {};
let mancheEnCours         = false;
let motsTrouvesManche     = [];   // mots trouvés durant la manche
let motPassesManche       = [];   // tous les mots vus (trouvés + passés)

// Module hôte
let _publierEtat   = () => {};
let _publierScores = () => {};
let _publierTour   = () => {};
let _viderReponse  = () => {};
let _crediterPts   = () => {};
let _stopEcoute    = null;
let _hoteActif     = false;

// ============================================================
// 🚀 INITIALISATION
// ============================================================

export async function initialiserMimer() {
    console.log('[MIMEDESSINE] Initialisation');
    await chargerDonnees();
    initialiserParticipants();
    resetJeu();

    const m = await _chargerModuleHote();
    if (m) {
        const pid = localStorage.getItem('minigame_partie_session_id');
        _publierEtat('en_cours');
        _publierScores(scoresParParticipant);
        _hoteActif = true;

        // Re-sync invités
        const cleD = 'partie_demande_etat_' + pid;
        let _tsVu = 0;
        setInterval(() => {
            try {
                const raw = localStorage.getItem(cleD);
                if (!raw) return;
                const d = JSON.parse(raw);
                if (d.ts <= _tsVu) return;
                _tsVu = d.ts;
                _publierEtat('en_cours');
                _publierScores(scoresParParticipant);
                _publierTourActuel();
            } catch {}
        }, 800);

        if (_stopEcoute) { _stopEcoute(); _stopEcoute = null; }
        _stopEcoute = m.ecouterActionInvite(_recevoirActionInvite);
    }

    afficherEcranAccueil();
}

window.initialiserMimer = initialiserMimer;

// ── Module hôte ─────────────────────────────────────────────

async function _chargerModuleHote() {
    try {
        const m = await import('../modules/mimedessine_hote.js');
        _publierEtat   = m.publierEtat;
        _publierScores = m.publierScores;
        _publierTour   = m.publierEtatTour;
        _viderReponse  = m.viderReponse;
        _crediterPts   = m.crediterPoints;
        console.log('[MIMEDESSINE] Module hôte chargé');
        return m;
    } catch (e) {
        console.warn('[MIMEDESSINE] mimedessine_hote.js introuvable :', e.message);
        return null;
    }
}

function _publierTourActuel() {
    if (!_hoteActif) return;
    _publierTour({
        participant:      participants[participantActuelIndex] || '',
        indexParticipant: participantActuelIndex,
        nbParticipants:   participants.length,
        mode:             modeActuel,
        categorie:        categorieActuelle,
        mot:              mancheEnCours ? motActuel : null,
        motCache:         false,
        phase:            mancheEnCours ? 'mot_revele' : 'accueil',
        mancheEnCours,
        scoresParParticipant
    });
    _publierScores(scoresParParticipant);
}

// ── Actions invités ──────────────────────────────────────────

function _recevoirActionInvite(data) {
    const joueurCourant = participants[participantActuelIndex];
    if (data.pseudo !== joueurCourant) return;

    _viderReponse();
    console.log('[MIMEDESSINE] Action invité:', data.action, 'par', data.pseudo);

    if (data.action === 'commencer') {
        _demarrerMancheInvite();
        return;
    }
    if (!mancheEnCours) return;

    if (data.action === 'trouve' || data.action === 'devine_ok') {
        // L'invité qui mime a appuyé Trouvé, ou un devineur a trouvé → mimeur +1
        const mimeur = participants[participantActuelIndex];
        _enregistrerTrouve(mimeur, data.pseudo);
        afficherNouveauDefi();
    } else if (data.action === 'passer') {
        afficherNouveauDefi();
    } else if (data.action === 'fin_manche') {
        finManche();
    } else if (data.action && data.action.startsWith('score_correction:')) {
        // L'invité corrige le score du mimeur
        const newScore = parseInt(data.action.split(':')[1], 10);
        if (!isNaN(newScore) && newScore >= 0) {
            const mimeur = participants[participantActuelIndex];
            const diff = newScore - (scoresParParticipant[mimeur] || 0);
            scoresParParticipant[mimeur] = newScore;
            if (_hoteActif) {
                if (diff !== 0) _crediterPts(mimeur, diff, scoresParParticipant);
                _publierScores(scoresParParticipant);
            }
            // Mettre à jour l'affichage du score
            const scoreEl = document.getElementById('mimer-hote-scores');
            if (scoreEl) _afficherScoresHote();
        }
    }
}

function _recevoirDevineOkHote(pseudo) {
    // Un observateur hôte a deviné correctement → le mimeur gagne 1 point
    const mimeur = participants[participantActuelIndex];
    _enregistrerTrouve(mimeur, pseudo);
    afficherNouveauDefi();
}

function _demarrerMancheInvite() {
    // Gardé pour compatibilité — l'hôte démarre maintenant via afficherEcranAccueil()
    console.log('[MIMEDESSINE] _demarrerMancheInvite appelé (ignoré)');
}

// ============================================================
// 👥 PARTICIPANTS & RESET
// ============================================================

function initialiserParticipants() {
    participants = [];
    scoresParParticipant = {};
    if (GameState.mode === 'solo') {
        participants = [...(GameState.joueurs || [])];
    } else if (GameState.mode === 'team') {
        participants = (GameState.equipes || []).map(e => e.nom);
    }
    participants.forEach(p => { scoresParParticipant[p] = 0; });
    console.log('[MIMEDESSINE] Participants:', participants);
}

function resetJeu() {
    tempsRestant = 180;
    derniereCategorie = null;
    modeActuel = null;
    motActuel  = null;
    categorieActuelle = null;
    participantActuelIndex = 0;
    mancheEnCours = false;
    motsTrouvesManche = [];
    motPassesManche   = [];
    participants.forEach(p => { scoresParParticipant[p] = 0; });
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    const t = document.getElementById('mimer-timer');
    if (t) { t.textContent = '03:00'; t.classList.remove('timer-alerte'); }
}

// ============================================================
// 📥 CHARGEMENT DES DONNÉES
// ============================================================

async function chargerDonnees() {
    try {
        const r = await fetch('data/MimeDessine.json');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        donneesJeu = await r.json();
        if (donneesJeu.length > 0) categoriesDisponibles = Object.keys(donneesJeu[0]);
        console.log('[MIMEDESSINE] Données:', donneesJeu.length, 'entrées,', categoriesDisponibles.length, 'catégories');
    } catch (e) {
        console.error('[MIMEDESSINE] Erreur chargement:', e);
    }
}

// ============================================================
// 🛠️ VÉRIFICATION DU MOT (Levenshtein)
// ============================================================

// ============================================================
// 🖥️ ÉCRAN D'ACCUEIL DU TOUR
// ============================================================

function afficherEcranAccueil() {
    const content = document.getElementById('mimer-content');
    if (!content) return;

    const participant   = participants[participantActuelIndex];
    const tourInfo      = 'Tour ' + (participantActuelIndex + 1) + ' / ' + participants.length;
    const estTourInvite = _hoteActif && GameState.joueurs?.[0] !== participant;

    if (_hoteActif) {
        _publierTour({
            participant,
            indexParticipant: participantActuelIndex,
            nbParticipants:   participants.length,
            mode: null, categorie: null, mot: null, motCache: false,
            phase: 'accueil', mancheEnCours: false, scoresParParticipant
        });
    }

    // Tour d'un invité : l'hôte lance la manche directement
    if (estTourInvite) {
        content.innerHTML =
            '<div class="mimer-accueil" style="text-align:center;">' +
                '<div class="mimer-tour-info">' + tourInfo + '</div>' +
                '<h2 class="mimer-participant" style="color:#00d4ff;">👤 ' + participant + '</h2>' +
                '<p class="mimer-instruction">C\'est le tour de <strong>' + participant + '</strong></p>' +
                '<p style="font-size:.85rem;color:rgba(255,255,255,.55);margin-top:8px;">' +
                    'La manche démarre dans un instant…' +
                '</p>' +
                '<div class="dot-loader" style="justify-content:center;margin-top:16px;">' +
                    '<span></span><span></span><span></span>' +
                '</div>' +
            '</div>';
        // L'hôte démarre la manche de l'invité après un court délai (laisser l'invité voir l'écran)
        setTimeout(() => {
            mancheEnCours = true;
            tempsRestant  = 180;
            motsTrouvesManche = [];
            motPassesManche   = [];
            demarrerTimer();
            afficherNouveauDefi();
        }, 2000);
        return;
    }

    // Tour de l'hôte
    content.innerHTML =
        '<div class="mimer-accueil">' +
            '<div class="mimer-tour-info">' + tourInfo + '</div>' +
            '<h2 class="mimer-participant">👤 ' + participant + '</h2>' +
            '<p class="mimer-instruction">C\'est ton tour !</p>' +
            '<p class="mimer-regles">' +
                '⏱️ Tu as <strong>3 minutes</strong><br>' +
                '🎯 Les autres devinent tes mots<br>' +
                '🚫 Tu ne peux pas choisir 2× la même catégorie d\'affilée' +
            '</p>' +
            '<button id="mimer-demarrer" class="btn-primary btn-large">' +
                '<span class="btn-icon">🚀</span> Commencer ma manche' +
            '</button>' +
        '</div>';

    document.getElementById('mimer-demarrer')?.addEventListener('click', demarrerManche);
}


// Écran hôte quand il observe le tour d'un invité (manche en cours)
function _afficherAttenteHote(mot) {
    const content = document.getElementById('mimer-content');
    if (!content) return;

    const participant = participants[participantActuelIndex];
    const tourInfo    = 'Tour ' + (participantActuelIndex + 1) + ' / ' + participants.length;
    const modeLabel   = modeActuel === 'mimer' ? '🎭 À MIMER' : '✏️ À DESSINER';

content.innerHTML =
    '<div class="mimer-accueil" style="text-align:center;">' +
        '<div class="mimer-tour-info">' + tourInfo + '</div>' +
        '<h2 class="mimer-participant" style="color:#fbbf24;">🎭 ' + participant + ' joue !</h2>' +
        '<div id="mimer-hote-scores" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:16px;"></div>' +
    '</div>';

_afficherScoresHote();

}


function _afficherScoresHote() {
    const el = document.getElementById('mimer-hote-scores');
    if (!el) return;
    el.innerHTML = Object.entries(scoresParParticipant).map(([nom, pts]) =>
        '<span style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);' +
        'border-radius:20px;padding:4px 12px;font-size:.78rem;font-weight:700;color:rgba(255,255,255,.8);">' +
        nom + ' : ' + pts + '</span>'
    ).join('');
}

// ============================================================
// 🎮 DÉMARRAGE D'UNE MANCHE (hôte)
// ============================================================

function demarrerManche() {
    mancheEnCours = true;
    tempsRestant  = 180;
    motsTrouvesManche = [];
    motPassesManche   = [];
    console.log('[MIMEDESSINE] Manche hôte démarrée :', participants[participantActuelIndex]);
    const partie = loadGame();
    if (partie) {
        partie.manche = participantActuelIndex + 1;
        partie.participantActuel = participants[participantActuelIndex];
        partie.scores = scoresParParticipant;
        saveGame(partie);
    }
    demarrerTimer();
    afficherNouveauDefi();
}

// ============================================================
// ⏱️ TIMER
// ============================================================

function demarrerTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    const t = document.getElementById('mimer-timer');
    timerInterval = setInterval(() => {
        tempsRestant--;
        const m = Math.floor(tempsRestant / 60);
        const s = tempsRestant % 60;
        if (t) t.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
        if (tempsRestant <= 30 && t) t.classList.add('timer-alerte');
        if (tempsRestant <= 0) finManche();
    }, 1000);
}

// ============================================================
// 🎲 NOUVEAU DÉFI — mot tiré et publié IMMÉDIATEMENT
// ============================================================

function afficherNouveauDefi() {
    const content = document.getElementById('mimer-content');
    if (!content) return;

    // Tirer mode, catégorie ET mot directement
    modeActuel = Math.random() < 0.5 ? 'mimer' : 'dessiner';
    let possibles = categoriesDisponibles.filter(c => c !== derniereCategorie);
    if (!possibles.length) possibles = categoriesDisponibles.slice();
    categorieActuelle = possibles[Math.floor(Math.random() * possibles.length)];
    derniereCategorie = categorieActuelle;

    // Tirer le mot immédiatement
    const obj = donneesJeu[Math.floor(Math.random() * donneesJeu.length)];
    motActuel = obj[categorieActuelle];
    motPassesManche.push({ mot: motActuel, categorie: categorieActuelle, trouve: false });

const participant   = participants[participantActuelIndex];
const estTourInvite = _hoteActif && GameState.joueurs?.[0] !== participant;
const modeLabel     = '🎭 À MIMER';
const consigne      = '';


    // Publier avec le mot dès maintenant
    if (_hoteActif) {
        _publierTour({
            participant,
            indexParticipant: participantActuelIndex,
            nbParticipants:   participants.length,
            mode:      modeActuel,
            categorie: categorieActuelle,
            mot:       motActuel,
            motCache:  false,
            phase:     'mot_revele',
            mancheEnCours: true,
            scoresParParticipant
        });
    }

    // Tour d'un invité → hôte voit le champ devinette
    if (estTourInvite) {
        _afficherAttenteHote(motActuel);
        return;
    }

    // Tour de l'hôte → il voit le mot, les autres devinent
    const score = scoresParParticipant[participant] || 0;

    content.innerHTML =
        '<div class="mimer-mot-affiche">' +
            '<div class="mimer-header-info">' +
            '<div class="mimer-categorie-mini">' + categorieActuelle + '</div>' +
            '<div class="mimer-mot-carte"><h2>' + motActuel + '</h2></div>' +
            '<p class="mimer-consigne">' + consigne + '</p>' +
            '<div class="mimer-actions">' +
                '<button id="mimer-trouve" class="btn-success btn-large">' +
                    '<span class="btn-icon">✅</span> Trouvé !' +
                '</button>' +
                '<button id="mimer-passer" class="btn-secondary btn-large">' +
                    '<span class="btn-icon">❌➡️</span> Passer' +
                '</button>' +
                '<button id="mimer-fin-manche" class="btn-warning btn-large">' +
                    '<span class="btn-icon">⏹</span> Finir ma manche' +
                '</button>' +
            '</div>' +
        '</div>';

    document.getElementById('mimer-trouve')?.addEventListener('click', () => {
        _enregistrerTrouve(participants[participantActuelIndex], 'hôte');
        afficherNouveauDefi();
    });
    document.getElementById('mimer-passer')?.addEventListener('click', afficherNouveauDefi);
    document.getElementById('mimer-fin-manche')?.addEventListener('click', finManche);
}

// ============================================================
// ✅ ENREGISTRER UN MOT TROUVÉ
// ============================================================

function _enregistrerTrouve(mimeur, devineur) {
    // +1 point au mimeur — on incrémente scoresParParticipant (score local de la manche)
    scoresParParticipant[mimeur] = (scoresParParticipant[mimeur] || 0) + 1;
    motsTrouvesManche.push({ mot: motActuel, devineur: devineur || '?' });
    // Marquer le mot comme trouvé dans la liste complète
    const dernierMot = motPassesManche[motPassesManche.length - 1];
    if (dernierMot && dernierMot.mot === motActuel) dernierMot.trouve = true;

    if (_hoteActif) {
        // _crediterPts met à jour GameState.scores + scores_globaux + scoreboard
        // On lui passe null pour scoresParParticipant (déjà incrémenté ci-dessus)
        _crediterPts(mimeur, 1, null);
        _publierScores(scoresParParticipant);
        // Rafraîchir le scoreboard côté hôte immédiatement
        if (typeof window.afficherScoreboard === 'function') window.afficherScoreboard();
    } else {
        modifierScore(mimeur, 1);
    }

    const partie = loadGame();
    if (partie) { partie.scores = scoresParParticipant; saveGame(partie); }

    console.log('[MIMEDESSINE] Mot trouvé :', motActuel, '| Mimeur:', mimeur, '| Devineur:', devineur);
}

// ============================================================
// 🏁 FIN DE MANCHE
// ============================================================

function finManche() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    mancheEnCours = false;

    const participant = participants[participantActuelIndex];
    const score       = scoresParParticipant[participant] || 0;
    const content     = document.getElementById('mimer-content');
    if (!content) return;

    const t = document.getElementById('mimer-timer');
    if (t) { t.classList.remove('timer-alerte'); t.textContent = '00:00'; }

    if (_hoteActif) {
        _publierTour({
            participant, indexParticipant: participantActuelIndex,
            nbParticipants: participants.length,
            mode: null, categorie: null, mot: null, motCache: false,
            phase: 'fin_manche', mancheEnCours: false, scoresParParticipant,
            motsTrouves: motsTrouvesManche,
            motsPasses:  motPassesManche
        });
        _publierScores(scoresParParticipant);
    }

    const encore    = participantActuelIndex < participants.length - 1;
    const pluriel   = score > 1 ? 's' : '';

    // Construire la liste COMPLÈTE de tous les mots vus
    const listeMots = motPassesManche.length > 0
        ? motPassesManche.map(m =>
            '<li style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,.06);' +
            'display:flex;justify-content:space-between;align-items:center;gap:10px;">' +
                '<span style="font-weight:700;color:' + (m.trouve ? '#16a34a' : '#999') + ';">' +
                    (m.trouve ? '✅ ' : '❌ ') + m.mot +
                '</span>' +
                '<span style="font-size:.72rem;color:#888;white-space:nowrap;">' +
                    m.categorie +
                '</span>' +
            '</li>'
          ).join('')
        : '<li style="color:#999;font-style:italic;padding:8px 0;">Aucun mot passé</li>';

    content.innerHTML =
        '<div class="mimer-fin">' +
            '<h2 class="mimer-fin-titre">⏱️ Temps écoulé !</h2>' +
            '<div class="mimer-score-final" style="color:#1e1e2e;">' +
                '<p class="mimer-participant-nom" style="color:#1e1e2e;">👤 ' + participant + '</p>' +
                '<h1 style="color:#1e1e2e;">' + score +
                    '<span style="font-size:1.2rem;opacity:.5;font-weight:400;color:#444;">/' + motPassesManche.length + '</span>' +
                '</h1>' +
                '<p class="mimer-score-label" style="color:#444;">mot' + pluriel + ' deviné' + pluriel + ' sur ' + motPassesManche.length + '</p>' +
                '<ul style="list-style:none;padding:0;margin:14px 0 0;text-align:left;' +
                    'background:rgba(0,0,0,.04);border-radius:12px;padding:12px 16px;' +
                    'max-height:180px;overflow-y:auto;">' +
                    listeMots +
                '</ul>' +
            '</div>' +
            (encore
                ? '<button id="mimer-suivant" class="btn-primary btn-large">' +
                    '<span class="btn-icon">➡️</span> Participant suivant</button>'
                : '<button id="mimer-classement" class="btn-primary btn-large">' +
                    '<span class="btn-icon">🏆</span> Voir le classement final</button>') +
        '</div>';

    document.getElementById('mimer-suivant')?.addEventListener('click', () => {
        participantActuelIndex++;
        derniereCategorie = null;
        motsTrouvesManche = [];
        motPassesManche   = [];
        tempsRestant = 180;
        const t2 = document.getElementById('mimer-timer');
        if (t2) { t2.textContent = '03:00'; t2.classList.remove('timer-alerte'); }
        afficherEcranAccueil();
    });

    document.getElementById('mimer-classement')?.addEventListener('click', afficherClassementFinal);
}

// ============================================================
// 🏆 CLASSEMENT FINAL
// ============================================================

function afficherClassementFinal() {
    const content = document.getElementById('mimer-content');
    if (!content) return;

    if (_hoteActif) {
        _publierTour({
            participant: '', indexParticipant: -1, nbParticipants: participants.length,
            mode: null, categorie: null, mot: null, motCache: false,
            phase: 'classement', mancheEnCours: false, scoresParParticipant
        });
    }

    const classement = participants
        .map(p => ({ nom: p, score: scoresParParticipant[p] || 0 }))
        .sort((a, b) => b.score - a.score);

    const lignes = classement.map((item, i) => {
        const m = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1) + '.';
        const pluriel = item.score > 1 ? 's' : '';
        return '<div class="classement-item ' + (i === 0 ? 'winner' : '') + '">' +
            '<span class="classement-position">' + m + '</span>' +
            '<span class="classement-nom">' + item.nom + '</span>' +
            '<span class="classement-score">' + item.score + ' mot' + pluriel + ' deviné' + pluriel + '</span>' +
        '</div>';
    }).join('');

    content.innerHTML =
        '<div class="mimer-fin">' +
            '<h2 class="mimer-fin-titre">🏆 Classement Final</h2>' +
            '<div class="mimer-classement">' + lignes + '</div>' +
            '<button id="mimer-rejouer" class="btn-primary btn-large">' +
                '<span class="btn-icon">🔄</span> Rejouer' +
            '</button>' +
        '</div>';

    document.getElementById('mimer-rejouer')?.addEventListener('click', () => {
        resetJeu();
        participants.forEach(p => { scoresParParticipant[p] = 0; });
        afficherEcranAccueil();
    });
}