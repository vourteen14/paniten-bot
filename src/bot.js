const TelegramBot = require('node-telegram-bot-api');
const config = require('./env');
const Database = require('./database');
const {
    formatAlertMessage,
    formatAcknowledgedMessage,
    formatResolvedMessage,
    formatWeeklyReport,
    createAcknowledgeKeyboard,
    createResolveKeyboard,
    extractAlertIdFromCallback
} = require('./utils');

class PanitenBot {
    constructor() {
        if (!config.BOT_TOKEN) {
            throw new Error('BOT_TOKEN is required for Telegram bot initialization');
        }
        
        this.token = config.BOT_TOKEN;
        this.chatId = config.CHAT_ID;
        this.authorizedUsers = config.AUTHORIZED_USERS;
        this.db = new Database();
        
        this.bot = new TelegramBot(this.token, { 
            polling: true,
            request: {
                timeout: config.TELEGRAM_TIMEOUT
            }
        });
        
        this.setupHandlers();
        this.logInitialization();
    }

    logInitialization() {
        console.log('Telegram bot initialized');
        console.log(`Chat ID: ${this.chatId || 'Not configured'}`);
        console.log(`Authorized users: ${this.authorizedUsers.length > 0 ? this.authorizedUsers.length + ' users' : 'Public access (no restriction)'}`);
        
        if (this.authorizedUsers.length === 0) {
            console.warn('WARNING: No authorized users configured - bot commands will be public');
        }
    }

    isUserAuthorized(user) {
        if (this.authorizedUsers.length === 0) {
            if (config.LOG_LEVEL === 'debug') {
                console.warn(`Public access: User ${user.id} (@${user.username || 'no_username'}) - no authorization configured`);
            }
            return true;
        }
        
        if (this.authorizedUsers.includes(user.id.toString())) {
            return true;
        }
        
        if (user.username && this.authorizedUsers.includes(`@${user.username}`)) {
            return true;
        }
        
        if (user.username && this.authorizedUsers.includes(user.username)) {
            return true;
        }
        
        return false;
    }

    setupHandlers() {
        this.setupCommandHandlers();
        this.setupCallbackHandlers();
        this.setupErrorHandlers();
    }

    setupCommandHandlers() {
        this.bot.onText(/\/start/, (msg) => {
            if (!this.isUserAuthorized(msg.from)) {
                console.log(`Unauthorized /start attempt by user ${msg.from.id} (@${msg.from.username || 'no_username'})`);
                return this.bot.sendMessage(msg.chat.id, 
                    'Access denied. Contact administrator to get authorized.');
            }
            
            console.log(`/start command from: ${msg.from.first_name} (@${msg.from.username || msg.from.id})`);
            
            const welcomeMessage = `*Paniten Bot* - Alert Management System

Welcome! I manage infrastructure alerts with team collaboration features.

*Available Commands:*
/status - Show unacknowledged alerts count
/report - Weekly alert summary with statistics
/help - Show detailed help information

*How it works:*
• External systems send alerts via webhook
• I notify this group with interactive buttons
• Team members can acknowledge and resolve alerts
• Track who handled what and when

*Ready to monitor your infrastructure!*`;
            
            this.bot.sendMessage(msg.chat.id, welcomeMessage, { parse_mode: 'Markdown' });
        });

        this.bot.onText(/\/status/, async (msg) => {
            if (!this.isUserAuthorized(msg.from)) {
                console.log(`Unauthorized /status attempt by user ${msg.from.id}`);
                return this.bot.sendMessage(msg.chat.id, 'Access denied.');
            }
            
            try {
                console.log(`/status command from: ${msg.from.first_name} (@${msg.from.username || msg.from.id})`);
                const count = await this.db.getUnacknowledgedCount();
                
                let message;
                if (count === 0) {
                    message = '*Status:* All alerts acknowledged - system healthy';
                } else {
                    message = `*Status:* ${count} unacknowledged alert${count > 1 ? 's' : ''} requiring attention`;
                }
                
                this.bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
            } catch (error) {
                console.error('Error getting status:', error);
                this.bot.sendMessage(msg.chat.id, 'Error retrieving system status');
            }
        });

        this.bot.onText(/\/report/, async (msg) => {
            if (!this.isUserAuthorized(msg.from)) {
                console.log(`Unauthorized /report attempt by user ${msg.from.id}`);
                return this.bot.sendMessage(msg.chat.id, 'Access denied.');
            }
            
            try {
                console.log(`/report command from: ${msg.from.first_name} (@${msg.from.username || msg.from.id})`);
                
                const [stats, topAcknowledgers, topResolvers] = await Promise.all([
                    this.db.getWeeklyReport(),
                    this.db.getTopAcknowledgers(),
                    this.db.getTopResolvers()
                ]);
                
                const report = formatWeeklyReport(stats, topAcknowledgers, topResolvers);
                this.bot.sendMessage(msg.chat.id, report, { parse_mode: 'Markdown' });
            } catch (error) {
                console.error('Error generating report:', error);
                this.bot.sendMessage(msg.chat.id, 'Error generating weekly report');
            }
        });

        this.bot.onText(/\/help/, (msg) => {
            if (!this.isUserAuthorized(msg.from)) {
                console.log(`Unauthorized /help attempt by user ${msg.from.id}`);
                return this.bot.sendMessage(msg.chat.id, 'Access denied.');
            }
            
            console.log(`/help command from: ${msg.from.first_name} (@${msg.from.username || msg.from.id})`);
            
            const helpMessage = `*Paniten Bot Help Guide*

*Available Commands:*
/start - Welcome message and system overview
/status - Current unacknowledged alerts count
/report - Weekly statistics and top contributors
/help - This help guide

*Alert Workflow:*
1. External monitoring systems send webhooks
2. Bot creates alert and notifies this group
3. Team members click "Acknowledge" button
4. After acknowledgment, click "Resolve" when fixed
5. System tracks all actions with timestamps

*Supported Webhook Formats:*
• Grafana alerts
• Prometheus Alertmanager
• Zabbix notifications  
• Generic webhooks with message field
• Native Paniten format

*Group Management:*
• Add bot to monitoring groups
• Configure CHAT_ID in environment
• Set AUTHORIZED_USERS for command access
• Bot needs message sending permissions

*Webhook Configuration:*
POST /api/alert with Bearer token authentication
Multiple formats supported with auto-detection

For technical setup assistance, consult the documentation.`;
            
            this.bot.sendMessage(msg.chat.id, helpMessage, { parse_mode: 'Markdown' });
        });
    }

