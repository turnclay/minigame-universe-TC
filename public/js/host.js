// /public/js/host.js
// ======================================================
// 🟦 HOST.JS v5
// - Après "Lancer" → TOUJOURS afficher l'écran spectateur
//   (que le host joue ou non)
// - La session est sauvegardée pour que le host puisse
//   ouvrir le jeu dans un autre onglet si besoin
// ======================================================

import { socket } from "./core/socket.js";

const $    = id  => document.getElementById(id);
const show = id  => { const el=$(id); if(el) el.hidden=false; };
const hide = id  => { const el=$(id); if(el) el.hidden=true; };
const esc  = str => String(str||"")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");

const WS_URL = `${location.protocol==="https:"?"wss":"ws"}://${location.host}/ws`;

// ── Map jeu → chemin URL ──────────────────────────────
const JEU_PATHS = {
    quiz:       "/games/quiz/",
    justeprix:  "/games/justeprix/",
    undercover: "/games/undercover/",
    lml:        "/games/lml/",
    mimer:      "/games/mimer/",
    pendu:      "/games/pendu/",
    petitbac:   "/games/petitbac/",
    memoire:    "/games/memoire/",
    morpion:    "/games/morpion/",
    puissance4: "/games/puissance4/",
};

// ── Toast ─────────────────────────────────────────────
function toast(msg, type="info", ms=3000) {
    const c = $("toast-container") || (() => {
        const d=document.createElement("div"); d.id="toast-container"; d.className="toast-container";
        document.body.appendChild(d); return d;
    })();
    const icons={info:"ℹ️",success:"✅",error:"❌",warning:"⚠️"};
    const el=document.createElement("div");
    el.className=`toast toast-${type}`;
    el.innerHTML=`<span>${icons[type]||"ℹ️"}</span><span>${esc(msg)}</span>`;
    c.appendChild(el);
    requestAnimationFrame(()=>el.classList.add("toast-visible"));
    setTimeout(()=>{ el.classList.remove("toast-visible"); el.classList.add("toast-hiding"); setTimeout(()=>el.remove(),400); },ms);
}

// ======================================================
// 🗂️ STATE
// ======================================================
const HostState = {
    partieId:      null,
    partieNom:     null,
    jeu:           null,
    mode:          "solo",
    equipes:       [],
    joueursSolo:   [],
    joueurs:       [],
    scores:        {},
    statut:        null,
    hostJoue:      false,
    hostPseudo:    null,
    partieEnCours: false,
};

// ======================================================
// 💾 PERSISTENCE LOCALE
// ======================================================
function sauvegarderPartieLocale(snapshot) {
    try {
        const parties = JSON.parse(localStorage.getItem("mgu_parties")||"[]");
        const idx = parties.findIndex(p=>p.partieId===snapshot.id);
        const entry = {
            partieId: snapshot.id, id: snapshot.id, nom: snapshot.nom,
            jeu: snapshot.jeu, mode: snapshot.mode, equipes: snapshot.equipes||[],
            joueurs: snapshot.joueurs||[], scores: snapshot.scores||{},
            statut: snapshot.statut, createdAt: Date.now(),
        };
        if(idx>=0) parties[idx]={...parties[idx],...entry}; else parties.push(entry);
        localStorage.setItem("mgu_parties", JSON.stringify(parties));
    } catch(e){ console.warn("[HOST] Save locale failed:", e); }
}

function mettreAJourStatutLocal(partieId, statut, scores) {
    try {
        const parties = JSON.parse(localStorage.getItem("mgu_parties")||"[]");
        const idx = parties.findIndex(p=>p.partieId===partieId||p.id===partieId);
        if(idx>=0){ parties[idx].statut=statut; if(scores) parties[idx].scores=scores; localStorage.setItem("mgu_parties",JSON.stringify(parties)); }
    } catch(e){}
}

