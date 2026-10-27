/**
 * แปลเมนู — ตัวกลางอ่านเมนู/ป้ายด้วย Gemini (API key อยู่ที่นี่ ไม่อยู่ในแอป)
 * เวอร์ชันโค้ด 5: ต้องให้เจ้าของอนุมัติรายเครื่องก่อนใช้ ใช้รายชื่อเดียวกันทั้งแอปแปลเมนูและ TripBudget
 *   (ขอใช้งาน/เช็กสถานะไม่ต้องใช้รหัสลับ ส่วนการแปลด้วย AI ต้องมีทั้งรหัสลับและการอนุมัติ)
 *
 * ตั้งค่าใน Project Settings → Script properties:
 *   GEMINI_API_KEY  (จำเป็น)  key จาก https://aistudio.google.com/apikey
 *   APP_TOKEN       (จำเป็น)  รหัสเข้าแอป (อยู่ในลิงก์ตั้งค่าที่ส่งให้เพื่อน)
 *   ADMIN_TOKEN     (จำเป็น)  รหัสผู้ดูแล ของเจ้าของคนเดียว ห้ามส่งให้ใคร ใส่ในแอปเครื่องตัวเองเพื่อใช้ได้ทันที
 *   OWNER_EMAIL     (ไม่บังคับ) อีเมลรับคำขออนุมัติ ค่าเริ่มต้น = อีเมลเจ้าของสคริปต์
 *   SHEET_ID        (ไม่บังคับ) ถ้าสคริปต์ไม่ได้สร้างจากใน Google Sheet ให้ใส่ ID ของชีตที่จะเก็บรายชื่อเครื่อง
 *   PER_DAY         (ไม่บังคับ) จำนวนรูปต่อเครื่องต่อวัน ค่าเริ่มต้น 30 (แก้รายคนในชีตช่อง "จำกัดต่อวัน")
 *   MODEL           (ไม่บังคับ) โมเดลอ่านเมนู ค่าเริ่มต้น gemini-flash-lite-latest (เร็ว ~1–10 วิ)
 *                   ใส่ gemini-flash-latest ถ้าอยากได้คำแปลละเอียดกว่า แต่บางช่วงช้ามาก (เคยวัดได้ 4 นาที)
 *   SIGN_MODEL      (ไม่บังคับ) โมเดลอ่านป้าย ค่าเริ่มต้น gemini-flash-lite-latest
 *   PER_HOUR        (ไม่บังคับ) จำกัดจำนวนรูปรวมทุกคนต่อชั่วโมง ค่าเริ่มต้น 60
 *
 * ชีต "เครื่องที่ใช้งาน" สร้างให้อัตโนมัติ เปลี่ยนช่อง "สถานะ" เป็น อนุมัติ / ไม่อนุมัติ / ปิด ได้เองตลอด
 *
 * Deploy → New deployment → Web app   (แก้โค้ดภายหลัง: Manage deployments → ✏️ → Version: New version)
 *   Execute as: Me   |   Who has access: Anyone
 */

const CODE_VERSION = 5;
const APPS = { menu: 'แปลเมนู', tripbudget: 'TripBudget' };
const MAX_IMAGE_CHARS = 5 * 1024 * 1024;
const ALLERGENS = ['ไข่', 'นม', 'ถั่วลิสง', 'ถั่วเปลือกแข็ง', 'แป้งสาลี', 'ถั่วเหลือง', 'กุ้ง/ปู', 'หอย', 'ปลา', 'งา'];
// แท็กส่วนผสมแบบสั้น (ตอบสั้น = เร็ว) "?" = อาจมี
const TAGS = ['pork', 'pork?', 'beef', 'beef?', 'chicken', 'chicken?', 'seafood', 'seafood?', 'alcohol', 'alcohol?', 'veg'];

