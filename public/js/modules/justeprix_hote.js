// /js/modules/justeprix_hote.js
// ============================================================
// 📡 JUSTEPRIX_HOTE.JS — Synchronisation hôte ↔ invités (Juste Prix)
// ============================================================
// Même architecture que quiz_hote.js.
// Clés localStorage :
//   partie_question_{id}   — produit courant (nom, image, description, catégorie)
//   partie_etat_{id}       — "attente" | "en_cours" | "fin"
//   partie_scores_{id}     — scores de tous les joueurs
//   partie_reponses_{id}   — estimations de TOUS (hôte inclus)
//   partie_revelation_{id} — signal révélation → jeu.html
//   partie_validation_{id} — résultat validation individuelle
//
// Règle de points :
//   • +3 pts au joueur le plus proche du vrai prix (tolérance ±10%)
//     avec bonus +1 s'il était le plus précis parmi tous
//   • +2 pts pour les autres dans la fourchette ±10%
//   • +1 pt pour ceux dans la fourchette ±25%
//   • 0 pt au-delà
// ============================================================

import { GameState } from '../core/state.js';

let timerSync           = null;
let _produitSuivantCb   = null;   // callback "Produit suivant" (hôte garde la main)
let _validationEnCours  = false;
let _reponseHoteEnvoyee = false;

// ── Clés localStorage ────────────────────────────────────────
function partieId() {
    const id = localStorage.getItem('minigame_partie_session_id');
    if (!id) console.warn('[JP_HOTE] ⚠️ minigame_partie_session_id introuvable !');
    return id || 'inconnu';
}
function cleQuestion()      { return `partie_question_${partieId()}`; }
function cleEtat()          { return `partie_etat_${partieId()}`; }
function cleScores()        { return `partie_scores_${partieId()}`; }
function cleReponses()      { return `partie_reponses_${partieId()}`; }
function cleValidation()    { return `partie_validation_${partieId()}`; }
function cleRevelation()    { return `partie_revelation_${partieId()}`; }

function _pseudoHote() {
    return (GameState?.joueurs?.[0]) || 'Hôte';
}

// ======================================================
// 📡 PUBLIER L'ÉTAT
// ======================================================
export function publierEtat(etat) {
    localStorage.setItem(cleEtat(), etat);
}

// ======================================================
// 📡 PUBLIER UN PRODUIT
// Stocke le produit courant pour les invités.
// ======================================================
export function publierProduit(produitObj) {
    _reponseHoteEnvoyee = false;

    const payload = {
        id:          produitObj.ID   || String(Date.now()),
        nom:         produitObj.Nom  || produitObj.nom  || '',
        description: produitObj.Description || produitObj.description || '',
        categorie:   produitObj['Catégorie'] || produitObj.categorie  || '',
        marque:      produitObj.Marque       || produitObj.marque      || '',
        // L'image et le PRIX ne sont PAS publiés immédiatement :
        // • L'image sera publiée par afficherImageProduit()
        // • Le PRIX ne sera révélé qu'à la révélation finale
        // imageSrc résolu en absolu par justeprix.js avant d'appeler publierProduit
        imageSrc:    produitObj._imageSrcResolu || produitObj.Image || '',
        ts: Date.now()
    };

    localStorage.setItem(cleQuestion(), JSON.stringify(payload));
    localStorage.removeItem(cleRevelation());
    _validationEnCours = false;

    _resetBoutonsHote();
    _demarrerEcouteReponsesInstantanee();
}

// ── Reset UI boutons hôte ─────────────────────────────────────
function _resetBoutonsHote() {
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

    // Masquer le prix révélé
    const prixEl = document.getElementById('jp-produit-prix');
    if (prixEl) {
        prixEl.textContent = '👁️ Afficher le prix';
        prixEl._revealed   = false;
    }
    // Supprimer le banner prix réel du produit précédent
    const bannerPrix = document.getElementById('jp-prix-reel-banner');
    if (bannerPrix) bannerPrix.remove();
}

// ── Écoute instantanée des réponses ──────────────────────────
let _storageListenerActif = false;
function _demarrerEcouteReponsesInstantanee() {
    if (_storageListenerActif) return;
    _storageListenerActif = true;

    window.addEventListener('storage', (e) => {
        if (_validationEnCours) return;
        if (e.key !== cleReponses()) return;
        afficherReponsesInvitesSurHote('jp-invites-reponses');
        _verifierSiTousOntRepondu();
    });
}

