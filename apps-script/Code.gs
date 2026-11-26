/**
 * แบบสำรวจการแสดงของนักเรียน
 * งานนมัสการปิดทองหลวงพ่อนิล วัดปรีดาราม (มณีศิริวรรณ) ประจำปี 2570
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
  MAX_FILE_MB: 10,   // ต่อไฟล์
  MAX_TOTAL_MB: 25   // รวมทุกไฟล์
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

/** รับข้อมูลจากหน้าเว็บ (GitHub Pages) ผ่าน fetch POST (body เป็น JSON แบบ text/plain) */
function doPost(e) {
  try {
    const form = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    // honeypot: บอตมักกรอกช่องที่ซ่อนไว้ ให้ตอบว่าสำเร็จแต่ไม่บันทึก
    if (form.website) return json_({ ok: true });
    return json_(submitForm(form));
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

  // 1) อัปโหลดไฟล์ (ถ้ามี)
  const fileLinks = [];
  if (form.files && form.files.length) {
    const folder = getFolder_();
    const prefix = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd-HHmmss')
      + ' ' + data.school.substring(0, 60) + ' - ';
    form.files.forEach(function (f) {
      const bytes = Utilities.base64Decode(f.data);
      const blob = Utilities.newBlob(bytes, f.type || 'application/octet-stream', prefix + f.name);
      const file = folder.createFile(blob);
      fileLinks.push(file.getUrl());
    });
  }

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

  return { ok: true, files: fileLinks.length };
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

  const files = form.files || [];
  if (files.length > CONFIG.MAX_FILES) throw new Error('แนบไฟล์ได้ไม่เกิน ' + CONFIG.MAX_FILES + ' ไฟล์');
  let total = 0;
  files.forEach(function (f) {
    const size = Math.floor((f.data || '').length * 3 / 4);
    if (size > CONFIG.MAX_FILE_MB * 1024 * 1024) {
      throw new Error('ไฟล์ "' + f.name + '" มีขนาดเกิน ' + CONFIG.MAX_FILE_MB + ' MB');
    }
    total += size;
    f.name = String(f.name || 'file').replace(/[\\/:*?"<>|]/g, '_').substring(0, 120);
  });
  if (total > CONFIG.MAX_TOTAL_MB * 1024 * 1024) {
    throw new Error('ขนาดไฟล์รวมเกิน ' + CONFIG.MAX_TOTAL_MB + ' MB');
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
  Logger.log('ชีต: ' + getSpreadsheet_().getUrl());
  Logger.log('โฟลเดอร์ไฟล์แนบ: ' + folder.getUrl());
}
