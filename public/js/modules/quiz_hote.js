// /js/modules/quiz_hote.js — v2.0 WebSocket
// ============================================================
// 📡 QUIZ_HOTE.JS — Synchronisation hôte ↔ serveur (Quiz)
// ============================================================
//
// MIGRATION v2.0 :
//   Canal localStorage → WebSocket natif (via window.jeuSocket)
//
// Interface exportée IDENTIQUE à v1.0 :
//   publierEtat(etat)
//   publierQuestion(questionObj, tempsRestant)
//   publierScores()
//   afficherReponsesInvitesSurHote(containerId)
//   viderReponses()
//   setQuestionSuivanteCallback(fn)
//   declencherAfficherReponse()
//   declencherValidationHote()             ← alias rétro-compat
//   envoyerReponseHote(rep)
//   lireReponsesInvites()
//   nettoyerPartieInvites()
//
// quiz.js n'est PAS modifié — il continue d'importer et
// d'appeler exactement les mêmes fonctions.
//
// Canaux de communication :
//   Sortant (hôte → serveur) :
//     HOST_ACTION  action:'quiz:next_question'  → serveur déclenche QUIZ_QUESTION
//     HOST_ACTION  action:'quiz:reveal'         → serveur déclenche QUIZ_CORRECTION
//     HOST_ACTION  action:'quiz:reveal_indice'  → serveur déclenche QUIZ_INDICE
//     PLAYER_ACTION action:'quiz:answer'        → réponse hôte (si hostJoue)
//
//   Entrant (serveur → hôte) :
//     QUIZ_RESPONSE_IN   { pseudo, nbReponses, nbJoueurs, allAnswered }
//     QUIZ_CORRECTION    { reponses, reponse, question, theme, ... }
//     SCORES_UPDATE      { scores }
//     PLAYER_JOINED      { pseudo, joueurs }
//     QUIZ_INDICE        { num, texte }
//     QUIZ_ANSWER_ACK    { status }
//
// Compatibilité locale (même appareil, WS absent) :
//   Si window.jeuSocket est absent ou déconnecté, fallback
//   transparent vers l'ancien canal localStorage.
// ============================================================

import { GameState } from '../core/state.js';

// ─────────────────────────────────────────────────────
// État interne
// ─────────────────────────────────────────────────────

let _questionSuivanteCallback = null;
let _validationEnCours        = false;
let _reponseHoteEnvoyee       = false;
let _reponsesRecues           = {};  // { pseudo: { reponse, ts } } — reçues du serveur
let _nbJoueursWS              = 0;   // nb joueurs connus via PLAYER_JOINED
let _questionCourante         = null;
let _wsListenersActifs        = false;

// ─────────────────────────────────────────────────────
// Accès au socket
// ─────────────────────────────────────────────────────

function _ws()        { return window.jeuSocket || null; }
function _wsOk()      { const s = _ws(); return !!(s && s.connected); }

// ─────────────────────────────────────────────────────
// Clés localStorage (fallback + compat scoreboard)
// ─────────────────────────────────────────────────────

function _pid()              { return localStorage.getItem('minigame_partie_session_id') || 'inconnu'; }
function _cleScores()        { return `partie_scores_${_pid()}`; }
function _cleReponses()      { return `partie_reponses_${_pid()}`; }
function _cleRevelation()    { return `partie_revelation_${_pid()}`; }
function _cleEtat()          { return `partie_etat_${_pid()}`; }
function _cleQuestion()      { return `partie_question_${_pid()}`; }

// ─────────────────────────────────────────────────────
// Pseudo hôte
// ─────────────────────────────────────────────────────

function _pseudoHote() {
    return (GameState?.joueurs?.[0]) || 'Hôte';
}

// ─────────────────────────────────────────────────────
// Initialisation des listeners WS entrants (une seule fois)
// ─────────────────────────────────────────────────────

