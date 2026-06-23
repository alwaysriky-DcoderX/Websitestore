const express = require('express');
const { getCheckoutSelection, processCheckout, validateVoucher, processTopup } = require('../controllers/checkoutController');

const router = express.Router();

// Get the payment method selection screen
router.post('/select', getCheckoutSelection);

// Process the final checkout
router.post('/process', processCheckout);

// Process the balance top-up
router.post('/topup', processTopup);

// Validate voucher via AJAX
router.post('/validate-voucher', validateVoucher);

module.exports = router;
