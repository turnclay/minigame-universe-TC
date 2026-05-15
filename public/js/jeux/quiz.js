// ============================================================
// /js/jeux/quiz.js — v3.3 WS-server-driven (RENDER-SAFE & FIXED)
// ============================================================
// Déploiement Render : chemins absolus, imports robustes, gestion erreurs
// Corrections WS : vérifications connexion, try/catch, cohérence partieId
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
// 📡 CHARGEMENT DU MODULE HÔTE (robuste pour Render)
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

        if (typeof window !== 'undefined') {
            window._quizEnvoyerReponseHote   = rep => _envoyerReponseHote(rep);
            window._quizDeclencherAfficher   = ()  => _declencherAfficherReponse();
            window._quizDeclencherValidation = ()  => _declencherAfficherReponse();
        }

        console.log('[QUIZ] ✅ Module hôte chargé');
        return true;
    } catch (e) {
        console.warn('[QUIZ] ⚠️ quiz_hote.js indisponible :', e.message);
        console.error('[QUIZ] 📍 Stack:', e.stack);
        return false;
    }
}

// ======================================================
// 🖥️ HANDLERS ÉVÉNEMENTS WS SERVEUR
// ======================================================

function _onQuizQuestion(payload) {
    const { question, theme, posees, total, ts, hasIndice1, hasIndice2 } = payload;
    _questionEnCours = payload;

    try {
        _viderReponses();
    } catch (err) {
        console.warn('[QUIZ] ⚠️ Erreur _viderReponses:', err.message);
    }

    const tEl = $('theme-display');
    if (tEl) tEl.textContent = theme || '—';

    const qEl = $('question');
    if (qEl) qEl.textContent = question || '';

    const i1  = $('indice1');
    if (i1) i1.textContent = '';

    const i2  = $('indice2');
    if (i2) i2.textContent = '';

    const rp  = $('reponse');
    if (rp) rp.textContent = '';

    const inp = document.getElementById('quiz-reponse-input');
    if (inp) {
        inp.value = '';
        inp.disabled = false;
    }

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

    const b1 = $('btn-indice1');
    if (b1) b1.disabled = !hasIndice1;

    const b2 = $('btn-indice2');
    if (b2) b2.disabled = !hasIndice2;

    const vEl = document.getElementById('verif-resultat');
    if (vEl) vEl.hidden = true;

    _demarrerTimerVisuel(ts);

    setTimeout(() => {
        try {
            if (typeof _afficherReponsesInvitesSurHote === 'function') {
                _afficherReponsesInvitesSurHote('invites-reponses');
            }
        } catch (err) {
            console.warn('[QUIZ] ⚠️ Erreur affichage panneau:', err.message);
        }
    }, 500);

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
    const { reponse, posees, total, scores } = payload;
    const repEl = $('reponse');
    if (repEl && reponse) repEl.textContent = reponse;

    // Stocker la bonne réponse dans _questionEnCours pour quiz_hote.js
    if (_questionEnCours) {
        _questionEnCours.reponse         = reponse;
        _questionEnCours['Réponse']      = reponse;
    }

    // [FIX] Mise à jour des scores depuis QUIZ_CORRECTION si fournis
    if (scores && typeof scores === 'object') {
        GameState.scores = GameState.scores || {};
        Object.assign(GameState.scores, scores);
    }

    try {
        _publierScores();
    } catch (err) {
        console.warn('[QUIZ] ⚠️ Erreur publierScores:', err.message);
    }

    if (typeof window.afficherScoreboard === 'function') {
        try {
            window.afficherScoreboard();
        } catch (err) {
            console.warn('[QUIZ] ⚠️ Erreur afficherScoreboard:', err.message);
        }
    }

    console.log('[QUIZ] ✅ Correction Q' + posees + '/' + total + ': "' + reponse + '"');
}

