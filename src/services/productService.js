import { supabase } from '../config/supabase.js'

export const getAll = async () => {
    const { data, error } = await supabase.from('products').select('*')
    if (error) throw new Error(error.message)
    return data
}

export const insert = async (product) => {
    const { data, error } = await supabase.from('products').insert([product]).single()
    if (error) throw new Error(error.message)
    return data
}
