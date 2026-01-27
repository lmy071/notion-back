# Notion to MySQL 同步工具

基于 Node.js + TypeScript 开发的 Notion 数据库同步到 MySQL 工具。

## 功能

- 从 Notion API 获取数据库数据
- 自动分析 Notion 数据库结构并映射为 MySQL 表
- 支持自动创建表和字段兼容更新
- 幂等性同步（基于 Notion ID）
- 完整类型支持
- 环境变量配置

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件，填入配置：

```env
# Notion 配置
NOTION_INTEGRATION_TOKEN=your_secret_here
NOTION_DATABASE_ID=your_database_id

# MySQL 配置
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=notion_sync
```

### 3. 配置 Notion

1. 访问 https://www.notion.so/my-integrations 创建集成
2. 复制 Internal Integration Secret
3. 在目标数据库中添加集成到 Connections

### 4. 创建数据库

```sql
CREATE DATABASE notion_sync CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 5. 执行同步

```bash
# 编译
npm run build

# 执行同步
npm run sync

# 或开发模式直接运行
npm run dev
```

## 命令行选项

```bash
npm run sync --debug          # 调试模式
npm run sync --table my_data  # 指定表名
npm run sync --skip-validation # 跳过验证
```

## 字段映射

| Notion 类型 | MySQL 类型 |
|------------|-----------|
| title | VARCHAR(1000) |
| rich_text | VARCHAR(2000) |
| number | DECIMAL(20) |
| select | VARCHAR(100) |
| multi_select | JSON |
| date | DATETIME |
| checkbox | BOOLEAN |
| people | JSON |
| files | JSON |
| url | VARCHAR(2048) |

## 项目结构

```
src/
├── setting.ts       # Notion配置
├── mysql.ts         # MySQL配置
├── types.ts         # 类型定义
├── notionClient.ts  # Notion API客户端
├── mysqlClient.ts   # MySQL客户端
├── syncEngine.ts    # 同步引擎
└── notion2mysql.ts  # 主入口
```
