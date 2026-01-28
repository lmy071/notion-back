/**
 * Notion数据类型定义模块
 * @module types
 * @description 定义Notion API返回数据和配置的完整类型接口
 */

/**
 * ============================================
 * 配置类型定义
 * ============================================
 */

/**
 * Notion集成配置接口
 */
export interface INotionConfig {
  /** Notion集成密钥（Internal Integration Token） */
  integrationToken: string;
  /** Notion API版本 */
  apiVersion: string;
  /** 请求超时时间（毫秒） */
  timeoutMs: number;
}

/**
 * MySQL连接池配置接口
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
 * ============================================
 * Notion API 基础类型定义
 * ============================================
 */

/**
 * Notion页面基础接口
 */
export interface INotionPage {
  id: string;
  object: 'page';
  created_time: string;
  last_edited_time: string;
  created_by: {
    object: 'user';
    id: string;
  };
  last_edited_by: {
    object: 'user';
    id: string;
  };
  cover: INotionCover | null;
  icon: INotionIcon | null;
  parent: INotionParent;
  archived: boolean;
  properties: Record<string, NotionProperty>;
  url: string;
}

/**
 * Notion封面
 */
export interface INotionCover {
  type: 'external' | 'file';
  external?: {
    url: string;
  };
  file?: {
    url: string;
    expiry_time: string;
  };
}

/**
 * Notion图标
 */
export interface INotionIcon {
  type: 'emoji' | 'external' | 'file' | 'custom_emoji';
  emoji?: string;
  external?: {
    url: string;
  };
  file?: {
    url: string;
    expiry_time: string;
  };
  custom_emoji?: {
    id: string;
  };
}

/**
 * Notion父对象
 */
export interface INotionParent {
  type: 'database_id' | 'page_id' | 'workspace' | 'block_id';
  database_id?: string;
  page_id?: string;
  workspace?: boolean;
  block_id?: string;
}

/**
 * ============================================
 * Notion 属性类型定义
 * ============================================
 */

/**
 * Notion属性基接口
 */
export interface INotionProperty {
  id: string;
  type: NotionPropertyType;
  name: string;
}

/**
 * Notion属性类型枚举
 */
export type NotionPropertyType =
  | 'title'
  | 'rich_text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'status'
  | 'date'
  | 'people'
  | 'files'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'phone_number'
  | 'formula'
  | 'relation'
  | 'rollup'
  | 'created_time'
  | 'created_by'
  | 'last_edited_time'
  | 'last_edited_by'
  | 'unique_id'
  | 'verification';

/**
 * 标题属性
 */
export interface INotionTitleProperty extends INotionProperty {
  type: 'title';
  title: Array<{
    type: 'text';
    text: {
      content: string;
      link: { url: string } | null;
    };
    annotations: {
      bold: boolean;
      italic: boolean;
      strikethrough: boolean;
      underline: boolean;
      code: boolean;
      color: NotionTextColor;
    };
    plain_text: string;
    href: string | null;
  }>;
}

/**
 * 富文本属性
 */
export interface INotionRichTextProperty extends INotionProperty {
  type: 'rich_text';
  rich_text: IRichText[];
}

/**
 * 富文本内容
 */
export interface IRichText {
  type: 'text' | 'mention' | 'equation';
  text?: {
    content: string;
    link: { url: string } | null;
  };
  mention?: {
    type: 'page' | 'database' | 'user' | 'date' | 'link_preview';
    page?: { id: string };
    database?: { id: string };
    user?: { id: string };
    date?: { start: string; end: string | null };
    link_preview?: { url: string };
  };
  equation?: {
    expression: string;
  };
  annotations: {
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    underline: boolean;
    code: boolean;
    color: NotionTextColor;
  };
  plain_text: string;
  href: string | null;
}

/**
 * 文本颜色
 */
export type NotionTextColor =
  | 'default'
  | 'gray'
  | 'brown'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'red'
  | 'gray_background'
  | 'brown_background'
  | 'orange_background'
  | 'yellow_background'
  | 'green_background'
  | 'blue_background'
  | 'purple_background'
  | 'pink_background'
  | 'red_background';

/**
 * 数字属性
 */
