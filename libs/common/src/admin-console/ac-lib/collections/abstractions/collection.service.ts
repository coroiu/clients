import { Observable } from "rxjs";

import { CollectionId, OrganizationId, UserId } from "../../../../types/guid";
import { OrgKey } from "../../../../types/key";
import { TreeNode } from "../../../../vault/models/domain/tree-node";
import { CollectionView, Collection, CollectionData } from "../../../models/collections";

export abstract class CollectionService {
  abstract encryptedCollections$(userId: UserId): Observable<Collection[] | null>;
  abstract decryptedCollections$(userId: UserId): Observable<CollectionView[]>;

  /**
   * Gets the default collection for a user in a given organization, if it exists.
   */
  abstract defaultUserCollection$(
    userId: UserId,
    orgId: OrganizationId,
  ): Observable<CollectionView | undefined>;
  abstract upsert(collection: CollectionData, userId: UserId): Promise<any>;
  abstract replace(collections: { [id: string]: CollectionData }, userId: UserId): Promise<any>;
  /**
   * @deprecated This method will soon be made private, use `decryptedCollections$` instead.
   */
  abstract decryptMany$(
    collections: Collection[],
    orgKeys: Record<OrganizationId, OrgKey>,
  ): Observable<CollectionView[]>;
  abstract delete(ids: CollectionId[], userId: UserId): Promise<any>;
  abstract encrypt(model: CollectionView, userId: UserId): Promise<Collection>;
  /**
   * Transforms the input CollectionViews into TreeNodes
   */
  abstract getAllNested(collections: CollectionView[]): TreeNode<CollectionView>[];
  /*
   * Transforms the input CollectionViews into TreeNodes and then returns the Treenode with the specified id
   */
  abstract getNested(collections: CollectionView[], id: string): TreeNode<CollectionView>;

  /*
   * Groups/keys collections by OrganizationId
   */
  abstract groupByOrganization(
    collections: CollectionView[],
  ): Map<OrganizationId, CollectionView[]>;
}
