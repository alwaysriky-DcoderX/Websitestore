const axios = require('axios');
const prisma = require('../config/db');

class TelegramService {
    async sendMessage(message) {
        try {
            const settingsList = await prisma.settings.findMany();
            const settings = {};
            settingsList.forEach(s => settings[s.key] = s.value);

            const botToken = settings.telegram_bot_token;
            const chatId = settings.telegram_channel_id;

            if (!botToken || !chatId) {
                console.log('Telegram bot token or channel ID not configured.');
                return;
            }

            const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
            await axios.post(url, {
                chat_id: chatId,
                text: message,
                parse_mode: 'HTML'
            });
        } catch (err) {
            console.error('Error sending Telegram message:', err.response ? err.response.data : err.message);
        }
    }

    async sendVoucherNotif(voucherCode, webDomain) {
        try {
            const settingsList = await prisma.settings.findMany();
            const settings = {};
            settingsList.forEach(s => settings[s.key] = s.value);

            let template = settings.telegram_notif_template || 'Halo guys! Ada voucher baru nih di @website\nKode: @voucher';
            const domain = webDomain || settings.web_domain || 'website.com';

            const message = template
                .replace(/@website/g, domain)
                .replace(/@voucher/g, `<b>${voucherCode}</b>`);

            await this.sendMessage(message);
        } catch (err) {
            console.error('Error sending Voucher notification:', err);
        }
    }
}

module.exports = new TelegramService();
