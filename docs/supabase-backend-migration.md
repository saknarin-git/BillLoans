# Supabase Backend Migration Runbook

เอกสารนี้เตรียม repo สำหรับย้าย backend ออกจาก Google Apps Script ไปยัง Supabase Edge Functions และ Supabase Database เต็มระบบ

## สิ่งที่เตรียมไว้แล้วใน repo

- หน้าเว็บใน [index.html](../index.html) รองรับ backend URL แบบ generic แล้ว
- ยังใช้งาน alias เดิม `setGasWebAppUrl()` และ `getGasWebAppUrl()` ได้ เพื่อไม่ให้โค้ดเก่าพัง
- มี scaffold ของ Edge Function ที่ [supabase/functions/app-api/index.ts](../supabase/functions/app-api/index.ts)
- มีรายชื่อ RPC contract ที่หน้าเว็บเรียกใช้อยู่ใน [supabase/functions/app-api/contracts.ts](../supabase/functions/app-api/contracts.ts)

## เป้าหมายสถาปัตยกรรม

1. Frontend เรียก HTTP backend เดียวผ่าน payload รูปแบบเดิม `{ method, args, sessionToken }`
2. Supabase Edge Function `app-api` ทำหน้าที่แทน `doPost` ของ GAS
3. Business logic ค่อย ๆ ย้ายจาก [Code.gs](../Code.gs) ไปเป็น handler ใน Edge Function หรือ Postgres RPC
4. Data source หลักเป็น Supabase tables ทั้งหมด โดยไม่ต้อง mirror จาก Sheets อีกต่อไป

## Contract ที่ต้องรองรับก่อนตัด GAS ออก

ชุด read หลัก:

- `getAppData`
- `getAppRuntimeSnapshot`
- `getPaymentReadyData`
- `getPaymentLookupByMemberId`
- `getTodayTransactionsForMemberPaymentEdit`
- `getSessionSnapshot`
- `getNotificationSettings`

ชุด write หลัก:

- `verifyLoginPin`
- `savePayment`
- `cancelPayment`
- `addMember`
- `updateMember`
- `addLoan`
- `editLoan`
- `saveSettings`

## ลำดับการย้ายที่แนะนำ

1. ย้าย transport ให้เรียก Supabase Edge Function URL
2. ทำ handler read-only ก่อน: `health`, `listMethods`, `getSessionSnapshot`, `getAppRuntimeSnapshot`, `getAppData`
3. ย้าย payment lookup read path: `getPaymentReadyData`, `getPaymentLookupByMemberId`, `getTodayTransactionsForMemberPaymentEdit`
4. ย้าย auth/users: `verifyLoginPin`, `changePin`, `getUserAdminList`
5. ย้าย write path ที่กระทบข้อมูลหลัก: `savePayment`, `cancelPayment`, `addMember`, `updateMember`, `addLoan`, `editLoan`, `saveSettings`
6. ย้าย reports/workflow/admin methods ที่เหลือ
7. ปิด fallback ไป GAS และลบ `window.__GAS_WEB_APP_URL__` ออกจากหน้าเว็บ

สถานะล่าสุด:

- `verifyLoginPin`, `savePayment`, `cancelPayment`, `addMember`, `updateMember`, `addLoan`, `editLoan`, `updateLoanStatus`, `deleteLoan`, `getNotificationSettings`, `saveSettings` ถูกย้ายมารอบแรกแล้วใน Edge Function
- `cancelPayment` ยังจำกัดที่การกลับรายการล่าสุดของสัญญา เพื่อหลีกเลี่ยงยอดเพี้ยนก่อนย้าย engine คำนวณย้อนหลังครบ
- `addMember` รองรับการอัปเกรด `ผู้ค้ำชั่วคราว` เป็นสมาชิกจริงเมื่อจับคู่ชื่อได้ชัดเจนเพียงรายการเดียว
- `saveSettings` รองรับ `interestRate`, `notificationSettings`, `reportLayoutSettings`, `menuSettings` โดยเขียนลง `app_settings`
- สิทธิ์ `notifications.manage` ถูกเปิดใช้ใน Edge Function แล้ว และจะอ่านจาก `permissions_json` ของ `app_users`
- `addLoan` และ `editLoan` รองรับการสร้างผู้ค้ำชั่วคราวอัตโนมัติ และ sync ชื่อผู้กู้กลับไปยังทะเบียนสมาชิกเมื่อแก้ชื่อผู้กู้ในสัญญา
- `deleteLoan` จะปฏิเสธการลบถ้ามี transaction ผูกกับสัญญาอยู่แล้ว ตามกติกาเดิมของ GAS

## แนวทาง implementation ฝั่ง Supabase

### Edge Function

- รับ POST JSON เท่านั้น
- รองรับ CORS สำหรับ GitHub Pages
- ตรวจ `sessionToken` เอง หรือเปลี่ยนไปใช้ Supabase Auth/JWT ในเฟสถัดไป
- dispatch ด้วยชื่อ method เดิมเพื่อลดการแก้ frontend

### Database Layer

- ใช้ `loans`, `members`, `transactions`, `app_settings`, `app_users`, `audit_logs`, `app_counters` ที่เตรียมไว้แล้ว
- งานที่ต้อง atomic เช่น `savePayment` ควรย้ายเป็น Postgres function หรือ transaction ใน Edge Function
- งาน read-heavy เช่น dashboard/report summary ควรใช้ SQL view หรือ RPC ช่วยลด logic ใน TypeScript

## ตัวแปรแนะนำสำหรับ Supabase Edge Function

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `APP_SESSION_SIGNING_SECRET`
- `PIN_UNIQUE_PEPPER`
- `APP_LOGIN_REQUIRED`

## Deploy ใช้งานจริง

คู่มือ deploy พร้อมคำสั่ง PowerShell, การตั้ง secrets, และขั้นทดสอบหลัง deploy อยู่ที่ [docs/supabase-edge-function-deploy.md](../docs/supabase-edge-function-deploy.md)

## จุดที่ยังต้องทำต่อ

- implement handler จริงใน Edge Function แทน scaffold
- export business logic ออกจาก [Code.gs](../Code.gs) เป็นโมดูล TypeScript หรือย้ายเป็น SQL/RPC
- ออกแบบ session/auth strategy ว่าจะใช้ token ภายในระบบเดิม หรือย้ายไป Supabase Auth
- ทดสอบ end-to-end จาก GitHub Pages ไปยัง Supabase Edge Function
