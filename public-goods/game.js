import { firebaseConfig, isFirebaseConfigured } from '../shared/firebase-config.js';

// Game state
let gameState = {
    playerName: 'Anonymous',
    currentRound: 1,
    totalRounds: 10,
    playerWealth: 100, // Starts with $100 ($10 per round × 10 rounds)
    totalContributed: 0,
    contributions: [],
    roundHistory: [],
    punishmentHistory: [],  // Track who got punished each round
    totalPunishmentSpent: 0,  // Total $ spent on punishing
    totalPunishmentReceived: 0,  // Total $ lost from being punished
    gameId: null
};

// AI citizen strategies
const CITIZEN_STRATEGIES = {
    altruist: { name: 'Altruist Alice', baseContrib: 10, adaptability: 0 },
    reciprocator: { name: 'Reciprocator Rob', baseContrib: 5, adaptability: 0.9 },
    conditional: { name: 'Conditional Clara', baseContrib: 5, adaptability: 0.7 },
    freeRider: { name: 'Free-Rider Fred', baseContrib: 0, adaptability: 0.1 }
};

const MULTIPLIER = 2; // Public goods multiplier
const NUM_CITIZENS = 4;
const ENDOWMENT_PER_ROUND = 10;

// Punishment parameters (Fehr & Gächter)
const PUNISHMENT_COST = 1;        // Cost to punisher
const PUNISHMENT_PENALTY = 3;     // Loss to punished (3:1 ratio)
const FREE_RIDER_THRESHOLD = 3;   // Contrib < $3 = free-rider

// Firebase references
let db = null;
let app = null;

// Initialize Firebase
async function initFirebase() {
    if (!isFirebaseConfigured()) {
        console.log('Firebase not configured - using demo mode');
        return false;
    }

    try {
        const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getDatabase } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');

        app = initializeApp(firebaseConfig);
        db = getDatabase(app);
        return true;
    } catch (error) {
        console.log('Firebase initialization failed:', error);
        return false;
    }
}

