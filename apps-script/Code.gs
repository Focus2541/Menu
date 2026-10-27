/**
 * แปลเมนู — ตัวกลางอ่านเมนู/ป้ายด้วย Gemini (API key อยู่ที่นี่ ไม่อยู่ในแอป)
 *
 * ตั้งค่าใน Project Settings → Script properties:
 *   GEMINI_API_KEY  (จำเป็น)  key จาก https://aistudio.google.com/apikey (ใช้ key เดียวกับแอปกินพอดีได้)
 *   APP_TOKEN       (จำเป็น)  รหัสลับที่ตั้งเอง ต้องตรงกับที่กรอกในแอป
 *   MODEL           (ไม่บังคับ) ค่าเริ่มต้น gemini-flash-latest
 *                   ถ้าคนใช้เยอะ (503/429) จะลองซ้ำ แล้วสลับไป gemini-flash-lite-latest ให้เอง
 *   PER_HOUR        (ไม่บังคับ) จำกัดจำนวนรูปต่อชั่วโมง ค่าเริ่มต้น 40
 *
 * Deploy → New deployment → Web app
 *   Execute as: Me   |   Who has access: Anyone
 */

const MAX_IMAGE_CHARS = 5 * 1024 * 1024; // base64 ~3.7 MB
const ALLERGENS = ['ไข่', 'นม', 'ถั่วลิสง', 'ถั่วเปลือกแข็ง', 'แป้งสาลี/กลูเตน', 'ถั่วเหลือง', 'กุ้ง/ปู', 'หอย', 'ปลา', 'งา'];

function doPost(e) {
  try {
    const props = PropertiesService.getScriptProperties();
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!props.getProperty('APP_TOKEN') || req.token !== props.getProperty('APP_TOKEN')) {
      return json_({ ok: false, error: 'รหัสลับไม่ถูกต้อง' });
    }
    if (req.action === 'ping') return json_({ ok: true, app: 'menu', version: 1 });
    if (req.action !== 'menu') return json_({ ok: false, error: 'ไม่รู้จักคำสั่ง' });
    if (!req.image || typeof req.image !== 'string') return json_({ ok: false, error: 'ไม่พบรูปภาพ' });
    if (req.image.length > MAX_IMAGE_CHARS) return json_({ ok: false, error: 'รูปใหญ่เกินไป' });
    if (!rateOk_(props)) return json_({ ok: false, error: 'ใช้งานถี่เกินไป รอสักครู่แล้วลองใหม่' });
    const out = read_(req, props);
    return json_({ ok: true, kind: out.kind, lang: out.lang, items: out.items, note: out.note, model: out.model });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function doGet() { return json_({ ok: true, app: 'menu', hint: 'ใช้ POST' }); }

function read_(req, props) {
  const sign = req.mode === 'sign';
  const where = String(req.country || '').slice(0, 40);
  const diet = String(req.diet || '').slice(0, 200);
  const prompt = sign
    ? 'You help a Thai tourist' + (where ? ' in ' + where : '') + ' understand a photo of a sign, notice, label, ticket machine or any text. ' +
      'Split the text into meaningful blocks in reading order (max 40). For each block return: ' +
      'orig = the exact original text; reading = how to pronounce the original, written in Thai script; ' +
      'th = natural Thai translation; desc = one short Thai sentence explaining what it means or what to do (empty if obvious). ' +
      'price = null. All flags false/"no", spicy 0, allergens empty. ' +
      'kind = "sign". lang = BCP-47 code of the original language. note = one short Thai sentence summarising the whole sign.'
    : 'You help a Thai tourist' + (where ? ' in ' + where : '') + ' read a restaurant menu photo. ' +
      'List every dish and drink you can read, in the order shown (max 60). For each item return: ' +
      'orig = the item name exactly as written on the menu; reading = pronunciation of the original name written in Thai script (so a Thai can say it); ' +
      'th = a natural Thai name a Thai person would understand (e.g. "ราเมงซุปกระดูกหมู"); ' +
      'desc = one short Thai sentence: what it is, main ingredients, cooking style, portion if shown; ' +
      'price = the number printed for this item (no currency symbol, choose the regular size if several), null if none; ' +
      'pork/beef/chicken/seafood/alcohol = "yes", "maybe" or "no". Treat lard, pork bone broth (tonkotsu), chashu, bacon, ham, sausage, gyoza filling and pork-based dashi as pork "yes". ' +
      'Use "maybe" when the dish is usually made with it but the menu does not say. ' +
      'spicy = 0 (not spicy) to 3 (very spicy); vegetarian = true only if no meat, fish or seafood at all (including broth); ' +
      'allergens = which of these are likely present: ' + ALLERGENS.join(', ') + '. ' +
      'confidence = "สูง", "กลาง" or "ต่ำ" for how sure you are about the translation. ' +
      'kind = "menu" (or "other" if the photo is not a menu, with an empty list). lang = BCP-47 code of the menu language. ' +
      'note = short Thai note about anything important on the menu (tax included or not, service charge, set menu rules, cash only, ordering by ticket machine), empty if none.' +
      (diet ? ' The tourist cannot eat: ' + diet + '. Be careful with these.' : '');

  const yn = { type: 'STRING', enum: ['yes', 'maybe', 'no'] };
  const body = {
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: req.mime || 'image/jpeg', data: req.image } }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 16384,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          kind: { type: 'STRING', enum: ['menu', 'sign', 'other'] },
          lang: { type: 'STRING' },
          note: { type: 'STRING' },
          items: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                orig: { type: 'STRING' }, reading: { type: 'STRING' }, th: { type: 'STRING' }, desc: { type: 'STRING' },
                price: { type: 'NUMBER', nullable: true },
                pork: yn, beef: yn, chicken: yn, seafood: yn, alcohol: yn,
                spicy: { type: 'INTEGER' }, vegetarian: { type: 'BOOLEAN' },
                allergens: { type: 'ARRAY', items: { type: 'STRING' } },
                confidence: { type: 'STRING', enum: ['สูง', 'กลาง', 'ต่ำ'] }
              },
              required: ['orig', 'th']
            }
          }
        },
        required: ['kind', 'items']
      }
    }
  };

  const r = callGemini_(body, props);
  if (r.code !== 200) {
    if (r.code === 503 || r.code === 429) throw new Error('AI มีคนใช้เยอะชั่วคราว ลองใหม่อีกครั้งใน 1–2 นาที');
    throw new Error('Gemini: ' + (r.data.error && r.data.error.message ? r.data.error.message : 'HTTP ' + r.code));
  }
  const cand = r.data.candidates && r.data.candidates[0];
  const text = cand && cand.content && (cand.content.parts || []).map(function (p) { return p.text || ''; }).join('');
  if (!text) throw new Error('AI ไม่ได้ตอบกลับ ลองถ่ายใหม่ให้ตัวหนังสือชัดขึ้น');
  let out;
  try { out = JSON.parse(text); }
  catch (e) { throw new Error(cand.finishReason === 'MAX_TOKENS' ? 'เมนูยาวเกินไป ลองถ่ายทีละครึ่งหน้า' : 'อ่านผลจาก AI ไม่ได้ ลองใหม่อีกครั้ง'); }
  const s = function (v, n) { return String(v == null ? '' : v).slice(0, n); };
  const f = function (v) { return v === 'yes' || v === 'maybe' ? v : 'no'; };
  return {
    kind: out.kind || 'other', lang: s(out.lang, 20), note: s(out.note, 300), model: r.model,
    items: (out.items || []).slice(0, 60).map(function (i) {
      const p = Number(i.price);
      return {
        orig: s(i.orig, 120), reading: s(i.reading, 120), th: s(i.th, 120), desc: s(i.desc, 240),
        price: isFinite(p) && p > 0 ? p : null,
        pork: f(i.pork), beef: f(i.beef), chicken: f(i.chicken), seafood: f(i.seafood), alcohol: f(i.alcohol),
        spicy: Math.max(0, Math.min(3, Math.round(+i.spicy || 0))), veg: !!i.vegetarian,
        allergens: (i.allergens || []).filter(function (a) { return ALLERGENS.indexOf(a) >= 0; }),
        conf: i.confidence || ''
      };
    })
  };
}

