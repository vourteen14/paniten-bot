const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class Database {
    constructor() {
        this.dbPath = process.env.DATABASE_PATH || './data/alerts.db';
        this.db = null;
        this.isInitialized = false;
        
        this.init();
    }

    init() {
        return new Promise((resolve, reject) => {
            try {
                this.ensureDirectoryExists();
                this.handleExistingDatabase();
                this.openDatabase(resolve, reject);
            } catch (error) {
                console.error('Database initialization error:', error);
                reject(error);
            }
        });
    }

    ensureDirectoryExists() {
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    handleExistingDatabase() {
        if (fs.existsSync(this.dbPath)) {
            try {
                fs.accessSync(this.dbPath, fs.constants.R_OK | fs.constants.W_OK);
            } catch (error) {
                console.warn(`Database file access issue, attempting to recreate: ${error.message}`);
                this.backupAndRecreateDatabase();
            }
        }
    }

    backupAndRecreateDatabase() {
        const backupPath = `${this.dbPath}.backup.${Date.now()}`;
        try {
            fs.copyFileSync(this.dbPath, backupPath);
            fs.unlinkSync(this.dbPath);
            console.log(`Database backed up to: ${backupPath}`);
        } catch (backupError) {
            console.warn(`Could not backup database: ${backupError.message}`);
        }
    }

    openDatabase(resolve, reject) {
        this.db = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
            if (err) {
                console.error('Failed to open database:', err.message);
                reject(err);
                return;
            }
            
            console.log(`Database connected: ${this.dbPath}`);
            
            this.configurePragmas()
                .then(() => this.setupDatabase())
                .then(resolve)
                .catch(reject);
        });
    }

    configurePragmas() {
        return new Promise((resolve) => {
            this.db.run("PRAGMA busy_timeout = 10000", (err) => {
                if (err) {
                    console.warn('Could not set busy timeout:', err.message);
                }
                
                this.db.run("PRAGMA journal_mode = WAL", (err) => {
                    if (err) {
                        console.warn('Could not enable WAL mode:', err.message);
                    }
                    resolve();
                });
            });
        });
    }

    setupDatabase() {
        return new Promise((resolve, reject) => {
            this.db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='alerts'", (err, row) => {
                if (err) {
                    console.error('Error checking table existence:', err);
                    reject(err);
                    return;
                }

                if (row) {
                    this.checkAndAddMetadataColumn()
                        .then(() => this.createIndexes())
                        .then(resolve)
                        .catch(reject);
                } else {
                    this.createTable()
                        .then(() => this.createIndexes())
                        .then(resolve)
                        .catch(reject);
                }
            });
        });
    }

    checkAndAddMetadataColumn() {
        return new Promise((resolve, reject) => {
            this.db.all("PRAGMA table_info(alerts)", (err, columns) => {
                if (err) {
                    console.error('Error getting table info:', err);
                    reject(err);
                    return;
                }
                
                const hasMetadata = columns.some(col => col.name === 'metadata');
                
                if (!hasMetadata) {
                    console.log('Adding metadata column to existing table...');
                    this.db.run("ALTER TABLE alerts ADD COLUMN metadata TEXT", (err) => {
                        if (err) {
                            console.error('Error adding metadata column:', err);
                            reject(err);
                            return;
                        }
                        console.log('Metadata column added successfully');
                        resolve();
                    });
                } else {
                    console.log('Database table already exists with all required columns');
                    resolve();
                }
            });
        });
    }

    createTable() {
        return new Promise((resolve, reject) => {
            const createTableSQL = `
                CREATE TABLE IF NOT EXISTS alerts (
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
                )
            `;

            this.db.run(createTableSQL, (err) => {
                if (err) {
                    console.error('Error creating table:', err);
                    reject(err);
                    return;
                }
                
                console.log('Database table created successfully');
                resolve();
            });
        });
    }

    createIndexes() {
        return new Promise((resolve, reject) => {
            const indexes = [
                "CREATE INDEX IF NOT EXISTS idx_alerts_acknowledged ON alerts(acknowledged)",
                "CREATE INDEX IF NOT EXISTS idx_alerts_resolved ON alerts(resolved)",
                "CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at)",
                "CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity)"
            ];

            let completed = 0;
            let hasError = false;

            indexes.forEach((indexSQL, i) => {
                this.db.run(indexSQL, (err) => {
                    if (err && !hasError) {
                        console.error(`Error creating index ${i}:`, err);
                        hasError = true;
                        reject(err);
                        return;
                    }
                    
                    completed++;
                    if (completed === indexes.length && !hasError) {
                        console.log('Database indexes created successfully');
                        this.isInitialized = true;
                        resolve();
                    }
                });
            });
        });
    }

    waitForInit() {
        return new Promise((resolve) => {
            if (this.isInitialized) {
                resolve();
                return;
            }
            
            const checkInit = () => {
                if (this.isInitialized) {
                    resolve();
                } else {
                    setTimeout(checkInit, 100);
                }
            };
            
            checkInit();
        });
    }

    async createAlert(alertData) {
        await this.waitForInit();
        
        return new Promise((resolve, reject) => {
            const { title, source, severity, message, timestamp = Date.now(), metadata } = alertData;
            
            const metadataJson = metadata ? JSON.stringify(metadata) : null;
            
            const sql = `
                INSERT INTO alerts (title, source, severity, message, timestamp, metadata)
                VALUES (?, ?, ?, ?, ?, ?)
            `;
            
            this.db.run(sql, [title, source, severity, message, timestamp, metadataJson], function(err) {
                if (err) {
                    console.error('Error creating alert:', err);
                    reject(err);
                } else {
                    resolve({ id: this.lastID, ...alertData });
                }
            });
        });
    }

    async updateTelegramInfo(alertId, telegramMessageId, chatId) {
        await this.waitForInit();
        
        return new Promise((resolve, reject) => {
            const sql = `
                UPDATE alerts 
                SET telegram_message_id = ?, chat_id = ?
                WHERE id = ?
            `;
            
            this.db.run(sql, [telegramMessageId, chatId, alertId], function(err) {
                if (err) {
                    console.error('Error updating Telegram info:', err);
                    reject(err);
                } else {
                    resolve(this.changes);
                }
            });
        });
    }

    async acknowledgeAlert(alertId, userInfo) {
        await this.waitForInit();
        
        return new Promise((resolve, reject) => {
            const { username, id, firstName, lastName } = userInfo;
            const fullName = [firstName, lastName].filter(Boolean).join(' ');
            
            const sql = `
                UPDATE alerts 
                SET acknowledged = TRUE,
                    acknowledged_by = ?,
                    acknowledged_by_id = ?,
                    acknowledged_by_name = ?,
                    acknowledged_at = strftime('%s', 'now')
                WHERE id = ? AND acknowledged = FALSE
            `;
            
            this.db.run(sql, [username, id, fullName, alertId], function(err) {
                if (err) {
                    console.error('Error acknowledging alert:', err);
                    reject(err);
                } else {
                    resolve(this.changes > 0);
                }
            });
        });
    }

    async resolveAlert(alertId, userInfo) {
        await this.waitForInit();
        
        return new Promise((resolve, reject) => {
            const { username, id, firstName, lastName } = userInfo;
            const fullName = [firstName, lastName].filter(Boolean).join(' ');
            
            const sql = `
                UPDATE alerts 
                SET resolved = TRUE,
                    resolved_by = ?,
                    resolved_by_id = ?,
                    resolved_by_name = ?,
                    resolved_at = strftime('%s', 'now')
                WHERE id = ? AND acknowledged = TRUE AND resolved = FALSE
            `;
            
            this.db.run(sql, [username, id, fullName, alertId], function(err) {
                if (err) {
                    console.error('Error resolving alert:', err);
                    reject(err);
                } else {
                    resolve(this.changes > 0);
                }
            });
        });
    }

    async getUnacknowledgedCount() {
        await this.waitForInit();
        
        return new Promise((resolve, reject) => {
            const sql = 'SELECT COUNT(*) as count FROM alerts WHERE acknowledged = FALSE';
            
            this.db.get(sql, (err, row) => {
                if (err) {
                    console.error('Error getting unacknowledged count:', err);
                    reject(err);
                } else {
                    resolve(row.count);
                }
            });
        });
    }

    async getWeeklyReport() {
        await this.waitForInit();
        
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN acknowledged = TRUE THEN 1 ELSE 0 END) as acknowledged,
                    SUM(CASE WHEN resolved = TRUE THEN 1 ELSE 0 END) as resolved,
                    SUM(CASE WHEN acknowledged = FALSE THEN 1 ELSE 0 END) as unacknowledged,
                    SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical,
                    SUM(CASE WHEN severity = 'warning' THEN 1 ELSE 0 END) as warning,
                    SUM(CASE WHEN severity = 'info' THEN 1 ELSE 0 END) as info
                FROM alerts 
                WHERE created_at >= strftime('%s', 'now', '-7 days')
            `;
            
            this.db.get(sql, (err, row) => {
                if (err) {
                    console.error('Error getting weekly report:', err);
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    async getTopAcknowledgers() {
        await this.waitForInit();
        
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT 
                    acknowledged_by_name,
                    acknowledged_by,
                    COUNT(*) as ack_count,
                    SUM(CASE WHEN resolved = TRUE THEN 1 ELSE 0 END) as resolved_count
                FROM alerts 
                WHERE acknowledged = TRUE 
                    AND acknowledged_at >= strftime('%s', 'now', '-7 days')
                    AND acknowledged_by IS NOT NULL
                GROUP BY acknowledged_by_id
                ORDER BY ack_count DESC
                LIMIT 5
            `;
            
            this.db.all(sql, (err, rows) => {
                if (err) {
                    console.error('Error getting top acknowledgers:', err);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async getTopResolvers() {
        await this.waitForInit();
        
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT 
                    resolved_by_name,
                    resolved_by,
                    COUNT(*) as count
                FROM alerts 
                WHERE resolved = TRUE 
                    AND resolved_at >= strftime('%s', 'now', '-7 days')
                    AND resolved_by IS NOT NULL
                GROUP BY resolved_by_id
                ORDER BY count DESC
                LIMIT 5
            `;
            
            this.db.all(sql, (err, rows) => {
                if (err) {
                    console.error('Error getting top resolvers:', err);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async getAlertById(alertId) {
        await this.waitForInit();
        
        return new Promise((resolve, reject) => {
            const sql = 'SELECT * FROM alerts WHERE id = ?';
            
            this.db.get(sql, [alertId], (err, row) => {
                if (err) {
                    console.error('Error getting alert by ID:', err);
                    reject(err);
                } else if (row) {
                    if (row.metadata) {
                        try {
                            row.metadata = JSON.parse(row.metadata);
                        } catch (e) {
                            console.warn(`Failed to parse metadata for alert ${alertId}:`, e.message);
                            row.metadata = null;
                        }
                    }
                    resolve(row);
                } else {
                    resolve(null);
                }
            });
        });
    }

    close() {
        return new Promise((resolve) => {
            if (this.db) {
                this.db.close((err) => {
                    if (err) {
                        console.error('Error closing database:', err.message);
                    } else {
                        console.log('Database connection closed');
                    }
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

module.exports = Database;