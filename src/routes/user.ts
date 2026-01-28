/**
 * 用户认证API路由模块
 * @module user
 * @description 提供用户注册、登录、登出等REST API接口
 */

import { Router, Request, Response, NextFunction } from 'express';
import { UserService, UserServiceError, createUserService } from '../userService';
import { createAuthMiddleware, AuthError } from '../authMiddleware';
import { TokenPayload } from '../types';

const router = Router();

/**
 * 用户服务实例缓存
 */
let userService: UserService | null = null;

/**
 * 获取用户服务实例
 */
function getUserService(): UserService {
  if (!userService) {
    userService = createUserService();
  }
  return userService;
}

/**
 * 刷新用户服务实例
 */
function refreshUserService(): void {
  userService = null;
}

/**
 * POST /api/user/register
 * 用户注册
 *
 * 请求体:
 * {
 *   username: string,  // 用户名（3-50字符）
 *   email: string,     // 邮箱地址
 *   password: string   // 密码（至少6字符）
 * }
 *
 * 响应:
 * {
 *   success: boolean,
 *   message: string,
 *   data: {
 *     user: { id, username, email, status, created_at, updated_at, last_login_at }
 *   }
 * }
 */
router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, email, password } = req.body;

    // 验证必填字段
    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: '用户名、邮箱和密码都是必填项',
        code: 'MISSING_FIELDS',
      });
    }

    const service = getUserService();
    await service.initialize();

    const user = await service.register(username, email, password);

    res.status(201).json({
      success: true,
      message: '注册成功',
      data: { user },
    });
  } catch (error) {
    if (error instanceof UserServiceError) {
      const statusCode = error.code === 'USER_EXISTS' ? 409 : 400;
      return res.status(statusCode).json({
        success: false,
        message: error.message,
        code: error.code,
      });
    }
    return next(error);
  }
});

/**
 * POST /api/user/login
 * 用户登录
 *
 * 请求体:
 * {
 *   username: string,  // 用户名或邮箱
 *   password: string   // 密码
 * }
 *
 * 响应:
 * {
 *   success: boolean,
 *   message: string,
 *   data: {
 *     user: { id, username, email, status, created_at, updated_at, last_login_at },
 *     accessToken: string,
 *     refreshToken: string
 *   }
 * }
 */
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password } = req.body;

    // 验证必填字段
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: '用户名和密码都是必填项',
        code: 'MISSING_FIELDS',
      });
    }

    const service = getUserService();
    await service.initialize();

    const result = await service.login(username, password);

    // 设置Cookie
    res.cookie('accessToken', result.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000, // 24小时
    });

    res.json({
      success: true,
      message: '登录成功',
      data: {
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      },
    });
  } catch (error) {
    if (error instanceof UserServiceError) {
      const statusCode =
        error.code === 'USER_NOT_FOUND' ||
        error.code === 'INVALID_PASSWORD' ||
        error.code === 'USER_BANNED' ||
        error.code === 'USER_INACTIVE'
          ? 401
          : 400;

      return res.status(statusCode).json({
        success: false,
        message: error.message,
        code: error.code,
      });
    }
    return next(error);
  }
});

/**
 * POST /api/user/logout
 * 用户登出
 *
 * 请求头:
 * Authorization: Bearer <token>
 *
 * 响应:
 * {
 *   success: boolean,
 *   message: string
 * }
 */
router.post('/logout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = getUserService();
    await service.initialize();

    // 从Header获取Token
    const authHeader = req.headers.authorization;
    let token: string | null = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else {
      token = req.cookies?.accessToken || req.cookies?.token;
    }

    if (token) {
      await service.logout(token);
    }

    // 清除Cookie
    res.clearCookie('accessToken');
    res.clearCookie('token');

    res.json({
      success: true,
      message: '登出成功',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/user/refresh
 * 刷新Access Token
 *
 * 请求体:
 * {
 *   refreshToken: string
 * }
 *
 * 响应:
 * {
 *   success: boolean,
 *   message: string,
 *   data: {
 *     accessToken: string
 *   }
 * }
 */
router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh Token是必填项',
        code: 'MISSING_TOKEN',
      });
    }

    const service = getUserService();
    await service.initialize();

    const accessToken = await service.refreshAccessToken(refreshToken);

    // 设置新的Cookie
    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000, // 24小时
    });

    res.json({
      success: true,
      message: 'Token刷新成功',
      data: { accessToken },
    });
  } catch (error) {
    if (error instanceof UserServiceError) {
      return res.status(401).json({
        success: false,
        message: error.message,
        code: error.code,
      });
    }
    return next(error);
  }
});

