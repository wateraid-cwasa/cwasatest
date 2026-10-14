import * as SecureStore from 'expo-secure-store';
import axios, { type AxiosRequestConfig } from 'axios';
import { Platform } from 'react-native';

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  'http://localhost:3000/api/v1';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: { Accept: 'application/json' },
});

type MeterReaderLoginRequest = {
  meterReaderId: string;
  password: string;
};

type MeterReaderLoginResponse = {
  meterReader: {
    id: string;
    readerCode: string;
    user: {
      id: string;
      name: string | null;
    };
  };
  tokens: {
    accessToken: string;
    refreshToken: string;
  };
};

export type AuthenticatedUser = {
  id: string;
  meterReaderId: string;
  name: string;
  readerCode: string;
  role: string;
};

type CurrentUserResponse = Pick<AuthenticatedUser, 'id' | 'name' | 'role'>;
export type AdminInspector = {
  readerCode: string;
  name: string;
  phoneNumber: string | null;
  email: string | null;
  passwordConfigured: boolean;
  isActive: boolean;
};
export type ReadingCustomer = {
  accountNo: string;
  customerName: string;
  address: string;
  mobileNo: string | null;
  meterNo: string | null;
  wardNo: string | null;
  propertyType: string | null;
  connectionSize: string | null;
  lastMeterReading: string | null;
  lastReadingDate: string | null;
  previousBill: string | null;
  paidAmount: string | null;
  paymentStatus: string | null;
};
export type ServiceRequestCustomer = Pick<
  ReadingCustomer,
  'accountNo' | 'customerName' | 'address' | 'meterNo'
>;
export type CreatedReading = {
  id: string;
  accountNo: string;
  meterNo: string | null;
  customerName: string;
  currentBill: string;
  createdAt: string;
  photoSaved: boolean;
};
export type MeterReadingSubmission = {
  id: string;
  readerCode: string;
  accountNo: string;
  wardNo: string | null;
  meterNo: string | null;
  customerName: string;
  currentBill: string;
  latitude: number;
  longitude: number;
  hasPhoto: boolean;
  photoBase64?: string | null;
  status: 'Pending' | 'Completed' | 'Rejected';
  createdAt: string;
};
export type ServiceRequestStatus = 'Pending' | 'In progress' | 'Completed';
export type ServiceRequestRecord = {
  id: string;
  accountNo: string;
  customerName: string;
  address: string;
  meterNo: string | null;
  problemType: string;
  description: string;
  status: ServiceRequestStatus;
  createdAt: string;
};
const AUTHENTICATED_USER_KEY = 'authenticatedUser';

type WebStorageEntry = readonly [key: string, value: string];
const webMemoryStorage = new Map<string, string>();

export class TokenStorageError extends Error {
  constructor() {
    super('Login succeeded, but token storage failed.');
    this.name = 'TokenStorageError';
  }
}

function setWebStorageItems(entries: readonly WebStorageEntry[]): void {
  try {
    for (const [key, value] of entries) {
      localStorage.setItem(key, value);
    }
    for (const [key] of entries) {
      webMemoryStorage.delete(key);
    }
    return;
  } catch {
    for (const [key] of entries) {
      try {
        localStorage.removeItem(key);
      } catch {
        // The persistent store may be unavailable.
      }
    }
  }

  try {
    for (const [key, value] of entries) {
      sessionStorage.setItem(key, value);
    }
    for (const [key] of entries) {
      webMemoryStorage.delete(key);
    }
  } catch {
    for (const [key, value] of entries) {
      try {
        sessionStorage.removeItem(key);
      } catch {
        // Preserve the original storage failure.
      }
      webMemoryStorage.set(key, value);
    }
  }
}

function getWebStorageItem(key: string): string | null {
  try {
    const value = localStorage.getItem(key);
    if (value !== null) return value;
  } catch {
    // The persistent store may be unavailable.
  }

  try {
    const value = sessionStorage.getItem(key);
    if (value !== null) return value;
  } catch {
    // The session store may be unavailable.
  }

  return webMemoryStorage.get(key) ?? null;
}

