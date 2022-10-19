import { BaseResponse } from "@bitwarden/common/models/response/baseResponse";
import { ProjectsMappedToSecret } from "@bitwarden/common/models/view/projectsMappedToSecret";

export class SecretListItemResponse extends BaseResponse {
  id: string;
  organizationId: string;
  name: string;
  creationDate: string;
  revisionDate: string;
  projects: ProjectsMappedToSecret[];
  constructor(response: any) {
    super(response);
    this.id = this.getResponseProperty("Id");
    this.organizationId = this.getResponseProperty("OrganizationId");
    this.name = this.getResponseProperty("Key");
    this.creationDate = this.getResponseProperty("CreationDate");
    this.revisionDate = this.getResponseProperty("RevisionDate");
    const projectResponse = this.getResponseProperty("projects"); //TODO
    this.projects = projectResponse; // == null ? null : projectResponse.map((k: any) => new ProjectsMappedToSecret(k));
  }
}
