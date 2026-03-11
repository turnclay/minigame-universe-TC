// ======================================================
// 🎯 QUIZ.JS (Corrigé)
// ======================================================

import { socket } from '../../js/core/socket.js';

const POINTS_BONNE_REPONSE = 2;
const TEMPS_PAR_QUESTION = 60;

const $ = (id) => document.getElementById(id);
const esc = (str) => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const QuizState = {
    partieId: null,
    pseudo: null,
    isAuthenticated: false,
    isGameStarted: false,
    questions: [],
    ordreQuestions: [],
    indexCourant: 0,
    scores: {},
    joueurs: [],
    tempsRestant: TEMPS_PAR_QUESTION,
    timerInterval: null,
};

/**
 * Extrait les paramètres depuis l'URL (priorité) ou sessionStorage
 */
function extraireParametresURL() {
    const params = new URLSearchParams(location.search);

    // Priorité à l'URL
    QuizState.partieId = params.get('partieId');
    QuizState.pseudo = params.get('pseudo');

    // Fallback sur sessionStorage
    if (!QuizState.partieId || !QuizState.pseudo) {
        try {
            const session = JSON.parse(sessionStorage.getItem('mgu_game_session') || '{}');
            QuizState.partieId = QuizState.partieId || session.partieId;
            QuizState.pseudo = QuizState.pseudo || session.pseudo;
        } catch {}
    }

    console.log('📍 Paramètres:', { partieId: QuizState.partieId, pseudo: QuizState.pseudo });
}

/**
 * Initialise WebSocket
 */
function initSocket() {
    socket.on('__connected__', () => {
        console.log('✅ WebSocket connecté');
        setTimeout(() => {
            if (QuizState.partieId && QuizState.pseudo && !QuizState.isAuthenticated) {
                socket.send('PLAYER_JOIN', {
                    pseudo: QuizState.pseudo,
                    partieId: QuizState.partieId,
                });
            }
        }, 100);
    });

    socket.on('JOIN_OK', ({ pseudo, snapshot }) => {
        console.log('✅ Authentifié:', pseudo);
        QuizState.isAuthenticated = true;
        QuizState.joueurs = snapshot.joueurs || [];
        QuizState.scores = snapshot.scores || {};

        hide('ecran-erreur');
        hide('ecran-attente');
        show('ecran-quiz');

        initialiserQuiz();
    });

    socket.on('JOIN_ERROR', ({ code }) => {
        console.error('❌ Erreur:', code);
        afficherEcranErreur(code);
    });

    socket.on('GAME_STARTED', ({ snapshot }) => {
        console.log('🚀 Partie démarrée');
        QuizState.isGameStarted = true;
        initialiserQuiz();
    });

    socket.on('GAME_ENDED', ({ snapshot }) => {
        console.log('🏁 Fin');
        arreterTimer();
        QuizState.scores = snapshot.scores || {};
        hide('ecran-quiz');
        show('ecran-resultats');
        renderResultats();
    });

    socket.on('SCORES_UPDATE', ({ scores }) => {
        QuizState.scores = scores;
        renderScoreboard();
    });

    socket.on('KICKED', () => {
        afficherEcranErreur('Vous avez été expulsé');
    });
}

/**
 * Affiche la liste des joueurs
 */
function renderListeJoueurs() {
    const container = $('joueurs-liste');
    if (!container || QuizState.joueurs.length === 0) return;

    container.innerHTML = QuizState.joueurs.map(j => `
        <div class="joueur-item">
            <span class="joueur-avatar">${(j.pseudo || '?').charAt(0).toUpperCase()}</span>
            <span class="joueur-nom">${esc(j.pseudo)}</span>
        </div>
    `).join('');
}

/**
 * Affiche le scoreboard
 */
function renderScoreboard() {
    const container = $('scoreboard');
    if (!container) return;

    const entries = Object.entries(QuizState.scores).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) {
        container.innerHTML = '<p>Pas de scores</p>';
        return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    const max = entries[0][1] || 1;

    container.innerHTML = entries.map(([nom, pts], i) => {
        const pct = Math.round((pts / max) * 100);
        return `
            <div class="score-row">
                <span>${medals[i] || `${i + 1}.`}</span>
                <span>${esc(nom)}</span>
                <div style="flex:1;background:#eee;height:4px;margin:0 1rem;border-radius:2px;">
                    <div style="width:${pct}%;background:#667eea;height:100%;border-radius:2px;"></div>
                </div>
                <span>${pts}pts</span>
            </div>
        `;
    }).join('');
}

/**
 * Affiche les résultats
 */
