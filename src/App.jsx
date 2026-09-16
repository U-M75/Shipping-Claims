import { useEffect, useMemo, useRef, useState } from 'react'

const CLAIM_TYPES = ['Missing Item', 'Swapped Item', 'Damaged Item', 'Short Shipment', 'Wrong Quantity', 'Wrong Product', 'Packaging Damage', 'Other']
const ISSUE_TYPES = CLAIM_TYPES
const CARRIERS = ['UPS', 'USPS', 'FedEx', 'T-Force', 'Faire', 'Other', 'Unknown']
const RESOLUTIONS = ['Reship', 'Refund', 'Store Credit', 'Replacement', 'Customer Charged', 'Call Tag', 'Customer Keeping Incorrect Item', 'Pending', 'Other']
const ROOT_CAUSES = ['Picking Error', 'Packing Error', 'Shopify Sync Issue', 'Inventory Issue', 'Product Defect', 'Packaging Failure', 'Carrier Damage', 'Customer Error', 'Unknown', 'Other']
const STATUSES = ['Open', 'In Progress', 'Pending', 'Resolved', 'Closed']
const DEPARTMENTS = ['Shipping', 'Customer Service', 'Purchasing', 'Vendor', 'Carrier', 'IT/Systems', 'Other']

const emptyItem = () => ({ sku: '', product_name: '', quantity: '', unit_value: '', issue_type: '', customer_received: '', notes: '' })
const emptyClaim = () => ({
  order_number: '', customer_name: '', date_shipped: '', date_delivered: '', claim_types: [],
  fulfilled_by: '', location: '', carrier: 'Unknown', resolution: 'Pending', resolution_notes: '', resolution_amount: '',
  root_cause: 'Unknown', external_claim_required: false, external_claim_type: '', external_claim_status: 'Not Filed',
  external_claim_reference: '', external_claim_amount: '', external_claim_notes: '', owner: '', department: 'Shipping', notes: '', items: [emptyItem()], evidence: [],
})

function money(value) {
  const n = Number(value || 0)
  return `$${n.toFixed(2)}`
}
function dateLabel(value, time = false) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', ...(time ? { hour: 'numeric', minute: '2-digit' } : {}) })
}
function daysOpen(value) {
  if (!value) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000))
}
function statusTone(status) {
  return String(status || '').toLowerCase().replace(/\s+/g, '-')
}
function apiJson(url, options) {
  return fetch(url, options).then(async response => {
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`)
    return data
  })
}
function titleCase(value) { return String(value || '').replace(/\b\w/g, c => c.toUpperCase()) }

function compressImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error(`${file.name} is not an image.`))
      return
    }
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      const scale = Math.min(1, 1400 / Math.max(image.width, image.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, image.width * scale)
      canvas.height = Math.max(1, image.height * scale)
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(blob => {
        URL.revokeObjectURL(url)
        if (!blob) return reject(new Error(`Could not prepare ${file.name}`))
        const reader = new FileReader()
        reader.onload = () => resolve({ file_name: `${file.name.replace(/\.[^.]+$/, '')}.jpg`, file_type: 'image/jpeg', base64: String(reader.result).split(',')[1] })
        reader.readAsDataURL(blob)
      }, 'image/jpeg', .82)
    }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Could not prepare ${file.name}`)) }
    image.src = url
  })
}

