import { backendMethodGroups, backendMethodNames } from "./contracts.ts";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

type RpcPayload = {
  method?: string;
  args?: unknown[];
  sessionToken?: string;
};

type SessionData = {
  userId: string;
  username: string;
  fullName: string;
  role: string;
  issuedAt: string;
  email?: string;
  permissions?: string[];
  staffPortalUnlocked?: boolean;
  staffPortalUnlockedAt?: string;
};

type SettingsMap = Record<string, JsonValue | undefined>;
type SupabaseRow = Record<string, JsonValue | undefined>;

const OPERATING_DAY_CALENDAR_SETTING_KEY = "OperatingDayCalendarJson";
const REPORT_LAYOUT_SETTINGS_KEY = "ReportLayoutSettingsJson";
const MENU_SETTINGS_KEY = "MenuSettingsJson";
const USER_STATUS_PENDING = "Pending";
const USER_STATUS_ACTIVE = "Active";
const USER_STATUS_SUSPENDED = "Suspended";
const DEFAULT_INTEREST_RATE = 12;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_SECONDS = 15 * 60;

const loginAttemptState = new Map<string, { attempts: number; expiresAt: number }>();
const loginLockState = new Map<string, number>();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PERMISSION_CATALOG = [
  { key: "dashboard.view", label: "ดูภาพรวมระบบ" },
  { key: "payments.create", label: "บันทึกรับชำระเงิน" },
  { key: "payments.edit", label: "แก้ไขรายการรับชำระ" },
  { key: "payments.reverse", label: "กลับรายการรับชำระ" },
  { key: "payment_records.view", label: "ดูเมนูจัดการรายการรับชำระ" },
  { key: "qualifications.view", label: "ดูเมนูตรวจสอบคุณสมบัติ" },
  { key: "members.view", label: "ดูทะเบียนสมาชิก" },
  { key: "members.manage", label: "เพิ่ม/แก้ไข/ลบสมาชิก" },
  { key: "loans.view", label: "ดูข้อมูลสัญญาเงินกู้" },
  { key: "loans.manage", label: "เพิ่ม/แก้ไข/ลบสัญญา" },
  { key: "reports.view", label: "ดูรายงาน" },
  { key: "reports.archive", label: "บันทึก/เปิดคลังรายงาน PDF" },
  { key: "reports.export", label: "ส่งออกข้อมูล CSV" },
  { key: "reports.reconcile", label: "ตรวจความสอดคล้องของยอด" },
  { key: "profile.view", label: "ดูข้อมูลส่วนตัว" },
  { key: "settings.view", label: "ดูเมนูตั้งค่าระบบ" },
  { key: "settings.manage", label: "แก้ไขการตั้งค่าระบบ" },
  { key: "users.manage", label: "จัดการผู้ใช้งาน" },
  { key: "staff.portal.access", label: "เข้าส่วนงานเจ้าหน้าที่" },
  { key: "audit.view", label: "ดู Audit Logs" },
  { key: "accounting.close", label: "ปิดยอดบัญชี" },
  { key: "backup.run", label: "Backup ธุรกรรม" },
] as const;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });

const success = (body: JsonObject) => json(200, { status: "Success", ...body });

const appError = (message: string, code = "APP_ERROR", extra: JsonObject = {}) =>
  json(200, {
    status: "Error",
    code,
    message,
    ...extra,
  });

const notImplemented = (method: string) =>
  json(501, {
    status: "Error",
    code: "NOT_IMPLEMENTED",
    message: `Supabase backend scaffold is ready, but method '${method}' is not implemented yet.`,
  });

const normalizeText = (value: unknown) => String(value ?? "").trim();
const normalizeLower = (value: unknown) => normalizeText(value).toLowerCase();
const normalizeRole = (value: unknown) => {
  const role = normalizeLower(value);
  if (!role) return "staff";
  if (role === "admin") return "admin";
  return role.replace(/[^a-z0-9._-]/g, "") || "staff";
};

const normalizeUserStatus = (value: unknown) => {
  const status = normalizeText(value);
  if (!status) return USER_STATUS_PENDING;
  const lower = status.toLowerCase();
  if (lower === "active") return USER_STATUS_ACTIVE;
  if (["suspended", "banned", "disabled", "inactive"].includes(lower)) return USER_STATUS_SUSPENDED;
  if (["pending", "waiting", "awaiting_approval"].includes(lower)) return USER_STATUS_PENDING;
  return status;
};

const getPermissionCatalog = () => PERMISSION_CATALOG.map((item) => ({ ...item }));
const getAllPermissionKeys = () => PERMISSION_CATALOG.map((item) => item.key);

const getDefaultPermissionMapByRole = (role: unknown) => {
  const normalizedRole = normalizeRole(role);
  const map = Object.fromEntries(getAllPermissionKeys().map((key) => [key, false]));
  if (normalizedRole === "admin") {
    for (const key of getAllPermissionKeys()) map[key] = true;
    return map;
  }
  for (const key of [
    "dashboard.view",
    "payments.create",
    "payment_records.view",
    "qualifications.view",
    "members.view",
    "loans.view",
    "reports.view",
    "reports.export",
    "profile.view",
  ]) {
    map[key] = true;
  }
  return map;
};

const parsePermissionsJson = (value: unknown): Record<string, boolean> => {
  if (Array.isArray(value)) {
    return Object.fromEntries(value.map((item) => [normalizeText(item), true]).filter(([key]) => key));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, enabled]) => [normalizeText(key), !!enabled]).filter(([key]) => key),
    );
  }
  const text = normalizeText(value);
  if (!text) return {};
  try {
    return parsePermissionsJson(JSON.parse(text));
  } catch {
    return {};
  }
};

const getEffectivePermissions = (userRow: SupabaseRow | null, roleOverride?: string) => {
  const role = normalizeRole(roleOverride ?? userRow?.role);
  const baseMap = getDefaultPermissionMapByRole(role);
  if (role !== "admin") {
    const customMap = parsePermissionsJson(userRow?.permissions_json);
    for (const key of getAllPermissionKeys()) {
      if (Object.prototype.hasOwnProperty.call(customMap, key)) {
        baseMap[key] = !!customMap[key];
      }
    }
  }
  return Object.keys(baseMap).filter((key) => baseMap[key]);
};

const parseBooleanEnv = (value: string | undefined, fallback: boolean) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
};

