import express from "express"
import { Note } from "../models/Note.js"
import { body, validationResult } from 'express-validator';
import fetchuser from "../middlewares/fetchuser.js";
import { encrypt, decrypt } from "../utils/encryption.js";

const router = express.Router();

// Validation rules for title and content
const noteValidationRules = body().custom((value, { req }) => {
    const { title, content, tag } = req.body;
    // Check that at least title or content is provided
    if (!title?.trim() && !content?.trim()) {
        throw new Error("Either title or content is required.");
    }

    // Validate tag if provided
    if (tag !== undefined) {
        if (Array.isArray(tag)) {
            const allStrings = tag.every(t => typeof t === 'string' && t.trim().length > 0);
            if (!allStrings) {
                throw new Error("Each tag must be a non-empty string.");
            }
        } else if (typeof tag !== 'string' || tag.trim().length === 0) {
            throw new Error("Tag must be a non-empty string or an array of non-empty strings.");
        }
    }

    return true;
});

// Validation rules for isPinned, isArchived and isDeleted
const exclusiveNoteRules = body().custom((value, { req }) => {
    const { isPinned, isArchived, isDeleted } = req.body;
    const trueCount = [isPinned, isArchived, isDeleted].filter(Boolean).length;
    if (trueCount > 1) {
        throw new Error("A note can only be pinned, archived or deleted — not more than one at a time.");
    }
    return true;
});

// ROUTE 1: Fetch all notes of a user with optional filter (pinned, archived, deleted)
router.get("/fetch-notes", fetchuser, async (req, res) => {
    let query = { user: req.user.id };
    switch (req.query.filter) {
        case "pinned":
            query.isPinned = true;
            break;
        case "archived":
            query.isArchived = true;
            break;
        case "deleted":
            query.isDeleted = true;
            break;
        default:
            // If no specific filter is applied, fetch only regular notes (not pinned, archived, or deleted)
            query.isPinned = false;
            query.isArchived = false;
            query.isDeleted = false;
    }
    try {
        // Fetch notes matching the searchText, sorted by most recently updated first
        let notes = await Note.find(query).lean().sort({ updatedAt: -1 });
        // Decrypt note title, content and tag
        notes = notes.map(note => ({
            ...note,
            title: decrypt(note.title),
            content: decrypt(note.content),
            tag: note.tag.map(t => decrypt(t))
        }));
        res.status(200).json(notes);
    } catch (err) {
        res.status(500).json({ error: "Internal server error" });
    }
})

// ROUTE 2: Search notes by title, content, or tag
router.get("/search", fetchuser, async (req, res) => {
    const searchText = req.query.text?.toLowerCase().trim();
    // Return empty array if searchText is empty
    if (!searchText) {
        res.status(200).json([]);
    }
    try {
        let notes = await Note.find({ user: req.user.id, isDeleted: false }).lean().sort({ updatedAt: -1 });
        // Decrypt the notes
        notes = notes.map(note => ({
            ...note,
            title: decrypt(note.title),
            content: decrypt(note.content),
            tag: note.tag?.map(t => decrypt(t)) || []
        }));
        // Filter notes that contain searchText in title, content or tag
        let filteredNotes = notes.filter(note => {
            const isTitle = note.title.toLowerCase().trim().includes(searchText);
            const isContent = note.content.toLowerCase().trim().includes(searchText);
            const isTag = note.tag?.some(t => t.toLowerCase().trim().includes(searchText));
            return isTitle || isContent || isTag;
        });
        res.status(200).json(filteredNotes);
    } catch (err) {
        res.status(500).json({ error: "Internal server error" });
    }
})

// ROUTE 3: Add a new note for a user
router.post("/add-note", fetchuser, [noteValidationRules, exclusiveNoteRules], async (req, res) => {
    // Return bad request and error if the note doesn't satisfy the validation rules
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    try {
        const { title, content, tag, isPinned, isArchived, isDeleted } = req.body;
        // Encrypt title, content and tag, if present
        const encryptedTitle = title ? encrypt(title) : '';
        const encryptedContent = content ? encrypt(content) : '';
        const encryptedTags = Array.isArray(tag) ?
            tag.map(t => encrypt(t)) : typeof (tag) === 'string' ? [encrypt(tag)] : [];
        const note = await Note.create({
            user: req.user.id,
            title: encryptedTitle,
            content: encryptedContent,
            tag: encryptedTags,
            isPinned, isArchived, isDeleted
        });
        res.status(201).json(note);
    } catch (err) {
        res.status(500).json({ error: "Internal server error" });
    }
})