function removeWebStorageItems(keys: readonly string[]): void {
  try {
    for (const key of keys) {
      localStorage.removeItem(key);
    }
  } catch {
    // The persistent store may be unavailable.
  }

  try {
    for (const key of keys) {
      sessionStorage.removeItem(key);
    }
  } catch {
    // The session store may be unavailable.
  }

  for (const key of keys) {
    webMemoryStorage.delete(key);
  }
}

async function persistTokens(accessToken: string, refreshToken: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      setWebStorageItems([
        ['accessToken', accessToken],
        ['refreshToken', refreshToken],
      ]);
      return;
    }

    await SecureStore.setItemAsync('accessToken', accessToken);
    await SecureStore.setItemAsync('refreshToken', refreshToken);
  } catch {
    try {
      if (Platform.OS === 'web') {
        removeWebStorageItems(['accessToken', 'refreshToken']);
      } else {
        await SecureStore.deleteItemAsync('accessToken');
        await SecureStore.deleteItemAsync('refreshToken');
      }
    } catch {
      // Preserve the original storage failure.
    }
    throw new TokenStorageError();
  }
}

export async function getStoredAccessToken(): Promise<string | null> {
  return Platform.OS === 'web'
    ? getWebStorageItem('accessToken')
    : SecureStore.getItemAsync('accessToken');
}

async function getStoredRefreshToken(): Promise<string | null> {
  return Platform.OS === 'web'
    ? getWebStorageItem('refreshToken')
    : SecureStore.getItemAsync('refreshToken');
}

function isAuthenticatedUser(value: unknown): value is AuthenticatedUser {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'meterReaderId' in value &&
    typeof value.meterReaderId === 'string' &&
    'name' in value &&
    typeof value.name === 'string' &&
    'readerCode' in value &&
    typeof value.readerCode === 'string' &&
    'role' in value &&
    typeof value.role === 'string'
  );
}

export async function getStoredAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const storedUser = Platform.OS === 'web'
    ? getWebStorageItem(AUTHENTICATED_USER_KEY)
    : await SecureStore.getItemAsync(AUTHENTICATED_USER_KEY);
  if (!storedUser) return null;

  try {
    const parsedUser: unknown = JSON.parse(storedUser);
    return isAuthenticatedUser(parsedUser) ? parsedUser : null;
  } catch {
    return null;
  }
}

export async function persistAuthenticatedUser(user: AuthenticatedUser): Promise<void> {
  const serializedUser = JSON.stringify(user);
  if (Platform.OS === 'web') {
    setWebStorageItems([[AUTHENTICATED_USER_KEY, serializedUser]]);
    return;
  }

  await SecureStore.setItemAsync(AUTHENTICATED_USER_KEY, serializedUser);
}

export async function clearStoredTokens(): Promise<void> {
  if (Platform.OS === 'web') {
    removeWebStorageItems(['accessToken', 'refreshToken', AUTHENTICATED_USER_KEY]);
    return;
  }

  await Promise.all([
    SecureStore.deleteItemAsync('accessToken'),
    SecureStore.deleteItemAsync('refreshToken'),
    SecureStore.deleteItemAsync(AUTHENTICATED_USER_KEY),
  ]);
}

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly responseMessage?: string,
  ) {
    super(responseMessage
      ? `API request failed with status ${status}: ${responseMessage}`
      : `API request failed with status ${status}.`);
    this.name = 'ApiRequestError';
  }
}

export class ApiConnectionError extends Error {
  constructor() {
    super('Could not connect to the API.');
    this.name = 'ApiConnectionError';
  }
}

export class ApiResponseError extends Error {
  constructor() {
    super('The API returned an invalid profile response.');
    this.name = 'ApiResponseError';
  }
}

function throwApiError(error: unknown): never {
  if (axios.isAxiosError(error)) {
    if (error.response) {
      const responseData: unknown = error.response.data;
      const responseMessage =
        typeof responseData === 'object' &&
        responseData !== null &&
        'message' in responseData &&
        typeof responseData.message === 'string'
          ? responseData.message
          : undefined;
      throw new ApiRequestError(error.response.status, responseMessage);
    }
    throw new ApiConnectionError();
  }
  throw error;
}

