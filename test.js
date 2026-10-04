/*
 * Tests for regitui.  Run with:  node --test
 *
 * They drive the same State/render/receiptLines code the TUI uses, so a passing
 * run means the register logic and the printed receipt are intact - no terminal
 * needed.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import * as core from "./core.js";
import * as node from "./register.js";

// Tripwire: no test may ever reach real paper. Every default pipeline in this
// suite is diverted to a null sink, and the "paper is never the target" test
// below fails if this is removed.
process.env.REGITUI_PRINT_CMD = "cat > /dev/null";

/** Core logic + Node print/env helpers under one name (matches the old suite). */
const r = {
  ...core,
  defaultConfig: () => node.defaultConfig(),
  printReceipt: node.printReceipt,
  printCommandFor: node.printCommandFor,
  defaultPrintCommand: node.defaultPrintCommand,
  pdfCommand: node.pdfCommand,
  shellQuote: node.shellQuote,
  hasPaps: node.hasPaps,
  loadEnvFile: node.loadEnvFile,
};

const press = (state, keys) => {
  for (const key of keys) state.handle(key);
  return state;
};

const plain = (state, rows, cols) => r.render(state, rows, cols).plainLines();

test("typing a price and pressing enter adds an item", () => {
  const s = press(new r.State(r.defaultConfig()), ["1", "2", "3", "ENTER"]);
  assert.deepEqual(s.items, [123]);
  assert.equal(s.total, 123);
  assert.equal(s.entry, "");
});

test("the dot key is a 00 shortcut in yen mode", () => {
  const yen = press(new r.State(r.defaultConfig()), ["5", ".", "ENTER"]);
  assert.deepEqual(yen.items, [500]);
  const dollars = press(new r.State({ ...r.defaultConfig(), currency: "$", decimals: 2 }), ["1", ".", "5", "0", "ENTER"]);
  assert.deepEqual(dollars.items, [1.5]);
});

test("leading zeros and duplicate dots are handled", () => {
  assert.deepEqual(press(new r.State(r.defaultConfig()), ["0", "0", "7", "ENTER"]).items, [7]);
  const s = new r.State({ ...r.defaultConfig(), currency: "$", decimals: 2 });
  press(s, ["1", ".", "."]);
  assert.match(s.message, /decimal/);
  press(s, ["5", "ENTER"]);
  assert.deepEqual(s.items, [1.5]);
});

test("an empty price is refused", () => {
  const s = press(new r.State(r.defaultConfig()), ["ENTER"]);
  assert.deepEqual(s.items, []);
  assert.match(s.message, /type a price/);
});

test("undo removes the last item", () => {
  const s = press(new r.State(r.defaultConfig()), ["1", "0", "ENTER", "2", "0", "ENTER", "u"]);
  assert.deepEqual(s.items, [10]);
});

test("paying with cash shows the change, and too little cash is refused", () => {
  // 123 on the register, customer hands over 1,000 (type 10 then the 00 key)
  const s = press(new r.State(r.defaultConfig()), ["1", "2", "3", "ENTER", "p", "1", "0", ".", "ENTER"]);
  assert.equal(s.mode, "change");
  assert.equal(s.tendered, 1000);
  assert.equal(s.change, 877);
  assert.equal(s.paid, true);

  const short = press(new r.State(r.defaultConfig()), ["1", "2", "3", "ENTER", "p", "5", "ENTER"]);
  assert.equal(short.mode, "tender");
  assert.equal(short.paid, false);
  assert.match(short.message, /not enough cash/);
});

test("esc clears the entry, enter after paying starts a new numbered sale", () => {
  const s = press(new r.State(r.defaultConfig()), ["1", "2", "ENTER", "ESC"]);
  assert.equal(s.entry, "");
  press(s, ["p", "1", ".", "ENTER"]);
  assert.equal(s.saleNo, 1);
  press(s, ["ENTER"]);
  assert.deepEqual(s.items, []);
  assert.equal(s.saleNo, 2);
  assert.equal(s.paid, false);
});

