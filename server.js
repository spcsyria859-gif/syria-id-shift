const express = require('express');
const session = require('express-session');
const mongoose = require('mongoose');
const path = require('path');
const axios = require('axios');

const app = express();

// ==========================================
// [1] اتصال قاعدة بيانات MongoDB السحابية
// ==========================================
const MONGO_URI = 'mongodb+srv://spcsyria859_db_user:bDe98PxrvExzy8dr@cluster0.x9mzpcb.mongodb.net/?appName=Cluster0';

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ تم الاتصال بنجاح بقاعدة بيانات MongoDB'))
    .catch(err => console.error('❌ خطأ في الاتصال بقاعدة البيانات:', err));

// تعريف هيكل السجلات (Schema)
const logSchema = new mongoose.Schema({
    username: { type: String, required: true },
    discord_id: { type: String, required: true },
    login_time: { type: Date, default: () => new Date(Date.now() + 3 * 60 * 60 * 1000) },
    logout_time: { type: Date, default: null },
    duration_minutes: { type: Number, default: null }
});

const Log = mongoose.model('Log', logSchema);

// ==========================================
// [2] بيانات ديسكورد الخاصة بك
// ==========================================
const CLIENT_ID = '1548725091272233020';
const CLIENT_SECRET = 'tBqSo-ZAGWUpV4ikMHu2IdkxWUF7gQxh';
const REDIRECT_URI = 'https://syria-id-shift-2.onrender.com/auth/discord/callback';

// 1. رابط الويب هوك الخاص بروم تسجيل الدخول والخروج (الشفتات)
const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1549029236923310112/kmg-3x74fAAGLIubiLRXeJ1JDV8JVFL_TOSSv76--LL-MQjDqS75jpdoBOUclWtlFFpi';

// 2. رابط الويب هوك الخاص بروم محاولات الدخول المرفوضة
const UNAUTHORIZED_WEBHOOK_URL = 'https://discord.com/api/webhooks/1549501046659743794/ftjx7Fmp6iQL_rwEw9r19pUUW980_naDvLgSaU512gXk71ATV-w4fFnj52fjp8GdnZYs';

// قائمة الأيديات المسموح لها بالدخول حصراً
const ALLOWED_ADMIN_IDS = [
    '883828506713272331',
    '1435672093550444670',
    '1118195222812295288',
    '1469812869670502652',
    '725736703301779507',
    '1449113159599259672',
    '1387525708917641378',
    '1088035074655662131',
    '763710085938806814',
    '1058522432878673950',
    '1363243483250430032'
];

// دالة لإرسال الإشعارات إلى ديسكورد (الشفتات)
async function sendDiscordNotification(message) {
    if (DISCORD_WEBHOOK_URL.includes('ضع_رابط_الويب_هوك')) return;
    try {
        await axios.post(DISCORD_WEBHOOK_URL, { content: message });
    } catch (error) {
        console.error('خطأ في إرسال إشعار ديسكورد:', error);
    }
}

// دالة لإرسال إشعارات محاولات الدخول المرفوضة إلى الروم المخصصة
async function sendUnauthorizedNotification(message) {
    if (!UNAUTHORIZED_WEBHOOK_URL || UNAUTHORIZED_WEBHOOK_URL.includes('ضع_رابط')) return;
    try {
        await axios.post(UNAUTHORIZED_WEBHOOK_URL, { content: message });
    } catch (error) {
        console.error('خطأ في إرسال إشعار محاولة الدخول المرفوضة:', error);
    }
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: 'admin-tracker-secret-key',
    resave: false,
    saveUninitialized: false
}));

// دالة للحصول على الوقت المحلي (إضافة 3 ساعات على وقت السيرفر UTC)
function getLocalTime(dateInput = new Date()) {
    const date = new Date(dateInput);
    return new Date(date.getTime() + (3 * 60 * 60 * 1000));
}

// دالة مساعدة لتنسيق التاريخ والوقت بالأرقام الإنجليزية
function formatLocalDateTime(dateString) {
    if (!dateString) return 'Active now';
    const localDate = getLocalTime(dateString);
    return localDate.toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
}

// صفحة تسجيل الدخول
app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

// توجيه المستخدم لصفحة تسجيل الدخول عبر ديسكورد
app.get('/auth/discord', (req, res) => {
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;
    res.redirect(discordAuthUrl);
});

