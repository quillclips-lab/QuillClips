import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 18, ...rest }: P) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...rest,
  };
}

export const IconPanel = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="8" height="10" rx="2" />
    <rect x="13" y="3" width="8" height="6" rx="2" />
    <rect x="13" y="11" width="8" height="10" rx="2" />
    <rect x="3" y="15" width="8" height="6" rx="2" />
  </svg>
);
export const IconProduce = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="5" width="13" height="14" rx="2.5" />
    <path d="M16 10l5-3v10l-5-3" />
  </svg>
);
export const IconInventory = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="9" rx="1.5" />
    <rect x="3" y="15" width="7" height="6" rx="1.5" />
    <rect x="14" y="15" width="7" height="6" rx="1.5" />
  </svg>
);
export const IconUsers = (p: P) => (
  <svg {...base(p)}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" />
    <path d="M16 4.5a3.5 3.5 0 010 7M18.5 14.8c1.6.8 2.6 2.6 3 5.2" />
  </svg>
);
export const IconCampaign = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 10v4a1 1 0 001 1h2l5 4V5L7 9H5a1 1 0 00-1 1z" />
    <path d="M16 8.5a5 5 0 010 7M18.8 6a8.5 8.5 0 010 12" />
  </svg>
);
export const IconDrive = (p: P) => (
  <svg {...base(p)}>
    <path d="M8.5 3.5h7L22 15l-3.5 6h-13L2 15z" />
    <path d="M8.5 3.5L15 15H2M15.5 3.5L9 15M5.5 21L12 9.5" />
  </svg>
);
export const IconFilm = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 4v16M17 4v16M3 9h4M17 9h4M3 15h4M17 15h4" />
  </svg>
);
export const IconSettings = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z" />
  </svg>
);
export const IconUpload = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 16V4M7 9l5-5 5 5" />
    <path d="M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3" />
  </svg>
);
export const IconCopy = (p: P) => (
  <svg {...base(p)}>
    <rect x="8" y="8" width="12" height="12" rx="2.5" />
    <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" />
  </svg>
);
export const IconCheck = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
export const IconDownload = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 4v12M7 11l5 5 5-5" />
    <path d="M4 20h16" />
  </svg>
);
export const IconRefresh = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" />
  </svg>
);
export const IconSpark = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    <path d="M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z" />
  </svg>
);
export const IconTrash = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </svg>
);
export const IconPlus = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const IconX = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const IconSearch = (p: P) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.2-4.2" />
  </svg>
);
export const IconPlay = (p: P) => (
  <svg {...base(p)}>
    <path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none" />
  </svg>
);
export const IconChevron = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);
export const IconLink = (p: P) => (
  <svg {...base(p)}>
    <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />
  </svg>
);
export const IconPause = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 5v14M15 5v14" />
  </svg>
);

/* ---------------------------------------------------------------- platform marks */

export function PlatformIcon({ platform, size = 16 }: { platform: string; size?: number }) {
  const s = { width: size, height: size };
  switch (platform) {
    case "youtube":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <rect x="1.5" y="5" width="21" height="14" rx="4.5" fill="#ff0033" />
          <path d="M10 9v6l5.2-3z" fill="#fff" />
        </svg>
      );
    case "tiktok":
      return (
        <svg viewBox="0 0 24 24" style={s} fill="none">
          <path d="M14 3v11.2a3.3 3.3 0 11-3.3-3.3" stroke="#25f4ee" strokeWidth="2.2" transform="translate(-.6 -.4)" />
          <path d="M14 3v11.2a3.3 3.3 0 11-3.3-3.3" stroke="#fe2c55" strokeWidth="2.2" transform="translate(.6 .4)" />
          <path d="M14 3v11.2a3.3 3.3 0 11-3.3-3.3M14 3c.4 2.6 2 4.2 4.6 4.5" stroke="#fff" strokeWidth="2.2" />
        </svg>
      );
    case "instagram":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <defs>
            <linearGradient id="ig" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#feda75" />
              <stop offset=".35" stopColor="#fa7e1e" />
              <stop offset=".6" stopColor="#d62976" />
              <stop offset="1" stopColor="#4f5bd5" />
            </linearGradient>
          </defs>
          <rect x="2" y="2" width="20" height="20" rx="6" fill="url(#ig)" />
          <rect x="6" y="6" width="12" height="12" rx="3.6" fill="none" stroke="#fff" strokeWidth="1.8" />
          <circle cx="12" cy="12" r="2.9" fill="none" stroke="#fff" strokeWidth="1.8" />
          <circle cx="16.3" cy="7.7" r=".9" fill="#fff" />
        </svg>
      );
    case "kick":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <rect x="2" y="2" width="20" height="20" rx="5" fill="#53fc18" />
          <path d="M7 6.5h3v4l3.5-4H17l-4.2 5.5L17 17.5h-3.5L10 13.5v4H7z" fill="#000" />
        </svg>
      );
    case "twitch":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <rect x="2" y="2" width="20" height="20" rx="5" fill="#9146ff" />
          <path d="M7 5.5h11v7.5l-3 3h-2.5L10.5 18v-2H7z" fill="#fff" />
          <path d="M11 8.5v3.5M14.5 8.5v3.5" stroke="#9146ff" strokeWidth="1.5" />
        </svg>
      );
    case "x":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <rect x="2" y="2" width="20" height="20" rx="5" fill="#000" stroke="#333" />
          <path d="M7 6.5h3l7 11h-3zM16.6 6.5L7.4 17.5" stroke="#fff" strokeWidth="1.5" fill="none" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <rect x="2" y="2" width="20" height="20" rx="5" fill="#985cff" />
          <rect x="10" y="5.5" width="4" height="8" rx="2" fill="#fff" />
          <path d="M7.5 11.5a4.5 4.5 0 009 0M12 16v2.5M9.5 18.5h5" stroke="#fff" strokeWidth="1.4" fill="none" />
        </svg>
      );
  }
}
