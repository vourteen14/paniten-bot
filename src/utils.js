const SEVERITY_EMOJI = {
    critical: 'CRITICAL',
    warning: 'WARNING', 
    info: 'INFO'
};

const SEVERITY_TEXT = {
    critical: 'CRITICAL',
    warning: 'WARNING', 
    info: 'INFO'
};

function formatAlertMessage(alert) {
    const severityText = SEVERITY_TEXT[alert.severity] || 'ALERT';
    const timestamp = formatTimestamp(alert.timestamp);

    if (alert.metadata) {
        return formatVerboseAlert(alert, severityText, timestamp);
    }

    return formatBasicAlert(alert, severityText, timestamp);
}

function formatBasicAlert(alert, severityText, timestamp) {
    return `*${severityText}*
*${alert.title}*
Source: ${alert.source}
Time: ${timestamp}

${alert.message}`;
}

function formatVerboseAlert(alert, severityText, timestamp) {
    let message = `*${severityText}*\n`;
    message += `*${alert.title}*\n`;
    message += `Source: ${alert.source}\n`;
    message += `Time: ${timestamp}\n`;
    
    if (alert.metadata?.status) {
        message += `${alert.metadata.status}\n`;
    }
    
    message += formatMetadataValues(alert.metadata);
    message += formatMetadataLabels(alert.metadata);
    message += formatMetadataAnnotations(alert.metadata);
    message += `\n${alert.message}`;
    message += formatMetadataUrls(alert.metadata);
    
    return message;
}

function formatMetadataValues(metadata) {
    if (!metadata?.values || Object.keys(metadata.values).length === 0) {
        return '';
    }
    
    const values = Object.entries(metadata.values)
        .map(([key, value]) => `${key}=${value}`)
        .join(', ');
    return `Value: ${values}\n`;
}

function formatMetadataLabels(metadata) {
    if (!metadata?.labels || Object.keys(metadata.labels).length === 0) {
        return '';
    }
    
    let result = 'Labels:\n';
    Object.entries(metadata.labels).forEach(([key, value]) => {
        result += ` - ${key} = ${value}\n`;
    });
    return result;
}

function formatMetadataAnnotations(metadata) {
    if (!metadata?.annotations || Object.keys(metadata.annotations).length === 0) {
        return '';
    }
    
    let result = 'Annotations:\n';
    Object.entries(metadata.annotations).forEach(([key, value]) => {
        result += ` - ${key} = ${value}\n`;
    });
    return result;
}

function formatMetadataUrls(metadata) {
    if (!metadata?.urls) {
        return '';
    }
    
    let result = '';
    
    if (metadata.urls.silence) {
        result += `\nSilence: ${metadata.urls.silence}`;
    }
    if (metadata.urls.dashboard) {
        result += `\nDashboard: ${metadata.urls.dashboard}`;
    }
    if (metadata.urls.panel) {
        result += `\nPanel: ${metadata.urls.panel}`;
    }
    if (metadata.urls.source) {
        result += `\nSource: ${metadata.urls.source}`;
    }
    
    return result;
}

