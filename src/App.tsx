import React, { useState, useEffect, useRef } from 'react';
import {
  onAuthStateChanged, signInWithPopup, signInAnonymously, signOut,
  GoogleAuthProvider, User
} from 'firebase/auth';
import {
  doc, getDoc, setDoc, onSnapshot,
  collection, query, where, getDocs
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { Member, PairGroup } from './types';
import Layout from './components/Layout';
import InstallGate from './components/InstallGate';
import Dashboard from './components/Dashboard';
import Requests from './components/Requests';
import Members from './components/Members';
import Settings from './components/Settings';
import TeamSchedule from './components/TeamSchedule';
import ShiftPatterns from './components/ShiftPatterns';
import PairGroups from './components/PairGroups';
import SpecialSchedule from './components/SpecialSchedule';
import { Toaster, toast } from 'sonner';
import { useRegisterSW } from 'virtual:pwa-register/react';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [pairGroup, setPairGroup] = useState<PairGroup | null>(null);

  const [pinEmpId, setPinEmpId] = useState('');
  const [pinValue, setPinValue] = useState('');
  const [pinLoading, setPinLoading] = useState(false);
  const [pinError, setPinError] = useState('');

  const pendingPinLoginRef = useRef(false);
  const memberUnsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (memberUnsubRef.current) { memberUnsubRef.current(); memberUnsubRef.current = null; }

      if (u && !u.isAnonymous) {
        const docRef = doc(db, 'members', u.uid);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists() && u.email?.toLowerCase() === 'q.apichai@gmail.com') {
          const newMember: Member = {
            id: u.uid, uid: u.uid,
            name: u.displayName || 'Admin',
            email: u.email || '',
            station: 'HQ', zone: 'Central',
            quotaA: 10, quotaH: 13, quotaX: 4,
            shiftPattern: 'S11,S11,S11,S11,S11,S11,X,X,S13,S13,S13,S13,S13,S13,X,X,S12,S12,X,X',
            cycleStartDate: new Date().toISOString().split('T')[0],
            role: 'admin'
          };
          try { await setDoc(docRef, newMember); } catch (e) {
            console.error('Error creating admin profile:', e);
            toast.error('ไม่สามารถสร้างโปรไฟล์ผู้ดูแลระบบได้');
          }
        }
        memberUnsubRef.current = onSnapshot(docRef, (snap) => {
          if (snap.exists()) setMember({ id: snap.id, ...snap.data() } as Member);
          else setMember(null);
          setLoading(false);
        });
      } else if (u && u.isAnonymous) {
        if (!pendingPinLoginRef.current) {
          // Stale anonymous session — sign out
          signOut(auth);
          return;
        }
        setLoading(false);
      } else {
        setMember(null);
        setLoading(false);
      }
    });

    return () => { unsubAuth(); if (memberUnsubRef.current) memberUnsubRef.current(); };
  }, []);

  useEffect(() => {
    if (!member) { setPairGroup(null); return; }
    const q = query(collection(db, 'pairGroups'), where('memberIds', 'array-contains', member.id));
    const unsub = onSnapshot(q, snap => {
      setPairGroup(snap.empty ? null : ({ id: snap.docs[0].id, ...snap.docs[0].data() } as PairGroup));
    });
    return unsub;
  }, [member?.id]);

  const handleGoogleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch {
      toast.error('เข้าสู่ระบบไม่สำเร็จ');
    }
  };

  const handlePinLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const empId = pinEmpId.trim();
    const pin = pinValue.trim();
    if (!empId || !pin) { setPinError('กรุณากรอกรหัสพนักงานและ PIN'); return; }
    setPinLoading(true);
    setPinError('');
    try {
      pendingPinLoginRef.current = true;
      await signInAnonymously(auth);

      // Try query by empId field first
      let memberDoc: any = null;
      const q = query(collection(db, 'members'), where('empId', '==', empId));
      const snap = await getDocs(q);
      if (!snap.empty) {
        memberDoc = snap.docs[0];
      } else {
        // Fallback: doc ID = empId (legacy imported members)
        const docSnap = await getDoc(doc(db, 'members', empId));
        if (docSnap.exists()) memberDoc = docSnap;
      }
      if (!memberDoc) throw new Error('ไม่พบรหัสพนักงาน');

      const memberData = { id: memberDoc.id, ...memberDoc.data() } as Member;
      const expectedPin = memberData.pin || empId.slice(-4);
      if (pin !== expectedPin) throw new Error('PIN ไม่ถูกต้อง');

      memberUnsubRef.current = onSnapshot(doc(db, 'members', memberDoc.id), (s) => {
        if (s.exists()) setMember({ id: s.id, ...s.data() } as Member);
      });
      setMember(memberData);
    } catch (err: any) {
      pendingPinLoginRef.current = false;
      await signOut(auth);
      setPinError(err.message || 'เกิดข้อผิดพลาด');
    } finally {
      pendingPinLoginRef.current = false;
      setPinLoading(false);
    }
  };

  const handleSignOut = async () => {
    if (memberUnsubRef.current) { memberUnsubRef.current(); memberUnsubRef.current = null; }
    await signOut(auth);
    setMember(null);
    setPinEmpId('');
    setPinValue('');
  };

  if (loading || pinLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600"></div>
      </div>
    );
  }

  if (!user || (user.isAnonymous && !member)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-sm bg-white p-8 rounded-2xl shadow-xl">
          <h1 className="text-2xl font-bold text-orange-600 mb-1 text-center">ระบบยำกะผี</h1>
          <p className="text-xs text-gray-400 text-center mb-6">ระบบจัดการและสลับกะการทำงานนายสถานี</p>

          <form onSubmit={handlePinLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">รหัสพนักงาน</label>
              <input
                value={pinEmpId}
                onChange={(e) => setPinEmpId(e.target.value)}
                placeholder="กรอกรหัสพนักงาน"
                autoComplete="username"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">PIN</label>
              <input
                type="password"
                value={pinValue}
                onChange={(e) => setPinValue(e.target.value)}
                placeholder="กรอก PIN"
                maxLength={8}
                autoComplete="current-password"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-500"
              />
              <p className="text-[10px] text-gray-400 mt-1">PIN เริ่มต้น = 4 ตัวท้ายของรหัสพนักงาน</p>
            </div>

            {pinError && (
              <div className="bg-red-50 border border-red-200 text-red-600 text-xs rounded-lg px-3 py-2">
                {pinError}
              </div>
            )}

            <button
              type="submit"
              className="w-full bg-orange-600 text-white py-2.5 rounded-xl font-semibold hover:bg-orange-700 transition-colors text-sm"
            >
              เข้าสู่ระบบ
            </button>
          </form>

          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-100" /></div>
            <div className="relative flex justify-center"><span className="bg-white px-2 text-[10px] text-gray-400">หรือ</span></div>
          </div>

          <button
            onClick={handleGoogleLogin}
            className="w-full border border-gray-200 text-gray-500 py-2.5 rounded-xl font-medium hover:bg-gray-50 transition-colors text-sm"
          >
            เข้าสู่ระบบด้วย Google (Admin)
          </button>
        </div>
        <Toaster position="top-center" />
      </div>
    );
  }

  if (!member) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-xl text-center">
          <h1 className="text-2xl font-bold text-gray-800 mb-4">รอการอนุมัติ</h1>
          <p className="text-gray-600 mb-4">บัญชีของคุณยังไม่ได้รับการลงทะเบียนในระบบ กรุณาติดต่อผู้ดูแลระบบ</p>
          <div className="bg-gray-50 p-4 rounded-xl mb-6 text-left border border-gray-100">
            <p className="text-[10px] text-gray-400 uppercase font-bold mb-1">รหัสผู้ใช้ของคุณ (UID)</p>
            <code className="text-xs text-orange-600 break-all font-mono">{user.uid}</code>
            <p className="text-[10px] text-gray-400 mt-2">* ส่งรหัสนี้ให้ผู้ดูแลระบบเพื่อเพิ่มชื่อเข้าสู่ระบบ</p>
          </div>
          <button
            onClick={handleSignOut}
            className="text-orange-600 font-medium hover:underline"
          >
            ออกจากระบบ
          </button>
        </div>
        <Toaster position="top-center" />
      </div>
    );
  }

  return (
    <InstallGate>
      <Layout
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isAdmin={member.role === 'admin'}
        hasPairGroup={!!pairGroup}
        onSignOut={handleSignOut}
      >
        {activeTab === 'dashboard' && <Dashboard member={member} />}
        {activeTab === 'team' && <TeamSchedule member={member} isAdmin={member.role === 'admin'} memberMode={true} />}
        {activeTab === 'team-edit' && member.role === 'admin' && <TeamSchedule member={member} isAdmin={true} memberMode={false} />}
        {activeTab === 'special' && pairGroup && <SpecialSchedule member={member} group={pairGroup} />}
        {activeTab === 'requests' && <Requests member={member} />}
        {activeTab === 'members' && member.role === 'admin' && <Members />}
        {activeTab === 'pairgroups' && member.role === 'admin' && <PairGroups />}
        {activeTab === 'shiftpatterns' && member.role === 'admin' && <ShiftPatterns />}
        {activeTab === 'settings' && member.role === 'admin' && <Settings member={member} setMember={setMember} />}
        <Toaster position="top-center" />
      </Layout>
    </InstallGate>
  );
}
