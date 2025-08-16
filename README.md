# Panitén Bot

Production-ready alert management system with Telegram bot interface for infrastructure monitoring and team collaboration.

## Overview

Paniten Bot is a Node.js-based alert management system that bridges monitoring infrastructure with team communication. It receives alerts from multiple monitoring systems via webhook and delivers them to Telegram with advanced acknowledgment and resolution tracking.

## Features

- **Multi-format Webhook Support**: Auto-detects and transforms alerts from Grafana, Prometheus, Zabbix, and generic monitoring systems
- **Three-stage Alert Lifecycle**: New → Acknowledged → Resolved with full audit trail
- **Team Collaboration**: Multi-user acknowledgment and resolution with user attribution
- **Real-time Notifications**: Instant Telegram delivery with interactive buttons
- **Weekly Reporting**: Comprehensive statistics with team performance metrics
- **Production Security**: Bearer token authentication, input validation, request timeouts
- **SQLite Database**: Lightweight, file-based persistence with optimized indexes

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Monitoring    │───▶│   Paniten Bot    │───▶│ Telegram Group  │
│     Systems     │    │                  │    │   /Channel      │
│                 │    │ ┌──────────────┐ │    │                 │
│ • Grafana       │    │ │   Express    │ │    │ • Notifications │
│ • Prometheus    │    │ │   Webhook    │ │    │ • Acknowledge   │
│ • Zabbix        │    │ │   Server     │ │    │ • Resolve       │
│ • Custom        │    │ └──────────────┘ │    │ • Reports       │
│                 │    │ ┌──────────────┐ │    │                 │
│                 │    │ │   SQLite     │ │    │                 │
│                 │    │ │   Database   │ │    │                 │
│                 │    │ └──────────────┘ │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## Quick Start

### Prerequisites

