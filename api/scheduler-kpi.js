// External scheduler endpoint for KPI notifications.
// Use an external scheduler for testing every 2 minutes, then switch it to
// the first day of each month after confirming it works.

import { createClient } from '@supabase/supabase-js'

function clean(value) { return String(value ?? '').trim() }
function money(value) { return Number(value || 0) }

function admin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('Supabase is not configured.')
  return createClient(url, key)
}

function authorized(req) {
  const secret = clean(process.env.CRON_SECRET)
  if (!secret) return true
  const header = String(req.headers.authorization || '')
  const query = clean(req.query?.secret)
  return header === `Bearer ${secret}` || query === secret
}

function add(map, key, value = 1) { map[key || 'Unknown'] = (map[key || 'Unknown'] || 0) + value }

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' })
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized scheduler request.' })

  try {
    const supabase = admin()
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()
    const monthLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

    const { data: claims, error } = await supabase
      .from('shipping_claims')
      .select('*, shipping_claim_items(*)')
      .gte('created_at', monthStart)
      .lt('created_at', nextMonth)
    if (error) throw error

    const rows = claims || []
    const byType = {}
    const byRoot = {}
    const skuMap = {}
    let itemsAffected = 0
    let claimValue = 0

    for (const claim of rows) {
      for (const type of claim.claim_types || []) add(byType, type)
      add(byRoot, claim.root_cause)
      for (const item of claim.shipping_claim_items || []) {
        const qty = Number(item.quantity || 0)
        itemsAffected += qty
        claimValue += qty * money(item.unit_value)
        const key = item.sku || item.product_name || 'Unknown'
        if (!skuMap[key]) skuMap[key] = { key, count: 0, qty: 0 }
        skuMap[key].count += 1
        skuMap[key].qty += qty
      }
    }

    const open = rows.filter(row => ['Open', 'In Progress', 'Pending'].includes(row.claim_status)).length
    const topTypes = Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([key, value]) => `• ${key}: ${value}`).join('\n') || '• None'
    const topSkus = Object.values(skuMap).sort((a, b) => b.count - a.count).slice(0, 5).map(row => `• ${row.key}: ${row.count} claim(s), ${row.qty} unit(s)`).join('\n') || '• None'
    const base = clean(process.env.APP_BASE_URL).replace(/\/$/, '')
    const dashboardUrl = base ? `${base}/?view=reports` : ''
    const pinkLine = ':pinkline::pinkline::pinkline::pinkline::pinkline::pinkline::pinkline::pinkline::pinkline::pinkline:'
    const message = [
      ':bar_chart: *KSC Shipping Claims KPI Report*',
      pinkLine,
      '',
      `*Period:* ${monthLabel}`,
      `*Total Claims:* ${rows.length}`,
      `*Open / Active:* ${open}`,
      `*Items Affected:* ${itemsAffected}`,
      `*Claim Value:* $${claimValue.toFixed(2)}`,
      '',
      ':warning: *Top Claim Types*',
      topTypes,
      '',
      ':package: *Top Affected SKUs*',
      topSkus,
      '',
      dashboardUrl ? `:link: <${dashboardUrl}|View KPI dashboard>` : '',
      pinkLine,
    ].filter(Boolean).join('\n')

    const token = clean(process.env.SLACK_BOT_TOKEN)
    const channel = clean(process.env.SLACK_SHIPPING_CLAIMS_CHANNEL_ID)
    if (!token || !channel) return res.status(200).json({ success: true, posted: false, reason: 'Slack scheduler variables not configured.', claims: rows.length })

    const slackResponse = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, text: message }),
    })
    const slack = await slackResponse.json()
    if (!slackResponse.ok || !slack.ok) throw new Error(slack.error || `Slack HTTP ${slackResponse.status}`)

    return res.status(200).json({ success: true, posted: true, claims: rows.length, period: monthLabel, ts: slack.ts })
  } catch (error) {
    console.error('Scheduled KPI error:', error)
    return res.status(500).json({ error: error.message || 'Scheduled KPI failed.' })
  }
}
