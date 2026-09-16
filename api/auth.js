// Lightweight internal login. Set CLAIMS_APP_PIN in Vercel for production.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { name, pin } = req.body || {}
  const expected = String(process.env.CLAIMS_APP_PIN || '').trim()
  if (!expected) return res.status(500).json({ error: 'CLAIMS_APP_PIN is not configured.' })
  if (!String(name || '').trim() || String(pin || '').trim() !== expected) {
    return res.status(401).json({ error: 'Incorrect name or PIN.' })
  }
  return res.status(200).json({ success: true, user: { name: String(name).trim() } })
}