const DEV_SHEET = 'เครื่องที่ใช้งาน';
const COLS = ['รหัสเครื่อง', 'ชื่อ', 'สถานะ', 'ขอเมื่อ', 'ใช้ล่าสุด', 'วันนี้', 'วันที่นับ', 'รวม', 'จำกัดต่อวัน', 'หมายเหตุ', 'key'];
const ST = { pending: 'รออนุมัติ', approved: 'อนุมัติ', denied: 'ไม่อนุมัติ', off: 'ปิด' };
const ST_CODE = { 'รออนุมัติ': 'pending', 'อนุมัติ': 'approved', 'ไม่อนุมัติ': 'denied', 'ปิด': 'off' };

function doPost(e) {
  const t0 = Date.now();
  try {
    const props = PropertiesService.getScriptProperties();
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const gate = req.action === 'ping' || req.action === 'register'; // ขอใช้งาน/เช็กสถานะ ไม่ต้องใช้รหัสลับ
    if (!gate && (!props.getProperty('APP_TOKEN') || req.token !== props.getProperty('APP_TOKEN'))) {
      return json_({ ok: false, error: 'รหัสลับไม่ถูกต้อง' });
    }
    const appName = APPS[req.app] ? req.app : 'menu';
    const tokenOk = !!props.getProperty('APP_TOKEN') && req.token === props.getProperty('APP_TOKEN');
    const admin = !!props.getProperty('ADMIN_TOKEN') && req.admin === props.getProperty('ADMIN_TOKEN');
    const dev = String(req.device || '').replace(/[^\w-]/g, '').slice(0, 40);
    if (!admin && dev.length < 12) return json_({ ok: false, error: 'แอปเวอร์ชันเก่า โหลดหน้าแอปใหม่แล้วลองอีกครั้ง', access: 'new' });

    if (req.action === 'ping') {
      const d = admin ? null : findDev_(dev);
      return json_({ ok: true, app: 'menu', version: CODE_VERSION, access: admin ? 'owner' : d ? d.code : 'new', name: d ? d.name : '', token: tokenOk });
    }
    if (req.action === 'register') return json_(register_(dev, req.name, props, appName));
    if (req.action !== 'menu') return json_({ ok: false, error: 'ไม่รู้จักคำสั่ง' });

    if (!admin) {
      const d = findDev_(dev);
      if (!d) return json_({ ok: false, access: 'new', error: 'เครื่องนี้ยังไม่ได้ขอใช้งาน' });
      if (d.code !== 'approved') return json_({ ok: false, access: d.code, error: d.code === 'pending' ? 'รอเจ้าของแอปอนุมัติก่อน' : 'เครื่องนี้ไม่ได้รับอนุญาตให้ใช้' });
      const lim = Number(d.limit) || Number(props.getProperty('PER_DAY') || 30);
      if (d.todayCount >= lim) return json_({ ok: false, access: 'approved', error: 'วันนี้ใช้ครบ ' + lim + ' รูปแล้ว พรุ่งนี้ใช้ได้ใหม่' });
    }
    if (!req.image || typeof req.image !== 'string') return json_({ ok: false, error: 'ไม่พบรูปภาพ' });
    if (req.image.length > MAX_IMAGE_CHARS) return json_({ ok: false, error: 'รูปใหญ่เกินไป' });
    if (!rateOk_(props)) return json_({ ok: false, error: 'ใช้งานถี่เกินไป รอสักครู่แล้วลองใหม่' });
    const out = req.mode === 'sign' ? sign_(req, props) : menu_(req, props);
    if (!admin) countUse_(dev); // นับเฉพาะครั้งที่แปลสำเร็จ
    out.ok = true; out.version = CODE_VERSION; out.ms = Date.now() - t0; out.access = admin ? 'owner' : 'approved';
    return json_(out);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err), version: CODE_VERSION, ms: Date.now() - t0 });
  }
}

