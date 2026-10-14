# Wire Swapr Mix into Command Center (optional)

Original Swapr panel stays on `https://wan22-templates.vercel.app/`.
Live Mix host: **https://swapr-mix.vercel.app/** (Vercel project `swapr-mix`).

Add a fifth Image gen mode in Command Center:

## 1. `src/adapters/swaprMix.ts`

```ts
/** Swapr Mix — person-mask replace (props stay). Separate from original Swapr. */
export const SWAPR_MIX_APP_URL =
  import.meta.env.VITE_SWAPR_MIX_URL || 'https://swapr-mix.vercel.app/';
```

## 2. `src/components/widgets/SwaprMixPanel.tsx`

Copy `SwaprPanel.tsx`, import `SWAPR_MIX_APP_URL`, retitle to **Swapr Mix**, and note:
mark person (green) / keep props (red) before Generate.

## 3. Image model

- Extend `ImageGenModel` with `'swaprMix'`
- Add a button in `ImageGenWidget` (keep the existing **Swapr** button)
- Route `swaprMix` → `<SwaprMixPanel />`

Do not change `SWAPR_APP_URL` or `SwaprPanel.tsx`.
