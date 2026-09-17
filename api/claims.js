import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

function clean(value) { return String(value ?? '').trim() }

function supabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('Supabase is not configured.')
  return createClient(url, key)
}

async function signedEvidence(supabase, rows) {
  return Promise.all((rows || []).map(async row => {
    if (!row.storage_path) return row
    const { data } = await supabase.storage.from('claim-evidence').createSignedUrl(row.storage_path, 60 * 60)
    return { ...row, signed_url: data?.signedUrl || null }
  }))
}

function slackSafe(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function sendSlackClaim(claim, items) {
  const token = String(process.env.SLACK_BOT_TOKEN || '').trim()
  const channel = String(process.env.SLACK_SHIPPING_CLAIMS_CHANNEL_ID || '').trim()
  if (!token || !channel) return { sent: false, skipped: true }

  const base = String(process.env.APP_BASE_URL || '').trim().replace(/\/$/, '')
  const claimUrl = base ? `${base}/?view=claim&id=${encodeURIComponent(claim.id)}` : ''
  const pinkLine = ':pinkline::pinkline::pinkline::pinkline::pinkline::pinkline::pinkline::pinkline:'
  const itemLines = (items || []).map(item => {
    const itemName = slackSafe(item.sku || item.product_name || 'Item')
    const quantity = slackSafe(item.quantity || 0)
    const issue = item.issue_type ? `\n  _Issue:_ ${slackSafe(item.issue_type)}` : ''
    return `• *${itemName}* — \`${quantity}\` unit(s)${issue}`
  }).join('\n') || '• _No item details provided_'

  const message = [
    pinkLine,
    ':rotating_light: *NEW SHIPPING CLAIM* :rotating_light:',
    '_A new shipping claim has been submitted for review._',
    pinkLine,
    '',
    '*Claim Details*',
    '',
    `*Claim:* \`${slackSafe(claim.claim_number)}\``,
    `*Order:* \`${slackSafe(claim.order_number)}\``,
    `*Customer:* ${slackSafe(claim.customer_name)}`,
    `*Claim Type:* _${slackSafe((claim.claim_types || []).join(' / '))}_`,
    `*Fulfilled By:* ${slackSafe(claim.fulfilled_by || 'Not assigned')}`,
    `*Carrier:* ${slackSafe(claim.carrier || 'Unknown')}`,
    `*Resolution:* _${slackSafe(claim.resolution || 'Pending')}_`,
    `*Root Cause:* _${slackSafe(claim.root_cause || 'Unknown')}_`,
    `*Status:* *${slackSafe(claim.claim_status)}*`,
    `*Owner:* ${slackSafe(claim.owner || 'Unassigned')}`,
    '',
    pinkLine,
    '',
    '*Affected Items*',
    '',
    itemLines,
    '',
    pinkLine,
    claimUrl ? `:link: *<${claimUrl}|View Claim>*` : ':link: *View Claim in the Shipping Claims app*',
    '_Please review and update the claim status when handled._',
    pinkLine,
  ].join('\n')

  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel, text: message }),
  })
  const data = await response.json()
  if (!response.ok || !data.ok) throw new Error(data.error || `Slack HTTP ${response.status}`)
  return { sent: true, ts: data.ts }
}

function claimHistoryEntries(oldClaim, updates, user, comment) {
  const entries = []
  const fields = [
    ['claim_status', 'Status changed'],
    ['owner', 'Owner changed'],
    ['resolution', 'Resolution changed'],
    ['root_cause', 'Root cause changed'],
    ['external_claim_status', 'External claim status changed'],
  ]
  for (const [field, action] of fields) {
    if (updates[field] !== undefined && String(updates[field] ?? '') !== String(oldClaim[field] ?? '')) {
      entries.push({
        claim_id: oldClaim.id,
        user_id: user || null,
        action,
        old_value: oldClaim[field] || null,
        new_value: updates[field] || null,
        comment: comment || null,
      })
    }
  }
  return entries
}

