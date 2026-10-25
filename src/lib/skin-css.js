/**
 * CSS generation for the wallpaper layer.
 *
 * One static stylesheet is injected per page load. It keys off the
 * `dsh-skin-on` class and reads every visual parameter from CSS custom
 * properties, so switching a skin is a handful of `style.setProperty` calls
 * on `<html>` — no reload, no flicker, no React involvement.
 *
 * Layer order:
 *   body::before  z-index -2   wallpaper image (blurred when requested)
 *   body::after   z-index -1   tint veil for text contrast
 *   #root > *     z-index auto app content
 */

export function hexToRgb(hex) {
  const value = String(hex ?? '').trim().replace(/^#/, '');
  if (value.length === 3) {
    return [
      parseInt(value[0] + value[0], 16),
      parseInt(value[1] + value[1], 16),
      parseInt(value[2] + value[2], 16),
    ];
  }
  if (value.length === 6) {
    return [
      parseInt(value.slice(0, 2), 16),
      parseInt(value.slice(2, 4), 16),
      parseInt(value.slice(4, 6), 16),
    ];
  }
  return [0, 0, 0];
}

/** Build the semi-transparent veil colour from tint + dim. */
export function veilColor(tint, dim) {
  const [r, g, b] = hexToRgb(tint);
  const alpha = Math.min(0.95, Math.max(0, Number(dim) || 0));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Compute the CSS custom properties for one skin.
 * @param {object} skin normalized skin
 * @param {string|null} imageUrl data: URL (or null for a colour-only skin)
 */
export function skinVariables(skin, imageUrl) {
  const tile = skin.size === 'tile';
  return {
    '--dsh-skin-image': imageUrl ? `url("${imageUrl}")` : 'none',
    '--dsh-skin-size': tile ? 'auto' : skin.size,
    '--dsh-skin-repeat': tile ? 'repeat' : 'no-repeat',
    '--dsh-skin-position': skin.position,
    '--dsh-skin-blur': `${skin.blur}px`,
    '--dsh-skin-scale': skin.blur > 0 ? '1.06' : '1',
    '--dsh-skin-veil': veilColor(skin.tint, skin.dim),
  };
}

export const SKIN_BASE_CSS = `
html.dsh-skin-on,
html.dsh-skin-on body {
  background: transparent !important;
}

html.dsh-skin-on body::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: -2;
  background-image: var(--dsh-skin-image, none);
  background-size: var(--dsh-skin-size, cover);
  background-position: var(--dsh-skin-position, center);
  background-repeat: var(--dsh-skin-repeat, no-repeat);
  background-attachment: fixed;
  filter: blur(var(--dsh-skin-blur, 0px));
  transform: scale(var(--dsh-skin-scale, 1));
  transform-origin: center;
  pointer-events: none;
}

html.dsh-skin-on body::after {
  content: "";
  position: fixed;
  inset: 0;
  z-index: -1;
  background: var(--dsh-skin-veil, transparent);
  pointer-events: none;
}

html.dsh-skin-on.dsh-skin-transparent-root,
html.dsh-skin-on.dsh-skin-transparent-root #root,
html.dsh-skin-on.dsh-skin-transparent-root #root > * {
  background: transparent !important;
}

/* Keep native menus, tooltips and popovers readable over a photo. */
html.dsh-skin-on [role="menu"],
html.dsh-skin-on [role="listbox"],
html.dsh-skin-on [role="dialog"] {
  backdrop-filter: blur(6px);
}
`;
