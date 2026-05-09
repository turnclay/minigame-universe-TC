// ============================================================
// /js/jeux/quiz.js — v3.0 WS-server-driven
// ============================================================
// Le serveur (server/games/quiz.js) est l'unique séquenceur.
// Ce fichier gère uniquement l'UI hôte :
//   1. fetch questions.json + envoi quiz:load au serveur
//   2. Mise à jour DOM sur réception QUIZ_* depuis le serveur
//   3. Boutons hôte → commandes WS (quiz:next_question, quiz:reveal…)
//   4. Panneau réponses invités
//
// IDs HTML utilisés (index.html) :
//   timer, theme-display, question, indice1, indice2, reponse
//   btn-next, btn-next-arrow, btn-prev (désactivé)
//   btn-indice1, btn-indice2
//   btn-afficher-reponse, btn-valider-reponse, quiz-reponse-input
//   verif-resultat
// ============================================================

import { $ } from '../core/dom.js';
import { GameState } from '../core/state.js';
import { ajouterPoints } from '../modules/scoreboard.js';

// ── État local (UI uniquement — plus de séquence locale) ──
let _timerLocal     = null;
let _tempsRestant   = 60;
let _questionEnCours = null;  // payload de la dernière QUIZ_QUESTION reçue

// ── Stubs module hôte (remplacés par chargerModuleHote) ──
let _publierEtat                    = () => {};
let _publierScores                  = () => {};
let _afficherReponsesInvitesSurHote = () => {};
let _viderReponses                  = () => {};
let _declencherAfficherReponse      = () => {};
let _envoyerReponseHote             = () => {};

// ======================================================
// 📡 CHARGEMENT DU MODULE HÔTE
// ======================================================
async function chargerModuleHote() {
    try {
        const m = await import('../modules/quiz_hote.js');
        _publierEtat                    = m.publierEtat;
        _publierScores                  = m.publierScores;
        _afficherReponsesInvitesSurHote = m.afficherReponsesInvitesSurHote;
        _viderReponses                  = m.viderReponses;
        _declencherAfficherReponse      = m.declencherAfficherReponse || (() => {});
        _envoyerReponseHote             = m.envoyerReponseHote        || (() => {});

        window._quizEnvoyerReponseHote   = rep => _envoyerReponseHote(rep);
        window._quizDeclencherAfficher   = ()  => _declencherAfficherReponse();
        window._quizDeclencherValidation = ()  => _declencherAfficherReponse();

        console.log('[QUIZ] ✅ Module hôte chargé');
        return true;
    } catch (e) {
        console.warn('[QUIZ] ⚠️ quiz_hote.js indisponible :', e.message);
        return false;
    }
}

// ======================================================
// 🖥️ HANDLERS ÉVÉNEMENTS WS SERVEUR
// ======================================================

function _onQuizQuestion(payload) {
    const { question, theme, posees, total, ts, hasIndice1, hasIndice2 } = payload;
    _questionEnCours = payload;
    _viderReponses();

    const tEl = $('theme-display'); if (tEl) tEl.textContent = theme || '—';
    const qEl = $('question');      if (qEl) qEl.textContent = question || '';
    const i1  = $('indice1');       if (i1) i1.textContent = '';
    const i2  = $('indice2');       if (i2) i2.textContent = '';
    const rp  = $('reponse');       if (rp) rp.textContent = '';

    const inp = document.getElementById('quiz-reponse-input');
    if (inp) { inp.value = ''; inp.disabled = false; }

    const btnEnv = document.getElementById('btn-valider-reponse');
    if (btnEnv) {
        btnEnv.disabled      = false;
        btnEnv._sent         = false;
        btnEnv.style.opacity = '';
        btnEnv.textContent   = '✅ Envoyer';
    }

    const btnAff = document.getElementById('btn-afficher-reponse');
    if (btnAff) {
        btnAff.disabled        = true;
        btnAff.style.opacity   = '0.4';
        btnAff.style.cursor    = 'not-allowed';
        btnAff.title           = 'En attente des réponses de tous les joueurs…';
        btnAff.style.animation = '';
    }

    const b1 = $('btn-indice1'); if (b1) b1.disabled = !hasIndice1;
    const b2 = $('btn-indice2'); if (b2) b2.disabled = !hasIndice2;

    const vEl = document.getElementById('verif-resultat');
    if (vEl) vEl.hidden = true;

    _demarrerTimerVisuel(ts);
    setTimeout(() => _afficherReponsesInvitesSurHote('invites-reponses'), 500);

    // Désactiver btn-next pendant la question (réactivé sur QUIZ_CORRECTION)
    const btnNxt = $('btn-next');
    if (btnNxt) {
        btnNxt.disabled      = true;
        btnNxt.style.opacity = '0.35';
        btnNxt.title         = 'Révélez la réponse avant de passer à la suivante';
        btnNxt.style.animation = '';
    }
    console.log('[QUIZ] ❓ Q' + posees + '/' + total + ': ' + question);
}

