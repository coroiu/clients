import { OrganizationUserType } from "../../../../enums";
import { PermissionsApi } from "../../../../models/api/permissions.api";
import { SelectionReadOnlyRequest } from "../../../../models/request/selection-read-only.request";

export class OrganizationUserInviteRequest {
  emails: string[];
  type: OrganizationUserType;
  accessSecretsManager: boolean = false;
  collections: SelectionReadOnlyRequest[] = [];
  groups: string[];
  permissions: PermissionsApi;

  constructor(c: {
    emails: string[];
    type: OrganizationUserType;
    groups: string[];
    permissions: PermissionsApi;
    collections: SelectionReadOnlyRequest[];
    accessSecretsManager: boolean;
  }) {
    this.emails = c.emails;
    this.type = c.type;
    this.groups = c.groups;
    this.permissions = c.permissions;
    this.collections = c.collections;
    this.accessSecretsManager = c.accessSecretsManager;
  }
}
