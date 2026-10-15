# App35 My Portfolio Remove fix

## Bug
In `Simzy420/big-brain-ape-dashboard` `app35.html`, My Portfolio sorts holdings by market value for display, then `Remove` called `removeHolding(displayIndex)` against the unsorted `bba_portfolio` array. Clicking Remove on one ticker deleted a different one.

## Fix
Preserve each holding's original `storageIndex` through the price-fetch/`Promise.all` path and pass that index to `removeHolding` after the value sort.

## Apply to live dashboard
This agent could not push to `Simzy420/big-brain-ape-dashboard` (no write permission). To ship:

1. Copy `app35.html` from this folder over `app35.html` on `main` in `big-brain-ape-dashboard`, **or**
2. Apply `portfolio-remove-fix.patch` in that repo:

```bash
cd big-brain-ape-dashboard
git apply path/to/portfolio-remove-fix.patch
```

Live site: https://simzy420.github.io/big-brain-ape-dashboard/app35.html
