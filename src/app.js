require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const session = require('express-session');
const { PrismaSessionStore } = require('@quixo3/prisma-session-store');
const prisma = require('./config/db');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const csrf = require('csurf');
const { connectDB } = require('./config/db');
const i18next = require('i18next');
const i18nextMiddleware = require('i18next-http-middleware');

const enTranslations = require('./locales/en.json');
const idTranslations = require('./locales/id.json');
const msTranslations = require('./locales/ms.json');

i18next
    .use(i18nextMiddleware.LanguageDetector)
    .init({
        fallbackLng: 'id',
        resources: {
            en: { translation: enTranslations },
            id: { translation: idTranslations },
            ms: { translation: msTranslations }
        },
        detection: {
            order: ['querystring', 'cookie'],
            caches: ['cookie']
        }
    });


connectDB();

const app = express();

app.set('trust proxy', 1);


app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.locals.formatPteroSize = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return '';
    if (num >= 1024) {
        const gb = num / 1024;
        const formatted = Number.isInteger(gb)
            ? gb.toString()
            : parseFloat(gb.toFixed(2)).toString();
        return `${formatted} GB`;
    }
    return `${Math.round(num)} MB`;
};

// Static files
// Note: On Vercel, static files are routed via vercel.json, but for local dev we use express.static
app.use(express.static(path.join(__dirname, '../public')));

// Middlewares
app.use(helmet({
    contentSecurityPolicy: false, // You may want to configure this more strictly in production
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(i18nextMiddleware.handle(i18next));

// Session setup with Prisma (PostgreSQL)
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback_secret_key',
    resave: false,
    saveUninitialized: false,
    store: new PrismaSessionStore(
        prisma,
        {
            checkPeriod: 2 * 60 * 1000, // 2 mins
            dbRecordIdFunction: (session) => session.userId,
            dbRecordIdIsSessionId: true,
        }
    ),
    cookie: {
        secure: process.env.NODE_ENV === 'production', // true on vercel
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 // 1 day
    }
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 mins
    max: 100
});
app.use(limiter);

// Prevent Cloudflare/Browsers from caching HTML to avoid stale CSRF tokens
app.use((req, res, next) => {
    if (!req.path.startsWith('/api') && !req.path.includes('.')) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, private');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
    }
    next();
});

// CSRF Protection for Web Routes (Exclude API)
const csrfProtection = csrf({
    cookie: {
        key: '_csrf',
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
    }
});
app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
        return next();
    }
    csrfProtection(req, res, (err) => {
        if (err) return next(err);
        res.locals.csrfToken = req.csrfToken();
        next();
    });
});

// Global User Middleware
app.use(async (req, res, next) => {
    res.locals.user = null;
    res.locals.req = req;
    const sessionId = req.session?.user?.id || req.session?.userId;
    if (sessionId) {
        try {
            const user = await prisma.user.findUnique({ where: { id: sessionId } });
            if (user) {
                req.user = {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    role: user.role,
                    balance: user.balance
                };
                res.locals.user = req.user;
            }
        } catch (err) {
            console.error('Session User Error:', err);
        }
    }
    next();
});

const myCache = require('./utils/cache');

// Global Settings Middleware
app.use(async (req, res, next) => {
    try {
        let settingsList = myCache.get('app_settings');
        if (!settingsList) {
            settingsList = await prisma.settings.findMany();
            myCache.set('app_settings', settingsList, 180); // cache for 3 minutes
        }
        
        const settings = {};
        settingsList.forEach(s => settings[s.key] = s.value);

        // Defaults
        let webLogo = settings.web_logo || '/img/logo.svg';
        if (!webLogo || (typeof webLogo === 'string' && webLogo.includes('logo.png'))) {
            webLogo = '/img/logo.svg';
        }

        let webFavicon = settings.web_favicon || '/img/logo.svg';
        if (!webFavicon || (typeof webFavicon === 'string' && webFavicon.includes('logo.png'))) {
            webFavicon = '/img/logo.svg';
        }

        res.locals.settings = {
            web_name: settings.web_name || 'AutoOrderCloud',
            web_logo: webLogo,
            web_favicon: webFavicon,
            web_description: settings.web_description || 'Platform layanan Pterodactyl, SMM, Nokos OTP, dan App Premium otomatis.',
            web_keywords: settings.web_keywords || 'Pterodactyl, SMM Panel, Nokos OTP, Premium App, Auto Order',
            web_theme_color: settings.web_theme_color || '#2563eb',
            footer_copyright: settings.footer_copyright || '© 2026 AutoOrderCloud. All rights reserved.',
            web_domain: settings.web_domain || `${req.protocol}://${req.get('host')}`,
            ...settings
        };
        next();
    } catch (err) {
        next();
    }
});