let refreshInFlight: Promise<TokenPair | null> | null = null;

async function refreshTokens(): Promise<TokenPair | null> {
  const refreshToken = await getStoredRefreshToken();
  if (!refreshToken) return null;

  try {
    const response = await apiClient.post<unknown>('/auth/refresh', { refreshToken });
    if (!hasTokenPair(response.data)) {
      await clearStoredTokens();
      throw new Error('The API returned an invalid token refresh response.');
    }
    await persistTokens(response.data.accessToken, response.data.refreshToken);
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 401) {
        await clearStoredTokens();
        return null;
      }
      throwApiError(error);
    }
    throw error;
  }
}

export async function apiRequest<T>(
  endpoint: string,
  options: AxiosRequestConfig = {},
): Promise<T> {
  try {
    const response = await apiClient.request<T>({
      ...options,
      url: endpoint,
    });
    return response.data;
  } catch (error) {
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      endpoint !== '/auth/refresh'
    ) {
      if (!refreshInFlight) {
        refreshInFlight = refreshTokens();
      }
      let tokens: TokenPair | null;
      try {
        tokens = await refreshInFlight;
      } finally {
        refreshInFlight = null;
      }
      if (tokens) {
        try {
          const retry = await apiClient.request<T>({
            ...options,
            url: endpoint,
            headers: {
              ...options.headers,
              Authorization: `Bearer ${tokens.accessToken}`,
            },
          });
          return retry.data;
        } catch (retryError) {
          throwApiError(retryError);
        }
      }
    }
    throwApiError(error);
  }
}

type TokenPair = {
  accessToken: string;
  refreshToken: string;
};

function hasTokenPair(value: unknown): value is TokenPair {
  return (
    typeof value === 'object' &&
    value !== null &&
    'accessToken' in value &&
    typeof value.accessToken === 'string' &&
    'refreshToken' in value &&
    typeof value.refreshToken === 'string'
  );
}

async function persistLogin(user: AuthenticatedUser, tokens: TokenPair): Promise<void> {
  await persistTokens(tokens.accessToken, tokens.refreshToken);
  try {
    await persistAuthenticatedUser(user);
  } catch {
    try {
      await clearStoredTokens();
    } catch {
      // Preserve the original profile-storage failure.
    }
    throw new TokenStorageError();
  }
}

function hasLoginTokens(value: unknown): value is MeterReaderLoginResponse {
  if (typeof value !== 'object' || value === null || !('tokens' in value)) {
    return false;
  }

  const tokens = value.tokens;
  return (
    'meterReader' in value &&
    typeof value.meterReader === 'object' &&
    value.meterReader !== null &&
    'id' in value.meterReader &&
    typeof value.meterReader.id === 'string' &&
    'readerCode' in value.meterReader &&
    typeof value.meterReader.readerCode === 'string' &&
    'user' in value.meterReader &&
    typeof value.meterReader.user === 'object' &&
    value.meterReader.user !== null &&
    'id' in value.meterReader.user &&
    typeof value.meterReader.user.id === 'string' &&
    'name' in value.meterReader.user &&
    (typeof value.meterReader.user.name === 'string' || value.meterReader.user.name === null) &&
    typeof tokens === 'object' &&
    tokens !== null &&
    'accessToken' in tokens &&
    typeof tokens.accessToken === 'string' &&
    'refreshToken' in tokens &&
    typeof tokens.refreshToken === 'string'
  );
}

export async function loginMeterReader(
  credentials: MeterReaderLoginRequest,
): Promise<AuthenticatedUser> {
  const response = await apiRequest<unknown>('/meter-reader/login', {
    method: 'POST',
    data: credentials,
  });

  if (!hasLoginTokens(response)) {
    throw new Error('Login response did not include valid tokens.');
  }

  const user: AuthenticatedUser = {
    id: response.meterReader.user.id,
    meterReaderId: response.meterReader.id,
    name: response.meterReader.user.name ?? '',
    readerCode: response.meterReader.readerCode,
    role: 'meter_inspector',
  };
  await persistLogin(user, response.tokens);
  return user;
}

