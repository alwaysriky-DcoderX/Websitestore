require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

let connectionString = process.env.DATABASE_URL;
if (connectionString && connectionString.includes('sslmode=require') && !connectionString.includes('uselibpqcompat')) {
    const separator = connectionString.includes('?') ? '&' : '?';
    connectionString = `${connectionString}${separator}uselibpqcompat=true`;
}
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

const prismaRaw = new PrismaClient({
    adapter,
    log: ['error', 'warn']
});

const prisma = prismaRaw.$extends({
    result: {
        user: {
            _id: {
                needs: { id: true },
                compute(user) {
                    return user.id;
                }
            }
        },
        category: {
            _id: {
                needs: { id: true },
                compute(category) {
                    return category.id;
                }
            }
        },
        node: {
            _id: {
                needs: { id: true },
                compute(node) {
                    return node.id;
                }
            }
        },
        product: {
            _id: {
                needs: { id: true },
                compute(product) {
                    return product.id;
                }
            }
        },
        order: {
            _id: {
                needs: { id: true },
                compute(order) {
                    return order.id;
                }
            }
        },
        chat: {
            _id: {
                needs: { id: true },
                compute(chat) {
                    return chat.id;
                }
            }
        },
        settings: {
            _id: {
                needs: { id: true },
                compute(settings) {
                    return settings.id;
                }
            }
        },
        voucher: {
            _id: {
                needs: { id: true },
                compute(voucher) {
                    return voucher.id;
                }
            }
        }
    }
});

const connectDB = async () => {
    try {
        await prismaRaw.$connect();
        console.log('PostgreSQL Connected via Prisma');
    } catch (error) {
        console.error(`Error connecting to database: ${error.message}`);
        process.exit(1);
    }
};

module.exports = prisma;
module.exports.connectDB = connectDB;
