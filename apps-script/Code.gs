/**
 * แบบสำรวจการแสดงของนักเรียน
 * งานนมัสการปิดทองหลวงพ่อนิล วัดปรีดาราม (ยายส้ม) ประจำปี 2570
 *
 * หน้าเว็บ   : GitHub Pages (index.html ในรีพอซิทอรี)
 * API      : ไฟล์นี้ (Google Apps Script เว็บแอป)
 * ฐานข้อมูล : Google Sheet
 * ไฟล์แนบ   : Google Drive
 */

// ===================== ตั้งค่า =====================
const CONFIG = {
  // เว้นว่างไว้ ถ้าสร้างสคริปต์จากเมนู "ส่วนขยาย > Apps Script" ใน Google Sheet
  // (สคริปต์จะใช้ชีตนั้นเอง) หรือใส่ ID ของ Google Sheet ที่ต้องการ
  SPREADSHEET_ID: '',
  SHEET_NAME: 'คำตอบ',

  // เว้นว่างไว้ ระบบจะสร้างโฟลเดอร์ชื่อ FOLDER_NAME ใน Drive ให้อัตโนมัติ
  // หรือใส่ ID ของโฟลเดอร์ Google Drive ที่ต้องการ
  FOLDER_ID: '',
  FOLDER_NAME: 'ไฟล์แนบ - แบบสำรวจการแสดง งานปิดทองหลวงพ่อนิล 2570',

  MAX_FILES: 5,
  MAX_FILE_MB: 100,  // ต่อไฟล์
  MAX_TOTAL_MB: 500, // รวมทุกไฟล์

  // หน้าเว็บส่งไฟล์มาเป็นชิ้น ๆ ทีละ CHUNK_MB แล้วสคริปต์นี้ต่อชิ้นเข้า Google Drive (resumable upload)
  // หน้าเว็บอ่านค่านี้จากเซิร์ฟเวอร์เอง (ต้องเป็นจำนวนเต็ม MB และไม่เกิน 30)
  CHUNK_MB: 8
};

const HEADERS = [
  'วันเวลาที่ส่ง',
  'ชื่อโรงเรียน',
  'ชื่อผู้อำนวยการโรงเรียน',
  'ระดับชั้น',
  'ชื่อชุดการแสดง',
  'ชื่อครูผู้ฝึกซ้อม',
  'ลิงก์เพลง',
  'ไฟล์แนบ'
];
// ==================================================

/** ตรวจสอบว่า API ทำงานอยู่ (เปิด URL /exec ในเบราว์เซอร์ได้) */
function doGet() {
  return json_({ ok: true, service: 'watpreedaramfest-survey' });
}

/**
 * รับข้อมูลจากหน้าเว็บ (GitHub Pages) ผ่าน fetch POST (body เป็น JSON แบบ text/plain)
 *   action 'initUpload'  : เริ่มอัปโหลดไฟล์ 1 ไฟล์ ได้ uploadId กลับไป
 *   action 'uploadChunk' : ส่งไฟล์ทีละชิ้น (base64)
 *   action 'submit'      : ส่งคำตอบ พร้อม uploadIds ของไฟล์ที่อัปโหลดเสร็จแล้ว
 */
function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    // honeypot: บอตมักกรอกช่องที่ซ่อนไว้ ให้ตอบว่าสำเร็จแต่ไม่บันทึก
    if (req.website) return json_({ ok: true });
    switch (req.action) {
      case 'initUpload': return json_(initUpload_(req));
      case 'uploadChunk': return json_(uploadChunk_(req));
      default: return json_(submitForm(req));
    }
  } catch (err) {
    return json_({ ok: false, error: err && err.message ? err.message : String(err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function submitForm(form) {
  const data = validate_(form);

  // 1) รวบรวมลิงก์ไฟล์ที่อัปโหลดเสร็จแล้ว
  const ids = Array.isArray(form.uploadIds) ? form.uploadIds : [];
  if (ids.length > CONFIG.MAX_FILES) throw new Error('แนบไฟล์ได้ไม่เกิน ' + CONFIG.MAX_FILES + ' ไฟล์');
  const fileLinks = ids.map(function (id) {
    const up = getUpload_(id);
    if (!up.fileId) throw new Error('ไฟล์ "' + up.name + '" อัปโหลดไม่ครบ กรุณาลองส่งใหม่');
    return 'https://drive.google.com/file/d/' + up.fileId + '/view';
  });

  // 2) บันทึกลง Google Sheet
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet_();
    sheet.appendRow([
      new Date(),
      safe_(data.school),
      safe_(data.director),
      safe_(data.level),
      safe_(data.showName),
      safe_(data.trainer),
      safe_(data.musicLink),
      fileLinks.join('\n')
    ]);
  } finally {
    lock.releaseLock();
  }

  ids.forEach(function (id) { CacheService.getScriptCache().remove('up_' + id); });
  return { ok: true, files: fileLinks.length };
}

// ---------------- อัปโหลดไฟล์ขนาดใหญ่ (Drive resumable upload) ----------------

const MB_ = 1024 * 1024;
const UPLOAD_TTL_ = 6 * 60 * 60; // วินาที (สูงสุดของ CacheService)

function initUpload_(req) {
  const size = Number(req.size);
  const name = cleanFileName_(req.name);
  const type = String(req.type || 'application/octet-stream').substring(0, 200);
  if (!(size > 0)) throw new Error('ไฟล์ "' + name + '" ว่างเปล่า');
  if (size > CONFIG.MAX_FILE_MB * MB_) {
    throw new Error('ไฟล์ "' + name + '" มีขนาดเกิน ' + CONFIG.MAX_FILE_MB + ' MB');
  }
  const school = String(req.school || '').trim().substring(0, 60);
  const fullName = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd-HHmmss')
    + (school ? ' ' + school : '') + ' - ' + name;

  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
      method: 'post',
      contentType: 'application/json; charset=UTF-8',
      headers: {
        Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
        'X-Upload-Content-Type': type,
        'X-Upload-Content-Length': String(size)
      },
      payload: JSON.stringify({ name: fullName, parents: [getFolder_().getId()] }),
      muteHttpExceptions: true
    });
  const headers = res.getHeaders();
  const sessionUrl = headers.Location || headers.location;
  if (res.getResponseCode() !== 200 || !sessionUrl) {
    throw new Error('เริ่มอัปโหลดไปยัง Google Drive ไม่สำเร็จ (' + res.getResponseCode() + ')');
  }

  const id = Utilities.getUuid();
  putUpload_(id, { url: sessionUrl, size: size, received: 0, name: name, type: type, fileId: '' });
  return { ok: true, uploadId: id, chunkSize: CONFIG.CHUNK_MB * MB_ };
}

function uploadChunk_(req) {
  const id = String(req.uploadId || '');
  const up = getUpload_(id);
  const offset = Number(req.offset);
  if (up.fileId) return { ok: true, received: up.size, done: true };
  // ชิ้นนี้ถูกรับไปแล้ว (หน้าเว็บส่งซ้ำตอนลองใหม่)
  if (offset < up.received) return { ok: true, received: up.received, done: false };
  if (offset !== up.received) throw new Error('ลำดับการอัปโหลดไม่ถูกต้อง กรุณาลองส่งใหม่');

  const bytes = Utilities.base64Decode(String(req.data || ''));
  const end = offset + bytes.length;
  const isLast = end === up.size;
  if (!bytes.length || end > up.size) throw new Error('ข้อมูลไฟล์ไม่ถูกต้อง');
  if (!isLast && bytes.length % (256 * 1024) !== 0) throw new Error('ขนาดชิ้นไฟล์ไม่ถูกต้อง');

  const res = UrlFetchApp.fetch(up.url, {
    method: 'put',
    contentType: up.type,
    headers: { 'Content-Range': 'bytes ' + offset + '-' + (end - 1) + '/' + up.size },
    payload: bytes,
    muteHttpExceptions: true,
    followRedirects: false
  });
  const code = res.getResponseCode();
  if (code === 308) {
    const range = res.getHeaders().Range || res.getHeaders().range || '';
    const m = /bytes=0-(\d+)/.exec(range);
    up.received = m ? Number(m[1]) + 1 : 0;
  } else if (code === 200 || code === 201) {
    up.received = up.size;
    up.fileId = JSON.parse(res.getContentText()).id;
  } else {
    throw new Error('อัปโหลดไฟล์ "' + up.name + '" ไม่สำเร็จ (' + code + ')');
  }
  putUpload_(id, up);
  return { ok: true, received: up.received, done: !!up.fileId };
}

function getUpload_(id) {
  const raw = /^[0-9a-f-]{36}$/i.test(id) && CacheService.getScriptCache().get('up_' + id);
  if (!raw) throw new Error('ไม่พบไฟล์ที่อัปโหลด หรือหมดเวลาแล้ว กรุณาลองส่งใหม่');
  return JSON.parse(raw);
}

function putUpload_(id, up) {
  CacheService.getScriptCache().put('up_' + id, JSON.stringify(up), UPLOAD_TTL_);
}

function cleanFileName_(n) {
  return String(n || 'file').replace(/[\\/:*?"<>|]/g, '_').substring(0, 120);
}

// ---------------- helpers ----------------

function validate_(form) {
  if (!form) throw new Error('ไม่พบข้อมูลแบบฟอร์ม');
  const clean = function (v) { return String(v == null ? '' : v).trim().substring(0, 1000); };
  const d = {
    school: clean(form.school),
    director: clean(form.director),
    level: clean(form.level),
    showName: clean(form.showName),
    trainer: clean(form.trainer),
    musicLink: clean(form.musicLink)
  };
  const labels = {
    school: 'ชื่อโรงเรียน', director: 'ชื่อผู้อำนวยการโรงเรียน', level: 'ระดับชั้น',
    showName: 'ชื่อชุดการแสดง', trainer: 'ชื่อครูผู้ฝึกซ้อม', musicLink: 'ลิงก์เพลง'
  };
  Object.keys(labels).forEach(function (k) {
    if (!d[k]) throw new Error('กรุณากรอก ' + labels[k]);
  });
  if (!/^https?:\/\/\S+$/i.test(d.musicLink)) {
    throw new Error('ลิงก์เพลงต้องขึ้นต้นด้วย http:// หรือ https://');
  }

  return d;
}

/** กันไม่ให้ข้อความที่ผู้ใช้พิมพ์ถูกตีความเป็นสูตรใน Sheet */
function safe_(v) {
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function getSpreadsheet_() {
  return CONFIG.SPREADSHEET_ID
    ? SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet_() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(CONFIG.SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length)
      .setFontWeight('bold').setBackground('#7a1f1f').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.getRange('A:A').setNumberFormat('dd/MM/yyyy HH:mm:ss');
    sheet.setColumnWidths(1, HEADERS.length, 200);
  }
  return sheet;
}

function getFolder_() {
  if (CONFIG.FOLDER_ID) return DriveApp.getFolderById(CONFIG.FOLDER_ID);
  const props = PropertiesService.getScriptProperties();
  const savedId = props.getProperty('FOLDER_ID');
  if (savedId) {
    try { return DriveApp.getFolderById(savedId); } catch (e) { /* ถูกลบไปแล้ว สร้างใหม่ */ }
  }
  const folder = DriveApp.createFolder(CONFIG.FOLDER_NAME);
  props.setProperty('FOLDER_ID', folder.getId());
  return folder;
}

/** รันฟังก์ชันนี้ 1 ครั้งจากตัวแก้ไขสคริปต์ เพื่อสร้างหัวตาราง โฟลเดอร์ และขอสิทธิ์ */
function setup() {
  getSheet_();
  const folder = getFolder_();
  // ขอสิทธิ์เชื่อมต่อภายนอก (ใช้ส่งไฟล์ขนาดใหญ่เข้า Google Drive)
  UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
  });
  Logger.log('ชีต: ' + getSpreadsheet_().getUrl());
  Logger.log('โฟลเดอร์ไฟล์แนบ: ' + folder.getUrl());
}
