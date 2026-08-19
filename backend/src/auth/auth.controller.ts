import { Body, Controller, Post } from '@nestjs/common';
import { LoginDto } from './dto/login-dto';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** Public by necessity: this is where a caller with no token gets one. */
  @Public()
  @Post('login')
  async login(@Body() loginDto: LoginDto): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    return await this.authService.login(loginDto.email, loginDto.password);
  }
}
