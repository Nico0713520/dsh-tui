# DeepSeek brand asset

`deepseek-whale.svg` is the unmodified blue whale mark served by the official
DeepSeek API documentation site:

- Source: <https://api-docs.deepseek.com/img/favicon.svg>
- Official SVG SHA-256 (without a repository-standard trailing LF):
  `0bf5e13ce954f13423a692f083f5cb0f4bcfde35c8b812f64efe89dabfdaed20`
- Decoded `63 × 46` transparent PNG cache SHA-256:
  `ea65ee127a76ec8617ae01895ddbda3806ab81bdb4edc53f9d27ae29cdd7f372`

`deepseek-whale.png.base64` is the deterministic PNG protocol cache used only
for terminal inline-image protocols. Display scaling preserves aspect ratio.

The text-terminal solid quadrant-block fallback in `src/ui/brand-logo.ts` is
sampled from the same silhouette at a fixed 32 × 12 or 24 × 10 subpixel grid.
It is a rendering fallback, not a replacement logo.
Do not redraw, recolor, crop, distort, or animate the official whale.

DeepSeek and its whale mark belong to their respective owner. This repository
is an independent community TUI and is not an official DeepSeek product.
