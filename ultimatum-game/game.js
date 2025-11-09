import { firebaseConfig, isFirebaseConfigured } from '../shared/firebase-config.js';

// Game state
let gameState = {
    playerName: 'Anonymous',
    currentRound: 1,
    totalRounds: 5,
    totalEarnings: 0,
    offers: [],
    responses: [],
    history: [],
    gameId: null
};

// AI responder fairness thresholds (based on research: most people reject offers below 30%)
const AI_FAIRNESS = {
    alwaysAccept: 0.2,      // 20% always accept any offer
    acceptFair: 0.6,        // 60% accept offers >= $3 (30%)
    acceptModerate: 0.15,   // 15% accept offers >= $2 (20%)
    rejectUnfair: 0.05      // 5% reject anything below $5 (50%)
};

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
        document.getElementById('preview-avg-offer').textContent = '$4.20';
        document.getElementById('preview-reject-rate').textContent = '32%';
        return;
    }

    try {
        const { ref, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
        const gamesRef = ref(db, 'ultimatum-games');
        const snapshot = await get(gamesRef);

        if (snapshot.exists()) {
            const games = Object.values(snapshot.val());

            // Calculate average offer
            const totalOffers = games.reduce((sum, g) => sum + (g.averageOffer || 0), 0);
            const avgOffer = (totalOffers / games.length).toFixed(2);
            document.getElementById('preview-avg-offer').textContent = `$${avgOffer}`;

            // Calculate rejection rate
            const totalRejections = games.reduce((sum, g) => {
                const rejections = (g.responses || []).filter(r => !r.accepted).length;
                return sum + rejections;
            }, 0);
            const totalResponses = games.reduce((sum, g) => (g.responses || []).length, 0);
            const rejectRate = totalResponses > 0 ? Math.round((totalRejections / totalResponses) * 100) : 32;
            document.getElementById('preview-reject-rate').textContent = `${rejectRate}%`;
        }
    } catch (error) {
        console.log('Error loading welcome stats:', error);
    }
}

