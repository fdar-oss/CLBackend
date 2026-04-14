import {
  Controller, Post, Get, Body, Req, Res,
  HttpCode, HttpStatus, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto, RefreshTokenDto, ChangePasswordDto } from './dto/login.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { JwtPayload } from './interfaces/jwt-payload.interface';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email + password' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto, req.ip);

    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  async refresh(
    @Req() req: Request,
    @Body() body: RefreshTokenDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = req.cookies?.refreshToken || body.refreshToken;
    if (!token) {
      return { message: 'Refresh token required' };
    }

    // Decode without verifying to get user info for lookup
    const payload = this.decodeToken(token);
    const result = await this.authService.refreshTokens(
      payload.sub,
      payload.tenantId,
      token,
    );

    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return { accessToken: result.accessToken };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout and revoke refresh token' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = req.cookies?.refreshToken;
    if (token) {
      await this.authService.logout(token);
    }
    res.clearCookie('refreshToken');
    return { message: 'Logged out successfully' };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  me(@CurrentUser() user: JwtPayload) {
    return this.authService.me(user.sub);
  }

  @Post('change-password')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change password' })
  changePassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.sub, dto);
  }

  private decodeToken(token: string): JwtPayload {
    const [, payload] = token.split('.');
    return JSON.parse(Buffer.from(payload, 'base64url').toString());
  }
}
