import crypto from 'crypto';
import dotenv from "dotenv";

dotenv.config()
const algorithm = 'aes-256-cbc';
const secretKey = process.env.NOTE_SECRET_KEY;
const iv = process.env.NOTE_IV;

export const encrypt = (text) => {
  const cipher = crypto.createCipheriv(algorithm, secretKey, iv);
  let encrypted = cipher.update(text, 'utf-8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
};

export const decrypt = (encryptedText) => {
  const decipher = crypto.createDecipheriv(algorithm, secretKey, iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf-8');
  decrypted += decipher.final('utf-8');
  return decrypted;
};