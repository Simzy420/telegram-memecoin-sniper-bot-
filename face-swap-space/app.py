"""
Face Swap + Extend — Gradio shell on RunPod backends.

Modes:
  * Swap only — BFS head-swap via face-swap-runpod-worker
  * Extend only — Wan 2.2 I2V + Extend chaining
  * Run both steps — swap still → I2V generate → MP4

RunPod is the primary path (RUNPOD_API_KEY + endpoint ids). ZeroGPU is only
an optional fallback when WAN_BACKEND=zerogpu or USE_ZERGPU=1.
"""

from __future__ import annotations

import base64
import os
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import cv2
import gradio as gr
import numpy as np
import dual_faces
import hf_auth
import runpod_faceswap
import runpod_i2v
from gradio_client import Client, handle_file
from PIL import Image, ImageOps

REPO_ROOT = Path(__file__).resolve().parent
STATIC_DIR = REPO_ROOT / "static"
# Direct Space URL — use this in Safari for Add to Home Screen (not huggingface.co/spaces/…).
SPACE_DIRECT_URL = "https://simzy-face-swap-extend-video.hf.space"
SPACE_ICON_BASE = (
    "https://huggingface.co/spaces/Simzy/face-swap-extend-video/resolve/main/static"
)

UPSTREAM_SPACE = os.environ.get("WAN_UPSTREAM_SPACE", "kulkas2pintu/wan222")
UPSTREAM_API = "generate_video"

DEFAULT_PROMPT = "make this image come alive, cinematic motion, smooth animation"
DEFAULT_NEGATIVE = (
    "色调艳丽, 过曝, 静态, 细节模糊不清, 字幕, 风格, 作品, 画作, 画面, 静止, "
    "整体发灰, 最差质量, 低质量, JPEG压缩残留, 丑陋的, 残缺的, 多余的手指, "
    "画得不好的手部, 画得不好的脸部, 畸形的, 毁容的, 形态畸形的肢体, 手指融合, "
    "静止不动的画面, 杂乱的背景, 三条腿, 背景人很多, 倒着走"
)

EXTEND_START_LAST_FRAME = "Last frame from video"
EXTEND_START_UPLOAD = "Upload custom image"

MODE_SWAP = "Swap only"
MODE_EXTEND = "Extend only"
MODE_BOTH = "Run both steps"
MODES = [MODE_SWAP, MODE_EXTEND, MODE_BOTH]

SWAP_TURBO = "Turbo · Viggle 6-step"
SWAP_BASE = "Base · Qwen-Image-2.1"
SWAP_MODES = [SWAP_TURBO, SWAP_BASE]
SWAP_DEFAULT_STEPS = {SWAP_TURBO: 6, SWAP_BASE: 30}
SWAP_RESOLUTIONS = [
    ("1K (1024² area)", 1024),
    ("1.5K (1536² area)", 1536),
    ("2K (2048² area)", 2048),
]

WORK = Path(tempfile.gettempdir()) / "face_swap_extend"
WORK.mkdir(parents=True, exist_ok=True)

_client: Client | None = None


def get_client() -> Client:
    global _client
    if _client is None:
        token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
        kwargs: dict[str, Any] = {}
        if token:
            kwargs["hf_token"] = token
        _client = Client(UPSTREAM_SPACE, **kwargs)
    return _client


def _session_dir() -> Path:
    d = WORK / uuid.uuid4().hex[:12]
    d.mkdir(parents=True, exist_ok=True)
    return d


def _as_image_source(img, _depth: int = 0):
    """Unwrap Gradio file-data / (image, caption) values to a PIL-loadable source."""
    if img is None or _depth > 4:
        return img
    if isinstance(img, dict):
        inner = img.get("path") or img.get("name") or img.get("image") or img.get("url")
        return _as_image_source(inner, _depth + 1)
    if isinstance(img, (list, tuple)) and img:
        return _as_image_source(img[0], _depth + 1)
    return img


def load_pil_image(img: Image.Image | np.ndarray | str | Path | dict | None) -> Image.Image | None:
    """Load an upload as RGB, honoring iPhone EXIF orientation."""
    img = _as_image_source(img)
    if img is None:
        return None
    if isinstance(img, Image.Image):
        pil = img
    elif isinstance(img, np.ndarray):
        arr = img
        if arr.ndim == 2:
            arr = np.stack([arr, arr, arr], axis=-1)
        if arr.shape[-1] == 4:
            arr = arr[..., :3]
        pil = Image.fromarray(arr.astype("uint8"))
    elif isinstance(img, (str, Path)):
        src = Path(img)
        if not src.exists() or not src.is_file():
            return None
        try:
            with Image.open(src) as opened:
                pil = opened.copy()
        except Exception:
            return None
    else:
        return None
    try:
        pil = ImageOps.exif_transpose(pil)
    except Exception:
        pass
    return pil.convert("RGB")


def save_image(img: Image.Image | np.ndarray | str | Path | dict | None, dest: Path) -> Path | None:
    pil = load_pil_image(img)
    if pil is None:
        return None
    out = dest.with_suffix(".png")
    pil.save(out)
    return out


def _even(n: int) -> int:
    n = int(n)
    if n < 2:
        return 2
    return n - (n % 2)


def probe_video_size(video_path: str | Path) -> tuple[int, int]:
    """Even pixel size of the first video stream (the size players lock onto)."""
    video_path = str(video_path)
    try:
        out = subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height",
                "-of",
                "csv=p=0:s=x",
                video_path,
            ],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
        w_s, h_s = out.split("x", 1)
        w, h = _even(int(w_s)), _even(int(h_s))
        if w >= 2 and h >= 2:
            return w, h
    except Exception:
        pass
    cap = cv2.VideoCapture(video_path)
    w = _even(int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0))
    h = _even(int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0))
    cap.release()
    if w < 2 or h < 2:
        raise RuntimeError(f"Could not read video size: {video_path}")
    return w, h


def cover_resize(image: Image.Image, width: int, height: int) -> Image.Image:
    """Scale-and-center-crop so `image` fills width×height without letterboxing."""
    width, height = _even(width), _even(height)
    image = image.convert("RGB")
    src_w, src_h = image.size
    if src_w < 1 or src_h < 1:
        raise ValueError("Custom image has no pixels.")
    if src_w == width and src_h == height:
        return image
    scale = max(width / src_w, height / src_h)
    new_w = max(1, int(round(src_w * scale)))
    new_h = max(1, int(round(src_h * scale)))
    resized = image.resize((new_w, new_h), Image.Resampling.LANCZOS)
    left = max(0, (new_w - width) // 2)
    top = max(0, (new_h - height) // 2)
    cropped = resized.crop((left, top, left + width, top + height))
    if cropped.size != (width, height):
        cropped = cropped.resize((width, height), Image.Resampling.LANCZOS)
    return cropped


def reference_video_path(state: dict) -> Path | None:
    """Clip whose geometry later segments must match. Prefer the original segment."""
    segs = state.get("segments") or []
    if segs:
        first = Path(str(segs[0]))
        if first.exists():
            return first
    video = state.get("video")
    if video:
        current = Path(str(video))
        if current.exists():
            return current
    return None


def extract_last_frame(video_path: str | Path, out_path: Path) -> Path:
    video_path = str(video_path)
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video: {video_path}")
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    frame = None
    if total > 0:
        cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, total - 1))
        ok, frame = cap.read()
        if not ok or frame is None:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            while True:
                ok, f = cap.read()
                if not ok:
                    break
                frame = f
    else:
        while True:
            ok, f = cap.read()
            if not ok:
                break
            frame = f
    cap.release()
    if frame is None:
        raise RuntimeError("No frames found in video.")
    out_path = out_path.with_suffix(".png")
    cv2.imwrite(str(out_path), frame)
    return out_path


