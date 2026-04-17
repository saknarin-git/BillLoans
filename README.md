# BillLoans

ระบบ BillLoans เวอร์ชันนี้ตั้งค่าให้เปิดหน้าเว็บผ่าน GitHub Pages ได้ และเตรียมย้าย backend จาก Google Apps Script ไปยัง Supabase Edge Functions

Supabase project เริ่มต้นที่ตั้งไว้ในระบบคือ https://fdtjomvkmpohdgdfbzst.supabase.co

หน้าเว็บถูกเตรียม transport layer ให้สลับจาก GAS ไปยัง backend HTTP ทั่วไปได้แล้ว เพื่อรองรับการย้ายไป Supabase Edge Functions ต่อจากนี้

## ลิงก์พร้อมใช้

- หน้าเว็บ: https://saknarin-git.github.io/BillLoans/
- Backend API (default): https://fdtjomvkmpohdgdfbzst.functions.supabase.co/app-api
- Backend API (GAS fallback): https://script.google.com/macros/s/AKfycbzsXcsljlezOtlzw9IXtRd95LmLmOaHkEVThV_xvDI5BgiGKibkKC_Pt3RDZJ7jHP4hsw/exec
- Repository: https://github.com/saknarin-git/BillLoans

## โครงสร้างที่ใช้งานอยู่

- หน้าเว็บหลักอยู่ที่ [index.html](index.html)
- GitHub Pages deploy อัตโนมัติผ่าน [workflow pages](.github/workflows/pages.yml)
- ฝั่ง backend อยู่ที่ [Code.gs](Code.gs)
- scaffold สำหรับ Supabase backend อยู่ที่ [supabase/functions/app-api/index.ts](supabase/functions/app-api/index.ts)
- runbook การย้ายระบบอยู่ที่ [docs/supabase-backend-migration.md](docs/supabase-backend-migration.md)

## วิธีทำงาน

- เมื่อ push ขึ้น branch `main` GitHub Actions จะ deploy หน้าเว็บไปยัง GitHub Pages อัตโนมัติ
- หน้าเว็บจะเรียก backend ผ่าน transport layer กลางใน [index.html](index.html)
- ค่า default ของ backend ใหม่ถูกกำหนดไว้ในตัวแปร `window.__BACKEND_API_URL__` ภายใน [index.html](index.html)
- ยังเก็บ `window.__GAS_WEB_APP_URL__` ไว้เป็น fallback/compatibility สำหรับช่วง migration
- สามารถ override backend ได้ผ่าน query string `backend_url`

## หากต้องการเปลี่ยน URL backend

แก้ค่า `window.__BACKEND_API_URL__` ใน [index.html](index.html) ให้เป็น Supabase Edge Function URL ตัวใหม่ แล้ว commit/push ขึ้น GitHub อีกครั้ง

หากต้องการกลับไปใช้ Google Apps Script ชั่วคราว ให้ส่ง `backend_url` เป็น GAS Web App URL หรือแก้ค่า `window.__GAS_WEB_APP_URL__` ใน [index.html](index.html)

## หมายเหตุ

- หาก GitHub Pages ยังไม่ขึ้นทันที ให้รอ workflow deploy ทำงานให้เสร็จก่อน
- หาก backend ใหม่ยังไม่ implement method ครบ หน้าเว็บจะเรียกได้เฉพาะ route ที่ Edge Function รองรับแล้ว
- หากต้องการใช้งานต่อในช่วงเปลี่ยนผ่าน ยังสามารถชี้กลับไปยัง GAS fallback ได้