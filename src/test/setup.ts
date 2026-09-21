// Setup file for Vitest in jsdom environment

if (typeof URL.createObjectURL === 'undefined') {
  URL.createObjectURL = (_blob: Blob | MediaSource) =>
    `blob:stub-${Math.random().toString(36).slice(2)}`;
}

if (typeof URL.revokeObjectURL === 'undefined') {
  URL.revokeObjectURL = (_url: string) => {};
}

// @ts-expect-error React 19 testing flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
