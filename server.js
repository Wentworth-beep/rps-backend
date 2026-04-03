const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
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

// ============ DATABASE TABLES (In-Memory) ============

// Users table
const users = [];
let nextUserId = 1;

// Friendships table
const friendships = [];
let nextFriendshipId = 1;

// Friend Requests table
const friendRequests = [];
let nextFriendRequestId = 1;

// Game Sessions table
const gameSessions = [];
let nextGameSessionId = 1;

// Matches table
const matches = [];
let nextMatchId = 1;

// Replays table
const replays = [];
let nextReplayId = 1;

// Tournaments table
const tournaments = [];
let nextTournamentId = 1;

// Tournament Participants table
const tournamentParticipants = [];

// Power-ups table
const userPowerups = [];
let nextPowerupId = 1;

// Available Power-ups
const availablePowerups = [
    { id: 'double_points', name: 'Double Points', description: 'Win gives 2x MMR', icon: 'fa-bolt', cost: 500, duration: 3 },
    { id: 'shield', name: 'Shield', description: 'Loss doesn\'t reduce MMR', icon: 'fa-shield-alt', cost: 300, duration: 1 },
    { id: 'prediction', name: 'Prediction', description: 'See opponent\'s move', icon: 'fa-eye', cost: 400, duration: 1 },
    { id: 'lucky_charm', name: 'Lucky Charm', description: 'Higher win chance', icon: 'fa-clover', cost: 600, duration: 5 }
];

// Active Matches for Multiplayer
const activeMatches = [];
const matchmakingQueue = [];

// Online Users
let onlineUsers = [];

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
        coins: 10000,
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
            created_at: new Date().toISOString()
        });
    }
    
    // Create sample friendships
    friendships.push({
        id: nextFriendshipId++,
        user_id1: 2,
        user_id2: 3,
        status: 'accepted',
        created_at: new Date().toISOString()
    });
    
    // Create sample friend requests
    friendRequests.push({
        id: nextFriendRequestId++,
        from_id: 3,
        to_id: 4,
        status: 'pending',
        created_at: new Date().toISOString()
    });
    
    // Create sample matches
    matches.push({
        id: nextMatchId++,
        player1_id: 2,
        player2_id: 3,
        winner_id: 2,
        player1_move: 'rock',
        player2_move: 'scissors',
        game_type: 'ranked',
        mmr_change: 25,
        created_at: new Date().toISOString()
    });
    
    // Create sample replay
    replays.push({
        id: nextReplayId++,
        match_id: 1,
        moves: JSON.stringify([{ round: 1, player1: 'rock', player2: 'scissors', winner: 2 }]),
        created_at: new Date().toISOString()
    });
    
    // Create sample tournament
    tournaments.push({
        id: nextTournamentId++,
        name: 'Weekly Championship',
        host_id: 2,
        status: 'waiting',
        max_players: 8,
        current_players: 4,
        prize_pool: 1000,
        created_at: new Date().toISOString()
    });
    
    console.log('✅ Database initialized with', users.length, 'users');
    console.log('   Friendships:', friendships.length);
    console.log('   Matches:', matches.length);
    console.log('   Tournaments:', tournaments.length);
}

// ============ HELPER FUNCTIONS ============
function findUserById(id) {
    return users.find(u => u.id === id);
}

function findUserByUsername(username) {
    return users.find(u => u.username === username);
}