/** ลิงก์ในอีเมล: ?a=approve|deny&d=รหัสเครื่อง&s=key */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.a !== 'approve' && p.a !== 'deny') return json_({ ok: true, app: 'menu', version: CODE_VERSION, hint: 'ใช้ POST' });
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sh = devSheet_(), rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === p.d && rows[i][10] && rows[i][10] === p.s) {
        sh.getRange(i + 1, 3).setValue(p.a === 'approve' ? ST.approved : ST.denied);
        return page_(p.a === 'approve' ? '✅ อนุมัติ "' + rows[i][1] + '" แล้ว' : '⛔ ไม่อนุมัติ "' + rows[i][1] + '"',
          'เปลี่ยนใจภายหลังได้ที่ชีต "' + DEV_SHEET + '" ช่องสถานะ (อนุมัติ / ไม่อนุมัติ / ปิด)');
      }
    }
    return page_('ไม่พบคำขอนี้', 'ลิงก์อาจหมดอายุ หรือถูกลบออกจากชีตแล้ว');
  } finally { lock.releaseLock(); }
}

/* ---------- รายชื่อเครื่อง (Google Sheet) ---------- */
function devSheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('ไม่พบ Google Sheet ให้สร้างสคริปต์จากในชีต (ส่วนขยาย → Apps Script) หรือใส่ SHEET_ID');
  let sh = ss.getSheetByName(DEV_SHEET);
  if (!sh) {
    sh = ss.insertSheet(DEV_SHEET);
    sh.appendRow(COLS); sh.setFrozenRows(1); sh.getRange(1, 1, 1, COLS.length).setFontWeight('bold').setBackground('#fff1e8');
    sh.getRange('C2:C').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList([ST.pending, ST.approved, ST.denied, ST.off], true).build());
    sh.setColumnWidth(1, 120); sh.setColumnWidth(2, 140); sh.hideColumns(11);
  }
  return sh;
}
function findDev_(dev) {
  if (!dev) return null;
  const rows = devSheet_().getDataRange().getValues(), today = today_();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === dev) {
      return { row: i + 1, name: rows[i][1], code: ST_CODE[rows[i][2]] || 'pending', limit: rows[i][8],
        todayCount: String(rows[i][6]) === today ? Number(rows[i][5]) || 0 : 0 };
    }
  }
  return null;
}
function register_(dev, name, props, appName) {
  name = String(name || '').replace(/[<>]/g, '').trim().slice(0, 40);
  if (!name) return { ok: false, error: 'ใส่ชื่อก่อน' };
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const found = findDev_(dev);
    if (found) return { ok: true, access: found.code, name: found.name };
    // กันคนส่งคำขอรัวๆ จนอีเมลเต็ม: ไม่เกิน 10 คำขอต่อชั่วโมง
    const cache = CacheService.getScriptCache(), k = 'reg_' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMddHH');
    const n = Number(cache.get(k) || 0); if (n >= 10) return { ok: false, error: 'มีคำขอเยอะเกินไป ลองใหม่ภายหลัง' };
    cache.put(k, String(n + 1), 3700);
    const key = Utilities.getUuid().replace(/-/g, '');
    devSheet_().appendRow([dev, name, ST.pending, new Date(), '', 0, '', 0, '', 'ขอจาก ' + APPS[appName], key]);
    notify_(dev, name, key, props, appName);
    return { ok: true, access: 'pending', name: name };
  } finally { lock.releaseLock(); }
}
function countUse_(dev) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const d = findDev_(dev); if (!d) return;
    const sh = devSheet_();
    sh.getRange(d.row, 5, 1, 4).setValues([[new Date(), d.todayCount + 1, today_(), Number(sh.getRange(d.row, 8).getValue() || 0) + 1]]);
  } finally { lock.releaseLock(); }
}
function notify_(dev, name, key, props, appName) {
  const to = props.getProperty('OWNER_EMAIL') || Session.getEffectiveUser().getEmail();
  const url = ScriptApp.getService().getUrl();
  if (!to || !url) return;
  const link = function (a) { return url + '?a=' + a + '&d=' + encodeURIComponent(dev) + '&s=' + key; };
  MailApp.sendEmail({
    to: to, subject: APPS[appName || 'menu'] + ': "' + name + '" ขอใช้งาน',
    htmlBody: '<p style="font-size:16px"><b>' + name + '</b> ขอใช้แอป ' + APPS[appName || 'menu'] + ' (อนุมัติแล้วใช้ได้ทั้ง TripBudget และแปลเมนู)</p>' +
      '<p><a href="' + link('approve') + '" style="background:#16834a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">✅ อนุมัติ</a> &nbsp; ' +
      '<a href="' + link('deny') + '" style="background:#cf3434;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">⛔ ไม่อนุมัติ</a></p>' +
      '<p style="color:#777;font-size:13px">ถ้าไม่รู้จักชื่อนี้ แปลว่าลิงก์ตั้งค่าถูกส่งต่อ กดไม่อนุมัติได้เลย · จัดการทั้งหมดได้ที่ชีต "' + DEV_SHEET + '"</p>'
  });
}
function today_() { return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd'); }
function page_(title, sub) {
  return HtmlService.createHtmlOutput('<meta name="viewport" content="width=device-width,initial-scale=1"><div style="font-family:sans-serif;text-align:center;padding:48px 20px"><h2>' + title + '</h2><p style="color:#666">' + sub + '</p></div>').setTitle('แปลเมนู');
}

/* ---------- เมนูอาหาร ---------- */
function menu_(req, props) {
  const where = String(req.country || '').slice(0, 40), diet = String(req.diet || '').slice(0, 200);
  const prompt =
    'Thai tourist' + (where ? ' in ' + where : '') + ' reading a restaurant menu photo. Be brief. ' +
    'List each dish/drink in menu order (max 50). Fields: ' +
    'o = name exactly as written; r = how to say it, in Thai script (max 25 chars); ' +
    't = natural Thai name; d = Thai description max 60 chars (main ingredients, cooking); ' +
    'p = printed price number or null; ' +
    'g = tags from [' + TAGS.join(',') + '] ("?" = usually contains but menu does not say; tonkotsu, chashu, lard, gyoza count as pork); ' +
    's = spicy 0-3; a = likely allergens from [' + ALLERGENS.join(',') + ']. ' +
    'n = one short Thai note only if important (tax/service charge/ticket machine/cash only), else "". ' +
    'k = "menu", or "other" with empty list if not a menu. l = menu language code.' +
    (diet ? ' Tourist cannot eat: ' + diet + '.' : '');
  const body = {
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: req.mime || 'image/jpeg', data: req.image } }] }],
    generationConfig: {
      temperature: 0.1, maxOutputTokens: 8192, responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          k: { type: 'STRING', enum: ['menu', 'other'] }, l: { type: 'STRING' }, n: { type: 'STRING' },
          i: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
            o: { type: 'STRING' }, r: { type: 'STRING' }, t: { type: 'STRING' }, d: { type: 'STRING' },
            p: { type: 'NUMBER', nullable: true }, g: { type: 'ARRAY', items: { type: 'STRING', enum: TAGS } },
            s: { type: 'INTEGER' }, a: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['o', 't'] } }
        },
        required: ['k', 'i']
      }
    }
  };
  const r = ask_(body, props.getProperty('MODEL') || 'gemini-flash-lite-latest', props);
  const out = r.json, s = str_;
  const lv = function (g, k) { return g.indexOf(k) >= 0 ? 'yes' : g.indexOf(k + '?') >= 0 ? 'maybe' : 'no'; };
  return {
    kind: out.k === 'menu' ? 'menu' : 'other', lang: s(out.l, 20), note: s(out.n, 300), model: r.model,
    items: (out.i || []).slice(0, 50).map(function (x) {
      const g = x.g || [], p = Number(x.p);
      return { orig: s(x.o, 120), reading: s(x.r, 60), th: s(x.t, 120), desc: s(x.d, 160), price: isFinite(p) && p > 0 ? p : null,
        pork: lv(g, 'pork'), beef: lv(g, 'beef'), chicken: lv(g, 'chicken'), seafood: lv(g, 'seafood'), alcohol: lv(g, 'alcohol'),
        spicy: Math.max(0, Math.min(3, Math.round(+x.s || 0))), veg: g.indexOf('veg') >= 0,
        allergens: (x.a || []).filter(function (a) { return ALLERGENS.indexOf(a) >= 0; }), conf: '' };
    })
  };
}

