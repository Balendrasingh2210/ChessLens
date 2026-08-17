/**
 * db.js — MongoDB connection helper
 *
 * Connects Mongoose to the URI in MONGO_URI (defaults to local).
 * Call once at startup — Mongoose maintains the connection pool internally.
 *
 * @module config/db
 */

const mongoose = require('mongoose');

/**
 * Establish the Mongoose connection. Throws on failure so the server
 * process exits rather than starting in a broken state.
 */
const connectDB = async () => {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/chesslens';
  await mongoose.connect(uri);
  console.log('✅ MongoDB connected');
};

module.exports = connectDB;