// Generate unique game ID
function generateGameId() {
    return `game_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// DOM Elements
const welcomeScreen = document.getElementById('welcome-screen');
const gameScreen = document.getElementById('game-screen');
const resultsScreen = document.getElementById('results-screen');
const startGameBtn = document.getElementById('start-game-btn');
const playerNameInput = document.getElementById('player-name');

// Welcome screen stats
async function loadWelcomeStats() {
    if (!db) {
        document.getElementById('preview-avg-contrib').textContent = '$4.20';
        document.getElementById('preview-free-rider').textContent = '35%';
        return;
    }

    try {
        const { ref, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
        const gamesRef = ref(db, 'public-goods-games');
        const snapshot = await get(gamesRef);

        if (snapshot.exists()) {
            const games = Object.values(snapshot.val());

            // Calculate average contribution
            const avgContrib = games.reduce((sum, g) => sum + (g.avgContribution || 0), 0) / games.length;
            document.getElementById('preview-avg-contrib').textContent = `$${avgContrib.toFixed(2)}`;

            // Calculate free-rider rate (avg contribution < $2)
            const freeRiders = games.filter(g => (g.avgContribution || 0) < 2).length;
            const freeRiderRate = Math.round((freeRiders / games.length) * 100);
            document.getElementById('preview-free-rider').textContent = `${freeRiderRate}%`;
        }
    } catch (error) {
        console.log('Error loading welcome stats:', error);
    }
}

// Load player count
async function loadPlayerCount() {
    const playerCountEl = document.getElementById('total-players');

    if (!db) {
        playerCountEl.textContent = '2,341';
        return;
    }

    try {
        const { ref, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
        const gamesRef = ref(db, 'public-goods-games');
        const snapshot = await get(gamesRef);

        if (snapshot.exists()) {
            const count = Object.keys(snapshot.val()).length;
            playerCountEl.textContent = count.toLocaleString();
        } else {
            playerCountEl.textContent = '0';
        }
    } catch (error) {
        console.log('Error loading player count:', error);
        playerCountEl.textContent = '...';
    }
}

// Start game
startGameBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    gameState.playerName = name || 'Anonymous';
    gameState.gameId = generateGameId();

    welcomeScreen.style.display = 'none';
    gameScreen.style.display = 'block';

    startRound();
});

// Start round
function startRound() {
    updateRoundHeader();
    showDecisionView();
    updateStats();
}

function updateRoundHeader() {
    document.getElementById('round-number').textContent = gameState.currentRound;
    const progress = (gameState.currentRound / gameState.totalRounds) * 100;
    document.getElementById('progress-fill').style.width = `${progress}%`;
}

// Show decision view
function showDecisionView() {
    document.getElementById('decision-view').style.display = 'block';
    document.getElementById('result-view').style.display = 'none';
    document.getElementById('transparency-view').style.display = 'none';
    document.getElementById('punishment-view').style.display = 'none';
    document.getElementById('punishment-results-view').style.display = 'none';

    const contribInput = document.getElementById('contribution-amount');
    contribInput.value = 5;
    updateContributionPreview(5);

    // Update preview as user types
    contribInput.oninput = (e) => {
        let value = parseInt(e.target.value) || 0;
        if (value < 0) value = 0;
        if (value > 10) value = 10;
        e.target.value = value;
        updateContributionPreview(value);
    };

    // Submit button
    document.getElementById('submit-contrib-btn').onclick = () => {
        let contrib = parseInt(contribInput.value) || 0;
        if (contrib < 0) contrib = 0;
        if (contrib > 10) contrib = 10;
        handlePlayerContribution(contrib);
    };
}

function updateContributionPreview(contrib) {
    const keep = 10 - contrib;
    document.getElementById('keep-amount').textContent = `$${keep}`;
    document.getElementById('contrib-display').textContent = `$${contrib}`;
}

// Handle player contribution
function handlePlayerContribution(playerContrib) {
    // Generate AI citizens' contributions
    const citizenContribs = generateCitizenContributions();

    // Calculate pool
    const totalContrib = playerContrib + citizenContribs.reduce((sum, c) => sum + c.amount, 0);
    const multipliedPool = totalContrib * MULTIPLIER;
    const sharePerPerson = multipliedPool / 5;

    // Player keeps what they didn't contribute
    const playerKeep = 10 - playerContrib;

    // Player's total for this round = what they kept + their share of pool
    const playerRoundTotal = playerKeep + sharePerPerson;

    // Update game state
    gameState.playerWealth += (playerRoundTotal - 10); // Net change from starting $10
    gameState.totalContributed += playerContrib;
    gameState.contributions.push(playerContrib);
    gameState.roundHistory.push({
        round: gameState.currentRound,
        playerContrib,
        citizenContribs: citizenContribs,  // Store citizen contributions
        totalContrib,
        multipliedPool,
        sharePerPerson,
        playerRoundTotal
    });

    // Show result
    showRoundResult(playerContrib, citizenContribs, totalContrib, multipliedPool, sharePerPerson, playerRoundTotal);
}

// Generate AI citizen contributions
function generateCitizenContributions() {
    const citizens = Object.values(CITIZEN_STRATEGIES);
    const contribs = [];

    // Calculate average contribution from previous rounds for conditional cooperators
    const avgPlayerContrib = gameState.contributions.length > 0
        ? gameState.contributions.reduce((a, b) => a + b, 0) / gameState.contributions.length
        : 5;

    citizens.forEach(citizen => {
        let amount = citizen.baseContrib;

        // Adaptive behavior
        if (citizen.adaptability > 0) {
            // Conditional cooperators match the player's average
            const target = avgPlayerContrib;
            amount = Math.round(citizen.baseContrib + (target - citizen.baseContrib) * citizen.adaptability);
        }

        // Clamp amount
        amount = Math.max(0, Math.min(10, amount));

        contribs.push({
            name: citizen.name,
            amount: amount
        });
    });

    return contribs;
}

// Show round result
function showRoundResult(playerContrib, citizenContribs, totalContrib, multipliedPool, sharePerPerson, playerRoundTotal) {
    document.getElementById('decision-view').style.display = 'none';
    document.getElementById('result-view').style.display = 'block';

    const resultContent = document.getElementById('result-content');

    let resultHTML = `
        <p style="margin-bottom: 1rem;"><strong>Round ${gameState.currentRound} Results:</strong></p>
        <p style="margin-bottom: 0.5rem;">You contributed: <span style="color: var(--contrib-color)">$${playerContrib}</span></p>
        <p style="margin-bottom: 0.5rem;">You kept: <span style="color: var(--success-color)">$${10 - playerContrib}</span></p>
        <p style="margin-bottom: 1.5rem;">Community total: <span style="color: var(--warning-color)">$${totalContrib}</span></p>

        <div style="background: rgba(0,217,255,0.1); padding: 1rem; margin: 1rem 0; border-left: 3px solid var(--primary-color);">
            <p style="margin-bottom: 0.5rem;">Pool: $${totalContrib} × ${MULTIPLIER} = <span style="color: var(--warning-color)">$${multipliedPool}</span></p>
            <p style="margin-bottom: 0.5rem;">Your share: $${multipliedPool} ÷ 5 = <span style="color: var(--success-color)">$${sharePerPerson.toFixed(2)}</span></p>
            <p style="margin-bottom: 0;">Round total: $${(10 - playerContrib).toFixed(2)} + $${sharePerPerson.toFixed(2)} = <span style="color: var(--money-color)">$${playerRoundTotal.toFixed(2)}</span></p>
        </div>
    `;

    // Analysis
    if (playerContrib === 0 && totalContrib > 0) {
        resultHTML += `<p style="color: var(--danger-color); margin-top: 1rem;">You free-rode! You got $${sharePerPerson.toFixed(2)} without contributing.</p>`;
    } else if (playerContrib === 10) {
        resultHTML += `<p style="color: var(--success-color); margin-top: 1rem;">Maximum contribution! You're supporting the commons.</p>`;
    } else if (playerContrib > 0 && playerContrib < totalContrib / 5) {
        resultHTML += `<p style="color: var(--warning-color); margin-top: 1rem;">You contributed less than average. Slight free-riding.</p>`;
    }

    resultContent.innerHTML = resultHTML;

    // Update citizens activity display
    updateCitizensActivity(citizenContribs);

    // Add to history
    addToHistory(playerContrib, playerRoundTotal);

    // Update stats
    updateStats();

    // View All Contributions button
    document.getElementById('view-contributions-btn').onclick = () => {
        showTransparencyView(playerContrib, citizenContribs);
    };

    // Next round button
    document.getElementById('next-round-btn').onclick = () => {
        if (gameState.currentRound < gameState.totalRounds) {
            gameState.currentRound++;
            startRound();
        } else {
            endGame();
        }
    };
}

