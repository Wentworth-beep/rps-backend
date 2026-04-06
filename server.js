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

// CORS for Vercel frontend
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

// ============ IN-MEMORY FALLBACK (for when database is down) ============
const memoryDB = {
    users: [],
    matches: [],
    nextId: 1
};

// Initialize in-memory users
async function initMemoryDB() {
    const adminHash = await bcrypt.hash('Peaceking', 10);
    memoryDB.users.push({
        id: memoryDB.nextId++,
        username: 'admin',
        email: 'santasantol087@gmail.com',
        password_hash: adminHash,
        role: 'admin',
        badge: 'Legend',
        level: 50,
        total_wins: 5000,
        total_games: 5500,
        mmr: 3500,
        rank: 'Grandmaster',
        is_banned: false,
        avatar: 'dragon',
        coins: 10000
    });
    
    const playerHash = await bcrypt.hash('player123', 10);
    memoryDB.users.push({
        id: memoryDB.nextId++,
        username: 'CyberWarrior',
        email: 'warrior@test.com',
        password_hash: playerHash,
        role: 'user',
        badge: 'Master',
        level: 25,
        total_wins: 150,
        total_games: 200,
        mmr: 2200,
        rank: 'Master',
        is_banned: false,
        avatar: 'ninja',
        coins: 2500
    });
    
    memoryDB.users.push({
        id: memoryDB.nextId++,
        username: 'NeonRookie',
        email: 'rookie@test.com',
        password_hash: playerHash,
        role: 'user',
        badge: 'Bronze',
        level: 3,
        total_wins: 8,
        total_games: 20,
        mmr: 450,
        rank: 'Bronze',
        is_banned: false,
        avatar: 'robot',
        coins: 200
    });
    
    console.log('✅ In-memory database initialized');
}

// Try Neon connection, fallback to memory
let db = null;
let useMemory = true;

async function connectToNeon() {
    try {
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 5000
        });
        
        await pool.query('SELECT NOW()');
        console.log('✅ Connected to Neon PostgreSQL');
        useMemory = false;
        return pool;
    } catch (err) {
        console.log('⚠️ Neon connection failed, using in-memory storage');
        await initMemoryDB();
        return null;
    }
}

// Initialize database connection
let pool;
connectToNeon().then(p => {
    pool = p;
});

// ============ HELPER FUNCTIONS ============
async function findUserByUsername(username) {
    if (!useMemory && pool) {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        return result.rows[0];
    } else {
        return memoryDB.users.find(u => u.username === username);
    }
}

async function findUserById(id) {
    if (!useMemory && pool) {
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
        return result.rows[0];
    } else {
        return memoryDB.users.find(u => u.id === id);
    }
}

async function createUser(username, email, passwordHash) {
    if (!useMemory && pool) {
        const result = await pool.query(
            'INSERT INTO users (username, email, password_hash, role, badge, level, coins, avatar) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, username, role, badge, level, coins, avatar',
            [username, email, passwordHash, 'user', 'Bronze', 1, 500, 'ninja']
        );
        return result.rows[0];
    } else {
        const newUser = {
            id: memoryDB.nextId++,
            username,
            email,
            password_hash: passwordHash,
            role: 'user',
            badge: 'Bronze',
            level: 1,
            total_wins: 0,
            total_games: 0,
            mmr: 500,
            rank: 'Bronze',
            is_banned: false,
            avatar: 'ninja',
            coins: 500
        };
        memoryDB.users.push(newUser);
        return newUser;
    }
}

async function updateUserStats(userId, won, coinsEarned) {
    if (!useMemory && pool) {
        if (won) {
            await pool.query('UPDATE users SET total_wins = total_wins + 1, total_games = total_games + 1, coins = coins + $1, win_streak = win_streak + 1, mmr = mmr + 25 WHERE id = $2', [coinsEarned, userId]);
        } else {
            await pool.query('UPDATE users SET total_games = total_games + 1, coins = coins + $1, win_streak = 0, mmr = GREATEST(mmr - 25, 0) WHERE id = $2', [coinsEarned, userId]);
        }
    } else {
        const user = memoryDB.users.find(u => u.id === userId);
        if (user) {
            if (won) {
                user.total_wins++;
                user.win_streak++;
                user.mmr += 25;
            } else {
                user.win_streak = 0;
                user.mmr = Math.max(0, user.mmr - 25);
            }
            user.total_games++;
            user.coins += coinsEarned;
        }
    }
}

