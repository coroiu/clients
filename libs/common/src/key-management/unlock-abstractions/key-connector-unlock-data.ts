import { EncString } from "@bitwarden/sdk-internal";

export type KeyConnectorUnlockData = {
  /**
   * The URL of the key connector. This should be verified by the user manually before being used to unlock.
   */
  url: string;
  /**
   * The user-key wrapped by the key-connector-key
   */
  keyConnectorKeyWrappedUserKey: EncString;
};
