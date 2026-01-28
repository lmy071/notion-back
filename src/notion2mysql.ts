/**
 * Notion数据同步到MySQL - 主入口文件
 * @module notion2mysql
 * @description 同步Notion数据库到MySQL的入口脚本，支持多数据库同步
 */

import dotenv from 'dotenv';
import { SyncEngine, createSyncEngine } from './syncEngine';
import { INotionConfig, isNotionConfigValid } from './setting';
import { IMySQLConfig, isMySQLConfigValid } from './mysql';
import { getDatabaseConfigManager, IDataSourceConfig } from './databaseConfig';

/**
 * 加载环境变量配置
 */
dotenv.config();

/**
 * 同步选项接口
 */
interface SyncOptions {
  /** 调试模式 */
  debug?: boolean;
  /** 跳过验证 */
  skipValidation?: boolean;
  /** 同步所有数据库 */
  all?: boolean;
  /** 指定 data source id */
  dataSourceId?: string;
  /** 指定表名 */
  tableName?: string;
}

/**
 * 打印使用帮助
 */
function printHelp(): void {
  console.log(`
用法: npm run sync [选项]

选项:
  --debug          启用调试模式，输出详细日志
  --all            同步所有数据源（从sync_data_sources表读取配置）
  --id <id>        指定同步单个数据源（data_source_id或表名）
  --skip-validation  跳过配置验证（仅用于测试）
  --help, -h       显示此帮助信息

示例:
  npm run sync --all           # 同步所有启用的数据库
  npm run sync --id db1        # 同步指定数据库（数据库ID或表名）
  npm run sync --debug         # 启用调试模式
  npm run sync --skip-validation  # 跳过配置验证（仅用于测试）
  `);
}

/**
 * 解析命令行参数
 * @returns SyncOptions - 同步选项
 */
function parseArgs(): SyncOptions {
  const args: SyncOptions = {};
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i].toLowerCase();

    switch (arg) {
      case '--debug':
        args.debug = true;
        break;

      case '--all':
        args.all = true;
        break;

      case '--id':
      case '--data-source-id':
      case '--table':
        if (i + 1 < argv.length) {
          const value = argv[i + 1];
          if (arg === '--table' || arg === '--id') {
            args.tableName = value;
          } else {
            args.dataSourceId = value;
          }
          i++;
        }
        break;

      case '--help':
      case '-h':
        printHelp();
        process.exit(0);

      case '--skip-validation':
        args.skipValidation = true;
        break;

      default:
        if (!arg.startsWith('--')) {
          args.tableName = arg;
        }
    }
  }

  return args;
}

/**
 * 验证配置
 * @param notionConfig - Notion配置
 * @param mysqlConfig - MySQL配置
 * @returns boolean - 验证是否通过
 */
function validateConfigs(
  notionConfig: INotionConfig,
  mysqlConfig: IMySQLConfig
): boolean {
  let isValid = true;

  // 验证Notion配置（只需要token）
  if (!isNotionConfigValid(notionConfig)) {
    console.error('❌ Notion配置验证失败');
    console.error('   请确保以下环境变量已设置:');
    console.error('   - NOTION_INTEGRATION_TOKEN: Notion集成密钥');
    isValid = false;
  } else {
    console.log('✅ Notion配置验证通过');
  }

  // 验证MySQL配置
  if (!isMySQLConfigValid(mysqlConfig)) {
    console.error('❌ MySQL配置验证失败');
    console.error('   请确保以下环境变量已设置:');
    console.error('   - MYSQL_HOST: 数据库主机地址');
    console.error('   - MYSQL_PORT: 数据库端口');
    console.error('   - MYSQL_USER: 数据库用户名');
    console.error('   - MYSQL_DATABASE: 数据库名称');
    isValid = false;
  } else {
    console.log('✅ MySQL配置验证通过');
  }

  return isValid;
}

/**
 * 从数据库表获取所有启用的数据源配置
 * @param mysqlConfig - MySQL配置
 * @returns Promise<IDataSourceConfig[]> - 数据源配置数组
 */
async function getDataSourcesFromTable(
  mysqlConfig: IMySQLConfig
): Promise<IDataSourceConfig[]> {
  // 动态导入mysql2
  const mysql = await import('mysql2/promise');
  const pool = mysql.createPool({
    host: mysqlConfig.host,
    port: mysqlConfig.port,
    user: mysqlConfig.user,
    password: mysqlConfig.password,
    database: mysqlConfig.database,
  });

  try {
    const [rows] = await pool.query<any[]>(
      'SELECT * FROM sync_data_sources WHERE status = ? ORDER BY id',
      ['active']
    );
    return rows.map((row) => ({
      id: row.id,
      dataSourceId: row.notion_data_source_id,
      tableName: row.table_name,
      databaseName: row.database_name,
      status: row.status,
      syncInterval: row.sync_interval,
      lastSyncAt: row.last_sync_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      remark: row.remark,
    }));
  } catch (error) {
    console.error('❌ 从数据库表获取配置失败:', (error as Error).message);
    return [];
  } finally {
    await pool.end();
  }
}

/**
 * 更新数据库的最后同步时间
 * @param mysqlConfig - MySQL配置
 * @param databaseId - 数据库ID
 */
async function updateLastSyncTime(
  mysqlConfig: IMySQLConfig,
  configId: number
): Promise<void> {
  const mysql = await import('mysql2/promise');
  const pool = mysql.createPool({
    host: mysqlConfig.host,
    port: mysqlConfig.port,
    user: mysqlConfig.user,
    password: mysqlConfig.password,
    database: mysqlConfig.database,
  });

  try {
    await pool.query(
      'UPDATE sync_data_sources SET last_sync_at = ?, updated_at = ? WHERE id = ?',
      [new Date(), new Date(), configId]
    );
  } catch (error) {
    console.warn('⚠️  更新同步时间失败:', (error as Error).message);
  } finally {
    await pool.end();
  }
}