def video_duration_seconds(video_path: str | Path) -> float:
    video_path = str(video_path)
    try:
        out = subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                video_path,
            ],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
        return float(out)
    except Exception:
        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 16.0
        frames = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
        cap.release()
        if fps > 0 and frames > 0:
            return frames / fps
        return 0.0


OUTPUT_FPS = 16


def concat_videos(paths: list[Path], out_path: Path) -> Path:
    if not paths:
        raise RuntimeError("No videos to concatenate.")
    if len(paths) == 1:
        shutil.copy2(paths[0], out_path)
        return out_path
    width, height = probe_video_size(paths[0])
    fps = OUTPUT_FPS
    crop_w = f"if(lt(iw\\,{width})\\,iw\\,{width})"
    crop_h = f"if(lt(ih\\,{height})\\,ih\\,{height})"
    vf = (
        f"scale={width}:{height}:force_original_aspect_ratio=increase,"
        f"crop=w={crop_w}:h={crop_h},"
        f"scale={width}:{height},"
        f"setsar=1,fps={fps},format=yuv420p"
    )
    list_file = out_path.parent / "concat_list.txt"
    normalized: list[Path] = []
    for i, p in enumerate(paths):
        norm = out_path.parent / f"norm_{i:03d}.mp4"
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(p),
                "-vf",
                vf,
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-an",
                "-vsync",
                "cfr",
                "-r",
                str(fps),
                str(norm),
            ],
            check=True,
            capture_output=True,
        )
        normalized.append(norm)
    with list_file.open("w") as f:
        for p in normalized:
            escaped = str(p.resolve()).replace("'", r"'\''")
            f.write(f"file '{escaped}'\n")
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(list_file),
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            str(out_path),
        ],
        check=True,
        capture_output=True,
    )
    return out_path


def _raise_segment_error(action: str, exc: Exception) -> None:
    """Surface RunPod failures directly. ``action`` is Generation or Extend."""
    if isinstance(exc, gr.Error):
        raise exc
    if isinstance(exc, runpod_i2v.RunpodError):
        raise gr.Error(f"{action} failed: {exc}") from exc
    if isinstance(exc, runpod_faceswap.FaceswapError):
        raise gr.Error(f"{action} failed: {exc}") from exc
    if runpod_i2v.active_backend() == "runpod":
        raise gr.Error(f"{action} failed (RunPod): {exc}") from exc
    if action == "Generation":
        raise gr.Error(
            f"Generation failed (ZeroGPU queue/quota or upstream error): {exc}"
        ) from exc
    raise gr.Error(f"Extend failed: {exc}") from exc


def _runpod_progress(progress, phase: str, elapsed: float) -> None:
    """Paint I2V phases. Never hit 1.0 — only the outer handler finalizes."""
    if not progress:
        return
    if phase == "submit":
        progress(0.12, desc="Sending this segment to RunPod…")
        return
    if phase == "IN_QUEUE":
        progress(
            min(0.35, 0.2 + float(elapsed) / 900.0),
            desc=(
                "Waiting for a RunPod worker "
                f"(cold start + model download can take several minutes)… {int(elapsed)}s"
            ),
        )
        return
    if phase == "IN_PROGRESS":
        progress(
            min(0.75, 0.45 + float(elapsed) / 1200.0),
            desc=f"RunPod is generating this segment… {int(elapsed)}s",
        )
        return
    if phase == "COMPLETED":
        # Status payload can include a large base64 MP4; keep the bar honest.
        progress(0.85, desc="RunPod finished — reading video payload…")
        return
    if phase == "save":
        progress(0.92, desc="Saving video…")
        return
    if phase:
        progress(0.4, desc=f"RunPod status: {phase}… {int(elapsed)}s")


def _faceswap_progress(progress, phase: str, elapsed: float) -> None:
    """Paint swap phases. Cap below 1.0 so nested 'Run both' does not look done."""
    if not progress:
        return
    if phase == "submit":
        progress(0.08, desc="Sending face swap to RunPod…")
        return
    if phase == "IN_QUEUE":
        # Creep so the bar cannot sit on one number for the whole cold start.
        progress(
            min(0.45, 0.2 + float(elapsed) / 800.0),
            desc=(
                "Waiting for a face-swap worker "
                f"(cold start can take several minutes)… {int(elapsed)}s"
            ),
        )
        return
    if phase in ("IN_PROGRESS", "Swapping…"):
        progress(
            min(0.75, 0.5 + float(elapsed) / 1200.0),
            desc=f"Swapping face… {int(elapsed)}s",
        )
        return
    if phase == "COMPLETED":
        progress(0.82, desc="Swap finished — decoding image…")
        return
    if phase == "save":
        progress(0.88, desc="Saving swapped still…")
        return
    if phase:
        progress(0.35, desc=f"Face-swap status: {phase}… {int(elapsed)}s")


def _pump_blocking(progress, start_desc: str, worker, paint):
    """Run RunPod work off this thread and repaint the bar every second.

    Gradio only delivers progress from the request thread. The face-swap
    client blocks inside urllib, so the bar would stay on the first 5% tick
    for the whole job.

    Never paints 1.0 — callers must finalize only when the Gradio return
    values are fully ready (otherwise the UI sits at 100% with no output).
    """
    phases: list[tuple[str, float]] = []
    box: dict[str, Any] = {}

    def on_progress(phase: str, elapsed: float) -> None:
        phases.append((str(phase or ""), float(elapsed)))

    def run() -> None:
        try:
            box["result"] = worker(on_progress)
        except Exception as exc:
            box["error"] = exc

    thread = threading.Thread(target=run, name="runpod-progress", daemon=True)
    thread.start()
    started = time.monotonic()
    while thread.is_alive():
        if phases:
            phase, elapsed = phases[-1]
            paint(progress, phase, elapsed)
        elif progress:
            waited = time.monotonic() - started
            progress(min(0.15, 0.06 + waited / 400.0), desc=f"{start_desc} {int(waited)}s")
        thread.join(timeout=1.0)
    if box.get("error") is not None:
        raise box["error"]
    if "result" not in box:
        raise RuntimeError(f"{start_desc}: worker thread finished with no result.")
    return box["result"]


def _require_media_file(path: str | Path | None, kind: str) -> str:
    """Fail clearly if a return path is missing — never hand Gradio a dead path."""
    if path is None:
        raise gr.Error(f"{kind} is missing after the job finished.")
    p = Path(str(path))
    try:
        ok = p.is_file() and p.stat().st_size >= 32
    except OSError as exc:
        raise gr.Error(f"{kind} could not be read ({p.name}): {exc}") from exc
    if not ok:
        raise gr.Error(f"{kind} was not written (missing or empty): {p}")
    return str(p.resolve())


