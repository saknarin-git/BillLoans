# Supabase Edge Function Deploy Guide

เอกสารนี้เป็นชุด deploy สำหรับ [supabase/functions/app-api/index.ts](../supabase/functions/app-api/index.ts) ให้ขึ้น Supabase ของโปรเจกต์ `fdtjomvkmpohdgdfbzst` พร้อม env vars และขั้นทดสอบหลัง deploy

## สิ่งที่ต้องมี

- Supabase CLI
- สิทธิ์เข้าถึงโปรเจกต์ `fdtjomvkmpohdgdfbzst`
- Service role key ของโปรเจกต์
- secret สำหรับ sign session token ของระบบ

## 1. ติดตั้งและล็อกอิน Supabase CLI

PowerShell:

```powershell
npm install -g supabase
supabase login
```

หากติดตั้ง CLI ไว้อยู่แล้ว ให้ข้ามขั้นนี้ได้

## 2. ตรวจ project ref ใน repo

ไฟล์ [supabase/config.toml](../supabase/config.toml) ถูกตั้งเป็น project ref จริงแล้ว:

```toml
project_id = "fdtjomvkmpohdgdfbzst"
```

## 3. ตั้งค่า secrets ให้ Edge Function

ค่าที่ต้องตั้งมี 5 ตัว:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `APP_SESSION_SIGNING_SECRET`
- `PIN_UNIQUE_PEPPER`
- `APP_LOGIN_REQUIRED`

ตัวอย่าง local file อยู่ที่ [supabase/functions/.env.local.example](../supabase/functions/.env.local.example)

คำสั่งตั้งค่า secrets บน Supabase:

```powershell
supabase secrets set SUPABASE_URL=https://fdtjomvkmpohdgdfbzst.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
supabase secrets set APP_SESSION_SIGNING_SECRET="CHANGE_THIS_TO_A_LONG_RANDOM_SECRET"
supabase secrets set PIN_UNIQUE_PEPPER="PIN_UNIQUE_PEPPER_DEFAULT"
supabase secrets set APP_LOGIN_REQUIRED=false
```

คำแนะนำ:

- `APP_SESSION_SIGNING_SECRET` ควรเป็นค่ายาว สุ่มใหม่ และไม่ใช้ซ้ำกับ key อื่น
- `PIN_UNIQUE_PEPPER` ต้องตรงกับค่าที่ฝั่ง GAS ใช้สร้าง `pin_unique_key` เดิม ไม่เช่นนั้นการหา user ด้วย PIN แบบ direct match จะไม่ตรง
- ถ้ายังย้ายระบบ login ไม่เสร็จ ให้เริ่มที่ `APP_LOGIN_REQUIRED=false`
- เมื่อ implement `verifyLoginPin` และ auth ฝั่ง Supabase ครบแล้ว ค่อยเปลี่ยนเป็น `true`

## 4. deploy function ขึ้น Supabase

จาก root ของ repo:

```powershell
supabase functions deploy app-api --project-ref fdtjomvkmpohdgdfbzst --no-verify-jwt
```

หมายเหตุ:

- ค่า `--no-verify-jwt` ต้องตรงกับ [supabase/config.toml](../supabase/config.toml) ที่ตั้ง `verify_jwt = false`
- endpoint หลัง deploy คือ `https://fdtjomvkmpohdgdfbzst.functions.supabase.co/app-api`

## 4.1 ตั้งค่า auto deploy ผ่าน GitHub Actions

repo นี้มี workflow ที่ [../.github/workflows/supabase-functions.yml](../.github/workflows/supabase-functions.yml) สำหรับ deploy function อัตโนมัติเมื่อ push เข้า branch `main` และมีการเปลี่ยนแปลงในโฟลเดอร์ `supabase/` โดยจะ deploy เฉพาะ function ที่มีไฟล์เปลี่ยนจริง

ให้เพิ่ม GitHub repository secrets ดังนี้:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `APP_SESSION_SIGNING_SECRET`
- `PIN_UNIQUE_PEPPER`
- `APP_LOGIN_REQUIRED`

พอ secrets ครบแล้ว workflow จะทำ 2 อย่างอัตโนมัติ:

- sync ค่า secrets ขึ้น Supabase
- deploy เฉพาะ function ที่เปลี่ยนในรอบนั้น

## 5. ทดสอบ endpoint หลัง deploy

### health

```powershell
$body = @{ method = "health"; args = @(); sessionToken = "" } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post -Uri "https://fdtjomvkmpohdgdfbzst.functions.supabase.co/app-api" -ContentType "application/json" -Body $body
```

### listMethods

```powershell
$body = @{ method = "listMethods"; args = @(); sessionToken = "" } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post -Uri "https://fdtjomvkmpohdgdfbzst.functions.supabase.co/app-api" -ContentType "application/json" -Body $body
```