export async function loginAdmin(credentials: {
  username: string;
  password: string;
}): Promise<AuthenticatedUser> {
  const response = await apiRequest<unknown>('/admin/login', {
    method: 'POST',
    data: credentials,
  });
  if (
    typeof response !== 'object' ||
    response === null ||
    !('admin' in response) ||
    typeof response.admin !== 'object' ||
    response.admin === null ||
    !('id' in response.admin) ||
    typeof response.admin.id !== 'string' ||
    !('username' in response.admin) ||
    typeof response.admin.username !== 'string' ||
    !('tokens' in response) ||
    !hasTokenPair(response.tokens)
  ) {
    throw new Error('Admin login response did not include valid tokens.');
  }

  const user: AuthenticatedUser = {
    id: response.admin.id,
    meterReaderId: '',
    name: response.admin.username,
    readerCode: response.admin.username,
    role: 'admin',
  };
  await persistLogin(user, response.tokens);
  return user;
}

export async function deactivateMeterInspector(readerCode: string): Promise<void> {
  const options = await getAuthorizedRequestOptions();
  await apiRequest(`/admin/inspectors/${encodeURIComponent(readerCode)}`, {
    ...options,
    method: 'DELETE',
  });
}

async function getAuthorizedRequestOptions(): Promise<AxiosRequestConfig> {
  const accessToken = await getStoredAccessToken();
  if (!accessToken) {
    throw new Error('No access token is available for the current request.');
  }
  return { headers: { Authorization: `Bearer ${accessToken}` } };
}

function isAdminInspectorList(value: unknown): value is AdminInspector[] {
  return (
    Array.isArray(value) &&
    value.every(
      (inspector) =>
        typeof inspector === 'object' &&
        inspector !== null &&
        'readerCode' in inspector &&
        typeof inspector.readerCode === 'string' &&
        'name' in inspector &&
        typeof inspector.name === 'string' &&
        'phoneNumber' in inspector &&
        (typeof inspector.phoneNumber === 'string' || inspector.phoneNumber === null) &&
        'email' in inspector &&
        (typeof inspector.email === 'string' || inspector.email === null) &&
        'passwordConfigured' in inspector &&
        typeof inspector.passwordConfigured === 'boolean' &&
        'isActive' in inspector &&
        typeof inspector.isActive === 'boolean',
    )
  );
}

export async function getAdminInspectors(): Promise<AdminInspector[]> {
  const options = await getAuthorizedRequestOptions();
  const response = await apiRequest<unknown>('/admin/inspectors', options);
  if (!isAdminInspectorList(response)) {
    throw new Error('The API returned an invalid inspector list.');
  }
  return response;
}

export async function createMeterInspector(input: {
  readerCode: string;
  name: string;
  phoneNumber: string;
  email: string;
  password: string;
}): Promise<AdminInspector> {
  const options = await getAuthorizedRequestOptions();
  const response = await apiRequest<unknown>('/admin/inspectors', {
    ...options,
    method: 'POST',
    data: input,
  });
  const createdInspector = [response];
  if (!isAdminInspectorList(createdInspector)) {
    throw new Error('The API returned an invalid created inspector.');
  }
  return createdInspector[0];
}

export async function setMeterInspectorPassword(
  readerCode: string,
  password: string,
): Promise<void> {
  const options = await getAuthorizedRequestOptions();
  await apiRequest(`/admin/inspectors/${encodeURIComponent(readerCode)}/password`, {
    ...options,
    method: 'PUT',
    data: { password },
  });
}