def _slider_file_pair(
    before: Image.Image, after: Image.Image, sess: Path
) -> tuple[str, str]:
    """Write before/after stills to disk so ImageSlider postprocess stays fast."""
    before_path = sess / f"before_{uuid.uuid4().hex[:10]}.png"
    after_path = sess / f"after_{uuid.uuid4().hex[:10]}.png"
    before.convert("RGB").save(before_path, format="PNG")
    after.convert("RGB").save(after_path, format="PNG")
    return str(before_path), str(after_path)


def call_runpod_i2v(
    image_path: Path,
    prompt: str,
    duration: float,
    steps: int,
    negative: str,
    seed: int,
    randomize: bool,
    progress: gr.Progress | None = None,
) -> Path:
    # Fail before submit when secrets are unset (no silent ZeroGPU, and no
    # silent hit on a deleted historical default endpoint).
    runpod_i2v.require_api_key()
    runpod_i2v.require_endpoint_id()
    dest = image_path.parent / f"seg_{uuid.uuid4().hex[:8]}.mp4"

    def worker(on_progress):
        return runpod_i2v.generate_i2v(
            image_path,
            dest,
            prompt=prompt or DEFAULT_PROMPT,
            negative_prompt=negative or DEFAULT_NEGATIVE,
            duration_seconds=float(duration),
            steps=int(steps),
            seed=runpod_i2v.resolve_seed(int(seed), bool(randomize)),
            on_progress=on_progress,
        )

    return _pump_blocking(progress, "Starting generation", worker, _runpod_progress)


def call_zerogpu_i2v(
    image_path: Path,
    prompt: str,
    duration: float,
    steps: int,
    negative: str,
    seed: int,
    randomize: bool,
    quality: int,
    fps: int,
    safe_mode: bool,
    progress: gr.Progress | None = None,
) -> Path:
    client = get_client()
    if progress:
        progress(0.1, desc=f"Calling {UPSTREAM_SPACE} (ZeroGPU queue)…")

    result = client.predict(
        handle_file(str(image_path)),
        None,
        prompt or DEFAULT_PROMPT,
        int(steps),
        negative or DEFAULT_NEGATIVE,
        float(duration),
        1.0,
        1.0,
        int(seed),
        bool(randomize),
        int(quality),
        "UniPCMultistep",
        3.0,
        int(fps),
        True,
        bool(safe_mode),
        api_name=f"/{UPSTREAM_API}",
    )

    video_ref = None
    if isinstance(result, (list, tuple)):
        video_ref = result[0]
    else:
        video_ref = result

    if isinstance(video_ref, dict):
        video_path = video_ref.get("video") or video_ref.get("path") or video_ref.get("url")
        if isinstance(video_path, dict):
            video_path = video_path.get("path") or video_path.get("url")
    else:
        video_path = video_ref

    if not video_path or not Path(str(video_path)).exists():
        raise RuntimeError(
            f"Upstream did not return a local video path. Got: {type(result)} {str(result)[:300]}"
        )

    dest = image_path.parent / f"seg_{uuid.uuid4().hex[:8]}.mp4"
    shutil.copy2(str(video_path), dest)
    return dest


def call_wan_i2v(
    image_path: Path,
    prompt: str,
    duration: float,
    steps: int,
    negative: str,
    seed: int,
    randomize: bool,
    quality: int,
    fps: int,
    safe_mode: bool,
    progress: gr.Progress | None = None,
) -> Path:
    """One I2V segment. RunPod by default; ZeroGPU only when explicitly opted in."""
    if runpod_i2v.active_backend() == "runpod":
        return call_runpod_i2v(
            image_path,
            prompt,
            duration,
            steps,
            negative,
            seed,
            randomize,
            progress,
        )
    return call_zerogpu_i2v(
        image_path,
        prompt,
        duration,
        steps,
        negative,
        seed,
        randomize,
        quality,
        fps,
        safe_mode,
        progress,
    )


def backend_status_bits() -> str:
    if runpod_i2v.active_backend() != "runpod":
        return f"ZeroGPU fallback `{UPSTREAM_SPACE}` (WAN_BACKEND=zerogpu)"
    parts: list[str] = []
    # Display uses soft-resolved extend id (env or historical default). Actual
    # jobs still call require_endpoint_id() so a missing env fails clearly.
    parts.append(f"extend `{runpod_i2v.endpoint_id()}`")
    fs = runpod_faceswap.endpoint_id()
    if fs:
        parts.append(f"swap `{fs}`")
    else:
        parts.append("swap endpoint **missing**")
    key = "key set" if (os.environ.get("RUNPOD_API_KEY") or "").strip() else "**API key missing**"
    return f"RunPod ({key}; " + "; ".join(parts) + ")"


def status_line(segments: list[str], duration_est: float) -> str:
    n = len(segments)
    return (
        f"**Segments:** {n}  ·  **Duration ≈ {duration_est:.1f}s**  ·  {backend_status_bits()}"
    )


def estimate_total(seg_duration: float, num_segments: int) -> float:
    return float(seg_duration) * int(num_segments)


def resolve_extend_prompt(extend_prompt: str | None, generate_prompt: str | None, state: dict) -> str:
    """Prefer dedicated Extend prompt; else Generate prompt / saved state / default."""
    if extend_prompt and str(extend_prompt).strip():
        return str(extend_prompt).strip()
    if generate_prompt and str(generate_prompt).strip():
        return str(generate_prompt).strip()
    return state.get("prompt") or DEFAULT_PROMPT


def resolve_extend_start_image(
    extend_start: str,
    custom_image,
    state: dict,
    sess: Path,
) -> Path:
    """Pick I2V start image for an Extend segment."""
    mode = (extend_start or EXTEND_START_LAST_FRAME).strip()
    if mode == EXTEND_START_UPLOAD:
        if custom_image is None:
            raise gr.Error("Upload a custom extend start image, or switch to “Last frame from video”.")
        pil = load_pil_image(custom_image)
        if pil is None:
            raise gr.Error("Could not read the custom extend start image.")
        ref = reference_video_path(state)
        if ref is not None:
            try:
                w, h = probe_video_size(ref)
                pil = cover_resize(pil, w, h)
            except Exception as e:
                raise gr.Error(
                    f"Could not match the custom image to the current video size: {e}"
                ) from e
        saved = save_image(pil, sess / f"extend_custom_{uuid.uuid4().hex[:8]}")
        if saved is None:
            raise gr.Error("Could not read the custom extend start image.")
        return saved

    last = Path(state["last_frame"]) if state.get("last_frame") else None
    if last is None or not last.exists():
        if not state.get("video"):
            raise gr.Error("Generate a clip first, then use Extend.")
        last = extract_last_frame(state["video"], sess / "last_frame")
        state["last_frame"] = str(last)
    return last


