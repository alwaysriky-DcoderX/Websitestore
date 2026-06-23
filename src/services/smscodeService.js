const axios = require('axios');
const prisma = require('../config/db');

class SMSCodeService {
    constructor() {
        this.baseUrl = "https://api.smscode.gg/v1";
    }

    async getApiKey() {
        const setting = await prisma.settings.findUnique({ where: { key: 'smscode_api_key' } });
        return setting?.value || process.env.SMSCODE_API_KEY || '';
    }

    async getHeaders() {
        const apiKey = await this.getApiKey();
        return {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
            "Accept": "application/json"
        };
    }

    /**
     * Get all active countries
     */
    async getCountries() {
        try {
            const headers = await this.getHeaders();
            const res = await axios.get(`${this.baseUrl}/catalog/countries`, { headers });
            if (res.data && res.data.success) {
                return res.data.data;
            }
            return null;
        } catch (error) {
            console.error('SMSCode getCountries error:', error.message);
            return null;
        }
    }

    /**
     * Get all available services / platforms.
     * Optionally filter by countryId.
     */
    async getServices(countryId = null) {
        try {
            const url = countryId 
                ? `${this.baseUrl}/catalog/services?country_id=${countryId}` 
                : `${this.baseUrl}/catalog/services`;
            const headers = await this.getHeaders();
            const res = await axios.get(url, { headers });
            if (res.data && res.data.success) {
                return res.data.data;
            }
            return null;
        } catch (error) {
            console.error('SMSCode getServices error:', error.message);
            return null;
        }
    }

    /**
     * Get available products. Filter by countryId and platformId.
     */
    async getProducts(countryId = null, platformId = null) {
        try {
            const params = new URLSearchParams();
            if (countryId) params.append('country_id', countryId);
            if (platformId) params.append('platform_id', platformId);
            params.append('limit', '100'); // Get up to 100 products for convenience

            const headers = await this.getHeaders();
            const res = await axios.get(`${this.baseUrl}/catalog/products?${params.toString()}`, { 
                headers 
            });
            if (res.data && res.data.success) {
                return res.data.data;
            }
            return null;
        } catch (error) {
            console.error('SMSCode getProducts error:', error.message);
            return null;
        }
    }

    /**
     * Create an order for a virtual number.
     * Automatically returns the ordered number information.
     */
    async createOrder(productId) {
        try {
            // Generate a random unique string for idempotency
            const idempotencyKey = 'IDEM-' + Math.random().toString(36).substring(2, 15).toUpperCase();
            
            const headers = await this.getHeaders();
            const res = await axios.post(`${this.baseUrl}/orders/create`, 
                { product_id: Number(productId), quantity: 1 }, 
                { 
                    headers: {
                        ...headers,
                        'Idempotency-Key': idempotencyKey
                    }
                }
            );
            if (res.data && res.data.success) {
                return res.data.data; // contains { orders: [ { id, status, phone_number, etc } ], failed_count: 0 }
            }
            return null;
        } catch (error) {
            console.error('SMSCode createOrder error:', error.response?.data || error.message);
            return null;
        }
    }

    /**
     * Get order details by ID
     */
    async getOrderStatus(orderId) {
        try {
            const headers = await this.getHeaders();
            const res = await axios.get(`${this.baseUrl}/orders/${orderId}`, { headers });
            if (res.data && res.data.success) {
                return res.data.data; // contains { id, status, phone_number, otp_code, etc }
            }
            return null;
        } catch (error) {
            console.error('SMSCode getOrderStatus error:', error.message);
            return null;
        }
    }

    /**
     * Cancel an active order and refund to balance.
     */
    async cancelOrder(orderId) {
        try {
            const headers = await this.getHeaders();
            const res = await axios.post(`${this.baseUrl}/orders/cancel`, 
                { id: Number(orderId) }, 
                { headers }
            );
            if (res.data && res.data.success) {
                return res.data.data;
            }
            return null;
        } catch (error) {
            console.error('SMSCode cancelOrder error:', error.response?.data || error.message);
            return null;
        }
    }

    /**
     * Confirm/Finish an order. Releases the number immediately.
     */
    async finishOrder(orderId) {
        try {
            const headers = await this.getHeaders();
            const res = await axios.post(`${this.baseUrl}/orders/finish`, 
                { id: Number(orderId) }, 
                { headers }
            );
            if (res.data && res.data.success) {
                return res.data.data;
            }
            return null;
        } catch (error) {
            console.error('SMSCode finishOrder error:', error.response?.data || error.message);
            return null;
        }
    }

    /**
     * Check authenticated balance (IDR)
     */
    async getBalance() {
        try {
            const headers = await this.getHeaders();
            const res = await axios.get(`${this.baseUrl}/balance`, { headers });
            if (res.data && res.data.success) {
                return res.data.data.balance; // returns number in IDR
            }
            return 0;
        } catch (error) {
            console.error('SMSCode getBalance error:', error.message);
            return 0;
        }
    }
}

module.exports = new SMSCodeService();
