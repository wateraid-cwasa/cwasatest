export type AuthRole = 'admin' | 'meter_inspector';

export type SessionClaims = {
  sub: string;
  role: AuthRole;
  displayName: string;
  readerCode: string;
  version: number;
  tokenType: 'access' | 'refresh';
};

export type AuthenticatedRequest = {
  headers: {
    authorization?: string;
  };
  user: SessionClaims;
};
