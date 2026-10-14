import type { WidgetDefinition } from './types';
import { ChatWidget } from '@/components/widgets/ChatWidget';
import { FilesWidget } from '@/components/widgets/FilesWidget';
import { TodoWidget } from '@/components/widgets/TodoWidget';
import { LinksWidget } from '@/components/widgets/LinksWidget';
import { ImageGenWidget } from '@/components/widgets/ImageGenWidget';
import { GalleryWidget } from '@/components/widgets/GalleryWidget';
import { WatchlistWidget } from '@/components/widgets/WatchlistWidget';
import { RobinhoodWidget } from '@/components/widgets/RobinhoodWidget';
import { ComputeWidget } from '@/components/widgets/ComputeWidget';
import { TradingStubWidget } from '@/components/widgets/PlaceholderWidgets';
import { GmailWidget } from '@/components/widgets/GmailWidget';
import { GameWidget, GAME_TITLE, GAME_TITLE_STYLE } from '@/components/widgets/GameWidget';
import { DriveWidget } from '@/components/widgets/DriveWidget';
import { GMAIL_TITLE_STYLE } from '@/adapters/gmail/policy';
import { DRIVE_TITLE_STYLE } from '@/adapters/drive/policy';
import type { FeatureFlags } from '@/store/sessionStore';

const registry = new Map<string, WidgetDefinition>();

export function registerWidget(def: WidgetDefinition): void {
  registry.set(def.type, def);
}

export function getWidget(type: string): WidgetDefinition | undefined {
  return registry.get(type);
}

export function listWidgets(flags?: FeatureFlags): WidgetDefinition[] {
  return [...registry.values()].filter((w) => !w.featureFlag || flags?.[w.featureFlag]);
}

registerWidget({
  type: 'chat',
  title: 'Multi-bot chat',
  description: 'Talk to Chief of Staff (real bridge) or other bots, separate threads.',
  icon: 'message',
  defaultSize: { w: 12, h: 8 },
  minSize: { w: 4, h: 4 },
  defaultSettings: { selectedBotIds: ['chief'] },
  component: ChatWidget,
});

registerWidget({
  type: 'files',
  title: 'Files',
  description: 'Open, save, and send files kept on this device. Nothing is uploaded.',
  icon: 'files',
  defaultSize: { w: 6, h: 7 },
  minSize: { w: 3, h: 4 },
  component: FilesWidget,
});

registerWidget({
  type: 'todo',
  title: 'To-do',
  description: 'Checkable list, persisted locally.',
  icon: 'todo',
  defaultSize: { w: 6, h: 6 },
  minSize: { w: 3, h: 4 },
  component: TodoWidget,
});

registerWidget({
  type: 'links',
  title: 'Links',
  description: 'Tile launcher. Opens in a new tab — no iframes.',
  icon: 'links',
  defaultSize: { w: 6, h: 5 },
  minSize: { w: 3, h: 3 },
  component: LinksWidget,
});

registerWidget({
  type: 'imagegen',
  title: 'Image generator',
  description: 'Stills (OpenAI / Pollinations) or Wan 2.2 image-to-video on Hugging Face.',
  icon: 'image',
  defaultSize: { w: 6, h: 12 },
  minSize: { w: 3, h: 5 },
  component: ImageGenWidget,
});

registerWidget({
  type: 'gallery',
  title: 'Photo gallery',
  description: 'Pick as many photos and videos as you want. Saved on this device.',
  icon: 'image',
  defaultSize: { w: 12, h: 10 },
  minSize: { w: 3, h: 5 },
  component: GalleryWidget,
});

registerWidget({
  type: 'watchlist',
  title: 'Watchlist',
  description: 'Live CoinGecko USD price and 24h change. No candles.',
  icon: 'watch',
  defaultSize: { w: 6, h: 6 },
  minSize: { w: 3, h: 4 },
  component: WatchlistWidget,
});

registerWidget({
  type: 'robinhood',
  title: 'Robinhood',
  description: 'Individual brokerage total and equity positions from the snapshot bridge. No orders.',
  icon: 'brokerage',
  defaultSize: { w: 12, h: 10 },
  minSize: { w: 4, h: 6 },
  component: RobinhoodWidget,
});

registerWidget({
  type: 'compute',
  title: 'Compute Balance',
  description: 'Live Virtuals compute remaining — agent LLM inference budget. Tap refresh to update.',
  icon: 'trade',
  defaultSize: { w: 6, h: 6 },
  minSize: { w: 3, h: 4 },
  component: ComputeWidget,
});

registerWidget({
  type: 'game',
  title: GAME_TITLE,
  description: 'Opens the Claude artifact game in a new tab.',
  icon: 'links',
  defaultSize: { w: 6, h: 5 },
  minSize: { w: 3, h: 3 },
  titleStyle: GAME_TITLE_STYLE,
  component: GameWidget,
});

registerWidget({
  type: 'drive',
  title: 'Google Drive',
  description: 'Open, save, and send files in caseylsims@gmail.com. Separate from files kept on this device.',
  icon: 'files',
  defaultSize: { w: 6, h: 8 },
  minSize: { w: 3, h: 5 },
  titleStyle: DRIVE_TITLE_STYLE,
  privateApp: true,
  component: DriveWidget,
});

registerWidget({
  type: 'gmail',
  title: 'Gmail',
  description: 'Newest 25 messages in caseylsims@gmail.com. Read a message or send from the private mail server.',
  icon: 'mail',
  defaultSize: { w: 12, h: 10 },
  minSize: { w: 4, h: 6 },
  titleStyle: GMAIL_TITLE_STYLE,
  privateApp: true,
  component: GmailWidget,
});

registerWidget({
  type: 'trading',
  title: 'Trading stub',
  description: 'Feature-flagged empty pane. No live orders.',
  icon: 'trade',
  defaultSize: { w: 6, h: 6 },
  minSize: { w: 3, h: 4 },
  featureFlag: 'tradingStub',
  component: TradingStubWidget,
});

export type { WidgetDefinition, WidgetRenderProps } from './types';
