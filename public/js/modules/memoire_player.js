// ============================================================
// /js/modules/memoire_player.js — v1.0 (migration WS)
// ============================================================
// Module invité Mémoire. Auto-enregistré dans JeuRegistry.
// L'invité reçoit MEMOIRE_DEFI (mêmes données que l'hôte) et joue
// le même défi en parallèle dans #jeu-contenu, calcule ses erreurs
// puis soumet son résultat via PLAYER_ACTION memoire:result.
//
// Formule de score IDENTIQUE au client hôte (calculerScore) :
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
    { nom:"Rose",   hex:"#ec407a" }, { nom:"Cyan",   hex:"#00d4ff" },
];

const WRAP = 'padding:1rem 0;display:flex;flex-direction:column;gap:14px;align-items:stretch;';
const TITRE = 'text-align:center;font-size:1rem;font-weight:800;color:#c4b5fd;';
const BARRE_WRAP = 'height:8px;background:rgba(255,255,255,.08);border-radius:6px;overflow:hidden;';
const BARRE = 'height:100%;width:0%;background:linear-gradient(90deg,#a78bfa,#00d4ff);transition:width .05s linear;';
const BTN = 'padding:10px 18px;border-radius:10px;font-weight:700;font-family:inherit;cursor:pointer;border:1.5px solid rgba(167,139,250,.45);background:rgba(167,139,250,.18);color:#fff;';

