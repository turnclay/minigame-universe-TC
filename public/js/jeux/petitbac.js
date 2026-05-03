/**
 * ============================================
 * 📝 PETITBAC.JS — Jeu du Petit Bac (Hôte)
 * ============================================
 * Intègre la synchronisation multi-joueur via petitbac_hote.js.
 * Architecture identique aux autres jeux (quiz, justeprix…).
 */

import { GameState } from "../core/state.js";
import { modifierScore } from "../modules/scoreboard.js";

// ── Variables globales ───────────────────────────────────────
let timerInterval  = null;
let tempsRestant   = 120;
let lettreActuelle = "";
let reponses       = {};

const CATEGORIES = [
    { id: "prenom",     label: "Prénom",           icon: "👤" },
    { id: "ville",      label: "Ville",             icon: "🏙️" },
    { id: "pays",       label: "Pays",              icon: "🌍" },
    { id: "animal",     label: "Animal",            icon: "🐾" },
    { id: "fruit",      label: "Fruit / Légume",    icon: "🍎" },
    { id: "metier",     label: "Métier",            icon: "💼" },
    { id: "objet",      label: "Objet",             icon: "📦" },
    { id: "marque",     label: "Marque",            icon: "🏷️" },
    { id: "personnage", label: "Personnage fictif", icon: "🧚" },
    { id: "celebrite",  label: "Célébrité",         icon: "🌟" }
];

const LETTRES = "ABCDEFGHIJKLMNOPRSTUVW".split("");

// ── Stubs module hôte ────────────────────────────────────────
let _publierEtat                    = () => {};
let _publierManche                  = () => {};
let _publierPhase                   = () => {};
let _publierScores                  = () => {};
let _afficherReponsesInvitesSurHote = () => {};
let _viderReponses                  = () => {};
let _envoyerReponsesHote            = () => {};
let _declencherRevelation           = () => {};
let _injecterPanneauHote            = () => {};
let _hoteActif                      = false;

// ── Chargement dynamique module hôte ────────────────────────
async function chargerModuleHote() {
    try {
        const m = await import('../modules/petitbac_hote.js');
        _publierEtat                    = m.publierEtat;
        _publierManche                  = m.publierManche;
        _publierPhase                   = m.publierPhase;
        _publierScores                  = m.publierScores;
        _afficherReponsesInvitesSurHote = m.afficherReponsesInvitesSurHote;
        _viderReponses                  = m.viderReponses;
        _envoyerReponsesHote            = m.envoyerReponsesHote;
        _declencherRevelation           = m.declencherRevelation;
        _injecterPanneauHote            = m.injecterPanneauHote;
        _hoteActif = true;
        console.log('[PETITBAC] ✅ Module hôte chargé');
        return true;
    } catch (e) {
        console.warn('[PETITBAC] ⚠️ petitbac_hote.js introuvable — mode solo', e.message);
        return false;
    }
}

// ── Publication anticipée (appelée depuis main.js AVANT le countdown) ──────
// Permet aux invités de recevoir la lettre dès que l'hôte clique Commencer,
// sans attendre la fin du countdown hôte (3s).
async function _prepublierPetitBac() {
    if (!_hoteActif) await chargerModuleHote();
    if (!_hoteActif) return;
    if (!lettreActuelle) {
        lettreActuelle = "ABCDEFGHIJKLMNOPRSTUVW"[Math.floor(Math.random() * 22)];
        console.log('[PETITBAC] 📡 Pré-publication lettre:', lettreActuelle);
    }
    _publierEtat('en_cours');
    _publierScores();
    _publierManche({ lettre: lettreActuelle, categories: CATEGORIES });
}
window._petitbacPublierManche = _prepublierPetitBac;