def do_generate(
    image,
    prompt,
    seg_duration,
    steps,
    negative,
    seed,
    randomize,
    quality,
    fps,
    safe_mode,
    state: dict,
    progress=gr.Progress(track_tqdm=False),
):
    hf_auth.require_unlocked(state)
    if image is None:
        raise gr.Error("Upload a still image first.")
    sess = Path(state.get("dir") or str(_session_dir()))
    sess.mkdir(parents=True, exist_ok=True)
    state["dir"] = str(sess)

    img_path = save_image(image, sess / "input")
    if img_path is None:
        raise gr.Error("Could not read the uploaded image.")

    progress(0.05, desc="Starting generation…")
    try:
        clip = call_wan_i2v(
            img_path,
            prompt,
            float(seg_duration),
            int(steps),
            negative,
            int(seed),
            bool(randomize),
            int(quality),
            int(fps),
            bool(safe_mode),
            progress,
        )
    except Exception as e:
        _raise_segment_error("Generation", e)

    out = sess / "current.mp4"
    shutil.copy2(clip, out)
    # Separate copy for Download so Gradio cache moves cannot race the preview path.
    download_path = sess / f"download_{uuid.uuid4().hex[:8]}.mp4"
    shutil.copy2(out, download_path)
    last = extract_last_frame(out, sess / "last_frame")
    dur = video_duration_seconds(out)
    state["segments"] = [str(clip)]
    state["video"] = str(out)
    state["last_frame"] = str(last)
    state["prompt"] = prompt
    video_out = _require_media_file(out, "Preview MP4")
    file_out = _require_media_file(download_path, "Download MP4")
    last_out = _require_media_file(last, "Last frame")
    if progress:
        progress(1.0, desc="Done")
    return (
        video_out,
        file_out,
        status_line(state["segments"], dur),
        last_out,
        state,
    )


def do_extend(
    prompt,
    extend_prompt,
    extend_start,
    custom_extend_image,
    seg_duration,
    steps,
    negative,
    seed,
    randomize,
    quality,
    fps,
    safe_mode,
    state: dict,
    progress=gr.Progress(track_tqdm=False),
):
    hf_auth.require_unlocked(state)
    if not state or not state.get("video"):
        raise gr.Error("Generate a clip first, then use Extend.")
    if len(state.get("segments", [])) >= 6:
        raise gr.Error("Segment cap reached (6). Reset and start a new chain.")

    sess = Path(state["dir"])
    start_img = resolve_extend_start_image(extend_start, custom_extend_image, state, sess)
    use_prompt = resolve_extend_prompt(extend_prompt, prompt, state)

    mode_label = (extend_start or EXTEND_START_LAST_FRAME).strip()
    progress(0.05, desc=f"Extending ({mode_label})…")
    try:
        clip = call_wan_i2v(
            start_img,
            use_prompt,
            float(seg_duration),
            int(steps),
            negative,
            int(seed),
            bool(randomize),
            int(quality),
            int(fps),
            bool(safe_mode),
            progress,
        )
    except Exception as e:
        _raise_segment_error("Extend", e)

    segs = [Path(p) for p in state["segments"]] + [clip]
    out = sess / f"current_{len(segs)}.mp4"
    try:
        concat_videos(segs, out)
    except Exception as e:
        raise gr.Error(f"Concat failed (ffmpeg): {e}") from e

    last = extract_last_frame(out, sess / "last_frame")
    dur = video_duration_seconds(out)
    state["segments"] = [str(p) for p in segs]
    state["video"] = str(out)
    state["last_frame"] = str(last)
    state["prompt"] = use_prompt
    download_path = sess / f"download_{uuid.uuid4().hex[:8]}.mp4"
    shutil.copy2(out, download_path)
    video_out = _require_media_file(out, "Preview MP4")
    file_out = _require_media_file(download_path, "Download MP4")
    last_out = _require_media_file(last, "Last frame")
    if progress:
        progress(1.0, desc="Extended")
    return (
        video_out,
        file_out,
        status_line(state["segments"], dur),
        last_out,
        state,
    )


def do_auto_extend(
    target_seconds,
    prompt,
    extend_prompt,
    extend_start,
    custom_extend_image,
    seg_duration,
    steps,
    negative,
    seed,
    randomize,
    quality,
    fps,
    safe_mode,
    state: dict,
    progress=gr.Progress(track_tqdm=False),
):
    hf_auth.require_unlocked(state)
    if not state or not state.get("video"):
        raise gr.Error("Generate a first clip, then Auto-extend.")
    target = float(target_seconds)
    max_segs = 6
    video, download, status, last_preview, state = (
        state.get("video"),
        state.get("video"),
        status_line(state.get("segments", []), video_duration_seconds(state["video"])),
        state.get("last_frame"),
        state,
    )
    first = True
    while len(state.get("segments", [])) < max_segs:
        dur = video_duration_seconds(state["video"])
        if dur >= target:
            break
        progress(
            len(state["segments"]) / max_segs,
            desc=f"Auto-extend: {dur:.1f}s / {target:.0f}s…",
        )
        this_start = extend_start if first else EXTEND_START_LAST_FRAME
        this_custom = custom_extend_image if first else None
        video, download, status, last_preview, state = do_extend(
            prompt,
            extend_prompt,
            this_start,
            this_custom,
            seg_duration,
            steps,
            negative,
            seed,
            randomize,
            quality,
            fps,
            safe_mode,
            state,
            progress=progress,
        )
        first = False
        time.sleep(0.3)
    return video, download, status, last_preview, state


def _mean_abs_diff(a: Image.Image, b: Image.Image) -> float:
    """Cheap perceptual check: near-zero means the 'swap' barely changed the target."""
    left = a.convert("RGB").resize((256, 256), Image.Resampling.BILINEAR)
    right = b.convert("RGB").resize((256, 256), Image.Resampling.BILINEAR)
    aa = np.asarray(left, dtype=np.float32)
    bb = np.asarray(right, dtype=np.float32)
    return float(np.mean(np.abs(aa - bb)))


def _video_path(value) -> str | None:
    if isinstance(value, dict):
        value = value.get("name") or value.get("path") or value.get("video")
    if isinstance(value, str) and Path(value).is_file():
        return value
    return None