/* ---------- ป้าย / ข้อความ ---------- */
function sign_(req, props) {
  const where = String(req.country || '').slice(0, 40);
  const prompt =
    'Thai tourist' + (where ? ' in ' + where : '') + ' wants to understand the text in this photo (sign, notice, machine, label, screen). ' +
    'Group text into meaningful blocks: a whole paragraph = one block; separate signs/buttons = separate blocks (max 25). Fields: ' +
    'o = original text; t = natural Thai translation; r = Thai-script pronunciation ONLY for short labels up to 12 characters, otherwise "". ' +
    'n = one short Thai sentence summarising what the photo says or what to do. l = language code.';
  const body = {
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: req.mime || 'image/jpeg', data: req.image } }] }],
    generationConfig: {
      temperature: 0.1, maxOutputTokens: 8192, responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: { l: { type: 'STRING' }, n: { type: 'STRING' },
        i: { type: 'ARRAY', items: { type: 'OBJECT', properties: { o: { type: 'STRING' }, t: { type: 'STRING' }, r: { type: 'STRING' } }, required: ['o', 't'] } } },
        required: ['i'] }
    }
  };
  const r = ask_(body, props.getProperty('SIGN_MODEL') || 'gemini-flash-lite-latest', props);
  const out = r.json, s = str_;
  const items = (out.i || []).slice(0, 25).map(function (x) {
    return { orig: s(x.o, 2000), reading: s(x.r, 60), th: s(x.t, 3000), desc: '', price: null,
      pork: 'no', beef: 'no', chicken: 'no', seafood: 'no', alcohol: 'no', spicy: 0, veg: false, allergens: [], conf: '' };
  });
  return { kind: items.length ? 'sign' : 'other', lang: s(out.l, 20), note: s(out.n, 300), model: r.model, items: items };
}

