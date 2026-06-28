// ======================================================
// 🃏 server/games/uno.js — v1.0
// ======================================================
// Jeu UNO — server-authoritative, multi-joueurs WebSocket.
//
// Règles implémentées :
//   - Deck 108 cartes standard
//   - 7 cartes par joueur au départ
//   - Effets : +2 (cumulables), +4 (cumulables), Passe, Inversion, Joker
//   - Annonce UNO obligatoire à 1 carte (pénalité +2 si pris en faute)
//   - Sens de jeu (horaire / anti-horaire)
//   - Scoring : valeur numérique + 20pts cartes spéciales + 50pts jokers
//   - getSessionState() pour reconnexion propre
//
// Flux WS HOST_ACTION : uno:load | uno:challenge_uno
// Flux WS PLAYER_ACTION : uno:play | uno:draw | uno:say_uno | uno:choose_color
//
// Events broadcastés :
//   UNO_STATE        — état complet public (main masquée)
//   UNO_HAND         — main privée envoyée à chaque joueur
//   UNO_TURN         — changement de tour
//   UNO_EFFECT       — effet d'une carte joué
//   UNO_UNO_SAID     — annonce UNO
//   UNO_WINNER       — fin de partie
//   UNO_SCORES       — scores finaux + SCORES_UPDATE
//   UNO_ERROR        — erreur action (carte invalide, pas ton tour…)
//   UNO_CHOOSE_COLOR — demande choix de couleur (Joker / +4)
// ======================================================

import store from '../store.js';

const sessions = new Map();

// ─────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────

const COULEURS   = ['rouge', 'vert', 'bleu', 'jaune'];
const VALEURS    = ['0','1','2','3','4','5','6','7','8','9','+2','passe','inversion'];
const JOKER_TYPES = ['joker', 'plus4'];

const VALEUR_POINTS = {
    '0':1,'1':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,
    '+2':20, 'passe':20, 'inversion':20,
    'joker':50, 'plus4':50,
};

// ─────────────────────────────────────────────────────
// DECK
// ─────────────────────────────────────────────────────

function _creerDeck() {
    const deck = [];
    // Cartes colorées : 0 x1 par couleur, 1-9 +2 passe inversion x2
    for (const couleur of COULEURS) {
        deck.push({ couleur, valeur: '0' });
        for (const valeur of VALEURS.filter(v => v !== '0')) {
            deck.push({ couleur, valeur });
            deck.push({ couleur, valeur });
        }
    }
    // Jokers × 4, +4 × 4
    for (let i = 0; i < 4; i++) {
        deck.push({ couleur: null, valeur: 'joker' });
        deck.push({ couleur: null, valeur: 'plus4' });
    }
    return deck;
}

