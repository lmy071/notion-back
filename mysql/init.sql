-- =====================================================
-- Notion Sync 数据库初始化脚本
-- =====================================================
-- 创建时间: 2026-01-27
-- 说明: 初始化notion_sync数据库和相关表结构
-- =====================================================

-- 创建数据库（如果不存在）
CREATE DATABASE IF NOT EXISTS notion_sync
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE notion_sync;

-- =====================================================
-- 数据库配置表: sync_databases
-- 存储多个Notion数据库的同步配置
-- =====================================================
DROP TABLE IF EXISTS sync_databases;
CREATE TABLE sync_databases (
    id INT AUTO_INCREMENT PRIMARY KEY COMMENT '配置ID',
    notion_database_id VARCHAR(100) NOT NULL COMMENT 'Notion数据库ID',
    table_name VARCHAR(100) NOT NULL COMMENT 'MySQL表名',
    database_name VARCHAR(100) NOT NULL COMMENT '数据库名称',
    status ENUM('active', 'inactive') DEFAULT 'active' COMMENT '同步状态',
    sync_interval INT DEFAULT 300 COMMENT '同步间隔（秒）',
    last_sync_at DATETIME DEFAULT NULL COMMENT '上次同步时间',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    remark VARCHAR(500) DEFAULT NULL COMMENT '备注',
    UNIQUE KEY uk_notion_id (notion_database_id),
    UNIQUE KEY uk_table_name (table_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Notion数据库同步配置表';

-- 插入示例配置
INSERT INTO sync_databases (notion_database_id, table_name, database_name, status, sync_interval, remark)
VALUES
    ('29320a967459807899b9f7b70478b3f6', 'notion_sync', 'notion_sync', 'active', 300, '示例数据库');

-- =====================================================
-- 同步日志表: sync_logs
-- 记录每次同步的执行情况
-- =====================================================
DROP TABLE IF EXISTS sync_logs;
CREATE TABLE sync_logs (
    id INT AUTO_INCREMENT PRIMARY KEY COMMENT '日志ID',
    notion_database_id VARCHAR(100) NOT NULL COMMENT 'Notion数据库ID',
    table_name VARCHAR(100) NOT NULL COMMENT 'MySQL表名',
    status ENUM('success', 'failed') NOT NULL COMMENT '同步状态',
    page_count INT DEFAULT 0 COMMENT '处理的页面数量',
    error_message TEXT DEFAULT NULL COMMENT '错误信息',
    duration_ms INT DEFAULT 0 COMMENT '执行耗时（毫秒）',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    INDEX idx_notion_id (notion_database_id),
    INDEX idx_table_name (table_name),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Notion同步执行日志表';

-- =====================================================
-- 示例数据表结构: notion_sync
-- 这是根据Notion数据库自动生成的表结构示例
-- 实际结构会根据Notion数据库字段动态生成
-- =====================================================
DROP TABLE IF EXISTS notion_sync;
CREATE TABLE notion_sync (
    id VARCHAR(50) NOT NULL COMMENT 'Notion页面ID（主键）' PRIMARY KEY,
    created_time DATETIME DEFAULT NULL COMMENT '创建时间',
    last_edited_time DATETIME DEFAULT NULL COMMENT '最后编辑时间',
    url VARCHAR(500) DEFAULT NULL COMMENT 'Notion页面URL',
    properties JSON DEFAULT NULL COMMENT 'Notion页面原始属性数据',
    -- 以下字段由Notion数据库属性动态生成
    -- 例如: title, rich_text, number, select, multi_select, date 等
    INDEX idx_created_time (created_time),
    INDEX idx_last_edited_time (last_edited_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Notion数据库同步表';

-- =====================================================
-- 使用说明
-- =====================================================
-- 1. 执行此脚本初始化数据库:
--    mysql -u root -p < src/mysql/init.sql
--
-- 2. 添加新的Notion数据库同步配置:
--    INSERT INTO sync_databases (notion_database_id, table_name, database_name, remark)
--    VALUES ('新的Notion数据库ID', '新表名', 'notion_sync', '备注说明');
--
-- 3. 查看同步配置:
--    SELECT * FROM sync_databases;
--
-- 4. 查看同步日志:
--    SELECT * FROM sync_logs ORDER BY created_at DESC LIMIT 100;
