#!/usr/bin/env node
/*
 * regitui — Node host: terminal I/O, .env defaults, CUPS/paps printing.
 *
 *   node register.js              # Japanese yen, whole yen
 *   node register.js --dollars    # $1.50 style, with cents
 *   node register.js --help
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  State,
  defaultConfig as baseConfig,
  printLayout,
  printText,
  PRINT_VERTICAL_MARGIN_PT,
  receiptLines,
  render,
  frameLines,
  keyToken,
} from "./core.js";

/**
 * Load KEY=value pairs from a local `.env` into `process.env` when the key is
 * not already set. Kept tiny on purpose: no dependency, no expansion, quotes
 * optional. Personal machine details (printer name, store name) belong here —
 * not in tracked source.
 */
export function loadEnvFile(filePath = path.join(process.cwd(), ".env")) {
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

/** Core defaults plus REGITUI_* env overlays (after loadEnvFile). */
export function defaultConfig() {
  const cfg = baseConfig();
  if (process.env.REGITUI_STORE) cfg.store = process.env.REGITUI_STORE;
  if (process.env.REGITUI_PRINTER) cfg.printer = process.env.REGITUI_PRINTER;
  if (process.env.REGITUI_PRINT_PAPER) cfg.printPaper = process.env.REGITUI_PRINT_PAPER;
  return cfg;
}

// --------------------------------------------------------------------------
// printing: paps | lp (or REGITUI_PRINT_CMD / --print-cmd / --print-to)
// --------------------------------------------------------------------------

let papsCache = null;

/** is paps (Pango text -> PostScript) available? it renders ¥/円 and box glyphs */
export function hasPaps() {
  if (papsCache === null) {
    try {
      papsCache = spawnSync("/bin/sh", ["-c", "command -v paps"], { stdio: "ignore" }).status === 0;
    } catch {
      papsCache = false;
    }
  }
  return papsCache;
}

/** shell-quote a path for the pipeline we hand to /bin/sh */
export function shellQuote(text) {
  return `'${String(text).replace(/'/g, "'\\''")}'`;
}

/** print to a PDF file instead of paper: paps writes PDF straight to stdout */
export function pdfCommand(cfg) {
  const paper = (cfg.printPaper || "a4").toLowerCase();
  const target = ` > ${shellQuote(cfg.printTo)}`;
  if (!hasPaps()) return `cat${target}`; // no paps: raw text in a file
  const { size, margin } = printLayout(cfg);
  return (
    `paps --paper=${paper} --format=pdf --font="DejaVu Sans Mono ${size}" ` +
    `--left-margin=${margin} --right-margin=${margin} ` +
    `--top-margin=${PRINT_VERTICAL_MARGIN_PT} --bottom-margin=${PRINT_VERTICAL_MARGIN_PT}${target}`
  );
}

/** default pipeline: paps (for the fonts) piped into lp (for CUPS) */
export function defaultPrintCommand(cfg) {
  const paper = (cfg.printPaper || "a4").toLowerCase();
  const lp = `lp${cfg.printer ? ` -d ${cfg.printer}` : ""} -o media=${paper.toUpperCase()} -o sides=one-sided`;
  if (!hasPaps()) return lp;
  const { size, margin } = printLayout(cfg);
  return (
    `paps --paper=${paper} --font="DejaVu Sans Mono ${size}" ` +
    `--left-margin=${margin} --right-margin=${margin} ` +
    `--top-margin=${PRINT_VERTICAL_MARGIN_PT} --bottom-margin=${PRINT_VERTICAL_MARGIN_PT} | ${lp}`
  );
}

/**
 * What F actually runs: an explicit --print-cmd, then the REGITUI_PRINT_CMD escape
 * hatch (set it to keep a test run away from real paper), then --print-to FILE
 * (a PDF instead of paper), then the real paps | lp pipeline.
 */
export function printCommandFor(cfg) {
  if (cfg.printCmd) return cfg.printCmd;
  if (process.env.REGITUI_PRINT_CMD) return process.env.REGITUI_PRINT_CMD;
  if (cfg.printTo) return pdfCommand(cfg);
  return defaultPrintCommand(cfg);
}

/**
 * Send the receipt to the printer (or to a PDF file). Async: `done({ok, message})`
 * runs when the pipeline finishes, so the TUI stays interactive and can report the
 * CUPS job id.
 */
export function printReceipt(state, cfg, done) {
  if (!state.items.length) {
    done({ ok: false, message: "nothing to print yet" });
    return;
  }
  const command = printCommandFor(cfg);
  let child;
  try {
    child = spawn("/bin/sh", ["-c", command], { stdio: ["pipe", "pipe", "pipe"] });
  } catch (e) {
    done({ ok: false, message: `print failed: ${e.message}` });
    return;
  }
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => {
    out += d;
  });
  child.stderr.on("data", (d) => {
    err += d;
  });
  child.on("error", (e) => done({ ok: false, message: `print failed: ${e.message}` }));
  child.on("close", (code) => {
    if (code === 0) {
      if (cfg.printTo) {
        done({ ok: true, message: `saved ${cfg.printTo}` });
        return;
      }
      const job = /request id is (\S+)/.exec(out);
      done({ ok: true, message: job ? `printing - job ${job[1]}` : "sent to printer" });
    } else {
      done({ ok: false, message: `print failed: ${(err.trim() || `exit ${code}`).slice(0, 70)}` });
    }
  });
  child.stdin.on("error", () => {}); // the reader may exit before we finish writing
  child.stdin.end(printText(state, cfg));
}