// Show transparency view
function showTransparencyView(playerContrib, citizenContribs) {
    document.getElementById('result-view').style.display = 'none';
    document.getElementById('transparency-view').style.display = 'block';

    const contributionsTable = document.getElementById('contributions-table');

    // Build contributions table
    let tableHTML = '<div class="contrib-table">';

    // Header
    tableHTML += `
        <div class="contrib-row contrib-header">
            <div class="contrib-cell">Citizen</div>
            <div class="contrib-cell">Contribution</div>
            <div class="contrib-cell">Status</div>
        </div>
    `;

    // Player row
    const playerStatus = playerContrib >= 7 ? 'High Contributor' :
                         playerContrib >= 4 ? 'Medium Contributor' :
                         playerContrib >= 1 ? 'Low Contributor' : 'Free-Rider';
    const playerColor = playerContrib >= 7 ? 'var(--success-color)' :
                        playerContrib >= 4 ? 'var(--warning-color)' :
                        'var(--danger-color)';

    tableHTML += `
        <div class="contrib-row">
            <div class="contrib-cell"><strong>You (${gameState.playerName})</strong></div>
            <div class="contrib-cell" style="color: ${playerColor}"><strong>$${playerContrib}</strong></div>
            <div class="contrib-cell" style="color: ${playerColor}">${playerStatus}</div>
        </div>
    `;

    // Citizen rows
    citizenContribs.forEach(citizen => {
        const status = citizen.amount >= 7 ? 'High Contributor' :
                      citizen.amount >= 4 ? 'Medium Contributor' :
                      citizen.amount >= 1 ? 'Low Contributor' : 'Free-Rider';
        const color = citizen.amount >= 7 ? 'var(--success-color)' :
                     citizen.amount >= 4 ? 'var(--warning-color)' :
                     'var(--danger-color)';

        tableHTML += `
            <div class="contrib-row">
                <div class="contrib-cell">${citizen.name}</div>
                <div class="contrib-cell" style="color: ${color}">$${citizen.amount}</div>
                <div class="contrib-cell" style="color: ${color}">${status}</div>
            </div>
        `;
    });

    tableHTML += '</div>';
    contributionsTable.innerHTML = tableHTML;

    // Generate insight about free-riding
    const transparencyInsight = document.getElementById('transparency-insight');

    // Count free-riders (contrib < $3)
    let freeRiders = [];
    if (playerContrib < 3) freeRiders.push('You');
    citizenContribs.forEach(citizen => {
        if (citizen.amount < 3) freeRiders.push(citizen.name);
    });

    let insightHTML = '<div class="transparency-insight-box">';

    if (freeRiders.length === 0) {
        insightHTML += `
            <p style="color: var(--success-color);">✅ <strong>No free-riders this round!</strong></p>
            <p>Everyone contributed at least $3. This is how public goods thrive!</p>
        `;
    } else if (freeRiders.length === 1) {
        insightHTML += `
            <p style="color: var(--warning-color);">⚠️ <strong>1 free-rider detected</strong></p>
            <p>${freeRiders[0]} contributed less than $3 while benefiting from others' contributions.</p>
        `;
    } else {
        insightHTML += `
            <p style="color: var(--danger-color);">🚨 <strong>${freeRiders.length} free-riders detected</strong></p>
            <p>${freeRiders.join(', ')} contributed less than $3 while benefiting from others' contributions.</p>
            <p style="margin-top: 0.5rem;">This is the classic free-rider problem - people benefit without contributing!</p>
        `;
    }

    insightHTML += '</div>';
    transparencyInsight.innerHTML = insightHTML;

    // Next Round button triggers punishment phase
    document.getElementById('next-round-btn').onclick = () => {
        showPunishmentPhase(playerContrib, citizenContribs);
    };
}

