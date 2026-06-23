const prisma = require('../config/db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const sendTokenResponse = (user, statusCode, req, res) => {
    // Create token
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'fallback_jwt_secret', {
        expiresIn: process.env.JWT_EXPIRE || '30d'
    });

    const options = {
        expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production'
    };

    req.session.token = token;
    req.session.user = { id: user.id, username: user.username, role: user.role };

    res.status(statusCode).cookie('token', token, options).json({
        success: true,
        token,
        role: user.role
    });
};

exports.register = async (req, res) => {
    try {
        const { username, email, password } = req.body;

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create user
        const user = await prisma.user.create({
            data: {
                username,
                email,
                password: hashedPassword
            }
        });

        sendTokenResponse(user, 201, req, res);
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
};

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate email & password
        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Please provide an email and password' });
        }

        // Check for user
        const user = await prisma.user.findUnique({
            where: { email }
        });

        if (!user) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        // Check if password matches
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        sendTokenResponse(user, 200, req, res);
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
};

exports.logout = (req, res) => {
    req.session.destroy();
    res.cookie('token', 'none', {
        expires: new Date(Date.now() + 10 * 1000),
        httpOnly: true
    });

    res.status(200).json({ success: true, data: {} });
};

exports.getMe = async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id }
        });
        res.status(200).json({ success: true, data: user });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
};

exports.forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, error: 'Silakan masukkan email' });

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return res.status(404).json({ success: false, error: 'Email tidak ditemukan' });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiry = new Date(Date.now() + 10 * 60 * 1000);

        await prisma.user.update({
            where: { email },
            data: { resetOtp: otp, resetOtpExpiry: expiry }
        });

        const MailService = require('../services/mailService');
        const mailService = new MailService();
        const transporter = await mailService.getTransporter('otp');
        
        if (transporter) {
            const settingsList = await prisma.settings.findMany();
            const settings = {};
            settingsList.forEach(s => settings[s.key] = s.value);
            
            await transporter.sendMail({
                from: `"${settings.web_name || 'AutoOrder Support'}" <${settings.email_otp_user || settings.email_smtp_user}>`,
                to: email,
                subject: `OTP Reset Password - ${settings.web_name || 'AutoOrder'}`,
                html: `
                    <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px; text-align: center;">
                        <h2 style="color: #2563eb;">Reset Password</h2>
                        <p>Anda meminta untuk mereset password akun Anda. Berikut adalah kode OTP Anda:</p>
                        <h1 style="font-size: 32px; letter-spacing: 4px; color: #1e40af; background: #f3f4f6; padding: 10px; border-radius: 8px;">${otp}</h1>
                        <p style="color: #ef4444; font-size: 12px;">Kode ini hanya berlaku selama 10 menit.</p>
                        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                        <p style="font-size: 12px; color: #6b7280;">Jika Anda tidak merasa meminta reset password, abaikan email ini.</p>
                    </div>
                `
            });
        }

        res.status(200).json({ success: true, message: 'OTP telah dikirim ke email Anda' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

exports.verifyResetOtp = async (req, res) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp) return res.status(400).json({ success: false, error: 'Email dan OTP harus diisi' });

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || user.resetOtp !== otp || !user.resetOtpExpiry || user.resetOtpExpiry < new Date()) {
            return res.status(400).json({ success: false, error: 'OTP tidak valid atau sudah kedaluwarsa' });
        }

        res.status(200).json({ success: true, message: 'OTP Valid' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

exports.resetPassword = async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        if (!email || !otp || !newPassword) return res.status(400).json({ success: false, error: 'Data tidak lengkap' });

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || user.resetOtp !== otp || !user.resetOtpExpiry || user.resetOtpExpiry < new Date()) {
            return res.status(400).json({ success: false, error: 'OTP tidak valid atau sudah kedaluwarsa' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        await prisma.user.update({
            where: { email },
            data: { password: hashedPassword, resetOtp: null, resetOtpExpiry: null }
        });

        res.status(200).json({ success: true, message: 'Password berhasil diubah, silakan login.' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};
