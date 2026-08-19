import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { API_VERSION } from '@postman-clone/contracts';
import type { Request, Response } from 'express';
import type { AuthenticatedUser } from './authenticated-user';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { AuthResponseDto } from './dto/auth-response.dto';
import { AuthUserResponseDto } from './dto/auth-user.dto';
import { LoginDto } from './dto/login-dto';
import { OriginCheckGuard } from './origin-check.guard';
import { Public } from './public.decorator';
import {
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
} from './refresh-cookie';
import { RegisterDto } from './dto/register-dto';

/**
 * `@Res({ passthrough: true })` on every handler that touches a cookie is
 * mandatory, not stylistic: without it Nest hands the response object over
 * entirely and stops serialising the return value, so the handler sets its
 * cookie and then hangs forever.
 */
@Controller({ path: 'auth', version: API_VERSION })
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  /** Public by necessity: this is where a caller with no token gets one. */
  @Public()
  @UseGuards(OriginCheckGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const issued = await this.authService.login(
      loginDto.email,
      loginDto.password,
      {
        userAgent: req.header('user-agent')?.slice(0, 512) ?? null,
        // ⚠️ Behind a reverse proxy or load balancer this is the *proxy's*
        // address, because `main.ts` does not enable Express's `trust proxy`.
        // Fixing it needs a `NestExpressApplication` and knowledge of the
        // deployment's hop count, so it is a separate deployment change; until
        // then, treat the address in the session list as indicative.
        ipAddress: req.ip ?? null,
      },
      readRefreshCookie(req, this.configService),
    );

    setRefreshCookie(
      res,
      this.configService,
      issued.refreshToken,
      issued.refreshExpiresAt,
    );

    // Note the refresh token is *not* in this body. It goes in the cookie only.
    return AuthResponseDto.from(issued);
  }

  /**
   * 201 where login is deliberately 200: registration creates the account it
   * then signs in.
   */
  @Public()
  @UseGuards(OriginCheckGuard)
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() registerDto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const issued = await this.authService.register(
      registerDto.email,
      registerDto.name,
      registerDto.password,
      {
        userAgent: req.header('user-agent')?.slice(0, 512) ?? null,
        ipAddress: req.ip ?? null,
      },
      readRefreshCookie(req, this.configService),
    );

    setRefreshCookie(
      res,
      this.configService,
      issued.refreshToken,
      issued.refreshExpiresAt,
    );

    // Note the refresh token is *not* in this body. It goes in the cookie only.
    return AuthResponseDto.from(issued);
  }

  /**
   * Public because the access token is expired by definition when a client
   * reaches here; the refresh cookie is the credential. `@CurrentUser()` must
   * not appear in this handler — the guard never ran, so `request.user` is
   * undefined.
   */
  @Public()
  @UseGuards(OriginCheckGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const presented = readRefreshCookie(req, this.configService);

    let issued;
    try {
      issued = await this.authService.refresh(presented);
    } catch (error) {
      // A refresh that fails is a session that is over. Clearing the cookie
      // here stops the client re-presenting a token that can only ever fail
      // again — and, on reuse detection, stops it re-presenting one that keeps
      // the incident alive.
      clearRefreshCookie(res, this.configService);
      throw error;
    }

    setRefreshCookie(
      res,
      this.configService,
      issued.refreshToken,
      issued.refreshExpiresAt,
    );

    return AuthResponseDto.from(issued);
  }

  /**
   * Public, and reads the cookie rather than `@CurrentUser()`. A protected
   * logout 401s exactly when a user most wants it to work — a tab left open
   * past the access token's lifetime — and answering "you must be signed in to
   * sign out" is absurd. Always 204, whether the cookie was valid, already
   * spent, or absent entirely.
   */
  @Public()
  @UseGuards(OriginCheckGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logout(readRefreshCookie(req, this.configService));
    clearRefreshCookie(res, this.configService);
  }

  /**
   * Stays protected, unlike `logout`: this is global and destructive, so it
   * demands a live access token rather than just possession of one cookie.
   */
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logoutAll(user.userId);
    clearRefreshCookie(res, this.configService);
  }

  @Get('me')
  async me(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AuthUserResponseDto> {
    return AuthUserResponseDto.from(await this.authService.me(user.userId));
  }
}
