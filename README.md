# regitui

A tiny pretend-play cash register — same logic in the terminal and the browser.
**Zero runtime dependencies** (no install needed to play). Made for playing
shop with kids: readable numbers, type any price, watch the total grow, work out
the change, then look at (or print) the receipt.

```bash
node register.js            # Japanese yen (default): ¥1,250, whole yen
node register.js --dollars  # $1.50 style, with cents
```

Run it from this directory; `node register.js --help` lists every flag.

Layout: [`core.js`](core.js) is the shared brain; [`register.js`](register.js) is the
Node host (TTY + CUPS); [`browser.js`](browser.js) + [`index.html`](index.html) are
the browser host.

## Browser

```bash
pnpm preview                # build → dist/, then serve it (via pnpm dlx serve)
```

Open the served page and use the same keys as the terminal. `F` / `CTRL-P` opens
the browser print dialog with the plain receipt (no CUPS). Query flags work too,
e.g. `?dollars` or `?store=KIDS%20MART`.

## Keys

| key | what it does |
| --- | --- |
| `0`-`9` | type a price |
| `.` | shortcut for `00` in yen mode (type `5` `.` → ¥500) |
| `ENTER` | add the item (or confirm cash, or start a new sale) |
| `BACKSPACE` | fix a typo |
| `ESC` | clear what you typed / cancel the cash entry |
| `P` | pay with cash — type what the customer hands over, `ENTER` shows the change |
| `R` | show the printed receipt (`R` again to go back, `ENTER` for the next customer) |
| `F` | print the receipt (also `CTRL-P`) |
| `U` | undo the last item |
| `N` | new sale |
| `Q` | quit (also `CTRL-C`) |

The big number is the running total. While you type it switches to the price you
are entering; after `P` it becomes the change due.

## The receipt

`R` shows the sale as it would come off a till roll. The border is only screen
chrome — **everything inside it is exactly the bytes a printer would get**: plain
ASCII, fixed width, sections separated by blank lines, no rules or box characters.

```
            MY SHOP
        2026-10-04 16:30

            No. 0001

Item                       Price
Item 1                       123
Item 2                         2
Item 3                        12

Items                          3
TOTAL                        137
CASH                       1,300
CHANGE                     1,163

           Thank you!
       Please come again
```

`CASH` and `CHANGE` only appear once the sale is paid. The sale number advances
each time a paid sale is closed with `ENTER`.

Because it has to be printable, the receipt is **ASCII only** — a non-ASCII
currency symbol (¥) is simply left off, the way real Japanese receipts print bare
numbers; an ASCII symbol (`$`) is kept.

## Printing it

Press `F` (or `CTRL-P`) and the receipt on screen goes to the printer: the same
lines, centred horizontally, portrait, on as many pages as it needs. The status
line reports the result, including the CUPS job id (`printing - job OfficePrinter-43`).

The text handed over is exactly the receipt — nothing added, padded or reflowed —
and it is centred by giving both page margins the same width. Font size is chosen
from the paper width so a receipt can never wrap, and the paper's own pagination
handles length: an 80-item sale becomes a 2-page receipt by itself.

Under the hood it pipes `paps` (Pango, so `¥`/`円` and the box glyphs really render)
into `lp`; without paps it falls back to sending plain text straight to `lp`, which
CUPS then renders left-aligned in its own font.

One subtlety worth knowing if you ever change the layout: paps/cairo hint glyph
advances to whole points, so 12 pt DejaVu Sans Mono advances 7 pt per column, not
the nominal 7.22 pt (`monoAdvance`). Measuring with the nominal figure is what made
an earlier version sit 6 mm left of centre.

Machine-specific defaults stay out of git: copy `.env.example` to `.env` and set
your CUPS printer (and optionally store name / paper). Flags still override.

```bash
cp .env.example .env   # then edit REGITUI_PRINTER=...
node register.js --printer OfficePrinter      # or pass a CUPS destination once
node register.js --print-paper letter         # a4 (default), letter, a3, legal
node register.js --print-to /tmp/receipt.pdf  # F saves a PDF instead of printing
node register.js --print-cmd 'lp -H hold'     # replace the pipeline (handy for tests)
```

`REGITUI_PRINT_CMD` does the same as `--print-cmd` but from the environment — the
test suite sets it to `cat > /dev/null` so a test run can never reach real paper
(there is a test that fails if that guard is removed). The same pattern covers
`REGITUI_PRINTER`, `REGITUI_STORE`, and `REGITUI_PRINT_PAPER`.

`--receipt-only` prints the same lines to stdout with no border, for scripting:

```bash
node register.js --receipt-only --demo '1,2,3,ENTER,p,13.,ENTER' | lpr
```

