import type { ComponentType } from 'react';
import { ChevronLeft, X } from 'lucide-react';

export const AI_TOOLS_LABEL = 'AI Tools';

type AiTool = {
  name: string;
  href: string;
  Icon: ComponentType;
};

function BrandTile({ bg, mark, markFill = '#ffffff' }: { bg: string; mark: string; markFill?: string }) {
  return (
    <svg viewBox="0 0 48 48" className="h-10 w-10 shrink-0" aria-hidden>
      <rect width="48" height="48" rx="12" fill={bg} />
      <g transform="translate(10 10) scale(1.1667)">
        <path fill={markFill} d={mark} />
      </g>
    </svg>
  );
}

const CHATGPT_MARK =
  'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z';

const CURSOR_MARK =
  'M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23';

const LINEAR_MARK =
  'M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z';

const REPLIT_MARK =
  'M2 1.5A1.5 1.5 0 0 1 3.5 0h7A1.5 1.5 0 0 1 12 1.5V8H3.5A1.5 1.5 0 0 1 2 6.5ZM12 8h8.5A1.5 1.5 0 0 1 22 9.5v5a1.5 1.5 0 0 1-1.5 1.5H12ZM2 17.5A1.5 1.5 0 0 1 3.5 16H12v6.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 2 22.5Z';

const PERPLEXITY_MARK =
  'M22.3977 7.0896h-2.3106V.0676l-7.5094 6.3542V.1577h-1.1554v6.1966L4.4904 0v7.0896H1.6023v10.3976h2.8882V24l6.932-6.3591v6.2005h1.1554v-6.0469l6.9318 6.1807v-6.4879h2.8882V7.0896zm-3.4657-4.531v4.531h-5.355l5.355-4.531zm-13.2862.0676 4.8691 4.4634H5.6458V2.6262zM2.7576 16.332V8.245h7.8476l-6.1149 6.1147v1.9723H2.7576zm2.8882 5.0404v-3.8852h.0001v-2.6488l5.7763-5.7764v7.0111l-5.7764 5.2993zm12.7086.0248-5.7766-5.1509V9.0618l5.7766 5.7766v6.5588zm2.8882-5.0652h-1.733v-1.9723L13.3948 8.245h7.8478v8.087z';

function ChatGptIcon() {
  return <BrandTile bg="#111111" mark={CHATGPT_MARK} />;
}

function Base44Icon() {
  return (
    <svg viewBox="0 0 48 48" className="h-10 w-10 shrink-0" aria-hidden>
      <rect width="48" height="48" rx="12" fill="#FF6A14" />
      <rect x="11" y="14" width="26" height="9" rx="4.5" fill="#1a120c" />
      <rect x="16" y="26" width="16" height="7" rx="3.5" fill="#1a120c" />
    </svg>
  );
}

function CursorIcon() {
  return <BrandTile bg="#111111" mark={CURSOR_MARK} />;
}

function BufferIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-10 w-10 shrink-0" aria-hidden>
      <rect width="48" height="48" rx="12" fill="#1F4BFF" />
      <text
        x="24"
        y="25"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#ffffff"
        fontSize="26"
        fontWeight="700"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        B
      </text>
    </svg>
  );
}

function LinearIcon() {
  return <BrandTile bg="#141414" mark={LINEAR_MARK} markFill="#eceae6" />;
}

function ReplitIcon() {
  return <BrandTile bg="#111111" mark={REPLIT_MARK} markFill="#F26207" />;
}

function PerplexityIcon() {
  return <BrandTile bg="#111111" mark={PERPLEXITY_MARK} />;
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-10 w-10 shrink-0" aria-hidden>
      <rect width="48" height="48" rx="12" fill="#071910" />
      <path
        d="M15.5 14.5C22 18.2 27.2 21.2 32 24c-4.8 2.8-10 5.8-16.5 9.5"
        fill="none"
        stroke="#3DDC84"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const AI_TOOLS: readonly AiTool[] = [
  { name: 'ChatGPT', href: 'https://chatgpt.com', Icon: ChatGptIcon },
  { name: 'Base44', href: 'https://base44.com', Icon: Base44Icon },
  { name: 'Cursor', href: 'https://cursor.com', Icon: CursorIcon },
  { name: 'Buffer', href: 'https://buffer.com', Icon: BufferIcon },
  { name: 'Linear', href: 'https://linear.app', Icon: LinearIcon },
  { name: 'Replit', href: 'https://replit.com', Icon: ReplitIcon },
  { name: 'Perplexity', href: 'https://www.perplexity.ai', Icon: PerplexityIcon },
  { name: 'Link', href: 'https://apps.apple.com/app/id1623228342', Icon: LinkIcon },
];

const plainLabel = { textTransform: 'none' as const };

export function AiToolsMenuButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mb-5 flex min-h-12 w-full items-center rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-3 text-left text-base font-semibold text-white"
      style={plainLabel}
    >
      {AI_TOOLS_LABEL}
    </button>
  );
}

export function AiToolsPanel({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  return (
    <>
      <div className="mb-4 flex items-center gap-1">
        <button type="button" className="rounded-lg p-2 hover:bg-white/5" aria-label="Back" onClick={onBack}>
          <ChevronLeft className="h-5 w-5" />
        </button>
        <p className="text-base font-semibold text-white" style={plainLabel}>
          {AI_TOOLS_LABEL}
        </p>
        <button type="button" className="ml-auto rounded-lg p-2 hover:bg-white/5" aria-label="Close menu" onClick={onClose}>
          <X className="h-5 w-5" />
        </button>
      </div>
      <AiToolsList />
    </>
  );
}

export function AiToolsList() {
  return (
    <ul className="flex flex-col gap-2">
      {AI_TOOLS.map((tool) => (
        <li key={tool.href}>
          <a
            href={tool.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-12 items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2"
          >
            <tool.Icon />
            <span className="text-sm font-medium text-white" style={plainLabel}>
              {tool.name}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
