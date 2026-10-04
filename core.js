/*
 * regitui core — pure register logic shared by the Node and browser hosts.
 * No Node APIs, no DOM. Hosts own keyboard, paint, and print.
 */

// --------------------------------------------------------------------------
// big text fonts - hand-written bitmaps
//
// Each glyph is an array of strings (one per row); any non-space character is
// "ink". A glyph's width is its widest row, so widths are proportional.
// --------------------------------------------------------------------------

const SEG_FONT = {
  0: ['█████', '█   █', '█   █', '█   █', '█   █', '█   █', '█████'],
  1: [' █ ', ' █ ', ' █ ', ' █ ', ' █ ', ' █ ', ' █ '],
  2: ['█████', '    █', '    █', '█████', '█    ', '█    ', '█████'],
  3: ['█████', '    █', '    █', '█████', '    █', '    █', '█████'],
  4: ['█   █', '█   █', '█   █', '█████', '    █', '    █', '    █'],
  5: ['█████', '█    ', '█    ', '█████', '    █', '    █', '█████'],
  6: ['█████', '█    ', '█    ', '█████', '█   █', '█   █', '█████'],
  7: ['█████', '    █', '    █', '    █', '    █', '    █', '    █'],
  8: ['█████', '█   █', '█   █', '█████', '█   █', '█   █', '█████'],
  9: ['█████', '█   █', '█   █', '█████', '    █', '    █', '█████'],
  '.': ['   ', '   ', '   ', '   ', '   ', '   ', ' █ '],
  ',': ['   ', '   ', '   ', '   ', '   ', ' █ ', ' █ '],
  '-': ['     ', '     ', '     ', '█████', '     ', '     ', '     '],
  ' ': ['   ', '   ', '   ', '   ', '   ', '   ', '   '],
}

const BIG_FONT = {
  0: ['  ___  ', ' / _ \\ ', '| | | |', '| |_| |', ' \\___/ '],
  1: ['  _ ', ' / |', ' | |', ' | |', ' |_|'],
  2: [' ____  ', '|___ \\ ', '  __) |', ' / __/ ', '|_____|'],
  3: [' _____ ', '|___ / ', '  |_ \\ ', ' ___) |', '|____/ '],
  4: [' _  _   ', '| || |  ', '| || |_ ', '|__   _|', '   |_|  '],
  5: [' ____  ', '| ___| ', '|___ \\ ', ' ___) |', '|____/ '],
  6: ['  __   ', ' / /_  ', "| '_ \\ ", '| (_) |', ' \\___/ '],
  7: [' _____ ', '|___  |', '   / / ', '  / /  ', ' /_/   '],
  8: ['  ___  ', ' ( _ ) ', ' / _ \\ ', '| (_) |', ' \\___/ '],
  9: ['  ___  ', ' / _ \\ ', '| (_) |', ' \\\\__, |', '   /_/ '],
  '.': ['   ', '   ', '   ', '   ', '(_)'],
  ',': ['   ', '   ', '   ', ' _ ', '(_)'],
  '-': ['    ', '    ', '    ', '____', '    '],
  ' ': ['   ', '   ', '   ', '   ', '   '],
}

const FONTS = { seg: SEG_FONT, big: BIG_FONT }

/** every glyph in a font is padded to this many rows */
function fontHeight(font) {
  return Math.max(...Object.values(font).map((g) => g.length))
}

function bigText(text, scale, font = SEG_FONT) {
  const h = fontHeight(font)
  const gap = ' '.repeat(scale)
  const rows = new Array(h).fill('')
  for (let i = 0; i < text.length; i++) {
    const glyph = font[text[i]] ?? font[' ']
    for (let r = 0; r < h; r++) {
      const line = r < glyph.length ? glyph[r] : ''
      rows[r] += [...line].map((c) => c.repeat(scale)).join('')
      if (i !== text.length - 1) rows[r] += gap
    }
  }
  const out = []
  for (const row of rows) for (let i = 0; i < scale; i++) out.push(row)
  return out
}