function _onQuizCorrection(payload) {
    _arreterTimerVisuel();
    const { reponse, posees, total } = payload;
    const repEl = $('reponse');
    if (repEl && reponse) repEl.textContent = reponse;
    _publierScores();
    if (typeof window.afficherScoreboard === 'function') window.afficherScoreboard();
    console.log('[QUIZ] ✅ Correction Q' + posees + '/' + total + ': "' + reponse + '"');

    // Réactiver btn-next après la correction
    const btnNext = $('btn-next');
    if (btnNext) {
        btnNext.disabled       = false;
        btnNext.style.opacity  = '1';
        btnNext.style.animation = 'btnPulse .5s ease';
        setTimeout(() => { if (btnNext) btnNext.style.animation = ''; }, 600);
    }
    // Désactiver btn-afficher-reponse (correction déjà faite)
    const btnAff = document.getElementById('btn-afficher-reponse');
    if (btnAff) {
        btnAff.disabled        = true;
        btnAff.style.opacity   = '0.3';
        btnAff.style.cursor    = 'not-allowed';
        btnAff.style.animation = '';
        btnAff.title           = 'Réponse déjà révélée — cliquez sur Question suivante';
    }
}

function _onQuizEnd({ scores, total }) {
    _arreterTimerVisuel();
    _publierEtat('fin');
    if (scores) {
        GameState.scores = GameState.scores || {};
        Object.assign(GameState.scores, scores);
        _publierScores();
    }
    if (typeof window.afficherScoreboard === 'function') window.afficherScoreboard();
    console.log('[QUIZ] 🏁 Fin — ' + total + ' questions');
}

// ======================================================
// ⏱ TIMER VISUEL (affichage seulement — timer réel = serveur)
// ======================================================
function _demarrerTimerVisuel(tsDebut) {
    _arreterTimerVisuel();
    _tempsRestant = 60;
    const t = $('timer');
    if (!t) return;
    t.textContent = '1:00';
    t.classList.remove('clignote');

    if (tsDebut) {
        const ecoulees = Math.floor((Date.now() - tsDebut) / 1000);
        _tempsRestant = Math.max(0, 60 - ecoulees);
    }

    _timerLocal = setInterval(() => {
        _tempsRestant--;
        if (t) {
            const m = Math.floor(_tempsRestant / 60);
            const s = (_tempsRestant % 60).toString().padStart(2, '0');
            t.textContent = m + ':' + s;
            if (_tempsRestant <= 5 && _tempsRestant > 0) t.classList.add('clignote');
            if (_tempsRestant <= 0) {
                _arreterTimerVisuel();
                t.textContent = '0:00';
                t.classList.remove('clignote');
            }
        }
    }, 1000);
}

function _arreterTimerVisuel() {
    if (_timerLocal) { clearInterval(_timerLocal); _timerLocal = null; }
}

