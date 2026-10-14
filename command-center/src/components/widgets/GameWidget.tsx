import { ExternalLink } from 'lucide-react';
import { WidgetFrame } from '@/components/shell/WidgetFrame';
import type { WidgetRenderProps } from '@/registry/types';

/** Exact Claude artifact the game lives on. The page requires a Claude login, so the game is not inlined here. */
export const GAME_ARTIFACT_URL =
  'https://claude.ai/code/artifact/e0be7c72-8356-45f3-a242-90e73c1ff645?org=ab3580a3-ad7b-4517-a457-271ef6ae591c';

export const GAME_TITLE = 'Game';

export const GAME_TITLE_STYLE = {
  fontFamily: 'Orbitron, sans-serif',
  textTransform: 'none' as const,
  fontWeight: 700,
};

export function GameWidget({ widget }: WidgetRenderProps) {
  return (
    <WidgetFrame widget={widget} title={GAME_TITLE} titleStyle={GAME_TITLE_STYLE} badge="OPEN">
      <div className="flex h-full min-h-0 flex-col justify-center gap-3">
        <p className="text-sm leading-snug text-white/70">
          Opens the game on Claude in a new tab. Claude may ask you to sign in.
        </p>
        <a
          href={GAME_ARTIFACT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hud-btn-primary widget-no-drag w-full gap-2 normal-case tracking-normal"
        >
          {GAME_TITLE}
          <ExternalLink className="h-4 w-4" aria-hidden />
        </a>
      </div>
    </WidgetFrame>
  );
}