// --------------------------------------------------------------------------
// terminal front-end: raw mode stdin in, ANSI frames out
// --------------------------------------------------------------------------

/** one keypress (or one escape sequence) chunk matcher */
const KEY_SEQ = /\x1b\[[0-9;]*[A-Za-z~]|\x1bO[A-Za-z]|\x1b|[\s\S]/g;

function runTui(cfg) {
  const out = process.stdout;
  const state = new State(cfg);
  let done = false;

  const cleanup = () => {
    if (done) return;
    done = true;
    try {
      process.stdin.setRawMode(false);
    } catch {}
    process.stdin.pause();
    out.write("\x1b[?1049l\x1b[?25h"); // leave alt screen, show cursor
  };

  const frame = () => {
    const cols = out.columns || 80;
    const rows = out.rows || 24;
    const canvas = render(state, rows, cols);
    let buf = "\x1b[?25l"; // hide cursor while painting
    const lines = frameLines(canvas, cols);
    for (let y = 0; y < lines.length; y++) buf += `\x1b[${y + 1};1H${lines[y]}\x1b[K`;
    out.write(buf);
  };

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    // arrow keys and friends arrive as ESC [ ... - ignore those, keep ESC itself
    for (const seq of chunk.match(KEY_SEQ) ?? []) {
      const token = seq.length > 1 && seq[0] === "\x1b" ? "IGNORE" : keyToken(seq);
      state.handle(token);
      if (state.quit) {
        cleanup();
        process.exit(0);
      }
      if (state.printRequested) {
        state.printRequested = false;
        printReceipt(state, cfg, (result) => {
          state.message = result.message;
          state.messageKind = result.ok ? "ok" : "warn";
          frame(); // repaint with the outcome
        });
      }
    }
    frame();
  });

  out.on("resize", frame);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  process.on("exit", cleanup);

  out.write("\x1b[?1049h\x1b[2J"); // alternate screen
  frame();
}

// --------------------------------------------------------------------------
// --demo: drive the brain with scripted keys and print frames as plain text
// --------------------------------------------------------------------------

function demo(cfg, script, size, receiptOnly = false) {
  const keywords = new Set(["ENTER", "ESC", "BACKSPACE", "SHOW", "IGNORE", "RESIZE"]);
  const state = new State(cfg);
  const [rows, cols] = size;
  let presses = 0;
  for (const token of script) {
    const keys = keywords.has(token) || [...token].length === 1 ? [token] : [...token];
    for (const key of keys) {
      state.handle(key);
      presses++;
      if (!receiptOnly && (key === "ENTER" || token === "SHOW")) {
        console.log(`--- keys 1..${presses} (through '${token}') ---`);
        console.log(render(state, rows, cols).plainLines().join("\n"));
        console.log();
      }
    }
  }
  if (receiptOnly) {
    console.log(receiptLines(state, cfg).join("\n"));
    return;
  }
  console.log("--- final ---");
  console.log(
    `items=[${state.items.map((v) => v.toFixed(1)).join(", ")}] total=${state.show(state.total)} ` +
      `mode=${state.mode} change=${state.show(state.change)} quit=${state.quit ? "True" : "False"}`
  );
}

