import fs from 'fs';
import path from 'path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AcuityLogo } from './AcuityLogo';
import {
  ACUITY_LOGO_VIEWBOX,
  ACUITY_LOGO_GRADIENT,
  ACUITY_LOGO_PATH,
} from './acuityLogoConstants';

describe('AcuityLogo and Favicon SVG Synchronization', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('renders AcuityLogo component with default size, vector path, and accessibility attributes', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<AcuityLogo />);
    });

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('width')).toBe('24');
    expect(svg?.getAttribute('height')).toBe('24');
    expect(svg?.getAttribute('viewBox')).toBe(ACUITY_LOGO_VIEWBOX);
    expect(svg?.getAttribute('aria-label')).toBe('Acuity Logo');

    const pathElem = svg?.querySelector('path');
    expect(pathElem).not.toBeNull();
    expect(pathElem?.getAttribute('d')).toBe(ACUITY_LOGO_PATH);

    // Verify gradient stops
    const stops = Array.from(svg?.querySelectorAll('stop') || []);
    expect(stops.length).toBe(ACUITY_LOGO_GRADIENT.stops.length);
    stops.forEach((stop, idx) => {
      expect(stop.getAttribute('offset')).toBe(ACUITY_LOGO_GRADIENT.stops[idx].offset);
      expect(stop.getAttribute('stop-color')).toBe(ACUITY_LOGO_GRADIENT.stops[idx].color);
    });

    await act(async () => {
      root.unmount();
    });
  });

  it('renders custom size and additional className properly', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<AcuityLogo size={36} className="custom-test-logo" />);
    });

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('36');
    expect(svg?.getAttribute('height')).toBe('36');
    expect(svg?.getAttribute('class')).toContain('custom-test-logo');

    await act(async () => {
      root.unmount();
    });
  });

  it('verifies public/acuity-logo.svg uses the EXACT same vector path and gradient stops as AcuityLogo', () => {
    const svgPath = path.resolve(__dirname, '../../public/acuity-logo.svg');
    expect(fs.existsSync(svgPath)).toBe(true);

    const svgContent = fs.readFileSync(svgPath, 'utf8');

    // Must match the exact authoritative vector path
    expect(svgContent).toContain(`d="${ACUITY_LOGO_PATH}"`);

    // Must match the exact viewBox
    expect(svgContent).toContain(`viewBox="${ACUITY_LOGO_VIEWBOX}"`);

    // Must match all gradient color stops
    ACUITY_LOGO_GRADIENT.stops.forEach((stop) => {
      expect(svgContent).toContain(`offset="${stop.offset}"`);
      expect(svgContent).toContain(`stop-color="${stop.color}"`);
    });
  });

  it('verifies index.html references /acuity-logo.svg as the favicon', () => {
    const htmlPath = path.resolve(__dirname, '../../index.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    expect(htmlContent).toContain('<link rel="icon" type="image/svg+xml" href="/acuity-logo.svg" />');
  });

  it('verifies public/icon.ico and resources/icon.ico contain valid multi-size Windows icons', () => {
    const publicIco = path.resolve(__dirname, '../../public/icon.ico');
    const resourcesIco = path.resolve(__dirname, '../../resources/icon.ico');

    expect(fs.existsSync(publicIco)).toBe(true);
    expect(fs.existsSync(resourcesIco)).toBe(true);

    const buf = fs.readFileSync(publicIco);
    expect(buf.readUInt16LE(0)).toBe(0); // Reserved
    expect(buf.readUInt16LE(2)).toBe(1); // Type 1 = ICO
    const count = buf.readUInt16LE(4);
    expect(count).toBe(6); // 16, 32, 48, 64, 128, 256

    // Read icon dimensions
    const expectedSizes = [16, 32, 48, 64, 128, 256];
    const actualSizes: number[] = [];
    for (let i = 0; i < count; i++) {
      const offset = 6 + i * 16;
      const w = buf.readUInt8(offset) || 256;
      actualSizes.push(w);
    }
    expect(actualSizes).toEqual(expectedSizes);

    // Verify resources/icon.ico has the exact same content
    const resBuf = fs.readFileSync(resourcesIco);
    expect(resBuf.equals(buf)).toBe(true);
  });

  it('verifies electron-builder.json configures desktop icon and packages resources', () => {
    const builderPath = path.resolve(__dirname, '../../electron-builder.json');
    const config = JSON.parse(fs.readFileSync(builderPath, 'utf8'));

    expect(config.win.icon).toBe('public/icon.ico');
    expect(config.files).toContain('resources/**/*');
    expect(config.nsis.createDesktopShortcut).toBe(true);
  });
});
