import type { ComponentType, CSSProperties } from 'react';
import type { FeatureFlags } from '@/store/sessionStore';
import type { WidgetInstance } from '@/types/layout';

export interface WidgetRenderProps {
  widget: WidgetInstance;
}

export interface WidgetDefinition {
  type: string;
  title: string;
  description: string;
  /** Dock / add-sheet glyph name */
  icon: 'message' | 'files' | 'todo' | 'links' | 'image' | 'watch' | 'mail' | 'trade' | 'brokerage';
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  defaultSettings?: Record<string, unknown>;
  /** Optional label face. Gmail uses a serif so the word is not set in the body font. */
  titleStyle?: CSSProperties;
  /** Hide from add-sheet unless this flag is on */
  featureFlag?: keyof FeatureFlags;
  /** Password-gated app. The + catalog lists it, but the instance belongs to the signed-in profile. */
  privateApp?: boolean;
  component: ComponentType<WidgetRenderProps>;
}
