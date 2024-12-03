// @ts-strict-ignore
import { PlanSponsorshipType } from "../../../../billing/enums";

export class OrganizationSponsorshipRedeemRequest {
  planSponsorshipType: PlanSponsorshipType;
  sponsoredOrganizationId: string;
}
