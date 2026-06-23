const prisma = require('../config/db');
const smscodeService = require('../services/smscodeService');

/**
 * Render the virtual number checkout page
 */
exports.getCheckoutPage = async (req, res) => {
    try {
        const { productId } = req.params;
        
        const product = await prisma.product.findUnique({
            where: { id: productId },
            include: { category: true }
        });

        if (!product || !product.isActive || !product.otpServiceId) {
            req.session.flash = { type: 'error', message: 'Produk tidak ditemukan atau tidak aktif.' };
            return res.redirect('/dashboard');
        }

        // Get all countries & products for this platform from SMSCode
        const activeProducts = await smscodeService.getProducts(null, Number(product.otpServiceId));
        const countries = await smscodeService.getCountries();

        if (!activeProducts || activeProducts.length === 0) {
            req.session.flash = { type: 'error', message: 'Layanan ini sedang tidak tersedia di provider.' };
            return res.redirect('/dashboard');
        }

        // Map SMSCode products to standard country dropdown elements
        const mappedCountries = activeProducts
            .filter(ap => ap.active && ap.available > 0)
            .map(ap => {
                const countryDetail = countries ? countries.find(c => c.id === ap.country_id) : null;
                return {
                    id: ap.id, // SMSCode product_id
                    country_name: countryDetail ? countryDetail.name : ap.name,
                    country_emoji: countryDetail ? countryDetail.emoji : '🌐',
                    available: ap.available,
                    price: Math.ceil((Number(ap.price) + Number(product.otpMargin || 0)) * (1 + ((res.locals.settings.global_margin_percent ? Number(res.locals.settings.global_margin_percent) : 10) / 100)))
                };
            });

        if (mappedCountries.length === 0) {
            req.session.flash = { type: 'error', message: 'Stok nomor untuk layanan ini sedang kosong.' };
            return res.redirect('/dashboard');
        }

        res.render('public/nokos-checkout', {
            title: `Order ${product.name}`,
            user: req.user,
            service: {
                id: product.id,
                service_name: product.name,
                price: mappedCountries[0].price // dynamic baseline
            },
            countries: mappedCountries,
            nokosMargin: Number(product.otpMargin || 0)
        });
    } catch (err) {
        console.error('Error rendering user nokos checkout:', err);
        req.session.flash = { type: 'error', message: 'Terjadi kesalahan sistem.' };
        res.redirect('/dashboard');
    }
};

/**
 * Place a new virtual number order
 */
