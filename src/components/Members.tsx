import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, doc, updateDoc, setDoc, getDoc, deleteDoc, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { Member, ShiftPatternTemplate, Shift } from '../types';
import { UserPlus, Edit2, Shield, User, Download, RefreshCw, Trash2, AlertTriangle, Repeat2, X as XIcon, CalendarDays } from 'lucide-react';
import { toast } from 'sonner';
import { format, differenceInDays, parseISO } from 'date-fns';
import { th } from 'date-fns/locale';
import { useShiftProperties } from '../hooks/useShiftProperties';

interface GasMember {
  empId: string;
  name: string;
  position: string;
  department: string;
  status: string;
  phone: string;
  email?: string;
}

export default function Members() {
  const { getShiftStyle } = useShiftProperties();
  const [members, setMembers] = useState<Member[]>([]);
  const [templates, setTemplates] = useState<ShiftPatternTemplate[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);

  const [patternInput, setPatternInput] = useState('');
  const [selectedPos, setSelectedPos] = useState<number | null>(null);
  const [cycleStartDate, setCycleStartDate] = useState('');

  // Switch pattern modal
  const [switchMember, setSwitchMember] = useState<Member | null>(null);
  const [switchTemplate, setSwitchTemplate] = useState<ShiftPatternTemplate | null>(null);
  const [switchPos, setSwitchPos] = useState<number | null>(null);
  const [switchCycleStart, setSwitchCycleStart] = useState('');
  const [switching, setSwitching] = useState(false);

  // Quota management
  const [viewMode, setViewMode] = useState<'members' | 'quota'>('members');
  const [yearShifts, setYearShifts] = useState<Shift[]>([]);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [editingQuota, setEditingQuota] = useState<Member | null>(null);
  const [quotaValues, setQuotaValues] = useState({ quotaA: 0, quotaH: 0 });

  // Import from GAS
  const [showImportModal, setShowImportModal] = useState(false);
  const [gasUrl, setGasUrl] = useState('');
  const [gasMembers, setGasMembers] = useState<GasMember[]>([]);
  const [selectedEmpIds, setSelectedEmpIds] = useState<Set<string>>(new Set());
  const [fetchLoading, setFetchLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);

  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const patternArray = patternInput.split(',').map(s => s.trim()).filter(Boolean);

  useEffect(() => {
    const unsubMembers = onSnapshot(collection(db, 'members'), (snap) => {
      setMembers(snap.docs.map(d => ({ id: d.id, ...d.data() } as Member)));
    });
    const unsubTemplates = onSnapshot(collection(db, 'shiftPatterns'), (snap) => {
      setTemplates(snap.docs.map(d => ({ id: d.id, ...d.data() } as ShiftPatternTemplate)));
    });
    getDoc(doc(db, 'settings', 'system')).then(snap => {
      if (snap.exists() && snap.data().gasUrl) setGasUrl(snap.data().gasUrl);
    });
    return () => { unsubMembers(); unsubTemplates(); };
  }, []);

  const currentYear = today.getFullYear();
  const todayStr = format(today, 'yyyy-MM-dd');
  // H: calendar year Jan 1–Dec 31
  const hStart = `${currentYear}-01-01`;
  const hEnd   = `${currentYear}-12-31`;
  // A: fiscal year Apr 1–Mar 31 next year
  const fiscalBase = today.getMonth() >= 3 ? currentYear : currentYear - 1;
  const aStart = `${fiscalBase}-04-01`;
  const aEnd   = `${fiscalBase + 1}-03-31`;
  // Fetch from earliest of hStart / aStart
  const fetchFrom = aStart < hStart ? aStart : hStart;

  useEffect(() => {
    if (viewMode !== 'quota') return;
    setQuotaLoading(true);
    const q = query(
      collection(db, 'shifts'),
      where('date', '>=', fetchFrom),
      where('date', '<=', todayStr)
    );
    const unsub = onSnapshot(q, snap => {
      setYearShifts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Shift)));
      setQuotaLoading(false);
    });
    return () => unsub();
  }, [viewMode]);

  const usageMap = useMemo(() => {
    const map = new Map<string, { A: number; H: number }>();
    for (const s of yearShifts) {
      if (s.shiftCode === 'A' && s.date >= aStart && s.date <= aEnd)  {
        const curr = map.get(s.memberId) || { A: 0, H: 0 };
        curr.A++;
        map.set(s.memberId, curr);
      } else if (s.shiftCode === 'H' && s.date >= hStart && s.date <= hEnd) {
        const curr = map.get(s.memberId) || { A: 0, H: 0 };
        curr.H++;
        map.set(s.memberId, curr);
      }
    }
    return map;
  }, [yearShifts]);

  const handleSaveQuota = async () => {
    if (!editingQuota) return;
    try {
      await updateDoc(doc(db, 'members', editingQuota.id), {
        quotaA: quotaValues.quotaA,
        quotaH: quotaValues.quotaH,
        initialUsedA: quotaValues.initialUsedA,
        initialUsedH: quotaValues.initialUsedH,
      });
      toast.success('บันทึกโควตาเรียบร้อย');
      setEditingQuota(null);
    } catch { toast.error('เกิดข้อผิดพลาด'); }
  };

  const firstOfMonthStr = format(firstOfMonth, 'yyyy-MM-dd');
  const monthLabel = format(firstOfMonth, 'MMMM yyyy', { locale: th });

  const openModal = (member: Member | null) => {
    setEditingMember(member);
    const pattern = member?.shiftPattern || '';
    setPatternInput(pattern);
    const existingCycleStart = member?.cycleStartDate || firstOfMonthStr;
    setCycleStartDate(existingCycleStart);

    // แสดง position ของ "วันที่ 1 ของเดือน" จาก cycleStartDate ที่มีอยู่
    if (member?.cycleStartDate && pattern) {
      const patternArr = pattern.split(',').map(s => s.trim()).filter(Boolean);
      const diff = differenceInDays(parseISO(firstOfMonthStr), parseISO(member.cycleStartDate));
      const pos = diff >= 0 ? diff % patternArr.length : null;
      setSelectedPos(pos);
    } else {
      setSelectedPos(null);
    }
    setShowModal(true);
  };

  const handleSelectPosition = (index: number) => {
    setSelectedPos(index);
    // cycleStartDate = วันที่ 1 ของเดือน - index วัน
    // → วันที่ 1 จะอยู่ที่ pattern[index] พอดี
    const d = new Date(firstOfMonth);
    d.setDate(d.getDate() - index);
    setCycleStartDate(format(d, 'yyyy-MM-dd'));
  };

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data: any = Object.fromEntries(formData.entries());
    data.quotaA = Number(data.quotaA);
    data.quotaH = Number(data.quotaH);
    data.quotaX = Number(data.quotaX);
    data.shiftPattern = patternInput;
    data.cycleStartDate = cycleStartDate;

    try {
      if (editingMember) {
        await updateDoc(doc(db, 'members', editingMember.id), data);
        toast.success('อัปเดตข้อมูลสำเร็จ');
      } else {
        const docId = data.uid?.trim() || data.empId?.trim();
        if (!docId) { toast.error('กรุณาระบุ UID หรือ รหัสพนักงาน'); return; }
        if (!data.empId?.trim()) { toast.error('กรุณาระบุรหัสพนักงาน (ใช้สำหรับ login PIN)'); return; }
        const pin = data.pin?.trim() || data.empId.slice(-4);
        await setDoc(doc(db, 'members', docId), {
          ...data,
          uid: docId,
          pin,
          role: 'member',
        });
        toast.success('เพิ่มสมาชิกสำเร็จ');
      }
      setShowModal(false);
      setEditingMember(null);
    } catch {
      toast.error('เกิดข้อผิดพลาด');
    }
  };

  const openSwitchModal = (member: Member, template: ShiftPatternTemplate) => {
    setSwitchMember(member);
    setSwitchTemplate(template);
    setSwitchPos(null);
    setSwitchCycleStart(firstOfMonthStr);
  };

  const handleSwitchSelectPos = (idx: number) => {
    setSwitchPos(idx);
    const d = new Date(firstOfMonth);
    d.setDate(d.getDate() - idx);
    setSwitchCycleStart(format(d, 'yyyy-MM-dd'));
  };

  const handleSwitchConfirm = async () => {
    if (!switchMember || !switchTemplate || switchPos === null) {
      toast.error('กรุณาเลือกตำแหน่งของรอบกะก่อน');
      return;
    }
    setSwitching(true);
    try {
      await updateDoc(doc(db, 'members', switchMember.id), {
        shiftPattern: switchTemplate.pattern,
        cycleStartDate: switchCycleStart,
        activePatternId: switchTemplate.id,
      });
      toast.success(`สลับเป็น "${switchTemplate.name}" สำเร็จ`);
      setSwitchMember(null);
      setSwitchTemplate(null);
    } catch {
      toast.error('เกิดข้อผิดพลาด');
    } finally {
      setSwitching(false);
    }
  };

  const fetchFromGas = async () => {
    if (!gasUrl.trim()) { toast.error('กรุณากรอก URL ของ GAS'); return; }
    setFetchLoading(true);
    setGasMembers([]);
    try {
      const sep = gasUrl.includes('?') ? '&' : '?';
      const res = await fetch(gasUrl.trim() + sep + 'action=getAllMembers');
      const json = await res.json();
      if (json.status === 'success') {
        setGasMembers(json.members);
        setSelectedEmpIds(new Set(json.members.map((m: GasMember) => m.empId)));
        if (json.members.length === 0) toast.info('ไม่พบรายชื่อพนักงานใน Sheet');
      } else {
        toast.error('GAS ตอบกลับข้อผิดพลาด: ' + json.message);
      }
    } catch (err: any) {
      toast.error('เชื่อมต่อไม่ได้ — ตรวจสอบ GAS Deploy ว่าตั้ง "Anyone, even anonymous"');
    } finally {
      setFetchLoading(false);
    }
  };

  const toggleSelectEmp = (empId: string) => {
    setSelectedEmpIds(prev => {
      const next = new Set(prev);
      next.has(empId) ? next.delete(empId) : next.add(empId);
      return next;
    });
  };

  const handleImport = async () => {
    if (selectedEmpIds.size === 0) { toast.error('เลือกอย่างน้อย 1 คน'); return; }
    setImportLoading(true);
    const today = format(new Date(), 'yyyy-MM-dd');
    let imported = 0;
    let updated = 0;
    try {
      for (const m of gasMembers) {
        if (!selectedEmpIds.has(m.empId)) continue;
        const cleanPosition = m.position?.replace(/\.$/, '').trim() as Member['position'];
        const existing =
          members.find(ex => ex.uid === m.empId || ex.id === m.empId) ||
          members.find(ex => ex.name.trim().toLowerCase() === m.name.trim().toLowerCase());
        if (existing) {
          await updateDoc(doc(db, 'members', existing.id), {
            name: m.name,
            ...(cleanPosition && { position: cleanPosition }),
            ...(m.department && { station: m.department }),
            ...(m.email && { email: m.email }),
          });
          updated++;
        } else {
          await setDoc(doc(db, 'members', m.empId), {
            uid: m.empId,
            empId: m.empId,
            pin: m.empId.slice(-4),
            name: m.name,
            ...(cleanPosition && { position: cleanPosition }),
            station: m.department || '',
            zone: '',
            quotaA: 0,
            quotaH: 0,
            quotaX: 4,
            shiftPattern: '',
            cycleStartDate: today,
            role: 'member',
            email: m.email || '',
          }, { merge: true });
          imported++;
        }
      }
      toast.success(`นำเข้าสำเร็จ: ${imported} คนใหม่, ${updated} คนอัปเดต`);
      setShowImportModal(false);
      setGasMembers([]);
      setGasUrl('');
    } catch {
      toast.error('เกิดข้อผิดพลาด');
    } finally {
      setImportLoading(false);
    }
  };

  // Duplicate detection
  const [showDupModal, setShowDupModal] = useState(false);
  const [selectedDups, setSelectedDups] = useState<Set<string>>(new Set());

  const duplicateGroups = (() => {
    const byName = new Map<string, Member[]>();
    for (const m of members) {
      const key = m.name.trim().toLowerCase();
      byName.set(key, [...(byName.get(key) || []), m]);
    }
    return [...byName.values()].filter(g => g.length > 1);
  })();

  const openDupModal = () => {
    // Pre-select empId docs (shorter IDs = imported from GAS, not real UID)
    const toDelete = new Set<string>();
    for (const group of duplicateGroups) {
      // Sort: prefer Firebase UID (longer) as keeper, mark shorter empId for deletion
      const sorted = [...group].sort((a, b) => b.id.length - a.id.length);
      sorted.slice(1).forEach(m => toDelete.add(m.id));
    }
    setSelectedDups(toDelete);
    setShowDupModal(true);
  };

  const handleDeleteDups = async () => {
    if (selectedDups.size === 0) return;
    if (!confirm(`ลบ ${selectedDups.size} รายการที่เลือกใช่ไหม?`)) return;
    try {
      await Promise.all([...selectedDups].map(id => deleteDoc(doc(db, 'members', id))));
      toast.success(`ลบสำเร็จ ${selectedDups.size} รายการ`);
      setShowDupModal(false);
    } catch { toast.error('เกิดข้อผิดพลาด'); }
  };

  const toggleDup = (id: string) => {
    setSelectedDups(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleRole = async (member: Member) => {
    try {
      await updateDoc(doc(db, 'members', member.id), {
        role: member.role === 'admin' ? 'member' : 'admin'
      });
      toast.success('เปลี่ยนสิทธิ์สำเร็จ');
    } catch {
      toast.error('เกิดข้อผิดพลาด');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800">จัดการสมาชิก</h2>
        <div className="flex items-center space-x-2">
          {duplicateGroups.length > 0 && (
            <button onClick={openDupModal}
              className="flex items-center space-x-2 bg-red-50 text-red-600 border border-red-200 px-4 py-2 rounded-xl font-bold hover:bg-red-100 transition-colors shadow-sm">
              <AlertTriangle size={16} />
              <span>ข้อมูลซ้ำ ({duplicateGroups.length})</span>
            </button>
          )}
          <button
            onClick={() => { setShowImportModal(true); if (gasUrl && gasMembers.length === 0) setTimeout(fetchFromGas, 50); }}
            className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Download size={18} />
            <span>นำเข้าจาก GAS</span>
          </button>
          <button
            onClick={() => openModal(null)}
            className="flex items-center space-x-2 bg-orange-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-orange-700 transition-colors shadow-sm"
          >
            <UserPlus size={18} />
            <span>เพิ่มสมาชิกใหม่</span>
          </button>
        </div>
      </div>

      {/* View mode tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        <button onClick={() => setViewMode('members')}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'members' ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>
          <User size={12} />รายชื่อ
        </button>
        <button onClick={() => setViewMode('quota')}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'quota' ? 'bg-white shadow text-orange-600' : 'text-gray-500 hover:text-gray-700'}`}>
          <CalendarDays size={12} />โควตาวันหยุด
        </button>
      </div>

      {/* ===== QUOTA VIEW ===== */}
      {viewMode === 'quota' && (() => {
        const knownPositions = ['SS', 'AStS', 'SP'];
        const normalize = (p?: string) => (p || '').replace(/\.$/, '').trim();
        const groups = [
          { pos: 'SS', badge: 'bg-orange-50 text-orange-600 border-orange-200' },
          { pos: 'AStS', badge: 'bg-cyan-50 text-cyan-600 border-cyan-200' },
          { pos: 'SP', badge: 'bg-purple-50 text-purple-600 border-purple-200' },
          { pos: '__other__', badge: 'bg-gray-50 text-gray-500 border-gray-200' },
        ];

        const QuotaBar = ({ used, quota, colorUsed, colorOver }: { used: number; quota: number; colorUsed: string; colorOver: string }) => {
          const pct = quota > 0 ? Math.min(100, (used / quota) * 100) : 0;
          const over = used > quota;
          return (
            <div className="w-full h-1.5 bg-gray-100 rounded-full mt-1">
              <div className={`h-full rounded-full transition-all ${over ? colorOver : colorUsed}`}
                style={{ width: `${pct}%` }} />
            </div>
          );
        };

        return (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <CalendarDays size={12} />
              <span>นับจากกะที่บันทึกจริง ปี {currentYear} (1 ม.ค. — วันนี้)</span>
              {quotaLoading && <span className="text-orange-500">กำลังโหลด...</span>}
            </div>

            {groups.map(({ pos, badge }) => {
              const group = pos === '__other__'
                ? members.filter(m => !knownPositions.includes(normalize(m.position)))
                : members.filter(m => normalize(m.position) === pos);
              if (group.length === 0) return null;
              return (
                <div key={pos} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${badge}`}>{pos === '__other__' ? '—' : pos}</span>
                    <span className="text-xs text-gray-400 ml-auto">{group.length} คน</span>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {group.map(m => {
                      const usage = usageMap.get(m.id) || { A: 0, H: 0 };
                      const overA = usage.A > m.quotaA;
                      const overH = usage.H > m.quotaH;
                      return (
                        <div key={m.id} className="px-4 py-3 flex items-start gap-4">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-gray-800 truncate">{m.name}</p>
                            {m.station && <p className="text-[10px] text-gray-400">{m.station}</p>}
                          </div>

                          {/* A quota */}
                          <div className="w-24 shrink-0">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-red-500 uppercase">A</span>
                              {overA && <span className="text-[9px] font-bold text-red-600 bg-red-50 px-1 rounded">เกิน!</span>}
                            </div>
                            <p className={`text-sm font-black leading-tight ${overA ? 'text-red-600' : 'text-gray-800'}`}>
                              {usage.A}<span className="text-[10px] font-normal text-gray-400">/{m.quotaA}</span>
                            </p>
                            <QuotaBar used={usage.A} quota={m.quotaA} colorUsed="bg-red-400" colorOver="bg-red-600" />
                            <p className="text-[9px] text-gray-400 mt-0.5">เหลือ {Math.max(0, m.quotaA - usage.A)} วัน</p>
                          </div>

                          {/* H quota */}
                          <div className="w-24 shrink-0">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-pink-500 uppercase">H</span>
                              {overH && <span className="text-[9px] font-bold text-pink-600 bg-pink-50 px-1 rounded">เกิน!</span>}
                            </div>
                            <p className={`text-sm font-black leading-tight ${overH ? 'text-pink-600' : 'text-gray-800'}`}>
                              {usage.H}<span className="text-[10px] font-normal text-gray-400">/{m.quotaH}</span>
                            </p>
                            <QuotaBar used={usage.H} quota={m.quotaH} colorUsed="bg-pink-400" colorOver="bg-pink-600" />
                            <p className="text-[9px] text-gray-400 mt-0.5">เหลือ {Math.max(0, m.quotaH - usage.H)} วัน</p>
                          </div>

                          {/* Edit quota button */}
                          <button
                            onClick={() => { setEditingQuota(m); setQuotaValues({ quotaA: m.quotaA, quotaH: m.quotaH }); }}
                            className="p-1.5 text-gray-300 hover:text-orange-500 transition-colors shrink-0 mt-0.5">
                            <Edit2 size={14} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Members grouped by position */}
      {viewMode === 'members' && (() => {
        const knownPositions = ['SS', 'AStS', 'SP'];
        const normalize = (p?: string) => (p || '').replace(/\.$/, '').trim();
        const groups = [
          { pos: 'SS', label: 'นายสถานี (SS)', badge: 'bg-orange-50 text-orange-600 border-orange-200' },
          { pos: 'AStS', label: 'ผู้ช่วยนายสถานี (AStS)', badge: 'bg-cyan-50 text-cyan-600 border-cyan-200' },
          { pos: 'SP', label: 'เจ้าหน้าที่สถานี (SP)', badge: 'bg-purple-50 text-purple-600 border-purple-200' },
          { pos: '__other__', label: 'ไม่ระบุตำแหน่ง', badge: 'bg-gray-50 text-gray-500 border-gray-200' },
        ];
        return groups.map(({ pos, label, badge }) => {
        const group = pos === '__other__'
          ? members.filter(m => !knownPositions.includes(normalize(m.position)))
          : members.filter(m => normalize(m.position) === pos);
        if (group.length === 0) return null;
        return (
          <div key={pos || 'none'} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center space-x-2">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${badge}`}>{pos || '—'}</span>
              <span className="text-xs font-bold text-gray-600">{label}</span>
              <span className="ml-auto text-[10px] text-gray-400">{group.length} คน</span>
            </div>
            <table className="w-full text-left">
              <thead className="bg-white border-b border-gray-100">
                <tr>
                  <th className="px-5 py-3 text-[10px] font-bold text-gray-400 uppercase">ชื่อ-นามสกุล</th>
                  <th className="px-5 py-3 text-[10px] font-bold text-gray-400 uppercase">สถานี / โซน</th>
                  <th className="px-5 py-3 text-[10px] font-bold text-gray-400 uppercase">สิทธิ์</th>
                  <th className="px-5 py-3 text-[10px] font-bold text-gray-400 uppercase text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {group.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-800 text-sm">{m.name}</p>
                      {m.empId && (
                        <p className="text-[10px] text-orange-500 font-mono">รหัส: {m.empId}</p>
                      )}
                      <p className="text-[10px] text-gray-400 font-mono">{m.uid}</p>
                    </td>
                    <td className="px-5 py-3">
                      <p className="text-sm text-gray-700">{m.station}</p>
                      <p className="text-[10px] text-gray-400">{m.zone}</p>
                    </td>
                    <td className="px-5 py-3">
                      <button
                        onClick={() => toggleRole(m)}
                        className={`flex items-center space-x-1 px-2 py-1 rounded-full text-[10px] font-bold uppercase border ${
                          m.role === 'admin' ? 'bg-orange-50 text-orange-600 border-orange-200' : 'bg-gray-50 text-gray-500 border-gray-200'
                        }`}
                      >
                        {m.role === 'admin' ? <Shield size={12} /> : <User size={12} />}
                        <span>{m.role}</span>
                      </button>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => openModal(m)} className="p-2 text-gray-400 hover:text-orange-600 transition-colors">
                        <Edit2 size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      });
      })()}

      {/* Quota Edit Modal */}
      {editingQuota && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white w-full max-w-xs rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-bold text-gray-800">แก้ไขโควตาวันหยุด</h3>
                <p className="text-xs text-gray-500">{editingQuota.name}</p>
              </div>
              <button onClick={() => setEditingQuota(null)} className="text-gray-400 hover:text-gray-600"><XIcon size={18} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-red-500 uppercase mb-1">A — ลาพักร้อน (วัน/ปี)</label>
                <input type="number" min={0} max={365}
                  value={quotaValues.quotaA}
                  onChange={e => setQuotaValues(v => ({ ...v, quotaA: Number(e.target.value) }))}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-lg font-bold text-center outline-none focus:ring-2 focus:ring-red-400" />
              </div>
              <div>
                <label className="block text-xs font-bold text-pink-500 uppercase mb-1">H — หยุดนักขัตฤกษ์ (วัน/ปี)</label>
                <input type="number" min={0} max={365}
                  value={quotaValues.quotaH}
                  onChange={e => setQuotaValues(v => ({ ...v, quotaH: Number(e.target.value) }))}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-lg font-bold text-center outline-none focus:ring-2 focus:ring-pink-400" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setEditingQuota(null)}
                className="flex-1 py-2.5 text-sm text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-xl font-medium transition-colors">
                ยกเลิก
              </button>
              <button onClick={handleSaveQuota}
                className="flex-1 py-2.5 text-sm text-white bg-orange-600 hover:bg-orange-700 rounded-xl font-bold transition-colors">
                บันทึก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import from GAS Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white w-full max-w-2xl rounded-2xl p-6 shadow-2xl my-4">
            <h3 className="text-xl font-bold mb-1">นำเข้าสมาชิกจาก GAS</h3>
            <p className="text-xs text-gray-400 mb-4">ดึงรายชื่อจาก Employee Sheet แล้วบันทึกลง Firestore</p>

            {/* URL Input */}
            <div className="flex space-x-2 mb-4">
              <input
                type="url"
                value={gasUrl}
                onChange={(e) => setGasUrl(e.target.value)}
                placeholder="https://script.google.com/macros/s/xxx/exec"
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
              <button
                onClick={fetchFromGas}
                disabled={fetchLoading}
                className="flex items-center space-x-1 px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                <RefreshCw size={14} className={fetchLoading ? 'animate-spin' : ''} />
                <span>{fetchLoading ? 'กำลังดึง...' : 'ดึงข้อมูล'}</span>
              </button>
            </div>

            {/* Member List */}
            {gasMembers.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-bold text-gray-700">พบ {gasMembers.length} คน — เลือก {selectedEmpIds.size} คน</p>
                  <button
                    onClick={() => setSelectedEmpIds(
                      selectedEmpIds.size === gasMembers.length
                        ? new Set()
                        : new Set(gasMembers.map(m => m.empId))
                    )}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    {selectedEmpIds.size === gasMembers.length ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด'}
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto border border-gray-100 rounded-xl divide-y divide-gray-50 mb-4">
                  {gasMembers.map((m) => {
                    const exists = members.some(ex => ex.uid === m.empId || ex.id === m.empId);
                    return (
                      <label key={m.empId} className="flex items-center px-4 py-3 hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedEmpIds.has(m.empId)}
                          onChange={() => toggleSelectEmp(m.empId)}
                          className="mr-3 accent-blue-600"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800">{m.name}</p>
                          <p className="text-xs text-gray-400">{m.empId} · {m.department}</p>
                        </div>
                        <div className="flex items-center space-x-2 ml-2 shrink-0">
                          {m.position && (
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                              m.position === 'SS' ? 'bg-orange-50 text-orange-600 border-orange-200' :
                              m.position === 'AStS' ? 'bg-cyan-50 text-cyan-600 border-cyan-200' :
                              'bg-purple-50 text-purple-600 border-purple-200'
                            }`}>{m.position}</span>
                          )}
                          {exists && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-50 text-green-600 border border-green-200">มีแล้ว</span>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
                <p className="text-[10px] text-gray-400 mb-4">
                  สมาชิกที่ "มีแล้ว" จะอัปเดตเฉพาะชื่อ/ตำแหน่ง/สถานี · quotaA/H/X และรูปแบบกะจะไม่ถูกเขียนทับ
                </p>
              </>
            )}

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => { setShowImportModal(false); setGasMembers([]); setGasUrl(''); }}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                ยกเลิก
              </button>
              {gasMembers.length > 0 && (
                <button
                  onClick={handleImport}
                  disabled={importLoading || selectedEmpIds.size === 0}
                  className="px-6 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {importLoading ? 'กำลังนำเข้า...' : `นำเข้า ${selectedEmpIds.size} คน`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl my-4">
            <div className="sticky top-0 bg-white rounded-t-2xl px-6 pt-6 pb-4 border-b border-gray-100 z-10">
              <h3 className="text-xl font-bold">{editingMember ? 'แก้ไขสมาชิก' : 'เพิ่มสมาชิก'}</h3>
              {editingMember && (
                <div className={`mt-1 flex items-center gap-2 text-[10px] font-mono px-2 py-1 rounded-lg w-fit ${
                  editingMember.id === editingMember.uid
                    ? 'bg-green-50 text-green-600'
                    : 'bg-red-50 text-red-600'
                }`}>
                  <span>Doc ID: {editingMember.id}</span>
                  {editingMember.id !== editingMember.uid && (
                    <span className="font-bold not-italic">⚠ ไม่ใช่ Firebase UID — ควรลบ doc นี้แล้วแก้ doc UID แทน</span>
                  )}
                </div>
              )}
            </div>
            <div className="px-6 pb-6">
            <h3 className="text-xl font-bold mb-4">{editingMember ? 'แก้ไขสมาชิก' : 'เพิ่มสมาชิก'}</h3>
            <form onSubmit={handleSave} className="space-y-4">

              {!editingMember && (
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                    รหัสผู้ใช้ (UID) <span className="normal-case font-normal text-gray-400">— ไม่บังคับ</span>
                  </label>
                  <input name="uid" placeholder="กรอกเฉพาะสมาชิกที่ login ด้วย Google"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-500 font-mono" />
                  <p className="text-[10px] text-gray-400 mt-1">ถ้าเว้นว่าง จะใช้รหัสพนักงาน (EmpID) แทน — login ด้วย PIN ได้เลย</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">รหัสพนักงาน (EmpID)</label>
                  <input name="empId" defaultValue={editingMember?.empId || ''}
                    placeholder="เช่น 600001"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-500 font-mono" />
                  <p className="text-[10px] text-gray-400 mt-1">ใช้สำหรับ login ด้วย PIN</p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">PIN</label>
                  <input name="pin" defaultValue={editingMember?.pin || ''}
                    placeholder="ค่าเริ่มต้น = 4 ตัวท้าย EmpID" maxLength={8}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-500 font-mono" />
                  <p className="text-[10px] text-gray-400 mt-1">เว้นว่างไว้ = ใช้ค่าเริ่มต้น</p>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">ชื่อ-นามสกุล</label>
                  <input name="name" defaultValue={editingMember?.name} required
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-500" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">สถานี</label>
                  <input name="station" defaultValue={editingMember?.station} required
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-500" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">โซน</label>
                  <input name="zone" defaultValue={editingMember?.zone} required
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-500" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">ตำแหน่ง (GAS)</label>
                  <select name="position" defaultValue={(editingMember?.position || '').replace(/\.$/, '').trim()}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-500">
                    <option value="">— ไม่ระบุ —</option>
                    <option value="SS">SS — นายสถานี</option>
                    <option value="AStS">AStS — ผู้ช่วยนายสถานี</option>
                    <option value="SP">SP — เจ้าหน้าที่สถานี</option>
                  </select>
                  <p className="text-[10px] text-gray-400 mt-1">ต้องตรงกับคอลัมน์ตำแหน่งใน Employee Sheet</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">โควตา A</label>
                  <input type="number" name="quotaA" defaultValue={editingMember?.quotaA ?? 0} required
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-500" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">โควตา H</label>
                  <input type="number" name="quotaH" defaultValue={editingMember?.quotaH ?? 0} required
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-500" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">โควตา X</label>
                  <input type="number" name="quotaX" defaultValue={editingMember?.quotaX ?? 4} required
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-500" />
                </div>
              </div>

              {/* Pattern Input */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-gray-500 uppercase">รูปแบบกะ (Pattern)</label>

                {/* Template quick-select */}
                {templates.length > 0 && (
                  <div>
                    <p className="text-[10px] text-gray-400 mb-1">เลือกจาก Pattern ที่มีอยู่</p>
                    <div className="flex flex-wrap gap-1.5">
                      {templates.map(t => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => { setPatternInput(t.pattern); setSelectedPos(null); }}
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all
                            ${patternInput === t.pattern
                              ? 'bg-orange-600 text-white border-orange-600'
                              : 'bg-white text-gray-600 border-gray-200 hover:border-orange-400'}`}
                        >
                          {t.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <textarea
                  value={patternInput}
                  onChange={(e) => { setPatternInput(e.target.value); setSelectedPos(null); }}
                  rows={2}
                  placeholder="หรือพิมพ์เองคั่นด้วยจุลภาค เช่น S11,S11,S11,X,X,S13,S13,S13,X,X"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-500 font-mono"
                />
              </div>

              {/* Pattern Visualizer */}
              {patternArray.length > 0 && (
                <div className="bg-orange-50 rounded-xl p-4 border border-orange-100">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-bold text-orange-700 uppercase">
                      เลือกกะที่ตรงกับ<span className="text-orange-600"> วันที่ 1 {monthLabel}</span>
                    </p>
                    {selectedPos !== null && (
                      <span className="text-[10px] bg-orange-200 text-orange-800 px-2 py-0.5 rounded-full font-bold">
                        position {selectedPos + 1} ({patternArray[selectedPos]})
                      </span>
                    )}
                  </div>

                  {/* Usage Guide */}
                  <div className="bg-white rounded-lg px-3 py-2 border border-orange-100 mb-3 space-y-1">
                    <p className="text-[11px] font-bold text-gray-600">วิธีใช้</p>
                    <p className="text-[10px] text-gray-500">
                      1. ดูว่าสมาชิกทำกะ<span className="font-bold text-gray-700">อะไรในวันที่ 1 {monthLabel}</span> เช่น S12
                    </p>
                    <p className="text-[10px] text-gray-500">
                      2. นับว่าวันที่ 1 นั้นเป็น<span className="font-bold text-gray-700">วันที่เท่าไหร่ของกะ S12 ในรอบ</span> เช่น S12 วันที่ 5
                    </p>
                    <p className="text-[10px] text-gray-500">
                      3. กดที่ช่อง S12 <span className="font-bold text-gray-700">ตำแหน่งที่ 5</span> → ระบบจะแสดง S12 ต่ออีก 2 วัน (วันที่ 1–2) แล้วขึ้น XX
                    </p>
                    <p className="text-[10px] text-orange-500 font-medium pt-0.5">
                      → ระบบจะคำนวณ cycleStartDate ให้อัตโนมัติ
                    </p>
                  </div>

                  <p className="text-[10px] text-orange-500 mb-3">กดที่ช่องกะที่สมาชิกทำงานในวันที่ 1 {monthLabel}</p>
                  <div className="flex flex-wrap gap-1">
                    {patternArray.map((code, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleSelectPosition(idx)}
                        className={`flex flex-col items-center justify-center w-10 h-12 rounded-lg border text-[10px] font-bold transition-all
                          ${selectedPos === idx
                            ? 'ring-2 ring-orange-500 ring-offset-1 scale-110 shadow-md'
                            : 'hover:scale-105 hover:shadow-sm'}`}
                        style={getShiftStyle(code)}
                      >
                        <span className="text-[8px] opacity-50 font-normal">{idx + 1}</span>
                        <span>{code}</span>
                      </button>
                    ))}
                  </div>

                  {selectedPos !== null ? (
                    <div className="mt-3 flex items-center space-x-2 bg-white rounded-lg px-3 py-2 border border-orange-200">
                      <div className="px-2 py-0.5 rounded text-xs font-bold border" style={getShiftStyle(patternArray[selectedPos])}>
                        {patternArray[selectedPos]}
                      </div>
                      <span className="text-xs text-gray-600">
                        วันที่ 1 {monthLabel} = ตำแหน่งที่ {selectedPos + 1} ของรอบ
                      </span>
                      <span className="text-[10px] text-gray-400 ml-auto">
                        cycleStart: {cycleStartDate}
                      </span>
                    </div>
                  ) : (
                    <p className="mt-3 text-[10px] text-orange-400 italic">ยังไม่ได้เลือกตำแหน่ง</p>
                  )}
                </div>
              )}

              {/* Assigned Patterns */}
              {editingMember && (editingMember.assignedPatternIds || []).length > 0 && (
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                  <p className="text-xs font-bold text-gray-500 uppercase mb-3">Patterns ที่ Assign ไว้</p>
                  <div className="space-y-2">
                    {(editingMember.assignedPatternIds || []).map(tId => {
                      const t = templates.find(tp => tp.id === tId);
                      if (!t) return null;
                      const isActive = tId === editingMember.activePatternId;
                      const codes = t.pattern.split(',').map(s => s.trim()).filter(Boolean);
                      return (
                        <div key={tId} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${isActive ? 'bg-orange-50 border-orange-200' : 'bg-white border-gray-200'}`}>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800">{t.name}</p>
                            <div className="flex flex-wrap gap-0.5 mt-1">
                              {codes.slice(0, 24).map((code, i) => (
                                <span key={i} className="px-1 py-0.5 rounded text-[9px] font-bold border" style={getShiftStyle(code)}>{code}</span>
                              ))}
                              {codes.length > 24 && <span className="text-[9px] text-gray-400 self-center">+{codes.length - 24}</span>}
                            </div>
                          </div>
                          {isActive ? (
                            <span className="shrink-0 text-[10px] font-bold text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full">ใช้งานอยู่</span>
                          ) : (
                            <button type="button" onClick={() => openSwitchModal(editingMember, t)}
                              className="shrink-0 flex items-center gap-1 text-[11px] font-bold text-blue-600 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-lg hover:bg-blue-100 transition-colors">
                              <Repeat2 size={12} />สลับ
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex justify-end space-x-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg">
                  ยกเลิก
                </button>
                <button type="submit"
                  className="px-6 py-2 bg-orange-600 text-white text-sm font-bold rounded-lg hover:bg-orange-700">
                  บันทึก
                </button>
              </div>
            </form>
            </div>{/* end scrollable content */}
          </div>
        </div>
      )}

      {/* Switch Pattern Modal */}
      {switchMember && switchTemplate && (() => {
        const codes = switchTemplate.pattern.split(',').map((s: string) => s.trim()).filter(Boolean);
        return (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[60]">
            <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl">
              <div className="px-6 pt-6 pb-4 border-b border-gray-100 flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <Repeat2 size={18} className="text-blue-600" />สลับ Shift Pattern
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">{switchMember.name} → {switchTemplate.name}</p>
                </div>
                <button onClick={() => { setSwitchMember(null); setSwitchTemplate(null); }} className="text-gray-400 hover:text-gray-600 mt-0.5">
                  <XIcon size={20} />
                </button>
              </div>

              <div className="px-6 py-5 space-y-4">
                {/* Pattern preview */}
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase mb-2">{codes.length} วัน/รอบ</p>
                  <div className="flex flex-wrap gap-1">
                    {codes.map((code: string, i: number) => (
                      <span key={i} className="px-1.5 py-0.5 rounded text-[10px] font-bold border" style={getShiftStyle(code)}>{code}</span>
                    ))}
                  </div>
                </div>

                {/* Cycle picker */}
                <div className="bg-orange-50 rounded-xl p-4 border border-orange-100">
                  <p className="text-xs font-bold text-orange-700 mb-1">
                    เลือกกะที่ตรงกับ <span className="text-orange-600">วันที่ 1 {monthLabel}</span>
                  </p>
                  <p className="text-[10px] text-orange-500 mb-3">กดที่ช่องกะที่ทำงานในวันที่ 1 {monthLabel}</p>
                  <div className="flex flex-wrap gap-1">
                    {codes.map((code: string, idx: number) => (
                      <button key={idx} type="button" onClick={() => handleSwitchSelectPos(idx)}
                        className={`flex flex-col items-center justify-center w-10 h-12 rounded-lg border text-[10px] font-bold transition-all
                          ${switchPos === idx ? 'ring-2 ring-orange-500 ring-offset-1 scale-110 shadow-md' : 'hover:scale-105 hover:shadow-sm'}`}
                        style={getShiftStyle(code)}>
                        <span className="text-[8px] opacity-50 font-normal">{idx + 1}</span>
                        <span>{code}</span>
                      </button>
                    ))}
                  </div>
                  {switchPos !== null ? (
                    <div className="mt-3 flex items-center space-x-2 bg-white rounded-lg px-3 py-2 border border-orange-200">
                      <div className="px-2 py-0.5 rounded text-xs font-bold border" style={getShiftStyle(codes[switchPos])}>{codes[switchPos]}</div>
                      <span className="text-xs text-gray-600">วันที่ 1 {monthLabel} = ตำแหน่งที่ {switchPos + 1} ของรอบ</span>
                      <span className="text-[10px] text-gray-400 ml-auto">cycleStart: {switchCycleStart}</span>
                    </div>
                  ) : (
                    <p className="mt-3 text-[10px] text-orange-400 italic">ยังไม่ได้เลือกตำแหน่ง</p>
                  )}
                </div>
              </div>

              <div className="px-6 pb-6 flex space-x-2">
                <button onClick={() => { setSwitchMember(null); setSwitchTemplate(null); }}
                  className="flex-1 py-2 text-sm text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium">
                  ยกเลิก
                </button>
                <button onClick={handleSwitchConfirm} disabled={switching || switchPos === null}
                  className="flex-1 py-2 text-sm text-white font-bold bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 flex items-center justify-center gap-2">
                  <Repeat2 size={14} />
                  {switching ? 'กำลังสลับ...' : 'ยืนยันสลับ Pattern'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Duplicate Members Modal */}
      {showDupModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl">
            <div className="px-6 pt-6 pb-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <AlertTriangle size={18} className="text-red-500" />
                <h3 className="text-lg font-bold">พบข้อมูลซ้ำ</h3>
              </div>
              <p className="text-xs text-gray-400 mt-1">เลือกรายการที่ต้องการลบ ระบบจะเก็บไว้เฉพาะที่ไม่ถูกเลือก</p>
            </div>
            <div className="px-6 py-4 max-h-96 overflow-y-auto space-y-4">
              {duplicateGroups.map(group => (
                <div key={group[0].name} className="border border-gray-200 rounded-xl overflow-hidden">
                  <div className="bg-gray-50 px-4 py-2 text-xs font-bold text-gray-600">{group[0].name}</div>
                  {group.map(m => (
                    <button key={m.id} onClick={() => toggleDup(m.id)}
                      className={`w-full flex items-center justify-between px-4 py-2.5 text-sm border-t border-gray-100 transition-colors ${
                        selectedDups.has(m.id) ? 'bg-red-50 text-red-700' : 'hover:bg-gray-50 text-gray-700'
                      }`}>
                      <div className="text-left">
                        <p className="font-mono text-[11px] text-gray-400">{m.id}</p>
                        <p className="text-xs">{m.station} · {m.position || '—'} · {m.role}</p>
                      </div>
                      {selectedDups.has(m.id)
                        ? <span className="text-[10px] font-bold text-red-500 bg-red-100 px-2 py-0.5 rounded-full">ลบ</span>
                        : <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">เก็บ</span>
                      }
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex space-x-2">
              <button onClick={() => setShowDupModal(false)}
                className="flex-1 py-2 text-sm text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium">
                ยกเลิก
              </button>
              <button onClick={handleDeleteDups} disabled={selectedDups.size === 0}
                className="flex-1 py-2 text-sm text-white font-bold bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-40 flex items-center justify-center gap-2">
                <Trash2 size={14} />
                ลบ {selectedDups.size} รายการ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
