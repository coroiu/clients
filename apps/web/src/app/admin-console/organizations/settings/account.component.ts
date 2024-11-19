import { Component, OnDestroy, OnInit, ViewChild, ViewContainerRef } from "@angular/core";
import { FormBuilder, Validators } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { combineLatest, from, lastValueFrom, of, Subject, switchMap, takeUntil } from "rxjs";

import { ModalService } from "@bitwarden/angular/services/modal.service";
import { OrganizationApiServiceAbstraction } from "@bitwarden/common/admin-console/abstractions/organization/organization-api.service.abstraction";
import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { OrganizationCollectionManagementUpdateRequest } from "@bitwarden/common/admin-console/models/request/organization-collection-management-update.request";
import { OrganizationKeysRequest } from "@bitwarden/common/admin-console/models/request/organization-keys.request";
import { OrganizationUpdateRequest } from "@bitwarden/common/admin-console/models/request/organization-update.request";
import { OrganizationResponse } from "@bitwarden/common/admin-console/models/response/organization.response";
import { FeatureFlag } from "@bitwarden/common/enums/feature-flag.enum";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { DialogService, ToastService } from "@bitwarden/components";
import { KeyService } from "@bitwarden/key-management";

import { ApiKeyComponent } from "../../../auth/settings/security/api-key.component";
import { PurgeVaultComponent } from "../../../vault/settings/purge-vault.component";

import { DeleteOrganizationDialogResult, openDeleteOrganizationDialog } from "./components";

@Component({
  selector: "app-org-account",
  templateUrl: "account.component.html",
})
export class AccountComponent implements OnInit, OnDestroy {
  @ViewChild("apiKeyTemplate", { read: ViewContainerRef, static: true })
  apiKeyModalRef: ViewContainerRef;
  @ViewChild("rotateApiKeyTemplate", { read: ViewContainerRef, static: true })
  rotateApiKeyModalRef: ViewContainerRef;

  selfHosted = false;
  canEditSubscription = true;
  loading = true;
  canUseApi = false;
  org: OrganizationResponse;
  taxFormPromise: Promise<unknown>;

  limitCollectionCreationDeletionSplitFeatureFlagIsEnabled: boolean;

  // FormGroup validators taken from server Organization domain object
  protected formGroup = this.formBuilder.group({
    orgName: this.formBuilder.control(
      { value: "", disabled: true },
      {
        validators: [Validators.required, Validators.maxLength(50)],
        updateOn: "change",
      },
    ),
    billingEmail: this.formBuilder.control(
      { value: "", disabled: true },
      { validators: [Validators.required, Validators.email, Validators.maxLength(256)] },
    ),
  });

  // Deprecated. Delete with https://bitwarden.atlassian.net/browse/PM-10863
  protected collectionManagementFormGroup = this.formBuilder.group({
    limitCollectionCreationDeletion: this.formBuilder.control({ value: false, disabled: true }),
    allowAdminAccessToAllCollectionItems: this.formBuilder.control({
      value: false,
      disabled: true,
    }),
  });

  protected collectionManagementFormGroup_VNext = this.formBuilder.group({
    limitCollectionCreation: this.formBuilder.control({ value: false, disabled: false }),
    limitCollectionDeletion: this.formBuilder.control({ value: false, disabled: false }),
    allowAdminAccessToAllCollectionItems: this.formBuilder.control({
      value: false,
      disabled: false,
    }),
  });

  protected organizationId: string;
  protected publicKeyBuffer: Uint8Array;

  private destroy$ = new Subject<void>();

  constructor(
    private modalService: ModalService,
    private i18nService: I18nService,
    private route: ActivatedRoute,
    private platformUtilsService: PlatformUtilsService,
    private keyService: KeyService,
    private router: Router,
    private organizationService: OrganizationService,
    private organizationApiService: OrganizationApiServiceAbstraction,
    private dialogService: DialogService,
    private formBuilder: FormBuilder,
    private toastService: ToastService,
    private configService: ConfigService,
  ) {}

  async ngOnInit() {
    this.selfHosted = this.platformUtilsService.isSelfHost();

    this.configService
      .getFeatureFlag$(FeatureFlag.LimitCollectionCreationDeletionSplit)
      .pipe(takeUntil(this.destroy$))
      .subscribe((x) => (this.limitCollectionCreationDeletionSplitFeatureFlagIsEnabled = x));

    this.route.params
      .pipe(
        switchMap((params) => this.organizationService.get$(params.organizationId)),
        switchMap((organization) => {
          return combineLatest([
            of(organization),
            // OrganizationResponse for form population
            from(this.organizationApiService.get(organization.id)),
            // Organization Public Key
            from(this.organizationApiService.getKeys(organization.id)),
          ]);
        }),
        takeUntil(this.destroy$),
      )
      .subscribe(([organization, orgResponse, orgKeys]) => {
        // Set domain level organization variables
        this.organizationId = organization.id;
        this.canEditSubscription = organization.canEditSubscription;
        this.canUseApi = organization.useApi;

        // Disabling these fields for self hosted orgs is deprecated
        // This block can be completely removed as part of
        // https://bitwarden.atlassian.net/browse/PM-10863
        if (!this.limitCollectionCreationDeletionSplitFeatureFlagIsEnabled) {
          if (!this.selfHosted) {
            this.collectionManagementFormGroup.get("limitCollectionCreationDeletion").enable();
            this.collectionManagementFormGroup.get("allowAdminAccessToAllCollectionItems").enable();
          }
        }

        // Update disabled states - reactive forms prefers not using disabled attribute
        if (!this.selfHosted) {
          this.formGroup.get("orgName").enable();
          if (this.canEditSubscription) {
            this.formGroup.get("billingEmail").enable();
          }
        }

        // Org Response
        this.org = orgResponse;

        // Public Key Buffer for Org Fingerprint Generation
        this.publicKeyBuffer = Utils.fromB64ToArray(orgKeys?.publicKey);

        // Patch existing values
        this.formGroup.patchValue({
          orgName: this.org.name,
          billingEmail: this.org.billingEmail,
        });
        if (this.limitCollectionCreationDeletionSplitFeatureFlagIsEnabled) {
          this.collectionManagementFormGroup_VNext.patchValue({
            limitCollectionCreation: this.org.limitCollectionCreation,
            limitCollectionDeletion: this.org.limitCollectionDeletion,
            allowAdminAccessToAllCollectionItems: this.org.allowAdminAccessToAllCollectionItems,
          });
        } else {
          this.collectionManagementFormGroup.patchValue({
            limitCollectionCreationDeletion: this.org.limitCollectionCreationDeletion,
            allowAdminAccessToAllCollectionItems: this.org.allowAdminAccessToAllCollectionItems,
          });
        }

        this.loading = false;
      });
  }

