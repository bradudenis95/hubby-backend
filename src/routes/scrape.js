import { Router } from 'express'
import { scrapeByBrand } from '../controllers/scrapeController.js'

const router = Router()

// Example: /api/scrape/helikon?sku=1234
router.post('/', scrapeByBrand)

export default router
