/**
 * 用户服务模块
 * @module userService
 * @description 处理用户注册、登录、Token管理等业务逻辑
 */

import crypto from 'crypto';
import { RowDataPacket } from 'mysql2/promise';
import { IUser, IUserToken, TokenPayload } from './types';
import { IMySQLConfig, getMySQLConfig, toPoolOptions } from './mysql';
import { MySQLClient, createMySQLClient } from './mysqlClient';
import mysql from 'mysql2/promise';

/**
 * 用户服务异常
 */
export class UserServiceError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'UserServiceError';
    this.code = code;
  }
}

/**
 * Token配置
 */
interface ITokenConfig {
  /** Access Token有效期（毫秒） */
  accessTokenExpiresIn: number;
  /** Refresh Token有效期（毫秒） */
  refreshTokenExpiresIn: number;
  /** Token密钥 */
  secretKey: string;
  /** Token前缀 */
  tokenPrefix: string;
}

/**
 * 默认Token配置
 */
const defaultTokenConfig: ITokenConfig = {
  accessTokenExpiresIn: 24 * 60 * 60 * 1000, // 24小时
  refreshTokenExpiresIn: 7 * 24 * 60 * 60 * 1000, // 7天
  secretKey: process.env.JWT_SECRET || 'notion-sync-secret-key-change-in-production',
  tokenPrefix: 'ns_',
};

/**
 * 获取Token配置
 */
function getTokenConfig(): ITokenConfig {
  return {
    accessTokenExpiresIn: parseInt(process.env.JWT_ACCESS_EXPIRES_IN || '86400000', 10),
    refreshTokenExpiresIn: parseInt(process.env.JWT_REFRESH_EXPIRES_IN || '604800000', 10),
    secretKey: process.env.JWT_SECRET || defaultTokenConfig.secretKey,
    tokenPrefix: process.env.TOKEN_PREFIX || defaultTokenConfig.tokenPrefix,
  };
}

/**
 * 用户服务类
 */
export class UserService {
  private pool: mysql.Pool | null = null;
  private config: IMySQLConfig;
  private tokenConfig: ITokenConfig;
  private mysqlClient: MySQLClient;

  /**
   * 创建用户服务
   * @param config - MySQL配置（可选，默认从环境变量读取）
   */
  constructor(config?: IMySQLConfig) {
    this.config = config || getMySQLConfig();
    this.tokenConfig = getTokenConfig();
    this.mysqlClient = createMySQLClient(this.config);
  }

  /**
   * 初始化连接池
   */
  async initialize(): Promise<void> {
    const poolOptions = toPoolOptions(this.config);
    this.pool = mysql.createPool(poolOptions);
    await this.mysqlClient.initialize();
  }

  /**
   * 关闭连接池
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
    await this.mysqlClient.close();
  }

  /**
   * 获取连接池
   */
  private getPool(): mysql.Pool {
    if (!this.pool) {
      throw new UserServiceError('数据库连接池未初始化', 'POOL_NOT_INITIALIZED');
    }
    return this.pool;
  }

  /**
   * 生成密码哈希
   * @param password - 原始密码
   * @returns 密码哈希
   */
  async hashPassword(password: string): Promise<string> {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto
      .pbkdf2Sync(password, salt, 1000, 64, 'sha512')
      .toString('hex');
    return `${salt}:${hash}`;
  }

  /**
   * 验证密码
   * @param password - 原始密码
   * @param storedHash - 存储的哈希值
   * @returns 是否匹配
   */
  async verifyPassword(password: string, storedHash: string): Promise<boolean> {
    const [salt, hash] = storedHash.split(':');
    const verifyHash = crypto
      .pbkdf2Sync(password, salt, 1000, 64, 'sha512')
      .toString('hex');
    return hash === verifyHash;
  }

  /**
   * 生成Token
   * @param payload - Token载荷
   * @param expiresIn - 过期时间（毫秒），不传则使用默认配置
   * @returns Token字符串
   */
  generateToken(payload: TokenPayload, expiresIn?: number): string {
    const header = Buffer.from(
      JSON.stringify({ alg: 'HS256', typ: 'JWT' })
    ).toString('base64url');

    const now = Date.now();
    const tokenPayload = {
      ...payload,
      iat: now,
      // 如果指定了过期时间则使用，否则使用默认配置（不传则永不过期）
      exp: expiresIn !== undefined ? now + expiresIn : undefined,
    };

    const encodedPayload = Buffer.from(JSON.stringify(tokenPayload)).toString(
      'base64url'
    );

    const signature = crypto
      .createHmac('sha256', this.tokenConfig.secretKey)
      .update(`${header}.${encodedPayload}`)
      .digest('base64url');

    return `${this.tokenConfig.tokenPrefix}${header}.${encodedPayload}.${signature}`;
  }

