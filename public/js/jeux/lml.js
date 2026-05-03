// /js/jeux/lml.js — Le Mot le Plus Long (côté hôte, logique multijoueur)
// Tous les joueurs (hôte + invités) jouent les mêmes lettres en parallèle.
// L'hôte choisit les lettres → chacun propose son mot → révélation groupée.
import { $ } from '../core/dom.js';
import { GameState } from '../core/state.js';
import { ajouterPoints } from '../modules/scoreboard.js';

const VOYELLES  = ['A','E','I','O','U','Y'];
const CONSONNES = 'BCDFGHJKLMNPQRSTVWXZ'.split('');

let lettresLML      = [];
let timerLML        = null;
let tempsRestantLML = 60;
let lexique         = new Set();
let hoteActif       = false;

let _publierEtat   = () => {};
let _publierManche = () => {};
let _publierScores = () => {};
let _afficherReps  = () => {};
let _viderReponses = () => {};
let _envoyerMot    = () => {};
let _declencherRev = () => {};

async function chargerModuleHote() {
    try {
        const m = await import('../modules/lml_hote.js');
        _publierEtat   = m.publierEtat;
        _publierManche = m.publierManche;
        _publierScores = m.publierScores;
        _afficherReps  = m.afficherReponsesInvitesSurHote;
        _viderReponses = m.viderReponses;
        _envoyerMot    = m.envoyerMotHote    || (() => {});
        _declencherRev = m.declencherRevelation || (() => {});

        window._lmlEnvoyerMotHote     = (mot) => _envoyerMot(mot);
        window._lmlDeclencherAfficher = ()    => _declencherRev(lexique, lettresLML);
        window._lmlNbInvites          = ()    => Math.max(0, (GameState.joueurs || []).length - 1);
        window._lmlValiderAvecPoints  = (pts) => {
            if (pts > 0) {
                const c = GameState.mode === 'solo'
                    ? GameState.joueurs[0]
                    : GameState.equipes[0]?.nom;
                if (c) { ajouterPoints(c, pts); _publierScores(); }
            }
        };

        console.log('[LML] ✅ Module hôte chargé');
        return true;
    } catch (e) {
        console.warn('[LML] ⚠️ lml_hote.js introuvable', e.message);
        return false;
    }
}

// Lexique : non bloquant, fire & forget
function chargerLexiqueAsync() {
    if (lexique.size > 0) return;
    fetch('data/Lexique383.tsv')
        .then(r => r.text())
        .then(t => {
            t.split('\n').slice(1).forEach(l => {
                const m = l.split('\t')[0]?.trim().toUpperCase();
                if (m && m.length >= 2) lexique.add(m);
            });
            console.log('[LML] 📚 Lexique :', lexique.size, 'mots');
        })
        .catch(() => console.warn('[LML] Lexique indisponible — validation par lettres seule'));
}

