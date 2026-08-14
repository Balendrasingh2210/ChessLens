const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const connectedAccountSchema = new mongoose.Schema({
  platform: { type: String, enum: ['chess.com', 'lichess'], required: true },
  username: { type: String, required: true },
  lastSynced: { type: Date, default: null },
  gamesAnalyzed: { type: Number, default: 0 },
}, { _id: false });

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  email:    { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  connectedAccounts: [connectedAccountSchema],
  isVerified:              { type: Boolean, default: false },
  verificationToken:       { type: String,  default: null  },
  verificationTokenExpiry: { type: Date,    default: null  },
  resetToken:              { type: String,  default: null  },
  resetTokenExpiry:        { type: Date,    default: null  },
}, { timestamps: true });

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toPublic = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
