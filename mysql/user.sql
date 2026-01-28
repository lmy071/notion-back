-- =====================================================
-- 用户表初始化脚本
-- =====================================================
-- 创建时间: 2026-01-28
-- 说明: 创建用户认证相关的表结构
-- =====================================================

USE notion_sync;

-- =====================================================
-- 用户表: users
-- 存储用户账户信息
-- =====================================================
DROP TABLE IF EXISTS users;
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY COMMENT '用户ID',
    username VARCHAR(50) NOT NULL COMMENT '用户名',
    email VARCHAR(100) NOT NULL COMMENT '邮箱地址',
    password_hash VARCHAR(255) NOT NULL COMMENT '密码哈希',
    status ENUM('active', 'inactive', 'banned') DEFAULT 'active' COMMENT '账户状态',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    last_login_at DATETIME DEFAULT NULL COMMENT '最后登录时间',
    UNIQUE KEY uk_username (username),
    UNIQUE KEY uk_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='用户账户表';

-- =====================================================
-- 用户Token表: user_tokens
-- 存储用户登录Token
-- =====================================================
DROP TABLE IF EXISTS user_tokens;
CREATE TABLE user_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY COMMENT 'Token ID',
    user_id INT NOT NULL COMMENT '用户ID',
    token VARCHAR(255) NOT NULL COMMENT 'Token值',
    token_type ENUM('access', 'refresh') DEFAULT 'access' COMMENT 'Token类型',
    expires_at DATETIME NOT NULL COMMENT '过期时间',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    revoked_at DATETIME DEFAULT NULL COMMENT '撤销时间',
    UNIQUE KEY uk_token (token),
    INDEX idx_user_id (user_id),
    INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='用户Token表';

-- =====================================================
-- 使用说明
-- =====================================================
-- 1. 执行此脚本初始化用户表:
--    mysql -u root -p < src/mysql/user.sql
--
-- 2. 用户注册:
--    INSERT INTO users (username, email, password_hash)
--    VALUES ('用户名', 'email@example.com', '密码哈希值');
--
-- 3. 登录时创建Token:
--    INSERT INTO user_tokens (user_id, token, token_type, expires_at)
--    VALUES (1, 'token值', 'access', DATE_ADD(NOW(), INTERVAL 24 HOUR));
--
-- 4. 退出登录时撤销Token:
--    UPDATE user_tokens SET revoked_at = NOW() WHERE token = 'token值';
--
-- 5. 查看所有用户:
--    SELECT id, username, email, status, created_at FROM users;
