export type BackendMethodGroup = {
  group: string;
  methods: Array<{ name: string; mode: "read" | "write" }>;
};

export const backendMethodGroups: BackendMethodGroup[] = [
  {
    group: "auth",
    methods: [
      { name: "createGuestSession", mode: "write" },
      { name: "logoutCurrentSession", mode: "write" },
      { name: "getSessionSnapshot", mode: "read" },
      { name: "verifyLoginPin", mode: "write" },
      { name: "verifyLogin", mode: "write" },
      { name: "changePin", mode: "write" },
    ],
  },
  {
    group: "core",
    methods: [
      { name: "getAppData", mode: "read" },
      { name: "getAppRuntimeSnapshot", mode: "read" },
      { name: "saveSettings", mode: "write" },
    ],
  },
  {
    group: "payments",
    methods: [
      { name: "getPaymentReadyData", mode: "read" },
      { name: "getPaymentLookupByMemberId", mode: "read" },
      { name: "getTodayTransactionsForMemberPaymentEdit", mode: "read" },
      { name: "checkMemberInterestPaymentForOffset", mode: "read" },
      { name: "savePayment", mode: "write" },
      { name: "cancelPayment", mode: "write" },
      { name: "getManagedPaymentRecords", mode: "read" },
      { name: "getPassbookTransactions", mode: "read" },
    ],
  },
  {
    group: "members_loans",
    methods: [
      { name: "addMember", mode: "write" },
      { name: "updateMember", mode: "write" },
      { name: "deleteMember", mode: "write" },
      { name: "getMemberDetail", mode: "read" },
      { name: "addLoan", mode: "write" },
      { name: "editLoan", mode: "write" },
      { name: "updateLoanStatus", mode: "write" },
      { name: "deleteLoan", mode: "write" },
      { name: "getLoanDetail", mode: "read" },
    ],
  },
  {
    group: "workflow_admin",
    methods: [
      { name: "listApprovalRequests", mode: "read" },
      { name: "getApprovalDashboardSummary", mode: "read" },
      { name: "getNotificationSettings", mode: "read" },
      { name: "getNotificationHistory", mode: "read" },
      { name: "getUserAdminList", mode: "read" },
      { name: "getAuditLogs", mode: "read" },
      { name: "getExecutiveDashboard", mode: "read" },
    ],
  },
  {
    group: "reports",
    methods: [
      { name: "getDailyReport", mode: "read" },
      { name: "getRegisterReportTransactions", mode: "read" },
      { name: "getOverdueInterestReport", mode: "read" },
      { name: "listReportPdfArchives", mode: "read" },
      { name: "findLatestReportPdfArchiveBySelection", mode: "read" },
    ],
  },
  {
    group: "ops",
    methods: [
      { name: "getDriveAutoBackupSettings", mode: "read" },
      { name: "getDriveAutoBackupHistory", mode: "read" },
      { name: "getSupabaseSetupStatus", mode: "read" },
      { name: "setupDatabase", mode: "write" },
    ],
  },
];

export const backendMethodNames = backendMethodGroups.flatMap((group) =>
  group.methods.map((method) => method.name),
);
