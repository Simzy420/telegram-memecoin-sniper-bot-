export const WAN_SPACE_ID = 'kulkas2pintu/wan222';
export const WAN_SPACE_ORIGIN = 'https://kulkas2pintu-wan222.hf.space';
export const WAN_SPACE_PAGE = 'https://huggingface.co/spaces/kulkas2pintu/wan222';
export const WAN_EMBED_URL = `${WAN_SPACE_ORIGIN}/?embed=true`;
export const WAN_API_NAME = 'generate_video';
export const WAN_CALL_PATH = `/gradio_api/call/${WAN_API_NAME}`;

export const WAN_DEFAULT_PROMPT = 'make this image come alive, cinematic motion, smooth animation';

/** Space default — copy verbatim so results match the hosted UI. */
export const WAN_DEFAULT_NEGATIVE =
  '色调艳丽, 过曝, 静态, 细节模糊不清, 字幕, 风格, 作品, 画作, 画面, 静止, 整体发灰, 最差质量, 低质量, JPEG压缩残留, 丑陋的, 残缺的, 多余的手指, 画得不好的手部, 画得不好的脸部, 畸形的, 毁容的, 形态畸形的肢体, 手指融合, 静止不动的画面, 杂乱的背景, 三条腿, 背景人很多, 倒着走';

export const WAN_DEFAULT_STEPS = 4;
export const WAN_DEFAULT_DURATION = 3.5;
export const WAN_DEFAULT_GUIDANCE = 1;
export const WAN_DEFAULT_GUIDANCE_2 = 1;
export const WAN_DEFAULT_SEED = 42;
export const WAN_DEFAULT_RANDOMIZE = true;
export const WAN_DEFAULT_QUALITY = 6;
export const WAN_DEFAULT_SCHEDULER = 'UniPCMultistep';
export const WAN_DEFAULT_FLOW_SHIFT = 3;
export const WAN_DEFAULT_FPS = 16;
export const WAN_DEFAULT_VIDEO_COMPONENT = true;
export const WAN_DEFAULT_SAFE_MODE = true;

export const WAN_FPS_CHOICES = [16, 32, 64, 128] as const;
export type WanFps = (typeof WAN_FPS_CHOICES)[number];

export const WAN_SCHEDULERS = [
  'FlowMatchEulerDiscrete',
  'SASolver',
  'DEISMultistep',
  'DPMSolverMultistepInverse',
  'UniPCMultistep',
  'DPMSolverMultistep',
  'DPMSolverSinglestep',
] as const;
export type WanScheduler = (typeof WAN_SCHEDULERS)[number];

/** ZeroGPU often takes 1–3 minutes; keep a buffer before we give up. */
export const WAN_TIMEOUT_MS = 270_000;
