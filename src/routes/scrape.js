import { Router } from 'express'
// import { scrapeByBrand } from '../controllers/scrapeController.js'
import { scrapeHelikon } from '../controllers/helikonController.js'

const router = Router()

// Example: /api/scrape/helikon?sku=1234
router.post('/helikon', scrapeHelikon)
// router.post('/', scrapeByBrand)

export default router
