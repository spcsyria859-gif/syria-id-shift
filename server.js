const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('admin_shifts.db');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const axios = require('axios');

const app = express();
const db = new Database('admin_shifts.db');

// ==========================================
// ⚠️ ضع معلومات الديسكورد الخاصة بك هنا
// ==========================================
const DISCORD_CLIENT_ID = '1548725091272233020';
const DISCORD_CLIENT_SECRET = '6k3djA3UnqoJZEVOE1s1K16IDhuXd4LC';
const DISCORD_CALLBACK_URL = 'https://syria-id-shift.onrender.com/auth/discord/callback';
const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1548726228939186298/6GsN9BeU4QvNtu8sAi57By0olzosy4em';

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: 'syria_id_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(passport.initialize());
app.use(passport.session());

// إنشاء جدول الشفتات
db.exec(`
  CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_name TEXT NOT NULL,
    discord_id TEXT,
    login_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    logout_time DATETIME,
    duration_minutes INTEGER
  )
`);

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
    clientID: DISCORD_CLIENT_ID,
    clientSecret: DISCORD_CLIENT_SECRET,
    callbackURL: DISCORD_CALLBACK_URL,
    scope: ['identify']
}, (accessToken, refreshToken, profile, done) => {
    return done(null, profile);
}));

// دالة إرسال التنبيهات للديسكورد (آمنة من توقيف السيرفر)
async function sendDiscordNotification(embed) {
    if (!DISCORD_WEBHOOK_URL || DISCORD_WEBHOOK_URL.includes('ضع_WEBHOOK_URL') || !DISCORD_WEBHOOK_URL.startsWith('http')) {
        console.log('💡 تنبيه: لم يتم ضبط رابط الـ Webhook بشكل صحيح، تم تخطي إرسال الإشعار للديسكورد.');
        return;
    }
    try {
        await axios.post(DISCORD_WEBHOOK_URL, { embeds: [embed] });
    } catch (err) {
        console.error('⚠️ خطأ في إرسال تنبيه الديسكورد:', err.message);
    }
}

// مسارات الديسكورد
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', {
    failureRedirect: '/'
}), (req, res) => {
    res.redirect('/');
});

// جلب معلومات المستخدم الحالي
app.get('/api/user', (req, res) => {
    if (req.isAuthenticated() && req.user) {
        const username = req.user.global_name || req.user.username;
        const avatar = req.user.avatar 
            ? `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png` 
            : 'https://cdn.discordapp.com/embed/avatars/0.png';
            
        res.json({ 
            authenticated: true, 
            username: username,
            avatar: avatar
        });
    } else {
        res.json({ authenticated: false });
    }
});

// 1. بدء الشفت
app.post('/api/login', async (req, res) => {
    try {
        let adminName = req.body.adminName;
        if (req.isAuthenticated() && req.user) {
            adminName = req.user.global_name || req.user.username;
        }

        const discordId = (req.isAuthenticated() && req.user) ? req.user.id : null;

        if (!adminName) return res.status(400).json({ error: 'الاسم مطلوب' });

        const stmt = db.prepare('INSERT INTO shifts (admin_name, discord_id) VALUES (?, ?)');
        const info = stmt.run(adminName, discordId);

        // إرسال تنبيه الديسكورد
        sendDiscordNotification({
            title: '🟢 بدء شفت جديد',
            description: `بدأ الإداري **${adminName}** شفته الآن.`,
            color: 3066993,
            timestamp: new Date()
        });

        res.json({ shiftId: info.lastInsertRowid, adminName });
    } catch (error) {
        console.error('خطأ في بدء الشفت:', error);
        res.status(500).json({ error: 'حدث خطأ في الخادم' });
    }
});

// 2. إنهاء الشفت
app.post('/api/logout', async (req, res) => {
    try {
        const { shiftId } = req.body;
        if (!shiftId) return res.status(400).json({ error: 'معرف الشفت مطلوب' });

        const shift = db.prepare('SELECT admin_name FROM shifts WHERE id = ?').get(shiftId);

        const stmt = db.prepare(`
            UPDATE shifts 
            SET logout_time = CURRENT_TIMESTAMP, 
                duration_minutes = CAST((julianday(CURRENT_TIMESTAMP) - julianday(login_time)) * 24 * 60 AS INTEGER)
            WHERE id = ?
        `);
        stmt.run(shiftId);

        const result = db.prepare('SELECT duration_minutes FROM shifts WHERE id = ?').get(shiftId);
        const duration = result ? result.duration_minutes : 0;

        // إرسال تنبيه الديسكورد
        if (shift) {
            sendDiscordNotification({
                title: '🔴 إنهاء شفت',
                description: `أنهى الإداري **${shift.admin_name}** شفته.\n⏱️ **مدة الشفت:** ${duration} دقيقة (${(duration / 60).toFixed(2)} ساعة).`,
                color: 15158332,
                timestamp: new Date()
            });
        }

        res.json({ durationMinutes: duration });
    } catch (error) {
        console.error('خطأ في إنهاء الشفت:', error);
        res.status(500).json({ error: 'حدث خطأ في الخادم' });
    }
});

// 3. جلب الإحصائيات
app.get('/api/stats', (req, res) => {
    const week = req.query.week;
    
    let query = `
        SELECT admin_name, 
               SUM(duration_minutes) as total_minutes, 
               COUNT(id) as total_shifts 
        FROM shifts 
        WHERE duration_minutes IS NOT NULL
    `;
    
    const params = [];
    if (week && week !== '') {
        query += ` AND strftime('%Y-%W', login_time) = ?`;
        params.push(week);
    }
    
    query += ` GROUP BY admin_name`;

    const rows = db.prepare(query).all(...params);

    const weeksList = db.prepare(`
        SELECT DISTINCT strftime('%Y-%W', login_time) as week_code 
        FROM shifts 
        WHERE logout_time IS NOT NULL
        ORDER BY week_code DESC
    `).all();

    res.json({ stats: rows, weeks: weeksList });
});

app.listen(3000, () => {
    console.log('Server is running on http://localhost:3000');
})
