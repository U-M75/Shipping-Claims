// External scheduler endpoint for KPI notifications and PDF delivery.
// Test this every 2 minutes with an external scheduler, then switch it to
// the first day of each month after confirming it works.

import { createClient } from '@supabase/supabase-js'
import { createKpiPdf } from '../pdf/kpi-report.js'

function clean(value) { return String(value ?? '').trim() }
function money(value) { return Number(value || 0) }
function add(map, key, value = 1) { map[key || 'Unknown'] = (map[key || 'Unknown'] || 0) + value }

function localMonthParts(timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date())
  const year = parts.find(part => part.type === 'year')?.value
  const month = parts.find(part => part.type === 'month')?.value
  return { year: Number(year), month: Number(month) }
}

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

function buildPdf({ monthLabel, rows, metrics, byType, byRootCause, byResolution, byCarrier, productBreakdown }) {
  const doc = createKpiPdf({
    monthLabel,
    metrics,
    byType,
    byRootCause,
    byResolution,
    byCarrier,
    productBreakdown,
    openClaims: rows,
  })
  return Buffer.from(doc.output('arraybuffer'))
}

async function postSlack(token, channel, text) {
  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel, text }),
  })
  const data = await response.json()
  if (!response.ok || !data.ok) throw new Error(data.error || `Slack HTTP ${response.status}`)
  return data
}

async function uploadPdf(token, channel, buffer, filename) {
  const urlResponse = await fetch('https://slack.com/api/files.getUploadURLExternal', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ filename, length: String(buffer.length) }),
  })
  const uploadInfo = await urlResponse.json()
  if (!urlResponse.ok || !uploadInfo.ok) throw new Error(uploadInfo.error || 'Slack upload URL failed')

  const uploadResponse = await fetch(uploadInfo.upload_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: buffer,
  })
  if (!uploadResponse.ok) throw new Error(`Slack PDF upload failed (HTTP ${uploadResponse.status})`)

  const completeResponse = await fetch('https://slack.com/api/files.completeUploadExternal', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel_id: channel,
      files: [{ id: uploadInfo.file_id, title: filename }],
    }),
  })
  const complete = await completeResponse.json()
  if (!completeResponse.ok || !complete.ok) throw new Error(complete.error || 'Slack PDF completion failed')
  return complete
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' })
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized scheduler request.' })

  try {
    const supabase = admin()
    const reportTimeZone = process.env.REPORT_TIMEZONE || 'America/Los_Angeles'
    const { year, month } = localMonthParts(reportTimeZone)
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
    const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }
    const nextMonth = `${next.year}-${String(next.month).padStart(2, '0')}-01`
    const monthLabel = new Date(`${monthStart}T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: reportTimeZone })

    const { data: claims, error } = await supabase
      .from('shipping_claims')
      .select('*, shipping_claim_items(*)')
      .gte('created_at', `${monthStart}T00:00:00Z`)
      .lt('created_at', `${nextMonth}T00:00:00Z`)
    if (error) throw error

    const rows = claims || []
    const byType = {}, byRoot = {}, byResolution = {}, byCarrier = {}, skuMap = {}
    let itemsAffected = 0
    let claimValue = 0
    for (const claim of rows) {
      for (const type of claim.claim_types || []) add(byType, type)
      add(byRoot, claim.root_cause)
      add(byResolution, claim.resolution)
      add(byCarrier, claim.carrier)
      for (const item of claim.shipping_claim_items || []) {
        const qty = Number(item.quantity || 0)
        const value = qty * money(item.unit_value)
        itemsAffected += qty
        claimValue += value
        const key = item.sku || item.product_name || 'Unknown'
        if (!skuMap[key]) skuMap[key] = { sku: item.sku || '—', product: item.product_name || 'Unspecified product', claims: 0, quantity: 0, value: 0 }
        skuMap[key].claims += 1
        skuMap[key].quantity += qty
        skuMap[key].value += value
      }
    }

    const openRows = rows.filter(row => ['Open', 'In Progress', 'Pending'].includes(row.claim_status)).map(row => ({
      ...row,
      days_open: Math.max(0, Math.floor((Date.now() - new Date(row.created_at).getTime()) / 86400000)),
    }))
    const metrics = {
      total: rows.length,
      open: openRows.length,
      pending: rows.filter(row => row.claim_status === 'Pending').length,
      resolved: rows.filter(row => ['Resolved', 'Closed'].includes(row.claim_status)).length,
      itemsAffected,
      claimValue,
      external: rows.filter(row => row.external_claim_required).length,
    }

    const token = clean(process.env.SLACK_BOT_TOKEN)
    const channel = clean(process.env.SLACK_SHIPPING_CLAIMS_CHANNEL_ID)
    if (!token || !channel) return res.status(200).json({ success: true, pdfSent: false, reason: 'Slack scheduler variables not configured.', claims: rows.length })

    const pdf = buildPdf({
      monthLabel,
      rows: openRows,
      metrics,
      byType: Object.entries(byType).map(([label, value]) => ({ label, value })),
      byRootCause: Object.entries(byRoot).map(([label, value]) => ({ label, value })),
      byResolution: Object.entries(byResolution).map(([label, value]) => ({ label, value })),
      byCarrier: Object.entries(byCarrier).map(([label, value]) => ({ label, value })),
      productBreakdown: Object.values(skuMap).sort((a, b) => b.claims - a.claims).slice(0, 50),
    })
    await uploadPdf(token, channel, pdf, `shipping-claims-kpi-${year}-${String(month).padStart(2, '0')}.pdf`)

    return res.status(200).json({ success: true, pdfSent: true, messageSent: false, claims: rows.length, period: monthLabel, timeZone: reportTimeZone })
  } catch (error) {
    console.error('Scheduled KPI error:', error)
    return res.status(500).json({ error: error.message || 'Scheduled KPI failed.' })
  }
}
