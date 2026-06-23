const express = require('express');
const nokosController = require('../controllers/nokosController');
const { protect } = require('../middlewares/auth');

const router = express.Router();

router.use(protect); // All routes below require login

router.get('/checkout/:productId', nokosController.getCheckoutPage);
router.get('/countries/:productId', nokosController.getCountriesList);
router.post('/order', nokosController.createOrder);
router.get('/status/:orderId', nokosController.checkStatus);
router.get('/active-order/:orderId', nokosController.getActiveOrderDetails);

// QRIS endpoints
router.post('/qris-order', nokosController.createQrisOrder);
router.get('/qris-status/:orderId', nokosController.checkQrisStatus);

module.exports = router;
