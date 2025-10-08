import { Router } from 'express'
import productRoutes from './products.js'
import scrapeRoutes from './scrape.js'

const router = Router()

router.use('/products', productRoutes)
router.use('/scrape', scrapeRoutes)

export default router
