const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']); // DNS fix taake MongoDB Atlas har network par chale

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');
const ExcelJS = require('exceljs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_in_production';

// Groq Setup
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Audio upload ke liye temporary folder setup
const upload = multer({ dest: 'uploads/' });

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected Successfully!'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// ==========================================
// DATABASE SCHEMAS & MODELS
// ==========================================
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.models.User || mongoose.model('User', userSchema);

const expenseSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  item: { type: String, required: true },
  amount: { type: Number, required: true },
  category: { type: String, required: true },
  type: {
    type: String,
    enum: ['expense', 'income', 'savings'],
    default: 'expense',
  },
  rawText: String,
  date: { type: Date, default: Date.now },
  month: { type: Number, default: () => new Date().getMonth() + 1 },
  year: { type: Number, default: () => new Date().getFullYear() }
});

const Expense = mongoose.models.Expense || mongoose.model('Expense', expenseSchema);

const budgetSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true },
  limit: { type: Number, default: 0 },
  icon: { type: String, default: '' },
  color: { type: String, default: '' },
  month: { type: Number, default: () => new Date().getMonth() + 1 },
  year: { type: Number, default: () => new Date().getFullYear() },
}, { timestamps: true });

const Budget = mongoose.models.Budget || mongoose.model('Budget', budgetSchema);

const upcomingBillSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true },
  amount: { type: Number, required: true, default: 0 },
  dueDate: { type: Date, required: true },
  isPaid: { type: Boolean, default: false },
}, { timestamps: true });

const UpcomingBill = mongoose.models.UpcomingBill || mongoose.model('UpcomingBill', upcomingBillSchema);

// ==========================================
// AUTH MIDDLEWARE (Routes se pehle hona zaroori hai)
// ==========================================
const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ success: false, error: 'Token missing hai. Please login karein.' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Token invalid ya expire ho chuka hai.' });
  }
};

// ==========================================
// AUTH ROUTES (REGISTER & LOGIN)
// ==========================================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Name, email aur password zaroori hain.' });
    }

    if (String(password).length < 6) {
      return res.status(400).json({ success: false, error: 'Password kam se kam 6 characters ka ho.' });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({ success: false, error: 'Yeh email pehle se registered hai.' });
    }

    const hashedPassword = await bcrypt.hash(String(password), 10);
    const user = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      password: hashedPassword,
    });

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '30d' });

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error('❌ Register error:', error);
    res.status(500).json({ success: false, error: 'Registration mein masla aaya.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email aur password zaroori hain.' });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(401).json({ success: false, error: 'Galat email ya password.' });
    }

    const isMatch = await bcrypt.compare(String(password), user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Galat email ya password.' });
    }

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ success: false, error: 'Login mein masla aaya.' });
  }
});

