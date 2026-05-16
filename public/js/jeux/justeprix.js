// /js/jeux/justeprix.js
// ============================================================
// 💰 JUSTE PRIX — Module hôte
// Même architecture que quiz.js.
// ============================================================
import { $, show, hide } from "../core/dom.js";
import { GameState } from "../core/state.js";
import { ajouterPoints } from "../modules/scoreboard.js";

let jpProduits = [];
let jpOrdre    = [];
let jpIndex    = 0;
let timerJP    = null;
let tempsRestantJP = 60;

// Fonctions déléguées à justeprix_hote.js
let _publierEtat                     = () => {};
let _publierProduit                  = () => {};
let _publierScores                   = () => {};
let _afficherReponsesInvitesSurHote  = () => {};
let _viderReponses                   = () => {};
let _setProduitSuivantCallback       = () => {};
let _envoyerEstimationHote           = () => {};
let _declencherAfficherPrix          = () => {};
let _declencherRevelationAvecPrix    = () => {};

// ======================================================
// 📡 CHARGEMENT DYNAMIQUE DE JUSTEPRIX_HOTE
// ======================================================
async function chargerModuleHote() {
    try {
        const m = await import('../modules/justeprix_hote.js');
        _publierEtat                    = m.publierEtat;
        _publierProduit                 = m.publierProduit;
        _publierScores                  = m.publierScores;
        _afficherReponsesInvitesSurHote = m.afficherReponsesInvitesSurHote;
        _viderReponses                  = m.viderReponses;
        _setProduitSuivantCallback      = m.setProduitSuivantCallback;
        _envoyerEstimationHote          = m.envoyerEstimationHote          || (() => {});
        _declencherAfficherPrix         = m.declencherAfficherPrix         || (() => {});
        _declencherRevelationAvecPrix   = m.declencherRevelationAvecPrix   || (() => {});

        // Exposer sur window pour index.html
        window._jpEnvoyerEstimationHote = (v) => _envoyerEstimationHote(v);
        window._jpDeclencherAfficher    = ()  => _declencherAfficherPrix();
        window._jpNbJoueursInvites = () => Math.max(0, (GameState.joueurs || []).length - 1);
        window._jpValiderAvecPoints = (pts) => {
            if (pts > 0) {
                if (GameState.mode === 'solo') ajouterPoints(GameState.joueurs[0], pts);
                else ajouterPoints(GameState.equipes[0].nom, pts);
                _publierScores();
            }
        };

        console.log('[JP] ✅ Module hôte Juste Prix chargé');
        return true;
    } catch (e) {
        console.warn('[JP] ⚠️ justeprix_hote.js introuvable — mode solo', e.message);
        return false;
    }
}

// ── Outils ────────────────────────────────────────────────────
function melangerTableau(tab) {
    for (let i = tab.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tab[i], tab[j]] = [tab[j], tab[i]];
    }
    return tab;
}

function getProduitCourant() {
    return jpProduits[jpOrdre[jpIndex]];
}

// ── Timer ──────────────────────────────────────────────────────
function afficherTimerJP() {
    const t = $("jp-timer");
    if (!t) return;
    const m = String(Math.floor(tempsRestantJP / 60)).padStart(2, "0");
    const s = String(tempsRestantJP % 60).padStart(2, "0");
    t.textContent = `${m}:${s}`;
}

function demarrerTimerJP() {
    clearInterval(timerJP);
    tempsRestantJP = 60;
    const t = $("jp-timer");
    if (t) t.classList.remove("clignote");
    afficherTimerJP();

    timerJP = setInterval(() => {
        tempsRestantJP--;
        afficherTimerJP();
        if (tempsRestantJP <= 5 && tempsRestantJP > 0) {
            $("jp-timer")?.classList.add("clignote");
        }
        if (tempsRestantJP <= 0) {
            clearInterval(timerJP);
            $("jp-timer")?.classList.remove("clignote");
        }
    }, 1000);
}

