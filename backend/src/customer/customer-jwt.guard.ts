import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { CustomerAuthenticatedRequest, CustomerSessionClaims } from './customer.types.js';

@Injectable()
export class CustomerJwtAccessGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CustomerAuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const [scheme, token] = authorization?.split(' ') ?? [];

    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('A bearer access token is required.');
    }

    let claims: CustomerSessionClaims;
    try {
      claims = await this.jwtService.verifyAsync<CustomerSessionClaims>(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
    } catch {
      throw new UnauthorizedException('The access token is invalid or expired.');
    }

    if (claims.tokenType !== 'access' || claims.role !== 'customer') {
      throw new UnauthorizedException('A customer access token is required.');
    }

    request.user = claims;
    return true;
  }
}
