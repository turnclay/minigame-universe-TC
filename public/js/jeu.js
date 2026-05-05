// ======================================================
// public/js/jeu.js — v4.0
// Point d'entree unique cote invite (jeu.html).
// ======================================================

import { socket } from './core/socket.js';

// ── DOM utils ─────────────────────────────────────────
const $ = id => document.getElementById(id);
const show = el => { if (typeof el==='string') el=$(el); if(el){el.hidden=false;el.style.display='';} };
const hide = el => { if (typeof el==='string') el=$(el); if(el){el.hidden=true;} };
const setText = (id,t) => { const e=$(id); if(e) e.textContent=t??''};
const esc = s => String(s??'')    .replace(/&/g,'&amp;')    .replace(/</g,'&lt;')    .replace(/>/g,'&gt;')    .replace(/"/g,'&quot;');

function jeuIcon(jeu) {
    const m={quiz:'❓',justeprix:'💰',undercover:'🕵️',lml:'📖',mimer:'🎭',
             mimedessine:'🎭',pendu:'🪢',petitbac:'📝',memoire:'🧠',morpion:'⭕',puissance4:'🔴'};
    return m[(jeu||'')        .toLowerCase()] || '🎮';
}

// ── Toast ──────────────────────────────────────────────
function toast(msg, type='info', duration=3000) {
    const C={success:'#22c55e',error:'#ef4444',warning:'#f59e0b',info:'#00d4ff'};
    const I={success:'✅',error:'❌',warning:'⚠️',info:'ℹ️'};
    let c=$('toast-container');
    if (!c) {
        c=document.createElement('div');c.id='toast-container';
        c.style.cssText='position:fixed;top:1rem;right:1rem;z-index:9999;display:flex;flex-direction:column;gap:.4rem;max-width:310px;pointer-events:none;';
        document.body.appendChild(c);
    }
    const el=document.createElement('div');
    el.style.cssText=['display:flex;gap:.5rem;align-items:flex-start;padding:.65rem .9rem;border-radius:8px',
        `background:#1e1e2e;color:#fff;border-left:3px solid ${C[type]||C.info}`,
        'box-shadow:0 4px 16px rgba(0,0,0,.5)',
        'opacity:0;transition:opacity .2s,transform .2s;transform:translateX(12px)',
        'font-size:.88rem;pointer-events:auto'].join(';');
    el.innerHTML=`<span style="flex-shrink:0">${I[type]||'ℹ️'}</span><span>${esc(msg)}</span>`;
    c.appendChild(el);
    requestAnimationFrame(()=>{el.style.opacity='1';el.style.transform='translateX(0)';});
    setTimeout(()=>{el.style.opacity='0';el.style.transform='translateX(8px)';setTimeout(()=>el.remove(),220);},duration);
}

// ── Banner ─────────────────────────────────────────────
function showBanner(msg) {
    let b=$('disconnect-banner');
    if (!b) {
        b=document.createElement('div');b.id='disconnect-banner';
        b.style.cssText='position:fixed;top:0;left:0;right:0;background:#f87171;color:#000;text-align:center;padding:.5rem;font-weight:600;z-index:9999;display:none;font-size:.9rem;';
        document.body.prepend(b);
    }
    b.textContent=msg; b.style.display='block';
}
function hideBanner(){const b=$('disconnect-banner');if(b)b.style.display='none';}

// ── JeuRegistry ────────────────────────────────────────
const JeuRegistry={
    _mods:{},
    register(jeu,mod){this._mods[jeu]=mod;},
    get(jeu){return this._mods[(jeu||'')        .toLowerCase()]||null;},
    has(jeu){return Boolean(this._mods[(jeu||'')        .toLowerCase()]);},
};

// ═══════════════════════════════════════════════════════
// ROLE PLAYER
// ═══════════════════════════════════════════════════════
const RolePlayer={
    session:null,snapshot:null,module:null,scoreLocal:0,
    _waitingForGame:false,_waitingAttempts:0,_waitingMax:40,

    init(session){
        this.session=session;this._waitingForGame=false;this._waitingAttempts=0;
        const phId=$('phase-identification'),phJeu=$('phase-jeu');
        if(phId){phId.style.display='';phId.hidden=false;}
        if(phJeu){phJeu.style.display='none';phJeu.hidden=true;}
        setText('hdr-pseudo',session.pseudo||'—');
        setText('hdr-partie',session.partieNom||'Partie');
        setText('hdr-jeu',(session.jeu||'')            .toUpperCase());

        socket.once('__connected__',()=>{
            socket.send('PLAYER_REJOIN',{partieId:session.partieId,pseudo:session.pseudo});
        });

        socket.on('REJOIN_OK',({pseudo,equipe,snapshot,gameState})=>{
            hideBanner();this._waitingForGame=false;this.snapshot=snapshot;
            this.session.equipe=equipe;this.session.pseudo=pseudo;
            toast(`Reconnecté : ${pseudo} 👋`,'success',2000);
            this._basculerVersJeu(snapshot);
            this._chargerModule(snapshot?.jeu||session.jeu,gameState,snapshot);
        });

        socket.on('JOIN_ERROR',({code})=>this._gererJoinError(code));

        socket.on('JOIN_OK',({pseudo,equipe,snapshot})=>{
            hideBanner();this._waitingForGame=false;this.snapshot=snapshot;
            this.session.equipe=equipe;this.session.pseudo=pseudo;
            toast(`Bienvenue ${pseudo} ! En attente du lancement…`,'success',3000);
            this._basculerVersJeu(snapshot);this._afficherAttente(snapshot);
        });

        socket.on('GAME_STARTED',({snapshot})=>{
            this.snapshot=snapshot;this._waitingForGame=false;
            toast('La partie commence ! 🚀','success',2000);
            this._afficherCountdown(3,()=>this._chargerModule(snapshot?.jeu||session.jeu,null,snapshot));
        });

        socket.on('HOST_ACTION',({action,data})=>{
            if(this.module?.onHostAction)this.module.onHostAction(action,data);
        });

        socket.on('SCORES_UPDATE',({scores})=>{
            const pts=scores?.[this.session.pseudo]??this.scoreLocal;
            this.scoreLocal=pts;
            if(this.module?.onScores)this.module.onScores(scores);
        });

        socket.on('GAME_ENDED',({snapshot})=>{
            this.snapshot=snapshot;
            if(this.module?.destroy)this.module.destroy();
            this._afficherFin((snapshot?.scores)||{});
        });

        socket.on('KICKED',({reason})=>{
            toast(`Vous avez été expulsé${reason?' : '+reason:''}`,'error',5000);
            setTimeout(()=>{window.location.href='/';},2500);
        });

        socket.on('HOST_DISCONNECTED',({message})=>showBanner(`⚠️ ${message||"Le host s'est déconnecté"}`));
        socket.on('__disconnected__',()=>showBanner('⚠️ Connexion perdue — reconnexion en cours…'));
        socket.on('__connected__',()=>hideBanner());

        socket.on('PLAYER_JOINED',({joueurs})=>{
            const el=$('attente-joueurs-count');
            if(el)el.textContent=`👥 ${joueurs.length} joueur(s) connecté(s)`;
        });
    },

    _gererJoinError(code){
        const session=this.session,etat=$('id-etat');

        if(code==='PLAYER_NOT_FOUND'){
            socket.send('PLAYER_JOIN',{pseudo:session.pseudo,partieId:session.partieId});
            return;
        }

        if(code==='GAME_NOT_FOUND'){
            if(!this._waitingForGame){
                this._waitingForGame=true;this._waitingAttempts=0;
                this._afficherAttenteCreation();
            }
            this._waitingAttempts++;
            if(this._waitingAttempts>=this._waitingMax){
                const msg=$('attente-creation-msg');
                if(msg)msg.innerHTML='<p style="color:#f87171;margin:0 0 .75rem;">L\'hôte n\'a pas encore créé la partie.</p>'+
                    '<button onclick="location.reload()" style="padding:.6rem 1.5rem;background:rgba(0,212,255,.15);border:1px solid rgba(0,212,255,.4);border-radius:8px;color:#00d4ff;cursor:pointer;font-family:inherit;">🔄 Réessayer</button>';
                this._waitingForGame=false;return;
            }
            let count=3;const cd=$('attente-countdown');
            const iv=setInterval(()=>{
                count--;
                if(cd)cd.textContent=count>0?`Nouvelle tentative dans ${count}s…`:'Connexion…';
                if(count<=0){clearInterval(iv);if(this._waitingForGame)socket.send('PLAYER_JOIN',{pseudo:session.pseudo,partieId:session.partieId});}
            },1000);
            return;
        }

        const msgs={
            PSEUDO_TAKEN:'Ce pseudo est déjà utilisé dans cette partie.',
            GAME_STARTED:"La partie est déjà en cours.",
            MAX_PLAYERS:'La partie est complète.',
            PSEUDO_INVALID:'Pseudo invalide (2-20 caractères).',
            MISSING_FIELDS:'Données manquantes.',
        };
        const msg=msgs[code]||`Erreur : ${code}`;
        if(etat)etat.textContent=msg;
        toast(msg,'error',5000);
    },

    _basculerVersJeu(snapshot){
        const phId=$('phase-identification'),phJeu=$('phase-jeu');
        if(phId){phId.style.display='none';phId.hidden=true;}
        if(phJeu){phJeu.style.display='';phJeu.hidden=false;}
        setText('hdr-pseudo',this.session.pseudo||'—');
        setText('hdr-partie',snapshot?.nom||this.session.partieNom||'Partie');
        setText('hdr-jeu',(snapshot?.jeu||this.session.jeu||'')            .toUpperCase());
        const nav=$('invite-navbar');if(nav)nav.classList.add('visible');
    },

    _afficherAttente(snapshot){
        const cont=$('jeu-contenu');if(!cont)return;
        const icon=jeuIcon(snapshot?.jeu||this.session.jeu);
        const mode=snapshot?.mode==='team'?'🛡️ Équipes':'👤 Solo';
        const nb=(snapshot?.joueurs||[]).length;
        cont.innerHTML=`
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:55vh;text-align:center;padding:2rem;gap:1.5rem;">
                <div style="background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.3);border-radius:12px;padding:.6rem 1.2rem;color:#4ade80;font-size:.85rem;font-weight:600;">✅ Connecté à la partie</div>
                <div style="background:rgba(0,212,255,.07);border:1px solid rgba(0,212,255,.2);border-radius:16px;padding:1.5rem 2rem;min-width:260px;max-width:380px;width:100%;">
                    <div style="font-size:3rem;margin-bottom:.5rem;">${icon}</div>
                    <div style="font-size:1.2rem;font-weight:700;margin-bottom:.25rem;">${esc(snapshot?.nom||this.session.partieNom||'Partie')}</div>
                    <div style="font-size:.85rem;opacity:.6;margin-bottom:1rem;">${(snapshot?.jeu||this.session.jeu||'')        .toUpperCase()} · ${mode}</div>
                    <div style="background:rgba(255,255,255,.05);border-radius:8px;padding:.75rem;margin-bottom:.75rem;">
                        <div style="font-size:.72rem;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:.25rem;">Ton pseudo</div>
                        <div style="font-size:1.1rem;font-weight:700;color:#00d4ff;">${esc(this.session.pseudo)}</div>
                        ${this.session.equipe?`<div style="font-size:.8rem;opacity:.6;margin-top:.25rem;">🛡️ ${esc(this.session.equipe)}</div>`:''}
                    </div>
                    <div id="attente-joueurs-count" style="font-size:.85rem;opacity:.6;">👥 ${nb} joueur(s) connecté(s)</div>
                </div>
                <div style="display:flex;flex-direction:column;align-items:center;gap:.75rem;">
                    <div style="width:36px;height:36px;border:3px solid rgba(0,212,255,.2);border-top-color:#00d4ff;border-radius:50%;animation:rp-spin .9s linear infinite;"></div>
                    <p style="color:#64748b;font-size:.9rem;margin:0;">En attente du lancement…</p>
                </div>
                <button id="btn-quitter-attente" style="background:none;border:1px solid rgba(255,255,255,.1);color:#64748b;border-radius:8px;padding:.5rem 1rem;cursor:pointer;font-size:.82rem;font-family:inherit;">Quitter</button>
            </div>
            <style>@keyframes rp-spin{to{transform:rotate(360deg)}}</style>`;
        $('btn-quitter-attente')?.addEventListener('click',()=>{if(confirm("Quitter ?"))window.location.href='/';});
    },

    _afficherAttenteCreation(){
        const phJeu=$('phase-jeu');
        const actif=phJeu&&!phJeu.hidden&&phJeu.style.display!=='none';
        const target=actif?$('jeu-contenu'):$('id-etat');
        if(!target)return;
        const nom=this.session.partieNom||'la partie';
        if(actif){
            target.innerHTML=`
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:55vh;text-align:center;padding:2rem;gap:1.25rem;">
                    <div style="width:48px;height:48px;border:4px solid rgba(0,212,255,.2);border-top-color:#00d4ff;border-radius:50%;animation:rp-spin .9s linear infinite;"></div>
                    <h2 style="color:white;margin:0;font-size:1.2rem;">En attente de l'hôte…</h2>
                    <div id="attente-creation-msg">
                        <p style="color:rgba(255,255,255,.6);max-width:320px;margin:0 0 .5rem;">Connecté en tant que <strong style="color:#00d4ff;">${esc(this.session.pseudo)}</strong><br>L'hôte configure <strong>${esc(nom)}</strong>.</p>
                        <p id="attente-countdown" style="color:rgba(255,255,255,.3);font-size:.82rem;margin:0;">Nouvelle tentative dans 3s…</p>
                    </div>
                    <a href="/" style="font-size:.8rem;color:rgba(255,255,255,.25);text-decoration:none;">← Retour</a>
                </div>
                <style>@keyframes rp-spin{to{transform:rotate(360deg)}}</style>`;
        } else {
            target.innerHTML=`<span style="display:inline-flex;align-items:center;gap:.5rem;"><span style="width:14px;height:14px;border:2px solid rgba(0,212,255,.3);border-top-color:#00d4ff;border-radius:50%;animation:rp-spin .9s linear infinite;display:inline-block;"></span>En attente de l'hôte… <span id="attente-countdown" style="color:rgba(255,255,255,.3);font-size:.8rem;"></span></span><style>@keyframes rp-spin{to{transform:rotate(360deg)}}</style>`;
        }
    },

    _afficherCountdown(n,onEnd){
        const cont=$('jeu-contenu');if(!cont){onEnd();return;}
        if(!$('style-rp-cd')){
            const s=document.createElement('style');s.id='style-rp-cd';
            s.textContent='@keyframes rpCdPop{0%{transform:scale(1.4);opacity:0}60%{transform:scale(.93)}100%{transform:scale(1);opacity:1}}.rp-cd-n{font-size:5rem;font-weight:900;color:white;text-shadow:0 0 50px rgba(0,212,255,.9);animation:rpCdPop .4s cubic-bezier(.4,0,.2,1)}.rp-cd-l{font-size:.95rem;color:rgba(255,255,255,.7);font-weight:700;letter-spacing:.1em;text-transform:uppercase}';
            document.head.appendChild(s);
        }
        cont.innerHTML=`<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:55vh;gap:1rem;text-align:center;padding:2rem;"><div class="rp-cd-n" id="rp-cd-number">${n}</div><div class="rp-cd-l">La partie commence…</div></div>`;
        let cur=n;const nEl=$('rp-cd-number');
        const iv=setInterval(()=>{
            cur--;
            if(cur>0){if(nEl){nEl.style.animation='none';nEl.textContent=String(cur);requestAnimationFrame(()=>{nEl.style.animation='rpCdPop .4s cubic-bezier(.4,0,.2,1)';});}}
            else{clearInterval(iv);onEnd();}
        },1000);
    },

    _chargerModule(jeu,gameState,snapshot){
        if(this.module?.destroy)this.module.destroy();this.module=null;
        const jeuReel=snapshot?.jeu||jeu||this.session.jeu;
        if(jeuReel){this.session.jeu=jeuReel;setText('hdr-jeu',jeuReel.toUpperCase());}
        const mod=JeuRegistry.get(jeuReel);
        if(mod){this.module=mod;mod.initPlayer(this.session,socket,gameState,snapshot);}
        else this._afficherJeuSurHote(jeuReel);
    },

    _afficherJeuSurHote(jeu){
        const cont=$('jeu-contenu');if(!cont)return;
        cont.innerHTML=`<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:55vh;text-align:center;padding:2rem;gap:1rem;"><span style="font-size:3.5rem;">${jeuIcon(jeu)}</span><h2 style="margin:0;font-size:1.2rem;">Jeu sur l'écran de l'hôte</h2><p style="color:rgba(255,255,255,.6);max-width:300px;margin:0;line-height:1.6;"><strong style="color:#00d4ff;">${esc((jeu||'')            .toUpperCase())}</strong> se joue sur l'écran principal.<br>Tu es inscrit en tant que <strong style="color:#c4b5fd;">${esc(this.session.pseudo)}</strong>.</p><div style="display:flex;flex-direction:column;align-items:center;gap:.5rem;margin-top:.5rem;"><div style="width:28px;height:28px;border:2px solid rgba(0,212,255,.2);border-top-color:#00d4ff;border-radius:50%;animation:rp-spin .9s linear infinite;"></div><p style="color:#64748b;font-size:.85rem;margin:0;">En attente de l'hôte…</p></div></div><style>@keyframes rp-spin{to{transform:rotate(360deg)}}</style>`;
    },

    _afficherFin(scores){
        const cont=$('jeu-contenu');if(!cont)return;
        const pseudo=this.session.pseudo;
        const entries=Object.entries(scores).sort((a,b)=>b[1]-a[1]);
        const medals=['🥇','🥈','🥉'];
        cont.innerHTML=`<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:55vh;text-align:center;padding:2rem;gap:1.5rem;"><span style="font-size:3.5rem;">🏆</span><h2 style="margin:0;">Partie terminée !</h2><div style="display:flex;flex-direction:column;gap:.5rem;width:100%;max-width:360px;">${entries.length?entries.map(([nom,pts],i)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:.75rem 1rem;border-radius:10px;background:${nom===pseudo?'rgba(0,212,255,.12)':'rgba(255,255,255,.04)'};${nom===pseudo?'outline:2px solid rgba(0,212,255,.4);':''}">${medals[i]||i+1+'.'} ${esc(nom)}${nom===pseudo?'<em style="font-size:.8rem;opacity:.6;"> (toi)</em>':''}<span style="font-weight:700;color:${nom===pseudo?'#00d4ff':'white'}">${pts} pts</span></div>`).join(''):'<p style="opacity:.5;">Aucun score.</p>'}</div><a href="/" style="display:inline-block;padding:.75rem 2rem;background:linear-gradient(135deg,#6a5af9,#8a2be2);border-radius:10px;color:white;text-decoration:none;font-weight:700;margin-top:.5rem;">🏠 Retour</a></div>`;
    },
};

// ═══════════════════════════════════════════════════════
// MODULE QUIZ (cote invite, WebSocket uniquement)
// ═══════════════════════════════════════════════════════
const QuizModule={
    _session:null,_socket:null,_aRepondu:false,
    _timerInterval:null,_timerSecondes:60,_timerExpire:false,_totalQ:0,

    initPlayer(session,sock,gameState,snapshot){
        this._session=session;this._socket=sock;
        this._aRepondu=false;this._timerExpire=false;this._timerInterval=null;
        this._afficherEcranAttente();
        if(gameState)this._rehydrater(gameState,session.pseudo);

        sock.on('QUIZ_QUESTION',(payload)=>{
            if(payload.total)this._totalQ=payload.total;
            this._afficherQuestion(payload);
        });
        sock.on('QUIZ_INDICE',({num,texte})=>{
            const el=$(`p-indice${num}`);
            if(el){el.textContent=`💡 Indice ${num} : ${texte}`;el.hidden=false;el.classList.add('indice-visible');}
        });
        sock.on('QUIZ_ANSWER_ACK',({status,texte})=>{
            if(status==='ok'){this._aRepondu=true;this._arreterTimer();this._confirmerEnvoi(texte);}
            else if(status==='already_answered')toast('Vous avez déjà répondu.','warning');
            else if(status==='too_late')toast('Trop tard.','warning');
            else toast('Réponse invalide.','error');
        });
        sock.on('QUIZ_CORRECTION',(payload)=>{this._arreterTimer();this._afficherCorrection(payload,session.pseudo);});
        sock.on('QUIZ_END',({scores})=>{this._arreterTimer();this._afficherFin(scores,session.pseudo);});

        $('p-btn-send')?.addEventListener('click',()=>this._envoyerReponse());
        $('p-answer-input')?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey)this._envoyerReponse();});
    },

    destroy(){this._arreterTimer();},
    onHostAction(){},onScores(){},

    _afficherEcranAttente(){
        const cont=$('jeu-contenu');if(!cont)return;
        cont.innerHTML='<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:50vh;gap:1.25rem;text-align:center;padding:2rem;"><div style="font-size:2.5rem;">❓</div><h2 style="margin:0;font-size:1.1rem;">Quiz en cours</h2><p style="color:rgba(255,255,255,.5);margin:0;">En attente de la prochaine question…</p></div>';
    },

    _afficherQuestion(payload){
        this._aRepondu=false;this._timerExpire=false;
        const{theme,question,posees,total,tempsRestant}=payload;
        const cont=$('jeu-contenu');if(!cont)return;
        cont.innerHTML=`
            <div style="padding:1rem 0;display:flex;flex-direction:column;gap:1rem;">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem;">
                    <span style="font-size:.75rem;text-transform:uppercase;letter-spacing:.1em;color:rgba(255,255,255,.5);background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.15);border-radius:6px;padding:4px 10px;">${esc(theme||'—')}</span>
                    <span style="font-size:.75rem;color:#64748b;font-weight:600;">Q ${posees} / ${total != null ? total : (this._totalQ || '?')}</span>
                </div>
                <div style="font-size:1.15rem;font-weight:700;line-height:1.45;text-align:center;padding:.75rem;background:rgba(255,255,255,.04);border-radius:12px;">${esc(question)}</div>
                <div style="display:flex;flex-direction:column;gap:.5rem;">
                    <div id="p-indice1" hidden style="font-size:.85rem;color:#fbbf24;padding:.5rem .75rem;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.25);border-radius:8px;"></div>
                    <div id="p-indice2" hidden style="font-size:.85rem;color:#f97316;padding:.5rem .75rem;background:rgba(249,115,22,.1);border:1px solid rgba(249,115,22,.25);border-radius:8px;"></div>
                </div>
                <div id="p-texte-answer-zone" style="display:flex;flex-direction:column;gap:.75rem;">
                    <input id="p-answer-input" type="text" autocomplete="off" placeholder="Votre réponse…"
                        style="width:100%;box-sizing:border-box;padding:.75rem 1rem;background:rgba(255,255,255,.07);border:1.5px solid rgba(255,255,255,.18);border-radius:10px;color:white;font-size:1rem;font-family:inherit;outline:none;">
                    <button id="p-btn-send"
                        style="padding:.85rem;background:rgba(34,197,94,.2);border:1.5px solid rgba(34,197,94,.45);border-radius:10px;color:white;font-size:.95rem;font-weight:700;cursor:pointer;font-family:inherit;">
                        ✉️ Envoyer
                    </button>
                </div>
                <div id="p-texte-sent" hidden style="padding:1rem;background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.3);border-radius:10px;text-align:center;color:#4ade80;font-size:.9rem;"></div>
            </div>`;
        $('p-btn-send')?.addEventListener('click',()=>this._envoyerReponse());
        $('p-answer-input')?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey)this._envoyerReponse();});
        this._demarrerTimer(tempsRestant??60);
        setTimeout(()=>$('p-answer-input')?.focus(),150);
    },

    _confirmerEnvoi(texte){
        const zone=$('p-texte-answer-zone'),sent=$('p-texte-sent');
        if(zone)zone.hidden=true;
        if(sent){sent.hidden=false;sent.innerHTML=`✅ Réponse envoyée : <strong>${esc(texte)}</strong><br><small style="opacity:.7;">En attente de la correction…</small>`;}
        toast('Réponse envoyée !','success',2000);
    },

    _afficherCorrection(payload,pseudo){
        const cont=$('jeu-contenu');if(!cont)return;
        const{theme,question,reponse,reponses,posees,total}=payload;
        const maRep=(reponses||[]).find(r=>r.pseudo===pseudo);
        let fb;
        if(!maRep)fb='<div style="background:rgba(100,116,139,.12);border:1px solid rgba(100,116,139,.3);border-radius:10px;padding:.75rem;color:rgba(255,255,255,.6);">😶 Tu n\'as pas répondu à temps.</div>';
        else if(maRep.correct){const p=maRep.estPremier?' 🏆 Premier correct!':'';fb=`<div style="background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.3);border-radius:10px;padding:.75rem;color:#4ade80;font-weight:600;">🎉 Bonne réponse ! <strong>+${maRep.points} pt${maRep.points!==1?'s':''}</strong>${p}</div>`;}
        else fb=`<div style="background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);border-radius:10px;padding:.75rem;color:#fca5a5;">❌ Mauvaise réponse — tu as écrit : <em>${esc(maRep.texte)}</em></div>`;
        cont.innerHTML=`<div style="padding:1rem 0;display:flex;flex-direction:column;gap:1rem;"><div style="display:flex;justify-content:space-between;font-size:.75rem;color:#64748b;"><span>${esc(theme||'—')}</span><span>Q ${posees} / ${total != null ? total : this._totalQ}</span></div><div style="font-size:1rem;font-weight:600;line-height:1.4;color:rgba(255,255,255,.8);text-align:center;">${esc(question)}</div><div style="text-align:center;"><div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.4);margin-bottom:.35rem;">Réponse correcte</div><div style="font-size:1.25rem;font-weight:800;color:#00d4ff;">${esc(reponse)}</div></div>${fb}<p style="font-size:.8rem;color:rgba(255,255,255,.35);text-align:center;margin:0;">En attente de la prochaine question…</p></div>`;
    },

    _afficherFin(scores,pseudo){
        const cont=$('jeu-contenu');if(!cont)return;
        const entries=Object.entries(scores).sort((a,b)=>b[1]-a[1]);
        const medals=['🥇','🥈','🥉'];
        cont.innerHTML=`<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:50vh;text-align:center;padding:2rem;gap:1.5rem;"><span style="font-size:3rem;">🏆</span><h2 style="margin:0;">Quiz terminé !</h2><div style="display:flex;flex-direction:column;gap:.5rem;width:100%;max-width:340px;">${entries.map(([nom,pts],i)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:.7rem 1rem;border-radius:10px;background:${nom===pseudo?'rgba(0,212,255,.12)':'rgba(255,255,255,.04)'};${nom===pseudo?'outline:2px solid rgba(0,212,255,.4);':''}">${medals[i]||i+1+'.'} ${esc(nom)}${nom===pseudo?'<em style="font-size:.8rem;opacity:.6;"> (toi)</em>':''}<span style="font-weight:700;color:${nom===pseudo?'#00d4ff':'white'}">${pts} pts</span></div>`).join('')}</div><a href="/" style="display:inline-block;padding:.75rem 2rem;background:linear-gradient(135deg,#6a5af9,#8a2be2);border-radius:10px;color:white;text-decoration:none;font-weight:700;">🏠 Retour à l'accueil</a></div>`;
    },

    _rehydrater(gs,pseudo){
        if(!gs)return;
        if(gs.phase==='question'&&gs.payload){this._afficherQuestion(gs.payload);toast('Question en cours — rejointe.','info',2000);}
        else if(gs.phase==='correction'&&gs.payload){this._afficherCorrection(gs.payload,pseudo);this._arreterTimer();}
        else if(gs.phase==='ended')this._afficherFin(gs.scores||{},pseudo);
    },

    _envoyerReponse(){
        if(this._aRepondu||this._timerExpire)return;
        const input=$('p-answer-input'),texte=input?.value.trim();
        if(!texte){toast('Écrivez votre réponse.','warning');return;}
        const btn=$('p-btn-send');if(btn){btn.disabled=true;btn.textContent='⏳ Envoi…';}
        this._socket.send('PLAYER_ACTION',{action:'quiz:answer',data:{texte}});
    },

    _demarrerTimer(s=60){
        this._arreterTimer();this._timerSecondes=s;this._timerExpire=false;
        this._afficherTimer(s);
        this._timerInterval=setInterval(()=>{
            this._timerSecondes--;
            if(this._timerSecondes<=0){this._timerSecondes=0;this._afficherTimer(0);this._expirerTimer();this._arreterTimer();}
            else this._afficherTimer(this._timerSecondes);
        },1000);
    },

    _arreterTimer(){if(this._timerInterval){clearInterval(this._timerInterval);this._timerInterval=null;}},

    _afficherTimer(s){
        let el=$('p-timer');
        if(!el){
            const zone=$('p-texte-answer-zone');if(!zone)return;
            el=document.createElement('div');el.id='p-timer';
            el.style.cssText='font-family:monospace;font-size:1.8rem;font-weight:700;text-align:center;transition:color .3s;margin-bottom:.25rem;';
            zone.parentNode.insertBefore(el,zone);
        }
        el.textContent=`⏱ ${s}s`;el.style.color=s<=5?'#f87171':s<=15?'#fbbf24':'#00d4ff';
    },

    _expirerTimer(){
        this._timerExpire=true;
        const input=$('p-answer-input'),btn=$('p-btn-send');
        if(input){input.disabled=true;input.placeholder='⏱ Temps écoulé';}
        if(btn){btn.disabled=true;btn.textContent='⏱ Temps écoulé';}
        if(!this._aRepondu)toast('⏱ Temps écoulé !','warning',3000);
    },
};

