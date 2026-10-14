import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CustomerJwtAccessGuard } from './customer-jwt.guard.js';
import type { CustomerAuthenticatedRequest } from './customer.types.js';
import { CustomerAuthService } from './customer-auth.service.js';
import { CustomerRefreshTokenDto, RequestOtpDto, VerifyOtpDto } from './customer.dto.js';

@Controller()
export class CustomerAuthController {
  constructor(private readonly customerAuthService: CustomerAuthService) {}

  @Post('customer/otp/request')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestOtp(@Body() body: RequestOtpDto) {
    return this.customerAuthService.requestOtp(body.accountNo, body.mobileNo);
  }

  @Post('customer/otp/verify')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verifyOtp(@Body() body: VerifyOtpDto) {
    return this.customerAuthService.verifyOtp(body.accountNo, body.otp);
  }

  @Post('customer/token/refresh')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  refresh(@Body() body: CustomerRefreshTokenDto) {
    return this.customerAuthService.refresh(body.refreshToken);
  }

  @Get('customer/me')
  @UseGuards(CustomerJwtAccessGuard)
  getCurrentCustomer(@Req() request: CustomerAuthenticatedRequest) {
    return this.customerAuthService.getCurrentCustomer(request.user);
  }
}
