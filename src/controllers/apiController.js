const prisma = require('../config/db');

// Get available products
exports.getProducts = async (req, res) => {
    try {
        const products = await prisma.product.findMany({
            where: { isActive: true }
        });
        
        // Add reseller margin logic
        const margin = req.user.marginReseller || 0;
        
        const productsWithMargin = products.map(p => {
            const prodObj = { ...p };
            delete prodObj.accounts;
            prodObj.resellerPrice = prodObj.price + margin;
            return prodObj;
        });

        res.status(200).json({
            success: true,
            count: productsWithMargin.length,
            data: productsWithMargin
        });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Server Error' });
    }
};

// Place an order via API
exports.placeOrder = async (req, res) => {
    try {
        const { productId, serverUsername, otpNumberId, paymentType = 'direct' } = req.body;
        
        const product = await prisma.product.findUnique({
            where: { id: productId },
            include: { category: true, pteroNode: true }
        });
        if (!product || !product.isActive) {
            return res.status(404).json({ success: false, error: 'Product not found or inactive' });
        }

        const productWithCategory = product; // Alias for backward compatibility below

        // Concurrency Check for Pterodactyl Username
        if (product.category && product.category.type === 'pterodactyl') {
            if (!serverUsername) {
                return res.status(400).json({ success: false, error: 'serverUsername is required for Pterodactyl products' });
            }

            // 1. Check pending orders in database
            const pendingOrders = await prisma.order.findMany({
                where: { status: 'pending' }
            });
            const duplicatePending = pendingOrders.find(o => {
                const d = o.data || {};
                return d.serverUsername && d.serverUsername.toLowerCase() === serverUsername.toLowerCase();
            });
            if (duplicatePending) {
                return res.status(400).json({ success: false, error: 'This Pterodactyl username is already reserved or in process of payment.' });
            }

            // 2. Check Pterodactyl panel
            if (product.pteroNode) {
                const PterodactylService = require('../services/pterodactylService');
                const ptero = new PterodactylService(product.pteroNode.apiKey, product.pteroNode.domain);
                const existingPteroUser = await ptero.findUserByUsername(serverUsername);
                if (existingPteroUser) {
                    return res.status(400).json({ success: false, error: 'This Pterodactyl username is already taken on the panel.' });
                }
            }
        }

        const margin = req.user.marginReseller || 0;
        const baseFinalPrice = product.price + margin;
        const gmSetting = await prisma.settings.findUnique({ where: { key: 'global_margin_percent' }});
        const globalMargin = gmSetting ? Number(gmSetting.value) : 10;
        const finalPrice = Math.ceil(baseFinalPrice * (1 + (globalMargin / 100)));
        const orderId = 'API-' + Math.random().toString(36).substring(2, 10).toUpperCase();

        if (paymentType === 'direct') {
            try {
                // Deduct balance atomically and check sufficient funds in a single thread-safe query
                await prisma.user.update({
                    where: {
                        id: req.user.id,
                        balance: { gte: finalPrice }
                    },
                    data: {
                        balance: { decrement: finalPrice }
                    }
                });
            } catch (err) {
                return res.status(400).json({ success: false, error: 'Insufficient balance for direct payment' });
            }

            const productWithCategory = await prisma.product.findUnique({
                where: { id: productId },
                include: { category: true, pteroNode: true }
            });
            const categoryType = productWithCategory.category ? productWithCategory.category.type : 'other';

            let orderData = { serverUsername, otpNumberId };

            let newOrder = await prisma.order.create({
                data: {
                    orderId,
                    productId: product.id,
                    productNameSnap: product.name,
                    amount: finalPrice,
                    paymentGateway: 'balance',
                    userId: req.user.id,
                    status: 'completed',
                    data: orderData
                }
            });

            try {
                if (categoryType === 'pterodactyl') {
                    if (!productWithCategory.pteroNode) throw new Error('Node configuration missing.');
                    
                    const PterodactylService = require('../services/pterodactylService');
                    const ptero = new PterodactylService(productWithCategory.pteroNode.apiKey, productWithCategory.pteroNode.domain);
                    
                    const userEmail = req.user.email;
                    const randomPassword = Math.random().toString(36).slice(-10);
                    
                    let pteroUser;
                    try {
                        pteroUser = await ptero.createUser(serverUsername, userEmail, randomPassword);
                    } catch (e) {
                        pteroUser = { id: serverUsername };
                    }

                    const locationId = productWithCategory.pteroLocationId;
                    if (!locationId) throw new Error('Location ID configuration missing.');

                    const limits = {
                        memory: productWithCategory.pteroMemory,
                        swap: productWithCategory.pteroSwap || 0,
                        disk: productWithCategory.pteroDisk,
                        io: productWithCategory.pteroIo || 500,
                        cpu: productWithCategory.pteroCpu
                    };
                    if (productWithCategory.pteroThreads && productWithCategory.pteroThreads.trim() !== "") {
                        limits.threads = productWithCategory.pteroThreads.trim();
                    }
                    const featureLimits = {
                        databases: productWithCategory.pteroDatabases || 0,
                        backups: productWithCategory.pteroBackups || 0,
                        allocations: productWithCategory.pteroAllocations || 1
                    };

                    const server = await ptero.createServer(
                        pteroUser.id,
                        `${productWithCategory.name}-${orderId}`,
                        limits,
                        featureLimits,
                        null,
                        productWithCategory.pteroEggId,
                        productWithCategory.pteroNestId,
                        locationId
                    );

                    orderData.serverPassword = randomPassword;
                    orderData.serverId = server.id;
                    orderData.panelUrl = productWithCategory.pteroNode.domain;
                } else if (categoryType === 'premium_app' || categoryType === 'script') {
                    const currentAccounts = Array.isArray(productWithCategory.accounts) ? productWithCategory.accounts : [];
                    if (currentAccounts.length > 0) {
                        const availableAccount = currentAccounts.find(a => a.status === 'available');
                        if (availableAccount) {
                            availableAccount.status = 'sold';
                            
                            const updatedAccounts = currentAccounts.map(a => 
                                a.id === availableAccount.id || a._id === availableAccount._id ? availableAccount : a
                            );
                            const updatedStock = updatedAccounts.filter(a => a.status === 'available').length;
                            
                            await prisma.product.update({
                                where: { id: productWithCategory.id },
                                data: {
                                    accounts: updatedAccounts,
                                    stock: updatedStock
                                }
                            });

                            orderData.accountEmail = availableAccount.email;
                            orderData.accountPassword = availableAccount.password;
                        } else {
                            throw new Error('Out of stock.');
                        }
                    } else {
                        orderData.downloadUrl = productWithCategory.downloadUrl;
                    }
                    orderData.instructions = productWithCategory.digitalInstructions;
                }

                // Update final order data
                newOrder = await prisma.order.update({
                    where: { id: newOrder.id },
                    data: { data: orderData }
                });

            } catch (provErr) {
                console.error(provErr);
                // Refund atomically
                await prisma.user.update({
                    where: { id: req.user.id },
                    data: { balance: { increment: finalPrice } }
                });
                
                await prisma.order.update({
                    where: { id: newOrder.id },
                    data: { status: 'failed' }
                });
                
                return res.status(500).json({ success: false, error: 'Provisioning failed: ' + provErr.message });
            }

            return res.status(201).json({
                success: true,
                message: 'Order placed successfully via balance.',
                data: newOrder
            });
        } else if (paymentType === 'qris') {
            const pakasirService = require('../services/pakasirService');
            
            try {
                // Generate QRIS using Pakasir
                const transaction = await pakasirService.createTransaction(orderId, finalPrice);
                
                const newOrder = await prisma.order.create({
                    data: {
                        orderId,
                        productId: product.id,
                        productNameSnap: product.name,
                        amount: finalPrice,
                        paymentGateway: 'qris',
                        userId: req.user.id,
                        status: 'pending',
                        data: { serverUsername, otpNumberId, qrString: transaction.qr_data, pakasirRaw: transaction }
                    }
                });

                return res.status(201).json({
                    success: true,
                    message: 'QRIS generated successfully. Order is pending payment.',
                    data: {
                        orderId: newOrder.orderId,
                        amount: newOrder.amount,
                        status: newOrder.status,
                        qris_data: transaction.qr_data
                    }
                });
            } catch (pteroErr) {
                return res.status(500).json({ success: false, error: 'Failed to generate QRIS: ' + pteroErr.message });
            }
        } else {
            return res.status(400).json({ success: false, error: 'Invalid paymentType. Use "direct" or "qris".' });
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Server Error' });
    }
};

// Create a deposit via API
exports.createDeposit = async (req, res) => {
    try {
        const { amount } = req.body;
        if (!amount || amount < 1000) {
            return res.status(400).json({ success: false, error: 'Minimum deposit is Rp 1,000' });
        }

        const depositId = 'DEP-' + Math.random().toString(36).substring(2, 10).toUpperCase();
        const pakasirService = require('../services/pakasirService');

        try {
            const transaction = await pakasirService.createTransaction(depositId, amount);
            
            res.status(201).json({
                success: true,
                message: 'Deposit QRIS generated successfully',
                data: {
                    depositId: depositId,
                    amount: parseInt(amount),
                    qris_data: transaction.qr_data
                }
            });
        } catch (err) {
            console.error(err);
            return res.status(500).json({ success: false, error: 'Failed to generate deposit QRIS' });
        }

    } catch (err) {
        res.status(500).json({ success: false, error: 'Server Error' });
    }
};


// Get user info and balance
exports.getAccountInfo = async (req, res) => {
    try {
        res.status(200).json({
            success: true,
            data: {
                username: req.user.username,
                role: req.user.role,
                balance: req.user.balance,
                margin: req.user.marginReseller
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Server Error' });
    }
};

// Get order details
exports.getOrderDetails = async (req, res) => {
    try {
        const orderId = req.params.id;
        // Only allow user to fetch their own orders
        const order = await prisma.order.findFirst({
            where: {
                orderId: orderId,
                userId: req.user.id
            }
        });
        
        if (!order) {
            return res.status(404).json({ success: false, error: 'Order not found' });
        }

        res.status(200).json({
            success: true,
            data: order
        });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Server Error' });
    }
};
