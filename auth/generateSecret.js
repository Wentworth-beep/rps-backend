const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function generateStrongSecret(length = 64) {
    return crypto.randomBytes(length).toString('hex').substring(0, length);
}

function generateAllSecrets() {
    console.log('\n========================================');
    console.log('🔐 STRONG SECRET GENERATOR');
    console.log('========================================\n');
    
    const userSecret = generateStrongSecret(64);
    const adminSecret = generateStrongSecret(64);
    
    console.log('USER_JWT_SECRET=' + userSecret);
    console.log('ADMIN_JWT_SECRET=' + adminSecret);
    console.log('\n========================================');
    console.log('Copy these to your .env file');
    console.log('========================================\n');
    
    // Optional: Save to .env file
    const envPath = path.join(__dirname, '../.env');
    if (fs.existsSync(envPath)) {
        let envContent = fs.readFileSync(envPath, 'utf8');
        envContent = envContent.replace(/USER_JWT_SECRET=.*/g, `USER_JWT_SECRET=${userSecret}`);
        envContent = envContent.replace(/ADMIN_JWT_SECRET=.*/g, `ADMIN_JWT_SECRET=${adminSecret}`);
        fs.writeFileSync(envPath, envContent);
        console.log('✅ Secrets saved to .env file');
    }
}

if (require.main === module) {
    generateAllSecrets();
}

module.exports = { generateStrongSecret, generateAllSecrets };