const NodeCache = require('node-cache');

// Create a central cache instance. 
// stdTTL: standard time to live in seconds (default: 60s for DB caching)
const myCache = new NodeCache({ stdTTL: 60, checkperiod: 120 });

module.exports = myCache;
