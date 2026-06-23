const prisma = require('../config/db');
const myCache = require('../utils/cache');

exports.getSettings = async (req, res) => {
    try {
        const settingsList = await prisma.settings.findMany();
        const settings = {};
        settingsList.forEach(s => settings[s.key] = s.value);

        // Defaults if not exists
        if (!settings.web_name) settings.web_name = 'AutoOrderCloud';
        if (!settings.web_logo) settings.web_logo = '/img/logo.png';
        if (!settings.web_favicon) settings.web_favicon = '/favicon.ico';
        if (!settings.web_description) settings.web_description = 'Solusi otomatisasi server, nomor OTP, dan aplikasi premium terbaik untuk kebutuhan digital Anda.';
        if (!settings.footer_copyright) settings.footer_copyright = '© 2026 AutoOrderCloud. All rights reserved.';
        if (!settings.web_domain) settings.web_domain = req.protocol + '://' + req.get('host');
        if (!settings.reseller_upgrade_price) settings.reseller_upgrade_price = '30000';
        if (!settings.seo_description) settings.seo_description = 'Auto Provisioning Platform for Digital Products';
        if (!settings.seo_keywords) settings.seo_keywords = 'pterodactyl, auto order, digital product, hosting';
        if (!settings.gtag_id) settings.gtag_id = '';
        if (!settings.telegram_bot_token) settings.telegram_bot_token = '';
        if (!settings.telegram_channel_id) settings.telegram_channel_id = '';
        if (!settings.telegram_notif_template) settings.telegram_notif_template = 'Halo guys! Ada voucher baru nih di @website\nKode: @voucher\nBuruan sikat sebelum limit abis!';
        if (!settings.email_smtp_host) settings.email_smtp_host = '';
        if (!settings.email_smtp_port) settings.email_smtp_port = '465';
        if (!settings.email_smtp_user) settings.email_smtp_user = '';
        if (!settings.email_smtp_pass) settings.email_smtp_pass = '';
        if (!settings.email_from_name) settings.email_from_name = 'AutoOrder Support';
        
        if (!settings.email_support_host) settings.email_support_host = '';
        if (!settings.email_support_port) settings.email_support_port = '465';
        if (!settings.email_support_user) settings.email_support_user = '';
        if (!settings.email_support_pass) settings.email_support_pass = '';
        if (!settings.email_support_from_name) settings.email_support_from_name = 'AutoOrder Helpdesk';
        
        if (!settings.email_otp_host) settings.email_otp_host = '';
        if (!settings.email_otp_port) settings.email_otp_port = '465';
        if (!settings.email_otp_user) settings.email_otp_user = '';
        if (!settings.email_otp_pass) settings.email_otp_pass = '';
        if (!settings.email_otp_from_name) settings.email_otp_from_name = 'AutoOrder Security';

        if (!settings.gemini_api_key) settings.gemini_api_key = '';
        if (!settings.pakasir_api_key) settings.pakasir_api_key = '';
        if (!settings.pakasir_slug) settings.pakasir_slug = '';
        if (!settings.smscode_api_key) settings.smscode_api_key = '';
        if (!settings.smm_api_id) settings.smm_api_id = '';
        if (!settings.smm_api_key) settings.smm_api_key = '';
        if (!settings.global_margin_percent) settings.global_margin_percent = '10';

        res.render('admin/settings/index', {
            title: 'System Settings',
            user: req.user,
            settings
        });
    } catch (err) {
        res.status(500).send('Server Error');
    }
};

exports.updateSettings = async (req, res) => {
    try {
        const data = req.body;
        
        for (const [key, value] of Object.entries(data)) {
            if (key === '_csrf') continue;
            await prisma.settings.upsert({
                where: { key },
                update: { value },
                create: { key, value }
            });
        }

        myCache.del('app_settings');

        res.redirect('/admin/settings?success=true');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};