test("the receipt key only opens the view when something was rung up", () => {
  const s = press(new r.State(r.defaultConfig()), ["r"]);
  assert.equal(s.view, "register");
  assert.match(s.message, /nothing on the receipt yet/);
  press(s, ["5", "ENTER", "r"]);
  assert.equal(s.view, "receipt");
  press(s, ["r"]);
  assert.equal(s.view, "register");
});

test("q quits from either view", () => {
  assert.equal(press(new r.State(r.defaultConfig()), ["q"]).quit, true);
  const s = press(new r.State(r.defaultConfig()), ["5", "ENTER", "r", "q"]);
  assert.equal(s.quit, true);
});

test("the receipt is plain text and every line is the same display width", () => {
  for (const width of [20, 32, 48, 64]) {
    for (const script of [["1", "2", "3", "ENTER"], ["1", ".", "ENTER", "p", "1", ".", "ENTER"]]) {
      const cfg = { ...r.defaultConfig(), receiptWidth: width, receiptTime: "2026-10-04 16:30" };
      const state = press(new r.State(cfg), script);
      const lines = r.receiptLines(state, cfg);
      const widths = new Set(lines.map((l) => r.dispWidth(l)));
      assert.deepEqual([...widths], [width], `width ${width} lines must all be ${width} cols`);
      for (const line of lines) assert.equal(typeof line, "string", "receipt lines must be strings");
      const ctrl = [...lines.join("")].filter((c) => {
        const n = c.charCodeAt(0);
        return n < 32 || (n >= 0x7f && n < 0xa0);
      });
      assert.deepEqual(ctrl, [], `no control characters on the paper (width ${width})`);
    }
  }
});

test("the printable receipt is just text: no borders, rules or box characters", () => {
  const cfg = { ...r.defaultConfig(), receiptTime: "t" };
  const state = press(new r.State(cfg), ["1", "2", "3", "ENTER", "p", "1", "3", ".", "ENTER"]);
  const text = r.receiptLines(state, cfg).join("\n");
  assert.doesNotMatch(text, /[|+\-_=*]/, "a printed receipt should not contain border or rule characters");
  // sections are separated by blank lines instead
  const lines = r.receiptLines(state, cfg);
  assert.ok(lines.some((l) => l.trim() === ""), "blank lines separate the sections");
  assert.equal(lines[lines.length - 1].trim(), "Please come again");
});

test("amounts carry the symbol by default, and 円 goes after the number", () => {
  const yen = { ...r.defaultConfig(), receiptTime: "t" };
  assert.equal(r.receiptMoney(yen, 1250), "¥1,250");

  const en = { ...r.defaultConfig(), receiptSymbol: "円", receiptTime: "t" };
  assert.equal(r.receiptMoney(en, 1250), "1,250円");

  const bare = { ...r.defaultConfig(), receiptSymbol: "", receiptTime: "t" };
  assert.equal(r.receiptMoney(bare, 1250), "1,250");

  const dollars = { ...r.defaultConfig(), currency: "$", decimals: 2, receiptTime: "t" };
  assert.equal(r.receiptMoney(dollars, 1.5), "$1.50");
  const forced = { ...dollars, receiptSymbolPosition: "after" };
  assert.equal(r.receiptMoney(forced, 1.5), "1.50$");
});

test("the receipt keeps its columns whatever the symbol", () => {
  const cases = [{}, { receiptSymbol: "円" }, { receiptSymbol: "" }, { currency: "$", decimals: 2 }];
  for (const over of cases) {
    const cfg = { ...r.defaultConfig(), ...over, receiptTime: "2026-10-04 16:30" };
    const state = press(new r.State(cfg), ["1", "2", "3", ".", "ENTER", "p", "2", "0", ".", "ENTER"]);
    const lines = r.receiptLines(state, cfg);
    const widths = new Set(lines.map((l) => r.dispWidth(l)));
    assert.deepEqual([...widths], [cfg.receiptWidth], `uniform width with symbol ${JSON.stringify(r.receiptSymbol(cfg))}`);
  }
});

