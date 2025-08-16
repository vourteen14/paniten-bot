require('dotenv').config();

function validateAndParseNumber(value, fieldName) {
    if (!value) return null;
    
    const stringValue = String(value).trim();
    const parsed = parseFloat(stringValue);
    
    if (isNaN(parsed)) {
        console.warn(`Warning: ${fieldName} is not a valid number: ${stringValue}`);
        return null;
    }
    
    if (fieldName === 'CHAT_ID') {
        return Math.floor(parsed);
    }
    
    return parsed;
}

function validateChatId(chatId) {
    if (!chatId) return null;
    
    const parsed = validateAndParseNumber(chatId, 'CHAT_ID');
    
    if (!parsed) return null;
    
    if (parsed > 0) {
        console.warn(`Warning: CHAT_ID ${parsed} appears to be a user ID, not a group/channel ID`);
        console.warn('Group/Channel IDs are typically negative numbers');
    }
    
    return parsed;
}

function validateBotToken(token) {
    if (!token) return null;
    
    const trimmed = token.trim();
    const tokenPattern = /^\d+:[A-Za-z0-9_-]+$/;
    
    if (!tokenPattern.test(trimmed)) {
        console.warn('Warning: BOT_TOKEN format appears invalid');
        console.warn('Expected format: <bot_id>:<bot_secret>');
        return trimmed;
    }
    
    return trimmed;
}

function validateWebhookSecret(secret) {
    if (!secret) return null;
    
    const trimmed = secret.trim();
    
    if (trimmed.length < 8) {
        console.warn('Warning: WEBHOOK_SECRET is too short, recommend at least 8 characters');
    }
    
    return trimmed;
}

function parseAuthorizedUsers(users) {
    if (!users) return [];
    
    return users.split(',')
        .map(user => user.trim())
        .filter(user => user.length > 0)
        .map(user => {
            if (user.startsWith('@')) {
                return user;
            }
            
            const parsed = parseInt(user);
            if (!isNaN(parsed)) {
                return parsed.toString();
            }
            
            return user;
        });
}

const config = {
    BOT_TOKEN: validateBotToken(process.env.BOT_TOKEN),
    CHAT_ID: validateChatId(process.env.CHAT_ID),
    WEBHOOK_SECRET: validateWebhookSecret(process.env.WEBHOOK_SECRET),
    PORT: parseInt(process.env.PORT) || 3000,
    HOST: process.env.HOST || '0.0.0.0',
    DATABASE_PATH: process.env.DATABASE_PATH || './data/alerts.db',
    NODE_ENV: process.env.NODE_ENV || 'development',
    AUTHORIZED_USERS: parseAuthorizedUsers(process.env.AUTHORIZED_USERS),
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    TELEGRAM_TIMEOUT: parseInt(process.env.TELEGRAM_TIMEOUT) || 60000,
    WEBHOOK_TIMEOUT: parseInt(process.env.WEBHOOK_TIMEOUT) || 30000
};

function validateConfiguration() {
    const warnings = [];
    const errors = [];

    if (!config.BOT_TOKEN) {
        errors.push('BOT_TOKEN is required for Telegram functionality');
    }

    if (!config.WEBHOOK_SECRET) {
        warnings.push('WEBHOOK_SECRET not set - webhook authentication disabled');
    }

    if (!config.CHAT_ID) {
        warnings.push('CHAT_ID not set - alerts will not be sent to Telegram');
    }

    if (config.AUTHORIZED_USERS.length === 0) {
        warnings.push('AUTHORIZED_USERS not set - bot commands will be public');
    }

    return { warnings, errors };
}

function logConfiguration() {
    if (config.NODE_ENV === 'test') return;

    const { warnings, errors } = validateConfiguration();

    console.log('Environment Configuration:');
    console.log(`- Node Environment: ${config.NODE_ENV}`);
    console.log(`- Server: ${config.HOST}:${config.PORT}`);
    console.log(`- Database: ${config.DATABASE_PATH}`);
    console.log(`- Bot Token: ${config.BOT_TOKEN ? 'Set' : 'Missing'}`);
    console.log(`- Chat ID: ${config.CHAT_ID || 'Not set'}`);
    console.log(`- Webhook Secret: ${config.WEBHOOK_SECRET ? 'Set' : 'Not set'}`);
    console.log(`- Authorized Users: ${config.AUTHORIZED_USERS.length} configured`);
    
    if (warnings.length > 0) {
        console.log('\nWarnings:');
        warnings.forEach(warning => console.log(`- ${warning}`));
    }
    
    if (errors.length > 0) {
        console.log('\nErrors:');
        errors.forEach(error => console.log(`- ${error}`));
        
        if (config.NODE_ENV === 'production') {
            console.log('\nCannot start in production with configuration errors');
            process.exit(1);
        }
    }
}

logConfiguration();

module.exports = config;