import { BaseResponse } from "../../../../../models/response/base.response";
import { OrganizationUserStatusType, OrganizationUserType } from "../../../../enums";

export class OrganizationUserUserMiniResponse extends BaseResponse {
  id: string;
  userId: string;
  email: string;
  name: string;
  type: OrganizationUserType;
  status: OrganizationUserStatusType;

  constructor(response: any) {
    super(response);
    this.id = this.getResponseProperty("Id");
    this.userId = this.getResponseProperty("UserId");
    this.email = this.getResponseProperty("Email");
    this.name = this.getResponseProperty("Name");
    this.type = this.getResponseProperty("Type");
    this.status = this.getResponseProperty("Status");
  }
}
