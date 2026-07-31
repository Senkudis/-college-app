const mongoose = require("mongoose");

const ReferenceSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true
    },
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
      required: true
    },
    file: String,
    link: String,
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Reference", ReferenceSchema);
