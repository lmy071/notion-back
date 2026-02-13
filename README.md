# Notion Sync - 数据同步与API服务

一个基于 Node.js 的 Notion 数据同步和 API 服务，支持数据可视化、用户管理、权限控制等功能。

## ✨ 核心功能

### 📊 图表管理 API
- **图表 CRUD**: 创建、读取、更新、删除图表配置
- **权限控制**: 基于用户和角色的图表访问权限
- **动态查询**: 支持多种数据聚合和筛选条件
- **数据预览**: 实时生成图表数据

### 🔄 数据同步
- **自动同步**: 定时从 Notion 同步数据到 MySQL
- **增量更新**: 只同步变更的数据
- **数据验证**: 确保数据完整性和准确性
- **错误处理**: 完善的同步错误处理机制

### 👥 用户管理
- **用户认证**: 基于用户 ID 的简单认证机制
- **权限验证**: 角色基础的访问控制
- **个人配置**: 用户个性化设置管理

### 🛡️ 安全特性
- **SQL 注入防护**: 使用参数化查询和字段转义
- **权限验证**: 所有 API 都需要用户认证
- **错误处理**: 统一的错误响应格式

## 🚀 快速开始

### 环境要求

- Node.js 16+
- MySQL 5.7+
- Notion Integration Token

### 安装依赖

```bash
npm install
```

### 配置环境变量

创建 `.env.dev` 文件：
```env
DB_HOST=your_database_host
DB_USER=your_database_user
DB_PASSWORD=your_database_password
DB_DATABASE=notion_sync
DB_PORT=3306
NOTION_API_KEY=your_notion_integration_token
```

### 初始化数据库

```bash
# 运行数据库初始化脚本
mysql -u your_user -p < mysql/init.sql
node scripts/init_charts_table.js
```

### 启动服务

```bash
# 开发模式
npm run dev

# 生产模式
npm run serve
```

## 📁 项目结构

```
notion-sync/
├── routes/               # API 路由
│   ├── charts.js        # 图表管理 API
│   ├── api.js           # 数据同步 API
│   ├── users.js         # 用户管理 API
│   └── index.js         # 根路由
├── lib/                  # 核心库
│   ├── db.js            # 数据库连接池
│   ├── auth.js          # 认证逻辑
│   ├── constants.js     # 常量定义
│   ├── sync.js          # 数据同步逻辑
│   ├── notion.js        # Notion API 封装
│   └── scheduler.js     # 定时任务调度
├── scripts/              # 工具脚本
│   ├── init_charts_table.js    # 图表表初始化
│   ├── test_sync.js     # 同步测试
│   └── auto-commit.js   # 自动提交脚本
├── mysql/                # SQL 脚本
│   ├── init.sql         # 数据库初始化
│   └── data_sources.sql # 数据源配置
├── bin/                  # 启动脚本
│   └── www               # 应用入口
├── app.js                # Express 应用配置
└── package.json          # 项目依赖
```

## 🔧 API 接口详解

### 图表管理 API

#### 获取图表列表
```http
GET /api/charts
Headers: x-user-id: {user_id}
```

#### 获取单个图表
```http
GET /api/charts/:id
Headers: x-user-id: {user_id}
```

#### 创建图表
```http
POST /api/charts
Headers: x-user-id: {user_id}
Content-Type: application/json

{
  "title": "消费趋势图",
  "description": "最近30天的消费趋势",
  "type": "line",
  "dataSource": "xiao_fei_ji_lu_2",
  "xAxis": "xiao_fei_ri_qi",
  "yAxis": "jin_e",
  "aggregation": "sum",
  "timeRange": "30d",
  "filters": [],
  "permissions": {
    "visibility": "private"
  },
  "styling": {}
}
```

#### 更新图表
```http
PUT /api/charts/:id
Headers: x-user-id: {user_id}
Content-Type: application/json
```

#### 删除图表
```http
DELETE /api/charts/:id
Headers: x-user-id: {user_id}
```