// Show punishment phase
function showPunishmentPhase(playerContrib, citizenContribs) {
    document.getElementById('transparency-view').style.display = 'none';
    document.getElementById('punishment-view').style.display = 'block';

    const punishmentOptions = document.getElementById('punishment-options');

    // Build punishment options
    let optionsHTML = '<div class="punishment-grid">';

    // Add options to punish each citizen
    citizenContribs.forEach((citizen, index) => {
        const isFreeRider = citizen.amount < FREE_RIDER_THRESHOLD;
        const borderColor = isFreeRider ? 'var(--danger-color)' : 'var(--success-color)';

        optionsHTML += `
            <div class="punishment-option" style="border-color: ${borderColor}">
                <div class="punishment-option-header">
                    <strong>${citizen.name}</strong>
                    <span style="color: ${isFreeRider ? 'var(--danger-color)' : 'var(--success-color)'}">
                        Contributed: $${citizen.amount}
                    </span>
                </div>
                <div class="punishment-option-body">
                    <label class="punishment-checkbox">
                        <input type="checkbox" id="punish-${index}" data-citizen-name="${citizen.name}" data-citizen-contrib="${citizen.amount}">
                        <span>Punish (Costs you $${PUNISHMENT_COST}, they lose $${PUNISHMENT_PENALTY})</span>
                    </label>
                </div>
            </div>
        `;
    });

    optionsHTML += '</div>';

    optionsHTML += `
        <div class="punishment-summary" id="punishment-summary">
            <p>Selected: <span id="punishment-count">0</span> citizens | Cost: $<span id="punishment-total-cost">0</span></p>
        </div>
    `;

    punishmentOptions.innerHTML = optionsHTML;

    // Add event listeners to checkboxes
    const checkboxes = document.querySelectorAll('.punishment-checkbox input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        checkbox.addEventListener('change', updatePunishmentSummary);
    });

    // Submit punishment button
    document.getElementById('submit-punishment-btn').onclick = () => {
        handlePlayerPunishment(citizenContribs);
    };

    // Skip punishment button
    document.getElementById('skip-punishment-btn').onclick = () => {
        handlePlayerPunishment(citizenContribs, true);
    };
}

// Update punishment summary
function updatePunishmentSummary() {
    const checkboxes = document.querySelectorAll('.punishment-checkbox input[type="checkbox"]:checked');
    const count = checkboxes.length;
    const cost = count * PUNISHMENT_COST;

    document.getElementById('punishment-count').textContent = count;
    document.getElementById('punishment-total-cost').textContent = cost;
}

