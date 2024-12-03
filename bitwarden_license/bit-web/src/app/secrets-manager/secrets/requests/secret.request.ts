// @ts-strict-ignore
import { SecretAccessPoliciesRequest } from "../../shared/access-policies/models/requests/secret-access-policies.request";

export class SecretRequest {
  key: string;
  value: string;
  note: string;
  projectIds?: string[];
  accessPoliciesRequests: SecretAccessPoliciesRequest;
}
