const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../errorLogs');
const MAX_LOGS = 100;

/**
 * 记录错误日志
 * @param {Object} logData 包含请求参数、响应参数、错误信息等
 */
function logError(logData) {
    try {
        let logs = [];
        if (fs.existsSync(LOG_FILE)) {
            const content = fs.readFileSync(LOG_FILE, 'utf8');
            try {
                logs = JSON.parse(content);
                if (!Array.isArray(logs)) {
                    logs = [];
                }
            } catch (e) {
                // 如果解析失败，说明文件损坏或格式不对，重置
                logs = [];
            }
        }

        // 添加新日志到开头（最新的在前面）
        const newEntry = {
            timestamp: new Date().toISOString(),
            ...logData
        };
        logs.unshift(newEntry);

        // 限制数量为 100 条
        if (logs.length > MAX_LOGS) {
            logs = logs.slice(0, MAX_LOGS);
        }

        fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2), 'utf8');
    } catch (err) {
        console.error('Failed to write error log:', err);
    }
}

/**
 * 拦截响应并记录错误日志的中间件
 */
function apiResponseInterceptor(req, res, next) {
    const oldJson = res.json;
    
    res.json = function(body) {
        if (res.statusCode >= 400 && (req.originalUrl.startsWith('/api') || req.path.startsWith('/api'))) {
            const logData = {
                path: req.originalUrl || req.path,
                method: req.method,
                headers: req.headers,
                query: req.query,
                params: req.params,
                body: req.body,
                response: {
                    status: res.statusCode,
                    body: body
                }
            };
            logError(logData);
        }
        return oldJson.call(this, body);
    };
    
    next();
}

/**
 * 错误日志中间件（用于捕获未处理的异常）
 */
function errorLoggerMiddleware(err, req, res, next) {
    const logData = {
        path: req.originalUrl || req.path,
        method: req.method,
        headers: req.headers,
        query: req.query,
        params: req.params,
        body: req.body,
        error: {
            message: err.message,
            stack: err.stack,
            status: err.status || 500
        }
    };

    // 只有 API 接口报错才记录
    if (req.originalUrl.startsWith('/api') || req.path.startsWith('/api')) {
        logError(logData);
    }

    next(err);
}

module.exports = {
    logError,
    apiResponseInterceptor,
    errorLoggerMiddleware
};