// Handle player punishment
function handlePlayerPunishment(citizenContribs, skip = false) {
    let playerPunishments = [];
    let playerPunishmentCost = 0;

    if (!skip) {
        const checkboxes = document.querySelectorAll('.punishment-checkbox input[type="checkbox"]:checked');
        checkboxes.forEach(checkbox => {
            playerPunishments.push({
                name: checkbox.dataset.citizenName,
                contrib: parseInt(checkbox.dataset.citizenContrib)
            });
            playerPunishmentCost += PUNISHMENT_COST;
        });
    }

    // Generate AI punishments
    const aiPunishments = generateAIPunishments(citizenContribs, gameState.roundHistory[gameState.roundHistory.length - 1].playerContrib);

    // Calculate punishment received by player
    const playerPunishmentReceived = aiPunishments.playerPunished ? aiPunishments.playerPunishmentCount * PUNISHMENT_PENALTY : 0;

    // Update game state
    gameState.playerWealth -= playerPunishmentCost; // Cost of punishing others
    gameState.playerWealth -= playerPunishmentReceived; // Penalty from being punished
    gameState.totalPunishmentSpent += playerPunishmentCost;
    gameState.totalPunishmentReceived += playerPunishmentReceived;

    // Record punishment history
    gameState.punishmentHistory.push({
        round: gameState.currentRound,
        playerPunished: playerPunishments,
        playerPunishmentCost,
        playerPunishmentReceived,
        aiPunishments: aiPunishments.details
    });

    // Show punishment results
    showPunishmentResults(playerPunishments, playerPunishmentCost, playerPunishmentReceived, aiPunishments);
}

// Generate AI punishments
function generateAIPunishments(citizenContribs, playerContrib) {
    const punishments = {
        playerPunished: false,
        playerPunishmentCount: 0,
        details: []
    };

    // Check if player is a free-rider
    const playerIsFreeRider = playerContrib < FREE_RIDER_THRESHOLD;

    // AI citizens punish based on their contribution level
    citizenContribs.forEach(citizen => {
        let punishPlayer = false;

        // High contributors (≥$7) punish free-riders 80% of the time
        if (citizen.amount >= 7 && playerIsFreeRider) {
            punishPlayer = Math.random() < 0.8;
        }
        // Medium contributors ($4-6) punish free-riders 50% of the time
        else if (citizen.amount >= 4 && citizen.amount < 7 && playerIsFreeRider) {
            punishPlayer = Math.random() < 0.5;
        }
        // Low contributors don't punish (they're part of the problem!)

        if (punishPlayer) {
            punishments.playerPunished = true;
            punishments.playerPunishmentCount++;
            punishments.details.push({
                name: citizen.name,
                punishedPlayer: true
            });
        }
    });

    return punishments;
}

// Show punishment results
function showPunishmentResults(playerPunishments, playerPunishmentCost, playerPunishmentReceived, aiPunishments) {
    document.getElementById('punishment-view').style.display = 'none';
    document.getElementById('punishment-results-view').style.display = 'block';

    const resultsContent = document.getElementById('punishment-results-content');

    let resultsHTML = '<div class="punishment-results-content">';

    // Player's punishments
    if (playerPunishments.length > 0) {
        resultsHTML += `
            <div class="punishment-results-section">
                <h4 style="color: var(--warning-color);">You Punished:</h4>
                <ul>
        `;
        playerPunishments.forEach(p => {
            resultsHTML += `<li>${p.name} (contributed $${p.contrib}) - Lost $${PUNISHMENT_PENALTY}</li>`;
        });
        resultsHTML += `
                </ul>
                <p style="margin-top: 0.5rem; color: var(--danger-color);">Your cost: -$${playerPunishmentCost}</p>
            </div>
        `;
    } else {
        resultsHTML += `
            <div class="punishment-results-section">
                <p style="color: var(--text-secondary);">You didn't punish anyone this round.</p>
            </div>
        `;
    }

    // Punishments received by player
    if (aiPunishments.playerPunished) {
        resultsHTML += `
            <div class="punishment-results-section">
                <h4 style="color: var(--danger-color);">You Were Punished:</h4>
                <p>${aiPunishments.playerPunishmentCount} citizen(s) punished you for low contribution!</p>
                <p style="margin-top: 0.5rem; color: var(--danger-color);">Your penalty: -$${playerPunishmentReceived}</p>
            </div>
        `;
    } else {
        resultsHTML += `
            <div class="punishment-results-section">
                <p style="color: var(--success-color);">✅ No one punished you this round!</p>
            </div>
        `;
    }

    // Net effect
    const netEffect = -(playerPunishmentCost + playerPunishmentReceived);
    resultsHTML += `
        <div class="punishment-results-section punishment-net">
            <h4>Net Punishment Effect:</h4>
            <p style="color: ${netEffect < 0 ? 'var(--danger-color)' : 'var(--success-color)'}; font-size: 1.2rem;">
                ${netEffect >= 0 ? '+' : ''}$${netEffect.toFixed(2)}
            </p>
        </div>
    `;

    resultsHTML += '</div>';
    resultsContent.innerHTML = resultsHTML;

    // Update stats display
    updateStats();

    // Next round button
    document.getElementById('next-round-after-punishment-btn').onclick = () => {
        if (gameState.currentRound < gameState.totalRounds) {
            gameState.currentRound++;
            startRound();
        } else {
            endGame();
        }
    };
}