// ── Initialisation ───────────────────────────────────────────
async function initialiserPetitBac() {
    console.log("[PETITBAC] Initialisation du jeu");
    await chargerModuleHote();

    resetJeu();
    // Réutiliser la lettre pré-publiée si déjà tirée, sinon en tirer une nouvelle
    if (!lettreActuelle) tirerLettre();
    else {
        const el = document.getElementById("petitbac-lettre-actuelle");
        if (el) {
            el.textContent = lettreActuelle;
            el.style.animation = "none";
            setTimeout(() => { el.style.animation = "bounceIn 0.6s ease-out"; }, 10);
        }
    }
    afficherCategories();
    demarrerTimer();
    configurerBoutonValidation();

    if (_hoteActif) {
        _publierEtat('en_cours');
        _publierScores();
        _publierManche({ lettre: lettreActuelle, categories: CATEGORIES });
        _injecterPanneauHote();

        // Re-pub pour invités en retard
        const pid = localStorage.getItem('minigame_partie_session_id');
        let _dernierTs = 0;
        setInterval(() => {
            try {
                const raw = localStorage.getItem(`partie_demande_etat_${pid}`);
                if (!raw) return;
                const data = JSON.parse(raw);
                if (data.ts <= _dernierTs) return;
                _dernierTs = data.ts;
                _publierEtat('en_cours');
                _publierScores();
                _publierManche({ lettre: lettreActuelle, categories: CATEGORIES });
            } catch {}
        }, 800);
    }
}

window.initialiserPetitBac = initialiserPetitBac;

// ── Reset ─────────────────────────────────────────────────────
function resetJeu() {
    tempsRestant  = 120;
    lettreActuelle = "";
    reponses       = {};
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    const t = document.getElementById("petitbac-timer");
    if (t) { t.textContent = "02:00"; t.classList.remove("clignote"); }
}

// ── Tirer une lettre ─────────────────────────────────────────
function tirerLettre() {
    lettreActuelle = LETTRES[Math.floor(Math.random() * LETTRES.length)];
    const el = document.getElementById("petitbac-lettre-actuelle");
    if (el) {
        el.textContent = lettreActuelle;
        el.style.animation = "none";
        setTimeout(() => { el.style.animation = "bounceIn 0.6s ease-out"; }, 10);
    }
    console.log("[PETITBAC] Lettre tirée:", lettreActuelle);
}

// ── Afficher catégories ───────────────────────────────────────
function afficherCategories() {
    const container = document.getElementById("petitbac-categories");
    if (!container) return;
    container.innerHTML = "";
    CATEGORIES.forEach(cat => {
        const card = document.createElement("div");
        card.className = "petitbac-categorie-card";
        card.innerHTML = `
            <div class="categorie-header">
                <span class="categorie-icon">${cat.icon}</span>
                <h3 class="categorie-label">${cat.label}</h3>
            </div>
            <input type="text" id="input-${cat.id}" class="petitbac-input"
                placeholder="Votre réponse…" maxlength="30" autocomplete="off">
            <div class="validation-feedback" id="feedback-${cat.id}"></div>`;
        container.appendChild(card);
        const input = document.getElementById(`input-${cat.id}`);
        if (input) {
            input.addEventListener("input", (e) => {
                if (e.target.value.length === 1) e.target.value = e.target.value.toUpperCase();
            });
        }
    });
}

// ── Timer ─────────────────────────────────────────────────────
function demarrerTimer() {
    const t = document.getElementById("petitbac-timer");
    timerInterval = setInterval(() => {
        tempsRestant--;
        const m = String(Math.floor(tempsRestant / 60)).padStart(2, '0');
        const s = String(tempsRestant % 60).padStart(2, '0');
        if (t) t.textContent = `${m}:${s}`;
        if (tempsRestant === 30 && t) t.classList.add("clignote");
        if (tempsRestant <= 0) finPartieAutomatique();
    }, 1000);
}

// ── Validation ───────────────────────────────────────────────
function configurerBoutonValidation() {
    const btn = document.getElementById("petitbac-valider");
    if (btn) btn.onclick = () => validerReponses();
}