// ==========================================
// 1. VOICE UPLOAD & AI CATEGORIZATION API
// ==========================================
app.post('/api/voice-expense', authMiddleware, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Audio file nahi mili!' });
    }

    const tempPath = req.file.path;
    const targetPath = `${tempPath}.m4a`;
    fs.renameSync(tempPath, targetPath);

    // Step A: Whisper se Audio ko Text mein convert karna
    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(targetPath),
      model: 'whisper-large-v3',
      prompt: 'Roman Urdu and English mix financial expenses like rashan, bill, burger, savings, petrol.',
      response_format: 'json',
    });

    const spokenText = transcription.text;
    console.log('🎙️ User ne kaha:', spokenText);

    // Temporary audio file delete kar dein
    fs.unlinkSync(targetPath);

    // Step B: Logged-in user ki custom budget categories fetch karna
    const userBudgets = await Budget.find({ userId: req.userId }).select('name');
    const customCategoryNames = [...new Set(
      userBudgets
        .map((b) => String(b.name || '').trim())
        .filter(Boolean)
    )];
    const categoriesInstruction = customCategoryNames.length > 0
      ? `Classify each item into one of these custom budget categories when relevant: ${customCategoryNames.map((name) => `"${name}"`).join(', ')}. If none fit, use "General" for expenses, "Income" for income, or "Savings" for savings.`
      : `No custom budget categories are set. Use "General" for expenses, "Income" for income, or "Savings" for savings.`;

    // Step C: LLM se Text ko Categories aur Type mein todna
    const prompt = `
      Jo bhi text transcribe hua hai, usme se sirf aur sirf financial items (expenses, income, savings) ki items aur amounts nikal kar chote se JSON mein do, baaki faltu text ignore kar do.
      ${categoriesInstruction}
      Also detect the "type" for each item as exactly one of: "expense", "income", "savings".
      - "expense": money spent (bills, shopping, food, transport, etc.)
      - "income": money received/earned (salary, payment received, bonus, etc.)
      - "savings": money saved/invested/transferred to savings

      Spoken Text: "${spokenText}"

      Return ONLY a valid JSON object in this exact format:
      {
        "transactions": [
          { "item": "Item name", "amount": 1000, "category": "Category name", "type": "expense" }
        ]
      }
    `;

    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'qwen/qwen3.8-27b',
      temperature: 0,
      max_tokens: 250,
      response_format: { type: 'json_object' }
    });

    let rawContent = chatCompletion.choices[0].message.content;
    rawContent = rawContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    const aiResponse = JSON.parse(rawContent);
    const transactions = Array.isArray(aiResponse.transactions) ? aiResponse.transactions : [];

    // Step D: MongoDB mein logged-in user ke userId ke sath save karna
    const allowedTypes = new Set(['expense', 'income', 'savings']);
    const savedRecords = [];
    for (const tx of transactions) {
      const amount = Number(tx.amount);
      if (!tx.item || !Number.isFinite(amount)) continue;

      const txType = allowedTypes.has(String(tx.type || '').toLowerCase())
        ? String(tx.type).toLowerCase()
        : 'expense';

      let txCategory = String(tx.category || '').trim();
      if (!txCategory) {
        if (txType === 'income') txCategory = 'Income';
        else if (txType === 'savings') txCategory = 'Savings';
        else txCategory = 'General';
      }

      const newExpense = new Expense({
        userId: req.userId,
        item: String(tx.item).trim(),
        amount,
        category: txCategory,
        type: txType,
        rawText: spokenText
      });
      await newExpense.save();
      savedRecords.push(newExpense);
    }

    res.json({
      success: true,
      spokenText,
      savedRecords
    });

  } catch (error) {
    console.error('❌ Error processing voice:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 2. GET ALL EXPENSES API FOR LOGGED-IN USER
// ==========================================
app.get('/api/expenses', authMiddleware, async (req, res) => {
  try {
    const expenses = await Expense.find({ userId: req.userId }).sort({ date: -1 });
    res.json(expenses);
  } catch (error) {
    console.error('❌ Fetch expenses error:', error);
    res.status(500).json({ error: 'Expenses fetch karne mein masla aaya' });
  }
});

// ==========================================
// 3. CREATE, UPDATE & DELETE EXPENSE API
// ==========================================
app.post('/api/expenses', authMiddleware, async (req, res) => {
  try {
    const { item, amount, category, type, date } = req.body;
    const numericAmount = Number(amount);
    if (!item || !String(item).trim() || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Sahi item aur amount darj karein' });
    }

    const allowedTypes = new Set(['expense', 'income', 'savings']);
    const txType = allowedTypes.has(String(type || '').toLowerCase())
      ? String(type).toLowerCase()
      : 'expense';

    let txCategory = String(category || '').trim();
    if (!txCategory) {
      txCategory = txType === 'income' ? 'Income' : txType === 'savings' ? 'Savings' : 'General';
    }

    const txDate = date ? new Date(date) : new Date();
    const safeDate = Number.isNaN(txDate.getTime()) ? new Date() : txDate;

    const expense = await Expense.create({
      userId: req.userId,
      item: String(item).trim(),
      amount: numericAmount,
      category: txCategory,
      type: txType,
      rawText: String(req.body.rawText || '').trim() || 'Manual entry',
      date: safeDate,
      month: safeDate.getMonth() + 1,
      year: safeDate.getFullYear(),
    });

    res.status(201).json({ success: true, expense });
  } catch (error) {
    console.error('? Create expense error:', error);
    res.status(500).json({ success: false, error: 'Transaction create karne mein masla aaya' });
  }
});

app.put('/api/expenses/:id', authMiddleware, async (req, res) => {
  try {
    const existing = await Expense.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Expense nahi mila' });
    }
    if (existing.userId?.toString() !== req.userId) {
      return res.status(403).json({ success: false, error: 'Aap is record ko update nahi kar sakte' });
    }

    const { item, amount, category, type } = req.body;
    const allowedTypes = new Set(['expense', 'income', 'savings']);
    const updateData = {
      ...(item !== undefined && { item }),
      ...(amount !== undefined && { amount: Number(amount) }),
      ...(category !== undefined && { category }),
    };
    if (type !== undefined && allowedTypes.has(String(type).toLowerCase())) {
      updateData.type = String(type).toLowerCase();
    }

    const updated = await Expense.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    res.json({ success: true, expense: updated });
  } catch (error) {
    console.error('❌ Update error:', error);
    res.status(500).json({ success: false, error: 'Update karne mein masla aaya' });
  }
});

app.delete('/api/expenses/:id', authMiddleware, async (req, res) => {
  try {
    const existing = await Expense.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Expense nahi mila' });
    }
    if (existing.userId?.toString() !== req.userId) {
      return res.status(403).json({ success: false, error: 'Aap is record ko delete nahi kar sakte' });
    }

    await Expense.findByIdAndDelete(req.params.id);
    res.json({ success: true, deletedId: req.params.id });
  } catch (error) {
    console.error('❌ Delete error:', error);
    res.status(500).json({ success: false, error: 'Delete karne mein masla aaya' });
  }
});

