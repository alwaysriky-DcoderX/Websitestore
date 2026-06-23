const axios = require('axios');
const prisma = require('../config/db');
const NodeCache = require('node-cache');
const smmCache = new NodeCache({ stdTTL: 300 }); // Cache for 5 minutes

class SMMService {
    constructor() {
        this.baseUrl = 'https://api.medanpedia.co.id';
    }

    // Shared axios config: don't throw on 4xx so we can read the API's error messages
    _axiosConfig() {
        return {
            timeout: 15000,
            validateStatus: () => true // never throw on any HTTP status
        };
    }

    async getCredentials() {
        try {
            const settings = await prisma.settings.findMany({
                where: {
                    key: {
                        in: ['smm_api_id', 'smm_api_key']
                    }
                }
            });
            const creds = {};
            settings.forEach(s => creds[s.key] = s.value);

            const apiId = creds.smm_api_id || process.env.SMM_API_ID || '';
            const apiKey = creds.smm_api_key || process.env.SMM_API_KEY || '';

            if (!apiId || !apiKey) {
                console.warn('[SMM] WARNING: API credentials are empty! Please set smm_api_id and smm_api_key in Admin Settings.');
            } else {
                console.log(`[SMM] Using API ID: ${apiId}, Key: ${apiKey.substring(0, 6)}...${apiKey.substring(apiKey.length - 4)}`);
            }

            return { apiId, apiKey };
        } catch (dbError) {
            console.error('[SMM] Database error fetching credentials:', dbError.message);
            // Fallback to env vars only
            return {
                apiId: process.env.SMM_API_ID || '',
                apiKey: process.env.SMM_API_KEY || ''
            };
        }
    }

    async getProfile() {
        try {
            const { apiId, apiKey } = await this.getCredentials();
            if (!apiId || !apiKey) {
                return { status: false, msg: 'API credentials belum diatur. Silakan atur di Admin Settings.' };
            }

            const payload = new URLSearchParams();
            payload.append('api_id', apiId);
            payload.append('api_key', apiKey);
            
            const res = await axios.post(`${this.baseUrl}/profile`, payload, this._axiosConfig());
            
            if (res.status !== 200 || (res.data && !res.data.status)) {
                console.error(`[SMM] getProfile failed — HTTP ${res.status}:`, res.data?.msg || 'Unknown error');
            }
            return res.data;
        } catch (error) {
            console.error('[SMM] getProfile error:', error.message);
            return { status: false, msg: error.message };
        }
    }


    async getServices() {
        try {
            const cached = smmCache.get('smm_services');
            if (cached) return cached;

            const { apiId, apiKey } = await this.getCredentials();
            if (!apiId || !apiKey) {
                return { status: false, msg: 'API credentials belum diatur. Silakan atur di Admin Settings.' };
            }

            const payload = new URLSearchParams();
            payload.append('api_id', apiId);
            payload.append('api_key', apiKey);

            const res = await axios.post(`${this.baseUrl}/services`, payload, this._axiosConfig());
            
            if (res.status !== 200) {
                console.error(`[SMM] getServices HTTP ${res.status}:`, res.data?.msg || 'Unknown error');
            }

            if (res.data && res.data.status) {
                smmCache.set('smm_services', res.data);
            } else {
                console.warn('[SMM] getServices returned status=false:', res.data?.msg || 'No message');
            }
            return res.data;
        } catch (error) {
            console.error('[SMM] getServices error:', error.message);
            return { status: false, msg: error.message };
        }
    }

    clearCache() {
        smmCache.flushAll();
        console.log('[SMM] Cache cleared');
    }

    async placeOrder(serviceId, target, quantity, type = 'default', extraData = {}) {
        try {
            const { apiId, apiKey } = await this.getCredentials();
            if (!apiId || !apiKey) {
                return { status: false, msg: 'API credentials belum diatur.' };
            }

            const payload = new URLSearchParams();
            payload.append('api_id', apiId);
            payload.append('api_key', apiKey);
            payload.append('service', serviceId);
            payload.append('target', target);
            
            if (type === 'default' || type === 'mentions_hastag' || type === 'mentions_follower' || type === 'mentions_media' || type === 'poll' || type === 'comment_likes') {
                payload.append('quantity', quantity);
            }
            
            if (type === 'custom_comment' || type === 'comment_reply') {
                payload.append('comments', extraData.comments || '');
            }
            if (type === 'mentions_custom_list') {
                payload.append('usernames', extraData.usernames || '');
            }
            if (type === 'mentions_hastag') {
                payload.append('hashtag', extraData.hashtag || '');
            }
            if (type === 'mentions_follower' || type === 'comment_reply' || type === 'comment_likes') {
                payload.append('username', extraData.username || '');
            }
            if (type === 'mentions_media') {
                payload.append('media', extraData.media || '');
            }
            if (type === 'poll') {
                payload.append('answer_number', extraData.answerNumber || 1);
            }

            const res = await axios.post(`${this.baseUrl}/order`, payload, this._axiosConfig());
            if (res.status !== 200 || (res.data && !res.data.status)) {
                console.error(`[SMM] placeOrder failed — HTTP ${res.status}:`, res.data?.msg || 'Unknown error');
            }
            return res.data;
        } catch (error) {
            console.error('[SMM] placeOrder error:', error.message);
            return { status: false, msg: error.message };
        }
    }

    async checkStatus(orderId) {
        try {
            const { apiId, apiKey } = await this.getCredentials();
            if (!apiId || !apiKey) {
                return { status: false, msg: 'API credentials belum diatur.' };
            }

            const payload = new URLSearchParams();
            payload.append('api_id', apiId);
            payload.append('api_key', apiKey);
            payload.append('id', orderId);

            const res = await axios.post(`${this.baseUrl}/status`, payload, this._axiosConfig());
            if (res.status !== 200 || (res.data && !res.data.status)) {
                console.error(`[SMM] checkStatus failed — HTTP ${res.status}:`, res.data?.msg || 'Unknown error');
            }
            return res.data;
        } catch (error) {
            console.error('[SMM] checkStatus error:', error.message);
            return { status: false, msg: error.message };
        }
    }
}

module.exports = new SMMService();
