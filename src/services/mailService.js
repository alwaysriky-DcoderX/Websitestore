const nodemailer = require('nodemailer');
const prisma = require('../config/db');

class MailService {
    async getTransporter(type = 'notification') {
        const settingsList = await prisma.settings.findMany();
        const settings = {};
        settingsList.forEach(s => settings[s.key] = s.value);

        let host, port, user, pass;

        if (type === 'support') {
            host = settings.email_support_host;
            port = settings.email_support_port;
            user = settings.email_support_user;
            pass = settings.email_support_pass;
        } else if (type === 'otp') {
            host = settings.email_otp_host;
            port = settings.email_otp_port;
            user = settings.email_otp_user;
            pass = settings.email_otp_pass;
        } else {
            host = settings.email_smtp_host;
            port = settings.email_smtp_port;
            user = settings.email_smtp_user;
            pass = settings.email_smtp_pass;
        }

        if (!host || !user || !pass) {
            return null;
        }

        return nodemailer.createTransport({
            host: host,
            port: parseInt(port) || 465,
            secure: parseInt(port) === 465,
            auth: {
                user: user,
                pass: pass
            }
        });
    }

    async sendOrderEmail(to, order) {
        const transporter = await this.getTransporter();
        if (!transporter) {
            console.log('Email SMTP not configured, skipping email.');
            return;
        }

        const settingsList = await prisma.settings.findMany();
        const settings = {};
        settingsList.forEach(s => settings[s.key] = s.value);

        let detailsHtml = `
            <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                <h2 style="color: #2563eb;">Order Successful!</h2>
                <p>Hello, thank you for your purchase. Here are your order details:</p>
                <div style="background: #f9fafb; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <p><strong>Order ID:</strong> ${order.orderId}</p>
                    <p><strong>Product:</strong> ${order.productNameSnap}</p>
                    <p><strong>Amount:</strong> Rp ${order.amount.toLocaleString('id-ID')}</p>
                </div>
        `;

        if (order.data.serverUsername) {
            detailsHtml += `
                <div style="background: #f0f9ff; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #3b82f6;">
                    <h3 style="margin-top: 0;">Panel Credentials</h3>
                    <p><strong>Username:</strong> ${order.data.serverUsername}</p>
                    <p><strong>Password:</strong> ${order.data.serverPassword}</p>
                    <p><strong>Panel URL:</strong> <a href="${order.data.panelUrl}">${order.data.panelUrl}</a></p>
                </div>
            `;
        }

        if (order.data.downloadUrl) {
            detailsHtml += `
                <div style="margin: 20px 0;">
                    <a href="${order.data.downloadUrl}" style="background: #2563eb; color: white; padding: 12px 25px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Download Product</a>
                </div>
            `;
        }

        if (order.data.instructions) {
            detailsHtml += `<p><strong>Instructions:</strong><br/>${order.data.instructions}</p>`;
        }

        detailsHtml += `
                <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                <p style="font-size: 12px; color: #6b7280;">This is an automated message from ${settings.web_name || 'AutoOrder'}.</p>
            </div>
        `;

        try {
            await transporter.sendMail({
                from: `"${settings.email_from_name || 'AutoOrder Support'}" <${settings.email_smtp_user}>`,
                to: to,
                subject: `Order Successful - ${order.orderId}`,
                html: detailsHtml
            });
            console.log('Order email sent to:', to);
        } catch (err) {
            console.error('Error sending order email:', err);
        }
    }
}

module.exports = new MailService();
