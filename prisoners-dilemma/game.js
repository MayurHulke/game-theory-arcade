import { firebaseConfig, isFirebaseConfigured } from '../shared/firebase-config.js';

// Opponent Strategies (based on 2024 research)
const OPPONENT_STRATEGIES = {
    'tit-for-tat': {
        name: 'Tit-for-Tat',
        emoji: '🔄',
        description: 'Mirrors your previous move. Classic reciprocal strategy.',
        decide: (gameState, partnerChoices) => {
            if (gameState.currentRound === 1) return 'cooperate';
            // Mirror player's last choice
            return gameState.choices[gameState.currentRound - 2];
        }
    },
    'generous-tft': {
        name: 'Generous Tit-for-Tat',
        emoji: '😊',
        description: 'Like Tit-for-Tat but occasionally forgives defections.',
        decide: (gameState, partnerChoices) => {
            if (gameState.currentRound === 1) return 'cooperate';
            const lastPlayerChoice = gameState.choices[gameState.currentRound - 2];
            // If player defected, forgive 30% of the time
            if (lastPlayerChoice === 'defect' && Math.random() < 0.3) {
                return 'cooperate';
            }
            return lastPlayerChoice;
        }
    },
    'win-stay-lose-shift': {
        name: 'Win-Stay-Lose-Shift',
        emoji: '🎲',
        description: 'Repeats successful moves, changes after bad outcomes.',
        decide: (gameState, partnerChoices) => {
            if (gameState.currentRound === 1) return 'cooperate';
            const lastOpponentChoice = partnerChoices[partnerChoices.length - 1];
            const lastPlayerChoice = gameState.choices[gameState.currentRound - 2];

            // WSLS: Stay if good outcome, shift if bad outcome (from opponent's perspective)
            if (lastOpponentChoice === 'cooperate') {
                // Opponent cooperated last round
                if (lastPlayerChoice === 'cooperate') {
                    return 'cooperate'; // Mutual cooperation (1 year) - good outcome, STAY
                } else {
                    return 'defect'; // Player defected (20 years!) - bad outcome, SHIFT
                }
            } else {
                // Opponent defected last round
                if (lastPlayerChoice === 'cooperate') {
                    return 'defect'; // Player cooperated (0 years!) - great outcome, STAY
                } else {
                    return 'cooperate'; // Mutual defection (5 years) - bad outcome, SHIFT
                }
            }
        }
    },
    'pavlov': {
        name: 'Pavlov',
        emoji: '🧠',
        description: 'Cooperates after mutual cooperation or mutual defection.',
        decide: (gameState, partnerChoices) => {
            if (gameState.currentRound === 1) return 'cooperate';
            const lastOpponentChoice = partnerChoices[partnerChoices.length - 1];
            const lastPlayerChoice = gameState.choices[gameState.currentRound - 2];

            // Cooperate if both did the same thing last round
            if (lastOpponentChoice === lastPlayerChoice) {
                return 'cooperate';
            }
            return 'defect';
        }
    },
    'always-defect': {
        name: 'Always Defect',
        emoji: '⚔️',
        description: 'Pure selfishness. Always defects.',
        decide: (gameState, partnerChoices) => {
            return 'defect';
        }
    },
    'gradual': {
        name: 'Gradual',
        emoji: '📈',
        description: 'Escalates retaliation gradually, then offers forgiveness.',
        decide: (gameState, partnerChoices) => {
            if (gameState.currentRound === 1) return 'cooperate';

            // Count how many times player defected
            const playerDefections = gameState.choices.filter(c => c === 'defect').length;
            const lastPlayerChoice = gameState.choices[gameState.currentRound - 2];

            // If player just defected, retaliate equal to number of their defections
            if (lastPlayerChoice === 'defect') {
                // Retaliate for N rounds (where N = their total defections)
                const roundsSinceLastDefection = gameState.currentRound - 1 -
                    gameState.choices.lastIndexOf('defect');

                if (roundsSinceLastDefection <= playerDefections) {
                    return 'defect';
                }
            }

            // Otherwise cooperate
            return 'cooperate';
        }
    },
    'random': {
        name: 'Random',
        emoji: '🎰',
        description: 'Unpredictable. Makes random choices.',
        decide: (gameState, partnerChoices) => {
            return Math.random() < 0.5 ? 'cooperate' : 'defect';
        }
    }
};

