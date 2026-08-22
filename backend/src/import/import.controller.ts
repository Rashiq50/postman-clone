import { Body, Controller, Post } from '@nestjs/common';
import { API_VERSION } from '@raven/contracts';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { ImportCollectionDto } from './dto/import-collection.dto';
import { ImportEnvironmentDto } from './dto/import-environment.dto';
import {
  ImportCollectionResultDto,
  ImportEnvironmentResultDto,
} from './dto/import-result.dto';
import { ImportService } from './import.service';

/**
 * Postman import.
 *
 * ⚠️ **Both routes answer `201` with `warnings[]`, never an error envelope for
 * a lossy import.** A collection whose folder auth was dropped and whose one
 * unknown verb became GET was still imported, and the user needs the 900
 * requests that arrived far more than they need a 400. This is the same call
 * the send path makes about an upstream 500 — *partial results are data* — and
 * it is why this slice adds **no new `ApiErrorCode`**. Our envelope stays
 * reserved for our failures: a malformed DTO (400), a workspace the caller
 * cannot see (404) or write to (403), an oversize body (413).
 *
 * ⚠️ **The environment route lives here, not on `POST /environments`.** It
 * takes a Postman document rather than a `CreateEnvironmentInput`, and putting
 * it beside the collection route is what gives both the same `warnings[]`
 * shape and lets one auto-detecting dialog on the client post to either without
 * learning two response types.
 *
 * ⚠️ **Deliberately not throttled.** Every caller is authenticated, and the
 * work is bounded twice over — by `IMPORT_MAX_BYTES` at the body parser and by
 * `IMPORT_MAX_ITEMS` at the DTO — so the abuse case a throttle would answer is
 * already closed by the caps. The auth routes are throttled because they are
 * *unauthenticated* and enumerable; this is neither.
 */
@Controller({ path: 'import', version: API_VERSION })
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  @Post('collection')
  async importCollection(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ImportCollectionDto,
  ): Promise<ImportCollectionResultDto> {
    return ImportCollectionResultDto.from(
      await this.importService.importCollection(user.userId, dto),
    );
  }

  @Post('environment')
  async importEnvironment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ImportEnvironmentDto,
  ): Promise<ImportEnvironmentResultDto> {
    return ImportEnvironmentResultDto.from(
      await this.importService.importEnvironment(user.userId, dto),
    );
  }
}