// Update citizens activity
function updateCitizensActivity(citizenContribs) {
    const citizensActivity = document.getElementById('citizens-activity');
    let html = `<p style="margin-bottom: 1rem; color: var(--primary-color);">Round ${gameState.currentRound} Contributions:</p>`;

    citizenContribs.forEach(citizen => {
        const contribLevel = citizen.amount >= 8 ? '🟢' : citizen.amount >= 4 ? '🟡' : citizen.amount > 0 ? '🟠' : '🔴';
        html += `
            <div class="citizen-action">
                ${contribLevel} <strong>${citizen.name}:</strong> $${citizen.amount}
            </div>
        `;
    });

    citizensActivity.innerHTML = html;
}

// Add to history
function addToHistory(contrib, roundTotal) {
    const historyList = document.getElementById('history-list');

    // Remove empty state
    const emptyState = historyList.querySelector('.empty-state');
    if (emptyState) {
        emptyState.remove();
    }

    const historyItem = document.createElement('div');
    historyItem.className = 'history-item';
    historyItem.innerHTML = `
        <div class="history-item-header">Round ${gameState.currentRound}</div>
        <div class="history-item-detail">
            Contributed: $${contrib} | Round total: $${roundTotal.toFixed(2)}
        </div>
    `;

    historyList.insertBefore(historyItem, historyList.firstChild);
}

// Update stats
function updateStats() {
    document.getElementById('total-wealth').textContent = `$${gameState.playerWealth.toFixed(2)}`;
    document.getElementById('total-contributed').textContent = `$${gameState.totalContributed}`;

    const avgContrib = gameState.contributions.length > 0
        ? (gameState.totalContributed / gameState.contributions.length).toFixed(1)
        : 0;
    document.getElementById('avg-contribution').textContent = `$${avgContrib}`;

    // Free-ride score: how much below maximum contribution (10)
    const freeRideScore = gameState.contributions.length > 0
        ? Math.min(100, Math.max(0, ((10 - avgContrib) / 10) * 100))
        : 0;
    document.getElementById('free-ride-score').textContent = `${Math.round(freeRideScore)}%`;
}

// End game
async function endGame() {
    // Save game data to Firebase
    await saveGameData();

    // Show results screen
    gameScreen.style.display = 'none';
    resultsScreen.style.display = 'block';

    displayFinalResults();
}