/** เรียก Gemini: ลองโมเดลหลัก 2 ครั้ง ถ้ายังติด 503/429/500 สลับไปโมเดล lite */
function callGemini_(body, props) {
  const key = props.getProperty('GEMINI_API_KEY') || '';
  if (!key) throw new Error('ยังไม่ได้ตั้ง GEMINI_API_KEY ใน Script properties');
  const models = [props.getProperty('MODEL') || 'gemini-flash-latest', 'gemini-flash-lite-latest']
    .filter(function (m, i, a) { return a.indexOf(m) === i; });
  let last = { code: 0, data: {} };
  for (let m = 0; m < models.length; m++) {
    for (let attempt = 0; attempt < (m === 0 ? 2 : 1); attempt++) {
      const res = UrlFetchApp.fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(models[m]) + ':generateContent',
        { method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key },
          payload: JSON.stringify(body), muteHttpExceptions: true });
      let data = {};
      try { data = JSON.parse(res.getContentText() || '{}'); } catch (e) {}
      last = { code: res.getResponseCode(), data: data, model: models[m] };
      if (last.code !== 503 && last.code !== 429 && last.code !== 500) return last;
      if (attempt === 0 && m === 0) Utilities.sleep(1500);
    }
  }
  return last;
}

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

/** กด Run ฟังก์ชันนี้ครั้งแรกเพื่ออนุญาตสิทธิ์ และเช็กว่า key ใช้ได้ */
function testSetup() {
  const props = PropertiesService.getScriptProperties();
  ['GEMINI_API_KEY', 'APP_TOKEN'].forEach(function (k) {
    Logger.log(k + ': ' + (props.getProperty(k) ? 'ตั้งแล้ว' : 'ยังไม่ได้ตั้ง'));
  });
  const r = callGemini_({ contents: [{ parts: [{ text: 'ตอบคำว่า พร้อม' }] }] }, props);
  Logger.log('Gemini (' + r.model + '): HTTP ' + r.code);
  if (r.code === 200) Logger.log('✅ พร้อมใช้งาน ไปขั้น Deploy ต่อได้เลย');
  else if (r.code === 503 || r.code === 429) Logger.log('⏳ key ใช้ได้ แต่คนใช้เยอะชั่วคราว ไปขั้น Deploy ต่อได้เลย');
  else Logger.log('❌ ' + JSON.stringify(r.data).slice(0, 300));
}
