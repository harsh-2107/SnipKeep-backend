import express from "express"
import cors from "cors"
import mongoose from "mongoose"
import dotenv from "dotenv"
import authRouter from "./routes/auth.js"
import notesRouter from "./routes/notes.js"
import tagsRouter from "./routes/tags.js"

dotenv.config()
await mongoose.connect(process.env.MONGO_URI)

const app = express()
const port = process.env.PORT || 3000

app.use(express.json());
app.use(cors());
app.use('/api/auth', authRouter);
app.use('/api/notes', notesRouter);
app.use('/api/tags', tagsRouter);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})