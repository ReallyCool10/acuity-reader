// Setup file for Vitest in jsdom environment

if (typeof URL.createObjectURL === 'undefined') {
  URL.createObjectURL = (_blob: Blob | MediaSource) =>
    `blob:stub-${Math.random().toString(36).slice(2)}`;
}

if (typeof URL.revokeObjectURL === 'undefined') {
  URL.revokeObjectURL = (_url: string) => {};
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
