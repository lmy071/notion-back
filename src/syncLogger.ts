/**
 * 同步日志模块
 * @module syncLogger
 * @description 记录同步过程中的元数据到日志文件
 */

import fs from 'fs';
import path from 'path';

/**
 * 同步日志接口
 */
export interface ISyncLog {
  /** 同步时间 */
  timestamp: string;
  /** 数据库ID */
  databaseId: string;
  /** 获取到的页面数量 */
  pageCount: number;
  /** 页面元数据 */
  pages: Array<{
    id: string;
    created_time: string | null;
    last_edited_time: string | null;
    url: string;
    properties: Record<string, unknown>;
  }>;
  /** 同步结果 */
  success: boolean;
  /** 错误信息（如果失败） */
  error?: string;
}

/**
 * 同步日志类
 */
export class SyncLogger {
  /** 日志目录路径 */
  private logDir: string;
  /** 保留的日志数量 */
  private keepCount: number;

  /**
   * 创建同步日志实例
   * @param logDir - 日志目录路径（默认: ./logs）
   * @param keepCount - 保留的日志数量（默认: 50）
   */
  constructor(logDir: string = './logs', keepCount: number = 50) {
    this.logDir = logDir;
    this.keepCount = keepCount;
    this.ensureLogDir();
  }

  /**
   * 确保日志目录存在
   */
  private ensureLogDir(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * 生成日志文件名
   * @returns 日志文件名
   */
  private generateLogFileName(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `sync-${timestamp}.json`;
  }

  /**
   * 保存同步日志
   * @param databaseId - Notion数据库ID
   * @param pages - 获取到的页面数据
   * @param success - 是否成功
   * @param error - 错误信息（可选）
   * @returns 日志文件路径
   */
  saveLog(
    databaseId: string,
    pages: Array<{
      id: string;
      created_time?: string | null;
      last_edited_time?: string | null;
      url?: string;
      properties: Record<string, unknown>;
    }>,
    success: boolean,
    error?: string
  ): string {
    const logData: ISyncLog = {
      timestamp: new Date().toISOString(),
      databaseId,
      pageCount: pages.length,
      pages: pages.map((page) => ({
        id: page.id,
        created_time: page.created_time || null,
        last_edited_time: page.last_edited_time || null,
        url: page.url || '',
        properties: page.properties,
      })),
      success,
      error,
    };

    const logFileName = this.generateLogFileName();
    const logFilePath = path.join(this.logDir, logFileName);

    try {
      fs.writeFileSync(logFilePath, JSON.stringify(logData, null, 2), 'utf-8');
      console.log(`📝 同步日志已保存: ${logFilePath}`);

      // 自动清理旧日志，保留最新50条
      this.cleanupOldLogs();
    } catch (err) {
      console.error(`❌ 保存同步日志失败: ${(err as Error).message}`);
    }

    return logFilePath;
  }

  /**
   * 获取日志目录路径
   * @returns 日志目录路径
   */
  getLogDir(): string {
    return this.logDir;
  }

  /**
   * 获取所有日志文件
   * @returns 日志文件名数组
   */
  getLogFiles(): string[] {
    if (!fs.existsSync(this.logDir)) {
      return [];
    }

    const files = fs.readdirSync(this.logDir);
    return files
      .filter((file) => file.startsWith('sync-') && file.endsWith('.json'))
      .sort()
      .reverse();
  }

  /**
   * 读取日志文件
   * @param fileName - 日志文件名
   * @returns 日志数据
   */
  readLog(fileName: string): ISyncLog | null {
    const logFilePath = path.join(this.logDir, fileName);

    if (!fs.existsSync(logFilePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(logFilePath, 'utf-8');
      return JSON.parse(content) as ISyncLog;
    } catch (err) {
      console.error(`❌ 读取日志文件失败: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * 删除旧日志文件（默认保留最新50条）
   * @param keepCount - 保留的日志数量（默认使用构造函数设置的值）
   */
  cleanupOldLogs(keepCount?: number): void {
    const maxKeep = keepCount ?? this.keepCount;
    const logFiles = this.getLogFiles();

    if (logFiles.length <= maxKeep) {
      return;
    }

    const filesToDelete = logFiles.slice(maxKeep);

    for (const fileName of filesToDelete) {
      const filePath = path.join(this.logDir, fileName);
      try {
        fs.unlinkSync(filePath);
        console.log(`🗑️  已删除旧日志: ${fileName}`);
      } catch (err) {
        console.error(`❌ 删除日志文件失败: ${fileName}`);
      }
    }
  }
}

/**
 * 创建同步日志器的工厂函数
 * @param logDir - 日志目录路径
 * @param keepCount - 保留的日志数量（默认: 50）
 * @returns SyncLogger实例
 */
export function createSyncLogger(logDir?: string, keepCount?: number): SyncLogger {
  return new SyncLogger(logDir, keepCount);
}
