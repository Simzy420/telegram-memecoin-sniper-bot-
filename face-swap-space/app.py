"""Private BFS face swap UI. Swaps run on Casey's RunPod serverless worker
(github.com/Simzy420/face-swap-runpod-worker), not on Hugging Face GPUs.

Space secrets: RUNPOD_API_KEY, RUNPOD_ENDPOINT_ID. No HF_TOKEN.
"""

import base64
import io
import json
import os
import random
import time
import urllib.error
import urllib.request

import gradio as gr

OWNER_USERNAME = "Simzy"


def require_owner(profile) -> None:
    """Refuse before any RunPod/GPU call unless the signed-in HF user is the owner."""
    if profile is None or getattr(profile, "username", None) != OWNER_USERNAME:
        raise gr.Error("Not allowed")

import numpy as np
from PIL import Image, ImageOps

RUNPOD_API_KEY = os.environ.get("RUNPOD_API_KEY", "").strip()
RUNPOD_API_KEY_2 = os.environ.get("RUNPOD_API_KEY_2", "").strip()
RUNPOD_ENDPOINT_ID = os.environ.get("RUNPOD_ENDPOINT_ID", "").strip()
RUNPOD_BASE = f"https://api.runpod.ai/v2/{RUNPOD_ENDPOINT_ID}"
TIMEOUT_S = float(os.environ.get("RUNPOD_TIMEOUT_SECONDS", "1500"))

MAX_SEED = np.iinfo(np.int32).max
TURBO = "Turbo · Viggle 6-step"
BASE = "Base · Qwen-Image-2.1"
MODES = [TURBO, BASE]
DEFAULT_STEPS = {TURBO: 6, BASE: 30}
# AMPERE_48 face-swap-bfs OOMs at 1536/2048 with large stills — only offer the safe bucket.
MAX_IMAGE_SIDE = 1024
SAFE_RESOLUTION = 1024
ALLOWED_RESOLUTIONS = (1024, 1536, 2048)
RESOLUTIONS = [
    ("1K (1024² — safe on AMPERE_48)", 1024),
]

FACE_SWAP_PROMPT = (
    "head_swap: start with <image1> as the base image, keeping its lighting, environment, and background. "
    "remove the head from <image1> completely and replace it with the head from <image2>, strictly preserving "
    "the hair, eye color, nose structure from <image2>. copy the direction of the eye, head rotation, micro "
    "expressions from <image1>, high quality, sharp details, 4k"
)


def _scrub(text: str) -> str:
    out = text
    for key in (RUNPOD_API_KEY, RUNPOD_API_KEY_2):
        if key:
            out = out.replace(key, "***")
    return out


RUNPOD_GRAPHQL = "https://api.runpod.io/graphql"