// Game State
const gameState = {
    playerName: 'Anonymous',
    currentRound: 1,
    maxRounds: 10,
    totalYears: 0,
    choices: [],
    sessionId: generateSessionId(),
    partnerChoices: [], // Pre-generated for consistency
    opponentStrategy: null // Selected at game start
};

// Firebase variables (will be initialized if configured)
let db = null;
let isFirebaseReady = false;

// Payoffs (years in prison - lower is better)
const PAYOFFS = {
    'cooperate-cooperate': { you: 1, partner: 1 },
    'cooperate-defect': { you: 20, partner: 0 },
    'defect-cooperate': { you: 0, partner: 20 },
    'defect-defect': { you: 5, partner: 5 }
};

// Behavioral Archetypes
const ARCHETYPES = {
    'altruist': {
        icon: '😇',
        name: 'The Altruist',
        description: 'You consistently cooperate, even when it might cost you. You believe in building trust and mutual benefit.',
        condition: (coopRate) => coopRate >= 80
    },
    'strategist': {
        icon: '🎯',
        name: 'The Strategist',
        description: 'You balance cooperation and self-interest, adapting your strategy based on outcomes.',
        condition: (coopRate) => coopRate >= 40 && coopRate < 80
    },
    'opportunist': {
        icon: '🦊',
        name: 'The Opportunist',
        description: 'You primarily look out for yourself, cooperating only when absolutely necessary.',
        condition: (coopRate) => coopRate >= 20 && coopRate < 40
    },
    'defector': {
        icon: '⚔️',
        name: 'The Rational Defector',
        description: 'You follow game theory\'s prediction: defection is your dominant strategy. Self-interest guides every choice.',
        condition: (coopRate) => coopRate < 20
    }
};

// Initialize Firebase
async function initFirebase() {
    if (!isFirebaseConfigured()) {
        console.log('Firebase not configured - running in demo mode with simulated data');
        isFirebaseReady = false;
        return;
    }

    try {
        // Import Firebase modules
        const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getDatabase, ref, push, get, set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');

        const app = initializeApp(firebaseConfig);
        db = getDatabase(app);
        isFirebaseReady = true;
        console.log('Firebase initialized successfully');

        // Export database functions for use in other functions
        window.firebaseDB = { ref, push, get, set };
    } catch (error) {
        console.error('Firebase initialization failed:', error);
        isFirebaseReady = false;
    }
}

