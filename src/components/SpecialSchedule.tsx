import React, { useState, useEffect, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, isToday, differenceInDays, parseISO } from 'date-fns';
import { th } from 'date-fns/locale';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { Member, Shift, PairGroup } from '../types';
import { useShiftProperties } from '../hooks/useShiftProperties';

interface SpecialScheduleProps {
  member: Member;
  group: PairGroup;
}

export default function SpecialSchedule({ member, group }: SpecialScheduleProps) {
  const { getOtherShiftStyle, getSelfShiftStyle } = useShiftProperties();
  const [groupMembers, setGroupMembers] = useState<Member[]>([]);
  const [allShifts, setAllShifts] = useState<Shift[]>([]);

  const rangeStart = startOfMonth(new Date());
  const rangeEnd = endOfMonth(addMonths(new Date(), 11));
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => addMonths(rangeStart, i)), []);

  useEffect(() => {
    const unsubMembers = onSnapshot(collection(db, 'members'), snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as Member));
      const inGroup = all.filter(m => group.memberIds.includes(m.id));
      setGroupMembers([
        ...inGroup.filter(m => m.id === member.id),
        ...inGroup.filter(m => m.id !== member.id),
      ]);
    });

    const qShifts = query(
      collection(db, 'shifts'),
      where('date', '>=', format(rangeStart, 'yyyy-MM-dd')),
      where('date', '<=', format(rangeEnd, 'yyyy-MM-dd'))
    );
    const unsubShifts = onSnapshot(qShifts, snap => {
      setAllShifts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Shift)));
    });

    return () => { unsubMembers(); unsubShifts(); };
  }, [group.memberIds]);

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

  const getUsage = (m: Member, code: string, mDays: Date[]) =>
    mDays.filter(d => getShift(m, format(d, 'yyyy-MM-dd')) === code).length;

  const positionColor = (pos?: string) => {
    if (pos === 'SS') return 'bg-orange-50 text-orange-600 border-orange-200';
    if (pos === 'AStS') return 'bg-cyan-50 text-cyan-600 border-cyan-200';
    return 'bg-purple-50 text-purple-600 border-purple-200';
  };

  const MemberCell = ({ m, mDays }: { m: Member; mDays: Date[] }) => {
    const isSelf = m.id === member.id;
    const parts = m.name.trim().split(' ');
    return (
      <td className={`sticky left-0 z-10 px-1.5 py-1 border-r border-gray-200 ${isSelf ? 'bg-orange-50' : 'bg-white'}`}
        style={{ minWidth: 80, width: 80, boxShadow: '2px 0 4px -2px rgba(0,0,0,0.08)' }}>
        <div className="flex items-center gap-0.5 mb-0.5">
          {m.position && (
            <span className={`text-[7px] font-bold px-1 py-0 rounded border leading-none shrink-0 ${positionColor(m.position)}`}>
              {m.position}
            </span>
          )}
          {isSelf && <span className="text-[9px] font-bold text-orange-500 shrink-0">★</span>}
        </div>
        <p className="text-[10px] font-bold text-gray-800 leading-tight break-all">{parts[0]}</p>
        {parts[1] && <p className="text-[10px] font-bold text-gray-800 leading-tight break-all">{parts.slice(1).join(' ')}</p>}
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
      <div>
        <h2 className="text-2xl font-bold text-gray-800">ตารางกะพิเศษ</h2>
        <p className="text-sm text-gray-500">กลุ่ม: {group.name} · {groupMembers.length} สมาชิก</p>
      </div>

      {/* Member badges */}
      <div className="flex flex-wrap gap-2">
        {groupMembers.map(m => (
          <div key={m.id} className={`flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium
            ${m.id === member.id ? 'bg-orange-50 border-orange-200 text-orange-700' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
            {m.position && (
              <span className={`text-[7px] font-bold px-1 rounded border leading-none ${positionColor(m.position)}`}>
                {m.position}
              </span>
            )}
            {m.name}
            {m.id === member.id && <span className="text-orange-500">★</span>}
          </div>
        ))}
      </div>

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
                    <th className="sticky left-0 z-20 bg-gray-50 px-1.5 py-2 text-left font-bold text-gray-500 uppercase border-r border-gray-200"
                      style={{ minWidth: 80, width: 80 }}>
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
                  {groupMembers.map(m => {
                    const isSelf = m.id === member.id;
                    return (
                      <tr key={m.id} className={`hover:bg-gray-50/50 transition-colors ${isSelf ? 'bg-orange-50/20' : ''}`}>
                        <MemberCell m={m} mDays={mDays} />
                        {mDays.map((day: Date) => {
                          const dateStr = format(day, 'yyyy-MM-dd');
                          const code = getShift(m, dateStr);
                          return (
                            <td key={dateStr} className={`p-0.5 border-r border-gray-100 text-center ${isToday(day) ? 'bg-orange-50/20' : ''}`}>
                              <div
                                className="w-full h-6 flex items-center justify-center rounded text-[9px] font-bold"
                                style={isSelf ? getSelfShiftStyle(code) : getOtherShiftStyle(code)}
                              >
                                {code === 'XO' ? 'X' : code}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  {groupMembers.length === 0 && (
                    <tr>
                      <td colSpan={mDays.length + 1} className="py-8 text-center text-sm text-gray-400 italic">
                        ไม่พบสมาชิกในกลุ่ม
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
