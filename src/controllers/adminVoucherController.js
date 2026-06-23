const prisma = require('../config/db');
const TelegramService = require('../services/telegramService');

exports.getVouchers = async (req, res) => {
    try {
        const vouchers = await prisma.voucher.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.render('admin/vouchers/index', {
            title: 'Manage Vouchers',
            user: req.user,
            vouchers
        });
    } catch (err) {
        res.status(500).send('Server Error');
    }
};

exports.createVoucher = async (req, res) => {
    try {
        const { code, discountType, discountValue, minPurchase, maxUsage, expiryDate, applicableTypes } = req.body;
        
        const types = Array.isArray(applicableTypes) ? applicableTypes : [applicableTypes || 'all'];

        const voucher = await prisma.voucher.create({
            data: {
                code: code.toUpperCase(),
                discountType,
                discountValue: Number(discountValue),
                minPurchase: Number(minPurchase) || 0,
                maxUsage: Number(maxUsage) || -1,
                expiryDate: expiryDate ? new Date(expiryDate) : null,
                applicableTypes: types
            }
        });

        // Send Telegram Notif
        const settingsList = await prisma.settings.findMany();
        const settings = {};
        settingsList.forEach(s => settings[s.key] = s.value);
        
        await TelegramService.sendVoucherNotif(voucher.code, settings.web_domain);

        res.redirect('/admin/vouchers');
    } catch (err) {
        console.error(err);
        res.status(400).send('Error creating voucher: ' + err.message);
    }
};

exports.deleteVoucher = async (req, res) => {
    try {
        await prisma.voucher.delete({
            where: { id: req.params.id }
        });
        res.redirect('/admin/vouchers');
    } catch (err) {
        res.status(500).send('Server Error');
    }
};