### createGuestSession

```powershell
$body = @{ method = "createGuestSession"; args = @(); sessionToken = "" } | ConvertTo-Json -Depth 5
$session = Invoke-RestMethod -Method Post -Uri "https://fdtjomvkmpohdgdfbzst.functions.supabase.co/app-api" -ContentType "application/json" -Body $body
$session
```

### verifyLoginPin

แทนค่า `123456` ด้วย PIN จริงของผู้ใช้:

```powershell
$body = @{ method = "verifyLoginPin"; args = @("123456"); sessionToken = "" } | ConvertTo-Json -Depth 5
$login = Invoke-RestMethod -Method Post -Uri "https://fdtjomvkmpohdgdfbzst.functions.supabase.co/app-api" -ContentType "application/json" -Body $body
$login
```

### getAppData

```powershell
$body = @{ method = "getAppData"; args = @(); sessionToken = "$($session.sessionToken)" } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post -Uri "https://fdtjomvkmpohdgdfbzst.functions.supabase.co/app-api" -ContentType "application/json" -Body $body
```

### getPaymentLookupByMemberId

แทนค่า `MEMBER_ID_HERE` ด้วยรหัสสมาชิกจริง:

```powershell
$body = @{ method = "getPaymentLookupByMemberId"; args = @("MEMBER_ID_HERE"); sessionToken = "$($session.sessionToken)" } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post -Uri "https://fdtjomvkmpohdgdfbzst.functions.supabase.co/app-api" -ContentType "application/json" -Body $body
```

### savePayment

ตัวอย่างบันทึกรับชำระปกติ:

```powershell
$payment = @{
	id = "tx-test-001"
	contract = "01/01-2569"
	memberId = "MEMBER_ID_HERE"
	memberName = "ทดสอบ"
	principalPaid = 100
	interestPaid = 600
	newBalance = 9900
	note = "-"
	interestMonthsPaid = 1
	currentMissedInterestMonths = 1
	newMissedInterestMonths = 0
	customStatus = "ปกติ"
} | ConvertTo-Json -Depth 8 -Compress

$body = @{ method = "savePayment"; args = @($payment); sessionToken = "$($login.sessionToken)" } | ConvertTo-Json -Depth 8
Invoke-RestMethod -Method Post -Uri "https://fdtjomvkmpohdgdfbzst.functions.supabase.co/app-api" -ContentType "application/json" -Body $body
```

### cancelPayment

แทนค่า `TX_ID_HERE` ด้วย transaction id จริง:

```powershell
$body = @{ method = "cancelPayment"; args = @("TX_ID_HERE", "ทดสอบกลับรายการ"); sessionToken = "$($login.sessionToken)" } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post -Uri "https://fdtjomvkmpohdgdfbzst.functions.supabase.co/app-api" -ContentType "application/json" -Body $body
```

### addMember

```powershell
$member = @{ id = "M-TEST-001"; name = "สมาชิกทดสอบ"; status = "ปกติ" } | ConvertTo-Json -Compress
$body = @{ method = "addMember"; args = @($member); sessionToken = "$($login.sessionToken)" } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post -Uri "https://fdtjomvkmpohdgdfbzst.functions.supabase.co/app-api" -ContentType "application/json" -Body $body
```

### updateMember

```powershell
$member = @{ id = "M-TEST-001"; name = "สมาชิกทดสอบ แก้ไข"; status = "ปกติ" } | ConvertTo-Json -Compress
$body = @{ method = "updateMember"; args = @($member); sessionToken = "$($login.sessionToken)" } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post -Uri "https://fdtjomvkmpohdgdfbzst.functions.supabase.co/app-api" -ContentType "application/json" -Body $body
```

### getNotificationSettings

```powershell
$body = @{ method = "getNotificationSettings"; args = @(); sessionToken = "$($login.sessionToken)" } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post -Uri "https://fdtjomvkmpohdgdfbzst.functions.supabase.co/app-api" -ContentType "application/json" -Body $body
```

### saveSettings

ตัวอย่างบันทึกการตั้งค่า notification และอัตราดอกเบี้ย:

```powershell
$settings = @{
	interestRate = 12
	notificationSettings = @{
		recipients = "admin@example.com"
		notifyApprovalSubmitted = $true
		notifyApprovalApproved = $true
		notifyApprovalRejected = $true
		notifyAttachmentUploaded = $false
		notifyPaymentCreated = $false
		notifyPaymentReversed = $true
		notifyReportArchived = $true
		notifyAccountingClosed = $true
		notifyBackupCompleted = $true
	}
} | ConvertTo-Json -Depth 8 -Compress

$body = @{ method = "saveSettings"; args = @($settings); sessionToken = "$($login.sessionToken)" } | ConvertTo-Json -Depth 8
Invoke-RestMethod -Method Post -Uri "https://fdtjomvkmpohdgdfbzst.functions.supabase.co/app-api" -ContentType "application/json" -Body $body
```

