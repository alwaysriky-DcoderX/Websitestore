const prisma = require('../config/db');
const smscodeService = require('../services/smscodeService');
const myCache = require('../utils/cache');

exports.getHomePage = async (req, res) => {
    try {
        let cachedData = myCache.get('home_page_stats');

        if (!cachedData) {
            const totalUsers = await prisma.user.count();
            const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
            const activeUsers = await prisma.user.count({
                where: { lastActivity: { gte: fiveDaysAgo } }
            });
            const activeServers = await prisma.order.count({
                where: { 
                    status: 'completed',
                    product: {
                        category: {
                            type: 'pterodactyl'
                        }
                    }
                }
            });

            cachedData = {
                totalUsers,
                activeUsers,
                activeServers
            };
            myCache.set('home_page_stats', cachedData, 300); // cache for 5 mins
        }

        res.render('public/home', { 
            title: 'Auto Order SaaS | Hosting & Digital Products',
            stats: cachedData,
            user: req.session.user || null
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

exports.getTermsPage = async (req, res) => {
    try {
        res.render('public/terms', {
            title: 'Syarat & Ketentuan | ' + (res.locals.settings?.web_name || 'Cloud'),
            user: req.user || null
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};
