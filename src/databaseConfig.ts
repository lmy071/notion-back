/**
 * 数据库配置管理模块
 * @module databaseConfig
 * @description 管理多个Notion数据库的同步配置
 */

/**
 * Notion数据库配置接口
 */
export interface IDatabaseConfig {
  /** 数据库ID（主键） */
  id: number;
  /** Notion数据库ID */
  notionDatabaseId: string;
  /** MySQL表名 */
  tableName: string;
  /** 数据库名称 */
  databaseName: string;
  /** 同步状态：active-启用，inactive-禁用 */
  status: 'active' | 'inactive';
  /** 同步间隔（秒） */
  syncInterval: number;
  /** 上次同步时间 */
  lastSyncAt: string | null;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  /** 备注 */
  remark: string | null;
}

/**
 * 数据库配置管理器类
 */
export class DatabaseConfigManager {
  /** 配置文件路径 */
  private configPath: string;
  /** 数据库配置列表 */
  private databases: IDatabaseConfig[];

  /**
   * 创建数据库配置管理器
   * @param configPath - 配置文件路径（默认: ./config/databases.json）
   */
  constructor(configPath: string = './config/databases.json') {
    this.configPath = configPath;
    this.databases = [];
    this.loadConfig();
  }

  /**
   * 加载配置文件
   */
  private loadConfig(): void {
    try {
      const fs = require('fs');
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        this.databases = JSON.parse(content);
      } else {
        this.databases = [];
        this.ensureConfigDir();
      }
    } catch (error) {
      console.error(`加载数据库配置失败: ${(error as Error).message}`);
      this.databases = [];
    }
  }

  /**
   * 确保配置目录存在
   */
  private ensureConfigDir(): void {
    const fs = require('fs');
    const dir = require('path').dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 保存配置文件
   */
  private saveConfig(): void {
    try {
      this.ensureConfigDir();
      const fs = require('fs');
      fs.writeFileSync(this.configPath, JSON.stringify(this.databases, null, 2), 'utf-8');
    } catch (error) {
      console.error(`保存数据库配置失败: ${(error as Error).message}`);
    }
  }

  /**
   * 获取所有启用的数据库配置
   * @returns 数据库配置数组
   */
  getActiveDatabases(): IDatabaseConfig[] {
    return this.databases.filter((db) => db.status === 'active');
  }

  /**
   * 获取所有数据库配置
   * @returns 数据库配置数组
   */
  getAllDatabases(): IDatabaseConfig[] {
    return this.databases;
  }

  /**
   * 根据表名获取数据库配置
   * @param tableName - 表名
   * @returns 数据库配置或undefined
   */
  getByTableName(tableName: string): IDatabaseConfig | undefined {
    return this.databases.find((db) => db.tableName === tableName);
  }

  /**
   * 根据Notion数据库ID获取配置
   * @param notionDatabaseId - Notion数据库ID
   * @returns 数据库配置或undefined
   */
  getByNotionId(notionDatabaseId: string): IDatabaseConfig | undefined {
    return this.databases.find((db) => db.notionDatabaseId === notionDatabaseId);
  }

  /**
   * 添加数据库配置
   * @param config - 数据库配置（不含id和创建时间）
   * @returns 添加后的配置
   */
  addDatabase(
    config: Omit<IDatabaseConfig, 'id' | 'createdAt' | 'updatedAt'>
  ): IDatabaseConfig {
    const now = new Date().toISOString();
    const newConfig: IDatabaseConfig = {
      ...config,
      id: this.databases.length + 1,
      createdAt: now,
      updatedAt: now,
    };

    this.databases.push(newConfig);
    this.saveConfig();
    return newConfig;
  }

  /**
   * 更新数据库配置
   * @param id - 数据库ID
   * @param updates - 更新内容
   * @returns 是否更新成功
   */
  updateDatabase(
    id: number,
    updates: Partial<Omit<IDatabaseConfig, 'id' | 'createdAt'>>
  ): boolean {
    const index = this.databases.findIndex((db) => db.id === id);
    if (index === -1) {
      return false;
    }

    this.databases[index] = {
      ...this.databases[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.saveConfig();
    return true;
  }

  /**
   * 删除数据库配置
   * @param id - 数据库ID
   * @returns 是否删除成功
   */
  deleteDatabase(id: number): boolean {
    const index = this.databases.findIndex((db) => db.id === id);
    if (index === -1) {
      return false;
    }

    this.databases.splice(index, 1);
    this.saveConfig();
    return true;
  }

  /**
   * 更新最后同步时间
   * @param id - 数据库ID
   */
  updateLastSyncTime(id: number): void {
    const config = this.databases.find((db) => db.id === id);
    if (config) {
      config.lastSyncAt = new Date().toISOString();
      config.updatedAt = config.lastSyncAt;
      this.saveConfig();
    }
  }

  /**
   * 添加示例配置（用于初始化）
   */
  addSampleConfig(): IDatabaseConfig[] {
    // 检查是否已存在示例配置
    const existing = this.getByNotionId('29320a967459807899b9f7b70478b3f6');
    if (existing) {
      return [existing];
    }

    const config = this.addDatabase({
      notionDatabaseId: '29320a967459807899b9f7b70478b3f6',
      tableName: 'notion_sync',
      databaseName: 'notion_sync',
      status: 'active',
      syncInterval: 300,
      lastSyncAt: null,
      remark: '示例数据库',
    });

    return [config];
  }
}

/**
 * 数据库配置管理器单例
 */
let configManager: DatabaseConfigManager | null = null;

/**
 * 获取数据库配置管理器实例
 * @param configPath - 配置文件路径（可选）
 * @returns 数据库配置管理器实例
 */
export function getDatabaseConfigManager(configPath?: string): DatabaseConfigManager {
  if (!configManager || configPath) {
    configManager = new DatabaseConfigManager(configPath);
  }
  return configManager;
}

/**
 * 重新初始化数据库配置管理器
 * @param configPath - 配置文件路径（可选）
 * @returns 数据库配置管理器实例
 */
export function resetDatabaseConfigManager(configPath?: string): DatabaseConfigManager {
  configManager = new DatabaseConfigManager(configPath);
  return configManager;
}
