/**
 * Notion数据类型定义模块
 * @module types
 * @description 定义Notion API返回数据的完整类型接口，覆盖常见字段类型
 */

import { Client } from '@notionhq/client';

/**
 * ============================================
 * Notion API 基础类型定义
 * ============================================
 */

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
  properties: Record<string, INotionProperty>;
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
  type: 'emoji' | 'external' | 'file';
  emoji?: string;
  external?: {
    url: string;
  };
  file?: {
    url: string;
    expiry_time: string;
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
  title: {
    rich_text: IRichText[];
  };
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
    link: {
      url: string;
    } | null;
  };
  mention?: {
    type: 'page' | 'database' | 'user' | 'date' | 'link_preview';
    page?: {
      id: string;
      object: 'page';
    };
    database?: {
      id: string;
      object: 'database';
    };
    user?: {
      id: string;
      object: 'user';
    };
    date?: {
      start: string;
      end: string | null;
    };
    link_preview?: {
      url: string;
    };
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
    person?: {
      email: string;
    };
    bot?: {
      owner: {
        type: 'user';
        user: {
          object: 'user';
          id: string;
        };
      };
    };
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
    external?: {
      url: string;
    };
    file?: {
      url: string;
      expiry_time: string;
    };
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
    date?: {
      start: string;
      end: string | null;
    };
  };
}

/**
 * 关联属性
 */
export interface INotionRelationProperty extends INotionProperty {
  type: 'relation';
  relation: Array<{
    id: string;
    opened: boolean;
  }>;
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
    date?: {
      start: string;
      end: string | null;
    };
    array?: Array<{
      type: string;
      [key: string]: unknown;
    }>;
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
  created_by: {
    object: 'user';
    id: string;
  };
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
  last_edited_by: {
    object: 'user';
    id: string;
  };
}

/**
 * 唯一ID属性
 */
export interface INotionUniqueIdProperty extends INotionProperty {
  type: 'unique_id';
  unique_id: {
    prefix: string | null;
    number: number;
  };
}

/**
 * 验证属性
 */
