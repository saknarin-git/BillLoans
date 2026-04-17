# BillLoans

ระบบ BillLoans เวอร์ชันนี้ตั้งค่าให้เปิดหน้าเว็บผ่าน GitHub Pages ได้ และเชื่อม backend ผ่าน Google Apps Script Web App

## ลิงก์พร้อมใช้

- หน้าเว็บ: https://saknarin-git.github.io/BillLoans/
- Backend API: https://script.google.com/macros/s/AKfycbzsXcsljlezOtlzw9IXtRd95LmLmOaHkEVThV_xvDI5BgiGKibkKC_Pt3RDZJ7jHP4hsw/exec
- Repository: https://github.com/saknarin-git/BillLoans

## โครงสร้างที่ใช้งานอยู่

- หน้าเว็บหลักอยู่ที่ [Index.html](Index.html)
- GitHub Pages deploy อัตโนมัติผ่าน [workflow pages](.github/workflows/pages.yml)
- ฝั่ง backend อยู่ที่ [Code.gs](Code.gs)

## วิธีทำงาน

- เมื่อ push ขึ้น branch `main` GitHub Actions จะ deploy หน้าเว็บไปยัง GitHub Pages อัตโนมัติ
- หน้าเว็บจะเรียก backend ของ Google Apps Script ผ่าน `google.script.run` proxy ที่ฝังไว้ใน [Index.html](Index.html)
- deployment URL ปัจจุบันของ Apps Script ถูกกำหนดไว้ในตัวแปร `window.__GAS_WEB_APP_URL__` ภายใน [Index.html](Index.html)

## หากต้องการเปลี่ยน URL backend

แก้ค่า `window.__GAS_WEB_APP_URL__` ใน [Index.html](Index.html) ให้เป็น Apps Script Web App URL ตัวใหม่ แล้ว commit/push ขึ้น GitHub อีกครั้ง

## หมายเหตุ

- หาก GitHub Pages ยังไม่ขึ้นทันที ให้รอ workflow deploy ทำงานให้เสร็จก่อน
- หาก backend เรียกไม่ได้ ให้ตรวจว่า Apps Script deployment ล่าสุด publish แล้ว และ URL ยังถูกต้อง