// Generate unique session ID
function generateSessionId() {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Save game data to Firebase
async function saveGameData() {
    if (!isFirebaseReady || !window.firebaseDB) {
        console.log('Firebase not ready, skipping save');
        return;
    }

    try {
        const { ref, set } = window.firebaseDB;
        const gameData = {
            timestamp: Date.now(),
            totalScore: -gameState.totalYears,  // Convert years to score (negative years = better score)
            cooperationRate: calculateCooperationRate(),
            rounds: gameState.maxRounds,
            playerArchetype: determineArchetype(calculateCooperationRate()).name
        };

        await set(ref(db, `games/${gameState.sessionId}`), gameData);

        // Also update aggregate stats by round
        for (let i = 0; i < gameState.choices.length; i++) {
            const roundRef = ref(db, `rounds/round_${i + 1}/${gameState.choices[i]}`);
            const snapshot = await window.firebaseDB.get(roundRef);
            const currentCount = snapshot.exists() ? snapshot.val() : 0;
            await set(roundRef, currentCount + 1);
        }

        console.log('Game data saved successfully');
    } catch (error) {
        console.error('Error saving game data:', error);
    }
}

// Get aggregate statistics from Firebase
async function getAggregateStats() {
    if (!isFirebaseReady || !window.firebaseDB) {
        // Return demo data if Firebase not configured
        return getDemoStats();
    }

    try {
        const { ref, get } = window.firebaseDB;

        // Get all games
        const gamesSnapshot = await get(ref(db, 'games'));

        if (!gamesSnapshot.exists()) {
            return getDemoStats();
        }

        const allGames = Object.values(gamesSnapshot.val());
        const stats = {
            totalPlayers: allGames.length,
            rounds: {},
            cooperationRates: [],
            totalYears: []
        };

        // Calculate round-by-round statistics
        for (let roundNum = 1; roundNum <= 10; roundNum++) {
            const roundSnapshot = await get(ref(db, `rounds/round_${roundNum}`));
            if (roundSnapshot.exists()) {
                const roundData = roundSnapshot.val();
                const coop = roundData.cooperate || 0;
                const defect = roundData.defect || 0;
                const total = coop + defect;

                stats.rounds[`round_${roundNum}`] = {
                    cooperate: coop,
                    defect: defect,
                    cooperationRate: total > 0 ? (coop / total) * 100 : 50
                };
            } else {
                stats.rounds[`round_${roundNum}`] = {
                    cooperate: 0,
                    defect: 0,
                    cooperationRate: 50
                };
            }
        }

        // Collect all cooperation rates and total years for percentile calculation
        allGames.forEach(game => {
            if (game.cooperationRate !== undefined) {
                stats.cooperationRates.push(game.cooperationRate);
            }
            if (game.totalYears !== undefined) {
                stats.totalYears.push(game.totalYears);
            }
        });

        return stats;
    } catch (error) {
        console.error('Error getting aggregate stats:', error);
        return getDemoStats();
    }
}

// Demo stats for when Firebase is not configured
function getDemoStats() {
    const stats = {
        totalPlayers: 1247,
        rounds: {},
        cooperationRates: [],
        totalYears: []
    };

    // Generate realistic demo data
    for (let i = 1; i <= 10; i++) {
        // Cooperation tends to decrease over rounds
        const baseCoopRate = 65 - (i * 3) + (Math.random() * 10 - 5);
        const coopRate = Math.max(30, Math.min(90, baseCoopRate));
        const totalChoices = 1247;
        const coop = Math.round(totalChoices * coopRate / 100);

        stats.rounds[`round_${i}`] = {
            cooperate: coop,
            defect: totalChoices - coop,
            cooperationRate: coopRate
        };
    }

    // Generate cooperation rates (normal distribution around 50%)
    for (let i = 0; i < 1247; i++) {
        const rate = Math.max(0, Math.min(100, 50 + (Math.random() - 0.5) * 60));
        stats.cooperationRates.push(rate);

        // Total years correlates with cooperation (less cooperation = more years)
        const years = Math.round(10 + (100 - rate) * 0.3 + (Math.random() * 5));
        stats.totalYears.push(years);
    }

    return stats;
}

// Calculate percentile
function calculatePercentile(value, array) {
    const sorted = array.slice().sort((a, b) => a - b);
    const index = sorted.findIndex(v => v >= value);
    if (index === -1) return 100;
    return Math.round((index / sorted.length) * 100);
}

// Calculate cooperation rate
function calculateCooperationRate() {
    const coopCount = gameState.choices.filter(c => c === 'cooperate').length;
    return Math.round((coopCount / gameState.choices.length) * 100);
}

// Determine behavioral archetype
function determineArchetype(coopRate) {
    for (const [key, archetype] of Object.entries(ARCHETYPES)) {
        if (archetype.condition(coopRate)) {
            return archetype;
        }
    }
    return ARCHETYPES.strategist; // Default
}

// DOM Elements
const welcomeScreen = document.getElementById('welcome-screen');
const gameScreen = document.getElementById('game-screen');
const resultsScreen = document.getElementById('results-screen');

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    await initFirebase();
    await showWelcomeScreen();

    // Event listeners
    document.getElementById('start-game-btn').addEventListener('click', startGame);
    document.getElementById('cooperate-btn').addEventListener('click', () => makeChoice('cooperate'));
    document.getElementById('defect-btn').addEventListener('click', () => makeChoice('defect'));
    document.getElementById('next-round-btn').addEventListener('click', nextRound);
    document.getElementById('play-again-btn').addEventListener('click', resetGame);
    document.getElementById('share-btn').addEventListener('click', shareResults);
});

// Show welcome screen with preview stats
async function showWelcomeScreen() {
    const stats = await getAggregateStats();

    document.getElementById('total-players').textContent = stats.totalPlayers.toLocaleString();

    // Calculate average cooperation rate
    const avgCoopRate = stats.cooperationRates.length > 0
        ? Math.round(stats.cooperationRates.reduce((a, b) => a + b, 0) / stats.cooperationRates.length)
        : 52;

    document.getElementById('preview-coop-rate').textContent = `${avgCoopRate}%`;
    document.getElementById('preview-r1-coop').textContent = `${Math.round(stats.rounds.round_1.cooperationRate)}%`;
}

