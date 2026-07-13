// /js/modules/parties.js

import { $, show, hide } from "../core/dom.js";

// Callback injecté par main.js
let _cbLancerJeu = null;
export function setPartiesCallback({ lancerJeu }) {
    _cbLancerJeu = lancerJeu || null;
}
import { GameState } from "../core/state.js";
import { getPartieSessionId, setPartieSessionId, mettreAJourLienInvitation } from "./invite.js";
import {
    getAllParties,
    saveNewParty,
    loadPartyById,
    loadGame,
    saveGame,
    getScoresGlobaux
} from "../core/storage.js";

// ======================================================
// 🧹 Suivi des intervalles et listeners créés par afficherListeParties()
// Ils sont nettoyés à chaque nouvel appel pour éviter les fuites.
// ======================================================
let _intervalsListeParties  = [];   // IDs setInterval
let _listenersListeParties  = [];   // { key, fn } pour window.removeEventListener

function _nettoyerListenersParties() {
    _intervalsListeParties.forEach(id => clearInterval(id));
    _intervalsListeParties = [];
    _listenersListeParties.forEach(({ fn }) => window.removeEventListener('storage', fn));
    _listenersListeParties = [];
}

// ======================================================
// 🎮 Bouton "Continuer"
// ======================================================
export function initContinueButton() {
    const partie = loadGame();
    if (partie) show("continue-block");
    else hide("continue-block");
}

// ======================================================
// 🧱 Conteneur liste des parties
// ======================================================
function ensureContainer() {
    let zone = $("liste-parties");
    if (!zone) {
        zone = document.createElement("div");
        zone.id = "liste-parties";
        zone.className = "liste-parties";
        document.body.appendChild(zone);
    }
    return zone;
}

// ======================================================
// 🟦 Suggestions de parties (datalist)
// ======================================================
export function remplirSuggestionsParties() {
    const datalist = document.getElementById("suggestions-parties");
    if (!datalist) return;

    const parties = getAllParties();
    datalist.innerHTML = "";
    parties.forEach(p => {
        const option = document.createElement("option");
    option.value = (p.nomPartie || p.nom || p.partieNom);
        datalist.appendChild(option);
    });
}

// ======================================================
// 🏆 Calcul du meilleur score d'une partie
// Cherche d'abord dans les scores sauvegardés de la partie,
// puis dans les scores globaux si la partie a des scores à 0.
// ======================================================
function getBestScorePartie(p) {
    // 1. Scores directs dans la partie
    if (p.scores && Object.keys(p.scores).length > 0) {
        const maxLocal = Math.max(...Object.values(p.scores));
        if (maxLocal > 0) return maxLocal;
    }

    // 2. Fallback : scores globaux filtrés par les participants de cette partie
    const scoresGlobaux = getScoresGlobaux();
    const participants = p.mode === "team"
        ? (p.equipes || []).map(e => e.nom)
        : (p.joueurs || []);

    if (participants.length === 0) return 0;

    const jeu = p.jeu || "";
    let maxGlobal = 0;

    participants.forEach(nom => {
        if (scoresGlobaux[nom]) {
            // Score pour ce jeu spécifique si disponible
            const scoreJeu = scoresGlobaux[nom]?.parJeu?.[jeu] || 0;
            maxGlobal = Math.max(maxGlobal, scoreJeu);
        }
    });

    return maxGlobal;
}

