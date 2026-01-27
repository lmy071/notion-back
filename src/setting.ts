/**
 * Notion配置模块
 * @module setting
 * @description 管理Notion相关的所有配置，包括API密钥、数据库ID、请求超时等
 */

import dotenv from 'dotenv';

/**
 * 加载环境变量配置
 */
dotenv.config();

/**
 * Notion API版本配置
 * 用于指定Notion API的版本号
 */
export const NOTION_API_VERSION: string = '2022-06-28';

/**
 * Notion集成配置接口
 * @description 定义Notion集成的所有配置项，包含类型约束和默认值
 */
export interface INotionConfig {
  /** Notion集成密钥（Internal Integration Token） */
  integrationToken: string;
  /** 目标数据库ID */
  databaseId: string;
  /** Notion API版本 */
  apiVersion: string;
  /** 请求超时时间（毫秒） */
  timeoutMs: number;
}

/**
 * 默认Notion配置
 * @description 用于环境变量未设置时的默认值
 */
const defaultNotionConfig: Readonly<INotionConfig> = {
  integrationToken: '',
  databaseId: '',
  apiVersion: NOTION_API_VERSION,
  timeoutMs: 30000, // 30秒
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
 * 创建类型化Notion配置对象
 * @description 从环境变量读取配置，支持通过环境变量覆盖默认值
 * @returns INotionConfig - 类型化的Notion配置对象
 *
 * @example
 * ```typescript
 * import { getNotionConfig } from './setting';
 * const config = getNotionConfig();
 * console.log(config.databaseId);
 * ```
 */
export function getNotionConfig(): INotionConfig {
  const config: INotionConfig = {
    integrationToken: getEnvValue('NOTION_INTEGRATION_TOKEN', defaultNotionConfig.integrationToken),
    databaseId: getEnvValue('NOTION_DATABASE_ID', defaultNotionConfig.databaseId),
    apiVersion: getEnvValue('NOTION_API_VERSION', defaultNotionConfig.apiVersion),
    timeoutMs: getEnvNumber('NOTION_TIMEOUT_MS', defaultNotionConfig.timeoutMs),
  };

  return config;
}

/**
 * 验证Notion配置是否有效
 * @param config - Notion配置对象
 * @returns 配置是否有效
 *
 * @example
 * ```typescript
 * const config = getNotionConfig();
 * if (!isNotionConfigValid(config)) {
 *   console.error('配置无效，请检查环境变量');
 * }
 * ```
 */
export function isNotionConfigValid(config: INotionConfig): boolean {
  if (!config.integrationToken || typeof config.integrationToken !== 'string') {
    return false;
  }
  if (!config.databaseId || typeof config.databaseId !== 'string') {
    return false;
  }
  if (!config.apiVersion || typeof config.apiVersion !== 'string') {
    return false;
  }
  if (typeof config.timeoutMs !== 'number' || config.timeoutMs <= 0) {
    return false;
  }
  return true;
}

/**
 * Notion配置导出对象
 * @description 提供直接导入使用的配置单例
 *
 * @example
 * ```typescript
 * import { notionConfig } from './setting';
 * if (!notionConfig.integrationToken) {
 *   throw new Error('请设置NOTION_INTEGRATION_TOKEN环境变量');
 * }
 * ```
 */
export const notionConfig: Readonly<INotionConfig> = getNotionConfig();
