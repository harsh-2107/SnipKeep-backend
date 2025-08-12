import express from "express";
import mongoose from 'mongoose';
import { Note } from "../models/Note.js";
import fetchuser from "../middlewares/fetchuser.js";
import { validateObjectId, checkNoteOwnership, noteTextValidation, noteCategoryValidation, colourValidation, handleValidationErrors } from "../middlewares/validation.js";
import { decryptNote, encryptNote, buildCategoryFilter, handleError, reorderPreviousCategoryNotes, reorderNewCategoryNotes } from "../utils/noteUtils.js";

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
    const notes = await Note.find(query).lean().sort({ order: 1 });
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
    const searchTag = req.query.tag?.trim();
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
    const filteredNotes = decryptedNotes.filter(note => note.tag?.includes(searchTag.toLowerCase()));
    res.status(200).json(filteredNotes);
  } catch (error) {
    handleError(error, res, `Failed to find notes with label "${searchTag}". Please reload the page or try again`);
  }
});

// ROUTE 4: Add a new note for a user
router.post("/add-note", fetchuser, noteTextValidation, noteCategoryValidation, handleValidationErrors, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const {
        title, content, tag,
        isPinned = false,
        isArchived = false,
        isDeleted = false,
        colour = "default"
      } = req.body;
      // Encrypt fields
      const encryptedFields = encryptNote({ title, content, tag });
      // Build category filter for the target category
      const categoryFilter = {
        user: req.user.id,
        isPinned,
        isArchived,
        isDeleted
      };
      // Increment all existing notes' order by 1 to make room at the top
      await reorderNewCategoryNotes(categoryFilter, session);
      // Create note with order 0 (top position)
      const [note] = await Note.create([{
        user: req.user.id,
        title: encryptedFields.title,
        content: encryptedFields.content,
        tag: encryptedFields.tag,
        isPinned,
        isArchived,
        isDeleted,
        colour,
        order: 0  // Always place new notes at the top
      }], { session });
      // Return decrypted note
      const decryptedNote = decryptNote(note.toObject());
      res.status(201).json(decryptedNote);
    });
  } catch (error) {
    handleError(error, res, "Failed to add note. Please try again");
  } finally {
    await session.endSession();
  }
});

// ROUTE 5: Update an edited note for a user
router.put("/update-note/:id", fetchuser, noteCategoryValidation, colourValidation, handleValidationErrors, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
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
      const isNoteTextChanged = !(prevNote.title === updatedNote.title && prevNote.content === updatedNote.content);
      const isCategoryChanged = !(prevNote.isPinned === updatedNote.isPinned && prevNote.isArchived === updatedNote.isArchived && prevNote.isDeleted === updatedNote.isDeleted);
      if (isCategoryChanged) {
        if (updatedNote.isPinned) {
          // Updated Note is pinned
          await reorderNewCategoryNotes({
            user: req.user.id,
            isPinned: true,
            isArchived: false,
            isDeleted: false
          }, session);
        } else if (updatedNote.isArchived) {
          // Updated Note is archived
          await reorderNewCategoryNotes({
            user: req.user.id,
            isPinned: false,
            isArchived: true,
            isDeleted: false
          }, session);
        } else if (updatedNote.isDeleted) {
          // Updated Note is deleted
          await reorderNewCategoryNotes({
            user: req.user.id,
            isPinned: false,
            isArchived: false,
            isDeleted: true
          }, session);
        } else {
          // Updated Note is a regular note
          await reorderNewCategoryNotes({
            user: req.user.id,
            isPinned: false,
            isArchived: false,
            isDeleted: false
          }, session);
        }
        await reorderPreviousCategoryNotes(prevNote.order, {
          user: req.user.id,
          isPinned: prevNote.isPinned,
          isArchived: prevNote.isArchived,
          isDeleted: prevNote.isDeleted
        }, session);
        // Update note with validation
        await Note.findByIdAndUpdate(req.params.id, { $set: { ...updatedNote, order: 0 } }, { session, timestamps: isNoteTextChanged });
      } else {
        // Update note with validation

        await Note.findByIdAndUpdate(req.params.id, { $set: updatedNote }, { session, timestamps: isNoteTextChanged });
      }
    });
    res.status(200).json({ success: true });
  } catch (error) {
    handleError(error, res, "Failed to update note. Please try again");
  } finally {
    await session.endSession();
  }
});

