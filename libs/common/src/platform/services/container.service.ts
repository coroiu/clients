// eslint-disable-next-line no-restricted-imports
import { EncryptService } from "@bitwarden/legacy-crypto";

import { KeyService } from "../../key-management/km-lib";
import { LegacyCompatKeyService } from "../../key-management/legacy-compat";

export class ContainerService {
  constructor(
    private keyService: KeyService,
    private encryptService: EncryptService,
    private legacyCompatKeyService: LegacyCompatKeyService,
  ) {}

  attachToGlobal(global: any) {
    if (!global.bitwardenContainerService) {
      global.bitwardenContainerService = this;
    }
  }

  /**
   * @throws Will throw if KeyService was not instantiated and provided to the ContainerService constructor
   */
  getKeyService(): KeyService {
    if (this.keyService == null) {
      throw new Error("ContainerService.keyService not initialized.");
    }
    return this.keyService;
  }

  /**
   * @throws Will throw if LegacyCompatKeyService was not instantiated and provided to the ContainerService constructor
   */
  getLegacyCompatKeyService(): LegacyCompatKeyService {
    if (this.legacyCompatKeyService == null) {
      throw new Error("ContainerService.legacyCompatKeyService not initialized.");
    }
    return this.legacyCompatKeyService;
  }

  /**
   * @throws Will throw if EncryptService was not instantiated and provided to the ContainerService constructor
   */
  getEncryptService(): EncryptService {
    if (this.encryptService == null) {
      throw new Error("ContainerService.encryptService not initialized.");
    }
    return this.encryptService;
  }
}