  /**
   * 生成万能 Token（永不过期）
   * @param userId - 用户ID
   * @param username - 用户名
   * @param email - 邮箱
   * @returns 万能Token字符串
   */
  generateMasterToken(userId: number, username: string, email: string): string {
    const payload: TokenPayload = {
      userId,
      username,
      email,
      type: 'master',
    };
    // 不设置 exp 字段，永不过期
    return this.generateToken(payload, undefined);
  }

  /**
   * 验证Token
   * @param token - Token字符串
   * @returns 解码后的载荷，如果无效则返回null
   */
  verifyToken(token: string): TokenPayload | null {
    try {
      // 检查Token前缀
      if (!token.startsWith(this.tokenConfig.tokenPrefix)) {
        return null;
      }

      // 移除前缀
      const tokenBody = token.slice(this.tokenConfig.tokenPrefix.length);
      const parts = tokenBody.split('.');

      if (parts.length !== 3) {
        return null;
      }

      const [headerB64, payloadB64, signature] = parts;

      // 验证签名
      const expectedSignature = crypto
        .createHmac('sha256', this.tokenConfig.secretKey)
        .update(`${headerB64}.${payloadB64}`)
        .digest('base64url');

      if (signature !== expectedSignature) {
        return null;
      }

      // 解析载荷
      const payload = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString()
      );

      // 检查过期时间（万能Token type=master 永不过期）
      if (payload.type !== 'master' && payload.exp && payload.exp < Date.now()) {
        return null;
      }

      return payload as TokenPayload;
    } catch {
      return null;
    }
  }

  /**
   * 注册用户
   * @param username - 用户名
   * @param email - 邮箱
   * @param password - 密码
   * @returns 创建的用户信息
   */
  async register(
    username: string,
    email: string,
    password: string
  ): Promise<Omit<IUser, 'password_hash'>> {
    const pool = this.getPool();

    // 验证输入
    if (!username || username.length < 3 || username.length > 50) {
      throw new UserServiceError('用户名长度必须在3-50个字符之间', 'INVALID_USERNAME');
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new UserServiceError('邮箱格式不正确', 'INVALID_EMAIL');
    }

    if (!password || password.length < 6) {
      throw new UserServiceError('密码长度至少6个字符', 'INVALID_PASSWORD');
    }

    // 检查用户名是否已存在
    const [existingUsers] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM users WHERE username = ? OR email = ?',
      [username, email]
    );

    if (existingUsers.length > 0) {
      throw new UserServiceError('用户名或邮箱已被注册', 'USER_EXISTS');
    }

    // 哈希密码
    const passwordHash = await this.hashPassword(password);

    // 插入用户
    const insertResult = await pool.query(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
      [username, email, passwordHash]
    );

    // mysql2 的 INSERT 返回 ResultSetHeader，需要正确解析
    const result = Array.isArray(insertResult) ? insertResult[0] : insertResult;
    const newUserId = (result as { insertId?: number }).insertId;

    if (newUserId === undefined || newUserId === 0) {
      throw new UserServiceError('用户创建失败', 'INSERT_FAILED');
    }

    // 获取创建的用户
    const [users] = await pool.query<RowDataPacket[]>(
      'SELECT id, username, email, status, created_at, updated_at, last_login_at FROM users WHERE id = ?',
      [newUserId]
    );

    const user = users[0];
    if (!user) {
      throw new UserServiceError('获取用户信息失败', 'USER_NOT_FOUND');
    }

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      status: user.status,
      created_at: user.created_at,
      updated_at: user.updated_at,
      last_login_at: user.last_login_at,
    };
  }

  /**
   * 用户登录
   * @param username - 用户名或邮箱
   * @param password - 密码
   * @returns 登录结果（用户信息 + Token）
   */
  async login(
    username: string,
    password: string
  ): Promise<{ user: Omit<IUser, 'password_hash'>; accessToken: string; refreshToken: string }> {
    const pool = this.getPool();

    // 查找用户
    const [users] = await pool.query<RowDataPacket[]>(
      'SELECT id, username, email, password_hash, status, created_at, updated_at, last_login_at FROM users WHERE username = ? OR email = ?',
      [username, username]
    );

    if (users.length === 0) {
      throw new UserServiceError('用户不存在', 'USER_NOT_FOUND');
    }

    const user = users[0];

    // 检查账户状态
    if (user.status === 'banned') {
      throw new UserServiceError('账户已被禁用', 'USER_BANNED');
    }

    if (user.status === 'inactive') {
      throw new UserServiceError('账户已停用', 'USER_INACTIVE');
    }

    // 验证密码
    const isPasswordValid = await this.verifyPassword(password, user.password_hash);
    if (!isPasswordValid) {
      throw new UserServiceError('密码错误', 'INVALID_PASSWORD');
    }

    // 生成Token
    const payload: TokenPayload = {
      userId: user.id,
      username: user.username,
      email: user.email,
    };

    const accessToken = this.generateToken(payload);
    const refreshToken = await this.generateRefreshToken(user.id);

    // 更新最后登录时间
    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);

    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        status: user.status,
        created_at: user.created_at,
        updated_at: user.updated_at,
        last_login_at: user.last_login_at,
      },
      accessToken,
      refreshToken,
    };
  }

  /**
   * 生成Refresh Token并存储
   * @param userId - 用户ID
   * @returns Refresh Token
   */
  private async generateRefreshToken(userId: number): Promise<string> {
    const pool = this.getPool();

    const payload: TokenPayload = {
      userId,
      type: 'refresh',
      username: '',
      email: '',
    };

    const refreshToken = this.generateToken(payload);

    // 存储Refresh Token
    const expiresAt = new Date(Date.now() + this.tokenConfig.refreshTokenExpiresIn);
    await pool.query(
      'INSERT INTO user_tokens (user_id, token, token_type, expires_at) VALUES (?, ?, ?, ?)',
      [userId, refreshToken, 'refresh', expiresAt]
    );

    return refreshToken;
  }

  /**
   * 刷新Access Token
   * @param refreshToken - Refresh Token
   * @returns 新的Access Token
   */
  async refreshAccessToken(refreshToken: string): Promise<string> {
    const pool = this.getPool();

    // 验证Token
    const payload = this.verifyToken(refreshToken);
    if (!payload || payload.type !== 'refresh') {
      throw new UserServiceError('无效的Refresh Token', 'INVALID_TOKEN');
    }

    // 检查Token是否已被撤销
    const [tokens] = await pool.query<RowDataPacket[]>(
      'SELECT id, revoked_at FROM user_tokens WHERE token = ?',
      [refreshToken]
    );

    if (tokens.length === 0) {
      throw new UserServiceError('Token不存在', 'TOKEN_NOT_FOUND');
    }

    if (tokens[0].revoked_at) {
      throw new UserServiceError('Token已被撤销', 'TOKEN_REVOKED');
    }

    // 获取用户信息
    const [users] = await pool.query<RowDataPacket[]>(
      'SELECT id, username, email, status FROM users WHERE id = ?',
      [payload.userId]
    );

    if (users.length === 0) {
      throw new UserServiceError('用户不存在', 'USER_NOT_FOUND');
    }

    const user = users[0];

    if (user.status !== 'active') {
      throw new UserServiceError('账户状态异常', 'USER_NOT_ACTIVE');
    }

    // 生成新的Access Token
    const newPayload: TokenPayload = {
      userId: user.id,
      username: user.username,
      email: user.email,
    };

    return this.generateToken(newPayload);
  }

  /**
   * 用户登出
   * @param token - Access Token
   */
  async logout(token: string): Promise<void> {
    const pool = this.getPool();

    // 撤销Refresh Token（如果有的话）
    const payload = this.verifyToken(token);
    if (payload && payload.type === 'refresh') {
      await pool.query('UPDATE user_tokens SET revoked_at = NOW() WHERE token = ?', [token]);
    }
  }

  /**
   * 通过Token获取用户信息
   * @param token - Access Token
   * @returns 用户信息
   */
  async getUserByToken(token: string): Promise<Omit<IUser, 'password_hash'> | null> {
    const payload = this.verifyToken(token);
    if (!payload) {
      return null;
    }

    const pool = this.getPool();
    const [users] = await pool.query<RowDataPacket[]>(
      'SELECT id, username, email, status, created_at, updated_at, last_login_at FROM users WHERE id = ?',
      [payload.userId]
    );

    if (users.length === 0) {
      return null;
    }

    const user = users[0];
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      status: user.status,
      created_at: user.created_at,
      updated_at: user.updated_at,
      last_login_at: user.last_login_at,
    };
  }

  /**
   * 根据ID获取用户信息
   * @param userId - 用户ID
   * @returns 用户信息
   */
  async getUserById(userId: number): Promise<Omit<IUser, 'password_hash'> | null> {
    const pool = this.getPool();
    const [users] = await pool.query<RowDataPacket[]>(
      'SELECT id, username, email, status, created_at, updated_at, last_login_at FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return null;
    }

    const user = users[0];
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      status: user.status,
      created_at: user.created_at,
      updated_at: user.updated_at,
      last_login_at: user.last_login_at,
    };
  }

  /**
   * 清理过期Token
   */
  async cleanupExpiredTokens(): Promise<number> {
    const pool = this.getPool();
    const result = await pool.query(
      'DELETE FROM user_tokens WHERE expires_at < NOW()'
    );
    // mysql2 的 DELETE 返回 ResultSetHeader
    const resultData = Array.isArray(result) ? result[0] : result;
    return (resultData as { affectedRows?: number }).affectedRows || 0;
  }
}

/**
 * 创建用户服务的工厂函数
 * @param config - MySQL配置
 * @returns UserService实例
 */
export function createUserService(config?: IMySQLConfig): UserService {
  return new UserService(config);
}
