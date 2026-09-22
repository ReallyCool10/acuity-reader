/**
 * Authoritative constants for Acuity Reader brand logo and iconography.
 * Shared across the in-app top bar (AcuityLogo.tsx), favicon (public/acuity-logo.svg),
 * and native application/taskbar icons.
 */

export const ACUITY_LOGO_VIEWBOX = '0 0 100 100';

export const ACUITY_LOGO_GRADIENT = {
  id: 'acuityGrad',
  x1: '10%',
  y1: '10%',
  x2: '90%',
  y2: '90%',
  stops: [
    { offset: '0%', color: '#ffd8a8' },   // Light Orange Yellow
    { offset: '35%', color: '#fef08a' },  // Warm Solar Yellow
    { offset: '100%', color: '#93c5fd' }, // Soft Sky Blue
  ],
} as const;

/**
 * Exact vector path of the Playfair Display SemiBold (weight 600) italic lowercase 'a'
 * positioned at origin x=20.01, y=83, fontSize=106, calibrated for the 100x100 viewBox.
 *
 * Using an exact vector path guarantees 100% pixel-perfect consistency across:
 * 1. App Top Bar (AcuityLogo.tsx)
 * 2. Browser Tab Favicon (public/acuity-logo.svg)
 * 3. Windows Taskbar & Frame Icons (icon.ico, icon.png)
 *
 * Eliminates FOUT (Flash of Unstyled Text) and prevents browser favicon sandboxes
 * from falling back to system serif (Georgia / Times New Roman).
 */
export const ACUITY_LOGO_PATH =
  'M37.08 79.61L37.08 79.61Q38.98 79.61 41.42 77.33Q43.86 75.05 46.40 70.92Q48.95 66.78 51.28 61.06Q53.61 55.33 55.31 48.55L55.31 48.55L53.08 60.00Q50.01 69.01 46.56 74.41Q43.12 79.82 39.35 82.15Q35.59 84.48 31.56 84.48L31.56 84.48Q25.84 84.48 23.08 80.93Q20.33 77.38 20.33 71.45L20.33 71.45Q20.33 65.93 22.13 59.84Q23.93 53.74 27.16 47.86Q30.40 41.98 34.53 37.26Q38.66 32.54 43.33 29.68Q47.99 26.82 52.66 26.82L52.66 26.82Q56.26 26.82 58.17 29.84Q60.08 32.86 59.12 39.01L59.12 39.01L57.96 39.65Q58.70 35.19 57.59 32.65Q56.47 30.11 53.93 30.11L53.93 30.11Q51.49 30.11 48.79 32.65Q46.09 35.19 43.44 39.54Q40.78 43.89 38.61 49.40Q36.44 54.91 35.17 60.85Q33.89 66.78 33.89 72.40L33.89 72.40Q33.89 76.32 34.69 77.97Q35.48 79.61 37.08 79.61ZM50.11 68.27L60.92 28.30Q64.74 28.20 68.08 27.88Q71.42 27.56 74.49 26.82L74.49 26.82L60.82 73.88Q60.39 75.16 60.24 76.48Q60.08 77.81 60.45 78.71Q60.82 79.61 62.20 79.61L62.20 79.61Q63.89 79.61 65.69 77.81Q67.50 76.00 69.41 70.49L69.41 70.49L71.00 65.72L73.01 65.72L70.36 73.46Q68.88 77.81 66.65 80.19Q64.42 82.58 61.93 83.53Q59.44 84.48 57.00 84.48L57.00 84.48Q51.91 84.48 49.80 81.30L48.80 81.30Q48.42 78.97 48.73 75.58Q49.05 72.19 50.11 68.27L50.11 68.27Z';
