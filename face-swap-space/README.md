---
title: BFS Face Swap (RunPod, owner-only)
emoji: 🎭
colorFrom: purple
colorTo: pink
sdk: gradio
hf_oauth: true
sdk_version: 6.28.0
app_file: app.py
python_version: "3.12"
short_description: Private BFS head swap running on RunPod serverless
models:
  - Alissonerdx/BFS-Best-Face-Swap
  - Qwen/Qwen-Image-2.1
  - Viggle/Qwen-Image-2.1-viggle-turbo
---

Private copy of `Simzy/bfs-best-face-swap` whose swaps run on Casey's RunPod worker (github.com/Simzy420/face-swap-runpod-worker). Head/face swap with the [BFS](https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap) `bfs_head_v1_qwen_2.1`
LoRA on [Qwen-Image-2.1](https://huggingface.co/Qwen/Qwen-Image-2.1), with an optional
[Viggle turbo](https://huggingface.co/Viggle/Qwen-Image-2.1-viggle-turbo) 6-step mode.

Example inputs are cropped from the example images in the BFS model repository (MIT license).
Qwen-Image-2.1 and the Viggle turbo LoRA are under the Qwen Research License (non-commercial).
Do not use or share results involving people who have not given consent.

## VRAM / resolution
On AMPERE_48 (`face-swap-bfs`), this Space caps uploads at **1024px max side** and sends worker `resolution` **1024** only (1536/2048 UI options removed / clamped). Matches `Simzy/face-swap-extend-video`.