// Save game data
async function saveGameData() {
    if (!db) {
        console.log('Demo mode - not saving data');
        return;
    }

    try {
        const { ref, set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');

        const avgContrib = gameState.totalContributed / gameState.contributions.length;

        const gameData = {
            gameId: gameState.gameId,
            playerName: gameState.playerName,
            timestamp: Date.now(),
            totalContributed: gameState.totalContributed,
            finalWealth: gameState.playerWealth,
            totalRounds: gameState.totalRounds,
            contributions: gameState.contributions,
            avgContribution: avgContrib,
            completed: true
        };

        const gameRef = ref(db, `public-goods-games/${gameState.gameId}`);
        await set(gameRef, gameData);

        console.log('Game data saved successfully');
    } catch (error) {
        console.log('Error saving game data:', error);
    }
}

// Display final results
async function displayFinalResults() {
    // Display final stats
    document.getElementById('final-wealth').textContent = `$${gameState.playerWealth.toFixed(2)}`;
    document.getElementById('final-contributed').textContent = `$${gameState.totalContributed}`;

    const avgContrib = gameState.totalContributed / gameState.contributions.length;
    document.getElementById('final-avg-contrib').textContent = `$${avgContrib.toFixed(2)}`;

    // Load comparison data
    await loadComparisonData(avgContrib);

    // Create contribution chart
    createContributionChart();

    // Show insights
    displayInsights();

    // Play again button
    document.getElementById('play-again-btn').onclick = () => {
        location.reload();
    };
}

// Load comparison data
async function loadComparisonData(avgContrib) {
    const comparisonContent = document.getElementById('comparison-content');

    if (!db) {
        comparisonContent.innerHTML = `
            <p style="margin-bottom: 1rem;">Your average contribution: <span style="color: var(--contrib-color)">$${avgContrib.toFixed(2)}</span></p>
            <p style="margin-bottom: 1rem;">Global average: <span style="color: var(--contrib-color)">$4.20</span></p>
            <p style="margin-bottom: 1rem;">Optimal contribution: <span style="color: var(--success-color)">$10.00</span></p>
            <p style="color: var(--primary-color);">${getPlayerArchetype(avgContrib)}</p>
            <p style="margin-top: 1.5rem; font-size: 0.55rem; color: var(--text-secondary);">Note: Demo mode - showing simulated data</p>
        `;
        return;
    }

    try {
        const { ref, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
        const gamesRef = ref(db, 'public-goods-games');
        const snapshot = await get(gamesRef);

        if (snapshot.exists()) {
            const games = Object.values(snapshot.val());

            // Calculate global average
            const globalAvg = games.reduce((sum, g) => sum + (g.avgContribution || 0), 0) / games.length;

            // Calculate percentile
            const avgContribs = games.map(g => g.avgContribution || 0);
            const lowerCount = avgContribs.filter(c => c < avgContrib).length;
            const percentile = Math.round((lowerCount / avgContribs.length) * 100);

            comparisonContent.innerHTML = `
                <p style="margin-bottom: 1rem;">Your average: <span style="color: var(--contrib-color)">$${avgContrib.toFixed(2)}</span></p>
                <p style="margin-bottom: 1rem;">Global average: <span style="color: var(--contrib-color)">$${globalAvg.toFixed(2)}</span></p>
                <p style="margin-bottom: 1rem;">Contribution percentile: <span style="color: var(--warning-color)">${percentile}th</span></p>
                <p style="color: var(--primary-color);">${getPlayerArchetype(avgContrib)}</p>
            `;
        }
    } catch (error) {
        console.log('Error loading comparison data:', error);
    }
}

// Get player archetype
function getPlayerArchetype(avgContrib) {
    if (avgContrib >= 9) {
        return '🌟 Altruist - You maximize the public good';
    } else if (avgContrib >= 7) {
        return '🤝 Strong Contributor - You support the commons';
    } else if (avgContrib >= 5) {
        return '⚖️ Moderate Contributor - You balance self-interest and cooperation';
    } else if (avgContrib >= 3) {
        return '🎭 Conditional Cooperator - You contribute, but not generously';
    } else if (avgContrib >= 1) {
        return '🏴‍☠️ Partial Free-Rider - You contribute minimally';
    } else {
        return '💀 Total Free-Rider - You contribute nothing';
    }
}

// Create contribution chart
function createContributionChart() {
    const ctx = document.getElementById('contribChart').getContext('2d');

    const labels = gameState.roundHistory.map(r => `R${r.round}`);
    const playerData = gameState.contributions;

    new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Your Contribution',
                data: playerData,
                borderColor: 'rgba(0, 217, 255, 1)',
                backgroundColor: 'rgba(0, 217, 255, 0.1)',
                borderWidth: 3,
                tension: 0.3
            }, {
                label: 'Optimal ($10)',
                data: Array(labels.length).fill(10),
                borderColor: 'rgba(0, 255, 65, 1)',
                borderDash: [5, 5],
                borderWidth: 2,
                fill: false
            }, {
                label: 'Zero (Free-Ride)',
                data: Array(labels.length).fill(0),
                borderColor: 'rgba(255, 0, 85, 1)',
                borderDash: [5, 5],
                borderWidth: 2,
                fill: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    max: 12,
                    ticks: { color: '#a0a8d4' },
                    grid: { color: 'rgba(0, 217, 255, 0.1)' }
                },
                x: {
                    ticks: { color: '#a0a8d4' },
                    grid: { color: 'rgba(0, 217, 255, 0.1)' }
                }
            },
            plugins: {
                legend: {
                    labels: { color: '#ffffff', font: { size: 10 } }
                }
            }
        }
    });
}

