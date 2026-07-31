require('dotenv').config();
const mongoose = require('mongoose');

// Models
const Batch = require('./models/Batch');
const User = require('./models/User');
const Subject = require('./models/Subject');
const Video = require('./models/Video');
const Assignment = require('./models/Assignment');

async function migrate() {
  try {
    console.log("Connecting to database...");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Database connected.");

    console.log("\n--- Starting Multi-Batch Migration ---");

    // 1. Create Default Batch if it doesn't exist
    let defaultBatch = await Batch.findOne({ code: 'DEFAULT' });
    if (!defaultBatch) {
      console.log("Creating default batch 'الدفعة الأولى'...");
      defaultBatch = await Batch.create({
        name: 'الدفعة الأولى',
        code: 'DEFAULT',
        themeColor: '#6366f1'
      });
      console.log("Default batch created with ID:", defaultBatch._id);
    } else {
      console.log("Default batch already exists:", defaultBatch._id);
    }

    const batchId = defaultBatch._id;

    // 2. Migrate Students
    console.log("\nMigrating Students...");
    const studentsRes = await User.updateMany(
      { roles: "student", batch: { $exists: false } },
      { $set: { batch: batchId } }
    );
    console.log(`Updated ${studentsRes.modifiedCount} students.`);

    // 3. Migrate Doctors (Adding default batch to their batches array)
    console.log("\nMigrating Doctors...");
    const doctorsRes = await User.updateMany(
      { roles: "doctor", batches: { $size: 0 } },
      { $push: { batches: batchId } }
    );
    console.log(`Updated ${doctorsRes.modifiedCount} doctors.`);

    // 4. Migrate Subjects
    console.log("\nMigrating Subjects...");
    const subjectsRes = await Subject.updateMany(
      { batches: { $size: 0 } },
      { $push: { batches: batchId } }
    );
    console.log(`Updated ${subjectsRes.modifiedCount} subjects.`);

    // 5. Migrate Videos
    console.log("\nMigrating Videos...");
    const videosRes = await Video.updateMany(
      { batches: { $size: 0 } },
      { $push: { batches: batchId } }
    );
    console.log(`Updated ${videosRes.modifiedCount} videos.`);

    // 6. Migrate Assignments
    console.log("\nMigrating Assignments...");
    const assignsRes = await Assignment.updateMany(
      { batches: { $size: 0 } },
      { $push: { batches: batchId } }
    );
    console.log(`Updated ${assignsRes.modifiedCount} assignments.`);

    console.log("\n--- Migration Completed Successfully ---");
    process.exit(0);
  } catch (error) {
    console.error("Migration Error:", error);
    process.exit(1);
  }
}

migrate();
