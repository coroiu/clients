import { CollectionWithIdRequest } from "../../admin-console/ac-lib";
import { CipherRequest } from "../../vault/models/request/cipher.request";
import { FolderWithOptionalIdRequest } from "../../vault/models/request/folder-with-optional-id.request";

import { KvpRequest } from "./kvp.request";

export class ImportOrganizationCiphersRequest {
  ciphers: CipherRequest[] = [];
  collections: CollectionWithIdRequest[] = [];
  collectionRelationships: KvpRequest<number, number>[] = [];
  folders: FolderWithOptionalIdRequest[] = [];
  folderRelationships: KvpRequest<number, number>[] = [];
}
