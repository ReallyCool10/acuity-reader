// Setup file for Vitest in jsdom environment

URL.createObjectURL = (_blob: Blob | MediaSource) =>
  `blob:stub-${Math.random().toString(36).slice(2)}`;

URL.revokeObjectURL = (_url: string) => {};


/*
 * jsdom does not implement ResizeObserver, which the PDF reader uses to keep
 * fit-width in step with the window. Report a zero-size box: components fall
 * back to their explicit scale, which is the behaviour under test.
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = () => {};
}

// @ts-expect-error React 19 testing flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { vi } from 'vitest';

// Stub mock for PDF.js worker URL import
vi.mock('pdfjs-dist/build/pdf.worker.mjs?url', () => ({
  default: 'blob:pdfjs-worker-stub',
}));
