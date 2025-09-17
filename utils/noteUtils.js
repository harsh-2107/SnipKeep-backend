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
    encrypted.tag = noteData.tag?.filter(t => t && t.trim()).map(t => encrypt(t));
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