function Login({ onLogin }) {
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  async function submit(e) {
    e.preventDefault(); setLoading(true); setError('')
    try {
      const data = await apiJson('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, pin }) })
      localStorage.setItem('claims_user', JSON.stringify(data.user))
      onLogin(data.user)
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }
  return <div className="login-page"><div className="login-orb one" /><div className="login-orb two" /><div className="login-card">
    <img src="/ksc-logo.png" alt="KSC" /><span className="eyebrow">Internal operations</span><h1>Shipping Claims</h1><p>KSC Shipping Claims & Resolution System</p>
    <form onSubmit={submit}><label>Team member<input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" /></label><label>PIN<input value={pin} onChange={e => setPin(e.target.value)} type="password" inputMode="numeric" placeholder="Enter PIN" /></label>{error && <div className="form-error">{error}</div>}<button className="primary-button" disabled={loading}>{loading ? 'Checking…' : 'Enter system →'}</button></form>
  </div></div>
}

function Sidebar({ page, setPage, user, onLogout }) {
  const nav = [
    ['dashboard', '⌂', 'Dashboard'], ['submit', '+', 'Submit Claim'], ['claims', '▤', 'All Claims'], ['open', '◷', 'Open Claims'],
    ['external', '↗', 'Vendor/Carrier Claims'], ['recurring', '◈', 'Common Issues'], ['reports', '▥', 'KPI Reports'], ['settings', '⚙', 'System Settings'],
  ]
  return <aside className="sidebar"><div className="side-brand"><img src="/ksc-logo.png" alt="KSC" /><div><strong>KSC Claims</strong><span>Resolution System</span></div></div><div className="side-nav">{nav.map(([id, icon, label]) => <button key={id} className={page === id ? 'active' : ''} onClick={() => setPage(id)}><span>{icon}</span>{label}</button>)}</div><div className="side-bottom"><div className="user-chip"><div className="avatar">{String(user?.name || 'U').slice(0, 1).toUpperCase()}</div><div><strong>{user?.name || 'Team member'}</strong><span>Internal user</span></div></div><button className="logout-button" onClick={onLogout}>Sign out</button></div></aside>
}

function Header({ title, eyebrow, action }) {
  return <div className="content-header"><div><span className="eyebrow">{eyebrow || 'Shipping operations'}</span><h1>{title}</h1></div>{action}</div>
}

function StatCard({ label, value, tone = 'pink', sub }) { return <div className={`stat-card ${tone}`}><span>{label}</span><strong>{value}</strong>{sub && <small>{sub}</small>}</div> }
function BarList({ title, rows }) { const max = Math.max(...(rows || []).map(row => row.value), 1); return <div className="panel"><div className="panel-title"><h3>{title}</h3></div><div className="bar-list">{(rows || []).length ? rows.map(row => <div className="bar-row" key={row.label}><div className="bar-label"><span>{row.label}</span><strong>{row.value}</strong></div><div className="bar-track"><i style={{ width: `${Math.max(5, row.value / max * 100)}%` }} /></div></div>) : <div className="empty-small">No data for this period.</div>}</div></div> }

function DashboardPage({ setPage, user }) {
  const [data, setData] = useState(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [period, setPeriod] = useState('current')
  async function load() { setLoading(true); setError(''); try { const now = new Date(); let from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString(); let to = null; if (period === 'previous') { from = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString(); to = new Date(now.getFullYear(), now.getMonth(), 0).toISOString() } if (period === 'custom') from = null; const qs = new URLSearchParams(); if (from) qs.set('from', from); if (to) qs.set('to', to); setData(await apiJson(`/api/kpi?${qs}`)) } catch (e) { setError(e.message) } finally { setLoading(false) } }
  useEffect(() => { load() }, [period])
  const m = data?.metrics || {}
  return <><Header title="Shipping claims dashboard" eyebrow="KSC operations" action={<div className="header-actions"><select value={period} onChange={e => setPeriod(e.target.value)}><option value="current">Current month</option><option value="previous">Previous month</option><option value="all">All claims</option></select><button className="secondary-button" onClick={load}>↻ Refresh</button></div>} />{error && <div className="form-error">{error}</div>}{loading ? <div className="loading-state">Loading claims intelligence…</div> : <>
    <div className="stat-grid"><StatCard label="Total Claims" value={m.total || 0} /><StatCard label="Open Claims" value={m.open || 0} tone="blue" /><StatCard label="Pending Claims" value={m.pending || 0} tone="gold" /><StatCard label="Resolved" value={m.resolved || 0} tone="green" /><StatCard label="Items Affected" value={m.itemsAffected || 0} tone="blue" /><StatCard label="Claim Value" value={money(m.claimValue)} tone="pink" /><StatCard label="External Claims" value={m.external || 0} tone="gold" /><StatCard label="Pending Follow-up" value={m.urgent || 0} tone="red" /></div>
    <div className="dashboard-grid"><BarList title="Claims by Type" rows={data?.byType} /><BarList title="Claims by Resolution" rows={data?.byResolution} /><BarList title="Claims by Root Cause" rows={data?.byRootCause} /><BarList title="Fulfilled By" rows={data?.byFulfilled} /></div>
    <div className="two-panels"><div className="panel"><div className="panel-title"><h3>Top problem SKUs</h3><button className="text-button" onClick={() => setPage('recurring')}>View all →</button></div><MiniTable rows={data?.topSkus?.slice(0, 6) || []} headers={['SKU / Product', 'Claims', 'Qty', 'Value']} render={row => [<span className="strong-cell">{row.sku}<small>{row.product}</small></span>, row.claims, row.quantity, money(row.value)]} /></div><div className="panel"><div className="panel-title"><h3>Open claims</h3><button className="text-button" onClick={() => setPage('open')}>View all →</button></div><MiniTable rows={data?.openClaims?.slice(0, 6) || []} headers={['Claim', 'Order', 'Status', 'Days']} render={row => [<span className="strong-cell">{row.claim_number}<small>{row.customer_name}</small></span>, row.order_number, <StatusBadge status={row.claim_status} />, row.days_open]} /></div></div>
  </>}</>
}

function MiniTable({ rows, headers, render }) { return <div className="mini-table"><div className="mini-head">{headers.map(h => <span key={h}>{h}</span>)}</div>{rows.length ? rows.map((row, i) => <div className="mini-row" key={row.id || row.sku || i}>{render(row).map((cell, j) => <span key={j}>{cell}</span>)}</div>) : <div className="empty-small">No data found.</div>}</div> }
function StatusBadge({ status }) { return <span className={`status-badge ${statusTone(status)}`}>{status}</span> }

function SubmitClaim({ user, onCreated, setPage }) {
  const [form, setForm] = useState(emptyClaim()); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [evidenceBusy, setEvidenceBusy] = useState(false); const [shopifyBusy, setShopifyBusy] = useState(false)
  function update(key, value) { setForm(prev => ({ ...prev, [key]: value })); setError('') }
  function toggleType(type) { setForm(prev => ({ ...prev, claim_types: prev.claim_types.includes(type) ? prev.claim_types.filter(x => x !== type) : [...prev.claim_types, type] })) }
  function updateItem(index, key, value) { setForm(prev => ({ ...prev, items: prev.items.map((item, i) => i === index ? { ...item, [key]: value } : item) })) }
  async function filesChanged(e) { const files = Array.from(e.target.files || []); if (!files.length) return; setEvidenceBusy(true); try { const prepared = []; for (const file of files.slice(0, 8)) prepared.push(await compressImage(file)); setForm(prev => ({ ...prev, evidence: [...prev.evidence, ...prepared].slice(0, 8) })) } catch (err) { setError(err.message) } finally { setEvidenceBusy(false) } }
  async function lookupShopifyOrder() {
    if (!form.order_number.trim()) { setError('Enter an order number first.'); return }
    setShopifyBusy(true); setError('')
    try {
      const data = await apiJson(`/api/shopify-order?order=${encodeURIComponent(form.order_number)}`)
      const order = data.order
      setForm(prev => ({ ...prev, customer_name: order.customer_name || prev.customer_name, date_shipped: order.date_shipped || prev.date_shipped, carrier: order.carrier || prev.carrier, location: order.location_name || prev.location, items: order.items?.length ? order.items : prev.items }))
    } catch (err) { setError(err.message) } finally { setShopifyBusy(false) }
  }
  async function submit(e) { e.preventDefault(); setError(''); if (!form.order_number || !form.customer_name || !form.claim_types.length || !form.items.some(item => item.sku || item.product_name)) { setError('Please complete Order Number, Customer Name, at least one Claim Type, and one affected item.'); return } setBusy(true); try { const data = await apiJson('/api/claims', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, submitted_by: user?.name || 'Internal user', items: form.items.filter(item => item.sku || item.product_name) }) }); alert(`Shipping claim ${data.claim.claim_number} has been created.`); onCreated(data.claim) } catch (err) { setError(err.message) } finally { setBusy(false) } }
  return <><Header title="Submit shipping claim" eyebrow="Fast employee workflow" action={<button className="secondary-button" onClick={() => setPage('claims')}>View all claims</button>} />{error && <div className="form-error">{error}</div>}<form className="claim-form" onSubmit={submit}>
    <FormSection number="01" title="Order information" hint="Enter an order number to look up Shopify details when Shopify is connected."><div className="form-grid two"><div className="field"><span>Order Number<b>*</b></span><div className="shopify-lookup"><input value={form.order_number} onChange={e => update('order_number', e.target.value)} placeholder="#15964" /><button type="button" className="lookup-button" onClick={lookupShopifyOrder} disabled={shopifyBusy}>{shopifyBusy ? 'Looking up…' : 'Shopify lookup'}</button></div></div><Field label="Customer Name" required value={form.customer_name} onChange={v => update('customer_name', v)} /><Field label="Date Shipped" type="date" value={form.date_shipped} onChange={v => update('date_shipped', v)} /><Field label="Date Delivered" type="date" value={form.date_delivered} onChange={v => update('date_delivered', v)} /></div></FormSection>
    <FormSection number="02" title="Claim type" hint="Select every type that applies."><div className="choice-grid">{CLAIM_TYPES.map(type => <button type="button" key={type} className={form.claim_types.includes(type) ? 'choice active' : 'choice'} onClick={() => toggleType(type)}>{form.claim_types.includes(type) ? '✓ ' : ''}{type}</button>)}</div></FormSection>
    <FormSection number="03" title="Affected items" hint="Keep multiple affected SKUs under one claim."><div className="items-list">{form.items.map((item, index) => <div className="item-editor" key={index}><div className="item-editor-head"><strong>Item {index + 1}</strong>{form.items.length > 1 && <button type="button" className="remove-button" onClick={() => setForm(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }))}>Remove</button>}</div><div className="form-grid three"><Field label="SKU" value={item.sku} onChange={v => updateItem(index, 'sku', v)} /><Field label="Product Name" value={item.product_name} onChange={v => updateItem(index, 'product_name', v)} /><Field label="Quantity Affected" type="number" value={item.quantity} onChange={v => updateItem(index, 'quantity', v)} /><Field label="Unit Value" type="number" value={item.unit_value} onChange={v => updateItem(index, 'unit_value', v)} /><SelectField label="Issue Type" value={item.issue_type} onChange={v => updateItem(index, 'issue_type', v)} options={ISSUE_TYPES} placeholder="Select issue" /><Field label="What Customer Received" value={item.customer_received} onChange={v => updateItem(index, 'customer_received', v)} /></div><Field label="Item Notes" value={item.notes} onChange={v => updateItem(index, 'notes', v)} textarea /></div>)}</div><button type="button" className="add-item" onClick={() => setForm(prev => ({ ...prev, items: [...prev.items, emptyItem()] }))}>+ Add another item</button></FormSection>
    <FormSection number="04" title="Fulfillment"><div className="form-grid three"><Field label="Fulfilled By" value={form.fulfilled_by} onChange={v => update('fulfilled_by', v)} /><Field label="Location" value={form.location} onChange={v => update('location', v)} placeholder="Warehouse / store" /><SelectField label="Carrier" value={form.carrier} onChange={v => update('carrier', v)} options={CARRIERS} /></div></FormSection>
    <FormSection number="05" title="Resolution"><div className="form-grid three"><SelectField label="Current Resolution" value={form.resolution} onChange={v => update('resolution', v)} options={RESOLUTIONS} /><Field label="Resolution Amount" type="number" value={form.resolution_amount} onChange={v => update('resolution_amount', v)} /><Field label="Resolution Notes" value={form.resolution_notes} onChange={v => update('resolution_notes', v)} textarea /></div></FormSection>
    <FormSection number="06" title="Root cause" hint="Keep Root Cause separate from Claim Type."><SelectField label="Suspected Root Cause" value={form.root_cause} onChange={v => update('root_cause', v)} options={ROOT_CAUSES} /></FormSection>
    <FormSection number="07" title="External claim"><div className="form-grid three"><SelectField label="External Claim Required?" value={form.external_claim_required ? 'Yes' : 'No'} onChange={v => update('external_claim_required', v === 'Yes')} options={['No', 'Yes']} />{form.external_claim_required && <><SelectField label="External Claim Type" value={form.external_claim_type} onChange={v => update('external_claim_type', v)} options={['Carrier', 'Vendor', 'Manufacturer', 'Faire', 'Other']} /><SelectField label="External Claim Status" value={form.external_claim_status} onChange={v => update('external_claim_status', v)} options={['Not Filed', 'Pending', 'Filed', 'Approved', 'Denied', 'Paid/Resolved']} /><Field label="External Claim Reference" value={form.external_claim_reference} onChange={v => update('external_claim_reference', v)} /><Field label="External Claim Amount" type="number" value={form.external_claim_amount} onChange={v => update('external_claim_amount', v)} /><Field label="External Claim Notes" value={form.external_claim_notes} onChange={v => update('external_claim_notes', v)} textarea /></>}</div></FormSection>
    <FormSection number="08" title="Ownership"><div className="form-grid three"><Field label="Owner" value={form.owner} onChange={v => update('owner', v)} /><SelectField label="Department Responsible" value={form.department} onChange={v => update('department', v)} options={DEPARTMENTS} /><Field label="Location" value={form.location} onChange={v => update('location', v)} /></div></FormSection>
    <FormSection number="09" title="Notes & evidence"><Field label="Notes" value={form.notes} onChange={v => update('notes', v)} textarea /><div className="evidence-upload"><label className="file-label">{evidenceBusy ? 'Preparing evidence…' : 'Upload photos / evidence'}<input type="file" accept="image/*,.pdf" multiple hidden onChange={filesChanged} /></label><span>{form.evidence.length} file(s) selected</span></div>{form.evidence.length > 0 && <div className="evidence-list">{form.evidence.map((file, i) => <span key={i}>{file.file_name}</span>)}</div>}</FormSection>
    <div className="submit-bar"><p>Submit a structured claim. You can update its status and resolution later.</p><button className="primary-button" disabled={busy}>{busy ? 'Creating claim…' : 'Submit Claim →'}</button></div>
  </form></>
}

