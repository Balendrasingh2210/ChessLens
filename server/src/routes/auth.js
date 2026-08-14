const router = require('express').Router();
const { register, login, getMe, updateProfile, changePassword, forgotPassword, resetPassword, verifyEmail } = require('../controllers/authController');
const { protect } = require('../middleware/auth');

router.post('/register',        register);
router.post('/login',           login);
router.get('/verify-email',     verifyEmail);
router.get('/me',               protect, getMe);
router.put('/update-profile',   protect, updateProfile);
router.put('/change-password',  protect, changePassword);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password',  resetPassword);

module.exports = router;