### addLoan

```powershell
$loan = @{
	memberId = "M-TEST-001"
	contract = "99/01-2569"
	member = "สมาชิกทดสอบ"
	amount = 10000
	interest = 12
	balance = 10000
	status = "ปกติ"
	nextPayment = "-"
	missedInterestMonths = 0
	createdAt = "17/04/2569"
	guarantor1 = "(M-TEST-002) ผู้ค้ำหนึ่ง"
	guarantor2 = ""
} | ConvertTo-Json -Depth 8 -Compress

$body = @{ method = "addLoan"; args = @($loan); sessionToken = "$($login.sessionToken)" } | ConvertTo-Json -Depth 8
Invoke-RestMethod -Method Post -Uri "https://fdtjomvkmpohdgdfbzst.functions.supabase.co/app-api" -ContentType "application/json" -Body $body
```

### editLoan

```powershell
$loan = @{
	memberId = "M-TEST-001"
	contract = "99/01-2569"
	member = "สมาชิกทดสอบ แก้ไขชื่อ"
	amount = 10000
	interest = 12
	balance = 9500
	status = "ปกติ"
	nextPayment = "-"
	missedInterestMonths = 0
	createdAt = "17/04/2569"
	guarantor1 = "(M-TEST-002) ผู้ค้ำหนึ่ง"
	guarantor2 = ""
} | ConvertTo-Json -Depth 8 -Compress

$body = @{ method = "editLoan"; args = @($loan); sessionToken = "$($login.sessionToken)" } | ConvertTo-Json -Depth 8
Invoke-RestMethod -Method Post -Uri "https://fdtjomvkmpohdgdfbzst.functions.supabase.co/app-api" -ContentType "application/json" -Body $body
```

## 6. ทดสอบหน้าเว็บกับ backend ใหม่

หน้าเว็บ default ถูกตั้งให้ชี้มาที่ Edge Function นี้แล้ว แต่ยัง override ได้ผ่าน query string:

```text
https://saknarin-git.github.io/BillLoans/?backend_url=https://fdtjomvkmpohdgdfbzst.functions.supabase.co/app-api
```

ใช้วิธีนี้ได้เมื่ออยากบังคับ backend ที่ต้องการระหว่างทดสอบ

## 7. รายการที่รองรับแล้วใน Edge Function ตอนนี้

- `health`
- `listMethods`
- `createGuestSession`
- `verifyLoginPin`
- `getSessionSnapshot`
- `getAppRuntimeSnapshot`
- `getAppData`
- `getPaymentReadyData`
- `getPaymentLookupByMemberId`
- `getTodayTransactionsForMemberPaymentEdit`
- `getNotificationSettings`
- `savePayment`
- `cancelPayment`
- `addMember`
- `updateMember`
- `addLoan`
- `editLoan`
- `saveSettings`

ข้อจำกัดปัจจุบัน:

- `cancelPayment` รองรับเฉพาะรายการรับชำระล่าสุดของสัญญาในช่วง migration นี้
- `addMember` จะอัปเกรด `ผู้ค้ำชั่วคราว` เป็นสมาชิกจริงได้เมื่อพบชื่อที่ตรงกันแบบชัดเจนเพียง 1 รายการ
- `saveSettings` รอบนี้รองรับ `interestRate`, `notificationSettings`, `reportLayoutSettings`, `menuSettings` ผ่าน `app_settings`
- `addLoan` และ `editLoan` รองรับการสร้างผู้ค้ำชั่วคราวอัตโนมัติเมื่อยังไม่พบในทะเบียนสมาชิก
- หากต้องให้บัญชี non-admin จัดการแจ้งเตือนได้ ต้องมี `notifications.manage` อยู่ใน `permissions_json`
- หากต้องการกลับรายการย้อนหลังหลายชั้น ยังควรใช้ GAS fallback จนกว่าจะย้าย logic recalculation ครบ

## 8. สิ่งที่ยังไม่ควรปิด GAS ทันที

ยังมี method สำคัญที่ยังไม่ได้ย้าย เช่น:

- `updateLoanStatus`
- `deleteLoan`

หมายเหตุ: `saveSettings` ถูกย้ายแล้ว แต่ยังมี settings/admin methods อื่นที่ยังไม่ครบ เช่นรายงานประวัติการแจ้งเตือนและ AutoBackup

ดังนั้น GAS ยังควรเก็บไว้เป็น fallback จนกว่าชุด write path และ auth จะครบ