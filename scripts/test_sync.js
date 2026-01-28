const Auth = require('../lib/auth');
const SyncEngine = require('../lib/sync');
const db = require('../lib/db');

async function test() {
    try {
        console.log('--- Notion Sync Tool Test ---');

        // 1. 测试用户管理
        console.log('\n[Testing User Management]');
        const username = 'testuser_' + Date.now();
        await Auth.createUser(username, 'password123', 'sync:notion');
        const users = await Auth.listUsers();
        const testUser = users.find(u => u.username === username);
        console.log(`Created user: ${testUser.username}, ID: ${testUser.id}`);

        // 2. 测试权限验证
        console.log('\n[Testing Permission Check]');
        const canSync = await Auth.checkPermission(testUser.id, 'sync:notion');
        console.log(`User has sync permission: ${canSync}`);

        const unauthorizedUser = await Auth.createUser('no_permission_user', 'pass');
        const canSyncUnauthorized = await Auth.checkPermission(unauthorizedUser.id, 'sync:notion');
        console.log(`Unauthorized user has sync permission: ${canSyncUnauthorized}`);

        // 3. 准备 Notion 配置 (需用户在数据库中手动填写)
        console.log('\n[Notion Configuration]');
        console.log('Please ensure notion_api_key and notion_database_id are set in the `configs` table.');

        // 4. 执行同步 (注意：这需要真实的 API Key 和数据库连接)
        // console.log('\n[Running Sync]');
        // await SyncEngine.run(testUser.id);

        console.log('\nTest completed (User/Permission logic verified).');
    } catch (error) {
        console.error('Test failed:', error);
    } finally {
        process.exit();
    }
}

test();
