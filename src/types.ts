export type ShiftCode = 'S11' | 'S12' | 'S13' | 'AL-S11' | 'AL-S12' | 'AL-S13' | 'S78' | 'X' | 'XO' | 'A' | 'H';

export interface NotificationPreferences {
  newRequests: boolean;
  requestStatus: boolean;
  warnings: boolean;
}

export interface Member {
  id: string;
  uid: string;
  name: string;
  station: string;
  zone: string;
  position?: 'SS' | 'AStS' | 'SP';
  email?: string;
  quotaA: number;
  quotaH: number;
  quotaX: number;
  initialUsedA?: number; // วันที่ใช้ก่อนเข้าระบบ (A)
  initialUsedH?: number; // วันที่ใช้ก่อนเข้าระบบ (H)
  shiftPattern: string; // Comma separated codes
  cycleStartDate: string; // YYYY-MM-DD
  role: 'admin' | 'member';
  empId?: string;
  pin?: string;
  assignedPatternIds?: string[];
  activePatternId?: string;
  notificationPreferences?: NotificationPreferences;
}

export interface ShiftPatternTemplate {
  id: string;
  name: string;
  pattern: string; // comma-separated ShiftCodes
  position?: 'SS' | 'AStS' | 'SP';
  createdAt: string;
}

export type ShiftTimeSlot = 'morning' | 'afternoon' | 'night' | 'rest' | 'holiday' | 'leave';
export type ShiftGroup = 'main' | 'extra' | 'rest' | 'leave' | 'holiday' | 'spare';

export const SHIFT_GROUPS: { value: ShiftGroup; label: string; color: string }[] = [
  { value: 'main',    label: 'กะหลัก',          color: '#991b1b' },
  { value: 'extra',   label: 'กะเสริม',          color: '#92400e' },
  { value: 'rest',    label: 'วันหยุด',          color: '#374151' },
  { value: 'leave',   label: 'วันลาพักร้อน',    color: '#dc2626' },
  { value: 'holiday', label: 'หยุดนักขัตฤกษ์',  color: '#e11d48' },
  { value: 'spare',   label: 'AL (กะ Spare)',    color: '#d97706' },
];

export interface ShiftProperty {
  id: string;
  name: string;
  description?: string;
  color: string;
  timeSlot: ShiftTimeSlot;
  isMain: boolean;
  group?: ShiftGroup;
  startTime?: string;   // HH:MM
  endTime?: string;     // HH:MM
  isOvernight?: boolean; // true = กะข้ามวัน เช่น 22:00-06:00
}

export interface Shift {
  id: string; // memberId_date
  memberId: string;
  date: string; // YYYY-MM-DD
  shiftCode: ShiftCode;
  originalShiftCode?: ShiftCode;
  isDoubleShift?: boolean;
  manualMark?: boolean; // true = set by user via Dashboard (H/A/XO), false/undefined = from swap approval
  updatedAt: string;
}

export interface PairGroup {
  id: string;
  name: string;
  memberIds: string[]; // max 4
  createdAt: string;
}

export interface SwapRequest {
  id: string;
  requesterId: string;
  requesterName: string;
  targetId?: string;
  targetName?: string;
  type: 'swap' | 'cover' | 'cover_holiday';
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'reversed';
  requesterDate: string;
  targetDate?: string;
  requesterShift: string;
  targetShift?: string;
  reason?: string;
  returnDate?: string;
  returnShift?: string;        // A's holiday (swap/cover_holiday) or A's shift for cover return
  returnTargetShift?: string;  // B's shift on returnDate
  isReverseOf?: string;
  createdAt: string;
}
