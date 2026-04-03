const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Neon Database Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_f1H2zKZLaMTG@ep-winter-night-anhzdv3n-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
});

// Test database connection
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Database connection error:', err.message);
        process.exit(1);
    } else {
        console.log('✅ Connected to Neon Database');
        release();
    }
});

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

const JWT_SECRET = process.env.JWT_SECRET || 'kirinyaga_secret_key_2025';

// Active match sessions (10-round matches)
const activeSessions = new Map();
const matchmakingQueue = [];
let onlineUsers = [];

// Level requirements
const levelRequirements = {
    1: 0, 2: 5, 3: 10, 4: 15, 5: 20, 6: 26, 7: 32, 8: 38, 9: 44, 10: 50,
    11: 57, 12: 64, 13: 71, 14: 78, 15: 85, 16: 93, 17: 101, 18: 109, 19: 117, 20: 125,
    21: 134, 22: 143, 23: 152, 24: 161, 25: 170, 26: 180, 27: 190, 28: 200, 29: 210, 30: 220,
    31: 231, 32: 242, 33: 253, 34: 264, 35: 275, 36: 287, 37: 299, 38: 311, 39: 323, 40: 335,
    41: 348, 42: 361, 43: 374, 44: 387, 45: 400, 46: 414, 47: 428, 48: 442, 49: 456, 50: 470
};

