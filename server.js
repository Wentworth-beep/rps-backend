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

// CORS
app.use(cors({
    origin: ['https://kukuyetu.vercel.app', 'https://rps-fronthead.vercel.app', 'http://localhost:3000', 'http://localhost:3001'],
    credentials: true
}));
app.use(express.json());

const io = socketIo(server, {
    cors: {
        origin: ['https://kukuyetu.vercel.app', 'https://rps-fronthead.vercel.app', 'http://localhost:3000'],
        credentials: true
    }
});

const JWT_SECRET = 'kirinyaga_secret_key_2025';

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Create tables
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role VARCHAR(20) DEFAULT 'user',
                badge VARCHAR(50) DEFAULT 'Bronze',
                level INTEGER DEFAULT 1,
                total_wins INTEGER DEFAULT 0,
                total_games INTEGER DEFAULT 0,
                mmr INTEGER DEFAULT 500,
                rank VARCHAR(50) DEFAULT 'Bronze',
                coins INTEGER DEFAULT 500,
                avatar VARCHAR(50) DEFAULT 'ninja',
                win_streak INTEGER DEFAULT 0,
                is_banned BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ Users table ready');
        
        // Create matches table if not exists
        await pool.query(`
            CREATE TABLE IF NOT EXISTS matches (
                id SERIAL PRIMARY KEY,
                player_id INTEGER REFERENCES users(id),
                opponent VARCHAR(50),
                result VARCHAR(10),
                mmr_change INTEGER,
                coins_earned INTEGER,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ Matches table ready');
        
        // Create admin user
        const adminCheck = await pool.query('SELECT * FROM users WHERE username = $1', ['admin']);
        if (adminCheck.rows.length === 0) {
            const adminHash = await bcrypt.hash('Peaceking', 10);
            await pool.query(
                `INSERT INTO users (username, email, password_hash, role, badge, level, total_wins, mmr, rank, coins, avatar)
                 VALUES ($1, $2, $3, 'admin', 'Legend', 50, 5000, 3500, 'Grandmaster', 10000, 'dragon')`,
                ['admin', 'santasantol087@gmail.com', adminHash]
            );
            console.log('✅ Admin user created');
        }
        
        console.log('✅ Database ready');
    } catch (err) {
        console.error('DB init error:', err.message);
    }
}
initDB();

// ============ REGISTER ============
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
    if (password.length < 4) return res.status(400).json({ error: 'Password too short' });
    
    try {
        const existing = await pool.query('SELECT id FROM users WHERE username = $1 OR email = $2', [username, email]);
        if (existing.rows.length > 0) return res.status(400).json({ error: 'Username or email exists' });
        
        const hash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, role, badge, level, coins, avatar`,
            [username, email, hash]
        );
        const token = jwt.sign({ id: result.rows[0].id, username }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, user: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: 'Registration failed' });
    }
});

// ============ LOGIN ============
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
        
        const user = result.rows[0];
        if (user.is_banned) return res.status(403).json({ error: 'Account banned' });
        
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
        
        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
        res.json({
            success: true, token,
            user: {
                id: user.id, username: user.username, role: user.role,
                badge: user.badge, level: user.level, total_wins: user.total_wins,
                mmr: user.mmr, rank: user.rank, coins: user.coins, avatar: user.avatar,
                win_streak: user.win_streak
            }
        });
    } catch (err) {
        res.status(500).json({ error: 'Login failed' });
    }
});

// ============ VERIFY TOKEN ============
app.get('/api/verify-token', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ valid: false });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const result = await pool.query('SELECT id, username, role FROM users WHERE id = $1', [decoded.id]);
        if (result.rows.length === 0) return res.status(401).json({ valid: false });
        res.json({ valid: true, user: result.rows[0] });
    } catch (err) {
        res.status(401).json({ valid: false });
    }
});

