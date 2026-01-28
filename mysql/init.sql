-- =====================================================
-- Notion Sync 数据库初始化脚本（Data Sources 版）
-- =====================================================
-- 创建时间: 2026-01-28
-- 说明:
--   - 适配 Notion API 2025-09-03：/v1/data_sources/{data_source_id}
--   - 支持存储 data source 元数据 + schema 快照 + 同步断点(cursor) + 同步运行日志
--   - 保留用户认证表（users/user_tokens），与现有后端一致
-- =====================================================

CREATE DATABASE IF NOT EXISTS notion_sync
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE notion_sync;

-- =====================================================
-- 1) Notion Data Source 元数据表：notion_data_sources
--    对应 GET /v1/data_sources/{id} 的主要字段
-- =====================================================
DROP TABLE IF EXISTS notion_data_sources;
CREATE TABLE notion_data_sources (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '自增主键',
  notion_data_source_id VARCHAR(100) NOT NULL COMMENT 'Notion data_source_id（新版主键）',
  notion_database_id VARCHAR(100) DEFAULT NULL COMMENT '所属 database_id（若返回包含/可推导）',
  title VARCHAR(500) DEFAULT NULL COMMENT '数据源标题（聚合后的纯文本）',
  description TEXT DEFAULT NULL COMMENT '描述（若返回包含）',
  url VARCHAR(500) DEFAULT NULL COMMENT 'Notion URL（若返回包含）',
  icon JSON DEFAULT NULL COMMENT 'icon 原始结构（若返回包含）',
  cover JSON DEFAULT NULL COMMENT 'cover 原始结构（若返回包含）',
  properties JSON NOT NULL COMMENT 'properties(schema) 原始 JSON',
  raw JSON NOT NULL COMMENT '完整原始响应 JSON（便于兼容字段变更）',
  archived TINYINT(1) DEFAULT 0 COMMENT '是否归档（archived）',
  created_time DATETIME DEFAULT NULL COMMENT 'Notion created_time',
  last_edited_time DATETIME DEFAULT NULL COMMENT 'Notion last_edited_time',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '本地入库时间',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '本地更新时间',
  UNIQUE KEY uk_notion_data_source_id (notion_data_source_id),
  KEY idx_notion_database_id (notion_database_id),
  KEY idx_last_edited_time (last_edited_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Notion data_sources 元数据与 schema 快照';

-- =====================================================
-- 2) 同步配置表：sync_data_sources
--    说明：每个 data_source 对应一个 MySQL 目标表（动态建表/增列由代码完成）
-- =====================================================
DROP TABLE IF EXISTS sync_data_sources;
CREATE TABLE sync_data_sources (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '配置ID',
  notion_data_source_id VARCHAR(100) NOT NULL COMMENT 'Notion data_source_id（与 notion_data_sources 对应）',
  table_name VARCHAR(100) NOT NULL COMMENT '目标 MySQL 表名（数据落地表）',
  database_name VARCHAR(100) NOT NULL DEFAULT 'notion_sync' COMMENT '所属数据库名（通常为 notion_sync）',
  status ENUM('active','inactive') DEFAULT 'active' COMMENT '同步状态',
  sync_interval INT DEFAULT 300 COMMENT '同步间隔（秒）',
  last_sync_at DATETIME DEFAULT NULL COMMENT '上次同步完成时间',
  last_cursor VARCHAR(255) DEFAULT NULL COMMENT '上次分页游标 next_cursor（用于断点续传）',
  last_sync_status ENUM('success','failed') DEFAULT NULL COMMENT '上次同步结果',
  last_error_message TEXT DEFAULT NULL COMMENT '上次错误信息（失败时）',
  remark VARCHAR(500) DEFAULT NULL COMMENT '备注',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  UNIQUE KEY uk_ds (notion_data_source_id),
  UNIQUE KEY uk_table (table_name),
  KEY idx_status (status),
  KEY idx_last_sync_at (last_sync_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Notion data_sources 同步配置表（含断点 cursor）';

-- =====================================================
-- 3) 同步运行日志：sync_runs
--    说明：一次“同步执行”的整体记录（与分页无关）
-- =====================================================
DROP TABLE IF EXISTS sync_runs;
CREATE TABLE sync_runs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '运行ID',
  notion_data_source_id VARCHAR(100) NOT NULL COMMENT 'Notion data_source_id',
  table_name VARCHAR(100) NOT NULL COMMENT '目标表名',
  status ENUM('success','failed') NOT NULL COMMENT '运行结果',
  total_records INT DEFAULT 0 COMMENT '本次同步拉取到的记录总数（汇总）',
  inserted_records INT DEFAULT 0 COMMENT '写入记录数（如无法区分则填总数）',
  updated_records INT DEFAULT 0 COMMENT '更新记录数（可选）',
  skipped_records INT DEFAULT 0 COMMENT '跳过记录数（可选）',
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '开始时间',
  finished_at DATETIME DEFAULT NULL COMMENT '结束时间',
  duration_ms INT DEFAULT 0 COMMENT '耗时毫秒',
  error_message TEXT DEFAULT NULL COMMENT '错误信息（失败时）',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  KEY idx_ds (notion_data_source_id),
  KEY idx_table (table_name),
  KEY idx_started_at (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='同步运行日志（run 级别）';

-- =====================================================
-- 4) 分页拉取明细（可选但推荐）：sync_pages
--    说明：每次调用 POST /v1/data_sources/{id}/query 的分页记录
-- =====================================================
DROP TABLE IF EXISTS sync_pages;
CREATE TABLE sync_pages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '分页ID',
  run_id BIGINT UNSIGNED NOT NULL COMMENT '关联 sync_runs.id',
  notion_data_source_id VARCHAR(100) NOT NULL COMMENT 'Notion data_source_id（冗余，便于查询）',
  request_cursor VARCHAR(255) DEFAULT NULL COMMENT '请求时的 start_cursor',
  response_next_cursor VARCHAR(255) DEFAULT NULL COMMENT '响应的 next_cursor',
  has_more TINYINT(1) DEFAULT 0 COMMENT '响应 has_more',
  page_size INT DEFAULT 0 COMMENT '本页返回条数（results.length）',
  raw JSON DEFAULT NULL COMMENT '本页响应原始 JSON（可选）',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  KEY idx_run (run_id),
  KEY idx_ds (notion_data_source_id),
  KEY idx_created_at (created_at),
  CONSTRAINT fk_sync_pages_run FOREIGN KEY (run_id) REFERENCES sync_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='同步分页明细（query 分页级别）';

-- =====================================================
-- 5) 用户认证表（与你现有 userService 一致）
-- =====================================================
DROP TABLE IF EXISTS users;
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY COMMENT '用户ID',
  username VARCHAR(50) NOT NULL COMMENT '用户名',
  email VARCHAR(100) NOT NULL COMMENT '邮箱地址',
  password_hash VARCHAR(255) NOT NULL COMMENT '密码哈希',
  status ENUM('active','inactive','banned') DEFAULT 'active' COMMENT '账户状态',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  last_login_at DATETIME DEFAULT NULL COMMENT '最后登录时间',
  UNIQUE KEY uk_username (username),
  UNIQUE KEY uk_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='用户账户表';

DROP TABLE IF EXISTS user_tokens;
CREATE TABLE user_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY COMMENT 'Token ID',
  user_id INT NOT NULL COMMENT '用户ID',
  token VARCHAR(255) NOT NULL COMMENT 'Token值',
  token_type ENUM('access','refresh') DEFAULT 'access' COMMENT 'Token类型',
  expires_at DATETIME NOT NULL COMMENT '过期时间',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  revoked_at DATETIME DEFAULT NULL COMMENT '撤销时间',
  UNIQUE KEY uk_token (token),
  KEY idx_user_id (user_id),
  KEY idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='用户Token表';

-- =====================================================
-- 6) API 日志表（与你现有 apilogger 对应）
--    注：保留 10000 条清理逻辑在 mysql/log_table.sql 中维护
-- =====================================================
DROP TABLE IF EXISTS log_table;
CREATE TABLE log_table (
  id BIGINT UNSIGNED AUTO_INCREMENT COMMENT '日志ID',
  request_id VARCHAR(64) NOT NULL COMMENT '请求唯一标识UUID',
  api_path VARCHAR(512) NOT NULL COMMENT 'API请求路径',
  http_method VARCHAR(10) NOT NULL COMMENT 'HTTP方法',
  ip_address VARCHAR(45) COMMENT '客户端IP地址',
  user_agent VARCHAR(512) COMMENT '用户代理',
  request_params TEXT COMMENT '请求参数(JSON格式)',
  request_body TEXT COMMENT '请求体(JSON格式)',
  response_status INT COMMENT '响应状态码',
  response_time_ms INT UNSIGNED COMMENT '响应时间(毫秒)',
  error_message TEXT COMMENT '错误信息',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (id),
  KEY idx_request_id (request_id),
  KEY idx_api_path (api_path(191)),
  KEY idx_http_method (http_method),
  KEY idx_created_at (created_at),
  KEY idx_response_status (response_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='API调用日志表';

-- =====================================================
-- 示例：插入一条 data_source 同步配置（把 notion_data_source_id 换成你的）
-- =====================================================
-- INSERT INTO sync_data_sources (notion_data_source_id, table_name, database_name, status, sync_interval, remark)
-- VALUES ('your-data-source-id', 'notion_sync', 'notion_sync', 'active', 300, '示例 data_source');

