import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
  Delete,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  AdminLoginDto,
  CreateInspectorDto,
  InspectorLoginDto,
  RefreshTokenDto,
  SetInspectorPasswordDto,
} from './auth.dto.js';
import { AdminGuard } from './admin.guard.js';
import { AuthService } from './auth.service.js';
import { JwtAccessGuard } from './jwt-access.guard.js';
import type { AuthenticatedRequest } from './auth.types.js';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('meter-reader/login')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  loginInspector(@Body() credentials: InspectorLoginDto) {
    return this.authService.loginInspector(credentials.meterReaderId, credentials.password);
  }

  @Post('admin/login')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  loginAdmin(@Body() credentials: AdminLoginDto) {
    return this.authService.loginAdmin(credentials.username, credentials.password);
  }

  @Get('auth/me')
  @UseGuards(JwtAccessGuard)
  getCurrentUser(@Req() request: AuthenticatedRequest) {
    return this.authService.getCurrentUser(request.user);
  }

  @Post('auth/refresh')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  refresh(@Body() body: RefreshTokenDto) {
    return this.authService.refresh(body.refreshToken);
  }

  @Delete('admin/inspectors/:readerCode')
  @UseGuards(JwtAccessGuard, AdminGuard)
  deactivateInspector(@Param('readerCode') readerCode: string) {
    return this.authService.deactivateInspector(readerCode);
  }

  @Get('admin/inspectors')
  @UseGuards(JwtAccessGuard, AdminGuard)
  listInspectors() {
    return this.authService.listInspectors();
  }

  @Post('admin/inspectors')
  @UseGuards(JwtAccessGuard, AdminGuard)
  createInspector(
    @Body() body: CreateInspectorDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.authService.createInspector(body, request.user.sub);
  }

  @Put('admin/inspectors/:readerCode/password')
  @UseGuards(JwtAccessGuard, AdminGuard)
  setInspectorPassword(
    @Param('readerCode') readerCode: string,
    @Body() body: SetInspectorPasswordDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.authService.setInspectorPassword(readerCode, body.password, request.user.sub);
  }
}