// ============ USER STATS ============
app.get('/api/user/stats', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const result = await pool.query(
            `SELECT username, badge, level, total_wins, total_games, mmr, rank, coins, avatar, win_streak FROM users WHERE id = $1`,
            [decoded.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

// ============ PLAY VS COMPUTER - FIXED ============
app.post('/api/game/computer', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { playerMove, difficulty } = req.body;
        
        if (!playerMove) return res.status(400).json({ error: 'Player move required' });
        
        // Computer move logic
        const moves = ['rock', 'paper', 'scissors'];
        let computerMove;
        
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
        
        // Determine winner
        let result, coinsEarned = 10;
        
        if (playerMove === computerMove) {
            result = 'tie';
        } else if (
            (playerMove === 'rock' && computerMove === 'scissors') ||
            (playerMove === 'paper' && computerMove === 'rock') ||
            (playerMove === 'scissors' && computerMove === 'paper')
        ) {
            result = 'win';
            coinsEarned = 50;
        } else {
            result = 'lose';
        }
        
        // Get current user
        const userResult = await pool.query('SELECT coins, win_streak, total_wins FROM users WHERE id = $1', [decoded.id]);
        const user = userResult.rows[0];
        
        let newWinStreak = result === 'win' ? user.win_streak + 1 : 0;
        let newTotalWins = result === 'win' ? user.total_wins + 1 : user.total_wins;
        
        // Update user
        await pool.query(
            `UPDATE users SET 
                total_wins = $1,
                total_games = total_games + 1,
                coins = coins + $2,
                win_streak = $3
             WHERE id = $4`,
            [newTotalWins, coinsEarned, newWinStreak, decoded.id]
        );
        
        // Get updated coins
        const updatedUser = await pool.query('SELECT coins FROM users WHERE id = $1', [decoded.id]);
        
        res.json({
            result: result,
            computerMove: computerMove,
            playerMove: playerMove,
            coins_earned: coinsEarned,
            total_coins: updatedUser.rows[0].coins,
            win_streak: newWinStreak
        });
    } catch (err) {
        console.error('Game error:', err);
        res.status(500).json({ error: 'Game failed: ' + err.message });
    }
});

// ============ LEADERBOARD ============
app.get('/api/leaderboard', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, username, total_wins as wins, mmr, badge, avatar, level FROM users WHERE role = 'user' ORDER BY mmr DESC LIMIT 20`
        );
        res.json(result.rows.map((u, i) => ({ ...u, rank: i + 1 })));
    } catch (err) {
        res.json([]);
    }
});

// ============ MATCH HISTORY ============
app.get('/api/match-history', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.json([]);
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const result = await pool.query(
            `SELECT result, opponent, mmr_change, coins_earned, created_at as timestamp FROM matches WHERE player_id = $1 ORDER BY created_at DESC LIMIT 20`,
            [decoded.id]
        );
        res.json(result.rows);
    } catch (err) {
        res.json([]);
    }
});

// ============ UPDATE AVATAR ============
app.post('/api/update-avatar', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { avatar } = req.body;
        await pool.query('UPDATE users SET avatar = $1 WHERE id = $2', [avatar, decoded.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

// ============ ADMIN LOGIN ============
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1 AND role = $2', [username, 'admin']);
        if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid admin credentials' });
        const admin = result.rows[0];
        const valid = await bcrypt.compare(password, admin.password_hash);
        if (!valid) return res.status(401).json({ error: 'Invalid admin credentials' });
        const token = jwt.sign({ id: admin.id, username: admin.username, role: admin.role }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, admin: { id: admin.id, username: admin.username } });
    } catch (err) {
        res.status(500).json({ error: 'Login failed' });
    }
});

app.get('/api/admin/users', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
        const result = await pool.query('SELECT id, username, email, role, badge, level, total_wins, mmr, is_banned, avatar, coins FROM users');
        res.json(result.rows);
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

app.post('/api/admin/ban-user', async (req, res) => {
    const { userId, ban } = req.body;
    await pool.query('UPDATE users SET is_banned = $1 WHERE id = $2', [ban, userId]);
    res.json({ success: true });
});

app.post('/api/admin/update-badge', async (req, res) => {
    const { userId, badge } = req.body;
    await pool.query('UPDATE users SET badge = $1 WHERE id = $2', [badge, userId]);
    res.json({ success: true });
});

app.get('/api/admin/online-count', (req, res) => {
    res.json({ count: onlineUsers.size });
});

app.get('/api/admin/total-users', async (req, res) => {
    const result = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'user'");
    res.json({ count: parseInt(result.rows[0].count) });
});

// ============ SOCKET.IO ============
const onlineUsers = new Map();

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    socket.on('user-online', (data) => {
        onlineUsers.set(socket.id, data);
        io.emit('online-count', { count: onlineUsers.size });
    });
    
    socket.on('create-match', (data) => {
        const matchCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        socket.join(matchCode);
        socket.emit('match-created', { matchCode });
    });
    
    socket.on('join-match', (data) => {
        const { matchCode } = data;
        socket.join(matchCode);
        io.to(matchCode).emit('match-started', { matchCode });
    });
    
    socket.on('make-move', (data) => {
        const { matchCode, move, userId } = data;
        const opponentMove = move === 'rock' ? 'scissors' : (move === 'paper' ? 'rock' : 'paper');
        io.to(matchCode).emit('game-result', {
            hostMove: move,
            opponentMove: opponentMove,
            winner: userId
        });
    });
    
    socket.on('send-sticker', (data) => {
        io.to(data.matchCode).emit('new-sticker', { username: data.username, sticker: data.sticker });
    });
    
    socket.on('disconnect', () => {
        onlineUsers.delete(socket.id);
        io.emit('online-count', { count: onlineUsers.size });
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n✅ Server running on port ${PORT}`);
    console.log(`🌐 https://rps-backend-6iq6.onrender.com\n`);
});
