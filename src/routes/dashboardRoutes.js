const express = require('express');
const dashboardController = require('../controllers/dashboardController');
const orderController = require('../controllers/orderController');
const profileController = require('../controllers/profileController');
const { protect } = require('../middlewares/auth');

const router = express.Router();

router.use(protect); // All routes below require login

// Dashboard Main
router.get('/', dashboardController.getDashboard);
router.get('/topup', dashboardController.getTopupPage);
router.get('/marketplace', dashboardController.getMarketplaceHub);
router.get('/marketplace/smm', dashboardController.getSmmMarketplace);
router.get('/marketplace/otp', dashboardController.getOtpMarketplace);
router.get('/marketplace/ptero', dashboardController.getPteroMarketplace);
router.get('/checkout/smm/:smmServiceId', dashboardController.getSmmCheckoutPage);
router.get('/checkout/:productId', dashboardController.getCheckoutPage);

// Orders
router.post('/orders/create', orderController.createDashboardOrder);
router.get('/orders/:id', orderController.getDashboardOrder);
router.get('/orders/pay/:id', orderController.getDashboardOrderPay);
router.post('/orders/cancel/:id', orderController.cancelOrder);

// Profile & Reseller
const multer = require('multer');
const path = require('path');
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/avatars/'),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, req.user.id + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ 
    storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Hanya file gambar yang diperbolehkan'));
    }
});

router.get('/profile', profileController.getProfilePage);
router.post('/profile/update', upload.single('avatar'), profileController.updateProfile);
router.post('/profile/upgrade', profileController.upgradeToReseller);
router.post('/profile/generate-key', profileController.generateApiKey);
router.post('/profile/margin', profileController.updateMargin);

module.exports = router;
