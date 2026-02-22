const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema({
  name: String,
  members: [String],
  admin: String,
  createdAt: { type: Date, default: Date.now }
});

const Group = mongoose.model('Group', groupSchema);
module.exports = Group;