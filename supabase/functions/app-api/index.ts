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
const TEMP_GUARANTOR_STATUS = "ผู้ค้ำชั่วคราว";
const DEFAULT_INTEREST_RATE = 12;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_SECONDS = 15 * 60;
const APPROVED_NAME_PREFIXES = [
  "นาย",
  "นาง",
  "นางสาว",
  "เด็กหญิง",
  "เด็กชาย",
] as const;

const loginAttemptState = new Map<
  string,
  { attempts: number; expiresAt: number }
>();
const loginLockState = new Map<string, number>();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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
  { key: "notifications.manage", label: "จัดการการแจ้งเตือนอีเมล" },
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

const appError = (
  message: string,
  code = "APP_ERROR",
  extra: JsonObject = {},
) =>
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
    message:
      `Supabase backend scaffold is ready, but method '${method}' is not implemented yet.`,
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
  if (["suspended", "banned", "disabled", "inactive"].includes(lower)) {
    return USER_STATUS_SUSPENDED;
  }
  if (["pending", "waiting", "awaiting_approval", "รออนุมัติ"].includes(lower)) {
    return USER_STATUS_PENDING;
  }
  return status;
};

const normalizeApprovedPrefix = (value: unknown) => {
  const normalized = normalizeText(value);
  return APPROVED_NAME_PREFIXES.includes(
      normalized as (typeof APPROVED_NAME_PREFIXES)[number],
    )
    ? normalized
    : "";
};

const normalizeHumanNamePart = (value: unknown) =>
  normalizeText(value).replace(/\s+/g, " ").trim();

const buildHumanFullName = (
  prefix: unknown,
  firstName: unknown,
  lastName: unknown,
) => {
  const parts = [
    normalizeApprovedPrefix(prefix),
    normalizeHumanNamePart(firstName),
    normalizeHumanNamePart(lastName),
  ].filter(Boolean);
  return parts.join(" ").trim();
};

const isStrongPasswordInput = (value: unknown) => {
  const text = normalizeText(value);
  return text.length >= 8 || isValidSixDigitPin(text);
};

const sanitizePermissionsJsonText = (value: unknown) => {
  const normalized = parsePermissionsJson(value);
  return JSON.stringify(normalized);
};

const getPermissionCatalog = () =>
  PERMISSION_CATALOG.map((item) => ({ ...item }));
const getAllPermissionKeys = () => PERMISSION_CATALOG.map((item) => item.key);

const getDefaultPermissionMapByRole = (role: unknown) => {
  const normalizedRole = normalizeRole(role);
  const map = Object.fromEntries(
    getAllPermissionKeys().map((key) => [key, false]),
  );
  if (normalizedRole === "admin") {
    for (const key of getAllPermissionKeys()) map[key] = true;
    return map;
  }
  for (
    const key of [
      "dashboard.view",
      "payments.create",
      "payment_records.view",
      "qualifications.view",
      "members.view",
      "loans.view",
      "reports.view",
      "reports.export",
      "profile.view",
    ]
  ) {
    map[key] = true;
  }
  return map;
};

