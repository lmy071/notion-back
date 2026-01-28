/**
 * API 日志服务模块
 * @module apiloggerService
 * @description 提供将 API 调用日志写入数据库的功能
 */

import mysql, { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { getMySQLConfig, toPoolOptions } from './mysql';
import { v4 as uuidv4 } from 'uuid';

/**
 * API 日志数据结构
 */
export interface IApiLog {
  request_id: string;
  api_path: string;
  http_method: string;
  ip_address?: string;
  user_agent?: string;
  request_params?: string;
  request_body?: string;
  response_status?: number;
  response_time_ms?: number;
  error_message?: string;
}

/**
 * API 日志服务类
 */
export class ApiLoggerService {
  private static instance: ApiLoggerService;
  private pool: Pool | null = null;

  private constructor() {
    this.initPool();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): ApiLoggerService {
    if (!ApiLoggerService.instance) {
      ApiLoggerService.instance = new ApiLoggerService();
    }
    return ApiLoggerService.instance;
  }

  /**
   * 初始化数据库连接池
   */
  private initPool(): void {
    try {
      const config = getMySQLConfig();
      this.pool = mysql.createPool(toPoolOptions(config));
    } catch (error) {
      console.error('⚠️  API日志服务初始化失败:', error);
    }
  }

  /**
   * 获取连接池
   */
  private getPool(): Pool {
    if (!this.pool) {
      this.initPool();
      if (!this.pool) {
        throw new Error('MySQL连接池未初始化');
      }
    }
    return this.pool;
  }

  /**
   * 将 API 日志写入数据库
   * @param log 日志数据对象
   * @returns Promise<boolean> 是否写入成功
   */
  async saveLog(log: IApiLog): Promise<boolean> {
    const pool = this.getPool();
    const connection = await pool.getConnection();

    try {
      const sql = `
        INSERT INTO log_table (
          request_id, api_path, http_method, ip_address, user_agent,
          request_params, request_body, response_status, response_time_ms, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const params = [
        log.request_id,
        log.api_path,
        log.http_method,
        log.ip_address || null,
        log.user_agent || null,
        log.request_params || null,
        log.request_body || null,
        log.response_status || null,
        log.response_time_ms || null,
        log.error_message || null,
      ];

      await connection.execute(sql, params);
      return true;
    } catch (error) {
      console.error('❌ 写入API日志失败:', error);
      return false;
    } finally {
      connection.release();
    }
  }

  /**
   * 批量保存日志
   * @param logs 日志数组
   * @returns Promise<number> 成功写入的日志数量
   */
  async saveLogs(logs: IApiLog[]): Promise<number> {
    let successCount = 0;
    for (const log of logs) {
      const success = await this.saveLog(log);
      if (success) {
        successCount++;
      }
    }
    return successCount;
  }

  /**
   * 获取日志总数
   * @returns Promise<number> 日志总数
   */
  async getLogCount(): Promise<number> {
    try {
      const pool = this.getPool();
      const [rows] = await pool.execute<RowDataPacket[]>(
        'SELECT COUNT(*) as count FROM log_table'
      );
      return rows[0]?.count || 0;
    } catch (error) {
      console.error('❌ 获取日志总数失败:', error);
      return 0;
    }
  }

  /**
   * 获取最近的日志
   * @param limit 获取数量
   * @param offset 偏移量
   * @returns Promise<IApiLog[]> 日志数组
   */
  async getRecentLogs(limit: number = 100, offset: number = 0): Promise<IApiLog[]> {
    try {
      const pool = this.getPool();
      const [rows] = await pool.execute<RowDataPacket[]>(
        'SELECT * FROM log_table ORDER BY id DESC LIMIT ? OFFSET ?',
        [limit, offset]
      );
      return rows as unknown as IApiLog[];
    } catch (error) {
      console.error('❌ 获取日志失败:', error);
      return [];
    }
  }

  /**
   * 手动清理旧日志（保留最新的N条）
   * @param keepCount 保留的日志数量
   * @returns Promise<number> 删除的日志数量
   */
  async cleanOldLogs(keepCount: number = 10000): Promise<number> {
    try {
      const pool = this.getPool();
      const totalCount = await this.getLogCount();

      if (totalCount <= keepCount) {
        return 0;
      }

      const deleteCount = totalCount - keepCount;
      const [result] = await pool.execute(
        'DELETE FROM log_table ORDER BY id ASC LIMIT ?',
        [deleteCount]
      );

      // @ts-ignore - MySQL result
      return result.affectedRows || 0;
    } catch (error) {
      console.error('❌ 清理旧日志失败:', error);
      return 0;
    }
  }

  /**
   * 清空所有日志
   * @returns Promise<boolean> 是否成功
   */
  async clearAllLogs(): Promise<boolean> {
    try {
      const pool = this.getPool();
      await pool.execute('TRUNCATE TABLE log_table');
      return true;
    } catch (error) {
      console.error('❌ 清空日志失败:', error);
      return false;
    }
  }

  /**
   * 关闭连接池
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}

/**
 * 生成请求ID
 * @returns UUID字符串
 */
export function generateRequestId(): string {
  return uuidv4();
}

/**
 * 安全地序列化为JSON字符串
 * @param data 任意数据
 * @returns JSON字符串，如果失败返回空字符串
 */
export function safeStringify(data: unknown): string {
  if (data === undefined) return '';
  if (data === null) return '';

  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

// 导出单例实例
export const apiLoggerService = ApiLoggerService.getInstance();
