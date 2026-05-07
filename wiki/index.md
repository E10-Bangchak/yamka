# Wiki Index — ระบบยำกะผี

> อัปเดตล่าสุด: 2026-05-06

## หน้าหลัก

| หน้า | สรุป |
|---|---|
| [project-status.md](project-status.md) | สถานะปัจจุบัน, สิ่งที่ค้าง, ขั้นตอนถัดไป |
| [architecture.md](architecture.md) | โครงสร้างระบบ, tech stack, Firestore schema |
| [components.md](components.md) | แต่ละ component ทำอะไร |
| [deploy-guide.md](deploy-guide.md) | ขั้นตอน deploy ครบถ้วน |

## Log

| วันที่ | รายการ |
|---|---|
| 2026-04-18 | ingest ครั้งแรก — อ่านโค้ดทั้งหมด สร้าง wiki จาก HANDOFF + source files |
| 2026-04-26 | แก้ไขการคำนวณกะ — Debug Panel, ล้าง shift overrides, แก้ position selection ใช้วันที่ 1 ของเดือน |
| 2026-05-02 | เชื่อมต่อ GAS สำเร็จ, เปิด Google Auth, ใส่ค่า EmailJS ครบ, Sync สมาชิก 18 คน, Deploy ล่าสุด |
| 2026-05-02 | แก้ Firestore rules, แก้ email, เพิ่มฟีเจอร์ ขอแลกคืน (swap-back), Deploy แล้ว |
| 2026-05-06 | Refactor ใหญ่: แยก TeamSchedule 2 โหมด (member/admin-edit), ย้าย ขอแลกคืน ไปป็น immediate reverse ใน popup, แปลง Requests เป็นหน้าประวัติ, แก้ bug green dot จาก reverse swaps, Deploy แล้ว |
| 2026-05-07 | ขอแลกคืนต้องผ่านการอนุมัติ: แทน handleReverseSwapDirect ด้วย handleRequestReverse (addDoc pending), handleAction รองรับ isReverse สำหรับ swap/cover, badge "แลกคืน" ใน RequestCard, Deploy แล้ว |
| 2026-05-07 | ระบบโควตาวันหยุด: เพิ่ม tab "โควตาวันหยุด" ใน Members (usage A/H ปีนี้ทุกคน + inline edit quota), แก้ Dashboard นับ A/H เฉพาะ Jan1-วันนี้จาก Firestore จริง + warning เกินโควต้า, Deploy แล้ว |
| 2026-05-07 | quota card แสดง totalUsed = initialUsedA/H + systemUsed พร้อม breakdown, quota modal เพิ่มช่อง "A/H ก่อนเข้าระบบ" (2×2 grid), Deploy แล้ว |