const getEnv = () => {
  const supabaseUrl = normalizeText(Deno.env.get("SUPABASE_URL"));
  const serviceRoleKey = normalizeText(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const loginRequired = parseBooleanEnv(Deno.env.get("APP_LOGIN_REQUIRED"), false);
  const sessionSigningSecret =
    normalizeText(Deno.env.get("APP_SESSION_SIGNING_SECRET")) ||
    normalizeText(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const pinUniquePepper = normalizeText(Deno.env.get("PIN_UNIQUE_PEPPER")) || "PIN_UNIQUE_PEPPER_DEFAULT";
  return { supabaseUrl, serviceRoleKey, loginRequired, sessionSigningSecret, pinUniquePepper };
};

const ensureConfigured = () => {
  const env = getEnv();
  if (!env.supabaseUrl || !env.serviceRoleKey) {
    throw new Error("Supabase Edge Function ยังไม่ได้ตั้งค่า SUPABASE_URL หรือ SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!env.sessionSigningSecret) {
    throw new Error("Supabase Edge Function ยังไม่ได้ตั้งค่า APP_SESSION_SIGNING_SECRET");
  }
  return env;
};

const pad2 = (value: number) => String(Math.max(0, Math.trunc(value || 0))).padStart(2, "0");

const formatThaiDate = (input = new Date()) => {
  const date = new Date(input);
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear() + 543}`;
};

const formatThaiDateTime = (input = new Date()) => {
  const date = new Date(input);
  return `${formatThaiDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
};

const parseThaiDateParts = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      day: value.getDate(),
      month: value.getMonth() + 1,
      yearBe: value.getFullYear() + 543,
      hour: value.getHours(),
      minute: value.getMinutes(),
      second: value.getSeconds(),
      dateOnly: formatThaiDate(value),
      dateTime: formatThaiDateTime(value),
    };
  }
  const text = normalizeText(value);
  if (!text) return null;
  const timeMatch = text.match(/(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  const time = {
    hour: Number(timeMatch?.[1] || 0),
    minute: Number(timeMatch?.[2] || 0),
    second: Number(timeMatch?.[3] || 0),
  };
  const slashMatch = text.split(" ")[0]?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const day = Number(slashMatch[1]);
    const month = Number(slashMatch[2]);
    const yearBe = Number(slashMatch[3]);
    return {
      day,
      month,
      yearBe,
      ...time,
      dateOnly: `${pad2(day)}/${pad2(month)}/${yearBe}`,
      dateTime: `${pad2(day)}/${pad2(month)}/${yearBe} ${pad2(time.hour)}:${pad2(time.minute)}:${pad2(time.second)}`,
    };
  }
  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const day = Number(isoMatch[3]);
    const month = Number(isoMatch[2]);
    const yearBe = Number(isoMatch[1]) + 543;
    return {
      day,
      month,
      yearBe,
      ...time,
      dateOnly: `${pad2(day)}/${pad2(month)}/${yearBe}`,
      dateTime: `${pad2(day)}/${pad2(month)}/${yearBe} ${pad2(time.hour)}:${pad2(time.minute)}:${pad2(time.second)}`,
    };
  }
  const nativeDate = new Date(text.replace(/\s*\([^)]*\)\s*$/, ""));
  if (!Number.isNaN(nativeDate.getTime())) {
    return parseThaiDateParts(nativeDate);
  }
  return null;
};

const getCurrentThaiMonthContext = () => {
  const parts = parseThaiDateParts(new Date()) || { month: new Date().getMonth() + 1, yearBe: new Date().getFullYear() + 543 };
  return {
    month: Number(parts.month) || new Date().getMonth() + 1,
    yearBe: Number(parts.yearBe) || new Date().getFullYear() + 543,
    monthKey: `${Number(parts.yearBe) || new Date().getFullYear() + 543}-${pad2(Number(parts.month) || new Date().getMonth() + 1)}`,
  };
};

const shouldCountSelectedMonthAsDueForOverdueReport = (
  reportYearBe: number,
  reportMonth: number,
  lastClosedAccountingMonthKey: unknown,
) => {
  const selectedMonthKey = `${Number(reportYearBe) || 0}-${pad2(Number(reportMonth) || 1)}`;
  const closedMonthKey = normalizeText(lastClosedAccountingMonthKey);
  if (/^\d{4}-\d{2}$/.test(closedMonthKey)) {
    return selectedMonthKey <= closedMonthKey;
  }
  return selectedMonthKey < getCurrentThaiMonthContext().monthKey;
};

const normalizeLoanCreatedAt = (value: unknown) => parseThaiDateParts(value)?.dateOnly || "";

const normalizeTransactionStatus = (status: unknown) => normalizeText(status) || "ปกติ";
const isInactiveTransactionStatus = (status: unknown) => {
  const normalized = normalizeTransactionStatus(status);
  return normalized === "ยกเลิก" || normalized === "กลับรายการ";
};

const deriveLoanStatusFromState = (balance: unknown, missedMonths: unknown, fallbackStatus: unknown) => {
  const remainingBalance = Number(balance) || 0;
  const arrears = Number(missedMonths) || 0;
  const fallback = normalizeText(fallbackStatus);
  if (remainingBalance <= 0) {
    return fallback.includes("กลบหนี้") ? fallback : "ปิดบัญชี";
  }
  if (arrears > 0) return "ค้างชำระ";
  return fallback || "ปกติ";
};

const normalizeJsonSetting = <T extends JsonValue>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  if (typeof value === "object") return value as T;
  return fallback;
};

const buildDashboardOverviewStatsFromLoans = (loansData: Array<Record<string, unknown>>, totalMembers: number) => {
  const summary = {
    totalLoanAmount: 0,
    totalOutstandingBalance: 0,
    totalMembers: Math.max(0, Number(totalMembers) || 0),
    activeLoanCount: 0,
    pendingApprovalCount: 0,
    nplCount: 0,
    nplRatio: "0.0",
  };
  for (const loan of loansData) {
    const amount = Number(loan.amount) || 0;
    const balance = Number(loan.balance) || 0;
    const status = normalizeText(loan.status);
    summary.totalLoanAmount += amount;
    if (balance > 0 && status !== "ปิดบัญชี" && !status.includes("กลบหนี้")) {
      summary.activeLoanCount += 1;
      summary.totalOutstandingBalance += balance;
    }
    if (status === "รออนุมัติ") summary.pendingApprovalCount += 1;
    if (status.includes("ค้างชำระ")) summary.nplCount += 1;
  }
  summary.nplRatio = loansData.length > 0 ? ((summary.nplCount / loansData.length) * 100).toFixed(1) : "0.0";
  return summary;
};