// ROUTE 4: Update an edited note for a user
router.put("/update-note/:id", fetchuser, [exclusiveNoteRules], async (req, res) => {
    // Return bad request and error if the note doesn't satisfy the validation rules
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    let note = await Note.findById(req.params.id);
    // Return Not Found error if note with the given id doesn't exist
    if (!note) {
        return res.status(404).json({ error: "Not Found" });
    }
    // Return unauthorized and error if the note doesn't belong to the user
    if (note.user.toString() !== req.user.id) {
        return res.status(403).json({ error: "Forbidden: You do not have permission to access this note" });
    }
    try {
        // Add all fields that exist in both req.body and allowedFields to updates
        const allowedFields = ['title', 'content', 'tag', 'isPinned', 'isArchived', 'isDeleted'];
        const updates = Object.fromEntries(
            Object.entries(req.body)
                .filter(([key, value]) => allowedFields.includes(key) && value !== undefined)
        );
        // Encrypt title, content and tag before updating, if present
        if (updates.title) { updates.title = encrypt(updates.title) }
        if (updates.content) { updates.content = encrypt(updates.content) }
        if (updates.tag) {
            const tagsArray = Array.isArray(updates.tag) ? updates.tag : [updates.tag];
            updates.tag = tagsArray.map(t => encrypt(t));
        }
        note = await Note.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true });
        res.status(200).json(note);
    } catch (err) {
        res.status(500).json({ error: "Internal server error" });
    }
})

// ROUTE 5: Toggle pin status of a note
router.put("/toggle-pin/:id", fetchuser, async (req, res) => {
    let note = await Note.findById(req.params.id);
    // Return Not Found error if note with the given id doesn't exist
    if (!note) {
        return res.status(404).json({ error: "Not Found" });
    }
    // Return unauthorized and error if the note doesn't belong to the user
    if (note.user.toString() !== req.user.id) {
        return res.status(403).json({ error: "Forbidden: You do not have permission to access this note" });
    }
    try {
        let updates = {};
        if (note.isPinned) {
            updates.isPinned = false; // Unpin note if pinned
        } else {
            updates.isPinned = true;
            if (note.isArchived) { updates.isArchived = false; } // Unarchive note if archived
        }
        note = await Note.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true });
        res.status(200).json(note);
    } catch (err) {
        res.status(500).json({ error: "Internal server error" });
    }
})

// ROUTE 6: Toggle archive status of a note
router.put("/toggle-archive/:id", fetchuser, async (req, res) => {
    let note = await Note.findById(req.params.id);
    // Return Not Found error if note with the given id doesn't exist
    if (!note) {
        return res.status(404).json({ error: "Not Found" });
    }
    // Return unauthorized and error if the note doesn't belong to the user
    if (note.user.toString() !== req.user.id) {
        return res.status(403).json({ error: "Forbidden: You do not have permission to access this note" });
    }
    try {
        let updates = {};
        if (note.isArchived) {
            updates.isArchived = false; // Unarchive note if archived
        } else {
            updates.isArchived = true;
            if (note.isPinned) { updates.isPinned = false; } // Unpin note if pinned
        }
        note = await Note.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true });
        res.status(200).json(note);
    } catch (err) {
        res.status(500).json({ error: "Internal server error" });
    }
})

// ROUTE 7: Soft delete or restore a note
router.put("/toggle-delete/:id", fetchuser, async (req, res) => {
    let note = await Note.findById(req.params.id);
    // Return Not Found error if note with the given id doesn't exist
    if (!note) {
        return res.status(404).json({ error: "Not Found" });
    }
    // Return unauthorized and error if the note doesn't belong to the user
    if (note.user.toString() !== req.user.id) {
        return res.status(403).json({ error: "Forbidden: You do not have permission to access this note" });
    }
    try {
        let updates = {};
        if (note.isDeleted) {
            updates.isDeleted = false;
        } else {
            updates.isDeleted = true;
            updates.isPinned = false;
            updates.isArchived = false;
        }
        note = await Note.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true });
        res.status(200).json(note);
    } catch (err) {
        res.status(500).json({ error: "Internal server error" });
    }
})

// ROUTE 8: Permanently delete a soft deleted a note from db
router.delete("/permanent-delete/:id", fetchuser, async (req, res) => {
    let note = await Note.findById(req.params.id);
    // Return Not Found error if note with the given id doesn't exist
    if (!note) {
        return res.status(404).json({ error: "Not Found" });
    }
    // Return unauthorized and error if the note doesn't belong to the user
    if (note.user.toString() !== req.user.id) {
        return res.status(403).json({ error: "Forbidden: You do not have permission to access this note" });
    }
    try {
        if (note.isDeleted) {
            note = await Note.findByIdAndDelete(req.params.id);
            res.status(200).json({ message: "Note permanently deleted" });
        } else {
            res.status(409).json({ error: "Note must be moved to bin (soft deleted) before permanent deletion" });
        }
    } catch (err) {
        res.status(500).json({ error: "Internal server error" });
    }
})

export default router;