function addMatch(player1Id, player2Id, winnerId, player1Move, player2Move, gameType, mmrChange) {
    const match = {
        id: nextMatchId++,
        player1_id: player1Id,
        player2_id: player2Id,
        winner_id: winnerId,
        player1_move: player1Move,
        player2_move: player2Move,
        game_type: gameType,
        mmr_change: mmrChange,
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

function addGameSession(player1Id, player2Id, gameType) {
    const session = {
        id: nextGameSessionId++,
        player1_id: player1Id,
        player2_id: player2Id,
        game_type: gameType,
        status: 'active',
        created_at: new Date().toISOString()
    };
    gameSessions.push(session);
    return session;
}

function updateUserStats(userId, won, mmrChange = 0) {
    const user = findUserById(userId);
    if (user) {
        if (won) user.total_wins++;
        user.total_games++;
        user.mmr += mmrChange;
        if (user.mmr < 0) user.mmr = 0;
        
        // Update rank based on MMR
        if (user.mmr >= 3000) user.rank = 'Legend';
        else if (user.mmr >= 2500) user.rank = 'Master';
        else if (user.mmr >= 2000) user.rank = 'Diamond';
        else if (user.mmr >= 1500) user.rank = 'Platinum';
        else if (user.mmr >= 1000) user.rank = 'Gold';
        else if (user.mmr >= 500) user.rank = 'Silver';
        else user.rank = 'Bronze';
        
        // Update badge based on wins
        if (user.total_wins >= 500) user.badge = 'Legend';
        else if (user.total_wins >= 250) user.badge = 'Master';
        else if (user.total_wins >= 100) user.badge = 'Diamond';
        else if (user.total_wins >= 50) user.badge = 'Platinum';
        else if (user.total_wins >= 25) user.badge = 'Gold';
        else if (user.total_wins >= 10) user.badge = 'Silver';
        
        user.level = Math.floor(user.total_wins / 5) + 1;
    }
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
        coins: 100,
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
            mmr: user.mmr, rank: user.rank, coins: user.coins, avatar: user.avatar
        }
    });
});

