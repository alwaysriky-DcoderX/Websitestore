const axios = require('axios');

const prisma = require('../config/db');

class PakasirService {
    constructor() {
        this.baseUrl = 'https://app.pakasir.com/api';
    }

    async getCredentials() {
        const settings = await prisma.settings.findMany({
            where: {
                key: {
                    in: ['pakasir_api_key', 'pakasir_slug']
                }
            }
        });
        const creds = {};
        settings.forEach(s => creds[s.key] = s.value);
        return {
            apiKey: creds.pakasir_api_key || process.env.PAKASIR_KEY || '',
            slug: creds.pakasir_slug || process.env.PAKASIR_SLUG || ''
        };
    }

    async createTransaction(orderId, amount) {
        try {
            const { apiKey, slug } = await this.getCredentials();
            const payload = {
                project: slug,
                order_id: orderId,
                amount: parseInt(amount),
                api_key: apiKey
            };
            const response = await axios.post(`${this.baseUrl}/transactioncreate/qris`, payload);
            return response.data;
        } catch (error) {
            console.error('Pakasir Create Error:', error.response?.data || error.message);
            throw new Error(error.response?.data?.message || 'Gagal membuat transaksi Pakasir');
        }
    }

    async cancelTransaction(orderId, amount) {
        try {
            const { apiKey, slug } = await this.getCredentials();
            const payload = {
                project: slug,
                order_id: orderId,
                amount: parseInt(amount),
                api_key: apiKey
            };
            const response = await axios.post(`${this.baseUrl}/transactioncancel`, payload);
            return response.data;
        } catch (error) {
            console.error('Pakasir Cancel Error:', error.message);
            return { status: 'error', message: error.message };
        }
    }

    async checkTransaction(orderId, amount) {
        try {
            const { apiKey, slug } = await this.getCredentials();
            const params = {
                project: slug,
                amount: parseInt(amount),
                order_id: orderId,
                api_key: apiKey
            };
            const response = await axios.get(`${this.baseUrl}/transactiondetail`, { params });
            const data = response.data;
            
            // Following Zanspiw logic: response structure usually has 'transaction'
            const transaction = data.transaction || data;
            
            if (transaction.status === 'success' || transaction.status === 'completed') {
                return 'completed';
            } else if (transaction.status === 'expired' || transaction.status === 'failed') {
                return 'failed';
            }
            return 'pending';
        } catch (error) {
            console.error('Pakasir Check Error:', error.message);
            return 'error';
        }
    }
}

module.exports = new PakasirService();