function isReadingCustomer(value: unknown): value is ReadingCustomer {
  return (
    typeof value === 'object' &&
    value !== null &&
    'accountNo' in value &&
    typeof value.accountNo === 'string' &&
    'customerName' in value &&
    typeof value.customerName === 'string' &&
    'address' in value &&
    typeof value.address === 'string' &&
    'mobileNo' in value &&
    (typeof value.mobileNo === 'string' || value.mobileNo === null) &&
    'meterNo' in value &&
    (typeof value.meterNo === 'string' || value.meterNo === null) &&
    'wardNo' in value &&
    (typeof value.wardNo === 'string' || value.wardNo === null) &&
    'propertyType' in value &&
    (typeof value.propertyType === 'string' || value.propertyType === null) &&
    'connectionSize' in value &&
    (typeof value.connectionSize === 'string' || value.connectionSize === null) &&
    'lastMeterReading' in value &&
    (typeof value.lastMeterReading === 'string' || value.lastMeterReading === null) &&
    'lastReadingDate' in value &&
    (typeof value.lastReadingDate === 'string' || value.lastReadingDate === null) &&
    'previousBill' in value &&
    (typeof value.previousBill === 'string' || value.previousBill === null) &&
    'paidAmount' in value &&
    (typeof value.paidAmount === 'string' || value.paidAmount === null) &&
    'paymentStatus' in value &&
    (typeof value.paymentStatus === 'string' || value.paymentStatus === null)
  );
}

export async function getAssignedReadingCustomers(): Promise<ReadingCustomer[]> {
  const options = await getAuthorizedRequestOptions();
  const response = await apiRequest<unknown>('/readings/assigned-customers', options);
  if (!Array.isArray(response) || !response.every(isReadingCustomer)) {
    throw new Error('The API returned an invalid assigned-customer list.');
  }
  return response;
}

export async function lookupReadingCustomer(identifier: string): Promise<ReadingCustomer> {
  const options = await getAuthorizedRequestOptions();
  const response = await apiRequest<unknown>('/readings/customer-lookup', {
    ...options,
    params: { identifier },
  });
  if (!isReadingCustomer(response)) {
    throw new Error('The API returned invalid customer details.');
  }
  return response;
}

function isCreatedReading(value: unknown): value is CreatedReading {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'accountNo' in value &&
    typeof value.accountNo === 'string' &&
    'wardNo' in value &&
    (typeof value.wardNo === 'string' || value.wardNo === null) &&
    'meterNo' in value &&
    (typeof value.meterNo === 'string' || value.meterNo === null) &&
    'customerName' in value &&
    typeof value.customerName === 'string' &&
    'currentBill' in value &&
    typeof value.currentBill === 'string' &&
    'createdAt' in value &&
    typeof value.createdAt === 'string' &&
    'photoSaved' in value &&
    typeof value.photoSaved === 'boolean'
  );
}

export async function createMeterReading(input: {
  identifier: string;
  currentBill: string;
  latitude: number;
  longitude: number;
  photoBase64: string;
}): Promise<CreatedReading> {
  const options = await getAuthorizedRequestOptions();
  const response = await apiRequest<unknown>('/readings', {
    ...options,
    method: 'POST',
    data: input,
  });
  if (!isCreatedReading(response)) {
    throw new Error('The API returned an invalid saved reading.');
  }
  return response;
}

function isMeterReadingSubmission(value: unknown): value is MeterReadingSubmission {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'readerCode' in value &&
    typeof value.readerCode === 'string' &&
    'accountNo' in value &&
    typeof value.accountNo === 'string' &&
    'meterNo' in value &&
    (typeof value.meterNo === 'string' || value.meterNo === null) &&
    'customerName' in value &&
    typeof value.customerName === 'string' &&
    'currentBill' in value &&
    typeof value.currentBill === 'string' &&
    'latitude' in value &&
    typeof value.latitude === 'number' &&
    'longitude' in value &&
    typeof value.longitude === 'number' &&
    'hasPhoto' in value &&
    typeof value.hasPhoto === 'boolean' &&
    (!('photoBase64' in value) || typeof value.photoBase64 === 'string' || value.photoBase64 === null) &&
    'status' in value &&
    (value.status === 'Pending' || value.status === 'Completed' || value.status === 'Rejected') &&
    'createdAt' in value &&
    typeof value.createdAt === 'string'
  );
}

async function getMeterReadings(path: string): Promise<MeterReadingSubmission[]> {
  const options = await getAuthorizedRequestOptions();
  const response = await apiRequest<unknown>(path, options);
  if (!Array.isArray(response) || !response.every(isMeterReadingSubmission)) {
    throw new Error('The API returned an invalid meter reading list.');
  }
  return response;
}

export function getPendingMeterReadings(): Promise<MeterReadingSubmission[]> {
  return getMeterReadings('/readings/pending');
}

