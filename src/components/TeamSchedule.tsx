import React, { useState, useEffect, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, isToday, differenceInDays, parseISO } from 'date-fns';
import { th } from 'date-fns/locale';
import { RefreshCw, X as CloseIcon, RotateCcw } from 'lucide-react';
import { collection, onSnapshot, query, where, doc, setDoc, addDoc, writeBatch, deleteField } from 'firebase/firestore';
import { db } from '../firebase';
import { Member, Shift, ShiftCode, SwapRequest, ShiftProperty } from '../types';
import { getShiftCode } from '../lib/scheduleUtils';
import { toast } from 'sonner';
import emailjs from '@emailjs/browser';
import { useShiftProperties } from '../hooks/useShiftProperties';

const EMAILJS_SERVICE_ID = 'service_yamka';
const EMAILJS_TEMPLATE_ID = 'template_nfo6sld';
const EMAILJS_PUBLIC_KEY = 'YY8IVNkVN-qhgglkU';
const ADMIN_EMAIL = 'ApichaiC.583986@outlook.co.th';

interface TeamScheduleProps {
  member: Member;
  isAdmin: boolean;
  memberMode?: boolean; // admin acts as member: swap/cover enabled, no edit modal
}

interface SwapPopup {
  targetMember: Member;
  targetDate: string;
  targetShift: string;
}

interface RequestForm {
  type: 'swap' | 'cover' | 'cover_holiday';
  targetMember: Member;
  targetDate: string;
  targetShift: string;
  requesterDate: string;
  returnDate: string;
  submitting: boolean;
}