function _initWsListeners() {
    if (_wsListenersActifs) return;
    const s = _ws();
    if (!s) return;
    _wsListenersActifs = true;

    // Réponse d'un joueur reçue par le serveur
    s.on('QUIZ_RESPONSE_IN', ({ pseudo, nbReponses, nbJoueurs, allAnswered }) => {
        if (!_reponsesRecues[pseudo]) {
            _reponsesRecues[pseudo] = { reponse: '…', ts: Date.now() };
        }
        if (nbJoueurs) _nbJoueursWS = nbJoueurs;
        _afficherPanneauAttenteWS();
        if (allAnswered) {
            _activerBoutonAfficher();
        } else {
            _mettreAJourBoutonAfficher(nbReponses, nbJoueurs);
        }
    });

    // Correction envoyée par le serveur après révélation
    s.on('QUIZ_CORRECTION', ({ reponses, reponse: bonneReponse }) => {
        _validationEnCours = false;
        const repEl = document.getElementById('reponse');
        if (repEl && bonneReponse) repEl.textContent = bonneReponse;
        _afficherPanneauResultats(reponses || [], bonneReponse || '');
        if (typeof window.afficherScoreboard === 'function') window.afficherScoreboard();
    });

    // Scores mis à jour après révélation
    s.on('SCORES_UPDATE', ({ scores }) => {
        if (scores) {
            GameState.scores = GameState.scores || {};
            Object.assign(GameState.scores, scores);
            localStorage.setItem(_cleScores(), JSON.stringify(scores));
        }
        if (typeof window.afficherScoreboard === 'function') window.afficherScoreboard();
    });

    // Nouveau joueur → mettre à jour le compteur attendu
    s.on('PLAYER_JOINED', ({ joueurs }) => {
        _nbJoueursWS = (joueurs || []).length;
    });

    // Indice broadcasté par le serveur
    s.on('QUIZ_INDICE', ({ num, texte }) => {
        const el = document.getElementById(`indice${num}`);
        if (el) el.textContent = texte;
    });

    // Ack réponse hôte
    s.on('QUIZ_ANSWER_ACK', ({ status }) => {
        if (status === 'ok') {
            const btn = document.getElementById('btn-valider-reponse');
            if (btn) { btn.disabled = true; btn.style.opacity = '0.45'; btn.textContent = '✅ Envoyé'; }
            const inp = document.getElementById('quiz-reponse-input');
            if (inp) inp.disabled = true;
        }
    });
}

// ─────────────────────────────────────────────────────
// Gestion des boutons hôte
// ─────────────────────────────────────────────────────

function _activerBoutonAfficher() {
    const btn = document.getElementById('btn-afficher-reponse');
    if (!btn) return;
    btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer';
    btn.title    = '✅ Tous ont répondu — Cliquez pour révéler';
    if (!document.getElementById('style-btn-pulse')) {
        const s = document.createElement('style');
        s.id = 'style-btn-pulse';
        s.textContent = '@keyframes btnPulse{0%{transform:scale(1)}50%{transform:scale(1.06)}100%{transform:scale(1)}}';
        document.head.appendChild(s);
    }
    btn.style.animation = 'btnPulse .5s ease';
}

function _mettreAJourBoutonAfficher(nbRecus, nbAttendu) {
    const btn = document.getElementById('btn-afficher-reponse');
    if (!btn) return;
    const reste = Math.max(0, (nbAttendu || 0) - (nbRecus || 0));
    btn.disabled = true; btn.style.opacity = '0.4'; btn.style.cursor = 'not-allowed';
    btn.title    = reste > 0 ? `En attente de ${reste} joueur${reste > 1 ? 's' : ''}…` : 'En attente…';
    btn.style.animation = '';
}