// Load player count
async function loadPlayerCount() {
    const playerCountEl = document.getElementById('total-players');

    if (!db) {
        playerCountEl.textContent = '1,247';
        return;
    }

    try {
        const { ref, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
        const gamesRef = ref(db, 'ultimatum-games');
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

// Round management
function startRound() {
    // Randomly assign role (50/50 chance)
    const isProposer = Math.random() < 0.5;

    updateRoundHeader();

    if (isProposer) {
        showProposerView();
    } else {
        showResponderView();
    }

    updateStats();
    updateCrowdStats();
}

function updateRoundHeader() {
    document.getElementById('round-number').textContent = gameState.currentRound;
    const progress = (gameState.currentRound / gameState.totalRounds) * 100;
    document.getElementById('progress-fill').style.width = `${progress}%`;
}

// Proposer view
function showProposerView() {
    const roleBadge = document.getElementById('role-badge');
    roleBadge.textContent = 'PROPOSER';
    roleBadge.style.background = 'var(--success-color)';
    roleBadge.style.borderColor = '#00cc33';

    document.getElementById('proposer-view').style.display = 'block';
    document.getElementById('responder-view').style.display = 'none';
    document.getElementById('result-view').style.display = 'none';

    const input = document.getElementById('offer-amount');
    input.value = 5;
    updateOfferDisplay(5);

    // Update display as user types
    input.oninput = (e) => {
        let value = parseInt(e.target.value) || 0;
        // Clamp value between 0 and 10
        if (value < 0) value = 0;
        if (value > 10) value = 10;
        e.target.value = value;
        updateOfferDisplay(value);
    };

    document.getElementById('submit-offer-btn').onclick = () => {
        let offer = parseInt(input.value) || 0;
        // Validate offer is between 0 and 10
        if (offer < 0) offer = 0;
        if (offer > 10) offer = 10;
        handleProposerSubmit(offer);
    };
}

function updateOfferDisplay(offer) {
    const youGet = 10 - offer;
    document.getElementById('you-get').textContent = `$${youGet}`;
    document.getElementById('they-get').textContent = `$${offer}`;
}

function handleProposerSubmit(offer) {
    gameState.offers.push(offer);

    // AI decides whether to accept
    const accepted = aiResponderDecision(offer);

    gameState.responses.push({
        offer: offer,
        accepted: accepted,
        role: 'proposer'
    });

    if (accepted) {
        gameState.totalEarnings += (10 - offer);
        showResult(true, `Offer Accepted! You earned $${10 - offer}`, offer);
    } else {
        showResult(false, `Offer Rejected! Both get $0`, offer);
    }

    addToHistory('Proposer', offer, accepted);
}

// AI responder logic (based on behavioral economics research)
function aiResponderDecision(offer) {
    const rand = Math.random();

    // Always accept threshold (20% of people)
    if (rand < AI_FAIRNESS.alwaysAccept) {
        return true;
    }

    // Fair offer threshold (>= $3, 30%)
    if (offer >= 3 && rand < AI_FAIRNESS.alwaysAccept + AI_FAIRNESS.acceptFair) {
        return true;
    }

    // Moderate offer threshold (>= $2, 20%)
    if (offer >= 2 && rand < AI_FAIRNESS.alwaysAccept + AI_FAIRNESS.acceptFair + AI_FAIRNESS.acceptModerate) {
        return true;
    }

    // Very fair offer threshold (>= $5, 50%)
    if (offer >= 5) {
        return true;
    }

    // Reject unfair offers
    return false;
}

// Responder view
function showResponderView() {
    const roleBadge = document.getElementById('role-badge');
    roleBadge.textContent = 'RESPONDER';
    roleBadge.style.background = 'var(--warning-color)';
    roleBadge.style.borderColor = '#ccaa00';

    document.getElementById('proposer-view').style.display = 'none';
    document.getElementById('responder-view').style.display = 'block';
    document.getElementById('result-view').style.display = 'none';

    // AI generates an offer (simulating real player behavior from research)
    const aiOffer = generateAIProposerOffer();

    document.getElementById('offer-amount-display').textContent = `$${aiOffer}`;
    document.getElementById('proposer-gets').textContent = `$${10 - aiOffer}`;
    document.getElementById('responder-gets').textContent = `$${aiOffer}`;

    document.getElementById('accept-btn').onclick = () => {
        handleResponderChoice(aiOffer, true);
    };

    document.getElementById('reject-btn').onclick = () => {
        handleResponderChoice(aiOffer, false);
    };
}

// Generate AI proposer offer (based on research: modal offer is $4-5)
function generateAIProposerOffer() {
    const rand = Math.random();

    if (rand < 0.15) return Math.floor(Math.random() * 2) + 1; // $1-2 (15% greedy)
    if (rand < 0.35) return 3; // $3 (20%)
    if (rand < 0.60) return 4; // $4 (25%)
    if (rand < 0.85) return 5; // $5 (25% - modal)
    return Math.floor(Math.random() * 3) + 6; // $6-8 (15% generous)
}

function handleResponderChoice(offer, accepted) {
    gameState.responses.push({
        offer: offer,
        accepted: accepted,
        role: 'responder'
    });

    if (accepted) {
        gameState.totalEarnings += offer;
        showResult(true, `You Accepted! You earned $${offer}`, offer);
    } else {
        showResult(false, `You Rejected! Both get $0`, offer);
    }

    addToHistory('Responder', offer, accepted);
}

// Show result
function showResult(success, message, offer) {
    document.getElementById('proposer-view').style.display = 'none';
    document.getElementById('responder-view').style.display = 'none';
    document.getElementById('result-view').style.display = 'block';

    const resultContent = document.getElementById('result-content');
    resultContent.className = success ? 'result-content result-success' : 'result-content result-failure';
    resultContent.innerHTML = `
        <p style="color: ${success ? 'var(--success-color)' : 'var(--danger-color)'}; font-size: 1rem; margin-bottom: 1rem;">
            ${success ? '✅' : '❌'} ${message}
        </p>
        <p style="color: var(--text-secondary);">Offer was: <span style="color: var(--money-color)">$${offer}</span></p>
    `;

    updateStats();

    document.getElementById('next-round-btn').onclick = () => {
        if (gameState.currentRound < gameState.totalRounds) {
            gameState.currentRound++;
            startRound();
        } else {
            endGame();
        }
    };
}

// Add to history
function addToHistory(role, offer, accepted) {
    const historyList = document.getElementById('history-list');

    // Remove empty state
    const emptyState = historyList.querySelector('.empty-state');
    if (emptyState) {
        emptyState.remove();
    }

    const historyItem = document.createElement('div');
    historyItem.className = 'history-item';
    historyItem.innerHTML = `
        <div class="history-item-header">Round ${gameState.currentRound} - ${role}</div>
        <div class="history-item-detail">
            Offer: $${offer} | ${accepted ? '✅ Accepted' : '❌ Rejected'}
        </div>
    `;

    historyList.insertBefore(historyItem, historyList.firstChild);
}

// Update stats
function updateStats() {
    document.getElementById('total-earnings').textContent = `$${gameState.totalEarnings}`;

    const proposerOffers = gameState.offers;
    if (proposerOffers.length > 0) {
        const avgOffer = (proposerOffers.reduce((a, b) => a + b, 0) / proposerOffers.length).toFixed(1);
        document.getElementById('avg-offer').textContent = `$${avgOffer}`;
    } else {
        document.getElementById('avg-offer').textContent = '$0';
    }
}

// Update crowd stats
async function updateCrowdStats() {
    const crowdStatsEl = document.getElementById('crowd-stats');

    if (!db) {
        crowdStatsEl.innerHTML = `
            <p style="margin-bottom: 1rem;">📊 <span style="color: var(--primary-color)">Demo Mode</span></p>
            <p>Average offer: <span style="color: var(--money-color)">$4.20</span></p>
            <p>Rejection rate: <span style="color: var(--danger-color)">32%</span></p>
            <p style="margin-top: 1rem; font-size: 0.5rem;">Most people offer $4-5 and reject offers below $3</p>
        `;
        return;
    }

    try {
        const { ref, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
        const gamesRef = ref(db, 'ultimatum-games');
        const snapshot = await get(gamesRef);

        if (snapshot.exists()) {
            const games = Object.values(snapshot.val());

            // Calculate average offer
            const allOffers = games.flatMap(g => g.offers || []);
            const avgOffer = allOffers.length > 0
                ? (allOffers.reduce((a, b) => a + b, 0) / allOffers.length).toFixed(2)
                : '0.00';

            // Calculate rejection rate
            const allResponses = games.flatMap(g => g.responses || []);
            const rejections = allResponses.filter(r => !r.accepted).length;
            const rejectRate = allResponses.length > 0
                ? Math.round((rejections / allResponses.length) * 100)
                : 0;

            crowdStatsEl.innerHTML = `
                <p style="margin-bottom: 1rem;">📊 <span style="color: var(--primary-color)">${games.length.toLocaleString()} players</span></p>
                <p>Average offer: <span style="color: var(--money-color)">$${avgOffer}</span></p>
                <p>Rejection rate: <span style="color: var(--danger-color)">${rejectRate}%</span></p>
                <p style="margin-top: 1rem; font-size: 0.5rem;">Live data from real players!</p>
            `;
        }
    } catch (error) {
        console.log('Error loading crowd stats:', error);
    }
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

        const proposerOffers = gameState.offers;
        const avgOffer = proposerOffers.length > 0
            ? proposerOffers.reduce((a, b) => a + b, 0) / proposerOffers.length
            : 0;

        // Determine player type based on average offer
        let playerType = 'Maximizer';
        if (avgOffer >= 5) playerType = 'Egalitarian';
        else if (avgOffer >= 4) playerType = 'Fair-Minded';
        else if (avgOffer >= 3) playerType = 'Strategic';
        else if (avgOffer >= 2) playerType = 'Risk-Taker';

        const gameData = {
            timestamp: Date.now(),
            averageOffer: avgOffer,
            playerType: playerType
        };

        const gameRef = ref(db, `ultimatum-games/${gameState.gameId}`);
        await set(gameRef, gameData);

        console.log('Game data saved successfully');
    } catch (error) {
        console.log('Error saving game data:', error);
    }
}

// Display final results
async function displayFinalResults() {
    // Display final stats
    document.getElementById('final-earnings').textContent = `$${gameState.totalEarnings}`;

    const proposerOffers = gameState.offers;
    const avgOffer = proposerOffers.length > 0
        ? (proposerOffers.reduce((a, b) => a + b, 0) / proposerOffers.length).toFixed(1)
        : '0';
    document.getElementById('final-avg-offer').textContent = `$${avgOffer}`;

    // Load comparison data
    await loadComparisonData(parseFloat(avgOffer));

    // Create offer chart
    createOfferChart();

    // Show insights
    displayInsights();

    // Play again button
    document.getElementById('play-again-btn').onclick = () => {
        location.reload();
    };
}

// Load comparison data
async function loadComparisonData(playerAvgOffer) {
    const comparisonContent = document.getElementById('comparison-content');

    if (!db) {
        comparisonContent.innerHTML = `
            <p style="margin-bottom: 1rem;">Your average offer: <span style="color: var(--money-color)">$${playerAvgOffer}</span></p>
            <p style="margin-bottom: 1rem;">Global average: <span style="color: var(--money-color)">$4.20</span></p>
            <p style="color: var(--primary-color);">You're ${playerAvgOffer > 4.2 ? 'more generous' : 'more strategic'} than average!</p>
            <p style="margin-top: 1.5rem; font-size: 0.55rem; color: var(--text-secondary);">Note: Demo mode - showing simulated data</p>
        `;
        return;
    }

    try {
        const { ref, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
        const gamesRef = ref(db, 'ultimatum-games');
        const snapshot = await get(gamesRef);

        if (snapshot.exists()) {
            const games = Object.values(snapshot.val());

            // Calculate global average
            const allAvgOffers = games.map(g => g.averageOffer || 0).filter(o => o > 0);
            const globalAvg = allAvgOffers.length > 0
                ? (allAvgOffers.reduce((a, b) => a + b, 0) / allAvgOffers.length).toFixed(2)
                : '0.00';

            // Calculate percentile
            const lowerCount = allAvgOffers.filter(o => o < playerAvgOffer).length;
            const percentile = allAvgOffers.length > 0
                ? Math.round((lowerCount / allAvgOffers.length) * 100)
                : 50;

            comparisonContent.innerHTML = `
                <p style="margin-bottom: 1rem;">Your average offer: <span style="color: var(--money-color)">$${playerAvgOffer}</span></p>
                <p style="margin-bottom: 1rem;">Global average: <span style="color: var(--money-color)">$${globalAvg}</span></p>
                <p style="margin-bottom: 1rem; color: var(--primary-color);">You're in the <span style="color: var(--warning-color)">${percentile}th percentile</span></p>
                <p style="color: var(--primary-color);">${getPersonalityType(playerAvgOffer)}</p>
            `;
        }
    } catch (error) {
        console.log('Error loading comparison data:', error);
    }
}

// Get personality type based on average offer
function getPersonalityType(avgOffer) {
    if (avgOffer >= 5) {
        return '🤝 Egalitarian - You value fairness highly!';
    } else if (avgOffer >= 4) {
        return '⚖️ Fair-Minded - You balance fairness and self-interest!';
    } else if (avgOffer >= 3) {
        return '💼 Strategic - You offer just enough to avoid rejection!';
    } else if (avgOffer >= 2) {
        return '🎲 Risk-Taker - You test how much unfairness others tolerate!';
    } else {
        return '💰 Maximizer - You prioritize personal gain!';
    }
}

// Create offer distribution chart
async function createOfferChart() {
    let allOffers = [];

    if (db) {
        try {
            const { ref, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
            const gamesRef = ref(db, 'ultimatum-games');
            const snapshot = await get(gamesRef);

            if (snapshot.exists()) {
                const games = Object.values(snapshot.val());
                allOffers = games.flatMap(g => g.offers || []);
            }
        } catch (error) {
            console.log('Error loading chart data:', error);
        }
    }

    // Use demo data if no Firebase data
    if (allOffers.length === 0) {
        allOffers = [1, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 6, 6, 7];
    }

    // Count offers by amount
    const offerCounts = Array(11).fill(0);
    allOffers.forEach(offer => {
        offerCounts[offer]++;
    });

    const playerOfferCounts = Array(11).fill(0);
    gameState.offers.forEach(offer => {
        playerOfferCounts[offer]++;
    });

    const ctx = document.getElementById('offerChart').getContext('2d');
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['$0', '$1', '$2', '$3', '$4', '$5', '$6', '$7', '$8', '$9', '$10'],
            datasets: [
                {
                    label: 'Everyone Else',
                    data: offerCounts,
                    backgroundColor: 'rgba(0, 217, 255, 0.5)',
                    borderColor: 'rgba(0, 217, 255, 1)',
                    borderWidth: 2
                },
                {
                    label: 'Your Offers',
                    data: playerOfferCounts,
                    backgroundColor: 'rgba(255, 221, 0, 0.7)',
                    borderColor: 'rgba(255, 221, 0, 1)',
                    borderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
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

// Display behavioral insights
function displayInsights() {
    const insightsGrid = document.getElementById('insights-grid');

    insightsGrid.innerHTML = `
        <div class="insight-card">
            <h4>💡 Game Theory Says...</h4>
            <p>Rational self-interest suggests offering $1 (just enough to avoid rejection). But most people don't!</p>
        </div>
        <div class="insight-card">
            <h4>🧠 What Humans Do</h4>
            <p>The modal offer is $5 (50-50 split). People care about fairness even when it costs them!</p>
        </div>
        <div class="insight-card">
            <h4>❌ Rejection Threshold</h4>
            <p>Most people reject offers below $3 (30%). We punish unfairness even at personal cost!</p>
        </div>
        <div class="insight-card">
            <h4>🌍 Cultural Variation</h4>
            <p>Fairness norms vary by culture. Some groups offer more, others accept less. Context matters!</p>
        </div>
    `;
}

// Initialize game
async function init() {
    await initFirebase();
    await loadPlayerCount();
    await loadWelcomeStats();
}

// Start when page loads
init();