// ── Nombre de joueurs attendus ────────────────────────────────
function _getNbJoueursInvites() {
    if (typeof window._jpNbJoueursInvites === 'function') {
        const n = window._jpNbJoueursInvites();
        if (n > 0) return n;
    }
    const total = (GameState.joueurs || []).length;
    if (total > 1) return total - 1;
    const pid = localStorage.getItem('minigame_partie_session_id');
    if (pid) {
        try {
            const raw = localStorage.getItem(`invite_rejoint_${pid}`);
            if (raw) {
                const liste = JSON.parse(raw);
                if (Array.isArray(liste) && liste.length > 0) return liste.length;
            }
        } catch {}
    }
    return 0;
}
function _getNbJoueursTotal() {
    const n = _getNbJoueursInvites();
    return n > 0 ? n + 1 : 0;
}

// ======================================================
// 🔍 VÉRIFIER SI TOUS ONT RÉPONDU
// Active le bouton "Afficher le prix" si oui.
// ======================================================
function _verifierSiTousOntRepondu() {
    const nbAttendu = _getNbJoueursTotal();
    const reponses  = lireReponsesInvites();
    const nbRecus   = Object.keys(reponses).length;

    const btnAfficher = document.getElementById('jp-btn-afficher-prix');
    if (!btnAfficher) return;

    if (nbAttendu > 0 && nbRecus >= nbAttendu) {
        btnAfficher.disabled        = false;
        btnAfficher.style.opacity   = '1';
        btnAfficher.style.cursor    = 'pointer';
        btnAfficher.title           = '✅ Tous ont estimé — Cliquez pour révéler le prix';
        if (!document.getElementById('style-jp-pulse')) {
            const s = document.createElement('style');
            s.id = 'style-jp-pulse';
            s.textContent = `@keyframes jpPulse{0%{transform:scale(1)}50%{transform:scale(1.06)}100%{transform:scale(1)}}`;
            document.head.appendChild(s);
        }
        btnAfficher.style.animation = 'jpPulse .5s ease';
        console.log('[JP_HOTE] ✅ Tous ont répondu — btn Afficher activé');
    } else {
        const reste = Math.max(0, nbAttendu - nbRecus);
        btnAfficher.disabled        = true;
        btnAfficher.style.opacity   = '0.4';
        btnAfficher.style.cursor    = 'not-allowed';
        btnAfficher.title           = `En attente de ${reste} joueur${reste > 1 ? 's' : ''}…`;
        btnAfficher.style.animation = '';
    }
}

// ======================================================
// 📨 ENVOYER L'ESTIMATION DE L'HÔTE
// ======================================================
export function envoyerEstimationHote(valeur) {
    if (!valeur || _reponseHoteEnvoyee) return;
    _reponseHoteEnvoyee = true;

    const pseudo = _pseudoHote();
    const cleR   = cleReponses();
    const toutes = JSON.parse(localStorage.getItem(cleR) || '{}');
    toutes[pseudo] = { reponse: String(valeur), ts: Date.now() };
    localStorage.setItem(cleR, JSON.stringify(toutes));

    console.log(`[JP_HOTE] 📨 Estimation hôte (${pseudo}) : ${valeur}€`);
    afficherReponsesInvitesSurHote('jp-invites-reponses');
    _verifierSiTousOntRepondu();
}