async function saveMatch(player1Id, player2Id, winnerId, player1Move, player2Move, gameType, mmrChange, coinsEarned) {
    if (!useMemory && pool) {
        await pool.query(
            'INSERT INTO matches (player1_id, player2_id, winner_id, player1_move, player2_move, game_type, mmr_change, coins_earned) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
            [player1Id, player2Id, winnerId, player1Move, player2Move, gameType, mmrChange, coinsEarned]
        );
    } else {
        memoryDB.matches.push({
            id: memoryDB.matches.length + 1,
            player1_id: player1Id,
            player2_id: player2Id,
            winner_id: winnerId,
            player1_move: player1Move,
            player2_move: player2Move,
            game_type: gameType,
            mmr_change: mmrChange,
            coins_earned: coinsEarned,
            created_at: new Date()
        });
    }
}

// ============ USER ROUTES ============

// Register
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    console.log('Register attempt:', username, email);
    
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'All fields required' });
    }
    if (password.length < 4) {
        return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }
    
    try {
        const existing = await findUserByUsername(username);
        if (existing) {
            return res.status(400).json({ error: 'Username already exists' });
        }
        
        const passwordHash = await bcrypt.hash(password, 10);
        const newUser = await createUser(username, email, passwordHash);
        
        const token = jwt.sign(
            { id: newUser.id, username: newUser.username, role: newUser.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        console.log(`✅ User registered: ${username}`);
        res.json({ success: true, token, user: newUser });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    console.log('Login attempt:', username);
    
    try {
        const user = await findUserByUsername(username);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        if (user.is_banned) {
            return res.status(403).json({ error: 'Account banned' });
        }
        
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        console.log(`✅ User logged in: ${username}`);
        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                badge: user.badge,
                level: user.level,
                total_wins: user.total_wins || 0,
                mmr: user.mmr || 500,
                rank: user.rank || 'Bronze',
                coins: user.coins || 500,
                avatar: user.avatar || 'ninja',
                win_streak: user.win_streak || 0
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
    if (!token) {
        return res.status(401).json({ error: 'Token required' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await findUserById(decoded.id);
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({
            username: user.username,
            badge: user.badge,
            level: user.level,
            total_wins: user.total_wins || 0,
            total_games: user.total_games || 0,
            mmr: user.mmr || 500,
            rank: user.rank || 'Bronze',
            coins: user.coins || 500,
            avatar: user.avatar || 'ninja',
            win_streak: user.win_streak || 0
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(403).json({ error: 'Invalid token' });
    }
});

// Play vs Computer
app.post('/api/game/computer', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Token required' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { playerMove, difficulty } = req.body;
        
        // Get computer move
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
        let coinsEarned = 10;
        
        if (playerMove === computerMove) {
            result = 'tie';
        } else if ((playerMove === 'rock' && computerMove === 'scissors') ||
                   (playerMove === 'paper' && computerMove === 'rock') ||
                   (playerMove === 'scissors' && computerMove === 'paper')) {
            result = 'win';
            won = true;
            coinsEarned = 50;
        } else {
            result = 'lose';
        }
        
        // Update user stats
        await updateUserStats(decoded.id, won, coinsEarned);
        
        // Save match
        await saveMatch(decoded.id, null, won ? decoded.id : null, playerMove, computerMove, 'computer', won ? 25 : -25, coinsEarned);
        
        // Get updated user
        const updatedUser = await findUserById(decoded.id);
        
        res.json({
            result,
            computerMove,
            playerMove,
            coins_earned: coinsEarned,
            total_coins: updatedUser.coins,
            win_streak: updatedUser.win_streak || 0
        });
    } catch (error) {
        console.error('Game error:', error);
        res.status(500).json({ error: 'Game failed' });
    }
});

// Leaderboard
app.get('/api/leaderboard', async (req, res) => {
    try {
        if (!useMemory && pool) {
            const result = await pool.query(
                `SELECT id, username, total_wins as wins, mmr, badge, avatar, level, coins
                 FROM users WHERE role = 'user' 
                 ORDER BY mmr DESC LIMIT 20`
            );
            res.json(result.rows.map((u, i) => ({ ...u, rank: i + 1 })));
        } else {
            const leaderboard = [...memoryDB.users]
                .filter(u => u.role === 'user')
                .sort((a, b) => b.mmr - a.mmr)
                .slice(0, 20)
                .map((u, i) => ({
                    rank: i + 1,
                    id: u.id,
                    username: u.username,
                    wins: u.total_wins,
                    mmr: u.mmr,
                    badge: u.badge,
                    avatar: u.avatar,
                    level: u.level,
                    coins: u.coins
                }));
            res.json(leaderboard);
        }
    } catch (error) {
        console.error('Leaderboard error:', error);
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
});

// Match history
app.get('/api/match-history', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Token required' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        
        if (!useMemory && pool) {
            const result = await pool.query(
                `SELECT m.*, 
                 CASE WHEN m.winner_id = $1 THEN 'win' ELSE 'lose' END as result,
                 COALESCE(u.username, 'Computer') as opponent,
                 m.mmr_change,
                 m.coins_earned,
                 m.created_at as timestamp
                 FROM matches m
                 LEFT JOIN users u ON (CASE WHEN m.player1_id = $1 THEN m.player2_id ELSE m.player1_id END) = u.id
                 WHERE m.player1_id = $1 OR m.player2_id = $1
                 ORDER BY m.created_at DESC LIMIT 20`,
                [decoded.id]
            );
            res.json(result.rows);
        } else {
            const userMatches = memoryDB.matches.filter(m => m.player1_id === decoded.id || m.player2_id === decoded.id);
            const history = userMatches.slice(0, 20).map(m => {
                const isWinner = m.winner_id === decoded.id;
                const opponentId = m.player1_id === decoded.id ? m.player2_id : m.player1_id;
                const opponent = memoryDB.users.find(u => u.id === opponentId);
                return {
                    result: isWinner ? 'win' : 'lose',
                    opponent: opponent ? opponent.username : 'Computer',
                    mmr_change: m.mmr_change,
                    coins_earned: m.coins_earned,
                    timestamp: m.created_at
                };
            });
            res.json(history);
        }
    } catch (error) {
        console.error('Match history error:', error);
        res.status(403).json({ error: 'Invalid token' });
    }
});

// Update avatar
app.post('/api/update-avatar', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Token required' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { avatar } = req.body;
        
        if (!useMemory && pool) {
            await pool.query('UPDATE users SET avatar = $1 WHERE id = $2', [avatar, decoded.id]);
        } else {
            const user = memoryDB.users.find(u => u.id === decoded.id);
            if (user) user.avatar = avatar;
        }
        
        res.json({ success: true });
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

// Verify token
app.get('/api/verify-token', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Token required' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await findUserById(decoded.id);
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({ valid: true, user: { id: user.id, username: user.username, role: user.role } });
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

// ============ ADMIN ROUTES ============
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;
    console.log('Admin login attempt:', username);
    
    try {
        const user = await findUserByUsername(username);
        if (!user || user.role !== 'admin') {
            return res.status(401).json({ error: 'Invalid admin credentials' });
        }
        
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid admin credentials' });
        }
        
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '8h' }
        );
        
        res.json({ success: true, token, admin: { id: user.id, username: user.username, role: user.role } });
    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({ error: 'Admin login failed' });
    }
});

