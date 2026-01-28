# MySQL 初始化脚本

## 文件说明

### init.sql

数据库初始化脚本，包含以下表结构：

| 表名 | 说明 |
|------|------|
| `sync_databases` | 存储多个Notion数据库的同步配置 |
| `sync_logs` | 记录每次同步的执行情况 |
| `notion_sync` | 示例数据表（实际结构会根据Notion数据库字段动态生成） |

### user.sql

用户认证表初始化脚本，包含以下表结构：

| 表名 | 说明 |
|------|------|
| `users` | 用户账户表，存储用户注册信息 |
| `user_tokens` | 用户Token表，存储登录Token |

## 使用方法

### 1. 执行初始化脚本

```bash
# 在MySQL命令行中执行
mysql -u root -p < src/mysql/init.sql

# 或者在MySQL命令行中
source /path/to/notion-node/src/mysql/init.sql
```

### 2. 执行用户表初始化脚本

```bash
# 在MySQL命令行中执行
mysql -u root -p < src/mysql/user.sql

# 或者在MySQL命令行中
source /path/to/notion-node/src/mysql/user.sql
```

### 3. 添加新的数据库配置

```sql
USE notion_sync;

INSERT INTO sync_databases (notion_database_id, table_name, database_name, remark)
VALUES ('新的Notion数据库ID', '新表名', 'notion_sync', '备注说明');
```

### 4. 常用查询

```sql
-- 查看所有同步配置
SELECT * FROM sync_databases;

-- 查看同步日志
SELECT * FROM sync_logs ORDER BY created_at DESC LIMIT 100;

-- 查看特定数据库的同步历史
SELECT * FROM sync_logs WHERE notion_database_id = '你的数据库ID' ORDER BY created_at DESC;

-- 查看所有用户
SELECT id, username, email, status, created_at FROM users;
```

## 字段说明

### sync_databases 表

| 字段 | 说明 |
|------|------|
| `id` | 配置ID（自增） |
| `notion_database_id` | Notion数据库ID |
| `table_name` | MySQL表名 |
| `database_name` | 数据库名称 |
| `status` | 同步状态（active/inactive） |
| `sync_interval` | 同步间隔（秒） |
| `last_sync_at` | 上次同步时间 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |
| `remark` | 备注 |

### sync_logs 表

| 字段 | 说明 |
|------|------|
| `id` | 日志ID（自增） |
| `notion_database_id` | Notion数据库ID |
| `table_name` | MySQL表名 |
| `status` | 同步状态（success/failed） |
| `page_count` | 处理的页面数量 |
| `error_message` | 错误信息 |
| `duration_ms` | 执行耗时（毫秒） |
| `created_at` | 创建时间 |
