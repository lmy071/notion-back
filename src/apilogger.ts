/**
 * API 日志中间件
 * @module apilogger
 * @description 自动记录所有 API 接口调用日志，不污染业务接口代码
 */

import { Request, Response, NextFunction } from 'express';
import { apiLoggerService, generateRequestId, safeStringify, IApiLog } from './apiloggerService';

/**
 * 需要排除的路径（不记录日志的接口）
 * 例如：静态资源、健康检查等
 */
const EXCLUDE_PATHS = [
  '/favicon.ico',
  '/public/',
  '/images/',
  '/javascripts/',
  '/stylesheets/',
];

/**
 * API 日志中间件
 * 自动记录所有匹配的 API 请求日志
 *
 * 使用方式：在 app.js 中使用 app.use(apilogger())
 * 无需在每个业务接口中单独调用
 */
export function apilogger(req: Request, res: Response, next: NextFunction): void {
  // 排除不需要记录的路径
  if (shouldExcludePath(req.path)) {
    next();
    return;
  }

  // 只记录 API 接口（以 /api 开头的路径）
  if (!req.path.startsWith('/api')) {
    next();
    return;
  }

  // 生成请求ID
  const requestId = generateRequestId();
  const startTime = Date.now();

  // 保存 requestId 到请求对象，供后续使用
  (req as any).requestId = requestId;

  // 捕获原始响应状态
  const originalSend = res.send;
  let responseStatus: number | undefined;

  // 重写 send 方法以捕获响应状态
  res.send = function (body: any): Response {
    responseStatus = res.statusCode;
    return originalSend.call(this, body);
  };

  // 响应结束时记录日志
  res.on('finish', async () => {
    const endTime = Date.now();
    const responseTime = endTime - startTime;

    // 构建日志数据
    const log: IApiLog = {
      request_id: requestId,
      api_path: req.path,
      http_method: req.method,
      ip_address: getClientIp(req),
      user_agent: req.headers['user-agent'] || undefined,
      request_params: safeStringify(req.query),
      request_body: getRequestBody(req),
      response_status: responseStatus || res.statusCode,
      response_time_ms: responseTime,
      error_message: res.statusCode >= 400 ? getErrorMessage(res) : undefined,
    };

    // 异步写入日志，不影响响应速度
    await apiLoggerService.saveLog(log);
  });

  next();
}

/**
 * 检查路径是否应该被排除
 * @param path 请求路径
 * @returns 是否应该排除
 */
function shouldExcludePath(path: string): boolean {
  return EXCLUDE_PATHS.some((excludePath) => path.startsWith(excludePath));
}

/**
 * 获取客户端真实IP
 * @param req 请求对象
 * @returns IP地址字符串
 */
function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    // x-forwarded-for 可能包含多个 IP，取第一个
    const ips = (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',');
    return ips[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || 'unknown';
}

/**
 * 获取请求体内容（仅在解析 body 后可用）
 * @param req 请求对象
 * @returns 请求体字符串
 */
function getRequestBody(req: Request): string {
  // 如果 body 已经被解析，返回其内容
  if (req.body && Object.keys(req.body).length > 0) {
    // 敏感信息脱敏处理
    const sanitizedBody = sanitizeSensitiveData(req.body);
    return safeStringify(sanitizedBody);
  }
  return '';
}

/**
 * 敏感信息脱敏处理
 * @param data 原始数据对象
 * @returns 脱敏后的数据对象
 */
function sanitizeSensitiveData(data: any): any {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const sensitiveFields = ['password', 'token', 'secret', 'key', 'authorization', 'apikey', 'api_key'];
  const result = Array.isArray(data) ? [...data] : { ...data };

  for (const key of Object.keys(result)) {
    if (sensitiveFields.some((field) => key.toLowerCase().includes(field.toLowerCase()))) {
      result[key] = '***REDACTED***';
    } else if (typeof result[key] === 'object' && result[key] !== null) {
      result[key] = sanitizeSensitiveData(result[key]);
    }
  }

  return result;
}

/**
 * 获取错误信息
 * @param res 响应对象
 * @returns 错误信息字符串
 */
function getErrorMessage(res: Response): string | undefined {
  if (res.statusCode >= 400) {
    // 可以根据实际需求扩展错误信息获取逻辑
    return `HTTP ${res.statusCode}`;
  }
  return undefined;
}

/**
 * 创建带有自定义配置的 API 日志中间件
 * @param options 配置选项
 * @returns 中间件函数
 */
export function createApiLogger(options?: {
  excludePaths?: string[];
  includePaths?: string[];
}): (req: Request, res: Response, next: NextFunction) => void {
  const excludePaths = options?.excludePaths || EXCLUDE_PATHS;
  const includePaths = options?.includePaths;

  return function (req: Request, res: Response, next: NextFunction): void {
    // 检查是否应该排除
    if (shouldExcludePathWithConfig(req.path, excludePaths, includePaths)) {
      next();
      return;
    }

    // 调用默认的日志中间件逻辑
    apilogger(req, res, next);
  };
}

/**
 * 检查路径是否应该被排除（带配置）
 */
function shouldExcludePathWithConfig(
  path: string,
  excludePaths: string[],
  includePaths?: string[]
): boolean {
  // 如果指定了 includePaths，则只记录这些路径
  if (includePaths && includePaths.length > 0) {
    return !includePaths.some((p) => path.startsWith(p));
  }

  // 否则使用 excludePaths 排除
  return excludePaths.some((p) => path.startsWith(p));
}

// 导出默认中间件
export default apilogger;