// ======================================================
// 📱 PANNEAU RÉPONSES INVITÉS (injecté une seule fois)
// ======================================================
function injecterPanneauInvites() {
    if (document.getElementById('panneau-invites-quiz')) return;
    const section = $('quiz');
    if (!section) return;

    const panneau = document.createElement('div');
    panneau.id = 'panneau-invites-quiz';
    panneau.style.cssText = 'margin-top:20px;background:rgba(0,212,255,0.06);border:1px solid rgba(0,212,255,0.2);border-radius:14px;padding:14px 16px;';
    panneau.innerHTML = '<div style="font-size:.78rem;text-transform:uppercase;letter-spacing:.1em;color:rgba(0,212,255,.7);margin-bottom:10px;font-weight:700;">📱 Réponses des joueurs</div>'
        + '<div id="invites-reponses"><p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">Aucune réponse pour l\'instant</p></div>';
    section.appendChild(panneau);

    if (!document.getElementById('style-invites')) {
        const s = document.createElement('style');
        s.id = 'style-invites';
        s.textContent = '@keyframes btnPulse{0%{transform:scale(1)}50%{transform:scale(1.06)}100%{transform:scale(1)}}';
        document.head.appendChild(s);
    }

    setInterval(() => _afficherReponsesInvitesSurHote('invites-reponses'), 2000);
}

// ======================================================
// 🎧 LISTENERS HÔTE → commandes WS serveur
// ======================================================
function attacherListenersQuiz(socket) {

    // 🚀 BOUTON START — masqué (le démarrage est automatique après quiz:load)
    const btnStart = document.getElementById('btn-start-solo');
    if (btnStart) btnStart.style.display = 'none';

    // 👉 Question suivante
    ['btn-next', 'btn-next-arrow'].forEach(id => {
        const el = $(id);
        if (el) el.onclick = () =>
            socket.send('HOST_ACTION', { action: 'quiz:next_question', data: {} });
    });

    // 👉 Bouton précédent désactivé
    const prev = $('btn-prev');
    if (prev) { prev.disabled = true; prev.style.opacity = '0.3'; }

    // 👉 Indices
    const ind1 = $('btn-indice1');
    if (ind1) ind1.onclick = () =>
        socket.send('HOST_ACTION', { action: 'quiz:reveal_indice', data: { num: 1 } });

    const ind2 = $('btn-indice2');
    if (ind2) ind2.onclick = () =>
        socket.send('HOST_ACTION', { action: 'quiz:reveal_indice', data: { num: 2 } });

    // 👉 Révélation
    const btnAff = document.getElementById('btn-afficher-reponse');
    if (btnAff) btnAff.onclick = () => _declencherAfficherReponse();

    // 👉 Réponse hôte
    const btnEnv = document.getElementById('btn-valider-reponse');
    if (btnEnv) {
        btnEnv.onclick = () => {
            if (btnEnv._sent) return;
            const inp = document.getElementById('quiz-reponse-input');
            const rep = inp ? inp.value.trim() : '';
            if (!rep) return;
            _envoyerReponseHote(rep);
        };
    }
}


// ======================================================
// 📡 ABONNEMENTS ÉVÉNEMENTS SERVEUR (côté hôte)
// ======================================================
function abonnerEvenementsServeur(socket) {

    socket.on('QUIZ_READY', ({ total, message }) => {
        console.log('[QUIZ] 📚 ' + (message || total + ' questions chargées'));
        // QUIZ_READY suivi du lancement auto — btn-start-solo n'est plus nécessaire
        const btnStart = document.getElementById('btn-start-solo');
        if (btnStart) btnStart.style.display = 'none';
    });

    socket.on('QUIZ_QUESTION',   payload => _onQuizQuestion(payload));
    socket.on('QUIZ_CORRECTION', payload => _onQuizCorrection(payload));
    socket.on('QUIZ_END',        payload => _onQuizEnd(payload));

    socket.on('QUIZ_INDICE', ({ num, texte }) => {
        const el = $('indice' + num);
        if (el) el.textContent = texte;
    });

    // Timer écoulé côté serveur → activer btn-afficher-reponse
    socket.on('QUIZ_TIMER_EXPIRED', ({ nbReponses, nbJoueurs }) => {
        console.log('[QUIZ] ⏱ Timer expiré — activation btn-afficher-reponse');
        _activerBoutonAfficherReponse();
    });

    socket.on('SCORES_UPDATE', ({ scores }) => {
        if (scores) {
            GameState.scores = GameState.scores || {};
            Object.assign(GameState.scores, scores);
        }
        _publierScores();
        if (typeof window.afficherScoreboard === 'function')
            window.afficherScoreboard();
    });
}

