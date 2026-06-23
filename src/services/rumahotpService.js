const axios = require('axios');
const prisma = require('../config/db');

class RumahOTPService {
    constructor() {
        this.baseUrlv1 = "https://www.rumahotp.io/api/v1";
        this.baseUrlv2 = "https://www.rumahotp.io/api/v2";
    }

    async getApiKey() {
        const setting = await prisma.settings.findUnique({ where: { key: 'rumahotp_api_key' } });
        return setting?.value || process.env.RUMAHOTP_API_KEY || '';
    }

    async getHeaders() {
        const apiKey = await this.getApiKey();
        return {
            "Content-Type": "application/json",
            'x-apikey': apiKey,
            'Accept': 'application/json'
        };
    }

    async getService() {
        try {
            const headers = await this.getHeaders();
            const res = await axios.get(`${this.baseUrlv2}/services`, { headers });
            // Filter popular services for display if needed, or return all
            const filtered = res.data.data.filter(item => ["WhatsApp", "Telegram", "Instagram"].includes(item.service_name));
            return filtered;
        } catch (error) {
            return null;
        }
    }

    async getCountry(serviceId) {
        try {
            const headers = await this.getHeaders();
            const res = await axios.get(`${this.baseUrlv2}/countries?service_id=${serviceId}`, { headers });
            return res.data.data;
        } catch (error) {
            return null;
        }
    }

    async createOrder(numberId, providerId, operatorId) {
        try {
            const headers = await this.getHeaders();
            const res = await axios.get(`${this.baseUrlv2}/orders?number_id=${numberId}&provider_id=${providerId}&operator_id=${operatorId}`, { headers });
            return res.data.data; // { order_id, phone_number, price, etc }
        } catch (error) {
            console.error('RumahOTP createOrder error:', error.message);
            return null;
        }
    }

    async setOrderStatus(orderId, status) {
        try {
            const headers = await this.getHeaders();
            const res = await axios.get(`${this.baseUrlv1}/orders/set_status?order_id=${orderId}&status=${status}`, { headers });
            return res.data.data; 
        } catch (error) {
            return null;
        }
    }

    async getOrderStatus(orderId) {
        try {
            const headers = await this.getHeaders();
            const res = await axios.get(`${this.baseUrlv1}/orders/get_status?order_id=${orderId}`, { headers });
            return res.data.data; // Contains 'sms' field with OTP code
        } catch (error) {
            return null;
        }
    }
}

module.exports = new RumahOTPService();