test("wide characters are measured in columns, not code units", () => {
  assert.equal(r.dispWidth("¥1,250"), 6);
  assert.equal(r.dispWidth("1,250円"), 7);
  assert.equal(r.padTo("円", 4), "円  ");
  assert.equal(r.padTo("円", 4, "right"), "  円");
});

test("the receipt prints cash and change only once paid", () => {
  const cfg = { ...r.defaultConfig(), receiptTime: "t" };
  const draft = press(new r.State(cfg), ["1", "0", "0", "ENTER"]);
  const draftText = r.receiptLines(draft, cfg).join("\n");
  assert.match(draftText, /TOTAL/);
  assert.doesNotMatch(draftText, /CASH|CHANGE/);

  const paid = press(draft, ["p", "1", "0", ".", "ENTER"]); // hand over 1,000 for a 100 item
  const paidText = r.receiptLines(paid, cfg).join("\n");
  assert.match(paidText, /CASH\s+\S*1,000/);
  assert.match(paidText, /CHANGE\s+\S*900/);
});

test("panels keep both borders at every width, and the frame does not clip them", () => {
  // regression: at widths where the receipt box reaches the right edge, the border
  // used to fall in the one column the frame writer left alone, so it vanished
  for (let cols = 34; cols <= 170; cols++) {
    const state = press(new r.State(r.defaultConfig()), ["9", "9", "9", "9", "9", "9", "9", "9", "ENTER"]);
    const rows = 24;
    const canvas = r.render(state, rows, cols);
    const boxed = plain(state, rows, cols).filter((l) => l.includes("ITEMS"));
    assert.equal(boxed.length, 1, `one items box at ${cols} cols`);
    assert.ok(boxed[0].includes("┐"), `top border closed at ${cols} cols: ${JSON.stringify(boxed[0])}`);
    const itemRow = plain(state, rows, cols).find((l) => l.includes("Item 1"));
    assert.ok(itemRow.trimEnd().endsWith("│"), `item row closed at ${cols} cols: ${JSON.stringify(itemRow)}`);

    // and it must survive the ANSI frame the terminal actually receives
    const frame = r.frameLines(canvas, cols).map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));
    const frameBox = frame.find((l) => l.includes("ITEMS"));
    assert.ok(frameBox.includes("┐"), `frame keeps the top border at ${cols} cols`);
    for (const line of frame) assert.ok(r.dispWidth(line) <= cols, `frame line fits ${cols} cols`);
  }
});

test("frames render at every plausible size without throwing", () => {
  for (let rows = 8; rows <= 50; rows += 2) {
    for (const cols of [30, 34, 60, 80, 112, 165]) {
      const state = press(new r.State(r.defaultConfig()), ["1", "2", "3", "ENTER", "4", "ENTER"]);
      const lines = plain(state, rows, cols);
      assert.equal(lines.length, rows);
      for (const line of lines) assert.ok(line.length <= cols, `line wider than ${cols}`);
    }
  }
});

test("the PAID stamp always gets its own row", () => {
  for (let rows = 12; rows <= 46; rows++) {
    for (const cols of [34, 60, 80, 165]) {
      const state = press(new r.State(r.defaultConfig()), ["1", "0", "ENTER", "2", "0", "ENTER", "3", "0", "ENTER"]);
      press(state, ["p", "1", ".", "ENTER"]);
      const paidRow = plain(state, rows, cols).find((l) => l.includes("PAID"));
      if (paidRow) {
        assert.ok(!paidRow.includes("Item"), `row ${rows}x${cols} has PAID on an item line: ${paidRow}`);
        assert.ok(!paidRow.includes("¥"), `row ${rows}x${cols} has PAID on a price line: ${paidRow}`);
      }
    }
  }
});

