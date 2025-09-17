import express from "express";
import mongoose from 'mongoose';
import { Note } from "../models/Note.js";
import fetchuser from "../middlewares/fetchuser.js";
import { validateObjectId, checkNoteOwnership, noteTextValidation, colourValidation, handleValidationErrors, tagArrayValidation } from "../middlewares/validation.js";
import { decryptNote, encryptNote, buildCategoryFilter, handleError } from "../utils/noteUtils.js";
import { encrypt } from "../utils/encryption.js";

const router = express.Router();

const ALLOWED_CATEGORIES = ["pinned", "archived", "deleted", "regular"];

// ROUTE 1: Fetch all notes
router.get("/fetch-notes", fetchuser, async (req, res) => {
  try {
    const { filter = "" } = req.query;
    // Allow empty string for regular notes, or valid categories
    const allowedFilters = [...ALLOWED_CATEGORIES.filter(c => c !== "regular"), ""];
    if (!allowedFilters.includes(filter)) {
      return res.status(400).json({
        error: "Invalid filter. Must be one of: pinned, archived, deleted or none"
      });
    }
    const query = buildCategoryFilter(filter, req.user.id);
    // Sort by order ascending (0 at top, higher numbers below)
    const notes = await Note.find(query).lean().sort({ updatedAt: -1 });
    // Decrypt notes
    const decryptedNotes = notes.map(decryptNote);
    res.status(200).json(decryptedNotes);
  } catch (error) {
    handleError(error, res, "Failed to fetch notes. Please reload the page");
  }
});

// ROUTE 2: Search notes by title, content, or tag
router.get("/search", fetchuser, async (req, res) => {
  try {
    const searchText = req.query.text?.toLowerCase().trim();
    // Return empty array if searchText is empty
    if (!searchText) {
      return res.status(200).json([]);
    }
    const notes = await Note.find({
      user: req.user.id,
      isDeleted: false
    }).lean().sort({ updatedAt: -1 });
    // Decrypt notes first, then filter
    const decryptedNotes = notes.map(decryptNote);
    const filteredNotes = decryptedNotes.filter(note => {
      const titleMatch = note.title.toLowerCase().includes(searchText);
      const contentMatch = note.content.toLowerCase().includes(searchText);
      const tagMatch = note.tag?.some(t => t.toLowerCase().includes(searchText));
      return titleMatch || contentMatch || tagMatch;
    });
    res.status(200).json(filteredNotes);
  } catch (error) {
    handleError(error, res, "Failed to search notes. Please reload the page or try again");
  }
});

// ROUTE 3: Search notes by tag name
router.get("/search-by-tag", fetchuser, async (req, res) => {
  try {
    const searchTag = req.query.tagName?.trim();
    // Return empty array if searchTag is empty
    if (!searchTag) {
      return res.status(200).json([]);
    }
    const notes = await Note.find({
      user: req.user.id,
      isDeleted: false
    }).lean().sort({ updatedAt: -1 });
    // Decrypt notes first, then filter
    const decryptedNotes = notes.map(decryptNote);
    const filteredNotes = decryptedNotes.filter(note => note.tag?.includes(searchTag));
    res.status(200).json(filteredNotes);
  } catch (error) {
    handleError(error, res, `Failed to find notes with label "${searchTag}". Please reload the page or try again`);
  }
});

// ROUTE 4: Add a new note for a user
router.post("/add-note", fetchuser, noteTextValidation, handleValidationErrors, async (req, res) => {
  try {
    const {
      title, content, tag,
      isPinned = false,
      isArchived = false,
      isDeleted = false,
      colour = "default"
    } = req.body;
    // Encrypt fields
    const encryptedFields = encryptNote({ title, content, tag });
    const note = await Note.create({
      user: req.user.id,
      title: encryptedFields.title,
      content: encryptedFields.content,
      tag: encryptedFields.tag,
      isPinned,
      isArchived,
      isDeleted,
      colour,
    });
    // Return decrypted note
    const decryptedNote = decryptNote(note.toObject());
    res.status(201).json(decryptedNote);
  } catch (error) {
    handleError(error, res, "Failed to add note. Please try again");
  }
});

