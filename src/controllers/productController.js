import * as productService from '../services/productService.js'

export const getProducts = async (req, res) => {
    try {
        const products = await productService.getAll()
        res.json(products)
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
}

export const addProduct = async (req, res) => {
    try {
        const product = await productService.insert(req.body)
        res.status(201).json(product)
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
}
