const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const JWT_SECRET = process.env.JWT_SECRET || 'kirinyaga_secret_key_2025';

// Badge system (PUBG style)
const badges = [
    { name: 'Bronze', min: 0, icon: 'fa-medal', color: '#cd7f32' },
    { name: 'Silver', min: 100, icon: 'fa-star', color: '#c0c0c0' },
    { name: 'Gold', min: 250, icon: 'fa-crown', color: '#ffd700' },
    { name: 'Platinum', min: 500, icon: 'fa-gem', color: '#00e5ff' },
    { name: 'Diamond', min: 1000, icon: 'fa-diamond', color: '#b9f2ff' },
    { name: 'Master', min: 2000, icon: 'fa-shield-alt', color: '#9b59b6' },
    { name: 'Legend', min: 3500, icon: 'fa-trophy', color: '#ff4b2b' }
];

// In-memory database
const memoryDB = {
    users: [],
    matches: [],
    activeMatches: [],
    abuseReports: [],
    adminLogs: [],
    onlineUsers: [],
    nextId: 1,
    reportId: 1,
    logId: 1
};

// Initialize data
async function initData() {
    // Create admin user
    const adminPasswordHash = await bcrypt.hash('Peaceking', 10);
    memoryDB.users.push({
        id: memoryDB.nextId++,
        username: 'admin',
        email: 'santasantol087@gmail.com',
        password_hash: adminPasswordHash,
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
    
    // Create sample users with different badges
    const samplePasswordHash = await bcrypt.hash('player123', 10);
    const sampleUsers = [
        { username: 'CyberWarrior', email: 'warrior@test.com', badge: 'Master', level: 25, wins: 150, mmr: 2200, rank: 'Master', avatar: 'ninja', coins: 2500 },
        { username: 'NeonRookie', email: 'rookie@test.com', badge: 'Bronze', level: 3, wins: 8, mmr: 450, rank: 'Bronze', avatar: 'robot', coins: 200 },
        { username: 'GlitchMaster', email: 'glitch@test.com', badge: 'Gold', level: 12, wins: 60, mmr: 1200, rank: 'Gold', avatar: 'wizard', coins: 800 },
        { username: 'ShadowBlade', email: 'shadow@test.com', badge: 'Platinum', level: 18, wins: 90, mmr: 1800, rank: 'Platinum', avatar: 'ghost', coins: 1500 },
        { username: 'DragonSlayer', email: 'dragon@test.com', badge: 'Diamond', level: 35, wins: 280, mmr: 3100, rank: 'Diamond', avatar: 'dragon', coins: 5000 }
    ];
    
    for (const user of sampleUsers) {
        memoryDB.users.push({
            id: memoryDB.nextId++,
            username: user.username,
            email: user.email,
            password_hash: samplePasswordHash,
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
    
    // Add sample abuse reports
    memoryDB.abuseReports.push({
        id: memoryDB.reportId++,
        reporter_name: 'CyberWarrior',
        reported_name: 'NeonRookie',
        reason: 'Using inappropriate language in chat',
        status: 'pending',
        created_at: new Date().toISOString()
    });
    
    memoryDB.abuseReports.push({
        id: memoryDB.reportId++,
        reporter_name: 'GlitchMaster',
        reported_name: 'ShadowBlade',
        reason: 'Cheating / using hacks',
        status: 'pending',
        created_at: new Date().toISOString()
    });
    
    // Add sample admin logs
    memoryDB.adminLogs.push({
        id: memoryDB.logId++,
        admin_name: 'admin',
        action: 'ADMIN_LOGIN',
        target: null,
        details: 'Admin logged in',
        created_at: new Date().toISOString()
    });
    
    console.log('✅ Database initialized with', memoryDB.users.length, 'users');
}

// Helper functions
function findUserByUsername(username) {
    return memoryDB.users.find(u => u.username === username);
}

function findUserById(id) {
    return memoryDB.users.find(u => u.id === id);
}

function addAdminLog(adminName, action, target, details) {
    memoryDB.adminLogs.unshift({
        id: memoryDB.logId++,
        admin_name: adminName,
        action: action,
        target: target,
        details: details,
        created_at: new Date().toISOString()
    });
    if (memoryDB.adminLogs.length > 100) memoryDB.adminLogs.pop();
}

// Authentication middleware
function authenticateAdmin(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Admin token required' });
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        req.admin = decoded;
        next();
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
}

// ============ ADMIN ROUTES ============

// Admin Login
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;
    
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
        
        addAdminLog(user.username, 'ADMIN_LOGIN', null, 'Admin logged in successfully');
        
        res.json({ 
            success: true, 
            token, 
            admin: { id: user.id, username: user.username, role: user.role } 
        });
    } catch (error) {
        res.status(500).json({ error: 'Admin login failed' });
    }
});

// Get all users
app.get('/api/admin/users', authenticateAdmin, async (req, res) => {
    try {
        const users = memoryDB.users.map(u => ({
            id: u.id,
            username: u.username,
            email: u.email,
            role: u.role,
            badge: u.badge,
            level: u.level,
            total_wins: u.total_wins,
            mmr: u.mmr,
            rank: u.rank,
            is_banned: u.is_banned,
            avatar: u.avatar,
            coins: u.coins,
            created_at: u.created_at
        }));
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// Ban/Unban user
app.post('/api/admin/ban-user', authenticateAdmin, async (req, res) => {
    const { userId, ban } = req.body;
    const user = findUserById(parseInt(userId));
    
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    if (user.role === 'admin') {
        return res.status(403).json({ error: 'Cannot ban admin users' });
    }
    
    user.is_banned = ban;
    addAdminLog(req.admin.username, ban ? 'BAN_USER' : 'UNBAN_USER', user.username, `User ${ban ? 'banned' : 'unbanned'}`);
    
    res.json({ success: true, message: ban ? 'User banned successfully' : 'User unbanned successfully' });
});

// Update user badge (PUBG style)
app.post('/api/admin/update-badge', authenticateAdmin, async (req, res) => {
    const { userId, badge } = req.body;
    const user = findUserById(parseInt(userId));
    
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    user.badge = badge;
    addAdminLog(req.admin.username, 'UPDATE_BADGE', user.username, `Badge changed to ${badge}`);
    
    res.json({ success: true, message: `Badge updated to ${badge}` });
});

// Get online count
app.get('/api/admin/online-count', authenticateAdmin, async (req, res) => {
    res.json({ count: memoryDB.onlineUsers.length });
});

// Get total registered users
app.get('/api/admin/total-users', authenticateAdmin, async (req, res) => {
    const count = memoryDB.users.filter(u => u.role === 'user').length;
    res.json({ count });
});

// Get abuse reports
app.get('/api/admin/reports', authenticateAdmin, async (req, res) => {
    res.json(memoryDB.abuseReports);
});

// Add abuse report
app.post('/api/report-abuse', authenticateAdmin, async (req, res) => {
    const { reportedUsername, reason } = req.body;
    const reportedUser = findUserByUsername(reportedUsername);
    
    if (!reportedUser) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    memoryDB.abuseReports.push({
        id: memoryDB.reportId++,
        reporter_name: req.admin.username,
        reported_name: reportedUsername,
        reason: reason,
        status: 'pending',
        created_at: new Date().toISOString()
    });
    
    res.json({ success: true, message: 'Report submitted' });
});

// Clear all reports
app.delete('/api/admin/clear-reports', authenticateAdmin, async (req, res) => {
    memoryDB.abuseReports = [];
    addAdminLog(req.admin.username, 'CLEAR_REPORTS', null, 'All abuse reports cleared');
    res.json({ success: true });
});

// Get admin logs
app.get('/api/admin/logs', authenticateAdmin, async (req, res) => {
    res.json(memoryDB.adminLogs);
});

// Get badges list
app.get('/api/admin/badges', authenticateAdmin, async (req, res) => {
    res.json(badges);
});

// ============ USER ROUTES ============

// Register
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'All fields required' });
    }
    
    const existingUser = findUserByUsername(username);
    if (existingUser) {
        return res.status(400).json({ error: 'Username already exists' });
    }
    
    const passwordHash = await bcrypt.hash(password, 10);
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
        coins: 100,
        created_at: new Date().toISOString()
    };
    memoryDB.users.push(newUser);
    
    const token = jwt.sign(
        { id: newUser.id, username: newUser.username, role: newUser.role },
        JWT_SECRET,
        { expiresIn: '24h' }
    );
    
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
    
    const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: '24h' }
    );
    
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
app.get('/api/user/stats', authenticateAdmin, async (req, res) => {
    const user = findUserById(req.admin.id);
    res.json({
        username: user.username,
        badge: user.badge,
        level: user.level,
        total_wins: user.total_wins,
        total_games: user.total_games,
        mmr: user.mmr,
        rank: user.rank,
        coins: user.coins,
        avatar: user.avatar
    });
});

