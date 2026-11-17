import { UserId } from "../../types/guid";

import { LockSource } from "./lock-source.enum";

export abstract class LockService {
  /**
   * Locks all accounts.
   * @param source What caused the lock
   */
  abstract lockAll(source: LockSource): Promise<void>;
  /**
   * Performs lock for a user.
   * @param userId The user id to lock
   * @param source What caused the lock
   */
  abstract lock(userId: UserId, source: LockSource): Promise<void>;

  abstract runPlatformOnLockActions(userId: UserId, source: LockSource): Promise<void>;
  /**
   * Registers an action to be run when a user is locked through this service.
   *
   * @param action Callback invoked after a lock with the user id and what caused the lock.
   */
  abstract registerOnLockAction(
    action: (userId: UserId, source: LockSource) => Promise<void>,
  ): void;
}
