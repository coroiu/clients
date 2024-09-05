import { defer, filter, firstValueFrom, map, merge, throwError, timeout } from "rxjs";

import AbstractChromeStorageService, {
  SerializedValue,
  objToStore,
} from "./abstractions/abstract-chrome-storage-api.service";

export const RESEED_IN_PROGRESS_KEY = "reseedInProgress";

export default class BrowserLocalStorageService extends AbstractChromeStorageService {
  newReseed = true;
  constructor() {
    super(chrome.storage.local);
    this.chromeStorageApi.remove(RESEED_IN_PROGRESS_KEY, () => {
      return;
    });
  }

  /**
   * Reads, clears, and re-saves all data in local storage. This is a hack to remove previously stored sensitive data from
   * local storage logs.
   *
   * @see https://github.com/bitwarden/clients/issues/485
   */
  async reseed(): Promise<void> {
    try {
      await this.save(RESEED_IN_PROGRESS_KEY, true);
      const data = await this.getAll();
      await this.clear();
      await this.saveAll(data);
    } finally {
      await super.remove(RESEED_IN_PROGRESS_KEY);
    }
  }

  async fillBuffer() {
    // Write 4MB of data in chrome.storage.local, log files will hold 4MB of data (by default)
    // before forcing a compaction. To force a compaction and have it remove previously saved data,
    // we want to fill it's buffer so that anything newly marked for deletion is gone.
    // https://github.com/google/leveldb/blob/main/doc/impl.md#log-files
    // It's important that if Google uses a different buffer length that we match that, as far as I can tell
    // Google uses the default value in Chromium:
    // https://github.com/chromium/chromium/blob/148774efa6b3a047369af6179a4248566b39d68f/components/value_store/lazy_leveldb.cc#L65-L66
    const fakeData = "0".repeat(1024 * 1024); // 1MB of data
    await new Promise<void>((resolve, reject) => {
      this.chromeStorageApi.set(
        {
          fake_data_1: fakeData,
          fake_data_2: fakeData,
          fake_data_3: fakeData,
          fake_data_4: fakeData,
        },
        () => {
          if (chrome.runtime.lastError) {
            return reject(chrome.runtime.lastError);
          }

          resolve();
        },
      );
    });
    await new Promise<void>((resolve, reject) => {
      this.chromeStorageApi.remove(
        ["fake_data_1", "fake_data_2", "fake_data_3", "fake_data_4"],
        () => {
          if (chrome.runtime.lastError) {
            return reject(chrome.runtime.lastError);
          }

          resolve();
        },
      );
    });
  }

  override async get<T>(key: string): Promise<T> {
    await this.awaitReseed();
    return super.get(key);
  }

  override async has(key: string): Promise<boolean> {
    await this.awaitReseed();
    return super.has(key);
  }

  override async save(key: string, obj: any): Promise<void> {
    await this.awaitReseed();
    return super.save(key, obj);
  }

  override async remove(key: string): Promise<void> {
    await this.awaitReseed();
    return super.remove(key);
  }

  private async awaitReseed(): Promise<void> {
    const notReseeding = async () => {
      return !(await super.get(RESEED_IN_PROGRESS_KEY));
    };

    const finishedReseeding = this.updates$.pipe(
      filter(({ key, updateType }) => key === RESEED_IN_PROGRESS_KEY && updateType === "remove"),
      map(() => true),
    );

    await firstValueFrom(
      merge(defer(notReseeding), finishedReseeding).pipe(
        filter((v) => v),
        timeout({
          // We eventually need to give up and throw an error
          first: 5_000,
          with: () =>
            throwError(
              () => new Error("Reseeding local storage did not complete in a timely manner."),
            ),
        }),
      ),
    );
  }

  /**
   * Clears local storage
   */
  private async clear() {
    return new Promise<void>((resolve, reject) => {
      this.chromeStorageApi.clear(() => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }
        resolve();
      });
    });
  }

  /**
   * Retrieves all objects stored in local storage.
   *
   * @remarks This method processes values prior to resolving, do not use `chrome.storage.local` directly
   * @returns Promise resolving to keyed object of all stored data
   */
  private async getAll(): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      this.chromeStorageApi.get(null, (allStorage) => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }

        const resolved = Object.entries(allStorage).reduce(
          (agg, [key, value]) => {
            agg[key] = this.processGetObject(value);
            return agg;
          },
          {} as Record<string, unknown>,
        );
        resolve(resolved);
      });
    });
  }

  private async saveAll(data: Record<string, unknown>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const keyedData = Object.entries(data).reduce(
        (agg, [key, value]) => {
          agg[key] = objToStore(value);
          return agg;
        },
        {} as Record<string, SerializedValue>,
      );
      this.chromeStorageApi.set(keyedData, () => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }

        resolve();
      });
    });
  }
}
