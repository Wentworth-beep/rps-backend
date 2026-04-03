const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// CORS for Vercel
const io = socketIo(server, {
    cors: {
        origin: ['https://rps-fronthead.vercel.app', 'http://localhost:3000', 'http://localhost:3001'],
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling']
});

app.use(cors({
    origin: ['https://rps-fronthead.vercel.app', 'http://localhost:3000', 'http://localhost:3001'],
    credentials: true
}));
app.use(express.json());

const JWT_SECRET = 'kirinyaga_secret_key_2025';

// ============ DATABASE TABLES ============
const users = [];
let nextUserId = 1;

// Friendships
const friendships = [];
let nextFriendshipId = 1;

// Friend Requests
const friendRequests = [];
let nextFriendRequestId = 1;

// Game Sessions
const gameSessions = [];
let nextGameSessionId = 1;

// Matches
const matches = [];
let nextMatchId = 1;

// Replays
const replays = [];
let nextReplayId = 1;

// Tournaments
const tournaments = [];
let nextTournamentId = 1;

// Tournament Participants
const tournamentParticipants = [];

// Power-ups
const userPowerups = [];
let nextPowerupId = 1;

// Daily Rewards Log
const dailyRewards = [];
let nextDailyRewardId = 1;

// Available Power-ups
const availablePowerups = [
    { id: 'double_points', name: 'Double Points', description: 'Win gives 2x coins', icon: 'fa-bolt', cost: 500, duration: 3 },
    { id: 'shield', name: 'Shield', description: 'Loss doesn\'t reduce streak', icon: 'fa-shield-alt', cost: 300, duration: 1 },
    { id: 'prediction', name: 'Prediction', description: 'See opponent\'s move', icon: 'fa-eye', cost: 400, duration: 1 },
    { id: 'lucky_charm', name: 'Lucky Charm', description: 'Higher win chance', icon: 'fa-clover', cost: 600, duration: 5 },
    { id: 'coin_boost', name: 'Coin Boost', description: 'Earn 2x coins for 5 matches', icon: 'fa-coins', cost: 800, duration: 5 }
];

// Active Matches for Multiplayer
const activeMatches = [];
const matchmakingQueue = [];

// Online Users
let onlineUsers = [];

// Level requirements (wins needed for each level)
const levelRequirements = {
    1: 0, 2: 5, 3: 10, 4: 15, 5: 20, 6: 26, 7: 32, 8: 38, 9: 44, 10: 50,
    11: 57, 12: 64, 13: 71, 14: 78, 15: 85, 16: 93, 17: 101, 18: 109, 19: 117, 20: 125,
    21: 134, 22: 143, 23: 152, 24: 161, 25: 170, 26: 180, 27: 190, 28: 200, 29: 210, 30: 220,
    31: 231, 32: 242, 33: 253, 34: 264, 35: 275, 36: 287, 37: 299, 38: 311, 39: 323, 40: 335,
    41: 348, 42: 361, 43: 374, 44: 387, 45: 400, 46: 414, 47: 428, 48: 442, 49: 456, 50: 470
};

// Coin rewards for wins
const winRewards = {
    win: 50,
    streak_bonus: 20,
    perfect_win: 100,
    comeback: 75
};

// Daily login rewards
const dailyRewardAmounts = {
    1: 100, 2: 150, 3: 200, 4: 250, 5: 300, 6: 400, 7: 500
};

// ============ HELPER FUNCTIONS ============
function getLevelFromWins(wins) {
    for (let level = 50; level >= 1; level--) {
        if (wins >= levelRequirements[level]) {
            return level;
        }
    }
    return 1;
}

function getWinsNeededForNextLevel(currentWins) {
    for (let level = 1; level <= 50; level++) {
        if (currentWins < levelRequirements[level]) {
            return levelRequirements[level] - currentWins;
        }
    }
    return 0;
}

function getLevelUpReward(level) {
    return level * 50; // 50 coins per level
}

function calculateCoinReward(won, streak, isPerfect = false, isComeback = false) {
    if (!won) return 10; // Participation coins even on loss
    
    let reward = winRewards.win;
    if (streak >= 3) reward += winRewards.streak_bonus;
    if (streak >= 5) reward += winRewards.streak_bonus * 2;
    if (streak >= 10) reward += winRewards.streak_bonus * 3;
    if (isPerfect) reward += winRewards.perfect_win;
    if (isComeback) reward += winRewards.comeback;
    
    return reward;
}

function findUserById(id) {
    return users.find(u => u.id === id);
}

function findUserByUsername(username) {
    return users.find(u => u.username === username);
}

function updateUserStats(userId, won, isPerfect = false, isComeback = false) {
    const user = findUserById(userId);
    if (!user) return;
    
    const previousLevel = getLevelFromWins(user.total_wins);
    
    if (won) {
        user.total_wins++;
        // Calculate coin reward
        const reward = calculateCoinReward(true, user.win_streak, isPerfect, isComeback);
        user.coins += reward;
        user.win_streak++;
        user.total_earned_coins += reward;
        
        // Update MMR
        user.mmr += 25;
    } else {
        user.total_games++;
        user.coins += 10; // Participation coins
        user.win_streak = 0;
        user.mmr = Math.max(0, user.mmr - 25);
    }
    
    user.total_games++;
    
    // Update level
    const newLevel = getLevelFromWins(user.total_wins);
    if (newLevel > previousLevel) {
        const levelUpReward = getLevelUpReward(newLevel);
        user.coins += levelUpReward;
        user.level = newLevel;
        user.level_up_message = `Congratulations! You reached Level ${newLevel} and earned ${levelUpReward} coins!`;
    } else {
        user.level = newLevel;
    }
    
    // Update rank based on MMR
    if (user.mmr >= 3000) user.rank = 'Legend';
    else if (user.mmr >= 2500) user.rank = 'Master';
    else if (user.mmr >= 2000) user.rank = 'Diamond';
    else if (user.mmr >= 1500) user.rank = 'Platinum';
    else if (user.mmr >= 1000) user.rank = 'Gold';
    else if (user.mmr >= 500) user.rank = 'Silver';
    else user.rank = 'Bronze';
    
    // Update badge
    if (user.total_wins >= 500) user.badge = 'Legend';
    else if (user.total_wins >= 250) user.badge = 'Master';
    else if (user.total_wins >= 100) user.badge = 'Diamond';
    else if (user.total_wins >= 50) user.badge = 'Platinum';
    else if (user.total_wins >= 25) user.badge = 'Gold';
    else if (user.total_wins >= 10) user.badge = 'Silver';
    else user.badge = 'Bronze';
    
    return {
        coins_earned: won ? calculateCoinReward(true, user.win_streak - 1, isPerfect, isComeback) : 10,
        new_level: newLevel > previousLevel,
        level_up_reward: newLevel > previousLevel ? getLevelUpReward(newLevel) : 0,
        wins_needed_next: getWinsNeededForNextLevel(user.total_wins)
    };
}

function addMatch(player1Id, player2Id, winnerId, player1Move, player2Move, gameType, mmrChange, coinsEarned = 0) {
    const match = {
        id: nextMatchId++,
        player1_id: player1Id,
        player2_id: player2Id,
        winner_id: winnerId,
        player1_move: player1Move,
        player2_move: player2Move,
        game_type: gameType,
        mmr_change: mmrChange,
        coins_earned: coinsEarned,
        created_at: new Date().toISOString()
    };
    matches.push(match);
    
    // Create replay
    replays.push({
        id: nextReplayId++,
        match_id: match.id,
        moves: JSON.stringify([{ player1: player1Move, player2: player2Move, winner: winnerId }]),
        created_at: new Date().toISOString()
    });
    
    return match;
}

// ============ DAILY REWARDS ============
function claimDailyReward(userId) {
    const user = findUserById(userId);
    if (!user) return { success: false, error: 'User not found' };
    
    const today = new Date().toDateString();
    const lastClaim = user.last_daily_claim ? new Date(user.last_daily_claim).toDateString() : null;
    
    if (lastClaim === today) {
        return { success: false, error: 'Already claimed today' };
    }
    
    let streak = user.daily_streak || 0;
    if (lastClaim === new Date(Date.now() - 86400000).toDateString()) {
        streak++;
    } else {
        streak = 1;
    }
    
    if (streak > 7) streak = 7;
    
    const reward = dailyRewardAmounts[streak] || 100;
    user.coins += reward;
    user.daily_streak = streak;
    user.last_daily_claim = new Date().toISOString();
    
    dailyRewards.push({
        id: nextDailyRewardId++,
        user_id: userId,
        reward: reward,
        streak: streak,
        claimed_at: new Date().toISOString()
    });
    
    return { success: true, reward: reward, streak: streak, total_coins: user.coins };
}

// ============ INITIALIZE DATA ============
async function initData() {
    // Create admin user
    const adminHash = await bcrypt.hash('Peaceking', 10);
    users.push({
        id: nextUserId++,
        username: 'admin',
        email: 'santasantol087@gmail.com',
        password_hash: adminHash,
        role: 'admin',
        badge: 'Legend',
        level: 50,
        total_wins: 5000,
        total_games: 5500,
        mmr: 3500,
        rank: 'Legend',
        is_banned: false,
        avatar: 'dragon',
        coins: 100000,
        win_streak: 0,
        daily_streak: 0,
        total_earned_coins: 100000,
        last_daily_claim: null,
        created_at: new Date().toISOString()
    });
    
    // Create sample users
    const playerHash = await bcrypt.hash('player123', 10);
    const sampleUsers = [
        { username: 'CyberWarrior', email: 'warrior@test.com', badge: 'Master', level: 25, wins: 150, mmr: 2200, rank: 'Master', avatar: 'ninja', coins: 2500 },
        { username: 'NeonRookie', email: 'rookie@test.com', badge: 'Bronze', level: 3, wins: 8, mmr: 450, rank: 'Bronze', avatar: 'robot', coins: 200 },
        { username: 'GlitchMaster', email: 'glitch@test.com', badge: 'Gold', level: 12, wins: 60, mmr: 1200, rank: 'Gold', avatar: 'wizard', coins: 800 },
        { username: 'ShadowBlade', email: 'shadow@test.com', badge: 'Platinum', level: 18, wins: 90, mmr: 1800, rank: 'Platinum', avatar: 'ghost', coins: 1500 }
    ];
    
    for (const user of sampleUsers) {
        users.push({
            id: nextUserId++,
            username: user.username,
            email: user.email,
            password_hash: playerHash,
            role: 'user',
            badge: user.badge,
            level: user.level,
            total_wins: user.wins,
            total_games: user.wins + 50,
            mmr: user.mmr,
            rank: user.rank,
            is_banned: false,
            avatar: user.avatar,
            coins: user.coins,
            win_streak: 0,
            daily_streak: 0,
            total_earned_coins: user.coins,
            last_daily_claim: null,
            created_at: new Date().toISOString()
        });
    }
    
    console.log('✅ Database initialized with', users.length, 'users');
    console.log('   Level requirements configured for levels 1-50');
    console.log('   Coin rewards: Win=' + winRewards.win + ', Streak bonus=' + winRewards.streak_bonus);
    console.log('   Daily rewards: Day 1-7 = 100-500 coins');
}

// ============ USER ROUTES ============

// Register
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'All fields required' });
    }
    
    const existing = findUserByUsername(username);
    if (existing) {
        return res.status(400).json({ error: 'Username already exists' });
    }
    
    const hash = await bcrypt.hash(password, 10);
    const newUser = {
        id: nextUserId++,
        username,
        email,
        password_hash: hash,
        role: 'user',
        badge: 'Bronze',
        level: 1,
        total_wins: 0,
        total_games: 0,
        mmr: 500,
        rank: 'Bronze',
        is_banned: false,
        avatar: 'ninja',
        coins: 500, // Starting coins
        win_streak: 0,
        daily_streak: 0,
        total_earned_coins: 500,
        last_daily_claim: null,
        created_at: new Date().toISOString()
    };
    users.push(newUser);
    
    const token = jwt.sign({ id: newUser.id, username: newUser.username, role: newUser.role }, JWT_SECRET);
    res.json({ success: true, token, user: newUser });
});

// Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    const user = findUserByUsername(username);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.is_banned) return res.status(403).json({ error: 'Account banned' });
    
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET);
    res.json({
        success: true,
        token,
        user: {
            id: user.id, username: user.username, role: user.role,
            badge: user.badge, level: user.level, total_wins: user.total_wins,
            mmr: user.mmr, rank: user.rank, coins: user.coins, avatar: user.avatar,
            win_streak: user.win_streak, daily_streak: user.daily_streak || 0,
            wins_needed_next: getWinsNeededForNextLevel(user.total_wins)
        }
    });
});

// Get user stats (includes level progression)
app.get('/api/user/stats', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = findUserById(decoded.id);
        res.json({
            username: user.username, badge: user.badge, level: user.level,
            total_wins: user.total_wins, total_games: user.total_games,
            mmr: user.mmr, rank: user.rank, coins: user.coins, avatar: user.avatar,
            win_streak: user.win_streak, daily_streak: user.daily_streak || 0,
            total_earned_coins: user.total_earned_coins,
            wins_needed_next: getWinsNeededForNextLevel(user.total_wins),
            next_level_wins: levelRequirements[user.level + 1] || levelRequirements[50],
            current_level_wins: levelRequirements[user.level] || 0
        });
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

// Claim daily reward
app.post('/api/daily-reward', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const result = claimDailyReward(decoded.id);
        res.json(result);
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

// Play vs Computer (with coin rewards and level tracking)
app.post('/api/game/computer', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { playerMove, difficulty } = req.body;
        
        let computerMove;
        const moves = ['rock', 'paper', 'scissors'];
        
        if (difficulty === 'easy') {
            computerMove = moves[Math.floor(Math.random() * 3)];
        } else if (difficulty === 'medium') {
            computerMove = moves[Math.floor(Math.random() * 3)];
            if (Math.random() > 0.6) {
                if (playerMove === 'rock') computerMove = 'paper';
                else if (playerMove === 'paper') computerMove = 'scissors';
                else computerMove = 'rock';
            }
        } else {
            computerMove = moves[Math.floor(Math.random() * 3)];
            if (Math.random() > 0.4) {
                if (playerMove === 'rock') computerMove = 'paper';
                else if (playerMove === 'paper') computerMove = 'scissors';
                else computerMove = 'rock';
            }
        }
        
        let result = 'tie';
        let won = false;
        
        if (playerMove === computerMove) {
            result = 'tie';
        } else if ((playerMove === 'rock' && computerMove === 'scissors') ||
                   (playerMove === 'paper' && computerMove === 'rock') ||
                   (playerMove === 'scissors' && computerMove === 'paper')) {
            result = 'win';
            won = true;
        } else {
            result = 'lose';
        }
        
        // Update user stats with rewards
        const statsUpdate = updateUserStats(decoded.id, won, false, false);
        const updatedUser = findUserById(decoded.id);
        
        res.json({ 
            result, 
            computerMove, 
            playerMove,
            coins_earned: statsUpdate?.coins_earned || (won ? 50 : 10),
            level_up: statsUpdate?.new_level || false,
            level_up_reward: statsUpdate?.level_up_reward || 0,
            new_level: updatedUser?.level,
            wins_needed_next: getWinsNeededForNextLevel(updatedUser?.total_wins || 0),
            total_coins: updatedUser?.coins,
            win_streak: updatedUser?.win_streak
        });
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

// Get level requirements
app.get('/api/level-requirements', (req, res) => {
    res.json(levelRequirements);
});

// Leaderboard
app.get('/api/leaderboard', (req, res) => {
    const leaderboard = [...users]
        .filter(u => u.role === 'user')
        .sort((a, b) => b.mmr - a.mmr)
        .slice(0, 20)
        .map((u, i) => ({
            rank: i + 1, username: u.username, wins: u.total_wins,
            mmr: u.mmr, badge: u.badge, avatar: u.avatar, level: u.level,
            coins: u.coins
        }));
    res.json(leaderboard);
});

// Match History
app.get('/api/match-history', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const userMatches = matches.filter(m => m.player1_id === decoded.id || m.player2_id === decoded.id);
        const history = userMatches.slice(0, 20).map(m => {
            const isWinner = m.winner_id === decoded.id;
            const opponentId = m.player1_id === decoded.id ? m.player2_id : m.player1_id;
            const opponent = findUserById(opponentId);
            return {
                result: isWinner ? 'win' : (m.winner_id === null ? 'tie' : 'lose'),
                opponent: opponent ? opponent.username : 'Computer',
                mmrChange: m.mmr_change || 0,
                coinsEarned: m.coins_earned || 0,
                timestamp: m.created_at
            };
        });
        res.json(history);
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

// Verify token
app.get('/api/verify-token', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        res.json({ valid: true, user: decoded });
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

// ============ FRIEND SYSTEM ============
app.post('/api/friends/request', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { username } = req.body;
        const friend = findUserByUsername(username);
        
        if (!friend) return res.status(404).json({ error: 'User not found' });
        if (friend.id === decoded.id) return res.status(400).json({ error: 'Cannot add yourself' });
        
        const existing = friendRequests.find(r => 
            (r.from_id === decoded.id && r.to_id === friend.id) ||
            (r.from_id === friend.id && r.to_id === decoded.id)
        );
        if (existing) return res.status(400).json({ error: 'Request already sent' });
        
        friendRequests.push({
            id: nextFriendRequestId++,
            from_id: decoded.id,
            to_id: friend.id,
            status: 'pending',
            created_at: new Date().toISOString()
        });
        
        res.json({ success: true, message: 'Friend request sent' });
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

app.post('/api/friends/accept/:requestId', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const requestId = parseInt(req.params.requestId);
        const request = friendRequests.find(r => r.id === requestId);
        
        if (!request) return res.status(404).json({ error: 'Request not found' });
        if (request.to_id !== decoded.id) return res.status(403).json({ error: 'Not authorized' });
        
        request.status = 'accepted';
        friendships.push({
            id: nextFriendshipId++,
            user_id1: request.from_id,
            user_id2: request.to_id,
            status: 'accepted',
            created_at: new Date().toISOString()
        });
        
        res.json({ success: true });
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

app.get('/api/friends/list', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const userFriendships = friendships.filter(f => f.user_id1 === decoded.id || f.user_id2 === decoded.id);
        const friends = userFriendships.map(f => {
            const friendId = f.user_id1 === decoded.id ? f.user_id2 : f.user_id1;
            return findUserById(friendId);
        }).filter(f => f);
        
        res.json(friends.map(f => ({
            id: f.id, username: f.username, avatar: f.avatar, rank: f.rank, 
            online: onlineUsers.some(u => u.userId === f.id), level: f.level
        })));
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

app.get('/api/friends/requests', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const pending = friendRequests.filter(r => r.to_id === decoded.id && r.status === 'pending');
        const requestsWithSender = pending.map(r => {
            const sender = findUserById(r.from_id);
            return { id: r.id, from_id: r.from_id, from_username: sender?.username, created_at: r.created_at };
        });
        res.json(requestsWithSender);
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

// ============ POWER-UPS ============
app.get('/api/powerups', (req, res) => {
    res.json(availablePowerups);
});

app.post('/api/powerups/buy', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { powerUpId } = req.body;
        const powerUp = availablePowerups.find(p => p.id === powerUpId);
        
        if (!powerUp) return res.status(404).json({ error: 'Power-up not found' });
        
        const user = findUserById(decoded.id);
        if (user.coins < powerUp.cost) return res.status(400).json({ error: 'Not enough coins' });
        
        user.coins -= powerUp.cost;
        userPowerups.push({
            id: nextPowerupId++,
            user_id: decoded.id,
            powerup_id: powerUpId,
            quantity: 1,
            acquired_at: new Date().toISOString()
        });
        
        res.json({ success: true, coins: user.coins, message: `Bought ${powerUp.name}!` });
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

app.get('/api/user/powerups', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const userPowerupList = userPowerups.filter(p => p.user_id === decoded.id);
        const powerupsWithDetails = userPowerupList.map(p => {
            const details = availablePowerups.find(ap => ap.id === p.powerup_id);
            return { ...p, name: details?.name, icon: details?.icon };
        });
        res.json(powerupsWithDetails);
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

// ============ TOURNAMENTS ============
app.post('/api/tournament/create', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { name, maxPlayers = 8, prizePool = 0 } = req.body;
        
        const tournament = {
            id: nextTournamentId++,
            name: name || `${findUserById(decoded.id).username}'s Tournament`,
            host_id: decoded.id,
            status: 'waiting',
            max_players: maxPlayers,
            current_players: 1,
            prize_pool: prizePool,
            created_at: new Date().toISOString()
        };
        tournaments.push(tournament);
        
        tournamentParticipants.push({
            tournament_id: tournament.id,
            user_id: decoded.id,
            username: findUserById(decoded.id).username,
            status: 'registered',
            joined_at: new Date().toISOString()
        });
        
        res.json({ success: true, tournamentId: tournament.id, code: tournament.id });
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

app.post('/api/tournament/join', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { tournamentId } = req.body;
        const tournament = tournaments.find(t => t.id === parseInt(tournamentId));
        
        if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
        if (tournament.status !== 'waiting') return res.status(400).json({ error: 'Tournament already started' });
        if (tournament.current_players >= tournament.max_players) return res.status(400).json({ error: 'Tournament is full' });
        
        tournament.current_players++;
        tournamentParticipants.push({
            tournament_id: tournament.id,
            user_id: decoded.id,
            username: findUserById(decoded.id).username,
            status: 'registered',
            joined_at: new Date().toISOString()
        });
        
        if (tournament.current_players === tournament.max_players) {
            tournament.status = 'active';
            const participants = tournamentParticipants.filter(p => p.tournament_id === tournament.id);
            const shuffled = [...participants];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            tournament.bracket = shuffled;
        }
        
        res.json({ success: true });
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

app.get('/api/tournament/:id', (req, res) => {
    const tournament = tournaments.find(t => t.id === parseInt(req.params.id));
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    
    const participants = tournamentParticipants.filter(p => p.tournament_id === tournament.id);
    res.json({ ...tournament, participants });
});

app.get('/api/tournaments', (req, res) => {
    const activeTournaments = tournaments.filter(t => t.status === 'waiting');
    res.json(activeTournaments);
});

// ============ ACHIEVEMENTS ============
app.get('/api/achievements', (req, res) => {
    const achievements = [
        { id: 'first_blood', name: 'First Blood', description: 'Win your first match', icon: 'fa-trophy', requirement: 1 },
        { id: 'warrior', name: 'Warrior', description: 'Win 10 matches', icon: 'fa-shield-alt', requirement: 10 },
        { id: 'legendary', name: 'Legendary', description: 'Win 50 matches', icon: 'fa-crown', requirement: 50 },
        { id: 'veteran', name: 'Veteran', description: 'Play 100 matches', icon: 'fa-star', requirement: 100 },
        { id: 'millionaire', name: 'Millionaire', description: 'Earn 1000 coins', icon: 'fa-coins', requirement: 1000 },
        { id: 'streak_master', name: 'Streak Master', description: 'Win 5 in a row', icon: 'fa-fire', requirement: 5 }
    ];
    
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.json(achievements.map(a => ({ ...a, unlocked: false })));
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = findUserById(decoded.id);
        
        const unlockedAchievements = achievements.map(a => {
            let unlocked = false;
            if (a.id === 'first_blood' && user.total_wins >= 1) unlocked = true;
            if (a.id === 'warrior' && user.total_wins >= 10) unlocked = true;
            if (a.id === 'legendary' && user.total_wins >= 50) unlocked = true;
            if (a.id === 'veteran' && user.total_games >= 100) unlocked = true;
            if (a.id === 'millionaire' && user.total_earned_coins >= 1000) unlocked = true;
            if (a.id === 'streak_master' && user.win_streak >= 5) unlocked = true;
            return { ...a, unlocked };
        });
        
        res.json(unlockedAchievements);
    } catch (error) {
        res.json(achievements.map(a => ({ ...a, unlocked: false })));
    }
});

// ============ ADMIN ROUTES ============
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;
    const user = findUserByUsername(username);
    if (!user || user.role !== 'admin') return res.status(401).json({ error: 'Invalid admin credentials' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid admin credentials' });
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET);
    res.json({ success: true, token, admin: { id: user.id, username: user.username, role: user.role } });
});

app.get('/api/admin/users', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
        const allUsers = users.map(u => ({
            id: u.id, username: u.username, email: u.email, role: u.role,
            badge: u.badge, level: u.level, total_wins: u.total_wins,
            mmr: u.mmr, is_banned: u.is_banned, avatar: u.avatar, coins: u.coins
        }));
        res.json(allUsers);
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

app.post('/api/admin/ban-user', (req, res) => {
    const { userId, ban } = req.body;
    const user = findUserById(parseInt(userId));
    if (user && user.role !== 'admin') user.is_banned = ban;
    res.json({ success: true });
});

app.post('/api/admin/update-badge', (req, res) => {
    const { userId, badge } = req.body;
    const user = findUserById(parseInt(userId));
    if (user) user.badge = badge;
    res.json({ success: true });
});

app.get('/api/admin/online-count', (req, res) => {
    res.json({ count: onlineUsers.length });
});

app.get('/api/admin/total-users', (req, res) => {
    const count = users.filter(u => u.role === 'user').length;
    res.json({ count });
});

// Update avatar
app.post('/api/update-avatar', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { avatar } = req.body;
        const user = findUserById(decoded.id);
        if (user) user.avatar = avatar;
        res.json({ success: true });
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

// ============ SOCKET.IO ============
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    let currentUserId = null;
    
    socket.on('user-online', (data) => {
        currentUserId = data.userId;
        onlineUsers.push({ userId: data.userId, username: data.username, socketId: socket.id });
        io.emit('online-count', { count: onlineUsers.length });
    });
    
    socket.on('join-matchmaking', (data) => {
        if (!matchmakingQueue.includes(data.userId)) {
            matchmakingQueue.push({ userId: data.userId, username: data.username, socketId: socket.id });
        }
        
        const checkMatch = setInterval(() => {
            if (matchmakingQueue.length >= 2) {
                const player1 = matchmakingQueue.shift();
                const player2 = matchmakingQueue.shift();
                
                if (player1 && player2) {
                    const matchCode = Math.random().toString(36).substring(2, 8).toUpperCase();
                    const match = { matchCode, player1, player2, status: 'active' };
                    activeMatches.push(match);
                    
                    io.to(player1.socketId).emit('match-found', { matchCode, opponent: player2.username });
                    io.to(player2.socketId).emit('match-found', { matchCode, opponent: player1.username });
                    clearInterval(checkMatch);
                }
            }
        }, 2000);
        
        socket.on('leave-matchmaking', () => {
            const index = matchmakingQueue.findIndex(p => p.userId === data.userId);
            if (index !== -1) matchmakingQueue.splice(index, 1);
            clearInterval(checkMatch);
        });
    });
    
    socket.on('create-match', (data) => {
        const matchCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        activeMatches.push({ matchCode, hostId: data.userId, hostName: data.username, hostSocket: socket.id, status: 'waiting' });
        socket.join(matchCode);
        socket.emit('match-created', { matchCode });
    });
    
    socket.on('join-match', (data) => {
        const match = activeMatches.find(m => m.matchCode === data.matchCode && m.status === 'waiting');
        if (match) {
            match.opponentId = data.userId;
            match.opponentName = data.username;
            match.opponentSocket = socket.id;
            match.status = 'active';
            
            socket.join(data.matchCode);
            io.to(match.hostSocket).emit('match-started', { matchCode: data.matchCode });
            socket.emit('match-started', { matchCode: data.matchCode });
        } else {
            socket.emit('join-error', { error: 'Match not found' });
        }
    });
    
    socket.on('make-move', (data) => {
        const match = activeMatches.find(m => m.matchCode === data.matchCode);
        if (match) {
            if (match.hostId === data.userId) match.hostMove = data.move;
            else match.opponentMove = data.move;
            
            if (match.hostMove && match.opponentMove) {
                let winner = null;
                if (match.hostMove === match.opponentMove) winner = 'tie';
                else if ((match.hostMove === 'rock' && match.opponentMove === 'scissors') ||
                         (match.hostMove === 'paper' && match.opponentMove === 'rock') ||
                         (match.hostMove === 'scissors' && match.opponentMove === 'paper')) {
                    winner = match.hostId;
                } else {
                    winner = match.opponentId;
                }
                
                if (winner !== 'tie') {
                    const winnerUser = findUserById(winner);
                    const loserId = winner === match.hostId ? match.opponentId : match.hostId;
                    updateUserStats(winner, true);
                    updateUserStats(loserId, false);
                    addMatch(match.hostId, match.opponentId, winner, match.hostMove, match.opponentMove, 'casual', winner === match.hostId ? 25 : -25);
                }
                
                io.to(data.matchCode).emit('game-result', {
                    hostMove: match.hostMove,
                    opponentMove: match.opponentMove,
                    winner: winner
                });
                
                const index = activeMatches.findIndex(m => m.matchCode === data.matchCode);
                if (index !== -1) activeMatches.splice(index, 1);
            }
        }
    });
    
    socket.on('send-sticker', (data) => {
        io.to(data.matchCode).emit('new-sticker', { username: data.username, sticker: data.sticker });
    });
    
    socket.on('disconnect', () => {
        onlineUsers = onlineUsers.filter(u => u.socketId !== socket.id);
        const queueIndex = matchmakingQueue.findIndex(p => p.socketId === socket.id);
        if (queueIndex !== -1) matchmakingQueue.splice(queueIndex, 1);
        io.emit('online-count', { count: onlineUsers.length });
    });
});

// Start server
const PORT = process.env.PORT || 3000;

initData().then(() => {
    server.listen(PORT, '0.0.0.0', () => {
        console.log('\n========================================');
        console.log('💰 RPS CYBER ARENA - COMPLETE ECONOMY');
        console.log('========================================');
        console.log(`✅ Server running on port ${PORT}`);
        console.log('========================================');
        console.log('💵 COIN EARNING METHODS:');
        console.log('   • Win a match: 50 coins');
        console.log('   • Loss participation: 10 coins');
        console.log('   • 3-win streak bonus: +20 coins');
        console.log('   • 5-win streak bonus: +40 coins');
        console.log('   • Level up reward: Level × 50 coins');
        console.log('   • Daily login: 100-500 coins');
        console.log('========================================');
        console.log('📈 LEVEL SYSTEM (1-50):');
        console.log('   • Level 1: 0 wins');
        console.log('   • Level 10: 50 wins');
        console.log('   • Level 25: 170 wins');
        console.log('   • Level 50: 470 wins');
        console.log('========================================');
        console.log('📋 LOGIN CREDENTIALS:');
        console.log('   Admin: admin / Peaceking (100,000 coins)');
        console.log('   Test: CyberWarrior / player123 (2,500 coins)');
        console.log('   Test: NeonRookie / player123 (200 coins)');
        console.log('========================================\n');
    });
});