    setupCallbackHandlers() {
        this.bot.on('callback_query', async (query) => {
            const callbackResult = extractAlertIdFromCallback(query.data);
            
            if (!callbackResult) {
                return this.bot.answerCallbackQuery(query.id, {
                    text: 'Invalid callback data',
                    show_alert: true
                });
            }

            const { id: alertId, action } = callbackResult;

            try {
                const alert = await this.db.getAlertById(alertId);
                if (!alert) {
                    return this.bot.answerCallbackQuery(query.id, {
                        text: 'Alert not found in database',
                        show_alert: true
                    });
                }

                if (action === 'acknowledge') {
                    await this.handleAcknowledge(query, alert, alertId);
                } else if (action === 'resolve') {
                    await this.handleResolve(query, alert, alertId);
                }

            } catch (error) {
                console.error('Error handling callback query:', error);
                this.bot.answerCallbackQuery(query.id, {
                    text: 'Error processing request',
                    show_alert: true
                });
            }
        });
    }

    setupErrorHandlers() {
        this.bot.on('polling_error', (error) => {
            console.error('Telegram polling error:', error.code);
            if (error.response && config.LOG_LEVEL === 'debug') {
                console.error('Response details:', error.response.body);
            }
        });

        this.bot.on('webhook_error', (error) => {
            console.error('Telegram webhook error:', error);
        });
    }

    async handleAcknowledge(query, alert, alertId) {
        if (alert.acknowledged) {
            const acknowledgedBy = alert.acknowledged_by_name || alert.acknowledged_by || 'Unknown user';
            return this.bot.answerCallbackQuery(query.id, {
                text: `Already acknowledged by ${acknowledgedBy}`,
                show_alert: false
            });
        }

        const userInfo = this.extractUserInfo(query.from);
        const displayName = this.getUserDisplayName(userInfo);
        console.log(`Acknowledging alert ${alertId} by ${displayName}`);

        const success = await this.db.acknowledgeAlert(alertId, userInfo);
        
        if (success) {
            const completeUserInfo = {
                ...userInfo,
                acknowledged_by: userInfo.username,
                acknowledged_by_id: userInfo.id,
                acknowledged_by_name: this.getFullName(userInfo)
            };
            
            const updatedMessage = formatAcknowledgedMessage(alert, completeUserInfo);
            const resolveKeyboard = createResolveKeyboard(alertId);
            
            await this.bot.editMessageText(updatedMessage, {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: resolveKeyboard
            });

            this.bot.answerCallbackQuery(query.id, {
                text: 'Alert acknowledged successfully',
                show_alert: false
            });

            console.log(`Alert ${alertId} acknowledged by ${displayName}`);
        } else {
            this.bot.answerCallbackQuery(query.id, {
                text: 'Failed to acknowledge alert',
                show_alert: true
            });
        }
    }

