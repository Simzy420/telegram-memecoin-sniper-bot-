# Swapr Mix — keep the props

**Fork of** [Simzy420/wan22-templates](https://github.com/Simzy420/wan22-templates) (**Swapr / Become the Character**).

This branch is a **separate product**. Do **not** deploy it onto the original Swapr hosts.

| App | Host | Status |
| --- | --- | --- |
| **Original Swapr** | https://wan22-templates.vercel.app · https://swapr-casey.netlify.app | Leave alone (`main`) |
| **Swapr Mix** (this) | Deploy a **new** Vercel or Netlify site from branch `cursor/swapr-mix-bb0e` | Person-mask replace |

## What Mix changes

Original Swapr sends Wan Animate `mode: replace` **without** SAM control points, so the worker’s auto mask often eats handheld props (popsicle → missing / rubber).

Swapr Mix:

1. Shows the template’s first frame.
2. You tap **green** on the person to replace.
3. You tap **red** on props to keep.
4. Generate sends `points_store` / `coordinates` / `neg_coordinates` so Runpod loads `newWanAnimate_point_api.json` (SAM guided by your marks).
5. Slightly stronger Mix defaults (steps 5, cfg 1, prop-aware prompt, standard Wan negative).

Same Runpod endpoint and template catalog as Swapr. Same phone proxy pattern (`USE_PROXY: true`).

## Deploy (new site only)

1. Create a **new** Vercel project (suggested name `swapr-mix`) pointed at this repo + branch `cursor/swapr-mix-bb0e`.
2. Copy the same secrets as Swapr Production: `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID` (`zrmwpir4qzs66s`), optional `HF_TOKEN` / `HF_SPACE_URL` for Extend.
3. Do **not** reconnect `wan22-templates` or `swapr-casey` to this branch.
4. Optional: in Command Center, add a panel URL for the new Mix host (keep the existing Swapr panel on the original URL).

## Local

```bash
npm install
npm test
npm run dev
```

## Original Swapr

Phone site: https://swapr-casey.netlify.app  
Vercel UI: https://wan22-templates.vercel.app  
Space: https://huggingface.co/spaces/Simzy/Wan-2.2-templates  
Dataset: https://huggingface.co/datasets/Simzy/wan22-template-clips  
