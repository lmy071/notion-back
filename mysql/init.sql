-- 用户表
CREATE TABLE IF NOT EXISTS `users` (
    `id` INT AUTO_INCREMENT PRIMARY KEY COMMENT '用户 ID',
    `username` VARCHAR(50) NOT NULL UNIQUE COMMENT '用户名',
    `password` VARCHAR(255) NOT NULL COMMENT '密码',
    `permissions` TEXT COMMENT '权限标识，逗号分隔，如 sync:notion',
    `role` VARCHAR(20) DEFAULT 'user' COMMENT '角色',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户管理表';

-- 用户级 Notion 配置表 (替代原 configs 表)
CREATE TABLE IF NOT EXISTS `user_configs` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `user_id` INT NOT NULL COMMENT '所属用户 ID',
    `config_key` VARCHAR(100) NOT NULL COMMENT '配置键名',
    `config_value` TEXT COMMENT '配置值',
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY `uk_user_key` (`user_id`, `config_key`),
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户级 Notion 配置表';

-- API 调用日志表
CREATE TABLE IF NOT EXISTS `api_logs` (
    `id` INT AUTO_INCREMENT PRIMARY KEY COMMENT '日志 ID',
    `user_id` INT COMMENT '执行用户 ID',
    `url` VARCHAR(255) NOT NULL COMMENT '接口地址',
    `method` VARCHAR(10) NOT NULL COMMENT '请求方法',
    `params` TEXT COMMENT '请求参数',
    `status_code` INT COMMENT '响应状态码',
    `response_body` LONGTEXT COMMENT '响应结果',
    `is_success` TINYINT(1) DEFAULT 0 COMMENT '是否成功',
    `error_message` TEXT COMMENT '异常信息',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '调用时间',
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='API 调用日志表';

-- Notion 同步目标表 (支持多用户、多数据库)
CREATE TABLE IF NOT EXISTS `notion_sync_targets` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `user_id` INT NOT NULL COMMENT '所属用户 ID',
    `database_id` VARCHAR(100) NOT NULL COMMENT 'Notion 数据库 ID',
    `name` VARCHAR(100) COMMENT '数据库别名/名称',
    `status` TINYINT(1) DEFAULT 1 COMMENT '是否启用同步: 1启用, 0禁用',
    `last_sync_at` TIMESTAMP NULL COMMENT '最后同步时间',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY `uk_user_db` (`user_id`, `database_id`),
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Notion 同步目标配置表';

-- 权限字典表
CREATE TABLE IF NOT EXISTS `dict_table` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `dict_code` VARCHAR(50) NOT NULL UNIQUE COMMENT '权限标识，如 sync:notion',
    `dict_name` VARCHAR(100) NOT NULL COMMENT '权限名称描述',
    `category` VARCHAR(50) DEFAULT 'permission' COMMENT '字典分类',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='权限字典表';

-- 页面分享配置表
CREATE TABLE IF NOT EXISTS `page_shares` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `page_id` VARCHAR(100) NOT NULL,
    `user_id` INT NOT NULL,
    `share_token` VARCHAR(64) NOT NULL UNIQUE,
    `is_active` TINYINT(1) DEFAULT 1,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY `uk_page_user` (`page_id`, `user_id`),
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='页面分享配置表';

-- 初始化权限字典
INSERT IGNORE INTO `dict_table` (`dict_code`, `dict_name`, `category`) VALUES 
('sync:notion', '执行 Notion 同步权限', 'permission'),
('data:delete', '删除数据连接权限', 'permission'),
('user:manage', '用户管理权限', 'permission'),
('config:manage', '系统配置权限', 'permission');

-- 初始化默认管理员 (密码: admin123)
INSERT IGNORE INTO `users` (`username`, `password`, `permissions`, `role`) VALUES 
('admin', 'admin123', 'sync:notion,data:delete,user:manage,config:manage', 'admin');