def do_two_swap(
    left_face_img,
    scene_img,
    right_face_img,
    clip,
    swap_model,
    swap_resolution,
    swap_steps,
    swap_lora,
    swap_seed,
    swap_randomize,
    swap_prompt,
    state: dict,
    progress=gr.Progress(track_tqdm=False),
):
    """Swap the left person and the right person in one picture, or in a short clip."""
    hf_auth.require_unlocked(state)
    left = load_pil_image(left_face_img)
    right = load_pil_image(right_face_img)
    scene = load_pil_image(scene_img)
    clip_path = _video_path(clip)
    if left is None or right is None:
        raise gr.Error("Upload the left face and the right face.")
    if scene is None and not clip_path:
        raise gr.Error("Upload the scene picture of both people, or a video clip.")

    sess = Path(state.get("dir") or str(_session_dir()))
    sess.mkdir(parents=True, exist_ok=True)
    state["dir"] = str(sess)
    turbo = (swap_model or SWAP_TURBO) == SWAP_TURBO
    seed = -1 if swap_randomize else int(swap_seed or 0)
    prompt = (swap_prompt or "").strip() or runpod_faceswap.FACE_SWAP_PROMPT

    def swap_one(face: Image.Image, crop: Image.Image) -> Image.Image:
        def worker(on_progress):
            image, _meta = runpod_faceswap.face_swap(
                face,
                crop,
                base_model="turbo" if turbo else "base",
                resolution=int(swap_resolution or 1536),
                num_inference_steps=int(swap_steps),
                lora_scale=float(swap_lora),
                seed=seed,
                prompt=prompt,
                output_format="png",
                on_progress=on_progress,
            )
            return image

        return _pump_blocking(progress, "Swapping a face", worker, _faceswap_progress)

    try:
        if clip_path:
            progress(0.05, desc="Reading the clip…")
            frames, out_fps = dual_faces.read_sampled_frames(clip_path)
            jobs = len(frames) * 2

            def on_frame(index: int, total: int) -> None:
                progress(0.1 + 0.8 * (index / max(total, 1)), desc=f"Swapping frame {index + 1} of {total} ({jobs} jobs)…")

            swapped = dual_faces.swap_video_frames(frames, left, right, swap_one, on_frame=on_frame)
            clip_out = sess / f"two_faces_{uuid.uuid4().hex[:10]}.mp4"
            dual_faces.write_video(swapped, clip_out, out_fps)
            still_out = sess / f"two_faces_{uuid.uuid4().hex[:10]}.png"
            swapped[0].save(still_out)
            note = (
                f"Swapped both people on {len(swapped)} frames "
                f"({jobs} RunPod jobs, first {int(dual_faces.MAX_CLIP_SECONDS)}s at "
                f"{int(dual_faces.SAMPLE_FPS)} fps)."
            )
            still_path = _require_media_file(still_out, "Swapped picture")
            clip_path_out = _require_media_file(clip_out, "Swapped clip")
            if progress:
                progress(1.0, desc="Clip done")
            return still_path, clip_path_out, note, state

        progress(0.1, desc="Swapping the person on the left…")
        calls = {"n": 0}

        def counted(face: Image.Image, crop: Image.Image) -> Image.Image:
            calls["n"] += 1
            # Stay under 1.0 until files are on disk and ready to return.
            progress(
                min(0.9, 0.15 + 0.35 * calls["n"]),
                desc=f"Swapping person {calls['n']} of 2…",
            )
            return swap_one(face, crop)

        result, info = dual_faces.swap_two_faces(scene, left, right, counted)
    except Exception as exc:
        _raise_segment_error("Two-face swap", exc)

    still_out = sess / f"two_faces_{uuid.uuid4().hex[:10]}.png"
    result.save(still_out)
    state["swapped"] = str(still_out)
    how = "two detected faces" if info["method"] == "faces" else "the left half and the right half"
    note = f"Replaced both people using {how}."
    still_path = _require_media_file(still_out, "Swapped picture")
    if progress:
        progress(1.0, desc="Swap done")
    return still_path, None, note, state


def do_swap(
    reference_face,
    target_image,
    swap_model,
    swap_resolution,
    swap_steps,
    swap_lora,
    swap_seed,
    swap_randomize,
    swap_prompt,
    state: dict,
    progress=gr.Progress(track_tqdm=False),
    *,
    finalize_progress: bool = True,
):
    hf_auth.require_unlocked(state)
    ref = load_pil_image(reference_face)
    tgt = load_pil_image(target_image)
    if ref is None or tgt is None:
        raise gr.Error("Provide both a reference face and a target image.")

    sess = Path(state.get("dir") or str(_session_dir()))
    sess.mkdir(parents=True, exist_ok=True)
    state["dir"] = str(sess)

    turbo = (swap_model or SWAP_TURBO) == SWAP_TURBO
    seed = int(swap_seed)
    if swap_randomize:
        seed = -1

    # Always send the canonical head_swap prompt unless the user typed a non-empty override.
    prompt = (swap_prompt or "").strip() or runpod_faceswap.FACE_SWAP_PROMPT

    progress(0.05, desc="Starting face swap…")
    try:
        # Worker contract: reference_face = face to paste, target_image = body/scene to keep.
        def worker(on_progress):
            return runpod_faceswap.face_swap(
                ref,
                tgt,
                base_model="turbo" if turbo else "base",
                resolution=int(swap_resolution or 1536),
                num_inference_steps=int(swap_steps),
                lora_scale=float(swap_lora),
                seed=seed,
                prompt=prompt,
                output_format="png",
                on_progress=on_progress,
            )

        result, meta = _pump_blocking(progress, "Starting face swap", worker, _faceswap_progress)
    except Exception as e:
        _raise_segment_error("Face swap", e)

    # Unique filename so Gradio/browser do not reuse a cached swapped.png path.
    if progress:
        progress(0.9, desc="Writing swapped still…")
    saved = sess / f"swapped_{uuid.uuid4().hex[:10]}.png"
    result.save(saved)
    before = tgt.copy()
    after = result.copy()
    state["swapped"] = str(saved)
    state["swap_seed"] = meta.get("seed", seed)
    used_seed = state["swap_seed"]
    mad = _mean_abs_diff(before, after)
    note = status_line(state.get("segments") or [], 0.0)
    note = f"{note}  ·  swap Δ≈{mad:.1f}/255  ·  seed `{used_seed}`"
    if mad < 4.0:
        note += (
            "  \n⚠️ Result is almost identical to the **body/scene** photo. "
            "Check uploads: left = face to copy, right = body/scene to keep. "
            "Try Base model or raise BFS LoRA strength."
        )
    # File paths (not in-memory PILs): ImageSlider postprocess stays fast and reliable.
    if progress:
        progress(0.95 if finalize_progress else 0.4, desc="Preparing before/after preview…")
    try:
        slider = _slider_file_pair(before, after, sess)
        _require_media_file(slider[0], "Before preview")
        _require_media_file(slider[1], "After preview")
        _require_media_file(saved, "Swapped still")
    except gr.Error:
        raise
    except Exception as exc:
        raise gr.Error(f"Face swap finished but could not prepare the preview: {exc}") from exc
    if finalize_progress and progress:
        progress(1.0, desc="Swap done")
    elif progress:
        # "Run both" continues into I2V — do NOT paint 1.0 or the UI hangs at 100%.
        progress(0.42, desc="Swap done — starting video…")
    return slider, used_seed, note, state


def do_run_both(
    reference_face,
    target_image,
    swap_model,
    swap_resolution,
    swap_steps,
    swap_lora,
    swap_seed,
    swap_randomize,
    swap_prompt,
    prompt,
    seg_duration,
    steps,
    negative,
    seed,
    randomize,
    quality,
    fps,
    safe_mode,
    state: dict,
    progress=gr.Progress(track_tqdm=False),
):
    """Swap → still → Generate I2V → MP4."""
    hf_auth.require_unlocked(state)
    # Critical: do_swap must not paint progress(1.0) here. Default mode is
    # "Run both steps"; finishing the bar after swap left the UI at 100% for
    # the whole I2V wait, then the proxy timed out with no video.
    slider, used_seed, swap_status, state = do_swap(
        reference_face,
        target_image,
        swap_model,
        swap_resolution,
        swap_steps,
        swap_lora,
        swap_seed,
        swap_randomize,
        swap_prompt,
        state,
        progress=progress,
        finalize_progress=False,
    )
    swapped_path = state.get("swapped")
    if not swapped_path:
        raise gr.Error("Face swap finished but no still was saved for I2V.")
    if progress:
        progress(0.45, desc="Swap done — starting I2V generate…")
    video, download, status, last, state = do_generate(
        swapped_path,
        prompt,
        seg_duration,
        steps,
        negative,
        seed,
        randomize,
        quality,
        fps,
        safe_mode,
        state,
        progress=progress,
    )
    status = f"{status}  ·  {swap_status}"
    return video, download, status, last, slider, used_seed, state