function _resetBoutonsHote() {
    const btnEnvoyer = document.getElementById('btn-valider-reponse');
    if (btnEnvoyer) {
        btnEnvoyer.disabled = false; btnEnvoyer._sent = false;
        btnEnvoyer.style.opacity = ''; btnEnvoyer.textContent = '✅ Envoyer';
    }
    const input = document.getElementById('quiz-reponse-input');
    if (input) { input.value = ''; input.disabled = false; }
    const btnAfficher = document.getElementById('btn-afficher-reponse');
    if (btnAfficher) {
        btnAfficher.disabled = true; btnAfficher.style.opacity = '0.4';
        btnAfficher.style.cursor = 'not-allowed';
        btnAfficher.title = 'En attente des réponses de tous les joueurs…';
        btnAfficher.style.animation = '';
    }
}

// ─────────────────────────────────────────────────────
// Panneau d'attente (avant révélation)
// ─────────────────────────────────────────────────────

function _afficherPanneauAttenteWS() {
    const container = document.getElementById('invites-reponses');
    if (!container || _validationEnCours) return;
    const pseudoHote = _pseudoHote();
    const entries    = Object.entries(_reponsesRecues);
    const nbAttendu  = _nbJoueursWS;

    if (entries.length === 0) {
        container.innerHTML = `<p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">En attente… (0 / ${nbAttendu || '?'})</p>`;
        return;
    }
    container.innerHTML = entries.map(([p]) => {
        const isHote = p === pseudoHote;
        return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;
            background:${isHote?'rgba(196,181,253,.07)':'rgba(0,212,255,.07)'};
            border:1px solid ${isHote?'rgba(196,181,253,.25)':'rgba(0,212,255,.2)'};
            border-radius:10px;margin-bottom:6px;">
            <span style="font-weight:700;font-size:.85rem;color:${isHote?'#c4b5fd':'#00d4ff'};min-width:80px;">
                ${isHote?'🎮 ':''}${_esc(p)}
            </span>
            <span style="flex:1;font-size:.82rem;color:rgba(255,255,255,.35);font-style:italic;">✅ a répondu</span>
        </div>`;
    }).join('') + `<p style="font-size:.78rem;color:rgba(255,255,255,.35);text-align:center;margin-top:6px;">
        ${entries.length} / ${nbAttendu || '?'} réponses
    </p>`;
}

// ─────────────────────────────────────────────────────
// Panneau de résultats (après révélation)
// ─────────────────────────────────────────────────────

function _afficherPanneauResultats(resultats, bonneReponse) {
    const container = document.getElementById('invites-reponses');
    if (!container) return;
    if (!resultats || resultats.length === 0) {
        container.innerHTML = '<p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">Aucune réponse reçue</p>';
        return;
    }
    const pseudoHote = _pseudoHote();
    container.innerHTML = resultats.map(({ pseudo, texte, reponse, correct, points, estPremier }) => {
        const rep    = texte || reponse || '';
        const bg     = correct ? 'rgba(34,197,94,.15)'  : 'rgba(239,68,68,.12)';
        const border = correct ? 'rgba(34,197,94,.35)'  : 'rgba(239,68,68,.25)';
        const isHote = pseudo === pseudoHote;
        const prem   = estPremier ? ' <span style="font-size:.75rem;color:#fbbf24;">🏆+1</span>' : '';
        const badge  = correct
            ? `<span style="color:#86efac;font-weight:700;font-size:.82rem;">+${points}pt${points!==1?'s':''} ✅${prem}</span>`
            : `<span style="color:#fca5a5;font-size:.82rem;">0pt ❌</span>`;
        return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;
            background:${bg};border:1px solid ${border};border-radius:10px;margin-bottom:6px;flex-wrap:wrap;">
            <span style="font-weight:700;font-size:.85rem;color:${isHote?'#c4b5fd':'#00d4ff'};min-width:80px;">
                ${isHote?'🎮 ':''}${_esc(pseudo)}
            </span>
            <span style="flex:1;font-size:.88rem;color:rgba(255,255,255,.85);font-style:italic;word-break:break-word;">"${_esc(rep)}"</span>
            ${badge}
        </div>`;
    }).join('') + (bonneReponse ? `
        <div style="margin-top:10px;padding:8px 12px;border-top:1px solid rgba(255,255,255,.1);
            font-size:.82rem;color:rgba(255,255,255,.5);text-align:center;">
            Réponse correcte : <strong style="color:#00d4ff;">${_esc(bonneReponse)}</strong>
        </div>` : '');
}