function FormSection({ number, title, hint, children }) { return <section className="form-section"><div className="section-heading"><span>{number}</span><div><h2>{title}</h2>{hint && <p>{hint}</p>}</div></div>{children}</section> }
function Field({ label, required, value, onChange, type = 'text', placeholder, textarea }) { return <label className="field"><span>{label}{required && <b>*</b>}</span>{textarea ? <textarea value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder || ''} rows="3" /> : <input type={type} value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder || ''} />}</label> }
function SelectField({ label, value, onChange, options, placeholder }) { return <label className="field"><span>{label}</span><select value={value || ''} onChange={e => onChange(e.target.value)}>{placeholder && <option value="">{placeholder}</option>}{options.map(option => <option key={option} value={option}>{option}</option>)}</select></label> }

function ClaimsPage({ setPage, status = '' }) {
  const [claims, setClaims] = useState([]); const [search, setSearch] = useState(''); const [loading, setLoading] = useState(true); const [error, setError] = useState('')
  async function load() { setLoading(true); try { const qs = new URLSearchParams(); if (status) qs.set('status', status); if (search) qs.set('search', search); const data = await apiJson(`/api/claims?${qs}`); setClaims(data.claims || []) } catch (e) { setError(e.message) } finally { setLoading(false) } }
  useEffect(() => { const timer = setTimeout(load, 180); return () => clearTimeout(timer) }, [status, search])
  return <><Header title={status ? `${status} Claims` : 'All Claims'} eyebrow="Shipping claims" action={<button className="primary-button" onClick={() => setPage('submit')}>+ Submit Claim</button>} />{error && <div className="form-error">{error}</div>}<div className="claims-toolbar"><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search claim number, order, customer, SKU, owner…" /><button className="secondary-button" onClick={load}>Refresh</button></div>{loading ? <div className="loading-state">Loading claims…</div> : <ClaimTable claims={claims} onOpen={id => setPage(`claim:${id}`)} />}</>
}
function ClaimTable({ claims, onOpen }) { return <div className="data-table-wrap"><table className="data-table"><thead><tr>{['Claim #', 'Created', 'Order', 'Customer', 'Claim Type', 'Fulfilled By', 'Carrier', 'Root Cause', 'Resolution', 'Status', 'Owner', 'Days Open'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{claims.map(claim => <tr key={claim.id} onClick={() => onOpen(claim.id)}><td className="strong-cell">{claim.claim_number}</td><td>{dateLabel(claim.created_at)}</td><td>{claim.order_number}</td><td>{claim.customer_name}</td><td>{(claim.claim_types || []).join(', ')}</td><td>{claim.fulfilled_by || '—'}</td><td>{claim.carrier || '—'}</td><td>{claim.root_cause || '—'}</td><td>{claim.resolution || '—'}</td><td><StatusBadge status={claim.claim_status} /></td><td>{claim.owner || '—'}</td><td>{['Resolved', 'Closed'].includes(claim.claim_status) ? '—' : daysOpen(claim.created_at)}</td></tr>)}{!claims.length && <tr><td colSpan="12" className="empty-cell">No claims found.</td></tr>}</tbody></table></div> }

function ClaimDetail({ id, setPage, user }) {
  const [data, setData] = useState(null); const [error, setError] = useState(''); const [saving, setSaving] = useState(false)
  async function load() { try { setData(await apiJson(`/api/claims?id=${id}`)) } catch (e) { setError(e.message) } }
  useEffect(() => { load() }, [id])
  async function update(values) { setSaving(true); try { await apiJson('/api/claims', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...values, user_id: user?.name }) }); await load() } catch (e) { setError(e.message) } finally { setSaving(false) } }
  if (error) return <div className="form-error">{error}</div>
  if (!data) return <div className="loading-state">Loading claim…</div>
  const c = data.claim
  return <><Header title={c.claim_number} eyebrow="Claim detail" action={<button className="secondary-button" onClick={() => setPage('claims')}>← Back to claims</button>} /><div className="detail-grid"><div className="panel detail-main"><div className="detail-top"><div><h2>{c.customer_name}</h2><p>Order {c.order_number} · Created {dateLabel(c.created_at)}</p></div><StatusBadge status={c.claim_status} /></div><div className="detail-info-grid"><Info label="Claim Type" value={(c.claim_types || []).join(', ')} /><Info label="Fulfilled By" value={c.fulfilled_by} /><Info label="Carrier" value={c.carrier} /><Info label="Root Cause" value={c.root_cause} /><Info label="Resolution" value={c.resolution} /><Info label="Owner" value={c.owner} /><Info label="Department" value={c.department} /><Info label="Days Open" value={['Resolved', 'Closed'].includes(c.claim_status) ? 'Closed' : daysOpen(c.created_at)} /></div><h3 className="subheading">Affected items</h3><div className="item-table"><div className="item-row item-head"><span>SKU</span><span>Product</span><span>Issue</span><span>Qty</span><span>Unit Value</span><span>Total</span><span>Received</span></div>{(data.items || []).map(item => <div className="item-row" key={item.id}><span>{item.sku || '—'}</span><span>{item.product_name || '—'}</span><span>{item.issue_type || '—'}</span><span>{item.quantity}</span><span>{money(item.unit_value)}</span><span>{money(Number(item.quantity || 0) * Number(item.unit_value || 0))}</span><span>{item.customer_received || '—'}</span></div>)}</div><h3 className="subheading">Notes</h3><p className="detail-notes">{c.notes || 'No notes added.'}</p><h3 className="subheading">Evidence</h3><div className="evidence-grid">{(data.evidence || []).map(file => file.signed_url ? <a href={file.signed_url} target="_blank" rel="noreferrer" key={file.id}>{file.file_name}</a> : <span key={file.id}>{file.file_name}</span>)}{!data.evidence?.length && <span>No evidence uploaded.</span>}</div></div><aside className="detail-side"><div className="panel"><h3>Update claim</h3><SelectField label="Status" value={c.claim_status} onChange={value => update({ claim_status: value })} options={STATUSES} /><Field label="Owner" value={c.owner || ''} onChange={value => update({ owner: value })} /><SelectField label="Resolution" value={c.resolution || ''} onChange={value => update({ resolution: value })} options={RESOLUTIONS} /><SelectField label="Root Cause" value={c.root_cause || ''} onChange={value => update({ root_cause: value })} options={ROOT_CAUSES} />{saving && <small>Saving…</small>}</div><div className="panel"><h3>Activity history</h3><div className="timeline">{(data.history || []).map(entry => <div className="timeline-entry" key={entry.id}><strong>{entry.action}</strong><span>{dateLabel(entry.created_at, true)} · {entry.user_id || 'System'}</span>{entry.comment && <p>{entry.comment}</p>}</div>)}{!data.history?.length && <span className="muted">No activity yet.</span>}</div></div></aside></div></>
}
function Info({ label, value }) { return <div className="info-cell"><span>{label}</span><strong>{value || '—'}</strong></div> }

