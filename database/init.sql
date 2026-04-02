-- Drop existing tables
DROP TABLE IF EXISTS sticker_messages CASCADE;
DROP TABLE IF EXISTS active_matches CASCADE;
DROP TABLE IF EXISTS game_sessions CASCADE;
DROP TABLE IF EXISTS abuse_reports CASCADE;
DROP TABLE IF EXISTS online_users CASCADE;
DROP TABLE IF EXISTS user_sessions CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Users Table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) DEFAULT 'user',
    badge VARCHAR(50) DEFAULT 'Novice',
    level INTEGER DEFAULT 0,
    total_wins INTEGER DEFAULT 0,
    total_games INTEGER DEFAULT 0,
    is_banned BOOLEAN DEFAULT FALSE,
    last_ip VARCHAR(45),
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User Sessions Table (for logging)
CREATE TABLE user_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    token_jti VARCHAR(100),
    login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    logout_time TIMESTAMP,
    ip_address VARCHAR(45),
    user_agent TEXT
);

-- Game Sessions Table
CREATE TABLE game_sessions (
    id SERIAL PRIMARY KEY,
    player1_id INTEGER REFERENCES users(id),
    player2_id INTEGER REFERENCES users(id),
    player1_move VARCHAR(10),
    player2_move VARCHAR(10),
    winner_id INTEGER REFERENCES users(id),
    game_type VARCHAR(20),
    difficulty VARCHAR(20),
    status VARCHAR(20) DEFAULT 'waiting',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- Active Multiplayer Matches
CREATE TABLE active_matches (
    id SERIAL PRIMARY KEY,
    match_code VARCHAR(10) UNIQUE NOT NULL,
    host_id INTEGER REFERENCES users(id),
    opponent_id INTEGER REFERENCES users(id),
    host_move VARCHAR(10),
    opponent_move VARCHAR(10),
    status VARCHAR(20) DEFAULT 'waiting',
    winner_id INTEGER,
    sticker_log TEXT[] DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Abuse Reports
CREATE TABLE abuse_reports (
    id SERIAL PRIMARY KEY,
    reporter_id INTEGER REFERENCES users(id),
    reported_user_id INTEGER REFERENCES users(id),
    reporter_name VARCHAR(50),
    reported_name VARCHAR(50),
    reason TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sticker Messages
CREATE TABLE sticker_messages (
    id SERIAL PRIMARY KEY,
    match_id INTEGER REFERENCES active_matches(id),
    sender_id INTEGER REFERENCES users(id),
    sender_name VARCHAR(50),
    sticker_code VARCHAR(50),
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Online Users Tracking
CREATE TABLE online_users (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    username VARCHAR(50),
    socket_id VARCHAR(100),
    last_heartbeat TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Admin Activity Log
CREATE TABLE admin_activity_log (
    id SERIAL PRIMARY KEY,
    admin_id INTEGER REFERENCES users(id),
    admin_name VARCHAR(50),
    action VARCHAR(100),
    target_user VARCHAR(50),
    details TEXT,
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_active_matches_status ON active_matches(status);
CREATE INDEX idx_online_users_last_heartbeat ON online_users(last_heartbeat);
CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_admin_log_admin_id ON admin_activity_log(admin_id);

-- Insert Admin User (password: Peaceking)
-- Password hash will be updated by server on startup
INSERT INTO users (username, email, password_hash, role, badge, level, total_wins) 
VALUES ('admin', 'santasantol087@gmail.com', 'temp_hash', 'admin', 'Legend', 99, 1000)
ON CONFLICT (username) DO NOTHING;

-- Insert Sample Users
INSERT INTO users (username, email, password_hash, role, badge, level, total_wins) 
VALUES 
('CyberWarrior', 'warrior@test.com', 'temp_hash', 'user', 'Master', 15, 75),
('NeonRookie', 'rookie@test.com', 'temp_hash', 'user', 'Novice', 2, 8),
('GlitchMaster', 'glitch@test.com', 'temp_hash', 'user', 'Adept', 8, 42),
('ShadowPlayer', 'shadow@test.com', 'temp_hash', 'user', 'Skilled', 6, 28)
ON CONFLICT (username) DO NOTHING;