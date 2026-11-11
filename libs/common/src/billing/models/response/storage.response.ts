import { BaseResponse } from "../../../models/response/base.response";
import { Storage } from "../../subscription-types";


export class StorageResponse extends BaseResponse implements Storage {
  available: number;
  used: number;
  readableUsed: string;

  constructor(response: any) {
    super(response);

    this.available = this.getResponseProperty("Available");
    this.used = this.getResponseProperty("Used");
    this.readableUsed = this.getResponseProperty("ReadableUsed");
  }
}