// ======================================================
// 🔌 SOCKET STATUS
// ======================================================
function initSocketStatus() {
    const dot=$("ws-dot"), label=$("ws-label");
    socket.on("__connected__",()=>{
        if(dot) dot.className="ws-dot ws-ok";
        if(label) label.textContent="Connecté";
        socket.send("HOST_AUTH",{});
    });
    socket.on("__disconnected__",()=>{
        if(dot) dot.className="ws-dot ws-ko";
        if(label) label.textContent="Déconnecté — reconnexion…";
    });
    socket.on("__reconnect_failed__",()=>{
        if(dot) dot.className="ws-dot ws-ko";
        if(label) label.textContent="Connexion perdue";
        toast("Connexion perdue. Rechargez la page.","error",0);
    });
}

// ======================================================
// 🎮 MODE TOGGLE
// ======================================================
function initModeToggle() {
    const setMode = mode => {
        HostState.mode = mode;
        $("btn-mode-solo")?.classList.toggle("mode-btn-active", mode==="solo");
        $("btn-mode-equipes")?.classList.toggle("mode-btn-active", mode==="team");
        if(mode==="solo"){ show("bloc-solo"); hide("bloc-equipes"); }
        else             { hide("bloc-solo"); show("bloc-equipes"); }
    };
    $("btn-mode-solo")?.addEventListener("click", ()=>setMode("solo"));
    $("btn-mode-equipes")?.addEventListener("click", ()=>setMode("team"));
    setMode("solo");
}

// ======================================================
// 👤 HOST JOUE TOGGLE
// ======================================================
function initHostRoleToggle() {
    $("h-host-joue")?.addEventListener("change", e=>{
        HostState.hostJoue = e.target.checked;
        const w = $("h-host-pseudo-wrap");
        if(w) w.hidden = !e.target.checked;
    });
}

// ======================================================
// 👥 JOUEURS SOLO
// ======================================================
function initJoueursSolo() {
    const input=$("h-joueur-input"), btn=$("h-joueur-ajouter");
    const ajouter = () => {
        const nom = input?.value.trim(); if(!nom) return;
        if(HostState.joueursSolo.includes(nom)){ toast("Joueur déjà existant.","warning"); return; }
        HostState.joueursSolo.push(nom);
        if(input) input.value="";
        renderJoueursSoloForm();
    };
    btn?.addEventListener("click", ajouter);
    input?.addEventListener("keydown", e=>{ if(e.key==="Enter") ajouter(); });
    renderJoueursSoloForm();
}

function renderJoueursSoloForm() {
    const c=$("h-joueurs-list"); if(!c) return;
    if(HostState.joueursSolo.length===0){
        c.innerHTML=`<p class="list-empty">Aucun joueur — rejoignez via le lien</p>`; return;
    }
    c.innerHTML=HostState.joueursSolo.map((j,i)=>`
        <div class="joueur-tag">
            <span class="joueur-tag-avatar">${j.charAt(0).toUpperCase()}</span>
            <span class="joueur-tag-nom">${esc(j)}</span>
            <button class="btn-remove" data-i="${i}">×</button>
        </div>`).join("");
    c.querySelectorAll(".btn-remove").forEach(btn=>btn.addEventListener("click",()=>{
        HostState.joueursSolo.splice(parseInt(btn.dataset.i),1); renderJoueursSoloForm();
    }));
}

// ======================================================
// 🛡️ ÉQUIPES
// ======================================================
function initEquipes() {
    const input=$("h-equipe-input"), btn=$("h-equipe-ajouter");
    const ajouter = () => {
        const nom=input?.value.trim(); if(!nom) return;
        if(HostState.equipes.some(e=>e.nom.toLowerCase()===nom.toLowerCase())){ toast("Équipe déjà existante.","warning"); return; }
        HostState.equipes.push({ nom, membres:[] });
        if(input) input.value="";
        renderEquipesForm();
    };
    btn?.addEventListener("click", ajouter);
    input?.addEventListener("keydown", e=>{ if(e.key==="Enter") ajouter(); });
    renderEquipesForm();
}

function renderEquipesForm() {
    const c=$("h-equipes-list"); if(!c) return;
    if(HostState.equipes.length===0){ c.innerHTML=`<p class="list-empty">Créez au moins 2 équipes</p>`; return; }
    c.innerHTML=HostState.equipes.map((eq,i)=>`
        <div class="equipe-form-item">
            <div class="equipe-form-header">
                <span>🛡️</span>
                <span class="equipe-form-nom">${esc(eq.nom)}</span>
                <button class="btn-remove btn-del-equipe" data-i="${i}">×</button>
            </div>
        </div>`).join("");
    c.querySelectorAll(".btn-del-equipe").forEach(btn=>btn.addEventListener("click",()=>{
        HostState.equipes.splice(parseInt(btn.dataset.i),1); renderEquipesForm();
    }));
}

