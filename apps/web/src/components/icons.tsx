/**
 * Small line icons drawn for Tandem: one 16px grid, 1.5px stroke, round caps.
 * They inherit the text colour, so a control's colour is the icon's colour.
 */
type Name = "mark" | "more" | "settings" | "chevron" | "plus" | "pin" | "doc" | "pr" | "task";

export function Glyph({ name, size = 16, className }: { name: Name; size?: number; className?: string }) {
  const p = {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: `glyph${className ? ` ${className}` : ""}`,
    "aria-hidden": true,
  };
  switch (name) {
    case "mark":
      // Two strokes riding side by side.
      return (
        <svg {...p}>
          <path d="M2.5 11.5c2-4.5 4.2-7 7-7" />
          <path d="M6.5 13c2-4.5 4.2-7 7-7" />
        </svg>
      );
    case "more":
      return (
        <svg {...p} stroke="none" fill="currentColor">
          <circle cx="3.5" cy="8" r="1.25" />
          <circle cx="8" cy="8" r="1.25" />
          <circle cx="12.5" cy="8" r="1.25" />
        </svg>
      );
    case "settings":
      return (
        <svg {...p}>
          <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
          <circle cx="10" cy="4.5" r="1.5" />
          <circle cx="6" cy="11.5" r="1.5" />
        </svg>
      );
    case "chevron":
      return (
        <svg {...p}>
          <path d="M4.5 6.5 8 10l3.5-3.5" />
        </svg>
      );
    case "plus":
      return (
        <svg {...p}>
          <path d="M8 3.5v9M3.5 8h9" />
        </svg>
      );
    case "pin":
      // A note pinned for everyone: a flag on a pole.
      return (
        <svg {...p}>
          <path d="M4.5 13.5v-10" />
          <path d="M4.5 3.5h7l-1.6 2.75L11.5 9h-7" />
        </svg>
      );
    case "doc":
      return (
        <svg {...p}>
          <path d="M4 2.5h5l3 3v8H4z" />
          <path d="M9 2.5v3h3" />
        </svg>
      );
    case "pr":
      return (
        <svg {...p}>
          <circle cx="4.5" cy="3.75" r="1.5" />
          <circle cx="4.5" cy="12.25" r="1.5" />
          <circle cx="11.5" cy="12.25" r="1.5" />
          <path d="M4.5 5.25v5.5M11.5 10.75V7a2 2 0 0 0-2-2H7.5" />
        </svg>
      );
    case "task":
      return (
        <svg {...p}>
          <rect x="3" y="3" width="10" height="10" rx="2" />
        </svg>
      );
  }
}
