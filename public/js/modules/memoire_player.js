// ============================================================
// /js/modules/memoire_player.js — v1.2 (WS, conforme + score serveur)
// ============================================================
// Module invité Mémoire. Auto-enregistré dans JeuRegistry.
// L'invité reçoit MEMOIRE_DEFI (mêmes données + tsAffichageFin que
// fixés par le SERVEUR) et rejoue le même défi dans #jeu-contenu,
// calcule ses erreurs puis soumet via PLAYER_ACTION memoire:result.
//
// Conformité :
//   - Source de vérité serveur : phase + tsAffichageFin proviennent du WS ;
//     le rendu local ne fait que refléter cet état.
//   - Reprise après refresh/reconnexion : initPlayer(gameState) rejoue la
//     phase courante (mémo restante via tsAffichageFin, ou saisie directe
//     si phase 'jeu').
//   - Aucun timer concurrent : garde de génération (_gen) + registre de
//     timers (_timers) purgé à chaque (re)démarrage et dans destroy().
//   - Pas d'état métier dans le DOM : placements symboles tenus en mémoire.
//
// Score IDENTIQUE au client hôte (calculerScore) :
//   score = erreurs > seuil ? 0 : (erreurs === 0 ? base : 1)
// ============================================================

import { JeuRegistry } from './player.js';

const $   = id => document.getElementById(id);
const esc = s => String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const SYMBOLES_SUITE = ["○","△","□","◇","☆","♠","♣","♥","♦","●","▲","■"];
const COULEURS = [
    { nom:"Rouge",  hex:"#e74c3c" }, { nom:"Bleu",   hex:"#3498db" },
    { nom:"Vert",   hex:"#2ecc71" }, { nom:"Jaune",  hex:"#f39c12" },
    { nom:"Violet", hex:"#9b59b6" }, { nom:"Orange", hex:"#e67e22" },
    { nom:"Rose",   hex:"#ec407a" }, { nom:"Cyan",   hex:"var(--mgu-pion-turquoise)" },
];

const WRAP  = 'padding:1rem 0;display:flex;flex-direction:column;gap:14px;align-items:stretch;';
const TITRE = 'text-align:center;font-size:1rem;font-weight:800;color:var(--mgu-or-600);';
const BWRAP = 'height:8px;background:var(--mgu-carton-50);border-radius:6px;overflow:hidden;';
const BAR   = 'height:100%;width:0%;background:linear-gradient(90deg,var(--mgu-or-600),var(--mgu-or-600));';
const BTN   = 'padding:10px 18px;border-radius:10px;font-weight:700;font-family:inherit;cursor:pointer;border:1.5px solid rgba(232,178,59,.45);background:rgba(232,178,59,.18);color:var(--mgu-encre-900);';