/* ---------- เรียก Gemini ---------- */
function ask_(body, model, props) {
  const r = callGemini_(body, model, props);
  if (r.code !== 200) {
    if (r.code === 503 || r.code === 429) throw new Error('AI มีคนใช้เยอะชั่วคราว ลองใหม่อีกครั้งใน 1–2 นาที');
    throw new Error('Gemini: ' + (r.data.error && r.data.error.message ? r.data.error.message : 'HTTP ' + r.code));
  }
  const cand = r.data.candidates && r.data.candidates[0];
  const text = cand && cand.content && (cand.content.parts || []).filter(function (p) { return !p.thought; }).map(function (p) { return p.text || ''; }).join('');
  if (!text) throw new Error('AI ไม่ได้ตอบกลับ ลองถ่ายใหม่ให้ตัวหนังสือชัดขึ้น');
  try { return { json: JSON.parse(text), model: r.model }; }
  catch (e) { throw new Error(cand.finishReason === 'MAX_TOKENS' ? 'ข้อความยาวเกินไป ลองถ่ายทีละครึ่งหน้า' : 'อ่านผลจาก AI ไม่ได้ ลองใหม่อีกครั้ง'); }
}

/**
 * ลดการ "คิด" ของโมเดลเพื่อความเร็ว แต่ละรุ่นรับค่าไม่เหมือนกัน จึงลองทีละแบบ:
 *   thinkingLevel low (Gemini 3) → thinkingBudget 0 (Gemini 2.5) → ไม่ใส่
 * แบบที่ใช้ได้จะจำไว้ 6 ชม. ครั้งต่อไปไม่ต้องลองใหม่
 * ลองซ้ำเฉพาะตอนล้มเร็ว (คนใช้เยอะ) ไม่ลองซ้ำถ้ารอนานแล้ว จะได้ไม่ค้างเกินเวลา
 */
