import axios from 'axios'
import * as cheerio from 'cheerio'

async function getHtml(url, retries = 3) {
    console.log(`[getHtml] Making request to: ${url} (attempt ${4 - retries}/3)`);

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const res = await axios.get(url, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.5",
                    "Accept-Encoding": "gzip, deflate, br",
                    "Connection": "keep-alive",
                    "Upgrade-Insecure-Requests": "1",
                    "Cache-Control": "no-cache",
                    "Pragma": "no-cache"
                },
                maxRedirects: 3, // Reduced redirects to prevent loops
                timeout: 30000, // 30 second timeout
                validateStatus: function (status) {
                    return status >= 200 && status < 300; // Only resolve for 2xx status codes
                },
                followRedirects: true, // Explicitly enable redirect following
                maxContentLength: 50 * 1024 * 1024, // 50MB max content length
                decompress: true // Enable automatic decompression
            });
            console.log(`[getHtml] Success on attempt ${attempt}, status: ${res.status}, content length: ${res.data.length}`);
            console.log(`[getHtml] Final URL after redirects: ${res.request.res.responseUrl || url}`);
            return res.data;
        } catch (error) {
            console.error(`[getHtml] Attempt ${attempt} failed:`, error.message);
            console.error(`[getHtml] Error code:`, error.code);

            // If it's a redirect error, try with different settings
            if (error.code === 'ERR_FR_TOO_MANY_REDIRECTS') {
                console.log(`[getHtml] Redirect loop detected, trying with no redirects...`);
                try {
                    const res = await axios.get(url, {
                        headers: {
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                            "Accept-Language": "en-US,en;q=0.5",
                            "Accept-Encoding": "gzip, deflate, br",
                            "Connection": "keep-alive",
                            "Upgrade-Insecure-Requests": "1"
                        },
                        maxRedirects: 0, // No redirects
                        timeout: 30000,
                        validateStatus: function (status) {
                            return status >= 200 && status < 400; // Accept redirects but don't follow them
                        },
                        followRedirects: false
                    });
                    console.log(`[getHtml] Success with no redirects, status: ${res.status}`);
                    return res.data;
                } catch (noRedirectError) {
                    console.error(`[getHtml] No redirect approach also failed:`, noRedirectError.message);
                }
            }

            if (attempt === retries) {
                console.error(`[getHtml] All ${retries} attempts failed for URL: ${url}`);
                throw error;
            }
            console.log(`[getHtml] Retrying in 2 seconds...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

async function getSoupAndHtml(url) {
    try {
        const html = await getHtml(url);
        const $ = cheerio.load(html);
        return { $, html };
    } catch (error) {
        if (error.code === 'ERR_FR_TOO_MANY_REDIRECTS') {
            throw new Error(`Too many redirects for URL: ${url}. The website may have redirect loops.`);
        } else if (error.code === 'ECONNABORTED') {
            throw new Error(`Request timeout for URL: ${url}`);
        } else if (error.response) {
            throw new Error(`HTTP ${error.response.status}: ${error.response.statusText} for URL: ${url}`);
        } else {
            throw new Error(`Network error for URL: ${url}: ${error.message}`);
        }
    }
}

// ---------- Text fields ----------
function extractName($) {
    const tag = $("span[data-ui-id='page-title-wrapper']");
    return tag.text().trim() || null;
}

function extractDescription($) {
    const sec = $("section#description");
    if (!sec.length) return null;
    const prose = sec.find("div.prose");
    return prose.text().trim() || null;
}

function extractSpec($) {
    const out = {};
    $("section#product\\.specification div").each((_, el) => {
        const txt = $(el).text().trim();
        if (txt.includes(":")) {
            const [k, v] = txt.split(":", 2);
            out[k.trim()] = v.trim();
        }
    });
    return out;
}

function extractMaterials($) {
    const out = {};
    $("section#product\\.materials div").each((_, el) => {
        const txt = $(el).text().trim();
        if (txt.includes(":")) {
            const [k, v] = txt.split(":", 2);
            out[k.trim()] = v.trim();
        }
    });
    return out;
}

function extractBasePrice($) {
    const tag = $("[data-price-amount]").first();
    if (tag.length) return tag.attr("data-price-amount");
    const el = $("span.price").first();
    return el.text().trim() || null;
}

// ---------- Images ----------
function extractInitialImages(html) {
    const m = html.match(/"initialImages"\s*:\s*(\[[\s\S]*?\])/);
    if (!m) return [];
    let arr;
    try {
        arr = JSON.parse(m[1]);
    } catch {
        return [];
    }
    const urls = arr.map(
        (o) => o.full_webp || o.full || o.img || o.img_webp
    ).filter(Boolean);
    // deduplicate
    return [...new Set(urls)];
}

// ---------- Configurable options ----------
function parseConfigurableJson(html) {
    const regex = /initConfigurableOptions\(/g;
    let match;
    while ((match = regex.exec(html))) {
        const text = html.slice(match.index);
        const comma = text.indexOf(",");
        if (comma === -1) continue;
        const jstart = text.indexOf("{", comma);
        if (jstart === -1) continue;

        let depth = 0, inStr = false, esc = false, end = null;
        for (let i = jstart; i < jstart + 200000 && i < text.length; i++) {
            const ch = text[i];
            if (inStr) {
                if (esc) esc = false;
                else if (ch === "\\") esc = true;
                else if (ch === '"') inStr = false;
            } else {
                if (ch === '"') inStr = true;
                else if (ch === "{") depth++;
                else if (ch === "}") {
                    depth--;
                    if (depth === 0) {
                        end = i + 1;
                        break;
                    }
                }
            }
        }
        if (!end) continue;
        const js = text.slice(jstart, end);
        try {
            return JSON.parse(js);
        } catch {
            continue;
        }
    }
    return null;
}

function buildVariantsFromCfg(cfg) {
    const variants = [];

    // color labels
    const colorMap = {};
    for (const [attrId, attr] of Object.entries(cfg.attributes || {})) {
        if (attr.code === "color") {
            for (const opt of attr.options || []) {
                colorMap[opt.id] = opt.label;
            }
        }
    }

    const skuMap = cfg.sku || {};
    const imagesMap = cfg.images || {};
    const priceMap = cfg.optionPrices || {};
    const index = cfg.index || {};

    for (const [pid, attrs] of Object.entries(index)) {
        const sku = skuMap[pid];
        let colorId = null;
        if (typeof attrs === "object") {
            const vals = Object.values(attrs);
            colorId = vals.length ? vals[0] : null;
        }
        const color = colorId ? colorMap[colorId] : null;

        let price = null;
        if (priceMap[pid]?.finalPrice) {
            price = priceMap[pid].finalPrice.amount;
        }

        let mainImage = null;
        const extra = [];
        for (const img of imagesMap[pid] || []) {
            const u = img.full_webp || img.full || img.img || img.img_webp;
            if (u) {
                if (!mainImage) mainImage = u;
                else extra.push(u);
            }
        }

        variants.push({
            sku,
            color,
            price,
            availability: null,
            main_image: mainImage,
            images: extra,
        });
    }

    return variants;
}

// ---------- Main Scraper ----------
export async function scrapeSingleProduct(url) {
    console.log(`[scrapeSingleProduct] Starting to scrape product from: ${url}`);

    try {
        const { $, html } = await getSoupAndHtml(url);
        console.log(`[scrapeSingleProduct] Successfully loaded HTML and Cheerio`);

        const data = { productUrl: url };
        console.log(`[scrapeSingleProduct] Extracting product name...`);
        data.name = extractName($);
        console.log(`[scrapeSingleProduct] Product name: ${data.name}`);

        console.log(`[scrapeSingleProduct] Extracting description...`);
        data.description = extractDescription($);
        console.log(`[scrapeSingleProduct] Description length: ${data.description ? data.description.length : 0}`);

        console.log(`[scrapeSingleProduct] Extracting specifications...`);
        data.specification = extractSpec($);
        console.log(`[scrapeSingleProduct] Specifications:`, data.specification);

        console.log(`[scrapeSingleProduct] Extracting materials...`);
        data.materials = extractMaterials($);
        console.log(`[scrapeSingleProduct] Materials:`, data.materials);

        console.log(`[scrapeSingleProduct] Extracting price...`);
        data.price = extractBasePrice($);
        console.log(`[scrapeSingleProduct] Price: ${data.price}`);

        console.log(`[scrapeSingleProduct] Extracting images...`);
        const gallery = extractInitialImages(html);
        console.log(`[scrapeSingleProduct] Found ${gallery.length} images`);
        data.main_image = gallery[0] || null;
        data.images = gallery.length > 1 ? gallery.slice(1) : [];

        console.log(`[scrapeSingleProduct] Parsing configurable options...`);
        const cfg = parseConfigurableJson(html);
        if (cfg) {
            console.log(`[scrapeSingleProduct] Found configurable options, building variants...`);
            data.variants = buildVariantsFromCfg(cfg);
            console.log(`[scrapeSingleProduct] Built ${data.variants.length} variants`);
        } else {
            console.log(`[scrapeSingleProduct] No configurable options, creating single variant...`);
            const sku = data.specification?.SKU;
            data.variants = [
                {
                    sku,
                    color: null,
                    price: data.price,
                    availability: null,
                    main_image: data.main_image,
                },
            ];
            console.log(`[scrapeSingleProduct] Created single variant with SKU: ${sku}`);
        }

        console.log(`[scrapeSingleProduct] Scraping completed successfully for: ${data.name}`);
        return data;
    } catch (error) {
        console.error(`[scrapeSingleProduct] Error scraping product from ${url}:`, error.message);
        throw error;
    }
}

// ---------- Find URL by SKU ----------
export async function findUrlBySku(sku) {
    console.log(`[findUrlBySku] Starting search for SKU: ${sku}`);
    const searchUrl = `https://helikon-tex.com/en/catalogsearch/result/?q=${sku}&___store=en_usd`;
    console.log(`[findUrlBySku] Search URL: ${searchUrl}`);

    try {
        console.log(`[findUrlBySku] Making request to search page...`);
        const html = await getHtml(searchUrl);
        console.log(`[findUrlBySku] Successfully received HTML, length: ${html.length}`);

        const $ = cheerio.load(html);
        console.log(`[findUrlBySku] Cheerio loaded successfully`);

        const productDivs = $("div.product-item");
        console.log(`[findUrlBySku] Found ${productDivs.length} product items`);

        if (!productDivs.length) {
            console.log(`[findUrlBySku] No product items found, checking for alternative selectors...`);
            // Try alternative selectors
            const altDivs = $(".product-item, .item, .product, [data-product-id]");
            console.log(`[findUrlBySku] Alternative selectors found ${altDivs.length} items`);

            if (!altDivs.length) {
                console.log(`[findUrlBySku] Page content preview:`, html.substring(0, 500));
                throw new Error(`No product url found with SKU: ${sku}`);
            }
        }

        const aTag = productDivs.first().find("a[href]");
        console.log(`[findUrlBySku] Found ${aTag.length} links in first product item`);

        if (!aTag.length) {
            throw new Error(`No product link found with SKU: ${sku}`);
        }

        const href = aTag.attr("href");
        console.log(`[findUrlBySku] Found product URL: ${href}`);
        return href;
    } catch (error) {
        console.error(`[findUrlBySku] Error occurred:`, error.message);
        console.error(`[findUrlBySku] Error code:`, error.code);

        if (error.code === 'ERR_FR_TOO_MANY_REDIRECTS') {
            throw new Error(`Too many redirects when searching for SKU: ${sku}. The search page may have redirect loops.`);
        } else if (error.code === 'ECONNABORTED') {
            throw new Error(`Search timeout for SKU: ${sku}`);
        } else if (error.response) {
            throw new Error(`Search failed with HTTP ${error.response.status} for SKU: ${sku}`);
        } else {
            throw new Error(`Search error for SKU: ${sku}: ${error.message}`);
        }
    }
}

// Example: scrape Helikon product by SKU
export const scrapeProduct = async (sku, url) => {
    console.log(`[scrapeProduct] Starting scrape process for SKU: ${sku}, URL: ${url}`);
    const BASE = "https://helikon-tex.com";
    let productUrl = '';

    if (url) {
        productUrl = url;
        console.log(`[scrapeProduct] Using provided URL: ${productUrl}`);
    } else if (sku) {
        console.log(`[scrapeProduct] Searching for SKU: ${sku}`);
        try {
            productUrl = await findUrlBySku(sku);
            console.log(`[scrapeProduct] Found product URL: ${productUrl}`);
        } catch (error) {
            console.error(`[scrapeProduct] Error finding URL for SKU ${sku}:`, error.message);
            throw new Error(`No product found with SKU: ${sku}. ${error.message}`);
        }
    } else {
        console.error(`[scrapeProduct] No SKU or URL provided`);
        throw new Error("No SKU or URL provided");
    }

    try {
        console.log(`[scrapeProduct] Starting to scrape product from: ${productUrl}`);
        const product = await scrapeSingleProduct(productUrl);
        console.log(`[scrapeProduct] Successfully scraped product: ${product.name}`);
        return product;
    } catch (error) {
        console.error(`[scrapeProduct] Error scraping product:`, error.message);
        throw new Error(`Failed to scrape product: ${error.message}`);
    }
}