// Display insights
function displayInsights() {
    const insightsGrid = document.getElementById('insights-grid');

    const avgContrib = gameState.totalContributed / gameState.contributions.length;
    const maxContrib = Math.max(...gameState.contributions);
    const minContrib = Math.min(...gameState.contributions);

    // Calculate if player did better by free-riding
    const actualWealth = gameState.playerWealth;
    const ifAlwaysContributed10 = 100 + (10 * 10 * MULTIPLIER / 5) - 100; // Net from always contributing $10
    const contributionCost = gameState.totalContributed;

    // Calculate punishment statistics
    const punishmentSpent = gameState.totalPunishmentSpent;
    const punishmentReceived = gameState.totalPunishmentReceived;
    const netPunishment = punishmentReceived - punishmentSpent;
    const roundsPunished = gameState.punishmentHistory.filter(p => p.playerPunishmentReceived > 0).length;
    const roundsYouPunished = gameState.punishmentHistory.filter(p => p.playerPunished.length > 0).length;

    let insightsHTML = `
        <div class="insight-card">
            <h4>Your Pattern</h4>
            <p>Average contribution: $${avgContrib.toFixed(2)}. Ranged from $${minContrib} to $${maxContrib}. ${avgContrib < 5 ? 'You free-rode more than contributed.' : 'You supported the public good.'}</p>
        </div>
        <div class="insight-card">
            <h4>Punishment Impact</h4>
            <p>You spent $${punishmentSpent} punishing others and received $${punishmentReceived} in punishments. ${netPunishment > 0 ? `Net cost: $${netPunishment.toFixed(2)} - being a free-rider was expensive!` : netPunishment < 0 ? `You enforced norms while contributing, paying $${Math.abs(netPunishment).toFixed(2)} to maintain cooperation.` : 'You neither gained nor lost from punishment.'}</p>
        </div>
        <div class="insight-card">
            <h4>Enforcement History</h4>
            <p>You were punished in ${roundsPunished} out of 10 rounds. You punished others in ${roundsYouPunished} rounds. ${roundsPunished > 5 ? 'Frequent punishment signals low contribution - the group enforced norms against you.' : 'Rare punishment suggests you contributed fairly.'}</p>
        </div>
        <div class="insight-card">
            <h4>The Paradox</h4>
            <p>If everyone contributed $10, each person would end with $200 ($100 starting + $100 from pool). But free-riding is individually rational, so most people don't.</p>
        </div>
        <div class="insight-card">
            <h4>Your Wealth</h4>
            <p>You ended with $${actualWealth.toFixed(2)}. If everyone (including you) always contributed $10, you'd have $200. The punishment system ${punishmentReceived > punishmentSpent ? 'penalized your free-riding' : 'allowed you to enforce cooperation'}, affecting your final wealth.</p>
        </div>
        <div class="insight-card">
            <h4>Why Punishment Works</h4>
            <p>Research by Fehr & Gächter showed punishment increases cooperation from ~40% to ~90%. Even costly punishment (you pay $1, they lose $3) sustains public goods. This explains why societies need enforcement - police, fines, reputation systems.</p>
        </div>
        <div class="insight-card">
            <h4>Real World</h4>
            <p>Wikipedia, PBS, open-source software, climate action - all suffer from free-riding. Without enforcement (reputation, moderation, social pressure), public goods collapse. The math punishes contributors and rewards free-riders, so institutions add costly punishment to sustain cooperation.</p>
        </div>
    `;

    insightsGrid.innerHTML = insightsHTML;
}

// Initialize game
async function init() {
    await initFirebase();
    await loadPlayerCount();
    await loadWelcomeStats();
}

// Start when page loads
init();