// ======================================================
// 📜 Afficher la liste des parties
// ======================================================
export function afficherListeParties() {
    // Nettoyer les intervalles et listeners de l'appel précédent
    _nettoyerListenersParties();

    const zone = ensureContainer();
    const parties = getAllParties();

    hide("home");
    zone.innerHTML = "";

    const header = document.createElement("div");
    header.className = "parties-header";

    const titre = document.createElement("h1");
    titre.className = "titre-partie";
    titre.textContent = "Charger une partie";
    header.appendChild(titre);
    zone.appendChild(header);

    if (parties.length === 0) {
        const p = document.createElement("p");
        p.textContent = "Aucune partie enregistrée.";
        zone.appendChild(p);
        show("liste-parties");

        const btnRetour = $("btn-retour-permanent");
        if (btnRetour) btnRetour.hidden = false;
        return;
    }

    parties.forEach(p => {
        const div = document.createElement("div");
        div.className = "partie-item";

        const dateObj  = new Date(p.date);
        const dateStr  = dateObj.toLocaleDateString("fr-FR");
        const heureStr = dateObj.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

        // ✅ FIX : calcul intelligent du meilleur score
        const meilleurScore = getBestScorePartie(p);
        const bestScore = meilleurScore > 0 ? `${meilleurScore} pts` : "Aucun score encore";

        const nomJeu    = String(p.jeu || "").toUpperCase();
        const modeLabel = p.mode === "team" ? "Équipes" : "Solo";

        let participantsLabel = "";
        if (p.mode === "team" && Array.isArray(p.equipes) && p.equipes.length > 0) {
            participantsLabel = p.equipes.map(e => e.nom).join(", ");
        } else if (Array.isArray(p.joueurs) && p.joueurs.length > 0) {
            participantsLabel = p.joueurs.join(", ");
        }

        // Calcul de la durée depuis la création
        const maintenant = new Date();
        const diffMs = maintenant - dateObj;
        const diffMin = Math.floor(diffMs / 60000);
        const diffH = Math.floor(diffMin / 60);
        const diffJ = Math.floor(diffH / 24);
        let anciennete = "";
        if (diffJ > 0) anciennete = `il y a ${diffJ}j`;
        else if (diffH > 0) anciennete = `il y a ${diffH}h`;
        else if (diffMin > 0) anciennete = `il y a ${diffMin}min`;
        else anciennete = "à l'instant";

        div.innerHTML = `
            <h3>${p.nomPartie}
                <span class="date-partie-mini"> — le ${dateStr} à ${heureStr} (${anciennete})</span>
            </h3>
            <p>${nomJeu} • Mode : ${modeLabel} • Meilleur score : <strong class="best-score-badge">${bestScore}</strong></p>
            ${(() => {
                if (!participantsLabel) return "";
                const sid = getPartieSessionId() || localStorage.getItem("minigame_partie_session_id");
                const cetAppareilEstHote = String(sid) === String(p.id);
                const noms = participantsLabel.split(", ");
                const html = noms.map((nom, i) =>
                    (cetAppareilEstHote && i === 0)
                        ? `<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(239,68,68,.18);border:1.5px solid rgba(239,68,68,.5);border-radius:6px;padding:1px 8px;color:#fca5a5;font-weight:700;" title="Hôte (toi)">${nom} 👑</span>`
                        : `<span>${nom}</span>`
                ).join(", ");
                return `<p class="participants-resume">Participant(s) : ${html}</p>`;
            })()}
        `;

        // ── Lien d'invitation ───────────────────────────────
        // sessionId = p.id depuis le fix creerNouvellePartie.
        // On le passe explicitement dans le lien pour que jeu.html
        // construise les bonnes clés localStorage sans ambiguïté.
        const _sessionIdLien = p.sessionId || String(p.id);
        const lienInvitation = `${location.origin}${location.pathname.replace(/\/[^/]*$/, '')}/rejoindre.html`
            + `?partieId=${p.id}`
            + `&sessionId=${_sessionIdLien}`
            + `&partieNom=${encodeURIComponent(p.nomPartie || p.nom || p.partieNom)}`
            + `&jeu=${encodeURIComponent(p.jeu || '')}`
            + `&createdAt=${p.date || p.id}`;

        const rowLien = document.createElement("div");
        rowLien.className = "invite-link-row";
        rowLien.innerHTML = `
            <input id="invite-link-input-${p.id}" class="invite-link-input" type="text" readonly value="${lienInvitation}" aria-label="Lien d'invitation">
            <button class="invite-copy-btn disabled" aria-label="Copier le lien" data-copy-id="${p.id}" disabled>📋</button>
        `;
        rowLien.querySelector('.invite-copy-btn').addEventListener('click', function () {
            navigator.clipboard.writeText(lienInvitation).then(() => {
                this.textContent = '✅';
                setTimeout(() => this.textContent = '📋', 1500);
            }).catch(() => {
                // Fallback si clipboard API indisponible
                const inp = document.getElementById(`invite-link-input-${p.id}`);
                if (inp) { inp.select(); document.execCommand('copy'); }
                this.textContent = '✅';
                setTimeout(() => this.textContent = '📋', 1500);
            });
        });

        // ── Bouton QR Code ──────────────────────────────────
        const btnQR = document.createElement("button");
        btnQR.className = "invite-copy-btn disabled";
        btnQR.setAttribute("aria-label", "Afficher le QR Code");
        btnQR.textContent = "📷";
        btnQR.disabled = true;
        btnQR.addEventListener('click', () => ouvrirModaleQR(lienInvitation, p.nomPartie || p.nom || p.partieNom));
        rowLien.appendChild(btnQR);

        div.appendChild(rowLien);

        // ── Injecter la modale QR (une seule fois) ──────────
        if (!document.getElementById('modale-qr')) {
            _injecterModaleQR();
        }

        // ── Bouton Charger ──────────────────────────────────
        // Compteur joueurs prêts
        const _sidP = p.sessionId || String(p.id);
        const _joueurs = p.mode === 'team' ? (p.equipes||[]).map(e=>e.nom) : (p.joueurs||[]);
        const _invites = _joueurs.slice(1);
        if (_invites.length > 0) {
            const cDiv = document.createElement('div');
            cDiv.id = 'cpt-' + p.id;
            cDiv.style.cssText = 'font-size:.74rem;color:rgba(255,255,255,.5);margin:6px 0 2px;';
            div.appendChild(cDiv);
            function majCpt() {
                const prets = JSON.parse(localStorage.getItem('invite_pret_' + _sidP)||'[]');
                const n = _invites.filter(x=>prets.some(p=>p.toLowerCase()===x.toLowerCase())).length;
                const el = document.getElementById('cpt-' + p.id); if (!el) return;
                if (n === 0) el.innerHTML = '⏳ En attente des joueurs…';
                else if (n < _invites.length) el.innerHTML = `✅ ${n}/${_invites.length} prêt(s)`;
                else el.innerHTML = '<span style="color:#86efac;font-weight:700;">✅ Tous prêts !</span>';
            }
            majCpt();
            const _iv = setInterval(majCpt, 800);
            _intervalsListeParties.push(_iv);   // suivi pour cleanup

            const _storageFn = e => { if (e.key === 'invite_pret_' + _sidP) majCpt(); };
            window.addEventListener('storage', _storageFn);
            _listenersListeParties.push({ fn: _storageFn }); // suivi pour cleanup
        }
        const btnLoad = document.createElement("button");
        btnLoad.className = "btn-load disabled";
        btnLoad.textContent = "Charger";
        btnLoad.dataset.id = p.id;
        btnLoad.disabled = true;

        btnLoad.onclick = () => {
            const partie = chargerPartie(p.id);
            if (!partie) return alert("Partie introuvable");

            console.log("[PARTIES] Chargement de la partie:", partie);

            // Undercover : retour à l'écran de config
            if (partie.jeu === "undercover") {
                hide("liste-parties");
                hide("home");
                show("container");

                const ucConfig = document.getElementById("undercover-config");
                const ucDistrib = document.getElementById("undercover-distribution");
                const ucGame   = document.getElementById("undercover");

                if (ucDistrib) { ucDistrib.hidden = true;  ucDistrib.style.display = "none"; }
                if (ucGame)    { ucGame.hidden = true;     ucGame.style.display = "none"; }
                if (ucConfig)  { ucConfig.hidden = false;  ucConfig.style.display = "block"; }

                const spanNbJoueurs = document.getElementById("uc-nb-joueurs");
                if (spanNbJoueurs) spanNbJoueurs.textContent = partie.joueurs.length;

                console.log("[PARTIES] ✅ Undercover prêt à être configuré");
                return;
            }

            // Autres jeux
            try { localStorage.removeItem('invite_pret_' + sidARestaurer); } catch {}
            if (_cbLancerJeu) _cbLancerJeu(partie.jeu, { fromLoad: true });
            hide("liste-parties");
        };

        div.appendChild(btnLoad);

        // ── Bouton Supprimer ────────────────────────────────
        const btnDelete = document.createElement("button");
        btnDelete.className = "btn-delete noselect disabled";
        btnDelete.disabled = true;
        btnDelete.dataset.id = p.id;
        btnDelete.innerHTML = `<span class="text">Supprimer</span><span class="icon">🗑️</span>`;

        btnDelete.onclick = () => {
            if (!confirm("Supprimer cette partie ?")) return;

            let list = getAllParties().filter(partie => String(partie.id) !== String(p.id));
            localStorage.setItem("parties", JSON.stringify(list));

            const partieEnCours = loadGame();
            if (partieEnCours && String(partieEnCours.id) === String(p.id)) {
                localStorage.removeItem("partie_en_cours");
            }

            initContinueButton();
            afficherListeParties();
        };

        div.appendChild(btnDelete);
        zone.appendChild(div);
    });

    show("liste-parties");

    const btnRetour = $("btn-retour-permanent");
    if (btnRetour) btnRetour.hidden = false;
}

// ======================================================
// 🔲 MODALE QR CODE
// ======================================================

export function _injecterModaleQR() {
    // Script qrcode.js depuis CDN (léger, sans dépendance)
    if (!document.getElementById('script-qrcodejs')) {
        const s = document.createElement('script');
        s.id  = 'script-qrcodejs';
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
        document.head.appendChild(s);
    }

    // Styles modale
    if (!document.getElementById('style-modale-qr')) {
        const style = document.createElement('style');
        style.id = 'style-modale-qr';
        style.textContent = `
            #modale-qr {
                position: fixed; inset: 0; z-index: 9999;
                background: rgba(0,0,0,.78);
                backdrop-filter: blur(8px);
                display: flex; align-items: center; justify-content: center;
                padding: 20px;
                animation: mqFadeIn .2s ease;
            }
            @keyframes mqFadeIn { from { opacity:0; } to { opacity:1; } }
            #modale-qr.hidden { display: none; }
            .modale-qr-inner {
                background: linear-gradient(145deg, rgba(30,20,80,.97), rgba(10,10,40,.97));
                border: 1px solid rgba(255,255,255,.15);
                border-radius: 24px;
                padding: 32px 28px 28px;
                text-align: center;
                max-width: 360px;
                width: 100%;
                box-shadow: 0 24px 80px rgba(0,0,0,.6);
                animation: mqPop .25s cubic-bezier(.4,0,.2,1);
            }
            @keyframes mqPop { from { transform: scale(.88) translateY(16px); opacity:0; } to { transform: scale(1) translateY(0); opacity:1; } }
            .modale-qr-titre {
                font-size: 1rem; font-weight: 800; color: white;
                margin-bottom: 4px;
            }
            .modale-qr-nom {
                font-size: 0.8rem; color: rgba(0,212,255,.8);
                font-weight: 700; margin-bottom: 20px;
                text-transform: uppercase; letter-spacing: .08em;
            }
            #qr-canvas-wrap {
                display: inline-flex; align-items: center; justify-content: center;
                background: white; border-radius: 16px;
                padding: 16px; margin-bottom: 20px;
            }
            #qr-canvas-wrap canvas, #qr-canvas-wrap img { display: block; }
            .modale-qr-hint {
                font-size: 0.78rem; color: rgba(255,255,255,.45);
                margin-bottom: 20px; line-height: 1.6;
            }
            .btn-fermer-qr {
                padding: 11px 28px;
                background: rgba(255,255,255,.1);
                border: 1px solid rgba(255,255,255,.2);
                border-radius: 12px; color: white;
                font-size: 0.9rem; font-weight: 700;
                cursor: pointer; transition: background .2s, transform .15s;
                font-family: inherit;
            }
            .btn-fermer-qr:hover { background: rgba(255,255,255,.2); transform: translateY(-1px); }
        `;
        document.head.appendChild(style);
    }

    // Structure HTML de la modale
    const modale = document.createElement('div');
    modale.id = 'modale-qr';
    modale.className = 'hidden';
    modale.innerHTML = `
        <div class="modale-qr-inner">
            <div class="modale-qr-titre">📲 Scanner pour rejoindre</div>
            <div class="modale-qr-nom" id="qr-nom-partie"></div>
            <div id="qr-canvas-wrap"></div>
            <p class="modale-qr-hint">Scanne ce QR Code avec ton téléphone<br>pour rejoindre la partie instantanément.</p>
            <button class="btn-fermer-qr" id="btn-fermer-qr">✖ Fermer</button>
        </div>
    `;
    document.body.appendChild(modale);

    // Fermeture : bouton ou clic sur l'overlay
    document.getElementById('btn-fermer-qr').onclick = () => { modale.classList.add('hidden'); };
    modale.addEventListener('click', e => { if (e.target === modale) modale.classList.add('hidden'); });

    // Fermeture clavier (Échap)
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') modale.classList.remove('hidden') && modale.classList.add('hidden');
    });
}

export function ouvrirModaleQR(lien, nomPartie) {
    const modale = document.getElementById('modale-qr');
    if (!modale) return;

    modale.classList.remove('hidden');
    document.getElementById('qr-nom-partie').textContent = nomPartie || '';

    const wrap = document.getElementById('qr-canvas-wrap');
    wrap.innerHTML = ''; // Vider l'ancien QR

    const generer = () => {
        if (typeof QRCode === 'undefined') {
            setTimeout(generer, 200); // Attendre le chargement du script
            return;
        }
        new QRCode(wrap, {
            text:           lien,
            width:          220,
            height:         220,
            colorDark:      '#000000',
            colorLight:     '#ffffff',
            correctLevel:   QRCode.CorrectLevel.M
        });
    };
    generer();
}
// Restaure GameState depuis la partie sauvegardée.
// ⚠️ N'appelle PAS saveGame() pour éviter de déclencher
//    une sync globale inutile.
// ======================================================
export function chargerPartie(id) {
    const partie = loadPartyById(id);
    if (!partie) return null;

    // Restaure le GameState depuis la sauvegarde
    GameState.jeuActuel  = partie.jeu;
    GameState.mode       = partie.mode;
    GameState.partieNom  = (partie.nomPartie || partie.nom || partie.partieNom);
    GameState.scores     = { ...partie.scores };   // copie des scores sauvegardés
    GameState.partieEnCoursChargee = true;

    if (partie.mode === "team") {
        GameState.equipes = partie.equipes || [];
        GameState.joueurs = [];
    } else {
        GameState.joueurs = partie.joueurs || [];
        GameState.equipes = [];
    }

    // ✅ Restaurer le sessionId alphanum dans minigame_partie_session_id
    // (pas l'ID numérique p.id qui casserait la synchro avec quiz_hote.js)
    const sidARestaurer = partie.sessionId || String(partie.id);
    setPartieSessionId(sidARestaurer);

    localStorage.setItem("partie_en_cours", JSON.stringify(partie));

    return partie;
}

// ======================================================
// 🆕 Créer une nouvelle partie
// ======================================================
export function creerNouvellePartie() {
    const data = {
        jeu:       GameState.jeuActuel,
        mode:      GameState.mode,
        nomPartie: GameState.partieNom,
    };

    if (GameState.mode === "team") {
        data.equipes = GameState.equipes || [];
        data.joueurs = [];
    } else {
        data.joueurs = GameState.joueurs || [];
        data.equipes = [];
    }

    const nouvellePartie = saveNewParty(data);

    // ✅ Stocker le sessionId alphanum dans la partie SANS écraser minigame_partie_session_id.
    // minigame_partie_session_id est déjà correct (alphanum, généré par invite.js).
    // L'écraser avec p.id (numérique) casserait la synchro hôte/invités.
    const sessionIdActuel = getPartieSessionId();
    try {
        const parties = JSON.parse(localStorage.getItem('parties') || '[]');
        const idx = parties.findIndex(p => String(p.id) === String(nouvellePartie.id));
        if (idx !== -1) {
            parties[idx].sessionId = sessionIdActuel;
            localStorage.setItem('parties', JSON.stringify(parties));
            nouvellePartie.sessionId = sessionIdActuel;
            localStorage.setItem('partie_en_cours', JSON.stringify(nouvellePartie));
        }
    } catch {}

    try { mettreAJourLienInvitation(); } catch {}

    GameState.scores = { ...nouvellePartie.scores };

    initContinueButton();
}