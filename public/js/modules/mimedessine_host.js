// C:/Users/clayt/PycharmProjects/MiniGameV2/public/js/modules/mimedessine_host.js
// Nouveau fichier pour la logique hôte du jeu Mime Dessine

import { sendHostAction } from '../websocket.js'; // Assuming websocket.js provides sendHostAction
import { HostRegistry } from '../host.js'; // Assuming host.js provides HostRegistry

const gameContainer = document.getElementById('game-container'); // Main game area on host
let currentGameState = null;
let hostSession = null;
let hostSocket = null;

const MimeDessineHostModule = {
    _session: null,
    _socket: null,

    initHost(session, socket, gameState, snapshot) {
        this._session = session;
        this._socket = socket;
        hostSession = session;
        hostSocket = socket;

        console.log("[MIMEDESSSINE_HOST] Initializing with state:", gameState);
        currentGameState = gameState;
        this.renderHostUI();
    },

    destroy() {
        gameContainer.innerHTML = ''; // Clear game content
        currentGameState = null;
        hostSession = null;
        hostSocket = null;
    },

    onHostAction(action, data) {
        // Host actions are initiated from the host UI, not received from server as generic HOST_ACTION
        console.log("[MIMEDESSSINE_HOST] Host action received (ignored):", action, data);
    },

    onScores(scores) {
        console.log("[MIMEDESSSINE_HOST] Scores updated:", scores);
        currentGameState = { ...currentGameState, scores: scores };
        this.renderHostUI(); // Re-render to update scores
    },

    onWsEvent(type, payload) {
        console.log(`[MIMEDESSSINE_HOST] Received event: ${type}`, payload);
        switch (type) {
            case 'MIMEDESSSINE_DEFI':
            case 'MIMEDESSSINE_PHASE':
                currentGameState = { ...currentGameState, ...payload };
                this.renderHostUI();
                break;
            case 'MIMEDESSSINE_GUESS_IN':
                // Display guess information to the host
                console.log(`[MIMEDESSSINE_HOST] Guess from ${payload.pseudo}: ${payload.guess} (Correct: ${payload.correct})`);
                // Optionally update a specific area for guesses
                this.renderHostUI(); // Re-render to update guess list or status
                break;
            case 'MIMEDESSSINE_DRAWING_DATA':
                // Host should also display the drawing
                if (currentGameState.phase === 'dessin') {
                    drawReceivedData(payload.data);
                }
                break;
            default:
                console.warn(`[MIMEDESSSINE_HOST] Unhandled event type: ${type}`);
        }
    },

    renderHostUI() {
        if (!gameContainer || !currentGameState || !hostSession) return;

        gameContainer.innerHTML = ''; // Clear previous content

        const phase = currentGameState.phase;
        const isHostDrawer = (hostSession.hostPseudo === currentGameState.drawerPseudo);

        let htmlContent = `<h2>Mime Dessine - Hôte</h2>`;
        htmlContent += `<p>Thème: <strong>${currentGameState.config?.theme || 'Non défini'}</strong></p>`;
        htmlContent += `<p>Manche: ${currentGameState.manche}</p>`;

        if (phase === 'menu') {
            htmlContent += `<p>Configurez le défi et choisissez le mot.</p>`;
            // Host controls for setting up the game (defi, motsDisponibles, etc.)
            // These buttons are usually part of the initial setup, not during a player's turn.
        } else if (phase === 'choix_mot') {
            htmlContent += `<p>Le dessinateur est: <strong>${currentGameState.drawerPseudo}</strong></p>`;
            htmlContent += `<p>En attente que l'hôte lance le dessin.</p>`;
            // Host button to start drawing
            htmlContent += `<button id="startDrawingButton">Lancer le dessin</button>`;
        } else if (phase === 'dessin') {
            htmlContent += `<p>Le dessinateur est: <strong>${currentGameState.drawerPseudo}</strong></p>`;
            htmlContent += `<p>Temps restant: <span id="hostTimer">--</span>s</p>`;
            htmlContent += `<div class="drawing-area">
                                <canvas id="drawingCanvas" width="600" height="400" style="border:1px solid #000;"></canvas>
                            </div>`;
            // Host buttons for revealing word or forcing results (only if host is not drawer)
            if (!isHostDrawer) {
                htmlContent += `<button id="revelerMotButton">Révéler le mot</button>`;
                htmlContent += `<button id="forceResultatsButton">Forcer les résultats</button>`;
            }
        } else if (phase === 'reponse') {
            htmlContent += `<p>Le mot était: <strong>${currentGameState.motADeviner || 'Non révélé'}</strong></p>`;
            htmlContent += `<p>Scores mis à jour.</p>`;
            htmlContent += `<div class="drawing-area">
                                <canvas id="drawingCanvas" width="600" height="400" style="border:1px solid #000;"></canvas>
                            </div>`;
            htmlContent += `<button id="nextRoundButton">Manche suivante</button>`;
        } else if (phase === 'resultats') {
            htmlContent += `<p>Fin de la manche. Résultats:</p>`;
            htmlContent += `<button id="newGameButton">Nouvelle partie</button>`;
        }

        htmlContent += `<div id="mimer-hote-scores"><h3>Scores:</h3>`;
        const scores = currentGameState.scores || {};
        if (Object.keys(scores).length > 0) {
            Object.entries(scores).sort(([, a], [, b]) => b - a).forEach(([pseudo, score]) => {
                htmlContent += `<p>${pseudo}: ${score} pts</p>`;
            });
        } else {
            htmlContent += `<p>Aucun score pour l'instant.</p>`;
        }
        htmlContent += `</div>`;

        gameContainer.innerHTML = htmlContent;
        this.setupHostListeners(isHostDrawer);
        this.setupHostCanvas();
    },

    setupHostListeners(isHostDrawer) {
        const startDrawingButton = document.getElementById('startDrawingButton');
        if (startDrawingButton) {
            startDrawingButton.addEventListener('click', () => {
                this._socket.send('HOST_ACTION', { action: 'mimedessine:start_dessin' });
            });
        }

        const revelerMotButton = document.getElementById('revelerMotButton');
        if (revelerMotButton) {
            revelerMotButton.addEventListener('click', () => {
                this._socket.send('HOST_ACTION', { action: 'mimedessine:reveler_mot' });
            });
        }

        const forceResultatsButton = document.getElementById('forceResultatsButton');
        if (forceResultatsButton) {
            forceResultatsButton.addEventListener('click', () => {
                this._socket.send('HOST_ACTION', { action: 'mimedessine:force_resultats' });
            });
        }

        const nextRoundButton = document.getElementById('nextRoundButton');
        if (nextRoundButton) {
            nextRoundButton.addEventListener('click', () => {
                // Logic to start next round, e.g., back to 'choix_mot' phase
                // This might require a new host action or re-using 'mimedessine:defi' with new data
                console.log("[MIMEDESSSINE_HOST] Next round button clicked. Implement logic.");
            });
        }

        const newGameButton = document.getElementById('newGameButton');
        if (newGameButton) {
            newGameButton.addEventListener('click', () => {
                // Logic to start a completely new game
                console.log("[MIMEDESSSINE_HOST] New game button clicked. Implement logic.");
            });
        }

        // Timer for host display
        if (currentGameState.phase === 'dessin' && currentGameState.tsPhaseEnd) {
            this.startHostTimer(currentGameState.tsPhaseEnd);
        }
    },

    setupHostCanvas() {
        const canvas = document.getElementById('drawingCanvas');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            // Restore drawing if available
            if (currentGameState.dessinData && currentGameState.dessinData.length > 0) {
                drawReceivedData(currentGameState.dessinData, ctx, canvas);
            }
            // Host canvas is always read-only
            canvas.style.pointerEvents = 'none';
        }
    },

    startHostTimer(tsPhaseEnd) {
        const timerEl = document.getElementById('hostTimer');
        if (!timerEl) return;

        const updateTimer = () => {
            const remainingTime = Math.max(0, Math.ceil((tsPhaseEnd - Date.now()) / 1000));
            timerEl.textContent = remainingTime;
            if (remainingTime <= 0) {
                clearInterval(this._timerInterval);
                timerEl.textContent = '0';
            }
        };

        if (this._timerInterval) clearInterval(this._timerInterval);
        this._timerInterval = setInterval(updateTimer, 1000);
        updateTimer(); // Initial call
    },
    _timerInterval: null,
};

function drawReceivedData(data, ctx, canvas) {
    if (!ctx || !canvas) return;
    if (Array.isArray(data) && data.length === 0) { // Clear command
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
    }
    const img = new Image();
    img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear before drawing new image
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = data; // Assuming data is a Data URL
}

// Register the host module
HostRegistry.register('mimedessine', MimeDessineHostModule);

export { MimeDessineHostModule };