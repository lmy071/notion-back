const axios = require('axios');
const db = require('./db');
const { pinyin } = require('pinyin-pro');

class NotionClient {
    constructor(userId, apiKey, version = '2025-09-03') {
        this.userId = userId;
        this.apiKey = apiKey;
        this.version = version;
        this.baseUrl = 'https://api.notion.com/v1';
    }

    async request(method, path, data = null, params = null) {
        const url = `${this.baseUrl}${path}`;
        const headers = {
            'Authorization': this.apiKey.startsWith('ntn_') ? this.apiKey : `Bearer ${this.apiKey}`,
            'Notion-Version': this.version
        };

        const config = {
            method,
            url,
            headers,
            params
        };

        if (data && method !== 'GET') {
            config.data = data;
            headers['Content-Type'] = 'application/json';
        }

        let response;
        try {
            response = await axios(config);
            await db.logApiCall(this.userId, url, method, { data, params }, response.status, response.data, true, null);
            return response.data;
        } catch (error) {
            const status = error.response ? error.response.status : 500;
            const errorData = error.response ? error.response.data : error.message;
            await db.logApiCall(this.userId, url, method, { data, params }, status, errorData, false, error.message);
            throw error;
        }
    }

    /**
     * 第一步：获取数据库信息，从中提取 data_source_id
     */
    async getDatabase(databaseId) {
        return await this.request('GET', `/databases/${databaseId}`);
    }

    /**
     * 第二步：使用 data_source_id 获取数据库列结构
     */
    async getDataSourceStructure(dataSourceId) {
        return await this.request('GET', `/data_sources/${dataSourceId}`);
    }

    /**
     * 第三步：使用 data_source_id 获取 Notion 具体数据
     */
    async queryDataSource(dataSourceId, body = {}) {
        return await this.request('POST', `/data_sources/${dataSourceId}/query`, body);
    }

    /**
     * 获取页面详情
     */
    async getPage(pageId) {
        return await this.request('GET', `/pages/${pageId}`);
    }

    /**
     * 获取页面内容块
     */
    async getPageBlocks(blockId, params = {}) {
        return await this.request('GET', `/blocks/${blockId}/children`, null, params);
    }

    /**
     * 生成易读的表名：title的拼音 + 用户ID
     */
    static generateTableName(userId, title) {
        if (Array.isArray(title)) {
            title = title.map(t => t.plain_text || (t.text && t.text.content) || '').join('');
        }
        
        let cleanTitle = pinyin(title, { toneType: 'none', nonZh: 'consonant' })
            .replace(/\s+/g, '_')
            .replace(/[^a-zA-Z0-9_]/g, '_')
            .toLowerCase();
        
        // 过滤掉连续的下划线
        cleanTitle = cleanTitle.replace(/_+/g, '_').replace(/^_|_$/g, '');

        if (!cleanTitle || cleanTitle === '_') {
            cleanTitle = 'notion_data';
        }
        
        return `${cleanTitle}_${userId}`;
    }

    /**
     * 第三步：列结构转换 (Notion -> MySQL)
     * 将 Notion 的 properties 映射为 MySQL 字段定义
     * @returns {Object} { columns: string[], mapping: Object }
     */
    mapNotionToMysql(properties) {
        const columns = [];
        const mapping = {};
        const usedNames = new Set(['notion_id', 'synced_at']); // 预留系统字段名

        // 默认主键，使用 Notion 的 id
        columns.push('`notion_id` VARCHAR(64) PRIMARY KEY');
        
        for (const [name, prop] of Object.entries(properties)) {
            let mysqlType = 'TEXT';
            const type = prop.type;

            switch (type) {
                case 'number':
                    mysqlType = 'DOUBLE';
                    break;
                case 'checkbox':
                    mysqlType = 'TINYINT(1)';
                    break;
                case 'date':
                    mysqlType = 'DATETIME';
                    break;
                case 'select':
                    // 如果有选项，使用 ENUM
                    if (prop.select && prop.select.options && prop.select.options.length > 0) {
                        const options = prop.select.options.map(opt => `'${opt.name.replace(/'/g, "''")}'`).join(', ');
                        mysqlType = `ENUM(${options})`;
                    } else {
                        mysqlType = 'VARCHAR(255)';
                    }
                    break;
                case 'multi_select':
                case 'status':
                case 'email':
                case 'phone_number':
                case 'url':
                case 'created_by':
                case 'last_edited_by':
                    mysqlType = 'VARCHAR(255)';
                    break;
                case 'rich_text':
                case 'title':
                    mysqlType = 'TEXT';
                    break;
                case 'created_time':
                case 'last_edited_time':
                    mysqlType = 'TIMESTAMP';
                    break;
                default:
                    mysqlType = 'TEXT';
            }

            // 字段名处理：优先转换为拼音，特殊字符替换为下划线
            let cleanName = pinyin(name, { toneType: 'none', nonZh: 'consonant' })
                .replace(/\s+/g, '_')
                .replace(/[^a-zA-Z0-9_]/g, '_')
                .toLowerCase();
            
            // 如果转换后为空（例如全是特殊字符），回退到原始处理
            if (!cleanName || cleanName === '_') {
                cleanName = name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
            }
            
            // 处理重名列：如果列名已存在，追加数字后缀
            let finalName = cleanName;
            let counter = 1;
            while (usedNames.has(finalName)) {
                finalName = `${cleanName}_${counter}`;
                counter++;
            }
            usedNames.add(finalName);
            mapping[name] = finalName;

            columns.push(`\`${finalName}\` ${mysqlType}`);
        }
        return { columns, mapping };
    }
}

module.exports = NotionClient;