// ======================================================
// 🚀 CRÉER PARTIE
// ======================================================
function initCreerPartie() {
    $("h-btn-creer")?.addEventListener("click", () => {
        if(HostState.partieEnCours){
            toast("Terminez ou quittez votre partie en cours d'abord.","warning");
            return;
        }
        const nom  = $("h-nom-partie")?.value.trim();
        const jeu  = $("h-jeu")?.value;
        const mode = HostState.mode;
        if(!nom){ toast("Donnez un nom à la partie.","warning"); return; }
        if(mode==="team" && HostState.equipes.length<2){ toast("Il faut au moins 2 équipes.","warning"); return; }

        let hostPseudo = null;
        if(HostState.hostJoue){
            hostPseudo = $("h-host-pseudo")?.value.trim();
            if(!hostPseudo){ toast("Entrez votre pseudo.","warning"); return; }
            HostState.hostPseudo = hostPseudo;
        }

        socket.send("HOST_CREATE_GAME",{
            nom, jeu, mode,
            equipes:     HostState.equipes,
            joueursSolo: HostState.joueursSolo,
            hostJoue:    HostState.hostJoue,
            hostPseudo
        });
    });
}

// ======================================================
// 🎮 LANCER LA PARTIE
// ✅ TOUJOURS → écran spectateur (peu importe hostJoue)
// Si host joue → session sauvegardée + lien "rejoindre" dans spectateur
// ======================================================
function lancerPartie() {
    socket.send("HOST_START_GAME", {});
}

function apresLancement(snapshot) {
    HostState.statut = "en_cours";
    mettreAJourStatutLocal(HostState.partieId, "en_cours", null);

    // ── Toujours sauvegarder la session (au cas où le host veut jouer dans un autre onglet) ──
    if(HostState.hostJoue && HostState.hostPseudo) {
        const session = {
            partieId:  HostState.partieId,
            pseudo:    HostState.hostPseudo,
            role:      "host",
            jeu:       HostState.jeu,
            mode:      HostState.mode,
            joueurs:   snapshot.joueurs || [],
            equipes:   snapshot.equipes || [],
            scores:    snapshot.scores  || {},
        };
        sessionStorage.setItem("mgu_game_session", JSON.stringify(session));
    }

    // ── TOUJOURS afficher l'écran spectateur ──
    afficherEcranSpectateur(snapshot);
}

// ======================================================
// 🖥️ ÉCRAN SPECTATEUR
// ======================================================
function afficherEcranSpectateur(snapshot) {
    hide("host-lobby");
    show("host-spectateur");

    const joinUrl = `${location.origin}/join/?partieId=${HostState.partieId}`;

    // QR Code
    const spQr = document.getElementById("sp-qr");
    if(spQr){
        const qrUrl=`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(joinUrl)}&bgcolor=0d0d1a&color=00d4ff&margin=2`;
        spQr.innerHTML=`<img src="${qrUrl}" alt="QR Code" class="qr-img" onerror="this.closest('.qr-container').innerHTML='<p>QR indisponible</p>'">`;
    }

    // ✅ Si le host joue, afficher un bouton "Rejoindre le jeu" dans le panneau spectateur
    if(HostState.hostJoue && HostState.hostPseudo) {
        const spActions = document.querySelector(".sp-actions");
        if(spActions && !document.getElementById("sp-btn-join-game")) {
            const gameUrl = JEU_PATHS[HostState.jeu] || "/games/";
            const btnJoin = document.createElement("a");
            btnJoin.id = "sp-btn-join-game";
            btnJoin.href = gameUrl;
            btnJoin.className = "btn-primary btn-full";
            btnJoin.style.display = "flex";
            btnJoin.style.alignItems = "center";
            btnJoin.style.justifyContent = "center";
            btnJoin.style.gap = "8px";
            btnJoin.style.marginBottom = "8px";
            btnJoin.innerHTML = `<span>🎮</span> Rejoindre le jeu (${esc(HostState.hostPseudo)})`;
            spActions.insertBefore(btnJoin, spActions.firstChild);
        }
    }

    renderSpectateur(snapshot);
}