test("the receipt view shows the printed lines verbatim, inside a chrome border", () => {
  const cfg = { ...r.defaultConfig(), receiptTime: "2026-10-04 16:30" };
  const state = press(new r.State(cfg), ["1", "2", "3", "ENTER", "r"]);
  const printed = r.receiptLines(state, cfg);
  const screen = plain(state, 30, 90);
  for (const line of printed) {
    assert.ok(
      screen.some((row) => row.includes(line)),
      `the view must contain the printed line verbatim: ${JSON.stringify(line)}`
    );
  }
  const border = screen.find((row) => row.includes("┌") && row.includes("┐"));
  assert.ok(border, "the view draws a border around the paper");
  assert.ok(screen.some((row) => row.includes("└") && row.includes("┘")), "...top and bottom");
});

test("key tokens map like the terminal sends them", () => {
  assert.equal(r.keyToken("\r"), "ENTER");
  assert.equal(r.keyToken("\x7f"), "BACKSPACE");
  assert.equal(r.keyToken("\x1b"), "ESC");
  assert.equal(r.keyToken("7"), "7");
  assert.equal(r.keyToken("\x03"), "Q"); // ctrl-c still quits
  assert.equal(r.keyToken(" "), " ");
});

test("F and CTRL-P ask for a print, and refuse when there is nothing to print", () => {
  const empty = new r.State(r.defaultConfig());
  empty.handle("f");
  assert.equal(empty.printRequested, false);
  assert.match(empty.message, /nothing to print/);

  for (const key of ["f", "F", "PRINT"]) {
    const s = press(new r.State(r.defaultConfig()), ["5", "ENTER", key]);
    assert.equal(s.printRequested, true, `${JSON.stringify(key)} requests a print`);
  }
  assert.equal(r.keyToken("\x10"), "PRINT"); // ctrl-p
  // and from inside the receipt view too
  const s = press(new r.State(r.defaultConfig()), ["5", "ENTER", "r", "f"]);
  assert.equal(s.printRequested, true);
  assert.equal(s.view, "receipt");
});

test("the printed page is exactly the receipt, centred by the margins", () => {
  const cfg = { ...r.defaultConfig(), receiptTime: "2026-10-04 16:30" };
  const state = press(new r.State(cfg), ["1", "2", "3", "ENTER", "p", "1", "3", ".", "ENTER"]);

  // nothing is added, padded or reflowed: the printer gets the receipt itself
  assert.equal(r.printText(state, cfg), r.receiptLines(state, cfg).join("\n") + "\n");

  const layout = r.printLayout(cfg);
  assert.ok(layout.size >= 5 && layout.size <= 12, `sane font size, got ${layout.size}`);
  assert.equal(layout.advance, r.monoAdvance(layout.size));
  const block = cfg.receiptWidth * layout.advance;
  const page = 595.28; // A4 portrait
  assert.ok(layout.margin * 2 + block <= page, "the receipt fits between the margins, so it cannot wrap");
  assert.ok(page - layout.margin * 2 - block < layout.advance, "margins are as tight as a whole point allows");
  assert.ok(Math.abs(page / 2 - (layout.margin + block / 2)) < layout.advance / 2, "the block sits on the page centre");
});

test("a wide receipt shrinks the font rather than wrapping", () => {
  for (const receiptWidth of [20, 32, 48, 64, 80, 100, 140]) {
    const layout = r.printLayout({ ...r.defaultConfig(), receiptWidth });
    const block = receiptWidth * layout.advance;
    assert.ok(layout.margin * 2 + block <= 595.28, `${receiptWidth} columns fit at ${layout.size}pt`);
    assert.ok(layout.size >= 5, `font never goes below 5pt, got ${layout.size}`);
  }
});

