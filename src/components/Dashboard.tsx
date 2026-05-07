import React, { useState, useEffect, useMemo } from 'react';
import { format, startOfMonth, startOfYear, endOfMonth, eachDayOfInterval, isToday, addMonths, differenceInDays, parseISO } from 'date-fns';
import { th } from 'date-fns/locale';
import { RefreshCw, Bug } from 'lucide-react';
import { collection, query, where, onSnapshot, doc, setDoc, deleteDoc, getDocs, deleteField } from 'firebase/firestore';
import { db } from '../firebase';
import { Member, Shift, ShiftCode } from '../types';
import { generateSchedule } from '../lib/scheduleUtils';
import { toast } from 'sonner';
import { useShiftProperties } from '../hooks/useShiftProperties';

interface DashboardProps {
  member: Member;
}

export default function Dashboard({ member }: DashboardProps) {
  const today = new Date();
  // H: calendar year Jan 1–Dec 31
  // A: fiscal year Apr 1–Mar 31 (next year)
  const calYear = today.getFullYear();
  const fiscalBase = today.getMonth() >= 3 ? calYear : calYear - 1; // Apr=3 in JS
  // Fetch from earliest period start to cover both H and A
  const rangeStart = today.getMonth() >= 3
    ? startOfYear(today)                      // Apr-Dec: Jan 1 covers both
    : new Date(fiscalBase, 3, 1);             // Jan-Mar: need Apr 1 of last year for A
  const rangeEnd = endOfMonth(addMonths(today, 11));
  const calendarStart = startOfMonth(today);

  const { getShiftStyle } = useShiftProperties();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [notes, setNotes] = useState<Map<string, string>>(new Map());
  const [noteInput, setNoteInput] = useState('');

  useEffect(() => {
    const q = query(
      collection(db, 'shifts'),
      where('memberId', '==', member.id),
      where('date', '>=', format(rangeStart, 'yyyy-MM-dd')),
      where('date', '<=', format(rangeEnd, 'yyyy-MM-dd'))
    );
    const unsub = onSnapshot(q, (snap) => {
      setShifts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Shift)));
      setLoading(false);
    });
    return () => unsub();
  }, [member.id]);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'notes'), where('memberId', '==', member.id)),
      snap => {
        const map = new Map<string, string>();
        snap.docs.forEach(d => map.set(d.data().date as string, d.data().text as string));
        setNotes(map);
      }
    );
    return () => unsub();
  }, [member.id]);

  const saveNote = async (dateStr: string, text: string) => {
    try {
      if (text.trim()) {
        await setDoc(doc(db, 'notes', `${member.id}_${dateStr}`), {
          memberId: member.id, date: dateStr,
          text: text.trim().slice(0, 30),
          updatedAt: new Date().toISOString(),
        });
      } else {
        await deleteDoc(doc(db, 'notes', `${member.id}_${dateStr}`));
      }
    } catch { toast.error('เกิดข้อผิดพลาด'); }
  };

  const generatedMap = useMemo(() => {
    const schedule = generateSchedule(member.id, member.shiftPattern, member.cycleStartDate, 2);
    return new Map(schedule.map(s => [s.date, s.shiftCode]));
  }, [member.id, member.shiftPattern, member.cycleStartDate]);

  const shiftsMap = useMemo(() =>
    new Map(shifts.map(s => [s.date, s])),
  [shifts]);

  const getShift = (dateStr: string): { code: ShiftCode; original?: ShiftCode; isDouble?: boolean; manualMark?: boolean } => {
    const ex = shiftsMap.get(dateStr);
    if (ex) return { code: ex.shiftCode, original: ex.originalShiftCode, isDouble: ex.isDoubleShift, manualMark: ex.manualMark };
    return { code: (generatedMap.get(dateStr) as ShiftCode) || 'X' };
  };

  const markCode = async (dateStr: string, newCode: 'H' | 'A' | 'XO') => {
    const { code, original } = getShift(dateStr);
    try {
      await setDoc(doc(db, 'shifts', `${member.id}_${dateStr}`), {
        memberId: member.id,
        date: dateStr,
        shiftCode: newCode,
        originalShiftCode: code !== newCode ? code : (original || code),
        manualMark: true,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      toast.success(`ใส่ ${newCode} วันที่ ${dateStr}`);
      setSelectedDay(null);
    } catch { toast.error('เกิดข้อผิดพลาด'); }
  };

  const revertShift = async (dateStr: string) => {
    const { original } = getShift(dateStr);
    if (!original) return;
    try {
      await setDoc(doc(db, 'shifts', `${member.id}_${dateStr}`), {
        memberId: member.id,
        date: dateStr,
        shiftCode: original,
        originalShiftCode: null,
        manualMark: deleteField() as any,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      toast.success(`คืนกะเดิม ${original}`);
      setSelectedDay(null);
    } catch { toast.error('เกิดข้อผิดพลาด'); }
  };

  // Quota: count only Firestore-stored A/H shifts from Jan 1 to today (actual used, not projected)
  const todayStr = format(today, 'yyyy-MM-dd');
  const totalA = shifts.filter(s => s.shiftCode === 'A' && s.date <= todayStr).length;
  const totalH = shifts.filter(s => s.shiftCode === 'H' && s.date <= todayStr).length;
  // X count from pattern over displayed calendar (informational only)
  const calDays = eachDayOfInterval({ start: calendarStart, end: rangeEnd });
  const totalX = calDays.filter(d => getShift(format(d, 'yyyy-MM-dd')).code === 'X').length;

  const months = Array.from({ length: 12 }, (_, i) => addMonths(today, i));

  const selShift = selectedDay ? getShift(selectedDay) : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">ตารางกะการทำงาน</h2>
          <p className="text-sm text-gray-500">{member.name} — {member.station}
            {member.position && <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-600 border border-orange-200">{member.position}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {member.role === 'admin' && (
            <button onClick={() => setShowDebug(p => !p)}
              className={`p-2 rounded-full transition-colors ${showDebug ? 'bg-yellow-100 text-yellow-600' : 'text-gray-400 hover:bg-gray-100 hover:text-yellow-600'}`}
              title="Debug info">
              <Bug size={18} />
            </button>
          )}
          <button onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 300); }}
            className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-orange-600">
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Debug Panel */}
      {showDebug && (() => {
        const patternArr = member.shiftPattern?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
        const todayStr = format(today, 'yyyy-MM-dd');
        const diff = member.cycleStartDate ? differenceInDays(parseISO(todayStr), parseISO(member.cycleStartDate)) : null;
        const patternIdx = diff !== null && patternArr.length > 0 ? ((diff % patternArr.length) + patternArr.length) % patternArr.length : null;
        const expectedShift = patternIdx !== null ? patternArr[patternIdx] : '—';
        const overrideShifts = shifts.filter(s => s.shiftCode !== 'A' && s.shiftCode !== 'H');

        const clearOverrides = async () => {
          if (!confirm(`ลบ shift override ${overrideShifts.length} รายการ (S11/S12/S13 เก่า) ใช่ไหม?\nปฏิทินจะคำนวณจาก pattern ใหม่ทั้งหมด`)) return;
          try {
            await Promise.all(overrideShifts.map(s => deleteDoc(doc(db, 'shifts', s.id))));
            toast.success(`ล้าง override สำเร็จ ${overrideShifts.length} รายการ`);
          } catch { toast.error('เกิดข้อผิดพลาด'); }
        };

        return (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-xs font-mono space-y-1">
            <p className="text-yellow-700 font-bold text-[11px] uppercase mb-2">🔍 Debug — Firestore doc: {member.id}</p>
            <p><span className="text-gray-500">shiftPattern:</span> <span className="text-gray-800 break-all">{member.shiftPattern || '—'}</span></p>
            <p><span className="text-gray-500">cycleStartDate:</span> <span className="text-gray-800">{member.cycleStartDate || '—'}</span></p>
            <p><span className="text-gray-500">patternLength:</span> <span className="text-gray-800">{patternArr.length} วัน</span></p>
            <div className="border-t border-yellow-200 pt-1 mt-1">
              <p><span className="text-gray-500">วันนี้ ({todayStr}):</span></p>
              <p className="pl-2"><span className="text-gray-500">diff =</span> <span className="text-blue-700 font-bold">{diff ?? '—'} วัน</span> <span className="text-gray-500 ml-2">index =</span> <span className="text-blue-700 font-bold">{patternIdx !== null ? `${patternIdx} (pos ${patternIdx + 1})` : '—'}</span> <span className="text-gray-500 ml-2">→</span> <span className="font-bold text-blue-700">{expectedShift}</span></p>
            </div>
            <div className={`border-t pt-1 mt-1 ${overrideShifts.length > 0 ? 'border-red-300' : 'border-yellow-200'}`}>
              <div className="flex items-center justify-between">
                <p className={`font-bold ${overrideShifts.length > 0 ? 'text-red-600' : 'text-gray-500'}`}>
                  Shift overrides (S11/S12/S13 เก่าใน Firestore): {overrideShifts.length} รายการ
                  {overrideShifts.length > 0 && <span className="ml-1 text-red-500">← สาเหตุที่ปฏิทินผิด!</span>}
                </p>
                {overrideShifts.length > 0 && (
                  <button onClick={clearOverrides}
                    className="ml-2 px-3 py-1 bg-red-600 text-white text-[10px] font-bold rounded-lg hover:bg-red-700 shrink-0">
                    ล้าง Override
                  </button>
                )}
              </div>
              {overrideShifts.length > 0 && (
                <p className="text-red-400 text-[10px] mt-0.5">shift เหล่านี้ถูก save ไว้ใน Firestore และ override การคำนวณจาก pattern</p>
              )}
            </div>
          </div>
        );
      })()}

      {/* Quota Summary */}
      <div className="space-y-2">
        <p className="text-[10px] text-gray-400 font-medium">วันหยุดที่ใช้ไปแล้ว ปี {today.getFullYear()} (1 ม.ค. — วันนี้)</p>
        <div className="grid grid-cols-3 gap-3">
          {[
            { code: 'A', label: 'ลาพักร้อน', quota: member.quotaA, used: totalA, bar: 'bg-red-400', barOver: 'bg-red-600', badge: 'bg-red-50 text-red-600' },
            { code: 'H', label: 'หยุดนักขัตฤกษ์', quota: member.quotaH, used: totalH, bar: 'bg-pink-400', barOver: 'bg-pink-600', badge: 'bg-pink-50 text-pink-600' },
            { code: 'X', label: 'หยุดประจำ', quota: member.quotaX, used: totalX, bar: 'bg-gray-400', barOver: 'bg-gray-600', badge: 'bg-gray-50 text-gray-600' },
          ].map(({ code, label, quota, used, bar, barOver, badge }) => {
            const over = quota > 0 && used > quota;
            return (
              <div key={code} className={`bg-white p-3 rounded-xl border shadow-sm ${over ? 'border-red-300' : 'border-gray-200'}`}>
                <div className="flex justify-between items-start mb-1">
                  <p className="text-[10px] uppercase font-bold text-gray-400">{label}</p>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${badge}`}>{code} {quota}</span>
                </div>
                <p className={`text-xl font-black ${over ? 'text-red-600' : 'text-gray-800'}`}>
                  {used} <span className="text-xs font-normal text-gray-400">วัน</span>
                </p>
                <div className="mt-1 h-1.5 w-full bg-gray-100 rounded-full">
                  <div className={`h-full ${over ? barOver : bar} rounded-full transition-all`}
                    style={{ width: `${Math.min(100, (used / Math.max(1, quota)) * 100)}%` }} />
                </div>
                {over
                  ? <p className="text-[10px] text-red-500 font-bold mt-1">⚠ เกิน {used - quota} วัน!</p>
                  : <p className="text-[10px] text-gray-400 mt-1">เหลือ {Math.max(0, quota - used)} วัน</p>
                }
              </div>
            );
          })}
        </div>
      </div>

      {/* 12-Month Calendars */}
      {months.map((monthDate) => {
        const mStart = startOfMonth(monthDate);
        const mEnd = endOfMonth(monthDate);
        const mDays = eachDayOfInterval({ start: mStart, end: mEnd });
        const isCurrent = format(monthDate, 'yyyy-MM') === format(today, 'yyyy-MM');
        const mA = mDays.filter(d => getShift(format(d, 'yyyy-MM-dd')).code === 'A').length;
        const mH = mDays.filter(d => getShift(format(d, 'yyyy-MM-dd')).code === 'H').length;
        const mX = mDays.filter(d => getShift(format(d, 'yyyy-MM-dd')).code === 'X').length;

        return (
          <div key={format(monthDate, 'yyyy-MM')} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className={`px-4 py-2.5 border-b border-gray-100 flex items-center justify-between ${isCurrent ? 'bg-orange-50' : 'bg-gray-50'}`}>
              <div className="flex items-center space-x-2">
                <h3 className={`font-bold text-sm ${isCurrent ? 'text-orange-700' : 'text-gray-700'}`}>
                  {format(monthDate, 'MMMM yyyy', { locale: th })}
                </h3>
                {isCurrent && <span className="text-[9px] bg-orange-600 text-white px-1.5 py-0.5 rounded-full font-bold">เดือนนี้</span>}
              </div>
              <div className="flex items-center space-x-2 text-[10px] font-bold">
                <span className="text-red-500">A:{mA}</span>
                <span className="text-pink-500">H:{mH}</span>
                <span className="text-gray-400">X:{mX}</span>
              </div>
            </div>

            <div className="grid grid-cols-7 bg-gray-50 border-b border-gray-100">
              {['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].map(d => (
                <div key={d} className="py-1.5 text-center text-[10px] font-bold text-gray-400">{d}</div>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {Array.from({ length: mStart.getDay() }).map((_, i) => (
                <div key={`pad-${i}`} className="h-14 border-b border-r border-gray-50 bg-gray-50/30" />
              ))}
              {mDays.map(day => {
                const dateStr = format(day, 'yyyy-MM-dd');
                const { code, original, isDouble } = getShift(dateStr);
                const todayDay = isToday(day);

                return (
                  <div
                    key={dateStr}
                    onClick={() => { setSelectedDay(selectedDay === dateStr ? null : dateStr); setNoteInput(notes.get(dateStr) || ''); }}
                    className={`min-h-14 border-b border-r border-gray-100 p-1 flex flex-col items-start cursor-pointer hover:bg-orange-50/20 transition-colors ${todayDay ? 'bg-orange-50' : ''} ${selectedDay === dateStr ? 'ring-2 ring-orange-400 ring-inset' : ''}`}
                  >
                    {todayDay ? (
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-orange-600 text-white text-[10px] font-bold shrink-0">
                        {format(day, 'd')}
                      </span>
                    ) : (
                      <span className="text-[10px] font-medium h-5 flex items-center text-gray-500">
                        {format(day, 'd')}
                      </span>
                    )}
                    <span className="inline-block px-1 py-0.5 rounded text-[9px] font-bold border mt-0.5" style={getShiftStyle(code)}>
                      {code === 'XO' ? 'X' : code}{isDouble ? '×2' : ''}
                    </span>
                    {original && (
                      <span className="block text-[8px] text-gray-400 line-through leading-tight">{original === 'XO' ? 'X' : original}</span>
                    )}
                    {notes.get(dateStr) && (
                      <span className="block text-[7px] text-indigo-500 leading-tight truncate w-full mt-0.5">📝 {notes.get(dateStr)}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Day Action Modal */}
      {selectedDay && selShift && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end md:items-center justify-center p-4"
          onClick={() => setSelectedDay(null)}>
          <div className="bg-white rounded-2xl w-full max-w-xs shadow-2xl p-5"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs text-gray-400 uppercase font-bold">วันที่</p>
                <p className="font-bold text-gray-800">{format(new Date(selectedDay + 'T00:00:00'), 'd MMMM yyyy', { locale: th })}</p>
              </div>
              <span className="px-3 py-1.5 rounded-lg text-sm font-bold border" style={getShiftStyle(selShift.code)}>
                {selShift.code}
              </span>
            </div>

            <div className="space-y-2">
              {selShift.code !== 'H' && (
                <button onClick={() => markCode(selectedDay, 'H')}
                  className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl bg-pink-50 hover:bg-pink-100 text-pink-700 font-medium text-sm transition-colors">
                  <span className="text-lg">🏖️</span>
                  <span>ใส่วันหยุดนักขัตฤกษ์ (H)</span>
                </button>
              )}
              {selShift.code !== 'A' && (
                <button onClick={() => markCode(selectedDay, 'A')}
                  className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 font-medium text-sm transition-colors">
                  <span className="text-lg">🌴</span>
                  <span>ใส่วันลาพักร้อน (A)</span>
                </button>
              )}
              {selShift.code !== 'XO' && (
                <button onClick={() => markCode(selectedDay, 'XO')}
                  className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium text-sm transition-colors">
                  <span className="text-lg">🔀</span>
                  <div className="text-left">
                    <p className="font-bold">แลกกะนอกสถานี (XO)</p>
                    <p className="text-[10px] text-blue-400">แลกกับพนักงานที่ไม่มีในระบบ</p>
                  </div>
                </button>
              )}
              {selShift.original && selShift.manualMark === true && (['H', 'A', 'XO'] as ShiftCode[]).includes(selShift.code) && (
                <button onClick={() => revertShift(selectedDay)}
                  className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl bg-gray-50 hover:bg-gray-100 text-gray-700 font-medium text-sm transition-colors">
                  <span className="text-lg">↩️</span>
                  <span>คืนกะเดิม ({selShift.original})</span>
                </button>
              )}
              {/* Note */}
              <div className="pt-1 border-t border-gray-100">
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">บันทึกส่วนตัว (ไม่เกิน 30 ตัวอักษร)</label>
                <div className="flex gap-2">
                  <input
                    value={noteInput}
                    onChange={e => setNoteInput(e.target.value.slice(0, 30))}
                    placeholder="บันทึกสั้นๆ..."
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                  <button onClick={() => saveNote(selectedDay!, noteInput)}
                    className="px-3 py-1.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-lg text-xs font-bold transition-colors">
                    บันทึก
                  </button>
                </div>
                <p className="text-[9px] text-gray-300 mt-0.5 text-right">{noteInput.length}/30</p>
              </div>

              <button onClick={() => setSelectedDay(null)}
                className="w-full py-2 text-sm text-gray-400 hover:text-gray-600 transition-colors">
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
