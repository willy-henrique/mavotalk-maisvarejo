import type { SVGProps } from "react";

type BrandProps = {
  compact?: boolean;
  inverse?: boolean;
};

export function MavoBrand({ compact = false, inverse = false }: BrandProps) {
  return (
    <div className={`mavo-brand ${inverse ? "inverse" : ""}`} aria-label="Mavo Talk">
      <span className="mavo-mark" aria-hidden="true">
        <svg viewBox="0 0 44 44" role="img">
          <path d="M10 10.5h24a4 4 0 0 1 4 4v13a4 4 0 0 1-4 4H23.4L15 38v-6.5h-5a4 4 0 0 1-4-4v-13a4 4 0 0 1 4-4Z" />
          <path className="mavo-mark-line" d="m13.5 24 4.4-7 4.2 6.1 4.1-6.1 4.3 7" />
        </svg>
      </span>
      {!compact ? (
        <span className="mavo-brand-copy">
          <strong>
            Mavo <em>Talk</em>
          </strong>
          <small>Central de conversas</small>
        </span>
      ) : null}
    </div>
  );
}

export type IconName =
  | "activity"
  | "arrow-left"
  | "check"
  | "clock"
  | "close"
  | "database"
  | "eye"
  | "eye-off"
  | "headset"
  | "inbox"
  | "logout"
  | "plus"
  | "power"
  | "queue"
  | "refresh"
  | "search"
  | "send"
  | "server"
  | "shield"
  | "sparkle"
  | "store"
  | "user"
  | "whatsapp";

type IconProps = SVGProps<SVGSVGElement> & {
  name: IconName;
  size?: number;
};

export function Icon({ name, size = 18, ...props }: IconProps) {
  const paths: Record<IconName, React.ReactNode> = {
    activity: <><path d="M3 12h4l2.5-7 5 14 2.5-7h4" /></>,
    "arrow-left": <><path d="m15 18-6-6 6-6" /><path d="M9 12h12" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    close: <><path d="m7 7 10 10M17 7 7 17" /></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
    eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
    "eye-off": <><path d="m3 3 18 18" /><path d="M10.6 6.2A10.7 10.7 0 0 1 12 6c6 0 9.5 6 9.5 6a16.6 16.6 0 0 1-2.1 2.7M6.2 6.3C3.8 8 2.5 12 2.5 12s3.5 6 9.5 6a9.8 9.8 0 0 0 3-.5" /></>,
    headset: <><path d="M4 14v-2a8 8 0 0 1 16 0v2" /><path d="M6 13H4a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2v-6ZM18 13h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2v-6ZM18 19c0 1.7-1.3 3-3 3h-2" /></>,
    inbox: <><path d="M4 4h16v14H4z" /><path d="M4 13h4l2 3h4l2-3h4" /></>,
    logout: <><path d="M10 5H5v14h5M14 8l4 4-4 4M9 12h9" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    power: <><path d="M12 2v10" /><path d="M7 5.5a8 8 0 1 0 10 0" /></>,
    queue: <><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r="1" /><circle cx="3.5" cy="12" r="1" /><circle cx="3.5" cy="18" r="1" /></>,
    refresh: <><path d="M20 7v5h-5" /><path d="M19 12a7 7 0 1 0-2 5" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    send: <><path d="m22 2-7 20-4-9-9-4 20-7Z" /><path d="M22 2 11 13" /></>,
    server: <><rect x="3" y="3" width="18" height="7" rx="2" /><rect x="3" y="14" width="18" height="7" rx="2" /><path d="M7 6.5h.01M7 17.5h.01M11 6.5h7M11 17.5h7" /></>,
    shield: <><path d="M12 3 4.5 6v5.5c0 4.5 3 7.7 7.5 9.5 4.5-1.8 7.5-5 7.5-9.5V6L12 3Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
    sparkle: <><path d="m12 3 1.3 4.2L17.5 9l-4.2 1.8L12 15l-1.3-4.2L6.5 9l4.2-1.8L12 3Z" /><path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z" /></>,
    store: <><path d="M4 10v10h16V10" /><path d="M3 10 5 4h14l2 6" /><path d="M3 10a3 3 0 0 0 5 2 3 3 0 0 0 4 0 3 3 0 0 0 4 0 3 3 0 0 0 5-2" /><path d="M9 20v-5h6v5" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></>,
    whatsapp: <><path d="M20.5 11.7a8.5 8.5 0 0 1-12.6 7.5L3 20.5l1.3-4.7a8.5 8.5 0 1 1 16.2-4.1Z" /><path d="M8.2 8.1c.2-.5.5-.5.8-.5h.6l1.1 2.5c.1.3 0 .5-.2.7l-.8.9c.7 1.5 1.8 2.6 3.4 3.3l.8-1c.2-.2.5-.3.8-.2l2.4 1.1c.3.1.4.4.4.7-.2 1.3-1.1 2.2-2.4 2.2-3.5 0-8.8-4.3-8.8-8 0-.7.7-1.5 1.9-1.7Z" /></>,
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
