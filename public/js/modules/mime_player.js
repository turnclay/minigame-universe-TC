// C:/Users/clayt/PycharmProjects/MiniGameV2/public/js/modules/mime_player.js

import { sendPlayerAction } from '../websocket.js';
import { getPlayerPseudo } from '../player.js'; // Assuming player.js provides this

const gameContainer = document.getElementById('game-container'); // Main game area
let currentGameState = null;
let playerPseudo = null;
let canvas = null;
let ctx = null;
let isDrawing = false;
let lastX = 0;
let lastY = 0;

export function initMimePlayer(initialState) {
    console.log("[MIME_PLAYER] Initializing with state:", initialState);
    currentGameState = initialState;
    playerPseudo = getPlayerPseudo(); // Get current player's pseudo
    renderPlayerUI();
}

export function handleMimeEvent(type, payload) {
    console.log(`[MIME_PLAYER] Received event: ${type}`, payload);
    switch (type) {
        case 'MIMEDESSSINE_DEFI':
        case 'MIMEDESSSINE_PHASE':
            currentGameState = { ...currentGameState, ...payload };
            renderPlayerUI();
            break;
        case 'MIMEDESSSINE_MOT_A_DEVINER':
            // Only the drawer receives this
            if (playerPseudo === currentGameState.drawerPseudo) {
                currentGameState.motADeviner = payload.mot;
                renderPlayerUI(); // Update UI to show the word to draw
            }
            break;
        case 'MIMEDESSSINE_DRAWING_DATA':
            // Guessers receive drawing data
            if (playerPseudo !== currentGameState.drawerPseudo && currentGameState.phase === 'dessin') {
                drawReceivedData(payload.data);
            }
            break;
        case 'MIMEDESSSINE_GUESS_ACK':
            // Handle feedback for player's guess
            console.log("[MIME_PLAYER] Guess ACK:", payload.status);
            // Optionally update UI based on guess status (e.g., show "Correct!" or "Try again")
            break;
        case 'SCORES_UPDATE':
            // Update scores display if needed
            console.log("[MIME_PLAYER] Scores updated:", payload.scores);
            break;
        default:
            console.warn(`[MIME_PLAYER] Unhandled event type: ${type}`);
    }
}

function renderPlayerUI() {
    if (!gameContainer || !currentGameState || !playerPseudo) return;

    gameContainer.innerHTML = ''; // Clear previous content

    const isDrawer = (playerPseudo === currentGameState.drawerPseudo);
    const phase = currentGameState.phase;

    let htmlContent = `<h2>Mime Dessine - Manche ${currentGameState.manche}</h2>`;

    if (phase === 'menu' || phase === 'choix_mot') {
        if (isDrawer) {
            htmlContent += `<p>Tu es le dessinateur pour cette manche. Attends que l'hôte lance le dessin.</p>`;
            if (currentGameState.motADeviner) {
                htmlContent += `<p>Mot à dessiner: <strong>${currentGameState.motADeviner}</strong></p>`;
            }
        } else {
            htmlContent += `<p>Le jeu est en préparation. ${currentGameState.drawerPseudo || 'Quelqu\'un'} va dessiner.</p>`;
        }
    } else if (phase === 'dessin') {
        if (isDrawer) {
            htmlContent += `<p>Dessine: <strong>${currentGameState.motADeviner}</strong></p>`;
            htmlContent += `<div class="drawing-area">
                                <canvas id="drawingCanvas" width="600" height="400" style="border:1px solid #000;"></canvas>
                                <button id="clearCanvas">Effacer</button>
                            </div>`;
        } else {
            htmlContent += `<p>${currentGameState.drawerPseudo} est en train de dessiner...</p>`;
            htmlContent += `<div class="drawing-area">
                                <canvas id="drawingCanvas" width="600" height="400" style="border:1px solid #000;"></canvas>
                            </div>`;
            htmlContent += `<div class="guess-area">
                                <input type="text" id="guessInput" placeholder="Ton hypothèse...">
                                <button id="submitGuess">Deviner</button>
                            </div>`;
        }
    } else if (phase === 'reponse') {
        htmlContent += `<p>Le mot était: <strong>${currentGameState.motADeviner}</strong></p>`;
        htmlContent += `<p>Scores mis à jour.</p>`;
        // Display final drawing
        htmlContent += `<div class="drawing-area">
                            <canvas id="drawingCanvas" width="600" height="400" style="border:1px solid #000;"></canvas>
                        </div>`;
    } else if (phase === 'resultats') {
        htmlContent += `<p>Fin de la manche. Résultats:</p>`;
        // Display scores or summary
    }

    gameContainer.innerHTML = htmlContent;
    setupCanvasAndListeners(isDrawer);
}

function setupCanvasAndListeners(isDrawer) {
    canvas = document.getElementById('drawingCanvas');
    if (canvas) {
        ctx = canvas.getContext('2d');
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#000';

        // Restore drawing if available (for rejoining or phase transitions)
        if (currentGameState.dessinData && currentGameState.dessinData.length > 0) {
            drawReceivedData(currentGameState.dessinData);
        }

        if (isDrawer && currentGameState.phase === 'dessin') {
            canvas.addEventListener('mousedown', startDrawing);
            canvas.addEventListener('mousemove', draw);
            canvas.addEventListener('mouseup', stopDrawing);
            canvas.addEventListener('mouseout', stopDrawing);

            const clearButton = document.getElementById('clearCanvas');
            if (clearButton) {
                clearButton.addEventListener('click', clearCanvas);
            }
        } else {
            // Disable drawing for guessers
            canvas.style.pointerEvents = 'none';
        }
    }

    const submitGuessButton = document.getElementById('submitGuess');
    if (submitGuessButton) {
        submitGuessButton.addEventListener('click', submitGuess);
    }
    const guessInput = document.getElementById('guessInput');
    if (guessInput) {
        guessInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                submitGuess();
            }
        });
    }
}

function startDrawing(e) {
    isDrawing = true;
    [lastX, lastY] = [e.offsetX, e.offsetY];
}

function draw(e) {
    if (!isDrawing) return;
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(e.offsetX, e.offsetY);
    ctx.stroke();
    [lastX, lastY] = [e.offsetX, e.offsetY];

    // Send drawing data to server
    sendPlayerAction('mimedessine:drawing_update', {
        data: getDrawingData() // Implement a function to get current drawing data
    });
}

function stopDrawing() {
    isDrawing = false;
}

function clearCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    sendPlayerAction('mimedessine:drawing_update', { data: [] }); // Clear drawing on server
}

function getDrawingData() {
    // For simplicity, we'll send the entire canvas as an image data URL.
    // In a real-time drawing app, you'd send individual drawing strokes/commands.
    return canvas.toDataURL();
}

function drawReceivedData(data) {
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

function submitGuess() {
    const guessInput = document.getElementById('guessInput');
    if (guessInput && guessInput.value.trim() !== '') {
        sendPlayerAction('mimedessine:guess', { guess: guessInput.value.trim() });
        guessInput.value = ''; // Clear input after guessing
    }
}