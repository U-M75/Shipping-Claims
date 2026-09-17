// External scheduler endpoint for KPI notifications and PDF delivery.
// Test this every 2 minutes with an external scheduler, then switch it to
// the first day of each month after confirming it works.

import { createClient } from '@supabase/supabase-js'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

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

function buildPdf({ monthLabel, rows, metrics, byType, byRoot, topSkus }) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const pink = [255, 179, 197]
  const ink = [61, 44, 56]
  const muted = [130, 115, 126]
  const dateText = new Date().toLocaleString('en-US')

  doc.setFillColor(...pink)
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 8, 'F')
  doc.setFontSize(20)
  doc.setTextColor(...ink)
  doc.text('KSC Shipping Claims KPI Report', 34, 39)
  doc.setFontSize(10)
  doc.setTextColor(...muted)
  doc.text(`${monthLabel} · Generated ${dateText}`, 34, 57)

  autoTable(doc, {
    startY: 78,
    margin: { left: 34, right: 34 },
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 6 },
    headStyles: { fillColor: pink, textColor: ink, fontStyle: 'bold' },
    head: [['Total Claims', 'Open / Active', 'Pending', 'Resolved', 'Items Affected', 'Claim Value', 'External Claims']],
    body: [[metrics.total, metrics.open, metrics.pending, metrics.resolved, metrics.itemsAffected, `$${metrics.claimValue.toFixed(2)}`, metrics.external]],
  })

  let y = (doc.lastAutoTable?.finalY || 125) + 18
  const sections = [
    ['Claims by Type', byType.map(row => [row.label, row.value])],
    ['Claims by Root Cause', byRoot.map(row => [row.label, row.value])],
    ['Top Affected Products / SKUs', topSkus.map(row => [row.key, row.count, row.qty, `$${row.value.toFixed(2)}`])],
  ]

  for (const [title, body] of sections) {
    if (!body.length) continue
    if (y > 520) { doc.addPage(); y = 40 }
    doc.setFontSize(12)
    doc.setTextColor(...ink)
    doc.text(title, 34, y)
    autoTable(doc, {
      startY: y + 8,
      margin: { left: 34, right: 34 },
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [255, 242, 246], textColor: ink },
      head: [title === 'Top Affected Products / SKUs' ? ['SKU / Product', 'Claims', 'Qty', 'Value'] : ['Category', 'Count']],
      body,
    })
    y = (doc.lastAutoTable?.finalY || y + 35) + 18
  }

  if (rows.length) {
    doc.addPage()
    doc.setFontSize(15)
    doc.setTextColor(...ink)
    doc.text('Open Claims Detail', 34, 39)
    autoTable(doc, {
      startY: 56,
      margin: { left: 28, right: 28 },
      theme: 'grid',
      styles: { fontSize: 7.5, cellPadding: 4, overflow: 'linebreak', valign: 'top' },
      headStyles: { fillColor: pink, textColor: ink, fontStyle: 'bold' },
      head: [['Claim', 'Order', 'Customer', 'Type', 'Status', 'Owner', 'Days Open']],
      body: rows.map(row => [row.claim_number, row.order_number, row.customer_name, (row.claim_types || []).join(' / '), row.claim_status, row.owner || 'Unassigned', row.days_open]),
    })
  }

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
    const byType = {}, byRoot = {}, skuMap = {}
    let itemsAffected = 0
    let claimValue = 0
    for (const claim of rows) {
      for (const type of claim.claim_types || []) add(byType, type)
      add(byRoot, claim.root_cause)
      for (const item of claim.shipping_claim_items || []) {
        const qty = Number(item.quantity || 0)
        const value = qty * money(item.unit_value)
        itemsAffected += qty
        claimValue += value
        const key = item.sku || item.product_name || 'Unknown'
        if (!skuMap[key]) skuMap[key] = { key, count: 0, qty: 0, value: 0 }
        skuMap[key].count += 1
        skuMap[key].qty += qty
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
      byRoot: Object.entries(byRoot).map(([label, value]) => ({ label, value })),
      topSkus: Object.values(skuMap).sort((a, b) => b.count - a.count).slice(0, 25),
    })
    await uploadPdf(token, channel, pdf, `shipping-claims-kpi-${year}-${String(month).padStart(2, '0')}.pdf`)

    return res.status(200).json({ success: true, pdfSent: true, messageSent: false, claims: rows.length, period: monthLabel, timeZone: reportTimeZone })
  } catch (error) {
    console.error('Scheduled KPI error:', error)
    return res.status(500).json({ error: error.message || 'Scheduled KPI failed.' })
  }
}