// ROUTE 5: Update an edited note for a user
router.put("/update-note/:id", fetchuser, colourValidation, handleValidationErrors, async (req, res) => {
  try {
    validateObjectId(req.params.id);
    const prevNote = await Note.findById(req.params.id);
    checkNoteOwnership(prevNote, req.user.id);
    // Prepare allowed fields and updates
    const allowedFields = ['title', 'content', 'tag', 'isPinned', 'isArchived', 'isDeleted', 'colour'];
    const updatedNote = Object.fromEntries(
      Object.entries(req.body)
        .filter(([key, value]) => allowedFields.includes(key) && value !== undefined)
    );
    // Encrypt sensitive fields
    const encryptedUpdates = encryptNote(updatedNote);
    Object.assign(updatedNote, encryptedUpdates);
    const isNoteChanged = !(prevNote.title === updatedNote.title && prevNote.content === updatedNote.content && prevNote.isPinned === updatedNote.isPinned && prevNote.isArchived === updatedNote.isArchived && prevNote.isDeleted === updatedNote.isDeleted);
    // Update note with validation
    await Note.findByIdAndUpdate(req.params.id, { $set: updatedNote }, { timestamps: isNoteChanged });
    res.status(200).json({ success: true });
  } catch (error) {
    handleError(error, res, "Failed to update note. Please try again");
  }
});

// ROUTE 6: Toggle pin status of a note
router.put("/toggle-pin/:id", fetchuser, async (req, res) => {
  try {
    validateObjectId(req.params.id);
    const note = await Note.findById(req.params.id);
    checkNoteOwnership(note, req.user.id);
    let updates = {};
    if (note.isPinned) {
      updates.isPinned = false;
    } else {
      updates.isPinned = true;
      updates.isArchived = false;
    }
    await Note.findByIdAndUpdate(req.params.id, { $set: updates });
    res.status(200).json({ success: true });
  } catch (error) {
    handleError(error, res, "Failed to toggle pin. Please try again");
  }
});

// ROUTE 7: Toggle archive status of a note
router.put("/toggle-archive/:id", fetchuser, async (req, res) => {
  try {
    validateObjectId(req.params.id);
    const note = await Note.findById(req.params.id);
    checkNoteOwnership(note, req.user.id);
    let updates = {};
    if (note.isArchived) {
      updates.isArchived = false;
    } else {
      updates.isArchived = true;
      updates.isPinned = false;
    }
    await Note.findByIdAndUpdate(req.params.id, { $set: updates });
    res.status(200).json({ success: true });
  } catch (error) {
    handleError(error, res, "Failed to toggle archive. Please try again");
  }
});

// ROUTE 8: Soft delete or restore a note
router.put("/toggle-delete/:id", fetchuser, async (req, res) => {
  try {
    validateObjectId(req.params.id);
    const note = await Note.findById(req.params.id);
    checkNoteOwnership(note, req.user.id);
    let updates = {};
    if (note.isDeleted) {
      updates.isDeleted = false;
    } else {
      updates.isDeleted = true;
      updates.isPinned = false;
      updates.isArchived = false;
    }
    await Note.findByIdAndUpdate(req.params.id, { $set: updates });
    res.status(200).json({ success: true });
  } catch (error) {
    handleError(error, res, "Failed to toggle delete. Please try again");
  }
});

// ROUTE 9: Permanently delete a soft deleted note from db
router.delete("/permanent-delete/:id", fetchuser, async (req, res) => {
  try {
    validateObjectId(req.params.id);
    const note = await Note.findById(req.params.id);
    checkNoteOwnership(note, req.user.id);
    if (!note.isDeleted) {
      return res.status(400).json({
        error: "Note must be moved to bin before permanent deletion"
      });
    }
    await Note.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true });
  } catch (error) {
    handleError(error, res, "Failed to permanently delete note. Please try again");
  }
});

// ROUTE 10: Change note colour
router.put("/change-colour/:id", fetchuser, colourValidation, handleValidationErrors, async (req, res) => {
  try {
    validateObjectId(req.params.id);
    const note = await Note.findById(req.params.id);
    checkNoteOwnership(note, req.user.id);
    const { colour } = req.body;
    // Check if colour is already the same (optimization)
    if (note.colour === colour) {
      return res.status(200).json({
        success: true,
        message: "Note colour is already set to this value"
      });
    }
    await Note.findByIdAndUpdate(req.params.id, { $set: { colour } }, { timestamps: false });
    res.status(200).json({ success: true });
  } catch (error) {
    handleError(error, res, "Failed to change note colour. Please try again");
  }
});

// ROUTE 10: Change note colour
router.put("/change-tags/:id", fetchuser, tagArrayValidation, handleValidationErrors, async (req, res) => {
  try {
    validateObjectId(req.params.id);
    const note = await Note.findById(req.params.id);
    checkNoteOwnership(note, req.user.id);
    let { tag } = req.body;
    tag = tag.map(t => encrypt(t));
    await Note.findByIdAndUpdate(req.params.id, { $set: { tag } }, { timestamps: false });
    res.status(200).json({ success: true });
  } catch (error) {
    handleError(error, res, "Failed to change note tags. Please try again");
  }
});

export default router;