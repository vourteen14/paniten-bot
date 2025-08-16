const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const config = require('./env');
const Database = require('./database');
const PanitenBot = require('./bot');
const { validateAlertPayload, formatUptime, formatAlertMessage } = require('./utils');

const app = express();

let db = null;
let bot = null;

async function initializeApp() {
    try {
        console.log('Initializing database...');
        db = new Database();
        await db.waitForInit();
        console.log('Database ready');

        if (config.BOT_TOKEN) {
            try {
                console.log('Initializing Telegram bot...');
                bot = new PanitenBot();
                console.log('Telegram bot initialized successfully');
            } catch (error) {
                console.error('Failed to initialize Telegram bot:', error.message);
                if (config.NODE_ENV === 'production') {
                    process.exit(1);
                }
            }
        } else {
            console.warn('BOT_TOKEN not configured - running in webhook-only mode');
        }

        startServer();
        
    } catch (error) {
        console.error('Failed to initialize application:', error);
        if (config.NODE_ENV === 'production') {
            process.exit(1);
        }
    }
}

function requestLogger(req, res, next) {
    const start = Date.now();
    const timestamp = new Date().toISOString();
    
    if (config.LOG_LEVEL === 'debug') {
        console.log(`[${timestamp}] ${req.method} ${req.originalUrl} - ${req.ip}`);
    }
    
    res.on('finish', () => {
        const duration = Date.now() - start;
        const status = res.statusCode;
        const logLevel = status >= 400 ? 'error' : 'info';
        
        if (config.LOG_LEVEL === 'debug' || logLevel === 'error') {
            console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - ${status} (${duration}ms)`);
        }
    });
    
    next();
}

function authenticateToken(req, res, next) {
    if (!config.WEBHOOK_SECRET) {
        console.warn('No WEBHOOK_SECRET configured - allowing unauthenticated access');
        return next();
    }
    
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        console.log(`Authentication failed: No token provided - ${req.ip}`);
        return res.status(401).json({ 
            error: 'Access token required',
            hint: 'Include "Authorization: Bearer <token>" header'
        });
    }
    
    if (token !== config.WEBHOOK_SECRET) {
        console.log(`Authentication failed: Invalid token - ${req.ip}`);
        return res.status(403).json({ error: 'Invalid access token' });
    }
    
    next();
}

function detectAndTransformWebhook(payload) {
    if (payload.title && payload.source && payload.severity && payload.message) {
        const validation = validateAlertPayload(payload);
        if (validation.valid) {
            console.log('Detected native Paniten format - no transformation needed');
            return null;
        }
    }
    
    if (payload.alerts && Array.isArray(payload.alerts) && payload.receiver) {
        console.log('Detected Grafana webhook format');
        return transformGrafanaWebhook(payload);
    }
    
    if (payload.alerts && Array.isArray(payload.alerts) && payload.groupKey) {
        console.log('Detected Prometheus Alertmanager webhook format');
        return transformPrometheusWebhook(payload);
    }
    
    if (payload.trigger && (payload.event || payload.problem)) {
        console.log('Detected Zabbix webhook format');
        return transformZabbixWebhook(payload);
    }
    
    if (payload.message && (payload.status || payload.level || payload.priority)) {
        console.log('Detected generic webhook format');
        return transformGenericWebhook(payload);
    }
    
    return null;
}

function transformGrafanaWebhook(payload) {
    const firstAlert = payload.alerts[0];
    
    const metadata = {
        status: payload.status || 'firing',
        labels: firstAlert.labels || {},
        annotations: firstAlert.annotations || {},
        values: firstAlert.values || {},
        urls: {}
    };
    
    if (payload.externalURL) {
        metadata.urls.source = payload.externalURL;
    }
    
    if (firstAlert.labels && payload.externalURL) {
        const matchers = Object.entries(firstAlert.labels)
            .map(([key, value]) => `matcher=${encodeURIComponent(key)}%3D${encodeURIComponent(value)}`)
            .join('&');
        metadata.urls.silence = `${payload.externalURL}/alerting/silence/new?alertmanager=grafana&${matchers}`;
    }
    
    return {
        title: firstAlert.annotations?.summary || 
               payload.commonAnnotations?.summary || 
               firstAlert.labels?.alertname || 
               'Grafana Alert',
        source: firstAlert.labels?.instance || 
               firstAlert.labels?.job || 
               payload.receiver || 
               'Grafana',
        severity: mapSeverity(firstAlert.labels?.severity, payload.status, 'grafana'),
        message: firstAlert.annotations?.description || 
                firstAlert.annotations?.summary ||
                `Alert: ${firstAlert.labels?.alertname}`,
        timestamp: firstAlert.startsAt ? new Date(firstAlert.startsAt).getTime() : Date.now(),
        metadata: metadata
    };
}

function transformPrometheusWebhook(payload) {
    const firstAlert = payload.alerts[0];
    
    const metadata = {
        status: payload.status || firstAlert.status || 'firing',
        labels: firstAlert.labels || {},
        annotations: firstAlert.annotations || {},
        values: firstAlert.values || {},
        urls: {}
    };
    
    if (payload.externalURL) {
        metadata.urls.source = payload.externalURL;
    }
    
    return {
        title: firstAlert.annotations?.summary || firstAlert.labels?.alertname || 'Prometheus Alert',
        source: firstAlert.labels?.instance || firstAlert.labels?.job || 'Prometheus',
        severity: mapSeverity(firstAlert.labels?.severity, payload.status, 'prometheus'),
        message: firstAlert.annotations?.description || firstAlert.annotations?.summary || 'Prometheus alert triggered',
        timestamp: firstAlert.startsAt ? new Date(firstAlert.startsAt).getTime() : Date.now(),
        metadata: metadata
    };
}

function transformZabbixWebhook(payload) {
    const metadata = {
        status: payload.event?.value === '1' ? 'Problem' : 'OK',
        labels: {
            trigger: payload.trigger?.name,
            host: payload.host?.name,
            priority: payload.trigger?.priority
        },
        annotations: {
            description: payload.trigger?.description
        },
        values: {},
        urls: {}
    };
    
    if (payload.trigger?.url) {
        metadata.urls.source = payload.trigger.url;
    }
    
    return {
        title: payload.trigger.name || payload.event?.name || 'Zabbix Alert',
        source: payload.host?.name || payload.trigger?.host || 'Zabbix',
        severity: mapSeverity(payload.trigger?.priority, payload.event?.value, 'zabbix'),
        message: payload.trigger?.description || payload.event?.description || 'Zabbix trigger activated',
        timestamp: payload.event?.clock ? payload.event.clock * 1000 : Date.now(),
        metadata: metadata
    };
}

function transformGenericWebhook(payload) {
    const metadata = {
        status: payload.status || payload.level || 'active',
        labels: {},
        annotations: {},
        values: {},
        urls: {}
    };
    
    Object.keys(payload).forEach(key => {
        if (!['title', 'source', 'severity', 'message', 'timestamp', 'status', 'level', 'priority'].includes(key)) {
            metadata.labels[key] = payload[key];
        }
    });
    
    return {
        title: payload.title || payload.subject || payload.alert || 'Generic Alert',
        source: payload.source || payload.service || payload.host || 'Webhook',
        severity: mapSeverity(payload.severity || payload.level || payload.priority, payload.status, 'generic'),
        message: payload.message || payload.description || 'Alert received',
        timestamp: payload.timestamp ? new Date(payload.timestamp).getTime() : Date.now(),
        metadata: metadata
    };
}

function mapSeverity(severity, status, source) {
    if (!severity && !status) return 'info';
    
    const severityStr = (severity || status || '').toString().toLowerCase();
    
    if (['critical', 'warning', 'info'].includes(severityStr)) {
        return severityStr;
    }
    
    switch (source) {
        case 'grafana':
        case 'prometheus':
            switch (severityStr) {
                case 'firing': return 'warning';
                case 'resolved': return 'info';
                case 'pending': return 'info';
                default: return 'warning';
            }
            
        case 'zabbix':
            switch (severityStr) {
                case '5': case 'disaster': return 'critical';
                case '4': case 'high': return 'critical';
                case '3': case 'average': return 'warning';
                case '2': case 'warning': return 'warning';
                case '1': case 'information': return 'info';
                case '0': case 'not_classified': return 'info';
                default: return 'warning';
            }
    }
    
    switch (severityStr) {
        case 'error': case 'fatal': case 'emergency': case 'alert': case 'high': case 'urgent':
            return 'critical';
        case 'warn': case 'warning': case 'medium': case 'moderate':
            return 'warning';
        case 'info': case 'information': case 'notice': case 'low': case 'debug': case 'trace':
            return 'info';
        default:
            return 'info';
    }
}

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(requestLogger);

app.use((req, res, next) => {
    req.setTimeout(config.WEBHOOK_TIMEOUT, () => {
        console.log(`Request timeout after ${config.WEBHOOK_TIMEOUT}ms: ${req.method} ${req.originalUrl}`);
        if (!res.headersSent) {
            res.status(408).json({
                error: 'Request timeout',
                message: `Request exceeded ${config.WEBHOOK_TIMEOUT}ms timeout`
            });
        }
    });
    next();
});

app.get('/api/health', async (req, res) => {
    try {
        const [unackCount, botInfo] = await Promise.all([
            db.getUnacknowledgedCount(),
            bot ? bot.getBotInfo() : Promise.resolve(null)
        ]);
        
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: formatUptime(process.uptime()),
            alerts: {
                unacknowledged: unackCount
            },
            bot: botInfo ? {
                connected: true,
                username: botInfo.username
            } : {
                connected: false,
                reason: config.BOT_TOKEN ? 'Bot initialization failed' : 'BOT_TOKEN not configured'
            },
            config: {
                chat_id_configured: !!config.CHAT_ID,
                webhook_auth_enabled: !!config.WEBHOOK_SECRET,
                authorized_users_count: config.AUTHORIZED_USERS.length
            }
        });
    } catch (error) {
        console.error('Health check error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Health check failed'
        });
    }
});

app.post('/api/alert', authenticateToken, async (req, res) => {
    try {
        let alertData;
        
        const transformed = detectAndTransformWebhook(req.body);
        
        if (transformed) {
            console.log(`Transformed webhook: ${transformed.title} (${transformed.severity}) from ${transformed.source}`);
            alertData = transformed;
        } else {
            const validation = validateAlertPayload(req.body);
            if (!validation.valid) {
                console.log(`Validation failed: ${validation.error}`);
                return res.status(400).json({
                    error: 'Invalid payload',
                    details: validation.error,
                    supported_formats: [
                        'Paniten format: {title, source, severity, message}',
                        'Grafana webhook format (auto-detected)',
                        'Prometheus Alertmanager format (auto-detected)',
                        'Zabbix webhook format (auto-detected)',
                        'Generic webhook format (auto-detected)'
                    ],
                    example: {
                        title: 'Database Connection Lost',
                        source: 'payment-service',
                        severity: 'critical',
                        message: 'PostgreSQL connection timeout after 30s'
                    }
                });
            }
            
            console.log(`Using original Paniten format: ${req.body.title} (${req.body.severity}) from ${req.body.source}`);
            alertData = {
                title: req.body.title.trim(),
                source: req.body.source.trim(),
                severity: req.body.severity.toLowerCase(),
                message: req.body.message.trim(),
                timestamp: req.body.timestamp || Date.now()
            };
        }

        const alert = await db.createAlert(alertData);
        alert.original_message = formatAlertMessage(alertData);
        
        console.log(`Alert created: ID=${alert.id}, ${alert.severity}/${alert.source}/${alert.title}`);
        
        if (bot && config.CHAT_ID) {
            bot.sendAlert(alert).catch(error => {
                console.error(`Failed to send alert ${alert.id} to Telegram:`, error.message);
            });
        } else {
            if (!bot) {
                console.warn(`Alert ${alert.id} not sent: Telegram bot not initialized`);
            } else if (!config.CHAT_ID) {
                console.warn(`Alert ${alert.id} not sent: CHAT_ID not configured`);
            }
        }

        res.status(201).json({
            success: true,
            alert: {
                id: alert.id,
                title: alert.title,
                source: alert.source,
                severity: alert.severity,
                timestamp: alert.timestamp
            },
            telegram_sent: !!(bot && config.CHAT_ID)
        });

    } catch (error) {
        console.error('Error processing alert webhook:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to process alert'
        });
    }
});

app.get('/api/alert', (req, res) => {
    res.json({
        message: 'Alert webhook endpoint',
        method: 'POST',
        authentication: config.WEBHOOK_SECRET ? 'Bearer token required' : 'No authentication (WEBHOOK_SECRET not set)',
        supported_formats: {
            paniten: {
                title: 'Alert title',
                source: 'system-name', 
                severity: 'critical|warning|info',
                message: 'Alert description',
                timestamp: 'optional unix timestamp'
            },
            grafana: 'Auto-detected Grafana webhook format',
            prometheus: 'Auto-detected Prometheus Alertmanager format',
            zabbix: 'Auto-detected Zabbix webhook format',
            generic: 'Auto-detected generic webhook with message field'
        },
        endpoints: {
            'POST /api/alert': 'Submit alert (multiple formats supported)',
            'GET /api/alerts': 'Get alert statistics (auth required if configured)',
            'GET /api/health': 'Health check and system status'
        },
        example_curl: `curl -X POST ${req.protocol}://${req.get('host')}/api/alert ${config.WEBHOOK_SECRET ? '-H "Authorization: Bearer YOUR_TOKEN"' : ''} -H "Content-Type: application/json" -d '{"title":"Test","source":"manual","severity":"info","message":"Test message"}'`
    });
});

