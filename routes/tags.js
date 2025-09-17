import express from "express";
import mongoose from "mongoose";
import { Note } from "../models/Note.js";
import { Tag } from "../models/Tag.js";
import fetchuser from "../middlewares/fetchuser.js";
import { tagStringValidation, handleValidationErrors } from "../middlewares/validation.js";
import { encrypt, decrypt } from "../utils/encryption.js";

const router = express.Router();

const checkTagOwnership = (tag, userId, res) => {
  if (!tag) {
    res.status(404).json({ error: "Label not found" });
    return false;
  }
  if (tag.user.toString() !== userId) {
    res.status(403).json({ error: "Access denied" });
    return false;
  }
  return true;
};

// Fetch tags (sorted alphabetically by decrypted value)
router.get("/fetch-tags", fetchuser, async (req, res) => {
  try {
    const tags = await Tag.find({ user: req.user.id }).lean();
    const decryptedTags = tags
      .map(t => ({ ...t, name: decrypt(t.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    res.status(200).json(decryptedTags);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch labels. Please try again." });
  }
});

router.post("/add-tag", fetchuser, tagStringValidation, handleValidationErrors, async (req, res) => {
  try {
    const tagName = req.body.name.trim();

    // Fetch existing tags to check for duplicates
    const existingTags = await Tag.find({ user: req.user.id }).lean();
    if (existingTags.length === 50) {
      return res.status(400).json({ error: "Maximum 50 labels allowed" });
    }
    const isDuplicate = existingTags.some(t => {
      const decryptedTag = decrypt(t.name);
      return decryptedTag.toLowerCase() === tagName.toLowerCase();
    });
    if (isDuplicate) {
      return res.status(400).json({ error: "Label already exists" });
    }
    const created = await Tag.create({
      user: req.user.id,
      name: encrypt(tagName)
    });
    // Return the created tag with decrypted value
    res.status(201).json({
      _id: created._id,
      user: created.user,
      name: tagName,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to add label. Please try again." });
  }
});

router.put("/update-tag/:id", fetchuser, tagStringValidation, handleValidationErrors, async (req, res) => {
  try {
    const { id } = req.params;
    const tagName = req.body.name.trim();
    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid label ID format" });
    }
    // Find the tag to update
    const tag = await Tag.findById(id);
    if (!checkTagOwnership(tag, req.user.id, res)) return;
    const currentDecryptedValue = decrypt(tag.name);
    // Check if the tag value actually changed
    if (currentDecryptedValue === tagName) {
      return res.status(200).json({
        success: true,
        message: "No changes made"
      });
    }
    // Check for duplicates with other tags (exclude current tag)
    const otherTags = await Tag.find({
      user: req.user.id,
      _id: { $ne: id }
    }).lean();
    const isDuplicate = otherTags.some(t => {
      const decryptedTag = decrypt(t.name);
      return decryptedTag.toLowerCase() === tagName.toLowerCase();
    });
    if (isDuplicate) {
      return res.status(400).json({ error: "Label already exists" });
    }
    // Update the tag
    const updatedTag = await Tag.findByIdAndUpdate(
      id,
      { $set: { name: encrypt(tagName) } },
      { new: true }
    );
    res.status(200).json({
      success: true,
      tag: {
        _id: updatedTag._id,
        user: updatedTag.user,
        name: tagName,
        createdAt: updatedTag.createdAt,
        updatedAt: updatedTag.updatedAt
      }
    });
  } catch (error) {
    console.error("Error updating tag:", error);
    res.status(500).json({ error: "Failed to update label. Please try again." });
  }
});

router.delete("/delete-tag/:id", fetchuser, async (req, res) => {
  try {
    const { id } = req.params;
    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid tag ID format" });
    }
    // Find and verify ownership
    const tag = await Tag.findById(id);
    if (!checkTagOwnership(tag, req.user.id, res)) return;
    // Delete the tag
    await Tag.findByIdAndDelete(id);
    const notesWithTags = await Note.find({ user: req.user.id, tag: { $exists: true, $not: { $size: 0 } } });
    for (const note of notesWithTags) {
      const updatedTags = note.tag.map(t => decrypt(t)).filter(t => t !== decrypt(tag.name)).map(t => encrypt(t));
      if (updatedTags.length !== note.tag.length) {
        await Note.findByIdAndUpdate(note._id, { tag: updatedTags }, { timestamps: false });
      }
    }
    // Remove the tag from the note.tag array, Upload these updated note in db
    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error deleting tag:", error);
    res.status(500).json({ error: "Failed to delete label. Please try again." });
  }
});

export default router;