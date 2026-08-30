/**
 * Locally generated profile avatars.
 *
 * These were photographs fetched from an image CDN, which made a decorative
 * detail into an outbound network dependency: on a plant network with no
 * internet the requests fail and the header shows broken images. The MES must
 * render completely from what ships with it, so the avatars are drawn here
 * instead of downloaded.
 *
 * The palette is baked into the SVG because a `data:` URI cannot read CSS
 * custom properties. That is the same allowance the brand mark takes in
 * `fv/FullCircleLogo`, and it is confined to this file: nothing else in the
 * product names a colour directly.
 */

/** Drawn from the Factory Vision blue ramp so the avatars sit in the palette. */
const AVATAR_PALETTE = [
  { background: '#0A4174', foreground: '#EAF2F8' },
  { background: '#0B5394', foreground: '#EAF2F8' },
  { background: '#1D5BC7', foreground: '#F2F6FD' },
  { background: '#4280EA', foreground: '#0A1B33' },
  { background: '#7FA9D4', foreground: '#0A1B33' },
];

/** First letters of the first two words, e.g. "Rian Pratama" gives "RP". */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return '?';
  return parts.map((part) => part[0]!.toUpperCase()).join('');
}

/**
 * A circular initials avatar as a `data:` URI, so it works anywhere an image
 * URL is expected without a network request.
 */
export function avatarDataUri(name: string, paletteIndex = 0): string {
  const { background, foreground } = AVATAR_PALETTE[paletteIndex % AVATAR_PALETTE.length];
  const initials = initialsOf(name);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">`,
    `<circle cx="48" cy="48" r="48" fill="${background}"/>`,
    `<text x="48" y="49" fill="${foreground}" font-family="Inter, Segoe UI, sans-serif"`,
    ` font-size="38" font-weight="700" text-anchor="middle" dominant-baseline="central">`,
    initials,
    `</text></svg>`,
  ].join('');
  // encodeURIComponent rather than base64: it keeps the markup readable in
  // devtools and avoids pulling in a Buffer/btoa shim.
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export interface AvatarChoice {
  id: string;
  label: string;
  url: string;
}

/** The picker offered in Edit Profile. */
export const OPEN_SOURCE_AVATARS: AvatarChoice[] = [
  { id: 'av1', label: 'Biru Tua', url: avatarDataUri('FV', 0) },
  { id: 'av2', label: 'Biru', url: avatarDataUri('FV', 1) },
  { id: 'av3', label: 'Biru Terang', url: avatarDataUri('FV', 2) },
  { id: 'av4', label: 'Biru Muda', url: avatarDataUri('FV', 3) },
  { id: 'av5', label: 'Biru Pucat', url: avatarDataUri('FV', 4) },
];
