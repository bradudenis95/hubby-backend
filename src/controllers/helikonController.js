import * as helikonScraper from '../services/scraping/helikonScraper.js'

export const scrapeHelikon = async (req, res) => {
    const { sku, url } = req.body

    try {
        let result
        result = await helikonScraper.scrapeProduct(sku, url)

        res.json(result)
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
}