function artSize(text, scale, font) {
  const art = bigText(text, scale, font)
  return { w: Math.max(0, ...art.map((l) => l.length)), h: art.length }
}

/**
 * Terminal display width of a string: CJK characters (and friends) take two
 * columns, so 円 counts as 2 and ¥ as 1. Everything that pads or centres text uses
 * these helpers so receipts and frames line up whatever symbol is used.
 */
const WIDE_RANGES = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
]

function charWidth(cp) {
  if (
    cp === 0 ||
    cp < 32 ||
    (cp >= 0x7f && cp < 0xa0) ||
    (cp >= 0x300 && cp <= 0x36f)
  )
    return 0
  for (const [lo, hi] of WIDE_RANGES) if (cp >= lo && cp <= hi) return 2
  return 1
}

function dispWidth(text) {
  let w = 0
  for (const ch of text) w += charWidth(ch.codePointAt(0))
  return w
}

/** cut to at most `width` display columns, never splitting a wide character */
function clipTo(text, width) {
  let out = ''
  let w = 0
  for (const ch of text) {
    const cw = charWidth(ch.codePointAt(0))
    if (w + cw > width) break
    out += ch
    w += cw
  }
  return out
}

/** pad/clip to exactly `width` display columns */
function padTo(text, width, align = 'left') {
  const clipped = clipTo(text, width)
  const gap = Math.max(0, width - dispWidth(clipped))
  if (align === 'right') return ' '.repeat(gap) + clipped
  if (align === 'center') {
    const left = Math.floor(gap / 2)
    return ' '.repeat(left) + clipped + ' '.repeat(gap - left)
  }
  return clipped + ' '.repeat(gap)
}

// --------------------------------------------------------------------------
// tiny canvas: rendering is a pure function, so --demo can print it as text
// --------------------------------------------------------------------------

const SGR_RESET = '\x1b[0m'
const SGR = {
  total: '\x1b[1;32m',
  change: '\x1b[1;33m',
  label: '\x1b[36m',
  dim: '\x1b[2m',
  warn: '\x1b[1;31m',
  ok: '\x1b[32m',
  frame: '\x1b[34m',
  hl: '\x1b[7;1m',
}

class Canvas {
  constructor(rows, cols, asciiBoxes = false) {
    this.rows = Math.max(rows, 1)
    this.cols = Math.max(cols, 1)
    this.asciiBoxes = asciiBoxes
    this.grid = Array.from({ length: this.rows }, () =>
      new Array(this.cols).fill(' '),
    )
    this.tags = Array.from({ length: this.rows }, () =>
      new Array(this.cols).fill(null),
    )
  }

  put(y, x, text, tag = null) {
    if (y < 0 || y >= this.rows) return
    let col = x
    for (const ch of text) {
      const w = charWidth(ch.codePointAt(0)) || 1
      if (col >= 0 && col < this.cols) {
        this.grid[y][col] = ch
        this.tags[y][col] = tag
        // a double-width character owns the next cell too
        if (w === 2 && col + 1 < this.cols) {
          this.grid[y][col + 1] = ''
          this.tags[y][col + 1] = tag
        }
      }
      col += w
    }
  }

  putRight(y, xRight, text, tag = null) {
    this.put(y, xRight - dispWidth(text) + 1, text, tag)
  }

  box(y, x, h, w, title = '', tag = null) {
    if (h < 2 || w < 2 || y < 0 || x < 0) return
    const [tl, tr, bl, br, hor, ver] = this.asciiBoxes
      ? ['+', '+', '+', '+', '-', '|']
      : ['┌', '┐', '└', '┘', '─', '│']
    this.put(y, x, tl + hor.repeat(w - 2) + tr, tag)
    this.put(y + h - 1, x, bl + hor.repeat(w - 2) + br, tag)
    for (let r = 1; r < h - 1; r++) {
      this.put(y + r, x, ver, tag)
      this.put(y + r, x + w - 1, ver, tag)
    }
    if (title && w > title.length + 4) this.put(y, x + 2, ` ${title} `, tag)
  }

