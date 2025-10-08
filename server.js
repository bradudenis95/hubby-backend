import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import routes from './src/routes/index.js'

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json())

// API routes
app.use('/api', routes)

const PORT = process.env.PORT || 4000
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`))
