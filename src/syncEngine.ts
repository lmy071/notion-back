/**
 * 同步引擎模块
 * @module syncEngine
 * @description 核心同步逻辑，协调Notion数据获取和MySQL存储
 */

import { NotionClient, NotionAPIError } from './notionClient';
import { MySQLClient, MySQLConnectionError, MySQLSchemaError } from './mysqlClient';
import {
  INotionConfig,
  IMySQLConfig,
  INotionPage,
  ISyncResult,
  ISchemaAnalysis,
  IFieldAnalysis,
  NotionPropertyType,
  MySQLFieldType,
} from './types';
import { getNotionConfig } from './setting';
import { getMySQLConfig } from './mysql';

/**
 * ============================================
 * 同步引擎类
 * ============================================
 */

/**
 * 同步引擎类
 * @description 协调Notion数据同步到MySQL的完整流程
 */
export class SyncEngine {
  /** Notion客户端 */
  private notionClient: NotionClient;
  /** MySQL客户端 */
  private mysqlClient: MySQLClient;
  /** 表名 */
  private tableName: string;
  /** 调试模式 */
  private debugMode: boolean;

  /**
   * 创建同步引擎
   * @param notionConfig - Notion配置（可选）
   * @param mysqlConfig - MySQL配置（可选）
   * @param options - 同步选项
   */
  constructor(
    notionConfig?: INotionConfig,
    mysqlConfig?: IMySQLConfig,
    options?: { tableName?: string; debugMode?: boolean }
  ) {
    this.notionClient = new NotionClient(notionConfig);
    this.mysqlClient = new MySQLClient(mysqlConfig);
    this.tableName = options?.tableName || 'notion_sync';
    this.debugMode = options?.debugMode || false;
  }