function _onQuizEnd({ scores, total }) {
    _arreterTimerVisuel();

    try {
        _publierEtat('fin');
    } catch (err) {
        console.warn('[QUIZ] ⚠️ Erreur publierEtat:', err.message);
    }

    if (scores) {
        GameState.scores = GameState.scores || {};
        Object.assign(GameState.scores, scores);
        try {
            _publierScores();
        } catch (err) {
            console.warn('[QUIZ] ⚠️ Erreur publierScores fin:', err.message);
        }
    }

    if (typeof window.afficherScoreboard === 'function') {
        try {
            window.afficherScoreboard();
        } catch (err) {
            console.warn('[QUIZ] ⚠️ Erreur afficherScoreboard fin:', err.message);
        }
    }

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
    if (_timerLocal) {
        clearInterval(_timerLocal);
        _timerLocal = null;
    }
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

    setInterval(() => {
        try {
            if (typeof _afficherReponsesInvitesSurHote === 'function') {
                _afficherReponsesInvitesSurHote('invites-reponses');
            }
        } catch (err) {
            console.warn('[QUIZ] ⚠️ Erreur refresh panneau:', err.message);
        }
    }, 2000);
}

// ======================================================
// 🎧 LISTENERS HÔTE → commandes WS serveur
// ======================================================
function attacherListenersQuiz(socket) {

    // 🚀 BOUTON START — masqué
    const btnStart = document.getElementById('btn-start-solo');
    if (btnStart) btnStart.style.display = 'none';

    // 👉 Question suivante
    ['btn-next', 'btn-next-arrow'].forEach(id => {
        const el = $(id);
        if (el) {
            el.onclick = () => {
                try {
                    socket.send('HOST_ACTION', { action: 'quiz:next_question', data: {} });
                } catch (err) {
                    console.error('[QUIZ] ⚠️ Erreur send next_question:', err.message);
                }
            };
        }
    });

    // 👉 Bouton précédent désactivé
    const prev = $('btn-prev');
    if (prev) {
        prev.disabled = true;
        prev.style.opacity = '0.3';
    }

    // 👉 Indices
    const ind1 = $('btn-indice1');
    if (ind1) {
        ind1.onclick = () => {
            try {
                socket.send('HOST_ACTION', { action: 'quiz:reveal_indice', data: { num: 1 } });
            } catch (err) {
                console.error('[QUIZ] ⚠️ Erreur send indice1:', err.message);
            }
        };
    }

    const ind2 = $('btn-indice2');
    if (ind2) {
        ind2.onclick = () => {
            try {
                socket.send('HOST_ACTION', { action: 'quiz:reveal_indice', data: { num: 2 } });
            } catch (err) {
                console.error('[QUIZ] ⚠️ Erreur send indice2:', err.message);
            }
        };
    }

    // 👉 Révélation
    const btnAff = document.getElementById('btn-afficher-reponse');
    if (btnAff) {
        btnAff.onclick = () => {
            try {
                _declencherAfficherReponse();
            } catch (err) {
                console.error('[QUIZ] ⚠️ Erreur declencherAfficherReponse:', err.message);
            }
        };
    }

    // 👉 Réponse hôte (gérée en local — pas de PLAYER_ACTION WS)
    // NOTE : attacherListenersQuiz est appelé APRÈS chargerModuleHote,
    // donc _envoyerReponseHote est déjà la vraie fonction ici.
    const btnEnv = document.getElementById('btn-valider-reponse');
    if (btnEnv) {
        btnEnv.onclick = () => {
            try {
                if (btnEnv._sent) return;
                const inp = document.getElementById('quiz-reponse-input');
                const rep = inp ? inp.value.trim() : '';
                if (!rep) return;
                window._quizReponseSaisieHote = rep;
                // Appel via la variable module (déjà chargée à ce stade)
                _envoyerReponseHote(rep);
                console.log('[QUIZ] 📨 Réponse hôte envoyée:', rep);
            } catch (err) {
                console.error('[QUIZ] ⚠️ Erreur envoi réponse hôte:', err.message);
            }
        };
    }
}


