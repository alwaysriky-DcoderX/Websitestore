const prisma = require('../config/db');

exports.getCategories = async (req, res) => {
    try {
        const categories = await prisma.category.findMany({
            orderBy: { order: 'asc' }
        });
        res.render('admin/categories/index', {
            title: 'Manage Categories',
            user: req.user,
            categories
        });
    } catch (err) {
        res.status(500).send('Server Error');
    }
};

exports.getNewCategoryForm = async (req, res) => {
    try {
        res.render('admin/categories/new', {
            title: 'Add New Category',
            user: req.user
        });
    } catch (err) {
        res.status(500).send('Server Error');
    }
};

exports.createCategory = async (req, res) => {
    try {
        const { name, slug, type, description, icon, order } = req.body;
        await prisma.category.create({
            data: {
                name,
                slug,
                type,
                description,
                icon,
                order: Number(order) || 0
            }
        });
        res.redirect('/admin/categories');
    } catch (err) {
        console.error(err);
        res.status(400).send('Error creating category. ' + err.message);
    }
};
