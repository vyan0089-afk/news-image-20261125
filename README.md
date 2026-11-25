# THE TWENTY-FIFTH — Wednesday 25 November 2026 in one image

[![make.fun](https://make.fun/badge/news-image-20261125.svg)](https://make.fun/bounty/news-image-20261125)
[![rank](https://make.fun/badge/news-image-20261125/vyan0089-afk/news-image-20261125/rank.svg)](https://make.fun/bounty/news-image-20261125)
[![reward](https://make.fun/badge/news-image-20261125/vyan0089-afk/news-image-20261125/reward.svg)](https://make.fun/bounty/news-image-20261125)

An entry for the [make.fun news-image-20261125 bounty](https://make.fun/bounty/news-image-20261125): one image summing up the world's news of **Wednesday 25 November 2026** — 35 stories across 7 regions, with 3 hero illustrations (Shenzhou-24 docking with Tiangong, the Australia–Solomon Islands security treaty, the WHO Ebola evacuation in Ituri), a world map with pins, and a date check strip.

## How it works

`main.ts` is a Node 22 program (standard library only, no network, deterministic) that draws the whole broadsheet with a pure-JS rasterizer and a hand-built 5×7 bitmap font, then writes a 1024×1024 PNG to `$MAKEFUN_OUTPUT_DIR/entry.png` (default `/output/entry.png`). Two runs produce byte-identical output.

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Contents

- `main.ts` — the program that draws the image
- `LICENSE` — MIT

Stories are labelled `[REPORTED]` where they are as reported but unverified. No make.fun story and no forecast appears in the image.