// --------------------------------------------------------------------------
// entry point
// --------------------------------------------------------------------------

const USAGE = `regitui - pretend-play cash register TUI (Node, zero dependencies)

usage: node register.js [options]

  --currency SYM      currency symbol (default ¥)
  --decimals N        decimal places (default 0)
  --dollars           shorthand for --currency $ --decimals 2
  --font seg|big      big digit style (default seg)
  --scale N           digit size: 1 = native (default), 0 = auto-fit
  --ascii             ASCII-only: +-+ boxes and # digits
  --store NAME        store name printed on the receipt (default MY SHOP)
  --receipt-width N   receipt columns: 32 = 58mm paper (default), 48 = 80mm
  --receipt-symbol S  symbol printed on amounts (default: the currency symbol;
                      use '' for bare numbers, or e.g. 円)
  --receipt-symbol-position P    auto (default), before or after the number
  --receipt-time STR  fixed receipt timestamp, e.g. '2026-10-04 16:30'
  --receipt-only      print just the receipt as plain ASCII (pipe it to a printer)
  --printer NAME      CUPS destination for the in-app F key (default: system default,
                      or REGITUI_PRINTER from the environment / .env)
  --print-paper PAPER paper for F: a4 (default), letter, a3, legal
  --print-cmd CMD     override the print pipeline used by F (default: paps | lp)
  --print-to FILE     F writes a PDF to FILE instead of printing on paper
  --size RxC          size used by --demo, e.g. 30x100
  --demo [KEYS]       non-interactive: comma separated keys, e.g. '5,.,ENTER,p,10.,ENTER'

  Local defaults (gitignored): copy .env.example to .env and set REGITUI_PRINTER,
  REGITUI_STORE, REGITUI_PRINT_PAPER, REGITUI_PRINT_CMD as needed.

keys: 0-9 price   . = 00 (yen)   ENTER add   BACKSPACE fix   ESC clear
      P pay cash   U undo   N new sale   R receipt   F print (also CTRL-P)   Q quit`;

export function main(argv) {
  loadEnvFile();
  const cfg = defaultConfig();
  let demoScript = null;
  let receiptOnly = false;
  let size = [30, 100];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => argv[++i];
    switch (arg) {
      case "-h":
      case "--help":
        console.log(USAGE);
        return 0;
      case "--currency":
        cfg.currency = value();
        break;
      case "--decimals":
        cfg.decimals = parseInt(value(), 10);
        break;
      case "--dollars":
        cfg.currency = "$";
        cfg.decimals = 2;
        break;
      case "--font":
        cfg.font = value();
        break;
      case "--scale":
        cfg.scale = parseInt(value(), 10);
        break;
      case "--ascii":
        cfg.asciiArt = true;
        break;
      case "--store":
        cfg.store = value();
        break;
      case "--receipt-width":
        cfg.receiptWidth = parseInt(value(), 10);
        break;
      case "--receipt-time":
        cfg.receiptTime = value();
        break;
      case "--receipt-symbol":
        cfg.receiptSymbol = value();
        break;
      case "--receipt-symbol-position":
        cfg.receiptSymbolPosition = value();
        break;
      case "--receipt-only":
        receiptOnly = true;
        break;
      case "--printer":
        cfg.printer = value();
        break;
      case "--print-paper":
        cfg.printPaper = value();
        break;
      case "--print-cmd":
        cfg.printCmd = value();
        break;
      case "--print-to":
        cfg.printTo = value();
        break;
      case "--size": {
        const [r, c] = value().split("x");
        size = [parseInt(r, 10), parseInt(c, 10)];
        break;
      }
      case "--demo":
        demoScript = argv[i + 1] && !argv[i + 1].startsWith("--") ? value() : "";
        break;
      default:
        console.error(`unknown option: ${arg}\n`);
        console.error(USAGE);
        return 2;
    }
  }

  if (demoScript !== null || argv.includes("--size") || receiptOnly) {
    const script = demoScript ? demoScript.split(",") : ["5", "0", "0", "ENTER"];
    demo(cfg, script, size, receiptOnly);
    return 0;
  }

  if (!process.stdin.isTTY) {
    console.error("regitui needs an interactive terminal (or use --demo).");
    return 1;
  }
  runTui(cfg);
  return 0;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) process.exitCode = main(process.argv.slice(2));