export interface INotionVerificationProperty extends INotionProperty {
  type: 'verification';
  verification: {
    state: 'verified' | 'unverified';
    verified_by?: {
      object: 'user';
      id: string;
    };
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
 * @description 定义Notion属性类型到MySQL字段类型的默认映射规则
 */
export const PROPERTY_TO_MYSQL_MAPPING: Record<NotionPropertyType, IPropertyToMySQLMapping> = {
  title: {
    notionPropertyType: 'title',
    mysqlFieldType: MySQLFieldType.VARCHAR,
    defaultLength: 1000,
    isNullable: true,
    description: '标题映射为VARCHAR',
  },
  rich_text: {
    notionPropertyType: 'rich_text',
    mysqlFieldType: MySQLFieldType.VARCHAR,
    defaultLength: 2000,
    isNullable: true,
    description: '富文本映射为VARCHAR',
  },
  number: {
    notionPropertyType: 'number',
    mysqlFieldType: MySQLFieldType.DECIMAL,
    defaultLength: 20,
    isNullable: true,
    description: '数字映射为DECIMAL',
  },
  select: {
    notionPropertyType: 'select',
    mysqlFieldType: MySQLFieldType.VARCHAR,
    defaultLength: 100,
    isNullable: true,
    description: '单选映射为VARCHAR',
  },
  multi_select: {
    notionPropertyType: 'multi_select',
    mysqlFieldType: MySQLFieldType.VARCHAR,
    defaultLength: 500,
    isNullable: true,
    description: '多选映射为JSON格式的VARCHAR',
  },
  status: {
    notionPropertyType: 'status',
    mysqlFieldType: MySQLFieldType.VARCHAR,
    defaultLength: 50,
    isNullable: true,
    description: '状态映射为VARCHAR',
  },
  date: {
    notionPropertyType: 'date',
    mysqlFieldType: MySQLFieldType.DATETIME,
    defaultLength: 0,
    isNullable: true,
    description: '日期映射为DATETIME',
  },
  people: {
    notionPropertyType: 'people',
    mysqlFieldType: MySQLFieldType.JSON,
    defaultLength: 0,
    isNullable: true,
    description: '人员映射为JSON',
  },
  files: {
    notionPropertyType: 'files',
    mysqlFieldType: MySQLFieldType.JSON,
    defaultLength: 0,
    isNullable: true,
    description: '文件映射为JSON',
  },
  checkbox: {
    notionPropertyType: 'checkbox',
    mysqlFieldType: MySQLFieldType.BOOLEAN,
    defaultLength: 0,
    isNullable: true,
    description: '复选框映射为BOOLEAN',
  },
  url: {
    notionPropertyType: 'url',
    mysqlFieldType: MySQLFieldType.VARCHAR,
    defaultLength: 2048,
    isNullable: true,
    description: 'URL映射为VARCHAR',
  },
  email: {
    notionPropertyType: 'email',
    mysqlFieldType: MySQLFieldType.VARCHAR,
    defaultLength: 255,
    isNullable: true,
    description: '邮箱映射为VARCHAR',
  },
  phone_number: {
    notionPropertyType: 'phone_number',
    mysqlFieldType: MySQLFieldType.VARCHAR,
    defaultLength: 50,
    isNullable: true,
    description: '电话号码映射为VARCHAR',
  },
  formula: {
    notionPropertyType: 'formula',
    mysqlFieldType: MySQLFieldType.VARCHAR,
    defaultLength: 500,
    isNullable: true,
    description: '公式映射为VARCHAR',
  },
  relation: {
    notionPropertyType: 'relation',
    mysqlFieldType: MySQLFieldType.VARCHAR,
    defaultLength: 100,
    isNullable: true,
    description: '关联映射为JSON',
  },
  rollup: {
    notionPropertyType: 'rollup',
    mysqlFieldType: MySQLFieldType.VARCHAR,
    defaultLength: 500,
    isNullable: true,
    description: '汇总映射为VARCHAR',
  },
  created_time: {
    notionPropertyType: 'created_time',
    mysqlFieldType: MySQLFieldType.DATETIME,
    defaultLength: 0,
    isNullable: true,
    description: '创建时间映射为DATETIME',
  },
  created_by: {
    notionPropertyType: 'created_by',
    mysqlFieldType: MySQLFieldType.VARCHAR,
    defaultLength: 100,
    isNullable: true,
    description: '创建者映射为VARCHAR',
  },
  last_edited_time: {
    notionPropertyType: 'last_edited_time',
    mysqlFieldType: MySQLFieldType.DATETIME,
    defaultLength: 0,
    isNullable: true,
    description: '最后编辑时间映射为DATETIME',
  },
  last_edited_by: {
    notionPropertyType: 'last_edited_by',
    mysqlFieldType: MySQLFieldType.VARCHAR,
    defaultLength: 100,
    isNullable: true,
    description: '最后编辑者映射为VARCHAR',
  },
  unique_id: {
    notionPropertyType: 'unique_id',
    mysqlFieldType: MySQLFieldType.VARCHAR,
    defaultLength: 50,
    isNullable: true,
    description: '唯一ID映射为VARCHAR',
  },
  verification: {
    notionPropertyType: 'verification',
    mysqlFieldType: MySQLFieldType.VARCHAR,
    defaultLength: 50,
    isNullable: true,
    description: '验证状态映射为VARCHAR',
  },
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
  /** 是否成功 */
  success: boolean;
  /** 同步的记录数 */
  totalRecords: number;
  /** 新增记录数 */
  insertedRecords: number;
  /** 更新的记录数 */
  updatedRecords: number;
  /** 跳过的记录数 */
  skippedRecords: number;
  /** 错误信息 */
  error?: string;
  /** 同步耗时（毫秒） */
  duration: number;
  /** 同步时间戳 */
  syncedAt: Date;
}

/**
 * 字段分析结果
 */
export interface IFieldAnalysis {
  /** 字段名 */
  name: string;
  /** Notion属性类型 */
  notionType: NotionPropertyType;
  /** MySQL字段类型 */
  mysqlType: MySQLFieldType;
  /** 字段长度 */
  length: number;
  /** 是否为主键 */
  isPrimaryKey: boolean;
  /** 是否可为空 */
  isNullable: boolean;
  /** 字段注释 */
  comment?: string;
}

/**
 * 数据库Schema分析结果
 */
export interface ISchemaAnalysis {
  /** 表名 */
  tableName: string;
  /** 字段列表 */
  fields: IFieldAnalysis[];
  /** 主键字段名 */
  primaryKey: string;
  /** 是否已存在 */
  tableExists: boolean;
}
