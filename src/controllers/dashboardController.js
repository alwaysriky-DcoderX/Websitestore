const prisma = require('../config/db');
const smscodeService = require('../services/smscodeService');
const smmService = require('../services/smmService');

exports.getDashboard = async (req, res) => {
    try {
        const orders = await prisma.order.findMany({
            where: { userId: req.user.id },
            orderBy: { createdAt: 'desc' }
        });
        
        // Fetch real-time status for active SMM orders
        await Promise.all(orders.map(async (order) => {
            let orderData = order.data || {};
            if (order.status === 'completed' && orderData.smmOrderId) {
                const sStatus = (orderData.smmStatus || '').toLowerCase();
                if (!['success', 'completed', 'error', 'canceled', 'partial'].includes(sStatus)) {
                    try {
                        const smmRes = await smmService.checkStatus(orderData.smmOrderId);
                        if (smmRes && smmRes.status && smmRes.data) {
                            if (orderData.smmStatus !== smmRes.data.status) {
                                orderData.smmStatus = smmRes.data.status;
                                await prisma.order.update({
                                    where: { id: order.id },
                                    data: { data: orderData }
                                });
                            }
                        }
                    } catch (e) {}
                }
            }
        }));
        
        // Fetch all categories
        const categories = await prisma.category.findMany({
            where: { isActive: true },
            orderBy: { order: 'asc' }
        });
        
        // Find products and filter them based on their category type
        const allProducts = await prisma.product.findMany({
            where: { isActive: true },
            include: { category: true, pteroNode: true }
        });

        // Resolve active dynamic prices for Nokos products
        await Promise.all(allProducts.map(async (product) => {
            if (product.otpServiceId) {
                try {
                    const activeProducts = await smscodeService.getProducts(null, Number(product.otpServiceId));
                    if (activeProducts && activeProducts.length > 0) {
                        const validProducts = activeProducts.filter(ap => ap.active && ap.available > 0);
                        if (validProducts.length > 0) {
                            const minBasePrice = Math.min(...validProducts.map(ap => Number(ap.price)));
                            product.price = minBasePrice + Number(product.otpMargin || 0);
                        } else {
                            const minBasePrice = Math.min(...activeProducts.map(ap => Number(ap.price)));
                            product.price = minBasePrice + Number(product.otpMargin || 0);
                        }
                    } else {
                        product.price = 5000 + Number(product.otpMargin || 0);
                    }
                } catch (e) {
                    product.price = 5000 + Number(product.otpMargin || 0);
                }
            }
        }));
        
        const globalMargin = res.locals.settings.global_margin_percent ? Number(res.locals.settings.global_margin_percent) : 10;
        allProducts.forEach(p => p.price = Math.ceil(p.price * (1 + (globalMargin / 100))));
        
        const pteroProducts = allProducts.filter(p => p.category && p.category.type === 'pterodactyl');
        const appProducts = allProducts.filter(p => p.category && p.category.type === 'premium_app');
        const codeProducts = allProducts.filter(p => p.category && p.category.type === 'script');
        const otherProducts = allProducts.filter(p => p.category && p.category.type === 'other');

        res.render('dashboard/index', {
            title: 'Dashboard - ' + (res.locals.settings.web_name || 'Cloud'),
            user: req.user,
            orders,
            pteroProducts,
            appProducts,
            codeProducts,
            otherProducts,
            categories
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

exports.getTopupPage = async (req, res) => {
    try {
        const orders = await prisma.order.findMany({
            where: { 
                userId: req.user.id,
                productId: 'topup-balance-product'
            },
            orderBy: { createdAt: 'desc' },
            include: { product: true }
        });

        res.render('dashboard/topup', {
            title: 'Topup Balance',
            user: req.user,
            orders
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

exports.getMarketplaceHub = async (req, res) => {
    try {
        const categories = await prisma.category.findMany({
            where: { isActive: true },
            orderBy: { order: 'asc' }
        });
        // We just render the hub view
        res.render('dashboard/marketplace-hub', {
            title: 'Marketplace',
            user: req.user,
            categories
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

exports.getSmmMarketplace = async (req, res) => {
    try {
        smmService.clearCache();
        const smmRes = await smmService.getServices();
        let smmServices = [];
        let smmError = '';
        if (smmRes && smmRes.status && smmRes.data) {
            smmServices = smmRes.data;
        } else {
            smmError = smmRes?.msg || 'Gagal memuat layanan SMM.';
        }
        res.render('dashboard/marketplace-smm', {
            title: 'SMM Panel',
            user: req.user,
            smmServices,
            smmError
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

exports.getOtpMarketplace = async (req, res) => {
    try {
        const categories = await prisma.category.findMany({
            where: { isActive: true, type: 'otp' },
            orderBy: { order: 'asc' }
        });
        const products = await prisma.product.findMany({
            where: { isActive: true, category: { type: 'otp' } },
            include: { category: true }
        });
        await Promise.all(products.map(async (product) => {
            if (product.otpServiceId) {
                try {
                    const activeProducts = await smscodeService.getProducts(null, Number(product.otpServiceId));
                    if (activeProducts && activeProducts.length > 0) {
                        const validProducts = activeProducts.filter(ap => ap.active && ap.available > 0);
                        if (validProducts.length > 0) {
                            const minBasePrice = Math.min(...validProducts.map(ap => Number(ap.price)));
                            product.price = minBasePrice + Number(product.otpMargin || 0);
                        } else {
                            const minBasePrice = Math.min(...activeProducts.map(ap => Number(ap.price)));
                            product.price = minBasePrice + Number(product.otpMargin || 0);
                        }
                    } else {
                        product.price = 5000 + Number(product.otpMargin || 0);
                    }
                } catch (e) {
                    product.price = 5000 + Number(product.otpMargin || 0);
                }
            }
        }));
        const globalMargin = res.locals.settings.global_margin_percent ? Number(res.locals.settings.global_margin_percent) : 10;
        products.forEach(p => p.price = Math.ceil(p.price * (1 + (globalMargin / 100))));
        
        res.render('dashboard/marketplace-otp', {
            title: 'Nokos / OTP',
            user: req.user,
            categories,
            products
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

exports.getPteroMarketplace = async (req, res) => {
    try {
        const type = req.query.type || 'pterodactyl';
        let title = 'Panel Pterodactyl';
        if (type === 'script') title = 'Script & Source Code';
        if (type === 'premium_app') title = 'Aplikasi Premium';

        const categories = await prisma.category.findMany({
            where: { isActive: true, type: type },
            orderBy: { order: 'asc' }
        });
        const products = await prisma.product.findMany({
            where: { isActive: true, category: { type: type } },
            include: { category: true, pteroNode: true },
            orderBy: { createdAt: 'desc' }
        });
        const globalMargin = res.locals.settings.global_margin_percent ? Number(res.locals.settings.global_margin_percent) : 10;
        products.forEach(p => p.price = Math.ceil(p.price * (1 + (globalMargin / 100))));
        
        res.render('dashboard/marketplace-regular', {
            title: title,
            user: req.user,
            categories,
            products,
            type: type
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

exports.getCheckoutPage = async (req, res) => {
    try {
        const product = await prisma.product.findUnique({
            where: { id: req.params.productId },
            include: { category: true }
        });
        if (!product) {
            return res.status(404).send('Product not found');
        }

        if (product.otpServiceId) {
            return res.redirect('/nokos/checkout/' + product.id);
        }

        const globalMargin = res.locals.settings.global_margin_percent ? Number(res.locals.settings.global_margin_percent) : 10;
        const basePrice = product.price;
        const adminFee = Math.ceil(basePrice * (globalMargin / 100));
        const totalPrice = basePrice + adminFee;
        product.price = totalPrice; // for button check in EJS
        
        res.render('dashboard/checkout', {
            title: 'Checkout - ' + product.name,
            user: req.user,
            product,
            basePrice,
            adminFee,
            totalPrice
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

exports.getSmmCheckoutPage = async (req, res) => {
    try {
        const { smmServiceId } = req.params;
        const target = req.query.target;
        const qty = parseInt(req.query.qty) || 0;
        
        const smmRes = await smmService.getServices();
        if (!smmRes || !smmRes.status || !smmRes.data) {
            return res.status(500).send('SMM Services currently unavailable');
        }
        
        const serviceData = smmRes.data.find(s => s.id == smmServiceId);
        if (!serviceData) {
            return res.status(404).send('SMM Service not found');
        }
        
        if (!target || qty < serviceData.min) {
            return res.status(400).send('Invalid target or quantity');
        }
        
        const marginSmm = res.locals.settings && res.locals.settings.smm_margin ? Number(res.locals.settings.smm_margin) : 0;
        const basePrice = (serviceData.price / 1000) * qty;
        const finalPriceBase = Math.ceil(basePrice + ((basePrice * marginSmm) / 100));
        const globalMargin = res.locals.settings.global_margin_percent ? Number(res.locals.settings.global_margin_percent) : 10;
        const finalPrice = Math.ceil(finalPriceBase * (1 + (globalMargin / 100)));
        
        let smmProduct = await prisma.product.findUnique({ where: { id: 'smm-panel-product' }, include: { category: true } });
        if (!smmProduct) {
            let smmCat = await prisma.category.findFirst({ where: { type: 'smm' } });
            if (!smmCat) smmCat = await prisma.category.create({ data: { name: 'SMM Panel', slug: 'smm-panel', type: 'smm', isActive: true } });
            smmProduct = await prisma.product.create({
                data: {
                    id: 'smm-panel-product',
                    name: 'SMM Order',
                    price: 0,
                    categoryId: smmCat.id,
                    isActive: false
                },
                include: { category: true }
            });
        }
        
        // Override for display
        smmProduct.name = `[SMM] ${serviceData.name} (${qty}x)`;
        const adminFee = finalPrice - finalPriceBase;
        smmProduct.price = finalPrice; // for button check
        smmProduct.description = `Target: ${target}\nKategori: ${serviceData.category}`;
        smmProduct.isSmm = true;
        smmProduct.smmServiceId = serviceData.id;
        smmProduct.smmTarget = target;
        smmProduct.smmQty = qty;

        res.render('dashboard/checkout', {
            title: 'Checkout - SMM Panel',
            user: req.user,
            product: smmProduct,
            basePrice: finalPriceBase,
            adminFee: adminFee,
            totalPrice: finalPrice
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};
