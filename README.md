# Notion to MySQL 同步工具

基于 Node.js + TypeScript 开发的 Notion 数据库同步到 MySQL 工具。

## 功能

- 从 Notion API 获取数据库数据
- 自动分析 Notion 数据库结构并映射为 MySQL 表
- 支持自动创建表和字段兼容更新
- 幂等性同步（基于 Notion ID）
- 完整类型支持
- 环境变量配置
- 用户注册和登录认证
- Token-based 身份验证

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
├── userService.ts   # 用户服务
├── authMiddleware.ts # 认证中间件
├── routes/
│   ├── sync.ts      # 同步API路由
│   └── user.ts      # 用户认证API路由
└── notion2mysql.ts  # 主入口
```

## 用户认证API

所有接口_BASE_URL_为 `http://localhost:3000`

### 环境变量配置

在 `.env` 文件中添加以下配置：

```env
# JWT配置
JWT_SECRET=your_jwt_secret_key
JWT_ACCESS_EXPIRES_IN=86400000      # Access Token有效期（毫秒）
JWT_REFRESH_EXPIRES_IN=604800000    # Refresh Token有效期（毫秒）
TOKEN_PREFIX=ns_                    # Token前缀
```

### 1. 用户注册

注册新用户。

**请求**

```
POST /api/user/register
Content-Type: application/json

{
  "username": "testuser",
  "email": "test@example.com",
  "password": "password123"
}
```

**响应（201 Created）**

```json
{
  "success": true,
  "message": "注册成功",
  "data": {
    "user": {
      "id": 1,
      "username": "testuser",
      "email": "test@example.com",
      "status": "active",
      "created_at": "2026-01-28T10:00:00.000Z",
      "updated_at": "2026-01-28T10:00:00.000Z",
      "last_login_at": null
    }
  }
}
```

**错误响应（400/409）**

```json
{
  "success": false,
  "message": "用户名或邮箱已被注册",
  "code": "USER_EXISTS"
}
```

### 2. 用户登录

用户登录并获取Token。

**请求**

```
POST /api/user/login
Content-Type: application/json

{
  "username": "testuser",
  "password": "password123"
}
```

**响应（200 OK）**

```json
{
  "success": true,
  "message": "登录成功",
  "data": {
    "user": {
      "id": 1,
      "username": "testuser",
      "email": "test@example.com",
      "status": "active",
      "created_at": "2026-01-28T10:00:00.000Z",
      "updated_at": "2026-01-28T10:00:00.000Z",
      "last_login_at": "2026-01-28T10:30:00.000Z"
    },
    "accessToken": "ns_xxx.yyy.zzz",
    "refreshToken": "ns_aaa.bbb.ccc"
  }
}
```

**Cookie**: 服务器会在客户端设置 `accessToken` cookie

### 3. 用户登出

用户登出，撤销Token。

**请求**

```
POST /api/user/logout
Authorization: Bearer <accessToken>
```

**响应（200 OK）**

```json
{
  "success": true,
  "message": "登出成功"
}
```

### 4. 获取用户信息

获取当前登录用户的信息（需要认证）。

**请求**

```
GET /api/user/profile
Authorization: Bearer <accessToken>
```

**响应（200 OK）**

```json
{
  "success": true,
  "data": {
    "user": {
      "id": 1,
      "username": "testuser",
      "email": "test@example.com",
      "status": "active",
      "created_at": "2026-01-28T10:00:00.000Z",
      "updated_at": "2026-01-28T10:00:00.000Z",
      "last_login_at": "2026-01-28T10:30:00.000Z"
    }
  }
}
```

### 5. 验证Token

验证Token是否有效（需要认证）。

**请求**

```
GET /api/user/verify
Authorization: Bearer <accessToken>
```

**响应（200 OK）**

```json
{
  "success": true,
  "message": "Token有效",
  "data": {
    "valid": true,
    "user": {
      "id": 1,
      "username": "testuser",
      "email": "test@example.com"
    }
  }
}
```

### 6. 刷新Token

使用Refresh Token获取新的Access Token。

**请求**

```
POST /api/user/refresh
Content-Type: application/json

{
  "refreshToken": "ns_aaa.bbb.ccc"
}
```

**响应（200 OK）**

```json
{
  "success": true,
  "message": "Token刷新成功",
  "data": {
    "accessToken": "ns_new.xxx.yyy.zzz"
  }
}
```

### 7. 获取指定用户信息

获取指定用户的信息（需要认证）。

**请求**

```
GET /api/user/info?id=1
Authorization: Bearer <accessToken>
```

**响应（200 OK）**

```json
{
  "success": true,
  "data": {
    "user": {
      "id": 1,
      "username": "testuser",
      "email": "test@example.com",
      "status": "active",
      "created_at": "2026-01-28T10:00:00.000Z",
      "updated_at": "2026-01-28T10:00:00.000Z",
      "last_login_at": "2026-01-28T10:30:00.000Z"
    }
  }
}
```

## 需要认证的接口

以下接口需要在请求头中携带有效的Token：

- `GET /api/user/profile` - 获取当前用户信息
- `GET /api/user/info` - 获取指定用户信息
- `GET /api/user/verify` - 验证Token

Token的传递方式：
1. **Header**: `Authorization: Bearer <token>`
2. **Cookie**: `accessToken=<token>`

## 数据库初始化

### 同步相关表

```bash
mysql -u root -p < src/mysql/init.sql
```

### 用户认证表

```bash
mysql -u root -p < src/mysql/user.sql
```
