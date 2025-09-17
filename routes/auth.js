import express from "express"
import { User } from "../models/User.js"
import { body, validationResult } from 'express-validator';
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken"
import fetchuser from "../middlewares/fetchuser.js";

const router = express.Router();

// Validate user credentials
const userNameRules = [body('name', 'Please enter a valid name').trim().notEmpty().bail().isLength({ min: 2, max: 15 }).bail().matches(/^[A-Za-z\s]+$/)]

const credentialRules = [
    body('email', 'Please enter a valid email').isEmail(),
    body('password', 'Password must be at least 6 characters and include an uppercase letter, a number, and a special character').isLength({ min: 6 }).bail().matches(/[A-Z]/).bail().matches(/\d/).bail().matches(/[@$!%*?&#]/)
];

const passwordRules = [
  body('newPassword', 'Password must be at least 6 characters and include an uppercase letter, a number, and a special character').isLength({ min: 6 }).bail().matches(/[A-Z]/).bail().matches(/\d/).bail().matches(/[@$!%*?&#]/)
];

// ROUTE 1: Handle route for creating a new user account
router.post('/create-account', userNameRules.concat(credentialRules), async (req, res) => {
    // Return bad request and error if the credentials don't satisfy the validation rules
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array() });
    }
    try {
        // Check if a user with the given email already exists
        let user = await User.findOne({ email: req.body.email });
        if (user) {
            return res.status(400).json({ error: "An account with this email already exists. Please log in instead." });
        }
        // Hash user password using bcryptjs
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(req.body.password, salt);
        // Create a new user
        user = await User.create({
            name: req.body.name,
            email: req.body.email,
            password: hash
        });
        // Sign the jwt web token
        const userData = { user: { id: user.id } };
        const authtoken = jwt.sign(userData, process.env.JWT_SECRET); // jwt.sign() is a sync function
        // Send the authtoken
        res.status(201).json({ authtoken });
    } catch (error) {
        res.status(500).json({ error: "Failed to create account. Please try again." });
    }
})

// ROUTE 2: Handle route for logging in user
router.post('/login', credentialRules, async (req, res) => {
    // Return bad request and error if the credentials don't satisfy the validation rules
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array() });
    }
    try {
        // Check if a user with the given email exists
        let user = await User.findOne({ email: req.body.email });
        if (!user) {
            return res.status(404).json({ error: "Please check your credentials or try again." });
        }
        // Check password from db and return authtoken
        if (await bcrypt.compare(req.body.password, user.password)) {
            // Sign the jwt web token
            const userData = { user: { id: user.id } };
            const authtoken = jwt.sign(userData, process.env.JWT_SECRET); // jwt.sign() is a sync function
            // Send the authtoken
            res.status(200).json({ authtoken });
        } else {
            return res.status(401).json({ error: "Please check your credentials or try again." });
        }
    } catch (error) {
        res.status(500).json({ error: "Login failed. Please try again." });
    }
})

// ROUTE 3: Get logged in user details
router.post('/get-user', fetchuser, async (req, res) => {
    try {
        const userId = req.user.id;
        const user = await User.findById(userId).select("-password").lean();
        res.status(200).json(user);
    } catch (error) {
        res.status(500).json({ error: "Failed to get user details" });
    }
})

// ROUTE 4: Change user's name
router.post('/change-username', fetchuser, async (req, res) => {
    try {
        const userId = req.user.id;
        const updates = { name: req.body.newName.trim() }
        const updatedUser = await User.findByIdAndUpdate(userId, { $set: updates }, { new: true }).select("-password");
        res.status(200).json(updatedUser);
    } catch (error) {
        res.status(500).json({ error: "Failed to update name. Please try again." });
    }
})

// ROUTE 5: Change user's password
router.post('/change-password', fetchuser, passwordRules, async (req, res) => {
    try {
        const userId = req.user.id;
        const user = await User.findById(userId);
        if (await bcrypt.compare(req.body.oldPassword, user.password)) {
            const salt = await bcrypt.genSalt(10);
            const newPasswordHash = await bcrypt.hash(req.body.newPassword, salt);
            const updates = { password: newPasswordHash }
            const updatedUser = await User.findByIdAndUpdate(userId, { $set: updates }, { new: true }).select("-password");
            res.status(200).json(updatedUser);
        } else {
            return res.status(400).json({ error: "Old password is incorrect" });
        }
    } catch (error) {
        res.status(500).json({ error: "Failed to update password. Please try again." });
    }
})

export default router;