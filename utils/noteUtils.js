import { encrypt, decrypt } from "../utils/encryption.js";

// Decrypt note contents
export const decryptNote = (note) => ({
  ...note,
  title: decrypt(note.title),
  content: decrypt(note.content),
  tag: note.tag?.map(t => decrypt(t)) || []
});

// Encrypt note contents
export const encryptNote = (noteData) => {
  const encrypted = {};
  if (noteData.title !== undefined) {
    encrypted.title = noteData.title ? encrypt(noteData.title) : encrypt("");
  }
  if (noteData.content !== undefined) {
    encrypted.content = noteData.content ? encrypt(noteData.content) : encrypt("");
  }
  if (noteData.tag !== undefined) {
    const tagsArray = Array.isArray(noteData.tag) ? noteData.tag : [noteData.tag];
    encrypted.tag = tagsArray.filter(t => t && t.trim()).map(t => encrypt(t));
  }
  return encrypted;
};

// Built a category filter query for searching notes 
export const buildCategoryFilter = (filter, userId) => {
  const query = { user: userId };
  if (filter === "pinned") {
    query.isPinned = true;
  } else if (filter === "archived") {
    query.isArchived = true;
  } else if (filter === "deleted") {
    query.isDeleted = true;
  } else {
    // Default/regular notes - not pinned, archived or deleted
    query.isPinned = false;
    query.isArchived = false;
    query.isDeleted = false;
  }
  return query;
};

// Send response with relevent status code based on error message
export const handleError = (error, res, defaultMessage) => {
  const statusMap = {
    "Invalid note ID format": 400,
    "Note not found": 404,
    "Access denied": 403,
    "Validation failed": 400
  };
  const status = statusMap[error.message] || 500;

  res.status(status).json({
    error: error.message || defaultMessage
  });
};

// Find all notes in the previous category with order greater than 'noteOrder' and decrease them by 1
export const reorderPreviousCategoryNotes = async (noteOrder, categoryFilter, session) => {
  await Note.updateMany({
    ...categoryFilter,
    order: { $gt: noteOrder }
  },
    { $dec: { order: 1 } },
    { session, timestamps: false }
  );
};

// Find all notes in the new category and increase their order by 1
export const reorderNewCategoryNotes = async (categoryFilter, session) => {
  await Note.updateMany(
    categoryFilter,
    { $inc: { order: 1 } },
    { session, timestamps: false }
  );
};