const db = require('../lib/db');

async function createChartsTable() {
    const sql = `
        CREATE TABLE IF NOT EXISTS charts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            title VARCHAR(255) NOT NULL,
            description TEXT,
            type VARCHAR(50) NOT NULL,
            data_source VARCHAR(100),
            x_axis VARCHAR(100),
            y_axis VARCHAR(100),
            aggregation VARCHAR(50),
            time_range VARCHAR(50),
            filters JSON,
            permissions JSON,
            styling JSON,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;

    try {
        console.log('Creating charts table...');
        await db.query(sql);
        console.log('Charts table created successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Error creating charts table:', error);
        process.exit(1);
    }
}

createChartsTable();
