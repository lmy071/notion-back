const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const Auth = require('../lib/auth');
const { StatusCode } = require('../lib/constants');

/**
 * Middleware: Authenticate User
 */
const authenticate = async (req, res, next) => {
    const userId = req.headers['x-user-id'];
    if (!userId) {
        return res.status(401).json({ 
            success: false, 
            message: 'Unauthorized: Missing User ID',
            code: StatusCode.UNAUTHORIZED
        });
    }
    try {
        const user = await Auth.getUser(userId);
        if (!user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized: Invalid User',
                code: StatusCode.UNAUTHORIZED
            });
        }
        req.user = user;
        next();
    } catch (error) {
        console.error('Authentication error:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

router.use(authenticate);

/**
 * Helper: Check chart access permission
 */
const checkChartAccess = (chart, user) => {
    // Owner always has access
    if (chart.user_id === user.id) return true;
    
    // Check permissions JSON
    let permissions;
    try {
        permissions = typeof chart.permissions === 'string' ? JSON.parse(chart.permissions) : chart.permissions;
    } catch (e) {
        permissions = { visibility: 'private' };
    }

    if (permissions.visibility === 'public') return true;
    
    if (permissions.visibility === 'shared') {
        // Check allowed users
        if (permissions.allowedUsers && permissions.allowedUsers.includes(user.id)) return true;
        // Check allowed roles
        if (permissions.allowedRoles && permissions.allowedRoles.includes(user.role)) return true;
    }

    return false;
};

router.get('/', async (req, res) => {
    try {
        const charts = await db.query('SELECT * FROM charts ORDER BY created_at DESC');
        const accessibleCharts = charts.filter(chart => checkChartAccess(chart, req.user));
        const processedCharts = accessibleCharts.map(chart => {
            const filters = typeof chart.filters === 'string' ? JSON.parse(chart.filters) : chart.filters;
            const permissions = typeof chart.permissions === 'string' ? JSON.parse(chart.permissions) : chart.permissions;
            const styling = typeof chart.styling === 'string' ? JSON.parse(chart.styling) : chart.styling;

            return {
                id: chart.id,
                user_id: chart.user_id,
                created_by: chart.user_id,
                title: chart.title,
                description: chart.description,
                type: chart.type,
                dataSource: chart.data_source,
                xAxis: chart.x_axis,
                yAxis: chart.y_axis,
                aggregation: chart.aggregation,
                timeRange: chart.time_range,
                filters,
                permissions,
                styling,
                created_at: chart.created_at,
                updated_at: chart.updated_at
            };
        });

        res.json({
            success: true,
            data: processedCharts
        });
    } catch (error) {
        console.error('Error fetching charts:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch charts' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const charts = await db.query('SELECT * FROM charts WHERE id = ?', [req.params.id]);
        
        if (charts.length === 0) {
            return res.status(404).json({ success: false, message: 'Chart not found' });
        }

        const chart = charts[0];
        if (!checkChartAccess(chart, req.user)) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const filters = typeof chart.filters === 'string' ? JSON.parse(chart.filters) : chart.filters;
        const permissions = typeof chart.permissions === 'string' ? JSON.parse(chart.permissions) : chart.permissions;
        const styling = typeof chart.styling === 'string' ? JSON.parse(chart.styling) : chart.styling;

        const processedChart = {
            id: chart.id,
            user_id: chart.user_id,
            created_by: chart.user_id,
            title: chart.title,
            description: chart.description,
            type: chart.type,
            dataSource: chart.data_source,
            xAxis: chart.x_axis,
            yAxis: chart.y_axis,
            aggregation: chart.aggregation,
            timeRange: chart.time_range,
            filters,
            permissions,
            styling,
            created_at: chart.created_at,
            updated_at: chart.updated_at
        };

        res.json({
            success: true,
            data: processedChart
        });
    } catch (error) {
        console.error('Error fetching chart:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch chart' });
    }
});

/**
 * POST /charts - Create a new chart
 */
router.post('/', async (req, res) => {
    const { 
        title, description, type, dataSource, xAxis, yAxis, 
        aggregation, timeRange, filters, permissions, styling 
    } = req.body;

    if (!title || !type) {
        return res.status(400).json({ success: false, message: 'Title and Type are required' });
    }

    try {
        const sql = `
            INSERT INTO charts (
                user_id, title, description, type, data_source, 
                x_axis, y_axis, aggregation, time_range, 
                filters, permissions, styling
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const params = [
            req.user.id,
            title,
            description || '',
            type,
            dataSource || '',
            xAxis || '',
            yAxis || '',
            aggregation || 'sum',
            timeRange || '30d',
            JSON.stringify(filters || []),
            JSON.stringify(permissions || { visibility: 'private' }),
            JSON.stringify(styling || {})
        ];

        const result = await db.query(sql, params);
        
        res.json({
            success: true,
            message: 'Chart created successfully',
            data: { id: result.insertId }
        });
    } catch (error) {
        console.error('Error creating chart:', error);
        res.status(500).json({ success: false, message: 'Failed to create chart' });
    }
});

/**
 * PUT /charts/:id - Update an existing chart
 */
router.put('/:id', async (req, res) => {
    const chartId = req.params.id;
    const { 
        title, description, type, dataSource, xAxis, yAxis, 
        aggregation, timeRange, filters, permissions, styling 
    } = req.body;

    try {
        // Check existence and ownership
        const charts = await db.query('SELECT * FROM charts WHERE id = ?', [chartId]);
        if (charts.length === 0) {
            return res.status(404).json({ success: false, message: 'Chart not found' });
        }
        
        const chart = charts[0];
        // Only owner can update
        if (chart.user_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Only the owner can update this chart' });
        }

        const sql = `
            UPDATE charts SET 
                title = ?, description = ?, type = ?, data_source = ?, 
                x_axis = ?, y_axis = ?, aggregation = ?, time_range = ?, 
                filters = ?, permissions = ?, styling = ?
            WHERE id = ?
        `;
        
        const params = [
            title,
            description || '',
            type,
            dataSource || '',
            xAxis || '',
            yAxis || '',
            aggregation || 'sum',
            timeRange || '30d',
            JSON.stringify(filters || []),
            JSON.stringify(permissions || { visibility: 'private' }),
            JSON.stringify(styling || {}),
            chartId
        ];

        await db.query(sql, params);
        
        res.json({
            success: true,
            message: 'Chart updated successfully'
        });
    } catch (error) {
        console.error('Error updating chart:', error);
        res.status(500).json({ success: false, message: 'Failed to update chart' });
    }
});

/**
 * DELETE /charts/:id - Delete a chart
 */
router.delete('/:id', async (req, res) => {
    const chartId = req.params.id;

    try {
        // Check existence and ownership
        const charts = await db.query('SELECT * FROM charts WHERE id = ?', [chartId]);
        if (charts.length === 0) {
            return res.status(404).json({ success: false, message: 'Chart not found' });
        }
        
        const chart = charts[0];
        // Only owner can delete
        if (chart.user_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Only the owner can delete this chart' });
        }

        await db.query('DELETE FROM charts WHERE id = ?', [chartId]);
        
        res.json({
            success: true,
            message: 'Chart deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting chart:', error);
        res.status(500).json({ success: false, message: 'Failed to delete chart' });
    }
});

/**
 * POST /charts/preview - Preview chart data
 */
router.post('/preview', async (req, res) => {
    const { 
        dataSource, 
        xAxis, 
        yAxis, 
        aggregation = 'sum', 
        timeRange = '30d', 
        filters = [] 
    } = req.body;

    if (!dataSource || !xAxis || !yAxis) {
        return res.status(400).json({ 
            success: false, 
            message: 'dataSource, xAxis, and yAxis are required for preview.' 
        });
    }

    try {
        // 1. Time Range
        let timeRangeCondition = '';
        const timeRangeMatch = timeRange.match(/^(\d+)([dmy])$/);
        if (timeRangeMatch) {
            const value = parseInt(timeRangeMatch[1], 10);
            const unit = { d: 'DAY', m: 'MONTH', y: 'YEAR' }[timeRangeMatch[2]];
            // Assuming the time column is always named 'xiao_fei_ri_qi' for now
            timeRangeCondition = `xiao_fei_ri_qi >= DATE_SUB(NOW(), INTERVAL ${value} ${unit})`;
        }

        // 2. Aggregation
        const aggFunction = ['sum', 'avg', 'count', 'min', 'max'].includes(aggregation.toLowerCase()) 
            ? aggregation.toUpperCase() 
            : 'SUM';
        
        // 3. Build Query
        // IMPORTANT: This is a simplified and potentially insecure way to build queries.
        // In a production environment, you MUST sanitize all inputs (dataSource, xAxis, yAxis)
        // to prevent SQL injection. For this exercise, we assume valid inputs.
        const sql = `
            SELECT
                DATE_FORMAT(${db.escapeId(xAxis)}, '%Y-%m-%d') as x,
                ${aggFunction}(${db.escapeId(yAxis)}) as y
            FROM ${db.escapeId(dataSource)}
            ${timeRangeCondition ? `WHERE ${timeRangeCondition}` : ''}
            GROUP BY x
            ORDER BY x ASC
        `;

        const results = await db.query(sql);

        res.json({
            success: true,
            data: results,
            // For debugging
            _sql: sql 
        });

    } catch (error) {
        console.error('Error generating chart preview:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to generate chart preview.',
            error: error.message
        });
    }
});

module.exports = router;
