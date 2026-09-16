// Shopify order lookup layer for the Shipping Claims form.
// Requires SHOPIFY_STORE and SHOPIFY_ACCESS_TOKEN in Vercel.

function clean(value) { return String(value ?? '').trim() }

async function graphql(store, token, query, variables) {
  const version = process.env.SHOPIFY_API_VERSION || '2025-10'
  const response = await fetch(`https://${store}/admin/api/${version}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(`Shopify HTTP ${response.status}`)
  if (data.errors?.length) throw new Error(data.errors.map(error => error.message).join('; '))
  return data.data
}

const ORDER_QUERY = `
  query findShippingClaimOrder($query: String!) {
    orders(first: 1, query: $query) {
      nodes {
        id
        name
        createdAt
        processedAt
        customer { displayName email }
        fulfillments(first: 10) {
          createdAt
          location { id name }
          trackingInfo { company number url }
        }
        lineItems(first: 100) {
          nodes {
            quantity
            sku
            name
            title
            variant { title }
            originalUnitPriceSet { shopMoney { amount currencyCode } }
          }
        }
      }
    }
  }
`

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const store = clean(process.env.SHOPIFY_STORE)
  const token = clean(process.env.SHOPIFY_ACCESS_TOKEN)
  const rawOrder = clean(req.query?.order).replace(/^#/, '')
  if (!store || !token) return res.status(503).json({ error: 'Shopify is not configured yet.' })
  if (!rawOrder) return res.status(400).json({ error: 'Order number is required.' })

  try {
    const data = await graphql(store, token, ORDER_QUERY, { query: `name:${rawOrder}` })
    const order = data.orders?.nodes?.[0]
    if (!order) return res.status(404).json({ error: `Shopify order ${rawOrder} was not found.` })

    const fulfillment = order.fulfillments?.[0]
    const tracking = fulfillment?.trackingInfo?.find(item => item.url || item.number)
    return res.status(200).json({
      order: {
        order_number: order.name,
        customer_name: order.customer?.displayName || '',
        date_shipped: fulfillment?.createdAt ? fulfillment.createdAt.slice(0, 10) : '',
        date_delivered: '',
        carrier: tracking?.company || 'Unknown',
        tracking_url: tracking?.url || '',
        location_id: fulfillment?.location?.id || '',
        location_name: fulfillment?.location?.name || '',
        items: (order.lineItems?.nodes || []).map(item => ({
          sku: item.sku || '',
          product_name: item.name || item.title || item.variant?.title || '',
          quantity: item.quantity || 0,
          unit_value: item.originalUnitPriceSet?.shopMoney?.amount || '',
          issue_type: '',
          customer_received: '',
          notes: '',
        })),
      },
    })
  } catch (error) {
    console.error('Shopify order lookup error:', error)
    return res.status(500).json({ error: error.message || 'Shopify lookup failed.' })
  }
}
