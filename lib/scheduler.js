const cron = require('node-cron');
const db = require('./db');
const SyncEngine = require('./sync');

// 存储所有的任务，key 为 userId，value 为 cron 任务对象
const tasks = new Map();

/**
 * 初始化所有用户的定时同步任务
 */
async function init() {
    console.log('[Scheduler] Initializing all sync schedules...');
    try {
        // 查询所有设置了定时同步的用户配置
        const rows = await db.query("SELECT user_id, config_value FROM user_configs WHERE config_key = 'sync_schedule'");
        
        for (const row of rows) {
            const userId = row.user_id;
            const cronExpression = row.config_value;
            
            if (cronExpression && cron.validate(cronExpression)) {
                scheduleSync(userId, cronExpression);
            } else {
                console.warn(`[Scheduler] Invalid cron expression for user ${userId}: ${cronExpression}`);
            }
        }
        console.log(`[Scheduler] Initialized ${tasks.size} sync tasks.`);
    } catch (error) {
        console.error('[Scheduler] Initialization failed:', error);
    }
}

/**
 * 为特定用户安排同步任务
 * @param {number} userId 
 * @param {string} cronExpression 
 */
function scheduleSync(userId, cronExpression) {
    // 如果该用户已经有任务，先停止并移除
    if (tasks.has(userId)) {
        tasks.get(userId).stop();
        tasks.delete(userId);
    }

    if (!cronExpression) return;

    // 创建新任务
    const task = cron.schedule(cronExpression, async () => {
        console.log(`[Scheduler] Running scheduled sync for user ${userId} (${cronExpression})`);
        try {
            await SyncEngine.run(userId);
            console.log(`[Scheduler] Scheduled sync completed for user ${userId}`);
        } catch (error) {
            console.error(`[Scheduler] Scheduled sync failed for user ${userId}:`, error);
        }
    });

    tasks.set(userId, task);
    console.log(`[Scheduler] Scheduled sync for user ${userId} set to: ${cronExpression}`);
}

/**
 * 停止特定用户的同步任务
 * @param {number} userId 
 */
function stopSync(userId) {
    if (tasks.has(userId)) {
        tasks.get(userId).stop();
        tasks.delete(userId);
        console.log(`[Scheduler] Stopped sync for user ${userId}`);
    }
}

module.exports = {
    init,
    scheduleSync,
    stopSync
};
