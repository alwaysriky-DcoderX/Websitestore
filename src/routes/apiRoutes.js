const express = require('express');
const rateLimit = require('express-rate-limit');
const { getProducts, placeOrder, createDeposit, getAccountInfo, getOrderDetails } = require('../controllers/apiController');
const { apiProtect } = require('../middlewares/auth');

const router = express.Router();

// Specific API Rate Limiter
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30, // Limit each API Key to 30 requests per minute
    message: { success: false, error: 'Too many requests, please try again later.' }
});

router.use(apiLimiter);
router.use(apiProtect); // All routes below require valid x-api-key

router.get('/products', getProducts);
router.post('/order', placeOrder);
router.post('/deposit', createDeposit);

router.get('/order/:id', getOrderDetails);
router.get('/account', getAccountInfo);

module.exports = router;