exports.createOrder = async (req, res) => {
    try {
        const { serviceId, countryId } = req.body;
        const userId = req.user.id;

        // 1. Fetch our local product
        const product = await prisma.product.findUnique({
            where: { id: serviceId }
        });

        if (!product || !product.isActive || !product.otpServiceId) {
            return res.json({ success: false, message: 'Produk tidak valid.' });
        }

        // 2. Fetch platform products from SMSCode to check the current base price
        const activeProducts = await smscodeService.getProducts(null, Number(product.otpServiceId));
        if (!activeProducts) {
            return res.json({ success: false, message: 'Gagal menghubungi provider virtual number.' });
        }

        const smscodeProduct = activeProducts.find(ap => ap.id === Number(countryId));
        if (!smscodeProduct || !smscodeProduct.active || smscodeProduct.available <= 0) {
            return res.json({ success: false, message: 'Nomor untuk negara pilihan ini sedang tidak tersedia.' });
        }

        // Fetch global margin setting
        const gmSetting = await prisma.settings.findUnique({ where: { key: 'global_margin_percent' } });
        const globalMargin = gmSetting && !isNaN(gmSetting.value) ? Number(gmSetting.value) : 10;
        
        // Calculate total price including global margin
        const rawTotalPrice = Number(smscodeProduct.price) + Number(product.otpMargin || 0);
        const totalPrice = Math.ceil(rawTotalPrice * (1 + (globalMargin / 100)));

        // 2.5 Check admin's SMSCode balance (server balance)
        const serverBalance = await smscodeService.getBalance();
        if (serverBalance < Number(smscodeProduct.price)) {
            return res.json({ success: false, message: 'Maaf, saat ini saldo server sedang kosong.' });
        }

        // 3. Atomically check user balance and deduct
        const freshUser = await prisma.user.findUnique({ where: { id: userId } });
        if (freshUser.balance < totalPrice) {
            return res.json({ success: false, message: 'Saldo Anda tidak mencukupi untuk melakukan transaksi ini.' });
        }

        // Lock & deduct balance
        await prisma.user.update({
            where: { id: userId },
            data: { balance: { decrement: totalPrice } }
        });

        // 4. Hit SMSCode to rent a number
        const orderRes = await smscodeService.createOrder(smscodeProduct.id);

        if (!orderRes || !orderRes.orders || orderRes.orders.length === 0) {
            // Refund balance immediately if provider failed
            await prisma.user.update({
                where: { id: userId },
                data: { balance: { increment: totalPrice } }
            });
            return res.json({ success: false, message: 'Gagal mendapatkan nomor dari provider, silakan coba lagi.' });
        }

        const providerOrder = orderRes.orders[0];

        // 5. Create transaction Order record
        const newOrder = await prisma.order.create({
            data: {
                orderId: 'OTP-' + providerOrder.id,
                userId: userId,
                productId: product.id,
                productNameSnap: `${product.name} (${smscodeProduct.name})`,
                amount: totalPrice,
                status: 'pending',
                paymentGateway: 'balance',
                data: {
                    providerOrderId: providerOrder.id,
                    phoneNumber: providerOrder.phone_number,
                    expiresAt: providerOrder.expires_at,
                    smscodeProductId: smscodeProduct.id,
                    basePrice: smscodeProduct.price,
                    margin: product.otpMargin
                }
            }
        });

        return res.json({
            success: true,
            orderId: newOrder.id,
            phoneNumber: providerOrder.phone_number
        });

    } catch (err) {
        console.error('Error creating nokos order:', err);
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan sistem.' });
    }
};

/**
 * Poll OTP order status
 */
