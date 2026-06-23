const prisma = require('../config/db');

exports.getAdminDashboard = async (req, res) => {
    try {
        const orderCount = await prisma.order.count();
        const productCount = await prisma.product.count();
        const userCount = await prisma.user.count();
        const nodeCount = await prisma.node.count();
        
        // Calculate total revenue from completed orders
        const completedOrders = await prisma.order.findMany({
            where: { status: 'completed' },
            select: { amount: true }
        });
        const revenue = completedOrders.reduce((sum, o) => sum + o.amount, 0);

        // Fetch recent 5 orders
        const recentOrders = await prisma.order.findMany({
            take: 5,
            orderBy: { createdAt: 'desc' },
            include: { 
                user: { select: { username: true, email: true } }, 
                product: { select: { name: true } } 
            }
        });

        res.render('admin/index', {
            title: 'Admin Dashboard',
            user: req.user,
            stats: {
                orderCount,
                productCount,
                userCount,
                nodeCount,
                revenue
            },
            recentOrders
        });
    } catch (err) {
        console.error('Admin Dashboard Error:', err);
        res.status(500).send('Server Error');
    }
};
