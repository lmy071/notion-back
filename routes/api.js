const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Auth = require('../lib/auth');
const db = require('../lib/db');
const SyncEngine = require('../lib/sync');
const NotionClient = require('../lib/notion');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

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

const { StatusCode } = require('../lib/constants');

/**
 * 简单的身份验证中间件
 * 实际应用中建议使用 JWT 或 Session
 */
const authenticate = async (req, res, next) => {
    const userId = req.headers['x-user-id'];
    if (!userId) {
        return res.status(401).json({ 
            success: false, 
            message: '未登录',
            code: StatusCode.UNAUTHORIZED
        });
    }
    const user = await Auth.getUser(userId);
    if (!user) {
        return res.status(401).json({ 
            success: false, 
            message: '无效的用户',
            code: StatusCode.UNAUTHORIZED
        });
    }
    req.user = user;
    next();
};

/**
 * 从本地数据库获取层级面包屑 (避免调用 Notion API)
 */
const getBreadcrumbsFromDb = async (userId, objectId) => {
    const breadcrumbs = [];
    const workspaceTableName = `user_${userId}_workspace_objects`;
    const normalizeId = (id) => id.replace(/-/g, '').toLowerCase();

    let currentId = objectId;

    try {
        // 检查表是否存在
        const checkTableSql = `SELECT COUNT(*) as count FROM information_schema.tables WHERE table_name = ? AND table_schema = DATABASE()`;
        const tableExists = await db.query(checkTableSql, [workspaceTableName]);
        if (tableExists[0].count === 0) return [];

        // 限制深度防止循环
        for (let i = 0; i < 5; i++) {
            const rows = await db.query(
                `SELECT object_id, type, title, raw_data FROM \`${workspaceTableName}\` 
                 WHERE object_id = ? OR REPLACE(object_id, '-', '') = ?`,
                [currentId, normalizeId(currentId)]
            );

            if (rows.length === 0) break;

            const item = rows[0];
            breadcrumbs.unshift({
                id: item.object_id,
                type: item.type,
                title: item.title
            });

            // 解析 parent
            let rawData = typeof item.raw_data === 'string' ? JSON.parse(item.raw_data) : item.raw_data;
            const parent = rawData?.parent;

            if (parent && parent.type === 'page_id') {
                currentId = parent.page_id;
            } else if (parent && parent.type === 'database_id') {
                currentId = parent.database_id;
            } else {
                break;
            }
        }
    } catch (e) {
        console.error('Local breadcrumbs error:', e);
    }
    return breadcrumbs;
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
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

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

        // 3. 获取根节点总数
        const countResult = await db.query(`SELECT COUNT(*) as total FROM \`${detailTableName}\` WHERE parent_id = ? OR REPLACE(parent_id, '-', '') = ?`, [pageId, normalizedPageId]);
        const totalRootBlocks = Number(countResult[0].total || 0);

        // 4. 从数据库查询所有 Block 用于构建树 (目前仍需全量读取以保证递归子节点完整)
        // 优化：我们只过滤出属于该 page 的所有块
        const rows = await db.query(`SELECT * FROM \`${detailTableName}\` WHERE page_id = ? OR REPLACE(page_id, '-', '') = ?`, [pageId, normalizedPageId]);

        if (rows.length === 0) {
            // 即使未同步内容，也尝试获取标题和面包屑用于显示
            let title = '页面详情分析';
            let breadcrumbs = [];
            try {
                const workspaceTableName = `user_${req.user.id}_workspace_objects`;
                const objectRows = await db.query(`SELECT title FROM \`${workspaceTableName}\` WHERE object_id = ? OR REPLACE(object_id, '-', '') = ?`, [pageId, normalizedPageId]);
                if (objectRows.length > 0) {
                    title = objectRows[0].title;
                }
                breadcrumbs = await getBreadcrumbsFromDb(req.user.id, pageId);
            } catch (e) {}

            return res.json({
                success: true,
                data: [],
                synced: false,
                title,
                breadcrumbs,
                message: '该页面尚未同步，请先执行同步'
            });
        }

        // 5. 重建树形结构 (仅针对分页后的根节点)
        const buildTree = (parentId, allRows) => {
            const normalizedParentId = normalizeId(parentId);
            return allRows
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
                        children: buildTree(row.block_id, allRows)
                    };
                });
        };

        // 获取分页后的根节点块
        const rootRows = rows.filter(row => normalizeId(row.parent_id) === normalizedPageId);
        const pagedRootRows = rootRows.slice(offset, offset + limit);

        const blocks = pagedRootRows.map(row => {
            let content;
            try {
                content = typeof row.content === 'string' ? JSON.parse(row.content) : row.content;
            } catch (e) {
                content = row.content;
            }
            return {
                ...content,
                children: buildTree(row.block_id, rows)
            };
        });

        // 获取页面标题与面包屑 (改用本地数据库获取)
        const workspaceTableName = `user_${req.user.id}_workspace_objects`;
        let title = '页面详情分析';
        let breadcrumbs = [];
        try {
            const objectRows = await db.query(`SELECT title FROM \`${workspaceTableName}\` WHERE object_id = ? OR REPLACE(object_id, '-', '') = ?`, [pageId, normalizedPageId]);
            if (objectRows.length > 0) {
                title = objectRows[0].title;
            }
            // 改用本地函数，避免调用 Notion API
            breadcrumbs = await getBreadcrumbsFromDb(req.user.id, pageId);
        } catch (e) {
            console.error('Fetch title and breadcrumbs error:', e);
        }

        res.json({
            success: true,
            data: blocks,
            synced: true,
            title,
            breadcrumbs,
            tableName: detailTableName,
            pagination: {
                total: totalRootBlocks,
                offset,
                limit,
                has_more: offset + limit < totalRootBlocks
            }
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

        // 4. 执行同步
        const notion = new NotionClient(req.user.id, apiKey, notionVersion);
        const count = await SyncEngine.syncPageContent(req.user.id, pageId, notion, detailTableName);

        res.json({
            success: true,
            message: '同步完成',
            count: count
        });
    } catch (error) {
        console.error('Sync page detail error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 查询 API 调用日志
 * GET /api/logs
 * 支持可选参数: isSuccess (0/1), statusCode, url, limit, offset
 */
router.get('/logs', authenticate, async (req, res) => {
    const { isSuccess, statusCode, url, limit = 50, offset = 0 } = req.query;

    try {
        let sql = 'SELECT * FROM api_logs WHERE user_id = ?';
        const params = [req.user.id];

        if (isSuccess !== undefined) {
            sql += ' AND is_success = ?';
            params.push(isSuccess);
        }
        
        if (statusCode) {
            sql += ' AND status_code = ?';
            params.push(parseInt(statusCode));
        }

        if (url) {
            sql += ' AND url LIKE ?';
            params.push(`%${url}%`);
        }

        sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        const queryParams = [...params, parseInt(limit), parseInt(offset)];

        const logs = await db.query(sql, queryParams);

        // 获取总数用于分页
        let countSql = 'SELECT COUNT(*) as total FROM api_logs WHERE user_id = ?';
        const countParams = [req.user.id];
        
        if (isSuccess !== undefined) {
            countSql += ' AND is_success = ?';
            countParams.push(isSuccess);
        }
        if (statusCode) {
            countSql += ' AND status_code = ?';
            countParams.push(parseInt(statusCode));
        }
        if (url) {
            countSql += ' AND url LIKE ?';
            countParams.push(`%${url}%`);
        }

        const totalResult = await db.query(countSql, countParams);

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
 * 获取用户所有可用的数据源
 * GET /api/data-sources
 */
router.get('/data-sources', authenticate, async (req, res) => {
    try {
        const databases = await db.query('SELECT * FROM notion_sync_targets WHERE user_id = ? AND status = 1', [req.user.id]);
        const allDataSources = [];

        for (const database of databases) {
            const dataSources = await db.query(
                'SELECT * FROM notion_data_sources WHERE user_id = ? AND database_id = ?',
                [req.user.id, database.database_id]
            );

            for (const source of dataSources) {
                let fields = [];

                if (source.name) {
                    try {
                        const tableName = NotionClient.generateTableName(req.user.id, source.name);
                        const tableCheck = await db.query(
                            'SELECT COUNT(*) as exists_count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
                            [tableName]
                        );

                        if (tableCheck[0].exists_count > 0) {
                            const columns = await db.query(`SHOW COLUMNS FROM \`${tableName}\``);
                            fields = columns
                                .map(c => c.Field)
                                .filter(name => name !== 'notion_id' && name !== 'synced_at');
                        }
                    } catch (e) {
                        fields = [];
                    }
                }

                allDataSources.push({
                    ...source,
                    fields
                });
            }
        }

        res.json({ success: true, data: allDataSources });
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

        // 4. 后台触发所有页面的内容同步 (不等待结果)
        SyncEngine.syncWorkspacePageDetails(req.user.id).catch(err => {
            console.error('Background detail sync trigger error:', err);
        });

        res.json({ success: true, message: '工作区列表同步完成，正在后台同步详细内容', count: allResults.length });
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

        // 默认过滤掉未命名的页面和数据库
        sql += ` AND title NOT IN ('未命名页面', '未命名数据库', '未命名')`;

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
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

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
            // 即使未同步内容，也尝试获取标题和面包屑用于显示
            let title = '工作区页面分析';
            let breadcrumbs = [];
            try {
                const workspaceTableName = `user_${req.user.id}_workspace_objects`;
                const objectRows = await db.query(`SELECT title FROM \`${workspaceTableName}\` WHERE object_id = ? OR REPLACE(object_id, '-', '') = ?`, [pageId, normalizedPageId]);
                if (objectRows.length > 0) {
                    title = objectRows[0].title;
                }
                breadcrumbs = await getBreadcrumbsFromDb(req.user.id, pageId);
            } catch (e) {}

            return res.json({
                success: true,
                data: [],
                synced: false,
                title,
                breadcrumbs,
                message: '该页面尚未同步'
            });
        }

        // 获取根节点总数
        const rootRows = rows.filter(row => normalizeId(row.parent_id) === normalizedPageId);
        const totalRootBlocks = rootRows.length;

        const buildTree = (parentId, allRows) => {
            const normalizedParentId = normalizeId(parentId);
            return allRows
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
                        children: buildTree(row.block_id, allRows)
                    };
                });
        };

        const pagedRootRows = rootRows.slice(offset, offset + limit);
        const blocks = pagedRootRows.map(row => {
            let content;
            try {
                content = typeof row.content === 'string' ? JSON.parse(row.content) : row.content;
            } catch (e) {
                content = row.content;
            }
            return {
                ...content,
                children: buildTree(row.block_id, rows)
            };
        });

        // 获取页面标题与面包屑 (改用本地数据库获取)
        const workspaceTableName = `user_${req.user.id}_workspace_objects`;
        let title = '工作区页面分析';
        let breadcrumbs = [];
        try {
            const objectRows = await db.query(`SELECT title FROM \`${workspaceTableName}\` WHERE object_id = ? OR REPLACE(object_id, '-', '') = ?`, [pageId, normalizedPageId]);
            if (objectRows.length > 0) {
                title = objectRows[0].title;
            }
            // 改用本地函数，避免调用 Notion API
            breadcrumbs = await getBreadcrumbsFromDb(req.user.id, pageId);
        } catch (e) {
            console.error('Fetch title and breadcrumbs error:', e);
        }

        res.json({
            success: true,
            data: blocks,
            synced: true,
            title,
            breadcrumbs,
            pagination: {
                total: totalRootBlocks,
                offset,
                limit,
                has_more: offset + limit < totalRootBlocks
            }
        });
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
        const count = await SyncEngine.syncPageContent(req.user.id, pageId, notion, detailTableName);

        res.json({ success: true, message: '同步完成', count: count });
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

        // 1. 获取数据库/数据源基本结构
        let database = null;
        try {
            database = await notion.getDatabase(databaseId);
        } catch (e) {
            console.log(`Failed to get database info for ${databaseId}, trying as data source...`);
        }

        // 2. 尝试获取实时数据
        let data = { results: [] };
        try {
            // 优先尝试调用 data_sources 接口 (符合用户最新需求)
            console.log(`Querying data_source: ${databaseId}`);
            data = await notion.queryDataSource(databaseId, { page_size: 50 });
        } catch (e) {
            console.log(`data_sources query failed for ${databaseId}, falling back to databases query...`);
            try {
                // 如果 data_sources 失败，回退到标准的 databases 接口
                data = await notion.queryDatabase(databaseId, { page_size: 50 });
            } catch (e2) {
                console.error('All query attempts failed:', e2.message);
                // 如果都失败了，抛出原始错误
                throw e;
            }
        }

        res.json({
            success: true,
            database: database || { title: [{ plain_text: '未知数据库' }] },
            results: data.results || [],
            has_more: data.has_more || false,
            next_cursor: data.next_cursor || null
        });
    } catch (error) {
        console.error('Realtime preview error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 图表预览接口
 * POST /api/charts/preview
 */
router.post('/charts/preview', authenticate, async (req, res) => {
    const { dataSource, xAxis, yAxis, type, aggregation, timeRange, filters } = req.body;
    
    try {
        // 验证参数
        if (!dataSource || !xAxis || !yAxis) {
            return res.status(400).json({ 
                success: false, 
                message: '缺少必要参数：数据源、X轴字段、Y轴字段' 
            });
        }

        // 获取数据源信息
        const dataSourceInfo = await db.query(
            'SELECT * FROM notion_data_sources WHERE id = ? AND user_id = ?',
            [dataSource, req.user.id]
        );
        
        if (dataSourceInfo.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: '数据源不存在或无权限访问' 
            });
        }

        const source = dataSourceInfo[0];
        const tableName = NotionClient.generateTableName(req.user.id, source.name);

        // 检查表是否存在
        const tableCheck = await db.query(
            "SELECT COUNT(*) as exists_count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
            [tableName]
        );
        
        if (tableCheck[0].exists_count === 0) {
            return res.status(404).json({ 
                success: false, 
                message: '数据表不存在，请先同步数据' 
            });
        }

        // 获取列信息
        const columns = await db.query(`SHOW COLUMNS FROM \`${tableName}\``);
        const columnNames = columns.map(col => col.Field);
        
        // 验证字段是否存在
        if (!columnNames.includes(xAxis) || !columnNames.includes(yAxis)) {
            return res.status(400).json({ 
                success: false, 
                message: '指定的X轴或Y轴字段不存在' 
            });
        }

        // 构建查询
        let timeFilter = '';
        let timeFilterParams = [];
        
        if (timeRange && timeRange !== 'all') {
            const days = timeRange === '7d' ? 7 : 
                        timeRange === '30d' ? 30 : 
                        timeRange === '90d' ? 90 : 
                        timeRange === '1y' ? 365 : 30;
            
            timeFilter = `WHERE \`${xAxis}\` >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`;
            timeFilterParams = [days];
        }

        // 添加其他过滤器
        let filterConditions = [];
        let filterParams = [];
        
        if (filters && filters.length > 0) {
            filters.forEach(filter => {
                if (filter.field && filter.operator && filter.value) {
                    let operator = '=';
                    switch (filter.operator) {
                        case 'equals': operator = '='; break;
                        case 'not_equals': operator = '!='; break;
                        case 'greater_than': operator = '>'; break;
                        case 'less_than': operator = '<'; break;
                        case 'contains': operator = 'LIKE'; filter.value = `%${filter.value}%`; break;
                    }
                    filterConditions.push(`\`${filter.field}\` ${operator} ?`);
                    filterParams.push(filter.value);
                }
            });
        }

        // 组合WHERE条件
        let whereClause = timeFilter;
        if (filterConditions.length > 0) {
            const filterClause = filterConditions.join(' AND ');
            whereClause = timeFilter ? `${timeFilter} AND ${filterClause}` : `WHERE ${filterClause}`;
            timeFilterParams.push(...filterParams);
        }

        // 构建聚合查询
        let sql;
        let queryParams = [];
        
        switch (aggregation) {
            case 'sum':
                sql = `SELECT \`${xAxis}\` as x, COALESCE(SUM(\`${yAxis}\`), 0) as y FROM \`${tableName}\` ${whereClause} GROUP BY \`${xAxis}\` ORDER BY \`${xAxis}\``;
                queryParams = timeFilterParams;
                break;
            case 'avg':
                sql = `SELECT \`${xAxis}\` as x, COALESCE(AVG(\`${yAxis}\`), 0) as y FROM \`${tableName}\` ${whereClause} GROUP BY \`${xAxis}\` ORDER BY \`${xAxis}\``;
                queryParams = timeFilterParams;
                break;
            case 'count':
                sql = `SELECT \`${xAxis}\` as x, COUNT(*) as y FROM \`${tableName}\` ${whereClause} GROUP BY \`${xAxis}\` ORDER BY \`${xAxis}\``;
                queryParams = timeFilterParams;
                break;
            case 'max':
                sql = `SELECT \`${xAxis}\` as x, COALESCE(MAX(\`${yAxis}\`), 0) as y FROM \`${tableName}\` ${whereClause} GROUP BY \`${xAxis}\` ORDER BY \`${xAxis}\``;
                queryParams = timeFilterParams;
                break;
            case 'min':
                sql = `SELECT \`${xAxis}\` as x, COALESCE(MIN(\`${yAxis}\`), 0) as y FROM \`${tableName}\` ${whereClause} GROUP BY \`${xAxis}\` ORDER BY \`${xAxis}\``;
                queryParams = timeFilterParams;
                break;
            default:
                sql = `SELECT \`${xAxis}\` as x, COALESCE(SUM(\`${yAxis}\`), 0) as y FROM \`${tableName}\` ${whereClause} GROUP BY \`${xAxis}\` ORDER BY \`${xAxis}\``;
                queryParams = timeFilterParams;
        }

        // 执行查询
        const results = await db.query(sql, queryParams);

        // 格式化数据
        const chartData = results.map(row => ({
            name: row.x,
            value: Number(row.y)
        }));

        res.json({
            success: true,
            data: chartData,
            meta: {
                total: chartData.length,
                xAxis: xAxis,
                yAxis: yAxis,
                aggregation: aggregation,
                timeRange: timeRange
            }
        });

    } catch (error) {
        console.error('Chart preview error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

/**
 * 公开访问分享页面 (无需身份验证)
 * GET /api/public/shares/:token
 */
router.get('/public/shares/:token', async (req, res) => {
    const { token } = req.params;
    try {
        // 1. 查找分享配置
        const share = await db.query('SELECT * FROM page_shares WHERE share_token = ? AND is_active = 1', [token]);
        if (share.length === 0) {
            return res.status(404).json({ success: false, message: '分享链接无效或已关闭' });
        }

        const { page_id, user_id } = share[0];

        // 2. 获取该用户的 Notion API Key
        const configs = await db.getAllConfigs(user_id);
        const apiKey = configs.notion_api_key;
        if (!apiKey) {
            return res.status(500).json({ success: false, message: '该页面的分享配置已失效 (API Key 缺失)' });
        }

        const notion = new NotionClient(user_id, apiKey, configs.notion_version);

        // 3. 获取页面详情和内容块
        const page = await notion.getPage(page_id);
        const blocksResponse = await notion.getPageBlocks(page_id);

        // 提取标题
        let title = 'Untitled';
        if (page.properties) {
            // 尝试不同的属性名，Notion 页面标题可能是 'title' 或 'Name'
            const titleProp = page.properties.title || page.properties.Name;
            if (titleProp && titleProp.title) {
                title = titleProp.title.map(t => t.plain_text).join('');
            }
        }

        res.json({
            success: true,
            data: {
                id: page_id,
                title: title,
                blocks: blocksResponse.results
            }
        });
    } catch (error) {
        console.error('Public share access error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 获取页面的分享配置
 * GET /api/shares/:pageId
 */
router.get('/shares/:pageId', authenticate, async (req, res) => {
    const { pageId } = req.params;
    try {
        const share = await db.query('SELECT * FROM page_shares WHERE page_id = ? AND user_id = ?', [pageId, req.user.id]);
        res.json({
            success: true,
            data: share.length > 0 ? share[0] : null
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 切换页面分享状态
 * POST /api/shares/:pageId
 */
router.post('/shares/:pageId', authenticate, async (req, res) => {
    const { pageId } = req.params;
    const { is_active } = req.body;

    try {
        // 检查是否已有配置
        const existing = await db.query('SELECT * FROM page_shares WHERE page_id = ? AND user_id = ?', [pageId, req.user.id]);

        if (existing.length > 0) {
            await db.query('UPDATE page_shares SET is_active = ? WHERE id = ?', [is_active ? 1 : 0, existing[0].id]);
            const updated = await db.query('SELECT * FROM page_shares WHERE id = ?', [existing[0].id]);
            res.json({ success: true, data: updated[0] });
        } else {
            // 生成新 token
            const token = crypto.randomBytes(16).toString('hex');
            await db.query('INSERT INTO page_shares (page_id, user_id, share_token, is_active) VALUES (?, ?, ?, ?)',
                [pageId, req.user.id, token, is_active ? 1 : 0]);
            const created = await db.query('SELECT * FROM page_shares WHERE share_token = ?', [token]);
            res.json({ success: true, data: created[0] });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 获取 Notion 页面内容块 (已登录用户)
 * GET /api/notion/page/:pageId
 */
router.get('/notion/page/:pageId', authenticate, async (req, res) => {
    const { pageId } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    const cursor = req.query.cursor || undefined;

    try {
        const configs = await db.getAllConfigs(req.user.id);
        const apiKey = configs.notion_api_key;
        if (!apiKey) return res.status(400).json({ success: false, message: '未配置 Notion API Key' });

        const notion = new NotionClient(req.user.id, apiKey, configs.notion_version);

        // 1. 获取页面详情 (为了获取标题)
        const page = await notion.getPage(pageId);

        // 2. 获取内容块
        const blocksResponse = await notion.getPageBlocks(pageId, {
            page_size: limit,
            start_cursor: cursor
        });

        let title = 'Untitled';
        if (page.properties) {
            const titleProp = page.properties.title || page.properties.Name;
            if (titleProp && titleProp.title) {
                title = titleProp.title.map(t => t.plain_text).join('');
            }
        }

        res.json({
            success: true,
            synced: true,
            title: title,
            data: blocksResponse.results,
            pagination: {
                has_more: blocksResponse.has_more,
                next_cursor: blocksResponse.next_cursor
            }
        });
    } catch (error) {
        console.error('Fetch notion page error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 消费记录 · 最近一个月日支出总和
 * GET /api/charts/consumption/daily
 * 可选参数:
 * - days: 天数范围，默认 30
 * - databaseId: 指定 Notion 数据库 ID（优先）
 */
router.get('/charts/consumption/daily', authenticate, async (req, res) => {
    const days = parseInt(req.query.days) || 30;
    const databaseId = req.query.databaseId || null;

    try {
        // 1) 解析消费记录的数据源名称
        let dsName = null;
        if (databaseId) {
            const dsInfo = await db.query(
                'SELECT name FROM notion_data_sources WHERE database_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1',
                [databaseId, req.user.id]
            );
            if (dsInfo.length > 0) {
                dsName = dsInfo[0].name;
            }
        }
        if (!dsName) {
            const candidates = await db.query(
                "SELECT name FROM notion_data_sources WHERE user_id = ? AND (name LIKE '%消费%' OR name LIKE '%消費%' OR name LIKE '%xiaofei%' OR name LIKE '%xiao_fei%') ORDER BY created_at DESC LIMIT 1",
                [req.user.id]
            );
            if (candidates.length > 0) {
                dsName = candidates[0].name;
            }
        }
        if (!dsName) {
            return res.status(404).json({ success: false, message: '未找到消费记录数据源，请在同步配置中添加包含“消费”名称的数据库' });
        }

        // 2) 生成表名并检查是否存在
        const tableName = NotionClient.generateTableName(req.user.id, dsName);
        const tableCheck = await db.query(
            "SELECT COUNT(*) as exists_count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
            [tableName]
        );
        if (tableCheck[0].exists_count === 0) {
            return res.status(404).json({ success: false, message: `数据表 ${tableName} 不存在，请先执行同步` });
        }

        // 3) 获取列信息，推断金额与日期列
        const columns = await db.query(`SHOW COLUMNS FROM \`${tableName}\``);
        const pickByType = (typeRegex) => columns.filter(c => new RegExp(typeRegex, 'i').test(c.Type));
        const doubles = pickByType('double');
        const datetimes = pickByType('datetime|timestamp|date');

        const preferByName = (cands, names) => {
            const list = [...cands];
            list.sort((a, b) => {
                const sa = names.some(n => a.Field.includes(n)) ? 1 : 0;
                const sb = names.some(n => b.Field.includes(n)) ? 1 : 0;
                return sb - sa;
            });
            return list.length > 0 ? list[0] : null;
        };

        const amountCol = preferByName(doubles, ['金额', 'price', 'amount', '消费', 'jine']) || doubles[0];
        const preferredDateCol = columns.find(c => c.Field === 'xiao_fei_ri_qi');
        const dateCol = preferredDateCol || preferByName(datetimes, ['日期', 'date', '时间', 'time']) || datetimes[0];

        if (!amountCol || !dateCol) {
            return res.status(400).json({ success: false, message: '无法自动识别金额或日期字段，请确认消费记录表包含数字与日期列' });
        }

        // 4) 查询最近 N 天的日支出总和
        const sql = `
            SELECT DATE(\`${dateCol.Field}\`) AS day, COALESCE(SUM(\`${amountCol.Field}\`), 0) AS total
            FROM \`${tableName}\`
            WHERE \`${dateCol.Field}\` >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
            GROUP BY day
            ORDER BY day ASC
        `;
        const rows = await db.query(sql, [days]);

        const normalizeYmd = (d) => {
            const date = new Date(d);
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const dd = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${dd}`;
        };
        const map = new Map();
        rows.forEach(r => {
            const key = normalizeYmd(r.day);
            map.set(key, Number(r.total || 0));
        });
        const today = new Date();
        const start = new Date();
        start.setDate(today.getDate() - (days - 1));
        const full = [];
        for (let i = 0; i < days; i++) {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            const key = normalizeYmd(d);
            full.push({ day: key, total: map.get(key) ?? 0 });
        }

        res.json({
            success: true,
            data: full,
            meta: {
                table: tableName,
                amount_col: amountCol.Field,
                date_col: dateCol.Field,
                days
            }
        });
    } catch (error) {
        console.error('Consumption daily chart error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/charts/consumption/daily/details', authenticate, async (req, res) => {
    const date = req.query.date;
    const databaseId = req.query.databaseId || null;
    if (!date) {
        return res.status(400).json({ success: false, message: '缺少日期参数' });
    }
    try {
        let dsName = null;
        if (databaseId) {
            const dsInfo = await db.query(
                'SELECT name FROM notion_data_sources WHERE database_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1',
                [databaseId, req.user.id]
            );
            if (dsInfo.length > 0) dsName = dsInfo[0].name;
        }
        if (!dsName) {
            const candidates = await db.query(
                "SELECT name FROM notion_data_sources WHERE user_id = ? AND (name LIKE '%消费%' OR name LIKE '%消費%' OR name LIKE '%xiaofei%' OR name LIKE '%xiao_fei%') ORDER BY created_at DESC LIMIT 1",
                [req.user.id]
            );
            if (candidates.length > 0) dsName = candidates[0].name;
        }
        if (!dsName) {
            return res.status(404).json({ success: false, message: '未找到消费记录数据源' });
        }

        const tableName = NotionClient.generateTableName(req.user.id, dsName);
        const tableCheck = await db.query(
            "SELECT COUNT(*) as exists_count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
            [tableName]
        );
        if (tableCheck[0].exists_count === 0) {
            return res.status(404).json({ success: false, message: `数据表 ${tableName} 不存在` });
        }

        const columns = await db.query(`SHOW COLUMNS FROM \`${tableName}\``);
        const amountCol = columns.find(c => /double/i.test(c.Type)) || columns[0];
        const preferredDateCol = columns.find(c => c.Field === 'xiao_fei_ri_qi');
        const dateCol = preferredDateCol || columns.find(c => /(datetime|timestamp|date)/i.test(c.Type)) || columns[0];

        const sql = `
            SELECT * FROM \`${tableName}\`
            WHERE DATE(\`${dateCol.Field}\`) = ?
            ORDER BY \`${dateCol.Field}\` ASC
            LIMIT 500
        `;
        const rows = await db.query(sql, [date]);

        res.json({
            success: true,
            data: rows,
            meta: {
                table: tableName,
                amount_col: amountCol.Field,
                date_col: dateCol.Field,
                columns: columns.map(c => c.Field)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * 清空指定数据表的数据
 * DELETE /api/tables/:tableName/clear
 * 需要管理员权限或数据操作权限
 */
router.delete('/tables/:tableName/clear', authenticate, async (req, res) => {
    const { tableName } = req.params;
    
    try {
        // 权限验证 - 需要数据操作权限或管理员权限
        const hasDataPermission = await Auth.checkPermission(req.user.id, 'data:manage');
        const isAdmin = req.user.role === 'admin';
        
        if (!hasDataPermission && !isAdmin) {
            return res.status(403).json({ 
                success: false, 
                message: '无数据管理权限 (data:manage)' 
            });
        }

        // 安全检查：确保表名符合用户数据表的命名规范
        const userTablePrefix = `user_${req.user.id}_`;
        if (!tableName.startsWith(userTablePrefix)) {
            return res.status(400).json({ 
                success: false, 
                message: '只能清空用户自己的数据表' 
            });
        }

        // 检查表是否存在
        const tableCheck = await db.query(
            "SELECT COUNT(*) as exists_count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
            [tableName]
        );
        
        if (tableCheck[0].exists_count === 0) {
            return res.status(404).json({ 
                success: false, 
                message: `数据表 ${tableName} 不存在` 
            });
        }

        // 执行清空操作 - 使用 TRUNCATE 更快且重置自增ID
        await db.query(`TRUNCATE TABLE \`${tableName}\``);

        // 记录操作日志
        await db.query(
            'INSERT INTO api_logs (user_id, method, url, status_code, response_body, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
            [
                req.user.id, 
                'DELETE', 
                `/api/tables/${tableName}/clear`, 
                200, 
                JSON.stringify({ success: true, message: `表 ${tableName} 已清空` })
            ]
        );

        res.json({ 
            success: true, 
            message: `表 ${tableName} 已清空`, 
            table: tableName 
        });
        
    } catch (error) {
        console.error('Clear table error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

module.exports = router;