// مسار الاستجابة (Callback) عند موافقة المستخدم
app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.redirect('/login');

    try {
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: REDIRECT_URI,
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const accessToken = tokenResponse.data.access_token;
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const discordUser = userResponse.data;

        // التحقق من أن المستخدم ضمن الأيديات المسموح لها
        if (ALLOWED_ADMIN_IDS.length > 0 && !ALLOWED_ADMIN_IDS.includes(discordUser.id)) {
            await sendUnauthorizedNotification(`⚠️ **محاولة دخول مرفوضة**\n👤 المستخدم: **${discordUser.global_name || discordUser.username}** (ID: ${discordUser.id}) حاول الدخول وهو غير مصرح له.`);
            return res.send(`
                <html dir="rtl" style="font-family: Tahoma; text-align: center; padding-top: 50px; background: #1a1a1a; color: white;">
                    <h2 style="color: #ff6b6b;">عذراً، لست مصرحاً لك بتسجيل الدخول كإداري!</h2>
                    <p style="color: #aaa; margin-top: 10px;">هذا النظام مخصص حصراً لإداريي السيرفر المسجلين مسبقاً.</p>
                    <p style="color: #777; font-size: 12px; margin-top: 20px;">Discord ID الخاص بك: ${discordUser.id}</p>
                    <br><a href="/login" style="color: #428177; text-decoration: underline;">العودة لصفحة تسجيل الدخول</a>
                </html>
            `);
        }

        const username = discordUser.global_name || discordUser.username;
        const avatarUrl = discordUser.avatar 
            ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png` 
            : 'https://cdn.discordapp.com/embed/avatars/0.png';

        // التحقق مما إذا كان هناك شفت قديم لنفس الإداري لم يتم إغلاقه (لم يقم بتسجيل الخروج بسب انطفاء السيرفر)
        const activeLog = await Log.findOne({ discord_id: discordUser.id, logout_time: null });
        if (activeLog) {
            // إغلاق الشفت القديم تلقائياً لتفادي تداخل السجلات
            const autoLogoutTime = new Date();
            const diffMs = autoLogoutTime - new Date(activeLog.login_time);
            const diffMins = Math.floor(diffMs / 60000);
            
            activeLog.logout_time = autoLogoutTime;
            activeLog.duration_minutes = diffMins > 0 ? diffMins : 1;
            await activeLog.save();
        }

        req.session.username = username;
        req.session.avatar = avatarUrl;
        req.session.discordId = discordUser.id;

        const loginTime = new Date();
        const formattedLoginForDiscord = formatLocalDateTime(loginTime);

        const newLog = new Log({ username, discord_id: discordUser.id, login_time: loginTime });
        await newLog.save();
        req.session.logId = newLog._id;

        await sendDiscordNotification(`🟢 **تم تسجيل دخول إداري**\n👤 الإداري: **${username}**\n⏰ الوقت: ${formattedLoginForDiscord}`);

        res.redirect('/success');
    } catch (error) {
        console.error('خطأ في مصادقة ديسكورد:', error);
        res.redirect('/login');
    }
});

// صفحة الشفت النشط
app.get('/success', async (req, res) => {
    if (!req.session.username || !req.session.discordId) return res.redirect('/login');
    
    // التأكد من وجود سجل نشط في قاعدة البيانات حتى لو حصل إعادة تشغيل للسيرفر
    let logRecord = null;
    if (req.session.logId) {
        logRecord = await Log.findById(req.session.logId);
    }
    if (!logRecord || logRecord.logout_time !== null) {
        // إذا ضاع السجل بسبب سبات Render، نبحث عن آخر شفت نشط لهذا المستخدم أو ننشئ له سجلاً جديداً
        logRecord = await Log.findOne({ discord_id: req.session.discordId, logout_time: null });
        if (!logRecord) {
            logRecord = new Log({ username: req.session.username, discord_id: req.session.discordId, login_time: new Date() });
            await logRecord.save();
        }
        req.session.logId = logRecord._id;
    }

    // حساب المدة المنقضية بدقة من قاعدة البيانات
    const loginTimeMs = new Date(logRecord.login_time).getTime();
    const currentTimeMs = Date.now();
    const initialSeconds = Math.max(0, Math.floor((currentTimeMs - loginTimeMs) / 1000));

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.send(`
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>وقت الشفت النشط</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                html, body { height: 100%; width: 100%; overflow: hidden; }
                body { font-family: Tahoma, sans-serif; display: flex; flex-direction: column; justify-content: center; align-items: center; position: relative; }

                .aura-background-component { position: absolute; top: 0; width: 100%; z-index: -10; height: 100%; }
                .aura-background-component [data-us-project] { position: absolute; width: 100%; height: 100%; left: 0; top: 0; z-index: -10; }

                .success-box { 
                    background: #edebe0; 
                    padding: 40px; 
                    border-radius: 20px; 
                    box-shadow: 0 15px 35px rgba(0, 0, 0, 0.4), 0 0 25px rgba(45, 212, 191, 0.4); 
                    width: 400px; 
                    text-align: center; 
                    border-top: 5px solid #0f766e;
                    position: relative;
                    z-index: 1;
                }
                .avatar { width: 80px; height: 80px; border-radius: 50%; border: 2px solid #0f766e; margin-bottom: 15px; object-fit: cover; }
                h2 { color: #333; margin-bottom: 5px; font-size: 22px; }
                .welcome-sub { color: #428177; font-size: 13px; font-weight: bold; margin-bottom: 20px; }
                .timer-container { background: #fdfcf7; border: 2px dashed #0f766e; border-radius: 10px; padding: 15px; margin-bottom: 25px; }
                .timer-label { color: #666; font-size: 12px; margin-bottom: 5px; }
                #timer { color: #0f766e; font-size: 26px; font-weight: bold; font-family: monospace; letter-spacing: 1px; }
                .logout-btn { 
                    display: inline-block; width: 100%; padding: 14px; background: #d9534f; color: white; 
                    border: 2px solid #b53f3c; border-radius: 10px; cursor: pointer; font-size: 16px; 
                    font-weight: bold; text-decoration: none; box-sizing: border-box; box-shadow: 0 6px 0 #9c312e;
                    transition: all 0.1s ease; 
                }
                .logout-btn:active { transform: translateY(4px); box-shadow: 0 2px 0 #9c312e; }
                .logout-btn:hover { background: #c9302c; }
            </style>
        </head>
        <body>
            <div class="aura-background-component">
                <div data-us-project="yaha7Bz5f3cRBAa5js9K"></div>
                <script type="text/javascript">
                    !function(){if(!window.UnicornStudio){window.UnicornStudio={isInitialized:!1};var i=document.createElement("script");i.src="https://cdn.jsdelivr.net/gh/hiunicornstudio/unicornstudio.js@v1.4.29/dist/unicornStudio.umd.js",i.onload=function(){window.UnicornStudio.isInitialized||(UnicornStudio.init(),window.UnicornStudio.isInitialized=!0)},(document.head || document.body).appendChild(i)}}();
                </script>
            </div>

            <div class="success-box">
                <img src="${req.session.avatar}" alt="User Avatar" class="avatar">
                <h2>مرحباً يا ${req.session.username}</h2>
                <p class="welcome-sub">تم تسجيل وقت دخولك بنجاح. أنت الآن في فترة العمل.</p>
                <div class="timer-container">
                    <div class="timer-label">مدة الشفت الحالية:</div>
                    <div id="timer">00:00:00</div>
                </div>
                <a href="/logout" class="logout-btn">تسجيل خروج</a>
            </div>
            <script>
                let totalSeconds = ${initialSeconds};
                const timerElement = document.getElementById('timer');
                function updateTimer() {
                    totalSeconds++;
                    let h = Math.floor(totalSeconds / 3600);
                    let m = Math.floor((totalSeconds % 3600) / 60);
                    let s = totalSeconds % 60;
                    timerElement.textContent = (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
                }
                updateTimer();
                setInterval(updateTimer, 1000);
            </script>
        </body>
        </html>
    `);
});

// تسجيل الخروج
app.get('/logout', async (req, res) => {
    const username = req.session.username;
    let logRecord = null;

    if (req.session.logId) {
        logRecord = await Log.findById(req.session.logId);
    }
    // إذا ضاع الـ logId بسبب سبات السيرفر، نبحث عنه عبر الـ discordId
    if (!logRecord && req.session.discordId) {
        logRecord = await Log.findOne({ discord_id: req.session.discordId, logout_time: null });
    }

    if (logRecord) {
        const logoutTime = new Date();
        const formattedLogoutForDiscord = formatLocalDateTime(logoutTime);
        try {
            const loginTime = new Date(logRecord.login_time);
            const diffMs = logoutTime - loginTime;
            const diffMins = Math.floor(diffMs / 60000);
            const hoursCount = (diffMins / 60).toFixed(1);

            logRecord.logout_time = logoutTime;
            logRecord.duration_minutes = diffMins > 0 ? diffMins : 1;
            await logRecord.save();

            await sendDiscordNotification(`🔴 **انتهاء شفت إداري**\n👤 الإداري: **${username || logRecord.username}**\n⏱️ مدة التواجد: **${logRecord.duration_minutes} دقيقة** (≈ ${hoursCount} ساعة)\n⏰ وقت الخروج: ${formattedLogoutForDiscord}`);
        } catch (error) {
            console.error('خطأ أثناء تسجيل الخروج:', error);
        }
    }

    req.session.destroy(() => {
        res.redirect('/login');
    });
});

// لوحة المراقبة
app.get('/admin-control', async (req, res) => {
    try {
        const rawLogs = await Log.find().sort({ _id: -1 }).lean();
        
        const formattedLogs = rawLogs.map(log => {
            const localLoginDate = getLocalTime(log.login_time);
            
            const startOfYear = new Date(localLoginDate.getFullYear(), 0, 1);
            const weekNumber = Math.ceil(((localLoginDate - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
            const weekKey = `Week ${weekNumber}, ${localLoginDate.getFullYear()}`;

            return {
                ...log,
                weekKey,
                formatted_login: formatLocalDateTime(log.login_time),
                formatted_logout: formatLocalDateTime(log.logout_time),
                duration_text: (log.duration_minutes !== null && log.duration_minutes !== undefined) 
                    ? `${Math.floor(log.duration_minutes / 60)} hrs ${log.duration_minutes % 60} mins` 
                    : 'Active'
            };
        });

        const groupedByWeek = {};
        formattedLogs.forEach(log => {
            if (!groupedByWeek[log.weekKey]) {
                groupedByWeek[log.weekKey] = [];
            }
            groupedByWeek[log.weekKey].push(log);
        });

        res.render('dashboard', { groupedByWeek });
    } catch (error) {
        console.error('خطأ في جلب السجلات:', error);
        res.status(500).send('Internal Server Error');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`السيرفر شغال على البورت ${PORT}`);
});