exports.checkStatus = async (req, res) => {
    try {
        const { orderId } = req.params;

        const order = await prisma.order.findUnique({
            where: { id: orderId }
        });

        if (!order) {
            return res.json({ success: false, message: 'Order tidak ditemukan.' });
        }

        const orderData = typeof order.data === 'object' && order.data !== null ? { ...order.data } : {};

        // If order already completed, return OTP immediately
        if (order.status === 'completed') {
            return res.json({
                success: true,
                status: 'completed',
                otpCode: orderData.otpCode
            });
        }

        // If order already failed or cancelled, return failed
        if (order.status === 'failed' || order.status === 'cancelled') {
            return res.json({
                success: true,
                status: 'failed',
                message: 'Order dibatalkan atau kedaluwarsa.'
            });
        }

        // Poll SMSCode Provider
        const providerOrder = await smscodeService.getOrderStatus(orderData.providerOrderId);

        if (!providerOrder) {
            // Graceful return if network issue
            return res.json({ success: true, status: 'pending' });
        }

        const providerStatus = providerOrder.status; // 'ACTIVE', 'OTP_RECEIVED', 'CANCELED', 'EXPIRED'

        if (providerStatus === 'OTP_RECEIVED') {
            // OTP Received! Fulfill it.
            const updatedOrder = await prisma.order.update({
                where: { id: order.id },
                data: {
                    status: 'completed',
                    data: {
                        ...orderData,
                        otpCode: providerOrder.otp_code,
                        otpMessage: providerOrder.otp_message || ''
                    }
                }
            });

            // Mark completed in provider to release active line
            await smscodeService.finishOrder(orderData.providerOrderId).catch(e => {});

            return res.json({
                success: true,
                status: 'completed',
                otpCode: providerOrder.otp_code
            });

        } else if (providerStatus === 'CANCELED' || providerStatus === 'EXPIRED') {
            // Order failed/expired. Perform user balance refund!
            await prisma.user.update({
                where: { id: order.userId },
                data: { balance: { increment: order.amount } }
            });

            await prisma.order.update({
                where: { id: order.id },
                data: {
                    status: 'failed'
                }
            });

            return res.json({
                success: true,
                status: 'failed',
                message: 'Order expired or canceled by provider.'
            });
        }

        // Default state: still active and waiting
        return res.json({
            success: true,
            status: 'pending'
        });

    } catch (err) {
        console.error('Error checking nokos status:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

/**
 * Get dynamic countries list for a Nokos product
 */
exports.getCountriesList = async (req, res) => {
    try {
        const { productId } = req.params;
        const product = await prisma.product.findUnique({
            where: { id: productId }
        });
        if (!product || !product.otpServiceId) {
            return res.status(404).json({ success: false, message: 'Produk tidak ditemukan.' });
        }

        const activeProducts = await smscodeService.getProducts(null, Number(product.otpServiceId));
        const countries = await smscodeService.getCountries();

        if (!activeProducts || activeProducts.length === 0) {
            return res.json({ success: true, countries: [] });
        }

        const mappedCountries = activeProducts
            .filter(ap => ap.active && ap.available > 0)
            .map(ap => {
                const countryDetail = countries ? countries.find(c => c.id === ap.country_id) : null;
                return {
                    id: ap.id,
                    country_name: countryDetail ? countryDetail.name : ap.name,
                    country_emoji: countryDetail ? countryDetail.emoji : '🌐',
                    available: ap.available,
                    price: Math.ceil((Number(ap.price) + Number(product.otpMargin || 0)) * (1 + ((res.locals.settings.global_margin_percent ? Number(res.locals.settings.global_margin_percent) : 10) / 100)))
                };
            });

        return res.json({ success: true, countries: mappedCountries });
    } catch (err) {
        console.error('Error fetching dynamic Nokos countries:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

/**
 * Resume / get details for an active pending Nokos order
 */
exports.getActiveOrderDetails = async (req, res) => {
    try {
        const { orderId } = req.params;
        const userId = req.user.id;

        const order = await prisma.order.findFirst({
            where: {
                id: orderId,
                userId: userId
            },
            include: { product: true }
        });

        if (!order || !order.orderId.startsWith('OTP-')) {
            return res.status(404).json({ success: false, message: 'Order tidak ditemukan.' });
        }

        const orderData = typeof order.data === 'object' && order.data !== null ? order.data : {};

        return res.json({
            success: true,
            productId: order.productId,
            productName: order.productNameSnap,
            phoneNumber: orderData.phoneNumber,
            status: order.status,
            otpCode: orderData.otpCode
        });
    } catch (err) {
        console.error('Error fetching active order details:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

/**
 * Create a pending Nokos order and generate QRIS via Pakasir
 */
exports.createQrisOrder = async (req, res) => {
    try {
        const { serviceId, countryId } = req.body;
        const userId = req.user.id;

        // 1. Validate Product
        const product = await prisma.product.findUnique({
            where: { id: serviceId }
        });
        if (!product || !product.isActive || !product.otpServiceId) {
            return res.json({ success: false, message: 'Produk tidak valid.' });
        }

        // 2. Fetch platform products from SMSCode to check the current base price
        const activeProducts = await smscodeService.getProducts(null, Number(product.otpServiceId));
        if (!activeProducts) {
            return res.json({ success: false, message: 'Gagal menghubungi provider virtual number.' });
        }
        const smscodeProduct = activeProducts.find(ap => ap.id === Number(countryId));
        if (!smscodeProduct || !smscodeProduct.active || smscodeProduct.available <= 0) {
            return res.json({ success: false, message: 'Nomor untuk negara pilihan ini sedang tidak tersedia.' });
        }

        const totalPrice = Number(smscodeProduct.price) + Number(product.otpMargin || 0);

        // 3. Check Admin/Server SMSCode Balance
        const serverBalance = await smscodeService.getBalance();
        if (serverBalance < Number(smscodeProduct.price)) {
            return res.json({ success: false, message: 'Maaf, saat ini saldo server sedang kosong.' });
        }

        // 4. Generate local order tracker ID
        const localOrderId = 'NQRIS-' + Date.now() + '-' + Math.floor(Math.random() * 1000);

        // 5. Call Pakasir to create transaction
        const pakasirService = require('../services/pakasirService');
        const transaction = await pakasirService.createTransaction(localOrderId, totalPrice);
        const qrString = transaction.payment?.qr_data || transaction.qr_data || transaction.data?.qr_data || transaction.payment?.payment_number;

        if (!qrString) {
            throw new Error('Data QRIS tidak diterima dari gateway.');
        }

        // 6. Save order into database
        const newOrder = await prisma.order.create({
            data: {
                orderId: localOrderId,
                userId: userId,
                productId: product.id,
                productNameSnap: `${product.name} (${smscodeProduct.name})`,
                amount: totalPrice,
                status: 'pending_payment',
                paymentGateway: 'qris',
                data: {
                    smscodeProductId: smscodeProduct.id,
                    basePrice: smscodeProduct.price,
                    margin: product.otpMargin,
                    qrString: qrString,
                    pakasirRaw: transaction
                }
            }
        });

        return res.json({
            success: true,
            orderId: newOrder.id,
            qrString: qrString
        });

    } catch (err) {
        console.error('Error creating nokos qris order:', err);
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan saat membuat QRIS: ' + err.message });
    }
};

/**
 * Poll QRIS status and trigger SMSCode execution when paid
 */
exports.checkQrisStatus = async (req, res) => {
    try {
        const { orderId } = req.params;
        const userId = req.user.id;

        const order = await prisma.order.findFirst({
            where: {
                id: orderId,
                userId: userId,
                paymentGateway: 'qris'
            }
        });

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order tidak ditemukan.' });
        }

        // If it's already past payment
        if (order.status === 'completed' || order.status === 'pending') {
            const orderData = typeof order.data === 'object' && order.data !== null ? order.data : {};
            return res.json({
                success: true,
                status: 'completed',
                orderId: order.id,
                phoneNumber: orderData.phoneNumber
            });
        }

        if (order.status !== 'pending_payment') {
            return res.json({ success: false, status: 'failed', message: 'Order status: ' + order.status });
        }

        // Check Pakasir Status
        const pakasirService = require('../services/pakasirService');
        const qrisStatus = await pakasirService.checkTransaction(order.orderId, order.amount);

        if (qrisStatus === 'completed') {
            const orderData = typeof order.data === 'object' && order.data !== null ? order.data : {};
            const smscodeProductId = orderData.smscodeProductId;

            // Purchase from SMSCode since it is paid
            const orderRes = await smscodeService.createOrder(smscodeProductId);
            
            if (!orderRes || !orderRes.orders || orderRes.orders.length === 0) {
                // If the provider fails, refund the user to their balance!
                await prisma.user.update({
                    where: { id: userId },
                    data: { balance: { increment: order.amount } }
                });
                await prisma.order.update({
                    where: { id: order.id },
                    data: { status: 'failed' }
                });
                return res.json({ 
                    success: true, 
                    status: 'failed', 
                    message: 'Stok sedang kosong dari pusat. Saldo Rp ' + order.amount.toLocaleString('id-ID') + ' telah dikembalikan ke dompet akun Anda.' 
                });
            }

            // Successfully secured number
            const providerOrder = orderRes.orders[0];
            
            orderData.providerOrderId = providerOrder.id;
            orderData.phoneNumber = providerOrder.phone_number;
            orderData.expiresAt = providerOrder.expires_at;

            await prisma.order.update({
                where: { id: order.id },
                data: {
                    status: 'pending', // nokos tracking status waiting for OTP
                    orderId: 'OTP-' + providerOrder.id, // Replace tracker ID with SMSCode ID for standard polling compatibility
                    data: orderData
                }
            });

            return res.json({
                success: true,
                status: 'completed',
                orderId: order.id,
                phoneNumber: providerOrder.phone_number
            });
        } else if (qrisStatus === 'failed') {
            await prisma.order.update({
                where: { id: order.id },
                data: { status: 'failed' }
            });
            return res.json({ success: true, status: 'failed', message: 'Pembayaran QRIS kadaluwarsa/batal.' });
        }

        // still pending payment
        return res.json({ success: true, status: 'pending' });

    } catch (err) {
        console.error('Error checking nokos qris status:', err);
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan sistem.' });
    }
};