function renderSpectateur(snapshot) {
    const snap = snapshot || {};
    const el = n=>document.getElementById(n);
    if(el("sp-nom"))  el("sp-nom").textContent  = HostState.partieNom || "—";
    if(el("sp-jeu"))  el("sp-jeu").textContent  = (HostState.jeu||"—").toUpperCase();
    if(el("sp-mode")) el("sp-mode").textContent = HostState.mode==="team"?"🛡️ Équipes":"👤 Solo";
    _setStatutBadgeSp("en_cours");
    renderScoresSp();
    renderJoueursSp();
}

function renderScoresSp() {
    const c = document.getElementById("sp-scores"); if(!c) return;
    const entries = Object.entries(HostState.scores).sort((a,b)=>b[1]-a[1]);
    if(entries.length===0){ c.innerHTML=`<p class="list-empty">Aucun score pour l'instant</p>`; return; }
    const medals=["🥇","🥈","🥉"];
    const max=entries[0]?.[1]||1;
    c.innerHTML=entries.map(([nom,pts],i)=>{
        const pct=max>0?Math.round((pts/max)*100):0;
        return `<div class="score-row">
            <span class="score-medal">${medals[i]||`${i+1}.`}</span>
            <span class="score-nom">${esc(nom)}</span>
            <div class="score-bar-wrap"><div class="score-bar" style="width:${pct}%"></div></div>
            <span class="score-pts">${pts}<small> pts</small></span>
            <div class="score-actions">
                <button class="btn-pts btn-plus"  data-cible="${esc(nom)}" data-delta="1">＋</button>
                <button class="btn-pts btn-minus" data-cible="${esc(nom)}" data-delta="-1">－</button>
            </div>
        </div>`;
    }).join("");
    c.querySelectorAll(".btn-pts").forEach(btn=>{
        btn.addEventListener("click",()=>{
            const d=parseInt(btn.dataset.delta);
            socket.send(d>0?"HOST_ADD_POINTS":"HOST_REMOVE_POINTS",{cible:btn.dataset.cible,points:1});
        });
    });
}

function renderJoueursSp() {
    const c = document.getElementById("sp-joueurs"); if(!c) return;
    if(HostState.joueurs.length===0){ c.innerHTML=`<p class="list-empty">En attente de joueurs…</p>`; return; }
    c.innerHTML=HostState.joueurs.map(j=>`
        <div class="joueur-connecte-item">
            <span class="joueur-connecte-avatar">${(j.pseudo||"?").charAt(0).toUpperCase()}</span>
            <span class="joueur-connecte-pseudo">${esc(j.pseudo)}</span>
            <button class="btn-kick" data-pseudo="${esc(j.pseudo)}" title="Expulser">✖</button>
        </div>`).join("");
    c.querySelectorAll(".btn-kick").forEach(btn=>btn.addEventListener("click",()=>{
        if(confirm(`Expulser ${btn.dataset.pseudo} ?`)) socket.send("HOST_KICK_PLAYER",{pseudo:btn.dataset.pseudo});
    }));
}

function _setStatutBadgeSp(statut) {
    const b=document.getElementById("sp-statut-badge"); if(!b) return;
    const map={lobby:{text:"● Lobby",cls:"statut-lobby"},en_cours:{text:"● En cours",cls:"statut-en-cours"},terminee:{text:"● Terminée",cls:"statut-terminee"}};
    const info=map[statut]||map.lobby;
    b.textContent=info.text; b.className=`statut-badge ${info.cls}`;
}

function renderResultatsSp() {
    const entries=Object.entries(HostState.scores).sort((a,b)=>b[1]-a[1]);
    const medals=["🥇","🥈","🥉"];
    const html=`<div class="resultats-finaux">
        <h3 class="resultats-titre">🏁 Résultats finaux</h3>
        ${entries.map(([nom,pts],i)=>`<div class="resultat-row ${i===0?"resultat-winner":""}">
            <span class="resultat-medal">${medals[i]||`${i+1}.`}</span>
            <span class="resultat-nom">${esc(nom)}</span>
            <span class="resultat-pts">${pts} pts</span>
        </div>`).join("")}
    </div>`;
    document.getElementById("sp-scores")?.insertAdjacentHTML("afterend", html);
}

