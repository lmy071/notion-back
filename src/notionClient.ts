/**
 * Notion API客户端封装模块
 * @module notionClient
 * @description 封装Notion API调用，包括数据获取、字段解析等
 */

import { Client } from '@notionhq/client';
import {
  INotionConfig,
  INotionPage,
  INotionResponse,
  NotionPropertyType,
  IRichText,
  NotionProperty,
} from './types';
import { getNotionConfig, isNotionConfigValid } from './setting';

/**
 * ============================================
 * 异常类型定义
 * ============================================
 */

/**
 * Notion API异常
 */
export class NotionAPIError extends Error {
  /** 错误代码 */
  code: string;
  /** 请求ID */
  requestId?: string;
  /** HTTP状态码 */
  statusCode?: number;

  constructor(
    message: string,
    code: string,
    requestId?: string,
    statusCode?: number
  ) {
    super(message);
    this.name = 'NotionAPIError';
    this.code = code;
    this.requestId = requestId;
    this.statusCode = statusCode;
  }
}

/**
 * 配置验证异常
 */
export class NotionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotionConfigError';
  }
}

/**
 * 数据解析异常
 */
export class NotionDataParseError extends Error {
  /** 页面ID */
  pageId: string;
  /** 字段名 */
  propertyName: string;

  constructor(message: string, pageId: string, propertyName: string) {
    super(message);
    this.name = 'NotionDataParseError';
    this.pageId = pageId;
    this.propertyName = propertyName;
  }
}

/**
 * ============================================
 * Notion客户端类
 * ============================================
 */

/**
 * Notion客户端类
 * @description 封装Notion API的所有操作
 */
export class NotionClient {
  /** Notion客户端实例 */
  private client: Client;
  /** 配置对象 */
  private config: INotionConfig;

  /**
   * 创建Notion客户端
   * @param config - Notion配置（可选，默认从环境变量读取）
   * @throws NotionConfigError - 配置无效时抛出
   */
  constructor(config?: INotionConfig) {
    this.config = config || getNotionConfig();

    // 验证配置
    if (!isNotionConfigValid(this.config)) {
      throw new NotionConfigError(
        'Notion配置无效，请检查NOTION_INTEGRATION_TOKEN和NOTION_DATABASE_ID环境变量'
      );
    }

    // 初始化Notion客户端
    this.client = new Client({
      auth: this.config.integrationToken,
      timeoutMs: this.config.timeoutMs,
    });
  }

  /**
   * 获取数据库中的所有记录
   * @returns Promise<INotionPage[]> - Notion页面数组
   * @throws NotionAPIError - API调用失败时抛出
   *
   * @example
   * ```typescript
   * const client = new NotionClient();
   * const pages = await client.getAllPages();
   * console.log(`获取到${pages.length}条记录`);
   * ```
   */
  async getAllPages(): Promise<INotionPage[]> {
    try {
      const allPages: INotionPage[] = [];
      let cursor: string | undefined = undefined;

      do {
        const response: INotionResponse<INotionPage> = await this.client.databases.query({
          database_id: this.config.databaseId,
          start_cursor: cursor,
          page_size: 100, // 每次最多获取100条
        });

        allPages.push(...response.results);

        if (response.has_more && response.next_cursor) {
          cursor = response.next_cursor;
        } else {
          cursor = undefined;
        }
      } while (cursor);

      return allPages;
    } catch (error) {
      if (error instanceof Error) {
        const notionError = error as { code?: string; body?: unknown };
        throw new NotionAPIError(
          `获取Notion数据失败: ${error.message}`,
          notionError.code || 'UNKNOWN_ERROR',
          undefined,
          undefined
        );
      }
      throw new NotionAPIError('获取Notion数据失败: 未知错误', 'UNKNOWN_ERROR');
    }
  }

