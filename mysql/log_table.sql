-- =====================================================
-- API 日志表 log_table
-- 用于记录所有 API 接口调用日志
-- 自动保留最新的 10000 条记录
-- =====================================================

-- 如果表存在则删除（首次创建时使用）
DROP TABLE IF EXISTS `log_table`;

-- 创建日志表
CREATE TABLE `log_table` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT COMMENT '日志ID',
  `request_id` VARCHAR(64) NOT NULL COMMENT '请求唯一标识UUID',
  `api_path` VARCHAR(512) NOT NULL COMMENT 'API请求路径',
  `http_method` VARCHAR(10) NOT NULL COMMENT 'HTTP方法',
  `ip_address` VARCHAR(45) COMMENT '客户端IP地址',
  `user_agent` VARCHAR(512) COMMENT '用户代理',
  `request_params` TEXT COMMENT '请求参数(JSON格式)',
  `request_body` TEXT COMMENT '请求体(JSON格式)',
  `response_status` INT COMMENT '响应状态码',
  `response_time_ms` INT UNSIGNED COMMENT '响应时间(毫秒)',
  `error_message` TEXT COMMENT '错误信息',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_request_id` (`request_id`),
  KEY `idx_api_path` (`api_path`(191)),
  KEY `idx_http_method` (`http_method`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_response_status` (`response_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='API调用日志表';

-- =====================================================
-- 自动清理旧日志的存储过程
-- 当日志超过10000条时，删除最旧的记录
-- =====================================================
DROP PROCEDURE IF EXISTS `clean_old_logs`;

DELIMITER //

CREATE PROCEDURE `clean_old_logs`()
BEGIN
    -- 定义最大保留日志数量
    DECLARE MAX_LOGS INT DEFAULT 10000;
    DECLARE CURRENT_COUNT INT;
    DECLARE DELETE_COUNT INT;

    -- 获取当前日志总数
    SELECT COUNT(*) INTO CURRENT_COUNT FROM `log_table`;

    -- 如果超过最大保留数量，删除多余的旧日志
    IF CURRENT_COUNT > MAX_LOGS THEN
        SET DELETE_COUNT = CURRENT_COUNT - MAX_LOGS;
        DELETE FROM `log_table`
        ORDER BY `id` ASC
        LIMIT DELETE_COUNT;
    END IF;
END //

DELIMITER ;

-- =====================================================
-- 创建触发器：每次插入日志后自动清理
-- =====================================================
DROP TRIGGER IF EXISTS `trg_after_insert_log`;

DELIMITER //

CREATE TRIGGER `trg_after_insert_log`
AFTER INSERT ON `log_table`
FOR EACH ROW
BEGIN
    -- 插入后检查并清理旧日志
    DECLARE MAX_LOGS INT DEFAULT 10000;
    DECLARE CURRENT_COUNT INT;

    SELECT COUNT(*) INTO CURRENT_COUNT FROM `log_table`;

    IF CURRENT_COUNT > MAX_LOGS THEN
        DELETE FROM `log_table`
        ORDER BY `id` ASC
        LIMIT CURRENT_COUNT - MAX_LOGS;
    END IF;
END //

DELIMITER ;

-- =====================================================
-- 手动清理日志的示例SQL（可选执行）
-- =====================================================
-- CALL clean_old_logs();
