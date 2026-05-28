require('dotenv').config();

const express    = require('express');
const mongoose   = require('mongoose');
const multer     = require('multer');
const nodemailer = require('nodemailer');
const path       = require('path');
const fs         = require('fs');

const app = express();

/* ── Static files ── */
app.use(express.static(path.join(__dirname)));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/* ── File upload (disk storage with original extension) ── */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },          // 5 MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|pdf/;
    const ok = allowed.test(path.extname(file.originalname).toLowerCase())
            && allowed.test(file.mimetype);
    cb(ok ? null : new Error('Only images/PDF allowed'), ok);
  }
});

/* ── MongoDB ── */
mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/khelutsav')
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

const registrationSchema = new mongoose.Schema({
  name:      { type: String, required: true },
  college:   { type: String, required: true },
  email:     { type: String, required: true },
  mobile:    { type: String, required: true },
  sport:     { type: String, required: true },
  category:  { type: String, required: true },
  team:      String,
  captain:   String,
  file:      String,
  createdAt: { type: Date, default: Date.now }
});
const Registration = mongoose.model('Registration', registrationSchema);

/* ── Nodemailer transporter ── */
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS     // use App Password (16 chars), not your Gmail password
  }
});

/* ── Routes ── */

// Serve main page
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Serve form
app.get('/form', (req, res) => res.sendFile(path.join(__dirname, 'form.html')));

// ─────────────────────────────────────────────────────────
// NEW: Admin Stats API — day-by-day registration counts
// ─────────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try {
    // Total registrations
    const total = await Registration.countDocuments();

    // Today's count
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayCount = await Registration.countDocuments({
      createdAt: { $gte: startOfToday }
    });

    // Day-by-day breakdown (group by date string)
    const byDay = await Registration.aggregate([
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Kolkata' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // By sport breakdown
    const bySport = await Registration.aggregate([
      {
        $group: {
          _id: '$sport',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    res.json({ total, todayCount, byDay, bySport });

  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});
// ─────────────────────────────────────────────────────────

// NEW: All registrations list
app.get('/api/registrations', async (req, res) => {
  try {
    const registrations = await Registration.find()
      .sort({ createdAt: -1 })  // newest first
      .select('-file -__v');    // hide internal fields
    res.json({ success: true, data: registrations });
  } catch (err) {
    console.error('Registrations fetch error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch registrations' });
  }
});
// ─────────────────────────────────────────────────────────

// Handle registration
app.post('/submit', upload.single('file'), async (req, res) => {
  try {
    const { name, college, email, mobile, sport, category, team, captain } = req.body;

    // Validate required fields
    if (!name || !college || !email || !mobile || !sport || !category) {
      return res.status(400).json({ success: false, message: 'Missing required fields.' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'College ID file is required.' });
    }

    // Save to DB
    const reg = new Registration({
      name, college, email, mobile, sport, category,
      team: team || '',
      captain: captain || '',
      file: req.file.filename
    });
    await reg.save();

    // ── Email to admin ──
    const adminMail = {
      from: `"Khel Utsav Registration" <${process.env.MAIL_USER}>`,
      to:   process.env.ADMIN_MAIL || process.env.MAIL_USER,
      subject: `[Khel Utsav] New Registration — ${sport} | ${name}`,
      html: `
        <h2 style="color:#0b1c4d">New Khel Utsav Registration</h2>
        <table style="border-collapse:collapse;width:100%;font-family:sans-serif">
          <tr><td style="padding:8px;border:1px solid #ddd"><b>Name</b></td><td style="padding:8px;border:1px solid #ddd">${name}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd"><b>College</b></td><td style="padding:8px;border:1px solid #ddd">${college}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd"><b>Email</b></td><td style="padding:8px;border:1px solid #ddd">${email}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd"><b>Mobile</b></td><td style="padding:8px;border:1px solid #ddd">${mobile}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd"><b>Sport</b></td><td style="padding:8px;border:1px solid #ddd">${sport}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd"><b>Category</b></td><td style="padding:8px;border:1px solid #ddd">${category}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd"><b>Team</b></td><td style="padding:8px;border:1px solid #ddd">${team || '—'}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd"><b>Captain</b></td><td style="padding:8px;border:1px solid #ddd">${captain || '—'}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd"><b>File</b></td><td style="padding:8px;border:1px solid #ddd">${req.file.filename}</td></tr>
        </table>
      `
    };

    // ── Confirmation email to user ──
    const userMail = {
      from: `"Khel Utsav 2025-26" <${process.env.MAIL_USER}>`,
      to:   email,
      subject: `✅ Registration Confirmed — ${sport} | Khel Utsav`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:auto;background:#020617;color:#f1f5f9;border-radius:16px;overflow:hidden">
          <div style="background:#0b1c4d;padding:28px;text-align:center">
            <h1 style="color:#f5b74a;letter-spacing:4px;font-size:22px;margin:0">KHEL UTSAV 2025–26</h1>
            <p style="color:rgba(255,255,255,0.6);margin:6px 0 0;font-size:13px">Dev Bhoomi Uttarakhand University</p>
          </div>
          <div style="padding:32px">
            <h2 style="color:#f5b74a;margin-bottom:8px">Hey ${name},</h2>
            <p style="line-height:1.7;color:rgba(255,255,255,0.8)">
              Your registration for <b style="color:#f5b74a">${sport}</b> (${category}) at Khel Utsav 2025–26 has been received successfully.
            </p>
            <p style="margin-top:16px;line-height:1.7;color:rgba(255,255,255,0.7)">
              Our team will verify your details and reach out with further instructions. 
              Please carry your original College ID to the event.
            </p>
            <div style="margin-top:28px;padding:16px;border:1px solid rgba(245,183,74,0.25);border-radius:12px;font-size:13px;color:rgba(255,255,255,0.6)">
              <b>Registration ID:</b> ${reg._id}<br>
              <b>Sport:</b> ${sport} | <b>Category:</b> ${category}
            </div>
          </div>
          <div style="padding:16px;text-align:center;font-size:12px;color:rgba(255,255,255,0.35)">
            © 2026 G S WebX — Designed by Guddu
          </div>
        </div>
      `
    };

    // Send emails — don't fail the registration if email fails
    try {
      await Promise.all([
        transporter.sendMail(adminMail),
        transporter.sendMail(userMail)
      ]);
      console.log(`📧 Emails sent for ${name} (${email})`);
    } catch (mailErr) {
      console.warn('⚠️  Email sending failed (registration still saved):', mailErr.message);
    }

    res.json({ success: true, message: 'Registration successful!' });

  } catch (err) {
    console.error('Submit error:', err);
    res.status(500).json({ success: false, message: 'Internal server error. Please try again.' });
  }
});

/* ── 404 ── */
app.use((req, res) => res.status(404).send('Page not found'));

/* ── Start ── */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Khel Utsav server running → http://localhost:${PORT}`);
});