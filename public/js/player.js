// /public/js/player.js
// ======================================================
// 🎮 PLAYER.JS v4
// Après GAME_STARTED → sauvegarde session + redirige
// vers le jeu correspondant (logique gérée par le JS du jeu)
// ======================================================

import { socket } from "./core/socket.js";

const $    = id => document.getElementById(id);
const show = id => { const el=$(id); if(el) el.hidden=false; };
const hide = id => { const el=$(id); if(el) el.hidden=true; };
const esc  = str => String(str||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

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

function toast(msg, type="info", ms=3000) {
    const c=$("toast-container")||(()=>{ const d=document.createElement("div"); d.id="toast-container"; d.className="toast-container"; document.body.appendChild(d); return d; })();
    const icons={info:"ℹ️",success:"✅",error:"❌",warning:"⚠️"};
    const el=document.createElement("div");
    el.className=`toast toast-${type}`;
    el.innerHTML=`<span>${icons[type]||"ℹ️"}</span><span>${esc(msg)}</span>`;
    c.appendChild(el);
    requestAnimationFrame(()=>el.classList.add("toast-visible"));
    setTimeout(()=>{ el.classList.remove("toast-visible"); el.classList.add("toast-hiding"); setTimeout(()=>el.remove(),400); },ms);
}

// ======================================================
// 🗂️ ÉTAT
// ======================================================
const PlayerState = {
    pseudo:    null,
    equipe:    null,
    partieId:  null,
    jeu:       null,
    mode:      null,
    joueurs:   [],
    equipes:   [],
    score:     0,
    connected: false,
};

// ======================================================
// 📺 ÉCRANS
// ======================================================
function showScreen(id) {
    ["player-join","player-lobby","player-game","player-results"].forEach(s=>{
        const el=$(s); if(el) el.hidden=true;
    });
    const t=$(id); if(t) t.hidden=false;
}

// ======================================================
// 📡 CHARGEMENT DES PARTIES
// ======================================================
async function chargerParties() {
    const select=$("p-partie-select"), loading=$("p-parties-loading"), empty=$("p-parties-empty");
    if(loading) loading.hidden=false;
    if(empty)   empty.hidden=true;
    if(select)  select.innerHTML="";

    try {
        const res = await fetch("/api/parties");
        if(!res.ok) throw new Error("Erreur réseau");
        const parties = await res.json();
        if(loading) loading.hidden=true;

        if(!parties||parties.length===0){
            if(empty) empty.hidden=false;
            if(select) select.innerHTML=`<option value="">Aucune partie disponible</option>`;
            return;
        }

        if(select){
            select.innerHTML=`<option value="">-- Choisir une partie --</option>`+
                parties.map(p=>`<option value="${esc(p.id)}" data-jeu="${esc(p.jeu)}" data-mode="${esc(p.mode)}" data-equipes='${JSON.stringify(p.equipes||[])}'>${esc(p.nom)} · ${esc((p.jeu||"").toUpperCase())} · ${p.nbJoueurs} joueur${p.nbJoueurs>1?"s":""}</option>`).join("");
        }

        select?.addEventListener("change", ()=>onPartieSelectChange(parties));

        // Pré-sélectionner depuis URL
        const urlPartieId = new URLSearchParams(location.search).get("partieId");
        if(urlPartieId && select){
            select.value=urlPartieId;
            onPartieSelectChange(parties);
        }
    } catch(e){
        if(loading) loading.hidden=true;
        if(empty){ empty.hidden=false; empty.textContent="Impossible de charger les parties."; }
    }
}

function onPartieSelectChange(parties) {
    const select=$("p-partie-select"), id=select?.value;
    const partie=parties.find(p=>p.id===id);
    const equipeBloc=$("p-equipe-bloc"), equipeSelect=$("p-equipe-select");
    if(!partie){ if(equipeBloc) equipeBloc.hidden=true; return; }
    if(partie.mode==="team" && partie.equipes?.length>0){
        if(equipeBloc) equipeBloc.hidden=false;
        if(equipeSelect) equipeSelect.innerHTML=`<option value="">-- Choisir une équipe --</option>`+
            partie.equipes.map(eq=>`<option value="${esc(eq.nom)}">${esc(eq.nom)}</option>`).join("");
    } else { if(equipeBloc) equipeBloc.hidden=true; }
}

// ======================================================
// 🔌 REJOINDRE
// ======================================================
function initJoinForm() {
    $("p-btn-join")?.addEventListener("click", rejoindrePartie);
    $("p-btn-refresh")?.addEventListener("click", ()=>{ chargerParties(); toast("Actualisation…","info",1500); });
    $("p-pseudo")?.addEventListener("keydown", e=>{ if(e.key==="Enter") rejoindrePartie(); });

    // Pré-remplir le pseudo
    const last = localStorage.getItem("mgu_last_pseudo");
    if(last){ const inp=$("p-pseudo"); if(inp) inp.value=last; }
}

function rejoindrePartie() {
    const pseudo  = $("p-pseudo")?.value.trim();
    const partieId = $("p-partie-select")?.value;
    const equipe   = $("p-equipe-select")?.value || null;
    hideError();
    if(!pseudo)   { showError("Entrez votre pseudo."); return; }
    if(!partieId) { showError("Sélectionnez une partie."); return; }

    PlayerState.pseudo   = pseudo;
    PlayerState.partieId = partieId;
    PlayerState.equipe   = equipe;
    localStorage.setItem("mgu_last_pseudo", pseudo);
    sessionStorage.removeItem("mgu_partie_a_charger");

    if(!socket.connected){
        socket.connect(WS_URL);
        socket.on("__connected__", ()=> socket.send("PLAYER_JOIN",{pseudo,partieId,equipe}));
    } else {
        socket.send("PLAYER_JOIN",{pseudo,partieId,equipe});
    }
}

// ======================================================
// 📡 SOCKET EVENTS
// ======================================================
function initSocketEvents() {

    socket.on("__disconnected__", ()=>{ const b=$("player-disconnect-banner"); if(b) b.hidden=false; });
    socket.on("__connected__",    ()=>{ const b=$("player-disconnect-banner"); if(b) b.hidden=true; });

    socket.on("JOIN_OK", ({ pseudo, partieId, snapshot }) => {
        PlayerState.pseudo    = pseudo;
        PlayerState.partieId  = partieId;
        PlayerState.connected = true;
        PlayerState.jeu       = snapshot?.jeu   || null;
        PlayerState.mode      = snapshot?.mode  || null;
        PlayerState.joueurs   = snapshot?.joueurs || [];
        PlayerState.equipes   = snapshot?.equipes || [];

        // Remplir l'écran de lobby
        if($("p-avatar"))  $("p-avatar").textContent  = pseudo.charAt(0).toUpperCase();
        if($("p-pseudo-display"))  $("p-pseudo-display").textContent  = pseudo;
        if($("p-equipe-display"))  $("p-equipe-display").textContent  = PlayerState.equipe ? `🛡️ ${PlayerState.equipe}` : "";
        if($("p-header-pseudo"))   $("p-header-pseudo").textContent   = pseudo;
        if($("p-header-equipe"))   $("p-header-equipe").textContent   = PlayerState.equipe ? `🛡️ ${PlayerState.equipe}` : "";
        if($("p-lobby-jeu"))       $("p-lobby-jeu").textContent       = (snapshot?.jeu||"").toUpperCase();
        if($("p-lobby-mode"))      $("p-lobby-mode").textContent      = snapshot?.mode==="team"?"🛡️ Équipes":"👤 Solo";

        renderLobbyJoueurs(snapshot?.joueurs||[]);
        showScreen("player-lobby");
        toast(`Bienvenue ${pseudo} !`,"success",2000);
    });

    socket.on("JOIN_FAIL", ({ error }) => {
        showError(error||"Impossible de rejoindre.");
        toast(error||"Rejoindre échoué.","error");
    });

    socket.on("PLAYER_JOINED", ({ joueurs }) => renderLobbyJoueurs(joueurs));
    socket.on("PLAYER_LEFT",   ({ joueurs }) => renderLobbyJoueurs(joueurs));

    socket.on("GAME_STARTED", ({ snapshot }) => {
        // ✅ Sauvegarder la session complète et rediriger vers le jeu
        const session = {
            partieId:  PlayerState.partieId,
            pseudo:    PlayerState.pseudo,
            equipe:    PlayerState.equipe,
            role:      "player",
            jeu:       snapshot?.jeu  || PlayerState.jeu,
            mode:      snapshot?.mode || PlayerState.mode,
            joueurs:   snapshot?.joueurs || PlayerState.joueurs,
            equipes:   snapshot?.equipes || PlayerState.equipes,
            scores:    snapshot?.scores  || {},
        };
        sessionStorage.setItem("mgu_game_session", JSON.stringify(session));

        const jeu = session.jeu;
        const path = JEU_PATHS[jeu];

        if(path){
            toast("La partie commence ! Redirection…","success",1500);
            setTimeout(()=>{ location.href = path; }, 1200);
        } else {
            // Fallback : afficher l'écran générique
            showScreen("player-game");
            toast("La partie commence !","success",2000);
        }
    });

    socket.on("SCORES_UPDATE", ({ scores }) => {
        const myScore = scores[PlayerState.pseudo] ?? scores[PlayerState.equipe] ?? 0;
        PlayerState.score = myScore;
        const el=$("p-header-score"); if(el) el.textContent=`${myScore} pts`;
    });

    socket.on("GAME_ENDED", ({ snapshot }) => {
        renderResultats(snapshot?.scores||{});
        showScreen("player-results");
        toast("Partie terminée !","info");
    });

    socket.on("PLAYER_KICKED", ({ reason }) => {
        toast(reason||"Vous avez été expulsé.","error",5000);
        setTimeout(()=>showScreen("player-join"),2000);
    });
}

// ======================================================
// 🎨 RENDU
// ======================================================
function renderLobbyJoueurs(joueurs) {
    const c=$("p-liste-joueurs"); if(!c) return;
    if(!joueurs||joueurs.length===0){ c.innerHTML=`<span class="lobby-joueur-empty">En attente d'autres joueurs…</span>`; return; }
    c.innerHTML=joueurs.map(j=>{
        const pseudo=typeof j==="string"?j:j.pseudo;
        const equipe=typeof j==="object"?j.equipe:null;
        const isMe=pseudo===PlayerState.pseudo;
        return `<span class="lobby-joueur-tag ${isMe?"lobby-joueur-moi":""}">
            <span class="lobby-joueur-avatar">${pseudo.charAt(0).toUpperCase()}</span>
            ${esc(pseudo)}
            ${equipe?`<small>🛡️ ${esc(equipe)}</small>`:""}
            ${isMe?`<span class="lobby-moi-badge">Moi</span>`:""}
        </span>`;
    }).join("");
}

function renderResultats(scores) {
    const c=$("p-results-content"); if(!c) return;
    const entries=Object.entries(scores).sort((a,b)=>b[1]-a[1]);
    const medals=["🥇","🥈","🥉"];
    if(entries.length===0){ c.innerHTML=`<p class="list-empty">Aucun score.</p>`; return; }
    c.innerHTML=entries.map(([nom,pts],i)=>{
        const isMe=nom===PlayerState.pseudo||nom===PlayerState.equipe;
        return `<div class="result-row ${i===0?"result-winner":""} ${isMe?"result-me":""}">
            <span>${medals[i]||`${i+1}.`}</span><span>${esc(nom)}</span><span>${pts} pts</span>
        </div>`;
    }).join("");
}

function showError(msg){ const el=$("p-join-error"); if(el){ el.textContent=msg; el.hidden=false; } }
function hideError()   { const el=$("p-join-error"); if(el) el.hidden=true; }

function initRejouer() {
    $("p-btn-rejouer")?.addEventListener("click",()=>{
        Object.assign(PlayerState,{pseudo:null,partieId:null,equipe:null,jeu:null,mode:null,score:0,connected:false});
        chargerParties();
        showScreen("player-join");
    });
}

// ======================================================
// 🚀 INIT
// ======================================================
document.addEventListener("DOMContentLoaded", ()=>{
    initJoinForm();
    initSocketEvents();
    initRejouer();
    socket.connect(WS_URL);
    chargerParties();
    showScreen("player-join");
    console.log("[PLAYER] 🎮 v4 initialisé");
});

window.PlayerState = PlayerState;