// ROUTE 6: Toggle pin status of a note
router.put("/toggle-pin/:id", fetchuser, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      validateObjectId(req.params.id);
      const note = await Note.findById(req.params.id).session(session);
      checkNoteOwnership(note, req.user.id);
      const willBePinned = !note.isPinned;
      const pinnedCategoryFilter = {
        user: req.user.id,
        isPinned: true,
        isArchived: false,
        isDeleted: false
      }
      const updates = { isPinned: willBePinned, isArchived: false, isDeleted: false, order: 0 };
      // Handle conflicts and order updates
      if (willBePinned) {
        if (note.isArchived) {
          // Pinning: remove from archive, add note in pinned category
          await reorderNewCategoryNotes(pinnedCategoryFilter, session);
          await reorderPreviousCategoryNotes(note.order, {
            user: req.user.id,
            isPinned: false,
            isArchived: true,
            isDeleted: false
          }, session);
        } else {
          // Moving from regular to pinned, reorder regular notes
          await reorderNewCategoryNotes(pinnedCategoryFilter, session);
          await reorderPreviousCategoryNotes(note.order, {
            user: req.user.id,
            isPinned: false,
            isArchived: false,
            isDeleted: false
          }, session);
        }
      } else {
        // Unpinning: move to regular, reorder pinned category
        await reorderNewCategoryNotes({
          user: req.user.id,
          isPinned: false,
          isArchived: false,
          isDeleted: false
        }, session);
        await reorderPreviousCategoryNotes(note.order, pinnedCategoryFilter, session);
      }
      await Note.findByIdAndUpdate(req.params.id, { $set: updates }, { session, timestamps: false });
    });
    res.status(200).json({ success: true });
  } catch (error) {
    handleError(error, res, "Failed to toggle pin. Please try again");
  } finally {
    await session.endSession();
  }
});

// ROUTE 7: Toggle archive status of a note
router.put("/toggle-archive/:id", fetchuser, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      validateObjectId(req.params.id);
      const note = await Note.findById(req.params.id).session(session);
      checkNoteOwnership(note, req.user.id);
      const willBeArchived = !note.isArchived;
      const archivedCategoryFilter = {
        user: req.user.id,
        isPinned: false,
        isArchived: true,
        isDeleted: false
      }
      const updates = { isPinned: false, isArchived: willBeArchived, isDeleted: false, order: 0 };
      if (willBeArchived) {
        // Archiving: remove from pin, add note in archived category
        if (note.isPinned) {
          await reorderNewCategoryNotes(archivedCategoryFilter, session);
          await reorderPreviousCategoryNotes(note.order, {
            user: req.user.id,
            isPinned: true,
            isArchived: false,
            isDeleted: false
          }, session);
        } else {
          // Moving from regular to archived, reorder regular notes
          await reorderNewCategoryNotes(archivedCategoryFilter, session);
          await reorderPreviousCategoryNotes(note.order, {
            user: req.user.id,
            isPinned: false,
            isArchived: false,
            isDeleted: false
          }, session);
        }
      } else {
        // Unarchiving: move to regular, reorder archived category
        await reorderNewCategoryNotes({
          user: req.user.id,
          isPinned: false,
          isArchived: false,
          isDeleted: false
        }, session);
        await reorderPreviousCategoryNotes(note.order, archivedCategoryFilter, session);
      }
      await Note.findByIdAndUpdate(req.params.id, { $set: updates }, { session, timestamps: false });
    });
    res.status(200).json({ success: true });
  } catch (error) {
    handleError(error, res, "Failed to toggle archive. Please try again");
  } finally {
    await session.endSession();
  }
});

// ROUTE 8: Soft delete or restore a note
router.put("/toggle-delete/:id", fetchuser, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      validateObjectId(req.params.id);
      const note = await Note.findById(req.params.id).session(session);
      checkNoteOwnership(note, req.user.id);
      const willBeDeleted = !note.isDeleted;
      const deletedCategoryFilter = {
        user: req.user.id,
        isPinned: false,
        isArchived: false,
        isDeleted: true
      }
      const updates = { isPinned: false, isArchived: false, isDeleted: willBeDeleted, order: 0 };
      if (willBeDeleted) {
        // Deleting: remove from current category, get next order in deleted category
        if (note.isPinned) {
          await reorderNewCategoryNotes(deletedCategoryFilter, session);
          await reorderPreviousCategoryNotes(note.order, {
            user: req.user.id,
            isPinned: true,
            isArchived: false,
            isDeleted: false
          }, session);
        } else if (note.isArchived) {
          await reorderNewCategoryNotes(deletedCategoryFilter, session);
          await reorderPreviousCategoryNotes(note.order, {
            user: req.user.id,
            isPinned: false,
            isArchived: true,
            isDeleted: false
          }, session);
        } else {
          await reorderNewCategoryNotes(deletedCategoryFilter, session);
          await reorderPreviousCategoryNotes(note.order, {
            user: req.user.id,
            isPinned: false,
            isArchived: false,
            isDeleted: false
          }, session);
        }
      } else {
        // Restoring: move to regular, reorder deleted category
        await reorderNewCategoryNotes({
          user: req.user.id,
          isPinned: false,
          isArchived: false,
          isDeleted: false
        }, session);
        await reorderPreviousCategoryNotes(note.order, deletedCategoryFilter, session);
      }
      await Note.findByIdAndUpdate(req.params.id, { $set: updates }, { session, timestamps: false });
    });
    res.status(200).json({ success: true });
  } catch (error) {
    handleError(error, res, "Failed to toggle delete. Please try again");
  } finally {
    await session.endSession();
  }
});