export interface INotionNumberProperty extends INotionProperty {
  type: 'number';
  number: number | null;
  format: NotionNumberFormat;
}

/**
 * 数字格式类型
 */
export type NotionNumberFormat =
  | 'number'
  | 'number_format'
  | 'percent'
  | 'percent_format'
  | 'currency'
  | 'currency_format'
  | 'date'
  | 'date_time';

/**
 * 单选属性
 */
export interface INotionSelectProperty extends INotionProperty {
  type: 'select';
  select: {
    id: string;
    name: string;
    color: NotionSelectColor;
  } | null;
}

/**
 * 单选颜色
 */
export type NotionSelectColor =
  | 'default'
  | 'gray'
  | 'brown'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'red';

/**
 * 多选属性
 */
export interface INotionMultiSelectProperty extends INotionProperty {
  type: 'multi_select';
  multi_select: Array<{
    id: string;
    name: string;
    color: NotionSelectColor;
  }>;
}

/**
 * 状态属性
 */
export interface INotionStatusProperty extends INotionProperty {
  type: 'status';
  status: {
    id: string;
    name: string;
    color: NotionSelectColor;
  } | null;
}

/**
 * 日期属性
 */
export interface INotionDateProperty extends INotionProperty {
  type: 'date';
  date: {
    start: string;
    end: string | null;
    time_zone: string | null;
  } | null;
}

/**
 * 人员属性
 */
export interface INotionPeopleProperty extends INotionProperty {
  type: 'people';
  people: Array<{
    object: 'user';
    id: string;
    type: 'person' | 'bot';
    name: string | null;
    avatar_url: string | null;
    person?: { email: string };
  }>;
}

/**
 * 文件属性
 */
export interface INotionFilesProperty extends INotionProperty {
  type: 'files';
  files: Array<{
    type: 'external' | 'file';
    name: string;
    external?: { url: string };
    file?: { url: string; expiry_time: string };
  }>;
}

/**
 * 复选框属性
 */
export interface INotionCheckboxProperty extends INotionProperty {
  type: 'checkbox';
  checkbox: boolean;
}

/**
 * URL属性
 */
export interface INotionUrlProperty extends INotionProperty {
  type: 'url';
  url: string | null;
}

/**
 * 邮箱属性
 */
export interface INotionEmailProperty extends INotionProperty {
  type: 'email';
  email: string | null;
}

/**
 * 电话号码属性
 */
export interface INotionPhoneNumberProperty extends INotionProperty {
  type: 'phone_number';
  phone_number: string | null;
}

/**
 * 公式属性
 */
export interface INotionFormulaProperty extends INotionProperty {
  type: 'formula';
  formula: {
    type: 'string' | 'number' | 'boolean' | 'date';
    string?: string;
    number?: number;
    boolean?: boolean;
    date?: { start: string; end: string | null };
  };
}

/**
 * 关联属性
 */
export interface INotionRelationProperty extends INotionProperty {
  type: 'relation';
  relation: Array<{ id: string; opened: boolean }>;
  has_more: boolean;
}

/**
 * 汇总属性
 */
export interface INotionRollupProperty extends INotionProperty {
  type: 'rollup';
  rollup: {
    type: 'number' | 'date' | 'array';
    number?: number;
    date?: { start: string; end: string | null };
    array?: Array<Record<string, unknown>>;
    function: NotionRollupFunction;
  };
}

/**
 * 汇总函数类型
 */
export type NotionRollupFunction =
  | 'count_all'
  | 'count_values'
  | 'count_unique_values'
  | 'count_number_value'
  | 'count_empty'
  | 'count_not_empty'
  | 'percent_empty'
  | 'percent_not_empty'
  | 'sum'
  | 'average'
  | 'median'
  | 'min'
  | 'max'
  | 'range'
  | 'show_original'
  | 'show_unique';

/**
 * 创建时间属性
 */
export interface INotionCreatedTimeProperty extends INotionProperty {
  type: 'created_time';
  created_time: string;
}

/**
 * 创建者属性
 */
export interface INotionCreatedByProperty extends INotionProperty {
  type: 'created_by';
  created_by: { object: 'user'; id: string };
}

