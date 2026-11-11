import "core-js/proposals/explicit-resource-management";

import { webcrypto } from "crypto";

import { toEqualBuffer } from "./spec/to-equal-buffer";

Object.defineProperty(window, "crypto", {
  value: webcrypto,
});

// Add custom matchers
expect.extend({ toEqualBuffer });
