import jwt from "jsonwebtoken"

// Middleware to fetch user
const fetchuser = (req, res, next) => {
    // Store the authtoken sent in header
    const token = req.header("auth-token");
    if (!token) {
        res.status(401).send({ error: "Please authenticate using a valid token" });
    }
    try {
        // Verify if the token is valid
        const data = jwt.verify(token, process.env.JWT_SECRET);
        req.user = data.user; // Attach the user ID from token payload to the request object
        next();
    } catch (error) {
        res.status(401).send({ error: "Please authenticate using a valid token" });
    }
}

export default fetchuser;