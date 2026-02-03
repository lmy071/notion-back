const axios = require('axios');
const https = require('https');
const db = require('./db');
const { pinyin } = require('pinyin-pro');

class NotionClient {
    constructor(userId, apiKey, version = '2025-09-03') {
        this.userId = userId;
        this.apiKey = apiKey;
        this.version = version;
        this.baseUrl = 'https://api.notion.com/v1';
        
        // 创建专用的 axios 实例，避免全局状态污染
        // 增加 timeout 和 httpsAgent 配置，防止连接卡死或错误的连接池复用
        this.client = axios.create({
            baseURL: this.baseUrl,
            timeout: 30000, // 30秒超时
            httpsAgent: new https.Agent({
                keepAlive: true,
                keepAliveMsecs: 1000,
                maxSockets: 50,
                freeSocketTimeout: 30000,
            })
        });
    }

    async request(method, path, data = null, params = null) {
        const headers = {
            'Authorization': this.apiKey.startsWith('ntn_') ? this.apiKey : `Bearer ${this.apiKey}`,
            'Notion-Version': this.version
        };

        if (data && method !== 'GET') {
            headers['Content-Type'] = 'application/json';
        }

        const config = {
            method,
            url: path,
            headers,
            params,
            data
        };

        let response;
        try {
            response = await this.client(config);
            await db.logApiCall(this.userId, `${this.baseUrl}${path}`, method, { data, params }, response.status, response.data, true, null);
            return response.data;
        } catch (error) {
            const status = error.response ? error.response.status : (error.code === 'ECONNABORTED' ? 408 : 500);
            const errorData = error.response ? error.response.data : error.message;
            
            // 记录详细的错误日志
            console.error(`[Notion API Error] ${method} ${path}:`, error.message);
            if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
                console.error(`[Notion API Connection Error] Target: ${error.address}:${error.port}`);
            }

            await db.logApiCall(this.userId, `${this.baseUrl}${path}`, method, { data, params }, status, errorData, false, error.message);
            throw error;
        }
    }

    /**
     * 获取单个页面详情
     */
    async getPage(pageId) {
        return await this.request('GET', `/pages/${pageId}`);
    }

    /**
     * 获取层级面包屑 (递归向上查找)
     */
    async getBreadcrumbs(objectId, objectType = 'page') {
        const breadcrumbs = [];
        let currentId = objectId;
        let currentType = objectType;

        try {
            while (currentId) {
                let currentObj;
                if (currentType === 'page') {
                    currentObj = await this.getPage(currentId);
                } else if (currentType === 'database') {
                    currentObj = await this.getDatabase(currentId);
                } else {
                    break;
                }

                // 提取标题
                let title = '未命名';
                if (currentObj.object === 'page') {
                    const titleProp = Object.values(currentObj.properties).find(p => p.type === 'title');
                    title = titleProp?.title?.[0]?.plain_text || '未命名页面';
                } else if (currentObj.object === 'database') {
                    title = currentObj.title?.[0]?.plain_text || '未命名数据库';
                }

                breadcrumbs.unshift({
                    id: currentId,
                    type: currentType,
                    title: title
                });

                // 查找父级
                const parent = currentObj.parent;
                if (parent && parent.type === 'page_id') {
                    currentId = parent.page_id;
                    currentType = 'page';
                } else if (parent && parent.type === 'database_id') {
                    currentId = parent.database_id;
                    currentType = 'database';
                } else if (parent && parent.type === 'workspace') {
                    // 到达工作区顶层
                    break;
                } else {
                    break;
                }

                // 限制层级深度，防止死循环或过长请求
                if (breadcrumbs.length > 5) break;
            }
        } catch (error) {
            console.error('Error fetching breadcrumbs:', error.message);
        }

        return breadcrumbs;
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
     * 直接查询数据库内容 (实时预览)
     */
    async queryDatabase(databaseId, body = {}) {
        return await this.request('POST', `/databases/${databaseId}/query`, body);
    }

    /**
     * 搜索 Notion 中的页面和数据库
     */
    async search(query = '', cursor = undefined, pageSize = 100) {
        const body = {
            query,
            sort: {
                direction: 'descending',
                timestamp: 'last_edited_time'
            },
            page_size: pageSize
        };
        if (cursor) {
            body.start_cursor = cursor;
        }
        return await this.request('POST', '/search', body);
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
     * 第四步：递归获取页面所有 Block
     */
    async getPageBlocksRecursive(blockId) {
        let allBlocks = [];
        let hasMore = true;
        let cursor = undefined;

        while (hasMore) {
            const response = await this.request('GET', `/blocks/${blockId}/children`, null, {
                start_cursor: cursor,
                page_size: 100
            });

            const blocks = response.results;

            for (const block of blocks) {
                if (block.has_children) {
                    block.children = await this.getPageBlocksRecursive(block.id);
                }
                allBlocks.push(block);
            }

            hasMore = response.has_more;
            cursor = response.next_cursor;
        }

        return allBlocks;
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