// ROUTE 9: Permanently delete a soft deleted note from db
router.delete("/permanent-delete/:id", fetchuser, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      validateObjectId(req.params.id);
      const note = await Note.findById(req.params.id).session(session);
      checkNoteOwnership(note, req.user.id);
      if (!note.isDeleted) {
        return res.status(400).json({
          error: "Note must be moved to bin before permanent deletion"
        });
      }
      await Note.findByIdAndDelete(req.params.id).session(session);
      // Reorder remaining deleted notes
      await reorderPreviousCategoryNotes(note.order, {
        user: req.user.id,
        isPinned: false,
        isArchived: false,
        isDeleted: true
      }, session);
    });
    res.status(200).json({ success: true });
  } catch (error) {
    handleError(error, res, "Failed to permanently delete note. Please try again");
  } finally {
    await session.endSession();
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

// ROUTE 11: Reorder notes after drag and drop rearrangement
router.put("/reorder", fetchuser, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const { rearrangedNotes, category } = req.body;
    // Input validation
    if (!Array.isArray(rearrangedNotes) || rearrangedNotes.length === 0) {
      return res.status(400).json({
        error: "rearrangedNotes must be a non-empty array"
      });
    }
    if (!ALLOWED_CATEGORIES.includes(category)) {
      return res.status(400).json({
        error: `Invalid category. Must be one of: ${ALLOWED_CATEGORIES.join(', ')}`,
        allowedCategories: ALLOWED_CATEGORIES
      });
    }
    // Prevent reordering deleted notes
    if (category === 'deleted') {
      return res.status(400).json({
        error: "Reordering is not allowed for deleted notes"
      });
    }
    // Limit batch size to prevent abuse
    if (rearrangedNotes.length > 1000) {
      return res.status(400).json({
        error: "Cannot reorder more than 1000 notes at once",
        provided: rearrangedNotes.length,
        maximum: 1000
      });
    }
    await session.withTransaction(async () => {
      // Extract and validate note IDs
      const noteIds = rearrangedNotes.map(n => n._id);
      // Check for duplicate IDs
      const uniqueIds = new Set(noteIds);
      if (uniqueIds.size !== noteIds.length) {
        throw new Error("Duplicate note IDs found in rearranged notes");
      }
      // Validate ObjectId format
      noteIds.forEach(validateObjectId);
      // Build category filter
      const categoryFilter = {
        _id: { $in: noteIds },
        user: req.user.id,
        isDeleted: false // Ensure we don't reorder deleted notes
      };
      // Add category-specific filters
      if (category === "regular") {
        categoryFilter.isPinned = false;
        categoryFilter.isArchived = false;
      } else if (category === "pinned") {
        categoryFilter.isPinned = true;
      } else if (category === "archived") {
        categoryFilter.isArchived = true;
      }
      // Verify all notes exist and belong to user
      const existingNotes = await Note.find(categoryFilter).session(session);
      if (existingNotes.length !== noteIds.length) {
        const foundIds = existingNotes.map(n => n._id.toString());
        const missingIds = noteIds.filter(id => !foundIds.includes(id));
        throw new Error(`Some notes not found or access denied. Missing IDs: ${missingIds.join(', ')}`);
      }
      // Prepare bulk operations
      const bulkOperations = noteIds.map((id, index) => ({
        updateOne: {
          filter: { _id: id },
          update: { $set: { order: index } }
        }
      }));
      const result = await Note.bulkWrite(bulkOperations, { session });
      if (result.modifiedCount !== noteIds.length) {
        throw new Error(`Expected to update ${noteIds.length} notes, but only updated ${result.modifiedCount}`);
      }
    });
    res.status(200).json({ success: true });
  } catch (error) {
    // Handle specific error types with appropriate status codes
    const clientErrors = [
      'Duplicate note IDs',
      'Invalid note ID format',
      'Some notes not found',
      'access denied',
      'Cannot reorder deleted notes',
      'Reordering is not allowed'
    ];
    const isClientError = clientErrors.some(err =>
      error.message.toLowerCase().includes(err.toLowerCase())
    );
    if (isClientError) {
      return res.status(400).json({ error: error.message });
    }
    handleError(error, res, "Failed to reorder notes");
  } finally {
    await session.endSession();
  }
});

export default router;