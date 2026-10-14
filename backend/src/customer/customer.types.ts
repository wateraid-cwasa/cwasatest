// Self-contained types for the customer-facing slice of this API. Kept
// separate from ../auth/auth.types.ts (which belongs to the meter-inspector
// and admin sessions) so the two auth domains can evolve independently
// without entangled discriminated-union narrowing.

export type CustomerSessionClaims = {
  sub: string;
  role: 'customer';
  displayName: string;
  accountNo: string;
  tokenType: 'access' | 'refresh';
};

export type CustomerAuthenticatedRequest = {
  headers: {
    authorization?: string;
  };
  user: CustomerSessionClaims;
};
