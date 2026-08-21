import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { API_VERSION, type Paginated } from '@raven/contracts';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { clearRefreshCookie } from '../auth/refresh-cookie';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { SessionResponseDto } from './dto/session-response.dto';
import { SessionsService } from './sessions.service';

/**
 * The user's own devices. No `@UseGuards` — `JwtAuthGuard` is global, so both
 * routes are protected by default, and the user id comes from the verified
 * token rather than any part of the request the caller controls.
 *
 * The cookie helpers are imported as plain functions. Making them a provider
 * would force `SessionsModule → AuthModule`, and `AuthModule` already imports
 * `SessionsModule`.
 */
@Controller({ path: 'sessions', version: API_VERSION })
export class SessionsController {
  constructor(
    private readonly sessionsService: SessionsService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<SessionResponseDto>> {
    const page = await this.sessionsService.findActiveForUser(
      user.userId,
      query,
    );

    return {
      ...page,
      data: SessionResponseDto.fromMany(page.data, user.sessionId),
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.sessionsService.revokeOwned(user.userId, id);

    // Revoking your own session is a logout, so the cookie has to go with it —
    // otherwise the browser keeps presenting a token whose session is dead.
    if (id === user.sessionId) {
      clearRefreshCookie(res, this.configService);
    }
  }
}