// ======================================================
// 🎯 RÉVÉLATION DU PRIX + CALCUL DES POINTS
// ======================================================
function _declencharRevelation(vraiPrix) {
    if (_validationEnCours) return;
    _validationEnCours = true;

    const btnAfficher = document.getElementById('jp-btn-afficher-prix');
    if (btnAfficher) { btnAfficher.disabled = true; btnAfficher.style.opacity = '0.45'; }
    const btnEnvoyer = document.getElementById('jp-btn-envoyer-hote');
    if (btnEnvoyer)  { btnEnvoyer.disabled  = true; btnEnvoyer.style.opacity  = '0.45'; }

    // Afficher le vrai prix dans l'interface hôte
    const prixEl = document.getElementById('jp-produit-prix');
    if (prixEl) prixEl.textContent = vraiPrix;

    // Lire toutes les estimations (hôte + invités)
    const toutes = lireReponsesInvites();
    const repTri = Object.entries(toutes).sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));

    // Parser le vrai prix (enlever symboles €, espaces, virgules)
    const prix = parseFloat(String(vraiPrix).replace(/[^0-9.,]/g,'').replace(',','.')) || 0;

    if (prix <= 0) {
        // Pas de prix parseable → afficher sans points
        _afficherPanneauResultats(repTri.map(([p, d]) => ({
            pseudo: p, estimation: d.reponse, ecart: null, points: 0, estPlusProche: false
        })), vraiPrix);
        publierRevelation(repTri.map(([p, d]) => ({
            pseudo: p, estimation: d.reponse, ecart: null, points: 0, estPlusProche: false
        })), vraiPrix);
        return;
    }

    // Calculer l'écart et les points de base pour chaque joueur
    const resultats = repTri.map(([pseudo, data]) => {
        const est   = parseFloat(String(data.reponse).replace(/[^0-9.,]/g,'').replace(',','.')) || 0;
        const ecart = prix > 0 ? Math.abs(est - prix) / prix : 1;  // ratio 0→1
        let points = 0;
        if (ecart <= 0.10) points = 2;       // ±10% → 2 pts de base
        else if (ecart <= 0.25) points = 1;  // ±25% → 1 pt de base
        return { pseudo, estimation: data.reponse, ecart, points, estPlusProche: false };
    });

    // Trouver le plus proche (parmi ceux avec points > 0 en priorité)
    const avecPoints = resultats.filter(r => r.points > 0);
    let plusProche   = null;
    if (avecPoints.length > 0) {
        plusProche = avecPoints.reduce((min, r) => r.ecart < min.ecart ? r : min, avecPoints[0]);
    } else if (resultats.length > 0) {
        // Personne dans la fourchette → le moins loin quand même
        plusProche = resultats.reduce((min, r) => r.ecart < min.ecart ? r : min, resultats[0]);
        plusProche.points = 1; // consolation
    }

    if (plusProche) {
        plusProche.estPlusProche = true;
        plusProche.points        = plusProche.points + 1; // bonus +1pt au plus proche
    }

    // Créditer les points
    const pseudoHote = _pseudoHote();
    resultats.forEach(r => {
        if (r.points <= 0) return;
        if (r.pseudo === pseudoHote) {
            if (typeof window._jpValiderAvecPoints === 'function') {
                window._jpValiderAvecPoints(r.points);
            }
        } else {
            if (GameState.scores[r.pseudo] === undefined) GameState.scores[r.pseudo] = 0;
            GameState.scores[r.pseudo] = +((GameState.scores[r.pseudo] + r.points).toFixed(2));
            try {
                const jeu   = GameState.jeuActuel || 'justeprix';
                const rawSG = localStorage.getItem('scores_globaux');
                const sg    = rawSG ? JSON.parse(rawSG) : {};
                if (!sg[r.pseudo]) sg[r.pseudo] = { total: 0, parJeu: {} };
                sg[r.pseudo].total = +((sg[r.pseudo].total || 0) + r.points).toFixed(2);
                sg[r.pseudo].parJeu = sg[r.pseudo].parJeu || {};
                sg[r.pseudo].parJeu[jeu] = +((sg[r.pseudo].parJeu[jeu] || 0) + r.points).toFixed(2);
                localStorage.setItem('scores_globaux', JSON.stringify(sg));
            } catch {}
        }
    });

    publierScores();

    _afficherPanneauResultats(resultats, vraiPrix, prix);
    publierRevelation(resultats, vraiPrix, prix);

    if (typeof window.afficherScoreboard === 'function') window.afficherScoreboard();
}

// ── Publier le signal de révélation pour jeu.html ────────────
function publierRevelation(resultats, vraiPrix, prix) {
    localStorage.setItem(cleRevelation(), JSON.stringify({
        vraiPrix,
        prixNum: prix || 0,
        hote:    _pseudoHote(),
        reponses: resultats.map(r => ({
            pseudo:       r.pseudo,
            estimation:   r.estimation,
            ecart:        r.ecart,
            points:       r.points,
            estPlusProche: r.estPlusProche
        })),
        ts: Date.now()
    }));
}

