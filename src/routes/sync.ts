/**
 * 同步API路由模块
 * @module sync
 * @description 提供Notion数据同步的REST API接口
 */

import { Router, Request, Response, NextFunction } from 'express';
import { createSyncEngine, SyncEngine } from '../syncEngine';
import { getNotionConfig } from '../setting';
import { getMySQLConfig } from '../mysql';
import { ISyncResult, ISyncDatabase } from '../types';
import { SyncDatabaseService, createSyncDatabaseService } from '../syncDatabaseService';

const router = Router();

/**
 * 同步引擎实例缓存
 */
let syncEngine: SyncEngine | null = null;

/**
 * 数据库配置服务实例缓存
 */
let syncDatabaseService: SyncDatabaseService | null = null;

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
 * 获取同步数据库配置服务实例
 * @returns SyncDatabaseService
 */
function getSyncDatabaseService(): SyncDatabaseService {
  if (!syncDatabaseService) {
    syncDatabaseService = createSyncDatabaseService();
  }
  return syncDatabaseService;
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
      'GET /api/sync/status': '获取最近同步状态',
      // sync_databases CRUD 接口
      'GET /api/sync/databases': '获取同步数据库配置列表',
      'GET /api/sync/databases/:id': '获取同步数据库配置详情',
      'POST /api/sync/databases': '创建同步数据库配置',
      'PUT /api/sync/databases/:id': '更新同步数据库配置',
      'DELETE /api/sync/databases/:id': '删除同步数据库配置',
      // 单数据库同步接口
      'POST /api/sync/databases/:id/sync': '同步单个数据库',
      'POST /api/sync/database/sync': '根据databaseId同步单个数据库',
      // 查询已配置表数据接口
      'GET /api/sync/table/:tableName': '查询已配置表的数据列表',
      'GET /api/sync/table/:tableName/count': '查询已配置表的记录数',
      'GET /api/sync/table/:tableName/:id': '查询已配置表的单条记录',
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

/**
 * ============================================
 * sync_databases CRUD 接口
 * ============================================
 */

/**
 * GET /api/sync/databases
 * 获取同步数据库配置列表
 *
 * 查询参数:
 * - status: 状态筛选 (active/inactive)
 * - page: 页码 (默认1)
 * - pageSize: 每页数量 (默认20)
 */
router.get('/databases', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = getSyncDatabaseService();
    await service.initialize();

    const { status, page, pageSize } = req.query;

    const result = await service.findAll({
      status: status as 'active' | 'inactive' | undefined,
      page: page ? parseInt(page as string, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize as string, 10) : undefined,
    });

    res.json({
      success: true,
      message: '获取成功',
      data: {
        list: result.list,
        total: result.total,
        page: parseInt(page as string, 10) || 1,
        pageSize: parseInt(pageSize as string, 10) || 20,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/sync/databases/:id
 * 获取同步数据库配置详情
 */
router.get('/databases/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = getSyncDatabaseService();
    await service.initialize();

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: '无效的ID',
      });
    }

    const database = await service.findById(id);

    if (!database) {
      return res.status(404).json({
        success: false,
        message: '配置不存在',
      });
    }

    res.json({
      success: true,
      message: '获取成功',
      data: database,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/sync/databases
 * 创建同步数据库配置
 *
 * 请求体:
 * {
 *   notionDatabaseId: string,  // Notion数据库ID (必填)
 *   tableName: string,         // MySQL表名 (必填)
 *   databaseName: string,      // 数据库名称 (必填)
 *   status?: 'active' | 'inactive',  // 状态 (默认active)
 *   syncInterval?: number,     // 同步间隔(秒) (默认300)
 *   remark?: string            // 备注
 * }
 */
router.post('/databases', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = getSyncDatabaseService();
    await service.initialize();

    const { notionDatabaseId, tableName, databaseName, status, syncInterval, remark } = req.body;

    // 参数验证
    if (!notionDatabaseId || !tableName || !databaseName) {
      return res.status(400).json({
        success: false,
        message: '缺少必填参数: notionDatabaseId, tableName, databaseName',
      });
    }

    const database = await service.create({
      notionDatabaseId,
      tableName,
      databaseName,
      status,
      syncInterval,
      remark,
    });

    res.status(201).json({
      success: true,
      message: '创建成功',
      data: database,
    });
  } catch (error) {
    if ((error as Error).message.includes('已存在')) {
      return res.status(409).json({
        success: false,
        message: (error as Error).message,
      });
    }
    next(error);
  }
});

/**
 * PUT /api/sync/databases/:id
 * 更新同步数据库配置
 *
 * 请求体:
 * {
 *   tableName?: string,        // MySQL表名
 *   databaseName?: string,     // 数据库名称
 *   status?: 'active' | 'inactive',  // 状态
 *   syncInterval?: number,     // 同步间隔(秒)
 *   remark?: string            // 备注
 * }
 */
router.put('/databases/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = getSyncDatabaseService();
    await service.initialize();

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: '无效的ID',
      });
    }

    const { tableName, databaseName, status, syncInterval, remark } = req.body;

    const database = await service.update(id, {
      tableName,
      databaseName,
      status,
      syncInterval,
      remark,
    });

    if (!database) {
      return res.status(404).json({
        success: false,
        message: '配置不存在',
      });
    }

    res.json({
      success: true,
      message: '更新成功',
      data: database,
    });
  } catch (error) {
    if ((error as Error).message.includes('已存在')) {
      return res.status(409).json({
        success: false,
        message: (error as Error).message,
      });
    }
    next(error);
  }
});

