/**
 * MySQL客户端封装模块
 * @module mysqlClient
 * @description 封装MySQL数据库操作，包括连接池管理、表创建、数据CRUD等
 */

import mysql, { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import {
  IMySQLField,
  MySQLFieldType,
  ISchemaAnalysis,
  IFieldAnalysis,
  NotionPropertyType,
  PROPERTY_TO_MYSQL_MAPPING,
} from './types';
import { IMySQLConfig, getMySQLConfig, isMySQLConfigValid, toPoolOptions } from './mysql';

/**
 * ============================================
 * 异常类型定义
 * ============================================
 */

/**
 * MySQL连接异常
 */
export class MySQLConnectionError extends Error {
  /** 原始错误 */
  originalError?: Error;

  constructor(message: string, originalError?: Error) {
    super(message);
    this.name = 'MySQLConnectionError';
    this.originalError = originalError;
  }
}

/**
 * MySQL查询异常
 */
export class MySQLQueryError extends Error {
  /** SQL语句 */
  sql: string;
  /** 错误代码 */
  code?: string;

  constructor(message: string, sql: string, code?: string) {
    super(message);
    this.name = 'MySQLQueryError';
    this.sql = sql;
    this.code = code;
  }
}

/**
 * MySQL Schema异常
 */
export class MySQLSchemaError extends Error {
  /** 表名 */
  tableName: string;

  constructor(message: string, tableName: string) {
    super(message);
    this.name = 'MySQLSchemaError';
    this.tableName = tableName;
  }
}

/**
 * ============================================
 * MySQL客户端类
 * ============================================
 */

/**
 * MySQL客户端类
 * @description 封装MySQL数据库的所有操作
 */
export class MySQLClient {
  /** 连接池 */
  private pool: Pool | null = null;
  /** 配置对象 */
  private config: IMySQLConfig;

  /**
   * 创建MySQL客户端
   * @param config - MySQL配置（可选，默认从环境变量读取）
   * @throws MySQLConnectionError - 配置无效或连接失败时抛出
   */
  constructor(config?: IMySQLConfig) {
    this.config = config || getMySQLConfig();

    if (!isMySQLConfigValid(this.config)) {
      throw new MySQLConnectionError('MySQL配置无效，请检查环境变量配置');
    }
  }

  /**
   * 初始化连接池
   * @throws MySQLConnectionError - 连接失败时抛出
   */
  async initialize(): Promise<void> {
    try {
      const poolOptions = toPoolOptions(this.config);
      this.pool = mysql.createPool(poolOptions);

      // 测试连接
      const connection = await this.pool.getConnection();
      connection.release();
    } catch (error) {
      if (error instanceof Error) {
        throw new MySQLConnectionError(
          `MySQL连接失败: ${error.message}`,
          error
        );
      }
      throw new MySQLConnectionError('MySQL连接失败: 未知错误');
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

  /**
   * 获取连接池
   * @returns Pool - MySQL连接池
   * @throws MySQLConnectionError - 连接池未初始化时抛出
   */
  private getPool(): Pool {
    if (!this.pool) {
      throw new MySQLConnectionError('MySQL连接池未初始化，请先调用initialize()');
    }
    return this.pool;
  }

  /**
   * 检查表是否存在
   * @param tableName - 表名
   * @returns Promise<boolean> - 是否存在
   */
  async tableExists(tableName: string): Promise<boolean> {
    const pool = this.getPool();
    const sql = `
      SELECT COUNT(*) as count
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    `;

    try {
      const [rows] = await pool.query<RowDataPacket[]>(sql, [
        this.config.database,
        tableName,
      ]);
      return (rows[0]?.count || 0) > 0;
    } catch (error) {
      throw new MySQLQueryError('检查表是否存在失败', sql);
    }
  }

  /**
   * 获取表字段信息
   * @param tableName - 表名
   * @returns Promise<IMySQLField[]> - 字段列表
   */
  async getTableColumns(tableName: string): Promise<IMySQLField[]> {
    const pool = this.getPool();
    const sql = `
      SELECT
        COLUMN_NAME as name,
        COLUMN_TYPE as type,
        IS_NULLABLE as is_nullable,
        COLUMN_KEY as column_key,
        COLUMN_DEFAULT as default_value,
        COLUMN_COMMENT as comment
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION
    `;

    try {
      const [rows] = await pool.query<RowDataPacket[]>(sql, [
        this.config.database,
        tableName,
      ]);

      return rows.map((row): IMySQLField => {
        // 解析字段类型
        const typeStr = row.type as string;
        let mysqlType = MySQLFieldType.VARCHAR;
        let length = 0;
        let decimals = 0;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const typeMatch = (typeStr as any)?.match(/^(\w+)(?:\((\d+)(?:,(\d+))?\))?/);
        if (typeMatch) {
          const typeName = typeMatch[1].toUpperCase() as keyof typeof MySQLFieldType;
          if (MySQLFieldType[typeName]) {
            mysqlType = MySQLFieldType[typeName];
          }
          length = typeMatch[2] ? parseInt(typeMatch[2], 10) : 0;
          decimals = typeMatch[3] ? parseInt(typeMatch[3], 10) : 0;
        }

        return {
          name: row.name as string,
          type: mysqlType,
          length,
          decimals,
          isPrimaryKey: (row.column_key as string) === 'PRI',
          isNullable: row.is_nullable === 'YES',
          defaultValue: row.default_value as string | number | null,
          comment: row.comment as string | undefined,
        };
      });
    } catch (error) {
      throw new MySQLQueryError('获取表字段信息失败', sql);
    }
  }

  /**
   * 将Notion属性转换为MySQL字段定义
   * @param propertyName - 属性名
   * @param propertyType - Notion属性类型
   * @param isPrimaryKey - 是否为主键
   * @returns IMySQLField - MySQL字段定义
   */
  private   propertyToMySQLField(
    propertyName: string,
    propertyType: NotionPropertyType,
    isPrimaryKey: boolean = false
  ): IMySQLField {
    const mapping = PROPERTY_TO_MYSQL_MAPPING[propertyType] || {
      mysqlFieldType: MySQLFieldType.VARCHAR,
      defaultLength: 500,
      isNullable: true,
      description: `未知属性类型: ${propertyType}`,
    };

    return {
      name: propertyName,
      type: mapping.mysqlFieldType,
      length: mapping.defaultLength || undefined,
      isPrimaryKey,
      isNullable: mapping.isNullable,
      comment: mapping.description,
    };
  }

  /**
   * 分析Notion数据库Schema并生成MySQL表结构
   * @param fieldNames - 字段名列表
   * @param fieldTypes - 字段类型映射
   * @param tableName - 表名
   * @returns ISchemaAnalysis - Schema分析结果
   */
  analyzeSchema(
    fieldNames: string[],
    fieldTypes: Record<string, NotionPropertyType>,
    tableName: string
  ): ISchemaAnalysis {
    const fields: IFieldAnalysis[] = [];
    let primaryKey = 'id';

    // 添加ID字段（主键）
    fields.push({
      name: 'id',
      type: MySQLFieldType.VARCHAR,
      notionType: 'rich_text' as NotionPropertyType,
      mysqlType: MySQLFieldType.VARCHAR,
      length: 50,
      isPrimaryKey: true,
      isNullable: false,
      comment: 'Notion页面ID，作为主键',
    });

    // 添加时间戳字段
    fields.push({
      name: 'created_time',
      type: MySQLFieldType.DATETIME,
      notionType: 'created_time' as NotionPropertyType,
      mysqlType: MySQLFieldType.DATETIME,
      length: 0,
      isPrimaryKey: false,
      isNullable: true,
      comment: '创建时间',
    });

    fields.push({
      name: 'last_edited_time',
      type: MySQLFieldType.DATETIME,
      notionType: 'last_edited_time' as NotionPropertyType,
      mysqlType: MySQLFieldType.DATETIME,
      length: 0,
      isPrimaryKey: false,
      isNullable: true,
      comment: '最后编辑时间',
    });

    // 添加URL字段
    fields.push({
      name: 'url',
      type: MySQLFieldType.VARCHAR,
      notionType: 'url' as NotionPropertyType,
      mysqlType: MySQLFieldType.VARCHAR,
      length: 500,
      isPrimaryKey: false,
      isNullable: true,
      comment: 'Notion页面URL',
    });

    // 添加properties字段（JSON格式存储所有原始属性）
    fields.push({
      name: 'properties',
      type: MySQLFieldType.JSON,
      notionType: 'json' as NotionPropertyType,
      mysqlType: MySQLFieldType.JSON,
      length: 0,
      isPrimaryKey: false,
      isNullable: true,
      comment: 'Notion页面原始属性数据',
    });

    // 解析每个字段
    for (let i = 0; i < fieldNames.length; i++) {
      const fieldName = fieldNames[i];
      // fieldTypes 使用清理后的字段名作为 key
      const propertyType = fieldTypes[fieldName] || 'rich_text';
      // 获取映射，如果不存在则使用默认值
      const mapping = PROPERTY_TO_MYSQL_MAPPING[propertyType] || {
        mysqlFieldType: MySQLFieldType.VARCHAR,
        defaultLength: 500,
        isNullable: true,
      };

      fields.push({
        name: fieldName,
        type: mapping.mysqlFieldType,
        notionType: propertyType,
        mysqlType: mapping.mysqlFieldType,
        length: mapping.defaultLength || 0,
        isPrimaryKey: false,
        isNullable: mapping.isNullable,
        comment: `Notion属性: ${fieldName}`,
      });
    }

    return {
      tableName,
      fields,
      primaryKey,
      tableExists: false,
    };
  }

  /**
   * 生成建表SQL
   * @param schema - Schema分析结果
   * @returns string - SQL语句
   */
  generateCreateTableSQL(schema: ISchemaAnalysis): string {
    const fieldDefs: string[] = [];

    for (const field of schema.fields) {
      let fieldDef = `\`${field.name}\` ${field.type}`;

      // 添加长度（如果需要）
      if (
        field.length &&
        [
          MySQLFieldType.VARCHAR,
          MySQLFieldType.DECIMAL,
          MySQLFieldType.FLOAT,
          MySQLFieldType.DOUBLE,
        ].includes(field.type)
      ) {
        fieldDef += `(${field.length}${field.decimals ? `,${field.decimals}` : ''})`;
      }

      // 添加可空性
      if (!field.isNullable) {
        fieldDef += ' NOT NULL';
      }

      // 添加默认值
      if (field.defaultValue !== undefined && field.defaultValue !== null) {
        fieldDef += ` DEFAULT ${field.defaultValue}`;
      }

      // 添加注释
      if (field.comment) {
        fieldDef += ` COMMENT '${field.comment.replace(/'/g, "\\'")}'`;
      }

      fieldDefs.push(fieldDef);
    }

    // 添加主键
    fieldDefs.push(`PRIMARY KEY (\`${schema.primaryKey}\`)`);

    // 添加表注释
    const tableComment = `Notion数据库同步表: ${schema.tableName}`;

    return `
      CREATE TABLE \`${schema.tableName}\` (
        ${fieldDefs.join(',\n        ')}
      ) ENGINE=InnoDB DEFAULT CHARSET=${this.config.charset} COLLATE=utf8mb4_unicode_ci
      COMMENT='${tableComment}'
    `.trim();
  }

  /**
   * 生成添加字段SQL
   * @param tableName - 表名
   * @param field - 字段定义
   * @returns string - SQL语句
   */
  generateAddColumnSQL(tableName: string, field: IMySQLField): string {
    let fieldDef = `\`${field.name}\` ${field.type}`;

    if (
      field.length &&
      [
        MySQLFieldType.VARCHAR,
        MySQLFieldType.DECIMAL,
        MySQLFieldType.FLOAT,
        MySQLFieldType.DOUBLE,
      ].includes(field.type)
    ) {
      fieldDef += `(${field.length}${field.decimals ? `,${field.decimals}` : ''})`;
    }

    if (!field.isNullable) {
      fieldDef += ' NOT NULL';
    }

    if (field.defaultValue !== undefined && field.defaultValue !== null) {
      fieldDef += ` DEFAULT ${field.defaultValue}`;
    }

    if (field.comment) {
      fieldDef += ` COMMENT '${field.comment.replace(/'/g, "\\'")}'`;
    }

    return `ALTER TABLE \`${tableName}\` ADD COLUMN ${fieldDef}`;
  }

  /**
   * 创建表
   * @param schema - Schema分析结果
   * @throws MySQLSchemaError - 创建失败时抛出
   */
  async createTable(schema: ISchemaAnalysis): Promise<void> {
    const pool = this.getPool();
    const sql = this.generateCreateTableSQL(schema);

    try {
      await pool.query(sql);
    } catch (error) {
      if (error instanceof Error) {
        throw new MySQLSchemaError(`创建表失败: ${error.message}`, schema.tableName);
      }
      throw new MySQLSchemaError('创建表失败: 未知错误', schema.tableName);
    }
  }

  /**
   * 更新表结构（添加新字段）
   * @param tableName - 表名
   * @param newFields - 需要添加的新字段
   * @throws MySQLSchemaError - 更新失败时抛出
   */
  async updateTableSchema(
    tableName: string,
    newFields: IFieldAnalysis[]
  ): Promise<void> {
    const pool = this.getPool();

    for (const field of newFields) {
      const sql = this.generateAddColumnSQL(tableName, field);

      try {
        await pool.query(sql);
      } catch (error) {
        // 忽略字段已存在的错误
        const mysqlError = error as { code?: string };
        if (mysqlError.code !== 'ER_DUP_FIELDNAME') {
          throw new MySQLSchemaError(
            `添加字段失败: ${(error as Error).message}`,
            tableName
          );
        }
      }
    }
  }

  /**
   * 插入或更新记录
   * @param tableName - 表名
   * @param data - 数据对象
   * @param primaryKeyField - 主键字段名
   * @throws MySQLQueryError - 操作失败时抛出
   */
  async upsert(
    tableName: string,
    data: Record<string, unknown>,
    primaryKeyField: string = 'id'
  ): Promise<void> {
    const pool = this.getPool();
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map(() => '?').join(', ');
    const updateClauses = keys.map((key) => `\`${key}\` = VALUES(\`${key}\`)`).join(', ');

    const sql = `
      INSERT INTO \`${tableName}\` (${keys.map((k) => `\`${k}\``).join(', ')})
      VALUES (${placeholders})
      ON DUPLICATE KEY UPDATE ${updateClauses}
    `;

    try {
      await pool.query<ResultSetHeader>(sql, values);
    } catch (error) {
      throw new MySQLQueryError(
        `插入/更新记录失败: ${(error as Error).message}`,
        sql
      );
    }
  }

  /**
   * 批量插入或更新记录
   * @param tableName - 表名
   * @param records - 数据记录数组
   * @param primaryKeyField - 主键字段名
   * @throws MySQLQueryError - 操作失败时抛出
   */
  async batchUpsert(
    tableName: string,
    records: Record<string, unknown>[],
    primaryKeyField: string = 'id'
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }

    const pool = this.getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      for (const record of records) {
        await this.upsert(tableName, record, primaryKeyField);
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw new MySQLQueryError(
        `批量插入/更新记录失败: ${(error as Error).message}`,
        'BATCH_UPSERT'
      );
    } finally {
      connection.release();
    }
  }

  /**
   * 根据ID查询记录
   * @param tableName - 表名
   * @param id - 记录ID
   * @returns Promise<RowDataPacket | null> - 记录数据
   */
  async findById(
    tableName: string,
    id: string
  ): Promise<RowDataPacket | null> {
    const pool = this.getPool();
    const sql = `SELECT * FROM \`${tableName}\` WHERE \`id\` = ?`;

    try {
      const [rows] = await pool.query<RowDataPacket[]>(sql, [id]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      throw new MySQLQueryError('查询记录失败', sql);
    }
  }

  /**
   * 获取表中的所有记录数
   * @param tableName - 表名
   * @returns Promise<number> - 记录数
   */
  async count(tableName: string): Promise<number> {
    const pool = this.getPool();
    const sql = `SELECT COUNT(*) as count FROM \`${tableName}\``;

    try {
      const [rows] = await pool.query<RowDataPacket[]>(sql);
      return rows[0]?.count || 0;
    } catch (error) {
      throw new MySQLQueryError('统计记录数失败', sql);
    }
  }

  /**
   * 查询表的所有记录（支持分页）
   * @param tableName - 表名
   * @param options - 查询选项
   * @returns Promise<{ list: RowDataPacket[]; total: number }> - 记录列表和总数
   */
  async findAll(
    tableName: string,
    options?: {
      page?: number;
      pageSize?: number;
      orderBy?: string;
      orderDir?: 'ASC' | 'DESC';
    }
  ): Promise<{ list: RowDataPacket[]; total: number }> {
    const pool = this.getPool();
    const page = options?.page || 1;
    const pageSize = options?.pageSize || 20;
    const offset = (page - 1) * pageSize;
    const orderBy = options?.orderBy || 'created_time';
    const orderDir = options?.orderDir || 'DESC';

    // 查询总数
    const countSql = `SELECT COUNT(*) as count FROM \`${tableName}\``;
    try {
      const [countRows] = await pool.query<RowDataPacket[]>(countSql);
      const total = countRows[0]?.count || 0;
      if (total === 0) {
        return { list: [], total: 0 };
      }

      // 查询列表
      const listSql = `
        SELECT * FROM \`${tableName}\`
        ORDER BY \`${orderBy}\` ${orderDir}
        LIMIT ? OFFSET ?
      `;
      const [listRows] = await pool.query<RowDataPacket[]>(listSql, [pageSize, offset]);

      return { list: listRows, total };
    } catch (error) {
      throw new MySQLQueryError(`查询表数据失败: ${tableName}`, countSql);
    }
  }

  /**
   * 根据ID查询表的记录
   * @param tableName - 表名
   * @param id - 记录ID
   * @returns Promise<RowDataPacket | null> - 记录数据
   */
  async findRecordById(
    tableName: string,
    id: string
  ): Promise<RowDataPacket | null> {
    return this.findById(tableName, id);
  }

  /**
   * 执行自定义查询（仅用于已验证的查询）
   * @param sql - SQL语句
   * @param params - 查询参数
   * @returns Promise<RowDataPacket[]> - 查询结果
   */
  async query<T extends RowDataPacket[]>(
    sql: string,
    params?: unknown[]
  ): Promise<T> {
    const pool = this.getPool();
    try {
      const [rows] = await pool.query<T>(sql, params);
      return rows;
    } catch (error) {
      throw new MySQLQueryError(`查询失败: ${(error as Error).message}`, sql);
    }
  }
}

/**
 * 创建MySQL客户端的工厂函数
 * @param config - MySQL配置（可选）
 * @returns MySQLClient实例
 */
export function createMySQLClient(config?: IMySQLConfig): MySQLClient {
  return new MySQLClient(config);
}
