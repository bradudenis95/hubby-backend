import * as helikonScraper from '../services/scraping/helikonScraper.js'

export const scrapeByBrand = async (req, res) => {
    const { brand, sku, url } = req.body

    try {
        let result
        switch (brand.toLowerCase()) {
            case 'helikon':
                result = await helikonScraper.scrapeProduct(sku, url)
                break
            // add more brands here
            default:
                return res.status(400).json({ error: 'Unsupported brand' })
        }

        res.json(result)
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
}
