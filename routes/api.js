const express = require('express');
const router = express.Router();
const Auth = require('../lib/auth');
const db = require('../lib/db');
const SyncEngine = require('../lib/sync');
const NotionClient = require('../lib/notion');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// 配置 multer 存储
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, '../public/uploads/avatars');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'avatar-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 限制 2MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('仅支持上传图片文件'));
        }
    }
});

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
 * 获取 API 调用日志
 * GET /api/logs
 */
router.get('/logs', authenticate, async (req, res) => {
    try {
        const logs = await db.query('SELECT * FROM api_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 100', [req.user.id]);
        res.json({ success: true, data: logs });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 获取 Notion API 密钥等全局信息
 * GET /api/configs
 */
router.get('/configs', authenticate, async (req, res) => {
    try {
        const configs = await db.getAllConfigs(req.user.id);
        res.json({ success: true, data: configs });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 获取当前用户信息
 * GET /api/me
 */
router.get('/me', authenticate, async (req, res) => {
    try {
        const users = await db.query('SELECT id, username, role, avatar, created_at FROM users WHERE id = ?', [req.user.id]);
        if (users.length > 0) {
            res.json({ success: true, data: users[0] });
        } else {
            res.status(404).json({ success: false, message: '用户不存在' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 更新个人资料 (头像等)
 * POST /api/me/profile
 */
router.post('/me/profile', authenticate, async (req, res) => {
    const { avatar } = req.body;
    try {
        await db.query('UPDATE users SET avatar = ? WHERE id = ?', [avatar, req.user.id]);
        res.json({ success: true, message: '个人资料已更新' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 上传头像
 * POST /api/upload/avatar
 */
router.post('/upload/avatar', authenticate, upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: '没有上传文件' });
        }
        
        // 返回文件的访问 URL
        const fileUrl = `/uploads/avatars/${req.file.filename}`;
        res.json({ success: true, data: { url: fileUrl } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 配置 Notion API 密钥等全局信息
 * POST /api/config
 */
router.post('/config', authenticate, async (req, res) => {
    const { apiKey, version, syncSchedule } = req.body;
    
    try {
        if (apiKey !== undefined) await db.updateConfig(req.user.id, 'notion_api_key', apiKey);
        if (version !== undefined) await db.updateConfig(req.user.id, 'notion_version', version);
        
        if (syncSchedule !== undefined) {
            // 验证 cron 表达式
            const cron = require('node-cron');
            const scheduler = require('../lib/scheduler');
            
            if (syncSchedule === '' || syncSchedule === null) {
                await db.updateConfig(req.user.id, 'sync_schedule', '');
                scheduler.stopSync(req.user.id);
            } else if (cron.validate(syncSchedule)) {
                await db.updateConfig(req.user.id, 'sync_schedule', syncSchedule);
                scheduler.scheduleSync(req.user.id, syncSchedule);
            } else {
                return res.status(400).json({ success: false, message: '无效的 Cron 表达式' });
            }
        }

        res.json({ success: true, message: '配置已更新' });
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
        await db.query('INSERT INTO notion_sync_targets (user_id, database_id, name) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)', [req.user.id, databaseId, name]);
        res.json({ success: true, message: '数据库已添加' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 获取当前用户已配置的数据库
 * GET /api/databases
 */
router.get('/databases', authenticate, async (req, res) => {
    try {
        const targets = await db.query('SELECT * FROM notion_sync_targets WHERE user_id = ?', [req.user.id]);
        
        // 为每个数据库目标获取实时数据总量
        const dataWithCounts = await Promise.all(targets.map(async (target) => {
            try {
                // 1. 确定表名 (优先使用数据源名称，回退到数据库ID命名)
                const dsInfo = await db.query('SELECT name FROM notion_data_sources WHERE database_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1', [target.database_id, req.user.id]);
                
                let tableName;
                if (dsInfo.length > 0 && dsInfo[0].name) {
                    tableName = NotionClient.generateTableName(req.user.id, dsInfo[0].name);
                } else {
                    tableName = `user_${req.user.id}_notion_data_${target.database_id.replace(/-/g, '_')}`;
                }

                // 2. 检查表是否存在，如果不存在则直接设为 0，避免触发 db.query 的内部错误日志
                let totalCount = 0;
                try {
                    const tableCheck = await db.query(
                        "SELECT COUNT(*) as exists_count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
                        [tableName]
                    );
                    
                    if (tableCheck[0].exists_count > 0) {
                        const countResult = await db.query(`SELECT COUNT(*) as total FROM \`${tableName}\``);
                        totalCount = Number(countResult[0].total || 0);
                    } else {
                        // 如果第一个表名不存在，检查备用表名
                        const fallbackTableName = `user_${req.user.id}_notion_data_${target.database_id.replace(/-/g, '_')}`;
                        if (fallbackTableName !== tableName) {
                            const fallbackCheck = await db.query(
                                "SELECT COUNT(*) as exists_count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
                                [fallbackTableName]
                            );
                            if (fallbackCheck[0].exists_count > 0) {
                                const countResult = await db.query(`SELECT COUNT(*) as total FROM \`${fallbackTableName}\``);
                                totalCount = Number(countResult[0].total || 0);
                            }
                        }
                    }
                } catch (err) {
                    console.error(`Metadata check failed for ${target.database_id}:`, err);
                    totalCount = 0;
                }

                return { ...target, total_count: totalCount };
            } catch (err) {
                console.error(`Failed to get count for ${target.database_id}:`, err);
                return { ...target, total_count: 0 };
            }
        }));

        res.json({ success: true, data: dataWithCounts });
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
        // 权限验证
        const hasPermission = await Auth.checkPermission(req.user.id, 'data:delete');
        if (!hasPermission) {
            return res.status(403).json({ success: false, message: '无删除数据权限 (data:delete)' });
        }

        // 先查出 database_id，用于后续清理相关数据源
        const targets = await db.query('SELECT database_id FROM notion_sync_targets WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
        if (targets.length === 0) {
            return res.status(404).json({ success: false, message: '配置不存在或无权操作' });
        }
        const databaseId = targets[0].database_id;

        // 1. 删除同步目标配置
        await db.query('DELETE FROM notion_sync_targets WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
        
        // 2. 删除该数据库关联的所有数据源记录
        await db.query('DELETE FROM notion_data_sources WHERE database_id = ? AND user_id = ?', [databaseId, req.user.id]);

        res.json({ success: true, message: '数据库配置及其关联数据源已删除' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 更新数据库同步状态 (启用/停用)
 * PUT /api/databases/:id/status
 */
router.put('/databases/:id/status', authenticate, async (req, res) => {
    const { status } = req.body;
    if (status === undefined) return res.status(400).json({ success: false, message: '缺少 status 参数' });

    try {
        const result = await db.query('UPDATE notion_sync_targets SET status = ? WHERE id = ? AND user_id = ?', [status ? 1 : 0, req.params.id, req.user.id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: '配置不存在或无权操作' });
        }
        res.json({ success: true, message: status ? '同步已启用' : '同步已停用' });
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
 * 更新数据库表字段 (从 Notion 同步结构)
 * POST /api/databases/:databaseId/refresh-schema
 */
router.post('/databases/:databaseId/refresh-schema', authenticate, async (req, res) => {
    const { databaseId } = req.params;
    
    try {
        // 权限验证
        const hasPermission = await Auth.checkPermission(req.user.id, 'sync:notion');
        if (!hasPermission) {
            return res.status(403).json({ success: false, message: '无同步数据权限 (sync:notion)' });
        }

        // 1. 查找数据源 ID
        const dsInfo = await db.query('SELECT data_source_id, name FROM notion_data_sources WHERE database_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1', [databaseId, req.user.id]);
        
        if (dsInfo.length === 0) {
            return res.status(404).json({ success: false, message: '未找到关联的数据源，请先执行一次同步' });
        }

        // 状态验证
        const statusCheck = await db.query('SELECT status FROM notion_sync_targets WHERE database_id = ? AND user_id = ?', [databaseId, req.user.id]);
        if (statusCheck.length > 0 && statusCheck[0].status === 0) {
            return res.status(403).json({ success: false, message: '该数据库链路已挂起，无法更新结构' });
        }
        
        const dataSourceId = dsInfo[0].data_source_id;
        const dsName = dsInfo[0].name;

        // 2. 获取 Notion 配置
        const configs = await db.getAllConfigs(req.user.id);
        const apiKey = configs.notion_api_key;
        const notionVersion = configs.notion_version || '2025-09-03';

        if (!apiKey) {
            return res.status(400).json({ success: false, message: '未配置 Notion API Key' });
        }

        const notion = new NotionClient(req.user.id, apiKey, notionVersion);
        
        // 3. 获取最新结构
        const structure = await notion.getDataSourceStructure(dataSourceId);
        const properties = structure.properties;
        const dsTitle = structure.title || dsName || 'notion_data';

        // 4. 映射字段
        const tableName = NotionClient.generateTableName(req.user.id, dsTitle);
        const { columns } = notion.mapNotionToMysql(properties);

        // 5. 更新表结构 (简单起见，使用先删后建模式，后续可优化为 ALTER TABLE)
        await db.query(`DROP TABLE IF EXISTS \`${tableName}\``);
        
        const createTableSql = `CREATE TABLE \`${tableName}\` (
            ${columns.join(', ')},
            \`synced_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;
        
        await db.query(createTableSql);

        res.json({ success: true, message: `表 ${tableName} 字段已成功更新` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 查询特定同步数据库里的数据
 * GET /api/data/:databaseId
 * 支持分页参数: page, limit, search, filters (JSON string)
 */
router.get('/data/:databaseId', authenticate, async (req, res) => {
    const { databaseId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const search = req.query.search || '';
    const filtersStr = req.query.filters || '[]';
    const offset = (page - 1) * limit;
    
    try {
        // 权限与状态验证
        const statusCheck = await db.query('SELECT status FROM notion_sync_targets WHERE database_id = ? AND user_id = ?', [databaseId, req.user.id]);
        if (statusCheck.length === 0) {
            return res.status(404).json({ success: false, message: '配置不存在或无权操作' });
        }
        if (statusCheck[0].status === 0) {
            return res.status(403).json({ success: false, message: '该数据库链路已挂起，无法访问数据' });
        }

        const dsInfo = await db.query('SELECT name FROM notion_data_sources WHERE database_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1', [databaseId, req.user.id]);
        
        let tableName;
        if (dsInfo.length > 0 && dsInfo[0].name) {
            tableName = NotionClient.generateTableName(req.user.id, dsInfo[0].name);
        } else {
            tableName = `user_${req.user.id}_notion_data_${databaseId.replace(/-/g, '_')}`;
        }
        
        const checkTableSql = `SELECT COUNT(*) as count FROM information_schema.tables WHERE table_name = ? AND table_schema = DATABASE()`;
        const tableExists = await db.query(checkTableSql, [tableName]);
        
        if (tableExists[0].count === 0) {
            return res.status(404).json({ success: false, message: '该数据库尚未同步或对应的 MySQL 表不存在' });
        }

        // 构建查询条件
        let whereClause = '';
        let queryParams = [];

        // 1. 获取表字段信息，用于安全搜索
        const columnsInfo = await db.query(`SHOW COLUMNS FROM \`${tableName}\``);
        const validColumns = columnsInfo.map(c => c.Field);

        // 2. 处理全局搜索
        if (search) {
            const searchConditions = validColumns.map(col => `\`${col}\` LIKE ?`).join(' OR ');
            whereClause += ` WHERE (${searchConditions})`;
            validColumns.forEach(() => queryParams.push(`%${search}%`));
        }

        // 3. 处理高级过滤
        try {
            const advancedFilters = JSON.parse(filtersStr);
            if (Array.isArray(advancedFilters) && advancedFilters.length > 0) {
                advancedFilters.forEach(f => {
                    if (f.field && f.value && validColumns.includes(f.field)) {
                        whereClause += whereClause ? ' AND ' : ' WHERE ';
                        whereClause += `\`${f.field}\` LIKE ?`;
                        queryParams.push(`%${f.value}%`);
                    }
                });
            }
        } catch (e) {
            console.error('Parse filters error:', e);
        }

        // 获取总数
        const countSql = `SELECT COUNT(*) as total FROM \`${tableName}\` ${whereClause}`;
        const countResult = await db.query(countSql, queryParams);
        // 确保 total 是数字类型，避免 BigInt 序列化问题
        const total = Number(countResult[0].total || 0);

        // 获取分页数据
        const sql = `SELECT * FROM \`${tableName}\` ${whereClause} ORDER BY synced_at DESC LIMIT ? OFFSET ?`;
        const data = await db.query(sql, [...queryParams, limit, offset]);
        
        res.json({ 
            success: true, 
            data,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit) || 1
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 获取存储在数据库中的 Notion 页面详情 (仅从 DB 读取)
 * GET /api/data/:databaseId/page/:pageId
 */
router.get('/data/:databaseId/page/:pageId', authenticate, async (req, res) => {
    const { databaseId, pageId } = req.params;
    
    // 归一化 ID (去除连字符) 用于比较
    const normalizeId = (id) => id.replace(/-/g, '').toLowerCase();
    const normalizedPageId = normalizeId(pageId);

    try {
        // 1. 获取数据源名称以生成表名
        const dsInfo = await db.query('SELECT name FROM notion_data_sources WHERE database_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1', [databaseId, req.user.id]);
        
        let baseTableName;
        if (dsInfo.length > 0 && dsInfo[0].name) {
            baseTableName = NotionClient.generateTableName(req.user.id, dsInfo[0].name);
        } else {
            baseTableName = `user_${req.user.id}_notion_data_${databaseId.replace(/-/g, '_')}`;
        }
        
        const detailTableName = baseTableName.replace(`_${req.user.id}`, `_detail_${req.user.id}`);

        // 2. 检查表是否存在
        const checkTableSql = `SELECT COUNT(*) as count FROM information_schema.tables WHERE table_name = ? AND table_schema = DATABASE()`;
        const tableExists = await db.query(checkTableSql, [detailTableName]);
        
        if (tableExists[0].count === 0) {
            return res.json({ success: true, data: [], synced: false, message: '该页面尚未同步，请先执行同步' });
        }

        // 3. 从数据库查询所有 Block (使用原始 ID 查询，因为存储时用的是原始 ID)
        // 但为了保险，我们查询该 page_id 相关的所有记录
        const rows = await db.query(`SELECT * FROM \`${detailTableName}\` WHERE page_id = ? OR REPLACE(page_id, '-', '') = ?`, [pageId, normalizedPageId]);
        
        if (rows.length === 0) {
            return res.json({ success: true, data: [], synced: false, message: '该页面尚未同步，请先执行同步' });
        }

        // 4. 重建树形结构
        const buildTree = (parentId) => {
            const normalizedParentId = normalizeId(parentId);
            return rows
                .filter(row => normalizeId(row.parent_id) === normalizedParentId)
                .map(row => {
                    let content;
                    try {
                        content = typeof row.content === 'string' ? JSON.parse(row.content) : row.content;
                    } catch (e) {
                        content = row.content;
                    }
                    return {
                        ...content,
                        children: buildTree(row.block_id)
                    };
                });
        };

        const blocks = buildTree(pageId);

        // 获取页面标题与面包屑
        const workspaceTableName = `user_${req.user.id}_workspace_objects`;
        let title = '页面详情分析';
        let breadcrumbs = [];
        try {
            const objectRows = await db.query(`SELECT title FROM \`${workspaceTableName}\` WHERE object_id = ? OR REPLACE(object_id, '-', '') = ?`, [pageId, normalizedPageId]);
            if (objectRows.length > 0) {
                title = objectRows[0].title;
            }

            // 获取实时层级面包屑
            const configs = await db.getAllConfigs(req.user.id);
            const notion = new NotionClient(req.user.id, configs.notion_api_key, configs.notion_version);
            breadcrumbs = await notion.getBreadcrumbs(pageId, 'page');
        } catch (e) {
            console.error('Fetch title and breadcrumbs error:', e);
        }

        res.json({ 
            success: true, 
            data: blocks,
            synced: true,
            title,
            breadcrumbs,
            tableName: detailTableName
        });
    } catch (error) {
        console.error('Fetch page detail from DB error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 同步 Notion 页面详情到数据库
 * POST /api/data/:databaseId/page/:pageId/sync
 */
router.post('/data/:databaseId/page/:pageId/sync', authenticate, async (req, res) => {
    const { databaseId, pageId } = req.params;
    
    try {
        // 1. 获取配置
        const configs = await db.getAllConfigs(req.user.id);
        const apiKey = configs.notion_api_key;
        const notionVersion = configs.notion_version || '2025-09-03';

        if (!apiKey) {
            return res.status(400).json({ success: false, message: '未配置 Notion API Key' });
        }

        // 2. 获取表名
        const dsInfo = await db.query('SELECT name FROM notion_data_sources WHERE database_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1', [databaseId, req.user.id]);
        
        let baseTableName;
        if (dsInfo.length > 0 && dsInfo[0].name) {
            baseTableName = NotionClient.generateTableName(req.user.id, dsInfo[0].name);
        } else {
            baseTableName = `user_${req.user.id}_notion_data_${databaseId.replace(/-/g, '_')}`;
        }
        
        const detailTableName = baseTableName.replace(`_${req.user.id}`, `_detail_${req.user.id}`);

        // 3. 确保表存在
        const createTableSql = `
            CREATE TABLE IF NOT EXISTS \`${detailTableName}\` (
                \`id\` INT AUTO_INCREMENT PRIMARY KEY,
                \`page_id\` VARCHAR(64) NOT NULL,
                \`block_id\` VARCHAR(64) NOT NULL,
                \`type\` VARCHAR(50),
                \`content\` JSON,
                \`parent_id\` VARCHAR(64),
                \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_page_id (\`page_id\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `;
        await db.query(createTableSql);

        // 4. 从 Notion 递归获取
        const notion = new NotionClient(req.user.id, apiKey, notionVersion);
        const blocks = await notion.getPageBlocksRecursive(pageId);

        // 5. 存储到 DB
        await db.query(`DELETE FROM \`${detailTableName}\` WHERE page_id = ?`, [pageId]);
        
        const flattenBlocks = (blockList, parentId = pageId) => {
            let result = [];
            for (const block of blockList) {
                const { children, ...blockData } = block;
                result.push({
                    page_id: pageId,
                    block_id: block.id,
                    type: block.type,
                    content: JSON.stringify(blockData),
                    parent_id: parentId
                });
                if (children && children.length > 0) {
                    result = result.concat(flattenBlocks(children, block.id));
                }
            }
            return result;
        };

        const flatData = flattenBlocks(blocks);
        
        // 批量插入优化
        for (const item of flatData) {
            await db.query(
                `INSERT INTO \`${detailTableName}\` (page_id, block_id, type, content, parent_id) VALUES (?, ?, ?, ?, ?)`,
                [item.page_id, item.block_id, item.type, item.content, item.parent_id]
            );
        }

        res.json({ 
            success: true, 
            message: '同步完成',
            count: flatData.length
        });
    } catch (error) {
        console.error('Sync page detail error:', error);
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
        let sql = 'SELECT * FROM api_logs WHERE user_id = ?';
        const params = [req.user.id];

        if (isSuccess !== undefined) {
            sql += ' AND is_success = ?';
            params.push(isSuccess);
        }

        sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const logs = await db.query(sql, params);
        
        // 获取总数用于分页
        const countSql = isSuccess !== undefined ? 'SELECT COUNT(*) as total FROM api_logs WHERE user_id = ? AND is_success = ?' : 'SELECT COUNT(*) as total FROM api_logs WHERE user_id = ?';
        const totalResult = await db.query(countSql, isSuccess !== undefined ? [req.user.id, isSuccess] : [req.user.id]);
        
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
 * 获取特定数据库下的所有数据源
 * GET /api/data_sources/:databaseId
 */
router.get('/data_sources/:databaseId', authenticate, async (req, res) => {
    const { databaseId } = req.params;
    try {
        const dataSources = await db.query('SELECT * FROM notion_data_sources WHERE user_id = ? AND database_id = ?', [req.user.id, databaseId]);
        res.json({ success: true, data: dataSources });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 根据获取到的字段列属性重新创建对应的数据库表
 * GET/POST /api/data_sources/:dataSourceId/recreate-table
 */
router.all('/data_sources/:dataSourceId/recreate-table', authenticate, async (req, res) => {
    const { dataSourceId } = req.params;
    let databaseId = req.body.databaseId || req.query.databaseId;

    try {
        // 权限验证
        const hasPermission = await Auth.checkPermission(req.user.id, 'sync:notion');
        if (!hasPermission) {
            return res.status(403).json({ success: false, message: '无同步数据权限 (sync:notion)' });
        }

        // 如果没有提供 databaseId，尝试从数据库中查找
        if (!databaseId) {
            const dsInfo = await db.query('SELECT database_id FROM notion_data_sources WHERE data_source_id = ? AND user_id = ?', [dataSourceId, req.user.id]);
            if (dsInfo.length > 0) {
                databaseId = dsInfo[0].database_id;
            }
        }

        if (!databaseId) {
            return res.status(400).json({ success: false, message: '缺少 databaseId 参数，且无法通过 dataSourceId 自动关联' });
        }

        // 状态验证
        const statusCheck = await db.query('SELECT status FROM notion_sync_targets WHERE database_id = ? AND user_id = ?', [databaseId, req.user.id]);
        if (statusCheck.length > 0 && statusCheck[0].status === 0) {
            return res.status(403).json({ success: false, message: '该数据库链路已挂起，无法重新创建表' });
        }

        const configs = await db.getAllConfigs(req.user.id);
        const apiKey = configs.notion_api_key;
        const notionVersion = configs.notion_version || '2025-09-03';

        if (!apiKey) {
            return res.status(400).json({ success: false, message: '未配置 Notion API Key' });
        }

        const notion = new NotionClient(req.user.id, apiKey, notionVersion);
        
        // 1. 获取数据源结构
        const structure = await notion.getDataSourceStructure(dataSourceId);
        const properties = structure.properties;
        const dsTitle = structure.title || 'notion_data';

        // 2. 映射字段
        const tableName = NotionClient.generateTableName(req.user.id, dsTitle);
        const { columns } = notion.mapNotionToMysql(properties);

        // 3. 重新建表 (先删后建)
        await db.query(`DROP TABLE IF EXISTS \`${tableName}\``);
        
        const createTableSql = `CREATE TABLE \`${tableName}\` (
            ${columns.join(', ')},
            \`synced_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;
        
        await db.query(createTableSql);

        res.json({ success: true, message: `表 ${tableName} 已根据数据源 ${dataSourceId} 的结构重新创建` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 获取当前用户的配置 (用于回显)
 * GET /api/config
 */
router.get('/config', authenticate, async (req, res) => {
    try {
        const configs = await db.getAllConfigs(req.user.id);
        res.json({ success: true, data: configs });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 同步整个 Notion 工作区的页面和数据库列表到数据库
 * POST /api/notion/workspace/sync
 */
router.post('/notion/workspace/sync', authenticate, async (req, res) => {
    try {
        const configs = await db.getAllConfigs(req.user.id);
        const apiKey = configs.notion_api_key;
        const notionVersion = configs.notion_version || '2025-09-03';

        if (!apiKey) {
            return res.status(400).json({ success: false, message: '未配置 Notion API Key' });
        }

        const notion = new NotionClient(req.user.id, apiKey, notionVersion);
        
        // 1. 创建表
        const tableName = `user_${req.user.id}_workspace_objects`;
        const createTableSql = `
            CREATE TABLE IF NOT EXISTS \`${tableName}\` (
                \`id\` INT AUTO_INCREMENT PRIMARY KEY,
                \`object_id\` VARCHAR(64) NOT NULL,
                \`type\` VARCHAR(20) NOT NULL,
                \`title\` TEXT,
                \`icon\` JSON,
                \`last_edited_time\` DATETIME,
                \`url\` TEXT,
                \`raw_data\` JSON,
                \`synced_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY \`idx_object_id\` (\`object_id\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `;
        await db.query(createTableSql);

        // 2. 递归获取所有搜索结果 (Notion /search 支持分页)
        let allResults = [];
        let hasMore = true;
        let cursor = undefined;

        while (hasMore) {
            const response = await notion.search('', cursor, 100);
            allResults = allResults.concat(response.results);
            hasMore = response.has_more;
            cursor = response.next_cursor;
        }

        // 3. 写入数据库
        for (const item of allResults) {
            let title = '未命名';
            if (item.object === 'database') {
                title = item.title?.[0]?.plain_text || '未命名数据库';
            } else {
                const titleProp = item.properties?.title || item.properties?.Name;
                title = titleProp?.title?.[0]?.plain_text || '未命名页面';
            }

            await db.query(
                `INSERT INTO \`${tableName}\` (object_id, type, title, icon, last_edited_time, url, raw_data) 
                 VALUES (?, ?, ?, ?, ?, ?, ?) 
                 ON DUPLICATE KEY UPDATE 
                    type = VALUES(type), 
                    title = VALUES(title), 
                    icon = VALUES(icon), 
                    last_edited_time = VALUES(last_edited_time), 
                    url = VALUES(url), 
                    raw_data = VALUES(raw_data)`,
                [
                    item.id,
                    item.object,
                    title,
                    JSON.stringify(item.icon || null),
                    new Date(item.last_edited_time),
                    item.url,
                    JSON.stringify(item)
                ]
            );
        }

        res.json({ success: true, message: '工作区列表同步完成', count: allResults.length });
    } catch (error) {
        console.error('Workspace sync error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 从数据库获取工作区对象列表
 * GET /api/notion/workspace/list
 */
router.get('/notion/workspace/list', authenticate, async (req, res) => {
    const { query = '', type } = req.query;
    const tableName = `user_${req.user.id}_workspace_objects`;

    try {
        // 检查表是否存在
        const checkTableSql = `SELECT COUNT(*) as count FROM information_schema.tables WHERE table_name = ? AND table_schema = DATABASE()`;
        const tableExists = await db.query(checkTableSql, [tableName]);
        
        if (tableExists[0].count === 0) {
            return res.json({ success: true, data: [], synced: false, message: '尚未同步，请先执行同步' });
        }

        let sql = `SELECT * FROM \`${tableName}\` WHERE 1=1`;
        const params = [];

        if (query) {
            sql += ` AND title LIKE ?`;
            params.push(`%${query}%`);
        }

        if (type) {
            sql += ` AND type = ?`;
            params.push(type);
        }

        sql += ` ORDER BY last_edited_time DESC`;

        const rows = await db.query(sql, params);
        
        // 格式化返回数据，使其结构与 Notion API 保持一致或前端兼容
        const results = rows.map(row => {
            let icon = null;
            let rawData = {};
            try {
                icon = typeof row.icon === 'string' ? JSON.parse(row.icon) : row.icon;
                rawData = typeof row.raw_data === 'string' ? JSON.parse(row.raw_data) : row.raw_data;
            } catch (e) {}

            return {
                ...rawData,
                id: row.object_id,
                object: row.type,
                title_from_db: row.title,
                icon: icon,
                last_edited_time: row.last_edited_time
            };
        });

        res.json({ success: true, data: { results }, synced: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 搜索 Notion 页面
 * GET /api/notion/search
 */
router.get('/notion/search', authenticate, async (req, res) => {
    const { query, cursor, pageSize } = req.query;
    try {
        const configs = await db.getAllConfigs(req.user.id);
        const apiKey = configs.notion_api_key;
        const notionVersion = configs.notion_version || '2025-09-03';

        if (!apiKey) {
            return res.status(400).json({ success: false, message: '未配置 Notion API Key' });
        }

        const notion = new NotionClient(req.user.id, apiKey, notionVersion);
        const result = await notion.search(query, cursor, pageSize ? parseInt(pageSize) : 100);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 获取工作区页面详情 (通用，不依赖特定 databaseId)
 * GET /api/notion/page/:pageId
 */
router.get('/notion/page/:pageId', authenticate, async (req, res) => {
    const { pageId } = req.params;
    const normalizeId = (id) => id.replace(/-/g, '').toLowerCase();
    const normalizedPageId = normalizeId(pageId);
    const detailTableName = `user_${req.user.id}_workspace_details`;

    try {
        const checkTableSql = `SELECT COUNT(*) as count FROM information_schema.tables WHERE table_name = ? AND table_schema = DATABASE()`;
        const tableExists = await db.query(checkTableSql, [detailTableName]);
        
        if (tableExists[0].count === 0) {
            return res.json({ success: true, data: [], synced: false, message: '该页面尚未同步' });
        }

        const rows = await db.query(`SELECT * FROM \`${detailTableName}\` WHERE page_id = ? OR REPLACE(page_id, '-', '') = ?`, [pageId, normalizedPageId]);
        
        if (rows.length === 0) {
            return res.json({ success: true, data: [], synced: false, message: '该页面尚未同步' });
        }

        const buildTree = (parentId) => {
            const normalizedParentId = normalizeId(parentId);
            return rows
                .filter(row => normalizeId(row.parent_id) === normalizedParentId)
                .map(row => {
                    let content;
                    try {
                        content = typeof row.content === 'string' ? JSON.parse(row.content) : row.content;
                    } catch (e) {
                        content = row.content;
                    }
                    return {
                        ...content,
                        children: buildTree(row.block_id)
                    };
                });
        };

        const blocks = buildTree(pageId);
        
        // 获取页面标题与面包屑
        const workspaceTableName = `user_${req.user.id}_workspace_objects`;
        let title = '工作区页面分析';
        let breadcrumbs = [];
        try {
            const objectRows = await db.query(`SELECT title FROM \`${workspaceTableName}\` WHERE object_id = ? OR REPLACE(object_id, '-', '') = ?`, [pageId, normalizedPageId]);
            if (objectRows.length > 0) {
                title = objectRows[0].title;
            }

            // 获取实时层级面包屑
            const configs = await db.getAllConfigs(req.user.id);
            const notion = new NotionClient(req.user.id, configs.notion_api_key, configs.notion_version);
            breadcrumbs = await notion.getBreadcrumbs(pageId, 'page');
        } catch (e) {
            console.error('Fetch title and breadcrumbs error:', e);
        }

        res.json({ success: true, data: blocks, synced: true, title, breadcrumbs });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 同步工作区页面详情
 * POST /api/notion/page/:pageId/sync
 */
router.post('/notion/page/:pageId/sync', authenticate, async (req, res) => {
    const { pageId } = req.params;
    const detailTableName = `user_${req.user.id}_workspace_details`;

    try {
        const configs = await db.getAllConfigs(req.user.id);
        const apiKey = configs.notion_api_key;
        const notionVersion = configs.notion_version || '2025-09-03';

        if (!apiKey) {
            return res.status(400).json({ success: false, message: '未配置 Notion API Key' });
        }

        const createTableSql = `
            CREATE TABLE IF NOT EXISTS \`${detailTableName}\` (
                \`id\` INT AUTO_INCREMENT PRIMARY KEY,
                \`page_id\` VARCHAR(64) NOT NULL,
                \`block_id\` VARCHAR(64) NOT NULL,
                \`type\` VARCHAR(50),
                \`content\` JSON,
                \`parent_id\` VARCHAR(64),
                \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_page_id (\`page_id\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `;
        await db.query(createTableSql);

        const notion = new NotionClient(req.user.id, apiKey, notionVersion);
        const blocks = await notion.getPageBlocksRecursive(pageId);

        await db.query(`DELETE FROM \`${detailTableName}\` WHERE page_id = ?`, [pageId]);
        
        const flattenBlocks = (blockList, parentId = pageId) => {
            let result = [];
            for (const block of blockList) {
                const { children, ...blockData } = block;
                result.push({
                    page_id: pageId,
                    block_id: block.id,
                    type: block.type,
                    content: JSON.stringify(blockData),
                    parent_id: parentId
                });
                if (children && children.length > 0) {
                    result = result.concat(flattenBlocks(children, block.id));
                }
            }
            return result;
        };

        const flatData = flattenBlocks(blocks);
        for (const item of flatData) {
            await db.query(
                `INSERT INTO \`${detailTableName}\` (page_id, block_id, type, content, parent_id) VALUES (?, ?, ?, ?, ?)`,
                [item.page_id, item.block_id, item.type, item.content, item.parent_id]
            );
        }

        res.json({ success: true, message: '同步完成', count: flatData.length });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 上报监控数据 (性能与错误)
 * POST /api/monitoring
 */
router.post('/monitoring', async (req, res) => {
    const { type, event, url, data, ua } = req.body;
    const userId = req.headers['x-user-id'] || null;

    try {
        // 1. 插入新日志
        await db.query(
            'INSERT INTO monitoring_logs (user_id, type, event, url, data, ua) VALUES (?, ?, ?, ?, ?, ?)',
            [userId, type, event, url, JSON.stringify(data), ua]
        );

        // 2. 限制存储量为 1000 条
        // 获取当前总数
        const countResult = await db.query('SELECT COUNT(*) as count FROM monitoring_logs');
        const count = countResult[0].count;

        if (count > 1000) {
            // 删除多余的旧日志
            const limit = count - 1000;
            await db.query(
                'DELETE FROM monitoring_logs ORDER BY created_at ASC LIMIT ?',
                [limit]
            );
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Monitoring report error:', error);
        // 监控接口即使失败也不应影响主流程，但返回错误码
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 获取页面的分享配置
 * GET /api/shares/:objectId
 */
router.get('/shares/:objectId', authenticate, async (req, res) => {
    const { objectId } = req.params;
    try {
        const rows = await db.query('SELECT * FROM shares WHERE object_id = ? AND user_id = ?', [objectId, req.user.id]);
        if (rows.length === 0) {
            return res.json({ success: true, data: null });
        }
        res.json({ success: true, data: rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 创建或更新页面的分享配置
 * POST /api/shares/:objectId
 */
router.post('/shares/:objectId', authenticate, async (req, res) => {
    const { objectId } = req.params;
    const { is_active } = req.body;
    
    try {
        // 检查是否已存在
        const existing = await db.query('SELECT id, share_token FROM shares WHERE object_id = ? AND user_id = ?', [objectId, req.user.id]);
        
        if (existing.length > 0) {
            // 更新状态
            await db.query('UPDATE shares SET is_active = ? WHERE id = ?', [is_active ? 1 : 0, existing[0].id]);
            const updated = await db.query('SELECT * FROM shares WHERE id = ?', [existing[0].id]);
            return res.json({ success: true, data: updated[0] });
        } else {
            // 创建新分享
            const shareToken = crypto.randomBytes(32).toString('hex');
            await db.query(
                'INSERT INTO shares (user_id, object_id, share_token, is_active) VALUES (?, ?, ?, ?)',
                [req.user.id, objectId, shareToken, is_active ? 1 : 0]
            );
            const created = await db.query('SELECT * FROM shares WHERE share_token = ?', [shareToken]);
            return res.json({ success: true, data: created[0] });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 公共接口：根据 share_token 获取页面内容
 * GET /api/public/shares/:token
 */
router.get('/public/shares/:token', async (req, res) => {
    const { token } = req.params;
    try {
        // 1. 查找分享配置
        const shareRows = await db.query('SELECT * FROM shares WHERE share_token = ? AND is_active = 1', [token]);
        if (shareRows.length === 0) {
            return res.status(404).json({ success: false, message: '分享不存在或已关闭' });
        }
        
        const share = shareRows[0];
        const { user_id, object_id } = share;
        
        // 2. 确定数据表名 (工作区详情表)
        const detailTableName = `user_${user_id}_workspace_details`;
        
        // 3. 检查表是否存在
        const checkTableSql = `SELECT COUNT(*) as count FROM information_schema.tables WHERE table_name = ? AND table_schema = DATABASE()`;
        const tableExists = await db.query(checkTableSql, [detailTableName]);
        
        if (tableExists[0].count === 0) {
            return res.status(404).json({ success: false, message: '内容尚未同步，请联系分享者' });
        }

        // 4. 获取内容并构建树
        const normalizeId = (id) => id.replace(/-/g, '').toLowerCase();
        const normalizedObjectId = normalizeId(object_id);
        
        const rows = await db.query(`SELECT * FROM \`${detailTableName}\` WHERE page_id = ? OR REPLACE(page_id, '-', '') = ?`, [object_id, normalizedObjectId]);
        
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: '页面内容为空或未同步' });
        }

        const buildTree = (parentId) => {
            const normalizedParentId = normalizeId(parentId);
            return rows
                .filter(row => normalizeId(row.parent_id) === normalizedParentId)
                .map(row => {
                    let content;
                    try {
                        content = typeof row.content === 'string' ? JSON.parse(row.content) : row.content;
                    } catch (e) {
                        content = row.content;
                    }
                    return {
                        ...content,
                        children: buildTree(row.block_id)
                    };
                });
        };

        const blocks = buildTree(object_id);
        
        // 获取页面标题 (从 workspace_objects 表获取)
        const objectRows = await db.query(`SELECT title FROM user_${user_id}_workspace_objects WHERE object_id = ?`, [object_id]);
        const title = objectRows.length > 0 ? objectRows[0].title : '分享页面';

        res.json({ 
            success: true, 
            data: {
                title,
                blocks
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 实时预览数据库内容 (不存储)
 * GET /api/notion/database/:databaseId/preview
 */
router.get('/notion/database/:databaseId/preview', authenticate, async (req, res) => {
    const { databaseId } = req.params;
    try {
        const configs = await db.getAllConfigs(req.user.id);
        const apiKey = configs.notion_api_key;
        const notionVersion = configs.notion_version || '2025-09-03';

        if (!apiKey) {
            return res.status(400).json({ success: false, message: '未配置 Notion API Key' });
        }

        const notion = new NotionClient(req.user.id, apiKey, notionVersion);
        
        // 1. 获取数据库结构
        const database = await notion.getDatabase(databaseId);
        
        // 2. 直接调用 data_sources 接口查询实时数据 (不落地)
        console.log(`Directly querying data_source: ${databaseId}`);
        const data = await notion.queryDataSource(databaseId, { page_size: 50 });

        res.json({ 
            success: true, 
            database,
            results: data.results || [],
            has_more: data.has_more || false,
            next_cursor: data.next_cursor || null
        });
    } catch (error) {
        console.error('Realtime preview error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
