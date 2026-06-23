const prisma = require('../config/db');
const smscodeService = require('../services/smscodeService');

/**
 * Toggle ALL Nokos/OTP products on or off globally
 * POST /admin/nokos/toggle-all
 * body: { action: 'on' | 'off' }
 */
exports.toggleAllNokos = async (req, res) => {
    try {
        const { action } = req.body;
        const isActive = action === 'on';

        await prisma.product.updateMany({
            where: { otpServiceId: { not: null } },
            data: { isActive }
        });

        req.session.flash = {
            type: isActive ? 'success' : 'info',
            message: isActive
                ? '✅ Semua layanan Nokos OTP telah DIAKTIFKAN.'
                : '🔴 Semua layanan Nokos OTP telah DINONAKTIFKAN.'
        };
        res.redirect('/admin/nokos');
    } catch (err) {
        console.error('Error toggling all Nokos:', err);
        res.status(500).send('Server Error');
    }
};

/**
 * Get Admin Nokos Settings page
 */
exports.getNokosDashboard = async (req, res) => {
    try {
        // Fetch active balance from SMSCode
        const balance = await smscodeService.getBalance();

        // Fetch live services from SMSCode
        // Country 6 (Indonesia) is standard, but fetching all is better
        let services = await smscodeService.getServices(6);
        
        // Fallback popular services if API is slow or offline
        if (!services || services.length === 0) {
            services = [
                { id: 3, code: 'wa', name: 'WhatsApp' },
                { id: 1, code: 'tg', name: 'Telegram' },
                { id: 4, code: 'go', name: 'Google' },
                { id: 2, code: 'fb', name: 'Facebook' },
                { id: 7, code: 'ig', name: 'Instagram' },
                { id: 5, code: 'tk', name: 'TikTok' }
            ];
        }

        // Fetch all current OTP products in database
        const existingProducts = await prisma.product.findMany({
            where: {
                otpServiceId: { not: null }
            }
        });

        // Map existing products to services for easy EJS rendering
        const serviceSettings = services.map(service => {
            const matchedProduct = existingProducts.find(p => p.otpServiceId === String(service.id));
            return {
                id: service.id,
                code: service.code,
                name: service.name,
                isActive: matchedProduct ? matchedProduct.isActive : false,
                margin: matchedProduct ? (matchedProduct.otpMargin || 0) : 0,
                productId: matchedProduct ? matchedProduct.id : null
            };
        });

        res.render('admin/nokos', {
            title: 'Nokos / OTP Settings - Admin',
            user: req.user,
            services: serviceSettings,
            providerBalance: balance,
            req
        });
    } catch (err) {
        console.error('Error loading Admin Nokos settings:', err);
        res.status(500).send('Server Error');
    }
};

/**
 * Save / Update Nokos Settings
 */
exports.saveNokosSettings = async (req, res) => {
    try {
        const { serviceId, isActive, margin } = req.body;
        
        // Find or create Category of type "otp"
        let otpCategory = await prisma.category.findFirst({
            where: { type: 'otp' }
        });

        if (!otpCategory) {
            otpCategory = await prisma.category.create({
                data: {
                    name: 'Virtual Number / OTP',
                    slug: 'otp-virtual-number',
                    type: 'otp',
                    description: 'One-time-password virtual numbers from SMSCode.gg',
                    isActive: true,
                    order: 99
                }
            });
        }

        // Handle bulk or single updates
        // Since admin saves a form with all rows, we can iterate over the services list
        // req.body can be: { 'active_3': 'on', 'margin_3': '2000', 'name_3': 'WhatsApp' }
        
        // Let's parse all services from request body
        const updates = {};
        Object.keys(req.body).forEach(key => {
            if (key.startsWith('margin_')) {
                const id = key.replace('margin_', '');
                if (!updates[id]) updates[id] = { id };
                updates[id].margin = Number(req.body[key]) || 0;
            }
            if (key.startsWith('name_')) {
                const id = key.replace('name_', '');
                if (!updates[id]) updates[id] = { id };
                updates[id].name = req.body[key];
            }
            if (key.startsWith('active_')) {
                const id = key.replace('active_', '');
                if (!updates[id]) updates[id] = { id };
                updates[id].isActive = req.body[key] === 'on' || req.body[key] === 'true';
            }
        });

        // Ensure we mark inactive any service that was NOT toggled on
        // The HTML checkboxes only submit if they are checked
        // So we also look for all keys of the form margin_X, and if active_X is not set, we assume it is false
        Object.keys(req.body).forEach(key => {
            if (key.startsWith('margin_')) {
                const id = key.replace('margin_', '');
                if (updates[id] && updates[id].isActive === undefined) {
                    updates[id].isActive = false;
                }
            }
        });

        // Perform upserts in a database transaction or sequentially
        for (const id of Object.keys(updates)) {
            const item = updates[id];
            
            // Check if product exists for this service ID
            const existingProduct = await prisma.product.findFirst({
                where: { otpServiceId: String(item.id) }
            });

            if (existingProduct) {
                // Update
                await prisma.product.update({
                    where: { id: existingProduct.id },
                    data: {
                        name: `${item.name} OTP`,
                        isActive: item.isActive,
                        otpMargin: item.margin
                    }
                });
            } else if (item.isActive) {
                // Only create if toggled active
                await prisma.product.create({
                    data: {
                        name: `${item.name} OTP`,
                        categoryId: otpCategory.id,
                        description: `Single-use virtual phone number for ${item.name} OTP verification.`,
                        price: 0, // base price will be fetched dynamically + margin
                        isActive: true,
                        otpServiceId: String(item.id),
                        otpMargin: item.margin
                    }
                });
            }
        }

        req.session.flash = { type: 'success', message: 'Nokos / OTP settings updated successfully!' };
        res.redirect('/admin/nokos');
    } catch (err) {
        console.error('Error saving Nokos settings:', err);
        res.status(500).send('Server Error');
    }
};