/**
 * 最后编辑时间属性
 */
export interface INotionLastEditedTimeProperty extends INotionProperty {
  type: 'last_edited_time';
  last_edited_time: string;
}

/**
 * 最后编辑者属性
 */
export interface INotionLastEditedByProperty extends INotionProperty {
  type: 'last_edited_by';
  last_edited_by: { object: 'user'; id: string };
}

/**
 * 唯一ID属性
 */
export interface INotionUniqueIdProperty extends INotionProperty {
  type: 'unique_id';
  unique_id: { prefix: string | null; number: number };
}

/**
 * 验证属性
 */
export interface INotionVerificationProperty extends INotionProperty {
  type: 'verification';
  verification: {
    state: 'verified' | 'unverified';
    verified_by?: { object: 'user'; id: string };
    date?: string;
  } | null;
}

/**
 * ============================================
 * 映射联合类型
 * ============================================
 */

/**
 * 所有属性类型的联合类型
 */
export type NotionProperty =
  | INotionTitleProperty
  | INotionRichTextProperty
  | INotionNumberProperty
  | INotionSelectProperty
  | INotionMultiSelectProperty
  | INotionStatusProperty
  | INotionDateProperty
  | INotionPeopleProperty
  | INotionFilesProperty
  | INotionCheckboxProperty
  | INotionUrlProperty
  | INotionEmailProperty
  | INotionPhoneNumberProperty
  | INotionFormulaProperty
  | INotionRelationProperty
  | INotionRollupProperty
  | INotionCreatedTimeProperty
  | INotionCreatedByProperty
  | INotionLastEditedTimeProperty
  | INotionLastEditedByProperty
  | INotionUniqueIdProperty
  | INotionVerificationProperty;

/**
 * ============================================
 * MySQL映射类型定义
 * ============================================
 */

/**
 * MySQL字段类型枚举
 */
export enum MySQLFieldType {
  VARCHAR = 'VARCHAR',
  TEXT = 'TEXT',
  LONGTEXT = 'LONGTEXT',
  INT = 'INT',
  BIGINT = 'BIGINT',
  FLOAT = 'FLOAT',
  DOUBLE = 'DOUBLE',
  DECIMAL = 'DECIMAL',
  DATETIME = 'DATETIME',
  DATE = 'DATE',
  TIMESTAMP = 'TIMESTAMP',
  BOOLEAN = 'BOOLEAN',
  JSON = 'JSON',
  ENUM = 'ENUM',
}

/**
 * MySQL字段定义接口
 */
export interface IMySQLField {
  /** 字段名 */
  name: string;
  /** MySQL字段类型 */
  type: MySQLFieldType;
  /** 字段长度/精度 */
  length?: number;
  /** 小数位数 */
  decimals?: number;
  /** 是否为主键 */
  isPrimaryKey: boolean;
  /** 是否可为空 */
  isNullable: boolean;
  /** 默认值 */
  defaultValue?: string | number | null;
  /** 注释 */
  comment?: string;
  /** 字符集（用于文本类型） */
  charset?: string;
  /** 排序规则（用于文本类型） */
  collation?: string;
}

/**
 * Notion属性到MySQL字段的映射配置
 */
export interface IPropertyToMySQLMapping {
  notionPropertyType: NotionPropertyType;
  mysqlFieldType: MySQLFieldType;
  defaultLength: number;
  isNullable: boolean;
  description: string;
}

/**
 * 字段映射表
 */
