/**
 * 同步数据库配置服务模块
 * @module syncDatabaseService
 * @description 提供 sync_databases 表的增删改查操作
 */

import { RowDataPacket } from 'mysql2/promise';
import { MySQLClient, MySQLQueryError } from './mysqlClient';
import {
  ISyncDatabase,
  ICreateSyncDatabaseRequest,
  IUpdateSyncDatabaseRequest,
  ISyncDatabaseListQuery,
  SyncDatabaseStatus,
} from './types';

/**
 * ResultSetHeader 类型声明（用于 INSERT/UPDATE/DELETE 操作）
 */
interface ResultSetHeader {
  affectedRows: number;
  insertId: number;
  warningStatus: number;
}

/**
 * 查询表数据的请求参数
 */
export interface IQueryTableDataParams {
  /** 表名 */
  tableName: string;
  /** 页码 */
  page?: number;
  /** 每页数量 */
  pageSize?: number;
  /** 排序字段 */
  orderBy?: string;
  /** 排序方向 */
  orderDir?: 'ASC' | 'DESC';
}

/**
 * 查询表数据的结果
 */
export interface IQueryTableDataResult {
  /** 表名 */
  tableName: string;
  /** 数据列表 */
  list: RowDataPacket[];
  /** 总记录数 */
  total: number;
  /** 页码 */
  page: number;
  /** 每页数量 */
  pageSize: number;
}

/**
 * 同步数据库配置服务类
 */
export class SyncDatabaseService {
  /** MySQL客户端 */
  private mysqlClient: MySQLClient;
  /** 表名 */
  private readonly tableName = 'sync_databases';

  /**
   * 创建同步数据库配置服务
   * @param mysqlClient - MySQL客户端实例
   */
  constructor(mysqlClient?: MySQLClient) {
    this.mysqlClient = mysqlClient || new MySQLClient();
  }

  /**
   * 初始化MySQL连接
   */
  async initialize(): Promise<void> {
    await this.mysqlClient.initialize();
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    await this.mysqlClient.close();
  }

  /**
   * 将数据库行转换为ISyncDatabase对象
   * @param row - 数据库行
   * @returns ISyncDatabase对象
   */
  private rowToSyncDatabase(row: RowDataPacket): ISyncDatabase {
    return {
      id: row.id,
      notionDatabaseId: row.notion_database_id,
      tableName: row.table_name,
      databaseName: row.database_name,
      status: row.status as SyncDatabaseStatus,
      syncInterval: row.sync_interval,
      lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      remark: row.remark || null,
    };
  }

  /**
   * 创建同步数据库配置
   * @param data - 创建请求数据
   * @returns Promise<ISyncDatabase> - 创建的配置
   * @throws MySQLQueryError - 创建失败时抛出
   */
  async create(data: ICreateSyncDatabaseRequest): Promise<ISyncDatabase> {
    const pool = (this.mysqlClient as unknown as { getPool: () => { query: (sql: string, params: unknown[]) => Promise<[ResultSetHeader, unknown[]]> } }).getPool();
    const sql = `
      INSERT INTO \`${this.tableName}\`
        (notion_database_id, table_name, database_name, status, sync_interval, remark)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    const params = [
      data.notionDatabaseId,
      data.tableName,
      data.databaseName,
      data.status || 'active',
      data.syncInterval || 300,
      data.remark || null,
    ];

    try {
      const [result] = await pool.query(sql, params);
      const created = await this.findById(result.insertId);
      if (!created) {
        throw new Error('创建后查询失败');
      }
      return created;
    } catch (error) {
      if (error instanceof MySQLQueryError) {
        throw error;
      }
      const mysqlError = error as { code?: string };
      if (mysqlError.code === 'ER_DUP_ENTRY') {
        throw new Error('Notion数据库ID或表名已存在');
      }
      throw new MySQLQueryError(`创建同步数据库配置失败: ${(error as Error).message}`, sql);
    }
  }

  /**
   * 根据ID查询配置
   * @param id - 配置ID
   * @returns Promise<ISyncDatabase | null> - 配置对象，不存在返回null
   */
  async findById(id: number): Promise<ISyncDatabase | null> {
    const pool = (this.mysqlClient as unknown as { getPool: () => { query: (sql: string, params: unknown[]) => Promise<[RowDataPacket[], unknown[]]> } }).getPool();
    const sql = `SELECT * FROM \`${this.tableName}\` WHERE \`id\` = ?`;

    try {
      const [rows] = await pool.query(sql, [id]);
      if (rows.length === 0) {
        return null;
      }
      return this.rowToSyncDatabase(rows[0]);
    } catch (error) {
      throw new MySQLQueryError('查询同步数据库配置失败', sql);
    }
  }