  /**
   * 打印调试信息
   * @param message - 消息
   * @param data - 数据（可选）
   */
  private log(message: string, data?: unknown): void {
    if (this.debugMode) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] ${message}`, data ? JSON.stringify(data, null, 2) : '');
    }
  }

  /**
   * 执行完整同步
   * @returns Promise<ISyncResult> - 同步结果
   */
  async sync(): Promise<ISyncResult> {
    const startTime = Date.now();
    const result: ISyncResult = {
      success: false,
      totalRecords: 0,
      insertedRecords: 0,
      updatedRecords: 0,
      skippedRecords: 0,
      duration: 0,
      syncedAt: new Date(),
    };

    try {
      console.log('🚀 开始同步Notion数据到MySQL...');
      console.log(`📋 目标表: ${this.tableName}`);

      // 1. 初始化MySQL连接
      console.log('🔌 正在连接MySQL数据库...');
      await this.mysqlClient.initialize();
      console.log('✅ MySQL连接成功');

      // 2. 获取Notion数据
      console.log('📥 正在从Notion获取数据...');
      const pages = await this.notionClient.getAllPages();
      result.totalRecords = pages.length;
      console.log(`✅ 获取到 ${pages.length} 条记录`);

      if (pages.length === 0) {
        console.log('⚠️  Notion数据库中没有数据');
        result.success = true;
        result.duration = Date.now() - startTime;
        return result;
      }

      // 3. 分析Notion数据库结构
      console.log('🔍 正在分析Notion数据库结构...');
      const schema = await this.analyzeNotionSchema(pages);
      console.log(`✅ 分析完成，发现 ${schema.fields.length} 个字段`);

      // 4. 确保表存在并更新结构
      console.log('📊 正在同步MySQL表结构...');
      await this.ensureTableExists(schema);
      console.log('✅ MySQL表结构同步完成');

      // 5. 转换数据
      console.log('🔄 正在转换数据格式...');
      const records = this.convertToRecords(pages, schema);
      console.log(`✅ 转换完成，${records.length} 条记录待同步`);

      // 6. 批量写入MySQL
      console.log('💾 正在写入MySQL数据库...');
      await this.mysqlClient.batchUpsert(this.tableName, records, 'id');
      console.log('✅ 数据写入完成');

      // 7. 生成结果
      result.success = true;
      result.insertedRecords = records.length;
      result.updatedRecords = 0; // upsert不区分新增和更新
      result.skippedRecords = 0;
      result.duration = Date.now() - startTime;

      console.log('🎉 同步完成！');
      console.log(`   总记录数: ${result.totalRecords}`);
      console.log(`   新增记录: ${result.insertedRecords}`);
      console.log(`   耗时: ${result.duration}ms`);

      return result;
    } catch (error) {
      result.success = false;
      result.error = this.getErrorMessage(error);
      result.duration = Date.now() - startTime;

      console.error('❌ 同步失败！');
      console.error(`   错误信息: ${result.error}`);

      if (this.debugMode && error instanceof Error) {
        console.error('   堆栈信息:', error.stack);
      }

      return result;
    } finally {
      // 关闭连接
      await this.mysqlClient.close();
    }
  }

  /**
   * 分析Notion数据库结构
   * @param pages - Notion页面数组
   * @returns ISchemaAnalysis - Schema分析结果
   */
  private async analyzeNotionSchema(pages: INotionPage[]): Promise<ISchemaAnalysis> {
    // 收集所有字段名和类型
    const fieldTypes: Record<string, NotionPropertyType> = {};
    const fieldNames: string[] = [];

    // 从第一个页面获取字段结构
    if (pages.length > 0) {
      const firstPage = pages[0];
      for (const [originalName, property] of Object.entries(firstPage.properties)) {
        const fieldName = this.notionClient.sanitizeFieldName(originalName);

        // 避免重复字段名
        let uniqueFieldName = fieldName;
        let counter = 1;
        while (fieldNames.includes(uniqueFieldName)) {
          uniqueFieldName = `${fieldName}_${counter}`;
          counter++;
        }

        fieldNames.push(uniqueFieldName);
        fieldTypes[uniqueFieldName] = property.type;
      }
    }

    // 分析现有表结构
    const tableExists = await this.mysqlClient.tableExists(this.tableName);
    let existingColumns: IFieldAnalysis[] = [];

    if (tableExists) {
      const existingFields = await this.mysqlClient.getTableColumns(this.tableName);
      existingColumns = existingFields;
    }

    // 构建Schema
    const schema = this.mysqlClient.analyzeSchema(
      fieldNames,
      fieldTypes,
      this.tableName
    );
    schema.tableExists = tableExists;

    // 如果表已存在，合并现有字段信息
    if (tableExists && existingColumns.length > 0) {
      const existingFieldMap = new Map(
        existingColumns.map((f) => [f.name, f])
      );

      for (const field of schema.fields) {
        const existingField = existingFieldMap.get(field.name);
        if (existingField) {
          // 保留现有的字段类型信息
          field.type = existingField.type;
          field.length = existingField.length;
          field.decimals = existingField.decimals;
          field.isNullable = existingField.isNullable;
          field.defaultValue = existingField.defaultValue;
          field.comment = existingField.comment;
        }
      }
    }

    return schema;
  }

  /**
   * 确保表存在并更新结构
   * @param schema - Schema分析结果
   */
  private async ensureTableExists(schema: ISchemaAnalysis): Promise<void> {
    if (!schema.tableExists) {
      // 创建新表
      await this.mysqlClient.createTable(schema);
      console.log(`   创建新表: ${schema.tableName}`);
    } else {
      // 检查是否需要添加新字段
      const existingColumns = await this.mysqlClient.getTableColumns(
        this.tableName
      );
      const existingFieldNames = new Set(existingColumns.map((c) => c.name));

      const newFields = schema.fields.filter(
        (f) => !existingFieldNames.has(f.name)
      );

      if (newFields.length > 0) {
        await this.mysqlClient.updateTableSchema(this.tableName, newFields);
        console.log(`   添加 ${newFields.length} 个新字段`);
      } else {
        console.log('   表结构已是最新');
      }
    }
  }

  /**
   * 转换Notion页面为MySQL记录
   * @param pages - Notion页面数组
   * @param schema - Schema信息
   * @returns Record<string, unknown>[] - MySQL记录数组
   */
  private convertToRecords(
    pages: INotionPage[],
    schema: ISchemaAnalysis
  ): Record<string, unknown>[] {
    const fieldNameSet = new Set(schema.fields.map((f) => f.name));

    return pages.map((page) => {
      const record: Record<string, unknown> = {
        id: page.id,
        created_time: page.created_time || null,
        last_edited_time: page.last_edited_time || null,
      };

      // 解析每个属性
      for (const [originalName, property] of Object.entries(page.properties)) {
        const fieldName = this.notionClient.sanitizeFieldName(originalName);

        // 只处理Schema中存在的字段
        if (!fieldNameSet.has(fieldName)) {
          continue;
        }

        try {
          const value = this.notionClient.parsePropertyValue(property);

          // 根据字段类型进行额外的转换
          const fieldSchema = schema.fields.find((f) => f.name === fieldName);
          if (fieldSchema) {
            record[fieldName] = this.convertValue(value, fieldSchema.mysqlType);
          } else {
            record[fieldName] = value;
          }
        } catch (error) {
          console.warn(
            `⚠️  解析字段 "${originalName}" (${fieldName}) 失败: ${
              (error as Error).message
            }`
          );
          record[fieldName] = null;
        }
      }

      return record;
    });
  }

  /**
   * 根据MySQL类型转换值
   * @param value - 原始值
   * @param mysqlType - MySQL字段类型
   * @returns 转换后的值
   */
  private convertValue(
    value: string,
    mysqlType: MySQLFieldType
  ): string | number | boolean | null {
    if (value === '' || value === null || value === undefined) {
      return null;
    }

    switch (mysqlType) {
      case MySQLFieldType.BOOLEAN:
        return value === 'true' || value === '1' || value === 'TRUE';

      case MySQLFieldType.INT:
      case MySQLFieldType.BIGINT:
        const intVal = parseInt(value, 10);
        return isNaN(intVal) ? null : intVal;

      case MySQLFieldType.FLOAT:
      case MySQLFieldType.DOUBLE:
      case MySQLFieldType.DECIMAL:
        const floatVal = parseFloat(value);
        return isNaN(floatVal) ? null : floatVal;

      case MySQLFieldType.DATETIME:
      case MySQLFieldType.DATE:
      case MySQLFieldType.TIMESTAMP:
        // 验证日期格式
        if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
          return value;
        }
        return null;

      case MySQLFieldType.JSON:
        try {
          // 尝试解析JSON
          if (value.startsWith('[') || value.startsWith('{')) {
            return value; // 已经是JSON字符串
          }
          return JSON.stringify(value);
        } catch {
          return JSON.stringify({ value });
        }

      case MySQLFieldType.TEXT:
      case MySQLFieldType.LONGTEXT:
      case MySQLFieldType.VARCHAR:
      default:
        return value;
    }
  }

  /**
   * 获取友好的错误信息
   * @param error - 错误对象
   * @returns string - 错误信息
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof NotionAPIError) {
      return `Notion API错误 [${error.code}]: ${error.message}`;
    }
    if (error instanceof MySQLConnectionError) {
      return `MySQL连接错误: ${error.message}`;
    }
    if (error instanceof MySQLSchemaError) {
      return `MySQL Schema错误: ${error.message}`;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return '未知错误';
  }

  /**
   * 设置调试模式
   * @param enabled - 是否启用
   */
  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
  }

  /**
   * 设置表名
   * @param tableName - 表名
   */
  setTableName(tableName: string): void {
    this.tableName = tableName;
  }
}

/**
 * 创建同步引擎的工厂函数
 * @param options - 同步选项
 * @returns SyncEngine实例
 */
export function createSyncEngine(
  options?: {
    notionConfig?: INotionConfig;
    mysqlConfig?: IMySQLConfig;
    tableName?: string;
    debugMode?: boolean;
  }
): SyncEngine {
  return new SyncEngine(
    options?.notionConfig,
    options?.mysqlConfig,
    {
      tableName: options?.tableName,
      debugMode: options?.debugMode,
    }
  );
}
