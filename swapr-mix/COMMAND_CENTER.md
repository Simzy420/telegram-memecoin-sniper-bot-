# Wire Swapr Mix into Command Center (optional)

Original Swapr panel stays on `https://wan22-templates.vercel.app/`.
After you deploy this Mix app to a **new** host, add a fifth Image gen mode.

## 1. `src/adapters/swaprMix.ts`

```ts
/** Swapr Mix — person-mask replace (props stay). Separate from original Swapr. */
export const SWAPR_MIX_APP_URL =
  import.meta.env.VITE_SWAPR_MIX_URL || 'https://YOUR-SWAPR-MIX-HOST.vercel.app/';
```

## 2. `src/components/widgets/SwaprMixPanel.tsx`

Copy `SwaprPanel.tsx`, import `SWAPR_MIX_APP_URL`, retitle to **Swapr Mix**, and note:
mark person (green) / keep props (red) before Generate.

## 3. Image model

- Extend `ImageGenModel` with `'swaprMix'`
- Add a button in `ImageGenWidget` (keep the existing **Swapr** button)
- Route `swaprMix` → `<SwaprMixPanel />`

Do not change `SWAPR_APP_URL` or `SwaprPanel.tsx`.
