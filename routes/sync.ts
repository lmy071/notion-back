/**
 * 同步API路由模块
 * @module routes/sync
 * @description 提供Notion数据同步的API接口
 */

import express, { Request, Response, NextFunction } from 'express';
import { createSyncEngine, SyncEngine } from '../syncEngine';
import { getNotionConfig } from '../setting';
import { getMySQLConfig } from '../mysql';
import { ISyncResult, INotionConfig, IMySQLConfig } from '../types';

export const router = express.Router();

/**
 * 同步请求参数接口
 */
interface ISyncRequestParams {
  /** 目标表名 */
  tableName?: string;
  /** 调试模式 */
  debug?: boolean;
  /** 跳过验证 */
  skipValidation?: boolean;
}

/**
 * 同步历史记录接口
 */
interface ISyncHistory {
  id: number;
  tableName: string;
  status: 'success' | 'failed';
  totalRecords: number;
  duration: number;
  error?: string;
  syncedAt: Date;
}

// 内存中的同步历史记录（生产环境建议使用数据库存储）
const syncHistory: ISyncHistory[] = [];
let historyId = 0;

/**
 * 验证Notion配置
 * @param config - Notion配置
 * @returns 是否有效
 */
function validateNotionConfig(config: INotionConfig): boolean {
  return !!(
    config.integrationToken &&
    config.databaseId &&
    config.integrationToken !== '' &&
    config.databaseId !== ''
  );
}

/**
 * 验证MySQL配置
 * @param config - MySQL配置
 * @returns 是否有效
 */
function validateMySQLConfig(config: IMySQLConfig): boolean {
  return !!(
    config.host &&
    config.user &&
    config.database &&
    config.host !== '' &&
    config.user !== '' &&
    config.database !== ''
  );
}

/**
 * POST /api/sync
 * 触发同步接口
 * @description 手动触发Notion数据同步到MySQL
 *
 * 请求体参数:
 * - tableName: 目标表名（可选，默认: notion_sync）
 * - debug: 是否启用调试模式（可选，默认: false）
 * - skipValidation: 是否跳过配置验证（可选，默认: false）
 *
 * @example
 * ```bash
 * # 基础调用
 * curl -X POST http://localhost:3000/api/sync
 *
 * # 带参数调用
 * curl -X POST http://localhost:3000/api/sync \
 *   -H "Content-Type: application/json" \
 *   -d '{"tableName": "my_notion_data", "debug": true}'
 * ```
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();

  console.log('═══════════════════════════════════════════════════════════');
  console.log('📡 API: 收到同步请求');
  console.log('═══════════════════════════════════════════════════════════');

  try {
    // 解析请求参数
    const params: ISyncRequestParams = {
      tableName: req.body?.tableName || 'notion_sync',
      debug: req.body?.debug === true,
      skipValidation: req.body?.skipValidation === true,
    };

    console.log(`📋 请求参数:`, params);

    // 验证配置
    const notionConfig = getNotionConfig();
    const mysqlConfig = getMySQLConfig();

    if (!params.skipValidation) {
      if (!validateNotionConfig(notionConfig)) {
        console.error('❌ Notion配置无效');
        return res.status(400).json({
          success: false,
          error: 'Notion配置无效',
          message: '请检查 NOTION_INTEGRATION_TOKEN 和 NOTION_DATABASE_ID 环境变量',
          code: 'INVALID_NOTION_CONFIG',
        });
      }

      if (!validateMySQLConfig(mysqlConfig)) {
        console.error('❌ MySQL配置无效');
        return res.status(400).json({
          success: false,
          error: 'MySQL配置无效',
          message: '请检查 MYSQL_HOST、MYSQL_USER、MYSQL_DATABASE 环境变量',
          code: 'INVALID_MYSQL_CONFIG',
        });
      }
    }

    // 创建同步引擎并执行同步
    const engine = createSyncEngine({
      notionConfig,
      mysqlConfig,
      tableName: params.tableName,
      debugMode: params.debug,
    });

    const result = await engine.sync();

    // 记录同步历史
    const historyRecord: ISyncHistory = {
      id: ++historyId,
      tableName: params.tableName || 'notion_sync',
      status: result.success ? 'success' : 'failed',
      totalRecords: result.totalRecords,
      duration: result.duration,
      error: result.error,
      syncedAt: result.syncedAt,
    };
    syncHistory.push(historyRecord);

    // 保留最近100条记录
    if (syncHistory.length > 100) {
      syncHistory.shift();
    }

    // 返回结果
    const responseData = {
      success: result.success,
      message: result.success ? '同步成功' : '同步失败',
      data: {
        totalRecords: result.totalRecords,
        insertedRecords: result.insertedRecords,
        updatedRecords: result.updatedRecords,
        skippedRecords: result.skippedRecords,
        duration: result.duration,
        syncedAt: result.syncedAt.toISOString(),
        tableName: params.tableName,
      },
      error: result.error,
    };

    console.log('✅ 同步请求完成');
    console.log(`   总记录数: ${result.totalRecords}`);
    console.log(`   耗时: ${result.duration}ms`);

    return res.status(result.success ? 200 : 500).json(responseData);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    console.error('❌ 同步请求异常:', errorMessage);

    // 记录失败历史
    syncHistory.push({
      id: ++historyId,
      tableName: 'notion_sync',
      status: 'failed',
      totalRecords: 0,
      duration: Date.now() - startTime,
      error: errorMessage,
      syncedAt: new Date(),
    });

    return res.status(500).json({
      success: false,
      error: '同步异常',
      message: errorMessage,
      code: 'SYNC_ERROR',
    });
  }
});

/**
 * GET /api/sync/status
 * 获取同步状态接口
 * @description 获取最近一次同步的结果
 *
 * @example
 * ```bash
 * curl http://localhost:3000/api/sync/status
 * ```
 */
