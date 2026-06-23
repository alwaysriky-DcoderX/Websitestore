const jwt = require('jsonwebtoken');
const prisma = require('../config/db');

// Protect routes
exports.protect = async (req, res, next) => {
    let token;

    // Check if token exists in headers or cookies
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies.token) {
        token = req.cookies.token;
    } else if (req.session && req.session.token) {
        token = req.session.token;
    }

    // Make sure token exists
    if (!token) {
        // If it's an API request, return JSON
        if (req.originalUrl.startsWith('/api')) {
            return res.status(401).json({ success: false, error: 'Not authorized to access this route' });
        }
        // Otherwise redirect to login
        return res.redirect('/auth/login');
    }

    try {
        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_jwt_secret');

        // Extract user from db
        req.user = await prisma.user.findUnique({ where: { id: decoded.id } });

        if (!req.user) {
            if (req.originalUrl.startsWith('/api')) {
                return res.status(401).json({ success: false, error: 'User no longer exists' });
            }
            return res.redirect('/auth/login');
        }

        // Update last activity in background
        prisma.user.update({ where: { id: req.user.id }, data: { lastActivity: new Date() } }).catch(err => console.error('Error updating activity:', err));

        next();
    } catch (err) {
        if (req.originalUrl.startsWith('/api')) {
            return res.status(401).json({ success: false, error: 'Not authorized to access this route' });
        }
        return res.redirect('/auth/login');
    }
};

// Grant access to specific roles
exports.authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            if (req.originalUrl.startsWith('/api')) {
                return res.status(403).json({ success: false, error: `User role ${req.user ? req.user.role : 'guest'} is not authorized to access this route` });
            }
            return res.status(403).send('Forbidden: Insufficient privileges');
        }
        next();
    };
};

// Reseller API Key Middleware
exports.apiProtect = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
        return res.status(401).json({ success: false, error: 'API key is missing' });
    }

    try {
        const user = await prisma.user.findFirst({
            where: {
                apiKey,
                role: { in: ['reseller', 'admin', 'owner'] }
            }
        });
        if (!user) {
            return res.status(401).json({ success: false, error: 'Invalid API key or insufficient privileges' });
        }
        req.user = user;
        
        // Update last activity in background
        prisma.user.update({ where: { id: req.user.id }, data: { lastActivity: new Date() } }).catch(err => console.error('Error updating API activity:', err));

        next();
    } catch (err) {
        return res.status(500).json({ success: false, error: 'Server error during API key validation' });
    }
};
