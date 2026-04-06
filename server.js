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

// ============ NEON POSTGRESQL CONNECTION ============
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_f1H2zKZLaMTG@ep-winter-night-anhzdv3n-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 20
});

// Test database connection
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Database connection error:', err.message);
        process.exit(1);
    } else {
        console.log('✅ Connected to Neon PostgreSQL database');
        release();
        initDatabase();
    }
});

// ============ INITIALIZE DATABASE TABLES ============
async function initDatabase() {
    try {
        // Create users table
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
                theme VARCHAR(50) DEFAULT 'cyberpunk',
                win_streak INTEGER DEFAULT 0,
                daily_streak INTEGER DEFAULT 0,
                total_earned_coins INTEGER DEFAULT 500,
                last_daily_claim DATE,
                is_banned BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Users table ready');

        // Create matches table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS matches (
                id SERIAL PRIMARY KEY,
                player1_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                player2_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                winner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                player1_move VARCHAR(10),
                player2_move VARCHAR(10),
                game_type VARCHAR(20),
                mmr_change INTEGER,
                coins_earned INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Matches table ready');

        // Create friend_requests table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS friend_requests (
                id SERIAL PRIMARY KEY,
                from_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                to_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                status VARCHAR(20) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Friend requests table ready');

        // Create friendships table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS friendships (
                id SERIAL PRIMARY KEY,
                user_id1 INTEGER REFERENCES users(id) ON DELETE CASCADE,
                user_id2 INTEGER REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Friendships table ready');

        // Create tournaments table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS tournaments (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100),
                host_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                players JSONB DEFAULT '[]',
                bracket JSONB DEFAULT '[]',
                status VARCHAR(20) DEFAULT 'waiting',
                max_players INTEGER DEFAULT 8,
                current_players INTEGER DEFAULT 1,
                prize_pool INTEGER DEFAULT 0,
                winner_id INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Tournaments table ready');

        // Create user_powerups table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_powerups (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                powerup_id VARCHAR(50),
                quantity INTEGER DEFAULT 1,
                acquired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Power-ups table ready');

        // Create daily_rewards table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS daily_rewards (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                reward INTEGER,
                streak INTEGER,
                claimed_at DATE DEFAULT CURRENT_DATE
            )
        `);
        console.log('✅ Daily rewards table ready');

        // Create admin logs table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS admin_logs (
                id SERIAL PRIMARY KEY,
                admin_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                admin_name VARCHAR(50),
                action VARCHAR(100),
                target VARCHAR(50),
                details TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Admin logs table ready');

        // Create admin user if not exists
        const adminCheck = await pool.query('SELECT * FROM users WHERE username = $1', ['admin']);
        if (adminCheck.rows.length === 0) {
            const adminPasswordHash = await bcrypt.hash('Peaceking', 10);
            await pool.query(
                `INSERT INTO users (username, email, password_hash, role, badge, level, total_wins, mmr, rank, coins, avatar)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                ['admin', 'santasantol087@gmail.com', adminPasswordHash, 'admin', 'Legend', 50, 5000, 3500, 'Grandmaster', 10000, 'dragon']
            );
            console.log('✅ Admin user created');
        }

        // Create sample users if not exists
        const userCount = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'user'");
        if (parseInt(userCount.rows[0].count) === 0) {
            const samplePasswordHash = await bcrypt.hash('player123', 10);
            const sampleUsers = [
                ['CyberWarrior', 'warrior@test.com', 'Master', 25, 150, 2200, 'Diamond', 2500, 'ninja'],
                ['NeonRookie', 'rookie@test.com', 'Bronze', 3, 8, 450, 'Bronze', 200, 'robot'],
                ['GlitchMaster', 'glitch@test.com', 'Gold', 12, 60, 1200, 'Gold', 800, 'wizard']
            ];
            
            for (const user of sampleUsers) {
                await pool.query(
                    `INSERT INTO users (username, email, password_hash, role, badge, level, total_wins, total_games, mmr, rank, coins, avatar)
                     VALUES ($1, $2, $3, 'user', $4, $5, $6, $7, $8, $9, $10, $11)`,
                    [user[0], user[1], samplePasswordHash, user[2], user[3], user[4], user[5], user[6], user[7], user[8]]
                );
            }
            console.log('✅ Sample users created');
        }

        console.log('========================================');
        console.log('✅ DATABASE INITIALIZATION COMPLETE');
        console.log('========================================\n');

    } catch (error) {
        console.error('Database initialization error:', error.message);
    }
}