/**
 * GET /api/user/profile
 * 获取当前用户信息（需要认证）
 *
 * 请求头:
 * Authorization: Bearer <token>
 *
 * 响应:
 * {
 *   success: boolean,
 *   data: {
 *     user: { id, username, email, status, created_at, updated_at, last_login_at }
 *   }
 * }
 */
router.get(
  '/profile',
  createAuthMiddleware((token: string) => getUserService().verifyToken(token)),
  async (req: Request, res: Response) => {
    const user = req.user as TokenPayload;

    const service = getUserService();
    await service.initialize();

    const userInfo = await service.getUserById(user.userId);

    if (!userInfo) {
      return res.status(404).json({
        success: false,
        message: '用户不存在',
        code: 'USER_NOT_FOUND',
      });
    }

    return res.json({
      success: true,
      data: { user: userInfo },
    });
  }
);

/**
 * GET /api/user/info
 * 获取指定用户信息（需要认证）
 *
 * 请求参数:
 * id - 用户ID
 *
 * 响应:
 * {
 *   success: boolean,
 *   data: {
 *     user: { id, username, email, status, created_at, updated_at, last_login_at }
 *   }
 * }
 */
router.get(
  '/info',
  createAuthMiddleware((token: string) => getUserService().verifyToken(token), ['GET /api/user/info']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = parseInt(req.query.id as string, 10);

      if (!userId || isNaN(userId)) {
        return res.status(400).json({
          success: false,
          message: '无效的用户ID',
          code: 'INVALID_USER_ID',
        });
      }

      const service = getUserService();
      await service.initialize();

      const user = await service.getUserById(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: '用户不存在',
          code: 'USER_NOT_FOUND',
        });
      }

      res.json({
        success: true,
        data: { user },
      });
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * GET /api/user/verify
 * 验证Token是否有效（需要认证）
 *
 * 请求头:
 * Authorization: Bearer <token>
 *
 * 响应:
 * {
 *   success: boolean,
 *   message: string,
 *   data: {
 *     valid: boolean,
 *     user: { id, username, email }
 *   }
 * }
 */
router.get(
  '/verify',
  createAuthMiddleware((token: string) => getUserService().verifyToken(token)),
  async (req: Request, res: Response) => {
    const user = req.user as TokenPayload;

    res.json({
      success: true,
      message: 'Token有效',
      data: {
        valid: true,
        user: {
          id: user.userId,
          username: user.username,
          email: user.email,
        },
      },
    });
  }
);

/**
 * POST /api/user/master-token
 * 生成万能Token（永不过期，用于系统同步等）
 *
 * 请求体:
 * {
 *   userId: number,  // 用户ID (必填)
 * }
 *
 * 响应:
 * {
 *   success: boolean,
 *   message: string,
 *   data: {
 *     masterToken: string,
 *     user: { id, username, email }
 *   }
 * }
 */
router.post('/master-token', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { userId } = req.body;

    if (!userId) {
      res.status(400).json({
        success: false,
        message: 'userId是必填项',
        code: 'MISSING_FIELDS',
      });
      return;
    }

    const service = getUserService();
    await service.initialize();

    // 获取用户信息
    const user = await service.getUserById(userId);
    if (!user) {
      res.status(404).json({
        success: false,
        message: '用户不存在',
        code: 'USER_NOT_FOUND',
      });
      return;
    }

    // 生成万能Token
    const masterToken = service.generateMasterToken(user.id, user.username, user.email);

    res.json({
      success: true,
      message: '万能Token生成成功（永不过期，请妥善保管）',
      data: {
        masterToken,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
        },
      },
    });
    return;
  } catch (error) {
    next(error);
    return;
  }
});

/**
 * 认证错误处理中间件
 */
function handleAuthError(
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
  next(err);
}

export default router;
