import jsPDFModule from 'jspdf'
import autoTable from 'jspdf-autotable'
import { KSC_LOGO_DATA_URL } from '../ksc-logo-base64.js'

const JsPDF = jsPDFModule.jsPDF || jsPDFModule

const COLORS = {
  brown: [138, 93, 59],
  darkBrown: [73, 48, 35],
  pink: [255, 168, 189],
  palePink: [255, 240, 244],
  cream: [255, 250, 245],
  white: [255, 255, 255],
  line: [235, 220, 211],
  muted: [135, 113, 99],
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`
}

function tableRows(rows, emptyLabel = 'No data for this period', columnCount = 2) {
  return rows?.length ? rows : [[emptyLabel, ...Array(Math.max(1, columnCount - 1)).fill('—')]]
}

function addFooter(doc) {
  const width = doc.internal.pageSize.getWidth()
  const height = doc.internal.pageSize.getHeight()
  doc.setDrawColor(...COLORS.line)
  doc.setLineWidth(0.6)
  doc.line(36, height - 30, width - 36, height - 30)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...COLORS.muted)
  doc.text('Kawaii Slime Company  •  Internal operations report', 36, height - 17)
  doc.text(`Page ${doc.internal.getNumberOfPages()}`, width - 36, height - 17, { align: 'right' })
}

function pageBackground(doc) {
  const width = doc.internal.pageSize.getWidth()
  const height = doc.internal.pageSize.getHeight()
  doc.setFillColor(...COLORS.cream)
  doc.rect(0, 0, width, height, 'F')
  doc.setFillColor(...COLORS.pink)
  doc.rect(0, 0, width, 8, 'F')
}

function reportHeader(doc, monthLabel, generatedAt, compact = false) {
  const width = doc.internal.pageSize.getWidth()
  pageBackground(doc)

  if (!compact) {
    doc.addImage(KSC_LOGO_DATA_URL, 'PNG', 36, 19, 154, 47, undefined, 'FAST')
    doc.setTextColor(...COLORS.brown)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(20)
    doc.text('SHIPPING CLAIMS', width - 36, 35, { align: 'right' })
    doc.setTextColor(...COLORS.pink)
    doc.setFontSize(10)
    doc.text('KPI REPORT', width - 36, 51, { align: 'right' })
    doc.setTextColor(...COLORS.muted)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.text(`${monthLabel}  •  Generated ${generatedAt}`, width - 36, 66, { align: 'right' })
    doc.setDrawColor(...COLORS.line)
    doc.setLineWidth(0.8)
    doc.line(36, 84, width - 36, 84)
  } else {
    doc.addImage(KSC_LOGO_DATA_URL, 'PNG', 36, 18, 102, 31, undefined, 'FAST')
    doc.setTextColor(...COLORS.brown)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text('KSC SHIPPING CLAIMS KPI REPORT', width - 36, 34, { align: 'right' })
    doc.setTextColor(...COLORS.muted)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(monthLabel, width - 36, 49, { align: 'right' })
    doc.setDrawColor(...COLORS.line)
    doc.line(36, 64, width - 36, 64)
  }
}

function drawMetricCards(doc, metrics) {
  const width = doc.internal.pageSize.getWidth()
  const left = 36
  const gap = 8
  const cardWidth = (width - 72 - gap * 6) / 7
  const y = 105
  const height = 66
  const values = [
    ['Total Claims', metrics.total, COLORS.pink],
    ['Open / Active', metrics.open, [244, 201, 139]],
    ['Pending', metrics.pending, [250, 220, 135]],
    ['Resolved', metrics.resolved, [174, 215, 177]],
    ['Items Affected', metrics.itemsAffected, [177, 213, 224]],
    ['Claim Value', money(metrics.claimValue), COLORS.pink],
    ['External Claims', metrics.external, [205, 183, 225]],
  ]

  values.forEach(([label, value, accent], index) => {
    const x = left + index * (cardWidth + gap)
    doc.setFillColor(...COLORS.white)
    doc.setDrawColor(...COLORS.line)
    doc.setLineWidth(0.7)
    doc.roundedRect(x, y, cardWidth, height, 7, 7, 'FD')
    doc.setFillColor(...accent)
    doc.roundedRect(x, y, cardWidth, 5, 2, 2, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.2)
    doc.setTextColor(...COLORS.muted)
    doc.text(label.toUpperCase(), x + 9, y + 22)
    doc.setFontSize(label === 'Claim Value' ? 13 : 18)
    doc.setTextColor(...COLORS.darkBrown)
    doc.text(String(value ?? 0), x + 9, y + 48)
  })
}

function addTable(doc, { title, head, body, x, y, width, columnStyles = {} }) {
  doc.setFillColor(...COLORS.pink)
  doc.roundedRect(x, y - 13, 5, 15, 2, 2, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...COLORS.darkBrown)
  doc.text(title, x + 12, y)

  autoTable(doc, {
    startY: y + 9,
    margin: { left: x, right: doc.internal.pageSize.getWidth() - x - width },
    tableWidth: width,
    theme: 'grid',
    head: [head],
    body,
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: 5,
      textColor: COLORS.darkBrown,
      lineColor: COLORS.line,
      lineWidth: 0.45,
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: COLORS.brown,
      textColor: COLORS.white,
      fontStyle: 'bold',
      fontSize: 7.5,
      cellPadding: 5,
    },
    alternateRowStyles: { fillColor: [255, 244, 242] },
    columnStyles,
    didDrawPage: () => addFooter(doc),
  })

  return (doc.lastAutoTable?.finalY || y + 30) + 18
}

export function createKpiPdf({
  monthLabel,
  metrics,
  byType = [],
  byRootCause = [],
  byResolution = [],
  byCarrier = [],
  productBreakdown = [],
  openClaims = [],
  generatedAt = new Date().toLocaleString('en-US'),
}) {
  const doc = new JsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const width = doc.internal.pageSize.getWidth()
  const columnGap = 18
  const columnWidth = (width - 72 - columnGap) / 2

  reportHeader(doc, monthLabel, generatedAt)
  drawMetricCards(doc, metrics)

  let leftY = 207
  leftY = addTable(doc, {
    title: 'Claims by Type',
    head: ['Claim Type', 'Claims'],
    body: tableRows(byType.map(row => [row.label, row.value])),
    x: 36,
    y: leftY,
    width: columnWidth,
    columnStyles: { 0: { cellWidth: columnWidth * 0.74 }, 1: { cellWidth: columnWidth * 0.26, halign: 'right' } },
  })
  addTable(doc, {
    title: 'Root Causes',
    head: ['Root Cause', 'Claims'],
    body: tableRows(byRootCause.map(row => [row.label, row.value])),
    x: 36,
    y: leftY,
    width: columnWidth,
    columnStyles: { 0: { cellWidth: columnWidth * 0.74 }, 1: { cellWidth: columnWidth * 0.26, halign: 'right' } },
  })

  let rightY = 207
  rightY = addTable(doc, {
    title: 'Resolutions',
    head: ['Resolution', 'Claims'],
    body: tableRows(byResolution.map(row => [row.label, row.value])),
    x: 36 + columnWidth + columnGap,
    y: rightY,
    width: columnWidth,
    columnStyles: { 0: { cellWidth: columnWidth * 0.74 }, 1: { cellWidth: columnWidth * 0.26, halign: 'right' } },
  })
  addTable(doc, {
    title: 'Carriers',
    head: ['Carrier', 'Claims'],
    body: tableRows(byCarrier.map(row => [row.label, row.value])),
    x: 36 + columnWidth + columnGap,
    y: rightY,
    width: columnWidth,
    columnStyles: { 0: { cellWidth: columnWidth * 0.74 }, 1: { cellWidth: columnWidth * 0.26, halign: 'right' } },
  })

  doc.addPage()
  reportHeader(doc, monthLabel, generatedAt, true)
  addTable(doc, {
    title: 'Affected Products / SKUs',
    head: ['SKU', 'Product', 'Claims', 'Affected Qty', 'Claim Value'],
    body: tableRows(productBreakdown.map(row => [
      row.sku || '—',
      row.product || 'Unspecified product',
      row.claims,
      row.quantity,
      money(row.value),
    ]), 'No affected products recorded', 5),
    x: 36,
    y: 93,
    width: width - 72,
    columnStyles: {
      0: { cellWidth: 160 },
      1: { cellWidth: 260 },
      2: { cellWidth: 70, halign: 'right' },
      3: { cellWidth: 90, halign: 'right' },
      4: { cellWidth: 185, halign: 'right' },
    },
  })

  doc.addPage()
  reportHeader(doc, monthLabel, generatedAt, true)
  addTable(doc, {
    title: 'Open Claims Detail',
    head: ['Claim', 'Order', 'Customer', 'Status', 'Owner', 'Days Open'],
    body: tableRows(openClaims.map(row => [
      row.claim_number,
      row.order_number,
      row.customer_name,
      row.claim_status,
      row.owner || 'Unassigned',
      row.days_open,
    ]), 'No open claims for this period', 6),
    x: 36,
    y: 93,
    width: width - 72,
    columnStyles: {
      0: { cellWidth: 120 },
      1: { cellWidth: 100 },
      2: { cellWidth: 220 },
      3: { cellWidth: 100 },
      4: { cellWidth: 135 },
      5: { cellWidth: 75, halign: 'right' },
    },
  })

  addFooter(doc)
  return doc
}