  /**
   * 根据Notion数据库ID查询配置
   * @param notionDatabaseId - Notion数据库ID
   * @returns Promise<ISyncDatabase | null> - 配置对象，不存在返回null
   */
  async findByNotionDatabaseId(notionDatabaseId: string): Promise<ISyncDatabase | null> {
    const pool = (this.mysqlClient as unknown as { getPool: () => { query: (sql: string, params: unknown[]) => Promise<[RowDataPacket[], unknown[]]> } }).getPool();
    const sql = `SELECT * FROM \`${this.tableName}\` WHERE \`notion_database_id\` = ?`;

    try {
      const [rows] = await pool.query(sql, [notionDatabaseId]);
      if (rows.length === 0) {
        return null;
      }
      return this.rowToSyncDatabase(rows[0]);
    } catch (error) {
      throw new MySQLQueryError('查询同步数据库配置失败', sql);
    }
  }

  /**
   * 根据表名查询配置
   * @param tableName - MySQL表名
   * @returns Promise<ISyncDatabase | null> - 配置对象，不存在返回null
   */
  async findByTableName(tableName: string): Promise<ISyncDatabase | null> {
    const pool = (this.mysqlClient as unknown as { getPool: () => { query: (sql: string, params: unknown[]) => Promise<[RowDataPacket[], unknown[]]> } }).getPool();
    const sql = `SELECT * FROM \`${this.tableName}\` WHERE \`table_name\` = ?`;

    try {
      const [rows] = await pool.query(sql, [tableName]);
      if (rows.length === 0) {
        return null;
      }
      return this.rowToSyncDatabase(rows[0]);
    } catch (error) {
      throw new MySQLQueryError('查询同步数据库配置失败', sql);
    }
  }