export const PROPERTY_TO_MYSQL_MAPPING: Record<NotionPropertyType, IPropertyToMySQLMapping> = {
  title: { notionPropertyType: 'title', mysqlFieldType: MySQLFieldType.VARCHAR, defaultLength: 1000, isNullable: true, description: '标题' },
  rich_text: { notionPropertyType: 'rich_text', mysqlFieldType: MySQLFieldType.VARCHAR, defaultLength: 2000, isNullable: true, description: '富文本' },
  number: { notionPropertyType: 'number', mysqlFieldType: MySQLFieldType.DECIMAL, defaultLength: 20, isNullable: true, description: '数字' },
  select: { notionPropertyType: 'select', mysqlFieldType: MySQLFieldType.VARCHAR, defaultLength: 100, isNullable: true, description: '单选' },
  multi_select: { notionPropertyType: 'multi_select', mysqlFieldType: MySQLFieldType.VARCHAR, defaultLength: 500, isNullable: true, description: '多选' },
  status: { notionPropertyType: 'status', mysqlFieldType: MySQLFieldType.VARCHAR, defaultLength: 50, isNullable: true, description: '状态' },
  date: { notionPropertyType: 'date', mysqlFieldType: MySQLFieldType.DATETIME, defaultLength: 0, isNullable: true, description: '日期' },
  people: { notionPropertyType: 'people', mysqlFieldType: MySQLFieldType.JSON, defaultLength: 0, isNullable: true, description: '人员' },
  files: { notionPropertyType: 'files', mysqlFieldType: MySQLFieldType.JSON, defaultLength: 0, isNullable: true, description: '文件' },
  checkbox: { notionPropertyType: 'checkbox', mysqlFieldType: MySQLFieldType.BOOLEAN, defaultLength: 0, isNullable: true, description: '复选框' },
  url: { notionPropertyType: 'url', mysqlFieldType: MySQLFieldType.VARCHAR, defaultLength: 2048, isNullable: true, description: 'URL' },
  email: { notionPropertyType: 'email', mysqlFieldType: MySQLFieldType.VARCHAR, defaultLength: 255, isNullable: true, description: '邮箱' },
  phone_number: { notionPropertyType: 'phone_number', mysqlFieldType: MySQLFieldType.VARCHAR, defaultLength: 50, isNullable: true, description: '电话' },
  formula: { notionPropertyType: 'formula', mysqlFieldType: MySQLFieldType.VARCHAR, defaultLength: 500, isNullable: true, description: '公式' },
  relation: { notionPropertyType: 'relation', mysqlFieldType: MySQLFieldType.VARCHAR, defaultLength: 100, isNullable: true, description: '关联' },
  rollup: { notionPropertyType: 'rollup', mysqlFieldType: MySQLFieldType.VARCHAR, defaultLength: 500, isNullable: true, description: '汇总' },
  created_time: { notionPropertyType: 'created_time', mysqlFieldType: MySQLFieldType.DATETIME, defaultLength: 0, isNullable: true, description: '创建时间' },
  created_by: { notionPropertyType: 'created_by', mysqlFieldType: MySQLFieldType.VARCHAR, defaultLength: 100, isNullable: true, description: '创建者' },
  last_edited_time: { notionPropertyType: 'last_edited_time', mysqlFieldType: MySQLFieldType.DATETIME, defaultLength: 0, isNullable: true, description: '最后编辑时间' },
  last_edited_by: { notionPropertyType: 'last_edited_by', mysqlFieldType: MySQLFieldType.VARCHAR, defaultLength: 100, isNullable: true, description: '最后编辑者' },
  unique_id: { notionPropertyType: 'unique_id', mysqlFieldType: MySQLFieldType.VARCHAR, defaultLength: 50, isNullable: true, description: '唯一ID' },
  verification: { notionPropertyType: 'verification', mysqlFieldType: MySQLFieldType.VARCHAR, defaultLength: 50, isNullable: true, description: '验证' },
};

/**
 * ============================================
 * 同步结果类型定义
 * ============================================
 */

/**
 * 同步结果接口
 */
export interface ISyncResult {
  success: boolean;
  totalRecords: number;
  insertedRecords: number;
  updatedRecords: number;
  skippedRecords: number;
  error?: string;
  duration: number;
  syncedAt: Date;
}

/**
 * 字段分析结果
 * @description 用于存储Notion字段分析结果，包含MySQL字段信息
 */
export interface IFieldAnalysis {
  /** 字段名 */
  name: string;
  /** MySQL字段类型 */
  type: MySQLFieldType;
  /** 字段长度/精度 */
  length?: number;
  /** 小数位数 */
  decimals?: number;
  /** 是否为主键 */
  isPrimaryKey: boolean;
  /** 是否可为空 */
  isNullable: boolean;
  /** 默认值 */
  defaultValue?: string | number | null;
  /** 注释 */
  comment?: string;
  /** 字符集 */
  charset?: string;
  /** 排序规则 */
  collation?: string;
  /** Notion属性类型 */
  notionType: NotionPropertyType;
  /** MySQL字段类型（冗余字段，用于类型安全） */
  mysqlType: MySQLFieldType;
}

