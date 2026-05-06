# Project Status — ระบบยำกะผี

> อัปเดตล่าสุด: 2026-05-06

## สถานะรวม

**ระบบพร้อมใช้งาน** — Deploy ล่าสุดแล้ว, ระบบ swap/cover/reverse ครบ, Requests เป็นหน้าประวัติ

---

## ✅ เสร็จแล้ว

### Infrastructure
- Firebase Hosting deploy ที่ `https://gen-lang-client-0528383957.web.app`
- Firebase Auth: Google Sign-in + PIN login (anonymous auth)
- EmailJS เชื่อม Outlook (`ApichaiC.583986@outlook.co.th`)
- Firestore rules: members/shifts/swapRequests ทุก authenticated user อ่าน-เขียนได้

### Auth Flow
- Google login (admin) — member.id = Firebase UID
- PIN login (member) — anonymous auth, member.id = Firestore doc ID (empId)
- PIN default = 4 ตัวท้าย empId

### ระบบกะ
- ShiftCode: `S11 S12 S13 AL-S11 AL-S12 AL-S13 S78 X XO A H`
- Pattern คำนวณจาก `cycleStartDate` + `shiftPattern` (comma-separated)
- Shift override: Firestore doc `/shifts/{memberId}_{date}` ทับ pattern
- `manualMark: true` = admin ตั้งค่าเอง (H/A/XO), `undefined` = จาก swap approval
- `originalShiftCode` = shift ก่อนถูกสลับ (สำหรับคืนกะ)

### TeamSchedule (2 โหมด)
- **กะทั้งหมด** (`memberMode=true`): member/admin เห็นตารางสถานีตัวเอง, swap/cover enabled, วงกลมเขียว = approved swap
- **แก้ไขกะ** (`memberMode=false`, admin only): edit modal กะโดยตรง, ไม่มี swap UI

### ระบบ Swap/Cover
- สลับกะ, ควงกะ (SS only), ควงกะ+คืนวันหยุด
- ส่ง email แจ้งเตือนผ่าน EmailJS
- Approve/Reject ใน Requests page → เขียน shift docs + mark status
- `cover_holiday` returnDate ≤ เดือนถัดไป

### ระบบ Reverse (ขอแลกคืน)
- ทำงานใน **TeamSchedule popup** เท่านั้น (immediate, no approval needed)
- ทั้ง requester และ target กดได้
- กด "ขอแลกคืน" → confirm → `handleReverseSwapDirect` → batch commit:
  - `shifts/{req}_{reqDate}` → `shiftCode: requesterShift` (คืนค่าเดิม)
  - `shifts/{tgt}_{tgtDate}` → `shiftCode: targetShift` (คืนค่าเดิม)
  - ลบ returnDate docs
  - `swapRequests/{id}` → `status: 'reversed'`
  - Optimistic update: ลบจาก `approvedSwaps` state ทันที → วงกลมเขียวหายทันที

### Requests (ประวัติการทำรายการ)
- **รอการอนุมัติจากคุณ** — incoming pending (approve/reject)
- **คำขอที่ส่งออกไป** — outgoing pending (cancel)
- **ประวัติการทำรายการ** — 60 รายการล่าสุด: approved/reversed/rejected/cancelled
- 8 Firestore listeners, มี error callback ทุกตัว

### Bug Fixes สำคัญ
- **Green dot จาก reverse swaps**: `approvedSwaps` filter ออก swaps ที่มี `isReverseOf` — reverse swap requests ไม่ควรแสดง green dot
- **handleAction + isReverse**: approve reverse swap → status = `'reversed'` ไม่ใช่ `'approved'`
- **Optimistic update**: หลัง batch.commit() สำเร็จ ลบ swap จาก state ทันที
- **reversing state**: ป้องกัน double-click ขณะ reverse

---

## ❌ ยังค้าง / รู้จักปัญหา

- **ข้อมูลเก่าใน Firestore**: reverse swap requests ที่ status='approved' (isReverseOf set) จากระบบเก่า — ถูก filter ออกโดยอัตโนมัติแล้ว ไม่แสดง green dot
- Shift pattern ถ้า admin เปลี่ยน `cycleStartDate` → วันที่มี shift doc override จะยังล็อกค่าเดิม (ไม่ได้แก้)

---

## Firebase Project

| Key | Value |
|---|---|
| Project ID | `gen-lang-client-0528383957` |
| Hosting URL | `https://gen-lang-client-0528383957.web.app` |
| Admin Email | `q.apichai@gmail.com` |
| Firestore DB ID | `ai-studio-01987361-573e-4f30-9681-1e83b5c491e3` |

## EmailJS

| Key | Value |
|---|---|
| Account | `ApichaiC.583986@outlook.co.th` |
| Service ID | `service_yamka` |
| Template ID | `template_nfo6sld` |
| Public Key | `YY8IVNkVN-qhgglkU` |
