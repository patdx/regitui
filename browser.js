/*
 * regitui — browser host: DOM keyboard, paint into #screen, window.print.
 */

import { State, defaultConfig, render, printText } from './core.js'

const TAG_CLASS = {
  total: 'c-total',
  change: 'c-change',
  label: 'c-label',
  dim: 'c-dim',
  warn: 'c-warn',
  ok: 'c-ok',
  frame: 'c-frame',
  hl: 'c-hl',
}

function configFromPage() {
  const cfg = defaultConfig()
  const params = new URLSearchParams(location.search)
  if (params.has('dollars')) {
    cfg.currency = '$'
    cfg.decimals = 2
  }
  if (params.has('currency')) cfg.currency = params.get('currency')
  if (params.has('decimals'))
    cfg.decimals = parseInt(params.get('decimals'), 10) || 0
  if (params.has('store')) cfg.store = params.get('store')
  if (params.has('font')) cfg.font = params.get('font')
  if (params.has('ascii')) cfg.asciiArt = true
  if (params.has('receipt-width'))
    cfg.receiptWidth = parseInt(params.get('receipt-width'), 10) || 32
  return cfg
}

/** KeyboardEvent → register token (same vocabulary as core keyToken / State.handle). */
function eventToken(e) {
  if (e.ctrlKey && (e.key === 'p' || e.key === 'P')) return 'PRINT'
  if (
    e.ctrlKey &&
    (e.key === 'c' || e.key === 'C' || e.key === 'd' || e.key === 'D')
  )
    return 'Q'
  switch (e.key) {
    case 'Enter':
      return 'ENTER'
    case 'Backspace':
      return 'BACKSPACE'
    case 'Escape':
      return 'ESC'
    case ' ':
      return ' '
    default:
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey)
        return e.key
      return 'IGNORE'
  }
}

function measureGrid(screen, probe) {
  const style = getComputedStyle(screen)
  probe.style.font = style.font
  probe.style.lineHeight = style.lineHeight
  probe.style.letterSpacing = style.letterSpacing
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
  const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
  const cw = probe.getBoundingClientRect().width || 8
  const ch = probe.getBoundingClientRect().height || 16
  const cols = Math.max(20, Math.floor((screen.clientWidth - padX) / cw))
  const rows = Math.max(8, Math.floor((screen.clientHeight - padY) / ch))
  return { cols, rows }
}

/** Paint a Canvas into #screen using per-cell CSS classes (no ANSI). */
function paintCanvas(screen, canvas) {
  const parts = []
  for (let y = 0; y < canvas.rows; y++) {
    let current = null
    for (let x = 0; x < canvas.cols; x++) {
      const ch = canvas.grid[y][x]
      if (ch === '') continue // second cell of a wide glyph
      const tag = canvas.tags[y][x]
      const cls = TAG_CLASS[tag] || null
      if (cls !== current) {
        if (current) parts.push('</span>')
        if (cls) parts.push(`<span class="${cls}">`)
        current = cls
      }
      parts.push(ch === ' ' ? ' ' : escapeHtml(ch))
    }
    if (current) parts.push('</span>')
    if (y < canvas.rows - 1) parts.push('\n')
  }
  screen.innerHTML = parts.join('')
}

function escapeHtml(ch) {
  if (ch === '&') return '&amp;'
  if (ch === '<') return '&lt;'
  if (ch === '>') return '&gt;'
  return ch
}

function printReceiptBrowser(state, cfg) {
  if (!state.items.length) return { ok: false, message: 'nothing to print yet' }
  const sheet = document.getElementById('print-sheet')
  sheet.textContent = printText(state, cfg).replace(/\n$/, '')
  window.print()
  return { ok: true, message: 'print dialog opened' }
}

function start() {
  const screen = document.getElementById('screen')
  const probe = document.getElementById('probe')
  const cfg = configFromPage()
  const state = new State(cfg)

  const frame = () => {
    const { cols, rows } = measureGrid(screen, probe)
    paintCanvas(screen, render(state, rows, cols))
  }

  const onKey = (e) => {
    const token = eventToken(e)
    if (token === 'IGNORE') return
    e.preventDefault()
    state.handle(token)
    if (state.quit) {
      state.quit = false
      state.message = 'refresh the page to start over'
      state.messageKind = 'dim'
    }
    if (state.printRequested) {
      state.printRequested = false
      const result = printReceiptBrowser(state, cfg)
      state.message = result.message
      state.messageKind = result.ok ? 'ok' : 'warn'
    }
    frame()
  }

  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', frame)
  new ResizeObserver(frame).observe(screen)
  frame()
  screen.focus({ preventScroll: true })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start)
} else {
  start()
}