// Start game
function startGame() {
    const nameInput = document.getElementById('player-name');
    gameState.playerName = nameInput.value.trim() || 'Anonymous';

    gameState.currentRound = 1;
    gameState.totalYears = 0;
    gameState.choices = [];
    gameState.partnerChoices = [];
    gameState.sessionId = generateSessionId();

    // Select random opponent strategy
    const strategyKeys = Object.keys(OPPONENT_STRATEGIES);
    const randomKey = strategyKeys[Math.floor(Math.random() * strategyKeys.length)];
    gameState.opponentStrategy = randomKey;

    welcomeScreen.style.display = 'none';
    gameScreen.style.display = 'block';

    updateGameUI();
}

// Make choice
async function makeChoice(choice) {
    gameState.choices.push(choice);

    // Generate partner choice using selected strategy
    const strategy = OPPONENT_STRATEGIES[gameState.opponentStrategy];
    const partnerChoice = strategy.decide(gameState, gameState.partnerChoices);

    gameState.partnerChoices.push(partnerChoice);

    // Calculate outcome
    const outcomeKey = `${choice}-${partnerChoice}`;
    const payoff = PAYOFFS[outcomeKey];
    gameState.totalYears += payoff.you;

    // Update UI
    document.getElementById('cooperate-btn').disabled = true;
    document.getElementById('defect-btn').disabled = true;

    // Show result
    showRoundResult(choice, partnerChoice, payoff.you);

    // Update crowd statistics
    await updateCrowdStats(gameState.currentRound, choice);

    updateProgress();
}

// Show round result
function showRoundResult(yourChoice, partnerChoice, years) {
    const resultDiv = document.getElementById('round-result');
    const decisionArea = document.querySelector('.decision-area');

    decisionArea.style.display = 'none';
    resultDiv.style.display = 'block';

    // Update choice badges
    const yourChoiceEl = document.getElementById('your-choice');
    yourChoiceEl.textContent = yourChoice === 'cooperate' ? '🤝 Cooperated' : '🔪 Defected';
    yourChoiceEl.className = `choice-badge ${yourChoice}`;

    const partnerChoiceEl = document.getElementById('partner-choice');
    partnerChoiceEl.textContent = partnerChoice === 'cooperate' ? '🤝 Cooperated' : '🔪 Defected';
    partnerChoiceEl.className = `choice-badge ${partnerChoice}`;

    document.getElementById('your-years').textContent = years;

    // Update total stats
    document.getElementById('total-years').textContent = `${gameState.totalYears} years`;
    const coopRate = calculateCooperationRate();
    document.getElementById('your-coop-rate').textContent = `${coopRate}%`;

    // Update choice history
    updateChoiceHistory();
}

// Update choice history visual
function updateChoiceHistory() {
    const historyDiv = document.getElementById('choice-history');
    historyDiv.innerHTML = '';

    gameState.choices.forEach((choice, index) => {
        const item = document.createElement('div');
        item.className = `history-item ${choice}`;
        item.textContent = index + 1;
        item.title = `Round ${index + 1}: ${choice}`;
        historyDiv.appendChild(item);
    });
}

// Update crowd statistics
async function updateCrowdStats(roundNum, yourChoice) {
    const stats = await getAggregateStats();
    const roundKey = `round_${roundNum}`;
    const roundData = stats.rounds[roundKey];

    if (roundData) {
        const coopPct = Math.round(roundData.cooperationRate);
        const defectPct = 100 - coopPct;

        document.getElementById('crowd-coop-pct').textContent = `${coopPct}%`;
        document.getElementById('crowd-defect-pct').textContent = `${defectPct}%`;
        document.getElementById('crowd-coop-bar').style.width = `${coopPct}%`;

        // Generate insight
        let insight = '';
        if (yourChoice === 'cooperate' && coopPct >= 60) {
            insight = `You're in the majority! ${coopPct}% of players also cooperated this round.`;
        } else if (yourChoice === 'cooperate' && coopPct < 40) {
            insight = `You're more trusting than most! Only ${coopPct}% cooperated this round.`;
        } else if (yourChoice === 'defect' && defectPct >= 60) {
            insight = `You played it safe like ${defectPct}% of players this round.`;
        } else {
            insight = `You chose differently than ${yourChoice === 'cooperate' ? defectPct : coopPct}% of players.`;
        }

        document.getElementById('round-insight').textContent = insight;
    }
}

