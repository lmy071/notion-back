const express = require('express');
const router = express.Router();
const Auth = require('../lib/auth');
const db = require('../lib/db');
const SyncEngine = require('../lib/sync');

/**
 * 简单的身份验证中间件
 * 实际应用中建议使用 JWT 或 Session
 */
const authenticate = async (req, res, next) => {
    const userId = req.headers['x-user-id'];
    if (!userId) {
        return res.status(401).json({ success: false, message: '未登录' });
    }
    const user = await Auth.getUser(userId);
    if (!user) {
        return res.status(401).json({ success: false, message: '无效的用户' });
    }
    req.user = user;
    next();
};

/**
 * 管理员权限验证中间件
 */
const isAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ success: false, message: '需要管理员权限' });
    }
};

/**
 * 用户注册
 * POST /api/register
 */
router.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
    }

    try {
        await Auth.createUser(username, password);
        res.json({ success: true, message: '注册成功' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            res.status(400).json({ success: false, message: '用户名已存在' });
        } else {
            res.status(500).json({ success: false, message: error.message });
        }
    }
});

/**
 * 用户登录
 * POST /api/login
 */
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await Auth.login(username, password);
        if (user) {
            res.json({ 
                success: true, 
                message: '登录成功', 
                user: { id: user.id, username: user.username, role: user.role } 
            });
        } else {
            res.status(401).json({ success: false, message: '用户名或密码错误' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 配置 Notion API 密钥等全局信息
 * POST /api/config
 */
router.post('/config', authenticate, async (req, res) => {
    const { apiKey, version } = req.body;
    
    try {
        if (apiKey) await db.updateConfig('notion_api_key', apiKey);
        if (version) await db.updateConfig('notion_version', version);

        res.json({ success: true, message: '全局配置已更新' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 添加需要同步的数据库
 * POST /api/databases
 */
router.post('/databases', authenticate, async (req, res) => {
    const { databaseId, name } = req.body;
    if (!databaseId) return res.status(400).json({ success: false, message: '缺少 databaseId' });

    try {
        await db.query('INSERT INTO notion_sync_targets (database_id, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)', [databaseId, name]);
        res.json({ success: true, message: '数据库已添加' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 获取所有已配置的数据库
 * GET /api/databases
 */
router.get('/databases', authenticate, async (req, res) => {
    try {
        const targets = await db.query('SELECT * FROM notion_sync_targets');
        res.json({ success: true, data: targets });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 删除数据库配置
 * DELETE /api/databases/:id
 */
router.delete('/databases/:id', authenticate, async (req, res) => {
    try {
        await db.query('DELETE FROM notion_sync_targets WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: '数据库配置已删除' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 触发同步 (所有启用数据库)
 * POST /api/sync
 */
router.post('/sync', authenticate, async (req, res) => {
    try {
        const result = await SyncEngine.run(req.user.id);
        res.json({ success: true, message: '同步完成', data: result });
    } catch (error) {
        res.status(403).json({ success: false, message: error.message });
    }
});

/**
 * 触发同步 (指定单个数据库)
 * POST /api/sync/:databaseId
 */
router.post('/sync/:databaseId', authenticate, async (req, res) => {
    const { databaseId } = req.params;
    try {
        const result = await SyncEngine.run(req.user.id, databaseId);
        res.json({ success: true, message: `数据库 ${databaseId} 同步完成`, data: result });
    } catch (error) {
        res.status(403).json({ success: false, message: error.message });
    }
});

/**
 * 查询特定同步数据库里的数据
 * GET /api/data/:databaseId
 */
router.get('/data/:databaseId', authenticate, async (req, res) => {
    const { databaseId } = req.params;
    const tableName = `notion_data_${databaseId.replace(/-/g, '_')}`;
    
    try {
        // 先检查表是否存在，限定在当前数据库内
        const checkTableSql = `SELECT COUNT(*) as count FROM information_schema.tables WHERE table_name = ? AND table_schema = DATABASE()`;
        const tableExists = await db.query(checkTableSql, [tableName]);
        
        if (tableExists[0].count === 0) {
            console.log(`[Data Query] Table not found: ${tableName}`);
            return res.status(404).json({ success: false, message: '该数据库尚未同步或对应的 MySQL 表不存在' });
        }

        const sql = `SELECT * FROM \`${tableName}\` ORDER BY synced_at DESC`;
        const data = await db.query(sql);
        res.json({ success: true, count: data.length, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 查询 API 调用日志
 * GET /api/logs
 * 支持可选参数: isSuccess (0/1), limit, offset
 */
router.get('/logs', authenticate, async (req, res) => {
    const { isSuccess, limit = 50, offset = 0 } = req.query;
    
    try {
        let sql = 'SELECT * FROM api_logs';
        const params = [];

        if (isSuccess !== undefined) {
            sql += ' WHERE is_success = ?';
            params.push(isSuccess);
        }

        sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const logs = await db.query(sql, params);
        
        // 获取总数用于分页
        const countSql = isSuccess !== undefined ? 'SELECT COUNT(*) as total FROM api_logs WHERE is_success = ?' : 'SELECT COUNT(*) as total FROM api_logs';
        const totalResult = await db.query(countSql, isSuccess !== undefined ? [isSuccess] : []);
        
        res.json({ 
            success: true, 
            total: totalResult[0].total,
            limit: parseInt(limit),
            offset: parseInt(offset),
            data: logs 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 获取用户列表 (仅管理员)
 * GET /api/users
 */
router.get('/users', authenticate, isAdmin, async (req, res) => {
    try {
        const users = await Auth.listUsers();
        // 隐藏密码字段
        const safeUsers = users.map(u => {
            const { password, ...user } = u;
            return user;
        });
        res.json({ success: true, data: safeUsers });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 更新用户权限或信息 (仅管理员)
 * PUT /api/users/:id
 */
router.put('/users/:id', authenticate, isAdmin, async (req, res) => {
    const { permissions, role, password } = req.body;
    const updates = {};
    if (permissions !== undefined) updates.permissions = permissions;
    if (role !== undefined) updates.role = role;
    if (password !== undefined) updates.password = password;

    try {
        await Auth.updateUser(req.params.id, updates);
        res.json({ success: true, message: '用户信息已更新' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 删除用户 (仅管理员)
 * DELETE /api/users/:id
 */
router.delete('/users/:id', authenticate, isAdmin, async (req, res) => {
    try {
        await Auth.deleteUser(req.params.id);
        res.json({ success: true, message: '用户已删除' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 获取所有可配置权限字典 (仅管理员)
 * GET /api/dict/permissions
 */
router.get('/dict/permissions', authenticate, isAdmin, async (req, res) => {
    try {
        const perms = await db.query('SELECT * FROM dict_table WHERE category = "permission"');
        res.json({ success: true, data: perms });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 新增权限字典项 (仅管理员)
 * POST /api/dict/permissions
 */
router.post('/dict/permissions', authenticate, isAdmin, async (req, res) => {
    const { code, name } = req.body;
    if (!code || !name) return res.status(400).json({ success: false, message: '缺少 code 或 name' });

    try {
        await db.query('INSERT INTO dict_table (dict_code, dict_name, category) VALUES (?, ?, "permission")', [code, name]);
        res.json({ success: true, message: '权限项已添加' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 删除权限字典项 (仅管理员)
 * DELETE /api/dict/permissions/:id
 */
router.delete('/dict/permissions/:id', authenticate, isAdmin, async (req, res) => {
    try {
        await db.query('DELETE FROM dict_table WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: '权限项已删除' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 获取当前配置 (用于回显)
 * GET /api/config
 */
router.get('/config', authenticate, async (req, res) => {
    try {
        const configs = await db.getAllConfigs();
        res.json({ success: true, data: configs });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
