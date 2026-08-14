const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const User   = require('../models/User');

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

exports.register = async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password)
      return res.status(400).json({ message: 'All fields required' });

    const emailExists = await User.findOne({ email });
    if (emailExists) return res.status(409).json({ message: 'Email already in use' });

    const usernameExists = await User.findOne({ username });
    if (usernameExists) return res.status(409).json({ message: 'Username already taken' });

    const user = await User.create({ username, email, password });
    res.status(201).json({ token: signToken(user._id), user: user.toPublic() });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ message: 'Invalid credentials' });
    res.json({ token: signToken(user._id), user: user.toPublic() });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getMe = (req, res) => res.json({ user: req.user.toPublic() });

exports.updateProfile = async (req, res) => {
  try {
    const { username, email } = req.body;
    if (!username && !email) return res.status(400).json({ message: 'Nothing to update' });

    const updates = {};
    if (username && username !== req.user.username) {
      const taken = await User.findOne({ username });
      if (taken) return res.status(409).json({ message: 'Username already taken' });
      updates.username = username;
    }
    if (email && email !== req.user.email) {
      const taken = await User.findOne({ email });
      if (taken) return res.status(409).json({ message: 'Email already in use' });
      updates.email = email;
    }

    const updated = await User.findByIdAndUpdate(req.user._id, updates, { new: true });
    res.json({ user: updated.toPublic() });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    // Always respond 200 to avoid leaking which emails exist
    if (!user) return res.json({ message: 'If that email exists, a reset token was generated.' });

    const token  = crypto.randomBytes(20).toString('hex');
    user.resetToken       = token;
    user.resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    console.log(`[Password Reset] Token for ${email}: ${token}`);
    res.json({ message: 'Reset token generated.', devToken: token });
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
      resetToken: token,
      resetTokenExpiry: { $gt: new Date() },
    });
    if (!user) return res.status(400).json({ message: 'Invalid or expired reset token' });

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
