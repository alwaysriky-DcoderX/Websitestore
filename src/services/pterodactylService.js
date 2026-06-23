const axios = require('axios');

class PterodactylService {
    constructor(apikey, domain) {
        this.apikey = apikey;
        this.domain = domain.endsWith('/') ? domain.slice(0, -1) : domain;
        this.headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.apikey}`
        };
    }

    async findUserByUsername(username) {
        try {
            const res = await axios.get(`${this.domain}/api/application/users?filter[username]=${username}`, { headers: this.headers });
            return res.data.data.length > 0 ? res.data.data[0].attributes : null;
        } catch (error) {
            return null;
        }
    }

    async findUserByEmail(email) {
        try {
            const res = await axios.get(`${this.domain}/api/application/users?filter[email]=${email}`, { headers: this.headers });
            return res.data.data.length > 0 ? res.data.data[0].attributes : null;
        } catch (error) {
            return null;
        }
    }

    async createUser(username, email, password, firstName = 'Auto', lastName = 'Order') {
        try {
            const data = {
                username,
                email,
                first_name: firstName,
                last_name: lastName,
                password
            };
            const res = await axios.post(`${this.domain}/api/application/users`, data, { headers: this.headers });
            return res.data.attributes;
        } catch (err) {
            throw new Error(err.response?.data?.errors?.[0]?.detail || 'Gagal membuat user Pterodactyl');
        }
    }

    async getOrCreateUser(username, email, password) {
        let user = await this.findUserByUsername(username);
        if (user) return user;

        user = await this.findUserByEmail(email);
        if (user) return user;

        return await this.createUser(username, email, password, username, 'User');
    }

    async _findAvailableAllocation(locationId) {
        try {
            const nodesRes = await axios.get(`${this.domain}/api/application/nodes?per_page=200`, { headers: this.headers });
            for (const node of nodesRes.data.data) {
                if (Number(node.attributes.location_id) === Number(locationId)) {
                    const allocsRes = await axios.get(`${this.domain}/api/application/nodes/${node.attributes.id}/allocations?per_page=200`, { headers: this.headers });
                    const available = allocsRes.data.data.find(a => !a.attributes.assigned);
                    if (available) return available.attributes.id;
                }
            }
            throw new Error('Tidak ada alokasi port tersedia di lokasi ini.');
        } catch (err) {
            throw new Error('Gagal mencari alokasi port: ' + err.message);
        }
    }

    async createServer(userId, name, limits, featureLimits, allocationId, eggId, nestId, locationId, env, startupCommand) {
        try {
            // Auto-detect allocation if not provided
            let finalAllocationId = allocationId;
            if (!finalAllocationId && locationId) {
                finalAllocationId = await this._findAvailableAllocation(locationId);
            }

            const data = {
                name,
                user: userId,
                egg: eggId,
                docker_image: "ghcr.io/parkervcp/yolks:nodejs_18", 
                startup: startupCommand || "npm start",
                environment: env || { "USER_UPLOAD": "0", "AUTO_UPDATE": "0", "JS_FILE": "index.js", "CMD_RUN": "node index.js" },
                limits,
                feature_limits: featureLimits,
                allocation: { default: finalAllocationId }
            };

            const res = await axios.post(`${this.domain}/api/application/servers`, data, { headers: this.headers });
            return res.data.attributes;
        } catch (err) {
            console.error('Pterodactyl createServer Error:', err.response?.data || err.message);
            throw new Error(err.response?.data?.errors?.[0]?.detail || 'Gagal membuat server Pterodactyl');
        }
    }
}

module.exports = PterodactylService;
