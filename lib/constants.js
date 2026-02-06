/**
 * 业务状态码枚举
 * 统一管理前后端交互的状态标识
 */
const StatusCode = {
    // 成功
    SUCCESS: 20000,
    
    // 客户端错误 (4xx)
    BAD_REQUEST: 40000,
    UNAUTHORIZED: 40100,
    FORBIDDEN: 40300,
    NOT_FOUND: 40400,
    VALIDATION_FAILED: 42200,
    
    // 服务端错误 (5xx)
    INTERNAL_ERROR: 50000,
    NOTION_API_ERROR: 50001,
    DATABASE_ERROR: 50002,
    SYNC_FAILED: 50003,
    NETWORK_ERROR: 50004
};

module.exports = {
    StatusCode
};