def do_reset(state: dict):
    if state and state.get("dir"):
        try:
            shutil.rmtree(state["dir"], ignore_errors=True)
        except Exception:
            pass
    # video, download, status, last, slider, seed, state
    return None, None, status_line([], 0), None, None, None, {}


def update_estimate(seg_duration, num_planned):
    total = estimate_total(seg_duration, num_planned)
    return f"Planned length ≈ **{total:.1f}s** ({num_planned} × {seg_duration:.1f}s segments). Cap: 6 segments."


def toggle_custom_extend_image(mode: str):
    visible = (mode or "").strip() == EXTEND_START_UPLOAD
    return gr.update(visible=visible)


def on_swap_mode_change(base_model):
    if base_model == SWAP_TURBO:
        return gr.update(
            value=SWAP_DEFAULT_STEPS[SWAP_TURBO],
            info="Turbo: 6 is the validated schedule (clamped to 4–8).",
        )
    return gr.update(
        value=SWAP_DEFAULT_STEPS[SWAP_BASE],
        info="Base: ~30–50 Euler steps; 30 is a good trade-off.",
    )


def default_steps() -> int:
    """RunPod's usual setting is 10. ZeroGPU stays on the faster default of 4."""
    return 10 if runpod_i2v.active_backend() == "runpod" else 4


def _pwa_head_html() -> str:
    """Safari Add to Home Screen meta + icons (Gradio Blocks ``head=``)."""
    icon_path = STATIC_DIR / "apple-touch-icon.png"
    icon_href = f"{SPACE_ICON_BASE}/apple-touch-icon.png"
    if icon_path.is_file():
        b64 = base64.b64encode(icon_path.read_bytes()).decode("ascii")
        # Data URI works same-origin without waiting on HF CDN resolve.
        icon_href = f"data:image/png;base64,{b64}"
    manifest_href = f"{SPACE_ICON_BASE}/manifest.webmanifest"
    return f"""
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Face Swap Extend">
<meta name="application-name" content="Face Swap Extend">
<meta name="theme-color" content="#4f46e5">
<link rel="apple-touch-icon" sizes="180x180" href="{icon_href}">
<link rel="icon" type="image/png" sizes="192x192" href="{SPACE_ICON_BASE}/icon-192.png">
<link rel="manifest" href="{manifest_href}">
"""


def intro_markdown() -> str:
    home_tip = (
        f"**iPhone home screen:** open [{SPACE_DIRECT_URL}]({SPACE_DIRECT_URL}) in **Safari** "
        "(not the Hugging Face app) → Share → **Add to Home Screen**."
    )
    if runpod_i2v.active_backend() == "runpod":
        endpoint = runpod_i2v.endpoint_id()
        return f"""
# Face Swap + Extend
**SWAP A FACE · EXTEND IT INTO VIDEO**

This Space is **Public**. Enter the owner **password** below and tap **Unlock**
(no Gradio Login page — works on iPhone). Until unlocked, Swap / Extend cannot call RunPod.

{home_tip}

Pick a mode, then run on **RunPod** (not Hugging Face ZeroGPU):

- **Swap only** — BFS head-swap still (`face-swap-runpod-worker`)
- **Extend only** — Wan 2.2 image→video + Extend chaining on `{endpoint}`
- **Run both steps** — swap → still → generate/extend I2V → MP4

Set `RUNPOD_API_KEY`, `RUNPOD_FACESWAP_ENDPOINT_ID`, `RUNPOD_EXTEND_ENDPOINT_ID`, and
`SPACE_AUTH_PASSWORD`. Missing secrets raise a clear error — ZeroGPU is **not** used unless
you set `WAN_BACKEND=zerogpu`.
"""
    return f"""
# Face Swap + Extend
**SWAP A FACE · EXTEND IT INTO VIDEO**

Unlock with the owner password in-app — only then can jobs run.
{home_tip}
ZeroGPU fallback is on (`WAN_BACKEND=zerogpu` / `USE_ZERGPU=1`). Upstream: `{UPSTREAM_SPACE}`.
Face swap still requires RunPod (`RUNPOD_FACESWAP_ENDPOINT_ID`) — there is no ZeroGPU swap path in this app.
"""


def cold_start_note() -> str:
    if runpod_i2v.active_backend() != "runpod":
        return ""
    return (
        "> **First jobs may take several minutes** (cold start + model download). "
        "Both workers scale to zero when idle. Leave this tab open until the result appears."
    )


def limits_markdown() -> str:
    if runpod_i2v.active_backend() == "runpod":
        endpoint = runpod_i2v.endpoint_id()
        return f"""
### Pipeline
1. **Swap** — reference face + target → swapped still (BFS / Qwen-Image-2.1).
2. **Generate** — still + motion prompt → short Wan 2.2 I2V MP4 via `{endpoint}`.
3. **Extend / Auto-extend** — chain from last frame (or custom still); soft cap **6 segments**.

### Env
| Variable | Purpose |
| --- | --- |
| `RUNPOD_API_KEY` | Shared Bearer token |
| `RUNPOD_FACESWAP_ENDPOINT_ID` | BFS worker endpoint (required for swap / both) |
| `RUNPOD_EXTEND_ENDPOINT_ID` | Wan I2V endpoint (required for extend / both); legacy `RUNPOD_ENDPOINT_ID` also accepted |
| `SPACE_AUTH_PASSWORD` | In-app Unlock password (required; blocks anonymous RunPod use) |
| `WAN_BACKEND=zerogpu` | Optional ZeroGPU I2V fallback only |

Every segment / swap can take several minutes on cold start + model download.
Deploy endpoints separately — this Space does not create or bill RunPod resources.
"""
    return f"""
### Limits
- I2V fallback: ZeroGPU Space `{UPSTREAM_SPACE}`.
- Face swap always needs RunPod `RUNPOD_FACESWAP_ENDPOINT_ID`.
"""


def mode_visibility(mode: str):
    """Show/hide swap vs extend panels for the selected product mode."""
    mode = (mode or MODE_BOTH).strip()
    show_swap = mode in (MODE_SWAP, MODE_BOTH)
    show_extend = mode in (MODE_EXTEND, MODE_BOTH)
    show_both_btn = mode == MODE_BOTH
    show_swap_btn = mode == MODE_SWAP
    show_extend_btns = mode == MODE_EXTEND
    # When "both", still allow manual extend after the first generate.
    show_extend_followup = mode in (MODE_EXTEND, MODE_BOTH)
    return (
        gr.update(visible=show_swap),
        gr.update(visible=show_extend),
        gr.update(visible=show_swap_btn),
        gr.update(visible=show_both_btn),
        gr.update(visible=show_extend_btns or show_extend_followup),
        gr.update(visible=show_extend_followup),
        gr.update(visible=show_extend_followup),
    )


CSS = """
.big-btn button { font-size: 1.15rem !important; min-height: 3rem !important; }
#status-md { font-size: 1rem; }
#brand-sub { letter-spacing: 0.08em; opacity: 0.85; }
footer { display: none !important; }
"""