/**
 * 数据库Schema分析结果
 */
export interface ISchemaAnalysis {
  tableName: string;
  fields: IFieldAnalysis[];
  primaryKey: string;
  tableExists: boolean;
}

/**
 * Notion API响应基础接口
 */
export interface INotionResponse<T> {
  object: string;
  results: T[];
  next_cursor: string | null;
  has_more: boolean;
  type: string;
}

/**
 * ============================================
 * sync_data_sources 表类型定义
 * ============================================
 */

/**
 * 同步数据库配置状态枚举
 */
export type SyncDataSourceStatus = 'active' | 'inactive';

/** 同步数据源配置接口（对应 sync_data_sources 表结构） */
export interface ISyncDataSource {
  /** 配置ID */
  id: number;
  /** Notion data_source_id */
  notionDataSourceId: string;
  /** MySQL表名 */
  tableName: string;
  /** 数据库名称 */
  databaseName: string;
  /** 同步状态 */
  status: SyncDataSourceStatus;
  /** 同步间隔（秒） */
  syncInterval: number;
  /** 上次同步时间 */
  lastSyncAt: Date | null;
  /** 创建时间 */
  createdAt: Date;
  /** 更新时间 */
  updatedAt: Date;
  /** 备注 */
  remark: string | null;
}

/**
 * 创建同步数据库配置请求
 */
export interface ICreateSyncDataSourceRequest {
  /** Notion data_source_id */
  notionDataSourceId: string;
  /** MySQL表名 */
  tableName: string;
  /** 数据库名称 */
  databaseName: string;
  /** 同步状态 */
  status?: SyncDataSourceStatus;
  /** 同步间隔（秒） */
  syncInterval?: number;
  /** 备注 */
  remark?: string;
}

/**
 * 更新同步数据库配置请求
 */
export interface IUpdateSyncDataSourceRequest {
  /** MySQL表名 */
  tableName?: string;
  /** 数据库名称 */
  databaseName?: string;
  /** 同步状态 */
  status?: SyncDataSourceStatus;
  /** 同步间隔（秒） */
  syncInterval?: number;
  /** 备注 */
  remark?: string;
}

/**
 * 同步数据库列表查询参数
 */
export interface ISyncDataSourceListQuery {
  /** 状态筛选 */
  status?: SyncDataSourceStatus;
  /** 页码 */
  page?: number;
  /** 每页数量 */
  pageSize?: number;
}

/**
 * ============================================
 * 用户认证类型定义
 * ============================================
 */

/**
 * 用户状态枚举
 */
export type UserStatus = 'active' | 'inactive' | 'banned';

/**
 * 用户信息接口
 */
export interface IUser {
  /** 用户ID */
  id: number;
  /** 用户名 */
  username: string;
  /** 邮箱 */
  email: string;
  /** 密码哈希 */
  password_hash: string;
  /** 用户状态 */
  status: UserStatus;
  /** 创建时间 */
  created_at: Date;
  /** 更新时间 */
  updated_at: Date;
  /** 最后登录时间 */
  last_login_at: Date | null;
}

/**
 * 用户Token信息接口
 */
export interface IUserToken {
  /** Token ID */
  id: number;
  /** 用户ID */
  user_id: number;
  /** Token字符串 */
  token: string;
  /** Token类型 */
  token_type: string;
  /** 过期时间 */
  expires_at: Date;
  /** 撤销时间 */
  revoked_at: Date | null;
  /** 创建时间 */
  created_at: Date;
}

/**
 * Token载荷接口
 */
export interface TokenPayload {
  /** 用户ID */
  userId: number;
  /** 用户名 */
  username: string;
  /** 邮箱 */
  email: string;
  /** Token类型（可选，refresh token时为'refresh'） */
  type?: string;
  /** 签发时间 */
  iat?: number;
  /** 过期时间 */
  exp?: number;
}
