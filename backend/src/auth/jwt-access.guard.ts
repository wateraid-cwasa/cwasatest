import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthenticatedRequest, SessionClaims } from './auth.types.js';

@Injectable()
export class JwtAccessGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const [scheme, token] = authorization?.split(' ') ?? [];

    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('A bearer access token is required.');
    }

    let claims: SessionClaims;
    try {
      claims = await this.jwtService.verifyAsync<SessionClaims>(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
    } catch {
      throw new UnauthorizedException('The access token is invalid or expired.');
    }

    if (claims.tokenType !== 'access') {
      throw new UnauthorizedException('The token is not an access token.');
    }

    request.user = claims;
    return true;
  }
}
