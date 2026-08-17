/**
 * authController.js — authentication and account management endpoints
 *
 * Handles the full user lifecycle:
 *   register()           — creates account, sends verification email via Brevo
 *   verifyEmail()        — validates the 24h token from the email link
 *   login()              — validates credentials + email verification, returns JWT
 *   getMe()              — returns the authenticated user object
 *   updateProfile()      — change username or email (uniqueness checked)
 *   resendVerification() — issues a fresh 24h token and re-sends the email
 *   forgotPassword()     — issues a 1h reset token and emails a reset link
 *   resetPassword()      — validates the reset token, sets the new password
 *   changePassword()     — authenticated password change (requires current password)
 *
 * Tokens are random 32-byte hex strings stored on the User document with expiry.
 * Passwords are hashed by the User model's pre-save hook (bcrypt, cost=12).
 * JWTs are signed with JWT_SECRET and expire per JWT_EXPIRES_IN (default 7d).
 *
 * @module controllers/authController
 */

const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const User   = require('../models/User');
const email  = require('../services/emailService');

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

exports.register = async (req, res) => {
  try {
    const { username, email: addr, password } = req.body;
    if (!username || !addr || !password)
      return res.status(400).json({ message: 'All fields required' });

    if (await User.findOne({ email: addr }))
      return res.status(409).json({ message: 'Email already in use' });
    if (await User.findOne({ username }))
      return res.status(409).json({ message: 'Username already taken' });

    const verToken = crypto.randomBytes(32).toString('hex');
    await User.create({
      username, email: addr, password,
      verificationToken:       verToken,
      verificationTokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    try { await email.sendVerificationEmail(addr, verToken); }
    catch (e) { console.error('Verification email failed:', e.message); }

    res.status(201).json({ message: 'Account created! Check your email to verify your account.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ message: 'Token is required' });

    const user = await User.findOne({
      verificationToken:       token,
      verificationTokenExpiry: { $gt: new Date() },
    });
    if (!user) return res.status(400).json({ message: 'Invalid or expired verification link' });

    user.isVerified              = true;
    user.verificationToken       = null;
    user.verificationTokenExpiry = null;
    await user.save();

    res.json({ message: 'Email verified! You can now log in.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email: addr, password } = req.body;
    const user = await User.findOne({ email: addr });
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ message: 'Invalid credentials' });
    if (!user.isVerified)
      return res.status(403).json({ message: 'Please verify your email before logging in. Check your inbox.' });
    res.json({ token: signToken(user._id), user: user.toPublic() });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getMe = (req, res) => res.json({ user: req.user.toPublic() });

exports.updateProfile = async (req, res) => {
  try {
    const { username, email: addr } = req.body;
    if (!username && !addr) return res.status(400).json({ message: 'Nothing to update' });

    const updates = {};
    if (username && username !== req.user.username) {
      if (await User.findOne({ username })) return res.status(409).json({ message: 'Username already taken' });
      updates.username = username;
    }
    if (addr && addr !== req.user.email) {
      if (await User.findOne({ email: addr })) return res.status(409).json({ message: 'Email already in use' });
      updates.email = addr;
    }

    const updated = await User.findByIdAndUpdate(req.user._id, updates, { new: true });
    res.json({ user: updated.toPublic() });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.resendVerification = async (req, res) => {
  try {
    const { email: addr } = req.body;
    if (!addr) return res.status(400).json({ message: 'Email is required' });

    const user = await User.findOne({ email: addr.toLowerCase() });
    if (user && !user.isVerified) {
      const verToken = require('crypto').randomBytes(32).toString('hex');
      user.verificationToken       = verToken;
      user.verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await user.save();
      try { await email.sendVerificationEmail(addr, verToken); }
      catch (e) { console.error('Resend verification email failed:', e.message); }
    }

    res.json({ message: 'If that email has an unverified account, a new link has been sent.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    const { email: addr } = req.body;
    if (!addr) return res.status(400).json({ message: 'Email is required' });

    const user = await User.findOne({ email: addr.toLowerCase() });
    if (user) {
      const token  = crypto.randomBytes(32).toString('hex');
      user.resetToken       = token;
      user.resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000);
      await user.save();
      try { await email.sendPasswordResetEmail(addr, token); }
      catch (e) { console.error('Reset email failed:', e.message); }
    }

    res.json({ message: 'If that email exists, a reset link has been sent.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ message: 'Token and new password are required' });
    if (newPassword.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });

    const user = await User.findOne({
      resetToken:       token,
      resetTokenExpiry: { $gt: new Date() },
    });
    if (!user) return res.status(400).json({ message: 'Invalid or expired reset link' });

    user.password         = newPassword;
    user.resetToken       = null;
    user.resetTokenExpiry = null;
    await user.save();

    res.json({ message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ message: 'Both passwords required' });
    if (newPassword.length < 6) return res.status(400).json({ message: 'New password must be at least 6 characters' });

    const user = await User.findById(req.user._id);
    if (!(await user.comparePassword(currentPassword)))
      return res.status(401).json({ message: 'Current password is incorrect' });

    user.password = newPassword;
    await user.save();
    res.json({ message: 'Password updated' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