// Update progress
function updateProgress() {
    const progress = (gameState.currentRound / gameState.maxRounds) * 100;
    document.getElementById('progress-fill').style.width = `${progress}%`;
}

// Next round
function nextRound() {
    if (gameState.currentRound >= gameState.maxRounds) {
        endGame();
        return;
    }

    gameState.currentRound++;
    document.getElementById('round-number').textContent = gameState.currentRound;

    // Reset UI for next round
    document.getElementById('cooperate-btn').disabled = false;
    document.getElementById('defect-btn').disabled = false;
    document.querySelector('.decision-area').style.display = 'block';
    document.getElementById('round-result').style.display = 'none';

    updateGameUI();
}

// Update game UI
function updateGameUI() {
    document.getElementById('round-number').textContent = gameState.currentRound;
    updateProgress();
}

// End game and show results
async function endGame() {
    await saveGameData();

    gameScreen.style.display = 'none';
    resultsScreen.style.display = 'block';

    await showResults();
}

// Show results screen
async function showResults() {
    const coopRate = calculateCooperationRate();
    const stats = await getAggregateStats();

    // Final scores
    document.getElementById('final-years').textContent = `${gameState.totalYears} years`;
    document.getElementById('final-coop-rate').textContent = `${coopRate}%`;
    document.getElementById('comparison-count').textContent = `${stats.totalPlayers.toLocaleString()} Players`;

    // Calculate percentiles
    const coopPercentile = calculatePercentile(coopRate, stats.cooperationRates);
    const timePercentile = 100 - calculatePercentile(gameState.totalYears, stats.totalYears); // Invert because lower is better

    // Cooperation comparison
    document.getElementById('coop-percentile').textContent = `${coopPercentile}th`;
    document.getElementById('coop-bar-fill').style.width = `${coopPercentile}%`;

    let coopDesc = '';
    if (coopPercentile >= 80) {
        coopDesc = 'You\'re among the most cooperative players!';
    } else if (coopPercentile >= 60) {
        coopDesc = 'You cooperate more than most players.';
    } else if (coopPercentile >= 40) {
        coopDesc = 'Your cooperation level is about average.';
    } else if (coopPercentile >= 20) {
        coopDesc = 'You\'re more strategic than cooperative.';
    } else {
        coopDesc = 'You rarely cooperate - pure self-interest!';
    }
    document.getElementById('coop-desc').textContent = coopDesc;

    // Time comparison
    document.getElementById('time-percentile').textContent = `${timePercentile}th`;
    document.getElementById('time-bar-fill').style.width = `${timePercentile}%`;

    let timeDesc = '';
    if (timePercentile >= 80) {
        timeDesc = 'You got less prison time than most players!';
    } else if (timePercentile >= 50) {
        timeDesc = 'You did better than average.';
    } else {
        timeDesc = 'Your strategy could use some work.';
    }
    document.getElementById('time-desc').textContent = timeDesc;

    // Behavioral archetype
    const archetype = determineArchetype(coopRate);
    document.getElementById('archetype-icon').textContent = archetype.icon;
    document.getElementById('archetype-name').textContent = archetype.name;
    document.getElementById('archetype-desc').textContent = archetype.description;

    // Calculate archetype prevalence
    const archetypeCount = stats.cooperationRates.filter(rate => archetype.condition(rate)).length;
    const prevalence = Math.round((archetypeCount / stats.cooperationRates.length) * 100);
    document.getElementById('archetype-prevalence').textContent = `${prevalence}% of players share this archetype`;

    // Reveal opponent strategy
    const strategy = OPPONENT_STRATEGIES[gameState.opponentStrategy];
    const opponentReveal = document.getElementById('opponent-reveal');
    if (opponentReveal) {
        opponentReveal.innerHTML = `
            <div class="opponent-strategy-reveal">
                <h3>🎭 Opponent Strategy Revealed</h3>
                <div class="opponent-strategy">
                    <span class="strategy-emoji">${strategy.emoji}</span>
                    <div class="strategy-details">
                        <div class="strategy-name">${strategy.name}</div>
                        <div class="strategy-description">${strategy.description}</div>
                    </div>
                </div>
                <p class="strategy-insight">Now you know! Try playing again to face a different opponent strategy.</p>
            </div>
        `;
    }

    // Generate insights
    generateInsights(stats, coopRate);

    // Create evolution chart
    createEvolutionChart(stats);
}