  plainLines() {
    // "" marks the second cell of a wide character: joining drops it
    return this.grid.map((row) => row.join('').replace(/\s+$/, ''))
  }

  /**
   * Colored lines, clipped to `maxWidth` *visible* columns (ANSI codes and
   * double-width characters are handled). `lastRowMax` can be smaller so the very
   * bottom-right cell is left untouched - writing it scrolls the terminal.
   */
  ansiLines(maxWidth = Infinity, lastRowMax = maxWidth) {
    return this.grid.map((row, y) => {
      const limit = y === this.rows - 1 ? lastRowMax : maxWidth
      let end = row.length
      while (end > 0 && (row[end - 1] === ' ' || row[end - 1] === '')) end--
      let out = ''
      let current
      let visible = 0
      for (let x = 0; x < end; x++) {
        const ch = row[x]
        const w = ch === '' ? 0 : charWidth(ch.codePointAt(0)) || 1
        if (visible + w > limit) break
        const tag = this.tags[y][x]
        if (tag !== current) {
          if (current !== undefined) out += SGR_RESET
          if (SGR[tag]) out += SGR[tag]
          current = tag
        }
        out += ch
        visible += w
      }
      if (current !== undefined) out += SGR_RESET
      return out
    })
  }
}

// --------------------------------------------------------------------------
// money helpers
// --------------------------------------------------------------------------

/** '1250' -> '1,250' (leaves decimals and stray dots alone) */
function groupInt(digits) {
  const dot = digits.indexOf('.')
  const head = dot === -1 ? digits : digits.slice(0, dot)
  const tail = dot === -1 ? '' : digits.slice(dot)
  if (!head) return digits
  const n = Number(head)
  const grouped = Number.isFinite(n) ? n.toLocaleString('en-US') : head
  return grouped + tail
}

