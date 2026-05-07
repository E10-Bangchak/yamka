import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, doc, writeBatch, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '../firebase';
import { Member, SwapRequest } from '../types';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { Check, X, ArrowRightLeft, Repeat, RotateCcw, History } from 'lucide-react';
import { toast } from 'sonner';
import emailjs from '@emailjs/browser';
import { useShiftProperties } from '../hooks/useShiftProperties';

const EMAILJS_SERVICE_ID = 'service_yamka';
const EMAILJS_TEMPLATE_ID = 'template_nfo6sld';
const EMAILJS_PUBLIC_KEY = 'YY8IVNkVN-qhgglkU';
const ADMIN_EMAIL = 'ApichaiC.583986@outlook.co.th';

interface RequestsProps {
  member: Member;
}


export default function Requests({ member }: RequestsProps) {
  const { getShiftStyle } = useShiftProperties();
  const [incoming, setIncoming] = useState<SwapRequest[]>([]);
  const [outgoing, setOutgoing] = useState<SwapRequest[]>([]);
  const [history, setHistory] = useState<SwapRequest[]>([]);

  useEffect(() => {
    const mkQ = (field: 'requesterId' | 'targetId', status: string) =>
      query(collection(db, 'swapRequests'), where(field, '==', member.id), where('status', '==', status));

    const onErr = (label: string) => (err: Error) =>
      console.error(`[Requests:${label}]`, err.message);

    const unsub1 = onSnapshot(
      mkQ('targetId', 'pending'),
      snap => setIncoming(snap.docs.map(d => ({ id: d.id, ...d.data() } as SwapRequest))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
      onErr('incoming')
    );
    const unsub2 = onSnapshot(
      mkQ('requesterId', 'pending'),
      snap => setOutgoing(snap.docs.map(d => ({ id: d.id, ...d.data() } as SwapRequest))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
      onErr('outgoing')
    );

    let buckets: Record<string, SwapRequest[]> = {
      approvedReq: [], approvedTgt: [],
      reversedReq: [], reversedTgt: [],
      rejectedReq: [], cancelledReq: [],
    };
    const mergeHistory = () => {
      const all = Object.values(buckets).flat();
      const unique = Array.from(new Map(all.map(r => [r.id, r])).values());
      setHistory(unique.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 60));
    };
    const listen = (key: string, field: 'requesterId' | 'targetId', status: string) =>
      onSnapshot(
        mkQ(field, status),
        snap => { buckets[key] = snap.docs.map(d => ({ id: d.id, ...d.data() } as SwapRequest)); mergeHistory(); },
        onErr(key)
      );

    const unsub3 = listen('approvedReq', 'requesterId', 'approved');
    const unsub4 = listen('approvedTgt', 'targetId', 'approved');
    const unsub5 = listen('reversedReq', 'requesterId', 'reversed');
    const unsub6 = listen('reversedTgt', 'targetId', 'reversed');
    const unsub7 = listen('rejectedReq', 'requesterId', 'rejected');
    const unsub8 = listen('cancelledReq', 'requesterId', 'cancelled');

    return () => { unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); unsub6(); unsub7(); unsub8(); };
  }, [member.id]);

  const handleAction = async (req: SwapRequest, action: 'approved' | 'rejected') => {
    try {
      const batch = writeBatch(db);
      const isReverse = !!(req as any).isReverseOf;
      const finalStatus = (action === 'approved' && isReverse) ? 'reversed' : action;
      batch.update(doc(db, 'swapRequests', req.id), { status: finalStatus });

      if (action === 'approved') {
        if (isReverse) {
          // Restore original shifts for both parties
          if (req.type === 'swap') {
            batch.set(doc(db, 'shifts', `${req.requesterId}_${req.requesterDate}`), {
              memberId: req.requesterId, date: req.requesterDate,
              shiftCode: req.targetShift, // requester's original = target's current
              originalShiftCode: deleteField(), manualMark: deleteField(),
              updatedAt: new Date().toISOString(),
            } as any, { merge: true });
            if (req.targetId && req.targetDate) {
              batch.set(doc(db, 'shifts', `${req.targetId}_${req.targetDate}`), {
                memberId: req.targetId, date: req.targetDate,
                shiftCode: req.requesterShift, // target's original = requester's current
                originalShiftCode: deleteField(), manualMark: deleteField(),
                updatedAt: new Date().toISOString(),
              } as any, { merge: true });
            }
          } else { // cover / cover_holiday
            const origShift = (req as any).originalRequesterShift || req.requesterShift;
            batch.set(doc(db, 'shifts', `${req.requesterId}_${req.requesterDate}`), {
              memberId: req.requesterId, date: req.requesterDate,
              shiftCode: origShift,
              originalShiftCode: deleteField(), manualMark: deleteField(),
              updatedAt: new Date().toISOString(),
            } as any, { merge: true });
            if (req.targetId && req.targetDate) {
              batch.delete(doc(db, 'shifts', `${req.targetId}_${req.targetDate}`));
            }
          }
          // Delete returnDate shift docs created during original swap approval
          if (req.returnDate && req.targetId) {
            batch.delete(doc(db, 'shifts', `${req.requesterId}_${req.returnDate}`));
            batch.delete(doc(db, 'shifts', `${req.targetId}_${req.returnDate}`));
          }
          // Mark original swap as reversed
          batch.update(doc(db, 'swapRequests', (req as any).isReverseOf), { status: 'reversed' });
        } else {
          // Normal approval: apply shift changes
          if (req.type === 'swap' && req.targetId && req.targetDate) {
            batch.set(doc(db, 'shifts', `${req.requesterId}_${req.requesterDate}`), {
              memberId: req.requesterId, date: req.requesterDate,
              shiftCode: req.targetShift,
              originalShiftCode: req.requesterShift,
              manualMark: deleteField(),
              updatedAt: new Date().toISOString(),
            } as any, { merge: true });
            batch.set(doc(db, 'shifts', `${req.targetId}_${req.targetDate}`), {
              memberId: req.targetId, date: req.targetDate,
              shiftCode: req.requesterShift,
              originalShiftCode: req.targetShift,
              manualMark: deleteField(),
              updatedAt: new Date().toISOString(),
            } as any, { merge: true });
            if (req.returnDate && req.targetId) {
              batch.set(doc(db, 'shifts', `${req.requesterId}_${req.returnDate}`), {
                memberId: req.requesterId, date: req.returnDate,
                shiftCode: req.returnTargetShift || req.requesterShift,
                manualMark: deleteField(),
                updatedAt: new Date().toISOString(),
              } as any, { merge: true });
              batch.set(doc(db, 'shifts', `${req.targetId}_${req.returnDate}`), {
                memberId: req.targetId, date: req.returnDate,
                shiftCode: req.returnShift || 'X',
                manualMark: deleteField(),
                updatedAt: new Date().toISOString(),
              } as any, { merge: true });
            }
          } else if (req.type === 'cover' || req.type === 'cover_holiday') {
            batch.set(doc(db, 'shifts', `${req.requesterId}_${req.requesterDate}`), {
              memberId: req.requesterId, date: req.requesterDate,
              shiftCode: 'X', originalShiftCode: req.requesterShift,
              manualMark: deleteField(),
              updatedAt: new Date().toISOString(),
            } as any, { merge: true });
            if (req.targetId && req.targetDate) {
              batch.set(doc(db, 'shifts', `${req.targetId}_${req.targetDate}`), {
                memberId: req.targetId, date: req.targetDate,
                shiftCode: req.targetShift, isDoubleShift: true,
                manualMark: deleteField(),
                updatedAt: new Date().toISOString(),
              } as any, { merge: true });
            }
            if (req.returnDate && req.targetId) {
              if (req.type === 'cover') {
                batch.set(doc(db, 'shifts', `${req.requesterId}_${req.returnDate}`), {
                  memberId: req.requesterId, date: req.returnDate,
                  shiftCode: req.returnShift, isDoubleShift: true,
                  manualMark: deleteField(),
                  updatedAt: new Date().toISOString(),
                } as any, { merge: true });
                batch.set(doc(db, 'shifts', `${req.targetId}_${req.returnDate}`), {
                  memberId: req.targetId, date: req.returnDate,
                  shiftCode: 'X', originalShiftCode: req.returnTargetShift,
                  manualMark: deleteField(),
                  updatedAt: new Date().toISOString(),
                } as any, { merge: true });
              } else {
                batch.set(doc(db, 'shifts', `${req.requesterId}_${req.returnDate}`), {
                  memberId: req.requesterId, date: req.returnDate,
                  shiftCode: req.returnTargetShift || req.requesterShift,
                  manualMark: deleteField(),
                  updatedAt: new Date().toISOString(),
                } as any, { merge: true });
                batch.set(doc(db, 'shifts', `${req.targetId}_${req.returnDate}`), {
                  memberId: req.targetId, date: req.returnDate,
                  shiftCode: req.returnShift || 'X',
                  manualMark: deleteField(),
                  updatedAt: new Date().toISOString(),
                } as any, { merge: true });
              }
            }
          }
        }
      }

      await batch.commit();

      const label = action === 'approved' ? 'อนุมัติ' : 'ปฏิเสธ';
      toast.success(`${label}คำขอเรียบร้อย`);

      if (req.requesterId) {
        const typeLabel = req.type === 'swap' ? 'สลับกะ' : req.type === 'cover' ? 'ควงกะ' : 'ควงกะ+คืนวันหยุด';
        emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
          subject: `[ระบบยำกะผี] คำขอ${typeLabel}ของคุณได้รับการ${label}`,
          from_name: 'ระบบยำกะผี',
          to_email: member.email || ADMIN_EMAIL,
          message: `ประเภท: คำขอ${typeLabel}\nผู้ขอ: ${req.requesterName}\nวันที่ขอ: ${req.requesterDate} (กะ ${req.requesterShift})${req.targetDate ? `\nวันที่แลก: ${req.targetDate} (กะ ${req.targetShift || '—'})` : ''}\nสถานะ: ${label} โดย ${member.name}\n\nตรวจสอบ: https://gen-lang-client-0528383957.web.app`,
        }, EMAILJS_PUBLIC_KEY).catch(() => {});
      }
    } catch (err: any) {
      console.error('[handleAction]', err?.code, err?.message, err);
      toast.error(`ผิดพลาด: ${err?.code || err?.message || 'unknown'}`);
    }
  };

  const handleCancel = async (reqId: string) => {
    try {
      await updateDoc(doc(db, 'swapRequests', reqId), { status: 'cancelled' });
      toast.success('ยกเลิกคำขอเรียบร้อย');
    } catch (err: any) {
      console.error('[handleCancel]', err?.code, err?.message, err);
      toast.error(`ผิดพลาด: ${err?.code || err?.message || 'unknown'}`);
    }
  };

  const formatDate = (d: string) => {
    try { return format(new Date(d + 'T00:00:00'), 'd MMM yyyy', { locale: th }); }
    catch { return d; }
  };

  const RequestCard: React.FC<{ req: SwapRequest; showActions: boolean }> = ({ req, showActions }) => (
    <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Type + names */}
        <div className="flex items-center space-x-3">
          <div className={`p-2.5 rounded-full ${req.type === 'swap' ? 'bg-orange-50 text-orange-600' : 'bg-purple-50 text-purple-600'}`}>
            {req.type === 'swap' ? <ArrowRightLeft size={18} /> : <Repeat size={18} />}
          </div>
          <div>
            <p className="font-bold text-gray-800 text-sm">
              {req.type === 'swap' ? 'คำขอสลับกะ' : req.type === 'cover' ? 'คำขอควงกะ' : 'คำขอควงกะ+คืนวันหยุด'}
              {(req as any).isReverseOf && (
                <span className="ml-1.5 text-[10px] font-normal text-blue-500 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full">แลกคืน</span>
              )}
            </p>
            <p className="text-xs text-gray-500">
              {showActions
                ? `จาก: ${req.requesterName}`
                : `ส่งถึง: ${req.targetName || '—'}`}
            </p>
          </div>
        </div>

        {/* Dates & shifts */}
        <div className="flex items-center gap-4 text-xs">
          <div className="text-center">
            <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">วันผู้ขอ</p>
            <span className="px-2 py-0.5 rounded font-bold border" style={getShiftStyle(req.requesterShift)}>
              {req.requesterShift}
            </span>
            <p className="text-gray-500 mt-0.5">{formatDate(req.requesterDate)}</p>
          </div>

          {req.type === 'swap' && req.targetDate && (
            <>
              <ArrowRightLeft size={12} className="text-gray-300" />
              <div className="text-center">
                <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">วันที่แลก</p>
                <span className="px-2 py-0.5 rounded font-bold border" style={getShiftStyle(req.targetShift || '')}>
                  {req.targetShift}
                </span>
                <p className="text-gray-500 mt-0.5">{formatDate(req.targetDate)}</p>
              </div>
            </>
          )}

          {req.returnDate && (
            <>
              <ArrowRightLeft size={12} className="text-gray-300" />
              <div className="text-center">
                <p className="text-[10px] font-bold text-purple-400 uppercase mb-0.5">{req.type === 'cover_holiday' ? 'คืนวันหยุด' : 'วันคืน'}</p>
                <span className="px-2 py-0.5 rounded font-bold border bg-purple-50 text-purple-700 border-purple-200">
                  คืน
                </span>
                <p className="text-gray-500 mt-0.5">{formatDate(req.returnDate)}</p>
              </div>
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center space-x-2">
          {showActions ? (
            <>
              <button onClick={() => handleAction(req, 'approved')}
                className="flex items-center space-x-1.5 px-3 py-2 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors text-sm font-bold border border-green-200">
                <Check size={16} />
                <span>อนุมัติ</span>
              </button>
              <button onClick={() => handleAction(req, 'rejected')}
                className="flex items-center space-x-1.5 px-3 py-2 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors text-sm font-bold border border-red-200">
                <X size={16} />
                <span>ปฏิเสธ</span>
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <span className="px-3 py-1.5 bg-amber-50 text-amber-600 border border-amber-200 text-xs font-bold rounded-full">
                รอการยืนยัน
              </span>
              <button onClick={() => handleCancel(req.id)}
                className="px-3 py-1.5 text-xs font-bold text-red-500 hover:bg-red-50 border border-red-200 rounded-full transition-colors">
                ยกเลิก
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const HistoryCard: React.FC<{ req: SwapRequest }> = ({ req }) => {
    const iAmRequester = req.requesterId === member.id;
    const counterpart = iAmRequester ? req.targetName : req.requesterName;
    const iconClass = req.status === 'reversed' ? 'bg-blue-50 text-blue-600'
      : req.status === 'rejected' ? 'bg-red-50 text-red-500'
      : req.status === 'cancelled' ? 'bg-gray-50 text-gray-400'
      : 'bg-green-50 text-green-600';

    return (
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className={`p-2.5 rounded-full ${iconClass}`}>
              {req.status === 'reversed' ? <RotateCcw size={18} /> : req.status === 'rejected' || req.status === 'cancelled' ? <X size={18} /> : <Check size={18} />}
            </div>
            <div>
              <p className="font-bold text-gray-800 text-sm">
                {req.type === 'swap' ? 'สลับกะ' : req.type === 'cover' ? 'ควงกะ' : 'ควงกะ+คืนวันหยุด'}
                {(req as any).isReverseOf && (
                  <span className="ml-1.5 text-[10px] font-normal text-blue-500 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full">แลกคืน</span>
                )}
              </p>
              <p className="text-xs text-gray-500">
                {iAmRequester ? `ส่งถึง: ${counterpart}` : `จาก: ${counterpart}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <div className="text-center">
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">วันผู้ขอ</p>
              <span className="px-2 py-0.5 rounded font-bold border" style={getShiftStyle(req.requesterShift)}>
                {req.requesterShift}
              </span>
              <p className="text-gray-500 mt-0.5">{formatDate(req.requesterDate)}</p>
            </div>
            {req.type === 'swap' && req.targetDate && (
              <>
                <ArrowRightLeft size={12} className="text-gray-300" />
                <div className="text-center">
                  <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">วันที่แลก</p>
                  <span className="px-2 py-0.5 rounded font-bold border" style={getShiftStyle(req.targetShift || '')}>
                    {req.targetShift}
                  </span>
                  <p className="text-gray-500 mt-0.5">{formatDate(req.targetDate)}</p>
                </div>
              </>
            )}
            {req.returnDate && (
              <>
                <ArrowRightLeft size={12} className="text-gray-300" />
                <div className="text-center">
                  <p className="text-[10px] font-bold text-purple-400 uppercase mb-0.5">{req.type === 'cover_holiday' ? 'คืนวันหยุด' : 'วันคืน'}</p>
                  <span className="px-2 py-0.5 rounded font-bold border bg-purple-50 text-purple-700 border-purple-200">คืน</span>
                  <p className="text-gray-500 mt-0.5">{formatDate(req.returnDate)}</p>
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {req.status === 'approved' && (
              <span className="px-3 py-1.5 bg-green-50 text-green-600 border border-green-200 text-xs font-bold rounded-full">อนุมัติแล้ว</span>
            )}
            {req.status === 'reversed' && (
              <span className="px-3 py-1.5 bg-blue-50 text-blue-600 border border-blue-200 text-xs font-bold rounded-full">คืนกะแล้ว</span>
            )}
            {req.status === 'rejected' && (
              <span className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 text-xs font-bold rounded-full">ถูกปฏิเสธ</span>
            )}
            {req.status === 'cancelled' && (
              <span className="px-3 py-1.5 bg-gray-50 text-gray-500 border border-gray-200 text-xs font-bold rounded-full">ยกเลิกแล้ว</span>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-800">ประวัติการทำรายการ</h2>

      {/* Incoming — needs action */}
      <div className="space-y-3">
        <div className="flex items-center space-x-2">
          <h3 className="text-sm font-bold text-gray-700">รอการอนุมัติจากคุณ</h3>
          {incoming.length > 0 && (
            <span className="px-2 py-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full">{incoming.length}</span>
          )}
        </div>
        {incoming.length === 0 ? (
          <div className="py-8 text-center bg-white rounded-xl border border-dashed border-gray-200 text-sm text-gray-400">
            ไม่มีคำขอรอการอนุมัติ
          </div>
        ) : (
          incoming.map(req => <RequestCard key={req.id} req={req} showActions={true} />)
        )}
      </div>

      {/* Outgoing — waiting for others */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-gray-700">คำขอที่ส่งออกไป</h3>
        {outgoing.length === 0 ? (
          <div className="py-8 text-center bg-white rounded-xl border border-dashed border-gray-200 text-sm text-gray-400">
            ไม่มีคำขอที่รอการตอบกลับ
          </div>
        ) : (
          outgoing.map(req => <RequestCard key={req.id} req={req} showActions={false} />)
        )}
      </div>

      {/* History — all completed transactions */}
      {history.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center space-x-2">
            <History size={14} className="text-gray-400" />
            <h3 className="text-sm font-bold text-gray-700">ประวัติการทำรายการ</h3>
            <span className="text-[10px] text-gray-400">(60 รายการล่าสุด)</span>
          </div>
          {history.map(req => <HistoryCard key={req.id} req={req} />)}
        </div>
      )}
    </div>
  );
}