function formatTimestamp(timestamp) {
    return new Date(timestamp).toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit',
        month: '2-digit', 
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatAcknowledgedMessage(alert, userInfo) {
    const originalMessage = formatAlertMessage(alert);
    const ackBy = extractUserDisplayName(userInfo, 'acknowledged');
    const ackTime = formatCurrentTime();

    return `${originalMessage}\n\nAcknowledged by *${ackBy}* at ${ackTime}`;
}

function formatResolvedMessage(alert, ackUserInfo, resolveUserInfo) {
    const originalMessage = formatAlertMessage(alert);
    const ackBy = extractAckUserDisplayName(ackUserInfo);
    const resolveBy = extractResolveUserDisplayName(resolveUserInfo);
    const ackTime = formatAckTime(ackUserInfo.acknowledged_at);
    const resolveTime = formatCurrentTime();

    return `${originalMessage}\n\nAcknowledged by *${ackBy}* at ${ackTime}\nResolved by *${resolveBy}* at ${resolveTime}`;
}

function extractUserDisplayName(userInfo, type) {
    const nameField = type === 'acknowledged' ? 'acknowledged_by_name' : 'resolved_by_name';
    const usernameField = type === 'acknowledged' ? 'acknowledged_by' : 'resolved_by';
    const idField = type === 'acknowledged' ? 'acknowledged_by_id' : 'resolved_by_id';
    
    if (userInfo[nameField] && userInfo[nameField].trim()) {
        return userInfo[nameField].trim();
    }
    
    if (userInfo.firstName || userInfo.lastName) {
        const firstName = userInfo.firstName || '';
        const lastName = userInfo.lastName || '';
        return `${firstName} ${lastName}`.trim();
    }
    
    if (userInfo[usernameField] && userInfo[usernameField].trim()) {
        return `@${userInfo[usernameField].trim()}`;
    }
    
    if (userInfo.username && userInfo.username.trim()) {
        return `@${userInfo.username.trim()}`;
    }
    
    return `User ${userInfo.id || userInfo[idField] || ''}`;
}

function extractAckUserDisplayName(ackUserInfo) {
    if (ackUserInfo.acknowledged_by_name && ackUserInfo.acknowledged_by_name.trim()) {
        return ackUserInfo.acknowledged_by_name.trim();
    }
    
    if (ackUserInfo.acknowledged_by && ackUserInfo.acknowledged_by.trim()) {
        return `@${ackUserInfo.acknowledged_by.trim()}`;
    }
    
    return 'Unknown User';
}

function extractResolveUserDisplayName(resolveUserInfo) {
    if (resolveUserInfo.resolved_by_name && resolveUserInfo.resolved_by_name.trim()) {
        return resolveUserInfo.resolved_by_name.trim();
    }
    
    if (resolveUserInfo.firstName || resolveUserInfo.lastName) {
        const firstName = resolveUserInfo.firstName || '';
        const lastName = resolveUserInfo.lastName || '';
        return `${firstName} ${lastName}`.trim();
    }
    
    if (resolveUserInfo.resolved_by && resolveUserInfo.resolved_by.trim()) {
        return `@${resolveUserInfo.resolved_by.trim()}`;
    }
    
    if (resolveUserInfo.username && resolveUserInfo.username.trim()) {
        return `@${resolveUserInfo.username.trim()}`;
    }
    
    return `User ${resolveUserInfo.id || resolveUserInfo.resolved_by_id || ''}`;
}

function formatCurrentTime() {
    return new Date().toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatAckTime(acknowledgedAt) {
    if (!acknowledgedAt) return 'Unknown';
    
    return new Date(acknowledgedAt * 1000).toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatWeeklyReport(stats, topAcknowledgers, topResolvers) {
    let report = `*Weekly Report* (Last 7 days)

*Alert Summary:*
• Total Alerts: ${stats.total}
• Acknowledged: ${stats.acknowledged}
• Resolved: ${stats.resolved}
• Unacknowledged: ${stats.unacknowledged}

*By Severity:*
• Critical: ${stats.critical}
• Warning: ${stats.warning}
• Info: ${stats.info}`;

    if (topAcknowledgers && topAcknowledgers.length > 0) {
        report += '\n\n*Top Contributors:*\n';
        topAcknowledgers.forEach((user, index) => {
            const rank = index + 1;
            const name = user.acknowledged_by_name || user.acknowledged_by || 'Unknown';
            report += `${rank}. ${name}: ${user.ack_count} acked, ${user.resolved_count} resolved\n`;
        });
    }

    if (topResolvers && topResolvers.length > 0) {
        report += '\n*Top Resolvers:*\n';
        topResolvers.forEach((user, index) => {
            const rank = index + 1;
            const name = user.resolved_by_name || user.resolved_by || 'Unknown';
            report += `${rank}. ${name}: ${user.count} resolved\n`;
        });
    }

    return report;
}

function createAcknowledgeKeyboard(alertId) {
    return {
        inline_keyboard: [[
            {
                text: 'Acknowledge',
                callback_data: `ack_${alertId}`
            }
        ]]
    };
}

function createResolveKeyboard(alertId) {
    return {
        inline_keyboard: [[
            {
                text: 'Resolve',
                callback_data: `resolve_${alertId}`
            }
        ]]
    };
}

function calculateMTTR(ackTime, resolveTime) {
    if (!ackTime || !resolveTime) return null;
    
    const ackTimestamp = typeof ackTime === 'number' ? ackTime * 1000 : new Date(ackTime).getTime();
    const resolveTimestamp = typeof resolveTime === 'number' ? resolveTime * 1000 : new Date(resolveTime).getTime();
    
    const diffMs = resolveTimestamp - ackTimestamp;
    const diffMinutes = Math.round(diffMs / (1000 * 60));
    
    if (diffMinutes < 60) {
        return `${diffMinutes}m`;
    } else if (diffMinutes < 1440) {
        const hours = Math.floor(diffMinutes / 60);
        const minutes = diffMinutes % 60;
        return `${hours}h ${minutes}m`;
    } else {
        const days = Math.floor(diffMinutes / 1440);
        const hours = Math.floor((diffMinutes % 1440) / 60);
        return `${days}d ${hours}h`;
    }
}

function validateAlertPayload(payload) {
    const required = ['title', 'source', 'severity', 'message'];
    const validSeverities = ['critical', 'warning', 'info'];
    
    for (const field of required) {
        if (!payload[field] || typeof payload[field] !== 'string') {
            return { valid: false, error: `Missing or invalid field: ${field}` };
        }
    }
    
    if (!validSeverities.includes(payload.severity)) {
        return { valid: false, error: `Invalid severity. Must be one of: ${validSeverities.join(', ')}` };
    }
    
    if (payload.title.length > 200) {
        return { valid: false, error: 'Title too long (max 200 characters)' };
    }
    
    if (payload.message.length > 2000) {
        return { valid: false, error: 'Message too long (max 2000 characters)' };
    }
    
    return { valid: true };
}

function formatUptime(uptimeSeconds) {
    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    
    if (days > 0) {
        return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else {
        return `${minutes}m`;
    }
}

function extractAlertIdFromCallback(callbackData) {
    const ackMatch = callbackData.match(/^ack_(\d+)$/);
    const resolveMatch = callbackData.match(/^resolve_(\d+)$/);
    
    if (ackMatch) return { id: parseInt(ackMatch[1]), action: 'acknowledge' };
    if (resolveMatch) return { id: parseInt(resolveMatch[1]), action: 'resolve' };
    
    return null;
}

module.exports = {
    formatAlertMessage,
    formatAcknowledgedMessage,
    formatResolvedMessage,
    formatWeeklyReport,
    createAcknowledgeKeyboard,
    createResolveKeyboard,
    validateAlertPayload,
    formatUptime,
    extractAlertIdFromCallback,
    calculateMTTR,
    SEVERITY_EMOJI
};