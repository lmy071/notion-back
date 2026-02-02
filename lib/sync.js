const db = require('./db');
const NotionClient = require('./notion');
const Auth = require('./auth');

class SyncEngine {
    /**
     * 执行同步任务
     * @param {number} userId 执行该任务的用户 ID
     * @param {string} targetDatabaseId 可选，指定同步的数据库 ID，如果不传则同步所有启用的数据库
     */
    static async run(userId, targetDatabaseId = null) {
        // 权限验证
        const hasPermission = await Auth.checkPermission(userId, 'sync:notion');
        if (!hasPermission) {
            const msg = 'Permission denied: User does not have sync:notion permission';
            console.error(msg);
            throw new Error(msg);
        }

        // 获取全局配置 (API Key)
        const configs = await db.getAllConfigs(userId);
        const apiKey = configs.notion_api_key;
        const notionVersion = configs.notion_version || '2022-06-28';

        if (!apiKey) {
            throw new Error('Notion API key not configured for this user');
        }

        // 获取需要同步的数据库列表
        let targets = [];
        if (targetDatabaseId) {
            targets = await db.query('SELECT * FROM notion_sync_targets WHERE user_id = ? AND database_id = ? AND status = 1', [userId, targetDatabaseId]);
        } else {
            targets = await db.query('SELECT * FROM notion_sync_targets WHERE user_id = ? AND status = 1', [userId]);
        }

        if (targets.length === 0) {
            return { success: true, count: 0, message: 'No targets to sync' };
        }

        const notion = new NotionClient(userId, apiKey, notionVersion);
        const results = [];

        for (const target of targets) {
            try {
                const databaseId = target.database_id;

                // 第一步：获取数据库信息，提取 data_sources
                const dbInfo = await notion.getDatabase(databaseId);
                if (!dbInfo.data_sources || dbInfo.data_sources.length === 0) {
                    throw new Error(`No data_sources found for database ${databaseId}`);
                }

                // 将获取到的 data_sources 存储在数据库中，并与用户关联
                for (const ds of dbInfo.data_sources) {
                    await db.query(`
                        INSERT INTO notion_data_sources (user_id, database_id, data_source_id, name)
                        VALUES (?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE name = VALUES(name)
                    `, [userId, databaseId, ds.id, ds.name]);
                }

                // 对于单一数据源的数据库，通常使用第一个即可
                const dataSourceId = dbInfo.data_sources[0].id;

                // 第二步：获取数据源列结构
                const structure = await notion.getDataSourceStructure(dataSourceId);
                const properties = structure.properties;
                const dsTitle = structure.title || dbInfo.title || 'notion_data';

                // 第三步：列结构转换并创建/更新 MySQL 表
                const tableName = NotionClient.generateTableName(userId, dsTitle);
                const { columns, mapping } = notion.mapNotionToMysql(properties);
                
                const createTableSql = `CREATE TABLE IF NOT EXISTS \`${tableName}\` (
                    ${columns.join(', ')},
                    \`synced_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;
                
                await db.query(createTableSql);

                // 第四步 & 第五步：循环获取并存储数据（处理分页）
                let hasMore = true;
                let nextCursor = null;
                let successCount = 0;

                while (hasMore) {
                    const queryBody = { page_size: 100 }; // 默认每页 100 条
                    if (nextCursor) {
                        queryBody.start_cursor = nextCursor;
                    }

                    const dataResponse = await notion.queryDataSource(dataSourceId, queryBody);
                    const records = dataResponse.results;

                    for (const record of records) {
                        const notionId = record.id;
                        const propValues = record.properties;
                        
                        const insertData = { notion_id: notionId };
                        for (const [name, prop] of Object.entries(propValues)) {
                            const mysqlColumnName = mapping[name];
                            if (mysqlColumnName) {
                                insertData[mysqlColumnName] = SyncEngine.extractValue(prop);
                            }
                        }

                        const keys = Object.keys(insertData);
                        const placeholders = keys.map(() => '?').join(', ');
                        const updates = keys.filter(k => k !== 'notion_id').map(k => `\`${k}\` = VALUES(\`${k}\`)`).join(', ');
                        
                        const syncSql = `INSERT INTO \`${tableName}\` (${keys.map(k => `\`${k}\``).join(', ')}) 
                                         VALUES (${placeholders}) 
                                         ON DUPLICATE KEY UPDATE ${updates}`;
                        
                        await db.query(syncSql, Object.values(insertData));
                        successCount++;
                    }

                    hasMore = dataResponse.has_more;
                    nextCursor = dataResponse.next_cursor;
                    
                    if (hasMore) {
                        console.log(`[Sync] Database ${databaseId} has more data, fetching next page...`);
                    }
                }

                // 更新最后同步时间
                await db.query('UPDATE notion_sync_targets SET last_sync_at = NOW() WHERE id = ?', [target.id]);

                results.push({ databaseId, success: true, count: successCount });

            } catch (error) {
                console.error(`Sync failed for database ${target.database_id}:`, error);
                results.push({ databaseId: target.database_id, success: false, error: error.message });
            }
        }

        return { success: true, results };
    }

    /**
     * 同步整个工作区所有页面的具体内容块
     */
    static async syncWorkspacePageDetails(userId) {
        try {
            console.log(`[Sync] Starting background detail sync for user ${userId}...`);
            
            // 1. 获取配置
            const configs = await db.getAllConfigs(userId);
            const apiKey = configs.notion_api_key;
            const notionVersion = configs.notion_version || '2025-09-03';
            
            if (!apiKey) {
                console.error(`[Sync] API Key not found for user ${userId}, detail sync aborted.`);
                return;
            }

            const notion = new NotionClient(userId, apiKey, notionVersion);
            const workspaceTableName = `user_${userId}_workspace_objects`;
            const detailTableName = `user_${userId}_workspace_details`;

            // 2. 检查工作区列表表是否存在
            const tableCheck = await db.query(
                "SELECT COUNT(*) as exists_count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
                [workspaceTableName]
            );
            
            if (tableCheck[0].exists_count === 0) {
                console.log(`[Sync] Workspace table ${workspaceTableName} does not exist, detail sync aborted.`);
                return;
            }

            // 3. 确保详情表存在
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

            // 4. 获取所有页面
            const pages = await db.query(`SELECT object_id FROM \`${workspaceTableName}\` WHERE type = 'page'`);
            console.log(`[Sync] Found ${pages.length} pages to sync details for user ${userId}.`);

            for (const page of pages) {
                const pageId = page.object_id;
                try {
                    console.log(`[Sync] Syncing details for page ${pageId}...`);
                    const blocks = await notion.getPageBlocksRecursive(pageId);
                    
                    // 清理旧数据并写入新数据
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
                    console.log(`[Sync] Page ${pageId} synced with ${flatData.length} blocks.`);
                } catch (pageErr) {
                    console.error(`[Sync] Failed to sync page ${pageId}:`, pageErr.message);
                }
            }
            console.log(`[Sync] Background detail sync completed for user ${userId}.`);
        } catch (error) {
            console.error(`[Sync] Critical error in syncWorkspacePageDetails:`, error);
        }
    }

    /**
     * 从 Notion 属性中提取实际值
     */
    static extractValue(prop) {
        const type = prop.type;
        const value = prop[type];

        if (!value) return null;

        const formatMysqlDate = (isoString) => {
            if (!isoString) return null;
            try {
                const date = new Date(isoString);
                if (isNaN(date.getTime())) return isoString;
                return date.toISOString().slice(0, 19).replace('T', ' ');
            } catch (e) {
                return isoString;
            }
        };

        switch (type) {
            case 'title':
            case 'rich_text':
                return value.map(t => t.plain_text).join('');
            case 'number':
                return value;
            case 'select':
                return value.name;
            case 'multi_select':
                return value.map(s => s.name).join(', ');
            case 'date':
                return formatMysqlDate(value.start);
            case 'checkbox':
                return value ? 1 : 0;
            case 'status':
                return value.name;
            case 'email':
            case 'phone_number':
            case 'url':
                return value;
            case 'created_time':
            case 'last_edited_time':
                return formatMysqlDate(value);
            case 'created_by':
            case 'last_edited_by':
                return value.name || value.id;
            default:
                return JSON.stringify(value);
        }
    }
}

module.exports = SyncEngine;
