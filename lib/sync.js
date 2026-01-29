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
            targets = await db.query('SELECT * FROM notion_sync_targets WHERE user_id = ? AND database_id = ?', [userId, targetDatabaseId]);
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