const toBytes = (value: string) => new TextEncoder().encode(value);
const bytesToString = (value: Uint8Array) => new TextDecoder().decode(value);

const bytesToHex = (value: Uint8Array) => Array.from(value).map((byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", toBytes(value));
  return bytesToHex(new Uint8Array(digest));
};

const base64UrlEncode = (input: Uint8Array) =>
  btoa(String.fromCharCode(...input)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const base64UrlDecode = (input: string) => {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const signHmac = async (secret: string, payload: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    toBytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, toBytes(payload));
  return base64UrlEncode(new Uint8Array(signature));
};

const normalizePinInput = (value: unknown) => String(value ?? "").replace(/\D/g, "").trim();
const isValidSixDigitPin = (value: unknown) => /^\d{6}$/.test(String(value ?? "").trim());

const computePinUniqueKey = async (pinValue: unknown) => {
  const pin = normalizePinInput(pinValue);
  if (!pin) return "";
  const { pinUniquePepper } = getEnv();
  return sha256Hex(`${pin}|${pinUniquePepper}`);
};

const buildStrongPasswordHash = async (password: unknown, salt: unknown, iterations: unknown) => {
  const safePassword = normalizeText(password);
  const safeSalt = normalizeText(salt);
  const rounds = Math.max(1000, Number(iterations) || 10000);
  let digestInput = `${safePassword}|${safeSalt}`;
  for (let index = 0; index < rounds; index += 1) {
    digestInput = await sha256Hex(digestInput);
  }
  return digestInput;
};

const verifyPasswordAgainstStoredHash = async (password: unknown, storedHash: unknown) => {
  const safeStoredHash = normalizeText(storedHash);
  if (!safeStoredHash) return false;
  if (/^v2\$\d+\$[A-Za-z0-9]+\$[a-f0-9]{64}$/i.test(safeStoredHash)) {
    const parts = safeStoredHash.split("$");
    const iterations = Number(parts[1]) || 10000;
    const salt = parts[2] || "";
    const expected = parts[3] || "";
    return await buildStrongPasswordHash(password, salt, iterations) === expected;
  }
  return await sha256Hex(String(password ?? "")) === safeStoredHash;
};

const getLoginLockoutState = (identity: unknown) => {
  const normalized = normalizeText(identity);
  if (!normalized) return { locked: false };
  const lockedUntil = Number(loginLockState.get(normalized) || 0);
  if (lockedUntil > Date.now()) {
    return { locked: true };
  }
  if (lockedUntil) loginLockState.delete(normalized);
  return { locked: false };
};

const registerFailedLoginAttempt = (identity: unknown) => {
  const normalized = normalizeText(identity);
  if (!normalized) return { locked: false, attempts: 0 };
  const now = Date.now();
  const current = loginAttemptState.get(normalized);
  const attempts = current && current.expiresAt > now ? current.attempts + 1 : 1;
  if (attempts >= MAX_LOGIN_ATTEMPTS) {
    loginLockState.set(normalized, now + LOGIN_LOCKOUT_SECONDS * 1000);
    loginAttemptState.delete(normalized);
    return { locked: true, attempts };
  }
  loginAttemptState.set(normalized, { attempts, expiresAt: now + LOGIN_LOCKOUT_SECONDS * 1000 });
  return { locked: false, attempts };
};

const clearFailedLoginAttempts = (identity: unknown) => {
  const normalized = normalizeText(identity);
  if (!normalized) return;
  loginAttemptState.delete(normalized);
  loginLockState.delete(normalized);
};

const encodeSessionToken = async (session: SessionData) => {
  const { sessionSigningSecret } = ensureConfigured();
  const payload = {
    ...session,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const payloadText = JSON.stringify(payload);
  const payloadEncoded = base64UrlEncode(toBytes(payloadText));
  const signature = await signHmac(sessionSigningSecret, payloadEncoded);
  return `bl1.${payloadEncoded}.${signature}`;
};

const decodeSessionToken = async (token: string): Promise<SessionData | null> => {
  const normalizedToken = normalizeText(token);
  if (!normalizedToken) return null;
  const parts = normalizedToken.split(".");
  if (parts.length !== 3 || parts[0] !== "bl1") return null;
  const { sessionSigningSecret } = ensureConfigured();
  const expectedSignature = await signHmac(sessionSigningSecret, parts[1]);
  if (expectedSignature !== parts[2]) return null;
  try {
    const parsed = JSON.parse(bytesToString(base64UrlDecode(parts[1]))) as SessionData & { exp?: number };
    if (!parsed?.username) return null;
    if (Number(parsed.exp) > 0 && Number(parsed.exp) < Math.floor(Date.now() / 1000)) return null;
    return {
      userId: normalizeText(parsed.userId),
      username: normalizeText(parsed.username),
      fullName: normalizeText(parsed.fullName || parsed.username),
      role: normalizeRole(parsed.role),
      issuedAt: normalizeText(parsed.issuedAt) || new Date().toISOString(),
      email: normalizeText(parsed.email),
      permissions: Array.isArray(parsed.permissions) ? parsed.permissions.map((item) => normalizeText(item)).filter(Boolean) : undefined,
      staffPortalUnlocked: !!parsed.staffPortalUnlocked,
      staffPortalUnlockedAt: normalizeText(parsed.staffPortalUnlockedAt),
    };
  } catch {
    return null;
  }
};

const createDirectAccessSession = (): SessionData => ({
  userId: "direct-access",
  username: "admin",
  fullName: "ผู้ดูแลระบบ",
  role: "admin",
  issuedAt: new Date().toISOString(),
  permissions: getAllPermissionKeys(),
  staffPortalUnlocked: true,
  staffPortalUnlockedAt: formatThaiDateTime(new Date()),
});

const buildQueryString = (query: Record<string, string>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === "") continue;
    params.append(key, value);
  }
  const built = params.toString();
  return built ? `?${built}` : "";
};

const callSupabase = async (
  tableName: string,
  query: Record<string, string>,
): Promise<SupabaseRow[]> => {
  return callSupabaseRequest("GET", tableName, query);
};

const callSupabaseRequest = async (
  method: string,
  tableName: string,
  query: Record<string, string>,
  payload?: JsonObject,
  extraHeaders: Record<string, string> = {},
): Promise<SupabaseRow[]> => {
  const { supabaseUrl, serviceRoleKey } = ensureConfigured();
  const endpoint = `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/${encodeURIComponent(tableName)}${buildQueryString(query)}`;
  const response = await fetch(endpoint, {
    method,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json",
      ...(payload ? { "Content-Type": "application/json" } : {}),
      ...extraHeaders,
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  if (!response.ok) {
    const errorText = normalizeText(await response.text());
    throw new Error(`Supabase REST API error (${response.status}): ${errorText || "unknown error"}`);
  }
  if (response.status === 204) return [];
  const data = await response.json();
  return Array.isArray(data) ? (data as SupabaseRow[]) : [];
};

const patchSupabaseRows = async (
  tableName: string,
  query: Record<string, string>,
  payload: JsonObject,
) => {
  await callSupabaseRequest("PATCH", tableName, query, payload, { Prefer: "return=minimal" });
};

const getSettingsMapSnapshot = async (): Promise<SettingsMap> => {
  const rows = await callSupabase("app_settings", {
    select: "key,value_text,value_json",
    order: "key.asc",
    limit: "5000",
  });
  const settingsMap: SettingsMap = {};
  for (const row of rows) {
    const key = normalizeText(row.key);
    if (!key) continue;
    settingsMap[key] = row.value_json ?? row.value_text;
  }
  return settingsMap;
};

const buildCurrentUserSnapshot = async (session: SessionData) => {
  const username = normalizeText(session.username);
  if (!username) {
    return {
      userId: normalizeText(session.userId),
      username: "admin",
      fullName: normalizeText(session.fullName) || "ผู้ดูแลระบบ",
      email: "",
      role: normalizeRole(session.role),
      permissions: getAllPermissionKeys(),
      staffPortalUnlocked: true,
      staffPortalUnlockedAt: formatThaiDateTime(new Date()),
      permissionCatalog: getPermissionCatalog(),
    };
  }

  const rows = await callSupabase("app_users", {
    select: "user_id,username,full_name,email,role,status,email_verified_at_text,pin_hash,permissions_json",
    username: `eq.${username}`,
    limit: "1",
  });
  const userRow = rows[0] || null;

  if (!userRow) {
    return {
      userId: normalizeText(session.userId) || "direct-access",
      username,
      fullName: normalizeText(session.fullName) || username,
      email: normalizeText(session.email),
      role: normalizeRole(session.role),
      permissions: Array.isArray(session.permissions) && session.permissions.length ? session.permissions : getAllPermissionKeys(),
      staffPortalUnlocked: !!session.staffPortalUnlocked,
      staffPortalUnlockedAt: normalizeText(session.staffPortalUnlockedAt),
      permissionCatalog: getPermissionCatalog(),
    };
  }

  const permissions = getEffectivePermissions(userRow, normalizeRole(userRow.role));
  return {
    userId: normalizeText(userRow.user_id),
    username: normalizeText(userRow.username) || username,
    fullName: normalizeText(userRow.full_name) || normalizeText(session.fullName) || username,
    email: normalizeLower(userRow.email),
    role: normalizeRole(userRow.role),
    status: normalizeUserStatus(userRow.status),
    emailVerifiedAt: normalizeText(userRow.email_verified_at_text),
    hasPin: !!normalizeText(userRow.pin_hash),
    permissions,
    staffPortalUnlocked: !!session.staffPortalUnlocked,
    staffPortalUnlockedAt: normalizeText(session.staffPortalUnlockedAt),
    permissionCatalog: getPermissionCatalog(),
  };
};

const findUserByUsername = async (username: unknown) => {
  const normalizedUsername = normalizeLower(username);
  if (!normalizedUsername) return null;
  const rows = await callSupabase("app_users", {
    select: "user_id,username,full_name,email,role,status,email_verified_at_text,pin_hash,pin_unique_key,permissions_json,last_login_at_text,updated_at_text",
    username: `eq.${normalizedUsername}`,
    limit: "1",
  });
  return rows[0] || null;
};

const findUserByLoginPin = async (pinValue: unknown) => {
  const normalizedPin = normalizePinInput(pinValue);
  if (!isValidSixDigitPin(normalizedPin)) return null;

  const directPinUniqueKey = await computePinUniqueKey(normalizedPin);
  if (directPinUniqueKey) {
    const directRows = await callSupabase("app_users", {
      select: "user_id,username,full_name,email,role,status,email_verified_at_text,pin_hash,pin_unique_key,permissions_json,last_login_at_text,updated_at_text",
      pin_unique_key: `eq.${directPinUniqueKey}`,
      limit: "2",
    });
    if (directRows.length === 1) return directRows[0];
    if (directRows.length > 1) {
      throw new Error("PIN นี้ซ้ำกับหลายบัญชี กรุณาติดต่อผู้ดูแลระบบ");
    }
  }

  const candidateRows = await callSupabase("app_users", {
    select: "user_id,username,full_name,email,role,status,email_verified_at_text,pin_hash,pin_unique_key,permissions_json,last_login_at_text,updated_at_text",
    not: "pin_hash.is.null",
    limit: "5000",
  });
  let matchedUser: SupabaseRow | null = null;
  for (const user of candidateRows) {
    if (!normalizeText(user.pin_hash)) continue;
    if (!await verifyPasswordAgainstStoredHash(normalizedPin, user.pin_hash)) continue;
    if (matchedUser && normalizeText(matchedUser.user_id) !== normalizeText(user.user_id)) {
      throw new Error("PIN นี้ซ้ำกับหลายบัญชี กรุณาติดต่อผู้ดูแลระบบ");
    }
    matchedUser = user;
  }
  return matchedUser;
};

const verifyLoginPin = async (payload: RpcPayload) => {
  const pinOrUsername = payload.args?.[0];
  const pinMaybe = payload.args?.[1];
  let normalizedUsername = "";
  let normalizedPin = "";

  if (pinMaybe !== undefined && pinMaybe !== null && normalizeText(pinMaybe) !== "") {
    normalizedUsername = normalizeLower(pinOrUsername);
    normalizedPin = normalizePinInput(pinMaybe);
  } else {
    const firstArg = normalizeText(pinOrUsername);
    if (isValidSixDigitPin(firstArg)) {
      normalizedPin = normalizePinInput(firstArg);
    } else {
      normalizedUsername = normalizeLower(firstArg);
    }
  }

  if (!normalizedPin && isValidSixDigitPin(pinOrUsername)) {
    normalizedPin = normalizePinInput(pinOrUsername);
    normalizedUsername = "";
  }

  if (!isValidSixDigitPin(normalizedPin)) {
    return { status: "Error", message: "กรุณากรอก PIN 6 หลัก" } as JsonObject;
  }

  const lockIdentity = normalizedUsername || `pin:${await computePinUniqueKey(normalizedPin)}`;
  if (getLoginLockoutState(lockIdentity).locked) {
    return {
      status: "Locked",
      message: "พยายามเข้าสู่ระบบผิดเกินกำหนด กรุณารอ 15 นาทีแล้วลองใหม่อีกครั้ง",
    } as JsonObject;
  }

  let userRecord: SupabaseRow | null = null;
  try {
    userRecord = normalizedUsername ? await findUserByUsername(normalizedUsername) : await findUserByLoginPin(normalizedPin);
  } catch (error) {
    return {
      status: "Error",
      message: (error as Error)?.message || "ไม่สามารถตรวจสอบ PIN ได้",
    } as JsonObject;
  }

  if (!userRecord || !normalizeText(userRecord.pin_hash)) {
    const failedState = registerFailedLoginAttempt(lockIdentity);
    return {
      status: failedState.locked ? "Locked" : "Error",
      message: failedState.locked
        ? "พยายามเข้าสู่ระบบผิดเกินกำหนด กรุณารอ 15 นาทีแล้วลองใหม่อีกครั้ง"
        : (normalizedUsername ? "ชื่อผู้ใช้ หรือ PIN ไม่ถูกต้อง" : "PIN ไม่ถูกต้อง"),
    } as JsonObject;
  }

  const normalizedStatus = normalizeUserStatus(userRecord.status || USER_STATUS_PENDING);
  if (normalizedStatus !== USER_STATUS_ACTIVE) {
    return {
      status: "Error",
      message: normalizedStatus === USER_STATUS_PENDING
        ? "บัญชีของคุณอยู่ระหว่างรออนุมัติจากผู้ดูแลระบบ"
        : "บัญชีผู้ใช้นี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ",
    } as JsonObject;
  }

  if (!normalizeText(userRecord.email_verified_at_text)) {
    return {
      status: "Error",
      message: "บัญชีนี้ยังไม่ได้ยืนยันอีเมล กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ",
    } as JsonObject;
  }

  const pinMatched = await verifyPasswordAgainstStoredHash(normalizedPin, userRecord.pin_hash);
  if (!pinMatched) {
    const failedState = registerFailedLoginAttempt(normalizeText(userRecord.username) || lockIdentity);
    return {
      status: failedState.locked ? "Locked" : "Error",
      message: failedState.locked
        ? "พยายามเข้าสู่ระบบผิดเกินกำหนด กรุณารอ 15 นาทีแล้วลองใหม่อีกครั้ง"
        : (normalizedUsername ? "ชื่อผู้ใช้ หรือ PIN ไม่ถูกต้อง" : "PIN ไม่ถูกต้อง"),
    } as JsonObject;
  }

  const permissions = getEffectivePermissions(userRecord, normalizeRole(userRecord.role));
  const loginAt = formatThaiDateTime(new Date());
  if (normalizeText(userRecord.user_id)) {
    try {
      await patchSupabaseRows(
        "app_users",
        { user_id: `eq.${normalizeText(userRecord.user_id)}` },
        {
          last_login_at_text: loginAt,
          updated_at_text: loginAt,
        },
      );
    } catch {
      // Keep login successful even if audit timestamps cannot be updated.
    }
  }

  clearFailedLoginAttempts(lockIdentity);
  clearFailedLoginAttempts(normalizeText(userRecord.username) || lockIdentity);

  const authenticatedSession: SessionData = {
    userId: normalizeText(userRecord.user_id),
    username: normalizeText(userRecord.username),
    fullName: normalizeText(userRecord.full_name) || normalizeText(userRecord.username),
    role: normalizeRole(userRecord.role),
    issuedAt: new Date().toISOString(),
    email: normalizeLower(userRecord.email),
    permissions,
    staffPortalUnlocked: false,
    staffPortalUnlockedAt: "",
  };
  const sessionToken = await encodeSessionToken(authenticatedSession);
  return {
    status: "Success",
    username: authenticatedSession.username,
    fullName: authenticatedSession.fullName,
    email: normalizeText(userRecord.email),
    role: authenticatedSession.role || "staff",
    permissions,
    permissionCatalog: getPermissionCatalog(),
    staffPortalUnlocked: false,
    staffPortalUnlockedAt: "",
    sessionToken,
    backendMode: "supabase-edge-function",
  } as JsonObject;
};

const resolveSession = async (payload: RpcPayload) => {
  const env = ensureConfigured();
  const tokenSession = await decodeSessionToken(normalizeText(payload.sessionToken));
  if (tokenSession) {
    const currentUser = await buildCurrentUserSnapshot(tokenSession);
    if (env.loginRequired) {
      if (!currentUser.username) {
        throw new Error("UNAUTHORIZED: กรุณาเข้าสู่ระบบใหม่อีกครั้ง");
      }
      const normalizedStatus = normalizeUserStatus(currentUser.status);
      if (normalizedStatus !== USER_STATUS_ACTIVE) {
        throw new Error(
          normalizedStatus === USER_STATUS_PENDING
            ? "FORBIDDEN: บัญชีของคุณอยู่ระหว่างรออนุมัติจากผู้ดูแลระบบ"
            : "FORBIDDEN: บัญชีผู้ใช้นี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ",
        );
      }
    }
    return {
      session: {
        userId: normalizeText(currentUser.userId || tokenSession.userId),
        username: normalizeText(currentUser.username || tokenSession.username),
        fullName: normalizeText(currentUser.fullName || tokenSession.fullName || tokenSession.username),
        role: normalizeRole(currentUser.role || tokenSession.role),
        issuedAt: normalizeText(tokenSession.issuedAt) || new Date().toISOString(),
        email: normalizeText(currentUser.email || tokenSession.email),
        permissions: Array.isArray(currentUser.permissions) ? currentUser.permissions : tokenSession.permissions,
        staffPortalUnlocked: !!currentUser.staffPortalUnlocked,
        staffPortalUnlockedAt: normalizeText(currentUser.staffPortalUnlockedAt),
      },
      currentUser,
    };
  }

  if (!env.loginRequired) {
    const session = createDirectAccessSession();
    return {
      session,
      currentUser: {
        userId: session.userId,
        username: session.username,
        fullName: session.fullName,
        email: "",
        role: session.role,
        permissions: session.permissions || getAllPermissionKeys(),
        staffPortalUnlocked: true,
        staffPortalUnlockedAt: session.staffPortalUnlockedAt,
        permissionCatalog: getPermissionCatalog(),
      },
    };
  }

  throw new Error("UNAUTHORIZED: กรุณาเข้าสู่ระบบใหม่อีกครั้ง");
};

const buildRuntimeLoanDataFromSupabaseRow = (row: SupabaseRow, currentMonthContext: { month: number; yearBe: number; monthKey: string }) => {
  const balance = Number(row.outstanding_balance) || 0;
  const overdueMonths = Math.max(0, Number(row.overdue_months) || 0);
  return {
    memberId: normalizeText(row.member_id),
    contract: normalizeText(row.contract_no),
    member: normalizeText(row.borrower_name),
    amount: Number(row.principal_amount) || 0,
    interest: Number(row.interest_rate) || 0,
    balance,
    status: deriveLoanStatusFromState(balance, overdueMonths, row.status),
    nextPayment: normalizeText(row.due_date_text),
    missedInterestMonths: overdueMonths,
    reportMissedInterestMonths: overdueMonths,
    currentMonthRequiredInstallment: 0,
    currentMonthInterestPaid: false,
    currentMonthKey: currentMonthContext.monthKey,
    paidInterestInstallmentsYtd: 0,
    dueInterestInstallmentsYtd: overdueMonths,
    maxInterestInstallments: 1,
    createdAt: normalizeLoanCreatedAt(row.created_date_text),
    guarantor1: normalizeText(row.guarantor_1),
    guarantor2: normalizeText(row.guarantor_2),
  };
};

const buildRuntimeTransactionDataFromSupabaseRow = (row: SupabaseRow) => {
  const timestamp = normalizeText(row.occurred_on_text);
  const parts = parseThaiDateParts(timestamp);
  const sortKey = parts
    ? `${parts.yearBe}${pad2(parts.month)}${pad2(parts.day)}${pad2(parts.hour)}${pad2(parts.minute)}${pad2(parts.second)}`
    : timestamp;
  return {
    id: normalizeText(row.reference_id),
    timestamp,
    contract: normalizeText(row.contract_no),
    memberId: normalizeText(row.member_id),
    principalPaid: Number(row.principal_paid) || 0,
    interestPaid: Number(row.interest_paid) || 0,
    newBalance: Number(row.outstanding_balance) || 0,
    note: normalizeText(row.note),
    memberName: normalizeText(row.full_name),
    txStatus: normalizeTransactionStatus(row.tx_status),
    interestMonthsPaid: Number(row.interest_months_paid) || 0,
    missedBeforePayment: Number(row.overdue_interest_before) || 0,
    missedAfterPayment: Number(row.overdue_interest_after) || 0,
    _sortKey: sortKey,
  };
};

const buildCurrentMonthInterestPaidMapFromSupabaseRows = (
  rows: SupabaseRow[],
  currentMonthContext: { month: number; yearBe: number },
) => {
  const map: Record<string, boolean> = {};
  for (const row of rows) {
    if (isInactiveTransactionStatus(row.tx_status)) continue;
    const parts = parseThaiDateParts(row.occurred_on_text);
    if (!parts) continue;
    if (Number(parts.yearBe) !== Number(currentMonthContext.yearBe) || Number(parts.month) !== Number(currentMonthContext.month)) {
      continue;
    }
    const contractNo = normalizeText(row.contract_no);
    if (contractNo) map[contractNo] = true;
  }
  return map;
};

const buildPaymentLoanFromSupabaseLoanRow = (
  row: SupabaseRow,
  currentMonthContext: { month: number; yearBe: number },
  currentMonthInterestPaidMap: Record<string, boolean>,
  lastClosedAccountingMonth: unknown,
) => {
  const balance = Number(row.outstanding_balance) || 0;
  const interestRate = Number.isFinite(Number(row.interest_rate)) && Number(row.interest_rate) >= 0
    ? Number(row.interest_rate)
    : DEFAULT_INTEREST_RATE;
  const contractNo = normalizeText(row.contract_no);
  const missedInterestMonths = Math.max(0, Number(row.overdue_months) || 0);
  const currentMonthInterestPaid = !!currentMonthInterestPaidMap[contractNo];
  const includeCurrentMonthInstallment = shouldCountSelectedMonthAsDueForOverdueReport(
    currentMonthContext.yearBe,
    currentMonthContext.month,
    lastClosedAccountingMonth,
  );
  const currentMonthRequiredInstallment = includeCurrentMonthInstallment && !currentMonthInterestPaid ? 1 : 0;
  const reportMissedInterestMonths = missedInterestMonths + currentMonthRequiredInstallment;
  return {
    memberId: normalizeText(row.member_id),
    contract: contractNo,
    member: normalizeText(row.borrower_name),
    amount: Number(row.principal_amount) || 0,
    interest: interestRate,
    balance,
    status: deriveLoanStatusFromState(balance, missedInterestMonths, row.status),
    nextPayment: normalizeText(row.due_date_text),
    missedInterestMonths,
    currentMonthInterestPaid,
    reportMissedInterestMonths,
    currentMonthRequiredInstallment,
    maxInterestInstallments: Math.max(1, reportMissedInterestMonths),
    monthlyInterestDue: Math.max(0, Math.floor(Math.max(0, balance) * (interestRate / 100) / 12)),
    createdAt: normalizeLoanCreatedAt(row.created_date_text),
    guarantor1: normalizeText(row.guarantor_1),
    guarantor2: normalizeText(row.guarantor_2),
  };
};

const buildAppRuntimePayload = async (session: SessionData, includeMembers: boolean) => {
  const settingsMap = await getSettingsMapSnapshot();
  const currentMonthContext = getCurrentThaiMonthContext();

  const [loanRows, transactionRows, memberRows] = await Promise.all([
    callSupabase("loans", {
      select: "contract_no,member_id,borrower_name,principal_amount,interest_rate,outstanding_balance,status,due_date_text,overdue_months,created_date_text,guarantor_1,guarantor_2",
      order: "contract_no.asc",
      limit: "5000",
    }),
    callSupabase("transactions", {
      select: "reference_id,occurred_on_text,contract_no,member_id,principal_paid,interest_paid,outstanding_balance,note,actor,full_name,tx_status,interest_months_paid,overdue_interest_before,overdue_interest_after",
      order: "updated_at.desc",
      limit: "200",
    }),
    includeMembers
      ? callSupabase("members", {
        select: "member_id,full_name,status",
        order: "member_id.asc",
        limit: "5000",
      })
      : Promise.resolve([]),
  ]);

  const loans = loanRows.map((row) => buildRuntimeLoanDataFromSupabaseRow(row, currentMonthContext));
  const transactions = transactionRows
    .map(buildRuntimeTransactionDataFromSupabaseRow)
    .filter((row) => !isInactiveTransactionStatus(row.txStatus))
    .sort((a, b) => String(b._sortKey || "").localeCompare(String(a._sortKey || "")))
    .slice(0, 100)
    .map(({ _sortKey, ...row }) => row);

  const currentUser = includeMembers ? await buildCurrentUserSnapshot(session) : null;
  const members = includeMembers
    ? memberRows.map((row) => ({
      id: normalizeText(row.member_id),
      name: normalizeText(row.full_name),
      status: normalizeText(row.status),
    }))
    : [];

  const payload: JsonObject = {
    loans,
    transactions,
    monthlyDashboardCoverCards: [],
    dashboardSummaryYearBe: currentMonthContext.yearBe,
    dashboardOverviewStats: buildDashboardOverviewStatsFromLoans(loans, includeMembers ? members.length : 0),
    settings: {
      interestRate: Number(settingsMap.InterestRate) || DEFAULT_INTEREST_RATE,
      dailyInterestAutomationEnabled: false,
      dailyInterestAutomationSchedule: "คำนวณค้างดอกเมื่อกดปิดยอดสิ้นวัน",
      lastClosedAccountingMonth: normalizeText(settingsMap.LastClosedAccountingMonth),
      lastClosedAccountingAt: normalizeText(settingsMap.LastClosedAccountingAt),
      operatingDayCalendar: normalizeJsonSetting<Record<string, string>>(settingsMap[OPERATING_DAY_CALENDAR_SETTING_KEY], {}),
      reportLayoutSettings: normalizeJsonSetting<Record<string, JsonValue>>(settingsMap[REPORT_LAYOUT_SETTINGS_KEY], {}),
      menuSettings: normalizeJsonSetting<Record<string, JsonValue>>(settingsMap[MENU_SETTINGS_KEY], {}),
    },
  };

  if (includeMembers) {
    payload.members = members;
    payload.currentUser = {
      userId: normalizeText(currentUser?.userId || session.userId),
      username: normalizeText(currentUser?.username || session.username),
      fullName: normalizeText(currentUser?.fullName || session.fullName || session.username),
      email: normalizeLower(currentUser?.email),
      role: normalizeRole(currentUser?.role || session.role),
      permissions: Array.isArray(currentUser?.permissions) ? currentUser.permissions : getAllPermissionKeys(),
      staffPortalUnlocked: !!currentUser?.staffPortalUnlocked,
      staffPortalUnlockedAt: normalizeText(currentUser?.staffPortalUnlockedAt),
      permissionCatalog: getPermissionCatalog(),
    };
  }

  return payload;
};

const buildPaymentReadyData = async () => {
  const settingsMap = await getSettingsMapSnapshot();
  const currentMonthContext = getCurrentThaiMonthContext();
  const [loanRows, transactionRows] = await Promise.all([
    callSupabase("loans", {
      select: "contract_no,member_id,borrower_name,principal_amount,interest_rate,outstanding_balance,status,due_date_text,overdue_months,created_date_text,guarantor_1,guarantor_2",
      order: "member_id.asc,contract_no.asc",
      limit: "5000",
    }),
    callSupabase("transactions", {
      select: "contract_no,occurred_on_text,tx_status",
      order: "updated_at.desc",
      limit: "5000",
    }),
  ]);
  const currentMonthInterestPaidMap = buildCurrentMonthInterestPaidMapFromSupabaseRows(transactionRows, currentMonthContext);
  return {
    loans: loanRows.map((row) =>
      buildPaymentLoanFromSupabaseLoanRow(
        row,
        currentMonthContext,
        currentMonthInterestPaidMap,
        settingsMap.LastClosedAccountingMonth,
      )
    ),
    settings: {
      interestRate: Number(settingsMap.InterestRate) || DEFAULT_INTEREST_RATE,
    },
  };
};

const buildPaymentTodayTransactionFromSupabaseRow = (row: SupabaseRow) => ({
  id: normalizeText(row.reference_id),
  timestamp: normalizeText(row.occurred_on_text),
  contract: normalizeText(row.contract_no),
  memberId: normalizeText(row.member_id),
  principalPaid: Number(row.principal_paid) || 0,
  interestPaid: Number(row.interest_paid) || 0,
  newBalance: Number(row.outstanding_balance) || 0,
  note: normalizeText(row.note),
  memberName: normalizeText(row.full_name),
  txStatus: normalizeTransactionStatus(row.tx_status),
  interestMonthsPaid: Math.max(0, Number(row.interest_months_paid) || 0),
});

const getPaymentLookupByMemberId = async (memberId: unknown) => {
  const normalizedMemberId = normalizeText(memberId);
  if (!normalizedMemberId) {
    return {
      status: "Error",
      message: "กรุณาระบุรหัสสมาชิก",
      loans: [],
      todayTransactions: [],
    };
  }

  const settingsMap = await getSettingsMapSnapshot();
  const currentMonthContext = getCurrentThaiMonthContext();
  const [loanRows, txRows] = await Promise.all([
    callSupabase("loans", {
      select: "contract_no,member_id,borrower_name,principal_amount,interest_rate,outstanding_balance,status,due_date_text,overdue_months,created_date_text,guarantor_1,guarantor_2",
      member_id: `eq.${normalizedMemberId}`,
      order: "outstanding_balance.desc,contract_no.asc",
      limit: "500",
    }),
    callSupabase("transactions", {
      select: "contract_no,occurred_on_text,tx_status",
      member_id: `eq.${normalizedMemberId}`,
      order: "updated_at.desc",
      limit: "1000",
    }),
  ]);
  const currentMonthInterestPaidMap = buildCurrentMonthInterestPaidMapFromSupabaseRows(txRows, currentMonthContext);
  const loans = loanRows.map((row) =>
    buildPaymentLoanFromSupabaseLoanRow(
      row,
      currentMonthContext,
      currentMonthInterestPaidMap,
      settingsMap.LastClosedAccountingMonth,
    )
  ).sort((a, b) => {
    const balanceDiff = (Number(b.balance) || 0) - (Number(a.balance) || 0);
    if (balanceDiff !== 0) return balanceDiff;
    return String(a.contract || "").localeCompare(String(b.contract || ""), "th", { numeric: true, sensitivity: "base" });
  });

  return {
    memberId: normalizedMemberId,
    memberName: loans.length ? normalizeText(loans[0].member) : "",
    loans,
    todayTransactions: [],
    interestRate: Number(settingsMap.InterestRate) || DEFAULT_INTEREST_RATE,
  };
};

const getTodayTransactionsForMemberPaymentEdit = async (memberId: unknown) => {
  const normalizedMemberId = normalizeText(memberId);
  if (!normalizedMemberId) {
    return {
      status: "Error",
      message: "กรุณาระบุรหัสสมาชิก",
      transactions: [],
    };
  }

  const todayThaiDate = formatThaiDate(new Date());
  const rows = await callSupabase("transactions", {
    select: "reference_id,occurred_on_text,contract_no,member_id,principal_paid,interest_paid,outstanding_balance,note,full_name,tx_status,interest_months_paid,overdue_interest_before,overdue_interest_after",
    member_id: `eq.${normalizedMemberId}`,
    order: "updated_at.desc",
    limit: "500",
  });
  const transactions = rows
    .map(buildPaymentTodayTransactionFromSupabaseRow)
    .filter((tx) => !isInactiveTransactionStatus(tx.txStatus))
    .filter((tx) => {
      const dateOnly = normalizeText(tx.timestamp).split(" ")[0] || "";
      return dateOnly === todayThaiDate;
    })
    .sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));

  return {
    memberId: normalizedMemberId,
    memberName: transactions.length ? normalizeText(transactions[0].memberName) : "",
    transactions,
  };
};

const handlers: Record<string, (payload: RpcPayload) => Promise<Response>> = {
  async health() {
    return success({
      backend: "supabase-edge-function",
      functionName: "app-api",
      availableMethods: backendMethodNames,
    });
  },
  async listMethods() {
    return success({
      groups: backendMethodGroups as unknown as JsonValue[],
    });
  },
  async createGuestSession(payload) {
    try {
      const { session } = await resolveSession(payload);
      const sessionToken = await encodeSessionToken(session);
      return success({
        sessionToken,
        username: session.username || "admin",
        role: session.role || "admin",
      });
    } catch (error) {
      return appError((error as Error)?.message || "ไม่สามารถสร้าง session ได้", "CREATE_GUEST_SESSION_FAILED");
    }
  },
  async getSessionSnapshot(payload) {
    try {
      const { session } = await resolveSession(payload);
      return success({
        username: session.username,
        fullName: session.fullName || session.username,
        role: session.role || "staff",
        serverTime: formatThaiDateTime(new Date()),
      });
    } catch (error) {
      return appError((error as Error)?.message || "ไม่สามารถตรวจสอบสถานะ session ได้", "SESSION_SNAPSHOT_FAILED");
    }
  },
  async getAppRuntimeSnapshot(payload) {
    try {
      const { session } = await resolveSession(payload);
      return success(await buildAppRuntimePayload(session, false));
    } catch (error) {
      return appError((error as Error)?.message || "ไม่สามารถโหลด runtime snapshot ได้", "APP_RUNTIME_SNAPSHOT_FAILED");
    }
  },
  async getAppData(payload) {
    try {
      const { session } = await resolveSession(payload);
      return success(await buildAppRuntimePayload(session, true));
    } catch (error) {
      return appError((error as Error)?.message || "ไม่สามารถโหลดข้อมูลระบบได้", "APP_DATA_FAILED");
    }
  },
  async getPaymentReadyData(payload) {
    try {
      await resolveSession(payload);
      return success(await buildPaymentReadyData());
    } catch (error) {
      return appError((error as Error)?.message || "ไม่สามารถโหลดข้อมูลรับชำระได้", "PAYMENT_READY_DATA_FAILED");
    }
  },
  async getPaymentLookupByMemberId(payload) {
    try {
      await resolveSession(payload);
      return success(await getPaymentLookupByMemberId(payload.args?.[0]));
    } catch (error) {
      return appError((error as Error)?.message || "ค้นหาข้อมูลรับชำระไม่สำเร็จ", "PAYMENT_LOOKUP_FAILED", {
        loans: [],
        todayTransactions: [],
      });
    }
  },
  async getTodayTransactionsForMemberPaymentEdit(payload) {
    try {
      await resolveSession(payload);
      return success(await getTodayTransactionsForMemberPaymentEdit(payload.args?.[0]));
    } catch (error) {
      return appError((error as Error)?.message || "โหลดรายการรับชำระของสมาชิกไม่สำเร็จ", "TODAY_TRANSACTIONS_FAILED", {
        transactions: [],
      });
    }
  },
  async verifyLoginPin(payload) {
    try {
      return success(await verifyLoginPin(payload));
    } catch (error) {
      return appError((error as Error)?.message || "เข้าสู่ระบบไม่สำเร็จ", "VERIFY_LOGIN_PIN_FAILED");
    }
  },
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json(405, { status: "Error", message: "Method not allowed" });
  }

  let payload: RpcPayload = {};
  try {
    payload = (await request.json()) as RpcPayload;
  } catch {
    return json(400, { status: "Error", message: "Invalid JSON payload" });
  }

  const method = String(payload.method || "").trim();
  if (!method) {
    return json(400, { status: "Error", message: "Missing method name" });
  }

  if (handlers[method]) {
    return handlers[method](payload);
  }

  if (backendMethodNames.includes(method)) {
    return notImplemented(method);
  }

  return json(404, {
    status: "Error",
    code: "UNKNOWN_METHOD",
    message: `Unknown backend method '${method}'.`,
  });
});