1. **Create Telegram Bot**
   - Message [@BotFather](https://t.me/BotFather) on Telegram
   - Create new bot with `/newbot`
   - Save the bot token

2. **Setup Telegram Chat**
   - Create group/channel or use existing
   - Add bot as admin with "Post Messages" permission
   - Get Chat ID from [@userinfobot](https://t.me/userinfobot) or API

3. **Get User ID**
   - Message [@userinfobot](https://t.me/userinfobot) to get your user ID
   - Add to AUTHORIZED_USERS for command access

### Installation

```bash
git clone https://github.com/your-username/paniten-bot.git
cd paniten-bot
npm install
```

### Configuration

Create `.env` file:

```bash
# Required Configuration
BOT_TOKEN=your_bot_token_here
CHAT_ID=your_chat_id_here
AUTHORIZED_USERS=user_id1,user_id2
WEBHOOK_SECRET=your_webhook_secret_here

# Optional Configuration
PORT=3000
HOST=0.0.0.0
NODE_ENV=production
DATABASE_PATH=./data/alerts.db
LOG_LEVEL=info
TELEGRAM_TIMEOUT=60000
WEBHOOK_TIMEOUT=30000
```

### Run

```bash
# Development
npm start

# Production with Docker
docker-compose up -d

# Production with Kubernetes
helm install paniten-bot ./charts
```

## Project Structure

```
paniten-bot/
├── src/
│   ├── app.js              # Express server & webhook handling
│   ├── bot.js              # Telegram bot logic & commands
│   ├── database.js         # SQLite operations & schema
│   ├── env.js              # Environment configuration
│   └── utils.js            # Message formatting & validation
├── charts/                 # Helm chart for Kubernetes
├── data/                   # SQLite database storage
├── docker-compose.yaml     # Docker deployment
├── Dockerfile             # Container image
├── package.json           # Node.js dependencies
└── README.md              # Documentation
```

## API Endpoints

### POST /api/alert

Receives alerts from monitoring systems with automatic format detection.

**Authentication**: Bearer token required

**Request Headers**:
```bash
Content-Type: application/json
Authorization: Bearer your_webhook_secret
```

**Supported Formats**:

**Paniten Native Format**:
```json
{
  "title": "Database Connection Lost",
  "source": "payment-service",
  "severity": "critical",
  "message": "PostgreSQL connection timeout after 30s",
  "timestamp": 1692181595000
}
```

**Grafana Webhook** (auto-detected):
```json
{
  "receiver": "paniten-bot",
  "status": "firing",
  "alerts": [{
    "status": "firing",
    "labels": {
      "alertname": "HighCPUUsage",
      "instance": "web-server-01",
      "severity": "critical"
    },
    "annotations": {
      "summary": "High CPU usage detected",
      "description": "CPU usage is 95% for 5 minutes"
    },
    "startsAt": "2025-08-16T13:26:35.393Z"
  }]
}
```

**Response**:
```json
{
  "success": true,
  "alert": {
    "id": 42,
    "title": "Database Connection Lost",
    "source": "payment-service",
    "severity": "critical",
    "timestamp": 1692181595000
  },
  "telegram_sent": true
}
```

### GET /api/health

Returns system status and metrics.

**No authentication required**

**Response**:
```json
{
  "status": "ok",
  "timestamp": "2025-08-16T13:26:35.393Z",
  "uptime": "2d 5h 30m",
  "alerts": {
    "unacknowledged": 3
  },
  "bot": {
    "connected": true,
    "username": "your_bot_username"
  },
  "config": {
    "chat_id_configured": true,
    "webhook_auth_enabled": true,
    "authorized_users_count": 2
  }
}
```

### GET /api/alerts

Returns alert statistics (authenticated).

**Authentication**: Bearer token required

**Response**:
```json
{
  "success": true,
  "stats": {
    "total": 145,
    "acknowledged": 120,
    "resolved": 95,
    "unacknowledged": 25,
    "critical": 15,
    "warning": 85,
    "info": 45
  }
}
```

## Bot Commands

All commands require user authorization via AUTHORIZED_USERS configuration.

| Command | Description | Response |
|---------|-------------|----------|
| `/start` | Welcome message and system overview | Bot introduction |
| `/status` | Current unacknowledged alerts count | Alert summary |
| `/report` | Weekly statistics with top contributors | Detailed metrics |
| `/help` | Command usage and setup instructions | Help guide |

## Alert Workflow

### 1. New Alert
```
[CRITICAL] Database Connection Lost
Source: payment-service
Time: 16/08/25, 15:30

PostgreSQL connection timeout after 30s

[Acknowledge] ← Team member clicks
```

### 2. Acknowledged Alert
```
[CRITICAL] Database Connection Lost
Source: payment-service
Time: 16/08/25, 15:30

PostgreSQL connection timeout after 30s

Acknowledged by John Doe at 15:32

[Resolve] ← Issue owner clicks
```

### 3. Resolved Alert
```
[CRITICAL] Database Connection Lost
Source: payment-service
Time: 16/08/25, 15:30

PostgreSQL connection timeout after 30s

Acknowledged by John Doe at 15:32
Resolved by Jane Smith at 15:45

(Complete audit trail)
```

## Deployment

### Docker

```bash
# Build and run
docker-compose up -d

# View logs
docker-compose logs -f paniten-bot

# Update
docker-compose pull && docker-compose up -d
```

### Kubernetes with Helm

```bash
# Install

helm install paniten-bot ./charts \
  --set telegram.botToken="your_bot_token" \
  --set telegram.chatId="your_chat_id" \
  --set telegram.authorizedUsers="user_id1,user_id2" \
  --set webhook.secret="your_webhook_secret" \
  --set persistence.storageClass="local-path" 

# Upgrade
helm upgrade paniten-bot ./charts

# Uninstall
helm uninstall paniten-bot
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BOT_TOKEN` | Yes | - | Telegram bot token from BotFather |
| `CHAT_ID` | Yes | - | Target chat/channel ID for alerts |
| `AUTHORIZED_USERS` | Yes | - | Comma-separated user IDs for commands |
| `WEBHOOK_SECRET` | Yes | - | Bearer token for webhook authentication |
| `PORT` | No | `3000` | Server port |
| `HOST` | No | `0.0.0.0` | Server host |
| `NODE_ENV` | No | `development` | Environment mode |
| `DATABASE_PATH` | No | `./data/alerts.db` | SQLite database file path |
| `LOG_LEVEL` | No | `info` | Logging level (debug, info, warn, error) |
| `TELEGRAM_TIMEOUT` | No | `60000` | Telegram API timeout in milliseconds |
| `WEBHOOK_TIMEOUT` | No | `30000` | Webhook request timeout in milliseconds |

## Database Schema

```sql
CREATE TABLE alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    source TEXT NOT NULL,
    severity TEXT NOT NULL CHECK(severity IN ('critical', 'warning', 'info')),
    message TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    
    metadata TEXT,
    
    telegram_message_id INTEGER,
    chat_id INTEGER,
    
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_by TEXT,
    acknowledged_by_id INTEGER,
    acknowledged_by_name TEXT,
    acknowledged_at INTEGER,
    
    resolved BOOLEAN DEFAULT FALSE,
    resolved_by TEXT,
    resolved_by_id INTEGER,
    resolved_by_name TEXT,
    resolved_at INTEGER
);
```

## Monitoring System Integration

### Grafana

1. **Create Contact Point**:
   - Go to Alerting → Contact points
   - Add webhook contact point
   - URL: `http://your-server:3000/api/alert`
   - HTTP Method: `POST`
   - Authorization header: `Bearer your_webhook_secret`

2. **Create Notification Policy**:
   - Route alerts to your contact point
   - Test with sample alert

### Prometheus Alertmanager

```yaml
# alertmanager.yml
receivers:
- name: 'paniten-bot'
  webhook_configs:
  - url: 'http://your-server:3000/api/alert'
    http_config:
      authorization:
        credentials: 'your_webhook_secret'
    send_resolved: true

route:
  group_by: ['alertname']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 1h
  receiver: 'paniten-bot'
```

### Zabbix

1. **Create Media Type**:
   - Administration → Media types → Create
   - Type: Webhook
   - Parameters: URL, Token
   - Script: Transform Zabbix format to Paniten format

2. **Assign to Users**:
   - Add media type to users
   - Configure trigger actions

## Troubleshooting

### Common Issues

**Chat not found error**:
- Verify bot is added to target chat as admin
- Check CHAT_ID format (negative for groups/channels)
- Ensure bot has message sending permissions

**Authentication failures**:
- Check Authorization header format: `Bearer your_token`
- Verify WEBHOOK_SECRET matches in monitoring system
- Ensure Content-Type: application/json header

**User authorization issues**:
- Get user ID from [@userinfobot](https://t.me/userinfobot)
- Add to AUTHORIZED_USERS in environment
- Restart bot after configuration change

### Testing

```bash
# Test webhook endpoint
curl -X POST http://localhost:3000/api/alert \
  -H "Authorization: Bearer your_token" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","source":"manual","severity":"info","message":"Test message"}'

# Test health endpoint
curl http://localhost:3000/api/health

# Test bot connectivity
curl "https://api.telegram.org/bot<BOT_TOKEN>/getMe"
```

### Debug Logging

```bash
# Enable verbose logging
LOG_LEVEL=debug npm start

# Or with environment variable
DEBUG=true LOG_LEVEL=debug npm start
```

## Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/new-feature`
3. Commit changes: `git commit -am 'Add new feature'`
4. Push branch: `git push origin feature/new-feature`
5. Create Pull Request

## License

MIT License - see LICENSE file for details.

## Support

- **Issues**: [GitHub Issues](https://github.com/your-username/paniten-bot/issues)
- **Documentation**: Check troubleshooting section first
- **Discussions**: [GitHub Discussions](https://github.com/your-username/paniten-bot/discussions)