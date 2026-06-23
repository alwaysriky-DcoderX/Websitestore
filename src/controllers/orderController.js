const prisma = require('../config/db');
const PterodactylService = require('../services/pterodactylService');
const mailService = require('../services/mailService');
const pakasirService = require('../services/pakasirService');

exports.createDashboardOrder = async (req, res) => {
    try {
        const { productId, paymentMethod, voucherCode, serverUsername, serverPassword } = req.body;

        const product = await prisma.product.findUnique({
            where: { id: productId },
            include: { category: true, pteroNode: true }
        });
        if (!product || (!product.isActive && productId !== 'smm-panel-product')) {
            return res.status(400).json({ success: false, error: 'Produk tidak tersedia.' });
        }
        
        let price = product.price;
        
        // Dynamic Pricing for SMM Pseudo Product
        if (productId === 'smm-panel-product') {
            const { target, qty, smmServiceId } = req.body;
            if (!target || !qty || !smmServiceId) {
                return res.status(400).json({ success: false, error: 'Data SMM tidak lengkap.' });
            }
            const smmService = require('../services/smmService');
            const smmRes = await smmService.getServices();
            if (!smmRes || !smmRes.status) return res.status(500).json({ success: false, error: 'Layanan SMM sedang gangguan.' });
            const srv = smmRes.data.find(s => s.id == smmServiceId);
            if (!srv) return res.status(404).json({ success: false, error: 'Layanan SMM tidak ditemukan.' });
            if (qty < srv.min || qty > srv.max) return res.status(400).json({ success: false, error: 'Jumlah SMM tidak sesuai batas.' });
            
            const settings = await prisma.settings.findMany();
            const marginSetting = settings.find(s => s.key === 'smm_margin');
            const gmSetting = settings.find(s => s.key === 'global_margin_percent');
            const marginSmm = marginSetting && !isNaN(marginSetting.value) ? Number(marginSetting.value) : 0;
            const globalMargin = gmSetting && !isNaN(gmSetting.value) ? Number(gmSetting.value) : 10;
            
            const basePrice = (srv.price / 1000) * parseInt(qty);
            const rawPrice = basePrice + ((basePrice * marginSmm) / 100);
            price = Math.ceil(rawPrice * (1 + (globalMargin / 100)));
        }

        // Concurrency Check for Pterodactyl Username
        if (product.category && product.category.type === 'pterodactyl') {
            if (!serverUsername) {
                return res.status(400).json({ success: false, error: 'Username panel wajib diisi.' });
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
                return res.status(400).json({ success: false, error: 'Username panel ini sudah digunakan atau sedang dalam proses pembayaran.' });
            }

            // 2. Check Pterodactyl panel
            if (product.pteroNode) {
                const ptero = new PterodactylService(product.pteroNode.apiKey, product.pteroNode.domain);
                const existingPteroUser = await ptero.findUserByUsername(serverUsername);
                if (existingPteroUser) {
                    return res.status(400).json({ success: false, error: 'Username panel ini sudah terdaftar di Pterodactyl.' });
                }
            }
        }

        let discountApplied = 0;

        if (voucherCode) {
            const voucher = await prisma.voucher.findUnique({
                where: { code: voucherCode.toUpperCase() }
            });
            if (voucher && voucher.isActive) {
                const isExpired = voucher.expiryDate && voucher.expiryDate < new Date();
                const limitReached = voucher.maxUsage !== -1 && voucher.usedCount >= voucher.maxUsage;
                if (!isExpired && !limitReached && price >= voucher.minPurchase) {
                    if (voucher.discountType === 'percentage') {
                        discountApplied = Math.floor(price * (voucher.discountValue / 100));
                    } else {
                        discountApplied = voucher.discountValue;
                    }
                    price = Math.max(0, price - discountApplied);
                }
            }
        }

        const orderId = 'ORD-' + Math.random().toString(36).substring(2, 10).toUpperCase();
        let orderData = { 
            serverUsername: serverUsername || req.user.username,
            serverPassword: serverPassword || null
        };
        
        if (productId === 'smm-panel-product') {
            orderData.target = req.body.target;
            orderData.qty = parseInt(req.body.qty);
            orderData.smmServiceId = req.body.smmServiceId;
        }

        // Create initial pending order
        let newOrder = await prisma.order.create({
            data: {
                orderId,
                productId: product.id,
                productNameSnap: product.name,
                amount: price,
                discount: discountApplied,
                voucherCode: voucherCode || null,
                paymentGateway: paymentMethod,
                userId: req.user.id,
                status: 'pending',
                data: orderData
            }
        });

        // 1. Payment via Balance
        if (paymentMethod === 'balance') {
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
                // Delete the pending order since balance deduction failed
                await prisma.order.delete({ where: { id: newOrder.id } });
                return res.status(400).json({ success: false, error: 'Saldo tidak cukup.' });
            }

            try {
                const categoryType = product.category ? product.category.type : 'other';

                if (categoryType === 'pterodactyl') {
                    if (!product.pteroNode) throw new Error('Konfigurasi Node tidak ditemukan.');
                    
                    const ptero = new PterodactylService(product.pteroNode.apiKey, product.pteroNode.domain);
                    const randomPassword = serverPassword || Math.random().toString(36).slice(-10);
                    
                    // SMART USER MATCHING
                    const pteroUser = await ptero.getOrCreateUser(orderData.serverUsername, req.user.email, randomPassword);

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
                        `${product.name}-${orderId}`,
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
                            
                            await prisma.product.update({
                                where: { id: product.id },
                                data: {
                                    accounts: updatedAccounts,
                                    stock: updatedStock
                                }
                            });

                            orderData.accountEmail = availableAccount.email;
                            orderData.accountPassword = availableAccount.password;
                        } else {
                            throw new Error('Stok habis.');
                        }
                    } else {
                        orderData.downloadUrl = product.downloadUrl;
                    }
                    orderData.instructions = product.digitalInstructions;
                } else if (categoryType === 'smm' || productId === 'smm-panel-product') {
                    const smmService = require('../services/smmService');
                    
                    const smmResult = await smmService.placeOrder(
                        orderData.smmServiceId,
                        orderData.target,
                        orderData.qty,
                        'default',
                        {}
                    );

                    if (!smmResult.status) {
                        throw new Error('SMM Order Failed: ' + smmResult.msg);
                    }
                    orderData.smmOrderId = smmResult.data ? smmResult.data.id : null;
                    orderData.smmStatus = 'Processing';
                    orderData.instructions = `Pesanan SMM sedang diproses.\nTarget: ${orderData.target}\nJumlah: ${orderData.qty}`;
                }

                // Increment voucher count if voucher was used
                if (voucherCode) {
                    const voucher = await prisma.voucher.findUnique({
                        where: { code: voucherCode.toUpperCase() }
                    });
                    if (voucher) {
                        await prisma.voucher.update({
                            where: { id: voucher.id },
                            data: { usedCount: voucher.usedCount + 1 }
                        });
                    }
                }

                // Update order to completed
                newOrder = await prisma.order.update({
                    where: { id: newOrder.id },
                    data: {
                        status: 'completed',
                        data: orderData
                    }
                });

                if (req.user.email && req.user.email.includes('@')) {
                    await mailService.sendOrderEmail(req.user.email, newOrder);
                }

                return res.json({ success: true, orderId: newOrder.id });
            } catch (err) {
                console.error('PROVISIONING ERROR:', err);
                // Refund balance atomically
                await prisma.user.update({
                    where: { id: req.user.id },
                    data: { balance: { increment: price } }
                });
                // Update order to failed
                await prisma.order.update({
                    where: { id: newOrder.id },
                    data: { status: 'failed' }
                });
                return res.status(500).json({ success: false, error: 'Gagal memproses pesanan: ' + err.message });
            }
        } 
        // 2. Payment via QRIS
        else if (paymentMethod === 'qris') {
            try {
                const transaction = await pakasirService.createTransaction(orderId, price);
                console.log('PAKASIR FULL RESPONSE:', JSON.stringify(transaction, null, 2));
                
                const qrString = transaction.payment?.qr_data || 
                                 transaction.qr_data || 
                                 transaction.data?.qr_data || 
                                 transaction.payment?.payment_number;
                
                if (!qrString) {
                    console.error('QRIS DATA MISSING. Response was:', transaction);
                    throw new Error('Data QRIS tidak diterima dari gateway. Cek log server.');
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

                return res.json({ 
                    success: true, 
                    paymentUrl: '/dashboard/orders/pay/' + newOrder.id 
                });
            } catch (err) {
                console.error('QRIS ERROR:', err);
                // Delete initial order since QRIS creation failed
                await prisma.order.delete({ where: { id: newOrder.id } });
                return res.status(500).json({ success: false, error: 'Gagal membuat QRIS: ' + err.message });
            }
        }

        res.status(400).json({ success: false, error: 'Metode pembayaran tidak valid.' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Server Error' });
    }
};

exports.getDashboardOrder = async (req, res) => {
    try {
        const order = await prisma.order.findUnique({
            where: { id: req.params.id },
            include: { product: true }
        });
        if (!order || order.userId !== req.user.id) {
            return res.redirect('/dashboard/marketplace');
        }

        // Fetch realtime status for SMM orders
        let orderData = order.data || {};
        if (order.status === 'completed' && orderData.smmOrderId) {
            const smmService = require('../services/smmService');
            const smmRes = await smmService.checkStatus(orderData.smmOrderId);
            if (smmRes && smmRes.status && smmRes.data) {
                // Update status if it changed
                if (orderData.smmStatus !== smmRes.data.status) {
                    orderData.smmStatus = smmRes.data.status;
                    await prisma.order.update({
                        where: { id: order.id },
                        data: { data: orderData }
                    });
                }
            }
        }
        res.render('dashboard/order-details', {
            title: 'Order Details #' + order.orderId,
            user: req.user,
            order
        });
    } catch (err) {
        res.redirect('/dashboard/marketplace');
    }
};

exports.getDashboardOrderPay = async (req, res) => {
    try {
        const order = await prisma.order.findUnique({
            where: { id: req.params.id }
        });
        if (!order || order.userId !== req.user.id || order.status !== 'pending') {
            return res.redirect('/dashboard/marketplace');
        }

        const dataObj = order.data || {};

        res.render('dashboard/order-pay', {
            title: 'Pay Order #' + order.orderId,
            user: req.user,
            order,
            qrString: dataObj.qrString
        });
    } catch (err) {
        res.redirect('/dashboard/marketplace');
    }
};

exports.cancelOrder = async (req, res) => {
    try {
        const order = await prisma.order.findUnique({
            where: { id: req.params.id }
        });
        if (!order) {
            return res.status(404).json({ success: false, error: 'Pesanan tidak ditemukan.' });
        }

        // Security check
        if (order.userId) {
            const userId = order.userId;
            const currentUserId = req.user ? req.user.id : null;
            
            console.log(`[CANCEL DEBUG] OrderUID: ${userId}, SessionUID: ${currentUserId}`);
            
            if (currentUserId && userId !== currentUserId) {
                return res.status(403).json({ success: false, error: `Bukan pesanan Anda.` });
            }
        }

        if (order.status !== 'pending') {
            return res.status(400).json({ success: false, error: 'Hanya pesanan pending yang bisa dibatalkan.' });
        }

        // CANCEL AT PAKASIR
        if (order.paymentGateway === 'qris') {
            await pakasirService.cancelTransaction(order.orderId, order.amount);
        }

        await prisma.order.update({
            where: { id: order.id },
            data: { status: 'failed' }
        });

        res.json({ success: true, message: 'Pesanan berhasil dibatalkan.' });
    } catch (err) {
        console.error('CANCEL ORDER ERROR:', err);
        res.status(500).json({ success: false, error: 'Gagal membatalkan: ' + err.message });
    }
};

exports.syncSmmOrdersCron = async (req, res) => {
    try {
        const activeSmmOrders = await prisma.order.findMany({
            where: {
                status: 'completed'
            }
        });

        const pendingSmmOrders = activeSmmOrders.filter(o => {
            const d = o.data || {};
            if (!d.smmOrderId) return false;
            const s = (d.smmStatus || '').toLowerCase();
            return !['completed', 'canceled', 'partial', 'error'].includes(s);
        });

        const smmService = require('../services/smmService');
        const results = [];

        for (const order of pendingSmmOrders) {
            const data = order.data;
            const smmRes = await smmService.checkStatus(data.smmOrderId);
            
            if (smmRes && smmRes.status && smmRes.data) {
                const apiStatus = smmRes.data.status;
                const apiStatusLower = (apiStatus || '').toLowerCase();
                
                let refundAmount = 0;
                let finalStatus = 'completed';

                if (apiStatusLower === 'canceled' || apiStatusLower === 'error') {
                    refundAmount = order.amount;
                    finalStatus = 'failed';
                } else if (apiStatusLower === 'partial') {
                    const remains = parseInt(smmRes.data.remains) || 0;
                    const totalQty = parseInt(data.qty) || parseInt(data.quantity) || 1;
                    if (remains > 0 && totalQty > 0) {
                        const ratio = remains / totalQty;
                        refundAmount = Math.floor(order.amount * ratio);
                    }
                }

                if (refundAmount > 0 && order.userId) {
                    await prisma.user.update({
                        where: { id: order.userId },
                        data: { balance: { increment: refundAmount } }
                    });
                }

                data.smmStatus = apiStatus;
                data.smmRemains = smmRes.data.remains || "0";
                data.smmStartCount = smmRes.data.start_count || "0";
                if (refundAmount > 0) data.refundedAmount = refundAmount;

                await prisma.order.update({
                    where: { id: order.id },
                    data: {
                        status: finalStatus,
                        data: data
                    }
                });

                results.push({ orderId: order.orderId, oldStatus: order.data.smmStatus, newStatus: apiStatus, refunded: refundAmount });
            }
        }

        res.json({ success: true, processed: results.length, results });
    } catch (err) {
        console.error('CRON ERROR:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};
