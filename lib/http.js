const axios = require('axios');
const https = require('https');

/**
 * 全局 Axios 配置
 * 用于统一管理后端发起的 HTTP 请求
 * 包含超时处理、连接池优化以及连接异常后的自我恢复能力
 */
const http = axios.create({
    timeout: 30000, // 30秒全局超时
    httpsAgent: new https.Agent({
        keepAlive: true,             // 开启 TCP 保持活动
        keepAliveMsecs: 1000,        // 保持活动数据包的发送频率
        maxSockets: 100,             // 允许的最大并发套接字数
        freeSocketTimeout: 30000,    // 空闲套接字在 30 秒后超时，防止指向错误 IP 的旧连接一直驻留
    })
});

// 请求拦截器（预留，可用于添加全局日志等）
http.interceptors.request.use(
    config => {
        return config;
    },
    error => {
        return Promise.reject(error);
    }
);

// 响应拦截器（预留，可用于统一错误处理）
http.interceptors.response.use(
    response => {
        return response;
    },
    error => {
        // 在这里可以处理一些通用的连接错误日志
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            console.error(`[Global HTTP Error] Connection failed to ${error.address}:${error.port}`);
        }
        return Promise.reject(error);
    }
);

module.exports = http;
