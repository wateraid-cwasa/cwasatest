import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomInt } from 'node:crypto';
import { PlatformDatabaseService, SourceDatabaseService } from '../database/database.module.js';
import type { CustomerSessionClaims } from './customer.types.js';

const ACCESS_TOKEN_LIFETIME_SECONDS = 15 * 60;
const REFRESH_TOKEN_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
const OTP_LIFETIME_SECONDS = 5 * 60;
const MAX_OTP_ATTEMPTS = 5;

type TokenPair = {
  accessToken: string;
  refreshToken: string;
};

type CustomerSourceRecord = {
  accountNo: string;
  customerName: string;
  mobileNo: string | null;
};

@Injectable()
export class CustomerAuthService {
  constructor(
    private readonly sourceDatabase: SourceDatabaseService,
    private readonly platformDatabase: PlatformDatabaseService,
    private readonly jwtService: JwtService,
  ) {}

  async requestOtp(accountNo: string, mobileNo: string): Promise<{ sent: true; devOtp?: string }> {
    const normalizedAccountNo = accountNo.trim();
    const normalizedMobileNo = mobileNo.replace(/\D/g, '');

    const customer = await this.findCustomerByAccount(normalizedAccountNo);
    if (!customer || (customer.mobileNo ?? '').replace(/\D/g, '') !== normalizedMobileNo) {
      throw new NotFoundException('No customer matches that account number and mobile number.');
    }

    const otp = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const otpHash = await argon2.hash(otp, { type: argon2.argon2id });
    const expiresAt = new Date(Date.now() + OTP_LIFETIME_SECONDS * 1000);

    await this.platformDatabase.customerOtp.upsert({
      where: { accountNo: normalizedAccountNo },
      create: {
        accountNo: normalizedAccountNo,
        mobileNo: normalizedMobileNo,
        otpHash,
        expiresAt,
        attempts: 0,
      },
      update: {
        mobileNo: normalizedMobileNo,
        otpHash,
        expiresAt,
        attempts: 0,
      },
    });

    // TODO: wire a real SMS gateway. Until then the OTP is only logged
    // server-side and returned in non-production environments so the app
    // is usable end-to-end during development.
    console.log(`[customer-otp] accountNo=${normalizedAccountNo} otp=${otp} (expires in 5 min)`);
    const isProduction = process.env.NODE_ENV === 'production';
    return isProduction ? { sent: true } : { sent: true, devOtp: otp };
  }

  async verifyOtp(accountNo: string, otp: string): Promise<{ tokens: TokenPair; customer: CustomerSourceRecord }> {
    const normalizedAccountNo = accountNo.trim();
    const record = await this.platformDatabase.customerOtp.findUnique({
      where: { accountNo: normalizedAccountNo },
    });

    if (!record || record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('The verification code has expired. Request a new one.');
    }
    if (record.attempts >= MAX_OTP_ATTEMPTS) {
      throw new UnauthorizedException('Too many incorrect attempts. Request a new code.');
    }

    const isValid = await argon2.verify(record.otpHash, otp);
    if (!isValid) {
      await this.platformDatabase.customerOtp.update({
        where: { accountNo: normalizedAccountNo },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('The verification code is incorrect.');
    }

    const customer = await this.findCustomerByAccount(normalizedAccountNo);
    if (!customer) {
      throw new NotFoundException('No customer matches that account number.');
    }

    await this.platformDatabase.customerOtp.delete({ where: { accountNo: normalizedAccountNo } });

    const tokens = await this.createTokens(customer);
    return { tokens, customer };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    let claims: CustomerSessionClaims;
    try {
      claims = await this.jwtService.verifyAsync<CustomerSessionClaims>(refreshToken, {
        secret: this.getRefreshSecret(),
      });
    } catch {
      throw new UnauthorizedException('The refresh token is invalid or expired.');
    }

    if (claims.tokenType !== 'refresh' || claims.role !== 'customer') {
      throw new UnauthorizedException('The token is not a customer refresh token.');
    }

    const customer = await this.findCustomerByAccount(claims.accountNo);
    if (!customer) {
      throw new UnauthorizedException('The customer account could not be found.');
    }

    return this.createTokens(customer);
  }

  async getCurrentCustomer(claims: CustomerSessionClaims) {
    const customer = await this.findCustomerByAccount(claims.accountNo);
    if (!customer) {
      throw new NotFoundException('No customer matches the current session.');
    }
    return {
      accountNo: customer.accountNo,
      name: customer.customerName,
    };
  }

  private async createTokens(customer: CustomerSourceRecord): Promise<TokenPair> {
    const claims: Omit<CustomerSessionClaims, 'tokenType'> = {
      sub: customer.accountNo,
      role: 'customer',
      displayName: customer.customerName,
      accountNo: customer.accountNo,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { ...claims, tokenType: 'access' },
        { secret: this.getAccessSecret(), expiresIn: ACCESS_TOKEN_LIFETIME_SECONDS },
      ),
      this.jwtService.signAsync(
        { ...claims, tokenType: 'refresh' },
        { secret: this.getRefreshSecret(), expiresIn: REFRESH_TOKEN_LIFETIME_SECONDS },
      ),
    ]);

    return { accessToken, refreshToken };
  }

  private async findCustomerByAccount(accountNo: string): Promise<CustomerSourceRecord | null> {
    const rows = await this.sourceDatabase.$queryRaw<CustomerSourceRecord[]>`
      SELECT TOP (1)
        CONVERT(nvarchar(255), c.[AccountNo]) AS [accountNo],
        COALESCE(CONVERT(nvarchar(255), c.[CustomerName]), N'') AS [customerName],
        CONVERT(nvarchar(255), c.[MobileNo]) AS [mobileNo]
      FROM [platform].[vw_Customer] AS c
      WHERE CONVERT(nvarchar(255), c.[AccountNo]) = ${accountNo}
    `;
    return rows[0] ?? null;
  }

  private getAccessSecret(): string {
    return this.getSecret('JWT_ACCESS_SECRET');
  }

  private getRefreshSecret(): string {
    return this.getSecret('JWT_REFRESH_SECRET');
  }

  private getSecret(name: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET'): string {
    const secret = process.env[name];
    if (!secret || secret.length < 32 || secret.startsWith('replace-with-')) {
      throw new Error(`${name} must be configured with a non-placeholder secret of at least 32 characters.`);
    }
    return secret;
  }
}