// Play vs Computer
app.post('/api/game/computer', authenticateAdmin, async (req, res) => {
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
    if (playerMove === computerMove) {
        result = 'tie';
    } else if (
        (playerMove === 'rock' && computerMove === 'scissors') ||
        (playerMove === 'paper' && computerMove === 'rock') ||
        (playerMove === 'scissors' && computerMove === 'paper')
    ) {
        result = 'win';
    } else {
        result = 'lose';
    }
    
    res.json({ result, computerMove, playerMove });
});

// Leaderboard
app.get('/api/leaderboard', authenticateAdmin, async (req, res) => {
    const leaderboard = [...memoryDB.users]
        .filter(u => u.role === 'user')
        .sort((a, b) => b.mmr - a.mmr)
        .slice(0, 20)
        .map((u, index) => ({
            rank: index + 1,
            username: u.username,
            wins: u.total_wins,
            mmr: u.mmr,
            badge: u.badge,
            avatar: u.avatar
        }));
    res.json(leaderboard);
});

// Match history
app.get('/api/match-history', authenticateAdmin, async (req, res) => {
    const history = memoryDB.matches
        .filter(m => m.playerId === req.admin.id)
        .slice(0, 20);
    res.json(history);
});

// Achievements
app.get('/api/achievements', authenticateAdmin, async (req, res) => {
    const allAchievements = [
        { id: 'first_blood', name: 'First Blood', description: 'Win your first match', icon: 'fa-trophy', unlocked: true },
        { id: 'warrior', name: 'Warrior', description: 'Win 10 matches', icon: 'fa-shield-alt', unlocked: false },
        { id: 'legendary', name: 'Legendary', description: 'Win 50 matches', icon: 'fa-crown', unlocked: false },
        { id: 'veteran', name: 'Veteran', description: 'Play 100 matches', icon: 'fa-star', unlocked: false }
    ];
    res.json(allAchievements);
});

