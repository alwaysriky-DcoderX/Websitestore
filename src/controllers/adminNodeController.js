const prisma = require('../config/db');

exports.getNodes = async (req, res) => {
    try {
        const nodes = await prisma.node.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.render('admin/nodes/index', {
            title: 'Manage Nodes',
            user: req.user,
            nodes
        });
    } catch (err) {
        res.status(500).send('Server Error');
    }
};

exports.createNode = async (req, res) => {
    try {
        const { name, domain, location, apiKey, locationId, eggId, nestId } = req.body;
        await prisma.node.create({
            data: {
                name,
                domain,
                location,
                apiKey,
                locationId: Number(locationId),
                eggId: Number(eggId),
                nestId: Number(nestId)
            }
        });
        res.redirect('/admin/nodes');
    } catch (err) {
        res.status(400).send('Error creating node: ' + err.message);
    }
};

exports.deleteNode = async (req, res) => {
    try {
        await prisma.node.delete({
            where: { id: req.params.id }
        });
        res.redirect('/admin/nodes');
    } catch (err) {
        res.status(500).send('Server Error');
    }
};

exports.getEditNode = async (req, res) => {
    try {
        const node = await prisma.node.findUnique({
            where: { id: req.params.id }
        });
        if (!node) return res.status(404).send('Node not found');
        
        res.render('admin/nodes/edit', {
            title: 'Edit Node',
            user: req.user,
            node
        });
    } catch (err) {
        res.status(500).send('Server Error');
    }
};

exports.updateNode = async (req, res) => {
    try {
        const { name, domain, location, apiKey, locationId, eggId, nestId } = req.body;
        await prisma.node.update({
            where: { id: req.params.id },
            data: {
                name,
                domain,
                location,
                apiKey,
                locationId: Number(locationId),
                eggId: Number(eggId),
                nestId: Number(nestId)
            }
        });
        res.redirect('/admin/nodes');
    } catch (err) {
        res.status(400).send('Error updating node: ' + err.message);
    }
};
