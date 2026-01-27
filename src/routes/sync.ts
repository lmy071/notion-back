/**
 * 同步API路由模块
 * @module sync
 * @description 提供Notion数据同步的REST API接口
 */

import { Router, Request, Response, NextFunction } from 'express';
import { createSyncEngine, SyncEngine } from '../syncEngine';
import { getNotionConfig } from '../setting';
import { getMySQLConfig } from '../mysql';
import { ISyncResult } from '../types';

const router = Router();

/**
 * 同步引擎实例缓存
 */
let syncEngine: SyncEngine | null = null;

/**
 * 获取同步引擎实例
 * @returns SyncEngine
 */
function getSyncEngine(): SyncEngine {
  if (!syncEngine) {
    const notionConfig = getNotionConfig();
    const mysqlConfig = getMySQLConfig();
    syncEngine = createSyncEngine({
      notionConfig,
      mysqlConfig,
      debugMode: process.env.DEBUG_MODE === 'true',
    });
  }
  return syncEngine;
}

/**
 * 刷新同步引擎实例
 * 用于重新加载配置
 */
function refreshSyncEngine(): void {
  syncEngine = null;
}

/**
 * GET /api/sync
 * 获取同步状态
 */
router.get('/', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: '同步服务运行中',
    endpoints: {
      'GET /api/sync': '获取同步状态',
      'POST /api/sync': '触发同步',
      'POST /api/sync/refresh': '刷新配置并同步',
    },
  });
});

/**
 * POST /api/sync
 * 触发Notion数据同步
 * 
 * 请求体（可选）:
 * {
 *   tableName?: string,  // 指定同步到哪个表
 *   debug?: boolean      // 是否启用调试模式
 * }
 * 
 * 响应:
 * {
 *   success: boolean,
 *   message: string,
 *   result: {
 *     totalRecords: number,
 *     insertedRecords: number,
 *     updatedRecords: number,
 *     duration: number,
 *     syncedAt: string
 *   }
 * }
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log('📡 收到同步请求...');

    // 获取请求参数
    const { tableName, debug } = req.body || {};

    // 创建同步引擎
    const engine = createSyncEngine({
      notionConfig: getNotionConfig(),
      mysqlConfig: getMySQLConfig(),
      tableName: tableName || 'notion_sync',
      debugMode: debug === true,
    });

    // 执行同步
    const result = await engine.sync();

    // 返回结果
    if (result.success) {
      res.json({
        success: true,
        message: '同步成功',
        result: {
          totalRecords: result.totalRecords,
          insertedRecords: result.insertedRecords,
          updatedRecords: result.updatedRecords,
          skippedRecords: result.skippedRecords,
          duration: result.duration,
          syncedAt: result.syncedAt.toISOString(),
        },
      });
    } else {
      res.status(500).json({
        success: false,
        message: '同步失败',
        error: result.error,
        result: {
          totalRecords: result.totalRecords,
          duration: result.duration,
        },
      });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/sync/refresh
 * 刷新配置并执行同步
 * 强制重新加载配置
 */
router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log('📡 收到同步请求（刷新模式）...');

    // 刷新同步引擎（重新加载配置）
    refreshSyncEngine();

    const { tableName, debug } = req.body || {};

    const engine = getSyncEngine();
    engine.setDebugMode(debug === true);

    if (tableName) {
      engine.setTableName(tableName);
    }

    const result = await engine.sync();

    if (result.success) {
      res.json({
        success: true,
        message: '同步成功（已刷新配置）',
        result: {
          totalRecords: result.totalRecords,
          insertedRecords: result.insertedRecords,
          updatedRecords: result.updatedRecords,
          duration: result.duration,
          syncedAt: result.syncedAt.toISOString(),
        },
      });
    } else {
      res.status(500).json({
        success: false,
        message: '同步失败',
        error: result.error,
      });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/sync/status
 * 获取最近一次同步状态
 */
router.get('/status', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: '同步服务就绪',
    config: {
      // 数据库ID从sync_databases表动态获取，此处仅显示配置状态
      notionIntegrationToken: getNotionConfig().integrationToken ? '***已配置***' : '***未配置***',
      mysqlHost: getMySQLConfig().host,
      mysqlDatabase: getMySQLConfig().database,
    },
  });
});

export default router;