// ==========================================
// 4. BUDGET / CATEGORY APIs
// ==========================================
app.get('/api/budgets', authMiddleware, async (req, res) => {
  try {
    const budgets = await Budget.find({ userId: req.userId }).sort({ year: -1, month: -1, createdAt: -1 });
    res.json(budgets);
  } catch (error) {
    console.error('❌ Fetch budgets error:', error);
    res.status(500).json({ success: false, error: 'Budgets fetch karne mein masla aaya' });
  }
});

app.post('/api/budgets', authMiddleware, async (req, res) => {
  try {
    const { name, limit, icon, color, month, year } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, error: 'Category/budget name zaroori hai.' });
    }

    const budget = await Budget.create({
      userId: req.userId,
      name: String(name).trim(),
      limit: limit !== undefined ? Number(limit) : 0,
      icon: icon !== undefined ? String(icon) : '',
      color: color !== undefined ? String(color) : '',
      month: month !== undefined ? Number(month) : new Date().getMonth() + 1,
      year: year !== undefined ? Number(year) : new Date().getFullYear(),
    });

    res.status(201).json({ success: true, budget });
  } catch (error) {
    console.error('❌ Create budget error:', error);
    res.status(500).json({ success: false, error: 'Budget create karne mein masla aaya' });
  }
});

app.put('/api/budgets/:id', authMiddleware, async (req, res) => {
  try {
    const existing = await Budget.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Budget nahi mila' });
    }
    if (existing.userId?.toString() !== req.userId) {
      return res.status(403).json({ success: false, error: 'Aap is budget ko update nahi kar sakte' });
    }

    const { name, limit, icon, color, month, year } = req.body;
    const updateData = {
      ...(name !== undefined && { name: String(name).trim() }),
      ...(limit !== undefined && { limit: Number(limit) }),
      ...(icon !== undefined && { icon: String(icon) }),
      ...(color !== undefined && { color: String(color) }),
      ...(month !== undefined && { month: Number(month) }),
      ...(year !== undefined && { year: Number(year) }),
    };

    if (updateData.name !== undefined && !updateData.name) {
      return res.status(400).json({ success: false, error: 'Category/budget name zaroori hai.' });
    }

    const updated = await Budget.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    });

    res.json({ success: true, budget: updated });
  } catch (error) {
    console.error('❌ Update budget error:', error);
    res.status(500).json({ success: false, error: 'Budget update karne mein masla aaya' });
  }
});

app.delete('/api/budgets/:id', authMiddleware, async (req, res) => {
  try {
    const existing = await Budget.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Budget nahi mila' });
    }
    if (existing.userId?.toString() !== req.userId) {
      return res.status(403).json({ success: false, error: 'Aap is budget ko delete nahi kar sakte' });
    }

    await Budget.findByIdAndDelete(req.params.id);
    res.json({ success: true, deletedId: req.params.id });
  } catch (error) {
    console.error('❌ Delete budget error:', error);
    res.status(500).json({ success: false, error: 'Budget delete karne mein masla aaya' });
  }
});