def _balance_line(api_key: str, label: str) -> str:
    """One account balance line; never raises — always returns markdown."""
    if not api_key:
        return f"- **{label}:** _(secret not set on this Space)_"
    query = "{ myself { clientBalance currentSpendPerHr } }"
    req = urllib.request.Request(
        RUNPOD_GRAPHQL,
        data=json.dumps({"query": query}).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "User-Agent": "simzy-face-swap-runpod/balances",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as exc:
        detail = _scrub(exc.read()[:200].decode(errors="replace"))
        return f"- **{label}:** _(API HTTP {exc.code}: {detail})_"
    except Exception as exc:
        return f"- **{label}:** _(unavailable: {_scrub(str(exc))[:160]})_"
    if body.get("errors"):
        msg = _scrub(str(body["errors"][0].get("message", "error")))[:160]
        return f"- **{label}:** _(RunPod API error: {msg})_"
    me = (body.get("data") or {}).get("myself") or {}
    try:
        bal = float(me.get("clientBalance") or 0.0)
        spend = float(me.get("currentSpendPerHr") or 0.0)
    except (TypeError, ValueError):
        return f"- **{label}:** _(unexpected response)_"
    return f"- **{label}:** `${bal:,.2f}` · burn `${spend:,.4f}/hr`"


def format_runpod_balances_md() -> str:
    """Top-of-UI RunPod credit snapshot. Failures stay in the panel (no crash)."""
    lines = [
        "### RunPod balances",
        "",
        _balance_line(RUNPOD_API_KEY, "Account 1 (`RUNPOD_API_KEY`)"),
    ]
    if RUNPOD_API_KEY_2:
        lines.append(_balance_line(RUNPOD_API_KEY_2, "Account 2 (`RUNPOD_API_KEY_2`)"))
    lines.extend(["", "_From Space secrets via RunPod GraphQL. Tap refresh to update._"])
    return "\n".join(lines)


def _request(method: str, url: str, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {RUNPOD_API_KEY}",
        "Content-Type": "application/json",
        "User-Agent": "simzy-face-swap-runpod/1.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read() or b"null")
    except urllib.error.HTTPError as exc:
        raise gr.Error(_scrub(f"RunPod HTTP {exc.code}: {exc.read()[:300].decode(errors='replace')}"))
    except urllib.error.URLError as exc:
        raise gr.Error(_scrub(f"RunPod unreachable: {exc}"))


def downscale_for_worker(img: Image.Image, max_side: int = MAX_IMAGE_SIDE) -> Image.Image:
    """EXIF-correct RGB copy capped to ``max_side`` (longest edge)."""
    img = ImageOps.exif_transpose(img).convert("RGB")
    img = img.copy()
    max_side = max(64, int(max_side))
    if max(img.size) > max_side:
        img.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    return img


def clamp_resolution(resolution) -> int:
    """Always send SAFE_RESOLUTION on AMPERE_48 — UI 1536/2048 cannot reach the worker."""
    try:
        value = int(resolution or SAFE_RESOLUTION)
    except (TypeError, ValueError):
        value = SAFE_RESOLUTION
    if value not in ALLOWED_RESOLUTIONS:
        value = SAFE_RESOLUTION
    if value > SAFE_RESOLUTION:
        value = SAFE_RESOLUTION
    return value


def _b64(img: Image.Image, max_side: int = MAX_IMAGE_SIDE) -> str:
    img = downscale_for_worker(img, max_side=max_side)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    return base64.b64encode(buf.getvalue()).decode()


def _oom_message(detail: str) -> str:
    return (
        f"{detail} "
        f"Inputs are auto-capped at {MAX_IMAGE_SIDE}px max side and resolution {SAFE_RESOLUTION}. "
        "Try a smaller scene still or a tighter face crop."
    )


def face_swap(
    reference_face: Image.Image,
    target_image: Image.Image,
    base_model: str = TURBO,
    resolution: int = SAFE_RESOLUTION,
    num_inference_steps: int = 6,
    lora_scale: float = 1.0,
    seed: int = 0,
    randomize_seed: bool = True,
    prompt: str = FACE_SWAP_PROMPT,
    progress=gr.Progress(),
    profile: gr.OAuthProfile | None = None,
):
    require_owner(profile)
    """Head swap on Casey's RunPod worker (same pipeline as Simzy/bfs-best-face-swap)."""
    if not RUNPOD_API_KEY or not RUNPOD_ENDPOINT_ID:
        raise gr.Error("RUNPOD_API_KEY / RUNPOD_ENDPOINT_ID Space secrets are missing.")
    if reference_face is None or target_image is None:
        raise gr.Error("Please provide both a reference face and a target image.")
    if base_model not in MODES:
        base_model = TURBO
    prompt = (prompt or "").strip() or FACE_SWAP_PROMPT
    reference_face = downscale_for_worker(reference_face)
    target_image = downscale_for_worker(target_image)
    resolution = clamp_resolution(resolution)
    seed = random.randint(0, MAX_SEED) if randomize_seed else int(seed)

    payload = {"input": {
        "reference_face": _b64(reference_face),
        "target_image": _b64(target_image),
        "base_model": "turbo" if base_model == TURBO else "base",
        "resolution": int(resolution),
        "num_inference_steps": int(num_inference_steps),
        "lora_scale": float(lora_scale),
        "seed": int(seed),
        "prompt": prompt,
        "output_format": "png",
    }}
    progress(0.05, desc="Sending to RunPod…")
    job = _request("POST", f"{RUNPOD_BASE}/run", payload, timeout=120)
    job_id = (job or {}).get("id")
    if not job_id:
        raise gr.Error(_scrub(f"RunPod did not return a job id: {str(job)[:300]}"))
    started = time.monotonic()
    while True:
        elapsed = time.monotonic() - started
        if elapsed > TIMEOUT_S:
            _request("POST", f"{RUNPOD_BASE}/cancel/{job_id}")
            raise gr.Error(f"RunPod job timed out after {int(elapsed)}s (cancelled).")
        status = _request("GET", f"{RUNPOD_BASE}/status/{job_id}")
        state = str((status or {}).get("status", "")).upper()
        if state == "COMPLETED":
            break
        if state in ("FAILED", "CANCELLED", "TIMED_OUT"):
            detail = _scrub(str(status.get("error") or status.get("output") or status)[:400])
            if "out of memory" in detail.lower() or "oom" in detail.lower():
                detail = _oom_message(detail)
            raise gr.Error(f"RunPod job {state}: {detail}")
        desc = "Waiting for a GPU worker (cold start can take a few minutes)…" if state == "IN_QUEUE" else "Swapping…"
        progress(min(0.9, 0.1 + elapsed / 600), desc=f"{desc} {int(elapsed)}s")
        time.sleep(3)
    out = status.get("output") or {}
    if isinstance(out, dict) and out.get("error"):
        detail = _scrub(str(out["error"]))
        if "out of memory" in detail.lower() or "oom" in detail.lower():
            detail = _oom_message(detail)
        raise gr.Error(f"Worker error: {detail}")
    if not isinstance(out, dict) or not out.get("image_base64"):
        raise gr.Error("RunPod finished but returned no image.")
    result = Image.open(io.BytesIO(base64.b64decode(out["image_base64"]))).convert("RGB")
    return (target_image, result), out.get("seed", seed)


def on_mode_change(base_model):
    if base_model == TURBO:
        return gr.update(value=DEFAULT_STEPS[TURBO],
                         info="Turbo: 6 is the validated schedule (clamped to 4-8; extra steps go to the high-noise end).")
    return gr.update(value=DEFAULT_STEPS[BASE],
                     info="Base: the official pipeline uses ~40-50 Euler steps; 30 is a good trade-off.")


# ----------------------------------------------------------------------------------------
# UI (layout follows linoyts/Flux2-Klein-Face-Swap)
# ----------------------------------------------------------------------------------------

css = """
#col-container { margin: 0 auto; max-width: 1200px; }
.image-container img { object-fit: contain; }
.dark .gradio-container { color: var(--body-text-color); }
"""

EX = "examples"
EXAMPLES = [
    [f"{EX}/reference_man.jpg", f"{EX}/target_1.jpg"],
    [f"{EX}/reference_man.jpg", f"{EX}/target_3.jpg"],
    [f"{EX}/reference_woman.jpg", f"{EX}/target_4.jpg"],
    [f"{EX}/reference_woman.jpg", f"{EX}/target_5.jpg"],
    [f"{EX}/reference_woman.jpg", f"{EX}/target_7.jpg"],
]

with gr.Blocks(title="BFS Best Face Swap · Qwen-Image-2.1") as demo:
    with gr.Column(elem_id="col-container"):
        balances_md = gr.Markdown(value="### RunPod balances\n\n_Loading…_")
        refresh_balances = gr.Button("Refresh balances", size="sm")
        gr.LoginButton()
        gr.HTML('<a href="/login/huggingface?_target_url=/" target="_self" style="display:block;text-align:center;padding:16px;margin:8px 0;border-radius:12px;background:#ff9d00;color:#000;font-size:18px;font-weight:700;text-decoration:none">Sign in with Hugging Face (tap here on iPhone)</a>'
                '<a href="https://simzy-face-swap-runpod.hf.space/login/huggingface?_target_url=/" target="_top" style="display:block;text-align:center;font-size:14px">Open app directly &amp; sign in</a>')
        gr.Markdown(
            "# BFS Best Face Swap · Qwen-Image-2.1 (RunPod, private)\n"
            "Head swap with the [Alissonerdx/BFS-Best-Face-Swap](https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap) "
            "`bfs_head_v1_qwen_2.1` LoRA on [Qwen-Image-2.1](https://huggingface.co/Qwen/Qwen-Image-2.1), optionally "
            "accelerated with [Viggle turbo](https://huggingface.co/Viggle/Qwen-Image-2.1-viggle-turbo) (6 steps). "
            "Upload the face to transfer and the target body/scene. Only use images of people who have given consent."
        )

        with gr.Row():
            with gr.Column():
                with gr.Row():
                    reference_face = gr.Image(label="Reference Face", type="pil", sources=["upload", "clipboard"],
                                              elem_classes="image-container", height=380)
                    target_image = gr.Image(label="Target Image (Body/Scene)", type="pil",
                                            sources=["upload", "clipboard"], elem_classes="image-container",
                                            height=380)
                base_model = gr.Radio(MODES, value=TURBO, label="Base model",
                                      info="Turbo: Viggle's 6-step distilled LoRA (~5x faster). Base: 40-step-class quality path.")
                run_button = gr.Button("Swap Face", variant="primary")
                with gr.Accordion("Advanced Settings", open=False):
                    resolution = gr.Dropdown(
                        RESOLUTIONS,
                        value=SAFE_RESOLUTION,
                        label="Resolution",
                        info=(
                            f"Capped at {SAFE_RESOLUTION} on AMPERE_48 to avoid GPU OOM. "
                            "Higher values are clamped before RunPod."
                        ),
                    )
                    num_inference_steps = gr.Slider(label="Inference Steps", minimum=4, maximum=50, step=1,
                                                    value=DEFAULT_STEPS[TURBO],
                                                    info="Turbo: 6 is the validated schedule (clamped to 4-8; extra steps go to the high-noise end).")
                    lora_scale = gr.Slider(label="BFS LoRA strength", minimum=0.0, maximum=1.5, step=0.05, value=1.0)
                    with gr.Row():
                        seed = gr.Slider(label="Seed", minimum=0, maximum=MAX_SEED, step=1, value=0)
                        randomize_seed = gr.Checkbox(label="Randomize seed", value=True)
                    prompt = gr.Textbox(label="Prompt", value=FACE_SWAP_PROMPT, lines=4,
                                        info="<image1> = target, <image2> = reference face.")

            with gr.Column():
                comparison_slider = gr.ImageSlider(label="Before / After", type="pil", format="png")
                seed_output = gr.Number(label="Seed used", interactive=False)

        gr.Examples(
            examples=EXAMPLES,
            inputs=[reference_face, target_image],
            outputs=[comparison_slider, seed_output],
            fn=face_swap,
            run_on_click=False,
            cache_examples=False,
            label="Examples (from the BFS model card)",
        )

    demo.load(format_runpod_balances_md, outputs=balances_md)
    refresh_balances.click(format_runpod_balances_md, outputs=balances_md)

    base_model.change(on_mode_change, inputs=base_model, outputs=num_inference_steps)
    run_button.click(
        face_swap,
        inputs=[reference_face, target_image, base_model, resolution, num_inference_steps, lora_scale,
                seed, randomize_seed, prompt],
        outputs=[comparison_slider, seed_output],
        api_name="face_swap",
        api_visibility="private",
    )

if __name__ == "__main__":
    demo.queue(max_size=20).launch(theme=gr.themes.Citrus(), css=css, footer_links=["gradio", "settings"])