#### 预览图表数据
```http
POST /api/charts/preview
Headers: x-user-id: {user_id}
Content-Type: application/json

{
  "dataSource": "xiao_fei_ji_lu_2",
  "xAxis": "xiao_fei_ri_qi",
  "yAxis": "jin_e",
  "aggregation": "sum",
  "timeRange": "30d"
}
```

### 数据同步 API

#### 获取同步状态
```http
GET /api/sync/status
```

#### 触发数据同步
```http
POST /api/sync/trigger
```

#### 获取数据表内容
```http
GET /api/data/:table
```

## 📊 图表功能详解

### 支持的图表类型
- **line**: 折线图
- **bar**: 柱状图
- **pie**: 饼图
- **scatter**: 散点图

### 数据聚合方式
- **sum**: 求和
- **avg**: 平均值
- **count**: 计数
- **max**: 最大值
- **min**: 最小值

### 时间范围格式
- **7d**: 最近7天
- **30d**: 最近30天
- **90d**: 最近90天
- **1y**: 最近1年

### 权限级别
- **private**: 私有，只有创建者可访问
- **shared**: 共享，指定用户或角色可访问
- **public**: 公开，所有用户都可访问

## 🔒 安全机制

### 认证方式
所有 API 请求都需要在 Header 中包含：
```http
x-user-id: {user_id}
```

### 权限验证
- **图表权限**: 只有创建者可以编辑和删除图表
- **数据权限**: 基于用户角色的数据访问控制
- **API 权限**: 所有接口都需要有效用户认证

### 数据安全
- **SQL 注入防护**: 使用 `mysql2.escapeId()` 转义标识符
- **参数验证**: 所有输入参数都进行格式验证
- **错误处理**: 统一的错误响应，不暴露敏感信息

## 🛠️ 开发指南

### 添加新的 API 路由
1. 在 `routes/` 目录下创建新的路由文件
2. 使用 `authenticate` 中间件进行用户认证
3. 使用 `checkChartAccess` 函数验证权限
4. 在 `app.js` 中注册新路由

### 数据库操作
```javascript
const db = require('../lib/db');

// 查询数据
const results = await db.query('SELECT * FROM table WHERE id = ?', [id]);

// 插入数据
const result = await db.query('INSERT INTO table (name) VALUES (?)', [name]);

// 更新数据
await db.query('UPDATE table SET name = ? WHERE id = ?', [name, id]);

// 删除数据
await db.query('DELETE FROM table WHERE id = ?', [id]);
```

### 错误处理
```javascript
try {
  // 业务逻辑
} catch (error) {
  console.error('Error description:', error);
  res.status(500).json({ 
    success: false, 
    message: '用户友好的错误信息',
    error: error.message 
  });
}
```

## 📈 性能优化

### 数据库优化
- 使用连接池管理数据库连接
- 合理使用索引提高查询效率
- 避免 N+1 查询问题

### API 优化
- 使用分页处理大量数据
- 缓存频繁访问的数据
- 压缩响应数据减少传输量

## 🔍 调试与监控

### 日志记录
- 使用 `console.error()` 记录错误信息
- 使用 `console.log()` 记录关键操作
- 生产环境建议使用专业的日志服务

### 调试技巧
- 在响应中包含 `_sql` 字段查看生成的 SQL
- 使用 `try-catch` 捕获并处理所有异常
- 添加详细的错误描述信息

## 🤝 贡献指南

1. Fork 本项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

## 📄 许可证

本项目基于 MIT 许可证开源。

## 🙏 致谢

- [Express.js](https://expressjs.com/) - 灵活的 Node.js Web 框架
- [MySQL2](https://github.com/sidorares/node-mysql2) - 快速的 MySQL 驱动
- [Node.js](https://nodejs.org/) - 强大的 JavaScript 运行时
- [Notion API](https://developers.notion.com/) - 提供丰富的数据源

---

**⭐ 如果这个项目对您有帮助，请给我们一个 Star！**