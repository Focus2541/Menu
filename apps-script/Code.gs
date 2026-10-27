/**
 * แปลเมนู — ตัวกลางอ่านเมนู/ป้ายด้วย Gemini (API key อยู่ที่นี่ ไม่อยู่ในแอป)
 * เวอร์ชันโค้ด 3: ตอบสั้นลง ลดการคิดของโมเดล (เลือกค่าที่รุ่นนั้นรับได้เอง) ไม่ลองซ้ำเมื่อรอนานแล้ว
 *
 * ตั้งค่าใน Project Settings → Script properties:
 *   GEMINI_API_KEY  (จำเป็น)  key จาก https://aistudio.google.com/apikey (ใช้ key เดียวกับแอปกินพอดีได้)
 *   APP_TOKEN       (จำเป็น)  รหัสลับที่ตั้งเอง ต้องตรงกับที่กรอกในแอป
 *   MODEL           (ไม่บังคับ) โมเดลอ่านเมนู ค่าเริ่มต้น gemini-flash-lite-latest (เร็ว ~1–10 วิ)
 *                   ใส่ gemini-flash-latest ถ้าอยากได้คำแปลละเอียดกว่า แต่บางช่วงช้ามาก (เคยวัดได้ 4 นาที)
 *   SIGN_MODEL      (ไม่บังคับ) โมเดลอ่านป้าย ค่าเริ่มต้น gemini-flash-lite-latest (เร็วกว่า)
 *   PER_HOUR        (ไม่บังคับ) จำกัดจำนวนรูปต่อชั่วโมง ค่าเริ่มต้น 40
 *
 * Deploy → New deployment → Web app   (แก้โค้ดภายหลัง: Manage deployments → ✏️ → Version: New version)
 *   Execute as: Me   |   Who has access: Anyone
 */

const CODE_VERSION = 3;
const MAX_IMAGE_CHARS = 5 * 1024 * 1024;
const ALLERGENS = ['ไข่', 'นม', 'ถั่วลิสง', 'ถั่วเปลือกแข็ง', 'แป้งสาลี', 'ถั่วเหลือง', 'กุ้ง/ปู', 'หอย', 'ปลา', 'งา'];
// แท็กส่วนผสมแบบสั้น (ตอบสั้น = เร็ว) "?" = อาจมี
const TAGS = ['pork', 'pork?', 'beef', 'beef?', 'chicken', 'chicken?', 'seafood', 'seafood?', 'alcohol', 'alcohol?', 'veg'];

function doPost(e) {
  const t0 = Date.now();
  try {
    const props = PropertiesService.getScriptProperties();
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!props.getProperty('APP_TOKEN') || req.token !== props.getProperty('APP_TOKEN')) {
      return json_({ ok: false, error: 'รหัสลับไม่ถูกต้อง' });
    }
    if (req.action === 'ping') return json_({ ok: true, app: 'menu', version: CODE_VERSION });
    if (req.action !== 'menu') return json_({ ok: false, error: 'ไม่รู้จักคำสั่ง' });
    if (!req.image || typeof req.image !== 'string') return json_({ ok: false, error: 'ไม่พบรูปภาพ' });
    if (req.image.length > MAX_IMAGE_CHARS) return json_({ ok: false, error: 'รูปใหญ่เกินไป' });
    if (!rateOk_(props)) return json_({ ok: false, error: 'ใช้งานถี่เกินไป รอสักครู่แล้วลองใหม่' });
    const out = req.mode === 'sign' ? sign_(req, props) : menu_(req, props);
    out.ok = true; out.version = CODE_VERSION; out.ms = Date.now() - t0;
    return json_(out);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err), version: CODE_VERSION, ms: Date.now() - t0 });
  }
}

function doGet() { return json_({ ok: true, app: 'menu', version: CODE_VERSION, hint: 'ใช้ POST' }); }

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
  const limit = Number(props.getProperty('PER_HOUR') || 40);
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
  ['GEMINI_API_KEY', 'APP_TOKEN'].forEach(function (k) {
    Logger.log(k + ': ' + (props.getProperty(k) ? 'ตั้งแล้ว' : 'ยังไม่ได้ตั้ง'));
  });
  [props.getProperty('MODEL') || 'gemini-flash-lite-latest', props.getProperty('SIGN_MODEL') || 'gemini-flash-lite-latest'].forEach(function (m) {
    const t0 = Date.now();
    const r = callGemini_({ contents: [{ parts: [{ text: 'ตอบคำว่า พร้อม' }] }], generationConfig: {} }, m, props);
    Logger.log(m + ' → ' + r.model + ' ' + JSON.stringify(r.think || 'ไม่ตั้งค่าคิด') + ': HTTP ' + r.code + ' ใน ' + ((Date.now() - t0) / 1000).toFixed(1) + ' วินาที');
    if (r.code !== 200) Logger.log('   ' + JSON.stringify(r.data).slice(0, 300));
  });
  Logger.log('เวอร์ชันโค้ด ' + CODE_VERSION + ' · ถ้าขึ้น HTTP 200 พร้อมใช้งาน');
}
