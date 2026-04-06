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
        origin: ['https://rps-fronthead.vercel.app', 'http://localhost:3000', 'http://localhost:3001', '*'],
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling']
});

app.use(cors({
    origin: ['https://rps-fronthead.vercel.app', 'http://localhost:3000', 'http://localhost:3001', '*'],
    credentials: true
}));
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'kirinyaga_secret_key_2025';

// ============ IN-MEMORY DATABASE (Working without Neon) ============
const memoryDB = {
    users: [],
    matches: [],
    nextId: 1
};

// Initialize in-memory users
async function initMemoryDB() {
    // Create admin user
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
        coins: 10000,
        win_streak: 0,
        created_at: new Date().toISOString()
    });
    
    // Create sample users
    const playerHash = await bcrypt.hash('player123', 10);
    const sampleUsers = [
        { username: 'CyberWarrior', email: 'warrior@test.com', badge: 'Master', level: 25, wins: 150, mmr: 2200, rank: 'Master', avatar: 'ninja', coins: 2500 },
        { username: 'NeonRookie', email: 'rookie@test.com', badge: 'Bronze', level: 3, wins: 8, mmr: 450, rank: 'Bronze', avatar: 'robot', coins: 200 },
        { username: 'GlitchMaster', email: 'glitch@test.com', badge: 'Gold', level: 12, wins: 60, mmr: 1200, rank: 'Gold', avatar: 'wizard', coins: 800 }
    ];
    
    for (const user of sampleUsers) {
        memoryDB.users.push({
            id: memoryDB.nextId++,
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
            created_at: new Date().toISOString()
        });
    }
    
    console.log('✅ In-memory database initialized with', memoryDB.users.length, 'users');
}

// ============ HELPER FUNCTIONS ============
function findUserByUsername(username) {
    return memoryDB.users.find(u => u.username === username);
}

function findUserById(id) {
    return memoryDB.users.find(u => u.id === id);
}

// ============ USER ROUTES ============

// Register - WORKING
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    console.log('📝 Register attempt:', username, email);
    
    // Validation
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'All fields are required' });
    }
    if (password.length < 4) {
        return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }
    if (!email.includes('@')) {
        return res.status(400).json({ error: 'Please enter a valid email address' });
    }
    
    try {
        // Check if user exists
        const existing = findUserByUsername(username);
        if (existing) {
            return res.status(400).json({ error: 'Username already exists' });
        }
        
        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);
        
        // Create new user
        const newUser = {
            id: memoryDB.nextId++,
            username: username,
            email: email,
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
            coins: 500,
            win_streak: 0,
            created_at: new Date().toISOString()
        };
        memoryDB.users.push(newUser);
        
        // Generate token
        const token = jwt.sign(
            { id: newUser.id, username: newUser.username, role: newUser.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        console.log(`✅ User registered successfully: ${username}`);
        res.json({
            success: true,
            token,
            user: {
                id: newUser.id,
                username: newUser.username,
                role: newUser.role,
                badge: newUser.badge,
                level: newUser.level,
                coins: newUser.coins,
                avatar: newUser.avatar
            }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed. Please try again.' });
    }
});

// Login - WORKING
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    console.log('🔐 Login attempt:', username);
    
    try {
        const user = findUserByUsername(username);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        if (user.is_banned) {
            return res.status(403).json({ error: 'Account has been banned' });
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

// Get user stats - WORKING
app.get('/api/user/stats', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Token required' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = findUserById(decoded.id);
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({
            username: user.username,
            badge: user.badge,
            level: user.level,
            total_wins: user.total_wins,
            total_games: user.total_games,
            mmr: user.mmr,
            rank: user.rank,
            coins: user.coins,
            avatar: user.avatar,
            win_streak: user.win_streak
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(403).json({ error: 'Invalid token' });
    }
});

// Play vs Computer - WORKING
app.post('/api/game/computer', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Token required' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { playerMove, difficulty } = req.body;
        
        // Computer AI
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
        
        // Determine winner
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
        const user = findUserById(decoded.id);
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
            
            // Update badge based on wins
            if (user.total_wins >= 500) user.badge = 'Legend';
            else if (user.total_wins >= 250) user.badge = 'Master';
            else if (user.total_wins >= 100) user.badge = 'Diamond';
            else if (user.total_wins >= 50) user.badge = 'Platinum';
            else if (user.total_wins >= 25) user.badge = 'Gold';
            else if (user.total_wins >= 10) user.badge = 'Silver';
            
            user.level = Math.floor(user.total_wins / 5) + 1;
            
            // Update rank based on MMR
            if (user.mmr >= 3000) user.rank = 'Legend';
            else if (user.mmr >= 2500) user.rank = 'Master';
            else if (user.mmr >= 2000) user.rank = 'Diamond';
            else if (user.mmr >= 1500) user.rank = 'Platinum';
            else if (user.mmr >= 1000) user.rank = 'Gold';
            else if (user.mmr >= 500) user.rank = 'Silver';
            else user.rank = 'Bronze';
        }
        
        // Save match
        memoryDB.matches.push({
            id: memoryDB.matches.length + 1,
            player1_id: decoded.id,
            player2_id: null,
            winner_id: won ? decoded.id : null,
            player1_move: playerMove,
            player2_move: computerMove,
            game_type: 'computer',
            mmr_change: won ? 25 : -25,
            coins_earned: coinsEarned,
            created_at: new Date().toISOString()
        });
        
        res.json({
            result,
            computerMove,
            playerMove,
            coins_earned: coinsEarned,
            total_coins: user.coins,
            win_streak: user.win_streak
        });
    } catch (error) {
        console.error('Game error:', error);
        res.status(500).json({ error: 'Game failed' });
    }
});