// Route definitions
const authRoutes = require('./routes/authRoutes');
const publicRoutes = require('./routes/publicRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const adminRoutes = require('./routes/adminRoutes');
const checkoutRoutes = require('./routes/checkoutRoutes');
const apiRoutes = require('./routes/apiRoutes');
const nokosRoutes = require('./routes/nokosRoutes');

// Public Order Status API (for polling)
app.get('/api/order/:id', async (req, res) => {
    try {
        let order = await prisma.order.findUnique({ where: { id: req.params.id } });
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
        // If order is pending and paid via qris, check the gateway status real-time!
        if (order.status === 'pending' && order.paymentGateway === 'qris') {
            // Atomic state lock: change status from 'pending' to 'processing' to prevent concurrent polling request double-fulfillment
            const lockResult = await prisma.order.updateMany({
                where: {
                    id: req.params.id,
                    status: 'pending'
                },
                data: {
                    status: 'processing'
                }
            });

            if (lockResult.count === 0) {
                // Another concurrent request has already claimed the lock and is processing this order!
                const currentOrder = await prisma.order.findUnique({ where: { id: req.params.id } });
                return res.json({ success: true, order: currentOrder });
            }

            const pakasirService = require('./services/pakasirService');
            try {
                const gatewayStatus = await pakasirService.checkTransaction(order.orderId, order.amount);

                if (gatewayStatus === 'completed') {
                    // SPECIAL CHECK FOR TOPUP ORDER
                    if (order.productId === 'topup-balance-product') {
                        try {
                            if (order.userId) {
                                await prisma.user.update({
                                    where: { id: order.userId },
                                    data: { balance: { increment: order.amount } }
                                });
                            }

                            const updatedOrder = await prisma.order.update({
                                where: { id: order.id },
                                data: {
                                    status: 'completed'
                                }
                            });

                            return res.json({ success: true, order: updatedOrder });
                        } catch (topupErr) {
                            console.error('TOPUP FULFILLMENT ERROR:', topupErr);
                            // Revert status back to pending to allow retry
                            await prisma.order.update({
                                where: { id: order.id },
                                data: { status: 'pending' }
                            });
                            return res.status(500).json({ success: false, message: 'Gagal memproses topup.' });
                        }
                    }

                    // Fulfill Order
                    const product = await prisma.product.findUnique({
                        where: { id: order.productId },
                        include: { category: true, pteroNode: true }
                    });

                    if (product) {
                        const categoryType = product.category ? product.category.type : 'other';
                        let orderData = typeof order.data === 'object' && order.data !== null ? { ...order.data } : {};

                        try {
                            if (categoryType === 'pterodactyl') {
                                if (product.pteroNode) {
                                    const PterodactylService = require('./services/pterodactylService');
                                    const ptero = new PterodactylService(product.pteroNode.apiKey, product.pteroNode.domain);

                                    const user = order.userId ? await prisma.user.findUnique({ where: { id: order.userId } }) : null;
                                    const userEmail = user ? user.email : (order.guestContact || 'guest@cloud.com');
                                    const serverUsername = orderData.serverUsername || user?.username || 'user';
                                    const randomPassword = orderData.serverPassword || Math.random().toString(36).slice(-10);

                                    const pteroUser = await ptero.getOrCreateUser(serverUsername, userEmail, randomPassword);
                                    const limits = {
                                        memory: product.pteroMemory,
                                        swap: product.pteroSwap || 0,
                                        disk: product.pteroDisk,
                                        io: product.pteroIo || 500,
                                        cpu: product.pteroCpu,
                                        threads: product.pteroThreads || ""
                                    };
                                    const featureLimits = {
                                        databases: product.pteroDatabases || 0,
                                        backups: product.pteroBackups || 0,
                                        allocations: product.pteroAllocations || 1
                                    };

                                    const server = await ptero.createServer(
                                        pteroUser.id,
                                        `${product.name}-${order.orderId}`,
                                        limits,
                                        featureLimits,
                                        null,
                                        product.pteroEggId,
                                        product.pteroNestId,
                                        product.pteroLocationId
                                    );

                                    orderData.serverPassword = randomPassword;
                                    orderData.serverId = server.id;
                                    orderData.panelUrl = product.pteroNode.domain;
                                }
                            } else if (categoryType === 'premium_app' || categoryType === 'script') {
                                const currentAccounts = Array.isArray(product.accounts) ? product.accounts : [];
                                if (currentAccounts.length > 0) {
                                    const availableAccount = currentAccounts.find(a => a.status === 'available');
                                    if (availableAccount) {
                                        availableAccount.status = 'sold';
                                        const updatedAccounts = currentAccounts.map(a =>
                                            a.id === availableAccount.id || a._id === availableAccount._id ? availableAccount : a
                                        );
                                        const updatedStock = updatedAccounts.filter(a => a.status === 'available').length;

                                        if (categoryType === 'premium_app') {
                                            // Premium App is one-time use per product. Delete it immediately when sold.
                                            await prisma.product.delete({
                                                where: { id: product.id }
                                            });
                                        } else {
                                            await prisma.product.update({
                                                where: { id: product.id },
                                                data: {
                                                    accounts: updatedAccounts,
                                                    stock: updatedStock
                                                }
                                            });
                                        }

                                        orderData.accountEmail = availableAccount.email;
                                        orderData.accountPassword = availableAccount.password;
                                    }
                                } else {
                                    orderData.downloadUrl = product.downloadUrl;
                                    if (categoryType === 'premium_app') {
                                        await prisma.product.delete({
                                            where: { id: product.id }
                                        });
                                    }
                                }
                                orderData.instructions = product.digitalInstructions;
                            } else if (categoryType === 'smm' || order.productId === 'smm-panel-product') {
                                const smmService = require('./services/smmService');
                                const smmId = order.productId === 'smm-panel-product' ? orderData.smmServiceId : product.smmId;
                                const qty = order.productId === 'smm-panel-product' ? orderData.qty : (orderData.quantity || 1);
                                
                                const smmResult = await smmService.placeOrder(
                                    smmId,
                                    orderData.target,
                                    qty,
                                    product.smmType || 'default',
                                    orderData.customData || {}
                                );

                                if (!smmResult.status) {
                                    throw new Error('SMM Order Failed: ' + smmResult.msg);
                                }
                                orderData.smmOrderId = smmResult.data ? smmResult.data.id : null;
                                orderData.smmStatus = 'Processing';
                                if (order.productId === 'smm-panel-product') {
                                    orderData.instructions = `Pesanan SMM sedang diproses.\nTarget: ${orderData.target}\nJumlah: ${qty}`;
                                }
                            }

                            if (order.voucherCode) {
                                const voucher = await prisma.voucher.findUnique({
                                    where: { code: order.voucherCode.toUpperCase() }
                                });
                                if (voucher) {
                                    await prisma.voucher.update({
                                        where: { id: voucher.id },
                                        data: { usedCount: voucher.usedCount + 1 }
                                    });
                                }
                            }

                            order = await prisma.order.update({
                                where: { id: order.id },
                                data: {
                                    status: 'completed',
                                    data: orderData
                                }
                            });

                            const mailService = require('./services/mailService');
                            const userEmail = order.guestContact || (order.userId ? (await prisma.user.findUnique({ where: { id: order.userId } }))?.email : null);
                            if (userEmail && userEmail.includes('@')) {
                                await mailService.sendOrderEmail(userEmail, order);
                            }
                        } catch (fulfillErr) {
                            console.error('Fulfillment error during polling check:', fulfillErr);
                            // Revert status back to pending to allow retail/resubmission on next poll
                            await prisma.order.update({
                                where: { id: order.id },
                                data: { status: 'pending' }
                            });
                        }
                    }
                } else if (gatewayStatus === 'failed') {
                    order = await prisma.order.update({
                        where: { id: order.id },
                        data: { status: 'failed' }
                    });
                } else {
                    // Gateway status is still unpaid/pending: release lock back to pending
                    order = await prisma.order.update({
                        where: { id: order.id },
                        data: { status: 'pending' }
                    });
                }
            } catch (gatewayErr) {
                console.error('Gateway check failed, releasing lock:', gatewayErr);
                await prisma.order.update({
                    where: { id: order.id },
                    data: { status: 'pending' }
                });
            }
        }
        res.json({ success: true, order });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// HTTP Chat Endpoint (Fallback when WebSockets are unavailable/Vercel)
app.post('/api/chat', async (req, res) => {
    try {
        const { sessionId, content, role = 'user' } = req.body;
        if (!sessionId || !content) {
            return res.status(400).json({ success: false, error: 'Session ID and content are required' });
        }

        let chat = await prisma.chat.findUnique({ where: { sessionId } });
        if (!chat) {
            chat = await prisma.chat.create({ data: { sessionId, messages: [] } });
        }

        const author = req.body.author || (req.user ? { id: req.user.id, name: req.user.username || req.user.name || req.user.email } : null);
        const userMsg = { role, content, timestamp: new Date() };
        if (author) userMsg.author = author;
        const updatedMessages = [...(chat.messages || []), userMsg];

        chat = await prisma.chat.update({
            where: { sessionId },
            data: {
                messages: updatedMessages,
                lastActivity: new Date()
            }
        });

        // AI Response if no admin joined
        let aiMsg = null;
        if (chat.status === 'active' && role === 'user') {
            const history = (chat.messages || []).map(m => ({
                role: m.role === 'admin' ? 'model' : m.role,
                parts: [{ text: m.content }]
            }));

            const aiResponse = await aiService.getChatResponse(content, history.slice(0, -1));
            aiMsg = { role: 'model', content: aiResponse, timestamp: new Date() };

            const updatedMessagesAi = [...(chat.messages || []), aiMsg];
            chat = await prisma.chat.update({
                where: { sessionId },
                data: {
                    messages: updatedMessagesAi
                }
            });
        }

        // Notify Socket.io admin (if connected)
        try {
            io.emit('admin-update-chat');
        } catch (e) { }

        res.json({ success: true, messages: chat.messages });
    } catch (err) {
        console.error('HTTP Chat error:', err);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// HTTP Get Chat History Endpoint
app.get('/api/chat/history/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const chat = await prisma.chat.findUnique({ where: { sessionId } });
        res.json({ success: true, messages: chat ? chat.messages : [], status: chat ? chat.status : 'active' });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// HTTP Request Admin Endpoint
app.post('/api/chat/request-admin', async (req, res) => {
    try {
        const { sessionId } = req.body;
        await prisma.chat.update({
            where: { sessionId },
            data: { status: 'waiting_admin' }
        });
        try {
            io.to(sessionId).emit('status-update', 'waiting_admin');
            io.emit('admin-new-request', sessionId);
        } catch (e) { }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// HTTP Reset Chat Endpoint
app.post('/api/chat/reset/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        await prisma.chat.update({
            where: { sessionId },
            data: {
                messages: [],
                status: 'active',
                lastActivity: new Date()
            }
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Public Order Cancel API
app.post('/api/order/cancel/:id', async (req, res) => {
    try {
        const orderController = require('./controllers/orderController');
        await orderController.cancelOrder(req, res);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

app.use('/api/v1', apiRoutes); // Reseller API
app.use('/auth', authRoutes); // Web routes
app.use('/dashboard', dashboardRoutes); // Protected dashboard
app.use('/admin', adminRoutes); // Admin dashboard
app.use('/checkout', checkoutRoutes); // Checkout flow
app.use('/nokos', nokosRoutes);
app.use('/', publicRoutes);

// Error handling
app.use((err, req, res, next) => {
    if (err.code === 'EBADCSRFTOKEN') {
        console.error(`CSRF Validation Error: [${req.method}] ${req.path}`);
        if (req.xhr || req.headers.accept?.indexOf('json') > -1 || req.path.startsWith('/checkout') || req.path.startsWith('/nokos')) {
            return res.status(403).json({
                success: false,
                message: 'Sesi Anda telah kedaluwarsa atau token keamanan tidak valid. Silakan muat ulang halaman.'
            });
        }
        return res.status(403).send(
            '<h1>403 Forbidden: Invalid CSRF Token</h1>' +
            '<p>Token keamanan Anda telah kedaluwarsa atau tidak valid. Silakan kembali dan muat ulang halaman.</p>'
        );
    }
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

// If running locally (not via Vercel), start server
const http = require('http');
const { Server } = require('socket.io');
const server = http.createServer(app);
const io = new Server(server);

const aiService = require('./services/aiService');

io.on('connection', (socket) => {
    socket.on('join-chat', async ({ sessionId }) => {
        socket.join(sessionId);
        let chat = await prisma.chat.findUnique({ where: { sessionId } });
        if (chat) {
            socket.emit('chat-history', chat.messages);
        }
    });

    socket.on('send-message', async ({ sessionId, content, role = 'user' }) => {
        let chat = await prisma.chat.findUnique({ where: { sessionId } });
        if (!chat) {
            chat = await prisma.chat.create({ data: { sessionId, messages: [] } });
        }

        const userAuthor = arguments[0].author || null;
        const userMsg = { role, content, timestamp: new Date() };
        if (userAuthor) userMsg.author = userAuthor;
        const updatedMessages = [...(chat.messages || []), userMsg];

        chat = await prisma.chat.update({
            where: { sessionId },
            data: {
                messages: updatedMessages,
                lastActivity: new Date()
            }
        });

        // Broadcast to session (user & admin)
        io.to(sessionId).emit('new-message', userMsg);
        io.emit('admin-update-chat'); // Notify admins of new activity

        // AI Response if no admin joined
        if (chat.status === 'active' && role === 'user') {
            const history = (chat.messages || []).map(m => ({
                role: m.role === 'admin' ? 'model' : m.role,
                parts: [{ text: m.content }]
            }));

            const aiResponse = await aiService.getChatResponse(content, history.slice(0, -1));
            const aiMsg = { role: 'model', content: aiResponse, timestamp: new Date() };

            const updatedMessagesAi = [...(chat.messages || []), aiMsg];
            chat = await prisma.chat.update({
                where: { sessionId },
                data: {
                    messages: updatedMessagesAi
                }
            });
            io.to(sessionId).emit('new-message', aiMsg);
        }
    });

    socket.on('admin-join', async ({ sessionId }) => {
        await prisma.chat.update({
            where: { sessionId },
            data: { status: 'admin_joined' }
        });
        socket.join(sessionId);
        io.to(sessionId).emit('admin-joined-status', true);
    });

    socket.on('request-admin', async ({ sessionId }) => {
        await prisma.chat.update({
            where: { sessionId },
            data: { status: 'waiting_admin' }
        });
        io.to(sessionId).emit('status-update', 'waiting_admin');
        io.emit('admin-new-request', sessionId);
    });

    socket.on('reset-chat', async ({ sessionId }) => {
        await prisma.chat.update({
            where: { sessionId },
            data: {
                messages: [],
                status: 'active',
                lastActivity: new Date()
            }
        });
        socket.emit('chat-history', []);
    });
});

if (process.env.NODE_ENV !== 'production' && require.main === module) {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

module.exports = app;
