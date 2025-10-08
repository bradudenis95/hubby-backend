import axios from 'axios'
import * as cheerio from 'cheerio'

async function getHtml(url) {
    const res = await axios.get(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1"
        },
        maxRedirects: 5, // Limit redirects to prevent infinite loops
        timeout: 10000, // 10 second timeout
        validateStatus: function (status) {
            return status >= 200 && status < 300; // Only resolve for 2xx status codes
        },
        followRedirects: true // Explicitly enable redirect following
    });
    return res.data;
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
    const { $, html } = await getSoupAndHtml(url);

    const data = { url };
    data.name = extractName($);
    data.description = extractDescription($);
    data.specification = extractSpec($);
    data.materials = extractMaterials($);
    data.price = extractBasePrice($);

    const gallery = extractInitialImages(html);
    data.main_image = gallery[0] || null;
    data.images = gallery.length > 1 ? gallery.slice(1) : [];

    const cfg = parseConfigurableJson(html);
    if (cfg) {
        data.variants = buildVariantsFromCfg(cfg);
    } else {
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
    }

    return data;
}

// ---------- Find URL by SKU ----------
export async function findUrlBySku(sku) {
    const searchUrl = `https://helikon-tex.com/en/catalogsearch/result/?q=${sku}&___store=en_usd`;

    try {
        const html = await getHtml(searchUrl);
        const $ = cheerio.load(html);

        const productDivs = $("div.product-item");
        if (!productDivs.length) {
            throw new Error(`No product url found with SKU: ${sku}`);
        }

        const aTag = productDivs.first().find("a[href]");
        if (!aTag.length) {
            throw new Error(`No product link found with SKU: ${sku}`);
        }

        return aTag.attr("href");
    } catch (error) {
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
    const BASE = "https://helikon-tex.com";
    let productUrl = '';
    if (url) {
        productUrl = url;
    } else if (sku) {
        try {
            productUrl = await findUrlBySku(sku);
        } catch (error) {
            console.log(error);
            throw new Error("No product found on scrapeProduct");
        }
    } else {
        console.log("No SKU or URL provided");
        throw new Error("No SKU or URL provided");
    }

    try {
        const product = await scrapeSingleProduct(productUrl)
        return product
    } catch (error) {
        console.log(error);
        throw new Error(error);
    }
}