function _afficherNotifPremierCorrect(pseudo) {
    document.getElementById('notif-premier-correct')?.remove();
    const notif = document.createElement('div');
    notif.id = 'notif-premier-correct';
    notif.style.cssText = 'position:fixed;top:80px;left:50%;transform:translateX(-50%);background:rgba(34,197,94,.92);color:white;padding:12px 24px;border-radius:14px;font-size:1rem;font-weight:700;z-index:9999;';
    notif.textContent = `🏆 ${pseudo} a trouvé en premier ! +1pt bonus`;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 4000);
}

// ─────────────────────────────────────────────────────
// EXPORTS — interface identique à v1.0
// ─────────────────────────────────────────────────────

export function publierEtat(etat) {
    // Fallback localStorage (signal.js l'écoute)
    localStorage.setItem(_cleEtat(), etat);
}

export function publierQuestion(questionObj, tempsRestant = 60) {
    _questionCourante   = questionObj;
    _validationEnCours  = false;
    _reponseHoteEnvoyee = false;
    _reponsesRecues     = {};

    _initWsListeners();
    _resetBoutonsHote();

    if (_wsOk()) {
        _ws().send('HOST_ACTION', {
            action : 'quiz:next_question',
            data   : {
                question : questionObj['Question']  || questionObj.question  || '',
                theme    : questionObj['Thème']     || questionObj.theme     || '',
                indice1  : questionObj['Indice 1']  || questionObj.indice1   || '',
                indice2  : questionObj['Indice 2']  || questionObj.indice2   || '',
                reponse  : questionObj['Réponse']   || questionObj.reponse   || '',
                tempsRestant,
            },
        });
        console.log('[QUIZ_HOTE] 📡 quiz:next_question → serveur');
    } else {
        // Fallback localStorage
        const ts = Date.now();
        const payload = {
            id: ts,
            question       : questionObj['Question']  || questionObj.question  || '',
            theme          : questionObj['Thème']     || questionObj.theme     || '',
            indice1        : questionObj['Indice 1']  || questionObj.indice1   || '',
            indice2        : questionObj['Indice 2']  || questionObj.indice2   || '',
            reponse        : questionObj['Réponse']   || questionObj.reponse   || '',
            tempsRestant, indice1Visible: false, indice2Visible: false,
            tsIndice1: ts + (tempsRestant - 30) * 1000,
            tsIndice2: ts + (tempsRestant - 10) * 1000,
            ts,
        };
        localStorage.setItem(_cleQuestion(), JSON.stringify(payload));
        localStorage.removeItem(_cleRevelation());
        console.log('[QUIZ_HOTE] 📦 Question → localStorage (fallback)');
    }
}

export function publierScores() {
    localStorage.setItem(_cleScores(), JSON.stringify(GameState.scores || {}));
    if (typeof window.afficherScoreboard === 'function') window.afficherScoreboard();
}