app.get('/api/admin/users', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Token required' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'admin') {
            return res.status(403).json({ error: 'Admin only' });
        }
        
        if (!useMemory && pool) {
            const result = await pool.query('SELECT id, username, email, role, badge, level, total_wins, mmr, is_banned, avatar, coins FROM users');
            res.json(result.rows);
        } else {
            const users = memoryDB.users.map(u => ({
                id: u.id,
                username: u.username,
                email: u.email,
                role: u.role,
                badge: u.badge,
                level: u.level,
                total_wins: u.total_wins,
                mmr: u.mmr,
                is_banned: u.is_banned,
                avatar: u.avatar,
                coins: u.coins
            }));
            res.json(users);
        }
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

app.post('/api/admin/ban-user', async (req, res) => {
    const { userId, ban } = req.body;
    
    if (!useMemory && pool) {
        await pool.query('UPDATE users SET is_banned = $1 WHERE id = $2 AND role != $3', [ban, userId, 'admin']);
    } else {
        const user = memoryDB.users.find(u => u.id === userId);
        if (user && user.role !== 'admin') user.is_banned = ban;
    }
    
    res.json({ success: true });
});

app.post('/api/admin/update-badge', async (req, res) => {
    const { userId, badge } = req.body;
    
    if (!useMemory && pool) {
        await pool.query('UPDATE users SET badge = $1 WHERE id = $2', [badge, userId]);
    } else {
        const user = memoryDB.users.find(u => u.id === userId);
        if (user) user.badge = badge;
    }
    
    res.json({ success: true });
});