function _melanger(deck) {
    const d = [...deck];
    for (let i = d.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
}

function _piocher(s, n = 1) {
    const cartes = [];
    for (let i = 0; i < n; i++) {
        if (s.pioche.length === 0) _recyclePile(s);
        if (s.pioche.length === 0) break;
        cartes.push(s.pioche.pop());
    }
    return cartes;
}

function _recyclePile(s) {
    if (s.defausse.length <= 1) return;
    const top = s.defausse[s.defausse.length - 1];
    const reste = s.defausse.splice(0, s.defausse.length - 1);
    s.pioche = _melanger(reste.map(c => ({ ...c, couleur: c.couleur || null })));
    s.defausse = [top];
    console.log('[UNO] ♻️ Pioche recyclée depuis la défausse');
}

// ─────────────────────────────────────────────────────
// SESSION
// ─────────────────────────────────────────────────────

function _getSession(partieId) { return sessions.get(partieId) || null; }

function _creerSession(partieId, joueurs) {
    const deck = _melanger(_creerDeck());
    const mains = {};
    // Distribuer 7 cartes à chaque joueur
    const piocheRestante = [...deck];
    for (const j of joueurs) {
        mains[j] = [];
        for (let i = 0; i < 7; i++) mains[j].push(piocheRestante.pop());
    }

    // Première carte défausse (pas de joker/+4 en premier)
    let premiereCarte;
    do {
        premiereCarte = piocheRestante.pop();
        if (JOKER_TYPES.includes(premiereCarte.valeur)) {
            piocheRestante.unshift(premiereCarte); // remettre en bas
            premiereCarte = null;
        }
    } while (!premiereCarte);

    const s = {
        phase          : 'jeu',
        joueurs        : [...joueurs],
        mains,
        pioche         : piocheRestante,
        defausse       : [premiereCarte],
        indexActuel    : 0,
        sensHoraire    : true,
        couleurActive  : premiereCarte.couleur,
        valeurActive   : premiereCarte.valeur,
        accumulateur   : 0,       // cumul +2/+4 en attente
        attenteCouleur : false,   // attend le choix de couleur post-joker
        unoAnnonces    : new Set(),
        timerHandle    : null,
        gagnant        : null,
    };

    // Appliquer l'effet de la première carte si besoin
    if (premiereCarte.valeur === 'inversion') {
        s.sensHoraire = false;
    }

    sessions.set(partieId, s);
    console.log(`[UNO] ✅ Session créée — ${joueurs.length} joueurs, première carte: ${JSON.stringify(premiereCarte)}`);
    return s;
}

function _detruireSession(partieId) {
    const s = sessions.get(partieId);
    if (s?.timerHandle) clearTimeout(s.timerHandle);
    sessions.delete(partieId);
}

// ─────────────────────────────────────────────────────
// RÈGLES
// ─────────────────────────────────────────────────────

function _joueurActuel(s) { return s.joueurs[s.indexActuel]; }

function _joueurSuivant(s, skip = 1) {
    const n = s.joueurs.length;
    const dir = s.sensHoraire ? 1 : -1;
    return s.joueurs[((s.indexActuel + dir * skip) % n + n) % n];
}

function _avancerTour(s, skip = 1) {
    const n = s.joueurs.length;
    const dir = s.sensHoraire ? 1 : -1;
    s.indexActuel = ((s.indexActuel + dir * skip) % n + n) % n;
}

function _carteJouable(s, carte) {
    if (s.attenteCouleur) return false;
    const top = s.defausse[s.defausse.length - 1];
    // Si accumulation +2/+4 en cours, on ne peut jouer que la même carte
    if (s.accumulateur > 0) {
        if (top.valeur === '+2')   return carte.valeur === '+2';
        if (top.valeur === 'plus4') return carte.valeur === 'plus4';
        return false;
    }
    if (JOKER_TYPES.includes(carte.valeur)) return true;
    if (carte.couleur === s.couleurActive)   return true;
    if (carte.valeur  === s.valeurActive)    return true;
    return false;
}

function _appliquerEffet(s, carte, couleurChoisie) {
    s.defausse.push(carte);
    s.valeurActive  = carte.valeur;
    s.couleurActive = carte.couleur || couleurChoisie || s.couleurActive;

    switch (carte.valeur) {
        case '+2':
            s.accumulateur += 2;
            _avancerTour(s);
            break;
        case 'plus4':
            s.accumulateur += 4;
            s.attenteCouleur = true;
            break;
        case 'joker':
            s.attenteCouleur = true;
            break;
        case 'passe':
            _avancerTour(s, 2); // saute le suivant
            break;
        case 'inversion':
            if (s.joueurs.length === 2) {
                // En 2 joueurs, inversion = passe
                _avancerTour(s, 2);
            } else {
                s.sensHoraire = !s.sensHoraire;
                _avancerTour(s);
            }
            break;
        default:
            _avancerTour(s);
    }
}

function _calculerScores(s, gagnant) {
    // Le gagnant marque la somme des points dans les mains adverses
    let total = 0;
    for (const [pseudo, main] of Object.entries(s.mains)) {
        if (pseudo === gagnant) continue;
        for (const c of main) total += (VALEUR_POINTS[c.valeur] || 0);
    }
    return { [gagnant]: total };
}

// ─────────────────────────────────────────────────────
// PAYLOAD PUBLIC (sans mains)
// ─────────────────────────────────────────────────────

function _publicState(s, partieId) {
    return {
        phase        : s.phase,
        joueurs      : s.joueurs,
        tourActuel   : _joueurActuel(s),
        sensHoraire  : s.sensHoraire,
        couleurActive: s.couleurActive,
        valeurActive : s.valeurActive,
        accumulateur : s.accumulateur,
        attenteCouleur: s.attenteCouleur,
        cartesParJoueur: Object.fromEntries(
            s.joueurs.map(j => [j, s.mains[j]?.length ?? 0])
        ),
        pioches      : s.pioche.length,
        derniereCarteDefausse: s.defausse[s.defausse.length - 1] || null,
        gagnant      : s.gagnant,
        scores       : store.getScores(partieId),
    };
}

// ─────────────────────────────────────────────────────
// API PUBLIQUE
// ─────────────────────────────────────────────────────

// Reconnexion (REJOIN_OK) : si pseudo est fourni et qu'il a une main dans
// la session, on l'inclut dans `_hand` pour que le client puisse rehydrater
// sa main privée. Le reste du payload reste public (cartesParJoueur, défausse,
// tour…) → identique à ce que tous les autres clients voient.
export function getSessionState(partieId, pseudo) {
    const s = _getSession(partieId);
    if (!s) return null;
    const base = _publicState(s, partieId);
    if (pseudo && s.mains[pseudo]) {
        base._hand = {
            main       : s.mains[pseudo],
            jouablesIdx: s.mains[pseudo]
                .map((c, i) => _carteJouable(s, c) ? i : -1)
                .filter(i => i >= 0),
        };
    }
    return base;
}

export function detruireSession(partieId) {
    _detruireSession(partieId);
    console.log(`[UNO] 🗑️ Session détruite: ${partieId}`);
}

// ─────────────────────────────────────────────────────
// BROADCAST HELPERS
// ─────────────────────────────────────────────────────

function _broadcastState(wss, partieId, s, helpers) {
    const { broadcastToGame } = helpers;
    broadcastToGame(wss, partieId, 'UNO_STATE', _publicState(s, partieId));
}

function _envoyerMains(wss, partieId, s, helpers) {
    const { sendToPseudo } = helpers;
    for (const pseudo of s.joueurs) {
        sendToPseudo(wss, partieId, pseudo, 'UNO_HAND', {
            main: s.mains[pseudo] || [],
            jouablesIdx: (s.mains[pseudo] || []).map((c, i) => _carteJouable(s, c) ? i : -1).filter(i => i >= 0),
        });
    }
}

function _annoncer(wss, partieId, s, helpers, contexte = '') {
    _broadcastState(wss, partieId, s, helpers);
    _envoyerMains(wss, partieId, s, helpers);
    if (contexte) console.log(`[UNO] ${contexte} — tour: ${_joueurActuel(s)}`);
}

// ─────────────────────────────────────────────────────
// FIN DE PARTIE
// ─────────────────────────────────────────────────────

function _finirPartie(wss, partieId, s, gagnant, helpers) {
    if (s.timerHandle) { clearTimeout(s.timerHandle); s.timerHandle = null; }
    s.phase   = 'terminee';
    s.gagnant = gagnant;

    const scores = _calculerScores(s, gagnant);
    for (const [pseudo, pts] of Object.entries(scores)) {
        store.modifierScore(partieId, pseudo, pts);
    }

    const scoresFinaux = store.getScores(partieId);
    const { broadcastToGame } = helpers;

    broadcastToGame(wss, partieId, 'UNO_WINNER', {
        gagnant,
        scores : scoresFinaux,
        mains  : s.mains,
    });
    broadcastToGame(wss, partieId, 'SCORES_UPDATE', { scores: scoresFinaux });
    console.log(`[UNO] 🏆 Gagnant: ${gagnant} (+${scores[gagnant] || 0}pts)`);
}

// ─────────────────────────────────────────────────────
// HOST ACTIONS
// ─────────────────────────────────────────────────────

export function handleHostAction(wss, ws, partieId, action, data, helpers) {
    const { send, broadcastToGame } = helpers;
    const cmd = action.split(':')[1];

    switch (cmd) {

        case 'load': {
            const partie = store.getPartie(partieId);
            if (!partie) return send(ws, 'ERROR', { code: 'NO_ACTIVE_GAME' });
            const joueurs = (partie.joueurs || []).map(j => j.pseudo);
            if (joueurs.length < 2) {
                return send(ws, 'ERROR', { code: 'UNO_NOT_ENOUGH_PLAYERS', message: 'UNO nécessite au moins 2 joueurs.' });
            }

            let s = _getSession(partieId);
            if (s) _detruireSession(partieId);
            s = _creerSession(partieId, joueurs);

            _annoncer(wss, partieId, s, helpers, '🃏 Partie UNO démarrée');

            broadcastToGame(wss, partieId, 'UNO_TURN', {
                tourActuel   : _joueurActuel(s),
                couleurActive: s.couleurActive,
                accumulateur : s.accumulateur,
            });
            break;
        }

        case 'challenge_uno': {
            // L'hôte déclare qu'un joueur n'a pas annoncé UNO
            const { cible } = data;
            const s = _getSession(partieId);
            if (!s) return send(ws, 'ERROR', { code: 'UNO_NO_SESSION' });
            if (!cible || !s.mains[cible]) return send(ws, 'ERROR', { code: 'UNO_PLAYER_NOT_FOUND' });

            if (s.mains[cible].length === 1 && !s.unoAnnonces.has(cible)) {
                // Pénalité : +2
                const penalite = _piocher(s, 2);
                s.mains[cible].push(...penalite);
                s.unoAnnonces.delete(cible);

                broadcastToGame(wss, partieId, 'UNO_PENALTY', {
                    joueur : cible,
                    nb     : 2,
                    raison : 'UNO non annoncé',
                });
                _annoncer(wss, partieId, s, helpers, `⚠️ Pénalité UNO sur ${cible}`);
            } else {
                send(ws, 'UNO_ERROR', { message: 'Challenge invalide — UNO bien annoncé ou plus d\'1 carte.' });
            }
            break;
        }

        default:
            console.warn(`[UNO] ⚠️ Action host inconnue: ${cmd}`);
    }
}

// ─────────────────────────────────────────────────────
// PLAYER ACTIONS
// ─────────────────────────────────────────────────────

export function handlePlayerAction(wss, ws, partieId, pseudo, action, data, helpers) {
    const { send, broadcastToGame } = helpers;
    const cmd = action.split(':')[1];
    const s   = _getSession(partieId);

    if (!s) return send(ws, 'UNO_ERROR', { message: 'Partie UNO non démarrée.' });
    if (s.phase === 'terminee') return send(ws, 'UNO_ERROR', { message: 'Partie terminée.' });

    switch (cmd) {

        // ── JOUER UNE CARTE ──────────────────────────
        case 'play': {
            if (_joueurActuel(s) !== pseudo) {
                return send(ws, 'UNO_ERROR', { message: "Ce n'est pas ton tour." });
            }
            if (s.attenteCouleur) {
                return send(ws, 'UNO_ERROR', { message: 'Choisis une couleur d\'abord.' });
            }

            const { index } = data;
            const main = s.mains[pseudo];
            if (!main || index < 0 || index >= main.length) {
                return send(ws, 'UNO_ERROR', { message: 'Carte invalide.' });
            }

            const carte = main[index];
            if (!_carteJouable(s, carte)) {
                return send(ws, 'UNO_ERROR', { message: 'Cette carte ne peut pas être jouée maintenant.' });
            }

            // Retirer la carte de la main
            main.splice(index, 1);
            s.unoAnnonces.delete(pseudo); // reset annonce à chaque jeu

            // Victoire ?
            if (main.length === 0) {
                // Joker/+4 sans couleur choisie → demander la couleur avant de finir
                if (JOKER_TYPES.includes(carte.valeur)) {
                    s.defausse.push(carte);
                    s.valeurActive = carte.valeur;
                    s.attenteCouleur = true;
                    s._pendingWinner = pseudo;

                    send(ws, 'UNO_CHOOSE_COLOR', { raison: 'play_and_win' });
                    broadcastToGame(wss, partieId, 'UNO_EFFECT', {
                        joueur: pseudo, carte, effet: 'joker_fin',
                        attenteCouleur: true,
                    });
                    _broadcastState(wss, partieId, s, helpers);
                    return;
                }
                _appliquerEffet(s, carte, null);
                _finirPartie(wss, partieId, s, pseudo, helpers);
                return;
            }

            // Besoin du choix de couleur (Joker / +4)
            if (JOKER_TYPES.includes(carte.valeur)) {
                s.defausse.push(carte);
                s.valeurActive = carte.valeur;
                if (carte.valeur === 'plus4') s.accumulateur += 4;
                s.attenteCouleur = true;

                broadcastToGame(wss, partieId, 'UNO_EFFECT', {
                    joueur: pseudo, carte,
                    effet : carte.valeur === 'plus4' ? `+${s.accumulateur}` : 'joker',
                    attenteCouleur: true,
                });
                send(ws, 'UNO_CHOOSE_COLOR', { raison: 'play' });
                _broadcastState(wss, partieId, s, helpers);
                _envoyerMains(wss, partieId, s, helpers);
                return;
            }

            // Carte normale/spéciale (non-joker)
            _appliquerEffet(s, carte, null);

            // Si accumulation doit être absorbée immédiatement (joueur suivant pioche)
            if (carte.valeur !== '+2' && s.accumulateur > 0) {
                // Ne devrait pas arriver hors jokers — sécurité
                s.accumulateur = 0;
            }

            broadcastToGame(wss, partieId, 'UNO_EFFECT', {
                joueur       : pseudo,
                carte,
                effet        : carte.valeur,
                tourSuivant  : _joueurActuel(s),
                accumulateur : s.accumulateur,
            });

            _annoncer(wss, partieId, s, helpers, `🃏 ${pseudo} joue ${carte.couleur} ${carte.valeur}`);
            broadcastToGame(wss, partieId, 'UNO_TURN', {
                tourActuel   : _joueurActuel(s),
                couleurActive: s.couleurActive,
                accumulateur : s.accumulateur,
            });
            break;
        }

        // ── CHOISIR UNE COULEUR (post-joker) ─────────
        case 'choose_color': {
            if (!s.attenteCouleur) {
                return send(ws, 'UNO_ERROR', { message: 'Pas de choix de couleur attendu.' });
            }
            // Seul le joueur qui a posé le joker peut choisir
            // Le joueur précédent = celui qui vient de jouer (on est avant le tour suivant)
            const { couleur } = data;
            if (!COULEURS.includes(couleur)) {
                return send(ws, 'UNO_ERROR', { message: 'Couleur invalide.' });
            }

            s.couleurActive  = couleur;
            s.attenteCouleur = false;

            // Si victoire pendante (main vide après joker)
            if (s._pendingWinner) {
                const gagnant = s._pendingWinner;
                delete s._pendingWinner;
                _finirPartie(wss, partieId, s, gagnant, helpers);
                return;
            }

            // Appliquer le tour maintenant (le +4 ou joker avance déjà dans play)
            // Pour +4 : le joueur suivant doit piocher s.accumulateur cartes
            if (s.accumulateur > 0) {
                const suivant = _joueurActuel(s);
                const piochees = _piocher(s, s.accumulateur);
                s.mains[suivant].push(...piochees);
                broadcastToGame(wss, partieId, 'UNO_EFFECT', {
                    joueur: suivant, carte: null,
                    effet : `pioche_${s.accumulateur}`,
                    nb    : s.accumulateur,
                });
                s.accumulateur = 0;
                _avancerTour(s);
            }

            broadcastToGame(wss, partieId, 'UNO_COLOR_CHOSEN', {
                couleur, joueur: pseudo,
                tourSuivant: _joueurActuel(s),
            });
            _annoncer(wss, partieId, s, helpers, `🎨 Couleur choisie: ${couleur}`);
            broadcastToGame(wss, partieId, 'UNO_TURN', {
                tourActuel   : _joueurActuel(s),
                couleurActive: s.couleurActive,
                accumulateur : s.accumulateur,
            });
            break;
        }

        // ── PIOCHER ───────────────────────────────────
        case 'draw': {
            if (_joueurActuel(s) !== pseudo) {
                return send(ws, 'UNO_ERROR', { message: "Ce n'est pas ton tour." });
            }
            if (s.attenteCouleur) {
                return send(ws, 'UNO_ERROR', { message: 'Choisis une couleur d\'abord.' });
            }

            const nb = s.accumulateur > 0 ? s.accumulateur : 1;
            const piochees = _piocher(s, nb);
            s.mains[pseudo].push(...piochees);
            s.accumulateur = 0;

            broadcastToGame(wss, partieId, 'UNO_EFFECT', {
                joueur: pseudo, carte: null,
                effet : `pioche_${nb}`, nb,
            });

            // Après la pioche : si 1 seule carte piochée, le joueur peut la jouer
            // sinon le tour passe
            if (nb === 1 && piochees.length === 1 && _carteJouable(s, piochees[0])) {
                // Le joueur a la main — on lui envoie sa main et on attend
                send(ws, 'UNO_DRAW_PLAYABLE', { carte: piochees[0], index: s.mains[pseudo].length - 1 });
                _broadcastState(wss, partieId, s, helpers);
                _envoyerMains(wss, partieId, s, helpers);
            } else {
                // Tour suivant
                _avancerTour(s);
                _annoncer(wss, partieId, s, helpers, `📦 ${pseudo} pioche ${nb}`);
                broadcastToGame(wss, partieId, 'UNO_TURN', {
                    tourActuel   : _joueurActuel(s),
                    couleurActive: s.couleurActive,
                    accumulateur : s.accumulateur,
                });
            }
            break;
        }

        // ── PASSER après pioche jouable non jouée ─────
        case 'pass': {
            if (_joueurActuel(s) !== pseudo) {
                return send(ws, 'UNO_ERROR', { message: "Ce n'est pas ton tour." });
            }
            _avancerTour(s);
            _annoncer(wss, partieId, s, helpers, `⏭️ ${pseudo} passe`);
            broadcastToGame(wss, partieId, 'UNO_TURN', {
                tourActuel   : _joueurActuel(s),
                couleurActive: s.couleurActive,
                accumulateur : s.accumulateur,
            });
            break;
        }

        // ── DIRE UNO ──────────────────────────────────
        case 'say_uno': {
            if (s.mains[pseudo]?.length === 1) {
                s.unoAnnonces.add(pseudo);
                broadcastToGame(wss, partieId, 'UNO_UNO_SAID', { joueur: pseudo });
                console.log(`[UNO] 🔔 UNO annoncé par ${pseudo}`);
            } else {
                send(ws, 'UNO_ERROR', { message: 'UNO impossible (tu as plus d\'une carte).' });
            }
            break;
        }

        default:
            console.warn(`[UNO] ⚠️ Action joueur inconnue: ${cmd}`);
    }
}