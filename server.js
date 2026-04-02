const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Your Render backend URL
const BACKEND_URL = 'https://rps-backend-6iq6.onrender.com';

// CORS - Allow Vercel frontend
const io = socketIo(server, {
    cors: {
        origin: ['https://rps-fronthead.vercel.app', 'http://localhost:3000'],
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling']
});

app.use(cors({
    origin: ['https://rps-fronthead.vercel.app', 'http://localhost:3000'],
    credentials: true
}));
app.use(express.json());

const JWT_SECRET = 'kirinyaga_secret_key_2025';

// In-memory database
const users = [];
let nextId = 1;

// Initialize users
async function initUsers() {
    const adminHash = await bcrypt.hash('Peaceking', 10);
    users.push({
        id: nextId++,
        username: 'admin',
        email: 'santasantol087@gmail.com',
        password_hash: adminHash,
        role: 'admin',
        badge: 'Legend',
        level: 50,
        total_wins: 5000,
        mmr: 3500,
        rank: 'Legend',
        is_banned: false,
        avatar: 'dragon',
        coins: 10000
    });
    
    const playerHash = await bcrypt.hash('player123', 10);
    users.push({
        id: nextId++,
        username: 'CyberWarrior',
        email: 'warrior@test.com',
        password_hash: playerHash,
        role: 'user',
        badge: 'Master',
        level: 25,
        total_wins: 150,
        mmr: 2200,
        rank: 'Master',
        is_banned: false,
        avatar: 'ninja',
        coins: 2500
    });
    
    console.log('✅ Users initialized');
}

// ============ API ROUTES ============

// Health check
app.get('/', (req, res) => {
    res.json({ status: 'online', message: 'RPS Backend Running', backend: BACKEND_URL });
});

// Register
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'All fields required' });
    }
    
    const existing = users.find(u => u.username === username);
    if (existing) {
        return res.status(400).json({ error: 'Username exists' });
    }
    
    const hash = await bcrypt.hash(password, 10);
    const newUser = {
        id: nextId++,
        username,
        email,
        password_hash: hash,
        role: 'user',
        badge: 'Bronze',
        level: 1,
        total_wins: 0,
        mmr: 500,
        rank: 'Bronze',
        is_banned: false,
        avatar: 'ninja',
        coins: 100
    };
    users.push(newUser);
    
    const token = jwt.sign({ id: newUser.id, username: newUser.username, role: newUser.role }, JWT_SECRET);
    res.json({ success: true, token, user: newUser });
});

// Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    const user = users.find(u => u.username === username);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.is_banned) return res.status(403).json({ error: 'Account banned' });
    
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET);
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
            avatar: user.avatar
        }
    });
});

// Get user stats
app.get('/api/user/stats', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = users.find(u => u.id === decoded.id);
        res.json({
            username: user.username,
            badge: user.badge,
            level: user.level,
            total_wins: user.total_wins,
            mmr: user.mmr,
            rank: user.rank,
            coins: user.coins,
            avatar: user.avatar
        });
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

// Play vs Computer
app.post('/api/game/computer', (req, res) => {
    const { playerMove, difficulty } = req.body;
    
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
        .slice(0, 10)
        .map((u, i) => ({
            rank: i + 1,
            username: u.username,
            wins: u.total_wins,
            mmr: u.mmr,
            badge: u.badge,
            avatar: u.avatar
        }));
    res.json(leaderboard);
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

// ============ ADMIN ROUTES ============

app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username && u.role === 'admin');
    if (!user) return res.status(401).json({ error: 'Invalid admin credentials' });
    
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
            id: u.id,
            username: u.username,
            email: u.email,
            role: u.role,
            badge: u.badge,
            level: u.level,
            total_wins: u.total_wins,
            mmr: u.mmr,
            is_banned: u.is_banned,
            avatar: u.avatar
        }));
        res.json(allUsers);
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

app.post('/api/admin/ban-user', (req, res) => {
    const { userId, ban } = req.body;
    const user = users.find(u => u.id === userId);
    if (user && user.role !== 'admin') user.is_banned = ban;
    res.json({ success: true });
});

app.post('/api/admin/update-badge', (req, res) => {
    const { userId, badge } = req.body;
    const user = users.find(u => u.id === userId);
    if (user) user.badge = badge;
    res.json({ success: true });
});

app.get('/api/admin/online-count', (req, res) => {
    res.json({ count: onlineUsers.size });
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

// ============ SOCKET.IO ============
const onlineUsers = new Map();
const activeMatches = [];

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    socket.on('user-online', (data) => {
        onlineUsers.set(socket.id, data);
        io.emit('online-count', { count: onlineUsers.size });
    });
    
    socket.on('create-match', (data) => {
        const matchCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        activeMatches.push({ matchCode, hostId: data.userId, hostName: data.username, status: 'waiting' });
        socket.join(matchCode);
        socket.emit('match-created', { matchCode });
    });
    
    socket.on('join-match', (data) => {
        const match = activeMatches.find(m => m.matchCode === data.matchCode && m.status === 'waiting');
        if (match) {
            match.opponentId = data.userId;
            match.opponentName = data.username;
            match.status = 'active';
            socket.join(data.matchCode);
            io.to(data.matchCode).emit('match-started', { matchCode: data.matchCode });
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
                io.to(data.matchCode).emit('game-result', { hostMove: match.hostMove, opponentMove: match.opponentMove, winner: winner });
                const index = activeMatches.findIndex(m => m.matchCode === data.matchCode);
                if (index !== -1) activeMatches.splice(index, 1);
            }
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

// Start server
const PORT = process.env.PORT || 3000;

initUsers().then(() => {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`\n========================================`);
        console.log(`🎮 RPS CYBER ARENA BACKEND`);
        console.log(`========================================`);
        console.log(`✅ Server running on port ${PORT}`);
        console.log(`🔗 Backend URL: https://rps-backend-6iq6.onrender.com`);
        console.log(`🌐 Accepting requests from Vercel frontend`);
        console.log(`========================================`);
        console.log(`📋 Admin: admin / Peaceking`);
        console.log(`🎮 Test: CyberWarrior / player123`);
        console.log(`========================================\n`);
    });
});
