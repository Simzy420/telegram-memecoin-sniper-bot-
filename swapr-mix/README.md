# Swapr Mix — replace a person and props

**Fork of** [Simzy420/wan22-templates](https://github.com/Simzy420/wan22-templates) (**Swapr / Become the Character**).

This branch is a **separate product**. Do **not** deploy it onto the original Swapr hosts.

| App | Host | Status |
| --- | --- | --- |
| **Original Swapr** | https://wan22-templates.vercel.app · https://swapr-casey.netlify.app | Leave alone (`main`) |
| **Swapr Mix** (this) | https://swapr-mix.vercel.app/ from branch `cursor/swapr-mix-bb0e` | Replace each marked person and marked props |

## What Mix changes

Original Swapr sends Wan Animate `mode: replace` **without** SAM control points, so you cannot choose which person or which handheld prop is replaced.

Swapr Mix:

1. Shows the template’s first frame.
2. You tap **green** once on each person to replace. The dots are numbered Person 1, Person 2, … in the order you tap, and a face slot appears for each number.
3. You tap **red** once on each prop to replace (popsicle, cup, phone). Prop 1, Prop 2, … each get a still slot. Skip red marks to replace people only.
4. Generate stays off until every Person slot and every Prop slot has a still.
5. Generate sends `points_store` / `coordinates` / `neg_coordinates` so Runpod loads `newWanAnimate_point_api.json`. Every green mark and every red mark is a **positive** SAM point (the region to replace). The hub still requires a dummy `neg_coordinates` point; that point does not mean “keep.”
6. Wan Animate’s Runpod handler and the Space `/generate` route each accept **one** reference image (`image_base64` / a single `image`). The phone composites Person 1, Person 2, … left to right into that JPEG, in the same order as the green points. One green mark still sends a single face, unchanged. Prop stills are composited left to right, inset into the corner of the reference JPEG, and also sent as `prop_image_base64`. With more than one face, the phone leaves the bottom of the strip clear so that corner inset does not cover the last face.
7. Slightly stronger Mix defaults (steps 5, cfg 1, replace-person / replace-prop prompt, standard Wan negative). Two or more green marks switch the stock prompt to a left-to-right face match.

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
