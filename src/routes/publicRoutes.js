const express = require('express');
const { getHomePage, getTermsPage } = require('../controllers/publicController');

const router = express.Router();

router.get('/', getHomePage);
router.get('/terms', getTermsPage);
router.get('/docs', (req, res) => res.render('public/docs', { title: 'API Documentation' }));

router.get('/cron/smm-sync', require('../controllers/orderController').syncSmmOrdersCron);

module.exports = router;
