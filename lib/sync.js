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

                // 第一步：获取数据库信息，提取 data_source_id
                const dbInfo = await notion.getDatabase(databaseId);
                if (!dbInfo.data_sources || dbInfo.data_sources.length === 0) {
                    throw new Error(`No data_sources found for database ${databaseId}`);
                }
                const dataSourceId = dbInfo.data_sources[0].id;

                // 第二步：获取数据源列结构
                const structure = await notion.getDataSourceStructure(dataSourceId);
                const properties = structure.properties;

                // 第三步：列结构转换并创建/更新 MySQL 表
                const tableName = `user_${userId}_notion_data_${databaseId.replace(/-/g, '_')}`;
                const columns = notion.mapNotionToMysql(properties);
                
                const createTableSql = `CREATE TABLE IF NOT EXISTS \`${tableName}\` (
                    ${columns.join(', ')},
                    \`synced_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;
                
                await db.query(createTableSql);

                // 第四步：获取数据源具体数据
                const dataResponse = await notion.queryDataSource(dataSourceId);
                const records = dataResponse.results;

                // 第五步：数据存储（增量同步）
                let successCount = 0;
                for (const record of records) {
                    const notionId = record.id;
                    const propValues = record.properties;
                    
                    const insertData = { notion_id: notionId };
                    for (const [name, prop] of Object.entries(propValues)) {
                        const cleanName = name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
                        insertData[cleanName] = SyncEngine.extractValue(prop);
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
                return value.start;
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
                return value;
            default:
                return JSON.stringify(value);
        }
    }
}

module.exports = SyncEngine;
