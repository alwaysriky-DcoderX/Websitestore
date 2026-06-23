const prisma = require('../config/db');
const crypto = require('crypto');

exports.getProducts = async (req, res) => {
    try {
        const products = await prisma.product.findMany({
            where: {
                AND: [
                    { category: { type: { not: 'otp' } } },
                    { id: { not: 'topup-balance-product' } },
                    { id: { not: 'smm-order-product' } },
                    { id: { not: 'nokos-order-product' } }
                ]
            },
            include: { category: true },
            orderBy: { createdAt: 'desc' }
        });
        res.render('admin/products/index', {
            title: 'Manage Products',
            user: req.user,
            products
        });
    } catch (err) {
        res.status(500).send('Server Error');
    }
};

exports.getNewProductForm = async (req, res) => {
    try {
        const { type } = req.params;
        const categories = await prisma.category.findMany({
            where: { isActive: true }
        });
        const nodes = await prisma.node.findMany({
            where: { isActive: true }
        });
        
        let template = 'admin/products/new'; // fallback
        if (type === 'panel') template = 'admin/products/new-panel';
        if (type === 'app') template = 'admin/products/new-app';
        if (type === 'script') template = 'admin/products/new-script';
        if (type === 'smm') template = 'admin/products/new-smm';

        res.render(template, {
            title: `Add New ${type.charAt(0).toUpperCase() + type.slice(1)}`,
            user: req.user,
            categories,
            nodes,
            type
        });
    } catch (err) {
        res.status(500).send('Server Error');
    }
};

exports.createProduct = async (req, res) => {
    try {
        const productData = req.body;
        const parseIntegerField = (value) => {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? Math.round(parsed) : null;
        };
        
        // Safeguard for iconSVG (ensure it's a string, not an array from duplicate inputs)
        let finalIconSVG = '';
        if (Array.isArray(productData.iconSVG)) {
            finalIconSVG = productData.iconSVG.find(v => v.trim() !== '') || '';
        } else {
            finalIconSVG = productData.iconSVG || '';
        }
        
        let accounts = [];
        let stock = -1;
        
        if (productData.type === 'app' && productData.initialEmail && productData.initialPassword) {
            const stockId = crypto.randomUUID();
            accounts = [{
                id: stockId,
                _id: stockId,
                email: productData.initialEmail,
                password: productData.initialPassword,
                specialNotes: productData.initialNotes || '',
                status: 'available'
            }];
            stock = 1;
        }

        let parsedEnv = null;
        if (productData.pteroEnv) {
            try {
                parsedEnv = typeof productData.pteroEnv === 'string' ? JSON.parse(productData.pteroEnv) : productData.pteroEnv;
            } catch (e) {
                parsedEnv = productData.pteroEnv;
            }
        }

        await prisma.product.create({
            data: {
                name: productData.name,
                categoryId: productData.category || productData.categoryId,
                description: productData.description || '',
                price: Number(productData.price) || 0,
                isActive: productData.isActive === undefined ? true : (productData.isActive === 'true' || productData.isActive === true),
                image: productData.image || '/img/default-product.png',
                iconSVG: finalIconSVG,
                pteroNodeId: productData.pteroNode || productData.pteroNodeId || null,
                pteroLocationId: productData.pteroLocationId ? Number(productData.pteroLocationId) : null,
                pteroEggId: productData.pteroEggId ? Number(productData.pteroEggId) : null,
                pteroNestId: productData.pteroNestId ? Number(productData.pteroNestId) : null,
                pteroMemory: parseIntegerField(productData.pteroMemory),
                pteroDisk: parseIntegerField(productData.pteroDisk),
                pteroCpu: parseIntegerField(productData.pteroCpu),
                pteroThreads: productData.pteroThreads || '',
                pteroSwap: parseIntegerField(productData.pteroSwap) || 0,
                pteroIo: productData.pteroIo ? Number(productData.pteroIo) : 500,
                pteroDatabases: productData.pteroDatabases ? Number(productData.pteroDatabases) : 0,
                pteroBackups: productData.pteroBackups ? Number(productData.pteroBackups) : 0,
                pteroAllocations: productData.pteroAllocations ? Number(productData.pteroAllocations) : 1,
                pteroEnv: parsedEnv,
                otpServiceId: productData.otpServiceId || null,
                otpMargin: productData.otpMargin ? Number(productData.otpMargin) : null,
                smmId: productData.smmId ? Number(productData.smmId) : null,
                smmType: productData.smmType || null,
                downloadUrl: productData.downloadUrl || null,
                digitalInstructions: productData.digitalInstructions || null,
                appPlatform: productData.appPlatform || 'Other',
                stock: Number(stock),
                accounts: accounts.length > 0 ? accounts : null
            }
        });

        const myCache = require('../utils/cache');
        myCache.del('home_page_data');
        myCache.del('marketplace_data');

        res.redirect('/admin/products');
    } catch (err) {
        console.error(err);
        res.status(400).send('Error creating product. ' + err.message);
    }
};

