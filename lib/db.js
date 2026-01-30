const mysql = require('mysql2/promise');
const path = require('path');

// 根据 NODE_ENV 加载对应的 .env 文件 (如果存在)
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.dev';
const envPath = path.resolve(process.cwd(), envFile);

// 只有当文件存在时才加载，允许直接使用系统环境变量
require('dotenv').config({ path: envPath });

if (process.env.DB_HOST) {
    console.log(`[Database] Using environment variables (loaded from ${envFile} if existed)`);
} else {
    console.warn('[Database] Warning: No DB_HOST found in environment or .env file');
}

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'notion_sync',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

/**
 * 执行 SQL 查询
 */
async function query(sql, params) {
    try {
        const [results] = await pool.execute(sql, params);
        return results;
    } catch (error) {
        console.error('Database query error:', error);
        throw error;
    }
}

/**
 * 获取用户的特定配置
 */
async function getConfig(userId, key) {
    const results = await query('SELECT config_value FROM user_configs WHERE user_id = ? AND config_key = ?', [userId, key]);
    return results.length > 0 ? results[0].config_value : null;
}

/**
 * 获取用户的所有配置
 */
async function getAllConfigs(userId) {
    const results = await query('SELECT config_key, config_value FROM user_configs WHERE user_id = ?', [userId]);
    const configs = {};
    results.forEach(row => {
        configs[row.config_key] = row.config_value;
    });
    return configs;
}

/**
 * 更新或插入用户的配置
 */
async function updateConfig(userId, key, value) {
    const sql = `INSERT INTO user_configs (user_id, config_key, config_value) 
                 VALUES (?, ?, ?) 
                 ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`;
    return await query(sql, [userId, key, value]);
}

/**
 * 记录 API 调用日志，并限制总条数为 10,000 条
 */
async function logApiCall(userId, url, method, params, statusCode, responseBody, isSuccess, errorMessage) {
    const insertSql = `INSERT INTO api_logs (user_id, url, method, params, status_code, response_body, is_success, error_message) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    await query(insertSql, [
        userId,
        url,
        method,
        JSON.stringify(params),
        statusCode,
        typeof responseBody === 'object' ? JSON.stringify(responseBody) : responseBody,
        isSuccess ? 1 : 0,
        errorMessage
    ]);

    // 清理逻辑：如果超过 10000 条，删除旧数据
    // 使用子查询获取第 10001 条及之后的 ID 并删除
    const cleanupSql = `
        DELETE FROM api_logs 
        WHERE id NOT IN (
            SELECT id FROM (
                SELECT id FROM api_logs 
                ORDER BY created_at DESC 
                LIMIT 10000
            ) AS temp
        )`;
    try {
        await query(cleanupSql);
    } catch (cleanupError) {
        console.error('Failed to cleanup logs:', cleanupError);
    }
}

module.exports = {
    query,
    getConfig,
    getAllConfigs,
    updateConfig,
    logApiCall,
    pool
};
