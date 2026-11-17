import { Observable } from "rxjs";

// eslint-disable-next-line no-restricted-imports
import { KdfConfig } from "@bitwarden/legacy-crypto";

import { UserId } from "../../../types/guid";

export abstract class KdfConfigService {
  abstract setKdfConfig(userId: UserId, KdfConfig: KdfConfig): Promise<void>;
  abstract getKdfConfig(userId: UserId): Promise<KdfConfig>;
  abstract getKdfConfig$(userId: UserId): Observable<KdfConfig | null>;
}