function ReportsPage() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  async function generate() {
    try {
      setError('')
      const [year, monthNumber] = month.split('-').map(Number)
      const lastDay = new Date(year, monthNumber, 0).getDate()
      const from = `${month}-01`
      const to = `${month}-${String(lastDay).padStart(2, '0')}`
      setData(await apiJson(`/api/kpi?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`))
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => { generate() }, [month])

  return <>
    <Header title="KPI Reports" eyebrow="Management reporting" action={<div className="header-actions"><input type="month" value={month} onChange={e => setMonth(e.target.value)} /><button className="primary-button" onClick={generate}>Generate report</button></div>} />
    {error && <div className="form-error">{error}</div>}
    {data && <><div className="stat-grid"><StatCard label="Total Claims" value={data.metrics.total} /><StatCard label="Items Affected" value={data.metrics.itemsAffected} tone="blue" /><StatCard label="Claim Value" value={money(data.metrics.claimValue)} tone="pink" /><StatCard label="External Claims" value={data.metrics.external} tone="gold" /></div><div className="dashboard-grid"><BarList title="Claims by Type" rows={data.byType} /><BarList title="Claims by Root Cause" rows={data.byRootCause} /><BarList title="Resolutions" rows={data.byResolution} /><BarList title="Carriers" rows={data.byCarrier} /></div></>}
  </>
}
function RecurringPage() { const [data, setData] = useState(null); useEffect(() => { apiJson('/api/kpi').then(setData).catch(() => {}) }, []); return <><Header title="Recurring Issues" eyebrow="Patterns worth fixing" />{data && <div className="panel"><div className="panel-title"><h3>Top problem SKUs</h3><span className="muted">Ranked by claim count</span></div><MiniTable rows={data.recurring || []} headers={['SKU / Product', 'Claims', 'Affected Qty', 'Claim Value']} render={row => [<span className="strong-cell">{row.sku}<small>{row.product}</small></span>, row.claims, row.quantity, money(row.value)]} /></div>}</> }
function SettingsPage() { return <><Header title="System Settings" eyebrow="Claims workflow" /><div className="settings-grid"><div className="panel"><h3>Claims workflow</h3><p className="muted">Claims are stored in Supabase and every important status/owner change is recorded in the claim history.</p><div className="setting-row"><span>Claim number format</span><strong>SC-YYYY-0001</strong></div><div className="setting-row"><span>Normal aging</span><strong>0–2 days</strong></div><div className="setting-row"><span>Follow-up aging</span><strong>3–6 days</strong></div><div className="setting-row"><span>Overdue aging</span><strong>7+ days</strong></div></div><div className="panel"><h3>Status definitions</h3>{STATUSES.map(status => <div className="setting-row" key={status}><StatusBadge status={status} /><span>{status === 'Open' ? 'Newly submitted claim' : status === 'In Progress' ? 'Someone is actively working it' : status === 'Pending' ? 'Waiting on customer, vendor, or carrier' : status === 'Resolved' ? 'Resolution completed' : 'Closed and archived'}</span></div>)}</div><div className="panel"><h3>Recurring issues</h3><p className="muted">Common claim categories and recurring SKUs are calculated from structured claim records. Import historical Slack data to make these insights complete.</p></div></div></> }