// Active btn-afficher-reponse avec feedback visuel
function _activerBoutonAfficherReponse() {
    const btn = document.getElementById('btn-afficher-reponse');
    if (!btn) return;
    btn.disabled        = false;
    btn.style.opacity   = '1';
    btn.style.cursor    = 'pointer';
    btn.style.animation = 'btnPulse .6s ease infinite alternate';
    btn.title           = '⏱ Timer écoulé — Cliquez pour révéler la réponse';
    // Injecter l'animation si absente
    if (!document.getElementById('style-btn-pulse')) {
        const s = document.createElement('style'); s.id = 'style-btn-pulse';
        s.textContent = '@keyframes btnPulse{0%{transform:scale(1)}100%{transform:scale(1.05)}}';
        document.head.appendChild(s);
    }
}


// ======================================================
// 📥 INITIALISATION PRINCIPALE
// ======================================================
async function initialiserQuiz() {
    // Récupérer le socket AVANT tout await — évite la race condition où
    // QUIZ_READY arrive avant que les listeners soient enregistrés.
    const socket = window.jeuSocket;
    if (!socket) {
        console.error('[QUIZ] ❌ window.jeuSocket introuvable');
        return;
    }

    // S'abonner aux événements serveur EN PREMIER — avant tout envoi réseau.
    // Si quiz:load → QUIZ_READY arrive pendant le await chargerModuleHote(),
    // les listeners sont déjà en place.
    abonnerEvenementsServeur(socket);
    attacherListenersQuiz(socket);

    // Désactiver btn-next par défaut — sera réactivé sur QUIZ_READY
    const btnNext = $('btn-next');
    if (btnNext) { btnNext.disabled = true; btnNext.style.opacity = '0.4'; }

    // Charger le module hôte en parallèle (async)
    const hoteActif = await chargerModuleHote();

    if (hoteActif) {
        _publierEtat('en_cours');
        _publierScores();
    }

    // Charger questions.json et les envoyer au serveur
    try {
        const res       = await fetch('data/questions.json');
        const questions = await res.json();

        // Mélanger côté client (ordre unique par partie)
        const ordre = [...Array(questions.length).keys()];
        for (let i = ordre.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [ordre[i], ordre[j]] = [ordre[j], ordre[i]];
        }
        const qMelangees = ordre.map(i => questions[i]);

        // Envoyer au serveur — séquence entièrement gérée côté serveur
        socket.send('HOST_ACTION', { action: 'quiz:load', data: { questions: qMelangees } });
        console.log('[QUIZ] 📡 ' + qMelangees.length + ' questions envoyées au serveur');

        if (hoteActif) injecterPanneauInvites();

    } catch (err) {
        console.error('[QUIZ] ❌ questions.json :', err);
        alert('Impossible de charger les questions.');
    }
}

// ======================================================
// EXPORTS WINDOW
// ======================================================
window.initialiserQuiz = initialiserQuiz;

window._quizGetReponseCorrecte = function () {
    if (!_questionEnCours) return '';
    return _questionEnCours['Réponse'] || _questionEnCours.reponse || '';
};

window._quizNbJoueursInvites = function () {
    const snap = window.HostSession?._snapshot;
    if (snap && snap.joueurs && snap.joueurs.length > 0) return snap.joueurs.length;
    return Math.max(0, (GameState.joueurs || []).length - 1);
};

window._quizValiderAvecPoints = function (correct, points) {
    if (correct && points > 0) {
        const p = GameState.mode === 'solo' ? GameState.joueurs[0] : GameState.equipes?.[0]?.nom;
        if (p) { ajouterPoints(p, points); _publierScores(); }
    }
};