function validerReponses() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    let score = 0;
    reponses  = {};

    CATEGORIES.forEach(cat => {
        const input    = document.getElementById(`input-${cat.id}`);
        const feedback = document.getElementById(`feedback-${cat.id}`);
        if (!input || !feedback) return;
        const valeur = input.value.trim();
        reponses[cat.id] = valeur;

        if (valeur === "") {
            feedback.innerHTML = '<span class="feedback-vide">❌ Vide</span>';
            feedback.className = "validation-feedback vide";
        } else if (valeur.charAt(0).toUpperCase() !== lettreActuelle) {
            feedback.innerHTML = `<span class="feedback-invalide">❌ Ne commence pas par ${lettreActuelle}</span>`;
            feedback.className = "validation-feedback invalide";
        } else {
            score++;
            feedback.innerHTML = '<span class="feedback-valide">✅ Valide (+1 pt)</span>';
            feedback.className = "validation-feedback valide";
        }
        input.disabled = true;
    });

    if (_hoteActif) {
        _envoyerReponsesHote({ reponses, score });
        _publierPhase('resultats');
        // Activer le bouton "Afficher résultats"
        const btnRes = document.getElementById('pb-btn-resultats');
        if (btnRes) {
            btnRes.onclick = () => {
                _declencherRevelation(lettreActuelle);
                _afficherPanneauResultatsHote();
            };
        }
    }

    afficherResultat(score);
    enregistrerScore(score);
}

function _afficherPanneauResultatsHote() {
    const container = document.getElementById('pb-invites-reponses');
    if (!container) return;
    try {
        const pid = localStorage.getItem('minigame_partie_session_id');
        const raw = localStorage.getItem(`partie_reponses_${pid}`);
        if (!raw) return;
        const reps = JSON.parse(raw);
        const hote = GameState?.joueurs?.[0] || '';
        container.innerHTML = Object.entries(reps)
            .sort((a, b) => (b[1].score || 0) - (a[1].score || 0))
            .map(([pseudo, data]) => {
                const sc     = data.score || 0;
                const isHote = pseudo === hote;
                const bg     = sc > 0 ? 'rgba(34,197,94,.15)'   : 'rgba(255,255,255,.06)';
                const bd     = sc > 0 ? 'rgba(34,197,94,.35)'   : 'rgba(255,255,255,.12)';
                return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;
                    background:${bg};border:1px solid ${bd};border-radius:10px;margin-bottom:6px;flex-wrap:wrap;">
                    <span style="font-weight:700;font-size:.85rem;color:${isHote?'#c4b5fd':'#a78bfa'};min-width:80px;">
                        ${isHote?'🎮 ':''}${escHtml(pseudo)}</span>
                    <span style="flex:1;font-size:.82rem;color:rgba(255,255,255,.6);">
                        ${sc} bonne${sc!==1?'s':''} réponse${sc!==1?'s':''}</span>
                    <span style="font-weight:700;font-size:.82rem;color:#86efac;">
                        +${sc} pt${sc!==1?'s':''} ✅</span>
                </div>`;
            }).join('');
    } catch {}
}

// ── Fin automatique ───────────────────────────────────────────
function finPartieAutomatique() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    validerReponses();
}

// ── Résultat + rejouer ────────────────────────────────────────
function afficherResultat(score) {
    const btn = document.getElementById("petitbac-valider");
    if (!btn) return;
    btn.textContent = `🎉 Score : ${score} pt${score!==1?'s':''} — Nouvelle lettre`;
    btn.className   = "btn-primary btn-rejouer";
    btn.onclick = () => {
        _viderReponses();
        resetJeu();
        tirerLettre();
        afficherCategories();
        demarrerTimer();
        btn.textContent = "Valider mes réponses";
        btn.className   = "btn-primary";
        btn.onclick     = () => validerReponses();
        if (_hoteActif) _publierManche({ lettre: lettreActuelle, categories: CATEGORIES });
    };
}

// ── Score ─────────────────────────────────────────────────────
function enregistrerScore(score) {
    let participant = null;
    if (GameState.mode === "solo" && GameState.joueurs?.length > 0) participant = GameState.joueurs[0];
    else if (GameState.mode === "team" && GameState.equipes?.length > 0) participant = GameState.equipes[0].nom;
    if (participant && score > 0) modifierScore(participant, score);
}

function escHtml(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export { initialiserPetitBac, resetJeu };