// ── Panneau résultats côté hôte ───────────────────────────────
function _afficherPanneauResultats(resultats, vraiPrix, prixNum) {
    const container = document.getElementById('jp-invites-reponses');
    if (!container) return;

    if (!resultats || resultats.length === 0) {
        container.innerHTML = '<p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">Aucune estimation reçue</p>';
        return;
    }

    const pseudoHote = _pseudoHote();

    // Afficher le prix réel au-dessus du panneau
    let prixRealBanner = document.getElementById('jp-prix-reel-banner');
    if (!prixRealBanner) {
        const panneau = document.getElementById('panneau-invites-jp');
        if (panneau) {
            prixRealBanner = document.createElement('div');
            prixRealBanner.id = 'jp-prix-reel-banner';
            prixRealBanner.style.cssText = [
                'text-align:center', 'padding:10px 14px', 'margin-bottom:12px',
                'background:rgba(251,191,36,.1)', 'border:1px solid rgba(251,191,36,.3)',
                'border-radius:10px', 'font-size:.95rem', 'color:rgba(255,255,255,.7)'
            ].join(';');
            panneau.insertAdjacentElement('beforebegin', prixRealBanner);
        }
    }
    if (prixRealBanner) {
        prixRealBanner.innerHTML = `Prix réel : <strong style="color:#fbbf24;font-size:1.15rem;">${escHtml(String(vraiPrix))}</strong>`;
    }

    container.innerHTML = resultats.map(({ pseudo, estimation, ecart, points, estPlusProche }) => {
        const correct = points > 0;
        const bg      = correct ? 'rgba(34,197,94,.15)'  : 'rgba(239,68,68,.12)';
        const border  = correct ? 'rgba(34,197,94,.35)'  : 'rgba(239,68,68,.25)';
        const isHote  = pseudo === pseudoHote;

        const ecartTxt = ecart !== null
            ? `${(ecart * 100).toFixed(1)}% d'écart`
            : '—';

        const badgePlusProche = estPlusProche
            ? ' <span style="font-size:.75rem;color:#fbbf24;">🎯+1</span>'
            : '';

        const badge = correct
            ? `<span style="color:#86efac;font-weight:700;font-size:.82rem;">+${points}pt${points !== 1 ? 's' : ''} ✅${badgePlusProche}</span>`
            : `<span style="color:#fca5a5;font-size:.82rem;">0pt ❌</span>`;

        return `
        <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;
            background:${bg};border:1px solid ${border};
            border-radius:10px;margin-bottom:6px;flex-wrap:wrap;">
            <span style="font-weight:700;font-size:.85rem;color:${isHote ? '#c4b5fd' : '#00d4ff'};min-width:80px;">
                ${isHote ? '🎮 ' : ''}${escHtml(pseudo)}
            </span>
            <span style="font-size:.88rem;color:rgba(255,255,255,.85);font-style:italic;">${escHtml(String(estimation))}€</span>
            <span style="flex:1;font-size:.75rem;color:rgba(255,255,255,.4);text-align:right;">${ecartTxt}</span>
            ${badge}
        </div>`;
    }).join('') + `
`;
}

// ── Notification plus proche ──────────────────────────────────
function _afficherNotifPlusProche(pseudo) {
    document.getElementById('notif-jp-proche')?.remove();
    const notif = document.createElement('div');
    notif.id = 'notif-jp-proche';
    notif.style.cssText = `
        position:fixed;top:80px;left:50%;transform:translateX(-50%);
        background:rgba(251,191,36,.9);color:#1a0a00;
        padding:12px 24px;border-radius:14px;font-size:1rem;font-weight:700;
        z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,.3);animation:slideDown .3s ease;
    `;
    notif.textContent = `🎯 ${pseudo} est le plus proche ! +1pt bonus`;
    document.body.appendChild(notif);
    if (!document.getElementById('style-notif-jp')) {
        const s = document.createElement('style');
        s.id = 'style-notif-jp';
        s.textContent = `@keyframes slideDown{from{opacity:0;transform:translateX(-50%) translateY(-12px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}`;
        document.head.appendChild(s);
    }
    setTimeout(() => notif.remove(), 4000);
}