// ======================================================
// 📡 SOCKET EVENTS
// ======================================================
function initSocketEvents() {

    socket.on("AUTH_OK", ()=>{ toast("Connecté en tant que host","success",2000); });

    socket.on("GAME_CREATED", ({ partieId, snapshot }) => {
        HostState.partieId      = partieId;
        HostState.partieEnCours = true;
        applySnapshot(snapshot);
        sauvegarderPartieLocale(snapshot);

        const joinUrl = `${location.origin}/join/?partieId=${partieId}`;
        const link=$("h-join-link");
        if(link){ link.href=joinUrl; link.textContent=joinUrl; }
        _renderQR(joinUrl);

        show("panel-game");
        renderGamePanel();
        toast(`Partie "${HostState.partieNom}" créée !`,"success");
    });

    socket.on("PLAYER_JOINED", ({ pseudo, equipe, joueurs }) => {
        HostState.joueurs = joueurs;
        renderJoueursConnectes();
        renderJoueursSp();
        renderScoresSp();
        toast(`${pseudo} a rejoint`,"info",2000);
    });

    socket.on("PLAYER_LEFT", ({ pseudo, joueurs }) => {
        HostState.joueurs = joueurs;
        renderJoueursConnectes();
        renderJoueursSp();
        toast(`${pseudo} a quitté`,"warning",2000);
    });

    socket.on("SCORES_UPDATE", ({ scores }) => {
        HostState.scores = scores;
        renderScores();
        renderScoresSp();
        mettreAJourStatutLocal(HostState.partieId, HostState.statut, scores);
    });

    socket.on("GAME_STARTED", ({ snapshot }) => {
        applySnapshot(snapshot);
        apresLancement(snapshot);
        toast("Partie lancée !","success");
    });

    socket.on("GAME_ENDED", ({ snapshot }) => {
        applySnapshot(snapshot);
        HostState.statut        = "terminee";
        HostState.partieEnCours = false;
        _setStatutBadgeSp("terminee");
        hide("sp-btn-end"); show("sp-btn-nouvelle");
        mettreAJourStatutLocal(HostState.partieId, "terminee", snapshot.scores);
        renderScoresSp();
        renderResultatsSp();
        toast("Partie terminée !","info");
        _setStatutBadge("terminee");
        hide("h-btn-end"); show("h-btn-nouvelle");
    });

    socket.on("PLAYER_ACTION", ({ pseudo, equipe, action }) => {
        if(typeof window.onPlayerAction==="function") window.onPlayerAction({pseudo,equipe,action});
    });

    socket.on("ERROR", ({ code }) => {
        const messages = {
            NOT_HOST:              "Accès refusé.",
            NO_ACTIVE_GAME:        "Aucune partie active.",
            MISSING_FIELDS:        "Données manquantes.",
            HOST_ALREADY_HAS_GAME: "Vous avez déjà une partie en cours. Terminez-la d'abord.",
        };
        toast(messages[code]||`Erreur (${code})`,"error");
    });
}

// ======================================================
// 🎮 CONTRÔLES LOBBY
// ======================================================
function initControles() {
    $("h-btn-start")?.addEventListener("click", () => {
        if(!HostState.partieId) return;
        lancerPartie();
    });

    $("h-btn-end")?.addEventListener("click", () => {
        if(!confirm("Terminer la partie ?")) return;
        socket.send("HOST_END_GAME", {});
    });

    $("h-btn-nouvelle")?.addEventListener("click", resetPourNouvellePartie);

    $("h-btn-copy")?.addEventListener("click", () => {
        const link=$("h-join-link");
        if(!link?.href||link.href==="#") return;
        navigator.clipboard.writeText(link.href)
            .then(()=>toast("Lien copié !","success",1500))
            .catch(()=>toast("Copie impossible","error"));
    });

    $("btn-go-home")?.addEventListener("click", ()=>{ location.href="/"; });

    // ── Contrôles écran spectateur ──
    $("sp-btn-end")?.addEventListener("click", ()=>{
        if(!confirm("Terminer la partie ?")) return;
        socket.send("HOST_END_GAME",{});
    });

    $("sp-btn-nouvelle")?.addEventListener("click", ()=>{
        hide("host-spectateur");
        show("host-lobby");
        resetPourNouvellePartie();
    });

    $("sp-btn-home")?.addEventListener("click",()=>{ location.href="/"; });
}

