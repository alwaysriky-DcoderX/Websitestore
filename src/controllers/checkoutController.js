const prisma = require('../config/db');
const PterodactylService = require('../services/pterodactylService');
const mailService = require('../services/mailService');

exports.validateVoucher = async (req, res) => {
    try {
        const { code, productId } = req.body;
        const voucher = await prisma.voucher.findUnique({
            where: { code: code.toUpperCase() }
        });
        
        if (!voucher || !voucher.isActive) {
            return res.json({ success: false, message: 'Invalid or inactive voucher code.' });
        }

        if (voucher.expiryDate && voucher.expiryDate < new Date()) {
            return res.json({ success: false, message: 'Voucher has expired.' });
        }

        if (voucher.maxUsage !== -1 && voucher.usedCount >= voucher.maxUsage) {
            return res.json({ success: false, message: 'Voucher usage limit reached.' });
        }

        const product = await prisma.product.findUnique({
            where: { id: productId },
            include: { category: true }
        });
        if (!product) return res.json({ success: false, message: 'Product not found.' });

        const productType = product.category ? product.category.type : 'other';
        const isApplicable = voucher.applicableTypes.includes('all') || voucher.applicableTypes.includes(productType);

        if (!isApplicable) {
            return res.json({ success: false, message: 'This voucher is not applicable for this type of product.' });
        }

        if (product.price < voucher.minPurchase) {
            return res.json({ success: false, message: `Minimum purchase for this voucher is Rp ${voucher.minPurchase.toLocaleString('id-ID')}` });
        }

        let discount = 0;
        if (voucher.discountType === 'percentage') {
            discount = Math.floor(product.price * (voucher.discountValue / 100));
        } else {
            discount = voucher.discountValue;
        }

        const newPrice = Math.max(0, product.price - discount);

        res.json({
            success: true,
            discount,
            newPrice
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.processCheckout = async (req, res) => {
    try {
        const { productId, serverUsername, serverPassword, guestContact, paymentMethod, voucherCode, target, quantity, customData } = req.body;
        
        const product = await prisma.product.findUnique({
            where: { id: productId },
            include: { pteroNode: true, category: true }
        });
        if (!product || !product.isActive) {
            return res.status(400).send('Product is unavailable.');
        }

        // Concurrency Check for Pterodactyl Username
        if (product.category && product.category.type === 'pterodactyl') {
            if (!serverUsername) {
                return res.render('public/checkout-error', { message: 'Username panel wajib diisi.' });
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
                return res.render('public/checkout-error', { message: 'Username panel ini sudah digunakan atau sedang dalam proses pembayaran.' });
            }

            // 2. Check Pterodactyl panel
            if (product.pteroNode) {
                const ptero = new PterodactylService(product.pteroNode.apiKey, product.pteroNode.domain);
                const existingPteroUser = await ptero.findUserByUsername(serverUsername);
                if (existingPteroUser) {
                    return res.render('public/checkout-error', { message: 'Username panel ini sudah terdaftar di Pterodactyl.' });
                }
            }
        }

        const gmSetting = await prisma.settings.findUnique({ where: { key: 'global_margin_percent' } });
        const globalMargin = gmSetting ? Number(gmSetting.value) : 10;
        let price = Math.ceil(product.price * (1 + (globalMargin / 100)));
        let discountApplied = 0;
        let voucherDoc = null;

        if (voucherCode) {
            voucherDoc = await prisma.voucher.findUnique({
                where: { code: voucherCode.toUpperCase() }
            });
            if (voucherDoc && voucherDoc.isActive) {
                const isExpired = voucherDoc.expiryDate && voucherDoc.expiryDate < new Date();
                const limitReached = voucherDoc.maxUsage !== -1 && voucherDoc.usedCount >= voucherDoc.maxUsage;
                
                const productWithCategory = await prisma.product.findUnique({
                    where: { id: productId },
                    include: { category: true }
                });
                const productType = productWithCategory.category ? productWithCategory.category.type : 'other';
                const isApplicable = voucherDoc.applicableTypes.includes('all') || voucherDoc.applicableTypes.includes(productType);

                if (!isExpired && !limitReached && isApplicable && price >= voucherDoc.minPurchase) {
                    if (voucherDoc.discountType === 'percentage') {
                        discountApplied = Math.floor(price * (voucherDoc.discountValue / 100));
                    } else {
                        discountApplied = voucherDoc.discountValue;
                    }
                    price = Math.max(0, price - discountApplied);
                }
            }
        }

        const orderId = 'ORD-' + Math.random().toString(36).substring(2, 10).toUpperCase();
        let orderData = { 
            serverUsername: serverUsername || '',
            serverPassword: serverPassword || null,
            target: target || null,
            quantity: quantity ? Number(quantity) : null,
            customData: customData || null
        };

        // Create pending order
        let newOrder = await prisma.order.create({
            data: {
                orderId,
                productId: product.id,
                productNameSnap: product.name,
                amount: price,
                discount: discountApplied,
                voucherCode: voucherCode || null,
                paymentGateway: paymentMethod || 'balance',
                guestContact: req.user ? null : guestContact,
                userId: req.user ? req.user.id : null,
                status: 'pending',
                data: orderData
            }
        });

        // 1. Payment via Balance
        if (paymentMethod === 'balance') {
            if (!req.user) {
                await prisma.order.delete({ where: { id: newOrder.id } });
                return res.status(401).send('Login required to pay with balance.');
            }
            
            try {
                // Deduct balance atomically and check sufficient funds in a single thread-safe query
                await prisma.user.update({
                    where: {
                        id: req.user.id,
                        balance: { gte: price }
                    },
                    data: {
                        balance: { decrement: price }
                    }
                });
            } catch (err) {
                await prisma.order.delete({ where: { id: newOrder.id } });
                return res.render('public/checkout-error', { message: 'Insufficient balance. Please topup first.' });
            }

            try {
                const productWithCategory = await prisma.product.findUnique({
                    where: { id: productId },
                    include: { category: true, pteroNode: true }
                });
                const categoryType = productWithCategory.category ? productWithCategory.category.type : 'other';

                if (categoryType === 'pterodactyl') {
                    if (!productWithCategory.pteroNode) {
                        throw new Error('Node configuration missing for this product.');
                    }

                    const ptero = new PterodactylService(
                        productWithCategory.pteroNode.apiKey,
                        productWithCategory.pteroNode.domain
                    );

                    const userEmail = req.user.email;
                    const randomPassword = serverPassword || Math.random().toString(36).slice(-10);
                    
                    // 1. Ensure user exists in Ptero
                    let pteroUser;
                    try {
                        pteroUser = await ptero.createUser(serverUsername, userEmail, randomPassword);
                    } catch (e) {
                        pteroUser = await ptero.findUserByUsername(serverUsername);
                        if (!pteroUser) throw new Error('User Pterodactyl tidak ditemukan dan gagal dibuat.');
                    }

                    const locationId = productWithCategory.pteroLocationId;
                    if (!locationId) throw new Error('Location ID configuration missing for this product.');

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
                } else if (categoryType === 'smm') {
                    const smmService = require('../services/smmService');
                    const smmResult = await smmService.placeOrder(
                        productWithCategory.smmId,
                        orderData.target,
                        orderData.quantity || 1,
                        productWithCategory.smmType,
                        orderData.customData || {}
                    );

                    if (!smmResult.status) {
                        throw new Error('SMM Order Failed: ' + smmResult.msg);
                    }
                    orderData.smmOrderId = smmResult.data ? smmResult.data.id : null;
                    orderData.smmStatus = 'Processing';
                }

                if (voucherDoc) {
                    await prisma.voucher.update({
                        where: { id: voucherDoc.id },
                        data: { usedCount: voucherDoc.usedCount + 1 }
                    });
                }

                newOrder = await prisma.order.update({
                    where: { id: newOrder.id },
                    data: {
                        status: 'completed',
                        data: orderData
                    }
                });

                // Send Email Notification
                const userEmail = req.user ? req.user.email : newOrder.guestContact;
                if (userEmail && userEmail.includes('@')) {
                    await mailService.sendOrderEmail(userEmail, newOrder);
                }

                return res.render('public/checkout-success', { order: newOrder, title: 'Order Success' });
            } catch (err) {
                console.error(err);
                // Refund atomically
                await prisma.user.update({
                    where: { id: req.user.id },
                    data: { balance: { increment: price } }
                });
                
                await prisma.order.update({
                    where: { id: newOrder.id },
                    data: { status: 'failed' }
                });
                return res.render('public/checkout-error', { message: 'Failed to process order: ' + err.message });
            }
        } 
        else if (paymentMethod === 'qris') {
            const pakasirService = require('../services/pakasirService');
            try {
                const transaction = await pakasirService.createTransaction(orderId, price);
                const qrString = transaction.payment?.qr_data || 
                                 transaction.qr_data || 
                                 transaction.data?.qr_data || 
                                 transaction.payment?.payment_number;
                
                if (!qrString) {
                    throw new Error('Data QRIS tidak diterima dari gateway.');
                }

                orderData.qrString = qrString;
                orderData.pakasirRaw = transaction;
                orderData.expiredAt = transaction.payment?.expired_at || transaction.expired_at;

                newOrder = await prisma.order.update({
                    where: { id: newOrder.id },
                    data: {
                        status: 'pending',
                        data: orderData
                    }
                });

                return res.render('public/checkout-qris', { 
                    order: newOrder, 
                    qrString: qrString,
                    title: 'Scan QRIS to Pay' 
                });
            } catch (pteroErr) {
                console.error(pteroErr);
                await prisma.order.delete({ where: { id: newOrder.id } });
                return res.render('public/checkout-error', { message: 'Gagal membuat QRIS: ' + pteroErr.message });
            }
        }

        res.status(400).send('Invalid payment method selected.');

    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error during checkout.');
    }
};

exports.getCheckoutSelection = async (req, res) => {
    try {
        const { productId, serverUsername, serverPassword, guestContact, voucherCode, target, quantity, customData } = req.body;
        const product = await prisma.product.findUnique({
            where: { id: productId },
            include: { pteroNode: true, category: true }
        });
        
        if (!product) return res.status(404).send('Product not found');

        // Concurrency Check for Pterodactyl Username
        if (product.category && product.category.type === 'pterodactyl') {
            if (!serverUsername) {
                return res.render('public/checkout-error', { message: 'Username panel wajib diisi.' });
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
                return res.render('public/checkout-error', { message: 'Username panel ini sudah digunakan atau sedang dalam proses pembayaran.' });
            }

            // 2. Check Pterodactyl panel
            if (product.pteroNode) {
                const ptero = new PterodactylService(product.pteroNode.apiKey, product.pteroNode.domain);
                const existingPteroUser = await ptero.findUserByUsername(serverUsername);
                if (existingPteroUser) {
                    return res.render('public/checkout-error', { message: 'Username panel ini sudah terdaftar di Pterodactyl.' });
                }
            }
        }

        res.render('public/checkout-selection', {
            title: 'Select Payment Method',
            product,
            serverUsername,
            serverPassword: serverPassword || '',
            guestContact,
            voucherCode: voucherCode || '',
            target: target || '',
            quantity: quantity || 1,
            customData: customData || '',
            user: req.user || null
        });
    } catch (err) {
        res.status(500).send('Server Error');
    }
};

exports.processTopup = async (req, res) => {
    try {
        const { amount } = req.body;
        if (!amount || amount < 1000) {
            return res.render('public/checkout-error', { message: 'Batas minimum top-up adalah Rp 1.000' });
        }

        // Ensure category and product exist dynamically in DB
        let depositCategory = await prisma.category.findUnique({
            where: { id: 'deposit-category' }
        });
        if (!depositCategory) {
            depositCategory = await prisma.category.create({
                data: {
                    id: 'deposit-category',
                    name: 'Deposit',
                    slug: 'deposit',
                    type: 'other',
                    isActive: false
                }
            });
        }
        let topupProduct = await prisma.product.findUnique({
            where: { id: 'topup-balance-product' }
        });
        if (!topupProduct) {
            topupProduct = await prisma.product.create({
                data: {
                    id: 'topup-balance-product',
                    name: 'Topup Balance',
                    categoryId: 'deposit-category',
                    price: 0,
                    isActive: false
                }
            });
        }

        const orderId = 'DEP-' + Math.random().toString(36).substring(2, 10).toUpperCase();
        const price = parseFloat(amount);

        const pakasirService = require('../services/pakasirService');
        try {
            const transaction = await pakasirService.createTransaction(orderId, price);
            const qrString = transaction.payment?.qr_data || 
                             transaction.qr_data || 
                             transaction.data?.qr_data || 
                             transaction.payment?.payment_number;
            
            if (!qrString) {
                throw new Error('Data QRIS tidak diterima dari gateway.');
            }

            const expiredAt = transaction.payment?.expired_at || transaction.expired_at;

            const newOrder = await prisma.order.create({
                data: {
                    orderId,
                    productId: 'topup-balance-product',
                    productNameSnap: 'Topup Saldo',
                    amount: price,
                    paymentGateway: 'qris',
                    userId: req.user.id,
                    status: 'pending',
                    data: {
                        qrString,
                        pakasirRaw: transaction,
                        expiredAt
                    }
                }
            });

            // Redirect to pay page
            return res.redirect(`/dashboard/orders/pay/${newOrder.id}`);
        } catch (gatewayErr) {
            console.error(gatewayErr);
            return res.render('public/checkout-error', { message: 'Gagal membuat QRIS: ' + gatewayErr.message });
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error during topup.');
    }
};
