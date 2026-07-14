import store from '../store.js';

const sessions = new Map();
const DEFAULT_DURATION = 60;

const WORD_BANK = [
    'soleil', 'fromage', 'valise', 'montagne', 'pirate', 'cinema', 'jardin',
    'fusee', 'tunnel', 'boussole', 'orage', 'banane', 'robot', 'diamant',
    'cascade', 'volcan', 'bibliotheque', 'chocolat', 'fantome', 'sirene',
    'labyrinthe', 'couronne', 'parapluie', 'planete', 'coffre', 'miroir',
    'ballon', 'navire', 'galaxie', 'tresor'
];

function clean(value) {
    return String(value ?? '').trim();
}

function normalize(value) {
    return clean(value)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');
}

function pickWord() {
    return WORD_BANK[Math.floor(Math.random() * WORD_BANK.length)];
}

function getOrCreateSession(partieId) {
    if (!sessions.has(partieId)) {
        sessions.set(partieId, {
            phase: 'idle',
            manche: 0,
            mot: '',
            indice: '',
            reponses: new Map(),
            scoresManche: new Map(),
            startedAt: null,
            endsAt: null,
            duration: DEFAULT_DURATION,
        });
    }
    return sessions.get(partieId);
}

function publicPlayers(partieId) {
    return store.getJoueurs(partieId).map(j => ({
        pseudo: j.pseudo,
        equipe: j.equipe || null,
    }));
}

function answersPublic(session, reveal = false) {
    return Array.from(session.reponses.entries()).map(([pseudo, answer]) => ({
        pseudo,
        answered: true,
        texte: reveal ? answer.texte : null,
        correct: reveal ? answer.correct : null,
        points: reveal ? answer.points : null,
        ordre: answer.ordre,
    })).sort((a, b) => a.ordre - b.ordre);
}

function roundPayload(partieId, session) {
    return {
        manche: session.manche,
        indice: session.indice,
        duration: session.duration,
        startedAt: session.startedAt,
        endsAt: session.endsAt,
        joueurs: publicPlayers(partieId),
        answered: answersPublic(session, false),
    };
}

function revealPayload(partieId, session) {
    return {
        manche: session.manche,
        mot: session.mot,
        indice: session.indice,
        reponses: answersPublic(session, true),
        scoresManche: Object.fromEntries(session.scoresManche.entries()),
        scores: store.getScores(partieId),
    };
}

function emitScores(wss, partieId, helpers) {
    helpers.broadcastToGame(wss, partieId, 'SCORES_UPDATE', {
        scores: store.getScores(partieId),
    });
}

function canAnswer(session) {
    return session.phase === 'round' && (!session.endsAt || Date.now() <= session.endsAt);
}

function recordAnswer(wss, partieId, pseudo, texte, helpers) {
    const session = getOrCreateSession(partieId);
    if (!pseudo) return;

    if (!canAnswer(session)) {
        helpers.sendToPseudo?.(wss, partieId, pseudo, 'MOTDEPASSE_ANSWER_ACK', { status: 'too_late' });
        return;
    }

    const answer = clean(texte).slice(0, 80);
    if (!answer) {
        helpers.sendToPseudo?.(wss, partieId, pseudo, 'MOTDEPASSE_ANSWER_ACK', { status: 'empty' });
        return;
    }

    if (session.reponses.has(pseudo)) {
        helpers.sendToPseudo?.(wss, partieId, pseudo, 'MOTDEPASSE_ANSWER_ACK', { status: 'already_answered' });
        return;
    }

    const correct = normalize(answer) === normalize(session.mot);
    const goodAnswers = Array.from(session.scoresManche.values()).filter(points => points > 0).length;
    const points = correct ? Math.max(1, 3 - goodAnswers) : 0;
    const ordre = session.reponses.size + 1;

    session.reponses.set(pseudo, { texte: answer, correct, points, ordre, at: Date.now() });
    session.scoresManche.set(pseudo, points);

    if (points > 0) {
        store.modifierScore(partieId, pseudo, points);
        emitScores(wss, partieId, helpers);
    }

    helpers.sendToPseudo?.(wss, partieId, pseudo, 'MOTDEPASSE_ANSWER_ACK', {
        status: 'ok',
        texte: answer,
        correct,
        points,
    });

    helpers.broadcastToHost(wss, partieId, 'MOTDEPASSE_ANSWER_IN', {
        pseudo,
        answeredCount: session.reponses.size,
        joueursCount: publicPlayers(partieId).length,
        correct,
    });
}

function startRound(wss, partieId, data, helpers) {
    const session = getOrCreateSession(partieId);
    const duration = Math.max(10, Math.min(180, Number(data.duration || DEFAULT_DURATION)));
    const mot = clean(data.mot) || pickWord();
    const indice = clean(data.indice) || 'Aucun indice fourni';

    session.phase = 'round';
    session.manche += 1;
    session.mot = mot.slice(0, 80);
    session.indice = indice.slice(0, 140);
    session.reponses = new Map();
    session.scoresManche = new Map();
    session.startedAt = Date.now();
    session.endsAt = session.startedAt + duration * 1000;
    session.duration = duration;

    helpers.broadcastToGame(wss, partieId, 'MOTDEPASSE_ROUND_START', roundPayload(partieId, session));
}

function revealRound(wss, partieId, helpers) {
    const session = getOrCreateSession(partieId);
    if (session.phase !== 'round' && session.phase !== 'reveal') return;

    session.phase = 'reveal';
    helpers.broadcastToGame(wss, partieId, 'MOTDEPASSE_REVELATION', revealPayload(partieId, session));
    emitScores(wss, partieId, helpers);
}

export function handleHostAction(wss, ws, partieId, action, data = {}, helpers) {
    switch (action) {
        case 'motdepasse:start':
        case 'motdepasse:next':
            startRound(wss, partieId, data, helpers);
            break;

        case 'motdepasse:host_answer':
            recordAnswer(wss, partieId, ws._pseudo, data.texte, helpers);
            break;

        case 'motdepasse:reveal':
            revealRound(wss, partieId, helpers);
            break;

        default:
            helpers.send(ws, 'ERROR', { code: 'UNKNOWN_MOTDEPASSE_ACTION', action });
    }
}

export function handlePlayerAction(wss, ws, partieId, pseudo, action, data = {}, helpers) {
    switch (action) {
        case 'motdepasse:answer':
            recordAnswer(wss, partieId, pseudo, data.texte, helpers);
            break;

        default:
            helpers.send(ws, 'ERROR', { code: 'UNKNOWN_MOTDEPASSE_ACTION', action });
    }
}

export function getSessionState(partieId, pseudo = null) {
    const session = sessions.get(partieId);
    if (!session) return { phase: 'idle', scores: store.getScores(partieId) };

    const state = {
        phase: session.phase,
        manche: session.manche,
        indice: session.indice,
        duration: session.duration,
        startedAt: session.startedAt,
        endsAt: session.endsAt,
        answered: answersPublic(session, session.phase === 'reveal'),
        scores: store.getScores(partieId),
    };

    if (session.phase === 'reveal') {
        state.mot = session.mot;
        state.reponses = answersPublic(session, true);
        state.scoresManche = Object.fromEntries(session.scoresManche.entries());
    }

    if (pseudo && session.reponses.has(pseudo)) {
        const rep = session.reponses.get(pseudo);
        state.maReponse = {
            texte: rep.texte,
            correct: session.phase === 'reveal' ? rep.correct : null,
            points: session.phase === 'reveal' ? rep.points : null,
        };
    }

    return state;
}

export function detruireSession(partieId) {
    sessions.delete(partieId);
}
