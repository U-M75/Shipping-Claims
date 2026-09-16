import { createClient } from '@supabase/supabase-js'

function admin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('Supabase is not configured.')
  return createClient(url, key)
}

function money(value) { return Number(value || 0) }
function add(map, key, value = 1) { map[key || 'Unknown'] = (map[key || 'Unknown'] || 0) + value }

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const supabase = admin()
    const from = req.query?.from
    const to = req.query?.to
    let query = supabase.from('shipping_claims').select('*, shipping_claim_items(*)').order('created_at', { ascending: false }).limit(2000)
    if (from) query = query.gte('created_at', from)
    if (to) {
      const toValue = /^\d{4}-\d{2}-\d{2}$/.test(String(to))
        ? `${to}T23:59:59.999Z`
        : String(to)
      query = query.lte('created_at', toValue)
    }
    const { data: claims, error } = await query
    if (error) throw error

    const rows = claims || []
    const byType = {}, byResolution = {}, byRootCause = {}, byCarrier = {}, byFulfilled = {}, skuMap = {}
    let itemsAffected = 0
    let claimValue = 0
    for (const claim of rows) {
      for (const type of claim.claim_types || []) add(byType, type)
      add(byResolution, claim.resolution)
      add(byRootCause, claim.root_cause)
      add(byCarrier, claim.carrier)
      add(byFulfilled, claim.fulfilled_by)
      for (const item of claim.shipping_claim_items || []) {
        const qty = Number(item.quantity || 0)
        const value = qty * money(item.unit_value)
        itemsAffected += qty
        claimValue += value
        const key = item.sku || item.product_name || 'Unknown'
        if (!skuMap[key]) skuMap[key] = { sku: key, product: item.product_name || 'Unknown', claims: 0, quantity: 0, value: 0 }
        skuMap[key].claims += 1
        skuMap[key].quantity += qty
        skuMap[key].value += value
      }
    }

    const openStatuses = new Set(['Open', 'In Progress', 'Pending'])
    const now = Date.now()
    const openClaims = rows.filter(row => openStatuses.has(row.claim_status)).map(row => ({
      ...row,
      days_open: Math.max(0, Math.floor((now - new Date(row.created_at).getTime()) / 86400000)),
    }))

    const recurring = Object.values(skuMap).sort((a, b) => b.claims - a.claims).slice(0, 25)
    const urgent = rows.filter(row => row.root_cause === 'Carrier Damage' || row.claim_status === 'Pending').length

    return res.status(200).json({
      metrics: {
        total: rows.length,
        open: rows.filter(row => row.claim_status === 'Open').length,
        pending: rows.filter(row => row.claim_status === 'Pending').length,
        resolved: rows.filter(row => ['Resolved', 'Closed'].includes(row.claim_status)).length,
        itemsAffected,
        claimValue,
        external: rows.filter(row => row.external_claim_required).length,
        urgent,
      },
      byType: Object.entries(byType).map(([label, value]) => ({ label, value })),
      byResolution: Object.entries(byResolution).map(([label, value]) => ({ label, value })),
      byRootCause: Object.entries(byRootCause).map(([label, value]) => ({ label, value })),
      byCarrier: Object.entries(byCarrier).map(([label, value]) => ({ label, value })),
      byFulfilled: Object.entries(byFulfilled).map(([label, value]) => ({ label, value })),
      topSkus: recurring,
      openClaims: openClaims.slice(0, 12),
      recurring,
    })
  } catch (error) {
    console.error('KPI API error:', error)
    return res.status(500).json({ error: error.message || 'Could not load KPI data.' })
  }
}
