const db = require('./db');

/**
 * 用户管理与权限控制
 */
class Auth {
    /**
     * 创建用户
     */
    static async createUser(username, password, permissions = '', role = 'user') {
        const sql = 'INSERT INTO users (username, password, permissions, role) VALUES (?, ?, ?, ?)';
        return await db.query(sql, [username, password, permissions, role]);
    }

    /**
     * 删除用户
     */
    static async deleteUser(id) {
        const sql = 'DELETE FROM users WHERE id = ?';
        return await db.query(sql, [id]);
    }

    /**
     * 更新用户信息
     */
    static async updateUser(id, updates) {
        const fields = [];
        const values = [];
        for (const [key, value] of Object.entries(updates)) {
            fields.push(`\`${key}\` = ?`);
            values.push(value);
        }
        values.push(id);
        const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
        return await db.query(sql, values);
    }

    /**
     * 获取用户信息
     */
    static async getUser(id) {
        const sql = 'SELECT * FROM users WHERE id = ?';
        const results = await db.query(sql, [id]);
        return results[0] || null;
    }

    /**
     * 获取所有用户
     */
    static async listUsers() {
        const sql = 'SELECT * FROM users';
        return await db.query(sql);
    }

    /**
     * 用户登录验证
     */
    static async login(username, password) {
        const sql = 'SELECT * FROM users WHERE username = ? AND password = ?';
        const results = await db.query(sql, [username, password]);
        return results[0] || null;
    }

    /**
     * 权限验证
     * @param {number} userId 用户 ID
     * @param {string} permissionRequired 所需权限标识，如 'sync:notion'
     */
    static async checkPermission(userId, permissionRequired) {
        const user = await this.getUser(userId);
        if (!user) return false;
        
        const permissions = user.permissions ? user.permissions.split(',') : [];
        return permissions.includes(permissionRequired);
    }
}

module.exports = Auth;
