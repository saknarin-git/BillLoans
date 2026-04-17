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

## 8. สิ่งที่ยังไม่ควรปิด GAS ทันที

ยังมี method สำคัญที่ยังไม่ได้ย้าย เช่น:

- `savePayment`
- `cancelPayment`
- `addMember`
- `updateMember`
- `addLoan`
- `editLoan`
- `saveSettings`

ดังนั้น GAS ยังควรเก็บไว้เป็น fallback จนกว่าชุด write path และ auth จะครบ