import React, { useState, useEffect, useMemo } from 'react';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  User,
  GoogleAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  serverTimestamp, 
  orderBy, 
  limit,
  setDoc,
  getDocs,
  getDoc
} from 'firebase/firestore';
import { auth, db } from './lib/firebase';
import { OperationType, handleFirestoreError } from './lib/error-handler';
import { formatCurrency, cn } from './lib/utils';
import { 
  LayoutDashboard, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Wallet, 
  Plus, 
  LogOut, 
  History, 
  PieChart, 
  Settings, Search, Calendar,
  ChevronRight,
  TrendingDown,
  TrendingUp,
  Filter,
  Trash2,
  Edit2,
  X,
  Menu,
  Bell,
  User as UserIcon,
  AlertTriangle,
  Printer,
  Download,
  RotateCcw,
  CalendarRange,
  Check,
  Tag
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Filler
} from 'chart.js';
import { Pie, Line } from 'react-chartjs-2';
import { format, startOfMonth, endOfMonth, isWithinInterval, parseISO } from 'date-fns';

ChartJS.register(
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Filler
);

// Types
interface Transaction {
  id: string;
  userId: string;
  userEmail?: string;
  type: 'income' | 'expense';
  amount: number;
  category: string;
  date: string;
  note: string;
  createdAt: any;
}

interface Budget {
  id: string;
  userId: string;
  userEmail?: string;
  category: string;
  amount: number;
}

// Indonesian month labels
const MONTH_NAMES_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

const MONTH_NAMES_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'
];

function parseSafeDate(raw: any): { year: number; month: number; day: number; str: string } | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    // YYYY-MM-DD
    const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoMatch) {
      const y = parseInt(isoMatch[1], 10);
      const m = parseInt(isoMatch[2], 10);
      const d = parseInt(isoMatch[3], 10);
      return {
        year: y,
        month: m,
        day: d,
        str: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      };
    }
    // DD/MM/YYYY or DD-MM-YYYY
    const dmyMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (dmyMatch) {
      const d = parseInt(dmyMatch[1], 10);
      const m = parseInt(dmyMatch[2], 10);
      const y = parseInt(dmyMatch[3], 10);
      return {
        year: y,
        month: m,
        day: d,
        str: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      };
    }
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = parsed.getMonth() + 1;
      const d = parsed.getDate();
      return {
        year: y,
        month: m,
        day: d,
        str: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      };
    }
  }
  if (raw && typeof raw.toDate === 'function') {
    const parsed = raw.toDate();
    const y = parsed.getFullYear();
    const m = parsed.getMonth() + 1;
    const d = parsed.getDate();
    return {
      year: y,
      month: m,
      day: d,
      str: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    };
  }
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    const y = raw.getFullYear();
    const m = raw.getMonth() + 1;
    const d = raw.getDate();
    return {
      year: y,
      month: m,
      day: d,
      str: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    };
  }
  return null;
}

function formatDisplayDate(raw: any, short = false): string {
  const parsed = parseSafeDate(raw);
  if (!parsed) return typeof raw === 'string' && raw ? raw : '-';
  const monthName = short ? MONTH_NAMES_SHORT[parsed.month - 1] : MONTH_NAMES_ID[parsed.month - 1];
  return `${parsed.day} ${monthName} ${parsed.year}`;
}