  /**
   * 获取数据库Schema信息
   * @returns Promise<Record<string, NotionProperty>> - 属性映射
   * @throws NotionAPIError - API调用失败时抛出
   */
  async getDatabaseSchema(): Promise<Record<string, NotionProperty>> {
    try {
      const database = await this.client.databases.retrieve({
        database_id: this.config.databaseId,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (database as any).properties as Record<string, NotionProperty>;
    } catch (error) {
      if (error instanceof Error) {
        throw new NotionAPIError(
          `获取数据库Schema失败: ${error.message}`,
          'SCHEMA_FETCH_ERROR'
        );
      }
      throw new NotionAPIError('获取数据库Schema失败: 未知错误', 'SCHEMA_FETCH_ERROR');
    }
  }

  /**
   * 获取单个页面的详情
   * @param pageId - 页面ID
   * @returns Promise<INotionPage> - 页面详情
   */
  async getPage(pageId: string): Promise<INotionPage> {
    try {
      const page = await this.client.pages.retrieve({ page_id: pageId });
      return page as INotionPage;
    } catch (error) {
      if (error instanceof Error) {
        throw new NotionAPIError(
          `获取页面详情失败: ${error.message}`,
          'PAGE_FETCH_ERROR'
        );
      }
      throw new NotionAPIError('获取页面详情失败: 未知错误', 'PAGE_FETCH_ERROR');
    }
  }

  /**
   * 解析富文本内容
   * @param richTextArray - 富文本数组
   * @returns string - 纯文本内容
   *
   * @example
   * ```typescript
   * const text = this.parseRichText(page.properties['Name'].title.rich_text);
   * ```
   */
  parseRichText(richTextArray: IRichText[]): string {
    if (!richTextArray || richTextArray.length === 0) {
      return '';
    }

    return richTextArray
      .map((rt) => {
        if (rt.type === 'text' && rt.text) {
          return rt.text.content;
        }
        if (rt.type === 'mention' && rt.mention) {
          return rt.plain_text;
        }
        if (rt.type === 'equation' && rt.equation) {
          return rt.equation.expression;
        }
        return rt.plain_text || '';
      })
      .join('');
  }

  /**
   * 解析属性值为字符串
   * @param property - Notion属性
   * @returns string - 解析后的值
   */
  parsePropertyValue(property: NotionProperty): string {
    switch (property.type) {
      case 'title':
        return this.parseRichText(property.title.rich_text);

      case 'rich_text':
        return this.parseRichText(property.rich_text.rich_text);

      case 'number':
        return property.number !== null ? String(property.number) : '';

      case 'select':
        return property.select?.name || '';

      case 'multi_select':
        return JSON.stringify(
          property.multi_select.map((item) => ({
            id: item.id,
            name: item.name,
            color: item.color,
          }))
        );

      case 'status':
        return property.status?.name || '';

      case 'date':
        if (property.date) {
          return property.date.start;
        }
        return '';

      case 'checkbox':
        return String(property.checkbox);

      case 'url':
        return property.url || '';

      case 'email':
        return property.email || '';

      case 'phone_number':
        return property.phone_number || '';

      case 'formula':
        const formula = property.formula;
        if (formula.type === 'string') {
          return formula.string || '';
        } else if (formula.type === 'number') {
          return formula.number !== null ? String(formula.number) : '';
        } else if (formula.type === 'boolean') {
          return String(formula.boolean);
        } else if (formula.type === 'date') {
          return formula.date?.start || '';
        }
        return '';

      case 'people':
        return JSON.stringify(
          property.people.map((person) => ({
            id: person.id,
            name: person.name,
            email: person.person?.email,
          }))
        );

      case 'files':
        return JSON.stringify(
          property.files.map((file) => ({
            name: file.name,
            url: file.external?.url || file.file?.url,
          }))
        );

      case 'relation':
        return JSON.stringify(
          property.relation.map((rel) => ({ id: rel.id }))
        );

      case 'rollup':
        if (property.rollup.type === 'number') {
          return property.rollup.number !== null
            ? String(property.rollup.number)
            : '';
        } else if (property.rollup.type === 'date') {
          return property.rollup.date?.start || '';
        } else if (property.rollup.type === 'array') {
          return JSON.stringify(property.rollup.array);
        }
        return '';

      case 'created_time':
        return property.created_time;

      case 'created_by':
        return property.created_by.id;

      case 'last_edited_time':
        return property.last_edited_time;

      case 'last_edited_by':
        return property.last_edited_by.id;

      case 'unique_id':
        return `${property.unique_id.prefix || ''}${property.unique_id.number}`;

      case 'verification':
        return property.verification?.state || '';

      default:
        // 处理未知类型
        return '';
    }
  }

  /**
   * 清理字段名（转为合法的MySQL标识符）
   * @param name - 原始字段名
   * @returns string - 清理后的字段名
   *
   * @example
   * ```typescript
   * const cleanName = this.sanitizeFieldName('字段 Name');
   * // 返回 'field_name'
   * ```
   */
  sanitizeFieldName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  /**
   * 获取所有属性的字段名列表
   * @param page - Notion页面
   * @returns string[] - 字段名列表
   */
  getFieldNames(page: INotionPage): string[] {
    return Object.keys(page.properties).map((key) =>
      this.sanitizeFieldName(key)
    );
  }
}

/**
 * 创建Notion客户端的工厂函数
 * @param config - Notion配置（可选）
 * @returns NotionClient实例
 */
export function createNotionClient(config?: INotionConfig): NotionClient {
  return new NotionClient(config);
}
