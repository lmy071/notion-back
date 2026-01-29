const axios = require('axios');
const db = require('./db');

class NotionClient {
    constructor(userId, apiKey, version = '2022-06-28') {
        this.userId = userId;
        this.apiKey = apiKey;
        this.version = version;
        this.baseUrl = 'https://api.notion.com/v1';
    }

    async request(method, path, data = null, params = null) {
        const url = `${this.baseUrl}${path}`;
        const headers = {
            'Authorization': `${this.apiKey}`,
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
     * 获取 Notion 数据库列结构
     */
    async getDatabase(databaseId) {
        return await this.request('GET', `/databases/${databaseId}`);
    }

    /**
     * 获取 Notion 数据库具体数据
     */
    async queryDatabase(databaseId, startCursor = null) {
        const data = {};
        if (startCursor) data.start_cursor = startCursor;
        return await this.request('POST', `/databases/${databaseId}/query`, data);
    }

    /**
     * 第三步：列结构转换 (Notion -> MySQL)
     * 将 Notion 的 properties 映射为 MySQL 字段定义
     */
    mapNotionToMysql(properties) {
        const columns = [];
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
                case 'multi_select':
                case 'status':
                case 'email':
                case 'phone_number':
                case 'url':
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
            // 字段名处理：特殊字符替换为下划线，避免 SQL 错误
            const cleanName = name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
            columns.push(`\`${cleanName}\` ${mysqlType}`);
        }
        return columns;
    }
}

module.exports = NotionClient;
