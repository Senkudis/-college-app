const mongoose = require('mongoose');
const User = require('./models/User');
const Batch = require('./models/Batch');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const activeBatches = await Batch.find({ status: 'active' }, '_id');
  const batchIds = activeBatches.map(b => b._id.toString());
  
  const res = await User.updateMany(
    { roles: 'doctor' },
    { $set: { batches: batchIds } }
  );
  console.log('Updated ' + res.modifiedCount + ' doctors with all active batches.');
  process.exit();
}).catch(console.error);