// ============ HELPER FUNCTIONS ============
function getLevelFromWins(wins) {
    return Math.floor(wins / 5) + 1;
}

function getRankFromMMR(mmr) {
    if (mmr >= 3000) return 'Legend';
    if (mmr >= 2500) return 'Master';
    if (mmr >= 2000) return 'Diamond';
    if (mmr >= 1500) return 'Platinum';
    if (mmr >= 1000) return 'Gold';
    if (mmr >= 500) return 'Silver';
    return 'Bronze';
}

function getBadgeFromWins(wins) {
    if (wins >= 500) return 'Legend';
    if (wins >= 250) return 'Master';
    if (wins >= 100) return 'Diamond';
    if (wins >= 50) return 'Platinum';
    if (wins >= 25) return 'Gold';
    if (wins >= 10) return 'Silver';
    return 'Bronze';
}

// ============ USER ROUTES ============

// Register - SAVES TO NEON DATABASE
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'All fields required' });
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
            `INSERT INTO users (username, email, password_hash, role, badge, level, coins, avatar)
             VALUES ($1, $2, $3, 'user', 'Bronze', 1, 500, 'ninja')
             RETURNING id, username, role, badge, level, coins, avatar`,
            [username, email, passwordHash]
        );
        
        const token = jwt.sign(
            { id: result.rows[0].id, username: result.rows[0].username, role: result.rows[0].role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        console.log(`✅ New user registered: ${username}`);
        res.json({ success: true, token, user: result.rows[0] });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login - FETCHES FROM NEON DATABASE
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
        
        // Update last login
        await pool.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);
        
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
                avatar: user.avatar,
                win_streak: user.win_streak,
                daily_streak: user.daily_streak
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Get user stats - FROM NEON DATABASE
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
        
        res.json(result.rows[0]);
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

// Play vs Computer - UPDATES NEON DATABASE
app.post('/api/game/computer', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    
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
        
        // Get current user data
        const userResult = await pool.query('SELECT total_wins, win_streak, coins, level FROM users WHERE id = $1', [decoded.id]);
        const user = userResult.rows[0];
        
        let newWinStreak = user.win_streak;
        let newTotalWins = user.total_wins;
        let levelUp = false;
        let levelUpReward = 0;
        
        if (won) {
            if (user.win_streak >= 2) coinsEarned += 20;
            if (user.win_streak >= 4) coinsEarned += 40;
            newWinStreak = user.win_streak + 1;
            newTotalWins = user.total_wins + 1;
            
            const oldLevel = getLevelFromWins(user.total_wins);
            const newLevel = getLevelFromWins(newTotalWins);
            if (newLevel > oldLevel) {
                levelUp = true;
                levelUpReward = newLevel * 50;
            }
            
            const newBadge = getBadgeFromWins(newTotalWins);
            const newRank = getRankFromMMR(user.mmr + 25);
            
            await pool.query(
                `UPDATE users SET 
                    total_wins = total_wins + 1, 
                    total_games = total_games + 1, 
                    coins = coins + $1,
                    win_streak = $2,
                    mmr = mmr + 25,
                    level = $3,
                    badge = $4,
                    rank = $5
                 WHERE id = $6`,
                [coinsEarned, newWinStreak, getLevelFromWins(newTotalWins), newBadge, newRank, decoded.id]
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
            total_coins: updatedUser.rows[0].coins,
            win_streak: newWinStreak
        });
    } catch (error) {
        console.error('Game error:', error);
        res.status(500).json({ error: 'Game failed' });
    }
});

// Leaderboard - FROM NEON DATABASE
app.get('/api/leaderboard', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, username, total_wins as wins, mmr, badge, avatar, level, coins
             FROM users WHERE role = 'user' 
             ORDER BY mmr DESC LIMIT 20`
        );
        res.json(result.rows.map((u, i) => ({ ...u, rank: i + 1 })));
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
});

// Match history - FROM NEON DATABASE
app.get('/api/match-history', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
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
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

// Update avatar - UPDATES NEON DATABASE
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
    console.log('Client connected:', socket.id);
    
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
            status: 'waiting',
            createdAt: Date.now()
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

// Start server
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log('\n========================================');
    console.log('🎮 RPS CYBER ARENA - NEON DATABASE');
    console.log('========================================');
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🗄️  Database: Neon PostgreSQL`);
    console.log('========================================');
    console.log('📋 LOGIN CREDENTIALS:');
    console.log('   Admin: admin / Peaceking');
    console.log('   Test: CyberWarrior / player123');
    console.log('========================================\n');
});