// ======================================================
// 📡 ABONNEMENTS ÉVÉNEMENTS SERVEUR (côté hôte)
// ======================================================
function abonnerEvenementsServeur(socket) {

    socket.on('QUIZ_READY', ({ total, message }) => {
        try {
            console.log('[QUIZ] 📚 ' + (message || total + ' questions chargées'));
            const btnStart = document.getElementById('btn-start-solo');
            if (btnStart) btnStart.style.display = 'none';
        } catch (err) {
            console.warn('[QUIZ] ⚠️ Erreur QUIZ_READY:', err.message);
        }
    });

    socket.on('QUIZ_QUESTION',   payload => {
        try {
            _onQuizQuestion(payload);
        } catch (err) {
            console.warn('[QUIZ] ⚠️ Erreur QUIZ_QUESTION:', err.message);
        }
    });

    socket.on('QUIZ_CORRECTION', payload => {
        try {
            _onQuizCorrection(payload);
        } catch (err) {
            console.warn('[QUIZ] ⚠️ Erreur QUIZ_CORRECTION:', err.message);
        }
    });

    socket.on('QUIZ_END', payload => {
        try {
            _onQuizEnd(payload);
        } catch (err) {
            console.warn('[QUIZ] ⚠️ Erreur QUIZ_END:', err.message);
        }
    });

    socket.on('QUIZ_INDICE', ({ num, texte }) => {
        try {
            const el = $('indice' + num);
            if (el) el.textContent = texte;
        } catch (err) {
            console.warn('[QUIZ] ⚠️ Erreur QUIZ_INDICE:', err.message);
        }
    });

    // Timer écoulé côté serveur
    socket.on('QUIZ_TIMER_EXPIRED', ({ nbReponses, nbJoueurs }) => {
        try {
            console.log('[QUIZ] ⏱ Timer expiré — nbReponses=' + nbReponses + ', nbJoueurs=' + nbJoueurs);
            _activerBoutonAfficherReponse();
        } catch (err) {
            console.warn('[QUIZ] ⚠️ Erreur QUIZ_TIMER_EXPIRED:', err.message);
        }
    });

    socket.on('SCORES_UPDATE', ({ scores }) => {
        try {
            if (scores) {
                GameState.scores = GameState.scores || {};
                Object.assign(GameState.scores, scores);
            }
            _publierScores();
            if (typeof window.afficherScoreboard === 'function')
                window.afficherScoreboard();
        } catch (err) {
            console.warn('[QUIZ] ⚠️ Erreur SCORES_UPDATE:', err.message);
        }
    });

    // Serveur confirme que la révélation est faite
    socket.on('QUIZ_CAN_NEXT', ({ posees, total, remaining, scores }) => {
        try {
            console.log('[QUIZ] ✅ QUIZ_CAN_NEXT — Q' + posees + '/' + total + ' — remaining:' + remaining);

            // [FIX] Mise à jour des scores depuis QUIZ_CAN_NEXT
            if (scores && typeof scores === 'object') {
                GameState.scores = GameState.scores || {};
                Object.assign(GameState.scores, scores);
            }

            const btnNext = $('btn-next');
            if (btnNext) {
                btnNext.disabled       = false;
                btnNext.style.opacity  = '1';
                btnNext.style.cursor   = 'pointer';
                btnNext.title          = remaining > 0
                    ? 'Passer à la question suivante (' + remaining + ' restante' + (remaining > 1 ? 's' : '') + ')'
                    : 'Terminer le quiz';
                btnNext.style.animation = 'btnPulse .4s ease';
                setTimeout(() => { if (btnNext) btnNext.style.animation = ''; }, 450);
            }

            const btnAff = document.getElementById('btn-afficher-reponse');
            if (btnAff) {
                btnAff.disabled        = true;
                btnAff.style.opacity   = '0.3';
                btnAff.style.cursor    = 'not-allowed';
                btnAff.style.animation = '';
                btnAff.title           = 'Réponse révélée — cliquez sur Question suivante';
            }
        } catch (err) {
            console.warn('[QUIZ] ⚠️ Erreur QUIZ_CAN_NEXT:', err.message);
        }
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
    if (!document.getElementById('style-btn-pulse')) {
        const s = document.createElement('style');
        s.id = 'style-btn-pulse';
        s.textContent = '@keyframes btnPulse{0%{transform:scale(1)}100%{transform:scale(1.05)}}';
        document.head.appendChild(s);
    }
}


// ======================================================
// 📥 INITIALISATION PRINCIPALE
// ======================================================
async function initialiserQuiz() {
    const socket = window.jeuSocket;
    if (!socket) {
        console.error('[QUIZ] ❌ window.jeuSocket introuvable');
        return;
    }

    // S'abonner aux événements serveur EN PREMIER (sans await)
    abonnerEvenementsServeur(socket);

    // Désactiver btn-next par défaut
    const btnNext = $('btn-next');
    if (btnNext) {
        btnNext.disabled = true;
        btnNext.style.opacity = '0.4';
    }

    // Charger le module hôte AVANT d'attacher les listeners.
    // CRITIQUE : attacherListenersQuiz doit être appelé APRÈS chargerModuleHote
    // car le onclick de btn-valider-reponse appelle _envoyerReponseHote qui
    // est un stub vide jusqu'à ce que le module soit chargé.
    const hoteActif = await chargerModuleHote();

    // Attacher les listeners APRÈS le chargement du module
    attacherListenersQuiz(socket);

    if (hoteActif) {
        try {
            _publierEtat('en_cours');
            _publierScores();
        } catch (err) {
            console.warn('[QUIZ] ⚠️ Erreur init scores:', err.message);
        }
    }

    // Charger questions.json depuis /public/ (fichier statique, toujours disponible)
    try {
        const res = await fetch('/data/questions.json');
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        const raw = await res.text();
        // Nettoyer les caractères de contrôle invalides avant parsing
        const propre = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
        const questions = JSON.parse(propre);
        if (!Array.isArray(questions) || questions.length === 0) {
            throw new Error('questions.json vide ou invalide');
        }

        // Mélanger côté client
        const ordre = [...Array(questions.length).keys()];
        for (let i = ordre.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [ordre[i], ordre[j]] = [ordre[j], ordre[i]];
        }
        const qMelangees = ordre.map(i => questions[i]);

        // Envoyer au serveur
        socket.send('HOST_ACTION', { action: 'quiz:load', data: { questions: qMelangees } });
        console.log('[QUIZ] 📡 ' + qMelangees.length + ' questions envoyées au serveur');

        if (hoteActif) injecterPanneauInvites();

    } catch (err) {
        console.error('[QUIZ] ❌ questions.json :', err.message);
        alert('Impossible de charger les questions. Vérifiez la connexion.');
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

window._quizGetReponseHoteSaisie = function () {
    return window._quizReponseSaisieHote || '';
};

window._quizNbJoueursInvites = function () {
    try {
        const snap = window.HostSession?._snapshot;
        if (snap && snap.joueurs && snap.joueurs.length > 0) return snap.joueurs.length;
        return Math.max(0, (GameState.joueurs || []).length - 1);
    } catch (err) {
        console.warn('[QUIZ] ⚠️ Erreur _quizNbJoueursInvites:', err.message);
        return 0;
    }
};

window._quizValiderAvecPoints = function (correct, points) {
    try {
        if (correct && points > 0) {
            const p = GameState.mode === 'solo' ? GameState.joueurs[0] : GameState.equipes?.[0]?.nom;
            if (p) {
                ajouterPoints(p, points);
                _publierScores();
            }
        }
    } catch (err) {
        console.warn('[QUIZ] ⚠️ Erreur _quizValiderAvecPoints:', err.message);
    }
};
