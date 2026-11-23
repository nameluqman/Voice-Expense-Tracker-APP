import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, } from 'react-native';
import { AudioModule, RecordingPresets, useAudioRecorder } from 'expo-audio';
// @ts-ignore - @expo/vector-icons may be provided by Expo runtime even if types are unavailable in this environment
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, G, Line, Path, Polyline, Text as SvgText } from 'react-native-svg';
import axios from 'axios';

type AuthUser = {
  id?: string;
  _id?: string;
  name?: string;
  email?: string;
};

type ExpenseType = 'expense' | 'income' | 'savings';
type AnalyticsRange = 'This Month' | '3M' | '6M' | 'Year';

type Expense = {
  _id: string;
  item: string;
  amount: number;
  category: string;
  type?: ExpenseType;
  rawText?: string;
  date?: string;
  month?: number;
  year?: number;
};

type Budget = {
  _id: string;
  name: string;
  limit: number;
  icon?: string;
  color?: string;
  month?: number;
  year?: number;
};

type UpcomingBill = {
  _id: string;
  title: string;
  amount: number;
  dueDate: string;
  isPaid: boolean;
};

type TabKey = 'Home' | 'Transactions' | 'Analytics' | 'Budgets';

const getBackendUrl = () => {
  const hostUri = Constants.expoConfig?.hostUri ?? Constants.experienceUrl;
  const host = hostUri
    ? hostUri.replace(/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//, '').split(':')[0]
    : null;
  if (host && host !== 'localhost' && host !== '127.0.0.1') {
    return `http://${host}:5000`;
  }
  if (host === 'localhost' || host === '127.0.0.1') {
    return `http://${host}:5000`;
  }
  return Platform.OS === 'android' ? 'http://10.0.2.2:5000' : 'http://localhost:5000';
};

const BACKEND_URL = getBackendUrl();
const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';
const THEME_KEY = 'app_theme';
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

type ThemeMode = 'dark' | 'light';

const darkTheme = {
  mode: 'dark' as ThemeMode,
  bg: '#12161D',
  card: '#1C222D',
  cardAlt: '#232B39',
  border: '#2B3445',
  text: '#F8FAFC',
  muted: '#94A3B8',
  track: '#0F141C',
  navBg: '#10151D',
  navBorder: '#2B3445',
  overlay: 'rgba(0,0,0,0.55)',
  green: '#22C55E',
  amber: '#F59E0B',
  red: '#EF4444',
  blue: '#3B82F6',
};

const lightTheme = {
  mode: 'light' as ThemeMode,
  bg: '#F5F7FA',
  card: '#FFFFFF',
  cardAlt: '#F1F5F9',
  border: '#D7DEE8',
  text: '#0F172A',
  muted: '#64748B',
  track: '#E2E8F0',
  navBg: '#FFFFFF',
  navBorder: '#D7DEE8',
  overlay: 'rgba(15,23,42,0.35)',
  green: '#22C55E',
  amber: '#F59E0B',
  red: '#EF4444',
  blue: '#3B82F6',
};

const getExpenseType = (expense: Expense): ExpenseType => {
  if (expense.type === 'income' || expense.type === 'savings' || expense.type === 'expense') {
    return expense.type;
  }
  const cat = String(expense.category || '').toLowerCase();
  if (cat === 'savings') return 'savings';
  if (cat === 'income') return 'income';
  return 'expense';
};

const getExpenseMonthYear = (expense: Expense) => {
  if (expense.month && expense.year) {
    return { month: Number(expense.month), year: Number(expense.year) };
  }
  const d = expense.date ? new Date(expense.date) : new Date();
  return { month: d.getMonth() + 1, year: d.getFullYear() };
};

const CURRENCY_STORAGE_KEY = 'app_currency';
const DEFAULT_CURRENCY = 'PKR';
const FALLBACK_CURRENCY_CODES = [
  'AED','AFN','ALL','AMD','ANG','AOA','ARS','AUD','AWG','AZN','BAM','BBD','BDT','BGN','BHD','BIF','BMD','BND','BOB','BRL',
  'BSD','BTN','BWP','BYN','BZD','CAD','CDF','CHF','CLP','CNY','COP','CRC','CUP','CVE','CZK','DJF','DKK','DOP','DZD','EGP',
  'ERN','ETB','EUR','FJD','FKP','FOK','GBP','GEL','GGP','GHS','GIP','GMD','GNF','GTQ','GYD','HKD','HNL','HRK','HTG','HUF',
  'IDR','ILS','IMP','INR','IQD','IRR','ISK','JEP','JMD','JOD','JPY','KES','KGS','KHR','KID','KMF','KRW','KWD','KYD','KZT',
  'LAK','LBP','LKR','LRD','LSL','LYD','MAD','MDL','MGA','MKD','MMK','MNT','MOP','MRU','MUR','MVR','MWK','MXN','MYR','MZN',
  'NAD','NGN','NIO','NOK','NPR','NZD','OMR','PAB','PEN','PGK','PHP','PKR','PLN','PYG','QAR','RON','RSD','RUB','RWF','SAR',
  'SBD','SCR','SDG','SEK','SGD','SHP','SLE','SOS','SRD','SSP','STN','SYP','SZL','THB','TJS','TMT','TND','TOP','TRY','TTD',
  'TVD','TWD','TZS','UAH','UGX','USD','UYU','UZS','VES','VND','VUV','WST','XAF','XCD','XCG','XDR','XOF','XPF','YER','ZAR',
  'ZMW','ZWL'
];

const getSupportedCurrencyCodes = (): string[] => {
  try {
    const intlAny = Intl as any;
    if (typeof intlAny?.supportedValuesOf === 'function') {
      const codes = intlAny.supportedValuesOf('currency');
      if (Array.isArray(codes) && codes.length > 0) {
        return Array.from(new Set(codes.map((c: string) => String(c).toUpperCase()))).sort();
      }
    }
  } catch {}
  return FALLBACK_CURRENCY_CODES;
};

const formatCurrency = (value: number, currencyCode: string = DEFAULT_CURRENCY) => {
  const amount = Number(value || 0);
  const code = (currencyCode || DEFAULT_CURRENCY).toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${code} ${amount.toLocaleString()}`;
  }
};

const formatDate = (value?: string) => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function App() {
  // Auth
  const [authReady, setAuthReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [nameInput, setNameInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Data
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [bills, setBills] = useState<UpcomingBill[]>([]);
  const [lastResult, setLastResult] = useState<any>(null);

  // UI state
  const [activeTab, setActiveTab] = useState<TabKey>('Home');
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [analyticsRange, setAnalyticsRange] = useState<AnalyticsRange>('This Month');
  const [isRecording, setIsRecording] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
  const [currencyCode, setCurrencyCode] = useState<string>(DEFAULT_CURRENCY);
  const [currencyModalVisible, setCurrencyModalVisible] = useState(false);
  const [currencySearch, setCurrencySearch] = useState('');

  // Edit/Add expense modal
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [editItem, setEditItem] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editType, setEditType] = useState<ExpenseType>('expense');

  // Budget modal
  const [budgetModalVisible, setBudgetModalVisible] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [budgetName, setBudgetName] = useState('');
  const [budgetLimit, setBudgetLimit] = useState('');
  const [budgetIcon, setBudgetIcon] = useState('');
  const [budgetColor, setBudgetColor] = useState('');

  // Bill modal
  const [billModalVisible, setBillModalVisible] = useState(false);
  const [billTitle, setBillTitle] = useState('');
  const [billAmount, setBillAmount] = useState('');
  const [billDueDate, setBillDueDate] = useState('');

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const authHeaders: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  const theme = themeMode === 'dark' ? darkTheme : lightTheme;
  const money = (value: number) => formatCurrency(value, currencyCode);
  const currencyOptions = getSupportedCurrencyCodes();
  const filteredCurrencyOptions = currencyOptions.filter((c) =>
    c.toLowerCase().includes(currencySearch.trim().toLowerCase())
  );

  const saveCurrency = async (code: string) => {
    const next = String(code || DEFAULT_CURRENCY).toUpperCase();
    setCurrencyCode(next);
    setCurrencyModalVisible(false);
    setCurrencySearch('');
    try {
      await AsyncStorage.setItem(CURRENCY_STORAGE_KEY, next);
    } catch (err) {
      console.error('Currency save error:', err);
    }
  };

  const openAddTransactionModal = (presetType: ExpenseType = 'expense') => {
    setEditingExpense(null);
    setEditItem('');
    setEditAmount('');
    setEditCategory(presetType === 'income' ? 'Income' : presetType === 'savings' ? 'Savings' : '');
    setEditType(presetType);
    setEditModalVisible(true);
  };

  const toggleTheme = async () => {
    const next: ThemeMode = themeMode === 'dark' ? 'light' : 'dark';
    setThemeMode(next);
    try {
      await AsyncStorage.setItem(THEME_KEY, next);
    } catch (err) {
      console.error('Theme save error:', err);
    }
  };

  useEffect(() => {
    const initAuth = async () => {
      try {
        const [savedToken, savedUser, savedTheme, savedCurrency] = await Promise.all([
          AsyncStorage.getItem(TOKEN_KEY),
          AsyncStorage.getItem(USER_KEY),
          AsyncStorage.getItem(THEME_KEY),
          AsyncStorage.getItem(CURRENCY_STORAGE_KEY),
        ]);
        if (savedToken) setToken(savedToken);
        if (savedUser) setCurrentUser(JSON.parse(savedUser));
        if (savedTheme === 'light' || savedTheme === 'dark') setThemeMode(savedTheme);
        if (savedCurrency) setCurrencyCode(String(savedCurrency).toUpperCase());
      } catch (err) {
        console.error('Auth load error:', err);
      } finally {
        setAuthReady(true);
      }
    };

    initAuth();
    getPermissions();
  }, []);

  useEffect(() => {
    if (token) {
      fetchAllData(token);
    } else {
      setExpenses([]);
      setBudgets([]);
      setBills([]);
      setLastResult(null);
      setActiveTab('Home');
    }
  }, [token]);

  const getPermissions = async () => {
    try {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        Alert.alert(
          'Permission Required',
          'Microphone ki permission dena zaroori hai voice record karne ke liye!'
        );
      }
    } catch (err) {
      console.error('Permission error:', err);
    }
  };

  const handleAuthSubmit = async () => {
    const cleanEmail = emailInput.trim().toLowerCase();
    const cleanPassword = passwordInput;
    const cleanName = nameInput.trim();

    if (!cleanEmail || !cleanPassword || (authMode === 'register' && !cleanName)) {
      Alert.alert('Missing Fields', 'Baraye meherbani sab zaroori fields bharein.');
      return;
    }

    setAuthLoading(true);
    try {
      const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const payload =
        authMode === 'register'
          ? { name: cleanName, email: cleanEmail, password: cleanPassword }
          : { email: cleanEmail, password: cleanPassword };

      const res = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (res.ok && data.success && data.token) {
        await AsyncStorage.setItem(TOKEN_KEY, data.token);
        if (data.user) {
          await AsyncStorage.setItem(USER_KEY, JSON.stringify(data.user));
          setCurrentUser(data.user);
        }
        setToken(data.token);
        setPasswordInput('');
        setNameInput('');
      } else {
        Alert.alert('Auth Failed', data.error || 'Login/Register nahi ho saka.');
      }
    } catch (err) {
      console.error('Auth error:', err);
      Alert.alert('Error', 'Server se connect nahi ho saka.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
    } catch (err) {
      console.error('Logout storage error:', err);
    }
    setToken(null);
    setCurrentUser(null);
    setExpenses([]);
    setBudgets([]);
    setBills([]);
    setLastResult(null);
  };

  const handleUnauthorized = (err: any) => {
    if (err?.response?.status === 401) {
      handleLogout();
      return true;
    }
    return false;
  };

  const fetchExpenses = async (activeToken = token) => {
    if (!activeToken) return;
    const response = await axios.get(`${BACKEND_URL}/api/expenses`, {
      headers: { Authorization: `Bearer ${activeToken}` },
    });
    setExpenses(Array.isArray(response.data) ? response.data : []);
  };

  const fetchBudgets = async (activeToken = token) => {
    if (!activeToken) return;
    const response = await axios.get(`${BACKEND_URL}/api/budgets`, {
      headers: { Authorization: `Bearer ${activeToken}` },
    });
    setBudgets(Array.isArray(response.data) ? response.data : []);
  };

  const fetchBills = async (activeToken = token) => {
    if (!activeToken) return;
    const response = await axios.get(`${BACKEND_URL}/api/bills`, {
      headers: { Authorization: `Bearer ${activeToken}` },
    });
    setBills(Array.isArray(response.data) ? response.data : []);
  };

  const fetchAllData = async (activeToken = token) => {
    if (!activeToken) return;
    setInitialLoading(true);
    try {
      await Promise.all([
        fetchExpenses(activeToken),
        fetchBudgets(activeToken),
        fetchBills(activeToken),
      ]);
    } catch (err: any) {
      console.log('Fetch data error:', err);
      if (!handleUnauthorized(err)) {
        Alert.alert('Error', 'Data fetch karne mein masla aaya.');
      }
    } finally {
      setInitialLoading(false);
    }
  };

  const handleRecordToggle = async () => {
    if (!token) {
      Alert.alert('Login Required', 'Pehle apne account mein login karein.');
      return;
    }

    try {
      if (!isRecording) {
        await audioRecorder.prepareToRecordAsync();
        audioRecorder.record();
        setIsRecording(true);
      } else {
        await audioRecorder.stop();
        setIsRecording(false);
        const uri = audioRecorder.uri;
        if (uri) {
          await sendAudioToBackend(uri);
        }
      }
    } catch (error) {
      console.error('Recording toggle error:', error);
      Alert.alert('Error', 'Recording mein masla aaya hai.');
      setIsRecording(false);
    }
  };

  const sendAudioToBackend = async (uri: string) => {
    if (!token) return;
    setVoiceLoading(true);
    try {
      const formData = new FormData() as any;
      formData.append('audio', {
        uri,
        type: 'audio/m4a',
        name: 'expense_note.m4a',
      } as any);

      const response = await axios.post(`${BACKEND_URL}/api/voice-expense`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          ...authHeaders,
        },
      });

      setLastResult(response.data);
      Alert.alert('Kamyabi! 🎉', 'Voice note process aur save ho gaya hai!');
      await fetchExpenses(token);
    } catch (error: any) {
      console.error('Upload error:', error);
      if (!handleUnauthorized(error)) {
        Alert.alert(
          'Upload Failed',
          error?.response?.data?.error || error.message || 'Audio bhejne mein nakami.'
        );
      }
    } finally {
      setVoiceLoading(false);
    }
  };

  const handleDownloadExcel = async () => {
    if (!token) return;
    try {
      const exportUrl = `${BACKEND_URL}/export-excel`;
      const fileUri = (FileSystem as any).documentDirectory + 'Expense_Report.xlsx';

      const downloadRes = await FileSystem.downloadAsync(exportUrl, fileUri, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      if (downloadRes.status === 200) {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(downloadRes.uri, {
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            dialogTitle: 'Download ya Share karein Excel Report',
          });
        } else {
          Alert.alert('Saved', 'File save ho gayi hai: ' + downloadRes.uri);
        }
      } else {
        Alert.alert('Error', 'Excel download karne mein masla aaya.');
      }
    } catch (error) {
      console.error('Excel Download Error:', error);
      Alert.alert('Error', 'Server se Excel file nahi mil saki.');
    }
  };

  const openEditModal = (exp: Expense) => {
    setEditingExpense(exp);
    setEditItem(exp.item || '');
    setEditAmount(String(exp.amount ?? ''));
    setEditCategory(exp.category || 'General');
    setEditType(getExpenseType(exp));
    setEditModalVisible(true);
  };

  const handleSaveEdit = async () => {
    if (!token) return;
    const numericAmount = Number(editAmount);
    if (!editItem.trim() || Number.isNaN(numericAmount) || numericAmount <= 0) {
      Alert.alert('Invalid Input', 'Sahi item naam aur amount darj karein.');
      return;
    }

    const payload = {
      item: editItem.trim(),
      amount: numericAmount,
      category: editCategory.trim() || (editType === 'income' ? 'Income' : editType === 'savings' ? 'Savings' : 'General'),
      type: editType,
    };

    try {
      const isEdit = Boolean(editingExpense?._id);
      const url = isEdit
        ? `${BACKEND_URL}/api/expenses/${editingExpense!._id}`
        : `${BACKEND_URL}/api/expenses`;
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (res.ok && data.success && data.expense) {
        if (isEdit) {
          setExpenses((prev) => prev.map((item) => (item._id === editingExpense!._id ? data.expense : item)));
        } else {
          setExpenses((prev) => [data.expense, ...prev]);
          setActiveTab('Transactions');
        }
        setEditModalVisible(false);
        setEditingExpense(null);
      } else {
        Alert.alert('Error', data.error || (isEdit ? 'Update nahi ho saka' : 'Transaction add nahi ho saka'));
      }
    } catch (err) {
      console.error('Save transaction error:', err);
      Alert.alert('Error', 'Server par save nahi ho saka');
    }
  };

  const handleDeleteExpense = (id: string, itemName: string) => {
    if (!token) return;
    Alert.alert('Delete Expense', `Kya aap "${itemName}" ko delete karna chahte hain?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const res = await fetch(`${BACKEND_URL}/api/expenses/${id}`, {
              method: 'DELETE',
              headers: authHeaders,
            });
            const data = await res.json();
            if (res.ok && data.success) {
              setExpenses((prev) => prev.filter((item) => item._id !== id));
            } else {
              Alert.alert('Error', data.error || 'Delete nahi ho saka');
            }
          } catch (err) {
            console.error('Delete error:', err);
            Alert.alert('Error', 'Server se delete request fail ho gayi');
          }
        },
      },
    ]);
  };

  const openBudgetModal = (budget?: Budget) => {
    if (budget) {
      setEditingBudget(budget);
      setBudgetName(budget.name || '');
      setBudgetLimit(String(budget.limit ?? ''));
      setBudgetIcon(budget.icon || '');
      setBudgetColor(budget.color || '');
    } else {
      setEditingBudget(null);
      setBudgetName('');
      setBudgetLimit('');
      setBudgetIcon('');
      setBudgetColor('');
    }
    setBudgetModalVisible(true);
  };

  const saveBudget = async () => {
    if (!token) return;
    const name = budgetName.trim();
    const limit = Number(budgetLimit || 0);
    if (!name) {
      Alert.alert('Invalid Input', 'Budget/category name zaroori hai.');
      return;
    }
    try {
      const isEdit = Boolean(editingBudget?._id);
      const url = isEdit
        ? `${BACKEND_URL}/api/budgets/${editingBudget!._id}`
        : `${BACKEND_URL}/api/budgets`;
      const method = isEdit ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          name,
          limit: Number.isFinite(limit) ? limit : 0,
          icon: budgetIcon.trim(),
          color: budgetColor.trim(),
          month: selectedMonth,
          year: selectedYear,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        await fetchBudgets(token);
        setBudgetModalVisible(false);
      } else {
        Alert.alert('Error', data.error || 'Budget save nahi ho saka');
      }
    } catch (err) {
      console.error('Save budget error:', err);
      Alert.alert('Error', 'Budget save karne mein masla aaya');
    }
  };

  const deleteBudget = (budget: Budget) => {
    if (!token) return;
    Alert.alert('Delete Budget', `Delete "${budget.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const res = await fetch(`${BACKEND_URL}/api/budgets/${budget._id}`, {
              method: 'DELETE',
              headers: authHeaders,
            });
            const data = await res.json();
            if (res.ok && data.success) {
              setBudgets((prev) => prev.filter((b) => b._id !== budget._id));
            } else {
              Alert.alert('Error', data.error || 'Budget delete nahi ho saka');
            }
          } catch (err) {
            console.error('Delete budget error:', err);
            Alert.alert('Error', 'Budget delete request fail ho gayi');
          }
        },
      },
    ]);
  };

  const openBillModal = () => {
    setBillTitle('');
    setBillAmount('');
    setBillDueDate(new Date().toISOString().slice(0, 10));
    setBillModalVisible(true);
  };

  const saveBill = async () => {
    if (!token) return;
    const title = billTitle.trim();
    const amount = Number(billAmount || 0);
    const dueDate = new Date(billDueDate);
    if (!title || Number.isNaN(dueDate.getTime())) {
      Alert.alert('Invalid Input', 'Bill title aur valid due date (YYYY-MM-DD) zaroori hai.');
      return;
    }
    try {
      const res = await fetch(`${BACKEND_URL}/api/bills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ title, amount: Number.isFinite(amount) ? amount : 0, dueDate: dueDate.toISOString() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        await fetchBills(token);
        setBillModalVisible(false);
      } else {
        Alert.alert('Error', data.error || 'Bill save nahi ho saka');
      }
    } catch (err) {
      console.error('Save bill error:', err);
      Alert.alert('Error', 'Bill save karne mein masla aaya');
    }
  };

  const toggleBill = async (id: string) => {
    if (!token) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/bills/${id}/toggle`, {
        method: 'PATCH',
        headers: authHeaders,
      });
      const data = await res.json();
      if (res.ok && data.success && data.bill) {
        setBills((prev) => prev.map((b) => (b._id === id ? data.bill : b)));
      } else {
        Alert.alert('Error', data.error || 'Bill toggle nahi ho saka');
      }
    } catch (err) {
      console.error('Toggle bill error:', err);
      Alert.alert('Error', 'Bill toggle request fail ho gayi');
    }
  };

  const changeMonth = (delta: number) => {
    const d = new Date(selectedYear, selectedMonth - 1 + delta, 1);
    setSelectedMonth(d.getMonth() + 1);
    setSelectedYear(d.getFullYear());
  };

  const filteredExpenses = useMemo(() => {
    return expenses.filter((e) => {
      const { month, year } = getExpenseMonthYear(e);
      return month === selectedMonth && year === selectedYear;
    });
  }, [expenses, selectedMonth, selectedYear]);

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    let savings = 0;
    filteredExpenses.forEach((e) => {
      const t = getExpenseType(e);
      const amt = Number(e.amount || 0);
      if (t === 'income') income += amt;
      else if (t === 'savings') savings += amt;
      else expense += amt;
    });
    return { income, expense, savings, net: income - expense - savings };
  }, [filteredExpenses]);

  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, { category: string; amount: number; type: ExpenseType }>();
    filteredExpenses.forEach((e) => {
      const type = getExpenseType(e);
      if (type !== 'expense') return;
      const key = (e.category || 'General').trim() || 'General';
      const prev = map.get(key) || { category: key, amount: 0, type };
      prev.amount += Number(e.amount || 0);
      map.set(key, prev);
    });
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  }, [filteredExpenses]);

  const maxCategoryAmount = Math.max(1, ...categoryBreakdown.map((c) => c.amount));

  const budgetsForPeriod = useMemo(() => {
    return budgets.filter((b) => {
      const m = b.month ?? selectedMonth;
      const y = b.year ?? selectedYear;
      return m === selectedMonth && y === selectedYear;
    });
  }, [budgets, selectedMonth, selectedYear]);

  const monthLabel = `${MONTHS[selectedMonth - 1]} ${selectedYear}`;

  const totalAllocatedBudget = useMemo(
    () => budgetsForPeriod.reduce((sum, b) => sum + Number(b.limit || 0), 0),
    [budgetsForPeriod]
  );

  const spentByCategory = useMemo(() => {
    const map = new Map<string, number>();
    filteredExpenses.forEach((e) => {
      if (getExpenseType(e) !== 'expense') return;
      const key = (e.category || 'General').trim().toLowerCase() || 'general';
      map.set(key, (map.get(key) || 0) + Number(e.amount || 0));
    });
    return map;
  }, [filteredExpenses]);

  const remainingBudgetAmount = totalAllocatedBudget - totals.expense;

  const daysInSelectedMonth = new Date(selectedYear, selectedMonth, 0).getDate();
  const now = new Date();
  const isCurrentMonth = now.getFullYear() === selectedYear && now.getMonth() + 1 === selectedMonth;
  const isPastMonth =
    selectedYear < now.getFullYear() || (selectedYear === now.getFullYear() && selectedMonth < now.getMonth() + 1);
  const dayOfMonth = isCurrentMonth ? now.getDate() : isPastMonth ? daysInSelectedMonth : 0;
  const remainingDays = isCurrentMonth ? Math.max(0, daysInSelectedMonth - now.getDate() + 1) : isPastMonth ? 0 : daysInSelectedMonth;
  const safeToSpendPerDay = remainingDays > 0 ? Math.max(0, remainingBudgetAmount) / remainingDays : 0;

  const recentActivity = useMemo(() => {
    return [...filteredExpenses]
      .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
      .slice(0, 8);
  }, [filteredExpenses]);

  const topCategoryBars = useMemo(() => categoryBreakdown.slice(0, 5), [categoryBreakdown]);

  if (!authReady) {
    return (
      <View style={[styles.centeredLoader, { backgroundColor: theme.bg }]}>
        <ActivityIndicator size="large" color={theme.green} />
      </View>
    );
  }

  if (!token) {
    return (
      <ScrollView contentContainerStyle={[styles.authContainer, { backgroundColor: theme.bg }]}>
        <View style={styles.authHeader}>
          <TouchableOpacity
            style={[styles.iconBtn, { alignSelf: 'flex-end', backgroundColor: theme.cardAlt, borderColor: theme.border }]}
            onPress={toggleTheme}
          >
            <Ionicons name={themeMode === 'dark' ? 'sunny' : 'moon'} size={18} color={theme.text} />
          </TouchableOpacity>
          <Text style={[styles.brandTitle, { color: theme.text }]}>AI Voice Finance</Text>
          <Text style={[styles.brandSubtitle, { color: theme.muted }]}>
            {authMode === 'login' ? 'Apne account mein login karein' : 'Naya personal account banayein'}
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          {authMode === 'register' && (
            <>
              <Text style={[styles.label, { color: theme.muted }]}>Full Name</Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.cardAlt, borderColor: theme.border, color: theme.text }]}
                value={nameInput}
                onChangeText={setNameInput}
                placeholder="e.g. Luqman Khan"
                placeholderTextColor={theme.muted}
              />
            </>
          )}

          <Text style={[styles.label, { color: theme.muted }]}>Email</Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.cardAlt, borderColor: theme.border, color: theme.text }]}
            value={emailInput}
            onChangeText={setEmailInput}
            placeholder="name@example.com"
            placeholderTextColor={theme.muted}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <Text style={[styles.label, { color: theme.muted }]}>Password</Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.cardAlt, borderColor: theme.border, color: theme.text }]}
            value={passwordInput}
            onChangeText={setPasswordInput}
            placeholder="Kam se kam 6 characters"
            placeholderTextColor={theme.muted}
            secureTextEntry
          />

          <TouchableOpacity style={styles.primaryBtn} onPress={handleAuthSubmit} disabled={authLoading}>
            {authLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>{authMode === 'login' ? 'Login' : 'Create Account'}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.linkBtn}
            onPress={() => setAuthMode((prev) => (prev === 'login' ? 'register' : 'login'))}
          >
            <Text style={[styles.linkBtnText, { color: theme.blue }]}>
              {authMode === 'login' ? 'Account nahi hai? Register karein' : 'Pehle se account hai? Login karein'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  const renderProgressRow = (
    label: string,
    amount: number,
    total: number,
    color: string,
    subtitle?: string
  ) => {
    const pct = total > 0 ? Math.min(100, Math.round((amount / total) * 100)) : 0;
    return (
      <View style={styles.progressBlock} key={`${label}-${subtitle || ''}`}>
        <View style={styles.progressHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.progressLabel, { color: theme.text }]}>{label}</Text>
            {subtitle ? <Text style={[styles.progressSub, { color: theme.muted }]}>{subtitle}</Text> : null}
          </View>
          <Text style={[styles.progressValue, { color: theme.text }]}>{money(amount)}</Text>
        </View>
        <View style={[styles.progressTrack, { backgroundColor: theme.track, borderColor: theme.border }]}>
          <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: color }]} />
        </View>
        <Text style={[styles.progressPct, { color: theme.muted }]}>{pct}%</Text>
      </View>
    );
  };

  const getMonthsForRange = (endMonth: number, endYear: number, range: AnalyticsRange) => {
    const count = range === 'This Month' ? 1 : range === '3M' ? 3 : range === '6M' ? 6 : 12;
    const months: { month: number; year: number }[] = [];
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(endYear, endMonth - 1 - i, 1);
      months.push({ month: d.getMonth() + 1, year: d.getFullYear() });
    }
    return months;
  };

  const isInMonthList = (month: number, year: number, list: { month: number; year: number }[]) =>
    list.some((m) => m.month === month && m.year === year);

  const getRangeDateBounds = (list: { month: number; year: number }[]) => {
    const first = list[0];
    const last = list[list.length - 1];
    const start = new Date(first.year, first.month - 1, 1);
    const end = new Date(last.year, last.month, 0);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  };

  const daysBetweenInclusive = (start: Date, end: Date) => {
    const a = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
    const b = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
    return Math.max(1, Math.round((b - a) / 86400000) + 1);
  };

  const polarToCartesian = (cx: number, cy: number, r: number, angleDeg: number) => {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  const donutSlicePath = (cx: number, cy: number, r: number, innerR: number, startAngle: number, endAngle: number) => {
    const sweep = Math.max(0, endAngle - startAngle);
    if (sweep <= 0) return '';
    if (sweep >= 359.999) {
      const outer = `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.001} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy - r}`;
      const inner = `M ${cx} ${cy - innerR} A ${innerR} ${innerR} 0 1 0 ${cx - 0.001} ${cy - innerR} A ${innerR} ${innerR} 0 1 0 ${cx} ${cy - innerR}`;
      return `${outer} ${inner} Z`;
    }
    const startOuter = polarToCartesian(cx, cy, r, endAngle);
    const endOuter = polarToCartesian(cx, cy, r, startAngle);
    const startInner = polarToCartesian(cx, cy, innerR, startAngle);
    const endInner = polarToCartesian(cx, cy, innerR, endAngle);
    const largeArc = sweep > 180 ? 1 : 0;
    return `M ${startOuter.x} ${startOuter.y} A ${r} ${r} 0 ${largeArc} 0 ${endOuter.x} ${endOuter.y} L ${startInner.x} ${startInner.y} A ${innerR} ${innerR} 0 ${largeArc} 1 ${endInner.x} ${endInner.y} Z`;
  };

  const renderHome = () => {
    const dayProgressPct = daysInSelectedMonth > 0 ? Math.min(100, Math.round((dayOfMonth / daysInSelectedMonth) * 100)) : 0;
    const remainingColor = remainingBudgetAmount >= 0 ? theme.green : theme.red;
    const budgetForCategory = (name: string) =>
      budgetsForPeriod.find((b) => (b.name || '').trim().toLowerCase() === (name || '').trim().toLowerCase());

    return (
      <ScrollView contentContainerStyle={styles.tabContent} showsVerticalScrollIndicator={false}>
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>Remaining Budget</Text>
          <Text style={[styles.heroAmount, { color: theme.text, marginTop: 4 }]}>
            {money(remainingBudgetAmount)} <Text style={{ color: theme.muted, fontSize: 16, fontWeight: '600' }}>left</Text>
          </Text>
          <Text style={[styles.mutedTextSmall, { color: theme.muted, marginTop: 4 }]}>
            Safe to spend: {money(Math.max(0, Math.floor(safeToSpendPerDay)))} / day
          </Text>
          <View style={{ marginTop: 12 }}>
            <View style={[styles.progressTrack, { backgroundColor: theme.track, borderColor: theme.border, height: 10 }]}>
              <View style={[styles.progressFill, { width: `${dayProgressPct}%`, backgroundColor: remainingColor }]} />
            </View>
            <View style={[styles.progressMetaRow, { marginTop: 8 }]}>
              <Text style={[styles.mutedTextSmall, { color: remainingColor, fontWeight: '700' }]}>{dayProgressPct}% of month</Text>
              <Text style={[styles.mutedTextSmall, { color: theme.muted }]}>Day {dayOfMonth} of {daysInSelectedMonth}</Text>
            </View>
          </View>
          <Text style={[styles.mutedTextSmall, { color: theme.muted, marginTop: 8 }]}>
            Allocated: {money(totalAllocatedBudget)} ? Expenses: {money(totals.expense)}
          </Text>
        </View>

        <View style={[styles.stripCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          {[
            { label: 'Income', value: totals.income, color: theme.green, type: 'income' as ExpenseType },
            { label: 'Expenses', value: totals.expense, color: theme.red, type: 'expense' as ExpenseType },
            { label: 'Saved', value: totals.savings, color: theme.blue, type: 'savings' as ExpenseType },
          ].map((box, idx, arr) => (
            <React.Fragment key={box.label}>
              <TouchableOpacity
                style={styles.stripCol}
                activeOpacity={0.75}
                onPress={() => openAddTransactionModal(box.type)}
              >
                <Text style={[styles.statLabel, { color: theme.muted, textAlign: 'center' }]}>{box.label}</Text>
                <Text style={[styles.summaryValue, { color: box.color, textAlign: 'center' }]}>{money(box.value)}</Text>
                <Text style={[styles.mutedTextSmall, { color: theme.muted, textAlign: 'center', marginTop: 2 }]}>Tap to add</Text>
              </TouchableOpacity>
              {idx < arr.length - 1 ? <View style={[styles.stripDivider, { backgroundColor: theme.border }]} /> : null}
            </React.Fragment>
          ))}
        </View>

        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>Top Categories</Text>
          {topCategoryBars.length === 0 ? (
            <Text style={[styles.mutedText, { color: theme.muted, marginTop: 6 }]}>No expense categories for this month.</Text>
          ) : (
            <View style={{ marginTop: 8, gap: 14 }}>
              {topCategoryBars.map((c, idx) => {
                const budget = budgetForCategory(c.category);
                const limit = Number(budget?.limit || 0);
                const denom = limit > 0 ? limit : Math.max(c.amount, 1);
                const pct = Math.max(0, Math.min(100, Math.round((c.amount / denom) * 100)));
                const colors = [theme.green, theme.amber, theme.blue, theme.red];
                const barColor = budget?.color || colors[idx % colors.length];
                return (
                  <View key={`${c.category}-${idx}`}>
                    <View style={styles.categoryHeaderRow}>
                      <Text style={[styles.itemTitle, { color: theme.text, flex: 1 }]} numberOfLines={1}>{c.category}</Text>
                      <Text style={[styles.mutedTextSmall, { color: theme.muted }]}>
                        {money(c.amount)}{limit > 0 ? ` / ${money(limit)}` : ''}
                      </Text>
                    </View>
                    <View style={[styles.progressTrack, { backgroundColor: theme.track, borderColor: theme.border, marginTop: 8 }]}>
                      <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: barColor }]} />
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={styles.cardHeaderRow}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>Upcoming Bills</Text>
            <TouchableOpacity style={[styles.secondaryBtn, { backgroundColor: theme.cardAlt, borderColor: theme.border }]} onPress={openBillModal}>
              <Text style={[styles.secondaryBtnText, { color: theme.text }]}>+ Add Bill</Text>
            </TouchableOpacity>
          </View>
          {bills.length === 0 ? (
            <Text style={[styles.mutedText, { color: theme.muted }]}>Koi upcoming bill nahi hai.</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalCardsRow}>
              {bills.map((bill) => (
                <TouchableOpacity
                  key={bill._id}
                  style={[styles.billCardH, { backgroundColor: theme.cardAlt, borderColor: theme.border }]}
                  onPress={() => toggleBill(bill._id)}
                  activeOpacity={0.85}
                >
                  <View style={styles.billCardTopRow}>
                    <Ionicons name={bill.isPaid ? 'checkmark-circle' : 'receipt-outline'} size={18} color={bill.isPaid ? theme.green : theme.amber} />
                    <Text style={[styles.itemTitle, { color: theme.text, flex: 1 }, bill.isPaid && styles.strikeText]} numberOfLines={1}>{bill.title}</Text>
                  </View>
                  <Text style={[styles.mutedTextSmall, { color: theme.muted, marginTop: 8 }]}>
                    {formatDate(bill.dueDate)} ? {money(Number(bill.amount || 0))}
                  </Text>
                  <Text style={[styles.mutedTextSmall, { color: bill.isPaid ? theme.green : theme.amber, marginTop: 4, fontWeight: '600' }]}>
                    {bill.isPaid ? 'Paid' : 'Tap to mark paid'}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>

        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={styles.cardHeaderRow}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>Recent Activity</Text>
            <TouchableOpacity style={[styles.secondaryBtn, { backgroundColor: theme.cardAlt, borderColor: theme.border }]} onPress={handleDownloadExcel}>
              <Text style={[styles.secondaryBtnText, { color: theme.text }]}>Export</Text>
            </TouchableOpacity>
          </View>
          {recentActivity.length === 0 ? (
            <Text style={[styles.mutedText, { color: theme.muted }]}>Is month mein koi activity nahi hai.</Text>
          ) : (
            recentActivity.map((exp) => {
              const type = getExpenseType(exp);
              const isIncome = type === 'income';
              const sign = isIncome ? '+' : '-';
              const color = isIncome ? theme.green : theme.red;
              return (
                <View key={exp._id} style={[styles.listRow, { borderBottomColor: theme.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.itemTitle, { color: theme.text }]}>{exp.item}</Text>
                    <Text style={[styles.mutedTextSmall, { color: theme.muted }]}>{exp.category} ? {formatDate(exp.date)}</Text>
                  </View>
                  <Text style={[styles.amountText, { color }]}>{sign} {money(Number(exp.amount || 0))}</Text>
                </View>
              );
            })
          )}
        </View>

        {lastResult ? (
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>Last Voice Result</Text>
            <Text style={[styles.mutedText, { color: theme.muted }]}>{`??? "${lastResult.spokenText}"`}</Text>
            <Text style={[styles.mutedTextSmall, { color: theme.muted }]}>
              Saved records: {Array.isArray(lastResult.savedRecords) ? lastResult.savedRecords.length : 0}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    );
  };

  const renderTransactions = () => (
    <ScrollView contentContainerStyle={styles.tabContent} showsVerticalScrollIndicator={false}>
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <View style={styles.cardHeaderRow}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>Transactions</Text>
          <TouchableOpacity style={[styles.secondaryBtn, { backgroundColor: theme.cardAlt, borderColor: theme.border }]} onPress={handleDownloadExcel}>
            <Text style={[styles.secondaryBtnText, { color: theme.text }]}>Export Excel</Text>
          </TouchableOpacity>
        </View>
        <Text style={[styles.mutedTextSmall, { color: theme.muted }]}>{filteredExpenses.length} record(s) in {monthLabel}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <TouchableOpacity style={[styles.secondaryBtn, { backgroundColor: theme.cardAlt, borderColor: theme.border }]} onPress={() => openAddTransactionModal('expense')}>
            <Text style={[styles.secondaryBtnText, { color: theme.text }]}>+ Add Expense</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.secondaryBtn, { backgroundColor: theme.cardAlt, borderColor: theme.border }]} onPress={() => openAddTransactionModal('income')}>
            <Text style={[styles.secondaryBtnText, { color: theme.green }]}>+ Add Income</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.secondaryBtn, { backgroundColor: theme.cardAlt, borderColor: theme.border }]} onPress={() => openAddTransactionModal('savings')}>
            <Text style={[styles.secondaryBtnText, { color: theme.blue }]}>+ Add Savings</Text>
          </TouchableOpacity>
        </View>
      </View>

      {filteredExpenses.length === 0 ? (
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.mutedText, { color: theme.muted }]}>Is month ke liye transactions nahi mili.</Text>
        </View>
      ) : (
        filteredExpenses.map((exp) => {
          const type = getExpenseType(exp);
          const borderColor = type === 'income' ? theme.green : type === 'savings' ? theme.blue : theme.red;
          return (
            <View key={exp._id} style={[styles.card, styles.txCard, { backgroundColor: theme.card, borderColor: theme.border, borderLeftColor: borderColor }]}>
              <View style={styles.txTop}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.itemTitle, { color: theme.text }]}>{exp.item}</Text>
                  <Text style={[styles.mutedTextSmall, { color: theme.muted }]}>
                    {exp.category} • {type.toUpperCase()} • {formatDate(exp.date)}
                  </Text>
                </View>
                <Text style={[styles.amountText, { color: borderColor }]}>{money(Number(exp.amount || 0))}</Text>
              </View>
              <View style={styles.actionRow}>
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.cardAlt, borderColor: theme.border }]} onPress={() => openEditModal(exp)}>
                  <Text style={[styles.actionBtnText, { color: theme.text }]}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, styles.dangerBtn]} onPress={() => handleDeleteExpense(exp._id, exp.item)}>
                  <Text style={[styles.actionBtnText, { color: theme.text }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );

  const renderAnalytics = () => {
    const rangeMonths = getMonthsForRange(selectedMonth, selectedYear, analyticsRange);
    const { start: rangeStart, end: rangeEnd } = getRangeDateBounds(rangeMonths);
    const totalDays = daysBetweenInclusive(rangeStart, rangeEnd);

    const rangeExpenses = expenses.filter((e) => {
      const { month, year } = getExpenseMonthYear(e);
      return isInMonthList(month, year, rangeMonths);
    });

    const rangeExpenseTxns = rangeExpenses.filter((e) => getExpenseType(e) === 'expense');
    const rangeIncome = rangeExpenses.filter((e) => getExpenseType(e) === 'income').reduce((s, e) => s + Number(e.amount || 0), 0);
    const rangeSavings = rangeExpenses.filter((e) => getExpenseType(e) === 'savings').reduce((s, e) => s + Number(e.amount || 0), 0);
    const totalSpent = rangeExpenseTxns.reduce((s, e) => s + Number(e.amount || 0), 0);

    const catMap = new Map<string, number>();
    rangeExpenseTxns.forEach((e) => {
      const key = (e.category || 'General').trim() || 'General';
      catMap.set(key, (catMap.get(key) || 0) + Number(e.amount || 0));
    });
    const donutPalette = [theme.red, theme.amber, theme.blue, theme.green, '#A78BFA', '#F472B6', '#14B8A6', '#FB923C'];
    const donutData = Array.from(catMap.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
      .map((d, i) => ({
        ...d,
        pct: totalSpent > 0 ? (d.amount / totalSpent) * 100 : 0,
        color: donutPalette[i % donutPalette.length],
      }));

    const totalBudgetForRange = rangeMonths.reduce((sum, m) => {
      const monthBudgets = budgets.filter((b) => (b.month ?? selectedMonth) === m.month && (b.year ?? selectedYear) === m.year);
      return sum + monthBudgets.reduce((s, b) => s + Number(b.limit || 0), 0);
    }, 0);

    const dayMs = 86400000;
    const rangeStartDay = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate()).getTime();
    const dailySpend: number[] = Array.from({ length: totalDays }, () => 0);
    rangeExpenseTxns.forEach((e) => {
      const { month, year } = getExpenseMonthYear(e);
      const d = new Date(e.date || `${year}-${String(month).padStart(2, '0')}-01`);
      if (isNaN(d.getTime())) return;
      const dayDate = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const idx = Math.floor((dayDate - rangeStartDay) / dayMs);
      if (idx >= 0 && idx < totalDays) dailySpend[idx] += Number(e.amount || 0);
    });
    let cum = 0;
    const cumulativeSpend = dailySpend.map((v) => { cum += v; return cum; });
    const cumulativeBudget = Array.from({ length: totalDays }, (_, i) => (totalBudgetForRange * (i + 1)) / totalDays);

    const savingsRate = rangeIncome > 0 ? (rangeSavings / rangeIncome) * 100 : 0;
    const dailyAverage = totalDays > 0 ? totalSpent / totalDays : 0;
    const fixedKeywords = /(rent|mortgage|emi|loan|insurance|subscription|utility|electric|gas|water|internet|phone|bill|tuition|fee|school|wifi|broadband)/i;
    let fixedTotal = 0;
    let variableTotal = 0;
    rangeExpenseTxns.forEach((e) => {
      const amt = Number(e.amount || 0);
      const text = `${e.category || ''} ${e.item || ''}`;
      if (fixedKeywords.test(text)) fixedTotal += amt; else variableTotal += amt;
    });
    const fixedPct = totalSpent > 0 ? (fixedTotal / totalSpent) * 100 : 0;
    const variablePct = totalSpent > 0 ? (variableTotal / totalSpent) * 100 : 0;
    const largestExpense = rangeExpenseTxns.reduce<Expense | null>((max, e) => {
      if (!max) return e;
      return Number(e.amount || 0) > Number(max.amount || 0) ? e : max;
    }, null);

    const chartW = 320;
    const chartH = 180;
    const padL = 36;
    const padR = 10;
    const padT = 10;
    const padB = 24;
    const plotW = chartW - padL - padR;
    const plotH = chartH - padT - padB;
    const maxY = Math.max(1, ...cumulativeSpend, ...cumulativeBudget);
    const toX = (i: number) => padL + (totalDays <= 1 ? 0 : (i / (totalDays - 1)) * plotW);
    const toY = (v: number) => padT + plotH - (v / maxY) * plotH;
    const spendPoints = cumulativeSpend.map((v, i) => `${toX(i)},${toY(v)}`).join(' ');
    const budgetPoints = cumulativeBudget.map((v, i) => `${toX(i)},${toY(v)}`).join(' ');

    const cx = 90, cy = 90, r = 70, innerR = 42;
    const makeDonutSlices = () => {
      if (donutData.length === 0 || totalSpent <= 0) return [] as { category: string; amount: number; pct: number; color: string; path: string }[];
      let startAngle = 0;
      return donutData.map((d, i) => {
        const angle = (d.pct / 100) * 360;
        const endAngle = i === donutData.length - 1 ? 360 : startAngle + angle;
        let path = '';
        if (endAngle - startAngle >= 359.99) {
          // full ring (single category or rounding)
          path = `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r} M ${cx} ${cy - innerR} A ${innerR} ${innerR} 0 1 0 ${cx} ${cy + innerR} A ${innerR} ${innerR} 0 1 0 ${cx} ${cy - innerR} Z`;
        } else {
          path = donutSlicePath(cx, cy, r, innerR, startAngle, endAngle);
        }
        startAngle = endAngle;
        return { ...d, path };
      });
    };
    const donutSlices = makeDonutSlices();

    const rangePills: AnalyticsRange[] = ['This Month', '3M', '6M', 'Year'];

    return (
      <ScrollView contentContainerStyle={styles.tabContent} showsVerticalScrollIndicator={false}>
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>Analytics</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
            {rangePills.map((pill) => {
              const active = analyticsRange === pill;
              return (
                <TouchableOpacity
                  key={pill}
                  style={[styles.pill, { backgroundColor: theme.cardAlt, borderColor: theme.border }, active && { backgroundColor: theme.green, borderColor: theme.green }]}
                  onPress={() => setAnalyticsRange(pill)}
                >
                  <Text style={[styles.pillText, { color: active ? '#08130B' : theme.text }]}>{pill}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <View style={[styles.monthSelector, { backgroundColor: theme.cardAlt, borderColor: theme.border, marginTop: 10 }]}>
            <TouchableOpacity style={[styles.monthBtn, { backgroundColor: theme.card }]} onPress={() => changeMonth(-1)}>
              <Ionicons name="chevron-back" size={18} color={theme.text} />
            </TouchableOpacity>
            <Text style={[styles.monthLabel, { color: theme.text }]}>{monthLabel}</Text>
            <TouchableOpacity style={[styles.monthBtn, { backgroundColor: theme.card }]} onPress={() => changeMonth(1)}>
              <Ionicons name="chevron-forward" size={18} color={theme.text} />
            </TouchableOpacity>
          </View>
          <Text style={[styles.mutedTextSmall, { color: theme.muted, marginTop: 8 }]}>
            Range: {rangeStart.toLocaleDateString()} - {rangeEnd.toLocaleDateString()}
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>Spending by Category</Text>
          <View style={{ alignItems: 'center', marginTop: 8 }}>
            <Svg width={180} height={180}>
              <G>
                {donutSlices.length > 0 ? (
                  donutSlices.map((s, i) => s.path ? <Path key={`${s.category}-${i}`} d={s.path} fill={s.color} /> : null)
                ) : (
                  <Path
                    d={`M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r} M ${cx} ${cy - innerR} A ${innerR} ${innerR} 0 1 0 ${cx} ${cy + innerR} A ${innerR} ${innerR} 0 1 0 ${cx} ${cy - innerR} Z`}
                    fill={theme.track}
                  />
                )}
                <Circle cx={cx} cy={cy} r={38} fill={theme.card} />
                <SvgText x={cx} y={84} fill={theme.muted} fontSize="10" textAnchor="middle">Total Spent</SvgText>
                <SvgText x={cx} y={102} fill={theme.text} fontSize="13" fontWeight="700" textAnchor="middle">
                  {money(totalSpent)}
                </SvgText>
              </G>
            </Svg>
          </View>
          {donutData.length === 0 ? (
            <Text style={[styles.mutedText, { color: theme.muted, textAlign: 'center', marginTop: 8 }]}>No expense data for this period.</Text>
          ) : (
            <View style={{ marginTop: 8, gap: 8 }}>
              {donutSlices.map((s, i) => (
                <View key={`${s.category}-legend-${i}`} style={styles.legendRow}>
                  <View style={[styles.legendDot, { backgroundColor: s.color }]} />
                  <Text style={[styles.legendLabel, { color: theme.text }]} numberOfLines={1}>{s.category}</Text>
                  <Text style={[styles.legendValue, { color: theme.muted }]}>{s.pct.toFixed(1)}% ? {money(s.amount)}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>Spending Trend</Text>
          <Text style={[styles.mutedTextSmall, { color: theme.muted }]}>Cumulative spending vs budget limit pace</Text>
          <View style={{ alignItems: 'center', marginTop: 10 }}>
            <Svg width={chartW} height={chartH}>
              <Line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke={theme.border} strokeWidth="1" />
              <Line x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH} stroke={theme.border} strokeWidth="1" />
              <Polyline points={budgetPoints} fill="none" stroke={theme.blue} strokeWidth="2" strokeDasharray="5,4" />
              <Polyline points={spendPoints} fill="none" stroke={theme.red} strokeWidth="2.5" />
              <SvgText x={padL} y={chartH - 6} fill={theme.muted} fontSize="9">Start</SvgText>
              <SvgText x={padL + plotW} y={chartH - 6} fill={theme.muted} fontSize="9" textAnchor="end">End</SvgText>
              <SvgText x={4} y={padT + 8} fill={theme.muted} fontSize="8">{money(Math.round(maxY))}</SvgText>
            </Svg>
          </View>
          <View style={styles.legendRowWrap}>
            <View style={styles.legendRow}><View style={[styles.legendDot, { backgroundColor: theme.red }]} /><Text style={[styles.legendLabel, { color: theme.text, flex: 0 }]}>Cumulative Spending</Text></View>
            <View style={styles.legendRow}><View style={[styles.legendDot, { backgroundColor: theme.blue }]} /><Text style={[styles.legendLabel, { color: theme.text, flex: 0 }]}>Budget Pace</Text></View>
          </View>
          <Text style={[styles.mutedTextSmall, { color: theme.muted, marginTop: 6 }]}>
            Budget pace total: {money(totalBudgetForRange)}{totalBudgetForRange === 0 ? ' (no budgets set for range)' : ''}
          </Text>
        </View>

        <View style={styles.metricGrid}>
          <View style={[styles.metricCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.statLabel, { color: theme.muted }]}>Savings Rate (%)</Text>
            <Text style={[styles.metricValue, { color: theme.green }]}>{savingsRate.toFixed(1)}%</Text>
            <Text style={[styles.mutedTextSmall, { color: theme.muted }]}>Savings / Income</Text>
          </View>
          <View style={[styles.metricCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.statLabel, { color: theme.muted }]}>Daily Average</Text>
            <Text style={[styles.metricValue, { color: theme.red }]}>{money(Math.round(dailyAverage))}</Text>
            <Text style={[styles.mutedTextSmall, { color: theme.muted }]}>Expense per day</Text>
          </View>
          <View style={[styles.metricCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.statLabel, { color: theme.muted }]}>Fixed vs. Variable (%)</Text>
            <Text style={[styles.metricValue, { color: theme.amber }]}>{fixedPct.toFixed(0)}% / {variablePct.toFixed(0)}%</Text>
            <Text style={[styles.mutedTextSmall, { color: theme.muted }]}>Fixed / Variable spend</Text>
          </View>
          <View style={[styles.metricCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.statLabel, { color: theme.muted }]}>Largest Expense</Text>
            <Text style={[styles.metricValue, { color: theme.red }]} numberOfLines={1}>
              {largestExpense ? money(Number(largestExpense.amount || 0)) : money(0)}
            </Text>
            <Text style={[styles.mutedTextSmall, { color: theme.muted }]} numberOfLines={1}>
              {largestExpense ? `${largestExpense.item} (${largestExpense.category || 'General'})` : 'No expenses in range'}
            </Text>
          </View>
        </View>
      </ScrollView>
    );
  };

  const renderBudgets = () => {
    const savingsGoalBudget = budgetsForPeriod.find((b) => /saving/i.test(b.name || ''));
    const savingsGoalTarget = Number(savingsGoalBudget?.limit || 0);
    const savingsGoalSaved = totals.savings;
    const savingsGoalProgress = savingsGoalTarget > 0 ? Math.max(0, Math.min(100, Math.round((savingsGoalSaved / savingsGoalTarget) * 100))) : 0;
    const ringSize = 84;
    const ringStroke = 8;
    const ringRadius = (ringSize - ringStroke) / 2;
    const ringCircumference = 2 * Math.PI * ringRadius;
    const ringOffset = ringCircumference - (savingsGoalProgress / 100) * ringCircumference;

    return (
      <ScrollView contentContainerStyle={styles.tabContent} showsVerticalScrollIndicator={false}>
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={styles.cardHeaderRow}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={[styles.cardTitle, { color: theme.text, fontSize: 22, fontWeight: '800' }]}>Budgets &amp; Envelopes</Text>
              <Text style={[styles.mutedTextSmall, { color: theme.muted, marginTop: 4 }]}>
                Allocated: {money(totals.expense)} of {money(totalAllocatedBudget)}
              </Text>
              <Text style={[styles.mutedTextSmall, { color: theme.muted, marginTop: 2 }]}>{monthLabel}</Text>
            </View>
            <TouchableOpacity style={[styles.secondaryBtn, { backgroundColor: theme.cardAlt, borderColor: theme.border }]} onPress={() => openBudgetModal()}>
              <Text style={[styles.secondaryBtnText, { color: theme.text }]}>+ Add Budget</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>Savings Goal</Text>
          {savingsGoalBudget ? (
            <View style={styles.savingsGoalRow}>
              <View style={styles.ringWrap}>
                <Svg width={ringSize} height={ringSize}>
                  <G rotation="-90" origin={`${ringSize / 2}, ${ringSize / 2}`}>
                    <Circle
                      cx={ringSize / 2}
                      cy={ringSize / 2}
                      r={ringRadius}
                      stroke={theme.track}
                      strokeWidth={ringStroke}
                      fill="none"
                    />
                    <Circle
                      cx={ringSize / 2}
                      cy={ringSize / 2}
                      r={ringRadius}
                      stroke={theme.green}
                      strokeWidth={ringStroke}
                      fill="none"
                      strokeDasharray={`${ringCircumference} ${ringCircumference}`}
                      strokeDashoffset={ringOffset}
                      strokeLinecap="round"
                    />
                  </G>
                </Svg>
                <View style={styles.ringCenter}>
                  <Text style={[styles.ringCenterText, { color: theme.text }]}>{savingsGoalProgress}%</Text>
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.itemTitle, { color: theme.text }]}>{savingsGoalBudget.name}</Text>
                <Text style={[styles.mutedTextSmall, { color: theme.muted, marginTop: 4 }]}>
                  {money(savingsGoalSaved)} / {money(savingsGoalTarget)}
                </Text>
                <Text style={[styles.mutedTextSmall, { color: theme.green, marginTop: 4, fontWeight: '600' }]}>
                  {Math.max(0, savingsGoalTarget - savingsGoalSaved) > 0
                    ? `${money(Math.max(0, savingsGoalTarget - savingsGoalSaved))} to go`
                    : 'Goal reached'}
                </Text>
              </View>
            </View>
          ) : (
            <View style={{ marginTop: 4 }}>
              <Text style={[styles.mutedText, { color: theme.muted }]}>No savings goal budget set for this period.</Text>
              <Text style={[styles.mutedTextSmall, { color: theme.muted, marginTop: 6 }]}>
                Saved this month: {money(totals.savings)}. Add a budget named "Savings" to track a goal.
              </Text>
              <TouchableOpacity style={[styles.secondaryBtn, { backgroundColor: theme.cardAlt, borderColor: theme.border, marginTop: 10, alignSelf: 'flex-start' }]} onPress={() => openBudgetModal()}>
                <Text style={[styles.secondaryBtnText, { color: theme.text }]}>+ Add Savings Budget</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {budgetsForPeriod.length === 0 ? (
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.mutedText, { color: theme.muted }]}>Is period ke liye koi budget/category set nahi hai.</Text>
          </View>
        ) : (
          budgetsForPeriod.map((b, idx) => {
            const key = (b.name || '').trim().toLowerCase();
            const spent = spentByCategory.get(key) || 0;
            const limit = Number(b.limit || 0);
            const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
            const pctClamped = Math.max(0, Math.min(100, pct));
            const remaining = limit - spent;
            const ratio = limit > 0 ? spent / limit : 0;
            const barColor = ratio >= 1 ? theme.red : ratio >= 0.9 ? theme.amber : ratio >= 0.8 ? theme.amber : (b.color || theme.green);
            const approaching = limit > 0 && ratio >= 0.8 && ratio < 1;
            const warning = limit > 0 && ratio >= 0.9 && ratio < 1;
            const paid = limit > 0 && ratio >= 1;
            const iconText = (b.icon && String(b.icon).trim()) || (b.name || '?').trim().charAt(0).toUpperCase() || '?';

            return (
              <View key={b._id} style={[styles.envelopeCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <View style={styles.envelopeTopRow}>
                  <View style={[styles.iconCircle, { backgroundColor: theme.cardAlt, borderColor: theme.border }]}>
                    <Text style={[styles.iconCircleText, { color: theme.text }]}>{iconText}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.itemTitle, { color: theme.text }]} numberOfLines={1}>{b.name}</Text>
                    <Text style={[styles.mutedTextSmall, { color: theme.muted, marginTop: 2 }]}>
                      {money(spent)} of {money(limit)} spent
                    </Text>
                  </View>
                  <View style={styles.envelopeStatusWrap}>
                    {approaching ? (
                      <View style={[styles.badge, { backgroundColor: 'rgba(245,158,11,0.15)', borderColor: theme.amber }]}>
                        {warning ? <Ionicons name="warning" size={12} color={theme.amber} /> : null}
                        <Text style={[styles.badgeText, { color: theme.amber }]}>Approaching limit</Text>
                      </View>
                    ) : null}
                    {!approaching && warning ? <Ionicons name="warning" size={18} color={theme.amber} /> : null}
                    {paid ? (
                      <View style={[styles.badge, { backgroundColor: 'rgba(34,197,94,0.15)', borderColor: theme.green }]}>
                        <Text style={[styles.badgeText, { color: theme.green }]}>Paid</Text>
                      </View>
                    ) : null}
                  </View>
                </View>

                <View style={{ marginTop: 12 }}>
                  <View style={[styles.progressTrack, { backgroundColor: theme.track, borderColor: theme.border, height: 10, borderRadius: 999 }]}>
                    <View style={[styles.progressFill, { width: `${pctClamped}%`, backgroundColor: barColor, borderRadius: 999 }]} />
                  </View>
                  <Text style={[styles.mutedTextSmall, { color: theme.muted, marginTop: 8 }]}>
                    {pct}% used ? {remaining >= 0 ? `${money(remaining)} left` : `${money(Math.abs(remaining))} over`}
                  </Text>
                </View>

                <View style={[styles.actionRow, { marginTop: 10 }]}>
                  <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.cardAlt, borderColor: theme.border }]} onPress={() => openBudgetModal(b)}>
                    <Text style={[styles.actionBtnText, { color: theme.text }]}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionBtn, styles.dangerBtn]} onPress={() => deleteBudget(b)}>
                    <Text style={[styles.actionBtnText, { color: '#FFFFFF' }]}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}

        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={styles.cardHeaderRow}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>Upcoming Bills</Text>
            <TouchableOpacity style={[styles.secondaryBtn, { backgroundColor: theme.cardAlt, borderColor: theme.border }]} onPress={openBillModal}>
              <Text style={[styles.secondaryBtnText, { color: theme.text }]}>+ Add Bill</Text>
            </TouchableOpacity>
          </View>
          {bills.length === 0 ? (
            <Text style={[styles.mutedText, { color: theme.muted }]}>Koi upcoming bill nahi hai.</Text>
          ) : (
            bills.map((bill) => (
              <TouchableOpacity key={bill._id} style={[styles.listRow, { borderBottomColor: theme.border }]} onPress={() => toggleBill(bill._id)} activeOpacity={0.8}>
                <View style={[styles.iconCircleSmall, { backgroundColor: theme.cardAlt, borderColor: theme.border }]}>
                  <Ionicons name={bill.isPaid ? 'checkmark-circle' : 'receipt-outline'} size={16} color={bill.isPaid ? theme.green : theme.amber} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.itemTitle, { color: theme.text }, bill.isPaid && styles.strikeText]}>{bill.title}</Text>
                  <Text style={[styles.mutedTextSmall, { color: theme.muted }]}>Due: {formatDate(bill.dueDate)} ? {money(Number(bill.amount || 0))}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[styles.amountText, { color: bill.isPaid ? theme.green : theme.amber }]}>
                    {bill.isPaid ? 'Paid' : 'Unpaid'}
                  </Text>
                  <Text style={[styles.mutedTextSmall, { color: theme.muted }]}>Tap to toggle</Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>
    );
  };

  const renderActiveTab = () => {
    if (activeTab === 'Home') return renderHome();
    if (activeTab === 'Transactions') return renderTransactions();
    if (activeTab === 'Analytics') return renderAnalytics();
    return renderBudgets();
  };

  return (
    <View style={[styles.appShell, { backgroundColor: theme.bg }]}>
      <View style={[styles.topBar, { backgroundColor: theme.bg, borderBottomColor: theme.border }]}>
        <View style={styles.topBarRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.topGreeting, { color: theme.text }]}>Hi, {currentUser?.name || currentUser?.email || 'User'}</Text>
            <Text style={[styles.topSubtle, { color: theme.muted }]}>{themeMode === 'dark' ? 'Dark' : 'Light'} fintech dashboard</Text>
          </View>
          <TouchableOpacity
            style={[styles.iconBtn, { backgroundColor: theme.cardAlt, borderColor: theme.border }]}
            onPress={() => setCurrencyModalVisible(true)}
          >
            <Ionicons name="cash-outline" size={18} color={theme.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconBtn, { backgroundColor: theme.cardAlt, borderColor: theme.border }]}
            onPress={toggleTheme}
          >
            <Ionicons name={themeMode === 'dark' ? 'sunny' : 'moon'} size={18} color={theme.text} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Text style={styles.logoutBtnText}>Logout</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.monthSelector, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <TouchableOpacity style={[styles.monthBtn, { backgroundColor: theme.cardAlt }]} onPress={() => changeMonth(-1)}>
            <Ionicons name="chevron-back" size={18} color={theme.text} />
          </TouchableOpacity>
          <Text style={[styles.monthLabel, { color: theme.text }]}>{monthLabel}</Text>
          <TouchableOpacity style={[styles.monthBtn, { backgroundColor: theme.cardAlt }]} onPress={() => changeMonth(1)}>
            <Ionicons name="chevron-forward" size={18} color={theme.text} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.contentArea}>
        {initialLoading ? (
          <View style={styles.centeredLoaderInline}>
            <ActivityIndicator size="large" color={theme.green} />
          </View>
        ) : (
          renderActiveTab()
        )}
      </View>

      <TouchableOpacity
        style={[styles.fab, (isRecording || voiceLoading) && styles.fabActive]}
        onPress={handleRecordToggle}
        disabled={voiceLoading}
        activeOpacity={0.85}
      >
        {voiceLoading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Ionicons name={isRecording ? 'stop' : 'mic'} size={26} color="#fff" />
        )}
      </TouchableOpacity>
      {(isRecording || voiceLoading) && (
        <View style={[styles.recordStatusPill, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.recordStatusText, { color: theme.text }]}>{voiceLoading ? 'Processing...' : 'Recording...'}</Text>
        </View>
      )}

      <View style={[styles.bottomNav, { backgroundColor: theme.navBg, borderTopColor: theme.navBorder }]}>
        {(['Home', 'Transactions', 'Analytics', 'Budgets'] as TabKey[]).map((tab) => {
          const active = activeTab === tab;
          const iconName =
            tab === 'Home'
              ? (active ? 'home' : 'home-outline')
              : tab === 'Transactions'
                ? (active ? 'swap-horizontal' : 'swap-horizontal-outline')
                : tab === 'Analytics'
                  ? (active ? 'bar-chart' : 'bar-chart-outline')
                  : (active ? 'wallet' : 'wallet-outline');
          return (
            <TouchableOpacity key={tab} style={styles.navItem} onPress={() => setActiveTab(tab)}>
              <Ionicons name={iconName as any} size={22} color={active ? theme.green : theme.muted} />
              <Text style={[styles.navLabel, { color: active ? theme.text : theme.muted }, active && styles.navLabelActive]}>{tab}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Edit Expense Modal */}
      <Modal visible={editModalVisible} transparent animationType="slide" onRequestClose={() => setEditModalVisible(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: theme.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>{editingExpense ? 'Edit Transaction' : 'Add Transaction'}</Text>
            <Text style={[styles.label, { color: theme.muted }]}>Item</Text>
            <TextInput style={[styles.input, { backgroundColor: theme.cardAlt, borderColor: theme.border, color: theme.text }]} value={editItem} onChangeText={setEditItem} placeholder="Item name" placeholderTextColor={theme.muted} />
            <Text style={[styles.label, { color: theme.muted }]}>Amount ({currencyCode})</Text>
            <TextInput style={[styles.input, { backgroundColor: theme.cardAlt, borderColor: theme.border, color: theme.text }]} value={editAmount} onChangeText={setEditAmount} keyboardType="numeric" placeholder="Amount" placeholderTextColor={theme.muted} />
            <Text style={[styles.label, { color: theme.muted }]}>Category</Text>
            <TextInput style={[styles.input, { backgroundColor: theme.cardAlt, borderColor: theme.border, color: theme.text }]} value={editCategory} onChangeText={setEditCategory} placeholder="Category" placeholderTextColor={theme.muted} />
            <Text style={[styles.label, { color: theme.muted }]}>Type</Text>
            <View style={styles.chipRow}>
              {(['expense', 'income', 'savings'] as ExpenseType[]).map((t) => (
                <TouchableOpacity key={t} style={[styles.chip, { backgroundColor: theme.cardAlt, borderColor: theme.border }, editType === t && { backgroundColor: theme.green, borderColor: theme.green }]} onPress={() => setEditType(t)}>
                  <Text style={[styles.chipText, { color: theme.text }, editType === t && styles.chipTextActive]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.cancelBtn, { backgroundColor: theme.cardAlt, borderColor: theme.border }]} onPress={() => setEditModalVisible(false)}>
                <Text style={[styles.cancelBtnText, { color: theme.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryBtnSmall} onPress={handleSaveEdit}>
                <Text style={styles.primaryBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Budget Modal */}
      <Modal visible={budgetModalVisible} transparent animationType="slide" onRequestClose={() => setBudgetModalVisible(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: theme.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>{editingBudget ? 'Edit Budget' : 'Add Budget / Category'}</Text>
            <Text style={[styles.label, { color: theme.muted }]}>Name</Text>
            <TextInput style={[styles.input, { backgroundColor: theme.cardAlt, borderColor: theme.border, color: theme.text }]} value={budgetName} onChangeText={setBudgetName} placeholder="e.g. Groceries" placeholderTextColor={theme.muted} />
            <Text style={[styles.label, { color: theme.muted }]}>Monthly Limit ({currencyCode})</Text>
            <TextInput style={[styles.input, { backgroundColor: theme.cardAlt, borderColor: theme.border, color: theme.text }]} value={budgetLimit} onChangeText={setBudgetLimit} keyboardType="numeric" placeholder="0" placeholderTextColor={theme.muted} />
            <Text style={[styles.label, { color: theme.muted }]}>Icon (optional)</Text>
            <TextInput style={[styles.input, { backgroundColor: theme.cardAlt, borderColor: theme.border, color: theme.text }]} value={budgetIcon} onChangeText={setBudgetIcon} placeholder="e.g. 🛒" placeholderTextColor={theme.muted} />
            <Text style={[styles.label, { color: theme.muted }]}>Color (optional)</Text>
            <TextInput style={[styles.input, { backgroundColor: theme.cardAlt, borderColor: theme.border, color: theme.text }]} value={budgetColor} onChangeText={setBudgetColor} placeholder="e.g. #22C55E" placeholderTextColor={theme.muted} />
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.cancelBtn, { backgroundColor: theme.cardAlt, borderColor: theme.border }]} onPress={() => setBudgetModalVisible(false)}>
                <Text style={[styles.cancelBtnText, { color: theme.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryBtnSmall} onPress={saveBudget}>
                <Text style={styles.primaryBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Bill Modal */}
      <Modal visible={billModalVisible} transparent animationType="slide" onRequestClose={() => setBillModalVisible(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: theme.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Add Upcoming Bill</Text>
            <Text style={[styles.label, { color: theme.muted }]}>Title</Text>
            <TextInput style={[styles.input, { backgroundColor: theme.cardAlt, borderColor: theme.border, color: theme.text }]} value={billTitle} onChangeText={setBillTitle} placeholder="e.g. Electricity bill" placeholderTextColor={theme.muted} />
            <Text style={[styles.label, { color: theme.muted }]}>Amount ({currencyCode})</Text>
            <TextInput style={[styles.input, { backgroundColor: theme.cardAlt, borderColor: theme.border, color: theme.text }]} value={billAmount} onChangeText={setBillAmount} keyboardType="numeric" placeholder="0" placeholderTextColor={theme.muted} />
            <Text style={[styles.label, { color: theme.muted }]}>Due Date (YYYY-MM-DD)</Text>
            <TextInput style={[styles.input, { backgroundColor: theme.cardAlt, borderColor: theme.border, color: theme.text }]} value={billDueDate} onChangeText={setBillDueDate} placeholder="2026-11-30" placeholderTextColor={theme.muted} autoCapitalize="none" />
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.cancelBtn, { backgroundColor: theme.cardAlt, borderColor: theme.border }]} onPress={() => setBillModalVisible(false)}>
                <Text style={[styles.cancelBtnText, { color: theme.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryBtnSmall} onPress={saveBill}>
                <Text style={styles.primaryBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Currency Modal */}
      <Modal visible={currencyModalVisible} transparent animationType="slide" onRequestClose={() => setCurrencyModalVisible(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: theme.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: theme.card, borderColor: theme.border, maxHeight: '80%' }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Select Currency</Text>
            <Text style={[styles.mutedTextSmall, { color: theme.muted, marginBottom: 8 }]}>
              Current: {currencyCode} ? Choose any supported currency
            </Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.cardAlt, borderColor: theme.border, color: theme.text }]}
              value={currencySearch}
              onChangeText={setCurrencySearch}
              placeholder="Search currency code (e.g. USD, PKR, EUR)"
              placeholderTextColor={theme.muted}
              autoCapitalize="characters"
            />
            <FlatList
              data={filteredCurrencyOptions}
              keyExtractor={(item) => item}
              keyboardShouldPersistTaps="handled"
              style={{ marginTop: 4 }}
              renderItem={({ item }) => {
                let name = item;
                try {
                  const dn = new (Intl as any).DisplayNames(['en'], { type: 'currency' });
                  name = dn?.of(item) || item;
                } catch {}
                const selected = item === currencyCode;
                return (
                  <TouchableOpacity
                    style={[
                      styles.currencyRow,
                      { borderBottomColor: theme.border, backgroundColor: selected ? theme.cardAlt : 'transparent' },
                    ]}
                    onPress={() => saveCurrency(item)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.itemTitle, { color: theme.text }]}>{item}</Text>
                      <Text style={[styles.mutedTextSmall, { color: theme.muted }]} numberOfLines={1}>{name}</Text>
                    </View>
                    {selected ? <Ionicons name="checkmark-circle" size={20} color={theme.green} /> : null}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={<Text style={[styles.mutedText, { color: theme.muted, marginTop: 8 }]}>No currency found.</Text>}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.cancelBtn, { backgroundColor: theme.cardAlt, borderColor: theme.border }]} onPress={() => { setCurrencyModalVisible(false); setCurrencySearch(''); }}>
                <Text style={[styles.cancelBtnText, { color: theme.text }]}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  appShell: { flex: 1, backgroundColor: darkTheme.bg },
  centeredLoader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: darkTheme.bg },
  centeredLoaderInline: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 40 },
  authContainer: { flexGrow: 1, justifyContent: 'center', padding: 20, backgroundColor: darkTheme.bg },
  authHeader: { marginBottom: 18 },
  brandTitle: { color: darkTheme.text, fontSize: 28, fontWeight: '800', textAlign: 'center' },
  brandSubtitle: { color: darkTheme.muted, fontSize: 14, textAlign: 'center', marginTop: 6 },
  topBar: { paddingTop: 52, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: darkTheme.bg, borderBottomWidth: 1, borderBottomColor: darkTheme.border },
  topBarRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  topGreeting: { color: darkTheme.text, fontSize: 18, fontWeight: '700' },
  topSubtle: { color: darkTheme.muted, fontSize: 12, marginTop: 2 },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  logoutBtn: { backgroundColor: '#2A1E22', borderWidth: 1, borderColor: '#5B2730', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  logoutBtnText: { color: '#FCA5A5', fontWeight: '700', fontSize: 12 },
  monthSelector: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: darkTheme.card, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: darkTheme.border },
  monthBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: darkTheme.cardAlt, alignItems: 'center', justifyContent: 'center' },
  monthBtnText: { color: darkTheme.text, fontSize: 22, fontWeight: '700', marginTop: -2 },
  monthLabel: { color: darkTheme.text, fontSize: 16, fontWeight: '700' },
  contentArea: { flex: 1 },
  tabContent: { padding: 16, paddingBottom: 140, gap: 12 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: { width: '48%', backgroundColor: darkTheme.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: darkTheme.border, borderLeftWidth: 4 },
  statLabel: { color: darkTheme.muted, fontSize: 12, marginBottom: 6 },
  statValue: { fontSize: 16, fontWeight: '800' },
  card: { backgroundColor: darkTheme.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: darkTheme.border },
  txCard: { borderLeftWidth: 4 },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 },
  cardTitle: { color: darkTheme.text, fontSize: 16, fontWeight: '700' },
  label: { color: darkTheme.muted, fontSize: 12, fontWeight: '600', marginTop: 8, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: darkTheme.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: darkTheme.text, backgroundColor: darkTheme.cardAlt },
  mutedText: { color: darkTheme.muted, fontSize: 14, lineHeight: 20 },
  mutedTextSmall: { color: darkTheme.muted, fontSize: 12, marginTop: 2 },
  progressBlock: { marginTop: 10 },
  progressHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressLabel: { color: darkTheme.text, fontSize: 13, fontWeight: '600' },
  progressSub: { color: darkTheme.muted, fontSize: 11, marginTop: 1 },
  progressValue: { color: darkTheme.text, fontSize: 12, fontWeight: '700' },
  progressTrack: { height: 10, backgroundColor: '#0F141C', borderRadius: 999, overflow: 'hidden', marginTop: 6, borderWidth: 1, borderColor: darkTheme.border },
  progressFill: { height: '100%', borderRadius: 999 },
  progressPct: { color: darkTheme.muted, fontSize: 11, marginTop: 4 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#263040' },
  itemTitle: { color: darkTheme.text, fontSize: 14, fontWeight: '700' },
  amountText: { fontSize: 14, fontWeight: '800' },
  actionRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 10 },
  inlineActions: { flexDirection: 'row', gap: 6 },
  actionBtn: { backgroundColor: darkTheme.cardAlt, borderWidth: 1, borderColor: darkTheme.border, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  dangerBtn: { borderColor: '#5B2730', backgroundColor: '#2A1E22' },
  actionBtnText: { color: darkTheme.text, fontSize: 12, fontWeight: '700' },
  secondaryBtn: { backgroundColor: darkTheme.cardAlt, borderWidth: 1, borderColor: darkTheme.border, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 },
  secondaryBtnText: { color: darkTheme.text, fontSize: 12, fontWeight: '700' },
  primaryBtn: { backgroundColor: darkTheme.green, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 16 },
  primaryBtnSmall: { backgroundColor: darkTheme.green, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center' },
  primaryBtnText: { color: '#08130B', fontWeight: '800', fontSize: 14 },
  linkBtn: { marginTop: 14, alignItems: 'center' },
  linkBtnText: { color: darkTheme.blue, fontWeight: '600', fontSize: 13 },
  bottomNav: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 78, backgroundColor: '#10151D', borderTopWidth: 1, borderTopColor: darkTheme.border, flexDirection: 'row', paddingBottom: 8, paddingTop: 8 },
  navItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  navDot: { width: 6, height: 6, borderRadius: 999, backgroundColor: 'transparent' },
  navDotActive: { backgroundColor: darkTheme.green },
  navLabel: { color: darkTheme.muted, fontSize: 11, fontWeight: '600' },
  navLabelActive: { color: darkTheme.text },
  fab: { position: 'absolute', right: 18, bottom: 92, width: 62, height: 62, borderRadius: 31, backgroundColor: darkTheme.red, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#7F1D1D', elevation: 6 },
  fabActive: { backgroundColor: '#B91C1C' },
  fabText: { fontSize: 24, color: '#fff' },
  recordStatusPill: { position: 'absolute', right: 90, bottom: 108, backgroundColor: darkTheme.card, borderWidth: 1, borderColor: darkTheme.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  recordStatusText: { color: darkTheme.text, fontSize: 12, fontWeight: '600' },
  txTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  strikeText: { textDecorationLine: 'line-through', color: darkTheme.muted },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: darkTheme.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: darkTheme.border },
  modalTitle: { color: darkTheme.text, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: darkTheme.cardAlt, borderWidth: 1, borderColor: darkTheme.border },
  cancelBtnText: { color: darkTheme.text, fontWeight: '600' },
  chipRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  chip: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: darkTheme.border, backgroundColor: darkTheme.cardAlt, alignItems: 'center' },
  chipActive: { backgroundColor: darkTheme.green, borderColor: darkTheme.green },
  chipText: { color: darkTheme.text, fontWeight: '600', textTransform: 'capitalize' },
  chipTextActive: { color: '#08130B' },
  heroAmount: { fontSize: 30, fontWeight: '800', marginTop: 6 },
  summaryRow: { flexDirection: 'row', gap: 10 },
  summaryBox: { flex: 1, borderRadius: 14, padding: 12, borderWidth: 1 },
  summaryValue: { fontSize: 15, fontWeight: '800', marginTop: 4 },
  horizontalCardsRow: { gap: 10, paddingVertical: 4, paddingRight: 4 },
  billCardH: { width: 220, borderRadius: 14, padding: 12, borderWidth: 1 },
  billCardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  pillRow: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  pill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  pillText: { fontSize: 12, fontWeight: '700' },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendRowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { fontSize: 12, fontWeight: '600', flex: 1 },
  legendValue: { fontSize: 12 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricCard: { width: '48%', borderRadius: 14, padding: 12, borderWidth: 1 },
  metricValue: { fontSize: 18, fontWeight: '800', marginTop: 4, marginBottom: 2 },
  stripCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, paddingVertical: 14, paddingHorizontal: 8, borderWidth: 1 },
  stripCol: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  stripDivider: { width: 1, alignSelf: 'stretch', marginVertical: 2 },
  progressMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  categoryHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  envelopeCard: { borderRadius: 16, padding: 14, borderWidth: 1 },
  envelopeTopRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  envelopeStatusWrap: { alignItems: 'flex-end', gap: 6, marginLeft: 4 },
  iconCircle: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  iconCircleSmall: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, marginRight: 10 },
  iconCircleText: { fontSize: 18, fontWeight: '700' },
  savingsGoalRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10 },
  ringWrap: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center' },
  ringCenter: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  ringCenterText: { fontSize: 16, fontWeight: '800' },
  currencyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1 },
});