JeuRegistry.register('quiz',QuizModule);

// ═══════════════════════════════════════════════════════
// POINT D'ENTREE — JeuApp
// ═══════════════════════════════════════════════════════
const JeuApp={
    session:null,

    init(){
        const params=new URLSearchParams(window.location.search);
        const partieId=params.get('partieId')||params.get('sessionId')||null;
        const pseudo=params.get('pseudo')||null;
        const jeu=params.get('jeu')||null;
        const partieNom=params.get('partieNom')||params.get('nom')||null;
        const hote=params.get('hote')||null;
        const codeCourt=params.get('code')||null;
        const createdAt=params.get('createdAt')||null;

        if(!partieId){
            const etat=$('id-etat');const sub=$('id-subtitle');
            if(etat)etat.textContent="Lien invalide — paramètre 'partieId' manquant.";
            if(sub)sub.textContent="❌ Utilise le lien fourni par l'hôte.";
            return;
        }

        const session={partieId,pseudo,jeu,partieNom:partieNom||'Partie',hote,codeCourt,createdAt,role:'player',needsPseudo:!pseudo};
        try{sessionStorage.setItem('mgu_game_session',JSON.stringify(session));}catch{}
        this.session=session;
        this._remplirMeta(session);

        if(!pseudo){this._afficherFormulairePseudo(session);return;}
        this._demarrer(session);
    },

    _remplirMeta(s){
        const JEUX_LABELS={quiz:'❓ Quiz',justeprix:'💰 Juste Prix',undercover:'🕵️ Undercover',
            lml:'📖 Maxi Lettres',mimer:'🎭 Mimer',mimedessine:'🎭 Mimer',pendu:'🪢 Pendu',
            petitbac:'📝 Petit Bac',memoire:'🧠 Mémoire',morpion:'⭕ Morpion',puissance4:'🔴 Puissance 4'};
        setText('id-meta-nom', s.partieNom || 'Partie');
        setText('id-meta-jeu', s.jeu ? (JEUX_LABELS[s.jeu.toLowerCase()] || s.jeu.toUpperCase()) : '—');
        setText('id-meta-id',  s.partieId || '—');
        setText('id-meta-hote', s.hote || '—');
        // Ligne hôte
        const rh=$('id-row-hote');
        if(rh) rh.style.display = s.hote ? '' : 'none';
        // Date de création depuis createdAt (timestamp ou ISO)
        const rowDate=$('id-row-date');
        if(s.createdAt && rowDate) {
            try {
                const d = new Date(isNaN(s.createdAt) ? s.createdAt : Number(s.createdAt));
                const dateStr = d.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'})
                    + ' à ' + d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
                setText('id-meta-date', dateStr);
                rowDate.style.display = '';
            } catch { rowDate.style.display = 'none'; }
        } else if(rowDate) {
            rowDate.style.display = 'none';
        }
    },

    _afficherFormulairePseudo(session){
        const etat  = $('id-etat');
        // Lire les éléments statiques de jeu.html
        const input = $('id-pseudo');
        const btn   = $('btn-join');

        if (!input || !btn) {
            // Fallback : les IDs ne sont pas dans le DOM (version ancienne)
            if (etat) etat.textContent = "Erreur : formulaire introuvable dans jeu.html.";
            return;
        }

        // Réinitialiser
        input.value   = '';
        input.disabled = false;
        if (etat) etat.textContent = '';

        const valider = () => {
            const p = input.value.trim();

            // Validation
            if (p.length < 2) {
                if (etat) etat.textContent = 'Pseudo trop court (2 caractères minimum).';
                input.focus();
                return;
            }
            if (!/^[a-zA-Z0-9_-]{2,20}$/.test(p)) {
                if (etat) etat.textContent = 'Lettres, chiffres, tiret ou underscore uniquement.';
                input.focus();
                return;
            }

            // Désactiver pour éviter double-clic
            btn.disabled   = true;
            btn.textContent = '⏳ Connexion…';
            input.disabled  = true;
            if (etat) etat.textContent = '';

            // Compléter la session avec le pseudo saisi
            const sessionComplete = { ...session, pseudo: p, needsPseudo: false };
            try { sessionStorage.setItem('mgu_game_session', JSON.stringify(sessionComplete)); } catch {}

            // Démarrer le flux WS — socket.connect() appelé ici
            this._demarrer(sessionComplete);
        };

        // Listener Enter sur le champ
        input.addEventListener('keydown', e => { if (e.key === 'Enter') valider(); });

        // Listener clic bouton — une seule fois (évite accumulation de listeners)
        btn.replaceWith(btn.cloneNode(true)); // cloner pour nettoyer anciens listeners
        const freshBtn = $('btn-join');
        freshBtn.addEventListener('click', valider);

        // Focus auto
        setTimeout(() => input.focus(), 100);
    },

    _demarrer(session){
        this.session=session;
        socket.connect();
        window.JeuApp=this;window.jeuSocket=socket;
        RolePlayer.init(session);
    },
};

document.addEventListener('DOMContentLoaded',()=>JeuApp.init());