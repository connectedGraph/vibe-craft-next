'use client';

import type { ReactNode } from 'react';

/**
 * 胶囊页的内联 SVG 图标。
 * 不依赖 CDN 图标字体：离线或被墙时界面不会出现「空按钮」。
 */
export type IconName =
  | 'logo'
  | 'menu'
  | 'plus'
  | 'search'
  | 'gear'
  | 'tag'
  | 'chevronDown'
  | 'upload'
  | 'download'
  | 'arrowLeft'
  | 'grid'
  | 'book'
  | 'highlighter'
  | 'pencil'
  | 'expand'
  | 'cornersIn'
  | 'fileText'
  | 'clock'
  | 'trash'
  | 'notebook'
  | 'x';

const ICONS: Record<IconName, ReactNode> = {
  logo: <path d="M7 3h10a2 2 0 0 1 2 2v16l-7-4-7 4V5a2 2 0 0 1 2-2z" fill="currentColor" stroke="none" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M16 16l4 4" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09A1.7 1.7 0 0 0 20.96 10H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
    </>
  ),
  tag: (
    <>
      <path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
      <circle cx="7.5" cy="7.5" r="1.2" />
    </>
  ),
  chevronDown: <path d="M6 9l6 6 6-6" />,
  upload: <path d="M12 16V4M8 8l4-4 4 4M4 16v3h16v-3" />,
  download: <path d="M12 4v12M8 12l4 4 4-4M4 16v3h16v-3" />,
  arrowLeft: <path d="M19 12H5M11 6l-6 6 6 6" />,
  grid: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.2" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2" />
    </>
  ),
  book: <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5zM20 18v3H6.5" />,
  highlighter: <path d="M9 14l6.5-6.5a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L12 17H8l1-3zM4 20h7" />,
  pencil: <path d="M4 20l4-1 11-11-3-3L5 16l-1 4zM14 5l3 3" />,
  expand: <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />,
  cornersIn: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
  fileText: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6z" />
      <path d="M14 3v6h6M8 13h8M8 17h5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
  notebook: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 3v18M13 8h4M13 12h4" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6L6 18" />,
};

export default function Icon({
  name,
  className = 'h-4 w-4',
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}