const parsePermissionsJson = (value: unknown): Record<string, boolean> => {
  if (Array.isArray(value)) {
    return Object.fromEntries(
      value.map((item) => [normalizeText(item), true]).filter(([key]) => key),
    );
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map((
        [key, enabled],
      ) => [normalizeText(key), !!enabled]).filter(([key]) => key),
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

const getEffectivePermissions = (
  userRow: SupabaseRow | null,
  roleOverride?: string,
) => {
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

const hasPermission = (session: SessionData, permissionKey: string) => {
  if (normalizeRole(session.role) === "admin") return true;
  const permissions = Array.isArray(session.permissions)
    ? session.permissions
    : [];
  return permissions.includes(permissionKey);
};

const requirePermission = (
  session: SessionData,
  permissionKey: string,
  friendlyMessage: string,
) => {
  if (hasPermission(session, permissionKey)) return;
  throw new Error(
    friendlyMessage || `FORBIDDEN: missing permission ${permissionKey}`,
  );
};

const requireAnyPermission = (
  session: SessionData,
  permissionKeys: string[],
  friendlyMessage: string,
) => {
  for (const permissionKey of permissionKeys) {
    if (hasPermission(session, permissionKey)) return;
  }
  throw new Error(
    friendlyMessage ||
      `FORBIDDEN: missing any permission ${permissionKeys.join(", ")}`,
  );
};

const parseBooleanEnv = (value: string | undefined, fallback: boolean) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
};

const getEnv = () => {
  const supabaseUrl = normalizeText(Deno.env.get("SUPABASE_URL"));
  const serviceRoleKey = normalizeText(
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  );
  const loginRequired = parseBooleanEnv(
    Deno.env.get("APP_LOGIN_REQUIRED"),
    false,
  );
  const sessionSigningSecret =
    normalizeText(Deno.env.get("APP_SESSION_SIGNING_SECRET")) ||
    normalizeText(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const pinUniquePepper = normalizeText(Deno.env.get("PIN_UNIQUE_PEPPER")) ||
    "PIN_UNIQUE_PEPPER_DEFAULT";
  return {
    supabaseUrl,
    serviceRoleKey,
    loginRequired,
    sessionSigningSecret,
    pinUniquePepper,
  };
};

const ensureConfigured = () => {
  const env = getEnv();
  if (!env.supabaseUrl || !env.serviceRoleKey) {
    throw new Error(
      "Supabase Edge Function ยังไม่ได้ตั้งค่า SUPABASE_URL หรือ SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  if (!env.sessionSigningSecret) {
    throw new Error(
      "Supabase Edge Function ยังไม่ได้ตั้งค่า APP_SESSION_SIGNING_SECRET",
    );
  }
  return env;
};

const pad2 = (value: number) =>
  String(Math.max(0, Math.trunc(value || 0))).padStart(2, "0");

const formatThaiDate = (input = new Date()) => {
  const date = new Date(input);
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${
    date.getFullYear() + 543
  }`;
};

const formatThaiDateTime = (input = new Date()) => {
  const date = new Date(input);
  return `${formatThaiDate(date)} ${pad2(date.getHours())}:${
    pad2(date.getMinutes())
  }:${pad2(date.getSeconds())}`;
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
  const slashMatch = text.split(" ")[0]?.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
  );
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
      dateTime: `${pad2(day)}/${pad2(month)}/${yearBe} ${pad2(time.hour)}:${
        pad2(time.minute)
      }:${pad2(time.second)}`,
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
      dateTime: `${pad2(day)}/${pad2(month)}/${yearBe} ${pad2(time.hour)}:${
        pad2(time.minute)
      }:${pad2(time.second)}`,
    };
  }
  const nativeDate = new Date(text.replace(/\s*\([^)]*\)\s*$/, ""));
  if (!Number.isNaN(nativeDate.getTime())) {
    return parseThaiDateParts(nativeDate);
  }
  return null;
};

const getCurrentThaiMonthContext = () => {
  const parts = parseThaiDateParts(new Date()) ||
    {
      month: new Date().getMonth() + 1,
      yearBe: new Date().getFullYear() + 543,
    };
  return {
    month: Number(parts.month) || new Date().getMonth() + 1,
    yearBe: Number(parts.yearBe) || new Date().getFullYear() + 543,
    monthKey: `${Number(parts.yearBe) || new Date().getFullYear() + 543}-${
      pad2(Number(parts.month) || new Date().getMonth() + 1)
    }`,
  };
};

const getUserAdminList = async (payload: RpcPayload) => {
  const { session } = await resolveSession(payload);
  requirePermission(session, "users.manage", "ไม่มีสิทธิ์จัดการผู้ใช้งาน");

  const rows = await callSupabase("app_users", {
    select:
      "user_id,username,full_name,email,prefix,first_name,last_name,email_verified_at_text,role,status,created_at_text,updated_at_text,last_login_at_text,permissions_json",
    order: "username.asc",
    limit: "5000",
  });

  const statusOrder: Record<string, number> = {
    [USER_STATUS_PENDING]: 0,
    [USER_STATUS_ACTIVE]: 1,
    [USER_STATUS_SUSPENDED]: 2,
  };

  const users = rows.map((row) => ({
    userId: normalizeText(row.user_id),
    username: normalizeText(row.username),
    fullName: normalizeText(row.full_name),
    email: normalizeText(row.email),
    prefix: normalizeText(row.prefix),
    firstName: normalizeText(row.first_name),
    lastName: normalizeText(row.last_name),
    emailVerifiedAt: normalizeText(row.email_verified_at_text),
    role: normalizeRole(row.role),
    status: normalizeUserStatus(row.status),
    createdAt: normalizeText(row.created_at_text),
    updatedAt: normalizeText(row.updated_at_text),
    lastLoginAt: normalizeText(row.last_login_at_text),
    permissionsJson: normalizeText(row.permissions_json),
    permissions: getEffectivePermissions(row, normalizeRole(row.role)),
  })).sort((a, b) => {
    const aStatus = normalizeUserStatus(a.status);
    const bStatus = normalizeUserStatus(b.status);
    const diff = (statusOrder[aStatus] ?? 99) - (statusOrder[bStatus] ?? 99);
    if (diff !== 0) return diff;
    return String(a.username || "").localeCompare(String(b.username || ""));
  });

  return { users } as JsonObject;
};

const getAuditLogs = async (payload: RpcPayload) => {
  const { session } = await resolveSession(payload);
  requirePermission(session, "audit.view", "ไม่มีสิทธิ์ดู Audit Logs");

  const rawArg = payload.args?.[0];
  const filter = typeof rawArg === "string"
    ? normalizeSettingsInputObject(JSON.parse(rawArg || "{}"))
    : normalizeSettingsInputObject(rawArg);
  const limit = Math.max(1, Math.min(500, Number(filter.limit) || 150));

  const rows = await callSupabase("audit_logs", {
    select:
      "occurred_at_text,username,display_name,role,action,entity_type,entity_id,reference_no,before_json,after_json,reason,details,log_id",
    order: "log_id.desc",
    limit: String(Math.min(Math.max(limit, 150), 500)),
  });

  const records = rows.map((row) => ({
    timestamp: normalizeText(row.occurred_at_text),
    username: normalizeText(row.username),
    actorName: normalizeText(row.display_name),
    role: normalizeText(row.role),
    action: normalizeText(row.action),
    entityType: normalizeText(row.entity_type),
    entityId: normalizeText(row.entity_id),
    referenceNo: normalizeText(row.reference_no),
    beforeJson: normalizeText(row.before_json),
    afterJson: normalizeText(row.after_json),
    reason: normalizeText(row.reason),
    details: normalizeText(row.details),
  })).filter((record) => {
    return record.timestamp || record.action || record.entityId ||
      record.details;
  });

  return { records: records.slice(0, limit) } as JsonObject;
};

const shouldCountSelectedMonthAsDueForOverdueReport = (
  reportYearBe: number,
  reportMonth: number,
  lastClosedAccountingMonthKey: unknown,
) => {
  const selectedMonthKey = `${Number(reportYearBe) || 0}-${
    pad2(Number(reportMonth) || 1)
  }`;
  const closedMonthKey = normalizeText(lastClosedAccountingMonthKey);
  if (/^\d{4}-\d{2}$/.test(closedMonthKey)) {
    return selectedMonthKey <= closedMonthKey;
  }
  return selectedMonthKey < getCurrentThaiMonthContext().monthKey;
};

const normalizeLoanCreatedAt = (value: unknown) =>
  parseThaiDateParts(value)?.dateOnly || "";

const normalizeTransactionStatus = (status: unknown) =>
  normalizeText(status) || "ปกติ";
const isInactiveTransactionStatus = (status: unknown) => {
  const normalized = normalizeTransactionStatus(status);
  return normalized === "ยกเลิก" || normalized === "กลับรายการ";
};

const normalizeTextForMatch = (value: unknown) =>
  String(value ?? "").replace(/\s+/g, " ").trim();

const validateRequiredTextField = (value: unknown, label: string) => {
  const normalized = normalizeTextForMatch(value);
  if (!normalized) throw new Error(`กรุณาระบุ${label}`);
  return normalized;
};

const validateMemberPayloadForWrite = (
  memberData: Record<string, unknown>,
) => ({
  id: validateRequiredTextField(memberData.id, "รหัสสมาชิก"),
  name: validateRequiredTextField(memberData.name, "ชื่อ-สกุลสมาชิก"),
  status: normalizeTextForMatch(memberData.status) || "ปกติ",
});

const validateLoanPayloadForWrite = (loanData: Record<string, unknown>) => {
  const normalized = {
    memberId: validateRequiredTextField(loanData.memberId, "รหัสสมาชิก"),
    contract: validateRequiredTextField(loanData.contract, "เลขที่สัญญา"),
    member: validateRequiredTextField(loanData.member, "ชื่อ-สกุลสมาชิก"),
    amount: Number(loanData.amount),
    interest: Number(loanData.interest),
    balance: Number(loanData.balance),
    status: normalizeTextForMatch(loanData.status) || "ปกติ",
    nextPayment: String(loanData.nextPayment || "-").trim() || "-",
    missedInterestMonths: Math.max(
      0,
      Number(loanData.missedInterestMonths) || 0,
    ),
    createdAt: loanData.createdAt,
    guarantor1: String(loanData.guarantor1 || ""),
    guarantor2: String(loanData.guarantor2 || ""),
  };

  if (!Number.isFinite(normalized.amount) || normalized.amount <= 0) {
    throw new Error("ยอดเงินกู้ต้องมากกว่า 0");
  }
  if (!Number.isFinite(normalized.interest) || normalized.interest < 0) {
    throw new Error("อัตราดอกเบี้ยต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป");
  }
  if (!Number.isFinite(normalized.balance) || normalized.balance < 0) {
    throw new Error("ยอดคงเหลือต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป");
  }
  if (normalized.balance - normalized.amount > 0.0001) {
    throw new Error("ยอดคงเหลือห้ามมากกว่ายอดเงินกู้");
  }
  return normalized;
};

const normalizeMemberNameKey = (value: unknown) =>
  String(value || "").replace(/\s+/g, " ").trim().toLowerCase();

const parseGuarantorInputParts = (value: unknown) => {
  const rawText = normalizeTextForMatch(value);
  if (!rawText) {
    return { rawText: "", memberId: "", memberName: "" };
  }

  const parenMatch = rawText.match(/^\(([^)]+)\)\s*(.*)$/);
  if (parenMatch) {
    return {
      rawText,
      memberId: normalizeTextForMatch(parenMatch[1]),
      memberName: normalizeTextForMatch(parenMatch[2]) || rawText,
    };
  }

  const tokenMatch = rawText.match(/^([A-Za-z]+[-\/]?\d[\w\/-]*)\s+(.+)$/i);
  if (tokenMatch) {
    return {
      rawText,
      memberId: normalizeTextForMatch(tokenMatch[1]),
      memberName: normalizeTextForMatch(tokenMatch[2]),
    };
  }

  return {
    rawText,
    memberId: "",
    memberName: rawText,
  };
};

const formatMemberDisplayName = (memberId: unknown, memberName: unknown) => {
  const id = normalizeTextForMatch(memberId);
  const name = normalizeTextForMatch(memberName);
  if (id && name) return `(${id}) ${name}`;
  return name || id;
};

const extractMemberIdFromGuarantorText = (value: unknown) => {
  const text = normalizeTextForMatch(value);
  if (!text) return "";
  const parenMatch = text.match(/^\(([^)]+)\)\s*(.*)$/);
  if (parenMatch) return normalizeTextForMatch(parenMatch[1]);
  const parts = text.split(" ");
  if (parts.length >= 2) {
    const firstToken = normalizeTextForMatch(parts[0]);
    if (/^(?:[A-Za-z]+[-\/]?)?\d[\w\/-]*$/i.test(firstToken)) return firstToken;
  }
  return "";
};

const guarantorReferenceMatchesMember = (
  guarantorText: unknown,
  memberId: unknown,
  memberName: unknown,
) => {
  const text = normalizeTextForMatch(guarantorText);
  const id = normalizeTextForMatch(memberId);
  const name = normalizeTextForMatch(memberName);
  if (!text) return false;
  if (id && text === id) return true;
  if (name && text === name) return true;
  const extractedId = extractMemberIdFromGuarantorText(text);
  return !!(id && extractedId && extractedId === id);
};

const isTemporaryGuarantorStatus = (status: unknown) =>
  normalizeTextForMatch(status) === TEMP_GUARANTOR_STATUS;

const deriveLoanStatusFromState = (
  balance: unknown,
  missedMonths: unknown,
  fallbackStatus: unknown,
) => {
  const remainingBalance = Number(balance) || 0;
  const arrears = Number(missedMonths) || 0;
  const fallback = normalizeText(fallbackStatus);
  if (remainingBalance <= 0) {
    return fallback.includes("กลบหนี้") ? fallback : "ปิดบัญชี";
  }
  if (arrears > 0) return "ค้างชำระ";
  return fallback || "ปกติ";
};

const normalizeJsonSetting = <T extends JsonValue>(
  value: unknown,
  fallback: T,
): T => {
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

const buildDashboardOverviewStatsFromLoans = (
  loansData: Array<Record<string, unknown>>,
  totalMembers: number,
) => {
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
  summary.nplRatio = loansData.length > 0
    ? ((summary.nplCount / loansData.length) * 100).toFixed(1)
    : "0.0";
  return summary;
};

const toBytes = (value: string) => new TextEncoder().encode(value);
const bytesToString = (value: Uint8Array) => new TextDecoder().decode(value);

const bytesToHex = (value: Uint8Array) =>
  Array.from(value).map((byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", toBytes(value));
  return bytesToHex(new Uint8Array(digest));
};

const base64UrlEncode = (input: Uint8Array) =>
  btoa(String.fromCharCode(...input)).replace(/\+/g, "-").replace(/\//g, "_")
    .replace(/=+$/g, "");

const base64UrlDecode = (input: string) => {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized +
    "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
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

const normalizePinInput = (value: unknown) =>
  String(value ?? "").replace(/\D/g, "").trim();
const isValidSixDigitPin = (value: unknown) =>
  /^\d{6}$/.test(String(value ?? "").trim());

const computePinUniqueKey = async (pinValue: unknown) => {
  const pin = normalizePinInput(pinValue);
  if (!pin) return "";
  const { pinUniquePepper } = getEnv();
  return sha256Hex(`${pin}|${pinUniquePepper}`);
};

const buildStrongPasswordHash = async (
  password: unknown,
  salt: unknown,
  iterations: unknown,
) => {
  const safePassword = normalizeText(password);
  const safeSalt = normalizeText(salt);
  const rounds = Math.max(1000, Number(iterations) || 10000);
  let digestInput = `${safePassword}|${safeSalt}`;
  for (let index = 0; index < rounds; index += 1) {
    digestInput = await sha256Hex(digestInput);
  }
  return digestInput;
};

const verifyPasswordAgainstStoredHash = async (
  password: unknown,
  storedHash: unknown,
) => {
  const safeStoredHash = normalizeText(storedHash);
  if (!safeStoredHash) return false;
  if (/^v2\$\d+\$[A-Za-z0-9]+\$[a-f0-9]{64}$/i.test(safeStoredHash)) {
    const parts = safeStoredHash.split("$");
    const iterations = Number(parts[1]) || 10000;
    const salt = parts[2] || "";
    const expected = parts[3] || "";
    return await buildStrongPasswordHash(password, salt, iterations) ===
      expected;
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
  const attempts = current && current.expiresAt > now
    ? current.attempts + 1
    : 1;
  if (attempts >= MAX_LOGIN_ATTEMPTS) {
    loginLockState.set(normalized, now + LOGIN_LOCKOUT_SECONDS * 1000);
    loginAttemptState.delete(normalized);
    return { locked: true, attempts };
  }
  loginAttemptState.set(normalized, {
    attempts,
    expiresAt: now + LOGIN_LOCKOUT_SECONDS * 1000,
  });
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

const decodeSessionToken = async (
  token: string,
): Promise<SessionData | null> => {
  const normalizedToken = normalizeText(token);
  if (!normalizedToken) return null;
  const parts = normalizedToken.split(".");
  if (parts.length !== 3 || parts[0] !== "bl1") return null;
  const { sessionSigningSecret } = ensureConfigured();
  const expectedSignature = await signHmac(sessionSigningSecret, parts[1]);
  if (expectedSignature !== parts[2]) return null;
  try {
    const parsed = JSON.parse(bytesToString(base64UrlDecode(parts[1]))) as
      & SessionData
      & { exp?: number };
    if (!parsed?.username) return null;
    if (
      Number(parsed.exp) > 0 &&
      Number(parsed.exp) < Math.floor(Date.now() / 1000)
    ) return null;
    return {
      userId: normalizeText(parsed.userId),
      username: normalizeText(parsed.username),
      fullName: normalizeText(parsed.fullName || parsed.username),
      role: normalizeRole(parsed.role),
      issuedAt: normalizeText(parsed.issuedAt) || new Date().toISOString(),
      email: normalizeText(parsed.email),
      permissions: Array.isArray(parsed.permissions)
        ? parsed.permissions.map((item) => normalizeText(item)).filter(Boolean)
        : undefined,
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
  const endpoint = `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/${
    encodeURIComponent(tableName)
  }${buildQueryString(query)}`;
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
    throw new Error(
      `Supabase REST API error (${response.status}): ${
        errorText || "unknown error"
      }`,
    );
  }
  if (response.status === 204) return [];
  const rawText = await response.text();
  if (!normalizeText(rawText)) return [];
  const data = JSON.parse(rawText);
  return Array.isArray(data) ? (data as SupabaseRow[]) : [];
};

const patchSupabaseRows = async (
  tableName: string,
  query: Record<string, string>,
  payload: JsonObject,
) => {
  await callSupabaseRequest("PATCH", tableName, query, payload, {
    Prefer: "return=minimal",
  });
};

const deleteSupabaseRows = async (
  tableName: string,
  query: Record<string, string>,
) => {
  await callSupabaseRequest("DELETE", tableName, query, undefined, {
    Prefer: "return=minimal",
  });
};

const insertSupabaseRows = async (
  tableName: string,
  payload: JsonObject | JsonObject[],
): Promise<SupabaseRow[]> => {
  return callSupabaseRequest(
    "POST",
    tableName,
    {},
    payload as JsonObject,
    { Prefer: "return=representation" },
  );
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

const upsertAppSettingValues = async (
  entries: Record<string, { valueText: string; valueJson?: JsonValue | null }>,
) => {
  const existingMap = await getSettingsMapSnapshot();
  const nowIso = new Date().toISOString();
  for (const [key, value] of Object.entries(entries)) {
    const payload: JsonObject = {
      value_text: String(value.valueText ?? ""),
      value_json: value.valueJson ?? null,
      updated_at: nowIso,
    };
    if (Object.prototype.hasOwnProperty.call(existingMap, key)) {
      await patchSupabaseRows("app_settings", { key: `eq.${key}` }, payload);
    } else {
      await insertSupabaseRows("app_settings", { key, ...payload });
    }
  }
};

const parseBooleanSetting = (value: unknown, fallback: boolean) => {
  const text = normalizeLower(value);
  if (!text) return !!fallback;
  return ["true", "1", "yes", "on"].includes(text);
};

const buildNotificationSettingsPayload = (settingsMap: SettingsMap) => ({
  recipients: normalizeText(settingsMap.NotificationRecipients),
  notifyApprovalSubmitted: parseBooleanSetting(
    settingsMap.NotifyApprovalSubmitted,
    true,
  ),
  notifyApprovalApproved: parseBooleanSetting(
    settingsMap.NotifyApprovalApproved,
    true,
  ),
  notifyApprovalRejected: parseBooleanSetting(
    settingsMap.NotifyApprovalRejected,
    true,
  ),
  notifyAttachmentUploaded: parseBooleanSetting(
    settingsMap.NotifyAttachmentUploaded,
    false,
  ),
  notifyPaymentCreated: parseBooleanSetting(
    settingsMap.NotifyPaymentCreated,
    false,
  ),
  notifyPaymentReversed: parseBooleanSetting(
    settingsMap.NotifyPaymentReversed,
    true,
  ),
  notifyReportArchived: parseBooleanSetting(
    settingsMap.NotifyReportArchived,
    true,
  ),
  notifyAccountingClosed: parseBooleanSetting(
    settingsMap.NotifyAccountingClosed,
    true,
  ),
  notifyBackupCompleted: parseBooleanSetting(
    settingsMap.NotifyBackupCompleted,
    true,
  ),
});

const normalizeSettingsInputObject = (
  value: unknown,
): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const parseJsonObjectArg = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  const text = normalizeText(value);
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return normalizeSettingsInputObject(parsed);
  } catch (error) {
    throw new Error(
      `รูปแบบ JSON สำหรับ setup ไม่ถูกต้อง: ${
        (error as Error)?.message || "invalid json"
      }`,
    );
  }
};

const normalizeJsonPayloadValue = (value: unknown): JsonValue => {
  if (
    value === null || typeof value === "string" || typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonPayloadValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        normalizeText(key),
        normalizeJsonPayloadValue(entry),
      ]),
    ) as JsonObject;
  }
  return normalizeText(value);
};

const buildMaskedSecret = (value: unknown) => {
  const text = normalizeText(value);
  if (!text) return "";
  if (text.length <= 8) return `${text.slice(0, 2)}***${text.slice(-2)}`;
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
};

const deriveProjectRefFromUrl = (value: unknown) => {
  const text = normalizeText(value);
  if (!text) return "";
  try {
    const hostname = new URL(text).hostname;
    return hostname.split(".")[0] || "";
  } catch {
    return "";
  }
};

const createHashRecord = async (secret: unknown) => {
  const normalizedSecret = normalizeText(secret);
  if (!normalizedSecret) return "";
  const iterations = 10000;
  const salt = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const digest = await buildStrongPasswordHash(
    normalizedSecret,
    salt,
    iterations,
  );
  return `v2$${iterations}$${salt}$${digest}`;
};

const upsertSupabaseBatch = async (
  tableName: string,
  rows: JsonObject[],
  onConflictColumns: string[] = [],
) => {
  if (!rows.length) return 0;
  const query: Record<string, string> = {};
  if (onConflictColumns.length) {
    query.on_conflict = onConflictColumns.join(",");
  }
  await callSupabaseRequest(
    "POST",
    tableName,
    query,
    rows as unknown as JsonObject,
    {
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
  );
  return rows.length;
};

const insertSupabaseBatch = async (tableName: string, rows: JsonObject[]) => {
  if (!rows.length) return 0;
  await callSupabaseRequest(
    "POST",
    tableName,
    {},
    rows as unknown as JsonObject,
    {
      Prefer: "return=minimal",
    },
  );
  return rows.length;
};

const getSupabaseManagedTableNames = () => [
  "loans",
  "members",
  "transactions",
  "app_settings",
  "app_users",
  "audit_logs",
  "app_counters",
];

const inspectSupabaseManagedTables = async () => {
  const found: string[] = [];
  const missing: string[] = [];
  for (const tableName of getSupabaseManagedTableNames()) {
    try {
      await callSupabase(tableName, {
        select: "*",
        limit: "1",
      });
      found.push(tableName);
    } catch (error) {
      const message = normalizeText((error as Error)?.message);
      if (
        message.includes("Could not find the table") ||
        message.includes("relation") || message.includes("404")
      ) {
        missing.push(tableName);
        continue;
      }
      throw error;
    }
  }
  return {
    tables: found,
    missingTables: missing,
    ready: missing.length === 0,
  };
};

const buildSupabaseSchemaSql = (schemaName: string) => {
  const schema = normalizeText(schemaName) || "public";
  return [
    `create schema if not exists "${schema}";`,
    `create table if not exists "${schema}"."loans" (`,
    "  contract_no text primary key,",
    "  member_id text not null default '',",
    "  borrower_name text not null default '',",
    "  principal_amount numeric(14,2) not null default 0,",
    "  interest_rate numeric(10,2) not null default 0,",
    "  outstanding_balance numeric(14,2) not null default 0,",
    "  status text not null default '',",
    "  due_date_text text not null default '',",
    "  overdue_months integer not null default 0,",
    "  created_date_text text not null default '',",
    "  guarantor_1 text not null default '',",
    "  guarantor_2 text not null default '',",
    "  raw_json jsonb not null default '{}'::jsonb,",
    "  updated_at timestamptz not null default now(),",
    "  imported_at timestamptz not null default now()",
    ");",
    `create table if not exists "${schema}"."members" (`,
    "  member_id text primary key,",
    "  full_name text not null default '',",
    "  status text not null default '',",
    "  raw_json jsonb not null default '{}'::jsonb,",
    "  updated_at timestamptz not null default now(),",
    "  imported_at timestamptz not null default now()",
    ");",
    `create table if not exists "${schema}"."transactions" (`,
    "  reference_id text primary key,",
    "  occurred_on_text text not null default '',",
    "  contract_no text not null default '',",
    "  member_id text not null default '',",
    "  principal_paid numeric(14,2) not null default 0,",
    "  interest_paid numeric(14,2) not null default 0,",
    "  outstanding_balance numeric(14,2) not null default 0,",
    "  note text not null default '',",
    "  actor text not null default '',",
    "  full_name text not null default '',",
    "  tx_status text not null default '',",
    "  interest_months_paid integer not null default 0,",
    "  overdue_interest_before numeric(14,2) not null default 0,",
    "  overdue_interest_after numeric(14,2) not null default 0,",
    "  raw_json jsonb not null default '{}'::jsonb,",
    "  updated_at timestamptz not null default now(),",
    "  imported_at timestamptz not null default now()",
    ");",
    `create table if not exists "${schema}"."app_settings" (`,
    "  key text primary key,",
    "  value_text text not null default '',",
    "  value_json jsonb,",
    "  updated_at timestamptz not null default now()",
    ");",
    `create table if not exists "${schema}"."app_users" (`,
    "  user_id text primary key,",
    "  username text not null unique,",
    "  full_name text not null default '',",
    "  email text not null default '',",
    "  password_hash text not null default '',",
    "  role text not null default 'staff',",
    "  status text not null default 'Active',",
    "  created_at_text text not null default '',",
    "  updated_at_text text not null default '',",
    "  last_login_at_text text not null default '',",
    "  reset_otp_hash text not null default '',",
    "  reset_otp_expire_at_text text not null default '',",
    "  reset_otp_requested_at_text text not null default '',",
    "  reset_otp_used_at_text text not null default '',",
    "  permissions_json text not null default '',",
    "  prefix text not null default '',",
    "  first_name text not null default '',",
    "  last_name text not null default '',",
    "  email_verified_at_text text not null default '',",
    "  pin_hash text not null default '',",
    "  pin_unique_key text not null default '',",
    "  pin_updated_at_text text not null default '',",
    "  email_verify_otp_hash text not null default '',",
    "  email_verify_otp_expire_at_text text not null default '',",
    "  email_verify_otp_requested_at_text text not null default '',",
    "  raw_json jsonb not null default '{}'::jsonb,",
    "  imported_at timestamptz not null default now()",
    ");",
    `create table if not exists "${schema}"."audit_logs" (`,
    "  log_id bigint generated by default as identity primary key,",
    "  occurred_at_text text not null default '',",
    "  username text not null default '',",
    "  display_name text not null default '',",
    "  role text not null default '',",
    "  action text not null default '',",
    "  entity_type text not null default '',",
    "  entity_id text not null default '',",
    "  reference_no text not null default '',",
    "  before_json text not null default '',",
    "  after_json text not null default '',",
    "  reason text not null default '',",
    "  details text not null default '',",
    "  raw_json jsonb not null default '{}'::jsonb,",
    "  imported_at timestamptz not null default now()",
    ");",
    `create table if not exists "${schema}"."app_counters" (`,
    "  counter_key text primary key,",
    "  current_no bigint not null default 0,",
    "  updated_at_text text not null default '',",
    "  raw_json jsonb not null default '{}'::jsonb,",
    "  imported_at timestamptz not null default now()",
    ");",
    `create index if not exists loans_member_id_idx on "${schema}"."loans" (member_id);`,
    `create index if not exists loans_status_idx on "${schema}"."loans" (status);`,
    `create index if not exists transactions_contract_no_idx on "${schema}"."transactions" (contract_no);`,
    `create index if not exists transactions_member_id_idx on "${schema}"."transactions" (member_id);`,
    `create index if not exists transactions_occurred_on_text_idx on "${schema}"."transactions" (occurred_on_text);`,
    `create index if not exists app_users_role_idx on "${schema}"."app_users" (role);`,
    `create index if not exists app_users_status_idx on "${schema}"."app_users" (status);`,
  ].join("\n");
};

const callSupabaseManagementQuery = async (
  config: Record<string, unknown>,
  sql: string,
  readOnly: boolean,
) => {
  const env = ensureConfigured();
  const projectRef = normalizeText(config.projectRef) ||
    deriveProjectRefFromUrl(config.url) ||
    deriveProjectRefFromUrl(env.supabaseUrl);
  const managementToken = normalizeText(config.managementToken);
  if (!projectRef || !managementToken) {
    throw new Error(
      "ยังไม่ได้ระบุ project ref หรือ management token สำหรับสร้างโครงสร้าง Supabase",
    );
  }
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${
      encodeURIComponent(projectRef)
    }/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${managementToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query: normalizeText(sql),
        read_only: !!readOnly,
      }),
    },
  );
  if (!response.ok) {
    const errorText = normalizeText(await response.text());
    throw new Error(
      `Supabase management API error (${response.status}): ${
        errorText || "unknown error"
      }`,
    );
  }
  try {
    return await response.json();
  } catch {
    return {};
  }
};

const buildSetupConfigSnapshot = (input: unknown) => {
  const env = ensureConfigured();
  const raw = normalizeSettingsInputObject(input);
  const url = normalizeText(raw.url) || env.supabaseUrl;
  const projectRef = normalizeText(raw.projectRef) ||
    deriveProjectRefFromUrl(url);
  const schema = normalizeText(raw.schema) || "public";
  const managementToken = normalizeText(raw.managementToken);
  const serviceRoleKey = normalizeText(raw.serviceRoleKey);
  return {
    url,
    projectRef,
    schema,
    managementToken,
    serviceRoleKey,
    hasServiceRoleKey: !!serviceRoleKey,
    hasManagementToken: !!managementToken,
    serviceRoleKeyMasked: buildMaskedSecret(serviceRoleKey),
    managementTokenMasked: buildMaskedSecret(managementToken),
  };
};

const normalizeImportedLoanRow = (loan: Record<string, unknown>) => {
  const nowIso = new Date().toISOString();
  const contractNo = normalizeText(
    loan.contract_no || loan.contract || loan.contractNo || loan["เลขที่สัญญา"],
  );
  if (!contractNo) return null;
  return {
    contract_no: contractNo,
    member_id: normalizeText(
      loan.memberId || loan.member_id || loan.id || loan["รหัสสมาชิก"],
    ),
    borrower_name: normalizeText(
      loan.member || loan.borrowerName || loan.borrower_name ||
        loan["ชื่อ-สกุลผู้กู้"],
    ),
    principal_amount:
      Number(loan.amount || loan.principalAmount || loan.principal_amount) || 0,
    interest_rate:
      Number(loan.interest || loan.interestRate || loan.interest_rate) || 0,
    outstanding_balance: Number(
      loan.balance || loan.outstandingBalance || loan.outstanding_balance,
    ) || 0,
    status: normalizeText(loan.status),
    due_date_text: normalizeText(
      loan.nextPayment || loan.dueDate || loan.due_date_text ||
        loan["วันครบกำหนด"],
    ),
    overdue_months: Math.max(
      0,
      Number(
        loan.missedInterestMonths || loan.overdueMonths ||
          loan.overdue_months || loan["จำนวนเดือนค้างชำระ"],
      ) || 0,
    ),
    created_date_text: normalizeText(
      loan.createdAt || loan.created_date_text || loan["วันที่สร้างสัญญา"],
    ),
    guarantor_1: normalizeText(
      loan.guarantor1 || loan.guarantor_1 || loan["ผู้ค้ำประกัน 1"],
    ),
    guarantor_2: normalizeText(
      loan.guarantor2 || loan.guarantor_2 || loan["ผู้ค้ำประกัน 2"],
    ),
    raw_json: normalizeJsonPayloadValue(loan) as JsonObject,
    updated_at: nowIso,
    imported_at: nowIso,
  } as JsonObject;
};

const normalizeImportedMemberRow = (member: Record<string, unknown>) => {
  const nowIso = new Date().toISOString();
  const memberId = normalizeText(
    member.id || member.memberId || member.member_id || member["รหัสสมาชิก"],
  );
  if (!memberId) return null;
  return {
    member_id: memberId,
    full_name: normalizeText(
      member.name || member.fullName || member.full_name || member["ชื่อ-สกุล"],
    ),
    status: normalizeText(member.status),
    raw_json: normalizeJsonPayloadValue(member) as JsonObject,
    updated_at: nowIso,
    imported_at: nowIso,
  } as JsonObject;
};

const normalizeImportedTransactionRow = (tx: Record<string, unknown>) => {
  const nowIso = new Date().toISOString();
  const referenceId = normalizeText(
    tx.id || tx.referenceId || tx.reference_id || tx["รหัสอ้างอิง"],
  );
  if (!referenceId) return null;
  return {
    reference_id: referenceId,
    occurred_on_text: normalizeText(
      tx.timestamp || tx.occurredOn || tx.occurred_on_text ||
        tx["วัน/เดือน/ปี (พ.ศ.)"],
    ),
    contract_no: normalizeText(
      tx.contract || tx.contractNo || tx.contract_no || tx["เลขที่สัญญา"],
    ),
    member_id: normalizeText(tx.memberId || tx.member_id || tx["รหัสสมาชิก"]),
    principal_paid:
      Number(tx.principalPaid || tx.principal_paid || tx["ชำระเงินต้น"]) || 0,
    interest_paid:
      Number(tx.interestPaid || tx.interest_paid || tx["ชำระดอกเบี้ย"]) || 0,
    outstanding_balance: Number(
      tx.newBalance || tx.balance || tx.outstandingBalance ||
        tx.outstanding_balance || tx["ยอดคงเหลือ"],
    ) || 0,
    note: normalizeText(tx.note || tx["หมายเหตุ"]),
    actor: normalizeText(tx.actor || tx.performedBy || tx["ผู้ทำรายการ"]),
    full_name: normalizeText(
      tx.memberName || tx.fullName || tx.full_name || tx["ชื่อ-สกุล"],
    ),
    tx_status: normalizeText(
      tx.txStatus || tx.status || tx.tx_status || tx["สถานะการทำรายการ"],
    ),
    interest_months_paid: Math.max(
      0,
      Number(
        tx.interestMonthsPaid || tx.interest_months_paid ||
          tx["จำนวนงวดดอกที่ชำระ"],
      ) || 0,
    ),
    overdue_interest_before: Number(
      tx.currentMissedInterestMonths || tx.overdueInterestBefore ||
        tx.overdue_interest_before || tx["ค้างดอกก่อนรับชำระ"],
    ) || 0,
    overdue_interest_after: Number(
      tx.newMissedInterestMonths || tx.overdueInterestAfter ||
        tx.overdue_interest_after || tx["ค้างดอกหลังรับชำระ"],
    ) || 0,
    raw_json: normalizeJsonPayloadValue(tx) as JsonObject,
    updated_at: nowIso,
    imported_at: nowIso,
  } as JsonObject;
};

const normalizeImportedUserRow = (user: Record<string, unknown>) => {
  const nowIso = new Date().toISOString();
  const username = normalizeLower(user.username);
  if (!username) return null;
  return {
    user_id: normalizeText(user.userId || user.user_id) || crypto.randomUUID(),
    username,
    full_name: normalizeText(user.fullName || user.full_name),
    email: normalizeLower(user.email),
    password_hash: normalizeText(user.passwordHash || user.password_hash),
    role: normalizeRole(user.role),
    status: normalizeUserStatus(user.status),
    created_at_text: normalizeText(user.createdAt || user.created_at_text),
    updated_at_text: normalizeText(user.updatedAt || user.updated_at_text) ||
      formatThaiDateTime(new Date()),
    last_login_at_text: normalizeText(
      user.lastLoginAt || user.last_login_at_text,
    ),
    reset_otp_hash: normalizeText(user.resetOtpHash || user.reset_otp_hash),
    reset_otp_expire_at_text: normalizeText(
      user.resetOtpExpireAt || user.reset_otp_expire_at_text,
    ),
    reset_otp_requested_at_text: normalizeText(
      user.resetOtpRequestedAt || user.reset_otp_requested_at_text,
    ),
    reset_otp_used_at_text: normalizeText(
      user.resetOtpUsedAt || user.reset_otp_used_at_text,
    ),
    permissions_json: normalizeText(
      user.permissionsJson || user.permissions_json,
    ),
    prefix: normalizeText(user.prefix),
    first_name: normalizeText(user.firstName || user.first_name),
    last_name: normalizeText(user.lastName || user.last_name),
    email_verified_at_text: normalizeText(
      user.emailVerifiedAt || user.email_verified_at_text,
    ),
    pin_hash: normalizeText(user.pinHash || user.pin_hash),
    pin_unique_key: normalizeText(user.pinUniqueKey || user.pin_unique_key),
    pin_updated_at_text: normalizeText(
      user.pinUpdatedAt || user.pin_updated_at_text,
    ),
    email_verify_otp_hash: normalizeText(
      user.emailVerifyOtpHash || user.email_verify_otp_hash,
    ),
    email_verify_otp_expire_at_text: normalizeText(
      user.emailVerifyOtpExpireAt || user.email_verify_otp_expire_at_text,
    ),
    email_verify_otp_requested_at_text: normalizeText(
      user.emailVerifyOtpRequestedAt || user.email_verify_otp_requested_at_text,
    ),
    raw_json: normalizeJsonPayloadValue(user) as JsonObject,
    imported_at: nowIso,
  } as JsonObject;
};

const buildDefaultImportedAdminUser = async () => {
  const nowIso = new Date().toISOString();
  const defaultPin = "123456";
  return {
    user_id: crypto.randomUUID(),
    username: "admin",
    full_name: "ผู้ดูแลระบบ",
    email: "admin@local.invalid",
    password_hash: await createHashRecord("admin"),
    role: "admin",
    status: USER_STATUS_ACTIVE,
    created_at_text: formatThaiDateTime(new Date()),
    updated_at_text: formatThaiDateTime(new Date()),
    last_login_at_text: "",
    reset_otp_hash: "",
    reset_otp_expire_at_text: "",
    reset_otp_requested_at_text: "",
    reset_otp_used_at_text: "",
    permissions_json: "",
    prefix: "",
    first_name: "",
    last_name: "",
    email_verified_at_text: formatThaiDateTime(new Date()),
    pin_hash: await createHashRecord(defaultPin),
    pin_unique_key: await computePinUniqueKey(defaultPin),
    pin_updated_at_text: formatThaiDateTime(new Date()),
    email_verify_otp_hash: "",
    email_verify_otp_expire_at_text: "",
    email_verify_otp_requested_at_text: "",
    raw_json: {
      seededBy: "edge-setup-default-admin",
    },
    imported_at: nowIso,
  } as JsonObject;
};

const normalizeImportedAuditLogRow = (record: Record<string, unknown>) => {
  const nowIso = new Date().toISOString();
  const occurredAt = normalizeText(
    record.timestamp || record.occurredAt || record.occurred_at_text ||
      record["วัน/เดือน/ปี (พ.ศ.)"],
  );
  const action = normalizeText(record.action || record.Action);
  const details = normalizeText(record.details || record.Details);
  if (!occurredAt && !action && !details) return null;
  return {
    occurred_at_text: occurredAt,
    username: normalizeText(record.username || record.Username),
    display_name: normalizeText(
      record.actorName || record.displayName || record.display_name ||
        record["ชื่อผู้ใช้"],
    ),
    role: normalizeText(record.role || record.Role),
    action,
    entity_type: normalizeText(
      record.entityType || record.entity_type || record.EntityType,
    ),
    entity_id: normalizeText(
      record.entityId || record.entity_id || record.EntityId,
    ),
    reference_no: normalizeText(
      record.referenceNo || record.reference_no || record.ReferenceNo,
    ),
    before_json: normalizeText(
      record.beforeJson || record.before_json || record.BeforeJson,
    ),
    after_json: normalizeText(
      record.afterJson || record.after_json || record.AfterJson,
    ),
    reason: normalizeText(record.reason || record.Reason),
    details,
    raw_json: normalizeJsonPayloadValue(record) as JsonObject,
    imported_at: nowIso,
  } as JsonObject;
};

const normalizeImportedCounterRow = (counter: Record<string, unknown>) => {
  const nowIso = new Date().toISOString();
  const counterKey = normalizeText(
    counter.counterKey || counter.counter_key || counter.CounterKey,
  );
  if (!counterKey) return null;
  return {
    counter_key: counterKey,
    current_no:
      Number(counter.currentNo || counter.current_no || counter.CurrentNo) || 0,
    updated_at_text: normalizeText(
      counter.updatedAt || counter.updated_at_text || counter.UpdatedAt,
    ),
    raw_json: normalizeJsonPayloadValue(counter) as JsonObject,
    imported_at: nowIso,
  } as JsonObject;
};

const buildImportedSettingsRows = (setupPayload: Record<string, unknown>) => {
  const nowIso = new Date().toISOString();
  const rows = new Map<string, JsonObject>();
  const pushSetting = (
    key: string,
    valueText: string,
    valueJson?: JsonValue | null,
  ) => {
    const normalizedKey = normalizeText(key);
    if (!normalizedKey) return;
    rows.set(normalizedKey, {
      key: normalizedKey,
      value_text: String(valueText ?? ""),
      value_json: valueJson ?? null,
      updated_at: nowIso,
    });
  };

  const interestRate = Number(setupPayload.interestRate);
  if (Number.isFinite(interestRate) && interestRate > 0) {
    pushSetting("InterestRate", String(interestRate), interestRate);
  }

  const notificationSettings = normalizeSettingsInputObject(
    setupPayload.notificationSettings,
  );
  const notificationEntries: Array<[string, unknown]> = [
    ["NotificationRecipients", notificationSettings.recipients],
    ["NotifyApprovalSubmitted", notificationSettings.notifyApprovalSubmitted],
    ["NotifyApprovalApproved", notificationSettings.notifyApprovalApproved],
    ["NotifyApprovalRejected", notificationSettings.notifyApprovalRejected],
    ["NotifyAttachmentUploaded", notificationSettings.notifyAttachmentUploaded],
    ["NotifyPaymentCreated", notificationSettings.notifyPaymentCreated],
    ["NotifyPaymentReversed", notificationSettings.notifyPaymentReversed],
    ["NotifyReportArchived", notificationSettings.notifyReportArchived],
    ["NotifyAccountingClosed", notificationSettings.notifyAccountingClosed],
    ["NotifyBackupCompleted", notificationSettings.notifyBackupCompleted],
  ];
  for (const [key, value] of notificationEntries) {
    if (value === undefined) continue;
    pushSetting(
      key,
      String(value ?? ""),
      typeof value === "boolean" ? value : null,
    );
  }

  const operatingDayCalendar = normalizeSettingsInputObject(
    setupPayload.operatingDayCalendar,
  );
  if (Object.keys(operatingDayCalendar).length > 0) {
    pushSetting(
      OPERATING_DAY_CALENDAR_SETTING_KEY,
      JSON.stringify(operatingDayCalendar),
      normalizeJsonPayloadValue(operatingDayCalendar),
    );
  }

  const reportLayoutSettings = normalizeSettingsInputObject(
    setupPayload.reportLayoutSettings,
  );
  if (Object.keys(reportLayoutSettings).length > 0) {
    pushSetting(
      REPORT_LAYOUT_SETTINGS_KEY,
      JSON.stringify(reportLayoutSettings),
      normalizeJsonPayloadValue(reportLayoutSettings),
    );
  }

  const menuSettings = normalizeSettingsInputObject(setupPayload.menuSettings);
  if (Object.keys(menuSettings).length > 0) {
    pushSetting(
      MENU_SETTINGS_KEY,
      JSON.stringify(menuSettings),
      normalizeJsonPayloadValue(menuSettings),
    );
  }

  const settingsMap = normalizeSettingsInputObject(
    setupPayload.settingsMap || setupPayload.settings,
  );
  for (const [key, value] of Object.entries(settingsMap)) {
    if (
      [
        "notificationSettings",
        "operatingDayCalendar",
        "reportLayoutSettings",
        "menuSettings",
      ].includes(key)
    ) {
      continue;
    }
    const normalizedValue = normalizeJsonPayloadValue(value);
    pushSetting(
      key,
      typeof normalizedValue === "string"
        ? normalizedValue
        : JSON.stringify(normalizedValue ?? null),
      normalizedValue,
    );
  }

  return Array.from(rows.values());
};

const appendAuditLogEntry = async (
  session: SessionData,
  payload: {
    action: string;
    entityType: string;
    entityId?: string;
    referenceNo?: string;
    before?: JsonValue;
    after?: JsonValue;
    reason?: string;
    details?: string;
  },
) => {
  await insertSupabaseBatch("audit_logs", [{
    occurred_at_text: formatThaiDateTime(new Date()),
    username: normalizeText(session.username),
    display_name: normalizeText(session.fullName || session.username),
    role: normalizeRole(session.role),
    action: normalizeText(payload.action),
    entity_type: normalizeText(payload.entityType),
    entity_id: normalizeText(payload.entityId),
    reference_no: normalizeText(payload.referenceNo),
    before_json: payload.before === undefined
      ? ""
      : JSON.stringify(payload.before),
    after_json: payload.after === undefined
      ? ""
      : JSON.stringify(payload.after),
    reason: normalizeText(payload.reason),
    details: normalizeText(payload.details),
    raw_json: normalizeJsonPayloadValue(payload) as JsonObject,
    imported_at: new Date().toISOString(),
  }]);
};

const getSupabaseSetupStatus = async (payload: RpcPayload) => {
  const { session } = await resolveSession(payload);
  requirePermission(session, "settings.manage", "ไม่มีสิทธิ์ดูการตั้งค่า Supabase");

  const rawArg = payload.args?.[0];
  const config = buildSetupConfigSnapshot(parseJsonObjectArg(rawArg));
  const schemaStatus = await inspectSupabaseManagedTables();
  const counts: Record<string, number> = {};
  for (const tableName of schemaStatus.tables) {
    const rows = await callSupabase(tableName, {
      select: "*",
      limit: "1",
    });
    counts[tableName] = rows.length;
  }
  return {
    provider: "supabase",
    config,
    ready: schemaStatus.ready,
    tables: schemaStatus.tables,
    missingTables: schemaStatus.missingTables,
    counts,
    message: schemaStatus.ready
      ? "Supabase Edge Function เชื่อมต่อฐานข้อมูลได้และพบตารางหลักครบแล้ว"
      : "เชื่อมต่อ Supabase ได้ แต่ยังต้องสร้างตารางบางส่วนก่อนนำเข้าข้อมูล",
  } as JsonObject;
};

const setupDatabase = async (payload: RpcPayload) => {
  const { session } = await resolveSession(payload);
  requirePermission(session, "settings.manage", "ไม่มีสิทธิ์ตั้งค่าฐานข้อมูลอัตโนมัติ");

  const rawArg = payload.args?.[0];
  const setupPayload = parseJsonObjectArg(rawArg);
  const config = buildSetupConfigSnapshot(
    setupPayload.config || setupPayload.supabase || setupPayload,
  );

  let schemaStatus = await inspectSupabaseManagedTables();
  if (!schemaStatus.ready) {
    if (!config.hasManagementToken) {
      throw new Error(
        "ยังไม่พบตาราง Supabase หลักครบ และไม่ได้ระบุ management token เพื่อสร้างโครงสร้างฐานข้อมูล",
      );
    }
    await callSupabaseManagementQuery(
      config,
      buildSupabaseSchemaSql(config.schema),
      false,
    );
    schemaStatus = await inspectSupabaseManagedTables();
  }

  const importedLoans = Array.isArray(setupPayload.loans)
    ? (setupPayload.loans as Array<Record<string, unknown>>)
      .map(normalizeImportedLoanRow)
      .filter((row): row is JsonObject => !!row)
    : [];
  const importedMembers = Array.isArray(setupPayload.members)
    ? (setupPayload.members as Array<Record<string, unknown>>)
      .map(normalizeImportedMemberRow)
      .filter((row): row is JsonObject => !!row)
    : [];
  const transactionSource = Array.isArray(setupPayload.transactions)
    ? setupPayload.transactions as Array<Record<string, unknown>>
    : (Array.isArray(setupPayload.recentTransactions)
      ? setupPayload.recentTransactions as Array<Record<string, unknown>>
      : []);
  const importedTransactions = transactionSource
    .map(normalizeImportedTransactionRow)
    .filter((row): row is JsonObject => !!row);
  const importedUsers = Array.isArray(setupPayload.users)
    ? (setupPayload.users as Array<Record<string, unknown>>)
      .map(normalizeImportedUserRow)
      .filter((row): row is JsonObject => !!row)
    : [];
  const importedAuditLogs = Array.isArray(setupPayload.auditLogs)
    ? (setupPayload.auditLogs as Array<Record<string, unknown>>)
      .map(normalizeImportedAuditLogRow)
      .filter((row): row is JsonObject => !!row)
    : [];
  const importedCounters = Array.isArray(setupPayload.counters)
    ? (setupPayload.counters as Array<Record<string, unknown>>)
      .map(normalizeImportedCounterRow)
      .filter((row): row is JsonObject => !!row)
    : [];
  const importedSettings = buildImportedSettingsRows(setupPayload);

  const existingAdminRows = await callSupabase("app_users", {
    select: "username",
    username: "eq.admin",
    limit: "1",
  });
  const hasExistingAdmin = existingAdminRows.length > 0;

  if (!importedUsers.length && !hasExistingAdmin) {
    importedUsers.push(await buildDefaultImportedAdminUser());
  }

  const summary = {
    loans: await upsertSupabaseBatch("loans", importedLoans, ["contract_no"]),
    members: await upsertSupabaseBatch("members", importedMembers, [
      "member_id",
    ]),
    transactions: await upsertSupabaseBatch(
      "transactions",
      importedTransactions,
      ["reference_id"],
    ),
    settings: await upsertSupabaseBatch("app_settings", importedSettings, [
      "key",
    ]),
    users: await upsertSupabaseBatch("app_users", importedUsers, ["username"]),
    auditLogs: await insertSupabaseBatch("audit_logs", importedAuditLogs),
    counters: await upsertSupabaseBatch("app_counters", importedCounters, [
      "counter_key",
    ]),
  };

  await appendAuditLogEntry(session, {
    action: "SETUP_DATABASE",
    entityType: "SYSTEM",
    entityId: "Supabase",
    referenceNo: "Supabase",
    after: summary as unknown as JsonValue,
    details: "Backfill ข้อมูลไป Supabase ผ่าน Edge Function สำเร็จ",
  });

  return {
    provider: "supabase",
    message: "สร้างโครงสร้างและย้ายข้อมูลไป Supabase ผ่าน Edge Function เรียบร้อยแล้ว",
    ...summary,
    tables: schemaStatus.tables,
    missingTables: schemaStatus.missingTables,
  } as JsonObject;
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
    select:
      "user_id,username,full_name,email,role,status,email_verified_at_text,pin_hash,permissions_json",
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
      permissions:
        Array.isArray(session.permissions) && session.permissions.length
          ? session.permissions
          : getAllPermissionKeys(),
      staffPortalUnlocked: !!session.staffPortalUnlocked,
      staffPortalUnlockedAt: normalizeText(session.staffPortalUnlockedAt),
      permissionCatalog: getPermissionCatalog(),
    };
  }

  const permissions = getEffectivePermissions(
    userRow,
    normalizeRole(userRow.role),
  );
  return {
    userId: normalizeText(userRow.user_id),
    username: normalizeText(userRow.username) || username,
    fullName: normalizeText(userRow.full_name) ||
      normalizeText(session.fullName) || username,
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
    select:
      "user_id,username,full_name,email,role,status,email_verified_at_text,password_hash,pin_hash,pin_unique_key,permissions_json,last_login_at_text,updated_at_text,prefix,first_name,last_name",
    username: `eq.${normalizedUsername}`,
    limit: "1",
  });
  return rows[0] || null;
};

const findUserById = async (userId: unknown) => {
  const normalizedUserId = normalizeText(userId);
  if (!normalizedUserId) return null;
  const rows = await callSupabase("app_users", {
    select:
      "user_id,username,full_name,email,role,status,email_verified_at_text,password_hash,pin_hash,pin_unique_key,permissions_json,last_login_at_text,updated_at_text,prefix,first_name,last_name",
    user_id: `eq.${normalizedUserId}`,
    limit: "1",
  });
  return rows[0] || null;
};

const mapUserRowForClient = (userRow: SupabaseRow | null) => {
  if (!userRow) return null;
  const role = normalizeRole(userRow.role);
  return {
    userId: normalizeText(userRow.user_id),
    username: normalizeText(userRow.username),
    fullName: normalizeText(userRow.full_name),
    email: normalizeLower(userRow.email),
    prefix: normalizeText(userRow.prefix),
    firstName: normalizeText(userRow.first_name),
    lastName: normalizeText(userRow.last_name),
    emailVerifiedAt: normalizeText(userRow.email_verified_at_text),
    role,
    status: normalizeUserStatus(userRow.status),
    updatedAt: normalizeText(userRow.updated_at_text),
    lastLoginAt: normalizeText(userRow.last_login_at_text),
    permissionsJson: normalizeText(userRow.permissions_json),
    permissions: getEffectivePermissions(userRow, role),
  } as JsonObject;
};

const findUserByLoginPin = async (pinValue: unknown) => {
  const normalizedPin = normalizePinInput(pinValue);
  if (!isValidSixDigitPin(normalizedPin)) return null;

  const directPinUniqueKey = await computePinUniqueKey(normalizedPin);
  if (directPinUniqueKey) {
    const directRows = await callSupabase("app_users", {
      select:
        "user_id,username,full_name,email,role,status,email_verified_at_text,pin_hash,pin_unique_key,permissions_json,last_login_at_text,updated_at_text",
      pin_unique_key: `eq.${directPinUniqueKey}`,
      limit: "2",
    });
    if (directRows.length === 1) return directRows[0];
    if (directRows.length > 1) {
      throw new Error("PIN นี้ซ้ำกับหลายบัญชี กรุณาติดต่อผู้ดูแลระบบ");
    }
  }

  const candidateRows = await callSupabase("app_users", {
    select:
      "user_id,username,full_name,email,role,status,email_verified_at_text,pin_hash,pin_unique_key,permissions_json,last_login_at_text,updated_at_text",
    pin_hash: "not.is.null",
    limit: "5000",
  });
  let matchedUser: SupabaseRow | null = null;
  for (const user of candidateRows) {
    if (!normalizeText(user.pin_hash)) continue;
    if (!await verifyPasswordAgainstStoredHash(normalizedPin, user.pin_hash)) {
      continue;
    }
    if (
      matchedUser &&
      normalizeText(matchedUser.user_id) !== normalizeText(user.user_id)
    ) {
      throw new Error("PIN นี้ซ้ำกับหลายบัญชี กรุณาติดต่อผู้ดูแลระบบ");
    }
    matchedUser = user;
  }
  return matchedUser;
};

const verifyLogin = async (payload: RpcPayload) => {
  const username = normalizeLower(payload.args?.[0]);
  const password = normalizeText(payload.args?.[1]);

  if (!username || !password) {
    return {
      status: "Error",
      message: "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน",
    } as JsonObject;
  }

  if (getLoginLockoutState(username).locked) {
    return {
      status: "Locked",
      message: "พยายามเข้าสู่ระบบผิดเกินกำหนด กรุณารอ 15 นาทีแล้วลองใหม่อีกครั้ง",
    } as JsonObject;
  }

  const userRecord = await findUserByUsername(username);
  const storedPasswordHash = normalizeText(userRecord?.password_hash) ||
    normalizeText(userRecord?.pin_hash);
  if (!userRecord || !storedPasswordHash) {
    const failedState = registerFailedLoginAttempt(username);
    return {
      status: failedState.locked ? "Locked" : "Error",
      message: failedState.locked
        ? "พยายามเข้าสู่ระบบผิดเกินกำหนด กรุณารอ 15 นาทีแล้วลองใหม่อีกครั้ง"
        : "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
    } as JsonObject;
  }

  const normalizedStatus = normalizeUserStatus(
    userRecord.status || USER_STATUS_PENDING,
  );
  if (normalizedStatus !== USER_STATUS_ACTIVE) {
    return {
      status: "Error",
      message: normalizedStatus === USER_STATUS_PENDING
        ? "บัญชีของคุณอยู่ระหว่างรออนุมัติจากผู้ดูแลระบบ"
        : "บัญชีผู้ใช้นี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ",
    } as JsonObject;
  }

  const passwordMatched = await verifyPasswordAgainstStoredHash(
    password,
    storedPasswordHash,
  );
  if (!passwordMatched) {
    const failedState = registerFailedLoginAttempt(username);
    return {
      status: failedState.locked ? "Locked" : "Error",
      message: failedState.locked
        ? "พยายามเข้าสู่ระบบผิดเกินกำหนด กรุณารอ 15 นาทีแล้วลองใหม่อีกครั้ง"
        : "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
    } as JsonObject;
  }

  const permissions = getEffectivePermissions(
    userRecord,
    normalizeRole(userRecord.role),
  );
  const loginAt = formatThaiDateTime(new Date());
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
    // Keep login successful even if timestamps cannot be updated.
  }

  clearFailedLoginAttempts(username);

  const authenticatedSession: SessionData = {
    userId: normalizeText(userRecord.user_id),
    username: normalizeText(userRecord.username),
    fullName: normalizeText(userRecord.full_name) ||
      normalizeText(userRecord.username),
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

const registerUser = async (payload: RpcPayload) => {
  const rawArg = payload.args?.[0];
  const form = typeof rawArg === "string"
    ? normalizeSettingsInputObject(JSON.parse(rawArg || "{}"))
    : normalizeSettingsInputObject(rawArg);

  const prefix = normalizeApprovedPrefix(form.prefix);
  const firstName = normalizeHumanNamePart(form.firstName);
  const lastName = normalizeHumanNamePart(form.lastName);
  const fullName = buildHumanFullName(prefix, firstName, lastName);
  const username = normalizeLower(form.username);
  const password = normalizeText(form.password || form.pin);
  const confirmPassword = normalizeText(
    form.confirmPassword || form.confirmPin,
  );

  if (!prefix) {
    return { status: "Error", message: "กรุณาเลือกคำนำหน้าชื่อ" } as JsonObject;
  }
  if (!firstName) {
    return { status: "Error", message: "กรุณากรอกชื่อ" } as JsonObject;
  }
  if (!lastName) {
    return { status: "Error", message: "กรุณากรอกสกุล" } as JsonObject;
  }
  if (!fullName) {
    return {
      status: "Error",
      message: "กรุณากรอกชื่อและสกุลให้ครบถ้วน",
    } as JsonObject;
  }
  if (!username || username.length < 4) {
    return {
      status: "Error",
      message: "ชื่อผู้ใช้ต้องยาวอย่างน้อย 4 ตัวอักษร",
    } as JsonObject;
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
    return {
      status: "Error",
      message: "ชื่อผู้ใช้ใช้ได้เฉพาะภาษาอังกฤษ ตัวเลข จุด ขีด และขีดล่าง",
    } as JsonObject;
  }
  if (!isStrongPasswordInput(password)) {
    return {
      status: "Error",
      message: "รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร หรือใช้ PIN 6 หลัก",
    } as JsonObject;
  }
  if (password !== confirmPassword) {
    return { status: "Error", message: "ยืนยันรหัสผ่านไม่ตรงกัน" } as JsonObject;
  }

  const existingUser = await findUserByUsername(username);
  if (existingUser) {
    return { status: "Error", message: "ชื่อผู้ใช้นี้ถูกใช้งานแล้ว" } as JsonObject;
  }

  const passwordHash = await createHashRecord(password);
  const pinUniqueKey = isValidSixDigitPin(password)
    ? await computePinUniqueKey(password)
    : "";
  if (pinUniqueKey) {
    const duplicatePinRows = await callSupabase("app_users", {
      select: "user_id",
      pin_unique_key: `eq.${pinUniqueKey}`,
      limit: "1",
    });
    if (duplicatePinRows.length > 0) {
      return {
        status: "Error",
        message: "รหัสผ่านแบบ PIN นี้ถูกใช้งานแล้ว กรุณาเปลี่ยนเป็นค่าอื่น",
      } as JsonObject;
    }
  }

  const nowText = formatThaiDateTime(new Date());
  await insertSupabaseRows("app_users", {
    user_id: crypto.randomUUID(),
    username,
    full_name: fullName,
    email: "",
    password_hash: passwordHash,
    role: "staff",
    status: USER_STATUS_PENDING,
    created_at_text: nowText,
    updated_at_text: nowText,
    last_login_at_text: "",
    reset_otp_hash: "",
    reset_otp_expire_at_text: "",
    reset_otp_requested_at_text: "",
    reset_otp_used_at_text: "",
    permissions_json: "",
    prefix,
    first_name: firstName,
    last_name: lastName,
    email_verified_at_text: "",
    pin_hash: passwordHash,
    pin_unique_key: pinUniqueKey,
    pin_updated_at_text: nowText,
    email_verify_otp_hash: "",
    email_verify_otp_expire_at_text: "",
    email_verify_otp_requested_at_text: "",
    raw_json: {
      registrationSource: "web-signup-approval-flow",
      approvalRequired: true,
    },
    imported_at: new Date().toISOString(),
  });

  return {
    status: "Success",
    message: "ส่งคำขอสมัครใช้งานเรียบร้อยแล้ว กรุณารอผู้ดูแลระบบอนุมัติก่อนเข้าสู่ระบบ",
    requiresApproval: true,
    identifier: username,
  } as JsonObject;
};

const updateCurrentUserProfile = async (payload: RpcPayload) => {
  const { session } = await resolveSession(payload);
  const rawArg = payload.args?.[0];
  const form = typeof rawArg === "string"
    ? normalizeSettingsInputObject(JSON.parse(rawArg || "{}"))
    : normalizeSettingsInputObject(rawArg);
  const email = normalizeLower(form.email);

  if (!email) {
    return { status: "Error", message: "กรุณากรอกอีเมล" } as JsonObject;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: "Error", message: "รูปแบบอีเมลไม่ถูกต้อง" } as JsonObject;
  }

  const currentUser = await findUserByUsername(session.username);
  if (!currentUser) {
    return { status: "Error", message: "ไม่พบบัญชีผู้ใช้งานในระบบ" } as JsonObject;
  }

  const existingEmailRows = await callSupabase("app_users", {
    select: "user_id,email",
    email: `eq.${email}`,
    limit: "2",
  });
  const emailOwner = existingEmailRows.find((row) =>
    normalizeText(row.user_id) !== normalizeText(currentUser.user_id)
  );
  if (emailOwner) {
    return { status: "Error", message: "อีเมลนี้ถูกใช้งานแล้ว" } as JsonObject;
  }

  const nowText = formatThaiDateTime(new Date());
  await patchSupabaseRows(
    "app_users",
    { user_id: `eq.${normalizeText(currentUser.user_id)}` },
    {
      email,
      updated_at_text: nowText,
    },
  );

  const refreshedUser = await findUserById(currentUser.user_id);
  return {
    status: "Success",
    message: "บันทึกอีเมลเรียบร้อยแล้ว",
    email,
    user: mapUserRowForClient(refreshedUser),
  } as JsonObject;
};

const adminUpdateUserAccount = async (payload: RpcPayload) => {
  const { session } = await resolveSession(payload);
  requirePermission(session, "users.manage", "ไม่มีสิทธิ์จัดการผู้ใช้งาน");

  const rawArg = payload.args?.[0];
  const form = typeof rawArg === "string"
    ? normalizeSettingsInputObject(JSON.parse(rawArg || "{}"))
    : normalizeSettingsInputObject(rawArg);
  const targetUserId = normalizeText(form.userId);
  if (!targetUserId) {
    return { status: "Error", message: "ไม่พบรหัสผู้ใช้ที่ต้องการแก้ไข" } as JsonObject;
  }

  const targetUser = await findUserById(targetUserId);
  if (!targetUser) {
    return { status: "Error", message: "ไม่พบบัญชีผู้ใช้ที่ต้องการแก้ไข" } as JsonObject;
  }

  const nextRole = normalizeRole(form.role || targetUser.role || "staff");
  const nextStatus = normalizeUserStatus(form.status || targetUser.status);
  const nextFullName = normalizeHumanNamePart(form.fullName) ||
    normalizeText(targetUser.full_name);
  const nextPermissionsJson = sanitizePermissionsJsonText(
    form.permissionsJson !== undefined
      ? form.permissionsJson
      : targetUser.permissions_json,
  );

  if (!nextFullName) {
    return { status: "Error", message: "กรุณาระบุชื่อ-สกุลของผู้ใช้" } as JsonObject;
  }
  if (normalizeText(session.userId) === targetUserId) {
    if (nextStatus !== USER_STATUS_ACTIVE) {
      return {
        status: "Error",
        message: "ไม่อนุญาตให้ระงับบัญชีที่กำลังใช้งานอยู่ของตนเอง",
      } as JsonObject;
    }
    if (normalizeRole(targetUser.role) === "admin" && nextRole !== "admin") {
      return {
        status: "Error",
        message: "ไม่อนุญาตให้ลดสิทธิ์ผู้ดูแลของบัญชีที่กำลังใช้งานอยู่",
      } as JsonObject;
    }
  }

  if (
    normalizeRole(targetUser.role) === "admin" &&
    (nextRole !== "admin" || nextStatus !== USER_STATUS_ACTIVE)
  ) {
    const activeAdminRows = await callSupabase("app_users", {
      select: "user_id",
      role: "eq.admin",
      status: `eq.${USER_STATUS_ACTIVE}`,
      limit: "5000",
    });
    const remainingAdmins = activeAdminRows.filter((row) =>
      normalizeText(row.user_id) !== targetUserId
    );
    if (remainingAdmins.length <= 0) {
      return {
        status: "Error",
        message: "ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 บัญชีเสมอ",
      } as JsonObject;
    }
  }

  const nowText = formatThaiDateTime(new Date());
  await patchSupabaseRows(
    "app_users",
    { user_id: `eq.${targetUserId}` },
    {
      full_name: nextFullName,
      role: nextRole,
      status: nextStatus,
      permissions_json: nextPermissionsJson,
      updated_at_text: nowText,
    },
  );

  const updatedUser = await findUserById(targetUserId);
  await appendAuditLogEntry(session, {
    action: "ADMIN_UPDATE_USER",
    entityType: "USER",
    entityId: targetUserId,
    referenceNo: normalizeText(targetUser.username),
    before: mapUserRowForClient(targetUser),
    after: mapUserRowForClient(updatedUser),
    details: "แก้ไขสิทธิ์/สถานะผู้ใช้งานโดยผู้ดูแลระบบ",
  });

  return {
    status: "Success",
    message: "บันทึกข้อมูลผู้ใช้เรียบร้อยแล้ว",
    user: mapUserRowForClient(updatedUser),
  } as JsonObject;
};

const verifyLoginPin = async (payload: RpcPayload) => {
  const pinOrUsername = payload.args?.[0];
  const pinMaybe = payload.args?.[1];
  let normalizedUsername = "";
  let normalizedPin = "";

  if (
    pinMaybe !== undefined && pinMaybe !== null &&
    normalizeText(pinMaybe) !== ""
  ) {
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

  const lockIdentity = normalizedUsername ||
    `pin:${await computePinUniqueKey(normalizedPin)}`;
  if (getLoginLockoutState(lockIdentity).locked) {
    return {
      status: "Locked",
      message: "พยายามเข้าสู่ระบบผิดเกินกำหนด กรุณารอ 15 นาทีแล้วลองใหม่อีกครั้ง",
    } as JsonObject;
  }

  let userRecord: SupabaseRow | null = null;
  try {
    userRecord = normalizedUsername
      ? await findUserByUsername(normalizedUsername)
      : await findUserByLoginPin(normalizedPin);
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

  const normalizedStatus = normalizeUserStatus(
    userRecord.status || USER_STATUS_PENDING,
  );
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

  const pinMatched = await verifyPasswordAgainstStoredHash(
    normalizedPin,
    userRecord.pin_hash,
  );
  if (!pinMatched) {
    const failedState = registerFailedLoginAttempt(
      normalizeText(userRecord.username) || lockIdentity,
    );
    return {
      status: failedState.locked ? "Locked" : "Error",
      message: failedState.locked
        ? "พยายามเข้าสู่ระบบผิดเกินกำหนด กรุณารอ 15 นาทีแล้วลองใหม่อีกครั้ง"
        : (normalizedUsername ? "ชื่อผู้ใช้ หรือ PIN ไม่ถูกต้อง" : "PIN ไม่ถูกต้อง"),
    } as JsonObject;
  }

  const permissions = getEffectivePermissions(
    userRecord,
    normalizeRole(userRecord.role),
  );
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
    fullName: normalizeText(userRecord.full_name) ||
      normalizeText(userRecord.username),
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
  const tokenSession = await decodeSessionToken(
    normalizeText(payload.sessionToken),
  );
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
        fullName: normalizeText(
          currentUser.fullName || tokenSession.fullName ||
            tokenSession.username,
        ),
        role: normalizeRole(currentUser.role || tokenSession.role),
        issuedAt: normalizeText(tokenSession.issuedAt) ||
          new Date().toISOString(),
        email: normalizeText(currentUser.email || tokenSession.email),
        permissions: Array.isArray(currentUser.permissions)
          ? currentUser.permissions
          : tokenSession.permissions,
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

const buildRuntimeLoanDataFromSupabaseRow = (
  row: SupabaseRow,
  currentMonthContext: { month: number; yearBe: number; monthKey: string },
) => {
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
    ? `${parts.yearBe}${pad2(parts.month)}${pad2(parts.day)}${
      pad2(parts.hour)
    }${pad2(parts.minute)}${pad2(parts.second)}`
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
    if (
      Number(parts.yearBe) !== Number(currentMonthContext.yearBe) ||
      Number(parts.month) !== Number(currentMonthContext.month)
    ) {
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
  const interestRate =
    Number.isFinite(Number(row.interest_rate)) && Number(row.interest_rate) >= 0
      ? Number(row.interest_rate)
      : DEFAULT_INTEREST_RATE;
  const contractNo = normalizeText(row.contract_no);
  const missedInterestMonths = Math.max(0, Number(row.overdue_months) || 0);
  const currentMonthInterestPaid = !!currentMonthInterestPaidMap[contractNo];
  const includeCurrentMonthInstallment =
    shouldCountSelectedMonthAsDueForOverdueReport(
      currentMonthContext.yearBe,
      currentMonthContext.month,
      lastClosedAccountingMonth,
    );
  const currentMonthRequiredInstallment =
    includeCurrentMonthInstallment && !currentMonthInterestPaid ? 1 : 0;
  const reportMissedInterestMonths = missedInterestMonths +
    currentMonthRequiredInstallment;
  return {
    memberId: normalizeText(row.member_id),
    contract: contractNo,
    member: normalizeText(row.borrower_name),
    amount: Number(row.principal_amount) || 0,
    interest: interestRate,
    balance,
    status: deriveLoanStatusFromState(
      balance,
      missedInterestMonths,
      row.status,
    ),
    nextPayment: normalizeText(row.due_date_text),
    missedInterestMonths,
    currentMonthInterestPaid,
    reportMissedInterestMonths,
    currentMonthRequiredInstallment,
    maxInterestInstallments: Math.max(1, reportMissedInterestMonths),
    monthlyInterestDue: Math.max(
      0,
      Math.floor(Math.max(0, balance) * (interestRate / 100) / 12),
    ),
    createdAt: normalizeLoanCreatedAt(row.created_date_text),
    guarantor1: normalizeText(row.guarantor_1),
    guarantor2: normalizeText(row.guarantor_2),
  };
};

const buildAppRuntimePayload = async (
  session: SessionData,
  includeMembers: boolean,
) => {
  const settingsMap = await getSettingsMapSnapshot();
  const currentMonthContext = getCurrentThaiMonthContext();

  const [loanRows, transactionRows, memberRows] = await Promise.all([
    callSupabase("loans", {
      select:
        "contract_no,member_id,borrower_name,principal_amount,interest_rate,outstanding_balance,status,due_date_text,overdue_months,created_date_text,guarantor_1,guarantor_2",
      order: "contract_no.asc",
      limit: "5000",
    }),
    callSupabase("transactions", {
      select:
        "reference_id,occurred_on_text,contract_no,member_id,principal_paid,interest_paid,outstanding_balance,note,actor,full_name,tx_status,interest_months_paid,overdue_interest_before,overdue_interest_after",
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

  const loans = loanRows.map((row) =>
    buildRuntimeLoanDataFromSupabaseRow(row, currentMonthContext)
  );
  const transactions = transactionRows
    .map(buildRuntimeTransactionDataFromSupabaseRow)
    .filter((row) => !isInactiveTransactionStatus(row.txStatus))
    .sort((a, b) =>
      String(b._sortKey || "").localeCompare(String(a._sortKey || ""))
    )
    .slice(0, 100)
    .map(({ _sortKey, ...row }) => row);

  const currentUser = includeMembers
    ? await buildCurrentUserSnapshot(session)
    : null;
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
    dashboardOverviewStats: buildDashboardOverviewStatsFromLoans(
      loans,
      includeMembers ? members.length : 0,
    ),
    settings: {
      interestRate: Number(settingsMap.InterestRate) || DEFAULT_INTEREST_RATE,
      dailyInterestAutomationEnabled: false,
      dailyInterestAutomationSchedule: "คำนวณค้างดอกเมื่อกดปิดยอดสิ้นวัน",
      lastClosedAccountingMonth: normalizeText(
        settingsMap.LastClosedAccountingMonth,
      ),
      lastClosedAccountingAt: normalizeText(settingsMap.LastClosedAccountingAt),
      operatingDayCalendar: normalizeJsonSetting<Record<string, string>>(
        settingsMap[OPERATING_DAY_CALENDAR_SETTING_KEY],
        {},
      ),
      reportLayoutSettings: normalizeJsonSetting<Record<string, JsonValue>>(
        settingsMap[REPORT_LAYOUT_SETTINGS_KEY],
        {},
      ),
      menuSettings: normalizeJsonSetting<Record<string, JsonValue>>(
        settingsMap[MENU_SETTINGS_KEY],
        {},
      ),
    },
  };

  if (includeMembers) {
    payload.members = members;
    payload.currentUser = {
      userId: normalizeText(currentUser?.userId || session.userId),
      username: normalizeText(currentUser?.username || session.username),
      fullName: normalizeText(
        currentUser?.fullName || session.fullName || session.username,
      ),
      email: normalizeLower(currentUser?.email),
      role: normalizeRole(currentUser?.role || session.role),
      permissions: Array.isArray(currentUser?.permissions)
        ? currentUser.permissions
        : getAllPermissionKeys(),
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
      select:
        "contract_no,member_id,borrower_name,principal_amount,interest_rate,outstanding_balance,status,due_date_text,overdue_months,created_date_text,guarantor_1,guarantor_2",
      order: "member_id.asc,contract_no.asc",
      limit: "5000",
    }),
    callSupabase("transactions", {
      select: "contract_no,occurred_on_text,tx_status",
      order: "updated_at.desc",
      limit: "5000",
    }),
  ]);
  const currentMonthInterestPaidMap =
    buildCurrentMonthInterestPaidMapFromSupabaseRows(
      transactionRows,
      currentMonthContext,
    );
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

const getCurrentActorName = (session: SessionData) =>
  normalizeText(session.fullName) || normalizeText(session.username) ||
  "System Admin";

const sanitizeReverseReason = (reason: unknown) =>
  normalizeText(reason).replace(/\s+/g, " ").trim().slice(0, 180);

const buildReverseTransactionNote = (
  sourceTxId: unknown,
  reason: unknown,
  reversalTxId: unknown,
) => {
  const parts = [`กลับรายการอ้างอิง ${normalizeText(sourceTxId) || "-"}`];
  if (normalizeText(reversalTxId)) {
    parts.push(`เลขที่กลับรายการ ${normalizeText(reversalTxId)}`);
  }
  if (normalizeText(reason)) parts.push(`เหตุผล: ${normalizeText(reason)}`);
  return parts.join(" | ").slice(0, 500);
};

const isOffsetPaymentRequest = (paymentData: Record<string, unknown>) => {
  const statusText = normalizeText(paymentData.customStatus);
  const noteText = normalizeText(paymentData.note);
  return statusText.includes("กลบหนี้") || noteText.includes("กลบหนี้");
};

const getLoanByContractNo = async (contractNo: unknown) => {
  const normalizedContractNo = normalizeText(contractNo);
  if (!normalizedContractNo) return null;
  const rows = await callSupabase("loans", {
    select:
      "contract_no,member_id,borrower_name,principal_amount,interest_rate,outstanding_balance,status,due_date_text,overdue_months,created_date_text,guarantor_1,guarantor_2",
    contract_no: `eq.${normalizedContractNo}`,
    limit: "1",
  });
  return rows[0] || null;
};

const getAllMembers = async () => {
  return callSupabase("members", {
    select: "member_id,full_name,status",
    order: "member_id.asc",
    limit: "5000",
  });
};

const getAllLoansForMemberSync = async () => {
  return callSupabase("loans", {
    select:
      "contract_no,member_id,borrower_name,guarantor_1,guarantor_2,status,outstanding_balance,overdue_months",
    order: "contract_no.asc",
    limit: "5000",
  });
};

const upsertMemberRow = async (
  member: { id: string; name: string; status: string },
) => {
  const nowIso = new Date().toISOString();
  await insertSupabaseRows("members", {
    member_id: member.id,
    full_name: member.name,
    status: member.status,
    raw_json: {
      id: member.id,
      name: member.name,
      status: member.status,
    },
    updated_at: nowIso,
    imported_at: nowIso,
  });
};

const pickSingleMemberCandidate = (
  candidates: Array<{ id: string; name: string; status: string }>,
) => {
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  const realMembers = candidates.filter((entry) =>
    !isTemporaryGuarantorStatus(entry.status)
  );
  const tempMembers = candidates.filter((entry) =>
    isTemporaryGuarantorStatus(entry.status)
  );
  if (realMembers.length === 1) return realMembers[0];
  if (realMembers.length === 0 && tempMembers.length === 1) {
    return tempMembers[0];
  }
  return null;
};

const buildMemberRegistryIndex = (members: SupabaseRow[]) => {
  const result: {
    byId: Record<string, { id: string; name: string; status: string }>;
    byNameKey: Record<
      string,
      Array<{ id: string; name: string; status: string }>
    >;
  } = { byId: {}, byNameKey: {} };

  for (const member of members) {
    const entry = {
      id: normalizeTextForMatch(member.member_id),
      name: normalizeTextForMatch(member.full_name),
      status: normalizeTextForMatch(member.status),
    };
    if (!entry.id && !entry.name) continue;
    if (entry.id) result.byId[entry.id] = entry;
    const nameKey = normalizeMemberNameKey(entry.name);
    if (nameKey) {
      if (!result.byNameKey[nameKey]) result.byNameKey[nameKey] = [];
      result.byNameKey[nameKey].push(entry);
    }
  }

  return result;
};

const findBestMemberMatchForGuarantor = (
  memberIndex: ReturnType<typeof buildMemberRegistryIndex>,
  guarantorText: unknown,
) => {
  const rawText = normalizeTextForMatch(guarantorText);
  if (!rawText) return null;

  const parsed = parseGuarantorInputParts(rawText);
  const explicitId = normalizeTextForMatch(parsed.memberId);
  if (explicitId && memberIndex.byId[explicitId]) {
    return memberIndex.byId[explicitId];
  }
  if (memberIndex.byId[rawText]) return memberIndex.byId[rawText];

  const nameKey = normalizeMemberNameKey(parsed.memberName || rawText);
  if (nameKey) {
    return pickSingleMemberCandidate(memberIndex.byNameKey[nameKey] || []);
  }
  return null;
};

const generateNextTemporaryMemberId = (members: SupabaseRow[]) => {
  let maxSeq = 0;
  for (const member of members) {
    const text = normalizeTextForMatch(member.member_id);
    const match = text.match(/^TMP-(\d+)$/i);
    if (match) {
      maxSeq = Math.max(maxSeq, Number(match[1]) || 0);
    }
  }
  return `TMP-${String(maxSeq + 1).padStart(5, "0")}`;
};

const createTemporaryGuarantorMember = async (
  members: SupabaseRow[],
  memberIndex: ReturnType<typeof buildMemberRegistryIndex>,
  guarantorName: unknown,
) => {
  const cleanName = normalizeTextForMatch(guarantorName);
  if (!cleanName) return null;
  const tempId = generateNextTemporaryMemberId(members);
  await upsertMemberRow({
    id: tempId,
    name: cleanName,
    status: TEMP_GUARANTOR_STATUS,
  });
  const entry = { id: tempId, name: cleanName, status: TEMP_GUARANTOR_STATUS };
  memberIndex.byId[tempId] = entry;
  const nameKey = normalizeMemberNameKey(cleanName);
  if (!memberIndex.byNameKey[nameKey]) memberIndex.byNameKey[nameKey] = [];
  memberIndex.byNameKey[nameKey].push(entry);
  members.push({
    member_id: tempId,
    full_name: cleanName,
    status: TEMP_GUARANTOR_STATUS,
  });
  return entry;
};

const ensureGuarantorMemberRecord = async (
  members: SupabaseRow[],
  memberIndex: ReturnType<typeof buildMemberRegistryIndex>,
  guarantorText: unknown,
) => {
  const rawText = normalizeTextForMatch(guarantorText);
  if (!rawText) {
    return {
      memberId: "",
      memberName: "",
      formatted: "",
      createdTemporary: false,
      ambiguous: false,
      rawText: "",
    };
  }

  const directMatch = findBestMemberMatchForGuarantor(memberIndex, rawText);
  if (directMatch) {
    return {
      memberId: directMatch.id,
      memberName: directMatch.name,
      formatted: formatMemberDisplayName(directMatch.id, directMatch.name),
      createdTemporary: false,
      ambiguous: false,
      rawText,
    };
  }

  const parsed = parseGuarantorInputParts(rawText);
  const nameKey = normalizeMemberNameKey(parsed.memberName || rawText);
  const sameNameCandidates = nameKey
    ? (memberIndex.byNameKey[nameKey] || [])
    : [];
  if (
    sameNameCandidates.length > 1 &&
    !pickSingleMemberCandidate(sameNameCandidates)
  ) {
    return {
      memberId: "",
      memberName: normalizeTextForMatch(parsed.memberName || rawText),
      formatted: rawText,
      createdTemporary: false,
      ambiguous: true,
      rawText,
    };
  }

  let tempEntry = pickSingleMemberCandidate(sameNameCandidates);
  if (!tempEntry) {
    tempEntry = await createTemporaryGuarantorMember(
      members,
      memberIndex,
      parsed.memberName || rawText,
    );
  }
  if (!tempEntry) {
    return {
      memberId: "",
      memberName: normalizeTextForMatch(parsed.memberName || rawText),
      formatted: rawText,
      createdTemporary: false,
      ambiguous: false,
      rawText,
    };
  }

  return {
    memberId: tempEntry.id,
    memberName: tempEntry.name,
    formatted: formatMemberDisplayName(tempEntry.id, tempEntry.name),
    createdTemporary: isTemporaryGuarantorStatus(tempEntry.status),
    ambiguous: false,
    rawText,
  };
};

const normalizeLoanGuarantorsForSave = async (
  guarantor1Value: unknown,
  guarantor2Value: unknown,
) => {
  const members = await getAllMembers();
  const memberIndex = buildMemberRegistryIndex(members);
  const result1 = await ensureGuarantorMemberRecord(
    members,
    memberIndex,
    guarantor1Value,
  );
  const result2 = await ensureGuarantorMemberRecord(
    members,
    memberIndex,
    guarantor2Value,
  );

  return {
    guarantor1: result1.formatted || result1.rawText || "",
    guarantor2: result2.formatted || result2.rawText || "",
    createdTemporaryCount: (result1.createdTemporary ? 1 : 0) +
      (result2.createdTemporary ? 1 : 0),
    ambiguousCount: (result1.ambiguous ? 1 : 0) + (result2.ambiguous ? 1 : 0),
  };
};

const syncMemberRegisterFromLoanEdit = async (
  memberId: string,
  updatedMemberName: string,
) => {
  const normalizedMemberId = normalizeText(memberId);
  const normalizedMemberName = normalizeText(updatedMemberName);
  if (!normalizedMemberId || !normalizedMemberName) return;

  const rows = await callSupabase("members", {
    select: "member_id,full_name,status",
    member_id: `eq.${normalizedMemberId}`,
    limit: "1",
  });
  const memberRow = rows[0] || null;
  if (!memberRow) return;
  if (normalizeText(memberRow.full_name) === normalizedMemberName) return;

  await patchMemberRow(normalizedMemberId, {
    full_name: normalizedMemberName,
    raw_json: {
      id: normalizedMemberId,
      name: normalizedMemberName,
      status: normalizeText(memberRow.status),
    },
  });
  await syncGuarantorReferencesForMember(
    normalizedMemberId,
    normalizeText(memberRow.full_name),
    normalizedMemberName,
  );
};

const insertLoanRow = async (loan: Record<string, unknown>) => {
  const nowIso = new Date().toISOString();
  await insertSupabaseRows("loans", {
    contract_no: normalizeText(loan.contract),
    member_id: normalizeText(loan.memberId),
    borrower_name: normalizeText(loan.member),
    principal_amount: Number(loan.amount) || 0,
    interest_rate: Number(loan.interest) || 0,
    outstanding_balance: Number(loan.balance) || 0,
    status: normalizeText(loan.status),
    due_date_text: normalizeText(loan.nextPayment) || "-",
    overdue_months: Math.max(0, Number(loan.missedInterestMonths) || 0),
    created_date_text: normalizeLoanCreatedAt(loan.createdAt) ||
      formatThaiDate(new Date()),
    guarantor_1: normalizeText(loan.guarantor1),
    guarantor_2: normalizeText(loan.guarantor2),
    raw_json: loan as JsonObject,
    updated_at: nowIso,
    imported_at: nowIso,
  });
};

const patchMemberRow = async (memberId: string, patch: JsonObject) => {
  await patchSupabaseRows("members", { member_id: `eq.${memberId}` }, patch);
};

const syncLoanBorrowerNameForMember = async (
  memberId: string,
  updatedMemberName: string,
) => {
  const loans = await getAllLoansForMemberSync();
  const changedContracts: string[] = [];
  for (const loan of loans) {
    if (normalizeText(loan.member_id) !== memberId) continue;
    if (normalizeText(loan.borrower_name) === updatedMemberName) continue;
    await patchSupabaseRows("loans", {
      contract_no: `eq.${normalizeText(loan.contract_no)}`,
    }, {
      borrower_name: updatedMemberName,
    });
    changedContracts.push(normalizeText(loan.contract_no));
  }
  return changedContracts;
};

const syncGuarantorReferencesForMember = async (
  memberId: string,
  previousMemberName: string,
  updatedMemberName: string,
) => {
  const loans = await getAllLoansForMemberSync();
  const formattedGuarantorText = formatMemberDisplayName(
    memberId,
    updatedMemberName,
  );
  let updatedCount = 0;
  for (const loan of loans) {
    const nextPatch: JsonObject = {};
    let rowChanged = false;
    const currentG1 = normalizeTextForMatch(loan.guarantor_1);
    const currentG2 = normalizeTextForMatch(loan.guarantor_2);
    if (
      guarantorReferenceMatchesMember(
        currentG1,
        memberId,
        previousMemberName,
      ) ||
      guarantorReferenceMatchesMember(currentG1, memberId, updatedMemberName)
    ) {
      if (currentG1 !== formattedGuarantorText) {
        nextPatch.guarantor_1 = formattedGuarantorText;
        rowChanged = true;
      }
    }
    if (
      guarantorReferenceMatchesMember(
        currentG2,
        memberId,
        previousMemberName,
      ) ||
      guarantorReferenceMatchesMember(currentG2, memberId, updatedMemberName)
    ) {
      if (currentG2 !== formattedGuarantorText) {
        nextPatch.guarantor_2 = formattedGuarantorText;
        rowChanged = true;
      }
    }
    if (!rowChanged) continue;
    await patchSupabaseRows("loans", {
      contract_no: `eq.${normalizeText(loan.contract_no)}`,
    }, nextPatch);
    updatedCount += 1;
  }
  return updatedCount;
};

const upgradeTemporaryMemberToReal = async (
  memberId: string,
  memberName: string,
  finalStatus: string,
) => {
  const members = await getAllMembers();
  const nameKey = normalizeTextForMatch(memberName).toLowerCase();
  const tempCandidates = members.filter((member) =>
    normalizeTextForMatch(member.full_name).toLowerCase() === nameKey &&
    isTemporaryGuarantorStatus(member.status)
  );
  if (tempCandidates.length !== 1) return null;

  const tempEntry = tempCandidates[0];
  await patchMemberRow(normalizeText(tempEntry.member_id), {
    member_id: memberId,
    full_name: memberName,
    status: finalStatus || "ปกติ",
    raw_json: {
      id: memberId,
      name: memberName,
      status: finalStatus || "ปกติ",
      previousTempId: normalizeText(tempEntry.member_id),
    },
  });
  await syncGuarantorReferencesForMember(
    memberId,
    normalizeText(tempEntry.full_name),
    memberName,
  );
  return {
    previousTempId: normalizeText(tempEntry.member_id),
    updatedMemberId: memberId,
    updatedMemberName: memberName,
  };
};

const getTransactionById = async (transactionId: unknown) => {
  const normalizedTxId = normalizeText(transactionId);
  if (!normalizedTxId) return null;
  const rows = await callSupabase("transactions", {
    select:
      "reference_id,occurred_on_text,contract_no,member_id,principal_paid,interest_paid,outstanding_balance,note,actor,full_name,tx_status,interest_months_paid,overdue_interest_before,overdue_interest_after",
    reference_id: `eq.${normalizedTxId}`,
    limit: "1",
  });
  return rows[0] || null;
};

const hasAnyTransactionForContract = async (contractNo: unknown) => {
  const normalizedContractNo = normalizeText(contractNo);
  if (!normalizedContractNo) return false;
  const rows = await callSupabase("transactions", {
    select: "reference_id",
    contract_no: `eq.${normalizedContractNo}`,
    limit: "1",
  });
  return rows.length > 0;
};

const findLatestActiveTransactionForContract = async (contractNo: unknown) => {
  const normalizedContractNo = normalizeText(contractNo);
  if (!normalizedContractNo) return null;
  const rows = await callSupabase("transactions", {
    select:
      "reference_id,occurred_on_text,contract_no,member_id,principal_paid,interest_paid,outstanding_balance,note,actor,full_name,tx_status,interest_months_paid,overdue_interest_before,overdue_interest_after",
    contract_no: `eq.${normalizedContractNo}`,
    order: "updated_at.desc",
    limit: "200",
  });
  return rows
    .filter((row) => !isInactiveTransactionStatus(row.tx_status))
    .sort((a, b) =>
      normalizeText(b.occurred_on_text).localeCompare(
        normalizeText(a.occurred_on_text),
      )
    )[0] || null;
};

const hasActivePaymentForContractOnThaiDate = async (
  contractNo: unknown,
  thaiDate: string,
) => {
  const normalizedContractNo = normalizeText(contractNo);
  if (!normalizedContractNo) return false;
  const rows = await callSupabase("transactions", {
    select: "reference_id,occurred_on_text,tx_status",
    contract_no: `eq.${normalizedContractNo}`,
    order: "updated_at.desc",
    limit: "100",
  });
  return rows.some((row) => {
    if (isInactiveTransactionStatus(row.tx_status)) return false;
    const dateOnly = normalizeText(row.occurred_on_text).split(" ")[0] || "";
    return dateOnly === thaiDate;
  });
};

const areDuplicatePaymentPayloadsConsistent = (
  existingTx: SupabaseRow,
  paymentData: Record<string, unknown>,
) => {
  return normalizeText(existingTx.contract_no) ===
      normalizeText(paymentData.contract) &&
    Math.abs(
        (Number(existingTx.principal_paid) || 0) -
          (Number(paymentData.principalPaid) || 0),
      ) < 0.0001 &&
    Math.abs(
        (Number(existingTx.interest_paid) || 0) -
          (Number(paymentData.interestPaid) || 0),
      ) < 0.0001 &&
    Math.abs(
        (Number(existingTx.outstanding_balance) || 0) -
          (Number(paymentData.newBalance) || 0),
      ) < 0.0001;
};

const buildSavePaymentResponse = (
  txId: string,
  timestamp: string,
  paymentData: Record<string, unknown>,
  memberId: string,
  memberName: string,
  serverStatus: string,
  serverNote: string,
) => ({
  transactionId: txId,
  timestamp,
  transaction: {
    id: txId,
    contract: normalizeText(paymentData.contract),
    memberId,
    memberName,
    principalPaid: Number(paymentData.principalPaid) || 0,
    interestPaid: Number(paymentData.interestPaid) || 0,
    newBalance: Number(paymentData.newBalance) || 0,
    note: serverNote,
    status: serverStatus,
  },
});

const savePayment = async (payload: RpcPayload) => {
  const { session } = await resolveSession(payload);
  requirePermission(session, "payments.create", "ไม่มีสิทธิ์บันทึกรับชำระเงิน");

  const rawArg = payload.args?.[0];
  const paymentData = typeof rawArg === "string"
    ? JSON.parse(rawArg) as Record<string, unknown>
    : ((rawArg as Record<string, unknown>) || {});

  let txId = normalizeText(paymentData.id);
  if (!txId) txId = crypto.randomUUID();

  const existingTx = await getTransactionById(txId);
  if (existingTx) {
    if (!areDuplicatePaymentPayloadsConsistent(existingTx, paymentData)) {
      throw new Error(
        "พบรหัสรายการซ้ำ แต่ข้อมูลรายการไม่ตรงกับที่มีอยู่เดิม ระบบยกเลิกการบันทึกเพื่อป้องกันข้อมูลเสียหาย",
      );
    }
    return {
      duplicated: true,
      ...buildSavePaymentResponse(
        txId,
        normalizeText(existingTx.occurred_on_text) ||
          formatThaiDateTime(new Date()),
        {
          ...paymentData,
          contract: existingTx.contract_no,
          principalPaid: existingTx.principal_paid,
          interestPaid: existingTx.interest_paid,
          newBalance: existingTx.outstanding_balance,
        },
        normalizeText(existingTx.member_id),
        normalizeText(existingTx.full_name),
        normalizeText(existingTx.tx_status) || "ปกติ",
        normalizeText(existingTx.note),
      ),
    } as JsonObject;
  }

  const contractNo = normalizeText(paymentData.contract);
  if (!contractNo) throw new Error("กรุณาระบุเลขที่สัญญา");

  const loanRow = await getLoanByContractNo(contractNo);
  if (!loanRow) throw new Error(`ไม่พบเลขที่สัญญา: ${contractNo}`);

  const authoritativeMemberId = normalizeText(loanRow.member_id);
  const authoritativeMemberName = normalizeText(loanRow.borrower_name);
  const principalPaid = Number(paymentData.principalPaid);
  const interestPaid = Number(paymentData.interestPaid);
  let newBalance = Number(paymentData.newBalance);

  if (
    ![principalPaid, interestPaid, newBalance].every((value) =>
      Number.isFinite(value)
    )
  ) {
    throw new Error("ยอดรับชำระต้องเป็นตัวเลขที่ถูกต้อง");
  }
  if (principalPaid < 0 || interestPaid < 0) {
    throw new Error("ยอดรับชำระติดลบไม่ได้");
  }
  if (principalPaid + interestPaid <= 0) {
    throw new Error("กรุณาระบุยอดรับชำระอย่างน้อย 1 รายการ");
  }

  const currentBalance = Number(loanRow.outstanding_balance) || 0;
  let annualInterestRate = Number(loanRow.interest_rate);
  if (!Number.isFinite(annualInterestRate) || annualInterestRate < 0) {
    annualInterestRate = DEFAULT_INTEREST_RATE;
  }
  if (principalPaid > currentBalance) {
    throw new Error("ยอดชำระเงินต้นเกินยอดคงค้าง");
  }

  const isOffsetPayment = isOffsetPaymentRequest(paymentData);
  const todayThaiDate = formatThaiDate(new Date());
  if (
    !isOffsetPayment &&
    await hasActivePaymentForContractOnThaiDate(contractNo, todayThaiDate)
  ) {
    throw new Error("เลขที่สัญญานี้มีรายการรับชำระแล้วในวันนี้");
  }

  if (isOffsetPayment) {
    if (principalPaid !== currentBalance) {
      throw new Error("การกลบหนี้ต้องชำระเต็มยอดคงค้างของสัญญา");
    }
    if (interestPaid !== 0) {
      throw new Error("การกลบหนี้ไม่อนุญาตให้บันทึกยอดดอกเบี้ยในรายการเดียวกัน");
    }
  }

  const expectedMonthlyInterest = Math.floor(
    currentBalance * (annualInterestRate / 100) / 12,
  );
  const interestMonthsPaid = isOffsetPayment
    ? 0
    : Math.max(1, Number(paymentData.interestMonthsPaid) || 1);
  if (!isOffsetPayment && expectedMonthlyInterest > 0) {
    const expectedInterestPaid = expectedMonthlyInterest * interestMonthsPaid;
    if (interestPaid !== expectedInterestPaid) {
      throw new Error(
        "ยอดชำระดอกเบี้ยต้องตรงกับที่ระบบคำนวณอัตโนมัติจากจำนวนงวดดอกที่เลือก",
      );
    }
  }
  if (
    !isOffsetPayment && principalPaid > 0 && expectedMonthlyInterest > 0 &&
    interestPaid <= 0
  ) {
    throw new Error("การชำระเงินต้นต้องชำระดอกเบี้ยตามที่ระบบคำนวณด้วย");
  }

  const recalculatedNewBalance = Math.max(0, currentBalance - principalPaid);
  if (Math.abs(newBalance - recalculatedNewBalance) > 0.0001) {
    newBalance = recalculatedNewBalance;
  }

  const oldMissedInterestMonths = Math.max(
    0,
    Number(paymentData.currentMissedInterestMonths ?? loanRow.overdue_months) ||
      0,
  );
  const newMissedInterestMonths = isOffsetPayment ? 0 : Math.max(
    0,
    Number(paymentData.newMissedInterestMonths ?? oldMissedInterestMonths) ||
      0,
  );
  const serverStatus = isOffsetPayment
    ? "ปิดบัญชี(กลบหนี้)"
    : deriveLoanStatusFromState(
      newBalance,
      newMissedInterestMonths,
      newBalance <= 0
        ? "ปิดบัญชี"
        : normalizeText(paymentData.customStatus) || "ปกติ",
    );
  let serverNote = normalizeText(paymentData.note);
  if (isOffsetPayment) serverNote = "กลบหนี้ด้วยเงินฝากสัจจะ";
  else if (newBalance <= 0) serverNote = "ปิดบัญชี";
  else serverNote = (serverNote || "-").slice(0, 120);

  const timestamp = formatThaiDateTime(new Date());
  await insertSupabaseRows("transactions", {
    reference_id: txId,
    occurred_on_text: timestamp,
    contract_no: contractNo,
    member_id: authoritativeMemberId,
    principal_paid: principalPaid,
    interest_paid: interestPaid,
    outstanding_balance: newBalance,
    note: serverNote,
    actor: getCurrentActorName(session),
    full_name: authoritativeMemberName,
    tx_status: "ปกติ",
    interest_months_paid: interestMonthsPaid,
    overdue_interest_before: oldMissedInterestMonths,
    overdue_interest_after: newMissedInterestMonths,
  });

  await patchSupabaseRows("loans", { contract_no: `eq.${contractNo}` }, {
    outstanding_balance: newBalance,
    status: serverStatus,
    overdue_months: newMissedInterestMonths,
  });

  return buildSavePaymentResponse(
    txId,
    timestamp,
    { ...paymentData, contract: contractNo, newBalance },
    authoritativeMemberId,
    authoritativeMemberName,
    serverStatus,
    serverNote,
  ) as JsonObject;
};

const cancelPayment = async (payload: RpcPayload) => {
  const { session } = await resolveSession(payload);
  requirePermission(session, "payments.reverse", "ไม่มีสิทธิ์ลบรายการรับชำระ");

  const transactionId = payload.args?.[0];
  const reason = payload.args?.[1];
  const normalizedTransactionId = normalizeText(transactionId);
  if (!normalizedTransactionId) throw new Error("ไม่พบข้อมูลรายการ");

  const matchedTx = await getTransactionById(normalizedTransactionId);
  if (!matchedTx) throw new Error("ไม่พบข้อมูลรายการ");
  if (isInactiveTransactionStatus(matchedTx.tx_status)) {
    throw new Error("รายการนี้ถูกยกเลิก/กลับรายการไปแล้ว");
  }

  const contractNo = normalizeText(matchedTx.contract_no);
  if (!contractNo) throw new Error("ไม่พบเลขที่สัญญาของรายการที่ต้องการลบ");

  const normalizedReason = sanitizeReverseReason(reason);
  if (!normalizedReason) throw new Error("กรุณาระบุเหตุผลการกลับรายการ");

  const latestActiveTx = await findLatestActiveTransactionForContract(
    contractNo,
  );
  if (
    !latestActiveTx ||
    normalizeText(latestActiveTx.reference_id) !== normalizedTransactionId
  ) {
    throw new Error(
      "รองรับการลบได้เฉพาะรายการรับชำระล่าสุดของสัญญาในช่วง migration นี้",
    );
  }

  const currentLoan = await getLoanByContractNo(contractNo);
  if (!currentLoan) throw new Error(`ไม่พบเลขที่สัญญา: ${contractNo}`);

  const finalBalance = Math.max(
    0,
    (Number(matchedTx.outstanding_balance) || 0) +
      (Number(matchedTx.principal_paid) || 0),
  );
  const finalMissedInterestMonths = Math.max(
    0,
    Number(matchedTx.overdue_interest_before) || 0,
  );
  const finalStatus = deriveLoanStatusFromState(
    finalBalance,
    finalMissedInterestMonths,
    Number(finalBalance) <= 0 ? "ปิดบัญชี" : "ปกติ",
  );
  const reversalTransactionId = `REV-${
    crypto.randomUUID().replace(/-/g, "").slice(0, 20)
  }`;
  const reversalTimestamp = formatThaiDateTime(new Date());
  const reversalNote = buildReverseTransactionNote(
    normalizedTransactionId,
    normalizedReason,
    reversalTransactionId,
  );

  await insertSupabaseRows("transactions", {
    reference_id: reversalTransactionId,
    occurred_on_text: reversalTimestamp,
    contract_no: contractNo,
    member_id: normalizeText(matchedTx.member_id),
    principal_paid: Number(matchedTx.principal_paid) || 0,
    interest_paid: Number(matchedTx.interest_paid) || 0,
    outstanding_balance: finalBalance,
    note: reversalNote,
    actor: getCurrentActorName(session),
    full_name: normalizeText(matchedTx.full_name),
    tx_status: "กลับรายการ",
    interest_months_paid: Number(matchedTx.interest_months_paid) || 0,
    overdue_interest_before: Number(matchedTx.overdue_interest_after) || 0,
    overdue_interest_after: finalMissedInterestMonths,
  });

  await patchSupabaseRows("transactions", {
    reference_id: `eq.${normalizedTransactionId}`,
  }, {
    tx_status: "ยกเลิก",
    note: buildReverseTransactionNote(
      normalizedTransactionId,
      normalizedReason,
      reversalTransactionId,
    ),
  });

  await patchSupabaseRows("loans", { contract_no: `eq.${contractNo}` }, {
    outstanding_balance: finalBalance,
    status: finalStatus,
    overdue_months: finalMissedInterestMonths,
  });

  return {
    message: "ลบรายการรับชำระเรียบร้อยแล้ว และคืนยอดสัญญาอัตโนมัติ",
    transactionId: normalizedTransactionId,
    reversalTransactionId,
    contractNo,
    finalLoanState: {
      balance: finalBalance,
      status: finalStatus,
      missedInterestMonths: finalMissedInterestMonths,
      contract: contractNo,
    },
  } as JsonObject;
};

const addMember = async (payload: RpcPayload) => {
  const { session } = await resolveSession(payload);
  requirePermission(session, "members.manage", "ไม่มีสิทธิ์เพิ่มสมาชิก");

  const rawArg = payload.args?.[0];
  const parsed = typeof rawArg === "string"
    ? JSON.parse(rawArg) as Record<string, unknown>
    : ((rawArg as Record<string, unknown>) || {});
  const member = validateMemberPayloadForWrite(parsed);

  const existingRows = await callSupabase("members", {
    select: "member_id",
    member_id: `eq.${member.id}`,
    limit: "1",
  });
  if (existingRows.length > 0) {
    return { status: "Duplicate ID" } as JsonObject;
  }

  const upgraded = await upgradeTemporaryMemberToReal(
    member.id,
    member.name,
    member.status,
  );
  if (upgraded) {
    return {
      action: "upgradedTemporaryGuarantor",
      previousTempId: upgraded.previousTempId,
      member,
    } as JsonObject;
  }

  await upsertMemberRow(member);
  return {
    action: "createdMember",
    member,
  } as JsonObject;
};

const updateMember = async (payload: RpcPayload) => {
  const { session } = await resolveSession(payload);
  requirePermission(session, "members.manage", "ไม่มีสิทธิ์แก้ไขสมาชิก");

  const rawArg = payload.args?.[0];
  const parsed = typeof rawArg === "string"
    ? JSON.parse(rawArg) as Record<string, unknown>
    : ((rawArg as Record<string, unknown>) || {});
  const member = validateMemberPayloadForWrite(parsed);

  const rows = await callSupabase("members", {
    select: "member_id,full_name,status",
    member_id: `eq.${member.id}`,
    limit: "1",
  });
  const existingMember = rows[0] || null;
  if (!existingMember) {
    throw new Error("ไม่พบรหัสสมาชิก");
  }

  const previousMemberName = normalizeText(existingMember.full_name);
  await patchMemberRow(member.id, {
    full_name: member.name,
    status: member.status,
    raw_json: {
      id: member.id,
      name: member.name,
      status: member.status,
      previousName: previousMemberName,
    },
  });

  await syncLoanBorrowerNameForMember(member.id, member.name);
  await syncGuarantorReferencesForMember(
    member.id,
    previousMemberName,
    member.name,
  );
  return { ok: true } as JsonObject;
};

const addLoan = async (payload: RpcPayload) => {
  const { session } = await resolveSession(payload);
  requirePermission(session, "loans.manage", "ไม่มีสิทธิ์เพิ่มสัญญาเงินกู้");

  const rawArg = payload.args?.[0];
  const parsed = typeof rawArg === "string"
    ? JSON.parse(rawArg) as Record<string, unknown>
    : ((rawArg as Record<string, unknown>) || {});
  const loanData = validateLoanPayloadForWrite(parsed);

  const existingLoan = await getLoanByContractNo(loanData.contract);
  if (existingLoan) {
    throw new Error("เลขที่สัญญานี้มีในระบบแล้ว");
  }

  const createdAt = normalizeLoanCreatedAt(loanData.createdAt) ||
    formatThaiDate(new Date());
  const autoApprovedStatus = loanData.status && loanData.status !== "รออนุมัติ"
    ? loanData.status
    : "ปกติ";
  const normalizedGuarantors = await normalizeLoanGuarantorsForSave(
    loanData.guarantor1,
    loanData.guarantor2,
  );

  await insertLoanRow({
    ...loanData,
    createdAt,
    status: autoApprovedStatus,
    missedInterestMonths: 0,
    guarantor1: normalizedGuarantors.guarantor1 || "",
    guarantor2: normalizedGuarantors.guarantor2 || "",
  });

  return {
    message: "บันทึกสัญญากู้เรียบร้อยแล้ว",
    contract: loanData.contract,
    createdTemporaryGuarantors: normalizedGuarantors.createdTemporaryCount,
    ambiguousGuarantors: normalizedGuarantors.ambiguousCount,
  } as JsonObject;
};

const editLoan = async (payload: RpcPayload) => {
  const { session } = await resolveSession(payload);
  requirePermission(session, "loans.manage", "ไม่มีสิทธิ์แก้ไขสัญญาเงินกู้");

  const rawArg = payload.args?.[0];
  const parsed = typeof rawArg === "string"
    ? JSON.parse(rawArg) as Record<string, unknown>
    : ((rawArg as Record<string, unknown>) || {});
  const loanData = validateLoanPayloadForWrite(parsed);

  const existingLoan = await getLoanByContractNo(loanData.contract);
  if (!existingLoan) {
    throw new Error("ไม่พบเลขที่สัญญา");
  }

  const currentCreatedAt = normalizeLoanCreatedAt(
    existingLoan.created_date_text,
  );
  const createdAt =
    normalizeLoanCreatedAt(loanData.createdAt || currentCreatedAt) ||
    formatThaiDate(new Date());
  const normalizedGuarantors = await normalizeLoanGuarantorsForSave(
    loanData.guarantor1,
    loanData.guarantor2,
  );

  await patchSupabaseRows("loans", { contract_no: `eq.${loanData.contract}` }, {
    member_id: loanData.memberId,
    borrower_name: loanData.member,
    principal_amount: loanData.amount,
    interest_rate: loanData.interest,
    outstanding_balance: loanData.balance,
    status: loanData.status || "ปกติ",
    due_date_text: loanData.nextPayment,
    overdue_months: loanData.missedInterestMonths,
    created_date_text: createdAt,
    guarantor_1: normalizedGuarantors.guarantor1 || "",
    guarantor_2: normalizedGuarantors.guarantor2 || "",
    raw_json: {
      ...loanData,
      createdAt,
      guarantor1: normalizedGuarantors.guarantor1 || "",
      guarantor2: normalizedGuarantors.guarantor2 || "",
    },
  });

  await syncMemberRegisterFromLoanEdit(loanData.memberId, loanData.member);

  return {
    message: "แก้ไขข้อมูลสัญญาเรียบร้อยแล้ว",
    contract: loanData.contract,
    createdTemporaryGuarantors: normalizedGuarantors.createdTemporaryCount,
    ambiguousGuarantors: normalizedGuarantors.ambiguousCount,
  } as JsonObject;
};

const updateLoanStatus = async (payload: RpcPayload) => {
  const { session } = await resolveSession(payload);
  requirePermission(session, "loans.manage", "ไม่มีสิทธิ์อนุมัติหรือปรับสถานะสัญญา");

  const contractNo = normalizeText(payload.args?.[0]);
  const status = normalizeText(payload.args?.[1]);
  if (!contractNo) throw new Error("ไม่พบเลขที่สัญญา");
  if (!status) throw new Error("กรุณาระบุสถานะสัญญา");

  const existingLoan = await getLoanByContractNo(contractNo);
  if (!existingLoan) {
    throw new Error("ไม่พบเลขที่สัญญา");
  }

  await patchSupabaseRows("loans", { contract_no: `eq.${contractNo}` }, {
    status,
    raw_json: {
      ...normalizeJsonSetting<Record<string, JsonValue>>(
        existingLoan.raw_json,
        {} as Record<string, JsonValue>,
      ),
      contract: normalizeText(existingLoan.contract_no),
      memberId: normalizeText(existingLoan.member_id),
      member: normalizeText(existingLoan.borrower_name),
      amount: Number(existingLoan.principal_amount) || 0,
      interest: Number(existingLoan.interest_rate) || 0,
      balance: Number(existingLoan.outstanding_balance) || 0,
      status,
      nextPayment: normalizeText(existingLoan.due_date_text) || "-",
      missedInterestMonths: Math.max(
        0,
        Number(existingLoan.overdue_months) || 0,
      ),
      createdAt: normalizeLoanCreatedAt(existingLoan.created_date_text),
      guarantor1: normalizeText(existingLoan.guarantor_1),
      guarantor2: normalizeText(existingLoan.guarantor_2),
    },
  });

  return {
    message: "อัปเดตสถานะสัญญาเรียบร้อยแล้ว",
    contract: contractNo,
    status,
  } as JsonObject;
};

const deleteLoan = async (payload: RpcPayload) => {
  const { session } = await resolveSession(payload);
  requirePermission(session, "loans.manage", "ไม่มีสิทธิ์ลบสัญญาเงินกู้");

  const contractNo = normalizeText(payload.args?.[0]);
  if (!contractNo) throw new Error("ไม่พบเลขที่สัญญา");

  const existingLoan = await getLoanByContractNo(contractNo);
  if (!existingLoan) {
    throw new Error("ไม่พบเลขที่สัญญา");
  }

  if (await hasAnyTransactionForContract(contractNo)) {
    throw new Error("สัญญานี้มีประวัติธุรกรรมแล้ว ไม่อนุญาตให้ลบถาวร");
  }

  await deleteSupabaseRows("loans", { contract_no: `eq.${contractNo}` });
  return {
    message: "ลบข้อมูลสัญญาสำเร็จ",
    contract: contractNo,
  } as JsonObject;
};

const getPaymentLookupByMemberId = async (memberId: unknown) => {
  const normalizedMemberId = normalizeText(memberId);
  if (!normalizedMemberId) {
    return {
      status: "Error",
      message: "กรุณาระบุรหัสสมาชิก",
      memberId: "",
      memberName: "",
      loans: [],
      todayTransactions: [],
      interestRate: DEFAULT_INTEREST_RATE,
    } as JsonObject;
  }

  const settingsMap = await getSettingsMapSnapshot();
  const currentMonthContext = getCurrentThaiMonthContext();
  const [loanRows, txRows] = await Promise.all([
    callSupabase("loans", {
      select:
        "contract_no,member_id,borrower_name,principal_amount,interest_rate,outstanding_balance,status,due_date_text,overdue_months,created_date_text,guarantor_1,guarantor_2",
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
  const currentMonthInterestPaidMap =
    buildCurrentMonthInterestPaidMapFromSupabaseRows(
      txRows,
      currentMonthContext,
    );
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
    return String(a.contract || "").localeCompare(
      String(b.contract || ""),
      "th",
      { numeric: true, sensitivity: "base" },
    );
  });

  return {
    memberId: normalizedMemberId,
    memberName: loans.length ? normalizeText(loans[0].member) : "",
    loans,
    todayTransactions: [],
    interestRate: Number(settingsMap.InterestRate) || DEFAULT_INTEREST_RATE,
  } as JsonObject;
};

const getTodayTransactionsForMemberPaymentEdit = async (memberId: unknown) => {
  const normalizedMemberId = normalizeText(memberId);
  if (!normalizedMemberId) {
    return {
      status: "Error",
      message: "กรุณาระบุรหัสสมาชิก",
      memberId: "",
      memberName: "",
      transactions: [],
    } as JsonObject;
  }

  const todayThaiDate = formatThaiDate(new Date());
  const rows = await callSupabase("transactions", {
    select:
      "reference_id,occurred_on_text,contract_no,member_id,principal_paid,interest_paid,outstanding_balance,note,full_name,tx_status,interest_months_paid,overdue_interest_before,overdue_interest_after",
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
    .sort((a, b) =>
      String(b.timestamp || "").localeCompare(String(a.timestamp || ""))
    );

  return {
    memberId: normalizedMemberId,
    memberName: transactions.length
      ? normalizeText(transactions[0].memberName)
      : "",
    transactions,
  } as JsonObject;
};

const getNotificationSettings = async (payload: RpcPayload) => {
  const { session } = await resolveSession(payload);
  requireAnyPermission(
    session,
    ["notifications.manage", "settings.manage"],
    "ไม่มีสิทธิ์ดูการตั้งค่าการแจ้งเตือน",
  );

  const settingsMap = await getSettingsMapSnapshot();
  return {
    settings: buildNotificationSettingsPayload(settingsMap),
    cached: false,
  } as JsonObject;
};

const saveSettings = async (payload: RpcPayload) => {
  const { session } = await resolveSession(payload);
  const rawArg = payload.args?.[0];
  const settingsData = typeof rawArg === "string"
    ? normalizeSettingsInputObject(JSON.parse(rawArg || "{}"))
    : normalizeSettingsInputObject(rawArg);

  const hasOwn = (key: string) =>
    Object.prototype.hasOwnProperty.call(settingsData, key);
  const wantsNotificationSettings = hasOwn("notificationSettings");
  const wantsInterestRate = hasOwn("interestRate");
  const wantsReportLayoutSettings = hasOwn("reportLayoutSettings");
  const wantsMenuSettings = hasOwn("menuSettings");

  if (
    !wantsNotificationSettings && !wantsInterestRate &&
    !wantsReportLayoutSettings && !wantsMenuSettings
  ) {
    requirePermission(session, "settings.manage", "ไม่มีสิทธิ์แก้ไขการตั้งค่าระบบ");
  } else if (
    wantsInterestRate || wantsReportLayoutSettings || wantsMenuSettings
  ) {
    requirePermission(session, "settings.manage", "ไม่มีสิทธิ์แก้ไขการตั้งค่าระบบ");
  } else if (wantsNotificationSettings) {
    requireAnyPermission(
      session,
      ["notifications.manage", "settings.manage"],
      "ไม่มีสิทธิ์จัดการการแจ้งเตือนอีเมล",
    );
  }

  const existingSettingsMap = await getSettingsMapSnapshot();
  const updates: Record<
    string,
    { valueText: string; valueJson?: JsonValue | null }
  > = {};

  if (wantsInterestRate) {
    let normalizedInterestRate = Number(settingsData.interestRate);
    if (
      !Number.isFinite(normalizedInterestRate) || normalizedInterestRate <= 0
    ) {
      normalizedInterestRate = Number(existingSettingsMap.InterestRate) ||
        DEFAULT_INTEREST_RATE;
    }
    updates.InterestRate = {
      valueText: String(normalizedInterestRate),
      valueJson: null,
    };
  }

  if (wantsReportLayoutSettings) {
    const normalizedReportLayoutSettings = normalizeSettingsInputObject(
      settingsData.reportLayoutSettings,
    );
    updates[REPORT_LAYOUT_SETTINGS_KEY] = {
      valueText: JSON.stringify(normalizedReportLayoutSettings),
      valueJson: normalizedReportLayoutSettings as JsonObject,
    };
  }

  if (wantsMenuSettings) {
    const normalizedMenuSettings = normalizeSettingsInputObject(
      settingsData.menuSettings,
    );
    updates[MENU_SETTINGS_KEY] = {
      valueText: JSON.stringify(normalizedMenuSettings),
      valueJson: normalizedMenuSettings as JsonObject,
    };
  }

  if (wantsNotificationSettings) {
    const notificationSettings = normalizeSettingsInputObject(
      settingsData.notificationSettings,
    );
    updates.NotificationRecipients = {
      valueText: normalizeText(notificationSettings.recipients),
      valueJson: null,
    };
    updates.NotifyApprovalSubmitted = {
      valueText: String(!!notificationSettings.notifyApprovalSubmitted),
      valueJson: null,
    };
    updates.NotifyApprovalApproved = {
      valueText: String(!!notificationSettings.notifyApprovalApproved),
      valueJson: null,
    };
    updates.NotifyApprovalRejected = {
      valueText: String(!!notificationSettings.notifyApprovalRejected),
      valueJson: null,
    };
    updates.NotifyAttachmentUploaded = {
      valueText: String(!!notificationSettings.notifyAttachmentUploaded),
      valueJson: null,
    };
    updates.NotifyPaymentCreated = {
      valueText: String(!!notificationSettings.notifyPaymentCreated),
      valueJson: null,
    };
    updates.NotifyPaymentReversed = {
      valueText: String(!!notificationSettings.notifyPaymentReversed),
      valueJson: null,
    };
    updates.NotifyReportArchived = {
      valueText: String(!!notificationSettings.notifyReportArchived),
      valueJson: null,
    };
    updates.NotifyAccountingClosed = {
      valueText: String(!!notificationSettings.notifyAccountingClosed),
      valueJson: null,
    };
    updates.NotifyBackupCompleted = {
      valueText: String(!!notificationSettings.notifyBackupCompleted),
      valueJson: null,
    };
  }

  if (Object.keys(updates).length > 0) {
    await upsertAppSettingValues(updates);
  }

  const response: JsonObject = {
    message: "บันทึกการตั้งค่าเรียบร้อยแล้ว",
  };
  if (wantsNotificationSettings) {
    const nextSettingsMap = await getSettingsMapSnapshot();
    response.settings = buildNotificationSettingsPayload(nextSettingsMap);
  }
  return response;
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
      return appError(
        (error as Error)?.message || "ไม่สามารถสร้าง session ได้",
        "CREATE_GUEST_SESSION_FAILED",
      );
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
      return appError(
        (error as Error)?.message || "ไม่สามารถตรวจสอบสถานะ session ได้",
        "SESSION_SNAPSHOT_FAILED",
      );
    }
  },
  async getAppRuntimeSnapshot(payload) {
    try {
      const { session } = await resolveSession(payload);
      return success(await buildAppRuntimePayload(session, false));
    } catch (error) {
      return appError(
        (error as Error)?.message || "ไม่สามารถโหลด runtime snapshot ได้",
        "APP_RUNTIME_SNAPSHOT_FAILED",
      );
    }
  },
  async getAppData(payload) {
    try {
      const { session } = await resolveSession(payload);
      return success(await buildAppRuntimePayload(session, true));
    } catch (error) {
      return appError(
        (error as Error)?.message || "ไม่สามารถโหลดข้อมูลระบบได้",
        "APP_DATA_FAILED",
      );
    }
  },
  async getPaymentReadyData(payload) {
    try {
      await resolveSession(payload);
      return success(await buildPaymentReadyData());
    } catch (error) {
      return appError(
        (error as Error)?.message || "ไม่สามารถโหลดข้อมูลรับชำระได้",
        "PAYMENT_READY_DATA_FAILED",
      );
    }
  },
  async getPaymentLookupByMemberId(payload) {
    try {
      await resolveSession(payload);
      return success(await getPaymentLookupByMemberId(payload.args?.[0]));
    } catch (error) {
      return appError(
        (error as Error)?.message || "ค้นหาข้อมูลรับชำระไม่สำเร็จ",
        "PAYMENT_LOOKUP_FAILED",
        {
          loans: [],
          todayTransactions: [],
        },
      );
    }
  },
  async getTodayTransactionsForMemberPaymentEdit(payload) {
    try {
      await resolveSession(payload);
      return success(
        await getTodayTransactionsForMemberPaymentEdit(payload.args?.[0]),
      );
    } catch (error) {
      return appError(
        (error as Error)?.message || "โหลดรายการรับชำระของสมาชิกไม่สำเร็จ",
        "TODAY_TRANSACTIONS_FAILED",
        {
          transactions: [],
        },
      );
    }
  },
  async verifyLogin(payload) {
    try {
      return success(await verifyLogin(payload));
    } catch (error) {
      return appError(
        (error as Error)?.message || "เข้าสู่ระบบไม่สำเร็จ",
        "VERIFY_LOGIN_FAILED",
      );
    }
  },
  async verifyLoginPin(payload) {
    try {
      return success(await verifyLoginPin(payload));
    } catch (error) {
      return appError(
        (error as Error)?.message || "เข้าสู่ระบบไม่สำเร็จ",
        "VERIFY_LOGIN_PIN_FAILED",
      );
    }
  },
  async registerUser(payload) {
    try {
      return success(await registerUser(payload));
    } catch (error) {
      return appError(
        (error as Error)?.message || "สมัครใช้งานไม่สำเร็จ",
        "REGISTER_USER_FAILED",
      );
    }
  },
  async updateCurrentUserProfile(payload) {
    try {
      return success(await updateCurrentUserProfile(payload));
    } catch (error) {
      return appError(
        (error as Error)?.message || "อัปเดตข้อมูลผู้ใช้ไม่สำเร็จ",
        "UPDATE_CURRENT_USER_PROFILE_FAILED",
      );
    }
  },
  async adminUpdateUserAccount(payload) {
    try {
      return success(await adminUpdateUserAccount(payload));
    } catch (error) {
      return appError(
        (error as Error)?.message || "บันทึกข้อมูลผู้ใช้ไม่สำเร็จ",
        "ADMIN_UPDATE_USER_ACCOUNT_FAILED",
      );
    }
  },
  async savePayment(payload) {
    try {
      return success(await savePayment(payload));
    } catch (error) {
      return appError(
        (error as Error)?.message || "ระบบขัดข้องในการบันทึกรายการรับชำระ",
        "SAVE_PAYMENT_FAILED",
      );
    }
  },
  async cancelPayment(payload) {
    try {
      return success(await cancelPayment(payload));
    } catch (error) {
      return appError(
        (error as Error)?.message || "ระบบขัดข้องในการลบรายการรับชำระ",
        "CANCEL_PAYMENT_FAILED",
      );
    }
  },
  async addMember(payload) {
    try {
      return success(await addMember(payload));
    } catch (error) {
      return appError(
        (error as Error)?.message || "ไม่สามารถเพิ่มสมาชิกได้",
        "ADD_MEMBER_FAILED",
      );
    }
  },
  async updateMember(payload) {
    try {
      return success(await updateMember(payload));
    } catch (error) {
      return appError(
        (error as Error)?.message || "ไม่สามารถแก้ไขสมาชิกได้",
        "UPDATE_MEMBER_FAILED",
      );
    }
  },
  async addLoan(payload) {
    try {
      return success(await addLoan(payload));
    } catch (error) {
      return appError(
        (error as Error)?.message || "ไม่สามารถเพิ่มสัญญาเงินกู้ได้",
        "ADD_LOAN_FAILED",
      );
    }
  },
  async editLoan(payload) {
    try {
      return success(await editLoan(payload));
    } catch (error) {
      return appError(
        (error as Error)?.message || "ไม่สามารถแก้ไขสัญญาเงินกู้ได้",
        "EDIT_LOAN_FAILED",
      );
    }
  },
  async updateLoanStatus(payload) {
    try {
      return success(await updateLoanStatus(payload));
    } catch (error) {
      return appError(
        (error as Error)?.message || "ไม่สามารถอัปเดตสถานะสัญญาได้",
        "UPDATE_LOAN_STATUS_FAILED",
      );
    }
  },
  async deleteLoan(payload) {
    try {
      return success(await deleteLoan(payload));
    } catch (error) {
      return appError(
        (error as Error)?.message || "ไม่สามารถลบสัญญาเงินกู้ได้",
        "DELETE_LOAN_FAILED",
      );
    }
  },
  async getNotificationSettings(payload) {
    try {
      return success(await getNotificationSettings(payload));
    } catch (error) {
      return appError(
        (error as Error)?.message || "โหลดการตั้งค่าการแจ้งเตือนไม่สำเร็จ",
        "GET_NOTIFICATION_SETTINGS_FAILED",
      );
    }
  },
  async getSupabaseSetupStatus(payload) {
    try {
      return success(await getSupabaseSetupStatus(payload));
    } catch (error) {
      return appError(
        (error as Error)?.message || "โหลดสถานะ Supabase setup ไม่สำเร็จ",
        "GET_SUPABASE_SETUP_STATUS_FAILED",
      );
    }
  },
  async setupDatabase(payload) {
    try {
      return success(await setupDatabase(payload));
    } catch (error) {
      return appError(
        (error as Error)?.message || "ตั้งค่าฐานข้อมูลไม่สำเร็จ",
        "SETUP_DATABASE_FAILED",
      );
    }
  },
  async getUserAdminList(payload) {
    try {
      return success(await getUserAdminList(payload));
    } catch (error) {
      return appError(
        (error as Error)?.message || "โหลดข้อมูลผู้ใช้ไม่สำเร็จ",
        "GET_USER_ADMIN_LIST_FAILED",
        { users: [] },
      );
    }
  },
  async getAuditLogs(payload) {
    try {
      return success(await getAuditLogs(payload));
    } catch (error) {
      return appError(
        (error as Error)?.message || "โหลด Audit Logs ไม่สำเร็จ",
        "GET_AUDIT_LOGS_FAILED",
        { records: [] },
      );
    }
  },
  async saveSettings(payload) {
    try {
      return success(await saveSettings(payload));
    } catch (error) {
      return appError(
        (error as Error)?.message || "ไม่สามารถบันทึกการตั้งค่าได้",
        "SAVE_SETTINGS_FAILED",
      );
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