function resetPourNouvellePartie() {
    Object.assign(HostState,{
        partieId:null, partieNom:null, jeu:null,
        joueurs:[], scores:{}, statut:null, partieEnCours:false,
        equipes:[], joueursSolo:[], hostJoue:false, hostPseudo:null,
    });
    hide("panel-game");
    hide("h-btn-nouvelle");
    show("h-btn-start");
    // Supprimer le bouton "rejoindre le jeu" s'il existe
    document.getElementById("sp-btn-join-game")?.remove();
    const nom=$("h-nom-partie"); if(nom) nom.value="";
    const cb=$("h-host-joue"); if(cb) cb.checked=false;
    HostState.hostJoue=false;
    hide("h-host-pseudo-wrap");
    renderJoueursSoloForm();
    renderEquipesForm();
    toast("Prêt pour une nouvelle partie !","info");
}

// ======================================================
// 🎨 RENDU UI — panel-game (lobby)
// ======================================================
function renderGamePanel() {
    const joinUrl=`${location.origin}/join/?partieId=${HostState.partieId}`;
    const el=n=>$(n);
    if(el("h-info-nom"))  el("h-info-nom").textContent  = HostState.partieNom||"—";
    if(el("h-info-jeu"))  el("h-info-jeu").textContent  = (HostState.jeu||"—").toUpperCase();
    if(el("h-info-mode")) el("h-info-mode").textContent = HostState.mode==="team"?"🛡️ Équipes":"👤 Solo";
    _setStatutBadge(HostState.statut||"lobby");
    const link=$("h-join-link");
    if(link){ link.href=joinUrl; link.textContent=joinUrl; }
    _renderQR(joinUrl);
    if(HostState.mode==="team"){ hide("bloc-joueurs-connectes"); show("bloc-equipes-connectees"); }
    else                       { show("bloc-joueurs-connectes"); hide("bloc-equipes-connectees"); }
    renderJoueursConnectes();
    renderScores();
}

function renderJoueursConnectes() {
    const c=$("h-joueurs-connectes"), counter=$("h-nb-joueurs");
    if(!c) return;
    if(counter) counter.textContent=HostState.joueurs.length;
    if(HostState.mode==="team"){
        const ec=$("h-equipes-connectees"), nb=$("h-nb-equipes");
        const map={};
        HostState.equipes.forEach(eq=>{ map[eq.nom]=[]; });
        HostState.joueurs.forEach(j=>{ const eq=j.equipe||"Sans équipe"; if(!map[eq]) map[eq]=[]; map[eq].push(j.pseudo); });
        if(nb) nb.textContent=Object.keys(map).length;
        if(ec) ec.innerHTML=Object.entries(map).map(([nom,membres])=>`
            <div class="equipe-connectee-card">
                <div class="equipe-connectee-header"><span>🛡️</span><span class="equipe-connectee-nom">${esc(nom)}</span><span class="equipe-connectee-count">${membres.length}</span></div>
                <div class="equipe-connectee-membres">${membres.length>0?membres.map(m=>`<span class="membre-chip"><span class="membre-avatar">${m.charAt(0).toUpperCase()}</span>${esc(m)}</span>`).join(""):
                    `<span class="membre-empty">Aucun joueur</span>`}</div>
            </div>`).join("") || `<p class="list-empty">En attente…</p>`;
        return;
    }
    if(HostState.joueurs.length===0){ c.innerHTML=`<p class="list-empty">En attente de joueurs…</p>`; return; }
    c.innerHTML=HostState.joueurs.map(j=>`
        <div class="joueur-connecte-item">
            <span class="joueur-connecte-avatar">${(j.pseudo||"?").charAt(0).toUpperCase()}</span>
            <span class="joueur-connecte-pseudo">${esc(j.pseudo)}</span>
            <button class="btn-kick" data-pseudo="${esc(j.pseudo)}" title="Expulser">✖</button>
        </div>`).join("");
    c.querySelectorAll(".btn-kick").forEach(btn=>btn.addEventListener("click",()=>{
        if(confirm(`Expulser ${btn.dataset.pseudo} ?`)) socket.send("HOST_KICK_PLAYER",{pseudo:btn.dataset.pseudo});
    }));
}