type View = 'dashboard' | 'transactions' | 'budget' | 'analytics';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  
  // Modal State
  const [isTransactionModalOpen, setIsTransactionModalOpen] = useState(false);
  const [isBudgetModalOpen, setIsBudgetModalOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [modalType, setModalType] = useState<'income' | 'expense'>('expense');

  // Data State
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [globalError, setGlobalError] = useState<{ message: string, url?: string } | null>(null);
  
  // Profile Picture State
  const [profilePic, setProfilePic] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      // First try to load from Firestore
      const loadProfile = async () => {
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists() && userDoc.data().photoURL) {
            setProfilePic(userDoc.data().photoURL);
            return;
          }
          // Fallback to localStorage
          const savedPic = localStorage.getItem(`avatar_${user.uid}`);
          if (savedPic) {
            setProfilePic(savedPic);
            // Migrate to Firestore
            await setDoc(doc(db, 'users', user.uid), { photoURL: savedPic }, { merge: true });
          } else if (user.photoURL) {
            setProfilePic(user.photoURL);
          }
        } catch (e) {
          console.error("Failed to load profile pic", e);
        }
      };
      loadProfile();
    } else {
      setProfilePic(null);
    }
  }, [user]);

  const handleProfilePicChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64String = reader.result as string;
        setProfilePic(base64String);
        if (user) {
          try {
            localStorage.setItem(`avatar_${user.uid}`, base64String);
            await setDoc(doc(db, 'users', user.uid), { photoURL: base64String }, { merge: true });
          } catch (e) {
            console.error("Failed to save profile pic", e);
          }
        }
      };
      reader.readAsDataURL(file);
    }
  };
  
  // Auth state listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Firestore listeners & Data Synchronization
  useEffect(() => {
    if (!user) return;

    // Collect all possible identifiers for this user (UID, email, and known email pengeluaranrekap@gmail.com)
    const userIdentifiers = [user.uid];
    if (user.email && !userIdentifiers.includes(user.email)) {
      userIdentifiers.push(user.email);
    }
    if (user.email?.toLowerCase() === 'pengeluaranrekap@gmail.com' && !userIdentifiers.includes('pengeluaranrekap@gmail.com')) {
      userIdentifiers.push('pengeluaranrekap@gmail.com');
    }

    const transactionsMap = new Map<string, Transaction>();
    const budgetsMap = new Map<string, Budget>();

    // 1. Primary listener: query transactions where userId is in userIdentifiers
    const tQuery = query(
      collection(db, 'transactions'), 
      where('userId', 'in', userIdentifiers)
    );
    
    const unsubscribeT = onSnapshot(tQuery, (snapshot) => {
      snapshot.docs.forEach(docSnap => {
        const item = { id: docSnap.id, ...docSnap.data() } as Transaction;
        transactionsMap.set(docSnap.id, item);

        // Auto-migrate legacy userId == user.email to user.uid
        if (item.userId !== user.uid) {
          updateDoc(doc(db, 'transactions', docSnap.id), { 
            userId: user.uid, 
            userEmail: user.email || '' 
          }).catch(console.warn);
        }
      });

      const list = Array.from(transactionsMap.values());
      list.sort((a, b) => {
        const dateA = a.date || '';
        const dateB = b.date || '';
        return dateB.localeCompare(dateA);
      });
      setTransactions(list);
    }, (err) => {
      console.warn("Transactions query ('in') issue, falling back to direct userId:", err.message);
      // Fallback: direct query
      const fallbackQuery = query(collection(db, 'transactions'), where('userId', '==', user.uid));
      onSnapshot(fallbackQuery, (snapshot) => {
        const list = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as Transaction));
        list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        setTransactions(list);
      }, (fallbackErr) => {
        console.error("Transactions sync error:", fallbackErr);
        setGlobalError({ 
          message: `Gagal memuat transaksi: ${fallbackErr.message}`,
          url: fallbackErr.message.match(/https[^\s]+/)?.[0]
        });
      });
    });

    // 2. Secondary listener: query transactions by userEmail if present (to catch legacy records)
    let unsubscribeTEmail = () => {};
    if (user.email) {
      try {
        const tEmailQuery = query(
          collection(db, 'transactions'),
          where('userEmail', '==', user.email)
        );
        unsubscribeTEmail = onSnapshot(tEmailQuery, (snapshot) => {
          let hasNew = false;
          snapshot.docs.forEach(docSnap => {
            if (!transactionsMap.has(docSnap.id)) {
              const item = { id: docSnap.id, ...docSnap.data() } as Transaction;
              transactionsMap.set(docSnap.id, item);
              hasNew = true;
            }
          });
          if (hasNew) {
            const list = Array.from(transactionsMap.values());
            list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            setTransactions(list);
          }
        }, (err) => {
          // Silent fallback if index or field not yet populated
          console.debug("userEmail transactions listener note:", err.message);
        });
      } catch (e) {
        console.debug("Optional email query skipped", e);
      }
    }

    // 3. Budgets listener
    const bQuery = query(
      collection(db, 'budgets'), 
      where('userId', 'in', userIdentifiers)
    );
    
    const unsubscribeB = onSnapshot(bQuery, (snapshot) => {
      snapshot.docs.forEach(docSnap => {
        const item = { id: docSnap.id, ...docSnap.data() } as Budget;
        budgetsMap.set(docSnap.id, item);
        if (item.userId !== user.uid) {
          updateDoc(doc(db, 'budgets', docSnap.id), { 
            userId: user.uid 
          }).catch(console.warn);
        }
      });
      setBudgets(Array.from(budgetsMap.values()));
    }, (err) => {
      console.warn("Budgets query ('in') note, using direct query:", err.message);
      const fbQuery = query(collection(db, 'budgets'), where('userId', '==', user.uid));
      onSnapshot(fbQuery, (snapshot) => {
        setBudgets(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Budget)));
      }, () => {});
    });

    // 4. Legacy LocalStorage Recovery (if data existed offline / before Firestore hook)
    try {
      const keys = [
        'transactions',
        `transactions_${user.uid}`,
        user.email ? `transactions_${user.email}` : null,
        'transactions_pengeluaranrekap@gmail.com'
      ].filter(Boolean) as string[];

      for (const k of keys) {
        const raw = localStorage.getItem(k);
        if (raw) {
          try {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr) && arr.length > 0) {
              arr.forEach(async (t: any) => {
                if (t.amount && t.category) {
                  await addDoc(collection(db, 'transactions'), {
                    userId: user.uid,
                    userEmail: user.email || '',
                    type: t.type || 'expense',
                    amount: Number(t.amount) || 0,
                    category: t.category,
                    date: t.date || format(new Date(), 'yyyy-MM-dd'),
                    note: t.note || '',
                    createdAt: serverTimestamp()
                  });
                }
              });
              localStorage.removeItem(k);
            }
          } catch (e) {
            console.warn("Storage recovery err", e);
          }
        }
      }
    } catch (e) {
      console.warn("Storage check failed", e);
    }

    return () => {
      unsubscribeT();
      unsubscribeTEmail();
      unsubscribeB();
    };
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-12 h-12 border-4 border-primary-600 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800 flex">
      {/* Global Error Banner */}
      <AnimatePresence>
        {globalError && (
          <motion.div 
            initial={{ y: -100 }}
            animate={{ y: 0 }}
            exit={{ y: -100 }}
            className="fixed top-0 inset-x-0 z-[100] bg-red-600 text-white p-4 text-center shadow-xl flex items-center justify-center gap-4"
          >
            <AlertTriangle size={20} />
            <div className="text-sm font-bold">
              {globalError.message} 
              {globalError.url && (
                <a href={globalError.url} target="_blank" rel="noreferrer" className="ml-2 underline decoration-white/50 hover:decoration-white">
                  Klik di sini untuk membuat Index
                </a>
              )}
            </div>
            <button onClick={() => setGlobalError(null)} className="p-1 hover:bg-white/20 rounded">
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Sidebar Toggle - Removed as per user request */}


      {/* Sidebar for Desktop */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-40 w-72 bg-white border-r border-slate-200 transition-transform lg:relative lg:translate-x-0 shadow-sm",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="h-full flex flex-col p-6">
          <div className="flex items-center gap-3 mb-12 px-2 mt-14 lg:mt-0">
            <div className="w-10 h-10 bg-[#2563EB] rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-600/30">
              <Wallet size={24} />
            </div>
            <h1 className="text-xl font-black tracking-tighter text-slate-800">SIMANDU</h1>
          </div>

          <nav className="flex-1 space-y-2">
            <SidebarItem 
              active={view === 'dashboard'} 
              icon={<LayoutDashboard size={20} />} 
              label="Home" 
              onClick={() => { setView('dashboard'); setIsSidebarOpen(false); }} 
            />
            <SidebarItem 
              active={view === 'transactions'} 
              icon={<History size={20} />} 
              label="Transaksi" 
              onClick={() => { setView('transactions'); setIsSidebarOpen(false); }} 
            />
            <SidebarItem 
              active={view === 'analytics'} 
              icon={<PieChart size={20} />} 
              label="Analisa" 
              onClick={() => { setView('analytics'); setIsSidebarOpen(false); }} 
            />
            <SidebarItem 
              active={view === 'budget'} 
              icon={<TrendingDown size={20} />} 
              label="Anggaran" 
              onClick={() => { setView('budget'); setIsSidebarOpen(false); }} 
            />
          </nav>

          <div className="pt-6 border-t border-slate-100">
            <button 
              onClick={() => signOut(auth)}
              className="w-full flex items-center gap-3 px-4 py-3 text-slate-500 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
            >
              <LogOut size={20} />
              <span className="font-bold">Logout</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 h-screen overflow-y-auto pb-32 lg:pb-10 relative">
        <header className="pt-16 pb-10 px-6 lg:pt-20 lg:pb-12 lg:px-10 bg-[#2563EB] text-white rounded-b-[32px] shadow-sm mb-6 relative overflow-hidden">
          <div className="flex items-center justify-between relative z-10">
            <div className="flex items-center gap-4">
              <label className="w-[60px] h-[60px] rounded-full border-[3px] border-white/20 p-0.5 bg-transparent cursor-pointer block relative group">
                <div className="w-full h-full rounded-full bg-blue-100 flex items-center justify-center text-[#2563EB] overflow-hidden relative">
                  {profilePic ? (
                    <img src={profilePic} alt="Profile" className="w-full h-full object-cover" />
                  ) : (
                    <UserIcon size={30} />
                  )}
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Edit2 size={16} className="text-white" />
                  </div>
                </div>
                <input 
                  type="file" 
                  accept="image/*" 
                  className="hidden" 
                  onChange={handleProfilePicChange} 
                />
              </label>
              <div>
                <p className="text-white/80 text-[11px] font-bold uppercase tracking-widest mb-1">Selamat Datang,</p>
                <h2 className="text-xl font-bold">{user.email?.split('@')[0] || 'User'}</h2>
                <p className="text-white/70 text-[11px] italic mt-0.5">Personal Finance Manager • SIMANDU</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button className="w-10 h-10 flex items-center justify-center bg-white/10 rounded-full hover:bg-white/20 transition-all">
                <Bell size={18} />
              </button>
              <button 
                onClick={() => signOut(auth)}
                className="w-10 h-10 flex items-center justify-center bg-white/10 rounded-full hover:bg-white/20 transition-all group"
                title="Logout"
              >
                <LogOut size={18} className="group-hover:translate-x-0.5 transition-transform" />
              </button>
            </div>
          </div>
        </header>

        <div className="px-6 lg:px-10">
          <AnimatePresence mode="wait">
            {view === 'dashboard' && (
              <DashboardView 
                key="dash" 
                transactions={transactions} 
                budgets={budgets} 
                userId={user.uid} 
                onOpenTransactionModal={(type) => {
                  setEditingTransaction(null);
                  setModalType(type);
                  setIsTransactionModalOpen(true);
                }}
                onNavigateToTransactions={() => setView('transactions')}
              />
            )}
            {view === 'transactions' && (
              <TransactionsView 
                key="trans" 
                transactions={transactions} 
                user={user}
                onEditTransaction={(t) => {
                  setEditingTransaction(t);
                  setModalType(t ? t.type : 'expense');
                  setIsTransactionModalOpen(true);
                }}
              />
            )}
            {view === 'budget' && (
              <BudgetView 
                key="budget" 
                transactions={transactions} 
                budgets={budgets} 
                userId={user.uid}
                onEditBudget={(b) => {
                  setEditingBudget(b);
                  setIsBudgetModalOpen(true);
                }}
              />
            )}
            {view === 'analytics' && (
              <AnalyticsView 
                key="analytics" 
                transactions={transactions} 
              />
            )}
          </AnimatePresence>
        </div>

        {/* Global Modals */}
        <AnimatePresence>
          {isTransactionModalOpen && (
            <TransactionModal 
              onClose={() => setIsTransactionModalOpen(false)} 
              user={user} 
              editingTransaction={editingTransaction}
              defaultType={modalType}
            />
          )}
          {isBudgetModalOpen && (
            <BudgetModal 
              onClose={() => setIsBudgetModalOpen(false)} 
              user={user} 
              editingBudget={editingBudget}
            />
          )}
        </AnimatePresence>
      </main>

      {/* Bottom Nav for Mobile - SIMANDU Style */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-100 px-4 flex items-center justify-between z-40 rounded-t-[32px] shadow-[0_-10px_40px_rgba(0,0,0,0.05)] h-20">
        <NavButton active={view === 'dashboard'} icon={<LayoutDashboard size={22} />} label="HOME" onClick={() => setView('dashboard')} />
        <NavButton active={view === 'transactions'} icon={<History size={22} />} label="TRANS" onClick={() => setView('transactions')} />
        
        {/* Floating Center Button */}
        <div className="relative -top-8 shrink-0 px-2">
          <button 
            onClick={() => {
              setEditingTransaction(null);
              setModalType('expense');
              setIsTransactionModalOpen(true);
            }}
            className="w-16 h-16 bg-[#2563EB] rounded-full flex items-center justify-center text-white shadow-lg shadow-blue-500/40 border-[6px] border-slate-50 hover:scale-105 transition-transform"
          >
            <Plus size={32} />
          </button>
        </div>

        <NavButton active={view === 'analytics'} icon={<PieChart size={22} />} label="ANALISA" onClick={() => setView('analytics')} />
        <NavButton active={view === 'budget'} icon={<TrendingDown size={22} />} label="BUDGET" onClick={() => setView('budget')} />
      </div>
    </div>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean, icon: React.ReactNode, label: string, onClick: () => void }) {
  return (
    <button onClick={onClick} className={cn(
      "flex flex-col items-center gap-1.5 transition-all w-16",
      active ? "text-[#2563EB]" : "text-slate-400 hover:text-slate-600"
    )}>
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
    </button>
  );
}
// Components
function SidebarItem({ active, icon, label, onClick }: { active: boolean, icon: React.ReactNode, label: string, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium",
        active 
          ? "bg-primary-600 text-white shadow-lg shadow-primary-600/20" 
          : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
      )}
    >
      {icon}
      <span>{label}</span>
      {active && <ChevronRight size={16} className="ml-auto opacity-70" />}
    </button>
  );
}