// Generate insights
function generateInsights(stats, yourCoopRate) {
    const insightsGrid = document.getElementById('insights-grid');
    insightsGrid.innerHTML = '';

    const insights = [];

    // Insight 1: Overall cooperation vs theory
    const avgCoop = Math.round(stats.cooperationRates.reduce((a, b) => a + b, 0) / stats.cooperationRates.length);
    insights.push({
        title: 'Humans vs Theory',
        value: `${avgCoop}%`,
        description: `cooperate on average - defying game theory's prediction of 0% cooperation!`
    });

    // Insight 2: First round behavior
    const round1Coop = Math.round(stats.rounds.round_1.cooperationRate);
    insights.push({
        title: 'Initial Trust',
        value: `${round1Coop}%`,
        description: 'of players start by cooperating, showing humans default to trust.'
    });

    // Insight 3: Trust decay
    const round10Coop = Math.round(stats.rounds.round_10.cooperationRate);
    const decay = round1Coop - round10Coop;
    insights.push({
        title: 'Trust Erosion',
        value: `${Math.abs(decay)}%`,
        description: decay > 0 ? 'drop in cooperation from Round 1 to Round 10' : 'increase in cooperation over time!'
    });

    // Insight 4: Your vs Average
    const diff = yourCoopRate - avgCoop;
    insights.push({
        title: 'Your Strategy',
        value: diff > 0 ? `+${diff}%` : `${diff}%`,
        description: `${diff > 0 ? 'more cooperative' : 'less cooperative'} than the average player`
    });

    insights.forEach(insight => {
        const card = document.createElement('div');
        card.className = 'insight-card';
        card.innerHTML = `
            <div class="insight-title">${insight.title}</div>
            <div class="insight-value">${insight.value}</div>
            <div class="insight-description">${insight.description}</div>
        `;
        insightsGrid.appendChild(card);
    });
}

// Create evolution chart
function createEvolutionChart(stats) {
    const ctx = document.getElementById('evolutionChart').getContext('2d');

    const crowdData = [];
    const yourData = [];

    for (let i = 1; i <= 10; i++) {
        crowdData.push(stats.rounds[`round_${i}`].cooperationRate);

        // Calculate your cooperation rate up to this round
        const yourChoices = gameState.choices.slice(0, i);
        const coops = yourChoices.filter(c => c === 'cooperate').length;
        yourData.push((coops / i) * 100);
    }

    new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10'],
            datasets: [
                {
                    label: 'Everyone',
                    data: crowdData,
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139, 92, 246, 0.1)',
                    tension: 0.4,
                    borderWidth: 3
                },
                {
                    label: 'You',
                    data: yourData,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    tension: 0.4,
                    borderWidth: 3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: '#cbd5e1', font: { size: 14 } }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    ticks: { color: '#cbd5e1', callback: (value) => value + '%' },
                    grid: { color: 'rgba(203, 213, 225, 0.1)' },
                    title: { display: true, text: 'Cooperation Rate (%)', color: '#cbd5e1' }
                },
                x: {
                    ticks: { color: '#cbd5e1' },
                    grid: { color: 'rgba(203, 213, 225, 0.1)' }
                }
            }
        }
    });
}

// Reset game
function resetGame() {
    resultsScreen.style.display = 'none';
    welcomeScreen.style.display = 'block';
    showWelcomeScreen();
}

// Share results
function shareResults() {
    const coopRate = calculateCooperationRate();
    const archetype = determineArchetype(coopRate);
    const text = `I just played the Prisoner's Dilemma! I'm "${archetype.name}" with ${coopRate}% cooperation and ${gameState.totalYears} years prison time. How would you play?`;

    if (navigator.share) {
        navigator.share({
            title: 'Prisoner\'s Dilemma Results',
            text: text,
            url: window.location.href
        }).catch(err => console.log('Share failed:', err));
    } else {
        // Fallback: copy to clipboard
        navigator.clipboard.writeText(text + ' ' + window.location.href)
            .then(() => alert('Results copied to clipboard!'))
            .catch(err => console.error('Copy failed:', err));
    }
}