exports.deleteProduct = async (req, res) => {
    try {
        await prisma.product.delete({
            where: { id: req.params.id }
        });

        const myCache = require('../utils/cache');
        myCache.del('home_page_data');
        myCache.del('marketplace_data');

        res.redirect('/admin/products');
    } catch (err) {
        res.status(500).send('Server Error');
    }
};

// ---- STOCK MANAGEMENT ----

exports.getStockPage = async (req, res) => {
    try {
        const product = await prisma.product.findUnique({
            where: { id: req.params.id }
        });
        if (!product) return res.status(404).send('Product not found');
        
        res.render('admin/products/stock', {
            title: 'Manage Stock',
            user: req.user,
            product
        });
    } catch (err) {
        res.status(500).send('Server Error');
    }
};

exports.addStock = async (req, res) => {
    try {
        const { email, password, specialNotes } = req.body;
        const product = await prisma.product.findUnique({
            where: { id: req.params.id }
        });
        if (!product) return res.status(404).send('Product not found');

        const stockId = crypto.randomUUID();
        const newAccount = {
            id: stockId,
            _id: stockId,
            email,
            password,
            specialNotes: specialNotes || '',
            status: 'available'
        };

        const currentAccounts = Array.isArray(product.accounts) ? product.accounts : [];
        const updatedAccounts = [...currentAccounts, newAccount];
        const updatedStock = updatedAccounts.filter(a => a.status === 'available').length;

        await prisma.product.update({
            where: { id: req.params.id },
            data: {
                accounts: updatedAccounts,
                stock: updatedStock
            }
        });

        const myCache = require('../utils/cache');
        myCache.del('home_page_data');
        myCache.del('marketplace_data');

        res.redirect(`/admin/products/stock/${product.id}`);
    } catch (err) {
        console.error(err);
        res.status(400).send('Error adding stock');
    }
};

exports.deleteStock = async (req, res) => {
    try {
        const product = await prisma.product.findUnique({
            where: { id: req.params.productId }
        });
        if (!product) return res.status(404).send('Product not found');

        const currentAccounts = Array.isArray(product.accounts) ? product.accounts : [];
        const updatedAccounts = currentAccounts.filter(a => a.id !== req.params.stockId && a._id !== req.params.stockId);
        const updatedStock = updatedAccounts.filter(a => a.status === 'available').length;

        await prisma.product.update({
            where: { id: req.params.productId },
            data: {
                accounts: updatedAccounts,
                stock: updatedStock
            }
        });

        res.redirect(`/admin/products/stock/${product.id}`);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

exports.getEditPanelForm = async (req, res) => {
    try {
        const product = await prisma.product.findUnique({
            where: { id: req.params.id },
            include: { category: true }
        });
        if (!product) return res.status(404).send('Product not found');

        const categories = await prisma.category.findMany({
            where: { isActive: true }
        });
        const nodes = await prisma.node.findMany({
            where: { isActive: true }
        });

        res.render('admin/products/edit-panel', {
            title: 'Edit Pterodactyl Product',
            user: req.user,
            product,
            categories,
            nodes
        });
    } catch (err) {
        res.status(500).send('Server Error');
    }
};

exports.updatePanelProduct = async (req, res) => {
    try {
        const productData = req.body;
        const parseIntegerField = (value) => {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? Math.round(parsed) : null;
        };

        let parsedEnv = null;
        if (productData.pteroEnv) {
            try {
                parsedEnv = typeof productData.pteroEnv === 'string' ? JSON.parse(productData.pteroEnv) : productData.pteroEnv;
            } catch (e) {
                parsedEnv = productData.pteroEnv;
            }
        }

        await prisma.product.update({
            where: { id: req.params.id },
            data: {
                name: productData.name,
                categoryId: productData.categoryId,
                description: productData.description || '',
                price: Number(productData.price) || 0,
                isActive: productData.isActive === undefined ? true : (productData.isActive === 'true' || productData.isActive === true),
                image: productData.image || '/img/default-product.png',
                pteroNodeId: productData.pteroNodeId || null,
                pteroLocationId: productData.pteroLocationId ? Number(productData.pteroLocationId) : null,
                pteroEggId: productData.pteroEggId ? Number(productData.pteroEggId) : null,
                pteroNestId: productData.pteroNestId ? Number(productData.pteroNestId) : null,
                pteroMemory: parseIntegerField(productData.pteroMemory),
                pteroDisk: parseIntegerField(productData.pteroDisk),
                pteroCpu: parseIntegerField(productData.pteroCpu),
                pteroThreads: productData.pteroThreads || '',
                pteroSwap: parseIntegerField(productData.pteroSwap) || 0,
                pteroIo: productData.pteroIo ? Number(productData.pteroIo) : 500,
                pteroDatabases: productData.pteroDatabases ? Number(productData.pteroDatabases) : 0,
                pteroBackups: productData.pteroBackups ? Number(productData.pteroBackups) : 0,
                pteroAllocations: productData.pteroAllocations ? Number(productData.pteroAllocations) : 1,
                pteroEnv: parsedEnv
            }
        });

        const myCache = require('../utils/cache');
        myCache.del('home_page_data');
        myCache.del('marketplace_data');

        res.redirect('/admin/products');
    } catch (err) {
        console.error(err);
        res.status(400).send('Error updating product. ' + err.message);
    }
};