// ── Afficher un produit ────────────────────────────────────────
function afficherProduit() {
    const p = getProduitCourant();
    if (!p) return;

    // Nom
    const nomEl = $("jp-produit-nom");
    if (nomEl) nomEl.textContent = p.Nom || '';

    // Description
    const descEl = $("jp-produit-description");
    if (descEl) descEl.textContent = p.Description || '';

    // Catégorie
    const catEl = $("jp-categorie");
    if (catEl) {
        catEl.textContent = p['Catégorie'] || '';
        catEl.style.animation = 'none';
        void catEl.offsetWidth;
        catEl.style.animation = 'bounceIn 0.8s ease-out';
    }

    // Image
    const imgEl = $("jp-produit-image");
    if (imgEl) {
        const src = (p.Image && p.Image.trim() !== '') ? p.Image : `images/produit_${p.ID}.jpg`;
        imgEl.src   = src;
        imgEl.alt   = p.Nom || 'Produit';
        imgEl.style.display = 'block';
    }

    // Lien Google Shopping
    const lienEl = $("jp-produit-lien");
    if (lienEl) {
        const q = encodeURIComponent(`${p.Marque || ''} ${p.Nom || ''} ${p.Description || ''}`.trim());
        lienEl.href = `https://www.google.com/search?tbm=shop&q=${q}`;
    }

    // Bouton prix — stocker le vrai prix mais ne pas l'afficher encore
    const prixEl = $("jp-produit-prix");
    if (prixEl) {
        prixEl.textContent = '👁️ Afficher le prix';
        prixEl._prix       = p.Prix || '';
        prixEl._revealed   = false;
    }

    // Réinitialiser champ + boutons hôte
    _resetBoutonsUI();

    demarrerTimerJP();

    // Publier aux invités — résoudre l'URL image en absolu
    // pour que jeu.html puisse l'afficher quel que soit son emplacement
    const srcImg = (p.Image && p.Image.trim()) ? p.Image.trim() : `images/produit_${p.ID}.jpg`;
    const baseUrl = window.location.origin + window.location.pathname.replace(/\/[^\/]*$/, '');
    const srcAbsolu = srcImg.startsWith('http') ? srcImg : `${baseUrl}/${srcImg.replace(/^\//, '')}`;
    p._imageSrcResolu = srcAbsolu;
    _publierProduit(p);
    _viderReponses();

    // Mettre à jour le panneau après 500ms
    setTimeout(() => _afficherReponsesInvitesSurHote('jp-invites-reponses'), 500);
}

function _resetBoutonsUI() {
    const btnEnvoyer = document.getElementById('jp-btn-envoyer-hote');
    if (btnEnvoyer) {
        btnEnvoyer.disabled      = false;
        btnEnvoyer._sent         = false;
        btnEnvoyer.style.opacity = '';
        btnEnvoyer.textContent   = '✅ Envoyer mon estimation';
    }
    const input = document.getElementById('jp-input-hote');
    if (input) { input.value = ''; input.disabled = false; }

    const btnAfficher = document.getElementById('jp-btn-afficher-prix');
    if (btnAfficher) {
        btnAfficher.disabled        = true;
        btnAfficher.style.opacity   = '0.4';
        btnAfficher.style.cursor    = 'not-allowed';
        btnAfficher.title           = 'En attente des estimations de tous les joueurs…';
        btnAfficher.style.animation = '';
    }
}

// ── Navigation ─────────────────────────────────────────────────
function produitSuivant() {
    jpIndex = (jpIndex + 1) % jpOrdre.length;
    afficherProduit();
}

function produitPrecedent() {
    jpIndex = (jpIndex - 1 + jpOrdre.length) % jpOrdre.length;
    afficherProduit();
}

