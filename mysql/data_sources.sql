-- Notion 数据源存储表
CREATE TABLE IF NOT EXISTS `notion_data_sources` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `user_id` INT NOT NULL COMMENT '所属用户 ID',
    `database_id` VARCHAR(100) NOT NULL COMMENT '所属 Notion 数据库 ID',
    `data_source_id` VARCHAR(100) NOT NULL COMMENT 'Notion 数据源 ID',
    `name` VARCHAR(100) COMMENT '数据源名称',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY `uk_user_ds` (`user_id`, `data_source_id`),
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Notion 数据源存储表';