// Leaderboard - WORKING
app.get('/api/leaderboard', async (req, res) => {
    try {
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
    } catch (error) {
        console.error('Leaderboard error:', error);
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
});

// Match history - WORKING
app.get('/api/match-history', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Token required' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
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
    } catch (error) {
        console.error('Match history error:', error);
        res.status(403).json({ error: 'Invalid token' });
    }
});

// Update avatar - WORKING
app.post('/api/update-avatar', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Token required' });
    }
    
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

// Verify token - WORKING
app.get('/api/verify-token', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Token required' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = findUserById(decoded.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ valid: true, user: { id: user.id, username: user.username, role: user.role } });
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

// ============ ADMIN ROUTES ============

// Admin login
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;
    console.log('👑 Admin login attempt:', username);
    
    try {
        const user = findUserByUsername(username);
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

// Get all users (admin only)
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
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

// Ban/unban user
app.post('/api/admin/ban-user', async (req, res) => {
    const { userId, ban } = req.body;
    const user = findUserById(userId);
    if (user && user.role !== 'admin') {
        user.is_banned = ban;
    }
    res.json({ success: true });
});

// Update badge
app.post('/api/admin/update-badge', async (req, res) => {
    const { userId, badge } = req.body;
    const user = findUserById(userId);
    if (user) {
        user.badge = badge;
    }
    res.json({ success: true });
});

// Get online count
app.get('/api/admin/online-count', (req, res) => {
    res.json({ count: onlineUsers.size });
});

// Get total users
app.get('/api/admin/total-users', (req, res) => {
    const count = memoryDB.users.filter(u => u.role === 'user').length;
    res.json({ count });
});

// ============ SOCKET.IO ============
const onlineUsers = new Map();
const activeSessions = {};

io.on('connection', (socket) => {
    console.log('🔌 Client connected:', socket.id);
    
    socket.on('user-online', (data) => {
        onlineUsers.set(socket.id, data);
        io.emit('online-count', { count: onlineUsers.size });
        console.log('👤 User online:', data.username, 'Total:', onlineUsers.size);
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
        console.log('🎮 Match created:', matchCode, 'by', data.username);
    });
    
    socket.on('join-match', (data) => {
        const session = activeSessions[data.matchCode];
        if (session && session.status === 'waiting') {
            session.players.push(data.username);
            session.status = 'active';
            socket.join(data.matchCode);
            io.to(data.matchCode).emit('match-started', { matchCode: data.matchCode });
            console.log('🎮 Match joined:', data.username, 'joined', data.matchCode);
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
            console.log('🎮 Move made in match:', data.matchCode);
        }
    });
    
    socket.on('send-sticker', (data) => {
        io.to(data.matchCode).emit('new-sticker', { username: data.username, sticker: data.sticker });
    });
    
    socket.on('disconnect', () => {
        onlineUsers.delete(socket.id);
        io.emit('online-count', { count: onlineUsers.size });
        console.log('🔌 Client disconnected:', socket.id);
    });
});

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ 
        status: 'online', 
        message: 'RPS Cyber Arena API is running',
        users: memoryDB.users.length,
        timestamp: new Date().toISOString()
    });
});

// Start server
const PORT = process.env.PORT || 3000;

// Initialize database and start server
initMemoryDB().then(() => {
    server.listen(PORT, '0.0.0.0', () => {
        console.log('\n========================================');
        console.log('🎮 RPS CYBER ARENA BACKEND');
        console.log('========================================');
        console.log(`✅ Server running on port ${PORT}`);
        console.log(`🌐 URL: http://localhost:${PORT}`);
        console.log(`👥 Users in database: ${memoryDB.users.length}`);
        console.log('========================================');
        console.log('📋 LOGIN CREDENTIALS:');
        console.log('   👑 Admin: admin / Peaceking');
        console.log('   🎮 Test: CyberWarrior / player123');
        console.log('   🎮 Test: NeonRookie / player123');
        console.log('   🎮 Test: GlitchMaster / player123');
        console.log('========================================\n');
    });
});
