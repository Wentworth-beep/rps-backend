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

// Neon PostgreSQL Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 20
});

// ============ HEALTH CHECK ============
app.get('/', (req, res) => {
    res.json({ 
        status: 'online', 
        message: 'RPS Cyber Arena API is running',
        timestamp: new Date().toISOString()
    });
});

// ============ REGISTER ROUTE ============
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    console.log('📝 Register attempt:', { username, email });
    
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'All fields are required' });
    }
    if (password.length < 4) {
        return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }
    
    try {
        const existing = await pool.query('SELECT id FROM users WHERE username = $1 OR email = $2', [username, email]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Username or email already exists' });
        }
        
        const passwordHash = await bcrypt.hash(password, 10);
        
        const result = await pool.query(
            `INSERT INTO users (username, email, password_hash, role, badge, level, total_wins, total_games, mmr, rank, coins, avatar, win_streak)
             VALUES ($1, $2, $3, 'user', 'Bronze', 1, 0, 0, 500, 'Bronze', 500, 'ninja', 0)
             RETURNING id, username, role, badge, level, coins, avatar, mmr, rank`,
            [username, email, passwordHash]
        );
        
        const token = jwt.sign(
            { id: result.rows[0].id, username: result.rows[0].username, role: result.rows[0].role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        console.log(`✅ User registered: ${username}`);
        res.json({ 
            success: true, 
            token, 
            user: result.rows[0],
            message: 'Registration successful!'
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed: ' + error.message });
    }
});

// ============ LOGIN ROUTE ============
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    console.log('🔐 Login attempt:', username);
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const user = result.rows[0];
        if (user.is_banned) {
            return res.status(403).json({ error: 'Account has been banned' });
        }
        
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        await pool.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);
        
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
                total_wins: user.total_wins,
                mmr: user.mmr,
                rank: user.rank,
                coins: user.coins,
                avatar: user.avatar,
                win_streak: user.win_streak
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// ============ USER STATS ============
app.get('/api/user/stats', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Token required' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const result = await pool.query(
            `SELECT username, badge, level, total_wins, total_games, mmr, rank, coins, avatar, win_streak
             FROM users WHERE id = $1`,
            [decoded.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Stats error:', error);
        res.status(403).json({ error: 'Invalid token' });
    }
});
// Add this to your server.js - Check if user is banned
app.get('/api/user/status', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Token required' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const result = await pool.query('SELECT is_banned FROM users WHERE id = $1', [decoded.id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({ 
            is_banned: result.rows[0].is_banned,
            username: decoded.username
        });
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});
// ============ LEADERBOARD ============
app.get('/api/leaderboard', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, username, total_wins as wins, mmr, badge, avatar, level
             FROM users WHERE role = 'user' 
             ORDER BY mmr DESC LIMIT 20`
        );
        res.json(result.rows.map((u, i) => ({ ...u, rank: i + 1 })));
    } catch (error) {
        console.error('Leaderboard error:', error);
        res.json([]);
    }
});

// ============ MATCH HISTORY ============
app.get('/api/match-history', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Token required' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const result = await pool.query(
            `SELECT * FROM matches WHERE player1_id = $1 OR player2_id = $1 ORDER BY created_at DESC LIMIT 20`,
            [decoded.id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Match history error:', error);
        res.json([]);
    }
});

// ============ UPDATE AVATAR ============
app.post('/api/update-avatar', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Token required' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { avatar } = req.body;
        await pool.query('UPDATE users SET avatar = $1 WHERE id = $2', [avatar, decoded.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

// ============ VERIFY TOKEN ============
app.get('/api/verify-token', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Token required' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const result = await pool.query('SELECT id, username, role FROM users WHERE id = $1', [decoded.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ valid: true, user: result.rows[0] });
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

// ============ PLAY VS COMPUTER ============
app.post('/api/game/computer', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Token required' });
    }
    
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
        
        const userResult = await pool.query('SELECT total_wins, win_streak, coins, mmr FROM users WHERE id = $1', [decoded.id]);
        const user = userResult.rows[0];
        
        let newWinStreak = user.win_streak;
        let newTotalWins = user.total_wins;
        
        if (won) {
            if (user.win_streak >= 2) coinsEarned += 20;
            if (user.win_streak >= 4) coinsEarned += 40;
            newWinStreak = user.win_streak + 1;
            newTotalWins = user.total_wins + 1;
            
            await pool.query(
                `UPDATE users SET 
                    total_wins = total_wins + 1, 
                    total_games = total_games + 1, 
                    coins = coins + $1,
                    win_streak = $2,
                    mmr = mmr + 25
                 WHERE id = $3`,
                [coinsEarned, newWinStreak, decoded.id]
            );
        } else if (result === 'lose') {
            newWinStreak = 0;
            await pool.query(
                `UPDATE users SET 
                    total_games = total_games + 1, 
                    coins = coins + $1,
                    win_streak = $2,
                    mmr = GREATEST(mmr - 25, 0)
                 WHERE id = $3`,
                [10, 0, decoded.id]
            );
        } else {
            await pool.query(
                `UPDATE users SET total_games = total_games + 1, coins = coins + $1 WHERE id = $2`,
                [10, decoded.id]
            );
        }
        
        const updatedUser = await pool.query('SELECT coins, level, total_wins FROM users WHERE id = $1', [decoded.id]);
        
        res.json({
            result,
            computerMove,
            playerMove,
            coins_earned: coinsEarned,
            total_coins: updatedUser.rows[0].coins,
            win_streak: newWinStreak
        });
    } catch (error) {
        console.error('Game error:', error);
        res.status(500).json({ error: 'Game failed' });
    }
});

// ============ ADMIN ROUTES ============
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;
    
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1 AND role = $2', [username, 'admin']);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid admin credentials' });
        }
        
        const admin = result.rows[0];
        const valid = await bcrypt.compare(password, admin.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid admin credentials' });
        }
        
        const token = jwt.sign(
            { id: admin.id, username: admin.username, role: admin.role },
            JWT_SECRET,
            { expiresIn: '8h' }
        );
        
        res.json({ success: true, token, admin: { id: admin.id, username: admin.username, role: admin.role } });
    } catch (error) {
        res.status(500).json({ error: 'Admin login failed' });
    }
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
    res.json({ count: onlineUsers.size });
});

app.get('/api/admin/total-users', async (req, res) => {
    const result = await pool.query("SELECT COUNT(*) as count FROM users WHERE role = 'user'");
    res.json({ count: parseInt(result.rows[0].count) });
});

// ============ SOCKET.IO ============
const onlineUsers = new Map();
const activeSessions = {};

io.on('connection', (socket) => {
    console.log('🔌 Client connected:', socket.id);
    
    socket.on('user-online', (data) => {
        onlineUsers.set(socket.id, data);
        io.emit('online-count', { count: onlineUsers.size });
    });
    
    socket.on('create-match', (data) => {
        const matchCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        activeSessions[matchCode] = {
            code: matchCode,
            creator: data.username,
            creatorId: data.userId,
            players: [data.username],
            status: 'waiting'
        };
        socket.join(matchCode);
        socket.emit('match-created', { matchCode });
    });
    
    socket.on('join-match', (data) => {
        const session = activeSessions[data.matchCode];
        if (session && session.status === 'waiting') {
            session.players.push(data.username);
            session.status = 'active';
            socket.join(data.matchCode);
            io.to(data.matchCode).emit('match-started', { matchCode: data.matchCode });
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
        }
    });
    
    socket.on('send-sticker', (data) => {
        io.to(data.matchCode).emit('new-sticker', { username: data.username, sticker: data.sticker });
    });
    
    socket.on('disconnect', () => {
        onlineUsers.delete(socket.id);
        io.emit('online-count', { count: onlineUsers.size });
    });
});

// ============ START SERVER ============
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log('\n========================================');
    console.log('🎮 RPS CYBER ARENA - NEON POSTGRESQL');
    console.log('========================================');
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🌐 Backend URL: https://rps-backend-6iq6.onrender.com`);
    console.log('========================================');
    console.log('📋 LOGIN CREDENTIALS:');
    console.log('   👑 Admin: admin / Peaceking');
    console.log('========================================\n');
});