// ======================================================
// 🔔 PANNEAU D'ATTENTE (avant révélation)
// Estimations masquées, juste le pseudo + "a estimé"
// ======================================================
export function afficherReponsesInvitesSurHote(containerId = 'jp-invites-reponses') {
    const container = document.getElementById(containerId);
    if (!container || _validationEnCours) return;

    const reponses   = lireReponsesInvites();
    const entries    = Object.entries(reponses);
    const nbAttendu  = _getNbJoueursTotal();
    const pseudoHote = _pseudoHote();

    if (entries.length === 0) {
        container.innerHTML = `<p style="font-size:.8rem;color:rgba(255,255,255,.4);text-align:center;">
            En attente des estimations… (0 / ${nbAttendu > 0 ? nbAttendu : '?'})
        </p>`;
        return;
    }

    container.innerHTML = entries.map(([p]) => {
        const isHote = p === pseudoHote;
        return `
        <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;
            background:${isHote ? 'rgba(196,181,253,.07)' : 'rgba(251,191,36,.07)'};
            border:1px solid ${isHote ? 'rgba(196,181,253,.25)' : 'rgba(251,191,36,.2)'};
            border-radius:10px;margin-bottom:6px;">
            <span style="font-weight:700;font-size:.85rem;color:${isHote ? '#c4b5fd' : '#fbbf24'};min-width:80px;">
                ${isHote ? '🎮 ' : ''}${escHtml(p)}
            </span>
            <span style="flex:1;font-size:.82rem;color:rgba(255,255,255,.35);font-style:italic;">💰 a estimé</span>
        </div>`;
    }).join('') + `
        <p style="font-size:.78rem;color:rgba(255,255,255,.35);text-align:center;margin-top:6px;">
            ${entries.length} / ${nbAttendu > 0 ? nbAttendu : '?'} estimations reçues
        </p>`;
}

// ======================================================
// 🎯 BOUTON "AFFICHER LE PRIX"
// Hôte entre le vrai prix et déclenche la révélation.
// ======================================================
export function declencherAfficherPrix() {
    if (_validationEnCours) return;

    // Lire le vrai prix depuis le champ #jp-vrai-prix ou le produit courant
    let vraiPrix = '';
    const champPrix = document.getElementById('jp-vrai-prix-input');
    if (champPrix && champPrix.value.trim()) {
        vraiPrix = champPrix.value.trim();
    } else {
        // Fallback : lire depuis le bouton d'affichage de prix
        const btnPrix = document.getElementById('jp-produit-prix');
        if (btnPrix && btnPrix._prix) vraiPrix = btnPrix._prix;
    }

    if (!vraiPrix) {
        // Si pas de prix saisi, demander à l'hôte
        vraiPrix = prompt('Entrez le vrai prix du produit (€) :');
        if (!vraiPrix) return;
    }

    _declencharRevelation(vraiPrix);
}

// Déclencher directement avec un prix connu (appelé quand hôte clique "Afficher le prix")
export function declencherRevelationAvecPrix(vraiPrix) {
    if (_validationEnCours) return;
    _declencharRevelation(vraiPrix);
}

// ======================================================
// 🔗 CALLBACKS & EXPORTS STANDARDS
// ======================================================
export function setProduitSuivantCallback(fn) {
    _produitSuivantCb = fn;
}

export function publierScores() {
    localStorage.setItem(cleScores(), JSON.stringify(GameState.scores || {}));
}

export function lireReponsesInvites() {
    try { return JSON.parse(localStorage.getItem(cleReponses()) || '{}'); } catch { return {}; }
}

export function viderReponses() {
    localStorage.removeItem(cleReponses());
}

export function nettoyerPartieInvites() {
    const pid = partieId();
    [`partie_question_${pid}`, `partie_reponses_${pid}`, `partie_validation_${pid}`,
     `partie_scores_${pid}`, `partie_revelation_${pid}`].forEach(k => localStorage.removeItem(k));
    publierEtat('fin');
    if (timerSync) clearInterval(timerSync);
    _validationEnCours  = false;
    _reponseHoteEnvoyee = false;
}

function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}