// Update avatar
app.post('/api/update-avatar', authenticateAdmin, async (req, res) => {
    const { avatar } = req.body;
    const user = findUserById(req.admin.id);
    if (user) user.avatar = avatar;
    res.json({ success: true });
});

// Verify token
app.get('/api/verify-token', authenticateAdmin, async (req, res) => {
    res.json({ valid: true, user: req.admin });
});

// Logout
app.post('/api/logout', authenticateAdmin, async (req, res) => {
    res.json({ success: true });
});

// ============ SOCKET.IO ============
const onlineUsers = new Map();

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    socket.on('user-online', (data) => {
        onlineUsers.set(socket.id, data);
        memoryDB.onlineUsers = Array.from(onlineUsers.values());
        io.emit('online-count', { count: onlineUsers.size });
    });
    
    socket.on('create-match', (data) => {
        const matchCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        memoryDB.activeMatches.push({
            matchCode,
            hostId: data.userId,
            hostName: data.username,
            status: 'waiting'
        });
        socket.join(matchCode);
        socket.emit('match-created', { matchCode });
    });
    
    socket.on('join-match', (data) => {
        const match = memoryDB.activeMatches.find(m => m.matchCode === data.matchCode && m.status === 'waiting');
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
        const match = memoryDB.activeMatches.find(m => m.matchCode === data.matchCode);
        if (match) {
            if (match.hostId === data.userId) match.hostMove = data.move;
            else match.opponentMove = data.move;
            
            if (match.hostMove && match.opponentMove) {
                let winner = null;
                if (match.hostMove === match.opponentMove) winner = 'tie';
                else if (
                    (match.hostMove === 'rock' && match.opponentMove === 'scissors') ||
                    (match.hostMove === 'paper' && match.opponentMove === 'rock') ||
                    (match.hostMove === 'scissors' && match.opponentMove === 'paper')
                ) {
                    winner = match.hostId;
                } else {
                    winner = match.opponentId;
                }
                
                io.to(data.matchCode).emit('game-result', {
                    hostMove: match.hostMove,
                    opponentMove: match.opponentMove,
                    winner: winner
                });
                
                memoryDB.activeMatches = memoryDB.activeMatches.filter(m => m.matchCode !== data.matchCode);
            }
        }
    });
    
    socket.on('send-sticker', (data) => {
        io.to(data.matchCode).emit('new-sticker', { username: data.username, sticker: data.sticker });
    });
    
    socket.on('disconnect', () => {
        onlineUsers.delete(socket.id);
        memoryDB.onlineUsers = Array.from(onlineUsers.values());
        io.emit('online-count', { count: onlineUsers.size });
    });
});

// Start server
const PORT = process.env.PORT || 3000;

initData().then(() => {
    server.listen(PORT, () => {
        console.log('\n========================================');
        console.log('KIRINYAGA UNIVERSITY - RPS CYBER ARENA');
        console.log('========================================');
 
        console.log('   - DragonSlayer (Diamond)');
        console.log('========================================\n');
    });
});