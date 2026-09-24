/**
 * Authoritative constants for Acuity Reader brand logo and iconography.
 * Shared across the in-app top bar (AcuityLogo.tsx), favicon (public/acuity-logo.svg),
 * and native application/taskbar icons.
 */

export const ACUITY_LOGO_VIEWBOX = '0 0 100 100';

export const ACUITY_LOGO_BASE_GRADIENT = {
  id: 'acuityGradBase',
  x1: '5%',
  y1: '60%',
  x2: '95%',
  y2: '85%',
  stops: [
    { offset: '0%', color: '#f59e0b' },   // Left: Warm Golden Honey
    { offset: '50%', color: '#fbbf24' },  // Left-to-center: Radiant Gold
    { offset: '100%', color: '#1d4ed8' }, // Bottom-Right: Deep Royal Cobalt Blue
  ],
} as const;

export const ACUITY_LOGO_TOP_GRADIENT = {
  id: 'acuityGradTop',
  x1: '50%',
  y1: '0%',
  x2: '50%',
  y2: '75%',
  stops: [
    { offset: '0%', color: '#ea580c', opacity: 1 },    // Top: Vibrant Sunset Orange-Red
    { offset: '40%', color: '#f97316', opacity: 0.85 }, // Warm Amber Blend
    { offset: '75%', color: '#ea580c', opacity: 0 },    // Transparent Fade
  ],
} as const;

/**
 * Exact vector path of the Playfair Display SemiBold (weight 600) italic lowercase 'a',
 * mathematically centered and scaled to fill ~94% of the vertical space and ~88% of the
 * horizontal space on the 100x100 viewBox with balanced, minimal optical padding (3-6%)
 * to eliminate dead whitespace across the favicon, top bar, and desktop icons.
 *
 * Bounds in 100x100 viewBox: X [5.97, 94.03], Y [3.12, 96.88]
 *
 * Using a single authoritative vector path guarantees 100% pixel-perfect consistency across:
 * 1. App Top Bar (AcuityLogo.tsx)
 * 2. Browser Tab Favicon (public/acuity-logo.svg)
 * 3. Windows Taskbar, Desktop Shortcuts & Native Frame Icons (icon.ico, icon.png)
 */
export const ACUITY_LOGO_PATH =
  'M33.20 88.96L33.20 88.96Q36.29 88.96 40.26 85.25Q44.23 81.54 48.36 74.83Q52.50 68.10 56.29 58.80Q60.08 49.48 62.85 38.46L62.85 38.46L59.22 57.07Q54.23 71.72 48.62 80.50Q43.02 89.30 36.89 93.09Q30.78 96.88 24.23 96.88L24.23 96.88Q14.93 96.88 10.44 91.11Q5.97 85.33 5.97 75.69L5.97 75.69Q5.97 66.72 8.89 56.81Q11.82 46.89 17.07 37.33Q22.34 27.77 29.06 20.10Q35.77 12.42 43.37 7.77Q50.94 3.12 58.54 3.12L58.54 3.12Q64.39 3.12 67.50 8.03Q70.60 12.94 69.04 22.94L69.04 22.94L67.15 23.98Q68.36 16.73 66.55 12.60Q64.73 8.47 60.60 8.47L60.60 8.47Q56.63 8.47 52.24 12.60Q47.85 16.73 43.54 23.80Q39.22 30.88 35.69 39.84Q32.16 48.80 30.10 58.46Q28.02 68.10 28.02 77.24L28.02 77.24Q28.02 83.61 29.32 86.29Q30.60 88.96 33.20 88.96ZM54.39 70.52L71.97 5.53Q78.18 5.37 83.61 4.85Q89.04 4.33 94.03 3.12L94.03 3.12L71.80 79.64Q71.11 81.72 70.86 83.87Q70.60 86.03 71.20 87.50Q71.80 88.96 74.05 88.96L74.05 88.96Q76.80 88.96 79.72 86.03Q82.67 83.09 85.77 74.13L85.77 74.13L88.36 66.37L91.63 66.37L87.32 78.96Q84.91 86.03 81.28 89.90Q77.66 93.79 73.61 95.33Q69.56 96.88 65.59 96.88L65.59 96.88Q57.32 96.88 53.89 91.71L52.26 91.71Q51.64 87.92 52.15 82.41Q52.67 76.89 54.39 70.52L54.39 70.52Z';
