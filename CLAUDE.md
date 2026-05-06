# CLAUDE.md — ระบบยำกะผี

## อ่านก่อนทุกสนทนา

อ่านไฟล์เหล่านี้ตอนเริ่มต้นทุกครั้ง **ก่อนทำงานใดๆ**:

1. `wiki/index.md` — index และ log
2. `wiki/project-status.md` — สถานะปัจจุบัน + สิ่งที่ค้าง
3. `wiki/architecture.md` — โครงสร้างระบบ + Firestore schema
4. `wiki/components.md` — รายละเอียดแต่ละ component
5. `wiki/deploy-guide.md` — ขั้นตอน deploy

ถ้างานที่ทำเกี่ยวข้องกับไฟล์ใด ให้อ่านไฟล์นั้นก่อนเสมอ

## โปรเจกต์คืออะไร

ระบบจัดการและสลับกะการทำงานของนายสถานี ชื่อ **ระบบยำกะผี**  
Stack: React 19 + TypeScript + Firebase Firestore + Firebase Hosting + EmailJS

## Admin

- Email: `q.apichai@gmail.com`
- Firebase Project: `gen-lang-client-0528383957`

## Git Hook

ทุกครั้งที่แก้ไขไฟล์ Claude Code จะ `git add → commit → push` อัตโนมัติ

## Wiki

- `wiki/` — knowledge base ของโปรเจกต์ (Claude เป็นคนดูแล)
- อัปเดต `wiki/project-status.md` ทุกครั้งที่สถานะเปลี่ยน
- บันทึก log ใน `wiki/index.md` ทุกครั้งที่ทำงาน

## กฎการอัปเดต Wiki อัตโนมัติ

ทุกครั้งที่สร้างหรือแก้ไข component / function / ระบบสำคัญ ให้อัปเดต wiki ด้วยเสมอ:

| เหตุการณ์ | ไฟล์ที่ต้องอัปเดต |
|---|---|
| แก้ไข / เพิ่ม component | `wiki/components.md` |
| เปลี่ยน Firestore schema หรือ flow | `wiki/architecture.md` |
| สถานะระบบเปลี่ยน / bug fix สำคัญ | `wiki/project-status.md` |
| ทำงานทุกครั้ง | `wiki/index.md` (log) |

อัปเดตทันทีหลัง deploy หรือหลังงานเสร็จ ไม่ต้องรอให้ user สั่ง