test("a very long receipt keeps every line (the filter decides the page breaks)", () => {
  const cfg = { ...r.defaultConfig(), receiptTime: "t" };
  const state = new r.State(cfg);
  for (let i = 0; i < 300; i++) press(state, ["1", "0", "0", "ENTER"]);
  const lines = r.printText(state, cfg).replace(/\n$/, "").split("\n");
  assert.equal(lines.length, r.receiptLines(state, cfg).length);
  assert.ok(lines.length > 300, `300 items means plenty of lines, got ${lines.length}`);
  const { margin, advance } = r.printLayout(cfg);
  const printableCols = Math.floor((595.28 - 2 * margin) / advance);
  assert.ok(printableCols >= cfg.receiptWidth, `${printableCols} printable columns for a ${cfg.receiptWidth} wide receipt`);
  assert.match(lines.join("\n"), /Item 300/);
});

test("paps is used when present, and a custom pipeline can replace it", () => {
  const cfg = r.defaultConfig();
  const cmd = r.defaultPrintCommand(cfg);
  assert.match(cmd, /lp/);
  assert.match(cmd, /sides=one-sided/);
  if (r.hasPaps()) {
    assert.match(cmd, /paps --paper=a4 --font="DejaVu Sans Mono 12"/, "paps feeds lp when installed");
    assert.match(cmd, /\| lp /, "paps output is piped into lp");
    // paps has no --portrait flag: portrait is simply its default
    assert.doesNotMatch(cmd, /--portrait/, "do not pass a flag paps rejects");
  }
  const custom = r.defaultPrintCommand({ ...cfg, printer: "OfficePrinter", printPaper: "letter" });
  assert.match(custom, /lp -d OfficePrinter -o media=LETTER/);
});

test("printing actually runs the pipeline and reports back", async () => {
  const out = "/tmp/regitui-print-test.txt";
  fs.rmSync(out, { force: true });
  const cfg = { ...r.defaultConfig(), receiptTime: "2026-10-04 16:30", printCmd: `cat > ${out}` };
  const state = press(new r.State(cfg), ["1", "2", "3", "ENTER", "p", "1", "3", ".", "ENTER"]);
  const result = await new Promise((resolve) => r.printReceipt(state, cfg, resolve));
  assert.equal(result.ok, true, `pipeline should succeed: ${result.message}`);
  const text = fs.readFileSync(out, "utf8");
  assert.match(text, /MY SHOP/);
  assert.match(text, /TOTAL\s+¥123/);
  assert.match(text, /CHANGE\s+¥1,177/);
  assert.match(text, /Please come again/);
  assert.equal(text, r.printText(state, cfg), "the pipeline received exactly the receipt, unindented");
  assert.equal(text, r.receiptLines(state, cfg).join("\n") + "\n");
});

test("a failing pipeline is reported, not thrown", async () => {
  const cfg = { ...r.defaultConfig(), printCmd: "exit 3" };
  const state = press(new r.State(cfg), ["5", "ENTER"]);
  const result = await new Promise((resolve) => r.printReceipt(state, cfg, resolve));
  assert.equal(result.ok, false);
  assert.match(result.message, /print failed/);
});

/** pull the glyphs a PDF actually draws out of its inflated content streams */
function pdfGlyphs(buf) {
  let stream = "";
  for (const m of buf.toString("latin1").matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    try {
      const chunk = zlib.inflateSync(Buffer.from(m[1], "latin1")).toString("latin1");
      if (/\bTJ\b|\bTj\b/.test(chunk)) stream += chunk; // content stream, not the font binary
    } catch {
      /* not a deflated stream */
    }
  }
  const unescape = (text) =>
    text
      .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8))) // ¥ is \245
      .replace(/\\([()\\nrt])/g, (_, ch) => ({ n: "\n", r: "\r", t: "\t" })[ch] ?? ch);
  return [...stream.matchAll(/\(((?:\\.|[^()\\])*)\)/g)].map((m) => unescape(m[1])).join("");
}

