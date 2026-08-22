import type { ImportCollectionInput } from '@raven/contracts';
import { IsUUID, Validate } from 'class-validator';
import { PostmanCollectionConstraint } from './postman-constraints';

export class ImportCollectionDto implements ImportCollectionInput {
  /** Scoping input, checked against membership — never an identity. */
  @IsUUID()
  workspaceId: string;

  /**
   * ⚠️ Typed `unknown` and validated by a constraint, **never** as a nested
   * DTO class: `whitelist: true` would strip every key a class did not declare
   * and silently import an empty collection. See `postman-constraints.ts`.
   */
  @Validate(PostmanCollectionConstraint)
  data: unknown;
}