function formatTime(s) {
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

function genererLettres() {
    lettresLML = [];
    for (let i = 0; i < 3; i++) lettresLML.push(VOYELLES[Math.floor(Math.random() * VOYELLES.length)]);
    for (let i = 0; i < 7; i++) lettresLML.push(CONSONNES[Math.floor(Math.random() * CONSONNES.length)]);
    lettresLML.sort(() => Math.random() - .5);
}

function afficherLettresHote() {
    const z = $('lml-lettres'); if (!z) return;
    z.innerHTML = lettresLML.map((l, i) =>
        `<span class="lettre" data-index="${i}" style="animation-delay:${i * .07}s">${l}</span>`
    ).join('');
    z.querySelectorAll('.lettre').forEach(el => {
        el.addEventListener('click', () => {
            if (el.classList.contains('utilisee')) return;
            const inp = $('lml-input');
            if (inp && !inp.disabled && inp.value.length < 10) {
                inp.value += el.textContent.trim();
                el.classList.add('utilisee');
            }
        });
    });
}

function demarrerTimer() {
    clearInterval(timerLML);
    tempsRestantLML = 60;
    const t = $('lml-timer');
    if (t) { t.textContent = formatTime(60); t.classList.remove('clignote'); }

    timerLML = setInterval(() => {
        tempsRestantLML--;
        if (t) {
            t.textContent = formatTime(tempsRestantLML);
            if (tempsRestantLML <= 10 && tempsRestantLML > 0) t.classList.add('clignote');
        }
        if (tempsRestantLML <= 0) {
            clearInterval(timerLML);
            if (t) { t.textContent = '00:00'; t.classList.remove('clignote'); }
            // Timer écoulé : si l'hôte n'a pas encore envoyé, envoyer mot vide
            const inp = $('lml-input');
            const btnEnv = document.getElementById('lml-btn-envoyer-hote');
            if (btnEnv && !btnEnv._sent) {
                const mot = inp ? inp.value.toUpperCase().trim() : '';
                _envoyerMot(mot || '');
                if (btnEnv) { btnEnv.disabled = true; btnEnv._sent = true; btnEnv.style.opacity = '0.45'; }
                if (inp) inp.disabled = true;
            }
        }
    }, 1000);
}

function nouvelleManche() {
    genererLettres();
    afficherLettresHote();
    _resetUI();
    _viderReponses();
    _publierManche(lettresLML);
    demarrerTimer();
    setTimeout(() => _afficherReps('lml-invites-reponses'), 500);
}

function _resetUI() {
    const inp = $('lml-input'); if (inp) { inp.value = ''; inp.disabled = false; }
    const res = $('lml-resultat'); if (res) res.textContent = '';
    $('lml-lettres')?.querySelectorAll('.lettre').forEach(e => e.classList.remove('utilisee'));

    const be = document.getElementById('lml-btn-envoyer-hote');
    if (be) { be.disabled = false; be._sent = false; be.style.opacity = ''; be.textContent = '✅ Envoyer mon mot'; }

    const ba = document.getElementById('lml-btn-afficher');
    if (ba) { ba.disabled = true; ba.style.opacity = '0.4'; ba.style.cursor = 'not-allowed'; ba.style.animation = ''; ba.title = 'En attente des mots de tous les joueurs…'; }

    const reps = document.getElementById('lml-invites-reponses');
    if (reps) reps.innerHTML = '<p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">En attente des mots…</p>';
}

function injecterPanneauInvites() {
    if (document.getElementById('panneau-invites-lml')) return;
    const section = $('lml'); if (!section) return;
    const p = document.createElement('div');
    p.id = 'panneau-invites-lml';
    p.style.cssText = 'margin-top:16px;background:rgba(167,139,250,.06);border:1px solid rgba(167,139,250,.25);border-radius:14px;padding:14px 16px;';
    p.innerHTML = '<div style="font-size:.78rem;text-transform:uppercase;letter-spacing:.1em;color:rgba(167,139,250,.8);margin-bottom:10px;font-weight:700;">📝 Mots des joueurs</div>'
        + '<div id="lml-invites-reponses"><p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">En attente des mots…</p></div>';
    section.appendChild(p);
    setInterval(() => _afficherReps('lml-invites-reponses'), 2000);
}

// ── Injecter le bouton "Envoyer mon mot" et "Afficher les résultats" dans le HTML ──
function injecterBoutons() {
    const section = $('lml'); if (!section) return;

    // Vérifier si les boutons existent déjà dans le HTML
    if (document.getElementById('lml-btn-envoyer-hote') && document.getElementById('lml-btn-afficher')) return;

    const wrap = document.createElement('div');
    wrap.id = 'lml-actions-hote';
    wrap.style.cssText = 'display:flex;gap:10px;margin-top:10px;flex-wrap:wrap;';

    if (!document.getElementById('lml-btn-envoyer-hote')) {
        const btnEnv = document.createElement('button');
        btnEnv.id = 'lml-btn-envoyer-hote';
        btnEnv.style.cssText = [
            'flex:1;padding:12px;border-radius:12px;font-size:.9rem;font-weight:700;',
            'background:rgba(34,197,94,.2);border:1.5px solid rgba(34,197,94,.45);',
            'color:white;cursor:pointer;font-family:inherit;transition:opacity .2s;min-width:140px;'
        ].join('');
        btnEnv.textContent = '✅ Envoyer mon mot';
        btnEnv.addEventListener('click', () => {
            if (btnEnv._sent) return;
            const inp = $('lml-input');
            const mot = (inp ? inp.value : '').toUpperCase().trim();
            if (!mot) { return; }
            btnEnv._sent = true;
            btnEnv.disabled = true;
            btnEnv.style.opacity = '0.45';
            btnEnv.textContent = '⏳ Envoyé';
            if (inp) inp.disabled = true;
            _envoyerMot(mot);
        });
        wrap.appendChild(btnEnv);
    }

    if (!document.getElementById('lml-btn-afficher')) {
        const btnAff = document.createElement('button');
        btnAff.id = 'lml-btn-afficher';
        btnAff.style.cssText = [
            'flex:1;padding:12px;border-radius:12px;font-size:.9rem;font-weight:700;',
            'background:rgba(167,139,250,.18);border:1.5px solid rgba(167,139,250,.45);',
            'color:white;cursor:not-allowed;opacity:.4;font-family:inherit;',
            'transition:opacity .2s,transform .15s;min-width:160px;'
        ].join('');
        btnAff.textContent = '📊 Afficher les résultats';
        btnAff.disabled    = true;
        btnAff.title       = 'En attente des mots de tous les joueurs…';
        btnAff.addEventListener('click', () => {
            if (btnAff.disabled) return;
            clearInterval(timerLML);
            btnAff.disabled      = true;
            btnAff.style.opacity = '0.45';
            _declencherRev(lexique, lettresLML);
        });
        wrap.appendChild(btnAff);
    }

    // Insérer après lml-input s'il existe, sinon en fin de section
    const inputEl = $('lml-input');
    const parent  = inputEl?.parentElement || section;
    if (inputEl?.parentElement) {
        inputEl.parentElement.insertAdjacentElement('afterend', wrap);
    } else {
        section.appendChild(wrap);
    }
}

function attacherListeners() {
    $('lml-rejouer')?.addEventListener('click', nouvelleManche);
    $('lml-melanger')?.addEventListener('click', () => {
        lettresLML.sort(() => Math.random() - .5);
        afficherLettresHote();
    });
    $('lml-input')?.addEventListener('keypress', e => {
        if (e.key === 'Enter') {
            const btnEnv = document.getElementById('lml-btn-envoyer-hote');
            if (btnEnv && !btnEnv._sent) btnEnv.click();
        }
    });
    $('lml-input')?.addEventListener('input', e => {
        e.target.value = e.target.value.toUpperCase();
    });
}

async function initialiserLML() {
    // ORDRE CRITIQUE : module hôte d'abord → publier état → nouvelle manche → lexique en fond
    hoteActif = await chargerModuleHote();

    if (hoteActif) {
        const pid = localStorage.getItem('minigame_partie_session_id');
        _publierEtat('en_cours');
        _publierScores();

        // Répondre aux demandes de re-sync des invités
        const cleD = 'partie_demande_etat_' + pid;
        let _tsVu  = 0;
        setInterval(() => {
            try {
                const raw = localStorage.getItem(cleD); if (!raw) return;
                const d   = JSON.parse(raw); if (d.ts <= _tsVu) return;
                _tsVu = d.ts;
                _publierEtat('en_cours');
                _publierScores();
                if (lettresLML.length > 0) _publierManche(lettresLML);
            } catch {}
        }, 800);
    }

    injecterBoutons();
    attacherListeners();
    nouvelleManche();
    if (hoteActif) injecterPanneauInvites();
    chargerLexiqueAsync();
}

window.initialiserLML = initialiserLML;