const MemoireModule = {
    _session:null, _socket:null,
    _typeDefi:null, _difficulte:null, _config:null, _base:3, _seuil:0,
    _termine:false, _resultEnvoye:false, _erreurs:0,
    _timerId:null, _reponse:[], _scores:{},

    initPlayer(session, sock, gameState, snapshot) {
        this._session = session;
        this._socket  = sock;
        this._scores  = (snapshot?.scores) || {};
        this._ecranAttente('En attente du choix de l\u2019h\u00f4te\u2026');

        if (gameState) {
            this._scores = gameState.scores || this._scores;
            if ((gameState.phase === 'affichage' || gameState.phase === 'jeu') && gameState.donnees) {
                this._onDefi(gameState);
            } else if (gameState.phase === 'resultats') {
                this._ecranAttente('Manche termin\u00e9e. En attente du prochain d\u00e9fi\u2026');
            }
        }
    },

    destroy() { this._stopTimer(); },

    onScores(scores) { if (scores) this._scores = scores; },

    onWsEvent(evt, payload) {
        switch (evt) {
            case 'MEMOIRE_DEFI':       this._onDefi(payload);  break;
            case 'MEMOIRE_PHASE':      this._onPhase(payload); break;
            case 'MEMOIRE_RESULT_ACK': this._onAck(payload);   break;
        }
    },

    // ─────────────────────────────────────────────────────

    _onDefi(p) {
        this._typeDefi   = p.typeDefi;
        this._difficulte = p.difficulte;
        this._config     = p.config || {};
        this._base       = p.base ?? 3;
        this._seuil      = this._config.seuilErreurs ?? 0;
        if (p.scores) this._scores = p.scores;

        if (!p.typeDefi || p.phase === 'menu') {
            this._ecranAttente('En attente du choix de l\u2019h\u00f4te\u2026');
            return;
        }
        if (p.phase === 'countdown') {
            this._ecranAttente('\u23f3 Pr\u00e9pare-toi\u2026');
            return;
        }
        if (p.phase === 'affichage' && p.donnees != null) {
            this._demarrerDefi(p.typeDefi, p.donnees);
        }
    },

    _onPhase(p) {
        if (p.phase === 'resultats' && !this._resultEnvoye) {
            // Le temps est écoulé côté hôte : on fige et on soumet l'état courant.
            this._ecranAttente('Manche termin\u00e9e.');
        }
    },

    _onAck({ status }) {
        if (status && status !== 'ok' && status !== 'already') {
            console.warn('[MP-MEMOIRE] result ack:', status);
        }
    },

    // ─────────────────────────────────────────────────────

    _demarrerDefi(typeDefi, donnees) {
        this._stopTimer();
        this._termine = false;
        this._resultEnvoye = false;
        this._erreurs = 0;
        this._reponse = [];

        switch (typeDefi) {
            case 'paires':   this._jouerPaires(donnees); break;
            case 'suite':    this._jouerSuite(donnees); break;
            case 'couleurs': this._jouerCouleurs(donnees.couleurs || donnees); break;
            case 'symboles': this._jouerSymboles(donnees); break;
            default:         this._ecranAttente('D\u00e9fi inconnu.');
        }
    },

    _submit(erreurs) {
        if (this._resultEnvoye) return;
        this._resultEnvoye = true;
        this._termine = true;
        this._stopTimer();
        const score = erreurs > this._seuil ? 0 : (erreurs === 0 ? this._base : 1);
        try {
            this._socket.send('PLAYER_ACTION', { action: 'memoire:result', data: { erreurs, score } });
        } catch (e) { console.error('[MP-MEMOIRE] send result:', e.message); }
        this._afficherResultatLocal(erreurs, score);
    },

    // ── Défi 1 : paires ──────────────────────────────────
    _jouerPaires(cartes) {
        const cont = $('jeu-contenu'); if (!cont) return;
        const cols = parseInt(String(this._config.gridSize || '4x2').split('x')[0], 10) || 4;
        cont.innerHTML = `
            <div style="${WRAP}">
                <div style="${TITRE}">\ud83c\udccf M\u00e9morise les paires</div>
                <div style="${BARRE_WRAP}"><div id="mp-barre" style="${BARRE}"></div></div>
                <div id="mp-grille" style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:8px;"></div>
                <p id="mp-status" style="text-align:center;font-size:.85rem;color:rgba(255,255,255,.6);">M\u00e9morise\u2026</p>
            </div>`;
        const grille = $('mp-grille');
        grille.innerHTML = cartes.map((sym, i) => `
            <div data-index="${i}" data-symbole="${esc(sym)}"
                style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;
                font-size:1.8rem;background:rgba(167,139,250,.15);border:1.5px solid rgba(167,139,250,.35);
                border-radius:10px;cursor:default;">${esc(sym)}</div>`).join('');

        this._animerBarre(this._config.tempsAffichage || 5000, () => {
            grille.querySelectorAll('[data-index]').forEach(c => { c.textContent = '?'; c.style.cursor = 'pointer'; c.style.color = 'rgba(255,255,255,.35)'; });
            const st = $('mp-status'); if (st) st.textContent = '\u00c0 toi ! (Erreurs : 0)';
            this._activerClicPaires(cartes.length / 2);
        });
    },

    _activerClicPaires(nbPaires) {
        let sel = null, bloque = false, restantes = nbPaires;
        const grille = $('mp-grille'); if (!grille) return;
        grille.querySelectorAll('[data-index]').forEach(carte => {
            carte.onclick = () => {
                if (bloque || carte.classList.contains('ok') || carte === sel) return;
                carte.textContent = carte.dataset.symbole; carte.style.color = '#fff';
                if (!sel) { sel = carte; return; }
                bloque = true;
                if (sel.dataset.symbole === carte.dataset.symbole) {
                    setTimeout(() => {
                        sel.classList.add('ok'); carte.classList.add('ok');
                        sel.style.background = 'rgba(34,197,94,.22)'; carte.style.background = 'rgba(34,197,94,.22)';
                        sel = null; bloque = false;
                        if (--restantes === 0) this._submit(this._erreurs);
                    }, 350);
                } else {
                    this._erreurs++;
                    const st = $('mp-status'); if (st) st.textContent = `Erreurs : ${this._erreurs}`;
                    setTimeout(() => {
                        carte.textContent = '?'; carte.style.color = 'rgba(255,255,255,.35)';
                        sel.textContent = '?'; sel.style.color = 'rgba(255,255,255,.35)';
                        sel = null; bloque = false;
                    }, 850);
                }
            };
        });
    },

    // ── Défi 2 : suite ───────────────────────────────────
    _jouerSuite(suite) {
        const cont = $('jeu-contenu'); if (!cont) return;
        cont.innerHTML = `
            <div style="${WRAP}">
                <div style="${TITRE}">\ud83d\udd22 Retiens la suite</div>
                <div style="${BARRE_WRAP}"><div id="mp-barre" style="${BARRE}"></div></div>
                <div id="mp-affichage" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;">
                    ${suite.map(v => `<div style="min-width:44px;padding:10px;border-radius:8px;font-weight:800;font-size:1.3rem;text-align:center;background:rgba(167,139,250,.18);border:1.5px solid rgba(167,139,250,.4);">${esc(v)}</div>`).join('')}
                </div>
                <div id="mp-input" style="display:none;flex-direction:column;gap:10px;">
                    <p style="text-align:center;font-size:.85rem;color:rgba(255,255,255,.6);">Reconstitue la suite :</p>
                    <div id="mp-reponse" style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;min-height:40px;"></div>
                    <div id="mp-clavier" style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;">${this._clavierSuite(this._config.type)}</div>
                    <div style="display:flex;gap:8px;justify-content:center;">
                        <button id="mp-effacer" style="${BTN}background:rgba(255,255,255,.1);">\ud83d\uddd1\ufe0f Effacer</button>
                        <button id="mp-valider" style="${BTN}">\u2705 Valider</button>
                    </div>
                </div>
            </div>`;

        this._animerBarre(this._config.tempsAffichage || 5000, () => {
            const aff = $('mp-affichage'); if (aff) aff.style.display = 'none';
            const inp = $('mp-input'); if (inp) inp.style.display = 'flex';
            const rep = $('mp-reponse');
            $('mp-clavier').querySelectorAll('button').forEach(b => {
                b.onclick = () => {
                    this._reponse.push(b.dataset.val);
                    const it = document.createElement('div');
                    it.style.cssText = 'min-width:36px;padding:6px;border-radius:6px;font-weight:800;text-align:center;background:rgba(255,255,255,.1);';
                    it.textContent = b.dataset.val;
                    rep.appendChild(it);
                };
            });
            $('mp-effacer').onclick = () => { this._reponse = []; rep.innerHTML = ''; };
            $('mp-valider').onclick = () => {
                const norm = this._reponse.map(r => isNaN(r) ? r : parseInt(r, 10));
                let err = 0;
                for (let i = 0; i < suite.length; i++) { if (suite[i] !== norm[i]) err++; }
                this._submit(err);
            };
        });
    },

    _clavierSuite(type) {
        const btn = v => `<button data-val="${esc(v)}" style="${BTN}min-width:42px;padding:8px 12px;">${esc(v)}</button>`;
        const chiffres = Array.from({ length: 10 }, (_, i) => btn(i)).join('');
        const symb = SYMBOLES_SUITE.slice(0, 12).map(btn).join('');
        if (type === 'nombres') return chiffres;
        if (type === 'mixte')   return chiffres + symb;
        return symb;
    },

    // ── Défi 3 : couleurs ────────────────────────────────
    _jouerCouleurs(couleurs) {
        const cont = $('jeu-contenu'); if (!cont) return;
        cont.innerHTML = `
            <div style="${WRAP}">
                <div style="${TITRE}">\ud83c\udfa8 Retiens les couleurs</div>
                <div style="display:flex;justify-content:center;">
                    <div id="mp-couleur" style="width:140px;height:140px;border-radius:18px;display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;background:transparent;border:1px solid rgba(255,255,255,.1);"></div>
                </div>
                <div id="mp-input" style="display:none;flex-direction:column;gap:10px;">
                    <p style="text-align:center;font-size:.85rem;color:rgba(255,255,255,.6);">Reconstitue la s\u00e9quence (${couleurs.length}) :</p>
                    <div id="mp-reponse" style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;min-height:36px;"></div>
                    <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;">
                        ${COULEURS.map(c => `<button data-nom="${c.nom}" title="${c.nom}" style="width:42px;height:42px;border-radius:10px;border:2px solid rgba(255,255,255,.2);cursor:pointer;background:${c.hex};"></button>`).join('')}
                    </div>
                    <div style="display:flex;gap:8px;justify-content:center;">
                        <button id="mp-effacer" style="${BTN}background:rgba(255,255,255,.1);">\ud83d\uddd1\ufe0f Effacer</button>
                        <button id="mp-valider" style="${BTN}">\u2705 Valider</button>
                    </div>
                </div>
            </div>`;

        const disp = $('mp-couleur');
        const vitesse = this._config.vitesse || 1000;
        let idx = 0;
        const montrer = () => {
            if (idx >= couleurs.length) {
                disp.style.background = 'transparent'; disp.textContent = '';
                const inp = $('mp-input'); if (inp) inp.style.display = 'flex';
                this._activerPaletteCouleurs(couleurs);
                return;
            }
            const c = couleurs[idx];
            disp.style.background = 'transparent'; disp.textContent = '';
            setTimeout(() => { disp.style.background = c.hex; disp.textContent = c.nom; idx++; this._timerId = setTimeout(montrer, vitesse); }, 90);
        };
        montrer();
    },

    _activerPaletteCouleurs(couleurs) {
        const rep = $('mp-reponse');
        const cont = $('jeu-contenu');
        cont.querySelectorAll('button[data-nom]').forEach(btn => {
            btn.onclick = () => {
                const c = COULEURS.find(x => x.nom === btn.dataset.nom);
                this._reponse.push(c);
                const it = document.createElement('div');
                it.style.cssText = `width:30px;height:30px;border-radius:7px;background:${c.hex};border:1px solid rgba(255,255,255,.25);`;
                rep.appendChild(it);
            };
        });
        $('mp-effacer').onclick = () => { this._reponse = []; rep.innerHTML = ''; };
        $('mp-valider').onclick = () => {
            let err = 0;
            for (let i = 0; i < couleurs.length; i++) {
                if (!this._reponse[i] || couleurs[i].nom !== this._reponse[i].nom) err++;
            }
            this._submit(err);
        };
    },

    // ── Défi 4 : symboles ────────────────────────────────
    _jouerSymboles(donnees) {
        const cont = $('jeu-contenu'); if (!cont) return;
        const { positions, grille, total } = donnees;
        cont.innerHTML = `
            <div style="${WRAP}">
                <div style="${TITRE}">\u2728 M\u00e9morise les symboles</div>
                <div style="${BARRE_WRAP}"><div id="mp-barre" style="${BARRE}"></div></div>
                <div id="mp-grid" style="display:grid;grid-template-columns:repeat(${grille},1fr);gap:6px;">
                    ${Array.from({ length: total }, (_, i) => {
                        const pos = positions.find(p => p.position === i);
                        return `<div data-index="${i}" style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-size:1.6rem;background:rgba(167,139,250,.12);border:1.5px solid rgba(167,139,250,.3);border-radius:9px;"><span class="mp-sym">${pos ? esc(pos.symbole) : ''}</span></div>`;
                    }).join('')}
                </div>
                <div id="mp-pool-wrap" style="display:none;flex-direction:column;gap:8px;">
                    <p style="text-align:center;font-size:.85rem;color:rgba(255,255,255,.6);">S\u00e9lectionne un symbole puis clique sa case :</p>
                    <div id="mp-pool" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;">
                        ${positions.map(p => `<div data-symbole="${esc(p.symbole)}" style="width:52px;height:52px;display:flex;align-items:center;justify-content:center;font-size:1.7rem;background:rgba(167,139,250,.2);border:2px solid rgba(167,139,250,.4);border-radius:10px;cursor:pointer;">${esc(p.symbole)}</div>`).join('')}
                    </div>
                </div>
            </div>`;

        this._animerBarre(this._config.tempsAffichage || 6000, () => {
            $('mp-grid').querySelectorAll('.mp-sym').forEach(s => { s.textContent = ''; });
            const pw = $('mp-pool-wrap'); if (pw) pw.style.display = 'flex';
            this._activerClicSymboles(positions);
        });
    },

    _activerClicSymboles(positions) {
        let symboleSel = null, selEl = null;
        const pool = $('mp-pool'), grid = $('mp-grid');
        if (!pool || !grid) return;
        const total = positions.length;

        pool.querySelectorAll('[data-symbole]').forEach(el => {
            el.onclick = () => {
                pool.querySelectorAll('[data-symbole]').forEach(b => b.style.boxShadow = '');
                symboleSel = el.dataset.symbole; selEl = el;
                el.style.boxShadow = '0 0 0 3px rgba(0,212,255,.8)';
            };
        });

        grid.querySelectorAll('[data-index]').forEach(caseEl => {
            caseEl.onclick = () => {
                if (!symboleSel) return;
                if (caseEl.dataset.place) return; // déjà rempli
                const span = caseEl.querySelector('.mp-sym');
                if (span) span.textContent = symboleSel;
                caseEl.dataset.place = symboleSel;
                caseEl.style.background = 'rgba(0,212,255,.15)';
                if (selEl) selEl.remove();
                symboleSel = null; selEl = null;

                const placed = grid.querySelectorAll('[data-place]').length;
                if (placed >= total) setTimeout(() => this._validerSymboles(positions), 400);
            };
        });
    },

    _validerSymboles(positions) {
        const grid = $('mp-grid'); if (!grid) return;
        let err = 0;
        grid.querySelectorAll('[data-index]').forEach(caseEl => {
            const i = parseInt(caseEl.dataset.index, 10);
            const place = caseEl.dataset.place || null;
            const attendu = positions.find(p => p.position === i);
            if (place && attendu) {
                if (place === attendu.symbole) caseEl.style.background = 'rgba(34,197,94,.22)';
                else { caseEl.style.background = 'rgba(239,68,68,.22)'; err++; }
            } else if (attendu || place) { err++; }
        });
        this._submit(err);
    },

    // ── Résultat local + écrans ──────────────────────────
    _afficherResultatLocal(erreurs, score) {
        const cont = $('jeu-contenu'); if (!cont) return;
        const ok = score > 0;
        cont.innerHTML = `
            <div style="${WRAP}">
                <div style="text-align:center;padding:1.2rem;border-radius:14px;
                    background:${ok ? 'rgba(34,197,94,.12)' : 'rgba(239,68,68,.12)'};
                    border:1.5px solid ${ok ? 'rgba(34,197,94,.4)' : 'rgba(239,68,68,.3)'};">
                    <div style="font-size:2.2rem;">${ok ? '\u2705' : '\u274c'}</div>
                    <div style="font-weight:800;font-size:1.05rem;margin-top:6px;color:#fff;">
                        ${erreurs === 0 ? 'Score parfait !' : (ok ? 'Bien jou\u00e9 !' : 'Trop d\u2019erreurs')}
                    </div>
                    <div style="font-size:.9rem;color:rgba(255,255,255,.7);margin-top:4px;">
                        Erreurs : ${erreurs} / Seuil : ${this._seuil} \u2014 <strong style="color:${ok ? '#86efac' : '#fca5a5'};">${score} pt${score !== 1 ? 's' : ''}</strong>
                    </div>
                </div>
                <p style="text-align:center;font-size:.85rem;color:rgba(255,255,255,.5);">En attente du prochain d\u00e9fi\u2026</p>
            </div>`;
    },

    _ecranAttente(msg) {
        const cont = $('jeu-contenu'); if (!cont) return;
        cont.innerHTML = `
            <div style="${WRAP}">
                <div style="text-align:center;padding:1.6rem;border-radius:14px;
                    background:rgba(167,139,250,.08);border:1.5px solid rgba(167,139,250,.3);">
                    <div style="font-size:2rem;">\ud83e\udde0</div>
                    <div style="font-weight:700;font-size:.95rem;margin-top:8px;color:#c4b5fd;">${esc(msg)}</div>
                </div>
            </div>`;
    },

    // ── Timer barre ──────────────────────────────────────
    _animerBarre(duree, cb) {
        this._stopTimer();
        const bar = $('mp-barre');
        if (!bar) { cb(); return; }
        let t = 0; const inc = 50;
        this._timerId = setInterval(() => {
            t += inc;
            bar.style.width = Math.min(100, (t / duree) * 100) + '%';
            if (t >= duree) { this._stopTimer(); cb(); }
        }, inc);
    },

    _stopTimer() {
        if (this._timerId) { clearInterval(this._timerId); clearTimeout(this._timerId); this._timerId = null; }
    },
};

JeuRegistry.register('memoire', MemoireModule);
console.log('[MP] \u2705 MemoireModule enregistr\u00e9 dans JeuRegistry');

export { MemoireModule };