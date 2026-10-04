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

/** Match core.js's "terminal too small" floor so we size the font to stay usable. */
const MIN_COLS = 34
const MIN_ROWS = 12
/** Aim for enough columns that the header / status line don't collide. */
const PREFERRED_COLS = 42
const MIN_FONT_PX = 10
const MAX_FONT_PX = 28

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

function visibleBox() {
  const innerW = window.innerWidth
  const innerH = window.innerHeight
  const vv = window.visualViewport
  if (!vv) return { w: innerW, h: innerH, left: 0, top: 0 }
  // Take the smaller size: soft keyboards shrink visualViewport, while some
  // environments update innerHeight first and leave visualViewport stale.
  const w = Math.min(innerW, vv.width)
  const h = Math.min(innerH, vv.height)
  const stale = vv.width > innerW + 1 || vv.height > innerH + 1
  return {
    w,
    h,
    left: stale ? 0 : vv.offsetLeft,
    top: stale ? 0 : vv.offsetTop,
  }
}

/** Phone portrait: a landscape 4:3 stage. Desktop / landscape: fill the viewport. */
function contentSize(vis) {
  const portraitMobile = vis.w < 600 && vis.w < vis.h
  if (!portraitMobile) return { w: Math.round(vis.w), h: Math.round(vis.h) }
  // Largest 4:3 rectangle inside the visible area (width-first; height if needed).
  let w = vis.w
  let h = (w * 3) / 4
  if (h > vis.h) {
    h = vis.h
    w = (h * 4) / 3
  }
  return { w: Math.round(w), h: Math.round(h) }
}

/** Position #screen (and the tap overlay) for the current visual viewport. */
function layoutScreen(screen) {
  const vis = visibleBox()
  const { w, h } = contentSize(vis)
  const ox = vis.left + (vis.w - w) / 2
  const oy = vis.top + (vis.h - h) / 2
  screen.style.transform = 'none'
  screen.style.width = `${w}px`
  screen.style.height = `${h}px`
  screen.style.left = `${ox}px`
  screen.style.top = `${oy}px`

  const kbd = document.getElementById('kbd')
  if (kbd) {
    kbd.style.width = `${vis.w}px`
    kbd.style.height = `${vis.h}px`
    kbd.style.left = `${vis.left}px`
    kbd.style.top = `${vis.top}px`
  }
  return { w, h, vis }
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
  const cols = Math.max(1, Math.floor((screen.clientWidth - padX) / cw))
  const rows = Math.max(1, Math.floor((screen.clientHeight - padY) / ch))
  return { cols, rows }
}

/**
 * Fit the monospace grid to the viewport: prefer PREFERRED_COLS so the UI
 * stays readable, but never drop below MIN_COLS × MIN_ROWS when possible.
 */
function fitFont(screen, probe) {
  // Phones can go a bit larger; desktop keeps the previous ~18px ceiling.
  const maxFont = screen.clientWidth < 600 ? MAX_FONT_PX : 18
  const largestFor = (wantCols) => {
    let lo = MIN_FONT_PX
    let hi = maxFont
    let best = MIN_FONT_PX
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2)
      screen.style.fontSize = `${mid}px`
      const { cols, rows } = measureGrid(screen, probe)
      if (cols >= wantCols && rows >= MIN_ROWS) {
        best = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return best
  }
  // Prefer a comfortable width; if the viewport is too narrow for that,
  // fall back to the hard minimum so core doesn't show "too small".
  let size = largestFor(PREFERRED_COLS)
  screen.style.fontSize = `${size}px`
  let grid = measureGrid(screen, probe)
  if (grid.cols < MIN_COLS || grid.rows < MIN_ROWS) {
    size = largestFor(MIN_COLS)
    screen.style.fontSize = `${size}px`
    grid = measureGrid(screen, probe)
  }
  return grid
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
  const kbd = document.getElementById('kbd')
  const cfg = configFromPage()
  const state = new State(cfg)

  const applyToken = (token) => {
    if (token === 'IGNORE') return
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

  const frame = () => {
    layoutScreen(screen)
    const { cols, rows } = fitFont(screen, probe)
    paintCanvas(screen, render(state, rows, cols))
  }

  const onKey = (e) => {
    // Mobile IMEs often emit keyCode 229 / Unidentified; the input handler covers those.
    if (e.isComposing || e.keyCode === 229 || e.key === 'Unidentified') return
    const token = eventToken(e)
    if (token === 'IGNORE') return
    e.preventDefault()
    applyToken(token)
  }

  const onInput = () => {
    const value = kbd.value
    if (!value) return
    kbd.value = ''
    for (const ch of value) {
      if (ch === '\n' || ch === '\r') applyToken('ENTER')
      else applyToken(ch)
    }
  }

  kbd.addEventListener('keydown', onKey)
  kbd.addEventListener('input', onInput)
  // A real focused field is what makes the soft keyboard appear on mobile.
  const focusKbd = () => kbd.focus({ preventScroll: true })
  document.addEventListener('pointerdown', focusKbd)

  let viewportKey = ''
  const frameIfViewportChanged = () => {
    const vis = visibleBox()
    const key = `${Math.round(vis.w)}x${Math.round(vis.h)}@${Math.round(vis.left)},${Math.round(vis.top)}`
    if (key === viewportKey) return
    viewportKey = key
    frame()
  }

  window.addEventListener('resize', frameIfViewportChanged)
  window.visualViewport?.addEventListener('resize', frameIfViewportChanged)
  window.visualViewport?.addEventListener('scroll', frameIfViewportChanged)
  // Observe the document (not #screen): we size #screen ourselves, so watching
  // it would miss viewport changes that don't emit a window resize event.
  new ResizeObserver(frameIfViewportChanged).observe(document.documentElement)
  // Soft-keyboard viewport changes are not reliable across browsers; poll lightly.
  setInterval(frameIfViewportChanged, 250)
  frameIfViewportChanged()
  focusKbd()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start)
} else {
  start()
}
