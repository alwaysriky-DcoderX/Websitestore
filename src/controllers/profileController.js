const prisma = require('../config/db');
const crypto = require('crypto');

exports.getProfilePage = async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id }
        });
        
        // Default upgrade price if not set in DB
        let upgradePrice = 30000; 
        const upgradeSetting = await prisma.settings.findUnique({
            where: { key: 'reseller_upgrade_price' }
        });
        if (upgradeSetting) {
            upgradePrice = Number(upgradeSetting.value);
        }

        res.render('dashboard/profile', {
            title: 'My Profile & API Key',
            user,
            upgradePrice
        });
    } catch (err) {
        res.status(500).send('Server Error');
    }
};

exports.upgradeToReseller = async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id }
        });

        if (user.role !== 'user') {
            return res.status(400).send('You are already a reseller or admin.');
        }

        let upgradePrice = 30000;
        const upgradeSetting = await prisma.settings.findUnique({
            where: { key: 'reseller_upgrade_price' }
        });
        if (upgradeSetting) {
            upgradePrice = Number(upgradeSetting.value);
        }

        // Deduct balance and update role atomically
        try {
            await prisma.user.update({
                where: { 
                    id: req.user.id,
                    role: 'user',
                    balance: { gte: upgradePrice }
                },
                data: {
                    balance: { decrement: upgradePrice },
                    role: 'reseller',
                    apiKey: 'AOC-' + crypto.randomBytes(16).toString('hex').toUpperCase()
                }
            });
        } catch (updateErr) {
            return res.render('public/checkout-error', { message: `Saldo tidak cukup untuk upgrade atau Anda sudah menjadi reseller.` });
        }

        // Update session role
        req.session.user.role = 'reseller';

        res.redirect('/dashboard/profile?success=upgraded');
    } catch (err) {
        res.status(500).send('Server Error');
    }
};

exports.generateApiKey = async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id }
        });

        if (user.role === 'user') {
            return res.status(403).send('Upgrade to reseller first to generate an API key.');
        }

        await prisma.user.update({
            where: { id: req.user.id },
            data: {
                apiKey: 'AOC-' + crypto.randomBytes(16).toString('hex').toUpperCase()
            }
        });

        res.redirect('/dashboard/profile?success=key_generated');
    } catch (err) {
        res.status(500).send('Server Error');
    }
};

exports.updateMargin = async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id }
        });
        
        if (user.role === 'user') {
            return res.status(403).send('Only resellers can set margin.');
        }

        const newMargin = Number(req.body.margin);
        if (isNaN(newMargin) || newMargin < 0) {
            return res.status(400).send('Invalid margin value.');
        }

        await prisma.user.update({
            where: { id: req.user.id },
            data: {
                marginReseller: newMargin
            }
        });

        res.redirect('/dashboard/profile?success=margin_updated');
    } catch (err) {
        res.status(500).send('Server Error');
    }
};

exports.updateProfile = async (req, res) => {
    try {
        const { name, username, email, password } = req.body;
        
        // Check if username or email is taken by another user
        if (username || email) {
            const existingUser = await prisma.user.findFirst({
                where: {
                    OR: [
                        { username: username || undefined },
                        { email: email || undefined }
                    ],
                    NOT: { id: req.user.id }
                }
            });
            if (existingUser) {
                return res.redirect('/dashboard/profile?error=exists');
            }
        }

        let updateData = {};
        if (name) updateData.name = name;
        if (username) updateData.username = username;
        if (email) updateData.email = email;
        
        if (password && password.trim() !== '') {
            const bcrypt = require('bcryptjs');
            const salt = await bcrypt.genSalt(10);
            updateData.password = await bcrypt.hash(password, salt);
        }

        if (req.file) {
            updateData.avatar = '/uploads/avatars/' + req.file.filename;
        }

        await prisma.user.update({
            where: { id: req.user.id },
            data: updateData
        });

        res.redirect('/dashboard/profile?success=profile_updated');
    } catch (err) {
        console.error('Profile Update Error:', err);
        res.redirect('/dashboard/profile?error=server_error');
    }
};