def do_unlock(password: str, buffered: str, state: dict):
    """In-app password unlock (no Gradio Login / HTTP basic auth).

    Mobile Safari often submits an empty ``type=password`` Textbox on button
    tap. Prefer the visible text field value, fall back to a buffered copy
    synced on every keystroke, and never raise ``gr.Error`` on a wrong guess
    (that clears inputs on some mobile Gradio builds).
    """
    state = dict(state or {})
    # Sticky: already unlocked this session — keep app open even if field empty.
    if state.get("unlocked"):
        return (
            gr.update(visible=False),
            gr.update(visible=True),
            "✅ Already unlocked — Swap / Extend are ready.",
            state,
            gr.update(),
            buffered or "",
        )

    candidate = (password or "").strip() or (buffered or "").strip()
    if not candidate:
        state["unlocked"] = False
        return (
            gr.update(visible=True),
            gr.update(visible=False),
            "⚠️ Password was empty when Unlock ran (common on iPhone). "
            "Type it again in the box (characters are visible), then Unlock.",
            state,
            gr.update(),
            buffered or "",
        )
    if not hf_auth.check_password(candidate):
        state["unlocked"] = False
        return (
            gr.update(visible=True),
            gr.update(visible=False),
            f"❌ Wrong password ({len(candidate)} characters). Expected the Space unlock password — try again.",
            state,
            gr.update(),  # do not clear the textbox
            buffered or "",
        )
    state["unlocked"] = True
    return (
        gr.update(visible=False),
        gr.update(visible=True),
        "✅ Unlocked — Swap / Extend are ready.",
        state,
        gr.update(value=""),
        "",
    )


def _buffer_password(password: str) -> str:
    """Keep a keystroke buffer so Unlock still sees the value on flaky mobile submits."""
    return password or ""


