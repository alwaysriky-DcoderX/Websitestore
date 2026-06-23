const express = require('express');
const { 
    register, 
    login, 
    logout, 
    getMe, 
    forgotPassword, 
    verifyResetOtp, 
    resetPassword 
} = require('../controllers/authController');
const { protect } = require('../middlewares/auth');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.get('/logout', logout);
router.get('/me', protect, getMe);

// Password Reset API
router.post('/forgot-password', forgotPassword);
router.post('/verify-otp', verifyResetOtp);
router.post('/reset-password', resetPassword);

// Render pages
router.get('/login', (req, res) => res.render('auth/login', { title: 'Login' }));
router.get('/register', (req, res) => res.render('auth/register', { title: 'Register' }));
router.get('/forgot-password', (req, res) => res.render('auth/forgot-password', { title: 'Lupa Password' }));
router.get('/verify-otp', (req, res) => res.render('auth/verify-otp', { title: 'Verifikasi OTP', email: req.query.email }));
router.get('/reset-password', (req, res) => res.render('auth/reset-password', { title: 'Reset Password', email: req.query.email }));

module.exports = router;