// --- Views ---

function DashboardView({ 
  transactions, 
  budgets, 
  userId, 
  onOpenTransactionModal,
  onNavigateToTransactions
}: { 
  key?: string,
  transactions: Transaction[], 
  budgets: Budget[], 
  userId: string,
  onOpenTransactionModal: (type: 'income' | 'expense') => void,
  onNavigateToTransactions?: () => void
}) {
  const [period, setPeriod] = useState<'this_month' | 'all'>('this_month');
  const now = new Date();
  const currentMonthName = MONTH_NAMES_ID[now.getMonth()] + ' ' + now.getFullYear();
  
  const stats = useMemo(() => {
    let income = 0;
    let expense = 0;
    
    const relevantTransactions = period === 'all' 
      ? transactions 
      : transactions.filter(t => {
          const parsed = parseSafeDate(t.date);
          if (!parsed) return false;
          return parsed.year === now.getFullYear() && parsed.month === (now.getMonth() + 1);
        });

    relevantTransactions.forEach(t => {
      if (t.type === 'income') income += t.amount;
      else expense += t.amount;
    });

    const totalBalance = transactions.reduce((acc, t) => {
      return t.type === 'income' ? acc + t.amount : acc - t.amount;
    }, 0);

    return { income, expense, totalBalance, count: relevantTransactions.length };
  }, [transactions, period]);

  // Has other transactions outside current month?
  const hasTransactionsOutsideCurrentMonth = useMemo(() => {
    if (transactions.length === 0) return false;
    return transactions.some(t => {
      const parsed = parseSafeDate(t.date);
      if (!parsed) return false;
      return parsed.year !== now.getFullYear() || parsed.month !== (now.getMonth() + 1);
    });
  }, [transactions]);

  // Chart data
  const pieData = useMemo(() => {
    const categories: Record<string, number> = {};
    const relevantExpenses = period === 'all'
      ? transactions.filter(t => t.type === 'expense')
      : transactions.filter(t => {
          if (t.type !== 'expense') return false;
          const parsed = parseSafeDate(t.date);
          return parsed ? (parsed.year === now.getFullYear() && parsed.month === (now.getMonth() + 1)) : false;
        });

    relevantExpenses.forEach(t => {
      categories[t.category] = (categories[t.category] || 0) + t.amount;
    });

    return {
      labels: Object.keys(categories),
      datasets: [{
        data: Object.values(categories),
        backgroundColor: [
          '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#8b5cf6', '#3b82f6', '#14b8a6'
        ],
        borderWidth: 0,
      }]
    };
  }, [transactions, period]);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6"
    >
      {/* Period Toggle & Quick Stats Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
        <div className="flex items-center gap-2">
          <CalendarRange size={18} className="text-[#2563EB]" />
          <span className="text-sm font-bold text-slate-700">Periode Dashboard:</span>
        </div>
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl w-full sm:w-auto">
          <button
            onClick={() => setPeriod('this_month')}
            className={cn(
              "flex-1 sm:flex-none px-4 py-1.5 text-xs font-bold rounded-lg transition-all",
              period === 'this_month' ? "bg-white text-[#2563EB] shadow-sm" : "text-slate-500 hover:text-slate-800"
            )}
          >
            Bulan Ini ({currentMonthName})
          </button>
          <button
            onClick={() => setPeriod('all')}
            className={cn(
              "flex-1 sm:flex-none px-4 py-1.5 text-xs font-bold rounded-lg transition-all",
              period === 'all' ? "bg-white text-[#2563EB] shadow-sm" : "text-slate-500 hover:text-slate-800"
            )}
          >
            Semua Waktu ({transactions.length} Transaksi)
          </button>
        </div>
      </div>

      {/* Helpful banner if viewing current month but transactions are in other months */}
      {period === 'this_month' && stats.count === 0 && hasTransactionsOutsideCurrentMonth && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-blue-900">
          <div className="flex items-center gap-3">
            <AlertTriangle size={20} className="text-[#2563EB] shrink-0" />
            <p className="text-xs sm:text-sm font-medium">
              Data transaksi Anda tersimpan aman ({transactions.length} transaksi), tercatat di bulan lain (seperti Agustus).
            </p>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => setPeriod('all')}
              className="flex-1 sm:flex-none px-3 py-1.5 bg-[#2563EB] text-white text-xs font-bold rounded-lg shadow-sm hover:bg-blue-700 transition-colors"
            >
              Tampilkan Semua Waktu
            </button>
            {onNavigateToTransactions && (
              <button
                onClick={onNavigateToTransactions}
                className="flex-1 sm:flex-none px-3 py-1.5 bg-white text-[#2563EB] border border-blue-300 text-xs font-bold rounded-lg hover:bg-blue-50 transition-colors"
              >
                Buka Riwayat
              </button>
            )}
          </div>
        </div>
      )}

      {/* Stat Cards - Grid layout for mobile to fit everything on screen */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-6">
        <div className="col-span-2 lg:col-span-1">
          <StatCard 
            title="Total Saldo" 
            amount={stats.totalBalance} 
            icon={<Plus size={20} />} 
            variant="blue" 
            subtitle="Saldo Keseluruhan"
          />
        </div>
        <div className="col-span-1">
          <StatCard 
            title="Pemasukan" 
            amount={stats.income} 
            icon={<TrendingUp size={16} />} 
            variant="green" 
            subtitle={period === 'this_month' ? 'Bulan Berjalan' : 'Semua Waktu'}
          />
        </div>
        <div className="col-span-1">
          <StatCard 
            title="Pengeluaran" 
            amount={stats.expense} 
            icon={<TrendingDown size={16} />} 
            variant="red" 
            subtitle={period === 'this_month' ? 'Bulan Berjalan' : 'Semua Waktu'}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent Transactions */}
        <div className="bg-white p-6 rounded-[32px] shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-bold text-slate-800">Transaksi Terbaru</h3>
              <p className="text-xs text-slate-400 mt-0.5">{transactions.length} transaksi tercatat</p>
            </div>
            {onNavigateToTransactions && (
              <button 
                onClick={onNavigateToTransactions} 
                className="text-[#2563EB] text-sm font-bold hover:underline flex items-center gap-1"
              >
                Lihat Semua ({transactions.length}) <ChevronRight size={14} />
              </button>
            )}
          </div>
          <div className="space-y-4">
            {transactions.slice(0, 5).map(t => (
              <div key={t.id} className="flex items-center gap-4 p-2 rounded-xl hover:bg-slate-50 transition-colors">
                <div className={cn(
                  "w-12 h-12 rounded-full flex items-center justify-center shrink-0",
                  t.type === 'income' ? "bg-green-100 text-[#10B981]" : "bg-red-100 text-[#EF4444]"
                )}>
                  {t.type === 'income' ? <ArrowUpRight size={20} /> : <ArrowDownLeft size={20} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-800 text-[15px] truncate">{t.category}</p>
                  <p className="text-[13px] text-slate-500 mt-0.5">{formatDisplayDate(t.date, true)}</p>
                </div>
                <p className={cn(
                  "font-bold whitespace-nowrap text-sm sm:text-base",
                  t.type === 'income' ? "text-[#10B981]" : "text-[#EF4444]"
                )}>
                  {t.type === 'income' ? '+' : '-'}{formatCurrency(t.amount)}
                </p>
              </div>
            ))}
            {transactions.length === 0 && (
              <div className="text-center py-10 text-slate-400">
                <History size={36} className="mx-auto mb-2 opacity-20" />
                <p className="font-medium">Belum ada transaksi</p>
                <p className="text-xs mt-1 text-slate-400">Klik tombol + di bawah untuk mulai mencatat</p>
              </div>
            )}
          </div>
        </div>

        {/* Expense Overview Pie */}
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold">Distribusi Pengeluaran</h3>
            <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg">
              {period === 'this_month' ? 'Bulan Ini' : 'Semua Waktu'}
            </span>
          </div>
          {pieData.labels.length > 0 ? (
            <div className="h-64 flex items-center justify-center">
              <Pie 
                data={pieData} 
                options={{
                  plugins: { legend: { position: 'right' } },
                  maintainAspectRatio: false
                }} 
              />
            </div>
          ) : (
            <div className="h-64 flex flex-col items-center justify-center text-slate-400 space-y-2">
              <PieChart size={48} className="opacity-20" />
              <p className="font-medium">Belum ada data pengeluaran {period === 'this_month' ? 'di bulan ini' : ''}</p>
              {period === 'this_month' && hasTransactionsOutsideCurrentMonth && (
                <button
                  onClick={() => setPeriod('all')}
                  className="text-xs text-[#2563EB] font-bold hover:underline"
                >
                  Tampilkan Pengeluaran Semua Waktu
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <QuickActionFAB onAdd={(type) => onOpenTransactionModal(type)} />
    </motion.div>
  );
}

function TransactionsView({ 
  transactions, 
  user,
  onEditTransaction
}: { 
  key?: string,
  transactions: Transaction[], 
  user: User,
  onEditTransaction: (t: Transaction | null) => void
}) {
  const [isPrintMode, setIsPrintMode] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Extract all unique categories
  const categoriesList = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach(t => {
      if (t.category) set.add(t.category);
    });
    return Array.from(set).sort();
  }, [transactions]);

  // Quick Preset Helper
  const applyPreset = (preset: 'all' | 'this_month' | 'last_month' | 'august_december_2026' | 'this_year') => {
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth() + 1;

    if (preset === 'all') {
      setStartDate('');
      setEndDate('');
    } else if (preset === 'this_month') {
      const mStr = String(curMonth).padStart(2, '0');
      const lastDay = new Date(curYear, curMonth, 0).getDate();
      setStartDate(`${curYear}-${mStr}-01`);
      setEndDate(`${curYear}-${mStr}-${String(lastDay).padStart(2, '0')}`);
    } else if (preset === 'last_month') {
      const prevDate = new Date(curYear, curMonth - 2, 1);
      const prevY = prevDate.getFullYear();
      const prevM = prevDate.getMonth() + 1;
      const prevMStr = String(prevM).padStart(2, '0');
      const lastDay = new Date(prevY, prevM, 0).getDate();
      setStartDate(`${prevY}-${prevMStr}-01`);
      setEndDate(`${prevY}-${prevMStr}-${String(lastDay).padStart(2, '0')}`);
    } else if (preset === 'august_december_2026') {
      setStartDate('2026-08-01');
      setEndDate('2026-12-01');
    } else if (preset === 'this_year') {
      setStartDate(`${curYear}-01-01`);
      setEndDate(`${curYear}-12-31`);
    }
  };

  const hasActiveFilters = Boolean(
    filterType !== 'all' || 
    selectedCategory !== 'all' || 
    searchQuery.trim() !== '' || 
    startDate !== '' || 
    endDate !== ''
  );

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filterType !== 'all') count++;
    if (selectedCategory !== 'all') count++;
    if (searchQuery.trim() !== '') count++;
    if (startDate !== '' || endDate !== '') count++;
    return count;
  }, [filterType, selectedCategory, searchQuery, startDate, endDate]);

  const resetAllFilters = () => {
    setFilterType('all');
    setSelectedCategory('all');
    setSearchQuery('');
    setStartDate('');
    setEndDate('');
  };

  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => {
      // 1. Type
      if (filterType !== 'all' && t.type !== filterType) return false;

      // 2. Category
      if (selectedCategory !== 'all' && (t.category || '').toLowerCase() !== selectedCategory.toLowerCase()) {
        return false;
      }

      // 3. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchCat = (t.category || '').toLowerCase().includes(q);
        const matchNote = (t.note || '').toLowerCase().includes(q);
        if (!matchCat && !matchNote) return false;
      }

      // 4. Date range
      const parsed = parseSafeDate(t.date);
      const dateStr = parsed ? parsed.str : (typeof t.date === 'string' ? t.date.split('T')[0] : '');

      if (startDate && dateStr) {
        if (dateStr < startDate) return false;
      }
      if (endDate && dateStr) {
        if (dateStr > endDate) return false;
      }

      return true;
    });
  }, [transactions, filterType, selectedCategory, searchQuery, startDate, endDate]);

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    filteredTransactions.forEach(t => {
      if (t.type === 'income') income += t.amount;
      else expense += t.amount;
    });
    return { income, expense, balance: income - expense };
  }, [filteredTransactions]);

  const handleDelete = async (id: string) => {
    if (!window.confirm('Hapus transaksi ini?')) return;
    try {
      await deleteDoc(doc(db, 'transactions', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `transactions/${id}`);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (isPrintMode) {
    return (
      <div className="fixed inset-0 z-[200] bg-white p-4 lg:p-8 overflow-auto">
        <div id="print-area" className="max-w-4xl mx-auto bg-white">
          <div className="flex flex-col lg:flex-row justify-between items-start mb-8 border-b pb-4 gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Laporan Transaksi</h1>
              <p className="text-slate-500">SIMANDU - Personal Finance Manager</p>
              <p className="text-xs mt-1 text-slate-400 font-mono">Dicetak pada: {format(new Date(), 'dd MMM yyyy HH:mm')}</p>
            </div>
            <div className="flex gap-2 print-hidden-buttons w-full lg:w-auto">
              <button 
                onClick={handlePrint}
                className="flex-1 lg:flex-none flex items-center justify-center gap-2 px-4 py-3 lg:py-2 bg-[#2563EB] text-white rounded-lg font-bold shadow-sm"
              >
                <Printer size={18} /> Print
              </button>
              <button 
                onClick={() => setIsPrintMode(false)}
                className="flex-1 lg:flex-none flex items-center justify-center px-4 py-3 lg:py-2 bg-slate-100 text-slate-600 rounded-lg font-bold"
              >
                Tutup
              </button>
            </div>
          </div>

          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-slate-200">
                <th className="py-3 font-bold text-slate-700">Tanggal</th>
                <th className="py-3 font-bold text-slate-700">Kategori</th>
                <th className="py-3 font-bold text-slate-700">Catatan</th>
                <th className="py-3 font-bold text-slate-700 text-right">Jumlah</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.map(t => (
                <tr key={t.id} className="border-b border-slate-100">
                  <td className="py-3 text-sm">{formatDisplayDate(t.date)}</td>
                  <td className="py-3 text-sm font-medium uppercase">{t.category}</td>
                  <td className="py-3 text-sm text-slate-500 italic">{t.note || '-'}</td>
                  <td className={cn(
                    "py-3 text-sm font-bold text-right",
                    t.type === 'income' ? 'text-green-600' : 'text-red-600'
                  )}>
                    {t.type === 'income' ? '+' : '-'}{formatCurrency(t.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50">
                <td colSpan={3} className="py-3 font-bold text-slate-700 text-right pr-4">Total Pemasukan:</td>
                <td className="py-3 font-bold text-green-600 text-right">+{formatCurrency(totals.income)}</td>
              </tr>
              <tr className="bg-slate-50">
                <td colSpan={3} className="py-3 font-bold text-slate-700 text-right pr-4">Total Pengeluaran:</td>
                <td className="py-3 font-bold text-red-600 text-right">-{formatCurrency(totals.expense)}</td>
              </tr>
              <tr className="border-b-2 border-slate-200 bg-slate-50">
                <td colSpan={3} className="py-3 font-bold text-slate-900 text-right pr-4">Total Saldo:</td>
                <td className={cn("py-3 font-bold text-right", totals.balance >= 0 ? "text-slate-900" : "text-red-600")}>
                  {totals.balance >= 0 ? '' : '-'}{formatCurrency(Math.abs(totals.balance))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-6"
    >
      <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 space-y-6">
        {/* Top Action Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Riwayat Transaksi</h2>
            <p className="text-xs text-slate-500 mt-0.5">Kelola dan filter seluruh catatan pengeluaran & pemasukan Anda</p>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setIsPrintMode(true)}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-50 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors border border-slate-200"
            >
              <Printer size={16} /> Print
            </button>
            <button 
              onClick={() => onEditTransaction(null)}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 bg-[#2563EB] text-white rounded-xl text-sm font-bold shadow-lg shadow-blue-500/20 hover:bg-blue-700 transition-colors"
            >
              <Plus size={18} /> Tambah Transaksi
            </button>
          </div>
        </div>

        {/* Filter Section: Structured & Comprehensive */}
        <div className="bg-slate-50/70 p-5 rounded-2xl border border-slate-200 space-y-4">
          {/* Row 1: Search & Type Tabs */}
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3">
            {/* Search Input */}
            <div className="relative flex-1 group">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <Search size={16} className="text-slate-400 group-focus-within:text-[#2563EB] transition-colors" />
              </div>
              <input 
                type="text"
                placeholder="Cari kategori atau catatan..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-9 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] transition-all outline-none font-medium shadow-sm"
              />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Type Selector (Semua, Masuk, Keluar) */}
            <div className="flex items-center bg-white p-1 rounded-xl border border-slate-200 shadow-sm shrink-0">
              <button
                onClick={() => setFilterType('all')}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all",
                  filterType === 'all' ? "bg-slate-800 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
                )}
              >
                Semua
              </button>
              <button
                onClick={() => setFilterType('income')}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1",
                  filterType === 'income' ? "bg-green-600 text-white shadow-sm" : "text-green-700 hover:bg-green-50"
                )}
              >
                <ArrowUpRight size={13} /> Pemasukan
              </button>
              <button
                onClick={() => setFilterType('expense')}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1",
                  filterType === 'expense' ? "bg-red-600 text-white shadow-sm" : "text-red-700 hover:bg-red-50"
                )}
              >
                <ArrowDownLeft size={13} /> Pengeluaran
              </button>
            </div>

            {/* Category Dropdown */}
            <div className="relative min-w-[160px]">
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold text-slate-700 outline-none focus:border-[#2563EB] shadow-sm cursor-pointer"
              >
                <option value="all">Semua Kategori ({categoriesList.length})</option>
                {categoriesList.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 2: Date Range Filter (Dari Tanggal & Sampai Tanggal) */}
          <div className="flex flex-col lg:flex-row items-stretch lg:items-end gap-3 pt-3 border-t border-slate-200/80">
            {/* Start Date */}
            <div className="flex-1">
              <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Calendar size={13} className="text-[#2563EB]" /> Dari Tanggal:
              </label>
              <input 
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs sm:text-sm font-medium text-slate-700 outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] shadow-sm transition-all"
                title="Pilih tanggal awal"
              />
            </div>

            {/* End Date */}
            <div className="flex-1">
              <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Calendar size={13} className="text-[#2563EB]" /> Sampai Tanggal:
              </label>
              <input 
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs sm:text-sm font-medium text-slate-700 outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] shadow-sm transition-all"
                title="Pilih tanggal akhir"
              />
            </div>

            {/* Reset Button */}
            {hasActiveFilters && (
              <button
                onClick={resetAllFilters}
                className="flex items-center justify-center gap-1.5 px-4 py-2 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded-xl text-xs font-bold transition-colors shadow-sm shrink-0 h-[38px]"
                title="Hapus semua filter"
              >
                <RotateCcw size={14} /> Reset Filter ({activeFilterCount})
              </button>
            )}
          </div>

          {/* Row 3: Quick Preset Chips */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-1">Preset Cepat:</span>
            <button
              type="button"
              onClick={() => applyPreset('all')}
              className={cn(
                "px-2.5 py-1 rounded-lg text-xs font-semibold transition-all",
                !startDate && !endDate ? "bg-[#2563EB] text-white" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
              )}
            >
              Semua Waktu
            </button>
            <button
              type="button"
              onClick={() => applyPreset('this_month')}
              className="px-2.5 py-1 bg-white text-slate-600 border border-slate-200 rounded-lg text-xs font-semibold hover:bg-slate-100 transition-all"
            >
              Bulan Ini
            </button>
            <button
              type="button"
              onClick={() => applyPreset('last_month')}
              className="px-2.5 py-1 bg-white text-slate-600 border border-slate-200 rounded-lg text-xs font-semibold hover:bg-slate-100 transition-all"
            >
              Bulan Lalu
            </button>
            <button
              type="button"
              onClick={() => applyPreset('august_december_2026')}
              className="px-2.5 py-1 bg-white text-blue-700 border border-blue-200 rounded-lg text-xs font-semibold hover:bg-blue-50 transition-all flex items-center gap-1"
            >
              1 Ags - 1 Des 2026
            </button>
            <button
              type="button"
              onClick={() => applyPreset('this_year')}
              className="px-2.5 py-1 bg-white text-slate-600 border border-slate-200 rounded-lg text-xs font-semibold hover:bg-slate-100 transition-all"
            >
              Tahun Ini
            </button>
          </div>
        </div>

        {/* Filter Summary Status */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1 text-xs text-slate-500 font-medium">
          <div>
            Menampilkan <span className="font-bold text-slate-800">{filteredTransactions.length}</span> dari total <span className="font-bold text-slate-800">{transactions.length}</span> transaksi
            {hasActiveFilters && <span className="text-[#2563EB] font-bold ml-1.5">(Filter Aktif)</span>}
          </div>
          {filteredTransactions.length > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-green-600 font-bold">Masuk: +{formatCurrency(totals.income)}</span>
              <span className="text-slate-300">•</span>
              <span className="text-red-600 font-bold">Keluar: -{formatCurrency(totals.expense)}</span>
              <span className="text-slate-300">•</span>
              <span className={cn("font-black", totals.balance >= 0 ? "text-slate-800" : "text-red-600")}>
                Selisih: {totals.balance >= 0 ? '' : '-'}{formatCurrency(Math.abs(totals.balance))}
              </span>
            </div>
          )}
        </div>

        {/* Table Area: Screen-optimized without requiring horizontal drag */}
        <div className="overflow-x-auto w-full -mx-4 px-4 sm:mx-0 sm:px-0">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="pb-3.5 font-bold text-slate-400 px-1 sm:px-3 text-[11px] sm:text-xs uppercase tracking-wider whitespace-nowrap">Tanggal</th>
                <th className="pb-3.5 font-bold text-slate-400 px-1 sm:px-3 text-[11px] sm:text-xs uppercase tracking-wider">Kategori & Catatan</th>
                <th className="pb-3.5 font-bold text-slate-400 px-1 sm:px-3 text-[11px] sm:text-xs uppercase tracking-wider text-right whitespace-nowrap">Jumlah</th>
                <th className="pb-3.5 font-bold text-slate-400 px-1 sm:px-3 text-[11px] sm:text-xs uppercase tracking-wider text-right whitespace-nowrap">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTransactions.map(t => (
                <tr key={t.id} className="hover:bg-slate-50/80 transition-colors group">
                  <td className="py-3.5 sm:py-4 text-[11px] sm:text-sm px-1 sm:px-3 whitespace-nowrap align-middle font-medium text-slate-600">
                    {formatDisplayDate(t.date, true)}
                  </td>
                  <td className="py-3.5 sm:py-4 px-1 sm:px-3 align-middle">
                    <div className="flex flex-col gap-1 items-start">
                      <span className="px-2.5 py-0.5 sm:px-3 sm:py-1 bg-slate-100 rounded-lg text-[10px] sm:text-xs font-bold text-slate-700 uppercase tracking-wider">
                        {t.category}
                      </span>
                      {t.note && (
                        <span className="text-[11px] sm:text-sm text-slate-500 line-clamp-2">{t.note}</span>
                      )}
                    </div>
                  </td>
                  <td className={cn(
                    "py-3.5 sm:py-4 font-black px-1 sm:px-3 text-right whitespace-nowrap text-xs sm:text-sm align-middle",
                    t.type === 'income' ? "text-[#10B981]" : "text-[#EF4444]"
                  )}>
                    {t.type === 'income' ? '+' : '-'}{formatCurrency(t.amount)}
                  </td>
                  <td className="py-3.5 sm:py-4 text-right px-1 sm:px-3 align-middle">
                    <div className="flex items-center justify-end gap-1 sm:gap-2">
                      <button 
                        onClick={() => onEditTransaction(t)}
                        className="p-1.5 sm:p-2 text-slate-400 hover:text-[#2563EB] hover:bg-blue-50 rounded-lg transition-colors"
                        title="Edit transaksi"
                      >
                        <Edit2 size={15} className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      </button>
                      <button 
                        onClick={() => handleDelete(t.id)}
                        className="p-1.5 sm:p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Hapus transaksi"
                      >
                        <Trash2 size={15} className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            {filteredTransactions.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50/60">
                  <td colSpan={2} className="py-3 sm:py-4 font-bold text-slate-700 text-right pr-2 sm:pr-4 text-xs sm:text-sm">Total Pemasukan:</td>
                  <td className="py-3 sm:py-4 font-bold text-green-600 px-1 sm:px-3 text-right text-xs sm:text-sm">+{formatCurrency(totals.income)}</td>
                  <td></td>
                </tr>
                <tr className="bg-slate-50/60">
                  <td colSpan={2} className="py-3 sm:py-4 font-bold text-slate-700 text-right pr-2 sm:pr-4 text-xs sm:text-sm">Total Pengeluaran:</td>
                  <td className="py-3 sm:py-4 font-bold text-red-600 px-1 sm:px-3 text-right text-xs sm:text-sm">-{formatCurrency(totals.expense)}</td>
                  <td></td>
                </tr>
                <tr className="border-b-2 border-slate-200 bg-slate-50/90">
                  <td colSpan={2} className="py-3.5 sm:py-4 font-black text-slate-900 text-right pr-2 sm:pr-4 text-xs sm:text-sm">Total Saldo:</td>
                  <td className={cn("py-3.5 sm:py-4 font-black px-1 sm:px-3 text-right text-xs sm:text-sm", totals.balance >= 0 ? "text-slate-900" : "text-red-600")}>
                    {totals.balance >= 0 ? '' : '-'}{formatCurrency(Math.abs(totals.balance))}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>

          {filteredTransactions.length === 0 && (
            <div className="p-12 text-center text-slate-400 space-y-3">
              {transactions.length === 0 ? (
                <>
                  <History size={48} className="mx-auto mb-2 opacity-20" />
                  <p className="font-bold text-slate-600">Belum ada riwayat transaksi tersimpan</p>
                  <p className="text-xs text-slate-400">Data transaksi Anda akan muncul di sini setelah Anda menambahkannya.</p>
                  <button
                    onClick={() => onEditTransaction(null)}
                    className="mt-2 inline-flex items-center gap-2 px-4 py-2 bg-[#2563EB] text-white rounded-xl text-xs font-bold shadow-md hover:bg-blue-700 transition-colors"
                  >
                    <Plus size={16} /> Tambah Transaksi Pertama
                  </button>
                </>
              ) : (
                <>
                  <Filter size={48} className="mx-auto mb-2 opacity-20 text-amber-500" />
                  <p className="font-bold text-slate-700">Tidak ada transaksi yang sesuai dengan filter yang dipilih</p>
                  <p className="text-xs text-slate-400">
                    Terdapat total {transactions.length} transaksi yang tercatat pada akun Anda.
                  </p>
                  <button
                    onClick={resetAllFilters}
                    className="mt-2 inline-flex items-center gap-2 px-4 py-2 bg-[#2563EB] text-white rounded-xl text-xs font-bold shadow-md hover:bg-blue-700 transition-colors"
                  >
                    <RotateCcw size={14} /> Tampilkan Semua Transaksi ({transactions.length})
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function BudgetView({ 
  transactions, 
  budgets, 
  userId,
  onEditBudget
}: { 
  key?: string,
  transactions: Transaction[], 
  budgets: Budget[], 
  userId: string,
  onEditBudget: (b: Budget | null) => void
}) {
  const budgetProgress = useMemo(() => {
    const currentMonth = startOfMonth(new Date());
    const monthlyExpenses = transactions.filter(t => 
      t.type === 'expense' && 
      isWithinInterval(parseISO(t.date), { start: currentMonth, end: endOfMonth(new Date()) })
    );

    return budgets.map(b => {
      const spent = monthlyExpenses
        .filter(t => t.category.toLowerCase() === b.category.toLowerCase())
        .reduce((sum, t) => sum + t.amount, 0);
      
      const percent = (spent / b.amount) * 100;
      return { ...b, spent, percent };
    });
  }, [transactions, budgets]);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-6"
    >
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-bold">Anggaran Kategori</h3>
        <button 
          onClick={() => onEditBudget(null)}
          className="flex items-center gap-2 px-6 py-2.5 bg-primary-600 text-white rounded-2xl font-bold shadow-lg shadow-primary-600/20"
        >
          <Plus size={18} /> Atur Budget
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {budgetProgress.map(b => (
          <div key={b.id} className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 flex flex-col gap-4">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-bold text-lg text-slate-800">{b.category}</p>
                <p className="text-sm text-slate-500">Bulan ini</p>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => onEditBudget(b)}
                  className="p-2 text-slate-300 hover:text-primary-600"
                >
                  <Edit2 size={16} />
                </button>
                <button 
                  onClick={async () => {
                    if (confirm('Hapus budget ini?')) {
                      await deleteDoc(doc(db, 'budgets', b.id));
                    }
                  }}
                  className="p-2 text-slate-300 hover:text-expense"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="font-medium text-slate-600">Progres: {Math.min(100, Math.round(b.percent))}%</span>
                <span>{formatCurrency(b.spent)} / {formatCurrency(b.amount)}</span>
              </div>
              <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, b.percent)}%` }}
                  className={cn(
                    "h-full rounded-full transition-all duration-1000",
                    b.percent > 100 ? "bg-red-500" : b.percent > 80 ? "bg-amber-500" : "bg-primary-600"
                  )}
                />
              </div>
            </div>

            {b.percent > 100 && (
              <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 rounded-xl text-sm font-medium">
                <AlertTriangle size={16} />
                <span>Over budget! Segera tinjau pengeluaran Anda.</span>
              </div>
            )}
            {b.percent > 80 && b.percent <= 100 && (
              <div className="flex items-center gap-2 p-3 bg-amber-50 text-amber-600 rounded-xl text-sm font-medium">
                <AlertTriangle size={16} />
                <span>Mendekati limit budget.</span>
              </div>
            )}
          </div>
        ))}
        {budgets.length === 0 && (
          <div className="md:col-span-2 text-center py-20 bg-white rounded-3xl border-2 border-dashed border-slate-200 text-slate-400">
            <PieChart size={48} className="mx-auto mb-4 opacity-10" />
            <p className="font-medium">Belum ada anggaran yang diatur.</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// --- Modals & UI Fragments ---

function StatCard({ title, amount, icon, variant, subtitle }: { title: string, amount: number, icon: React.ReactNode, variant: 'blue' | 'red' | 'green', subtitle?: string }) {
  const styles = {
    blue: "bg-[#2563EB] text-white",
    red: "bg-[#EF4444] text-white",
    green: "bg-[#10B981] text-white"
  };

  return (
    <div className={cn("p-5 lg:p-6 rounded-[24px] lg:rounded-[28px] shadow-sm relative overflow-hidden group flex flex-col justify-between min-h-[120px] lg:min-h-[140px]", styles[variant])}>
      <div className="relative z-10 flex flex-col h-full justify-between">
        <div>
          <p className="text-white/80 text-[10px] lg:text-[11px] font-bold uppercase tracking-widest mb-1">{title}</p>
          <p className={cn(
            "font-bold tracking-tight truncate",
            variant === 'blue' ? "text-2xl lg:text-[28px]" : "text-lg sm:text-xl lg:text-2xl"
          )}>{formatCurrency(amount)}</p>
        </div>
        
        <div className="flex items-end justify-between mt-4 lg:mt-6 pt-3 lg:pt-4 border-t border-white/10">
          <p className="text-white/80 text-[9px] lg:text-[10px] font-bold uppercase tracking-widest truncate mr-2">{subtitle}</p>
          <div className="w-7 h-7 lg:w-8 lg:h-8 bg-white/20 rounded-full flex items-center justify-center shrink-0">
            {icon}
          </div>
        </div>
      </div>
    </div>
  );
}

function QuickActionFAB({ onAdd }: { onAdd: (type: 'income' | 'expense') => void }) {
  const [isOpen, setIsOpen] = useState(false);
  
  return (
    <div className="hidden lg:block fixed bottom-8 right-8 z-40">
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.5, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.5, y: 20 }}
            className="absolute bottom-20 right-0 flex flex-col gap-3 items-end"
          >
            <ActionButton label="Pemasukan" onClick={() => { onAdd('income'); setIsOpen(false); }} />
            <ActionButton label="Pengeluaran" onClick={() => { onAdd('expense'); setIsOpen(false); }} />
          </motion.div>
        )}
      </AnimatePresence>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-16 h-16 bg-primary-600 rounded-full flex items-center justify-center text-white shadow-2xl shadow-primary-600/40 hover:scale-110 active:scale-95 transition-all"
      >
        {isOpen ? <X /> : <Plus size={32} />}
      </button>
    </div>
  );
}

function ActionButton({ label, onClick }: { label: string, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className="px-6 py-3 bg-white text-slate-800 rounded-2xl shadow-xl border border-slate-100 font-bold hover:bg-slate-50 transition-all whitespace-nowrap"
    >
      {label}
    </button>
  );
}

function TransactionModal({ 
  onClose, 
  user, 
  editingTransaction,
  defaultType = 'expense'
}: { 
  onClose: () => void, 
  user: User, 
  editingTransaction: Transaction | null,
  defaultType?: 'income' | 'expense'
}) {
  const [type, setType] = useState<'income' | 'expense'>(editingTransaction?.type || defaultType);
  const [formData, setFormData] = useState({
    amount: editingTransaction?.amount.toString() || '',
    category: editingTransaction?.category || '',
    date: editingTransaction?.date || format(new Date(), 'yyyy-MM-dd'),
    note: editingTransaction?.note || ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        userId: user.uid,
        userEmail: user.email || '',
        type,
        amount: Number(formData.amount),
        category: formData.category,
        date: formData.date,
        note: formData.note,
        createdAt: serverTimestamp()
      };

      if (editingTransaction) {
        await updateDoc(doc(db, 'transactions', editingTransaction.id), {
          ...payload,
          createdAt: editingTransaction.createdAt // Keep original
        });
      } else {
        await addDoc(collection(db, 'transactions'), payload);
      }
      onClose();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'transactions');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white w-full max-w-lg rounded-[2rem] overflow-hidden shadow-2xl"
      >
        <div className="p-8">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-2xl font-bold">{editingTransaction ? 'Edit Transaksi' : 'Transaksi Baru'}</h2>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors"><X /></button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="flex p-1 bg-slate-100 rounded-2xl">
              <button 
                type="button"
                onClick={() => setType('income')}
                className={cn("flex-1 py-3 rounded-xl font-bold transition-all", type === 'income' ? "bg-white text-green-600 shadow-sm" : "text-slate-500")}
              >Pemasukan</button>
              <button 
                type="button"
                onClick={() => setType('expense')}
                className={cn("flex-1 py-3 rounded-xl font-bold transition-all", type === 'expense' ? "bg-white text-red-600 shadow-sm" : "text-slate-500")}
              >Pengeluaran</button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-500 mb-2">Jumlah (Rp)</label>
                <input 
                  type="number" 
                  autoFocus
                  required
                  value={formData.amount}
                  onChange={e => setFormData({...formData, amount: e.target.value})}
                  className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent focus:border-primary-600 rounded-2xl outline-none text-xl font-bold transition-all" 
                  placeholder="0"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-500 mb-2">Kategori</label>
                  <div className="flex gap-2">
                    <select 
                      required
                      value={formData.category}
                      onChange={e => setFormData({...formData, category: e.target.value})}
                      className="flex-1 px-4 py-4 bg-slate-50 border-2 border-transparent focus:border-primary-600 rounded-2xl outline-none font-medium"
                    >
                      <option value="">Pilih Kategori</option>
                      <option value="Makanan">Makanan</option>
                      <option value="Gaji">Gaji</option>
                      <option value="Transport">Transport</option>
                      <option value="Hiburan">Hiburan</option>
                      <option value="Kesehatan">Kesehatan</option>
                      <option value="Belanja">Belanja</option>
                      <option value="Investasi">Investasi</option>
                      <option value="Kebutuhan">Kebutuhan</option>
                      {formData.category && !["Makanan", "Gaji", "Transport", "Hiburan", "Kesehatan", "Belanja", "Investasi", "Kebutuhan"].includes(formData.category) && (
                        <option value={formData.category}>{formData.category}</option>
                      )}
                      <option value="custom">+ Tambah Baru</option>
                    </select>
                    {formData.category === 'custom' && (
                      <input 
                        type="text"
                        placeholder="Nama Kategori"
                        autoFocus
                        onBlur={e => {
                          if (e.target.value) setFormData({...formData, category: e.target.value});
                          else setFormData({...formData, category: ''});
                        }}
                        className="flex-1 px-4 py-4 bg-slate-50 border-2 border-primary-600 rounded-2xl outline-none font-medium"
                      />
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-500 mb-2">Tanggal</label>
                  <input 
                    type="date" 
                    required
                    value={formData.date}
                    onChange={e => setFormData({...formData, date: e.target.value})}
                    className="w-full px-4 py-4 bg-slate-50 border-2 border-transparent focus:border-primary-600 rounded-2xl outline-none font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-500 mb-2">Catatan (Opsional)</label>
                <textarea 
                  value={formData.note}
                  onChange={e => setFormData({...formData, note: e.target.value})}
                  className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent focus:border-primary-600 rounded-2xl outline-none font-medium min-h-[100px] resize-none"
                  placeholder="Tambahkan detail..."
                />
              </div>
            </div>

            <button type="submit" className="w-full py-5 bg-primary-600 text-white rounded-3xl font-black text-lg shadow-xl shadow-primary-600/30 hover:scale-[1.02] active:scale-95 transition-all">
              SIMPAN DATA
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}

function BudgetModal({ onClose, user, editingBudget }: { onClose: () => void, user: User, editingBudget: Budget | null }) {
  const [formData, setFormData] = useState({
    amount: editingBudget?.amount.toString() || '',
    category: editingBudget?.category || '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        userId: user.uid,
        userEmail: user.email || '',
        amount: Number(formData.amount),
        category: formData.category,
        createdAt: serverTimestamp()
      };

      if (editingBudget) {
        await updateDoc(doc(db, 'budgets', editingBudget.id), {
          amount: payload.amount,
          category: payload.category
        });
      } else {
        await addDoc(collection(db, 'budgets'), payload);
      }
      onClose();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'budgets');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white w-full max-w-md rounded-[2.5rem] overflow-hidden shadow-2xl"
      >
        <div className="p-10">
          <div className="flex justify-between items-center mb-10">
            <h2 className="text-2xl font-bold">Set Anggaran</h2>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors"><X /></button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-bold text-slate-400 mb-3 ml-2 uppercase tracking-widest">Kategori</label>
                <select 
                  required
                  value={formData.category}
                  onChange={e => setFormData({...formData, category: e.target.value})}
                  className="w-full px-6 py-5 bg-slate-50 border-2 border-transparent focus:border-primary-600 rounded-2xl outline-none font-bold text-lg"
                >
                  <option value="">Pilih Kategori</option>
                  <option value="Makanan">Makanan</option>
                  <option value="Transport">Transport</option>
                  <option value="Hiburan">Hiburan</option>
                  <option value="Kesehatan">Kesehatan</option>
                  <option value="Belanja">Belanja</option>
                  <option value="Investasi">Investasi</option>
                  <option value="Lainnya">Lainnya</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-400 mb-3 ml-2 uppercase tracking-widest">Limit Saldo (Rp)</label>
                <input 
                  type="number" 
                  required
                  value={formData.amount}
                  onChange={e => setFormData({...formData, amount: e.target.value})}
                  className="w-full px-6 py-5 bg-slate-50 border-2 border-transparent focus:border-primary-600 rounded-2xl outline-none text-2xl font-black" 
                  placeholder="Maksimal..."
                />
              </div>
            </div>

            <button type="submit" className="w-full py-5 bg-slate-900 text-white rounded-3xl font-black text-lg shadow-2xl shadow-slate-900/30 hover:scale-[1.02] active:scale-[0.98] transition-all">
              TETAPKAN LIMIT
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}

function AuthScreen() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const { user } = await createUserWithEmailAndPassword(auth, email, password);
        await setDoc(doc(db, 'users', user.uid), {
          email,
          createdAt: serverTimestamp()
        });
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      const { user } = await signInWithPopup(auth, provider);
      await setDoc(doc(db, 'users', user.uid), {
        email: user.email,
        name: user.displayName,
        createdAt: serverTimestamp()
      }, { merge: true });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-primary-600 flex items-center justify-center p-6 relative overflow-hidden">
      {/* Decorative Orbs */}
      <div className="absolute top-0 left-0 w-96 h-96 bg-white/10 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2"></div>
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-primary-700 rounded-full blur-3xl translate-x-1/3 translate-y-1/3"></div>

      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md bg-white rounded-[40px] p-10 shadow-2xl relative z-10"
      >
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-primary-600 rounded-2xl mx-auto flex items-center justify-center text-white shadow-xl mb-6">
            <Wallet size={32} />
          </div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">SIMANDU</h1>
          <p className="text-slate-500 mt-2 font-medium">Atur keuanganmu lebih cerdas</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-widest">Alamat Email</label>
            <input 
              type="email" 
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent focus:border-primary-600 rounded-2xl outline-none font-semibold transition-all"
              placeholder="user@email.com"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-widest">Kata Sandi</label>
            <input 
              type="password" 
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent focus:border-primary-600 rounded-2xl outline-none font-semibold transition-all"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="p-4 bg-red-50 text-red-600 rounded-2xl text-sm font-medium border border-red-100 italic">
              {error}
            </div>
          )}

          <button 
            type="submit" 
            disabled={loading}
            className="w-full py-5 bg-primary-600 text-white rounded-3xl font-black text-lg shadow-xl shadow-primary-600/30 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            {loading ? 'SABAR YA...' : isLogin ? 'MASUK SEKARANG' : 'DAFTAR AKUN'}
          </button>
        </form>

        <div className="mt-6 flex items-center gap-4">
          <div className="flex-1 h-px bg-slate-200"></div>
          <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">ATAU</span>
          <div className="flex-1 h-px bg-slate-200"></div>
        </div>

        <button 
          onClick={handleGoogleLogin}
          disabled={loading}
          className="mt-6 w-full py-4 bg-white border-2 border-slate-100 text-slate-700 rounded-3xl font-bold shadow-sm hover:bg-slate-50 active:scale-95 transition-all flex items-center justify-center gap-3"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="currentColor"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="currentColor"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="currentColor"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Lanjutkan dengan Google
        </button>

        <div className="mt-8 text-center">
          <button 
            onClick={() => setIsLogin(!isLogin)}
            className="text-slate-500 font-bold hover:text-primary-600 transition-colors"
          >
            {isLogin ? 'Belum punya akun? Daftar' : 'Sudah punya akun? Masuk'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function AnalyticsView({ transactions }: { key?: string; transactions: Transaction[] }) {
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  // Extract all available months that have transactions
  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach(t => {
      const parsed = parseSafeDate(t.date);
      if (parsed) {
        set.add(`${parsed.year}-${String(parsed.month).padStart(2, '0')}`);
      }
    });
    return Array.from(set).sort().reverse();
  }, [transactions]);

  // Determine initial period: current month if it has expenses, else latest month with expenses, else 'all'
  const initialPeriod = useMemo(() => {
    const hasCurrentMonthExpense = transactions.some(t => {
      if (t.type !== 'expense') return false;
      const parsed = parseSafeDate(t.date);
      return parsed ? `${parsed.year}-${String(parsed.month).padStart(2, '0')}` === currentMonthKey : false;
    });
    if (hasCurrentMonthExpense) return currentMonthKey;
    if (availableMonths.length > 0) return availableMonths[0];
    return 'all';
  }, [transactions, availableMonths, currentMonthKey]);

  const [selectedPeriod, setSelectedPeriod] = useState<string>(initialPeriod);

  // Sync selectedPeriod if initialPeriod changes
  useEffect(() => {
    if (selectedPeriod !== 'all' && !availableMonths.includes(selectedPeriod)) {
      if (availableMonths.length > 0) setSelectedPeriod(availableMonths[0]);
      else setSelectedPeriod('all');
    }
  }, [availableMonths]);

  // Format month key for human reading: "2026-08" -> "Agustus 2026"
  const getPeriodLabel = (key: string) => {
    if (key === 'all') return `Semua Waktu (${transactions.filter(t => t.type === 'expense').length} Pengeluaran)`;
    const parts = key.split('-');
    if (parts.length === 2) {
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      return `${MONTH_NAMES_ID[m - 1]} ${y}`;
    }
    return key;
  };

  const pieData = useMemo(() => {
    const categories: Record<string, number> = {};
    const relevantExpenses = transactions.filter(t => {
      if (t.type !== 'expense') return false;
      if (selectedPeriod === 'all') return true;
      const parsed = parseSafeDate(t.date);
      if (!parsed) return false;
      return `${parsed.year}-${String(parsed.month).padStart(2, '0')}` === selectedPeriod;
    });

    relevantExpenses.forEach(t => {
      categories[t.category] = (categories[t.category] || 0) + t.amount;
    });

    return {
      labels: Object.keys(categories),
      datasets: [{
        data: Object.values(categories),
        backgroundColor: [
          '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#8b5cf6', '#3b82f6', '#14b8a6'
        ],
        borderWidth: 0,
      }],
      totalAmount: relevantExpenses.reduce((sum, t) => sum + t.amount, 0),
      count: relevantExpenses.length
    };
  }, [transactions, selectedPeriod]);

  const insights = useMemo(() => {
    if (pieData.labels.length === 0) return null;
    
    const categories = pieData.labels;
    const data = pieData.datasets[0].data as number[];
    
    let maxAmount = -1;
    let maxCategory = '';
    let totalExpense = 0;
    
    categories.forEach((cat, idx) => {
      const amount = data[idx];
      totalExpense += amount;
      if (amount > maxAmount) {
        maxAmount = amount;
        maxCategory = cat;
      }
    });

    if (totalExpense === 0) return null;
    const percentOfTotal = Math.round((maxAmount / totalExpense) * 100);
    
    let suggestion = '';
    let status: 'warning' | 'info' | 'success' = 'info';
    let icon = <AlertTriangle size={24} className="text-amber-500 shrink-0" />;
    
    if (percentOfTotal > 50) {
      status = 'warning';
      suggestion = `Pengeluaran untuk kategori ${maxCategory.toUpperCase()} sangat mendominasi (${percentOfTotal}% dari total pengeluaran). Tindakan yang disarankan: Evaluasi kembali pos pengeluaran ini, buat limit anggaran bulanan yang lebih ketat, dan alokasikan kelebihan dana ke tabungan darurat atau investasi.`;
      icon = <AlertTriangle size={24} className="text-amber-500 shrink-0" />;
    } else if (percentOfTotal > 30) {
      status = 'info';
      suggestion = `Pengeluaran terbesar pada periode ini adalah ${maxCategory.toUpperCase()} (${percentOfTotal}%). Pastikan pengeluaran ini sudah sesuai dengan prioritas kebutuhan pokok Anda.`;
      icon = <PieChart size={24} className="text-blue-500 shrink-0" />;
    } else {
      status = 'success';
      suggestion = 'Pola pengeluaran Anda terdistribusi dengan sangat seimbang dan sehat di berbagai kategori. Tidak ada satu pos yang membebani keuangan secara berlebihan. Pertahankan disiplin ini!';
      icon = <TrendingUp size={24} className="text-green-500 shrink-0" />;
    }
    
    return {
      maxCategory,
      percentOfTotal,
      maxAmount,
      totalExpense,
      suggestion,
      status,
      icon,
      statusColorClass: status === 'warning' 
        ? 'bg-amber-50 border-amber-200 text-amber-950' 
        : status === 'info' 
        ? 'bg-blue-50 border-blue-200 text-blue-950' 
        : 'bg-green-50 border-green-200 text-green-950'
    };
  }, [pieData]);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6 pb-10"
    >
      <div className="bg-white p-6 lg:p-8 rounded-[32px] shadow-sm border border-slate-100 space-y-6">
        {/* Header & Period Selector */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <h3 className="text-xl font-bold text-slate-800">Analisa Pengeluaran</h3>
            <p className="text-xs text-slate-500 mt-0.5">Analisis pola belanja dan rekomendasi penghematan cerdas</p>
          </div>

          {/* Month / Period Picker Dropdown */}
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider shrink-0">Periode:</span>
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="flex-1 sm:flex-none px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-bold text-slate-700 outline-none focus:border-[#2563EB] shadow-sm cursor-pointer"
            >
              <option value="all">Semua Waktu</option>
              {availableMonths.map(m => (
                <option key={m} value={m}>{getPeriodLabel(m)}</option>
              ))}
            </select>
          </div>
        </div>

        {pieData.labels.length > 0 ? (
          <>
            <div className="flex flex-col lg:flex-row items-center gap-8 lg:gap-12">
              <div className="h-72 w-full lg:w-1/2 flex flex-col items-center justify-center relative">
                <div className="w-full h-full">
                  <Pie 
                    data={pieData} 
                    options={{
                      plugins: { legend: { display: false } },
                      maintainAspectRatio: false
                    }} 
                  />
                </div>
                <div className="mt-2 text-center">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Pengeluaran Periode</p>
                  <p className="text-lg font-black text-[#EF4444]">{formatCurrency(pieData.totalAmount)}</p>
                </div>
              </div>

              <div className="w-full lg:w-1/2 space-y-3 max-h-80 overflow-y-auto pr-1">
                {pieData.labels.map((label, idx) => {
                  const val = pieData.datasets[0].data[idx] as number;
                  const pct = Math.round((val / (pieData.totalAmount || 1)) * 100);
                  const color = pieData.datasets[0].backgroundColor[idx] as string;
                  return (
                    <div key={label} className="p-3.5 bg-slate-50/80 rounded-2xl border border-slate-100 flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div 
                            className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm" 
                            style={{ backgroundColor: color }}
                          ></div>
                          <span className="font-bold text-slate-800 uppercase text-xs sm:text-sm">{label}</span>
                        </div>
                        <div className="text-right">
                          <span className="font-black text-[#EF4444] text-xs sm:text-sm">
                            {formatCurrency(val)}
                          </span>
                          <span className="text-[11px] font-bold text-slate-400 ml-1.5">({pct}%)</span>
                        </div>
                      </div>
                      <div className="h-1.5 w-full bg-slate-200/60 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }}></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Smart Financial Advice Card */}
            {insights && (
              <div className={cn("p-5 sm:p-6 rounded-2xl border flex flex-col sm:flex-row gap-4 items-start shadow-sm", insights.statusColorClass)}>
                {insights.icon}
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-black text-sm sm:text-base">Insight & Evaluasi Keuangan</h4>
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider",
                      insights.status === 'warning' ? "bg-amber-200 text-amber-900" : insights.status === 'info' ? "bg-blue-200 text-blue-900" : "bg-green-200 text-green-900"
                    )}>
                      {insights.status === 'warning' ? 'Perhatian / Boros' : insights.status === 'info' ? 'Perlu Dipantau' : 'Stabil & Sehat'}
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm leading-relaxed opacity-90">{insights.suggestion}</p>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="h-64 flex flex-col items-center justify-center text-slate-400 space-y-3 bg-slate-50/70 rounded-3xl border border-dashed border-slate-200 p-8 text-center">
            <PieChart size={48} className="opacity-20" />
            <p className="font-bold text-slate-600">Belum ada data pengeluaran untuk {getPeriodLabel(selectedPeriod)}</p>
            {availableMonths.length > 0 && selectedPeriod !== 'all' && (
              <button
                onClick={() => setSelectedPeriod('all')}
                className="text-xs text-[#2563EB] font-bold hover:underline"
              >
                Lihat Analisa Semua Waktu
              </button>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

