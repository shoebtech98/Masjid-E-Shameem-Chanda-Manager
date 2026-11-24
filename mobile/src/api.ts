import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const SERVER_KEY = 'chanda.server-url';
const SESSION_KEY = 'chanda.session-token';
const DEFAULT_SERVER_URL = 'https://masjid-shameem-staging.kingshoaib.workers.dev';
const webStore = new Map<string, string>();
let sessionExpiredListener: (() => void) | null = null;

export function setSessionExpiredHandler(listener: (() => void) | null) {
  sessionExpiredListener = listener;
  return () => {
    if (sessionExpiredListener === listener) sessionExpiredListener = null;
  };
}

function resolveDefaultServerUrl() {
  const configuredUrl = Constants.expoConfig?.extra?.apiUrl;
  return typeof configuredUrl === 'string' && configuredUrl.trim()
    ? normalizeServerUrl(configuredUrl)
    : DEFAULT_SERVER_URL;
}

async function getStoredItem(key: string) {
  return Platform.OS === 'web'
    ? webStore.get(key) ?? null
    : SecureStore.getItemAsync(key);
}

async function setStoredItem(key: string, value: string) {
  if (Platform.OS === 'web') {
    webStore.set(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function deleteStoredItem(key: string) {
  if (Platform.OS === 'web') {
    webStore.delete(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export interface User {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'treasurer';
}

export interface AdminUser extends User {
  status: 'active' | 'inactive';
  created_at: string;
}

export interface AuditEntry {
  id: number;
  user_id: number | null;
  user_name: string;
  action: 'create' | 'update' | 'delete' | 'reset' | 'seed';
  entity: 'household' | 'payment' | 'user';
  entity_id: number | null;
  description: string;
  details: string | null;
  created_at: string;
}

export interface AuditStats {
  total: number;
  by_action: { action: string; c: number }[];
  by_entity: { entity: string; c: number }[];
}

/** Worker monthly_amount values are stored and returned as integer paise. */
export interface Household {
  id: number;
  house_no: string;
  name: string;
  phone: string | null;
  monthly_amount: number;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

/** Worker payment monetary fields are integer paise, including fields without a suffix. */
export interface Payment {
  id: number;
  household_id: number;
  month: number;
  year: number;
  amount: number;
  payment_mode: 'cash' | 'upi' | 'split';
  cash_amount: number;
  upi_amount: number;
  payment_date: string;
  upi_reference: string | null;
  notes: string | null;
  created_by?: number | null;
  recorded_by?: string | null;
  house_no?: string;
  household_name?: string;
}

export interface PaymentModeSummary {
  mode: Payment['payment_mode'];
  transactions: number;
  total_paise: number;
}

export interface DuplicatePayment {
  id: number;
  amount_paise: number;
  payment_mode: Payment['payment_mode'];
  cash_amount_paise: number;
  upi_amount_paise: number;
  payment_date: string;
}

export interface DashboardData {
  month: number;
  year: number;
  month_label: string;
  total_collection_paise: number;
  households_paid: number;
  households_pending: number;
  cash_paise: number;
  upi_paise: number;
  active_households: number;
  total_households: number;
  recent: Payment[];
}

export interface HouseholdDetail {
  household: Household;
  payments: Payment[];
  summary: {
    total_payments: number;
    total_amount_paise: number;
    current_year_paise: number;
    current_month: { paid: boolean; amount_paise?: number; payment_mode?: string };
    last_payment_date: string | null;
    months_paid: number;
    months_pending: number;
    current_month_label: string;
  };
}

export interface MonthlyReport {
  type: 'monthly';
  month: number;
  year: number;
  generated_at: string;
  label: string;
  mode: string;
  summary: {
    total_households: number;
    active_households: number;
    households_paid: number;
    households_pending: number;
    total_collection_paise: number;
    cash_paise: number;
    upi_paise: number;
    transactions: number;
    expected_pending_paise: number;
  };
  mode_summary: PaymentModeSummary[];
  rows: Payment[];
  pending: {
    household_id: number;
    house_no: string;
    household_name: string;
    monthly_amount: number;
  }[];
}

export interface AnnualReport {
  type: 'annual';
  year: number;
  generated_at: string;
  label: string;
  mode: string;
  summary: {
    total_collection_paise: number;
    transactions: number;
    cash_paise: number;
    upi_paise: number;
  };
  monthly: {
    month: number;
    month_name: string;
    transactions: number;
    households_paid: number;
    total_paise: number;
    cash_paise: number;
    upi_paise: number;
  }[];
  households: {
    id: number;
    house_no: string;
    name: string;
    months_paid: number;
    total_paise: number;
  }[];
  mode_summary: PaymentModeSummary[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizeServerUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Enter a complete server address, such as https://chanda.example.org.');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('The server address must use HTTPS.');
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Enter the server’s base address without credentials, paths, or query parameters.');
  }
  const localHttpHosts = new Set(['localhost', '127.0.0.1', '::1', '10.0.2.2']);
  if (url.protocol === 'http:' && (!__DEV__ || !localHttpHosts.has(url.hostname.toLowerCase()))) {
    throw new Error('Use HTTPS for remote servers. HTTP is allowed only for local development.');
  }
  return url.origin;
}

export async function getServerUrl() {
  const storedUrl = await getStoredItem(SERVER_KEY);
  const defaultUrl = resolveDefaultServerUrl();
  if (!storedUrl || storedUrl.trim() !== defaultUrl) {
    await configureServer(defaultUrl);
  }
  return defaultUrl;
}

export async function configureServer(value: string) {
  const input = value.trim();
  const next = normalizeServerUrl(input || resolveDefaultServerUrl());
  const configuredUrl = resolveDefaultServerUrl();
  if (next !== configuredUrl) {
    throw new Error('This app build is configured to use its assigned API environment.');
  }
  const previous = await getStoredItem(SERVER_KEY);
  if (previous !== next) await deleteStoredItem(SESSION_KEY);
  await setStoredItem(SERVER_KEY, next);
  return next;
}

export async function hasSavedSession() {
  return Boolean(await getStoredItem(SESSION_KEY));
}

async function request<T>(
  path: string,
  options: RequestInit & { authenticated?: boolean } = {},
): Promise<T> {
  const baseUrl = await getServerUrl();
  if (!baseUrl) throw new Error('Connect to your organization’s server first.');

  const { authenticated = true, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers);
  headers.set('Accept', 'application/json');
  if (fetchOptions.body !== undefined) headers.set('Content-Type', 'application/json');
  if (authenticated) {
    const token = await getStoredItem(SESSION_KEY);
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...fetchOptions,
      headers,
      credentials: 'omit',
    });
  } catch {
    throw new Error('Could not reach the server. Check the address and your internet connection.');
  }

  const raw = await response.text();
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    if (response.status === 401 && authenticated) {
      await deleteStoredItem(SESSION_KEY);
      sessionExpiredListener?.();
    }
    const message = isRecord(data) && typeof data.error === 'string'
      ? data.error
      : `The server returned an error (${response.status}).`;
    throw new ApiError(message, response.status, data);
  }

  if (isRecord(data) && typeof data.token === 'string') {
    await setStoredItem(SESSION_KEY, data.token);
  }
  return data as T;
}

export async function checkServer() {
  return request<{ ok: boolean; name: string }>('/api/health', { authenticated: false });
}

export async function signIn(serverUrl: string, email: string, password: string) {
  await configureServer(serverUrl);
  const result = await request<{ user: User; token: string }>('/api/auth/mobile-login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
    authenticated: false,
  });
  if (!result.token) throw new Error('The server did not return a mobile session.');
  await setStoredItem(SESSION_KEY, result.token);
  return result.user;
}

export async function restoreUser() {
  const serverUrl = await getServerUrl();
  if (!serverUrl || !(await hasSavedSession())) return null;
  try {
    const result = await request<{ user: User }>('/api/auth/me');
    return result.user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      await clearSession();
      return null;
    }
    throw error;
  }
}

export async function apiGet<T>(path: string) {
  return request<T>(path);
}

export async function checkExistingPayment(householdId: number, month: number, year: number) {
  const query = new URLSearchParams({
    household_id: String(householdId),
    month: String(month),
    year: String(year),
  });
  return request<{ existing: DuplicatePayment | null }>(`/api/payments/check?${query}`);
}

export async function apiSend<T>(path: string, method: 'POST' | 'PUT', body: unknown) {
  return request<T>(path, { method, body: JSON.stringify(body) });
}

export async function apiDelete<T>(path: string) {
  return request<T>(path, { method: 'DELETE' });
}

export async function signOut() {
  try {
    await request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
  } finally {
    await deleteStoredItem(SESSION_KEY);
  }
}

export async function clearSession() {
  await deleteStoredItem(SESSION_KEY);
}