test("the test suite can never reach a real printer", () => {
  // This is the safety net, not a nicety: an earlier run of this suite sent a
  // sheet to a real printer because a test used the default pipeline by
  // accident. If this fails, printing safety has regressed.
  assert.equal(process.env.REGITUI_PRINT_CMD, "cat > /dev/null");
  assert.equal(r.printCommandFor(r.defaultConfig()), process.env.REGITUI_PRINT_CMD);
  assert.doesNotMatch(r.printCommandFor(r.defaultConfig()), /\blp\b/, "no lp in the test pipeline");

  // --print-cmd/-to still win when a test asks for them explicitly
  assert.equal(r.printCommandFor({ ...r.defaultConfig(), printCmd: "true" }), "true");
  assert.match(r.printCommandFor({ ...r.defaultConfig(), printTo: "/tmp/x.pdf" }), /^cat > /);
});

test("--print-to writes a PDF with no printer in the pipeline", async () => {
  const out = "/tmp/regitui-print-to.pdf";
  fs.rmSync(out, { force: true });
  const cfg = { ...r.defaultConfig(), receiptTime: "2026-10-04 16:30", printTo: out, printCmd: "" };
  delete process.env.REGITUI_PRINT_CMD; // exercise the real pdf pipeline once
  try {
    const command = r.pdfCommand(cfg);
    assert.doesNotMatch(command, /\blp\b/, "a PDF run never touches a printer");
    assert.match(command, /--format=pdf/);
    if (!r.hasPaps()) return; // without paps we can only check the command shape

    const state = press(new r.State(cfg), ["1", "2", "3", "ENTER", "p", "1", "3", ".", "ENTER"]);
    const result = await new Promise((resolve) => r.printReceipt(state, cfg, resolve));
    assert.equal(result.ok, true, `pdf pipeline: ${result.message}`);
    assert.match(result.message, /saved \/tmp\/regitui-print-to\.pdf/);

    const pdf = fs.readFileSync(out);
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-", "a real PDF, not text");
    assert.ok(pdf.length > 2000, `PDF has content, got ${pdf.length} bytes`);
    const drawn = pdfGlyphs(pdf);
    // this sale is one ¥123 item paid with ¥1,300, so the change is ¥1,177
    for (const expected of ["MY SHOP", "TOTAL", "¥123", "¥1,300", "¥1,177", "Please come again"]) {
      assert.ok(drawn.includes(expected), `PDF draws ${JSON.stringify(expected)}`);
    }
  } finally {
    process.env.REGITUI_PRINT_CMD = "cat > /dev/null"; // tripwire back on
  }
});

test("shellQuote survives awkward paths", () => {
  assert.equal(r.shellQuote("/tmp/a b.pdf"), "'/tmp/a b.pdf'");
  assert.equal(r.shellQuote("/tmp/it's.pdf"), `'/tmp/it'\\''s.pdf'`);
});

test("loadEnvFile fills unset keys from a dotenv-style file", () => {
  const file = "/tmp/regitui-env-test.env";
  fs.writeFileSync(
    file,
    [
      "# comment",
      "REGITUI_ENV_TEST_A=alpha",
      "REGITUI_ENV_TEST_B='beta value'",
      'REGITUI_ENV_TEST_C="gamma"',
      "not a line",
      "",
    ].join("\n"),
  );
  delete process.env.REGITUI_ENV_TEST_A;
  delete process.env.REGITUI_ENV_TEST_B;
  process.env.REGITUI_ENV_TEST_C = "keep-me"; // already set wins
  r.loadEnvFile(file);
  assert.equal(process.env.REGITUI_ENV_TEST_A, "alpha");
  assert.equal(process.env.REGITUI_ENV_TEST_B, "beta value");
  assert.equal(process.env.REGITUI_ENV_TEST_C, "keep-me");
  delete process.env.REGITUI_ENV_TEST_A;
  delete process.env.REGITUI_ENV_TEST_B;
  delete process.env.REGITUI_ENV_TEST_C;
  fs.rmSync(file, { force: true });
});
