import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PlatformDatabaseService, SourceDatabaseService } from '../database/database.module.js';
import type { AuthRole, SessionClaims } from './auth.types.js';

const ACCESS_TOKEN_LIFETIME_SECONDS = 15 * 60;
const REFRESH_TOKEN_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

type TokenPair = {
  accessToken: string;
  refreshToken: string;
};

type AuthIdentity = {
  id: string;
  role: AuthRole;
  displayName: string;
  readerCode: string;
  version: number;
};

type InspectorSourceRecord = {
  readerCode: string;
  readerName: string | null;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly sourceDatabase: SourceDatabaseService,
    private readonly platformDatabase: PlatformDatabaseService,
    private readonly jwtService: JwtService,
  ) {}

  async loginInspector(meterReaderId: string, password: string) {
    const readerCode = meterReaderId.trim();
    const credential = await this.platformDatabase.meterInspectorCredential.findUnique({
      where: { readerCode },
    });

    if (!credential?.isActive || !(await argon2.verify(credential.passwordHash, password))) {
      throw new UnauthorizedException('Invalid meter reader ID or password.');
    }

    const inspector = await this.findInspector(readerCode);
    if (!inspector) {
      throw new UnauthorizedException('Invalid meter reader ID or password.');
    }

    const identity: AuthIdentity = {
      id: inspector.readerCode,
      role: 'meter_inspector',
      displayName: inspector.readerName ?? '',
      readerCode: inspector.readerCode,
      version: credential.updatedAt.getTime(),
    };
    const tokens = await this.createTokens(identity);

    return {
      meterReader: {
        id: inspector.readerCode,
        readerCode: inspector.readerCode,
        user: {
          id: inspector.readerCode,
          name: inspector.readerName,
        },
      },
      tokens,
    };
  }

  async loginAdmin(username: string, password: string) {
    const normalizedUsername = username.trim().toLowerCase();
    const admin = await this.platformDatabase.adminAccount.findUnique({
      where: { username: normalizedUsername },
    });

    if (!admin?.isActive || !(await argon2.verify(admin.passwordHash, password))) {
      throw new UnauthorizedException('Invalid username or password.');
    }

    const tokens = await this.createTokens({
      id: admin.adminId,
      role: 'admin',
      displayName: admin.username,
      readerCode: admin.username,
      version: admin.updatedAt.getTime(),
    });

    return {
      admin: {
        id: admin.adminId,
        username: admin.username,
        name: admin.username,
        role: 'admin',
      },
      tokens,
    };
  }

  async getCurrentUser(claims: SessionClaims) {
    return {
      id: claims.sub,
      name: claims.displayName,
      role: claims.role,
    };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    let claims: SessionClaims;
    try {
      claims = await this.jwtService.verifyAsync<SessionClaims>(refreshToken, {
        secret: this.getRefreshSecret(),
      });
    } catch {
      throw new UnauthorizedException('The refresh token is invalid or expired.');
    }

    if (claims.tokenType !== 'refresh') {
      throw new UnauthorizedException('The token is not a refresh token.');
    }

    const identity = await this.getActiveIdentity(claims);
    if (!identity || identity.version !== claims.version) {
      throw new UnauthorizedException('The account is inactive or its password has changed.');
    }

    return this.createTokens(identity);
  }

  async listInspectors() {
    const [inspectors, credentials] = await Promise.all([
      this.sourceDatabase.$queryRaw<InspectorSourceRecord[]>`
        SELECT [ReaderCode] AS [readerCode], [InspectorName] AS [readerName]
        FROM [platform].[vw_Inspector]
        ORDER BY [ReaderCode]
      `,
      this.platformDatabase.meterInspectorCredential.findMany({
        select: { readerCode: true, isActive: true },
      }),
    ]);
    const credentialByCode = new Map(
      credentials.map((credential) => [credential.readerCode, credential.isActive]),
    );

    return inspectors.map((inspector) => ({
      readerCode: inspector.readerCode,
      name: inspector.readerName ?? '',
      passwordConfigured: credentialByCode.has(inspector.readerCode),
      isActive: credentialByCode.get(inspector.readerCode) ?? false,
    }));
  }

  async setInspectorPassword(readerCode: string, password: string, adminId: string) {
    const normalizedReaderCode = readerCode.trim();
    const inspector = await this.findInspector(normalizedReaderCode);
    if (!inspector) {
      throw new NotFoundException('Meter inspector not found.');
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await this.platformDatabase.meterInspectorCredential.upsert({
      where: { readerCode: normalizedReaderCode },
      create: {
        readerCode: normalizedReaderCode,
        passwordHash,
        createdByAdminId: adminId,
        updatedByAdminId: adminId,
      },
      update: {
        passwordHash,
        isActive: true,
        updatedAt: new Date(),
        updatedByAdminId: adminId,
      },
    });

    return { readerCode: normalizedReaderCode, passwordConfigured: true };
  }

  private async getActiveIdentity(claims: SessionClaims): Promise<AuthIdentity | null> {
    if (claims.role === 'admin') {
      const admin = await this.platformDatabase.adminAccount.findUnique({
        where: { adminId: claims.sub },
      });
      if (!admin?.isActive) return null;
      return {
        id: admin.adminId,
        role: 'admin',
        displayName: admin.username,
        readerCode: admin.username,
        version: admin.updatedAt.getTime(),
      };
    }

    const credential = await this.platformDatabase.meterInspectorCredential.findUnique({
      where: { readerCode: claims.readerCode },
    });
    if (!credential?.isActive) return null;

    const inspector = await this.findInspector(claims.readerCode);
    if (!inspector) return null;

    return {
      id: inspector.readerCode,
      role: 'meter_inspector',
      displayName: inspector.readerName ?? '',
      readerCode: inspector.readerCode,
      version: credential.updatedAt.getTime(),
    };
  }

  private async createTokens(identity: AuthIdentity): Promise<TokenPair> {
    const claims: Omit<SessionClaims, 'tokenType'> = {
      sub: identity.id,
      role: identity.role,
      displayName: identity.displayName,
      readerCode: identity.readerCode,
      version: identity.version,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { ...claims, tokenType: 'access' },
        {
          secret: this.getAccessSecret(),
          expiresIn: ACCESS_TOKEN_LIFETIME_SECONDS,
        },
      ),
      this.jwtService.signAsync(
        { ...claims, tokenType: 'refresh' },
        {
          secret: this.getRefreshSecret(),
          expiresIn: REFRESH_TOKEN_LIFETIME_SECONDS,
        },
      ),
    ]);

    return { accessToken, refreshToken };
  }

  private async findInspector(readerCode: string): Promise<InspectorSourceRecord | null> {
    const inspectors = await this.sourceDatabase.$queryRaw<InspectorSourceRecord[]>`
      SELECT TOP (1) [ReaderCode] AS [readerCode], [InspectorName] AS [readerName]
      FROM [platform].[vw_Inspector]
      WHERE [ReaderCode] = ${readerCode}
    `;
    return inspectors[0] ?? null;
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