  /**
   * 获取所有同步数据库配置
   * @param query - 查询参数
   * @returns Promise<{ list: ISyncDatabase[]; total: number }> - 配置列表和总数
   */
  async findAll(query?: ISyncDatabaseListQuery): Promise<{ list: ISyncDatabase[]; total: number }> {
    const pool = (this.mysqlClient as unknown as { getPool: () => { query: (sql: string, params: unknown[]) => Promise<[RowDataPacket[], unknown[]]> } }).getPool();
    const page = query?.page || 1;
    const pageSize = query?.pageSize || 20;
    const offset = (page - 1) * pageSize;

    // 构建查询条件
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query?.status) {
      conditions.push('`status` = ?');
      params.push(query.status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // 查询总数
    const countSql = `SELECT COUNT(*) as count FROM \`${this.tableName}\` ${whereClause}`;
    try {
      const [countRows] = await pool.query(countSql, params);
      const total = countRows[0]?.count || 0;
      if (total === 0) {
        return { list: [], total: 0 };
      }

      // 查询列表
      const listSql = `
        SELECT * FROM \`${this.tableName}\`
        ${whereClause}
        ORDER BY \`created_at\` DESC
        LIMIT ? OFFSET ?
      `;
      const [listRows] = await pool.query(listSql, [...params, pageSize, offset]);

      return {
        list: listRows.map((row) => this.rowToSyncDatabase(row)),
        total,
      };
    } catch (error) {
      throw new MySQLQueryError('查询同步数据库配置列表失败', countSql);
    }
  }

  /**
   * 更新同步数据库配置
   * @param id - 配置ID
   * @param data - 更新数据
   * @returns Promise<ISyncDatabase | null> - 更新后的配置，不存在返回null
   */
  async update(id: number, data: IUpdateSyncDatabaseRequest): Promise<ISyncDatabase | null> {
    const pool = (this.mysqlClient as unknown as { getPool: () => { query: (sql: string, params: unknown[]) => Promise<[ResultSetHeader, unknown[]]> } }).getPool();

    // 构建更新字段
    const updates: string[] = [];
    const params: unknown[] = [];

    if (data.tableName !== undefined) {
      updates.push('`table_name` = ?');
      params.push(data.tableName);
    }
    if (data.databaseName !== undefined) {
      updates.push('`database_name` = ?');
      params.push(data.databaseName);
    }
    if (data.status !== undefined) {
      updates.push('`status` = ?');
      params.push(data.status);
    }
    if (data.syncInterval !== undefined) {
      updates.push('`sync_interval` = ?');
      params.push(data.syncInterval);
    }
    if (data.remark !== undefined) {
      updates.push('`remark` = ?');
      params.push(data.remark);
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    const sql = `UPDATE \`${this.tableName}\` SET ${updates.join(', ')} WHERE \`id\` = ?`;
    params.push(id);

    try {
      const [result] = await pool.query(sql, params);
      if (result.affectedRows === 0) {
        return null;
      }
      const updated = await this.findById(id);
      return updated;
    } catch (error) {
      if (error instanceof MySQLQueryError) {
        throw error;
      }
      const mysqlError = error as { code?: string };
      if (mysqlError.code === 'ER_DUP_ENTRY') {
        throw new Error('表名已存在');
      }
      throw new MySQLQueryError(`更新同步数据库配置失败: ${(error as Error).message}`, sql);
    }
  }

  /**
   * 删除同步数据库配置
   * @param id - 配置ID
   * @returns Promise<boolean> - 是否删除成功
   */
  async delete(id: number): Promise<boolean> {
    const pool = (this.mysqlClient as unknown as { getPool: () => { query: (sql: string, params: unknown[]) => Promise<[ResultSetHeader, unknown[]]> } }).getPool();
    const sql = `DELETE FROM \`${this.tableName}\` WHERE \`id\` = ?`;

    try {
      const [result] = await pool.query(sql, [id]);
      return result.affectedRows > 0;
    } catch (error) {
      throw new MySQLQueryError(`删除同步数据库配置失败: ${(error as Error).message}`, sql);
    }
  }

  /**
   * 获取所有启用的同步数据库配置
   * @returns Promise<ISyncDatabase[]> - 启用的配置列表
   */
  async findActive(): Promise<ISyncDatabase[]> {
    const pool = (this.mysqlClient as unknown as { getPool: () => { query: (sql: string, params?: unknown[]) => Promise<[RowDataPacket[], unknown[]]> } }).getPool();
    const sql = `
      SELECT * FROM \`${this.tableName}\`
      WHERE \`status\` = 'active'
      ORDER BY \`created_at\` ASC
    `;

    try {
      const [rows] = await pool.query(sql, []);
      return rows.map((row) => this.rowToSyncDatabase(row));
    } catch (error) {
      throw new MySQLQueryError('查询启用的同步数据库配置失败', sql);
    }
  }

  /**
   * 更新最后同步时间
   * @param id - 配置ID
   * @returns Promise<boolean> - 是否更新成功
   */
  async updateLastSyncAt(id: number): Promise<boolean> {
    const pool = (this.mysqlClient as unknown as { getPool: () => { query: (sql: string, params: unknown[]) => Promise<[ResultSetHeader, unknown[]]> } }).getPool();
    const sql = `UPDATE \`${this.tableName}\` SET \`last_sync_at\` = NOW() WHERE \`id\` = ?`;

    try {
      const [result] = await pool.query(sql, [id]);
      return result.affectedRows > 0;
    } catch (error) {
      throw new MySQLQueryError(`更新最后同步时间失败: ${(error as Error).message}`, sql);
    }
  }

  /**
   * 检查表是否在 sync_databases 中已配置
   * @param tableName - 表名
   * @returns Promise<{ valid: boolean; config: ISyncDatabase | null; message: string }> - 验证结果和配置
   */
  async validateTable(tableName: string): Promise<{
    valid: boolean;
    config: ISyncDatabase | null;
    message: string;
  }> {
    const config = await this.findByTableName(tableName);

    if (!config) {
      return {
        valid: false,
        config: null,
        message: `表 '${tableName}' 未在 sync_databases 中配置`,
      };
    }

    if (config.status !== 'active') {
      return {
        valid: false,
        config,
        message: `表 '${tableName}' 的同步配置已禁用`,
      };
    }

    return {
      valid: true,
      config,
      message: '表配置有效',
    };
  }

  /**
   * 查询已配置表的数据
   * @param params - 查询参数
   * @returns Promise<IQueryTableDataResult> - 查询结果
   * @throws Error - 表未配置或不存在时抛出
   */
  async queryTableData(params: IQueryTableDataParams): Promise<IQueryTableDataResult> {
    const { tableName, page, pageSize, orderBy, orderDir } = params;

    // 验证表是否在 sync_databases 中配置
    const validation = await this.validateTable(tableName);
    if (!validation.valid) {
      throw new Error(validation.message);
    }

    // 查询数据
    const result = await this.mysqlClient.findAll(tableName, {
      page: page || 1,
      pageSize: pageSize || 20,
      orderBy: orderBy || 'created_time',
      orderDir: orderDir || 'DESC',
    });

    return {
      tableName,
      list: result.list,
      total: result.total,
      page: page || 1,
      pageSize: pageSize || 20,
    };
  }

  /**
   * 根据ID查询已配置表的单条记录
   * @param tableName - 表名
   * @param id - 记录ID
   * @returns Promise<RowDataPacket | null> - 记录数据
   */
  async findRecordById(tableName: string, id: string): Promise<RowDataPacket | null> {
    // 验证表是否在 sync_databases 中配置
    const validation = await this.validateTable(tableName);
    if (!validation.valid) {
      throw new Error(validation.message);
    }

    return this.mysqlClient.findRecordById(tableName, id);
  }

  /**
   * 获取已配置表的记录数
   * @param tableName - 表名
   * @returns Promise<number> - 记录数
   */
  async getTableCount(tableName: string): Promise<number> {
    // 验证表是否在 sync_databases 中配置
    const validation = await this.validateTable(tableName);
    if (!validation.valid) {
      throw new Error(validation.message);
    }

    return this.mysqlClient.count(tableName);
  }
}

/**
 * 创建同步数据库配置服务的工厂函数
 * @param mysqlClient - MySQL客户端实例（可选）
 * @returns SyncDatabaseService实例
 */
export function createSyncDatabaseService(mysqlClient?: MySQLClient): SyncDatabaseService {
  return new SyncDatabaseService(mysqlClient);
}