// Helper functions
function getLevelFromWins(wins) {
    for (let level = 50; level >= 1; level--) {
        if (wins >= levelRequirements[level]) return level;
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

// ============ USER ROUTES ============

// Register
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'All fields required' });
    }
    
    try {
        const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Username already exists' });
        }
        
        const passwordHash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            `INSERT INTO users (username, email, password_hash, role, badge, level, coins, avatar)
             VALUES ($1, $2, $3, 'user', 'Bronze', 1, 500, 'ninja')
             RETURNING id, username, role, badge, level, coins, avatar`,
            [username, email, passwordHash]
        );
        
        const token = jwt.sign({ id: result.rows[0].id, username, role: 'user' }, JWT_SECRET);
        res.json({ success: true, token, user: result.rows[0] });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const user = result.rows[0];
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
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Get user stats
app.get('/api/user/stats', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const result = await pool.query(
            `SELECT username, badge, level, total_wins, total_games, mmr, rank, coins, avatar, win_streak, daily_streak, total_earned_coins
             FROM users WHERE id = $1`,
            [decoded.id]
        );
        
        if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        
        const user = result.rows[0];
        res.json({
            ...user,
            wins_needed_next: getWinsNeededForNextLevel(user.total_wins),
            next_level_wins: levelRequirements[user.level + 1] || levelRequirements[50],
            current_level_wins: levelRequirements[user.level] || 0
        });
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

// Play vs Computer
app.post('/api/game/computer', async (req, res) => {
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
        
        // Get current user data
        const userResult = await pool.query('SELECT total_wins, win_streak, coins, level FROM users WHERE id = $1', [decoded.id]);
        const user = userResult.rows[0];
        
        let coinsEarned = 10;
        let newWinStreak = user.win_streak;
        let newTotalWins = user.total_wins;
        let levelUp = false;
        let levelUpReward = 0;
        
        if (won) {
            coinsEarned = 50;
            if (user.win_streak >= 2) coinsEarned += 20;
            if (user.win_streak >= 4) coinsEarned += 40;
            newWinStreak = user.win_streak + 1;
            newTotalWins = user.total_wins + 1;
            
            // Check level up
            const oldLevel = getLevelFromWins(user.total_wins);
            const newLevel = getLevelFromWins(newTotalWins);
            if (newLevel > oldLevel) {
                levelUp = true;
                levelUpReward = newLevel * 50;
            }
            
            await pool.query(
                `UPDATE users SET total_wins = total_wins + 1, total_games = total_games + 1, 
                 coins = coins + $1, win_streak = $2, mmr = mmr + 25, level = $3
                 WHERE id = $4`,
                [coinsEarned, newWinStreak, newLevel, decoded.id]
            );
        } else if (result === 'lose') {
            newWinStreak = 0;
            await pool.query(
                `UPDATE users SET total_games = total_games + 1, coins = coins + $1, 
                 win_streak = $2, mmr = GREATEST(mmr - 25, 0)
                 WHERE id = $3`,
                [10, 0, decoded.id]
            );
        } else {
            await pool.query(
                `UPDATE users SET total_games = total_games + 1, coins = coins + $1
                 WHERE id = $2`,
                [10, decoded.id]
            );
        }
        
        // Save match to database
        await pool.query(
            `INSERT INTO matches (player1_id, player2_id, winner_id, player1_move, player2_move, game_type, mmr_change, coins_earned)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [decoded.id, null, won ? decoded.id : null, playerMove, computerMove, 'computer', won ? 25 : -25, coinsEarned]
        );
        
        const updatedUser = await pool.query('SELECT coins, level, total_wins FROM users WHERE id = $1', [decoded.id]);
        
        res.json({
            result,
            computerMove,
            playerMove,
            coins_earned: coinsEarned,
            level_up: levelUp,
            level_up_reward: levelUpReward,
            new_level: getLevelFromWins(newTotalWins),
            wins_needed_next: getWinsNeededForNextLevel(newTotalWins),
            total_coins: updatedUser.rows[0].coins,
            win_streak: newWinStreak,
            winner: won ? 'You' : (result === 'lose' ? 'Computer' : 'Tie'),
            loser: won ? 'Computer' : (result === 'lose' ? 'You' : 'None')
        });
    } catch (error) {
        console.error('Game error:', error);
        res.status(500).json({ error: 'Game failed' });
    }
});

// Get match history
app.get('/api/match-history', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const result = await pool.query(
            `SELECT m.*, 
             CASE WHEN m.winner_id = $1 THEN 'win' ELSE 'lose' END as result,
             COALESCE(u.username, 'Computer') as opponent
             FROM matches m
             LEFT JOIN users u ON (CASE WHEN m.player1_id = $1 THEN m.player2_id ELSE m.player1_id END) = u.id
             WHERE m.player1_id = $1 OR m.player2_id = $1
             ORDER BY m.created_at DESC LIMIT 20`,
            [decoded.id]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

// Leaderboard
app.get('/api/leaderboard', async (req, res) => {
    const result = await pool.query(
        `SELECT id, username, total_wins as wins, mmr, badge, avatar, level, coins
         FROM users WHERE role = 'user' 
         ORDER BY mmr DESC LIMIT 20`
    );
    res.json(result.rows.map((u, i) => ({ ...u, rank: i + 1 })));
});

// Verify token
app.get('/api/verify-token', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const result = await pool.query('SELECT id, username, role FROM users WHERE id = $1', [decoded.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        res.json({ valid: true, user: result.rows[0] });
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

// Update avatar
app.post('/api/update-avatar', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { avatar } = req.body;
        await pool.query('UPDATE users SET avatar = $1 WHERE id = $2', [avatar, decoded.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

// ============ 10-MATCH SESSION MULTIPLAYER ============

// Create a 10-round match session
app.post('/api/match/session/create', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const sessionCode = Math.random().toString(36).substring(2, 10).toUpperCase();
        
        const session = {
            code: sessionCode,
            player1: { id: decoded.id, username: decoded.username },
            player2: null,
            rounds: [],
            player1Wins: 0,
            player2Wins: 0,
            ties: 0,
            currentRound: 1,
            totalRounds: 10,
            status: 'waiting',
            createdAt: Date.now()
        };
        
        activeSessions.set(sessionCode, session);
        res.json({ success: true, sessionCode, totalRounds: 10 });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create session' });
    }
});

// Join a 10-round match session
app.post('/api/match/session/join', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { sessionCode } = req.body;
        const session = activeSessions.get(sessionCode);
        
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (session.player2) return res.status(400).json({ error: 'Session full' });
        
        session.player2 = { id: decoded.id, username: decoded.username };
        session.status = 'active';
        
        // Save session to database
        const dbResult = await pool.query(
            `INSERT INTO match_sessions (player1_id, player2_id, total_rounds, started_at)
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
             RETURNING id`,
            [session.player1.id, session.player2.id, 10]
        );
        session.dbId = dbResult.rows[0].id;
        
        res.json({ success: true, sessionCode, totalRounds: 10, opponent: session.player1.username });
    } catch (error) {
        res.status(500).json({ error: 'Failed to join session' });
    }
});

// Make a move in a round
app.post('/api/match/session/move', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { sessionCode, move, roundNumber } = req.body;
        const session = activeSessions.get(sessionCode);
        
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (session.status !== 'active') return res.status(400).json({ error: 'Session not active' });
        
        // Store the move
        if (!session.rounds[roundNumber]) {
            session.rounds[roundNumber] = {};
        }
        
        if (session.player1.id === decoded.id) {
            session.rounds[roundNumber].player1Move = move;
        } else if (session.player2.id === decoded.id) {
            session.rounds[roundNumber].player2Move = move;
        } else {
            return res.status(403).json({ error: 'Not a participant' });
        }
        
        // Check if both players have made their moves
        const round = session.rounds[roundNumber];
        if (round.player1Move && round.player2Move) {
            // Determine winner
            const p1Move = round.player1Move;
            const p2Move = round.player2Move;
            let roundWinner = null;
            let roundLoser = null;
            
            if (p1Move === p2Move) {
                session.ties++;
                roundWinner = 'tie';
            } else if (
                (p1Move === 'rock' && p2Move === 'scissors') ||
                (p1Move === 'paper' && p2Move === 'rock') ||
                (p1Move === 'scissors' && p2Move === 'paper')
            ) {
                session.player1Wins++;
                roundWinner = session.player1.username;
                roundLoser = session.player2.username;
            } else {
                session.player2Wins++;
                roundWinner = session.player2.username;
                roundLoser = session.player1.username;
            }
            
            round.winner = roundWinner;
            round.loser = roundLoser;
            
            // Check if session is complete
            if (session.currentRound >= session.totalRounds) {
                // Session complete - determine overall winner
                let overallWinner = null;
                let overallLoser = null;
                let winnerId = null;
                
                if (session.player1Wins > session.player2Wins) {
                    overallWinner = session.player1.username;
                    overallLoser = session.player2.username;
                    winnerId = session.player1.id;
                } else if (session.player2Wins > session.player1Wins) {
                    overallWinner = session.player2.username;
                    overallLoser = session.player1.username;
                    winnerId = session.player2.id;
                } else {
                    overallWinner = 'tie';
                }
                
                session.status = 'completed';
                
                // Update database with session results
                await pool.query(
                    `UPDATE match_sessions 
                     SET player1_wins = $1, player2_wins = $2, ties = $3, winner_id = $4, completed_at = CURRENT_TIMESTAMP
                     WHERE id = $5`,
                    [session.player1Wins, session.player2Wins, session.ties, winnerId, session.dbId]
                );
                
                // Update user stats
                if (winnerId) {
                    await pool.query(
                        `UPDATE users SET total_wins = total_wins + 1, total_games = total_games + 1, coins = coins + 100, mmr = mmr + 50
                         WHERE id = $1`,
                        [winnerId]
                    );
                    const loserId = winnerId === session.player1.id ? session.player2.id : session.player1.id;
                    await pool.query(
                        `UPDATE users SET total_games = total_games + 1, coins = coins + 50, mmr = GREATEST(mmr - 25, 0)
                         WHERE id = $1`,
                        [loserId]
                    );
                }
                
                res.json({
                    type: 'session_complete',
                    winner: overallWinner,
                    loser: overallLoser,
                    player1Wins: session.player1Wins,
                    player2Wins: session.player2Wins,
                    ties: session.ties,
                    totalRounds: session.totalRounds,
                    roundWinner,
                    roundLoser
                });
                
                // Clean up session
                setTimeout(() => activeSessions.delete(sessionCode), 60000);
            } else {
                session.currentRound++;
                res.json({
                    type: 'round_complete',
                    roundWinner,
                    roundLoser,
                    currentRound: session.currentRound,
                    totalRounds: session.totalRounds,
                    player1Wins: session.player1Wins,
                    player2Wins: session.player2Wins,
                    ties: session.ties,
                    nextRound: session.currentRound
                });
            }
        } else {
            res.json({ type: 'move_received', message: 'Move recorded, waiting for opponent' });
        }
    } catch (error) {
        console.error('Move error:', error);
        res.status(500).json({ error: 'Failed to record move' });
    }
});

// Get session status
app.get('/api/match/session/:code', (req, res) => {
    const session = activeSessions.get(req.params.code);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    
    res.json({
        code: session.code,
        player1: session.player1,
        player2: session.player2,
        player1Wins: session.player1Wins,
        player2Wins: session.player2Wins,
        ties: session.ties,
        currentRound: session.currentRound,
        totalRounds: session.totalRounds,
        status: session.status,
        rounds: session.rounds
    });
});

// ============ ADMIN ROUTES ============
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE username = $1 AND role = $2', [username, 'admin']);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid admin credentials' });
    
    const valid = await bcrypt.compare(password, result.rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid admin credentials' });
    
    const token = jwt.sign({ id: result.rows[0].id, username, role: 'admin' }, JWT_SECRET);
    res.json({ success: true, token, admin: { id: result.rows[0].id, username } });
});

app.get('/api/admin/users', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
        
        const result = await pool.query('SELECT id, username, email, role, badge, level, total_wins, mmr, is_banned, avatar, coins FROM users');
        res.json(result.rows);
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

app.post('/api/admin/ban-user', async (req, res) => {
    const { userId, ban } = req.body;
    await pool.query('UPDATE users SET is_banned = $1 WHERE id = $2 AND role != $3', [ban, userId, 'admin']);
    res.json({ success: true });
});

app.post('/api/admin/update-badge', async (req, res) => {
    const { userId, badge } = req.body;
    await pool.query('UPDATE users SET badge = $1 WHERE id = $2', [badge, userId]);
    res.json({ success: true });
});

app.get('/api/admin/online-count', (req, res) => {
    res.json({ count: onlineUsers.length });
});

app.get('/api/admin/total-users', async (req, res) => {
    const result = await pool.query("SELECT COUNT(*) as count FROM users WHERE role = 'user'");
    res.json({ count: parseInt(result.rows[0].count) });
});

// ============ SOCKET.IO for real-time ============
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    socket.on('user-online', (data) => {
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
                    const sessionCode = Math.random().toString(36).substring(2, 10).toUpperCase();
                    const session = {
                        code: sessionCode,
                        player1: { id: player1.userId, username: player1.username },
                        player2: { id: player2.userId, username: player2.username },
                        rounds: [],
                        player1Wins: 0,
                        player2Wins: 0,
                        ties: 0,
                        currentRound: 1,
                        totalRounds: 10,
                        status: 'active',
                        createdAt: Date.now()
                    };
                    activeSessions.set(sessionCode, session);
                    
                    io.to(player1.socketId).emit('match-found', { sessionCode, opponent: player2.username, totalRounds: 10 });
                    io.to(player2.socketId).emit('match-found', { sessionCode, opponent: player1.username, totalRounds: 10 });
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
    
    socket.on('disconnect', () => {
        onlineUsers = onlineUsers.filter(u => u.socketId !== socket.id);
        const queueIndex = matchmakingQueue.findIndex(p => p.socketId === socket.id);
        if (queueIndex !== -1) matchmakingQueue.splice(queueIndex, 1);
        io.emit('online-count', { count: onlineUsers.length });
    });
});

// Start server
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log('\n========================================');
    console.log('🎮 RPS CYBER ARENA - NEON DATABASE');
    console.log('========================================');
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🗄️  Database: Neon PostgreSQL`);
    console.log(`🎯 10-Round Match Sessions: ACTIVE`);
    console.log('========================================');
    console.log('📋 LOGIN CREDENTIALS:');
    console.log('   Admin: admin / Peaceking');
    console.log('   Test: CyberWarrior / player123');
    console.log('========================================\n');
});