function renderResultats() {
    const container = $('resultats-final');
    if (!container) return;

    const entries = Object.entries(QuizState.scores).sort((a, b) => b[1] - a[1]);
    const medals = ['🥇', '🥈', '🥉'];

    container.innerHTML = entries.map(([nom, pts], i) => `
        <div class="resultat-row">
            <span>${medals[i] || `${i + 1}.`}</span>
            <span>${esc(nom)}</span>
            <span>${pts}pts</span>
        </div>
    `).join('');
}

/**
 * Affiche erreur
 */
function afficherEcranErreur(message) {
    const container = $('ecran-erreur');
    if (container) {
        container.innerHTML = `
            <div style="text-align:center;padding:2rem;">
                <h2>❌ ${esc(message)}</h2>
                <a href="/join/" class="btn btn-primary">Retour</a>
            </div>
        `;
        show('ecran-erreur');
        hide('ecran-attente');
        hide('ecran-quiz');
    }
}

/**
 * Quiz
 */
function initialiserQuiz() {
    fetch('data/questions.json')
        .then(r => r.json())
        .then(data => {
            QuizState.questions = data;
            QuizState.ordreQuestions = shuffle([...Array(data.length).keys()]);
            QuizState.indexCourant = 0;

            afficherQuestion();
            attacherListeners();

            console.log('✅ Quiz prêt');
        })
        .catch(err => {
            console.error('Erreur questions:', err);
            afficherEcranErreur('Erreur chargement');
        });
}

function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function getQuestionCourante() {
    if (QuizState.questions.length === 0) return null;
    return QuizState.questions[QuizState.ordreQuestions[QuizState.indexCourant]];
}

function afficherQuestion() {
    const q = getQuestionCourante();
    if (!q) return;

    const qEl = $('question-text');
    if (qEl) qEl.textContent = q.question || q.Question || '—';

    const tEl = $('theme-display');
    if (tEl) tEl.textContent = q.theme || q.Thème || '—';

    [$('indice1'), $('indice2'), $('reponse-text')].forEach(el => {
        if (el) el.textContent = '';
    });

    demarrerTimer();
}

function questionSuivante() {
    QuizState.indexCourant = (QuizState.indexCourant + 1) % QuizState.questions.length;
    afficherQuestion();
}

function afficherIndice1() {
    const q = getQuestionCourante();
    if (q) {
        const el = $('indice1');
        if (el) el.textContent = q.indice1 || q['Indice 1'] || '—';
    }
}

function revelerReponse() {
    const q = getQuestionCourante();
    if (q) {
        const el = $('reponse-text');
        if (el) el.textContent = q.reponse || q.Réponse || '—';

        socket.send('HOST_ADD_POINTS', {
            cible: QuizState.pseudo,
            points: POINTS_BONNE_REPONSE,
        });
    }
}

function demarrerTimer() {
    arreterTimer();
    QuizState.tempsRestant = TEMPS_PAR_QUESTION;

    const tEl = $('timer');
    if (tEl) tEl.textContent = `1:00`;

    QuizState.timerInterval = setInterval(() => {
        QuizState.tempsRestant--;
        if (tEl) {
            const m = Math.floor(QuizState.tempsRestant / 60);
            const s = (QuizState.tempsRestant % 60).toString().padStart(2, '0');
            tEl.textContent = `${m}:${s}`;
        }

        if (QuizState.tempsRestant <= 0) arreterTimer();
    }, 1000);
}

function arreterTimer() {
    if (QuizState.timerInterval) {
        clearInterval(QuizState.timerInterval);
        QuizState.timerInterval = null;
    }
}

function attacherListeners() {
    $('btn-next')?.addEventListener('click', questionSuivante);
    $('btn-indice1')?.addEventListener('click', afficherIndice1);
    $('btn-reponse')?.addEventListener('click', revelerReponse);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') questionSuivante();
        if (e.key === '1') afficherIndice1();
        if (e.key === ' ') { e.preventDefault(); revelerReponse(); }
    });
}

function show(id) {
    const el = $(id);
    if (el) el.hidden = false;
}

function hide(id) {
    const el = $(id);
    if (el) el.hidden = true;
}

/**
 * Init
 */
function init() {
    console.log('🎯 Init quiz.js');

    extraireParametresURL();

    if (!QuizState.partieId || !QuizState.pseudo) {
        afficherEcranErreur('Paramètres manquants');
        return;
    }

    initSocket();

    show('ecran-attente');
    hide('ecran-quiz');
    hide('ecran-resultats');
    hide('ecran-erreur');

    console.log('✅ Quiz prêt');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

window.QuizState = QuizState;