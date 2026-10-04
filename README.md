# regitui

A tiny pretend-play cash register for kids — type prices, take cash, make change,
print a receipt. Runs in the terminal or the browser. Zero runtime dependencies.

<!-- demo:start -->
```
    CASH REGISTER                          TENDERED ¥1,000   3 items    
                               CHANGE DUE                               
                            █████ █████ █████                           
                                █ █   █     █                           
                          ¥     █ █   █     █                           
                            █████ █████     █                           
                            █         █     █                           
                            █         █     █                           
                            █████ █████     █                           
                                                                        
 ┌─ ITEMS (3) ────────────────────────────────────────────────────────┐ 
 │  1. Item 1 ·················································· ¥123 │ 
 │  2. Item 2 ·················································· ¥500 │ 
 │  3. Item 3 ··················································· ¥80 │ 
 │                                                               PAID │ 
 └────────────────────────────────────────────────────────────────────┘ 
                                                                        
                                                                        
                                                                        
                                                                        
                                                                        
                                                                        
  here is your change!                                                  
 CHANGE ¥297                      ENTER new  F print  R receipt  Q quit 
```
<!-- demo:end -->

## Terminal

```bash
node register.js            # yen (default)
node register.js --dollars  # dollars + cents
node register.js --help
```

Keys: `0`–`9` price · `.` = `00` (yen) · `ENTER` add · `P` pay · `R` receipt ·
`F` print · `U` undo · `N` new sale · `Q` quit

Copy [`.env.example`](.env.example) to `.env` for a local CUPS printer name
(`REGITUI_PRINTER`). That file is gitignored.

## Browser

```bash
pnpm preview    # build → dist/, then serve locally
pnpm deploy     # build → Cloudflare Workers (regitui.pmil.me)
```

Same keys. `F` / `Ctrl-P` opens the browser print dialog.

Live: [regitui.pmil.me](https://regitui.pmil.me)

## Develop

```bash
pnpm test
pnpm build
pnpm readme     # refresh the demo frame in this README
pnpm format     # prettier via pnpm dlx
```

`core.js` is the shared brain; `register.js` is the Node/TTY host;
`browser.js` + `index.html` are the browser host.