  ngOnDestroy(): void {
    // You must first call .next() in order for the notifier to properly close subscriptions using takeUntil
    this.destroy$.next();
    this.destroy$.complete();
  }

  submit = async () => {
    this.formGroup.markAllAsTouched();
    if (this.formGroup.invalid) {
      return;
    }

    const request = new OrganizationUpdateRequest();

    /*
     * When you disable a FormControl, it is removed from formGroup.values, so we have to use
     * the original value.
     * */
    request.name = this.formGroup.get("orgName").disabled
      ? this.org.name
      : this.formGroup.value.orgName;
    request.billingEmail = this.formGroup.get("billingEmail").disabled
      ? this.org.billingEmail
      : this.formGroup.value.billingEmail;

    // Backfill pub/priv key if necessary
    if (!this.org.hasPublicAndPrivateKeys) {
      const orgShareKey = await this.keyService.getOrgKey(this.organizationId);
      const orgKeys = await this.keyService.makeKeyPair(orgShareKey);
      request.keys = new OrganizationKeysRequest(orgKeys[0], orgKeys[1].encryptedString);
    }

    await this.organizationApiService.save(this.organizationId, request);

    this.toastService.showToast({
      variant: "success",
      title: null,
      message: this.i18nService.t("organizationUpdated"),
    });
  };

  submitCollectionManagement = async () => {
    // Early exit if self-hosted
    if (this.selfHosted && !this.limitCollectionCreationDeletionSplitFeatureFlagIsEnabled) {
      return;
    }
    const request = new OrganizationCollectionManagementUpdateRequest();
    if (this.limitCollectionCreationDeletionSplitFeatureFlagIsEnabled) {
      request.limitCollectionCreation =
        this.collectionManagementFormGroup_VNext.value.limitCollectionCreation;
      request.limitCollectionDeletion =
        this.collectionManagementFormGroup_VNext.value.limitCollectionDeletion;
      request.allowAdminAccessToAllCollectionItems =
        this.collectionManagementFormGroup_VNext.value.allowAdminAccessToAllCollectionItems;
    } else {
      request.limitCreateDeleteOwnerAdmin =
        this.collectionManagementFormGroup.value.limitCollectionCreationDeletion;
      request.allowAdminAccessToAllCollectionItems =
        this.collectionManagementFormGroup.value.allowAdminAccessToAllCollectionItems;
    }

    await this.organizationApiService.updateCollectionManagement(this.organizationId, request);

    this.toastService.showToast({
      variant: "success",
      title: null,
      message: this.i18nService.t("updatedCollectionManagement"),
    });
  };

  async deleteOrganization() {
    const dialog = openDeleteOrganizationDialog(this.dialogService, {
      data: {
        organizationId: this.organizationId,
        requestType: "RegularDelete",
      },
    });

    const result = await lastValueFrom(dialog.closed);

    if (result === DeleteOrganizationDialogResult.Deleted) {
      // FIXME: Verify that this floating promise is intentional. If it is, add an explanatory comment and ensure there is proper error handling.
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.router.navigate(["/"]);
    }
  }

  purgeVault = async () => {
    const dialogRef = PurgeVaultComponent.open(this.dialogService, {
      data: {
        organizationId: this.organizationId,
      },
    });
    await lastValueFrom(dialogRef.closed);
  };

  async viewApiKey() {
    await ApiKeyComponent.open(this.dialogService, {
      data: {
        keyType: "organization",
        entityId: this.organizationId,
        postKey: this.organizationApiService.getOrCreateApiKey.bind(this.organizationApiService),
        scope: "api.organization",
        grantType: "client_credentials",
        apiKeyTitle: "apiKey",
        apiKeyWarning: "apiKeyWarning",
        apiKeyDescription: "apiKeyDesc",
      },
    });
  }

  async rotateApiKey() {
    await ApiKeyComponent.open(this.dialogService, {
      data: {
        keyType: "organization",
        isRotation: true,
        entityId: this.organizationId,
        postKey: this.organizationApiService.rotateApiKey.bind(this.organizationApiService),
        scope: "api.organization",
        grantType: "client_credentials",
        apiKeyTitle: "apiKey",
        apiKeyWarning: "apiKeyWarning",
        apiKeyDescription: "apiKeyRotateDesc",
      },
    });
  }
}
