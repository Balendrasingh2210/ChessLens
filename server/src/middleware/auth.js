/**
 * auth.js — JWT authentication middleware
 *
 * `protect` validates the Bearer token from the Authorization header,
 * loads the corresponding User from MongoDB, and attaches it to req.user.
 * Routes that call protect() can then access req.user without another DB lookup.
 *
 * @module middleware/auth
 */

const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Express middleware that enforces authentication.
 * Responds 401 if the token is missing, invalid, or the user no longer exists.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const protect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token provided' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user) return res.status(401).json({ message: 'User not found' });
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
};

module.exports = { protect };
