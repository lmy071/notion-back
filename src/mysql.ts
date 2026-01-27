/**
 * MySQL配置模块
 * @module mysql
 * @description 管理MySQL数据库连接配置，支持环境变量覆盖和类型化配置导出
 */

import dotenv from 'dotenv';
import { PoolOptions } from 'mysql2/promise';

/**
 * 加载环境变量配置
 */
dotenv.config();

/**
 * MySQL连接池配置接口
 * @description 定义MySQL数据库连接的所有配置项，包含类型约束
 */
export interface IMySQLConfig {
  /** 数据库主机地址 */
  host: string;
  /** 数据库端口 */
  port: number;
  /** 数据库用户名 */
  user: string;
  /** 数据库密码 */
  password: string;
  /** 数据库名称 */
  database: string;
  /** 字符集 */
  charset: string;
  /** 连接超时时间（毫秒） */
  connectTimeout: number;
  /** 连接池配置 */
  pool: {
    /** 最小连接数 */
    min: number;
    /** 最大连接数 */
    max: number;
    /** 获取连接超时时间（毫秒） */
    acquireTimeout: number;
    /** 空闲连接超时时间（毫秒） */
    idleTimeout: number;
  };
  /** 其他选项 */
  options?: {
    /** 是否启用多语句查询 */
    multipleStatements?: boolean;
    /** 日期处理方式 */
    dateStrings?: boolean;
    /** 时区配置 */
    timezone?: string;
  };
}

/**
 * 默认MySQL配置
 * @description 用于环境变量未设置时的默认值
 */
const defaultMySQLConfig: Readonly<IMySQLConfig> = {
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: '',
  database: 'notion_sync',
  charset: 'utf8mb4',
  connectTimeout: 10000, // 10秒
  pool: {
    min: 2,
    max: 10,
    acquireTimeout: 30000, // 30秒
    idleTimeout: 60000, // 60秒
  },
  options: {
    multipleStatements: true,
    dateStrings: false,
    timezone: '+00:00',
  },
};

/**
 * 获取环境变量值的工具函数
 * @param envKey - 环境变量键名
 * @param defaultValue - 默认值
 * @returns 环境变量值或默认值
 */
function getEnvValue(envKey: string, defaultValue: string): string {
  const value = process.env[envKey];
  return value !== undefined && value !== '' ? value : defaultValue;
}

/**
 * 获取环境变量数值的工具函数
 * @param envKey - 环境变量键名
 * @param defaultValue - 默认数值
 * @returns 环境变量数值或默认值
 */
function getEnvNumber(envKey: string, defaultValue: number): number {
  const value = process.env[envKey];
  if (value !== undefined && value !== '') {
    const parsed = Number(value);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  return defaultValue;
}

/**
 * 创建类型化MySQL配置对象
 * @description 从环境变量读取配置，支持通过环境变量覆盖默认值
 * @returns IMySQLConfig - 类型化的MySQL配置对象
 *
 * @example
 * ```typescript
 * import { getMySQLConfig } from './mysql';
 * const config = getMySQLConfig();
 * console.log(config.host);
 * ```
 */
export function getMySQLConfig(): IMySQLConfig {
  const config: IMySQLConfig = {
    host: getEnvValue('MYSQL_HOST', defaultMySQLConfig.host),
    port: getEnvNumber('MYSQL_PORT', defaultMySQLConfig.port),
    user: getEnvValue('MYSQL_USER', defaultMySQLConfig.user),
    password: getEnvValue('MYSQL_PASSWORD', defaultMySQLConfig.password),
    database: getEnvValue('MYSQL_DATABASE', defaultMySQLConfig.database),
    charset: getEnvValue('MYSQL_CHARSET', defaultMySQLConfig.charset),
    connectTimeout: getEnvNumber('MYSQL_CONNECT_TIMEOUT', defaultMySQLConfig.connectTimeout),
    pool: {
      min: getEnvNumber('MYSQL_POOL_MIN', defaultMySQLConfig.pool.min),
      max: getEnvNumber('MYSQL_POOL_MAX', defaultMySQLConfig.pool.max),
      acquireTimeout: getEnvNumber('MYSQL_POOL_ACQUIRE_TIMEOUT', defaultMySQLConfig.pool.acquireTimeout),
      idleTimeout: getEnvNumber('MYSQL_POOL_IDLE_TIMEOUT', defaultMySQLConfig.pool.idleTimeout),
    },
    options: {
      multipleStatements: getEnvValue('MYSQL_MULTIPLE_STATEMENTS', 'true') === 'true',
      dateStrings: getEnvValue('MYSQL_DATE_STRINGS', 'false') === 'true',
      timezone: getEnvValue('MYSQL_TIMEZONE', defaultMySQLConfig.options!.timezone || '+00:00'),
    },
  };

  return config;
}

/**
 * 转换为mysql2库可用的PoolOptions
 * @description 将IMySQLConfig转换为mysql2/promise所需的PoolOptions类型
 * @param config - MySQL配置对象
 * @returns PoolOptions - 可直接用于mysql2的连接池选项
 *
 * @example
 * ```typescript
 * import { getMySQLConfig, toPoolOptions } from './mysql';
 * import mysql from 'mysql2/promise';
 *
 * const config = getMySQLConfig();
 * const pool = mysql.createPool(toPoolOptions(config));
 * ```
 */
export function toPoolOptions(config: IMySQLConfig): PoolOptions {
  return {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    charset: config.charset,
    connectTimeout: config.connectTimeout,
    waitForConnections: true,
    queueLimit: 0, // 无限制队列
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000, // 10秒
    ...config.options,
  };
}

/**
 * 验证MySQL配置是否有效
 * @param config - MySQL配置对象
 * @returns 配置是否有效
 *
 * @example
 * ```typescript
 * const config = getMySQLConfig();
 * if (!isMySQLConfigValid(config)) {
 *   console.error('配置无效，请检查环境变量');
 * }
 * ```
 */
export function isMySQLConfigValid(config: IMySQLConfig): boolean {
  if (!config.host || typeof config.host !== 'string') {
    return false;
  }
  if (typeof config.port !== 'number' || config.port <= 0 || config.port > 65535) {
    return false;
  }
  if (!config.user || typeof config.user !== 'string') {
    return false;
  }
  if (!config.database || typeof config.database !== 'string') {
    return false;
  }
  if (config.pool) {
    if (typeof config.pool.min !== 'number' || config.pool.min < 0) {
      return false;
    }
    if (typeof config.pool.max !== 'number' || config.pool.max < config.pool.min) {
      return false;
    }
  }
  return true;
}

/**
 * MySQL配置导出对象
 * @description 提供直接导入使用的配置单例
 */
export const mysqlConfig: Readonly<IMySQLConfig> = getMySQLConfig();

/**
 * MySQL连接池选项导出对象
 * @description 提供直接导入使用的mysql2连接池选项
 */
export const mysqlPoolOptions: Readonly<PoolOptions> = toPoolOptions(mysqlConfig);
