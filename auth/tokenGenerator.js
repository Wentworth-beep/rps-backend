const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class TokenManager {
    constructor() {
        this.userSecret = process.env.USER_JWT_SECRET;
        this.adminSecret = process.env.ADMIN_JWT_SECRET;
        this.blacklistedTokens = new Set();
        this.logFile = path.join(__dirname, '../logs/token_activity.log');
        this.ensureLogFile();
    }

    ensureLogFile() {
        const logDir = path.join(__dirname, '../logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        if (!fs.existsSync(this.logFile)) {
            fs.writeFileSync(this.logFile, '');
        }
    }

    logTokenActivity(message, type = 'INFO') {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${type}] ${message}\n`;
        fs.appendFileSync(this.logFile, logMessage);
        console.log(`🔐 ${logMessage.trim()}`);
    }

    generateUserToken(userId, username, role = 'user') {
        try {
            const token = jwt.sign(
                { 
                    id: userId, 
                    username: username, 
                    role: role,
                    type: 'user',
                    iat: Math.floor(Date.now() / 1000),
                    jti: crypto.randomBytes(16).toString('hex')
                },
                this.userSecret,
                { expiresIn: process.env.USER_TOKEN_EXPIRY || '24h' }
            );
            
            this.logTokenActivity(`User token generated for: ${username} (ID: ${userId})`, 'GENERATE');
            return token;
        } catch (error) {
            this.logTokenActivity(`Token generation failed for ${username}: ${error.message}`, 'ERROR');
            throw error;
        }
    }

    generateAdminToken(adminId, adminUsername) {
        try {
            const token = jwt.sign(
                { 
                    id: adminId, 
                    username: adminUsername, 
                    role: 'admin',
                    type: 'admin',
                    iat: Math.floor(Date.now() / 1000),
                    jti: crypto.randomBytes(16).toString('hex'),
                    permissions: ['ban_users', 'manage_badges', 'view_reports', 'delete_reports']
                },
                this.adminSecret,
                { expiresIn: process.env.ADMIN_TOKEN_EXPIRY || '8h' }
            );
            
            this.logTokenActivity(`Admin token generated for: ${adminUsername} (ID: ${adminId})`, 'ADMIN_GENERATE');
            return token;
        } catch (error) {
            this.logTokenActivity(`Admin token generation failed: ${error.message}`, 'ERROR');
            throw error;
        }
    }

    verifyUserToken(token) {
        try {
            const decoded = jwt.verify(token, this.userSecret);
            
            if (this.blacklistedTokens.has(token)) {
                this.logTokenActivity(`Blacklisted token rejected for: ${decoded.username}`, 'REJECTED');
                return null;
            }
            
            this.logTokenActivity(`User token verified for: ${decoded.username}`, 'VERIFY');
            return decoded;
        } catch (error) {
            this.logTokenActivity(`User token verification failed: ${error.message}`, 'ERROR');
            return null;
        }
    }

    verifyAdminToken(token) {
        try {
            const decoded = jwt.verify(token, this.adminSecret);
            
            if (this.blacklistedTokens.has(token)) {
                this.logTokenActivity(`Blacklisted admin token rejected for: ${decoded.username}`, 'REJECTED');
                return null;
            }
            
            this.logTokenActivity(`Admin token verified for: ${decoded.username}`, 'ADMIN_VERIFY');
            return decoded;
        } catch (error) {
            this.logTokenActivity(`Admin token verification failed: ${error.message}`, 'ERROR');
            return null;
        }
    }

    blacklistToken(token, reason = 'No reason provided') {
        this.blacklistedTokens.add(token);
        this.logTokenActivity(`Token blacklisted: ${reason}`, 'BLACKLIST');
        
        // Auto-clean blacklist after 24 hours
        setTimeout(() => {
            this.blacklistedTokens.delete(token);
            this.logTokenActivity(`Token removed from blacklist after expiry`, 'CLEANUP');
        }, 24 * 60 * 60 * 1000);
    }

    decodeTokenWithoutVerify(token) {
        return jwt.decode(token);
    }

    getTokenExpiry(token) {
        const decoded = this.decodeTokenWithoutVerify(token);
        if (decoded && decoded.exp) {
            return new Date(decoded.exp * 1000);
        }
        return null;
    }

    isTokenExpired(token) {
        const expiry = this.getTokenExpiry(token);
        if (!expiry) return true;
        return expiry < new Date();
    }
}

module.exports = new TokenManager();