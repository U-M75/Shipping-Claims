# KSC Shipping Claims & Resolution System

A production-ready internal claims workflow for Kawaii Slime Company. It replaces free-form shipping claim messages with structured claims, affected items, evidence, status history, ownership, recurring issue reporting, and KPI views.

## Included MVP features

- Internal PIN login
- Dashboard KPI cards and charts
- Submit Shipping Claim workflow
- Multiple affected SKU/item rows per claim
- Claim type multi-select
- Resolution and root-cause tracking
- External vendor/carrier claim fields
- Claim owner and department
- Claim aging and status badges
- All Claims / Open Claims / Pending Claims tables
- Claim detail page with activity history
- Evidence image upload to Supabase Storage
- Recurring issue view
- Monthly KPI report view
- Bread Display Tracker starter view
- Dashboard filters and search
- PDF-ready reporting structure
- Historical CSV import API architecture
- Shopify and Slack integration placeholders without fake credentials

## Supabase setup

Create a Supabase project and run this file once in SQL Editor:

```text
supabase-shipping-claims-schema.sql
```

The schema creates:

```text
shipping_claims
shipping_claim_items
claim_evidence
claim_history
shipping_claim_counters
staff
vendors
carriers
```

It also creates the `claim-evidence` Storage bucket and the `next_shipping_claim_number()` function used for IDs such as:

```text
SC-2026-0001
```

## Vercel environment variables

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
CLAIMS_APP_PIN=your-internal-pin
```

Keep `SUPABASE_SERVICE_KEY` private. Never use it in a `VITE_` variable or commit it to GitHub.

Shopify integration variables:

```text
SHOPIFY_STORE=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=your-admin-token
SHOPIFY_API_VERSION=2025-10
```

Required Shopify Admin API scopes for order lookup:

```text
read_orders
read_products
```

Optional scopes:

```text
read_all_orders
read_customers
read_locations
read_inventory
```

Slack notification variables:

```text
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_SHIPPING_CLAIMS_CHANNEL_ID=C0123456789
APP_BASE_URL=https://your-app.vercel.app
```

Required Slack bot scope for the current notification integration:

```text
chat:write
```

The browser form can use the Shopify lookup button when Shopify credentials are configured. New claims send a structured Slack notification when the Slack variables are configured. No credentials are fabricated or included in the repository.

## API routes

```text
POST /api/auth
GET  /api/claims
POST /api/claims
PATCH /api/claims
GET  /api/kpi
```

## Deploy on Vercel

The app is a Vite + React app with serverless API routes.

1. Upload the files to the GitHub repository root.
2. Make sure `api/`, `src/`, `public/`, `index.html`, `package.json`, and `vercel.json` are directly in the root.
3. Set Vercel Root Directory to blank or `.`.
4. Run the Supabase SQL schema.
5. Add Vercel environment variables.
6. Deploy.

## Local development

```bash
npm install
npm run dev
```

The Vite UI runs at `http://localhost:5173`. The server API routes run on Vercel, so use `vercel dev` with a local `.env.local` when testing Supabase APIs locally.
