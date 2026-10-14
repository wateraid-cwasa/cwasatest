import {
  ConflictException,
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
  phoneNumber: string | null;
  email: string | null;
};

function normalizeReaderCode(readerCode: string): string {
  return readerCode.trim().toLowerCase();
}

function isMissingInspectorDirectoryTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /invalid object name.*MeterInspectorDirectory|MeterInspectorDirectory.*does not exist/i.test(message);
}

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

  async deactivateInspector(readerCode: string) {
    const normalizedReaderCode = readerCode.trim();
    const inspector = await this.findInspector(normalizedReaderCode);
    if (!inspector) {
      throw new NotFoundException('Meter inspector not found.');
    }
    const result = await this.platformDatabase.meterInspectorCredential.updateMany({
      where: { readerCode: normalizedReaderCode },
      data: { isActive: false, updatedAt: new Date() },
    });
    if (result.count === 0) {
      throw new NotFoundException('Meter inspector credentials are not configured.');
    }
    return { readerCode: normalizedReaderCode, isActive: false };
  }

  async listInspectors() {
    const [sourceInspectors, credentials, adminAccounts] = await Promise.all([
      this.sourceDatabase.$queryRaw<InspectorSourceRecord[]>`
        SELECT [ReaderCode] AS [readerCode], [InspectorName] AS [readerName],
          CAST(NULL AS nvarchar(50)) AS [phoneNumber],
          CAST(NULL AS nvarchar(255)) AS [email]
        FROM [platform].[vw_Inspector]
        ORDER BY [ReaderCode]
      `,
      this.platformDatabase.meterInspectorCredential.findMany({
        select: { readerCode: true, isActive: true },
      }),
      this.platformDatabase.adminAccount.findMany({
        select: { username: true },
      }),
    ]);
    let appInspectors: InspectorSourceRecord[] = [];
    try {
      appInspectors = await this.platformDatabase.$queryRaw<InspectorSourceRecord[]>`
        SELECT [RICODE] AS [readerCode], [InspectorName] AS [readerName],
          [PhoneNumber] AS [phoneNumber], [Email] AS [email]
        FROM [app].[MeterInspectorDirectory]
      `;
    } catch (error) {
      if (!isMissingInspectorDirectoryTable(error)) throw error;
    }
    const inspectorByCode = new Map<string, InspectorSourceRecord>();
    for (const inspector of sourceInspectors) {
      inspectorByCode.set(normalizeReaderCode(inspector.readerCode), inspector);
    }
    for (const inspector of appInspectors) {
      inspectorByCode.set(normalizeReaderCode(inspector.readerCode), inspector);
    }
    const credentialByCode = new Map(
      credentials.map((credential) => [normalizeReaderCode(credential.readerCode), credential.isActive]),
    );
    const adminUsernames = new Set(
      adminAccounts.map((admin) => normalizeReaderCode(admin.username)),
    );

    return [...inspectorByCode.values()]
      .filter((inspector) =>
        !adminUsernames.has(normalizeReaderCode(inspector.readerCode)) &&
        !adminUsernames.has(normalizeReaderCode(inspector.readerName ?? '')),
      )
      .sort((left, right) => left.readerCode.localeCompare(right.readerCode))
      .map((inspector) => ({
        readerCode: inspector.readerCode.trim(),
        name: inspector.readerName ?? '',
        phoneNumber: inspector.phoneNumber,
        email: inspector.email,
        passwordConfigured: credentialByCode.has(normalizeReaderCode(inspector.readerCode)),
        isActive: credentialByCode.get(normalizeReaderCode(inspector.readerCode)) ?? false,
      }));
  }

  async createInspector(
    input: { readerCode: string; name: string; phoneNumber: string; email: string; password: string },
    adminId: string,
  ) {
    const readerCode = input.readerCode.trim();
    const existing = await this.findInspector(readerCode);
    if (existing) {
      throw new ConflictException('A meter inspector with this RICODE already exists.');
    }

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    await this.platformDatabase.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        INSERT INTO [app].[MeterInspectorDirectory]
          ([RICODE], [InspectorName], [PhoneNumber], [Email], [CreatedByAdminId])
        VALUES
          (${readerCode}, ${input.name.trim()}, ${input.phoneNumber.trim()}, ${input.email.trim()}, ${adminId})
      `;
      await transaction.meterInspectorCredential.create({
        data: {
          readerCode,
          passwordHash,
          createdByAdminId: adminId,
          updatedByAdminId: adminId,
        },
      });
    });

    return {
      readerCode,
      name: input.name.trim(),
      phoneNumber: input.phoneNumber.trim(),
      email: input.email.trim(),
      passwordConfigured: true,
      isActive: true,
    };
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
      SELECT TOP (1) [ReaderCode] AS [readerCode], [InspectorName] AS [readerName],
        CAST(NULL AS nvarchar(50)) AS [phoneNumber],
        CAST(NULL AS nvarchar(255)) AS [email]
      FROM [platform].[vw_Inspector]
      WHERE [ReaderCode] = ${readerCode}
    `;
    if (inspectors[0]) return inspectors[0];
    const appInspectors = await this.platformDatabase.$queryRaw<InspectorSourceRecord[]>`
      SELECT TOP (1) [RICODE] AS [readerCode], [InspectorName] AS [readerName],
        [PhoneNumber] AS [phoneNumber], [Email] AS [email]
      FROM [app].[MeterInspectorDirectory]
      WHERE [RICODE] = ${readerCode}
    `;
    return appInspectors[0] ?? null;
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
