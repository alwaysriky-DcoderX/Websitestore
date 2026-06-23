const prisma = require('../config/db');

exports.getSupportPage = async (req, res) => {
    try {
        const chats = await prisma.chat.findMany({
            orderBy: { lastActivity: 'desc' },
            take: 50
        });
        // enrich chats for admin UI: attach guestInfo.name when message author exists
        const enriched = chats.map(c => {
            const lastMsg = (c.messages || []).slice().reverse().find(m => m.role === 'user' || m.role === 'admin' || m.role === 'model');
            const author = lastMsg && lastMsg.author ? lastMsg.author : null;
            return Object.assign({}, c, { guestInfo: { name: author ? (author.name || 'User') : (c.guestName || 'Guest User') } });
        });

        res.render('admin/support/index', {
            title: 'Live Support Management',
            user: req.user,
            chats: enriched
        });
    } catch (err) {
        res.status(500).send('Server Error');
    }
};

exports.getChatSession = async (req, res) => {
    try {
        const chat = await prisma.chat.findUnique({
            where: { sessionId: req.params.sessionId }
        });
        if (!chat) return res.status(404).json({ message: 'Chat not found' });
        res.json(chat);
    } catch (err) {
        res.status(500).json({ message: 'Server Error' });
    }
};
