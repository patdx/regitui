#!/usr/bin/env node
/*
 * Render a scripted sale through the shared core and inject the frame into
 * README.md between <!-- demo:start --> / <!-- demo:end --> markers.
 *
 *   pnpm readme
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { State, defaultConfig, render } from '../core.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const README = path.join(ROOT, 'README.md')
const START = '<!-- demo:start -->'
const END = '<!-- demo:end -->'

const ROWS = 24
const COLS = 72
const KEYS = [
  '1',
  '2',
  '3',
  'ENTER',
  '5',
  '0',
  '0',
  'ENTER',
  '8',
  '0',
  'ENTER',
  'p',
  '1',
  '0',
  '.',
  'ENTER',
]

function press(state, keys) {
  for (const key of keys) state.handle(key)
  return state
}

function demoFrame() {
  const cfg = {
    ...defaultConfig(),
    receiptTime: '2026-10-04 16:30',
    store: 'MY SHOP',
  }
  const state = press(new State(cfg), KEYS)
  const lines = render(state, ROWS, COLS).plainLines()
  // pad every line to COLS so the fence looks like a fixed terminal
  return lines.map((line) => line.padEnd(COLS).slice(0, COLS)).join('\n')
}

function inject(readme, frame) {
  const block = [START, '```', frame, '```', END].join('\n')
  const start = readme.indexOf(START)
  const end = readme.indexOf(END)
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`README.md must contain ${START} … ${END} markers`)
  }
  return readme.slice(0, start) + block + readme.slice(end + END.length)
}

const frame = demoFrame()
const next = inject(fs.readFileSync(README, 'utf8'), frame)
fs.writeFileSync(README, next)
console.log(`updated ${path.relative(ROOT, README)} (${ROWS}x${COLS}, ${KEYS.length} keys)`)
