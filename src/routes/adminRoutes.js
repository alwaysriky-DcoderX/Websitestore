const express = require('express');
const { getAdminDashboard } = require('../controllers/adminController');
const { getCategories, getNewCategoryForm, createCategory } = require('../controllers/adminCategoryController');
const { protect, authorize } = require('../middlewares/auth');
const { getSupportPage, getChatSession } = require('../controllers/adminSupportController');

const router = express.Router();

router.use(protect);
router.use(authorize('admin', 'owner')); // Only admins and owners

router.get('/', getAdminDashboard);

// Support
router.get('/support', getSupportPage);
router.get('/support/session/:sessionId', getChatSession);

// Products
const { getProducts, getNewProductForm, createProduct, deleteProduct, getStockPage, addStock, deleteStock, getEditPanelForm, updatePanelProduct } = require('../controllers/adminProductController');
router.get('/products', getProducts);
router.get('/products/new/:type', getNewProductForm);
router.post('/products', createProduct);
router.get('/products/delete/:id', deleteProduct);
router.get('/products/stock/:id', getStockPage);
router.post('/products/stock/:id', addStock);
router.post('/products/stock/:productId/delete/:stockId', deleteStock);
router.get('/products/edit/panel/:id', getEditPanelForm);
router.post('/products/edit/panel/:id', updatePanelProduct);

// Categories
router.get('/categories', getCategories);
router.get('/categories/new', getNewCategoryForm);
router.post('/categories', createCategory);

// Nodes (PLTA)
const { getNodes, createNode, deleteNode, getEditNode, updateNode } = require('../controllers/adminNodeController');
router.get('/nodes', getNodes);
router.post('/nodes', createNode);
router.get('/nodes/edit/:id', getEditNode);
router.post('/nodes/edit/:id', updateNode);
router.get('/nodes/delete/:id', deleteNode);

// Vouchers
const { getVouchers, createVoucher, deleteVoucher } = require('../controllers/adminVoucherController');
router.get('/vouchers', getVouchers);
router.post('/vouchers', createVoucher);
router.get('/vouchers/delete/:id', deleteVoucher);

// Settings
const { getSettings, updateSettings } = require('../controllers/adminSettingsController');
router.get('/settings', getSettings);
router.post('/settings/save', updateSettings);

// Nokos / OTP Settings
const { getNokosDashboard, saveNokosSettings, toggleAllNokos } = require('../controllers/adminNokosController');
router.get('/nokos', getNokosDashboard);
router.post('/nokos/save', saveNokosSettings);
router.post('/nokos/toggle-all', toggleAllNokos);

module.exports = router;
