/**
 * Notion数据同步到MySQL - 主入口文件
 * @module notion2mysql
 * @description 同步Notion数据库到MySQL的入口脚本
 */

import dotenv from 'dotenv';
import { SyncEngine, createSyncEngine } from './syncEngine';
import { isNotionConfigValid } from './setting';
import { isMySQLConfigValid } from './mysql';
import { INotionConfig, IMySQLConfig } from './types';

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
  /** 表名 */
  tableName?: string;
  /** 跳过验证 */
  skipValidation?: boolean;
}

/**
 * 打印使用帮助
 */
function printHelp(): void {
  console.log(`
用法: npm run sync [选项]

选项:
  --debug          启用调试模式，输出详细日志
  --table <name>   指定目标表名（默认: notion_sync）
  --help, -h       显示此帮助信息
  --skip-validation  跳过配置验证

示例:
  npm run sync                    # 使用默认配置执行同步
  npm run sync --debug            # 启用调试模式
  npm run sync --table my_data    # 指定目标表名
  npm run sync --skip-validation  # 跳过配置验证
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

      case '--table':
      case '--table-name':
        if (i + 1 < argv.length) {
          args.tableName = argv[i + 1];
          i++; // 跳过下一个参数
        }
        break;

      case '--help':
      case '-h':
        printHelp();
        process.exit(0);

      case '--skip-validation':
      case '--skip-validation':
        args.skipValidation = true;
        break;

      default:
        console.warn(`⚠️  未知参数: ${argv[i]}`);
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

  // 验证Notion配置
  if (!isNotionConfigValid(notionConfig)) {
    console.error('❌ Notion配置验证失败');
    console.error('   请确保以下环境变量已设置:');
    console.error('   - NOTION_INTEGRATION_TOKEN: Notion集成密钥');
    console.error('   - NOTION_DATABASE_ID: 目标数据库ID');
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
 * 主函数
 */
async function main(): Promise<void> {
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
      console.error('💡 提示: 运行 --skip-validation 可跳过配置验证（仅用于测试）');
      process.exit(1);
    }
  } else {
    console.log('⚠️  跳过配置验证（仅用于测试）');
  }

  // 显示配置信息（不显示敏感信息）
  console.log('');
  console.log('📋 配置信息:');
  console.log(`   Notion数据库ID: ${notionConfig.databaseId ? '***已配置***' : '***未配置***'}`);
  console.log(`   Notion API版本: ${notionConfig.apiVersion}`);
  console.log(`   MySQL主机: ${mysqlConfig.host}:${mysqlConfig.port}`);
  console.log(`   MySQL数据库: ${mysqlConfig.database}`);
  console.log(`   目标表名: ${options.tableName || 'notion_sync'}`);
  console.log(`   调试模式: ${options.debug ? '开启' : '关闭'}`);
  console.log('');

  // 创建同步引擎
  const engine = createSyncEngine({
    notionConfig,
    mysqlConfig,
    tableName: options.tableName,
    debugMode: options.debug,
  });

  // 执行同步
  try {
    const result = await engine.sync();

    // 输出结果
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 同步结果');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`   状态: ${result.success ? '✅ 成功' : '❌ 失败'}`);
    console.log(`   总记录数: ${result.totalRecords}`);
    console.log(`   新增/更新记录: ${result.insertedRecords + result.updatedRecords}`);
    console.log(`   耗时: ${result.duration}ms`);
    console.log(`   同步时间: ${result.syncedAt.toISOString()}`);

    if (result.error) {
      console.log(`   错误信息: ${result.error}`);
    }

    console.log('═══════════════════════════════════════════════════════════');

    // 根据结果退出进程
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('');
    console.error('💥 同步过程中发生未处理的异常:');
    console.error(`   ${(error as Error).message}`);

    if (options.debug) {
      console.error('');
      console.error('堆栈信息:');
      console.error((error as Error).stack);
    }

    process.exit(1);
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
