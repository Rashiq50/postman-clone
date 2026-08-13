import { Body, Controller, Post } from '@nestjs/common';
import { LoginDto } from './dto/login-dto';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    @Post('login')
    async login(@Body() loginDto: LoginDto): Promise<{
      accessToken: string;
      refreshToken: string;
    }> {
        return await this.authService.login(loginDto.email, loginDto.password);
    }
}
