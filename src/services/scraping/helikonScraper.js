import axios from 'axios'
import * as cheerio from 'cheerio'

async function getHtml(url) {
    const res = await axios.get(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
    });
    return res.data;
}

async function getSoupAndHtml(url) {
    const html = await getHtml(url);
    const $ = cheerio.load(html);
    return { $, html };
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
    const html = await getHtml(searchUrl);
    const $ = cheerio.load(html);

    const productDivs = $("div.product-item");
    if (!productDivs.length) {
        throw new Error("No product found");
    }

    const aTag = productDivs.first().find("a[href]");
    if (!aTag.length) {
        throw new Error("No product link found");
    }

    return aTag.attr("href");
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
            throw new Error("No product found");
        }
    } else {
        throw new Error("No SKU or URL provided");
    }

    try {
        const product = await scrapeSingleProduct(productUrl)
        return product
    } catch (error) {
        throw new Error("No product found");
    }
}