// ── Panneau invités injecté dans la section ────────────────────
function injecterPanneauInvites() {
    if (document.getElementById('panneau-invites-jp')) return;
    const section = $("justeprix");
    if (!section) return;

    // Déplacer les boutons Lien et Produit suivant APRÈS le panneau
    // pour le layout : lien bas-gauche, suivant bas-droite
    const btnLien    = document.getElementById('jp-produit-lien');
    const btnSuivant = document.getElementById('btn-next-jp');

    const panneau = document.createElement('div');
    panneau.id = 'panneau-invites-jp';
    panneau.style.cssText = `
        margin-top:20px;background:rgba(251,191,36,0.06);
        border:1px solid rgba(251,191,36,0.25);border-radius:14px;padding:14px 16px;
    `;
    panneau.innerHTML = `
        <div style="font-size:.78rem;text-transform:uppercase;letter-spacing:.1em;
            color:rgba(251,191,36,.8);margin-bottom:10px;font-weight:700;">
            💰 Estimations des joueurs
        </div>
        <div id="jp-invites-reponses">
            <p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">Aucune estimation pour l'instant</p>
        </div>
    `;
    section.appendChild(panneau);

    // Barre boutons bas : lien gauche | suivant droite
    const barresBas = document.createElement('div');
    barresBas.id = 'jp-barre-bas';
    barresBas.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-top:12px;gap:10px;';
    if (btnLien)    barresBas.appendChild(btnLien);
    if (btnSuivant) barresBas.appendChild(btnSuivant);
    section.appendChild(barresBas);

    setInterval(() => _afficherReponsesInvitesSurHote('jp-invites-reponses'), 2000);
}

// ── Attacher les listeners hôte ────────────────────────────────
function attacherListenersJP() {
    // Navigation produits
    ["btn-next-jp", "jp-btn-next"].forEach(id => {
        const el = $(id);
        if (el) el.onclick = produitSuivant;
    });
    const prev = $("jp-btn-prev");
    if (prev) prev.onclick = produitPrecedent;

    // Bouton "Afficher le prix" (hôte clique quand prêt)
    const btnPrix = $("jp-produit-prix");
    if (btnPrix) {
        btnPrix.onclick = () => {
            if (btnPrix._revealed) return;
            const prix = btnPrix._prix || '';
            if (!prix) return;
            btnPrix._revealed  = true;
            btnPrix.textContent = prix;
            // Déclencher la révélation avec ce prix
            _declencherRevelationAvecPrix(prix);
        };
    }
}

// ── Initialisation principale ──────────────────────────────────
async function initialiserJustePrix() {
    const hoteActif = await chargerModuleHote();

    if (hoteActif) {
        const pid = localStorage.getItem('minigame_partie_session_id');
        console.log('[JP] Partie — partieId =', pid);
        _publierEtat('en_cours');
        _publierScores();
        _setProduitSuivantCallback(produitSuivant);

        // Re-publication pour les invités en retard
        const cleDemandeEtat = `partie_demande_etat_${pid}`;
        let _dernierTs = 0;
        setInterval(() => {
            try {
                const raw = localStorage.getItem(cleDemandeEtat);
                if (!raw) return;
                const data = JSON.parse(raw);
                if (data.ts <= _dernierTs) return;
                _dernierTs = data.ts;
                _publierEtat('en_cours');
                _publierScores();
                const p = getProduitCourant();
                if (p) _publierProduit(p);
            } catch {}
        }, 800);
    }

    fetch("data/justeprix.json")
        .then(r => r.json())
        .then(data => {
            jpProduits = data;
            jpOrdre    = melangerTableau([...Array(jpProduits.length).keys()]);
            jpIndex    = 0;
            _viderReponses();
            afficherProduit();
            attacherListenersJP();
            if (hoteActif) injecterPanneauInvites();
        })
        .catch(err => {
            console.error("❌ justeprix.json :", err);
            alert("Impossible de charger les produits.");
        });
}

export { initialiserJustePrix };