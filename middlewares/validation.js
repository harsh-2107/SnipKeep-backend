import { body, validationResult } from 'express-validator';
import mongoose from 'mongoose';
import { Tag } from "../models/Tag.js";
import { decrypt } from "../utils/encryption.js";

// CONSTANTS
const ALLOWED_COLOURS = ["default", "coral", "peach", "sand", "mint", "sage", "fog", "storm", "dusk", "blossom", "clay", "chalk"];
const MAX_TITLE_LENGTH = 180;
const MAX_CONTENT_LENGTH = 30000;
const MAX_TAG_LENGTH = 10;
const MAX_TAGS_COUNT = 50;

// Validate note object id
export const validateObjectId = (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Invalid note ID format");
  }
};

// Check note ownership
export const checkNoteOwnership = (note, userId) => {
  if (!note) {
    throw new Error("Note not found");
  }
  if (note.user.toString() !== userId) {
    throw new Error("Access denied");
  }
};

// Validate note title and content
export const noteTextValidation = body().custom((value, { req }) => {
  const { title, content } = req.body;
  // Check that at least title or content is provided
  if (!title?.trim() && !content?.trim()) {
    throw new Error("Either title or content is required");
  }
  // Validate title length
  if (title && title.length > MAX_TITLE_LENGTH) {
    throw new Error(`Title cannot exceed ${MAX_TITLE_LENGTH} characters`);
  }
  // Validate content length
  if (content && content.length > MAX_CONTENT_LENGTH) {
    throw new Error(`Content cannot exceed ${MAX_CONTENT_LENGTH} characters`);
  }
  return true;
});

// Validate tag string
export const tagStringValidation = body("name")
  .exists({ checkFalsy: true })
  .withMessage("Label can't be an empty string")
  .isString()
  .withMessage("Label must be a string")
  .trim()
  .isLength({ min: 1, max: 10 })
  .withMessage("Label must be a non empty string with not more than 10 characters");

// Validate 
export const tagArrayValidation = body().custom(async (value, { req }) => {
  const { tag } = req.body;
  if (tag !== undefined) {
    if (Array.isArray(tag)) {
      if (tag.length > MAX_TAGS_COUNT) {
        throw new Error(`Maximum ${MAX_TAGS_COUNT} tags allowed`);
      }
      const invalidTags = tag.filter(t =>
        !t || typeof t !== 'string' || t.trim().length === 0 || t.length > MAX_TAG_LENGTH
      );
      if (invalidTags.length > 0) {
        throw new Error(`Each lebel must be a non-empty string with maximum ${MAX_TAG_LENGTH} characters`);
      }
      const globalTagObjs = await Tag.find({ user: req.user.id }).lean();
      // Extract and decrypt the tag strings from each document
      const globalTags = globalTagObjs.map(tagObj => decrypt(tagObj.name));
      // Check if all provided tags exist in the user's global tags
      for (const t of tag) {
        if (!globalTags.includes(t.trim())) {
          throw new Error("Label should be added first before use");
        }
      }
    } else {
      throw new Error("Invalid tag format");
    }
  }
  return true;
});

// Validation rules for note card colour
export const colourValidation = body().custom((value, { req }) => {
  const { colour } = req.body;
  if (colour && !ALLOWED_COLOURS.includes(colour)) {
    throw new Error(`Invalid colour. Must be one of: ${ALLOWED_COLOURS.join(', ')}`);
  }
  return true;
});

// Return 'Bad request' response for validation errors
export const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: errors.array()[0].msg,
      field: errors.array()[0].param
    });
  }
  next();
};