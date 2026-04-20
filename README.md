# best-flight-chrome-extension

## What it does

1. You paste a Skiplagged search URL where origin and destination are already selected.
2. You set:
   - Departure date range
   - Return date range
   - Price threshold (USD)
3. The extension scans each valid round-trip date pair (`return > depart`).
4. It tracks the global cheapest fare found across all date pairs.
5. It keeps only flights where `price <= (global_cheapest + threshold)`.
6. You export the kept results as CSV.

## Important notes

- This is a DOM-based parser and may need selector tuning if Skiplagged changes layout.
- Use only where allowed by the website terms and applicable law.
- Nearby airports are handled by whatever options are encoded in your pasted Skiplagged URL.

## How to Use

1. Open extension popup.
2. Paste your Skiplagged round-trip search URL (must already include both dates).
3. Enter date ranges and threshold.
4. Click **Run manual scan**.
5. Click **Download CSV**.

## CSV columns

- `departDate`
- `returnDate`
- `airline`
- `priceUsd`
- `bookingLink`
- `lastChecked`
- `sourceUrl`