export default function App() {
  const [user, setUser] = useState(() => { try { return JSON.parse(localStorage.getItem('claims_user') || 'null') } catch { return null } })
  const [page, setPage] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('view') === 'claim' && params.get('id') ? `claim:${params.get('id')}` : 'dashboard'
  })
  function logout() { localStorage.removeItem('claims_user'); setUser(null) }
  if (!user) return <Login onLogin={setUser} />
  let content
  if (page === 'dashboard') content = <DashboardPage setPage={setPage} user={user} />
  else if (page === 'submit') content = <SubmitClaim user={user} onCreated={() => setPage('claims')} setPage={setPage} />
  else if (page === 'claims') content = <ClaimsPage setPage={setPage} />
  else if (page === 'open') content = <ClaimsPage setPage={setPage} status="Open" />
  else if (page === 'external') content = <ClaimsPage setPage={setPage} status="Pending" />
  else if (page === 'recurring') content = <RecurringPage />
  else if (page === 'reports') content = <ReportsPage />
  else if (page === 'settings') content = <SettingsPage />
  else if (page.startsWith('claim:')) content = <ClaimDetail id={page.split(':')[1]} setPage={setPage} user={user} />
  return <div className="app-shell"><Sidebar page={page.split(':')[0]} setPage={setPage} user={user} onLogout={logout} /><main className="main-content">{content}</main></div>
}
