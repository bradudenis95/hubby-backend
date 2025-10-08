import * as helikonScraper from '../services/scraping/helikonScraper.js'

export const scrapeHelikon = async (req, res) => {
    console.log(`[helikonController] Received request to scrape Helikon product`);
    console.log(`[helikonController] Request body:`, req.body);

    const { sku, url } = req.body
    console.log(`[helikonController] Extracted parameters - SKU: ${sku}, URL: ${url}`);

    try {
        console.log(`[helikonController] Calling helikonScraper.scrapeProduct...`);
        let result = await helikonScraper.scrapeProduct(sku, url)
        console.log(`[helikonController] Scraping completed successfully`);
        console.log(`[helikonController] Result summary - Name: ${result.name}, Variants: ${result.variants?.length || 0}`);

        res.json(result)
    } catch (err) {
        console.error(`[helikonController] Error occurred:`, err.message);
        console.error(`[helikonController] Error stack:`, err.stack);
        res.status(500).json({ error: err.message })
    }
}
