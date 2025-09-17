import mongoose from "mongoose";

const tagSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  name: {
    type: String,
    default: ""
  }
}, {
  timestamps: true
});

export const Tag = mongoose.model('Tag', tagSchema);