def build_ui():
    runpod = runpod_i2v.active_backend() == "runpod"
    with gr.Blocks(
        title="Face Swap + Extend",
        css=CSS,
        theme=gr.themes.Soft(),
        head=_pwa_head_html(),
    ) as demo:
        gr.Markdown(intro_markdown())
        gr.Markdown(hf_auth.auth_help_markdown())
        gr.Markdown("<p id='brand-sub'>SWAP A FACE · EXTEND IT INTO VIDEO</p>")
        state = gr.State({})

        with gr.Group(visible=True) as lock_panel:
            # type=text (not password): iPhone Safari + Gradio often submit empty
            # values from type=password on button tap.
            unlock_password = gr.Textbox(
                label="Space password",
                type="text",
                placeholder="Type password here (visible), then Unlock",
                autofocus=True,
                elem_id="space-unlock-password",
            )
            pwd_buffer = gr.State("")
            btn_unlock = gr.Button("Unlock", variant="primary", elem_id="space-unlock-btn")
            unlock_status = gr.Markdown(
                "🔒 Locked — type the password (you will see the characters), then tap **Unlock**."
            )

        with gr.Group(visible=False) as app_panel:
            mode = gr.Radio(
                choices=MODES,
                value=MODE_BOTH,
                label="Mode",
                info="Swap only · Extend only · Run both steps (swap → I2V).",
            )

            with gr.Row():
                with gr.Column(scale=1):
                    with gr.Group(visible=True) as swap_panel:
                        gr.Markdown(
                            "### Face swap\n"
                            "**Left = face to copy** (identity / head). "
                            "**Right = body / scene to keep** (pose, clothes, background). "
                            "Drag the After slider to compare original body vs swapped result."
                        )
                        with gr.Row():
                            reference_face = gr.Image(
                                label="① Face to copy (identity)",
                                type="pil",
                                height=240,
                            )
                            target_image = gr.Image(
                                label="② Body / scene to keep",
                                type="pil",
                                height=240,
                            )
                        swap_model = gr.Radio(
                            SWAP_MODES,
                            value=SWAP_TURBO,
                            label="Swap model",
                        )
                        with gr.Accordion("Swap advanced", open=False):
                            swap_resolution = gr.Dropdown(
                                SWAP_RESOLUTIONS,
                                value=1536,
                                label="Resolution",
                            )
                            swap_steps = gr.Slider(
                                4,
                                50,
                                value=SWAP_DEFAULT_STEPS[SWAP_TURBO],
                                step=1,
                                label="Swap inference steps",
                            )
                            swap_lora = gr.Slider(
                                0.0,
                                1.5,
                                value=1.0,
                                step=0.05,
                                label="BFS LoRA strength",
                            )
                            with gr.Row():
                                swap_seed = gr.Number(value=0, label="Swap seed", precision=0)
                                swap_randomize = gr.Checkbox(value=True, label="Randomize swap seed")
                            swap_prompt = gr.Textbox(
                                label="Swap prompt",
                                value=runpod_faceswap.FACE_SWAP_PROMPT,
                                lines=3,
                                info=(
                                    "BFS mapping: <image1> = body/scene (right upload), "
                                    "<image2> = face to copy (left upload)."
                                ),
                            )
                            gr.Markdown(
                                "### Two people\n"
                                "**Left face** replaces the person on the left of the scene. "
                                "**Right face** replaces the person on the right. "
                                "The middle upload is the picture of both people. "
                                "Or upload a short video clip instead of that picture "
                                f"(first {int(dual_faces.MAX_CLIP_SECONDS)} seconds, "
                                f"{int(dual_faces.SAMPLE_FPS)} frames per second, two swaps on each frame)."
                            )
                            with gr.Row():
                                left_face = gr.Image(label="Left face", type="pil", height=200)
                                scene_two = gr.Image(
                                    label="Scene — both people",
                                    type="pil",
                                    height=200,
                                )
                                right_face = gr.Image(label="Right face", type="pil", height=200)
                            clip_two = gr.Video(
                                label="Or a video clip of both people",
                                sources=["upload"],
                                height=180,
                            )
                            btn_two = gr.Button("Swap both faces", variant="primary", size="lg")
                            two_note = gr.Markdown()
                            two_still = gr.Image(label="Swapped picture", type="filepath", height=280)
                            two_clip = gr.Video(label="Swapped clip", height=280)

                    with gr.Group(visible=True) as extend_panel:
                        gr.Markdown("### Extend / I2V")
                        still_image = gr.Image(
                            label="Still image (Extend-only Generate start)",
                            type="pil",
                            height=240,
                        )
                        prompt = gr.Textbox(
                            label="Generate prompt",
                            value=DEFAULT_PROMPT,
                            lines=3,
                            placeholder="Describe the motion you want…",
                        )

                        with gr.Accordion("Extend options", open=True):
                            extend_prompt = gr.Textbox(
                                label="Extend prompt",
                                value="",
                                lines=3,
                                placeholder="Leave blank to reuse Generate prompt",
                                info="Optional. Used only for Extend / Auto-extend.",
                            )
                            extend_start = gr.Radio(
                                choices=[EXTEND_START_LAST_FRAME, EXTEND_START_UPLOAD],
                                value=EXTEND_START_LAST_FRAME,
                                label="Extend start",
                            )
                            custom_extend_image = gr.Image(
                                label="Custom extend start image",
                                type="pil",
                                height=200,
                                visible=False,
                            )

                        with gr.Row():
                            seg_duration = gr.Slider(
                                2.0,
                                5.0,
                                value=3.5,
                                step=0.5,
                                label="Segment length (seconds)",
                            )
                            num_planned = gr.Slider(
                                1,
                                6,
                                value=4,
                                step=1,
                                label="Target segments",
                                info="Estimate only.",
                            )
                        estimate = gr.Markdown(update_estimate(3.5, 4))
                        target_seconds = gr.Slider(
                            8,
                            22,
                            value=14,
                            step=1,
                            label="Auto-extend target (seconds)",
                        )

                        with gr.Accordion("I2V advanced", open=False):
                            steps = gr.Slider(
                                1,
                                12,
                                value=default_steps(),
                                step=1,
                                label="I2V inference steps",
                                info=(
                                    "Sent to RunPod. 10 is the usual setting."
                                    if runpod
                                    else None
                                ),
                            )
                            quality = gr.Slider(
                                1,
                                10,
                                value=6,
                                step=1,
                                label="Video quality",
                                info="ZeroGPU fallback only." if runpod else None,
                            )
                            fps = gr.Dropdown(
                                choices=[16, 32, 64],
                                value=16,
                                label="Fluidity FPS",
                                info="ZeroGPU only. RunPod is 16 fps." if runpod else None,
                            )
                            seed = gr.Number(value=42, label="I2V seed", precision=0)
                            randomize = gr.Checkbox(value=True, label="Randomize I2V seed")
                            safe_mode = gr.Checkbox(
                                value=True,
                                label="Upstream Safe Mode",
                                info="ZeroGPU fallback only." if runpod else None,
                            )
                            negative = gr.Textbox(
                                label="Negative prompt",
                                value=DEFAULT_NEGATIVE,
                                lines=2,
                            )

                    cold_note = cold_start_note()
                    if cold_note:
                        gr.Markdown(cold_note)

                    with gr.Row(elem_classes=["big-btn"]):
                        btn_swap = gr.Button("Swap face", variant="primary", size="lg", visible=False)
                        btn_both = gr.Button(
                            "Run both steps", variant="primary", size="lg", visible=True
                        )
                    with gr.Row(elem_classes=["big-btn"]):
                        btn_gen = gr.Button("Generate", variant="primary", size="lg", visible=False)
                        btn_ext = gr.Button("Extend", variant="secondary", size="lg", visible=True)
                    with gr.Row(elem_classes=["big-btn"]):
                        btn_auto = gr.Button("Auto-extend to target", size="lg", visible=True)
                        btn_reset = gr.Button("Reset", size="lg")

                with gr.Column(scale=1):
                    comparison_slider = gr.ImageSlider(
                        label="Before / After — drag to compare (left=original body, right=swapped)",
                        type="filepath",
                        format="png",
                        slider_position=50,
                        height=360,
                        interactive=False,
                    )
                    swap_seed_out = gr.Number(label="Swap seed used", interactive=False)
                    video = gr.Video(label="Preview MP4", height=320, autoplay=True)
                    status = gr.Markdown(status_line([], 0), elem_id="status-md")
                    last_preview = gr.Image(label="Last frame (next Extend start)", height=160)
                    download = gr.File(label="Download MP4")

            seg_duration.change(update_estimate, [seg_duration, num_planned], estimate)
            num_planned.change(update_estimate, [seg_duration, num_planned], estimate)
            extend_start.change(toggle_custom_extend_image, [extend_start], [custom_extend_image])
            swap_model.change(on_swap_mode_change, inputs=swap_model, outputs=swap_steps)
            mode.change(
                mode_visibility,
                inputs=[mode],
                outputs=[
                    swap_panel,
                    extend_panel,
                    btn_swap,
                    btn_both,
                    btn_gen,
                    btn_ext,
                    btn_auto,
                ],
            )

            gen_inputs = [
                still_image,
                prompt,
                seg_duration,
                steps,
                negative,
                seed,
                randomize,
                quality,
                fps,
                safe_mode,
                state,
            ]
            ext_inputs = [
                prompt,
                extend_prompt,
                extend_start,
                custom_extend_image,
                seg_duration,
                steps,
                negative,
                seed,
                randomize,
                quality,
                fps,
                safe_mode,
                state,
            ]
            swap_inputs = [
                reference_face,
                target_image,
                swap_model,
                swap_resolution,
                swap_steps,
                swap_lora,
                swap_seed,
                swap_randomize,
                swap_prompt,
                state,
            ]
            both_inputs = swap_inputs[:-1] + [
                prompt,
                seg_duration,
                steps,
                negative,
                seed,
                randomize,
                quality,
                fps,
                safe_mode,
                state,
            ]
            video_outs = [video, download, status, last_preview, state]
            # do_swap → (slider_tuple, saved_path, seed, status, state); path is kept in state only
            swap_outs = [comparison_slider, swap_seed_out, status, state]
            both_outs = [
                video,
                download,
                status,
                last_preview,
                comparison_slider,
                swap_seed_out,
                state,
            ]
            reset_outs = [
                video,
                download,
                status,
                last_preview,
                comparison_slider,
                swap_seed_out,
                state,
            ]

            btn_swap.click(do_swap, swap_inputs, swap_outs)
            btn_two.click(
                do_two_swap,
                [
                    left_face,
                    scene_two,
                    right_face,
                    clip_two,
                    swap_model,
                    swap_resolution,
                    swap_steps,
                    swap_lora,
                    swap_seed,
                    swap_randomize,
                    swap_prompt,
                    state,
                ],
                [two_still, two_clip, two_note, state],
            )
            btn_both.click(do_run_both, both_inputs, both_outs)
            btn_gen.click(do_generate, gen_inputs, video_outs)
            btn_ext.click(do_extend, ext_inputs, video_outs)
            btn_auto.click(do_auto_extend, [target_seconds] + ext_inputs, video_outs)
            btn_reset.click(do_reset, [state], reset_outs)

            # Apply initial mode visibility (Both).
            demo.load(
                lambda: mode_visibility(MODE_BOTH),
                inputs=None,
                outputs=[
                    swap_panel,
                    extend_panel,
                    btn_swap,
                    btn_both,
                    btn_gen,
                    btn_ext,
                    btn_auto,
                ],
            )

            gr.Markdown(limits_markdown())

        unlock_password.change(
            _buffer_password,
            inputs=[unlock_password],
            outputs=[pwd_buffer],
        )
        unlock_password.input(
            _buffer_password,
            inputs=[unlock_password],
            outputs=[pwd_buffer],
        )
        unlock_outs = [lock_panel, app_panel, unlock_status, state, unlock_password, pwd_buffer]
        btn_unlock.click(
            do_unlock,
            inputs=[unlock_password, pwd_buffer, state],
            outputs=unlock_outs,
        )
        unlock_password.submit(
            do_unlock,
            inputs=[unlock_password, pwd_buffer, state],
            outputs=unlock_outs,
        )

    return demo


if __name__ == "__main__":
    # No launch(auth=...) — Gradio Login chrome fails on iPhone / Spaces proxy.
    # In-app password Unlock gates RunPod instead.
    demo = build_ui()
    hf_auth.require_password_configured()
    # WORK lives under tempfile and is usually allowed already; list it explicitly
    # so preview/download paths never fail Gradio's file-access check after 1.0.
    allowed = [str(WORK)]
    if STATIC_DIR.is_dir():
        allowed.append(str(STATIC_DIR))
    demo.queue(default_concurrency_limit=1).launch(
        server_name="0.0.0.0",
        server_port=7860,
        share=False,
        ssr_mode=False,
        show_api=False,
        allowed_paths=allowed,
    )
