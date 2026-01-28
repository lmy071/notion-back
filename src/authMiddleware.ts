/**
 * 认证中间件模块
 * @module authMiddleware
 * @description 提供Token验证和用户认证中间件
 */

import { Request, Response, NextFunction } from 'express';
import { TokenPayload } from './types';

/**
 * 扩展Request类型，添加用户信息
 */
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

/**
 * 认证错误类
 */
export class AuthError extends Error {
  code: string;
  statusCode: number;
  constructor(message: string, code: string, statusCode: number = 401) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * 从请求头获取Token
 * @param req - Express请求对象
 * @returns Token字符串或null
 */
function extractTokenFromHeader(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return null;
  }

  // 支持 Bearer Token 格式
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }

  return parts[1];
}

/**
 * 从Cookie获取Token
 * @param req - Express请求对象
 * @param tokenName - Cookie中的Token名称
 * @returns Token字符串或null
 */
function extractTokenFromCookie(req: Request, tokenName: string): string | null {
  const token = req.cookies?.[tokenName];
  if (!token || typeof token !== 'string') {
    return null;
  }
  return token;
}

/**
 * 获取Token的辅助函数
 * @param req - Express请求对象
 * @returns Token字符串
 */
function getToken(req: Request): string | null {
  // 首先尝试从Header获取
  let token = extractTokenFromHeader(req);
  if (token) {
    return token;
  }

  // 然后尝试从Cookie获取
  token = extractTokenFromCookie(req, 'accessToken');
  if (token) {
    return token;
  }

  token = extractTokenFromCookie(req, 'token');
  if (token) {
    return token;
  }

  return null;
}

/**
 * 创建认证中间件
 * @param verifyTokenFn - Token验证函数
 * @param skipPaths - 跳过认证的路径列表
 * @returns Express中间件
 */
export function createAuthMiddleware(
  verifyTokenFn: (token: string) => TokenPayload | null,
  skipPaths: string[] = []
) {
  const skipSet = new Set(skipPaths);

  return (req: Request, res: Response, next: NextFunction): void => {
    // 检查是否跳过认证
    const path = req.path;
    const method = req.method.toUpperCase();

    // 检查完整路径和HTTP方法的组合
    const skipKey = `${method} ${path}`;
    if (skipSet.has(skipKey) || skipSet.has(path)) {
      return next();
    }

    // 获取Token
    const token = getToken(req);
    if (!token) {
      return next(new AuthError('未提供认证Token', 'TOKEN_MISSING'));
    }

    // 验证Token
    const payload = verifyTokenFn(token);
    if (!payload) {
      return next(new AuthError('无效或已过期的Token', 'INVALID_TOKEN'));
    }

    // 将用户信息添加到请求对象
    req.user = payload;
    next();
  };
}

/**
 * 创建可选认证中间件
 * 如果提供了Token则验证，但不会拒绝没有Token的请求
 * @param verifyTokenFn - Token验证函数
 * @returns Express中间件
 */
export function createOptionalAuthMiddleware(
  verifyTokenFn: (token: string) => TokenPayload | null
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = getToken(req);
    if (token) {
      const payload = verifyTokenFn(token);
      if (payload) {
        req.user = payload;
      }
    }
    next();
  };
}

/**
 * 错误处理中间件
 * 用于处理认证错误
 */
export function authErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (err instanceof AuthError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      code: err.code,
    });
    return;
  }

  // 如果不是认证错误，传递给下一个错误处理中间件
  next(err);
}

export { getToken };
