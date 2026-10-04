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

/**
 * Logical terminal size (keyboard-closed). Width changes (rotation) reset it;
 * height only grows so a soft keyboard opening doesn't collapse the grid.
 */
let stableW = 0
let stableH = 0

function logicalSize() {
  const w = window.innerWidth
  const h = Math.max(window.innerHeight, window.visualViewport?.height ?? 0)
  if (!stableW || Math.abs(w - stableW) > 50) {
    stableW = w
    stableH = h
  } else {
    stableW = w
    if (h > stableH) stableH = h
  }
  return { w: stableW, h: stableH }
}

/** Size #screen to the keyboard-closed logical viewport (no scale). */
function sizeLogical(screen) {
  const { w, h } = logicalSize()
  screen.style.transform = 'none'
  screen.style.width = `${w}px`
  screen.style.height = `${h}px`
  screen.style.left = '0px'
  screen.style.top = '0px'
  return { w, h }
}

/**
 * Scale the logical terminal into the visual viewport so the full grid stays
 * visible when the soft keyboard eats the bottom of the screen.
 */
function fitToVisible(screen) {
  const vv = window.visualViewport
  const visW = vv?.width ?? window.innerWidth
  const visH = vv?.height ?? window.innerHeight
  const left = vv?.offsetLeft ?? 0
  const top = vv?.offsetTop ?? 0
  const logW = screen.clientWidth || logicalSize().w
  const logH = screen.clientHeight || logicalSize().h
  const scale = Math.min(visW / logW, visH / logH, 1)
  const ox = left + (visW - logW * scale) / 2
  const oy = top + (visH - logH * scale) / 2
  screen.style.left = `${ox}px`
  screen.style.top = `${oy}px`
  screen.style.transformOrigin = 'top left'
  screen.style.transform = scale < 1 ? `scale(${scale})` : 'none'

  const kbd = document.getElementById('kbd')
  if (kbd) {
    // Overlay tracks the visible viewport (taps), not the scaled logical screen.
    kbd.style.width = `${visW}px`
    kbd.style.height = `${visH}px`
    kbd.style.left = `${left}px`
    kbd.style.top = `${top}px`
  }
  return { scale, logW, logH, visW, visH }
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
    sizeLogical(screen)
    const { cols, rows } = fitFont(screen, probe)
    paintCanvas(screen, render(state, rows, cols))
    fitToVisible(screen)
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
  window.addEventListener('resize', frame)
  window.visualViewport?.addEventListener('resize', frame)
  window.visualViewport?.addEventListener('scroll', frame)
  new ResizeObserver(frame).observe(screen)
  frame()
  focusKbd()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start)
} else {
  start()
}