/**
 * DELETE /api/sync/databases/:id
 * 删除同步数据库配置
 */
router.delete('/databases/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = getSyncDatabaseService();
    await service.initialize();

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: '无效的ID',
      });
    }

    const deleted = await service.delete(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: '配置不存在',
      });
    }

    res.json({
      success: true,
      message: '删除成功',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * ============================================
 * 单数据库同步接口
 * ============================================
 */

/**
 * POST /api/sync/databases/:id/sync
 * 根据配置ID同步单个数据库
 */
router.post('/databases/:id/sync', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = getSyncDatabaseService();
    await service.initialize();

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: '无效的ID',
      });
    }

    // 获取数据库配置
    const database = await service.findById(id);
    if (!database) {
      return res.status(404).json({
        success: false,
        message: '数据库配置不存在',
      });
    }

    if (database.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: '数据库配置已禁用，请先启用后再同步',
      });
    }

    // 创建同步引擎并执行同步
    const engine = createSyncEngine({
      notionConfig: getNotionConfig(),
      mysqlConfig: getMySQLConfig(),
      tableName: database.tableName,
      debugMode: req.body?.debug === true,
    });
    engine.setDatabaseId(database.notionDatabaseId);

    const result = await engine.syncDatabase(database.tableName);

    // 更新最后同步时间
    if (result.success) {
      await service.updateLastSyncAt(id);
    }

    if (result.success) {
      res.json({
        success: true,
        message: '同步成功',
        data: {
          databaseId: database.id,
          notionDatabaseId: database.notionDatabaseId,
          tableName: database.tableName,
          result: {
            totalRecords: result.totalRecords,
            insertedRecords: result.insertedRecords,
            updatedRecords: result.updatedRecords,
            skippedRecords: result.skippedRecords,
            duration: result.duration,
            syncedAt: result.syncedAt.toISOString(),
          },
        },
      });
    } else {
      res.status(500).json({
        success: false,
        message: '同步失败',
        error: result.error,
        data: {
          databaseId: database.id,
          notionDatabaseId: database.notionDatabaseId,
          tableName: database.tableName,
          result: {
            totalRecords: result.totalRecords,
            duration: result.duration,
          },
        },
      });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/sync/database/sync
 * 根据databaseId同步单个数据库
 *
 * 请求体:
 * {
 *   databaseId: string,  // Notion数据库ID (必填)
 *   tableName: string,   // MySQL表名 (必填)
 *   debug?: boolean      // 是否启用调试模式
 * }
 */
router.post('/database/sync', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { databaseId, tableName, debug } = req.body;

    // 参数验证
    if (!databaseId || !tableName) {
      return res.status(400).json({
        success: false,
        message: '缺少必填参数: databaseId, tableName',
      });
    }

    // 创建同步引擎并执行同步
    const engine = createSyncEngine({
      notionConfig: getNotionConfig(),
      mysqlConfig: getMySQLConfig(),
      tableName,
      debugMode: debug === true,
    });
    engine.setDatabaseId(databaseId);

    const result = await engine.syncDatabase(tableName);

    if (result.success) {
      res.json({
        success: true,
        message: '同步成功',
        data: {
          notionDatabaseId: databaseId,
          tableName,
          result: {
            totalRecords: result.totalRecords,
            insertedRecords: result.insertedRecords,
            updatedRecords: result.updatedRecords,
            skippedRecords: result.skippedRecords,
            duration: result.duration,
            syncedAt: result.syncedAt.toISOString(),
          },
        },
      });
    } else {
      res.status(500).json({
        success: false,
        message: '同步失败',
        error: result.error,
        data: {
          notionDatabaseId: databaseId,
          tableName,
          result: {
            totalRecords: result.totalRecords,
            duration: result.duration,
          },
        },
      });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * ============================================
 * 查询已配置表数据接口
 * ============================================
 */

/**
 * GET /api/sync/table/:tableName
 * 查询已配置表的数据列表
 *
 * 路径参数:
 * - tableName: 表名
 *
 * 查询参数:
 * - page: 页码 (默认1)
 * - pageSize: 每页数量 (默认20)
 * - orderBy: 排序字段 (默认 created_time)
 * - orderDir: 排序方向 ASC/DESC (默认 DESC)
 */
router.get('/table/:tableName', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = getSyncDatabaseService();
    await service.initialize();

    const { tableName } = req.params;
    const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
    const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : undefined;
    const orderBy = req.query.orderBy as string | undefined;
    const orderDir = (req.query.orderDir as 'ASC' | 'DESC' | undefined) || 'DESC';

    const result = await service.queryTableData({
      tableName,
      page,
      pageSize,
      orderBy,
      orderDir,
    });

    res.json({
      success: true,
      message: '查询成功',
      data: result,
    });
  } catch (error) {
    if ((error as Error).message.includes('未在 sync_databases 中配置') || (error as Error).message.includes('已禁用')) {
      return res.status(403).json({
        success: false,
        message: (error as Error).message,
      });
    }
    next(error);
  }
});

/**
 * GET /api/sync/table/:tableName/count
 * 查询已配置表的记录数
 */
router.get('/table/:tableName/count', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = getSyncDatabaseService();
    await service.initialize();

    const { tableName } = req.params;

    const count = await service.getTableCount(tableName);

    res.json({
      success: true,
      message: '查询成功',
      data: {
        tableName,
        count,
      },
    });
  } catch (error) {
    if ((error as Error).message.includes('未在 sync_databases 中配置') || (error as Error).message.includes('已禁用')) {
      return res.status(403).json({
        success: false,
        message: (error as Error).message,
      });
    }
    next(error);
  }
});

/**
 * GET /api/sync/table/:tableName/:id
 * 查询已配置表的单条记录
 */
router.get('/table/:tableName/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = getSyncDatabaseService();
    await service.initialize();

    const { tableName, id } = req.params;

    const record = await service.findRecordById(tableName, id);

    if (!record) {
      return res.status(404).json({
        success: false,
        message: '记录不存在',
      });
    }

    res.json({
      success: true,
      message: '查询成功',
      data: record,
    });
  } catch (error) {
    if ((error as Error).message.includes('未在 sync_databases 中配置') || (error as Error).message.includes('已禁用')) {
      return res.status(403).json({
        success: false,
        message: (error as Error).message,
      });
    }
    next(error);
  }
});

export default router;