export default function TeamSchedule({ member, isAdmin, memberMode = false }: TeamScheduleProps) {
  const showSwap = !isAdmin || memberMode; // member behavior: swap/cover/green dots enabled
  const { getShiftStyle, getOtherShiftStyle, getSelfShiftStyle } = useShiftProperties();
  const [members, setMembers] = useState<Member[]>([]);
  const [allShifts, setAllShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const normalizePos = (p?: string) => (p || '').replace(/\.$/, '').trim();
  const [positionTab, setPositionTab] = useState<string>(normalizePos(member.position) || 'SS');
  const [selectedZone, setSelectedZone] = useState<string>('');
  const [selectedStation, setSelectedStation] = useState<string>('');
  const [editingShift, setEditingShift] = useState<{ member: Member; date: string } | null>(null);
  const [swapPopup, setSwapPopup] = useState<SwapPopup | null>(null);
  const [requestForm, setRequestForm] = useState<RequestForm | null>(null);
  const [approvedSwaps, setApprovedSwaps] = useState<SwapRequest[]>([]);
  const [swapDetail, setSwapDetail] = useState<SwapRequest | null>(null);
  const [confirmReverse, setConfirmReverse] = useState(false);
  const [shiftProps, setShiftProps] = useState<ShiftProperty[]>([]);

  const rangeStart = startOfMonth(new Date());
  const rangeEnd = endOfMonth(addMonths(new Date(), 11));
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => addMonths(rangeStart, i)), []);

  useEffect(() => {
    const unsubMembers = onSnapshot(collection(db, 'members'), (snap) => {
      setMembers(snap.docs.map(d => ({ id: d.id, ...d.data() } as Member)));
    });
    const q = query(
      collection(db, 'shifts'),
      where('date', '>=', format(rangeStart, 'yyyy-MM-dd')),
      where('date', '<=', format(rangeEnd, 'yyyy-MM-dd'))
    );
    const unsubShifts = onSnapshot(q, (snap) => {
      setAllShifts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Shift)));
      setLoading(false);
    });
    const unsubSwaps = onSnapshot(
      query(collection(db, 'swapRequests'), where('status', '==', 'approved')),
      snap => setApprovedSwaps(snap.docs.map(d => ({ id: d.id, ...d.data() } as SwapRequest)))
    );
    const unsubProps = onSnapshot(collection(db, 'shiftProperties'), snap => {
      setShiftProps(snap.docs.map(d => ({ id: d.id, ...d.data() } as ShiftProperty)));
    });
    return () => { unsubMembers(); unsubShifts(); unsubSwaps(); unsubProps(); };
  }, []);

  const shiftsMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of allShifts) map.set(`${s.memberId}_${s.date}`, s.shiftCode);
    return map;
  }, [allShifts]);

  const getShift = (m: Member, dateStr: string): string => {
    const override = shiftsMap.get(`${m.id}_${dateStr}`);
    if (override) return override;
    if (!m.shiftPattern || !m.cycleStartDate) return 'X';
    const pattern = m.shiftPattern.split(',').map(s => s.trim()).filter(Boolean);
    if (!pattern.length) return 'X';
    const diff = differenceInDays(parseISO(dateStr), parseISO(m.cycleStartDate));
    if (diff < 0) return 'X';
    return pattern[diff % pattern.length] || 'X';
  };

  const swapMap = useMemo(() => {
    const map = new Map<string, SwapRequest>();
    for (const sw of approvedSwaps) {
      if (sw.requesterId && sw.requesterDate) map.set(`${sw.requesterId}_${sw.requesterDate}`, sw);
      if (sw.targetId && sw.targetDate) map.set(`${sw.targetId}_${sw.targetDate}`, sw);
      if ((sw.type === 'cover' || sw.type === 'cover_holiday') && sw.targetId && sw.requesterDate)
        map.set(`${sw.targetId}_${sw.requesterDate}`, sw);
      // returnDate is already part of the approved swap — no separate green dot needed
    }
    return map;
  }, [approvedSwaps]);

  // Maps memberId_date → effective shift code after approved swaps/covers
  // cover cells use "COVER:ownShift|coveredShift" format
  const effectiveShiftMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const sw of approvedSwaps) {
      if (sw.type === 'swap') {
        if (sw.requesterId && sw.requesterDate && sw.targetShift)
          map.set(`${sw.requesterId}_${sw.requesterDate}`, sw.targetShift);
        if (sw.targetId && sw.targetDate && sw.requesterShift)
          map.set(`${sw.targetId}_${sw.targetDate}`, sw.requesterShift);
        if (sw.returnDate) {
          if (sw.requesterId && sw.returnTargetShift)
            map.set(`${sw.requesterId}_${sw.returnDate}`, sw.returnTargetShift);
          if (sw.targetId && sw.returnShift)
            map.set(`${sw.targetId}_${sw.returnDate}`, sw.returnShift);
        }
      } else if (sw.type === 'cover') {
        // วันที่ 1: B ควงให้ A, A ได้หยุด
        if (sw.requesterId && sw.requesterDate)
          map.set(`${sw.requesterId}_${sw.requesterDate}`, 'X');
        if (sw.targetId && sw.targetDate && sw.targetShift)
          map.set(`${sw.targetId}_${sw.targetDate}`, `COVER:${sw.targetShift}|${sw.requesterShift || '?'}`);
        if (sw.targetId && sw.requesterDate && sw.targetDate && sw.targetDate !== sw.requesterDate)
          map.set(`${sw.targetId}_${sw.requesterDate}`, `COVER2:${sw.requesterShift || '?'}`);
        // วันที่ 2: A ควงคืนให้ B, B ได้หยุด
        if (sw.returnDate) {
          if (sw.targetId)
            map.set(`${sw.targetId}_${sw.returnDate}`, 'X');
          if (sw.requesterId && sw.returnShift && sw.returnTargetShift)
            map.set(`${sw.requesterId}_${sw.returnDate}`, `COVER:${sw.returnShift}|${sw.returnTargetShift}`);
        }
      } else if (sw.type === 'cover_holiday') {
        // วันที่ 1: B ควงให้ A, A ได้หยุด
        if (sw.requesterId && sw.requesterDate)
          map.set(`${sw.requesterId}_${sw.requesterDate}`, 'X');
        if (sw.targetId && sw.targetDate && sw.targetShift)
          map.set(`${sw.targetId}_${sw.targetDate}`, `COVER:${sw.targetShift}|${sw.requesterShift || '?'}`);
        if (sw.targetId && sw.requesterDate && sw.targetDate && sw.targetDate !== sw.requesterDate)
          map.set(`${sw.targetId}_${sw.requesterDate}`, `COVER2:${sw.requesterShift || '?'}`);
        // วันคืน: A ทำแทน B, B ได้วันหยุด
        if (sw.returnDate) {
          if (sw.requesterId && sw.returnTargetShift)
            map.set(`${sw.requesterId}_${sw.returnDate}`, sw.returnTargetShift);
          if (sw.targetId && sw.returnShift)
            map.set(`${sw.targetId}_${sw.returnDate}`, sw.returnShift);
        }
      }
    }
    return map;
  }, [approvedSwaps]);

  const zones = useMemo(() =>
    [...new Set(members.map(m => m.zone).filter(Boolean))].sort(), [members]);

  const stationsInZone = useMemo(() =>
    [...new Set(members.filter(m => m.zone === selectedZone).map(m => m.station).filter(Boolean))].sort(),
    [members, selectedZone]);

  // Auto-select first zone when members load (admin)
  useEffect(() => {
    if (isAdmin && zones.length > 0 && !selectedZone) setSelectedZone(zones[0]);
  }, [zones, isAdmin]);

  // Auto-select first station when zone changes (admin)
  useEffect(() => {
    if (isAdmin && stationsInZone.length > 0) setSelectedStation(stationsInZone[0]);
  }, [selectedZone, stationsInZone, isAdmin]);

  const visibleMembers = useMemo(() => {
    const filtered = members.filter(m => {
      if (isAdmin && !memberMode) {
        if (normalizePos(m.position) !== positionTab) return false;
        if (selectedZone && m.zone !== selectedZone) return false;
        if (selectedStation && m.station !== selectedStation) return false;
      } else {
        // Member mode (or non-admin): own station + own position only
        if (m.station !== member.station) return false;
        if (normalizePos(m.position) !== normalizePos(member.position)) return false;
      }
      return true;
    });
    return [...filtered.filter(m => m.id === member.id), ...filtered.filter(m => m.id !== member.id)];
  }, [members, positionTab, member.id, isAdmin, memberMode, selectedZone, selectedStation, member.station, member.position]);

  const getUsage = (m: Member, code: string, mDays: Date[]) =>
    mDays.filter((d: Date) => getShift(m, format(d, 'yyyy-MM-dd')) === code).length;

  const OFF_SHIFTS = ['X', 'A', 'H', 'XO'];

  const checkConsecutive = (codeA: string, codeB: string): { valid: boolean; crossDay: boolean; order: 'A_first' | 'B_first' } | null => {
    const pA = shiftProps.find(p => p.id === codeA);
    const pB = shiftProps.find(p => p.id === codeB);
    if (!pA?.endTime || !pB?.startTime || !pA?.startTime || !pB?.endTime) return null;
    if (pA.endTime === pB.startTime) return { valid: true, crossDay: pA.isOvernight || false, order: 'A_first' };
    if (pB.endTime === pA.startTime) return { valid: true, crossDay: pB.isOvernight || false, order: 'B_first' };
    return { valid: false, crossDay: false, order: 'A_first' };
  };

  const openRequestForm = (type: 'swap' | 'cover' | 'cover_holiday', popup: SwapPopup) => {
    const defaultReturn = format(endOfMonth(new Date()), 'yyyy-MM-dd');
    setSwapPopup(null);
    setRequestForm({
      type,
      targetMember: popup.targetMember,
      targetDate: popup.targetDate,
      targetShift: popup.targetShift,
      requesterDate: popup.targetDate,
      returnDate: defaultReturn,
      submitting: false,
    });
  };

  const submitRequest = async () => {
    if (!requestForm) return;
    const { type, targetMember, targetDate, targetShift, requesterDate, returnDate } = requestForm;

    if (targetMember.zone !== member.zone) {
      toast.error(`ไม่สามารถแลกกะข้ามโซนได้ (โซน ${member.zone} ↔ ${targetMember.zone})`);
      return;
    }

    const requesterShift = getShiftCode(member, requesterDate, allShifts);
    setRequestForm(f => f ? { ...f, submitting: true } : null);

    try {
      const payload: Record<string, unknown> = {
        requesterId: member.id, requesterName: member.name,
        targetId: targetMember.id, targetName: targetMember.name,
        type, requesterDate, requesterShift,
        status: 'pending', createdAt: new Date().toISOString(),
      };

      if (type === 'swap') {
        payload.targetDate = targetDate;
        payload.targetShift = targetShift;
        const hasHol = OFF_SHIFTS.includes(targetShift) !== OFF_SHIFTS.includes(requesterShift);
        if (hasHol) {
          payload.returnDate = returnDate;
          payload.returnShift = getShiftCode(member, returnDate, allShifts);
          payload.returnTargetShift = getShiftCode(targetMember, returnDate, allShifts);
        }
      } else if (type === 'cover' || type === 'cover_holiday') {
        payload.targetDate = targetDate;
        payload.targetShift = targetShift;
        payload.returnDate = returnDate;
        payload.returnShift = getShiftCode(member, returnDate, allShifts);
        payload.returnTargetShift = getShiftCode(targetMember, returnDate, allShifts);
      }

      await addDoc(collection(db, 'swapRequests'), payload);

      const typeLabel: Record<string, string> = {
        swap: 'สลับกะ', cover: 'ควงกะ', cover_holiday: 'ควงกะ + คืนวันหยุด',
      };
      emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
        subject: `[ระบบยำกะผี] คำขอ${typeLabel[type]}ใหม่จาก ${member.name}`,
        from_name: 'ระบบยำกะผี',
        to_email: targetMember.email || ADMIN_EMAIL,
        message: `ประเภท: ${typeLabel[type]}\nผู้ขอ: ${member.name}\nส่งถึง: ${targetMember.name}\nวันที่: ${requesterDate} (กะ ${requesterShift})\nสถานะ: รอการอนุมัติ\n\nตรวจสอบ: https://gen-lang-client-0528383957.web.app`,
      }, EMAILJS_PUBLIC_KEY).catch(() => {});

      toast.success('ส่งคำขอเรียบร้อยแล้ว');
      setRequestForm(null);
    } catch {
      toast.error('เกิดข้อผิดพลาด');
      setRequestForm(f => f ? { ...f, submitting: false } : null);
    }
  };

  const handleUpdateShift = async (code: ShiftCode) => {
    if (!editingShift) return;
    try {
      await setDoc(doc(db, 'shifts', `${editingShift.member.id}_${editingShift.date}`), {
        memberId: editingShift.member.id,
        date: editingShift.date,
        shiftCode: code,
        updatedAt: new Date().toISOString(),
        updatedBy: 'admin',
      });
      {
        emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
          subject: `[ระบบยำกะผี] กะของคุณถูกแก้ไข วันที่ ${editingShift.date}`,
          from_name: 'ระบบยำกะผี',
          to_email: editingShift.member.email || ADMIN_EMAIL,
          message: `ประเภท: แก้ไขกะโดย Admin\nพนักงาน: ${editingShift.member.name}\nวันที่: ${editingShift.date}\nกะใหม่: ${code}\n\nตรวจสอบ: https://gen-lang-client-0528383957.web.app`,
        }, EMAILJS_PUBLIC_KEY).catch(() => {});
      }
      toast.success('อัปเดตกะสำเร็จ');
      setEditingShift(null);
    } catch { toast.error('เกิดข้อผิดพลาด'); }
  };

  useEffect(() => { setConfirmReverse(false); }, [swapDetail?.id]);

  const [reversing, setReversing] = useState(false);

  const handleReverseSwapDirect = async (sw: SwapRequest) => {
    if (reversing) return;
    setReversing(true);
    try {
      const batch = writeBatch(db);

      // Revert requester's date to original shift
      batch.set(doc(db, 'shifts', `${sw.requesterId}_${sw.requesterDate}`), {
        memberId: sw.requesterId, date: sw.requesterDate,
        shiftCode: sw.requesterShift,
        originalShiftCode: deleteField(),
        manualMark: deleteField(),
        updatedAt: new Date().toISOString(),
      } as any, { merge: true });

      // Revert target's date
      if (sw.targetId && sw.targetDate) {
        if (sw.type === 'swap' && sw.targetShift) {
          batch.set(doc(db, 'shifts', `${sw.targetId}_${sw.targetDate}`), {
            memberId: sw.targetId, date: sw.targetDate,
            shiftCode: sw.targetShift,
            originalShiftCode: deleteField(),
            manualMark: deleteField(),
            updatedAt: new Date().toISOString(),
          } as any, { merge: true });
        } else {
          // cover/cover_holiday: target's doc was created during approval, delete it
          batch.delete(doc(db, 'shifts', `${sw.targetId}_${sw.targetDate}`));
        }
      }

      // Delete return-date docs created during approval
      if (sw.returnDate) {
        batch.delete(doc(db, 'shifts', `${sw.requesterId}_${sw.returnDate}`));
        if (sw.targetId) batch.delete(doc(db, 'shifts', `${sw.targetId}_${sw.returnDate}`));
      }

      batch.update(doc(db, 'swapRequests', sw.id), { status: 'reversed' });
      await batch.commit();

      // Optimistic update: immediately remove from local state so green dot disappears
      // without waiting for Firestore listener to fire
      setApprovedSwaps(prev => prev.filter(s => s.id !== sw.id));
      setSwapDetail(null);
      setConfirmReverse(false);
      toast.success('คืนกะเดิมเรียบร้อยแล้ว');
    } catch (err: any) {
      console.error('[handleReverseSwapDirect]', err);
      toast.error(`คืนกะไม่สำเร็จ: ${err?.code || err?.message || 'unknown'}`);
    } finally {
      setReversing(false);
    }
  };

  const MemberCell = ({ m, mDays }: { m: Member; mDays: Date[] }) => {
    const isSelf = m.id === member.id;
    const isDiffStation = !isSelf && m.station !== member.station;
    const parts = m.name.trim().split(' ');
    return (
      <td className={`sticky left-0 z-10 px-1.5 py-1 border-r border-gray-200 ${isSelf ? 'bg-orange-50' : 'bg-white'}`}
        style={{ minWidth: 80, width: 80, boxShadow: '2px 0 4px -2px rgba(0,0,0,0.08)' }}>
        <div className="flex items-center gap-0.5 mb-0.5">
          {m.position && (
            <span className={`text-[7px] font-bold px-1 py-0 rounded border leading-none shrink-0 ${
              m.position === 'SS' ? 'bg-orange-50 text-orange-600 border-orange-200' :
              m.position === 'AStS' ? 'bg-cyan-50 text-cyan-600 border-cyan-200' :
              'bg-purple-50 text-purple-600 border-purple-200'
            }`}>{m.position}</span>
          )}
          {isSelf && <span className="text-[9px] font-bold text-orange-500 shrink-0">★</span>}
        </div>
        <p className="text-[10px] font-bold text-gray-800 leading-tight break-all">{parts[0]}</p>
        {parts[1] && <p className="text-[10px] font-bold text-gray-800 leading-tight break-all">{parts.slice(1).join(' ')}</p>}
        {isDiffStation && m.station && (
          <p className="text-[7px] text-indigo-500 font-bold leading-none mt-0.5 truncate">{m.station}</p>
        )}
        <div className="flex items-center gap-0.5 mt-0.5 flex-wrap">
          <span className="text-[7px] text-red-500 font-bold leading-none">A:{getUsage(m, 'A', mDays)}</span>
          <span className="text-[7px] text-pink-500 font-bold leading-none">H:{getUsage(m, 'H', mDays)}</span>
          <span className="text-[7px] text-gray-400 font-bold leading-none">X:{getUsage(m, 'X', mDays)}</span>
        </div>
      </td>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">กะทั้งหมด</h2>
          <p className="text-sm text-gray-500">
            {isAdmin && !memberMode ? 'ดูและแก้ไขตารางกะของทุกตำแหน่ง' : `ตำแหน่ง ${member.position || '—'}`}
          </p>
        </div>
        <button onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 400); }}
          className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-orange-600">
          <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Admin: Zone → Station → Position tabs — edit mode only */}
      {isAdmin && !memberMode && (
        <div className="space-y-2">
          {/* Zone tabs */}
          <div className="flex flex-wrap gap-1">
            <span className="text-[10px] font-bold text-gray-400 uppercase self-center mr-1">โซน</span>
            {zones.map(z => (
              <button key={z} onClick={() => setSelectedZone(z)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${selectedZone === z ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500 border-gray-200 hover:border-indigo-300'}`}>
                {z}
              </button>
            ))}
          </div>
          {/* Station tabs */}
          {stationsInZone.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span className="text-[10px] font-bold text-gray-400 uppercase self-center mr-1">สถานี</span>
              {stationsInZone.map(s => (
                <button key={s} onClick={() => setSelectedStation(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${selectedStation === s ? 'bg-orange-600 text-white border-orange-600' : 'bg-white text-gray-500 border-gray-200 hover:border-orange-300'}`}>
                  {s}
                </button>
              ))}
            </div>
          )}
          {/* Position tabs */}
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
            {['SS', 'AStS', 'SP'].map(tab => (
              <button key={tab} onClick={() => setPositionTab(tab)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${positionTab === tab ? 'bg-white shadow text-orange-600' : 'text-gray-500 hover:text-gray-700'}`}>
                {tab}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Show own station + position info in member mode */}
      {(!isAdmin || memberMode) && (
        <div className="flex items-center gap-2">
          {member.station && (
            <span className="text-xs text-indigo-600 font-bold bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-lg">
              {member.station}
            </span>
          )}
          {member.position && (
            <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${
              normalizePos(member.position) === 'SS' ? 'bg-orange-50 text-orange-600 border-orange-200' :
              normalizePos(member.position) === 'AStS' ? 'bg-cyan-50 text-cyan-600 border-cyan-200' :
              'bg-purple-50 text-purple-600 border-purple-200'
            }`}>
              {member.position}
            </span>
          )}
        </div>
      )}

      {/* 12 Month Tables */}
      {months.map(monthDate => {
        const mStart = startOfMonth(monthDate);
        const mEnd = endOfMonth(monthDate);
        const mDays = eachDayOfInterval({ start: mStart, end: mEnd });
        const isCurrent = format(monthDate, 'yyyy-MM') === format(new Date(), 'yyyy-MM');

        return (
          <div key={format(monthDate, 'yyyy-MM')} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className={`px-3 py-2 border-b border-gray-100 flex items-center justify-between ${isCurrent ? 'bg-orange-50' : 'bg-gray-50'}`}>
              <h3 className={`font-bold text-sm ${isCurrent ? 'text-orange-700' : 'text-gray-700'}`}>
                {format(monthDate, 'MMMM yyyy', { locale: th })}
              </h3>
              {isCurrent && <span className="text-[9px] bg-orange-600 text-white px-1.5 py-0.5 rounded-full font-bold">เดือนนี้</span>}
            </div>
            <div className="overflow-x-auto" style={{ paddingBottom: 17 }}>
              <table className="border-collapse text-xs" style={{ tableLayout: 'fixed', minWidth: '100%' }}>
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="sticky left-0 z-20 bg-gray-50 px-1.5 py-2 text-left font-bold text-gray-500 uppercase border-r border-gray-200" style={{ minWidth: 80, width: 80 }}>
                      สมาชิก
                    </th>
                    {mDays.map((day: Date) => (
                      <th key={day.toISOString()}
                        style={{ width: 28, minWidth: 28 }}
                        className={`px-0 py-1.5 text-center font-bold uppercase border-r border-gray-100 ${isToday(day) ? 'bg-orange-50 text-orange-500' : 'text-gray-400'}`}>
                        <div className="text-[10px]">{format(day, 'd')}</div>
                        <div className="text-[7px] font-normal">{format(day, 'EEE')}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {visibleMembers.map(m => {
                    const isSelf = m.id === member.id;
                    return (
                      <tr key={m.id} className={`hover:bg-gray-50/50 transition-colors ${isSelf ? 'bg-orange-50/20' : ''}`}>
                        <MemberCell m={m} mDays={mDays} />
                        {mDays.map((day: Date) => {
                          const dateStr = format(day, 'yyyy-MM-dd');
                          const rawEff = effectiveShiftMap.get(`${m.id}_${dateStr}`);
                          const isCover = rawEff?.startsWith('COVER:') ?? false;
                          const isCover2 = rawEff?.startsWith('COVER2:') ?? false;
                          const code = (rawEff && !isCover && !isCover2) ? rawEff : getShift(m, dateStr);
                          const coverShifts = isCover ? rawEff!.slice(6).split('|') : isCover2 ? ['', rawEff!.slice(7)] : [];
                          const swap = swapMap.get(`${m.id}_${dateStr}`);
                          return (
                            <td key={dateStr} className={`p-0.5 border-r border-gray-100 text-center ${isToday(day) ? 'bg-orange-50/20' : ''}`}>
                              <button
                                onClick={() => {
                                  if (showSwap) {
                                    if (swap) { setSwapDetail(swap); return; }
                                    if (!isSelf) setSwapPopup({ targetMember: m, targetDate: dateStr, targetShift: isCover ? coverShifts[0] : code });
                                  } else {
                                    setEditingShift({ member: m, date: dateStr });
                                  }
                                }}
                                disabled={showSwap && isSelf && !swap}
                                className={`relative w-full flex items-center justify-center rounded font-bold transition-all
                                  ${isCover || isCover2 ? 'h-8 flex-col gap-0' : 'h-6 text-[9px]'}
                                  ${(showSwap && isSelf && !swap) ? 'cursor-default opacity-70' : 'hover:opacity-75 active:scale-95 cursor-pointer'}`}
                                style={isCover || isCover2
                                  ? { backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d', borderRadius: 4 }
                                  : (isSelf ? getSelfShiftStyle(code) : getOtherShiftStyle(code))}
                              >
                                {isCover ? (
                                  <>
                                    <span className="text-[8px] font-bold leading-none">{coverShifts[0]}</span>
                                    <span className="text-[7px] font-bold leading-none opacity-60">+{coverShifts[1]}</span>
                                  </>
                                ) : isCover2 ? (
                                  <>
                                    <span className="text-[7px] font-bold leading-none opacity-50">ควง</span>
                                    <span className="text-[8px] font-bold leading-none">{coverShifts[1]}</span>
                                  </>
                                ) : (
                                  code === 'XO' ? 'X' : code
                                )}
                                {showSwap && swap && <span className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full bg-green-500" />}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  {visibleMembers.length === 0 && (
                    <tr><td colSpan={mDays.length + 1} className="py-8 text-center text-sm text-gray-400 italic">ไม่พบสมาชิกในตำแหน่งนี้</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {/* Admin: Edit Shift Modal — only in edit mode (not memberMode) */}
      {isAdmin && !memberMode && editingShift && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white w-full max-w-sm rounded-2xl p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">แก้ไขกะ</h3>
              <button onClick={() => setEditingShift(null)} className="text-gray-400 hover:text-gray-600"><CloseIcon size={20} /></button>
            </div>
            <p className="text-sm font-bold text-gray-700 mb-1">{editingShift.member.name}</p>
            <p className="text-xs text-gray-500 mb-4">{format(new Date(editingShift.date + 'T00:00:00'), 'd MMMM yyyy', { locale: th })}</p>
            <div className="grid grid-cols-4 gap-2">
              {(['S11','S12','S13','S78','AL-S11','AL-S12','AL-S13','X','A','H'] as ShiftCode[]).map(code => (
                <button key={code} onClick={() => handleUpdateShift(code)}
                  className="py-2.5 rounded-lg text-xs font-bold border-2 transition-all hover:scale-105 active:scale-95"
                  style={getShiftStyle(code)}>
                  {code}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Member: Step 1 — choose type */}
      {showSwap && swapPopup && (() => {
        const tgtIsOff = OFF_SHIFTS.includes(swapPopup.targetShift);
        const bothSS = normalizePos(member.position) === 'SS' && normalizePos(swapPopup.targetMember.position) === 'SS';
        return (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-end md:items-center justify-center p-4"
            onClick={() => setSwapPopup(null)}>
            <div className="bg-white rounded-2xl w-full max-w-xs shadow-2xl p-5" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-xs text-gray-400 uppercase font-bold">เลือกประเภทคำขอ</p>
                  <p className="font-bold text-gray-800 text-sm mt-0.5">{swapPopup.targetMember.name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {swapPopup.targetMember.station && (
                      <span className="text-[10px] text-indigo-600 font-bold bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded">
                        {swapPopup.targetMember.station}
                      </span>
                    )}
                    <p className="text-xs text-gray-500">{format(new Date(swapPopup.targetDate + 'T00:00:00'), 'd MMMM yyyy', { locale: th })}</p>
                  </div>
                </div>
                <span className="px-3 py-1.5 rounded-lg text-sm font-bold" style={getOtherShiftStyle(swapPopup.targetShift)}>{swapPopup.targetShift}</span>
              </div>
              <div className="space-y-2">
                <button onClick={() => openRequestForm('swap', swapPopup)}
                  className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl bg-orange-50 hover:bg-orange-100 text-orange-700 font-medium text-sm transition-colors">
                  <span className="text-lg">⇄</span>
                  <div className="text-left">
                    <p className="font-bold">สลับกะ</p>
                    <p className="text-[10px] text-orange-500">
                      {tgtIsOff ? 'แลกกะกับวันหยุด — ต้องระบุวันคืนทันที' : 'แลกกะทำงานกัน'}
                    </p>
                  </div>
                </button>
                {bothSS && (
                  <button onClick={() => openRequestForm('cover', swapPopup)}
                    className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-700 font-medium text-sm transition-colors">
                    <span className="text-lg">🔄</span>
                    <div className="text-left">
                      <p className="font-bold">ควงกะ</p>
                      <p className="text-[10px] text-purple-500">ควงให้กัน — เลือกวิธีคืนในขั้นถัดไป (SS เท่านั้น)</p>
                    </div>
                  </button>
                )}
                <button onClick={() => setSwapPopup(null)} className="w-full py-2 text-sm text-gray-400 hover:text-gray-600">ยกเลิก</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Member: Step 2 — fill in dates & submit */}
      {showSwap && requestForm && (() => {
        const liveReqShift = getShiftCode(member, requestForm.requesterDate, allShifts);
        const liveRetShift = getShiftCode(member, requestForm.returnDate, allShifts);
        const isSameDate = requestForm.requesterDate === requestForm.targetDate;
        const retIsOff = OFF_SHIFTS.includes(liveRetShift);
        const tgtIsOff = OFF_SHIFTS.includes(requestForm.targetShift);
        const reqIsOff = OFF_SHIFTS.includes(liveReqShift);
        const bothOff = tgtIsOff && reqIsOff;
        const hasHoliday = requestForm.type === 'swap' && (tgtIsOff !== reqIsOff);
        const maxReturnDate = format(endOfMonth(addMonths(new Date(), 1)), 'yyyy-MM-dd');
        const minDate = format(new Date(), 'yyyy-MM-dd');
        const returnDateValid = requestForm.returnDate <= maxReturnDate;
        const coverCheck = (requestForm.type === 'cover' || requestForm.type === 'cover_holiday')
          ? checkConsecutive(liveReqShift, requestForm.targetShift) : null;
        const bShiftOnReturnDate = requestForm.type === 'cover'
          ? getShiftCode(requestForm.targetMember, requestForm.returnDate, allShifts) : '';
        const coverReturnCheck = requestForm.type === 'cover'
          ? checkConsecutive(liveRetShift, bShiftOnReturnDate) : null;
        const canSubmit = !requestForm.submitting && (
          requestForm.type === 'swap'
            ? (!bothOff && (!hasHoliday || (retIsOff && returnDateValid)))
            : requestForm.type === 'cover'
              ? (coverCheck?.valid === true && coverReturnCheck?.valid === true)
              : (coverCheck?.valid === true && retIsOff)
        );
        const btnColor = requestForm.type === 'swap' ? 'bg-orange-600 hover:bg-orange-700'
          : requestForm.type === 'cover_holiday' ? 'bg-teal-600 hover:bg-teal-700'
          : 'bg-purple-600 hover:bg-purple-700';

        const TwoCol = ({ leftLabel, leftContent, rightLabel, rightContent, arrow = '⇄' }: {
          leftLabel: string; leftContent: React.ReactNode;
          rightLabel: string; rightContent: React.ReactNode; arrow?: string;
        }) => (
          <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
            <div className="bg-orange-50 border border-orange-100 rounded-xl p-3 text-center">
              <p className="text-[10px] font-bold text-orange-500 uppercase mb-2">{leftLabel}</p>
              {leftContent}
            </div>
            <div className="text-xl font-bold text-gray-400 pb-2">{arrow}</div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
              <p className="text-[10px] font-bold text-gray-500 uppercase mb-2">{rightLabel}</p>
              {rightContent}
            </div>
          </div>
        );

        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-4"
            onClick={() => setRequestForm(null)}>
            <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <div>
                  <p className="text-xs text-gray-400 uppercase font-bold">{requestForm.type === 'swap' ? 'สลับกะ' : 'ควงกะ'}</p>
                  <p className="font-bold text-gray-800 text-sm mt-0.5">กับ {requestForm.targetMember.name}</p>
                </div>
                <button onClick={() => setRequestForm(null)} className="text-gray-400 hover:text-gray-600"><CloseIcon size={18} /></button>
              </div>

              {/* ===== SWAP ===== */}
              {requestForm.type === 'swap' && (
                <div className="space-y-3">
                  <TwoCol
                    leftLabel="คุณ"
                    leftContent={<>
                      <input type="date" value={requestForm.requesterDate} min={minDate}
                        onChange={e => setRequestForm(f => f ? { ...f, requesterDate: e.target.value } : null)}
                        className="w-full border border-orange-200 rounded-lg px-1 py-1.5 text-[10px] text-center focus:ring-2 focus:ring-orange-500 outline-none bg-white mb-2" />
                      <span className="inline-block px-3 py-1.5 rounded-lg text-base font-bold" style={getSelfShiftStyle(liveReqShift)}>{liveReqShift}</span>
                    </>}
                    rightLabel={requestForm.targetMember.name.split(' ')[0]}
                    rightContent={<>
                      <p className="text-[10px] text-gray-500 font-medium py-1.5 mb-2">{format(new Date(requestForm.targetDate + 'T00:00:00'), 'd MMM yy', { locale: th })}</p>
                      <span className="inline-block px-3 py-1.5 rounded-lg text-base font-bold" style={getOtherShiftStyle(requestForm.targetShift)}>{requestForm.targetShift}</span>
                    </>}
                  />
                  {bothOff && (
                    <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
                      ⚠️ ไม่สามารถสลับวันหยุด ↔ วันหยุดได้
                    </div>
                  )}
                  {!hasHoliday && !bothOff && (
                    <div className={`rounded-lg px-3 py-2 text-xs font-medium ${isSameDate ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
                      {isSameDate
                        ? `สลับกะ ${liveReqShift} ↔ ${requestForm.targetShift} วันที่ ${format(new Date(requestForm.targetDate + 'T00:00:00'), 'd MMMM', { locale: th })}`
                        : `คุณให้กะ ${liveReqShift} วัน ${format(new Date(requestForm.requesterDate + 'T00:00:00'), 'd MMM', { locale: th })} — ${requestForm.targetMember.name.split(' ')[0]} ให้กะ ${requestForm.targetShift} วัน ${format(new Date(requestForm.targetDate + 'T00:00:00'), 'd MMM', { locale: th })}`}
                    </div>
                  )}
                  {hasHoliday && (
                    <div className="border-t border-dashed border-blue-100 pt-3 space-y-2">
                      <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wide">วันคืนวันหยุด <span className="font-normal text-gray-400 normal-case">(ไม่เกินเดือนถัดไป)</span></p>
                      <div className="flex items-center gap-2">
                        <input type="date" value={requestForm.returnDate} max={maxReturnDate}
                          onChange={e => setRequestForm(f => f ? { ...f, returnDate: e.target.value } : null)}
                          className="flex-1 border border-blue-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 outline-none" />
                        <span className="px-2 py-1.5 rounded-lg text-sm font-bold shrink-0" style={getSelfShiftStyle(liveRetShift)}>{liveRetShift}</span>
                      </div>
                      {retIsOff && returnDateValid
                        ? <p className="text-[10px] text-blue-600">✓ คืนวันหยุด {liveRetShift} ให้ {requestForm.targetMember.name.split(' ')[0]} วัน {format(new Date(requestForm.returnDate + 'T00:00:00'), 'd MMM', { locale: th })}</p>
                        : !retIsOff
                          ? <p className="text-[10px] text-red-500">⚠️ ต้องเลือกวันหยุดของคุณ (X/A/H) เพื่อคืน</p>
                          : <p className="text-[10px] text-red-500">⚠️ ต้องคืนภายในเดือนถัดไป (ก่อน {format(new Date(maxReturnDate + 'T00:00:00'), 'd MMM yy', { locale: th })})</p>
                      }
                    </div>
                  )}
                </div>
              )}

              {/* ===== COVER / COVER_HOLIDAY (unified) ===== */}
              {(requestForm.type === 'cover' || requestForm.type === 'cover_holiday') && (
                <div className="space-y-3">
                  <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
                    <button
                      onClick={() => setRequestForm(f => f ? { ...f, type: 'cover' } : null)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${requestForm.type === 'cover' ? 'bg-white shadow text-purple-600' : 'text-gray-400 hover:text-gray-600'}`}>
                      ควงคืน
                    </button>
                    <button
                      onClick={() => setRequestForm(f => f ? { ...f, type: 'cover_holiday' } : null)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${requestForm.type === 'cover_holiday' ? 'bg-white shadow text-teal-600' : 'text-gray-400 hover:text-gray-600'}`}>
                      คืนวันหยุด
                    </button>
                  </div>
                  <p className="text-[10px] font-bold text-purple-600 uppercase tracking-wide">วันที่ขอ</p>
                  <TwoCol
                    arrow="+"
                    leftLabel="กะคุณ"
                    leftContent={<>
                      <p className="text-sm font-bold text-orange-700 py-1.5 mb-2">{format(new Date(requestForm.requesterDate + 'T00:00:00'), 'd MMM yy', { locale: th })}</p>
                      <span className="inline-block px-3 py-1.5 rounded-lg text-base font-bold" style={getSelfShiftStyle(liveReqShift)}>{liveReqShift}</span>
                    </>}
                    rightLabel={requestForm.targetMember.name.split(' ')[0]}
                    rightContent={<>
                      <p className="text-[10px] text-gray-500 font-medium py-1.5 mb-2">{format(new Date(requestForm.targetDate + 'T00:00:00'), 'd MMM yy', { locale: th })}</p>
                      <span className="inline-block px-3 py-1.5 rounded-lg text-base font-bold" style={getOtherShiftStyle(requestForm.targetShift)}>{requestForm.targetShift}</span>
                    </>}
                  />
                  {coverCheck === null
                    ? reqIsOff
                      ? <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">⚠️ กะวันที่ขอเป็นวันหยุด — เลือกวันที่มีกะทำงาน</div>
                      : <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-xs text-yellow-700">⚠️ ยังไม่มีข้อมูลเวลากะ — ไปที่ ตั้งค่า → ทะเบียนรหัสกะ เพื่อใส่เวลาเข้า-ออก</div>
                    : !coverCheck.valid
                      ? <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">⚠️ กะ {liveReqShift} + {requestForm.targetShift} ไม่ต่อเนื่อง — กรุณาเลือกวันที่กะต่อกัน</div>
                      : null
                  }
                  <div className="border-t border-dashed border-purple-100 pt-3 space-y-2">
                    <p className="text-[10px] font-bold text-purple-600 uppercase tracking-wide">วันที่คืน</p>
                    {requestForm.type === 'cover' ? (
                      <>
                        <TwoCol
                          arrow="+"
                          leftLabel="กะคุณ"
                          leftContent={<>
                            <input type="date" value={requestForm.returnDate} min={minDate}
                              onChange={e => setRequestForm(f => f ? { ...f, returnDate: e.target.value } : null)}
                              className="w-full border border-purple-200 rounded-lg px-1 py-1.5 text-[10px] text-center focus:ring-2 focus:ring-purple-500 outline-none bg-white mb-2" />
                            <span className="inline-block px-3 py-1.5 rounded-lg text-base font-bold" style={getSelfShiftStyle(liveRetShift)}>{liveRetShift}</span>
                          </>}
                          rightLabel={requestForm.targetMember.name.split(' ')[0]}
                          rightContent={<>
                            <p className="text-[10px] text-gray-500 font-medium py-1.5 mb-2">{format(new Date(requestForm.returnDate + 'T00:00:00'), 'd MMM yy', { locale: th })}</p>
                            <span className="inline-block px-3 py-1.5 rounded-lg text-base font-bold" style={getOtherShiftStyle(bShiftOnReturnDate)}>{bShiftOnReturnDate || '—'}</span>
                          </>}
                        />
                        {coverReturnCheck === null
                          ? <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-xs text-yellow-700">⚠️ วันที่คืนเป็นวันหยุด</div>
                          : !coverReturnCheck.valid
                            ? <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">⚠️ กะ {liveRetShift} + {bShiftOnReturnDate} ไม่ต่อเนื่อง (วันคืน)</div>
                            : null
                        }
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <input type="date" value={requestForm.returnDate} min={minDate} max={maxReturnDate}
                            onChange={e => setRequestForm(f => f ? { ...f, returnDate: e.target.value } : null)}
                            className="flex-1 border border-teal-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-teal-500 outline-none" />
                          <span className="px-2 py-1.5 rounded-lg text-sm font-bold shrink-0" style={getSelfShiftStyle(liveRetShift)}>{liveRetShift}</span>
                        </div>
                        {retIsOff
                          ? <p className="text-[10px] text-teal-600">✓ คืนวันหยุด {liveRetShift} ให้ {requestForm.targetMember.name.split(' ')[0]} วัน {format(new Date(requestForm.returnDate + 'T00:00:00'), 'd MMM', { locale: th })}</p>
                          : <p className="text-[10px] text-red-500">⚠️ ต้องเลือกวันหยุดของคุณ (X/A/H) เพื่อคืนให้</p>
                        }
                      </>
                    )}
                  </div>
                </div>
              )}

              <div className="flex space-x-2 mt-5">
                <button onClick={() => setRequestForm(null)}
                  className="flex-1 py-2 text-sm text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors">ยกเลิก</button>
                <button onClick={submitRequest} disabled={!canSubmit}
                  className={`flex-1 py-2 text-sm text-white font-bold rounded-lg transition-colors disabled:opacity-50 ${btnColor}`}>
                  {requestForm.submitting ? 'กำลังส่ง...' : 'ยืนยันส่งคำขอ'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      {/* Swap Detail Modal */}
      {showSwap && swapDetail && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end md:items-center justify-center p-4"
          onClick={() => setSwapDetail(null)}>
          <div className="bg-white rounded-2xl w-full max-w-xs shadow-2xl p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold text-green-600 uppercase">✓ การแลกกะที่อนุมัติแล้ว</p>
              <button onClick={() => setSwapDetail(null)} className="text-gray-400 hover:text-gray-600"><CloseIcon size={18} /></button>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">ประเภท</span>
                <span className="font-bold">{swapDetail.type === 'swap' ? 'สลับกะ' : 'ควงกะ'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">ผู้ขอ</span>
                <span className="font-bold text-gray-800">{swapDetail.requesterName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">วันที่ผู้ขอ</span>
                <span className="font-bold">{swapDetail.requesterDate} <span className="text-orange-600">({swapDetail.requesterShift})</span></span>
              </div>
              {swapDetail.targetName && (
                <div className="flex justify-between">
                  <span className="text-gray-500">คู่แลก</span>
                  <span className="font-bold text-gray-800">{swapDetail.targetName}</span>
                </div>
              )}
              {swapDetail.targetDate && (
                <div className="flex justify-between">
                  <span className="text-gray-500">วันที่คู่แลก</span>
                  <span className="font-bold">{swapDetail.targetDate} <span className="text-orange-600">({swapDetail.targetShift})</span></span>
                </div>
              )}
              {swapDetail.returnDate && (
                <div className="flex justify-between">
                  <span className="text-gray-500">วันคืนกะ</span>
                  <span className="font-bold text-purple-600">{swapDetail.returnDate}</span>
                </div>
              )}
            </div>
            {(swapDetail.requesterId === member.id || swapDetail.targetId === member.id) && (
              <div className="mt-4 pt-3 border-t border-gray-100">
                {!confirmReverse ? (
                  <button
                    onClick={() => setConfirmReverse(true)}
                    className="w-full py-2.5 text-sm font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    <RotateCcw size={14} />
                    ขอแลกคืน
                  </button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-center text-gray-600 font-medium">คืนกะเดิมของทั้งสองฝ่ายใช่ไหม?</p>
                    <div className="flex gap-2">
                      <button onClick={() => setConfirmReverse(false)}
                        className="flex-1 py-2 text-sm text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors">
                        ยกเลิก
                      </button>
                      <button onClick={() => handleReverseSwapDirect(swapDetail)}
                        className="flex-1 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg font-bold transition-colors">
                        ยืนยัน
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