export function getCompletedMeterReadings(): Promise<MeterReadingSubmission[]> {
  return getMeterReadings('/readings/completed');
}

export function getAdminPendingMeterReadings(): Promise<MeterReadingSubmission[]> {
  return getMeterReadings('/readings/admin/pending');
}

export function getAdminCompletedMeterReadings(): Promise<MeterReadingSubmission[]> {
  return getMeterReadings('/readings/admin/completed');
}

export function getAdminRejectedMeterReadings(): Promise<MeterReadingSubmission[]> {
  return getMeterReadings('/readings/admin/rejected');
}

export async function approveMeterReading(readingId: string): Promise<void> {
  const options = await getAuthorizedRequestOptions();
  await apiRequest(`/readings/admin/${encodeURIComponent(readingId)}/approve`, {
    ...options,
    method: 'POST',
  });
}

export async function rejectMeterReading(readingId: string): Promise<void> {
  const options = await getAuthorizedRequestOptions();
  await apiRequest(`/readings/admin/${encodeURIComponent(readingId)}/reject`, {
    ...options,
    method: 'POST',
  });
}

function isServiceRequestRecord(value: unknown): value is ServiceRequestRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'accountNo' in value &&
    typeof value.accountNo === 'string' &&
    'customerName' in value &&
    typeof value.customerName === 'string' &&
    'address' in value &&
    typeof value.address === 'string' &&
    'meterNo' in value &&
    (typeof value.meterNo === 'string' || value.meterNo === null) &&
    'problemType' in value &&
    typeof value.problemType === 'string' &&
    'description' in value &&
    typeof value.description === 'string' &&
    'status' in value &&
    (value.status === 'Pending' || value.status === 'In progress' || value.status === 'Completed') &&
    'createdAt' in value &&
    typeof value.createdAt === 'string'
  );
}

export async function getServiceRequests(): Promise<ServiceRequestRecord[]> {
  const options = await getAuthorizedRequestOptions();
  const response = await apiRequest<unknown>('/service-requests', options);
  if (!Array.isArray(response) || !response.every(isServiceRequestRecord)) {
    throw new Error('The API returned an invalid service-request list.');
  }
  return response;
}

function isServiceRequestCustomer(value: unknown): value is ServiceRequestCustomer {
  return (
    typeof value === 'object' &&
    value !== null &&
    'accountNo' in value &&
    typeof value.accountNo === 'string' &&
    'customerName' in value &&
    typeof value.customerName === 'string' &&
    'address' in value &&
    typeof value.address === 'string' &&
    'meterNo' in value &&
    (typeof value.meterNo === 'string' || value.meterNo === null)
  );
}

export async function lookupServiceRequestCustomer(identifier: string): Promise<ServiceRequestCustomer> {
  const options = await getAuthorizedRequestOptions();
  const response = await apiRequest<unknown>('/service-requests/customer-lookup', {
    ...options,
    params: { identifier },
  });
  if (!isServiceRequestCustomer(response)) {
    throw new Error('The API returned invalid service-request customer details.');
  }
  return response;
}

export async function createServiceRequest(input: {
  identifier: string;
  problemType: string;
  description: string;
  photoBase64?: string;
}): Promise<ServiceRequestRecord> {
  const options = await getAuthorizedRequestOptions();
  const response = await apiRequest<unknown>('/service-requests', {
    ...options,
    method: 'POST',
    data: input,
  });
  if (!isServiceRequestRecord(response)) {
    throw new Error('The API returned an invalid created service request.');
  }
  return response;
}

function isCurrentUserResponse(value: unknown): value is CurrentUserResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'name' in value &&
    typeof value.name === 'string' &&
    'role' in value &&
    typeof value.role === 'string'
  );
}

export async function getCurrentUser(): Promise<CurrentUserResponse> {
  const accessToken = await getStoredAccessToken();
  if (!accessToken) {
    throw new Error('No access token is available for the current user request.');
  }

  const response = await apiRequest<unknown>('/auth/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!isCurrentUserResponse(response)) {
    throw new ApiResponseError();
  }
  return response;
}