// Get user stats
app.get('/api/user/stats', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = findUserById(decoded.id);
        res.json({
            username: user.username, badge: user.badge, level: user.level,
            total_wins: user.total_wins, total_games: user.total_games,
            mmr: user.mmr, rank: user.rank, coins: user.coins, avatar: user.avatar
        });
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

// Play vs Computer
app.post('/api/game/computer', (req, res) => {
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
    if (playerMove === computerMove) result = 'tie';
    else if ((playerMove === 'rock' && computerMove === 'scissors') ||
             (playerMove === 'paper' && computerMove === 'rock') ||
             (playerMove === 'scissors' && computerMove === 'paper')) {
        result = 'win';
    } else {
        result = 'lose';
    }
    
    res.json({ result, computerMove, playerMove });
});

// Leaderboard
app.get('/api/leaderboard', (req, res) => {
    const leaderboard = [...users]
        .filter(u => u.role === 'user')
        .sort((a, b) => b.mmr - a.mmr)
        .slice(0, 20)
        .map((u, i) => ({
            rank: i + 1, username: u.username, wins: u.total_wins,
            mmr: u.mmr, badge: u.badge, avatar: u.avatar, level: u.level
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
                opponent: opponent ? opponent.username : 'Unknown',
                mmrChange: m.mmr_change || 0,
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

// ============ FRIEND SYSTEM ROUTES ============

// Send friend request
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

// Accept friend request
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

// Get friends list
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
            id: f.id, username: f.username, avatar: f.avatar, rank: f.rank, online: onlineUsers.some(u => u.userId === f.id)
        })));
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

// Get pending friend requests
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

// ============ POWER-UP ROUTES ============

// Get available power-ups
app.get('/api/powerups', (req, res) => {
    res.json(availablePowerups);
});

// Buy power-up
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

// Get user's power-ups
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

// Use power-up
app.post('/api/powerups/use', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { powerUpId, matchId } = req.body;
        const userPowerup = userPowerups.find(p => p.user_id === decoded.id && p.powerup_id === powerUpId);
        
        if (!userPowerup || userPowerup.quantity < 1) return res.status(400).json({ error: 'No power-up available' });
        
        userPowerup.quantity--;
        if (userPowerup.quantity === 0) {
            const index = userPowerups.findIndex(p => p.id === userPowerup.id);
            if (index !== -1) userPowerups.splice(index, 1);
        }
        
        res.json({ success: true, message: 'Power-up activated!' });
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

// ============ TOURNAMENT ROUTES ============

// Create tournament
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

// Join tournament
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
        
        // Auto-start if full
        if (tournament.current_players === tournament.max_players) {
            tournament.status = 'active';
            // Create bracket
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

// Get tournament info
app.get('/api/tournament/:id', (req, res) => {
    const tournament = tournaments.find(t => t.id === parseInt(req.params.id));
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    
    const participants = tournamentParticipants.filter(p => p.tournament_id === tournament.id);
    res.json({ ...tournament, participants });
});

// Get all active tournaments
app.get('/api/tournaments', (req, res) => {
    const activeTournaments = tournaments.filter(t => t.status === 'waiting');
    res.json(activeTournaments);
});

// ============ REPLAY ROUTES ============

// Get replay
app.get('/api/replay/:id', (req, res) => {
    const replay = replays.find(r => r.id === parseInt(req.params.id));
    if (!replay) return res.status(404).json({ error: 'Replay not found' });
    
    const match = matches.find(m => m.id === replay.match_id);
    res.json({ replay, match });
});

// Get user replays
app.get('/api/user/replays', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const userMatches = matches.filter(m => m.player1_id === decoded.id || m.player2_id === decoded.id);
        const userReplays = replays.filter(r => userMatches.some(m => m.id === r.match_id));
        res.json(userReplays);
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
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

app.get('/api/admin/reports', (req, res) => {
    res.json([]);
});

app.delete('/api/admin/clear-reports', (req, res) => {
    res.json({ success: true });
});

app.get('/api/admin/logs', (req, res) => {
    res.json([]);
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

// ============ ACHIEVEMENTS ============
app.get('/api/achievements', (req, res) => {
    const achievements = [
        { id: 'first_blood', name: 'First Blood', description: 'Win your first match', icon: 'fa-trophy', unlocked: true },
        { id: 'warrior', name: 'Warrior', description: 'Win 10 matches', icon: 'fa-shield-alt', unlocked: false },
        { id: 'legendary', name: 'Legendary', description: 'Win 50 matches', icon: 'fa-crown', unlocked: false },
        { id: 'veteran', name: 'Veteran', description: 'Play 100 matches', icon: 'fa-star', unlocked: false },
        { id: 'social', name: 'Social Butterfly', description: 'Add 5 friends', icon: 'fa-users', unlocked: false },
        { id: 'tournament_winner', name: 'Champion', description: 'Win a tournament', icon: 'fa-trophy', unlocked: false }
    ];
    res.json(achievements);
});

// ============ SOCKET.IO WITH MATCHMAKING ============

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    let currentUserId = null;
    
    socket.on('user-online', (data) => {
        currentUserId = data.userId;
        onlineUsers.push({ userId: data.userId, username: data.username, socketId: socket.id });
        io.emit('online-count', { count: onlineUsers.length });
        console.log('User online:', data.username, 'Total online:', onlineUsers.length);
    });
    
    // Matchmaking for ranked
    socket.on('join-matchmaking', (data) => {
        if (!matchmakingQueue.includes(data.userId)) {
            matchmakingQueue.push({ userId: data.userId, username: data.username, socketId: socket.id });
            console.log('Player joined queue:', data.username, 'Queue size:', matchmakingQueue.length);
        }
        
        // Try to find match every 2 seconds
        const checkMatch = setInterval(() => {
            if (matchmakingQueue.length >= 2) {
                const player1 = matchmakingQueue.shift();
                const player2 = matchmakingQueue.shift();
                
                if (player1 && player2) {
                    const matchCode = Math.random().toString(36).substring(2, 8).toUpperCase();
                    const match = {
                        matchCode,
                        player1: player1,
                        player2: player2,
                        status: 'active'
                    };
                    activeMatches.push(match);
                    
                    io.to(player1.socketId).emit('match-found', { matchCode, opponent: player2.username });
                    io.to(player2.socketId).emit('match-found', { matchCode, opponent: player1.username });
                    
                    console.log('Match found:', player1.username, 'vs', player2.username);
                    clearInterval(checkMatch);
                }
            }
        }, 2000);
        
        socket.on('leave-matchmaking', () => {
            const index = matchmakingQueue.findIndex(p => p.userId === data.userId);
            if (index !== -1) matchmakingQueue.splice(index, 1);
            clearInterval(checkMatch);
            socket.emit('left-matchmaking');
        });
    });
    
    // Create casual match
    socket.on('create-match', (data) => {
        const matchCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        activeMatches.push({
            matchCode,
            hostId: data.userId,
            hostName: data.username,
            hostSocket: socket.id,
            status: 'waiting'
        });
        socket.join(matchCode);
        socket.emit('match-created', { matchCode });
        console.log('Match created:', matchCode, 'by', data.username);
    });
    
    // Join casual match
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
            console.log('Match joined:', data.username, 'joined', data.matchCode);
        } else {
            socket.emit('join-error', { error: 'Match not found or already started' });
        }
    });
    
    // Make move in match
    socket.on('make-move', (data) => {
        const match = activeMatches.find(m => m.matchCode === data.matchCode);
        if (match) {
            if (match.hostId === data.userId) {
                match.hostMove = data.move;
            } else {
                match.opponentMove = data.move;
            }
            
            if (match.hostMove && match.opponentMove) {
                let winner = null;
                if (match.hostMove === match.opponentMove) {
                    winner = 'tie';
                } else if (
                    (match.hostMove === 'rock' && match.opponentMove === 'scissors') ||
                    (match.hostMove === 'paper' && match.opponentMove === 'rock') ||
                    (match.hostMove === 'scissors' && match.opponentMove === 'paper')
                ) {
                    winner = match.hostId;
                } else {
                    winner = match.opponentId;
                }
                
                // Update stats
                if (winner !== 'tie') {
                    updateUserStats(winner, true, 25);
                    const loserId = winner === match.hostId ? match.opponentId : match.hostId;
                    updateUserStats(loserId, false, -25);
                    
                    // Add to matches history
                    addMatch(match.hostId, match.opponentId, winner, match.hostMove, match.opponentMove, 'casual', winner === match.hostId ? 25 : -25);
                }
                
                io.to(data.matchCode).emit('game-result', {
                    hostMove: match.hostMove,
                    opponentMove: match.opponentMove,
                    winner: winner
                });
                
                // Clean up match
                const index = activeMatches.findIndex(m => m.matchCode === data.matchCode);
                if (index !== -1) activeMatches.splice(index, 1);
                console.log('Match completed:', data.matchCode);
            }
        }
    });
    
    // Send sticker
    socket.on('send-sticker', (data) => {
        io.to(data.matchCode).emit('new-sticker', { username: data.username, sticker: data.sticker });
    });
    
    socket.on('disconnect', () => {
        onlineUsers = onlineUsers.filter(u => u.socketId !== socket.id);
        const queueIndex = matchmakingQueue.findIndex(p => p.socketId === socket.id);
        if (queueIndex !== -1) matchmakingQueue.splice(queueIndex, 1);
        io.emit('online-count', { count: onlineUsers.length });
        console.log('Client disconnected:', socket.id);
    });
});

// Start server
const PORT = process.env.PORT || 3000;

initData().then(() => {
    server.listen(PORT, '0.0.0.0', () => {
        console.log('\n========================================');
        console.log('🎮 RPS CYBER ARENA - COMPLETE BACKEND');
        console.log('========================================');
        console.log(`✅ Server running on port ${PORT}`);
        console.log(`🌐 Accepting connections from Vercel`);
        console.log('========================================');
        console.log('📊 DATABASE TABLES:');
        console.log(`   Users: ${users.length}`);
        console.log(`   Friendships: ${friendships.length}`);
        console.log(`   Friend Requests: ${friendRequests.length}`);
        console.log(`   Game Sessions: ${gameSessions.length}`);
        console.log(`   Matches: ${matches.length}`);
        console.log(`   Replays: ${replays.length}`);
        console.log(`   Tournaments: ${tournaments.length}`);
        console.log(`   Power-ups: ${availablePowerups.length}`);
        console.log('========================================');
        console.log('📋 LOGIN CREDENTIALS:');
        console.log('   Admin: admin / Peaceking');
        console.log('   Test: CyberWarrior / player123');
        console.log('   Test: NeonRookie / player123');
        console.log('   Test: GlitchMaster / player123');
        console.log('========================================\n');
    });
});