export default async function handler(req, res) {
  try {
    const supabase = supabaseAdmin()

    if (req.method === 'POST') {
      const body = req.body || {}
      const required = ['order_number', 'customer_name', 'claim_types', 'items']
      const missing = required.find(key => body[key] === undefined || body[key] === null || (Array.isArray(body[key]) && body[key].length === 0))
      if (missing) return res.status(400).json({ error: `${missing} is required.` })

      const { data: numberData, error: numberError } = await supabase.rpc('next_shipping_claim_number')
      if (numberError) throw numberError

      const claim = {
        claim_number: numberData,
        submitted_by: body.submitted_by || null,
        order_number: String(body.order_number).trim(),
        customer_name: String(body.customer_name).trim(),
        date_shipped: body.date_shipped || null,
        date_delivered: body.date_delivered || null,
        claim_types: body.claim_types,
        claim_status: body.claim_status || 'Open',
        owner: body.owner || null,
        department: body.department || 'Shipping',
        fulfilled_by: body.fulfilled_by || null,
        location: body.location || null,
        carrier: body.carrier || 'Unknown',
        resolution: body.resolution || 'Pending',
        resolution_notes: body.resolution_notes || null,
        resolution_amount: body.resolution_amount || null,
        root_cause: body.root_cause || 'Unknown',
        external_claim_required: Boolean(body.external_claim_required),
        external_claim_type: body.external_claim_type || null,
        external_claim_status: body.external_claim_status || null,
        external_claim_reference: body.external_claim_reference || null,
        external_claim_amount: body.external_claim_amount || null,
        external_claim_notes: body.external_claim_notes || null,
        notes: body.notes || null,
      }

      const { data: saved, error: claimError } = await supabase
        .from('shipping_claims')
        .insert(claim)
        .select()
        .single()
      if (claimError) throw claimError

      const items = (body.items || []).map(item => ({
        claim_id: saved.id,
        sku: item.sku || null,
        product_id: item.product_id || null,
        product_name: item.product_name || null,
        quantity: Number(item.quantity || 0),
        unit_value: item.unit_value === '' || item.unit_value == null ? null : Number(item.unit_value),
        issue_type: item.issue_type || null,
        customer_received: item.customer_received || null,
        notes: item.notes || null,
      }))
      const { error: itemError } = await supabase.from('shipping_claim_items').insert(items)
      if (itemError) throw itemError

      await supabase.from('claim_history').insert({
        claim_id: saved.id,
        user_id: body.submitted_by || null,
        action: 'Claim created',
        new_value: saved.claim_status,
        comment: 'Shipping claim submitted',
      })

      const evidence = Array.isArray(body.evidence) ? body.evidence.slice(0, 8) : []
      for (const file of evidence) {
        if (!file.base64 || !file.file_name) continue
        const path = `${saved.id}/${randomUUID()}-${file.file_name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
        const buffer = Buffer.from(file.base64, 'base64')
        const { error: uploadError } = await supabase.storage
          .from('claim-evidence')
          .upload(path, buffer, { contentType: file.file_type || 'application/octet-stream', upsert: false })
        if (uploadError) throw uploadError
        await supabase.from('claim_evidence').insert({
          claim_id: saved.id,
          file_name: file.file_name,
          file_type: file.file_type || null,
          storage_path: path,
          uploaded_by: body.submitted_by || null,
        })
      }

      let slack = { sent: false, skipped: true }
      try {
        slack = await sendSlackClaim(saved, items)
      } catch (slackError) {
        console.error('Shipping claim Slack notification failed:', slackError)
        slack = { sent: false, error: slackError.message }
      }

      return res.status(201).json({ success: true, claim: saved, slack })
    }

    if (req.method === 'PATCH') {
      const body = req.body || {}
      if (!body.id) return res.status(400).json({ error: 'Claim id is required.' })
      const { data: oldClaim, error: oldError } = await supabase.from('shipping_claims').select('*').eq('id', body.id).single()
      if (oldError) throw oldError

      const allowed = [
        'claim_status', 'owner', 'department', 'resolution', 'resolution_notes',
        'resolution_amount', 'root_cause', 'external_claim_required',
        'external_claim_type', 'external_claim_status', 'external_claim_reference',
        'external_claim_amount', 'external_claim_notes', 'fulfilled_by', 'carrier', 'notes',
      ]
      const updates = {}
      for (const key of allowed) if (body[key] !== undefined) updates[key] = body[key]
      updates.updated_at = new Date().toISOString()

      const { data: updated, error: updateError } = await supabase.from('shipping_claims').update(updates).eq('id', body.id).select().single()
      if (updateError) throw updateError

      const history = claimHistoryEntries(oldClaim, updates, body.user_id, body.comment)
      if (history.length) await supabase.from('claim_history').insert(history)
      return res.status(200).json({ success: true, claim: updated })
    }

    if (req.method === 'GET') {
      const claimId = clean(req.query?.id)
      if (claimId) {
        const [{ data: claim, error: claimError }, { data: items, error: itemsError }, { data: evidence, error: evidenceError }, { data: history, error: historyError }] = await Promise.all([
          supabase.from('shipping_claims').select('*').eq('id', claimId).single(),
          supabase.from('shipping_claim_items').select('*').eq('claim_id', claimId).order('created_at'),
          supabase.from('claim_evidence').select('*').eq('claim_id', claimId).order('uploaded_at'),
          supabase.from('claim_history').select('*').eq('claim_id', claimId).order('created_at', { ascending: false }),
        ])
        if (claimError) throw claimError
        if (itemsError) throw itemsError
        if (evidenceError) throw evidenceError
        if (historyError) throw historyError
        return res.status(200).json({ claim, items: items || [], evidence: await signedEvidence(supabase, evidence || []), history: history || [] })
      }

      const status = clean(req.query?.status)
      const search = clean(req.query?.search)
      const claimType = clean(req.query?.claim_type)
      let query = supabase.from('shipping_claims').select('*, shipping_claim_items(*)').order('created_at', { ascending: false }).limit(500)
      if (status) query = query.eq('claim_status', status)
      if (search) query = query.or(`claim_number.ilike.%${search}%,order_number.ilike.%${search}%,customer_name.ilike.%${search}%,owner.ilike.%${search}%`)
      const { data, error } = await query
      if (error) throw error
      const rows = (data || []).filter(row => !claimType || (row.claim_types || []).includes(claimType))
      return res.status(200).json({ claims: rows })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    console.error('Claims API error:', error)
    return res.status(500).json({ error: error.message || 'Claims request failed.' })
  }
}