router.get('/status', (req: Request, res: Response) => {
  const lastSync = syncHistory[syncHistory.length - 1];

  res.json({
    success: true,
    data: {
      lastSync: lastSync || null,
      totalSyncCount: syncHistory.length,
      recentHistory: syncHistory.slice(-10).map((record) => ({
        id: record.id,
        tableName: record.tableName,
        status: record.status,
        totalRecords: record.totalRecords,
        duration: record.duration,
        syncedAt: record.syncedAt,
      })),
    },
  });
});

/**
 * GET /api/sync/history
 * 获取同步历史接口
 * @description 获取完整的同步历史记录
 *
 * @query limit - 返回记录数量限制（默认: 50）
 *
 * @example
 * ```bash
 * # 获取最近10条记录
 * curl "http://localhost:3000/api/sync/history?limit=10"
 * ```
 */
router.get('/history', (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const history = syncHistory.slice(-limit).reverse();

  res.json({
    success: true,
    data: {
      records: history,
      total: syncHistory.length,
    },
  });
});

/**
 * GET /api/sync/config
 * 获取配置状态接口
 * @description 检查当前配置是否有效
 *
 * @example
 * ```bash
 * curl http://localhost:3000/api/sync/config
 * ```
 */
router.get('/config', (req: Request, res: Response) => {
  const notionConfig = getNotionConfig();
  const mysqlConfig = getMySQLConfig();

  res.json({
    success: true,
    data: {
      notion: {
        configured: validateNotionConfig(notionConfig),
        databaseId: notionConfig.databaseId ? '***已配置***' : '***未配置***',
        apiVersion: notionConfig.apiVersion,
        timeoutMs: notionConfig.timeoutMs,
      },
      mysql: {
        configured: validateMySQLConfig(mysqlConfig),
        host: mysqlConfig.host,
        port: mysqlConfig.port,
        database: mysqlConfig.database,
        charset: mysqlConfig.charset,
      },
    },
  });
});

/**
 * POST /api/sync/test
 * 测试连接接口
 * @description 测试Notion和MySQL连接是否正常
 *
 * @example
 * ```bash
 * curl -X POST http://localhost:3000/api/sync/test
 * ```
 */
router.post('/test', async (req: Request, res: Response) => {
  console.log('📡 API: 测试连接请求');

  const results = {
    notion: { connected: false, error: null as string | null },
    mysql: { connected: false, error: null as string | null },
  };

  // 测试Notion连接
  try {
    const { NotionClient } = await import('../notionClient');
    const notionConfig = getNotionConfig();

    if (!validateNotionConfig(notionConfig)) {
      results.notion.error = 'Notion配置无效';
    } else {
      const client = new NotionClient(notionConfig);
      await client.getAllPages();
      results.notion.connected = true;
    }
  } catch (error) {
    results.notion.error = error instanceof Error ? error.message : '未知错误';
  }

  // 测试MySQL连接
  try {
    const { MySQLClient } = await import('../mysqlClient');
    const mysqlConfig = getMySQLConfig();

    if (!validateMySQLConfig(mysqlConfig)) {
      results.mysql.error = 'MySQL配置无效';
    } else {
      const client = new MySQLClient(mysqlConfig);
      await client.initialize();
      await client.close();
      results.mysql.connected = true;
    }
  } catch (error) {
    results.mysql.error = error instanceof Error ? error.message : '未知错误';
  }

  const allConnected = results.notion.connected && results.mysql.connected;

  return res.status(allConnected ? 200 : 400).json({
    success: allConnected,
    message: allConnected ? '所有连接正常' : '部分连接失败',
    data: results,
  });
});