/**
 * 同步单个数据库
 */
async function syncSingleDatabase(
  config: IDataSourceConfig,
  notionConfig: INotionConfig,
  mysqlConfig: IMySQLConfig,
  debugMode: boolean
): Promise<void> {
  console.log('');
  console.log(`🚀 开始同步: ${config.dataSourceId} -> ${config.tableName}`);

  // 创建同步引擎（databaseId通过setDatabaseId方法设置）
  const engine = createSyncEngine({
    notionConfig,
    mysqlConfig,
    tableName: config.tableName,
    debugMode,
  });

  // 设置数据库ID并同步
  engine.setDataSourceId(config.dataSourceId);
  const result = await engine.syncDatabase(config.tableName);

  try {
    const result = await engine.sync();

    if (result.success) {
      console.log(`✅ 同步成功: ${result.totalRecords} 条记录`);
    } else {
      console.error(`❌ 同步失败: ${result.error}`);
    }

    // 更新同步时间
    await updateLastSyncTime(mysqlConfig, config.id);
  } catch (error) {
    console.error(`❌ 同步异常: ${(error as Error).message}`);
  }
}

/**
 * 加载环境变量配置
 * 重新加载以确保在运行时读取正确的配置文件
 */
function loadEnvConfig(): void {
  const path = require('path');
  const env = process.env.NODE_ENV || 'development';
  const envFile = env === 'production' ? '.env.production' : '.env.dev';
  const envPath = path.resolve(process.cwd(), envFile);

  try {
    dotenv.config({ path: envPath });
  } catch (error) {
    // 忽略错误，继续执行
  }
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  // 重新加载环境变量配置
  loadEnvConfig();

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     Notion数据库同步到MySQL - 数据同步工具 v1.0.0          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  // 解析命令行参数
  const options = parseArgs();

  // 导入配置
  const { getNotionConfig } = await import('./setting');
  const { getMySQLConfig } = await import('./mysql');

  const notionConfig = getNotionConfig();
  const mysqlConfig = getMySQLConfig();

  // 验证配置（除非跳过）
  if (!options.skipValidation) {
    if (!validateConfigs(notionConfig, mysqlConfig)) {
      console.log('');
      console.error('💡 提示: 运行 --skip-validation 可跳过配置验证');
      process.exit(1);
    }
  } else {
    console.log('⚠️  跳过配置验证（仅用于测试）');
  }

  // 显示配置信息
  console.log('');
  console.log('📋 配置信息:');
  console.log(`   Notion API版本: ${notionConfig.apiVersion}`);
  console.log(`   MySQL主机: ${mysqlConfig.host}:${mysqlConfig.port}`);
  console.log(`   MySQL数据库: ${mysqlConfig.database}`);
  console.log(`   调试模式: ${options.debug ? '开启' : '关闭'}`);

  // 从数据库表获取所有启用的数据库配置
  console.log('');
  // 2025-09-03 起：配置表为 sync_data_sources
  console.log('📥 从sync_data_sources表读取数据源配置...');
  const databases = await getDataSourcesFromTable(mysqlConfig);

  if (databases.length === 0) {
    console.error('❌ 没有找到启用的数据库配置');
    console.log('💡 请在sync_data_sources表中添加配置:');
    console.log(`
    INSERT INTO sync_data_sources (notion_data_source_id, table_name, database_name, status, remark)
    VALUES ('your-data-source-id', 'your_table_name', 'notion_sync', 'active', '备注');
    `);
    process.exit(1);
  }

  console.log(`✅ 找到 ${databases.length} 个启用的数据库配置`);

  // 同步模式
  if (options.all) {
    // 同步所有数据库
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📦 批量同步所有数据库');
    console.log('═══════════════════════════════════════════════════════════');

    for (const db of databases) {
      await syncSingleDatabase(db, notionConfig, mysqlConfig, options.debug || false);
    }

    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 批量同步完成');
    console.log('═══════════════════════════════════════════════════════════');
  } else if (options.dataSourceId || options.tableName) {
    // 同步指定数据库
    const targetId = options.dataSourceId || options.tableName;
    const targetDb = databases.find(
      (db) => db.dataSourceId === targetId || db.tableName === targetId
    );

    if (!targetDb) {
      console.error(`❌ 未找到数据库配置: ${targetId}`);
      console.log('💡 可用配置:');
      for (const db of databases) {
        console.log(`   - ${db.dataSourceId} (表: ${db.tableName})`);
      }
      process.exit(1);
    }

    await syncSingleDatabase(targetDb, notionConfig, mysqlConfig, options.debug || false);
  } else {
    // 默认同步所有数据库
    console.log('');
    console.log('💡 未指定同步模式，默认同步所有数据库');
    console.log('💡 使用 --all 或 --id <id> 指定同步模式');

    console.log('');
    console.log('📋 待同步数据库列表:');
    for (const db of databases) {
      console.log(`   - ${db.dataSourceId} -> ${db.tableName} ${db.remark ? `(${db.remark})` : ''}`);
    }

    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📦 批量同步所有数据库');
    console.log('═══════════════════════════════════════════════════════════');

    for (const db of databases) {
      await syncSingleDatabase(db, notionConfig, mysqlConfig, options.debug || false);
    }
  }
}

// 导出SyncEngine供程序化使用
export { SyncEngine, createSyncEngine };

// 导出配置验证函数
export { validateConfigs };

// 如果直接运行此文件，则执行main函数
if (require.main === module) {
  main().catch((error) => {
    console.error('💥 程序异常退出:', error);
    process.exit(1);
  });
}