// ==========================================
// 5. UPCOMING BILLS APIs
// ==========================================
app.get('/api/bills', authMiddleware, async (req, res) => {
  try {
    const bills = await UpcomingBill.find({ userId: req.userId }).sort({ dueDate: 1, createdAt: -1 });
    res.json(bills);
  } catch (error) {
    console.error('❌ Fetch bills error:', error);
    res.status(500).json({ success: false, error: 'Bills fetch karne mein masla aaya' });
  }
});

app.post('/api/bills', authMiddleware, async (req, res) => {
  try {
    const { title, amount, dueDate, isPaid } = req.body;
    if (!title || !String(title).trim()) {
      return res.status(400).json({ success: false, error: 'Bill title zaroori hai.' });
    }
    if (!dueDate || Number.isNaN(new Date(dueDate).getTime())) {
      return res.status(400).json({ success: false, error: 'Valid dueDate zaroori hai.' });
    }

    const bill = await UpcomingBill.create({
      userId: req.userId,
      title: String(title).trim(),
      amount: amount !== undefined ? Number(amount) : 0,
      dueDate: new Date(dueDate),
      isPaid: Boolean(isPaid),
    });

    res.status(201).json({ success: true, bill });
  } catch (error) {
    console.error('❌ Create bill error:', error);
    res.status(500).json({ success: false, error: 'Bill create karne mein masla aaya' });
  }
});

app.patch('/api/bills/:id/toggle', authMiddleware, async (req, res) => {
  try {
    const existing = await UpcomingBill.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Bill nahi mila' });
    }
    if (existing.userId?.toString() !== req.userId) {
      return res.status(403).json({ success: false, error: 'Aap is bill ko update nahi kar sakte' });
    }

    existing.isPaid = !existing.isPaid;
    await existing.save();

    res.json({ success: true, bill: existing });
  } catch (error) {
    console.error('❌ Toggle bill error:', error);
    res.status(500).json({ success: false, error: 'Bill toggle karne mein masla aaya' });
  }
});

// ==========================================
// 6. EXPORT MONTH-END EXCEL SHEET API
// ==========================================
app.get('/export-excel', authMiddleware, async (req, res) => {
  try {
    const expenses = await Expense.find({ userId: req.userId }).sort({ date: -1 });
    const user = await User.findById(req.userId).select('name email');

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Monthly Expenses');

    worksheet.columns = [
      { header: 'Date', key: 'date', width: 15 },
      { header: 'Item Name', key: 'item', width: 25 },
      { header: 'Type', key: 'type', width: 12 },
      { header: 'Category', key: 'category', width: 20 },
      { header: 'Amount (Rs.)', key: 'amount', width: 15 },
      { header: 'Voice Note (Raw Text)', key: 'rawText', width: 45 },
    ];

    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF2E7D32' },
    };

    let totalExpense = 0;
    let totalIncome = 0;
    let totalSavings = 0;

    expenses.forEach((exp) => {
      const formattedDate = new Date(exp.date).toLocaleDateString('en-PK');
      const expType = String(exp.type || '').toLowerCase();
      const normalizedType =
        expType === 'income' || expType === 'savings' || expType === 'expense'
          ? expType
          : exp.category === 'Savings'
            ? 'savings'
            : 'expense';

      worksheet.addRow({
        date: formattedDate,
        item: exp.item,
        type: normalizedType,
        category: exp.category,
        amount: exp.amount,
        rawText: exp.rawText || '-',
      });

      if (normalizedType === 'income') totalIncome += exp.amount;
      else if (normalizedType === 'savings') totalSavings += exp.amount;
      else totalExpense += exp.amount;
    });

    worksheet.addRow([]);
    worksheet.addRow(['', `SUMMARY (${user?.name || 'User'})`, '', '', '', '']).font = { bold: true };
    worksheet.addRow(['', 'Total Expense:', '', '', totalExpense, '']);
    worksheet.addRow(['', 'Total Income:', '', '', totalIncome, '']);
    worksheet.addRow(['', 'Total Savings:', '', '', totalSavings, '']);

    const grandTotalRow = worksheet.addRow([
      '',
      'NET (Income - Expense):',
      '',
      '',
      totalIncome - totalExpense,
      '',
    ]);
    grandTotalRow.font = { bold: true, size: 12 };

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=Expense_Report.xlsx'
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('❌ Excel generation error:', error);
    res.status(500).json({ success: false, error: 'Excel file banane mein masla aaya' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server chal raha hai: http://0.0.0.0:${PORT}`);
});