app.get('/api/admin/online-count', (req, res) => {
    res.json({ count: onlineUsers.size });
});

app.get('/api/admin/total-users', async (req, res) => {
    if (!useMemory && pool) {
        const result = await pool.query("SELECT COUNT(*) as count FROM users WHERE role = 'user'");
        res.json({ count: parseInt(result.rows[0].count) });
    } else {
        const count = memoryDB.users.filter(u => u.role === 'user').length;
        res.json({ count });
    }
});

// ============ SOCKET.IO ============
const onlineUsers = new Map();
const activeSessions = {};

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    socket.on('user-online', (data) => {
        onlineUsers.set(socket.id, data);
        io.emit('online-count', { count: onlineUsers.size });
        console.log('User online:', data.username, 'Total:', onlineUsers.size);
    });
    
    socket.on('create-match', (data) => {
        const matchCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        activeSessions[matchCode] = {
            code: matchCode,
            creator: data.username,
            creatorId: data.userId,
            players: [data.username],
            status: 'waiting',
            createdAt: Date.now()
        };
        socket.join(matchCode);
        socket.emit('match-created', { matchCode });
        console.log('Match created:', matchCode, 'by', data.username);
    });
    
    socket.on('join-match', (data) => {
        const session = activeSessions[data.matchCode];
        if (session && session.status === 'waiting') {
            session.players.push(data.username);
            session.status = 'active';
            socket.join(data.matchCode);
            io.to(data.matchCode).emit('match-started', { matchCode: data.matchCode });
            console.log('Match joined:', data.username, 'joined', data.matchCode);
        } else {
            socket.emit('join-error', { error: 'Match not found' });
        }
    });
    
    socket.on('make-move', (data) => {
        const session = activeSessions[data.matchCode];
        if (session) {
            io.to(data.matchCode).emit('game-result', {
                hostMove: data.move,
                opponentMove: data.move === 'rock' ? 'scissors' : (data.move === 'paper' ? 'rock' : 'paper'),
                winner: data.userId
            });
            delete activeSessions[data.matchCode];
            console.log('Move made in match:', data.matchCode);
        }
    });
    
    socket.on('send-sticker', (data) => {
        io.to(data.matchCode).emit('new-sticker', { username: data.username, sticker: data.sticker });
    });
    
    socket.on('disconnect', () => {
        onlineUsers.delete(socket.id);
        io.emit('online-count', { count: onlineUsers.size });
        console.log('Client disconnected:', socket.id);
    });
});

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ status: 'online', message: 'RPS Cyber Arena API is running', timestamp: new Date().toISOString() });
});

// Start server
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log('\n========================================');
    console.log('🎮 RPS CYBER ARENA BACKEND');
    console.log('========================================');
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log('========================================');
    console.log('📋 LOGIN CREDENTIALS:');
    console.log('   Admin: admin / Peaceking');
    console.log('   Test: CyberWarrior / player123');
    console.log('   Test: NeonRookie / player123');
    console.log('========================================\n');
});
