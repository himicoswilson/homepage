# HIMICOS

> The best software disappears into the gesture it’s for.

Source of [himicos.com](https://himicos.com) — a tiny personal landing page with a real-time **ASCII video background** rendered by a WebGL shader, in the spirit of the old Midjourney homepage.

## Features

- **ASCII video in a fragment shader** — the video is sampled per character cell on the GPU and mapped to a glyph atlas by brightness. The CPU only uploads one video texture per frame.
- **CRT look** — phosphor glow, RGB fringing, scanlines, aperture mask, rolling band and barrel curvature.
- **Interaction** — a scrambling lens follows the cursor; every click drops a water ripple (up to 8 at once) that refracts the video.
- **Intro animation** — the sentence *How I Make Ideas Come Out Slowly* collapses into its initials **HIMICOS**, which then fly into the card as the background decodes in.
- Easy on the eyes: per-cell temporal smoothing (no glyph flicker), soft scanlines, a calm looping clip.
- Respects `prefers-reduced-motion`, pauses when the tab is hidden, falls back to a plain video without WebGL.

## Stack

[Next.js](https://nextjs.org) (static export) · [Motion](https://motion.dev) · Tailwind CSS v4 · WebGL · [Cloudflare Workers](https://developers.cloudflare.com/workers/static-assets/)

## Development

```bash
npm install
npm run dev        # http://localhost:3000
```

| Path | What |
| --- | --- |
| `src/app/page.tsx` | Page & intro animation timeline |
| `src/app/components/AsciiVideo.tsx` | WebGL ASCII / CRT renderer |
| `worker/index.ts` | Adds HTTP Range (206) support for videos — required by Safari / iOS |
| `scripts/media-sizes.mjs` | Records media file sizes for the worker at build time |
| `.github/workflows/deploy.yml` | CI: build on PRs, deploy on `main` |

## Deployment

Every push to `main` is built and deployed to Cloudflare Workers by GitHub Actions.
Deploys to himicos.com on every push to `main`. Add a repository secret `CLOUDFLARE_API_TOKEN` (an API token created from the **Edit Cloudflare Workers** template) and set your `account_id` in `wrangler.jsonc`. Manual deploy: `npm run deploy`.

## License

[CC BY-SA 4.0](LICENSE) — adapted by himicoswilson from [uwu.cat](https://github.com/CtrlcvsNya/uwu.cat) by Ctrlcvs; you may share and adapt this work with attribution, under the same license.

**Exception:** the background video `public/media/kitten-540p.mp4` is a re-encode of
[“Kitten, Game, Pets”](https://pixabay.com/videos/kitten-game-pets-4216/) by MixailMixail from Pixabay,
used under the [Pixabay Content License](https://pixabay.com/service/license-summary/). It is **not** covered by CC BY-SA.

*not for sale, AI last.*
