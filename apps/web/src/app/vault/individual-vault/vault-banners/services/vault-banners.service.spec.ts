import { TestBed } from "@angular/core/testing";
import { BehaviorSubject, firstValueFrom, of, take, timeout } from "rxjs";

import {
  UserDecryptionOptions,
  UserDecryptionOptionsServiceAbstraction,
} from "@bitwarden/auth/common";
import { KdfConfigService } from "@bitwarden/common/auth/abstractions/kdf-config.service";
import { TokenService } from "@bitwarden/common/auth/abstractions/token.service";
import { BillingAccountProfileStateService } from "@bitwarden/common/billing/abstractions/account/billing-account-profile-state.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { KdfType } from "@bitwarden/common/platform/enums";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { StateProvider } from "@bitwarden/common/platform/state";
import { FakeStateProvider, mockAccountServiceWith } from "@bitwarden/common/spec";
import { UserId } from "@bitwarden/common/types/guid";
import { SyncService } from "@bitwarden/common/vault/abstractions/sync/sync.service.abstraction";

import {
  PREMIUM_BANNER_REPROMPT_KEY,
  VaultBannersService,
  VisibleVaultBanner,
} from "./vault-banners.service";

describe("VaultBannersService", () => {
  let service: VaultBannersService;
  const isSelfHost = jest.fn().mockReturnValue(false);
  const hasPremiumFromAnySource$ = new BehaviorSubject<boolean>(false);
  const userId = Utils.newGuid() as UserId;
  const fakeStateProvider = new FakeStateProvider(mockAccountServiceWith(userId));
  const getEmailVerified = jest.fn().mockResolvedValue(true);
  const lastSync$ = new BehaviorSubject<Date | null>(null);
  const userDecryptionOptions$ = new BehaviorSubject<UserDecryptionOptions>({
    hasMasterPassword: true,
  });
  const kdfConfig$ = new BehaviorSubject({ kdfType: KdfType.PBKDF2_SHA256, iterations: 600000 });

  beforeEach(() => {
    lastSync$.next(new Date("2024-05-14"));
    isSelfHost.mockClear();
    getEmailVerified.mockClear().mockResolvedValue(true);

    TestBed.configureTestingModule({
      providers: [
        VaultBannersService,
        {
          provide: PlatformUtilsService,
          useValue: { isSelfHost },
        },
        {
          provide: BillingAccountProfileStateService,
          useValue: { hasPremiumFromAnySource$: hasPremiumFromAnySource$ },
        },
        {
          provide: StateProvider,
          useValue: fakeStateProvider,
        },
        {
          provide: PlatformUtilsService,
          useValue: { isSelfHost },
        },
        {
          provide: TokenService,
          useValue: { getEmailVerified },
        },
        {
          provide: KdfConfigService,
          useValue: { getKdfConfig$: () => kdfConfig$ },
        },
        {
          provide: SyncService,
          useValue: { lastSync$: () => lastSync$ },
        },
        {
          provide: UserDecryptionOptionsServiceAbstraction,
          useValue: {
            userDecryptionOptionsById$: () => userDecryptionOptions$,
          },
        },
      ],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("Premium", () => {
    it("waits until sync is completed before showing premium banner", async () => {
      hasPremiumFromAnySource$.next(false);
      isSelfHost.mockReturnValue(false);
      lastSync$.next(null);

      service = TestBed.inject(VaultBannersService);

      const premiumBanner$ = service.shouldShowPremiumBanner$(of(userId));

      // Should not emit when sync is null
      await expect(firstValueFrom(premiumBanner$.pipe(take(1), timeout(100)))).rejects.toThrow();

      // Should emit when sync is completed
      lastSync$.next(new Date("2024-05-14"));
      expect(await firstValueFrom(premiumBanner$)).toBe(true);
    });

    it("does not show a premium banner for self-hosted users", async () => {
      hasPremiumFromAnySource$.next(false);
      isSelfHost.mockReturnValue(true);

      service = TestBed.inject(VaultBannersService);

      expect(await firstValueFrom(service.shouldShowPremiumBanner$(of(userId)))).toBe(false);
    });

    it("does not show a premium banner when they have access to premium", async () => {
      hasPremiumFromAnySource$.next(true);
      isSelfHost.mockReturnValue(false);

      service = TestBed.inject(VaultBannersService);

      expect(await firstValueFrom(service.shouldShowPremiumBanner$(of(userId)))).toBe(false);
    });

    describe("dismissing", () => {
      beforeEach(async () => {
        jest.useFakeTimers();
        const date = new Date("2023-06-08");
        date.setHours(0, 0, 0, 0);
        jest.setSystemTime(date.getTime());

        service = TestBed.inject(VaultBannersService);
        await service.dismissBanner(userId, VisibleVaultBanner.Premium);
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      it("updates state on first dismiss", async () => {
        const state = await firstValueFrom(
          fakeStateProvider.getUser(userId, PREMIUM_BANNER_REPROMPT_KEY).state$,
        );

        const oneWeekLater = new Date("2023-06-15");
        oneWeekLater.setHours(0, 0, 0, 0);

        expect(state).toEqual({
          numberOfDismissals: 1,
          nextPromptDate: oneWeekLater.getTime(),
        });
      });

      it("updates state on second dismiss", async () => {
        const state = await firstValueFrom(
          fakeStateProvider.getUser(userId, PREMIUM_BANNER_REPROMPT_KEY).state$,
        );

        const oneMonthLater = new Date("2023-07-08");
        oneMonthLater.setHours(0, 0, 0, 0);

        expect(state).toEqual({
          numberOfDismissals: 2,
          nextPromptDate: oneMonthLater.getTime(),
        });
      });

      it("updates state on third dismiss", async () => {
        const state = await firstValueFrom(
          fakeStateProvider.getUser(userId, PREMIUM_BANNER_REPROMPT_KEY).state$,
        );

        const oneYearLater = new Date("2024-06-08");
        oneYearLater.setHours(0, 0, 0, 0);

        expect(state).toEqual({
          numberOfDismissals: 3,
          nextPromptDate: oneYearLater.getTime(),
        });
      });
    });
  });

  describe("KDFSettings", () => {
    beforeEach(async () => {
      userDecryptionOptions$.next({ hasMasterPassword: true });
      kdfConfig$.next({ kdfType: KdfType.PBKDF2_SHA256, iterations: 599999 });
    });

    it("shows low KDF iteration banner", async () => {
      service = TestBed.inject(VaultBannersService);

      expect(await service.shouldShowLowKDFBanner(userId)).toBe(true);
    });

    it("does not show low KDF iteration banner if KDF type is not PBKDF2_SHA256", async () => {
      kdfConfig$.next({ kdfType: KdfType.Argon2id, iterations: 600001 });

      service = TestBed.inject(VaultBannersService);

      expect(await service.shouldShowLowKDFBanner(userId)).toBe(false);
    });

    it("does not show low KDF for iterations about 600,000", async () => {
      kdfConfig$.next({ kdfType: KdfType.PBKDF2_SHA256, iterations: 600001 });

      service = TestBed.inject(VaultBannersService);

      expect(await service.shouldShowLowKDFBanner(userId)).toBe(false);
    });

    it("dismisses low KDF iteration banner", async () => {
      service = TestBed.inject(VaultBannersService);

      expect(await service.shouldShowLowKDFBanner(userId)).toBe(true);

      await service.dismissBanner(userId, VisibleVaultBanner.KDFSettings);

      expect(await service.shouldShowLowKDFBanner(userId)).toBe(false);
    });
  });

  describe("OutdatedBrowser", () => {
    beforeEach(async () => {
      // Hardcode `MSIE` in userAgent string
      const userAgent = "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 MSIE";
      Object.defineProperty(navigator, "userAgent", {
        configurable: true,
        get: () => userAgent,
      });
    });

    it("shows outdated browser banner", async () => {
      service = TestBed.inject(VaultBannersService);

      expect(await service.shouldShowUpdateBrowserBanner(userId)).toBe(true);
    });

    it("dismisses outdated browser banner", async () => {
      service = TestBed.inject(VaultBannersService);

      expect(await service.shouldShowUpdateBrowserBanner(userId)).toBe(true);

      await service.dismissBanner(userId, VisibleVaultBanner.OutdatedBrowser);

      expect(await service.shouldShowUpdateBrowserBanner(userId)).toBe(false);
    });
  });

  describe("VerifyEmail", () => {
    beforeEach(async () => {
      getEmailVerified.mockResolvedValue(false);
    });

    it("shows verify email banner", async () => {
      service = TestBed.inject(VaultBannersService);

      expect(await service.shouldShowVerifyEmailBanner(userId)).toBe(true);
    });

    it("dismisses verify email banner", async () => {
      service = TestBed.inject(VaultBannersService);

      expect(await service.shouldShowVerifyEmailBanner(userId)).toBe(true);

      await service.dismissBanner(userId, VisibleVaultBanner.VerifyEmail);

      expect(await service.shouldShowVerifyEmailBanner(userId)).toBe(false);
    });
  });
});