    async handleResolve(query, alert, alertId) {
        if (!alert.acknowledged) {
            return this.bot.answerCallbackQuery(query.id, {
                text: 'Alert must be acknowledged before resolving',
                show_alert: true
            });
        }

        if (alert.resolved) {
            const resolvedBy = alert.resolved_by_name || alert.resolved_by || 'Unknown user';
            return this.bot.answerCallbackQuery(query.id, {
                text: `Already resolved by ${resolvedBy}`,
                show_alert: false
            });
        }

        const userInfo = this.extractUserInfo(query.from);
        const displayName = this.getUserDisplayName(userInfo);
        console.log(`Resolving alert ${alertId} by ${displayName}`);

        const success = await this.db.resolveAlert(alertId, userInfo);
        
        if (success) {
            const ackUserInfo = {
                acknowledged_by: alert.acknowledged_by,
                acknowledged_by_name: alert.acknowledged_by_name,
                acknowledged_at: alert.acknowledged_at
            };
            
            const resolvedMessage = formatResolvedMessage(alert, ackUserInfo, userInfo);
            
            await this.bot.editMessageText(resolvedMessage, {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id,
                parse_mode: 'Markdown'
            });

            this.bot.answerCallbackQuery(query.id, {
                text: 'Alert resolved successfully',
                show_alert: false
            });

            console.log(`Alert ${alertId} resolved by ${displayName}`);
        } else {
            this.bot.answerCallbackQuery(query.id, {
                text: 'Failed to resolve alert',
                show_alert: true
            });
        }
    }

    extractUserInfo(from) {
        return {
            username: from.username,
            id: from.id,
            firstName: from.first_name,
            lastName: from.last_name
        };
    }

    getUserDisplayName(userInfo) {
        if (userInfo.firstName || userInfo.lastName) {
            return this.getFullName(userInfo);
        }
        
        if (userInfo.username) {
            return `@${userInfo.username}`;
        }
        
        return `User ${userInfo.id}`;
    }

    getFullName(userInfo) {
        const parts = [userInfo.firstName, userInfo.lastName].filter(Boolean);
        return parts.length > 0 ? parts.join(' ') : null;
    }

    async sendAlert(alert) {
        if (!this.chatId) {
            console.warn('CHAT_ID not configured - alert not sent to Telegram');
            return null;
        }

        try {
            console.log(`Sending alert ${alert.id} to chat ${this.chatId}`);
            
            const message = formatAlertMessage(alert);
            const keyboard = createAcknowledgeKeyboard(alert.id);

            const sentMessage = await this.bot.sendMessage(
                this.chatId,
                message,
                {
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                }
            );

            await this.db.updateTelegramInfo(alert.id, sentMessage.message_id, this.chatId);

            console.log(`Alert ${alert.id} sent successfully (message ${sentMessage.message_id})`);
            return sentMessage;
            
        } catch (error) {
            console.error(`Failed to send alert ${alert.id} to Telegram:`, error.message);
            this.handleSendError(error);
            throw error;
        }
    }

    handleSendError(error) {
        if (error.message.includes('chat not found')) {
            console.error('Chat configuration issues detected:');
            console.error('1. Verify bot is added to the target group/channel');
            console.error('2. Check CHAT_ID format and value');
            console.error('3. Ensure bot has message sending permissions');
            console.error(`Current CHAT_ID: ${this.chatId}`);
            console.error('To get correct CHAT_ID: add bot to group and send /start');
        } else if (error.message.includes('bot was blocked')) {
            console.error('Bot was blocked by user or removed from group');
        } else if (error.message.includes('timeout')) {
            console.error('Telegram API timeout - check network connectivity');
        }
    }

    async getBotInfo() {
        try {
            const me = await this.bot.getMe();
            return {
                id: me.id,
                username: me.username,
                first_name: me.first_name,
                can_join_groups: me.can_join_groups,
                can_read_all_group_messages: me.can_read_all_group_messages
            };
        } catch (error) {
            console.error('Error getting bot info:', error);
            return null;
        }
    }

    close() {
        if (this.bot) {
            try {
                this.bot.stopPolling();
                console.log('Telegram bot polling stopped');
            } catch (error) {
                console.error('Error stopping bot polling:', error);
            }
        }
        
        if (this.db) {
            this.db.close();
        }
    }
}

module.exports = PanitenBot;