function renderScores() {
    const c=$("h-scores-liste"); if(!c) return;
    const entries=Object.entries(HostState.scores).sort((a,b)=>b[1]-a[1]);
    if(entries.length===0){ c.innerHTML=`<p class="list-empty">Aucun score</p>`; return; }
    const max=entries[0]?.[1]||1, medals=["🥇","🥈","🥉"];
    c.innerHTML=entries.map(([nom,pts],i)=>{
        const pct=max>0?Math.round((pts/max)*100):0;
        return `<div class="score-row">
            <span class="score-medal">${medals[i]||`${i+1}.`}</span>
            <span class="score-nom">${esc(nom)}</span>
            <div class="score-bar-wrap"><div class="score-bar" style="width:${pct}%"></div></div>
            <span class="score-pts">${pts}<small> pts</small></span>
            <div class="score-actions">
                <button class="btn-pts btn-plus"  data-cible="${esc(nom)}" data-delta="1">＋</button>
                <button class="btn-pts btn-minus" data-cible="${esc(nom)}" data-delta="-1">－</button>
            </div>
        </div>`;
    }).join("");
    c.querySelectorAll(".btn-pts").forEach(btn=>btn.addEventListener("click",()=>{
        const d=parseInt(btn.dataset.delta);
        socket.send(d>0?"HOST_ADD_POINTS":"HOST_REMOVE_POINTS",{cible:btn.dataset.cible,points:1});
    }));
}

function _renderQR(url) {
    const c=$("h-qr"); if(!c) return;
    const qrUrl=`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(url)}&bgcolor=0d0d1a&color=00d4ff&margin=2`;
    c.innerHTML=`<img src="${qrUrl}" alt="QR Code" class="qr-img" onerror="this.closest('.qr-container').innerHTML='<p>QR indisponible</p>'">`;
}

function _setStatutBadge(statut) {
    const b=$("h-statut-badge"); if(!b) return;
    const map={lobby:{text:"● Lobby",cls:"statut-lobby"},en_cours:{text:"● En cours",cls:"statut-en-cours"},terminee:{text:"● Terminée",cls:"statut-terminee"}};
    const info=map[statut]||map.lobby;
    b.textContent=info.text; b.className=`statut-badge ${info.cls}`;
}

// ======================================================
// 🔄 SNAPSHOT
// ======================================================
function applySnapshot(snap) {
    if(!snap) return;
    HostState.partieId  = snap.id      ?? HostState.partieId;
    HostState.partieNom = snap.nom     ?? HostState.partieNom;
    HostState.jeu       = snap.jeu     ?? HostState.jeu;
    HostState.mode      = snap.mode    ?? HostState.mode;
    HostState.equipes   = snap.equipes ?? HostState.equipes;
    HostState.scores    = snap.scores  ?? HostState.scores;
    HostState.statut    = snap.statut  ?? HostState.statut;
    HostState.joueurs   = snap.joueurs ?? HostState.joueurs;
}

// ======================================================
// 📥 PRÉ-REMPLISSAGE URL
// ======================================================
function initFromUrl() {
    const p=new URLSearchParams(location.search);
    const jeuId=p.get("jeu");
    if(jeuId){ const s=$("h-jeu"); if(s) s.value=jeuId; }
}

// ======================================================
// 🚀 INIT
// ======================================================
document.addEventListener("DOMContentLoaded", () => {
    initSocketStatus();
    initSocketEvents();
    initModeToggle();
    initHostRoleToggle();
    initJoueursSolo();
    initEquipes();
    initCreerPartie();
    initControles();
    initFromUrl();
    socket.connect(WS_URL);
    console.log("[HOST] 🎮 v5 initialisé");
});

window.HostState = HostState;