app.get('/api/alerts', authenticateToken, async (req, res) => {
    try {
        const stats = await db.getWeeklyReport();
        res.json({
            success: true,
            stats
        });
    } catch (error) {
        console.error('Error fetching alerts:', error);
        res.status(500).json({
            error: 'Failed to fetch alerts'
        });
    }
});

app.use('*', (req, res) => {
    if (config.LOG_LEVEL === 'debug') {
        console.log(`404 - ${req.method} ${req.originalUrl} from ${req.ip}`);
    }
    res.status(404).json({
        error: 'Not found',
        message: 'Endpoint not found',
        available_endpoints: ['/api/health', '/api/alert', '/api/alerts']
    });
});

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: config.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

function gracefulShutdown(signal) {
    console.log(`${signal} received. Shutting down gracefully...`);
    
    const shutdownPromises = [];
    
    if (bot) {
        shutdownPromises.push(bot.close());
    }
    
    if (db) {
        shutdownPromises.push(db.close());
    }
    
    Promise.all(shutdownPromises)
        .then(() => {
            console.log('Shutdown complete');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Error during shutdown:', error);
            process.exit(1);
        });
}

function startServer() {
    const server = app.listen(config.PORT, config.HOST, () => {
        console.log(`\nPaniten Bot -`, Buffer.from("dm91cnRlZW4xNA==", "base64").toString("utf-8"));
        console.log(`Server running on http://${config.HOST}:${config.PORT}`);
        console.log(`Environment: ${config.NODE_ENV}`);
        console.log(`Health check: http://${config.HOST}:${config.PORT}/api/health`);
        console.log(`Webhook endpoint: http://${config.HOST}:${config.PORT}/api/alert`);
        console.log(`Node.js version: ${process.version}`);
        
        console.log('\nSystem Status:');
        console.log(`- Database: Connected (${config.DATABASE_PATH})`);
        console.log(`- Telegram Bot: ${bot ? 'Connected' : 'Disabled'}`);
        console.log(`- Chat ID: ${config.CHAT_ID ? 'Configured' : 'Not set'}`);
        console.log(`- Webhook Auth: ${config.WEBHOOK_SECRET ? 'Enabled' : 'Disabled'}`);
        console.log(`- Authorized Users: ${config.AUTHORIZED_USERS.length} configured`);
        console.log(`- Request Timeout: ${config.WEBHOOK_TIMEOUT}ms`);
        console.log(`- Telegram Timeout: ${config.TELEGRAM_TIMEOUT}ms`);
        
        console.log('\nSupported webhook formats: Grafana, Prometheus, Zabbix, Generic');
    });

    server.timeout = config.WEBHOOK_TIMEOUT;
    server.keepAliveTimeout = config.WEBHOOK_TIMEOUT + 1000;
    server.headersTimeout = config.WEBHOOK_TIMEOUT + 2000;
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

initializeApp();

module.exports = app;