const MemoireModule = {
    _session:null, _socket:null, _scores:{},
    _typeDefi:null, _difficulte:null, _config:{}, _base:3, _seuil:0, _donnees:null,
    _gen:0, _timers:[],
    _termine:false, _resultEnvoye:false, _erreurs:0, _reponse:[], _symPlace:{},

    initPlayer(session, sock, gameState, snapshot) {
        this._session = session;
        this._socket  = sock;
        this._scores  = (snapshot?.scores) || {};
        this._ecranAttente('En attente du choix de l\u2019h\u00f4te\u2026');
        // Reprise d'état (refresh / reconnexion) depuis la source de vérité serveur.
        if (gameState) this._onDefi(gameState);
    },

    destroy() { this._clearTimers(); },

    onScores(scores) {
        if (scores) this._scores = scores;
        if ($('mp-classement')) this._renderClassement();
    },

    onWsEvent(evt, payload) {
        switch (evt) {
            case 'MEMOIRE_DEFI':       this._onDefi(payload);  break;
            case 'MEMOIRE_PHASE':      this._onPhase(payload); break;
            case 'MEMOIRE_RESULT_ACK': this._onAck(payload);   break;
        }
    },

    // ── Réception défi / phase (état serveur) ─────────────
    _onDefi(p) {
        this._typeDefi   = p.typeDefi;
        this._difficulte = p.difficulte;
        this._config     = p.config || {};
        this._base       = p.base ?? 3;
        this._seuil      = this._config.seuilErreurs ?? 0;
        if (p.scores)        this._scores  = p.scores;
        if (p.donnees != null) this._donnees = p.donnees;

        if (!p.typeDefi || p.phase === 'menu') {
            this._ecranAttente('En attente du choix de l\u2019h\u00f4te\u2026'); return;
        }
        if (p.phase === 'countdown') {
            this._ecranAttente('\u23f3 Pr\u00e9pare-toi\u2026'); return;
        }
        if (p.phase === 'resultats') {
            this._renderClassementScreen('Manche termin\u00e9e'); return;
        }
        if ((p.phase === 'affichage' || p.phase === 'jeu') && this._donnees != null) {
            const reste = p.tsAffichageFin
                ? (p.tsAffichageFin - Date.now())
                : (this._config.tempsAffichage || 0);
            this._demarrer(p.phase, reste);
        }
    },

    _onPhase(p) {
        if (p.phase === 'resultats') this._renderClassementScreen('Manche termin\u00e9e');
        // 'jeu' / 'countdown' / 'affichage' : pilotés par le timer local
        // (déjà synchronisé via tsAffichageFin) → pas d'action ici.
    },

    _onAck({ status }) {
        if (status && status !== 'ok' && status !== 'already') {
            console.warn('[MP-MEMOIRE] result ack:', status);
        }
    },

    // ── Démarrage d'un défi (mémo ou saisie directe) ──────
    _demarrer(phase, resteMs) {
        const gen = ++this._gen;          // invalide tout timer/callback antérieur
        this._clearTimers();
        this._termine = false;
        this._resultEnvoye = false;
        this._erreurs = 0;
        this._reponse = [];
        this._symPlace = {};

        const direct = (phase === 'jeu') || !(resteMs > 0);
        switch (this._typeDefi) {
            case 'paires':   this._renderPaires(gen, direct, resteMs);   break;
            case 'suite':    this._renderSuite(gen, direct, resteMs);    break;
            case 'couleurs': this._renderCouleurs(gen, direct);          break;
            case 'symboles': this._renderSymboles(gen, direct, resteMs); break;
            default:         this._ecranAttente('D\u00e9fi inconnu.');
        }
    },

    _submit(erreurs) {
        if (this._resultEnvoye) return;
        this._resultEnvoye = true;
        this._termine = true;
        this._clearTimers();
        // Le SCORE est recalculé côté serveur (autorité, anti-triche) ; on
        // ne transmet que les erreurs. Le score local ci-dessous sert
        // uniquement à l'affichage immédiat (même formule que le serveur).
        const score = erreurs > this._seuil ? 0 : (erreurs === 0 ? this._base : 1);
        try {
            this._socket.send('PLAYER_ACTION', { action: 'memoire:result', data: { erreurs } });
        } catch (e) { console.error('[MP-MEMOIRE] send result:', e.message); }
        this._afficherResultatLocal(erreurs, score);
    },

    // ── Défi 1 : paires ───────────────────────────────────
    _renderPaires(gen, direct, resteMs) {
        const cont = $('jeu-contenu'); if (!cont) return;
        const cartes = this._donnees || [];
        const cols = parseInt(String(this._config.gridSize || '4x2').split('x')[0], 10) || 4;
        cont.innerHTML = `
            <div style="${WRAP}">
                <div style="${TITRE}">\ud83c\udccf M\u00e9morise les paires</div>
                <div style="${BWRAP}"><div id="mp-barre" style="${BAR}"></div></div>
                <div id="mp-grille" style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:8px;"></div>
                <p id="mp-status" style="text-align:center;font-size:.85rem;color:var(--mgu-encre-600);">${direct ? '\u00c0 toi !' : 'M\u00e9morise\u2026'}</p>
            </div>`;
        const grille = $('mp-grille');
        grille.innerHTML = cartes.map((sym, i) => `
            <div data-index="${i}" data-symbole="${esc(sym)}"
                style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-size:1.8rem;
                background:rgba(232,178,59,.15);border:1.5px solid rgba(232,178,59,.35);border-radius:10px;">
                <span class="mp-face">${direct ? '?' : esc(sym)}</span></div>`).join('');

        if (direct) { this._pairesEnable(gen); return; }
        this._animerBarre(gen, resteMs, () => {
            grille.querySelectorAll('.mp-face').forEach(f => { f.textContent = '?'; f.style.color = 'rgba(255,255,255,.35)'; });
            const st = $('mp-status'); if (st) st.textContent = '\u00c0 toi ! (Erreurs : 0)';
            this._pairesEnable(gen);
        });
    },

    _pairesEnable(gen) {
        const grille = $('mp-grille'); if (!grille) return;
        let sel = null, bloque = false;
        let restantes = grille.querySelectorAll('[data-index]').length / 2;
        grille.querySelectorAll('[data-index]').forEach(carte => {
            carte.style.cursor = 'pointer';
            carte.onclick = () => {
                if (gen !== this._gen || bloque || carte.dataset.ok || carte === sel) return;
                const face = carte.querySelector('.mp-face');
                if (face) { face.textContent = carte.dataset.symbole; face.style.color = '#fff'; }
                if (!sel) { sel = carte; return; }
                bloque = true;
                if (sel.dataset.symbole === carte.dataset.symbole) {
                    this._addTimeout(() => {
                        if (gen !== this._gen) return;
                        [sel, carte].forEach(c => { c.dataset.ok = '1'; c.style.background = 'rgba(95,167,119,.22)'; });
                        sel = null; bloque = false;
                        if (--restantes === 0) this._submit(this._erreurs);
                    }, 350);
                } else {
                    this._erreurs++;
                    const st = $('mp-status'); if (st) st.textContent = `Erreurs : ${this._erreurs}`;
                    this._addTimeout(() => {
                        if (gen !== this._gen) return;
                        [sel, carte].forEach(c => { const f = c.querySelector('.mp-face'); if (f) { f.textContent = '?'; f.style.color = 'rgba(255,255,255,.35)'; } });
                        sel = null; bloque = false;
                    }, 850);
                }
            };
        });
    },

    // ── Défi 2 : suite ────────────────────────────────────
    _renderSuite(gen, direct, resteMs) {
        const cont = $('jeu-contenu'); if (!cont) return;
        const suite = this._donnees || [];
        cont.innerHTML = `
            <div style="${WRAP}">
                <div style="${TITRE}">\ud83d\udd22 Retiens la suite</div>
                <div style="${BWRAP}"><div id="mp-barre" style="${BAR}"></div></div>
                <div id="mp-affichage" style="display:${direct ? 'none' : 'flex'};flex-wrap:wrap;gap:8px;justify-content:center;">
                    ${suite.map(v => `<div style="min-width:44px;padding:10px;border-radius:8px;font-weight:800;font-size:1.3rem;text-align:center;background:rgba(232,178,59,.18);border:1.5px solid rgba(232,178,59,.4);">${esc(v)}</div>`).join('')}
                </div>
                <div id="mp-input" style="display:${direct ? 'flex' : 'none'};flex-direction:column;gap:10px;">
                    <p style="text-align:center;font-size:.85rem;color:var(--mgu-encre-600);">Reconstitue la suite :</p>
                    <div id="mp-reponse" style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;min-height:40px;"></div>
                    <div id="mp-clavier" style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;">${this._clavierSuite(this._config.type)}</div>
                    <div style="display:flex;gap:8px;justify-content:center;">
                        <button id="mp-effacer" style="${BTN}background:var(--mgu-carton-50);">\ud83d\uddd1\ufe0f Effacer</button>
                        <button id="mp-valider" style="${BTN}">\u2705 Valider</button>
                    </div>
                </div>
            </div>`;
        if (direct) { this._suiteEnable(gen, suite); return; }
        this._animerBarre(gen, resteMs, () => {
            const aff = $('mp-affichage'); if (aff) aff.style.display = 'none';
            const inp = $('mp-input'); if (inp) inp.style.display = 'flex';
            this._suiteEnable(gen, suite);
        });
    },

    _suiteEnable(gen, suite) {
        const rep = $('mp-reponse'); const clav = $('mp-clavier');
        if (!rep || !clav) return;
        clav.querySelectorAll('button').forEach(b => {
            b.onclick = () => {
                if (gen !== this._gen) return;
                this._reponse.push(b.dataset.val);
                const it = document.createElement('div');
                it.style.cssText = 'min-width:36px;padding:6px;border-radius:6px;font-weight:800;text-align:center;background:var(--mgu-carton-50);';
                it.textContent = b.dataset.val;
                rep.appendChild(it);
            };
        });
        $('mp-effacer').onclick = () => { if (gen !== this._gen) return; this._reponse = []; rep.innerHTML = ''; };
        $('mp-valider').onclick = () => {
            if (gen !== this._gen) return;
            const norm = this._reponse.map(r => isNaN(r) ? r : parseInt(r, 10));
            let err = 0;
            for (let i = 0; i < suite.length; i++) { if (suite[i] !== norm[i]) err++; }
            this._submit(err);
        };
    },

    _clavierSuite(type) {
        const btn = v => `<button data-val="${esc(v)}" style="${BTN}min-width:42px;padding:8px 12px;">${esc(v)}</button>`;
        const chiffres = Array.from({ length: 10 }, (_, i) => btn(i)).join('');
        const symb = SYMBOLES_SUITE.slice(0, 12).map(btn).join('');
        if (type === 'nombres') return chiffres;
        if (type === 'mixte')   return chiffres + symb;
        return symb;
    },

    // ── Défi 3 : couleurs ─────────────────────────────────
    _renderCouleurs(gen, direct) {
        const cont = $('jeu-contenu'); if (!cont) return;
        const couleurs = (this._donnees && this._donnees.couleurs) ? this._donnees.couleurs : (this._donnees || []);
        cont.innerHTML = `
            <div style="${WRAP}">
                <div style="${TITRE}">\ud83c\udfa8 Retiens les couleurs</div>
                <div style="display:flex;justify-content:center;">
                    <div id="mp-couleur" style="width:140px;height:140px;border-radius:18px;display:flex;align-items:center;justify-content:center;font-weight:800;color:var(--mgu-encre-900);background:transparent;border:1px solid var(--mgu-carton-line);"></div>
                </div>
                <div id="mp-input" style="display:${direct ? 'flex' : 'none'};flex-direction:column;gap:10px;">
                    <p style="text-align:center;font-size:.85rem;color:var(--mgu-encre-600);">Reconstitue la s\u00e9quence (${couleurs.length}) :</p>
                    <div id="mp-reponse" style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;min-height:36px;"></div>
                    <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;">
                        ${COULEURS.map(c => `<button data-nom="${c.nom}" title="${c.nom}" style="width:42px;height:42px;border-radius:10px;border:2px solid var(--mgu-carton-line);cursor:pointer;background:${c.hex};"></button>`).join('')}
                    </div>
                    <div style="display:flex;gap:8px;justify-content:center;">
                        <button id="mp-effacer" style="${BTN}background:var(--mgu-carton-50);">\ud83d\uddd1\ufe0f Effacer</button>
                        <button id="mp-valider" style="${BTN}">\u2705 Valider</button>
                    </div>
                </div>
            </div>`;

        if (direct) { this._couleursEnable(gen, couleurs); return; }

        const disp = $('mp-couleur');
        const vitesse = this._config.vitesse || 1000;
        let idx = 0;
        const montrer = () => {
            if (gen !== this._gen) return;
            if (idx >= couleurs.length) {
                if (disp) { disp.style.background = 'transparent'; disp.textContent = ''; }
                const inp = $('mp-input'); if (inp) inp.style.display = 'flex';
                this._couleursEnable(gen, couleurs);
                return;
            }
            const c = couleurs[idx];
            if (disp) { disp.style.background = 'transparent'; disp.textContent = ''; }
            this._addTimeout(() => {
                if (gen !== this._gen) return;
                if (disp) { disp.style.background = c.hex; disp.textContent = c.nom; }
                idx++;
                this._addTimeout(montrer, vitesse);
            }, 90);
        };
        montrer();
    },

    _couleursEnable(gen, couleurs) {
        const rep = $('mp-reponse'); const cont = $('jeu-contenu');
        if (!rep || !cont) return;
        cont.querySelectorAll('button[data-nom]').forEach(btn => {
            btn.onclick = () => {
                if (gen !== this._gen) return;
                const c = COULEURS.find(x => x.nom === btn.dataset.nom);
                this._reponse.push(c);
                const it = document.createElement('div');
                it.style.cssText = `width:30px;height:30px;border-radius:7px;background:${c.hex};border:1px solid var(--mgu-carton-line);`;
                rep.appendChild(it);
            };
        });
        $('mp-effacer').onclick = () => { if (gen !== this._gen) return; this._reponse = []; rep.innerHTML = ''; };
        $('mp-valider').onclick = () => {
            if (gen !== this._gen) return;
            let err = 0;
            for (let i = 0; i < couleurs.length; i++) {
                if (!this._reponse[i] || couleurs[i].nom !== this._reponse[i].nom) err++;
            }
            this._submit(err);
        };
    },

    // ── Défi 4 : symboles ─────────────────────────────────
    _renderSymboles(gen, direct, resteMs) {
        const cont = $('jeu-contenu'); if (!cont) return;
        const { positions = [], grille = 3, total = 9 } = this._donnees || {};
        cont.innerHTML = `
            <div style="${WRAP}">
                <div style="${TITRE}">\u2728 M\u00e9morise les symboles</div>
                <div style="${BWRAP}"><div id="mp-barre" style="${BAR}"></div></div>
                <div id="mp-grid" style="display:grid;grid-template-columns:repeat(${grille},1fr);gap:6px;">
                    ${Array.from({ length: total }, (_, i) => {
                        const pos = positions.find(p => p.position === i);
                        return `<div data-index="${i}" style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-size:1.6rem;background:rgba(232,178,59,.12);border:1.5px solid rgba(232,178,59,.3);border-radius:9px;cursor:default;"><span class="mp-sym">${(!direct && pos) ? esc(pos.symbole) : ''}</span></div>`;
                    }).join('')}
                </div>
                <div id="mp-pool-wrap" style="display:${direct ? 'flex' : 'none'};flex-direction:column;gap:8px;">
                    <p style="text-align:center;font-size:.85rem;color:var(--mgu-encre-600);">S\u00e9lectionne un symbole puis clique sa case :</p>
                    <div id="mp-pool" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;">
                        ${positions.map(p => `<div data-symbole="${esc(p.symbole)}" style="width:52px;height:52px;display:flex;align-items:center;justify-content:center;font-size:1.7rem;background:rgba(232,178,59,.2);border:2px solid rgba(232,178,59,.4);border-radius:10px;cursor:pointer;">${esc(p.symbole)}</div>`).join('')}
                    </div>
                </div>
            </div>`;
        if (direct) { this._symbolesEnable(gen, positions); return; }
        this._animerBarre(gen, resteMs, () => {
            $('mp-grid').querySelectorAll('.mp-sym').forEach(s => { s.textContent = ''; });
            const pw = $('mp-pool-wrap'); if (pw) pw.style.display = 'flex';
            this._symbolesEnable(gen, positions);
        });
    },

    _symbolesEnable(gen, positions) {
        const pool = $('mp-pool'), grid = $('mp-grid');
        if (!pool || !grid) return;
        const total = positions.length;
        let selSym = null, selEl = null;

        pool.querySelectorAll('[data-symbole]').forEach(el => {
            el.onclick = () => {
                if (gen !== this._gen) return;
                pool.querySelectorAll('[data-symbole]').forEach(b => b.style.boxShadow = '');
                selSym = el.dataset.symbole; selEl = el;
                el.style.boxShadow = '0 0 0 3px rgba(232,178,59,.8)';
            };
        });

        grid.querySelectorAll('[data-index]').forEach(caseEl => {
            const i = parseInt(caseEl.dataset.index, 10);
            caseEl.onclick = () => {
                if (gen !== this._gen || !selSym || this._symPlace[i] !== undefined) return;
                const span = caseEl.querySelector('.mp-sym');
                if (span) span.textContent = selSym;
                this._symPlace[i] = selSym;          // état en mémoire (pas dans le DOM)
                caseEl.style.background = 'rgba(232,178,59,.15)';
                if (selEl) selEl.remove();
                selSym = null; selEl = null;
                if (Object.keys(this._symPlace).length >= total) {
                    this._addTimeout(() => { if (gen === this._gen) this._validerSymboles(gen, positions); }, 350);
                }
            };
        });
    },

    _validerSymboles(gen, positions) {
        if (gen !== this._gen) return;
        const grid = $('mp-grid');
        let err = 0;
        const totalCases = grid ? grid.querySelectorAll('[data-index]').length : 0;
        for (let i = 0; i < totalCases; i++) {
            const place   = this._symPlace[i] ?? null;
            const attendu = positions.find(p => p.position === i);
            const caseEl  = grid.querySelector(`[data-index="${i}"]`);
            if (place && attendu) {
                if (place === attendu.symbole) { if (caseEl) caseEl.style.background = 'rgba(95,167,119,.22)'; }
                else { if (caseEl) caseEl.style.background = 'rgba(214,72,79,.22)'; err++; }
            } else if (attendu || place) { err++; }
        }
        this._submit(err);
    },

    // ── Écrans ────────────────────────────────────────────
    _afficherResultatLocal(erreurs, score) {
        const cont = $('jeu-contenu'); if (!cont) return;
        const ok = score > 0;
        cont.innerHTML = `
            <div style="${WRAP}">
                <div style="text-align:center;padding:1.2rem;border-radius:14px;
                    background:${ok ? 'rgba(95,167,119,.12)' : 'rgba(214,72,79,.12)'};
                    border:1.5px solid ${ok ? 'rgba(95,167,119,.4)' : 'rgba(214,72,79,.3)'};">
                    <div style="font-size:2.2rem;">${ok ? '\u2705' : '\u274c'}</div>
                    <div style="font-weight:800;font-size:1.05rem;margin-top:6px;color:var(--mgu-encre-900);">
                        ${erreurs === 0 ? 'Score parfait !' : (ok ? 'Bien jou\u00e9 !' : 'Trop d\u2019erreurs')}
                    </div>
                    <div style="font-size:.9rem;color:var(--mgu-encre-600);margin-top:4px;">
                        Erreurs : ${erreurs} / Seuil : ${this._seuil} \u2014 <strong style="color:${ok ? '#2f5f42' : '#8a2f33'};">${score} pt${score !== 1 ? 's' : ''}</strong>
                    </div>
                </div>
                <p style="text-align:center;font-size:.85rem;color:var(--mgu-encre-600);">En attente des autres joueurs\u2026</p>
            </div>`;
    },

    _ecranAttente(msg) {
        const cont = $('jeu-contenu'); if (!cont) return;
        cont.innerHTML = `
            <div style="${WRAP}">
                <div style="text-align:center;padding:1.6rem;border-radius:14px;
                    background:rgba(232,178,59,.08);border:1.5px solid rgba(232,178,59,.3);">
                    <div style="font-size:2rem;">\ud83e\udde0</div>
                    <div style="font-weight:700;font-size:.95rem;margin-top:8px;color:var(--mgu-or-600);">${esc(msg)}</div>
                </div>
            </div>`;
    },

    _renderClassementScreen(titre) {
        const cont = $('jeu-contenu'); if (!cont) return;
        cont.innerHTML = `
            <div style="${WRAP}">
                <div style="${TITRE}">\ud83c\udfc1 ${esc(titre)}</div>
                <div id="mp-classement" style="display:flex;flex-direction:column;gap:6px;"></div>
                <p style="text-align:center;font-size:.85rem;color:var(--mgu-encre-600);">En attente du prochain d\u00e9fi\u2026</p>
            </div>`;
        this._renderClassement();
    },

    _renderClassement() {
        const el = $('mp-classement'); if (!el) return;
        const moi = this._session?.pseudo;
        const lignes = Object.entries(this._scores || {})
            .sort((a, b) => (b[1] || 0) - (a[1] || 0));
        if (!lignes.length) {
            el.innerHTML = `<p style="text-align:center;font-size:.82rem;color:var(--mgu-encre-600);">Scores en cours\u2026</p>`;
            return;
        }
        el.innerHTML = lignes.map(([p, pts], i) => {
            const isMe = p === moi;
            return `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:10px;
                background:${isMe ? 'rgba(196,181,253,.14)' : 'rgba(255,255,255,.05)'};
                border:1px solid ${isMe ? 'rgba(196,181,253,.4)' : 'rgba(255,255,255,.1)'};">
                <span style="min-width:22px;font-weight:800;color:var(--mgu-or-600);">${i + 1}</span>
                <span style="flex:1;font-weight:700;color:${isMe ? 'var(--mgu-or-600)' : '#fff'};">${isMe ? '\ud83d\udc64 ' : ''}${esc(p)}</span>
                <span style="font-weight:800;color:var(--mgu-or-600);">${pts} pt${pts !== 1 ? 's' : ''}</span>
            </div>`;
        }).join('');
    },

    // ── Timers (registre + garde de génération) ───────────
    _animerBarre(gen, dureeMs, cb) {
        const bar = $('mp-barre');
        if (!bar || !(dureeMs > 0)) { if (gen === this._gen) cb(); return; }
        const debut = Date.now();
        const iv = setInterval(() => {
            if (gen !== this._gen) { clearInterval(iv); return; }
            const t = Date.now() - debut;
            bar.style.width = Math.min(100, (t / dureeMs) * 100) + '%';
            if (t >= dureeMs) { clearInterval(iv); cb(); }
        }, 50);
        this._timers.push(['i', iv]);
    },

    _addTimeout(fn, ms) { const id = setTimeout(fn, ms); this._timers.push(['t', id]); return id; },

    _clearTimers() {
        this._timers.forEach(([k, id]) => k === 't' ? clearTimeout(id) : clearInterval(id));
        this._timers = [];
    },
};

JeuRegistry.register('memoire', MemoireModule);
console.log('[MP] \u2705 MemoireModule enregistr\u00e9 dans JeuRegistry');

export { MemoireModule };