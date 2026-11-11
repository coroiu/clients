import "core-js/proposals/explicit-resource-management";

import { webcrypto } from "crypto";

import { setupZoneTestEnv } from "jest-preset-angular/setup-env/zone";

setupZoneTestEnv({ errorOnUnknownElements: true, errorOnUnknownProperties: true });

// JSDOM has no ResizeObserver, which `bitOverflowList` constructs on init. Suites
// that assert on packing install their own over this one.
class ResizeObserverStub implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

global.ResizeObserver ??= ResizeObserverStub;

Object.defineProperty(window, "CSS", { value: null });
Object.defineProperty(window, "getComputedStyle", {
  value: () => {
    return {
      display: "none",
      appearance: ["-webkit-appearance"],
    };
  },
});

Object.defineProperty(document, "doctype", {
  value: "<!DOCTYPE html>",
});
Object.defineProperty(document.body.style, "transform", {
  value: () => {
    return {
      enumerable: true,
      configurable: true,
    };
  },
});

Object.defineProperty(window, "crypto", {
  value: webcrypto,
});
