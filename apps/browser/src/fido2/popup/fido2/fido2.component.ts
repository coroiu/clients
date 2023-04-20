import { Component, HostListener, OnDestroy, OnInit } from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import {
  BehaviorSubject,
  combineLatest,
  concatMap,
  map,
  Observable,
  Subject,
  take,
  takeUntil,
} from "rxjs";

import { Fido2KeyView } from "@bitwarden/common/fido2/models/view/fido2-key.view";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { PasswordRepromptService } from "@bitwarden/common/vault/abstractions/password-reprompt.service";
import { CipherType } from "@bitwarden/common/vault/enums/cipher-type";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

import { BrowserApi } from "../../../browser/browserApi";
import {
  BrowserFido2Message,
  BrowserFido2UserInterfaceSession,
} from "../../../services/fido2/browser-fido2-user-interface.service";

@Component({
  selector: "app-fido2",
  templateUrl: "fido2.component.html",
  styleUrls: [],
})
export class Fido2Component implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  protected data$ = new BehaviorSubject<BrowserFido2Message>(null);
  protected sessionId?: string;
  protected ciphers?: CipherView[] = [];
  protected loading = false;

  constructor(
    private activatedRoute: ActivatedRoute,
    private cipherService: CipherService,
    private passwordRepromptService: PasswordRepromptService
  ) {}

  ngOnInit(): void {
    const sessionId$ = this.activatedRoute.queryParamMap.pipe(
      take(1),
      map((queryParamMap) => queryParamMap.get("sessionId"))
    );

    combineLatest([sessionId$, BrowserApi.messageListener$() as Observable<BrowserFido2Message>])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([sessionId, message]) => {
        this.sessionId = sessionId;
        if (message.type === "NewSessionCreatedRequest" && message.sessionId !== sessionId) {
          return this.abort(false);
        }

        if (message.sessionId !== sessionId) {
          return;
        }

        if (message.type === "AbortRequest") {
          return this.abort(false);
        }

        this.data$.next(message);
      });

    this.data$
      .pipe(
        concatMap(async (data) => {
          if (data?.type === "ConfirmNewCredentialRequest") {
            const cipher = new CipherView();
            cipher.name = data.credentialName;
            cipher.type = CipherType.Fido2Key;
            cipher.fido2Key = new Fido2KeyView();
            cipher.fido2Key.userName = data.userName;
            this.ciphers = [cipher];
          } else if (data?.type === "ConfirmCredentialRequest") {
            const cipher = await this.cipherService.get(data.cipherId);
            this.ciphers = [await cipher.decrypt()];
          } else if (data?.type === "PickCredentialRequest") {
            this.ciphers = await Promise.all(
              data.cipherIds.map(async (cipherId) => {
                const cipher = await this.cipherService.get(cipherId);
                return cipher.decrypt();
              })
            );
          } else if (data?.type === "ConfirmNewNonDiscoverableCredentialRequest") {
            this.ciphers = (await this.cipherService.getAllDecrypted()).filter(
              (cipher) => cipher.type === CipherType.Login && !cipher.isDeleted
            );
          } else if (data?.type === "InformExcludedCredentialRequest") {
            this.ciphers = await Promise.all(
              data.existingCipherIds.map(async (cipherId) => {
                const cipher = await this.cipherService.get(cipherId);
                return cipher.decrypt();
              })
            );
          } else if (data?.type === "CloseRequest") {
            window.close();
          }
        }),
        takeUntil(this.destroy$)
      )
      .subscribe();

    sessionId$.pipe(takeUntil(this.destroy$)).subscribe((sessionId) => {
      this.send({
        sessionId: sessionId,
        type: "ConnectResponse",
      });
    });
  }

  async pick(cipher: CipherView) {
    const data = this.data$.value;
    if (data?.type === "PickCredentialRequest") {
      this.send({
        sessionId: this.sessionId,
        cipherId: cipher.id,
        type: "PickCredentialResponse",
      });
    } else if (data?.type === "ConfirmNewNonDiscoverableCredentialRequest") {
      let userVerified = false;
      if (data.userVerification) {
        userVerified = await this.passwordRepromptService.showPasswordPrompt();
      }

      this.send({
        sessionId: this.sessionId,
        cipherId: cipher.id,
        type: "ConfirmNewNonDiscoverableCredentialResponse",
        userVerified,
      });
    }

    this.loading = true;
  }

  confirm() {
    this.send({
      sessionId: this.sessionId,
      type: "ConfirmCredentialResponse",
    });
    this.loading = true;
  }

  async confirmNew() {
    const data = this.data$.value;
    if (data.type !== "ConfirmNewCredentialRequest") {
      return;
    }

    let userVerified = false;
    if (data.userVerification) {
      userVerified = await this.passwordRepromptService.showPasswordPrompt();
    }

    this.send({
      sessionId: this.sessionId,
      type: "ConfirmNewCredentialResponse",
      userVerified,
    });
    this.loading = true;
  }

  abort(fallback: boolean) {
    this.unload(fallback);
    window.close();
  }

  @HostListener("window:unload")
  unload(fallback = false) {
    this.send({
      sessionId: this.sessionId,
      type: "AbortResponse",
      fallbackRequested: fallback,
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private send(msg: BrowserFido2Message) {
    BrowserFido2UserInterfaceSession.sendMessage({
      sessionId: this.sessionId,
      ...msg,
    });
  }
}