function formatAmount(cfg, value) {
  if (cfg.decimals <= 0) return Math.round(value).toLocaleString('en-US')
  return value.toFixed(cfg.decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function money(cfg, value) {
  return cfg.currency + formatAmount(cfg, value)
}

/**
 * The symbol printed on the receipt: the currency symbol unless overridden, and
 * "" to print bare numbers.
 */
function receiptSymbol(cfg) {
  return cfg.receiptSymbol === null || cfg.receiptSymbol === undefined
    ? cfg.currency
    : cfg.receiptSymbol
}

/**
 * A printed amount. "auto" puts narrow symbols in front ($1.50, ¥123) and wide
 * ones after the number, the way 円 is written: 123円.
 */
function receiptMoney(cfg, value) {
  const sym = receiptSymbol(cfg)
  const number = formatAmount(cfg, value)
  if (!sym) return number
  const mode = cfg.receiptSymbolPosition || 'auto'
  const after = mode === 'after' || (mode === 'auto' && dispWidth(sym) > 1)
  return after ? number + sym : sym + number
}

// --------------------------------------------------------------------------
// the printed receipt: plain ASCII, fixed width, exactly what a printer gets
// --------------------------------------------------------------------------

/** 'YYYY-MM-DD HH:MM' in local time, or the fixed --receipt-time value */
function receiptTime(cfg) {
  if (cfg.receiptTime) return cfg.receiptTime
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * The sale as a real receipt: plain fixed-width text, ASCII only, exactly the
 * characters a printer would put on the paper. No borders or rules - sections are
 * separated by blank lines, the way they are on a till roll.
 */
function receiptLines(state, cfg) {
  const width = Math.max(20, cfg.receiptWidth)
  const out = []
  const center = (text) => {
    out.push(padTo(text, width, 'center'))
  }
  const priceW = width >= 28 ? 9 : 7
  const nameW = width - priceW - 1
  const amount = (label, value) => {
    out.push(
      padTo(padTo(label, nameW) + ' ' + padTo(value, priceW, 'right'), width),
    )
  }

  center(cfg.store)
  center(receiptTime(cfg))
  out.push(padTo('', width))
  center(`No. ${String(state.saleNo).padStart(4, '0')}`)
  out.push(padTo('', width))
  out.push(
    padTo(padTo('Item', nameW) + ' ' + padTo('Price', priceW, 'right'), width),
  )
  state.items.forEach((value, i) =>
    amount(`Item ${i + 1}`, receiptMoney(cfg, value)),
  )
  out.push(padTo('', width))
  amount('Items', String(state.items.length))
  amount('TOTAL', receiptMoney(cfg, state.total))
  if (state.paid) {
    amount('CASH', receiptMoney(cfg, state.tendered))
    amount('CHANGE', receiptMoney(cfg, state.change))
  }
  out.push(padTo('', width))
  center('Thank you!')
  center('Please come again')
  return out
}

// --------------------------------------------------------------------------
// printing layout maths (pure): hosts decide how to send bytes to paper
// --------------------------------------------------------------------------

const MONO_ADVANCE_EM = 0.60205 // DejaVu Sans Mono nominal advance width

/** portrait page widths in points, the way paps sees them */
const PAPER_WIDTH_PT = { a4: 595.28, letter: 612, legal: 612, a3: 841.89 }
const PRINT_VERTICAL_MARGIN_PT = 36
const PRINT_MIN_MARGIN_PT = 18

/**
 * The advance paps/cairo really lays out with: it hints glyph advances to whole
 * points, so 12pt DejaVu Sans Mono advances 7pt, not the nominal 7.22pt. Measured
 * with paps + ImageMagick at 8/10/11/12/14pt; the quantisation is visible in the
 * PDF's own TJ adjustments.
 */
function monoAdvance(size) {
  return Math.max(1, Math.round(size * MONO_ADVANCE_EM))
}

/**
 * How the receipt lands on the page: the largest font that still leaves a margin,
 * and the equal side margins that centre the block. Centring with margins rather
 * than leading spaces keeps the text handed to the printer exactly the receipt.
 */
function printLayout(cfg) {
  const page =
    PAPER_WIDTH_PT[(cfg.printPaper || 'a4').toLowerCase()] || PAPER_WIDTH_PT.a4
  const needed = Math.max(20, cfg.receiptWidth)
  let size = 12
  while (
    size > 5 &&
    needed * monoAdvance(size) > page - 2 * PRINT_MIN_MARGIN_PT
  ) {
    size = Math.round((size - 0.5) * 10) / 10
  }
  const advance = monoAdvance(size)
  return {
    size,
    advance,
    margin: Math.max(
      PRINT_MIN_MARGIN_PT,
      Math.floor((page - needed * advance) / 2),
    ),
  }
}

/**
 * The bytes handed to the printer: the receipt lines, verbatim. Centring is the
 * page's job (see printLayout), so nothing is added or reflowed here. A long
 * receipt is simply more lines, which the filter turns into more pages.
 */
function printText(state, cfg) {
  return receiptLines(state, cfg).join('\n') + '\n'
}

// --------------------------------------------------------------------------
// the register brain: pure logic, no terminal code
// --------------------------------------------------------------------------

class State {
  constructor(cfg) {
    this.cfg = cfg
    this.items = []
    this.entry = ''
    this.mode = 'amount' // amount | tender | change
    this.tendered = 0
    this.change = 0
    this.paid = false
    this.message = ''
    this.messageKind = 'dim'
    this.quit = false
    this.view = 'register' // register | receipt
    this.saleNo = 1
    this.printRequested = false // set by F/CTRL-P, cleared by the TUI
  }

  get total() {
    return this.items.reduce((a, b) => a + b, 0)
  }

  show(value) {
    return money(this.cfg, value)
  }

  /** grouped digits with no currency symbol - what the big font renders */
  plain(value) {
    if (this.cfg.decimals <= 0) return Math.round(value).toLocaleString('en-US')
    return money(this.cfg, value).slice(this.cfg.currency.length)
  }

  entryValue() {
    const v = parseFloat(this.entry)
    return Number.isFinite(v) ? v : 0
  }

  newSale() {
    if (this.paid) this.saleNo++
    this.items = []
    this.entry = ''
    this.tendered = 0
    this.change = 0
    this.paid = false
    this.mode = 'amount'
    this.view = 'register'
    this.message = 'new sale'
  }

  /** key: one printable character, or ENTER / ESC / BACKSPACE / PRINT */
  handle(key) {
    if (key === 'IGNORE' || key === 'RESIZE') return
    if (key === 'PRINT' || (key.length === 1 && key.toLowerCase() === 'f')) {
      this.requestPrint()
      return
    }
    if (this.view === 'receipt') {
      this.handleReceipt(key)
      return
    }
    if (key === 'BACKSPACE') {
      this.entry = this.entry.slice(0, -1)
      return
    }
    if (key === 'ESC') {
      if (this.mode === 'change') this.newSale()
      else {
        this.entry = ''
        this.message = ''
      }
      return
    }
    if (key === 'ENTER') {
      this.enter()
      return
    }
    if ([...key].length !== 1) return
    const low = key.toLowerCase()
    const isDigit = key >= '0' && key <= '9'

    if (isDigit || (key === '.' && this.cfg.decimals > 0)) this.typeDigit(key)
    else if (key === '.' && this.cfg.decimals <= 0)
      this.typeDigit('00') // yen "00" key
    else if (low === 'p') {
      if (this.mode === 'amount' && this.items.length) {
        this.mode = 'tender'
        this.entry = ''
        this.message = 'how much cash did they give you?'
        this.messageKind = 'dim'
      }
    } else if (low === 'u') {
      if (this.items.length) {
        this.items.pop()
        this.message = 'undid last item'
        this.messageKind = 'dim'
      }
      this.entry = ''
    } else if (low === 'n') this.newSale()
    else if (low === 'r') {
      if (this.items.length) this.view = 'receipt'
      else {
        this.message = 'nothing on the receipt yet'
        this.messageKind = 'warn'
      }
    } else if (low === 'q') this.quit = true
    else if (key === ' ') this.enter()
  }

  /** F or CTRL-P: ask the front-end to send this receipt to the printer */
  requestPrint() {
    if (this.items.length) {
      this.printRequested = true
      this.message = 'printing...'
      this.messageKind = 'dim'
    } else {
      this.message = 'nothing to print yet'
      this.messageKind = 'warn'
    }
  }

  handleReceipt(key) {
    const low = key.toLowerCase()
    if (low === 'q') this.quit = true
    else if (key === 'ENTER') {
      // paid sale -> next customer; otherwise just go back to the register
      if (this.paid) this.newSale()
      else this.view = 'register'
    } else if (key === 'ESC' || key === 'BACKSPACE' || low === 'r')
      this.view = 'register'
  }

  typeDigit(chars) {
    if (this.mode === 'change') return
    if (chars === '.' && this.entry.includes('.')) {
      this.message = 'one decimal point only'
      this.messageKind = 'warn'
      return
    }
    if (
      this.entry.replace(/\./g, '').length + chars.replace(/\./g, '').length >
      8
    )
      return
    this.entry += chars
    if (!this.entry.includes('.')) {
      const stripped = this.entry.replace(/^0+/, '')
      this.entry = stripped || (chars.startsWith('0') ? '0' : '')
    }
    this.message = ''
  }

  enter() {
    if (this.mode === 'change') {
      this.newSale()
      return
    }
    if (this.mode === 'tender') {
      const cash = this.entryValue()
      if (cash < this.total) {
        this.message = `not enough cash (need ${this.show(this.total)})`
        this.messageKind = 'warn'
        return
      }
      this.tendered = cash
      this.change = cash - this.total
      this.paid = true
      this.mode = 'change'
      this.entry = ''
      this.message = 'here is your change!'
      this.messageKind = 'ok'
      return
    }
    const price = this.entryValue()
    if (this.entry === '' || price <= 0) {
      this.message = 'type a price first'
      this.messageKind = 'warn'
      return
    }
    const factor = Math.pow(10, this.cfg.decimals)
    this.items.push(Math.round(price * factor) / factor)
    this.entry = ''
    this.message = ''
  }
}

// --------------------------------------------------------------------------
// rendering - pure function of (state, rows, cols)
// --------------------------------------------------------------------------

/** {label, text, tag, cursor} for the main display */
function bigDisplay(state) {
  if (state.mode === 'change') {
    return {
      label: 'CHANGE DUE',
      text: state.plain(state.change),
      tag: 'change',
      cursor: false,
    }
  }
  if (state.mode === 'tender') {
    if (state.entry)
      return {
        label: 'CASH RECEIVED',
        text: groupInt(state.entry),
        tag: 'total',
        cursor: true,
      }
    return {
      label: 'TOTAL DUE',
      text: state.plain(state.total),
      tag: 'total',
      cursor: false,
    }
  }
  if (state.entry)
    return {
      label: 'PRICE',
      text: groupInt(state.entry),
      tag: 'total',
      cursor: true,
    }
  return {
    label: 'TOTAL',
    text: state.plain(state.total),
    tag: 'total',
    cursor: false,
  }
}

function render(state, rows, cols) {
  const cfg = state.cfg
  const c = new Canvas(rows, cols, cfg.asciiArt)
  if (cols < 34 || rows < 12) {
    c.put(0, 0, 'terminal too small - please resize', 'warn')
    return c
  }

  if (state.view === 'receipt') return renderReceipt(c, state, rows, cols)

  let font = FONTS[cfg.font] ?? SEG_FONT
  if (cfg.asciiArt) {
    font = Object.fromEntries(
      Object.entries(font).map(([k, g]) => [
        k,
        g.map((row) => row.replace(/█/g, '#')),
      ]),
    )
  }
  const maxBigH = Math.max(fontHeight(font), rows - 13)

  const { label, text: shown, tag, cursor } = bigDisplay(state)
  const cur = cfg.currency

  const contentW = Math.max(20, Math.min(cols - 2, 112)) // keep a margin either side
  const xOff = Math.max(0, Math.floor((cols - contentW) / 2))
  const rightEdge = xOff + contentW - 1

  // digit size: the requested scale, shrunk if it would not fit
  const biggest = cfg.scale > 0 ? cfg.scale : 4
  let scale = 1
  for (let candidate = biggest; candidate > 0; candidate--) {
    const { w, h } = artSize(shown, candidate, font)
    if (h <= maxBigH && w + cur.length + 2 <= contentW - 4) {
      scale = candidate
      break
    }
  }

  const art = bigText(shown, scale, font)
  const artH = art.length
  const artW = Math.max(0, ...art.map((l) => l.length))
  const blockW = artW + cur.length + 1

  // ---- header --------------------------------------------------------
  c.put(0, xOff + 1, '  CASH REGISTER', 'label')
  const count = `${state.items.length} item${state.items.length === 1 ? '' : 's'}`
  const right =
    state.mode === 'change'
      ? `TENDERED ${state.show(state.tendered)}   ${count}   `
      : `TOTAL ${state.show(state.total)}   ${count}   `
  c.putRight(0, rightEdge, right, 'dim')

  // ---- big display ---------------------------------------------------
  const top = 1
  c.put(
    top,
    xOff + Math.max(0, Math.floor((contentW - label.length) / 2)),
    label,
    'label',
  )
  const artRow = top + 1
  const bx = xOff + Math.max(0, Math.floor((contentW - blockW) / 2))
  const artX = bx + cur.length + 1
  // the currency symbol stays normal sized, sitting at the digits' waist
  c.put(artRow + Math.max(0, Math.floor(artH / 2) - 1), bx, cur, 'label')
  art.forEach((line, i) => {
    c.put(artRow + i, artX + Math.floor((artW - line.length) / 2), line, tag)
  })
  if (cursor) c.put(artRow + artH - 1, artX + artW + 1, '_', 'hl')

  // ---- receipt -------------------------------------------------------
  const panelTop = top + 1 + artH + 1
  const avail = rows - panelTop - 2
  // the receipt box hugs its contents instead of stretching over the whole window;
  // while paid it keeps one spare row so the PAID stamp never lands on an item
  const wanted = state.items.length + 2 + (state.paid ? 1 : 0)
  let panelH = Math.max(3, Math.min(avail, wanted))
  panelH = Math.min(panelH, avail)
  let top2 = panelTop
  if (panelH < 3) {
    top2 = Math.max(1, rows - 6)
    panelH = 4
  }
  drawItems(c, top2, xOff, panelH, contentW, state)

  // ---- status line ---------------------------------------------------
  drawStatus(c, rows - 1, cols, state)
  return c
}

/**
 * The receipt view: the printed lines, untouched, inside a border that is only
 * screen chrome - nothing inside the box is added by the UI.
 */
function renderReceipt(c, state, rows, cols) {
  const lines = receiptLines(state, state.cfg)
  const paperW = dispWidth(lines[0])
  const blockW = paperW + 4 // border, one column of margin, paper, margin, border
  const blockH = lines.length + 2
  const boxed = cols >= blockW + 1 && rows >= blockH + 1
  const fullW = boxed ? blockW : paperW
  const fullH = boxed ? blockH : lines.length
  const x = Math.max(0, Math.floor((cols - fullW) / 2))
  const top = Math.max(0, Math.floor((rows - fullH) / 2))
  if (boxed) c.box(top, x, blockH, blockW, '', 'frame')
  const cx = boxed ? x + 2 : x
  const cy = boxed ? top + 1 : top
  lines.forEach((line, i) => {
    if (cy + i < rows - 1) c.put(cy + i, cx, line)
  })
  c.putRight(
    rows - 1,
    cols - 1,
    cols >= 64
      ? '  R = back   F = print   ENTER = new sale   Q = quit '
      : '  R back  F print  Q quit ',
    'dim',
  )
  return c
}

function drawItems(c, y, x, h, w, state) {
  c.box(y, x, h, w, `ITEMS (${state.items.length})`, 'frame')
  const innerH = h - 2
  const innerW = w - 4
  if (innerH <= 0) return

  const items = state.items
  // while paid, the bottom inner row belongs to the PAID stamp
  const listH = Math.max(0, innerH - (state.paid ? 1 : 0))
  // the "more above" hint is only worth a row if an item still fits under it
  const showHead = items.length > listH && listH >= 2
  const start = Math.max(0, items.length - (showHead ? listH - 1 : listH))
  const lines = []
  if (start)
    lines.push({ left: `… ${start} more above`, right: '', tag: 'dim' })
  for (let i = start; i < items.length; i++) {
    lines.push({
      left: `${String(i + 1).padStart(2)}. Item ${i + 1}`,
      right: state.show(items[i]),
      tag: null,
    })
  }

  lines.slice(0, listH).forEach((line, i) => {
    const ry = y + 1 + i
    const gapW = Math.max(0, innerW - line.right.length - 1)
    let text
    if (line.right && line.left.length < gapW) {
      text =
        line.left + ' ' + '·'.repeat(Math.max(0, gapW - line.left.length - 1)) // dotted leader
    } else {
      text = line.left.padEnd(gapW)
    }
    c.put(ry, x + 2, text.slice(0, gapW), line.tag)
    if (line.right) c.putRight(ry, x + w - 3, line.right, line.tag ?? 'label')
  })

  if (!items.length) c.put(y + 1, x + 2, 'no items yet - type a price', 'dim')
  if (state.paid) c.putRight(y + h - 2, x + w - 3, 'PAID', 'ok')
}

function drawStatus(c, y, cols, state) {
  const typed = groupInt(state.entry || '0')
  const zeroes = state.cfg.decimals <= 0 ? '   . = 00 ' : ''
  let text, longHint, shortHint
  if (state.mode === 'amount') {
    text = ` NEXT ITEM  > ${state.entry ? state.cfg.currency + typed : ''}_`
    longHint = `${zeroes}  ENTER = add item   P = pay   F = print   R = receipt   U = undo   Q = quit `
    shortHint = '  ENTER add  P pay  F print  R receipt  U undo  Q quit '
  } else if (state.mode === 'tender') {
    text = ` CASH  > ${state.entry ? state.cfg.currency + typed : ''}_`
    longHint = '  ENTER = confirm cash   ESC = cancel '
    shortHint = '  ENTER ok  ESC cancel '
  } else {
    text = ` CHANGE ${state.show(state.change)}`
    longHint =
      '  ENTER = new sale   F = print receipt   R = receipt   Q = quit '
    shortHint = '  ENTER new  F print  R receipt  Q quit '
  }
  let hint = cols >= text.length + longHint.length + 2 ? longHint : shortHint
  if (cols < text.length + hint.length + 2) hint = ''
  c.put(
    y,
    0,
    text.padEnd(Math.max(0, cols - hint.length - 1)),
    state.mode === 'change' ? 'ok' : null,
  )
  c.putRight(y, cols - 1, hint, 'dim')
  if (state.message)
    c.put(
      y - 1,
      2,
      state.message.slice(0, Math.max(0, cols - 4)),
      state.messageKind,
    )
}

// --------------------------------------------------------------------------
// key tokens (byte sequences from a terminal; browser host maps events itself)
// --------------------------------------------------------------------------

/** one keypress (or one terminal byte sequence) -> a register key */
function keyToken(data) {
  switch (data) {
    case '\r':
    case '\n':
      return 'ENTER'
    case '\x7f':
    case '\b':
      return 'BACKSPACE'
    case '\x1b':
      return 'ESC'
    case '\x03': // ctrl-c
    case '\x04': // ctrl-d
      return 'Q'
    case '\x10': // ctrl-p
      return 'PRINT'
    default:
      return data
  }
}

/**
 * One frame as ANSI lines. Only the bottom row gives up its last cell, so panels
 * that reach the right edge keep their border.
 */
function frameLines(canvas, cols) {
  return canvas.ansiLines(cols, Math.max(1, cols - 1))
}

// --------------------------------------------------------------------------
// defaults (pure — hosts may overlay env / URL / flags)
// --------------------------------------------------------------------------

function defaultConfig() {
  return {
    currency: '¥',
    decimals: 0,
    asciiArt: false,
    font: 'seg',
    scale: 1,
    store: 'MY SHOP',
    receiptWidth: 32,
    receiptTime: '',
    receiptSymbol: null, // null = use the currency symbol, "" = bare numbers
    receiptSymbolPosition: 'auto', // auto | before | after
    printer: '', // CUPS destination for F; "" = the system default
    printPaper: 'a4',
    printCmd: '', // overrides the whole print pipeline
    printTo: '', // F writes a PDF here instead of printing
  }
}

export {
  SEG_FONT,
  BIG_FONT,
  FONTS,
  Canvas,
  State,
  bigText,
  fontHeight,
  groupInt,
  money,
  formatAmount,
  receiptLines,
  receiptMoney,
  receiptSymbol,
  printLayout,
  printText,
  monoAdvance,
  PAPER_WIDTH_PT,
  PRINT_VERTICAL_MARGIN_PT,
  receiptTime,
  dispWidth,
  padTo,
  frameLines,
  render,
  bigDisplay,
  keyToken,
  defaultConfig,
}
