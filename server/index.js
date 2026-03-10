// ── Dans le gestionnaire PLAYER_JOIN ──────────────────────

socket.on('PLAYER_JOIN', ({ pseudo, partieId }) => {
    try {
        // Validation 1: Pseudo valide
        const pseudoRegex = /^[a-zA-Z0-9_-]{2,20}$/;
        if (!pseudo || !pseudoRegex.test(pseudo)) {
            socket.emit('JOIN_ERROR', { code: 'PSEUDO_INVALID' });
            return;
        }

        // Validation 2: Partie existe
        const partie = store.getPartie(partieId);
        if (!partie) {
            socket.emit('JOIN_ERROR', { code: 'GAME_NOT_FOUND' });
            return;
        }

        // Validation 3: Partie pas terminée
        if (partie.statut === 'ended' || partie.statut === 'terminee') {
            socket.emit('JOIN_ERROR', { code: 'GAME_NOT_FOUND' });
            return;
        }

        // Validation 4: Partie pas déjà en cours (sauf si dans lobby)
        if (partie.statut === 'started' || partie.statut === 'en_cours') {
            socket.emit('JOIN_ERROR', { code: 'GAME_STARTED' });
            return;
        }

        // Validation 5: Pseudo pas déjà utilisé
        const pseudoExists = partie.joueurs?.some(j => j.pseudo === pseudo);
        if (pseudoExists) {
            socket.emit('JOIN_ERROR', { code: 'PSEUDO_TAKEN' });
            return;
        }

        // Validation 6: Max joueurs pas atteint
        if (partie.joueurs.length >= (partie.maxJoueurs || 8)) {
            socket.emit('JOIN_ERROR', { code: 'MAX_PLAYERS' });
            return;
        }

        // ✅ Valider le joueur
        const equipe = partie.mode === 'team' ? assignerEquipe(partie) : null;
        const joueur = {
            id: socket.id,
            pseudo,
            equipe,
            score: 0,
            statut: 'connected',
        };

        partie.joueurs.push(joueur);
        socket.join(partieId);
        socket.data.partieId = partieId;
        socket.data.pseudo = pseudo;
        socket.data.role = 'player';

        // Notifier tous les joueurs
        io.to(partieId).emit('PLAYER_JOINED', {
            pseudo,
            joueurs: partie.joueurs,
        });

        // Confirmer au client
        socket.emit('JOIN_OK', {
            pseudo,
            equipe,
            snapshot: {
                jeu: partie.jeu,
                mode: partie.mode,
                joueurs: partie.joueurs,
                equipes: partie.equipes,
                statut: partie.statut,
            },
        });

        console.log(`✅ ${pseudo} a rejoint ${partieId}`);

    } catch (err) {
        console.error('PLAYER_JOIN error:', err);
        socket.emit('JOIN_ERROR', { code: 'MISSING_FIELDS' });
    }
});