const THINK = [{ thinkingLevel: 'low' }, { thinkingBudget: 0 }, null];
function callGemini_(body, model, props) {
  const key = props.getProperty('GEMINI_API_KEY') || '';
  if (!key) throw new Error('ยังไม่ได้ตั้ง GEMINI_API_KEY ใน Script properties');
  const cache = CacheService.getScriptCache(), t0 = Date.now();
  const models = [model, 'gemini-flash-lite-latest'].filter(function (m, i, a) { return a.indexOf(m) === i; });
  let last = { code: 0, data: {}, model: model };
  for (let m = 0; m < models.length; m++) {
    const ck = 'think_' + models[m];
    let v = Number(cache.get(ck) || 0);
    while (v < THINK.length) {
      const b = JSON.parse(JSON.stringify(body));
      b.generationConfig = b.generationConfig || {};
      if (THINK[v]) b.generationConfig.thinkingConfig = THINK[v];
      const res = UrlFetchApp.fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(models[m]) + ':generateContent',
        { method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key }, payload: JSON.stringify(b), muteHttpExceptions: true });
      let data = {};
      try { data = JSON.parse(res.getContentText() || '{}'); } catch (e) {}
      last = { code: res.getResponseCode(), data: data, model: models[m], think: THINK[v] };
      if (last.code === 400 && v < THINK.length - 1) { v++; continue; } // รุ่นนี้ไม่รับค่านี้ ลองแบบถัดไป
      if (last.code === 200) { cache.put(ck, String(v), 21600); return last; }
      break;
    }
    if (last.code !== 503 && last.code !== 429 && last.code !== 500) return last;
    if (Date.now() - t0 > 25000) return last; // รอนานแล้ว ไม่ลองซ้ำ
    Utilities.sleep(1000);
  }
  return last;
}

function str_(v, n) { return String(v == null ? '' : v).slice(0, n); }

/** จำกัดจำนวนรูปต่อชั่วโมง กันโควตาหมดถ้าลิงก์หลุดไป */
function rateOk_(props) {
  const limit = Number(props.getProperty('PER_HOUR') || 60);
  const cache = CacheService.getScriptCache();
  const k = 'rate_' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMddHH');
  const n = Number(cache.get(k) || 0);
  if (n >= limit) return false;
  cache.put(k, String(n + 1), 3700);
  return true;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** กด Run ฟังก์ชันนี้เพื่ออนุญาตสิทธิ์ เช็ก key และดูว่าโมเดลตอบเร็วแค่ไหน */
function testSetup() {
  const props = PropertiesService.getScriptProperties();
  ['GEMINI_API_KEY', 'APP_TOKEN', 'ADMIN_TOKEN'].forEach(function (k) {
    Logger.log(k + ': ' + (props.getProperty(k) ? 'ตั้งแล้ว' : 'ยังไม่ได้ตั้ง'));
  });
  [props.getProperty('MODEL') || 'gemini-flash-lite-latest', props.getProperty('SIGN_MODEL') || 'gemini-flash-lite-latest'].forEach(function (m) {
    const t0 = Date.now();
    const r = callGemini_({ contents: [{ parts: [{ text: 'ตอบคำว่า พร้อม' }] }], generationConfig: {} }, m, props);
    Logger.log(m + ' → ' + r.model + ' ' + JSON.stringify(r.think || 'ไม่ตั้งค่าคิด') + ': HTTP ' + r.code + ' ใน ' + ((Date.now() - t0) / 1000).toFixed(1) + ' วินาที');
    if (r.code !== 200) Logger.log('   ' + JSON.stringify(r.data).slice(0, 300));
  });
  const sh = devSheet_(); Logger.log('ชีตรายชื่อเครื่อง: ' + sh.getParent().getName() + ' → ' + sh.getName());
  Logger.log('ส่งอีเมลได้อีกวันนี้ ' + MailApp.getRemainingDailyQuota() + ' ฉบับ ไปที่ ' + (props.getProperty('OWNER_EMAIL') || Session.getEffectiveUser().getEmail()));
  Logger.log('เวอร์ชันโค้ด ' + CODE_VERSION + ' · ถ้าขึ้น HTTP 200 พร้อมใช้งาน');
}