```bash
node register.js --receipt-only --demo '1,2,3,ENTER,p,13.,ENTER' | lpr
node register.js --receipt-only --store "KIDS MART" --receipt-width 48 \
  --receipt-time '2026-10-04 16:30' --demo '1,2,3,ENTER,p,13.,ENTER'
```

On screen the paper is boxed and centred; if the window is too small for the box
the border is dropped and the bare receipt is shown.

## Options

| flag | default | meaning |
| --- | --- | --- |
| `--currency SYM` | `¥` | currency symbol |
| `--decimals N` | `0` | decimal places (`2` with `--dollars`) |
| `--dollars` | | shorthand for `--currency $ --decimals 2` |
| `--font seg\|big` | `seg` | seven-segment digits, or the thinner figlet-style set |
| `--scale N` | `1` | digit size: native size, or `0` to auto-fit the window |
| `--ascii` | | ASCII-only terminal: `+-+` boxes and `#` digits |
| `--store NAME` | `MY SHOP` / `REGITUI_STORE` | name printed at the top of the receipt |
| `--receipt-width N` | `32` | receipt columns: 32 ≈ 58 mm paper, 48 ≈ 80 mm |
| `--receipt-time STR` | now | fixed receipt timestamp (handy for tests) |
| `--receipt-only` | | print the receipt instead of running the TUI |
| `--printer NAME` | system default / `REGITUI_PRINTER` | CUPS destination used by the in-app `F` key |
| `--print-paper P` | `a4` / `REGITUI_PRINT_PAPER` | paper for `F`: `a4`, `letter`, `a3`, `legal` |
| `--print-cmd CMD` | `paps ... \| lp ...` / `REGITUI_PRINT_CMD` | replace the whole print pipeline |
| `--size RxC` | `30x100` | frame size used by `--demo` |
| `--demo [KEYS]` | | non-interactive: run scripted keys and print frames |

## The big digits

There is no font library involved. `SEG_FONT` is a hand-written bitmap: each
character is an array of strings, one per row, where any non-space cell is "ink".
`bigText()` stitches glyphs together and enlarges them by repeating every character
`scale` times across and every row `scale` times down.

Glyph widths are proportional, so a `1` is narrower than a `0`. The default font is
seven-segment (solid, uniform strokes, unambiguous `1`/`5`/`7`) at its native size;
`--scale 2` (or `0` to auto-fit) blows the digits up. The currency symbol is drawn
at normal text size beside the digits, not as art.

The receipt box hugs its contents rather than stretching into an empty box, and
while a sale is paid the `PAID` stamp always gets its own row.

## How the terminal part works

No curses binding exists for Node, and none is needed: `register.js` puts stdin in
raw mode, reads keys from `data` events and paints with plain ANSI — one
`process.stdout.write` per frame, using the alternate screen (`?1049`), a hidden
cursor, SGR colours and cursor positioning. It repaints on input and on `resize`,
and restores the terminal (raw mode off, cursor shown, alternate screen popped) on
quit, `CTRL-C`, `CTRL-D` or `SIGTERM`.

Rendering is a pure function (`render(state, rows, cols) -> Canvas`), which is what
makes both the receipt view and the tests possible. Two details that bite in raw
ANSI but not with curses: lines are clipped by *visible* columns (ANSI codes and
double-width characters do not count), and only the bottom row's last cell is left
unwritten, because writing the bottom-right cell scrolls the terminal. Panels keep a
one-column margin so borders never land in that cell anyway.

## Testing

```bash
pnpm test                   # or: node --test
pnpm build                  # smoke-check the dist/ copy
```

`test.js` drives the same `State`/`render`/`receiptLines` code the TUI uses: the
price/undo/pay/change flows, receipt plain-text-ness and uniform column width at
20/32/48/64 columns with `¥`, `円`, bare and `$` amounts, wide-character column
maths, the `PAID` stamp never landing on an item row (swept across sizes), frames
rendering at every plausible window size, both borders surviving at every width
34→170, and key-token mapping. The print path is covered too: `F`/`CTRL-P` requests,
the centring and no-wrap maths, a 300-item receipt keeping every line, and real
end-to-end runs of the pipeline — into a file, and into a PDF whose drawn glyphs
(including `¥`) are read back out of its compressed content streams.

You can also eyeball any state as plain text, no terminal required:

```bash
node register.js --size 30x100 --demo '2,5,0,ENTER,1,.,ENTER,p,20.,ENTER'
node register.js --size 30x60 --demo '1,2,3,ENTER,r,SHOW'      # the receipt view
```

`--demo` runs the same code the TUI uses, printing a frame after each `ENTER` (add
`SHOW` to print one without pressing `ENTER`), then the final state.
