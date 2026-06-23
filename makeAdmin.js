const prisma = require('./src/config/db');
const dotenv = require('dotenv');

dotenv.config();

const makeAdmin = async () => {
    const username = process.argv[2];
    if (!username) {
        console.error('Harap masukkan username! Contoh: node makeAdmin.js nama_user');
        process.exit(1);
    }

    try {
        const user = await prisma.user.findUnique({
            where: { username }
        });

        if (!user) {
            console.error('User tidak ditemukan!');
            process.exit(1);
        }

        await prisma.user.update({
            where: { id: user.id },
            data: { role: 'admin' }
        });
        
        console.log(`Berhasil! User '${username}' sekarang adalah Admin.`);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

makeAdmin();