export function afficherReponsesInvitesSurHote(containerId = 'invites-reponses') {
    if (_wsOk()) {
        _afficherPanneauAttenteWS();
    } else {
        // Fallback localStorage
        const container = document.getElementById(containerId);
        if (!container || _validationEnCours) return;
        try {
            const reponses  = JSON.parse(localStorage.getItem(_cleReponses()) || '{}');
            const pseudoHote = _pseudoHote();
            const entries   = Object.entries(reponses);
            if (entries.length === 0) {
                container.innerHTML = '<p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">En attente des réponses…</p>';
                return;
            }
            container.innerHTML = entries.map(([p]) => {
                const isHote = p === pseudoHote;
                return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;
                    background:${isHote?'rgba(196,181,253,.07)':'rgba(0,212,255,.07)'};
                    border:1px solid ${isHote?'rgba(196,181,253,.25)':'rgba(0,212,255,.2)'};
                    border-radius:10px;margin-bottom:6px;">
                    <span style="font-weight:700;font-size:.85rem;color:${isHote?'#c4b5fd':'#00d4ff'};min-width:80px;">
                        ${isHote?'🎮 ':''}${_esc(p)}
                    </span>
                    <span style="flex:1;font-size:.82rem;color:rgba(255,255,255,.35);font-style:italic;">✅ a répondu</span>
                </div>`;
            }).join('');
        } catch {}
    }
}

export function viderReponses() {
    _reponsesRecues = {};
    localStorage.removeItem(_cleReponses());
}

export function setQuestionSuivanteCallback(fn) {
    _questionSuivanteCallback = fn;
}

export function declencherAfficherReponse() {
    if (_validationEnCours) return;
    _validationEnCours = true;

    // Bloquer les boutons immédiatement (feedback UI)
    const btnEnvoyer  = document.getElementById('btn-valider-reponse');
    const btnAfficher = document.getElementById('btn-afficher-reponse');
    if (btnEnvoyer)  { btnEnvoyer.disabled  = true; btnEnvoyer.style.opacity  = '0.45'; }
    if (btnAfficher) { btnAfficher.disabled = true; btnAfficher.style.opacity = '0.45'; btnAfficher.style.animation = ''; }

    if (_wsOk()) {
        _ws().send('HOST_ACTION', { action: 'quiz:reveal', data: {} });
        console.log('[QUIZ_HOTE] 📡 quiz:reveal → serveur');
    } else {
        _declencharRevelationLocale('hote-afficher');
    }
}

export function declencherValidationHote() {
    declencherAfficherReponse();
}

export function envoyerReponseHote(rep) {
    if (!rep || _reponseHoteEnvoyee) return;
    _reponseHoteEnvoyee = true;
    const pseudo = _pseudoHote();
    console.log(`[QUIZ_HOTE] 📨 Réponse hôte: "${rep}"`);

    if (_wsOk()) {
        _ws().send('PLAYER_ACTION', { action: 'quiz:answer', data: { texte: rep } });
        _reponsesRecues[pseudo] = { reponse: rep, ts: Date.now() };
        _afficherPanneauAttenteWS();
    } else {
        const toutes = JSON.parse(localStorage.getItem(_cleReponses()) || '{}');
        toutes[pseudo] = { reponse: rep, ts: Date.now() };
        localStorage.setItem(_cleReponses(), JSON.stringify(toutes));
        afficherReponsesInvitesSurHote('invites-reponses');
    }
}

export function lireReponsesInvites() {
    if (_wsOk()) return { ..._reponsesRecues };
    try { return JSON.parse(localStorage.getItem(_cleReponses()) || '{}'); } catch { return {}; }
}

export function nettoyerPartieInvites() {
    _reponsesRecues      = {};
    _validationEnCours   = false;
    _reponseHoteEnvoyee  = false;
    _questionCourante    = null;
    _wsListenersActifs   = false;

    const pid = _pid();
    ['partie_question_', 'partie_reponses_', 'partie_validation_', 'partie_scores_',
     'partie_premier_correct_', 'partie_nav_', 'partie_revelation_']
        .forEach(k => localStorage.removeItem(k + pid));
    publierEtat('fin');

    if (_wsOk()) _ws().send('HOST_END_GAME', {});
}

// ─────────────────────────────────────────────────────
// FALLBACK — révélation locale (WS absent)
// Identique à quiz_hote.js v1.0
// ─────────────────────────────────────────────────────

function _declencharRevelationLocale(source) {
    console.log(`[QUIZ_HOTE] 🎯 Révélation locale (${source})`);

    let bonneReponse = '';
    if (typeof window._quizGetReponseCorrecte === 'function') bonneReponse = window._quizGetReponseCorrecte() || '';
    if (!bonneReponse) { try { bonneReponse = JSON.parse(localStorage.getItem(_cleQuestion())).reponse || ''; } catch {} }

    const repEl = document.getElementById('reponse');
    if (repEl && bonneReponse) repEl.textContent = bonneReponse;

    let tsI1 = Infinity, tsI2 = Infinity;
    try { const q = JSON.parse(localStorage.getItem(_cleQuestion())||'{}'); if (q.tsIndice1) tsI1 = q.tsIndice1; if (q.tsIndice2) tsI2 = q.tsIndice2; } catch {}

    const calcPts = (ok, ts) => { if (!ok) return 0; if (ts >= tsI2) return 1; if (ts >= tsI1) return 1; return 2; };
    const toutes  = lireReponsesInvites();
    const repTri  = Object.entries(toutes).sort((a, b) => (a[1].ts||0) - (b[1].ts||0));
    const resultats = [];
    let premierOk = null;

    repTri.forEach(([pseudo, data]) => {
        const rep     = String(data.reponse || '');
        const tsRep   = data.ts || Date.now();
        const correct = bonneReponse ? (_similarite(rep, bonneReponse) >= 0.85) : false;
        const points  = calcPts(correct, tsRep);
        resultats.push({ pseudo, reponse: rep, correct, points, estPremier: false });
        if (correct && points > 0) {
            const ph = _pseudoHote();
            if (pseudo === ph) { if (typeof window._quizValiderAvecPoints === 'function') window._quizValiderAvecPoints(true, points); }
            else { GameState.scores = GameState.scores||{}; GameState.scores[pseudo] = +((GameState.scores[pseudo]||0) + points).toFixed(2); }
            if (!premierOk) premierOk = pseudo;
        }
    });

    if (premierOk) {
        const res = resultats.find(r => r.pseudo === premierOk);
        if (res) { res.points = +(res.points + 1); res.estPremier = true; }
        const ph = _pseudoHote();
        if (premierOk === ph) { if (typeof window._quizValiderAvecPoints === 'function') window._quizValiderAvecPoints(true, 1); }
        else { GameState.scores[premierOk] = +((GameState.scores[premierOk]||0) + 1).toFixed(2); }
        _afficherNotifPremierCorrect(premierOk);
    }

    publierScores();
    localStorage.setItem(_cleRevelation(), JSON.stringify({
        bonneReponse, hote: _pseudoHote(),
        reponses: resultats.map(r => ({ pseudo: r.pseudo, reponse: r.reponse, correct: r.correct, points: r.points, estPremier: r.estPremier })),
        ts: Date.now(),
    }));
    _afficherPanneauResultats(resultats, bonneReponse);
    if (typeof window.afficherScoreboard === 'function') window.afficherScoreboard();
}

// ─────────────────────────────────────────────────────
// Algorithme de similarité (identique à v1.0)
// ─────────────────────────────────────────────────────

function _normaliser(s) { return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' ').trim(); }
function _bigrammes(s) { const n=_normaliser(s); const b=new Set(); for(let i=0;i<n.length-1;i++) b.add(n.slice(i,i+2)); return b; }
function _similarite(a,b) {
    if(!a||!b) return 0;
    if(_normaliser(a)===_normaliser(b)) return 1;
    const na=_normaliser(a),nb=_normaliser(b);
    if(nb.includes(na)||na.includes(nb)) return 0.9;
    const ba=_bigrammes(a),bb=_bigrammes(b);
    if(!ba.size||!bb.size) return 0;
    let i=0; ba.forEach(g=>{if(bb.has(g))i++;});
    return (2*i)/(ba.size+bb.size);
}
function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }