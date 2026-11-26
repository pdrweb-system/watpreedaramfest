// ตั้งค่าแบบสำรวจ
// SCRIPT_URL: URL ของเว็บแอป Google Apps Script (ลงท้ายด้วย /exec) ที่ได้จากขั้นตอนใน README.md
window.SURVEY_CONFIG = {
  SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbzCTBf2z_qM-Ki1RxXqvClygkVzkkolZuVc-g2dPem7n7QKId3OaMYzMF-zbcvoKTOegg/exec',

  // ต้องตรงกับค่าใน apps-script/Code.gs
  MAX_FILES: 5,
  MAX_FILE_MB: 10,
  MAX_TOTAL_MB: 25
};
