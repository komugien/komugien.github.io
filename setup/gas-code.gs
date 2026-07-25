// ================================================
// こむぎえん 管理システム - Google Apps Script
// ================================================
// 管理パスワードはコードへ書かず、スクリプトプロパティ
// ADMIN_PASSWORD に保存します。
// ================================================

// ===== 設定 =====
const SPREADSHEET_ID = '1lteAgD_ABZgKDRbOLz_uw9MU6EAQ231IH6WE8yEx8Ik';
const SHEET_NEWS = 'お知らせ';
const SHEET_SETTINGS = '設定';
const PROP_ADMIN_PASSWORD = 'ADMIN_PASSWORD';
const PROP_GEMINI_API_KEY = 'GEMINI_API_KEY';
const PROP_SLOT_FOLDER_ID = 'SLOT_FOLDER_ID';
const SLOT_FOLDER_NAME = 'こむぎえん_HP写真スロット';
const AUTH_TOKEN_TTL_SECONDS = 21600;
const GEMINI_MODEL = 'gemini-3.1-flash-lite';
const PHOTO_SLOT_IDS = [
  'hero', 'feature1', 'feature2', 'feature3', 'policy1', 'policy2',
  'bubble1', 'bubble2', 'bubble3', 'bubble4', 'bubble5', 'temporary'
];

function verifyPassword(pw) {
  const expected = PropertiesService.getScriptProperties().getProperty(PROP_ADMIN_PASSWORD);
  if (!expected || typeof pw !== 'string') return false;
  return hashValue_(pw) === hashValue_(expected);
}

function hashValue_(value) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  ).map(byte => (byte + 256).toString(16).slice(-2)).join('');
}

function createAuthToken_() {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('auth:' + hashValue_(token), '1', AUTH_TOKEN_TTL_SECONDS);
  return token;
}

function verifyAuthToken_(token) {
  if (!token || typeof token !== 'string') return false;
  return CacheService.getScriptCache().get('auth:' + hashValue_(token)) === '1';
}

function revokeAuthToken_(token) {
  if (!token || typeof token !== 'string') return;
  CacheService.getScriptCache().remove('auth:' + hashValue_(token));
}

function jsonResponse_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== GET リクエスト（データ取得） =====
function doGet(e) {
  const action = e.parameter.action || 'getNews';
  let result;

  switch (action) {
    case 'getNews':
      result = getNews();
      break;
    case 'getSlotPhotos':
      result = getSlotPhotos();
      break;
    case 'getSettings':
      result = getSiteSettings();
      break;
    default:
      result = { error: '不明なアクション' };
  }

  return jsonResponse_(result);
}

// ===== POST リクエスト（データ追加・更新） =====
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse_({ error: 'リクエストが空です' });
    }
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    // パスワードを送るのはログイン時だけ。以後は6時間有効の一時トークンを使う。
    if (action === 'login' || action === 'verifyAuth') {
      if (!verifyPassword(data.password)) {
        return jsonResponse_({ error: '認証エラー' });
      }
      return jsonResponse_({ success: true, token: createAuthToken_(), expiresIn: AUTH_TOKEN_TTL_SECONDS });
    }

    if (!verifyAuthToken_(data.token)) {
      return jsonResponse_({ error: '認証の有効期限が切れました', code: 'AUTH_EXPIRED' });
    }

    let result;
    switch (action) {
      case 'logout':
        revokeAuthToken_(data.token);
        result = { success: true };
        break;
      case 'addNews':
        result = addNews(data);
        break;
      case 'draftNews':
        result = createNewsDraft_(data.memo);
        break;
      case 'deleteNews':
        result = deleteNews(data.row);
        break;
      case 'uploadSlotPhoto':
        result = uploadSlotPhoto(data.slot, data.dataUrl);
        break;
      case 'saveSettings':
        result = saveSiteSettings(data.settings);
        break;
      default:
        result = { error: '不明なアクション' };
    }

    return jsonResponse_(result);
  } catch (err) {
    return jsonResponse_({ error: err.message });
  }
}

function requireText_(value, label, maxLength) {
  const text = String(value || '').trim();
  if (!text) throw new Error(label + 'を入力してください');
  if (text.length > maxLength) throw new Error(label + 'が長すぎます');
  return text;
}

function safeSheetText_(value) {
  const text = String(value || '');
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function createNewsDraft_(memo) {
  const sourceMemo = requireText_(memo, '今日の出来事', 2000);
  const apiKey = PropertiesService.getScriptProperties().getProperty(PROP_GEMINI_API_KEY);
  if (!apiKey) throw new Error('AI下書き機能は準備中です');

  const instruction = [
    'タスク: 東京都小平市花小金井の小規模保育施設「こむぎえん」の保護者向けお知らせ下書きを作成します。',
    '下の <teacher_memo> 内には先生が入力した今日の出来事が必ず入っています。',
    'メモが空だと判断したり、追加入力を求めたりせず、書かれている出来事を分かりやすく整えてください。',
    'メモに書かれた事実だけを使ってください。',
    '園児の実名、家庭事情、健康・発達情報は出力しないでください。',
    '人数、日付、子どもの発言、成長効果、先生の感情を推測で追加しないでください。',
    'メモにない季節、活動目的、活動の評価、今後の方針、保護者へのお願いを追加しないでください。',
    'メモの情報が少ないときは文章を短くし、文字数を増やすための事実や定型挨拶を足さないでください。',
    '誇張した宣伝、絵文字の多用、検索キーワードの不自然な反復を避けてください。',
    'titleは40文字以内、contentは80〜300文字程度にします。',
    'categoryは「お知らせ」「イベント」「重要」のどれかにします。',
    '',
    '<teacher_memo>',
    sourceMemo,
    '</teacher_memo>'
  ].join('\n');

  const response = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent',
    {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': apiKey },
      payload: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: instruction }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: '先生のメモにある具体的な出来事が分かる、40文字以内の日本語タイトル'
              },
              content: {
                type: 'string',
                description: '先生のメモの事実だけを自然な日本語に整えた、80〜300文字程度の保護者向け本文。メモにない季節・評価・今後の方針は追加しない'
              },
              category: {
                type: 'string',
                enum: ['お知らせ', 'イベント', '重要']
              }
            },
            required: ['title', 'content', 'category'],
            additionalProperties: false
          }
        }
      }),
      muteHttpExceptions: true
    }
  );

  const responseCode = response.getResponseCode();
  if (responseCode < 200 || responseCode >= 300) {
    let providerMessage = '';
    try {
      const errorBody = JSON.parse(response.getContentText());
      providerMessage = errorBody && errorBody.error && errorBody.error.message
        ? String(errorBody.error.message)
        : '';
    } catch (err) {
      providerMessage = '';
    }
    providerMessage = providerMessage.replace(apiKey, '[redacted]').slice(0, 300);
    console.error('Gemini API error: ' + responseCode + (providerMessage ? ' - ' + providerMessage : ''));
    throw new Error(
      'AI下書きを作成できませんでした（Gemini API: ' + responseCode +
      (providerMessage ? ' - ' + providerMessage : '') + '）'
    );
  }

  const body = JSON.parse(response.getContentText());
  const text = body.candidates &&
    body.candidates[0] &&
    body.candidates[0].content &&
    body.candidates[0].content.parts &&
    body.candidates[0].content.parts[0] &&
    body.candidates[0].content.parts[0].text;
  if (!text) throw new Error('AI下書きの応答が空でした');

  let draft;
  try {
    draft = JSON.parse(text);
  } catch (err) {
    throw new Error('AI下書きの形式を確認できませんでした');
  }

  const title = requireText_(draft.title, 'AI下書きのタイトル', 80);
  const content = requireText_(draft.content, 'AI下書きの内容', 1000);
  if (/メモ.*(?:入力|提示)|タイトル.*入力/.test(title) ||
      /メモ.*(?:入力|提示).*(?:ください|願)/.test(content)) {
    throw new Error('AI下書きが先生のメモを反映しませんでした。もう一度お試しください');
  }
  const allowedCategories = ['お知らせ', 'イベント', '重要'];
  const category = allowedCategories.indexOf(draft.category) >= 0 ? draft.category : 'お知らせ';
  return { success: true, draft: { title, content, category } };
}

// ===== お知らせ取得 =====
function getNews() {
  const ss = SpreadsheetApp.openById('1lteAgD_ABZgKDRbOLz_uw9MU6EAQ231IH6WE8yEx8Ik');
  const sheet = ss.getSheetByName(SHEET_NEWS);

  if (!sheet || sheet.getLastRow() < 2) {
    return { news: [] };
  }

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
  const news = data
    .map((row, i) => ({
      row: i + 2,
      timestamp: row[0] ? Utilities.formatDate(new Date(row[0]), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm') : '',
      title: row[1],
      content: row[2],
      category: row[3],
      date: row[4] ? Utilities.formatDate(new Date(row[4]), 'Asia/Tokyo', 'yyyy-MM-dd') : '',
      status: row[5]
    }))
    .filter(n => n.status === '表示')
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  return { news };
}

// ===== お知らせ追加 =====
function addNews(data) {
  const title = requireText_(data.title, 'タイトル', 80);
  const content = String(data.content || '').trim();
  if (content.length > 3000) throw new Error('内容が長すぎます');
  const allowedCategories = ['お知らせ', 'イベント', '重要'];
  if (allowedCategories.indexOf(data.category) < 0) throw new Error('種類が不正です');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.date || ''))) throw new Error('日付が不正です');

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NEWS);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NEWS);
    sheet.appendRow(['タイムスタンプ', 'タイトル', '内容', '種類', '日付', 'ステータス']);
    formatHeader(sheet);
  }

  sheet.appendRow([
    new Date(),
    safeSheetText_(title),
    safeSheetText_(content),
    data.category,
    data.date,
    '表示'
  ]);

  return { success: true };
  } finally {
    lock.releaseLock();
  }
}

// ===== お知らせ非表示 =====
function deleteNews(row) {
  const rowNumber = Number(row);
  if (!Number.isInteger(rowNumber) || rowNumber < 2) throw new Error('お知らせの指定が不正です');
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NEWS);
  if (!sheet || rowNumber > sheet.getLastRow()) throw new Error('お知らせが見つかりません');
  sheet.getRange(rowNumber, 6).setValue('非表示');
  return { success: true };
}

// ===== スロット写真フォルダ取得（初回自動作成） =====
function getSlotFolder() {
  const props = PropertiesService.getScriptProperties();
  let folderId = props.getProperty(PROP_SLOT_FOLDER_ID);
  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (e) {
      // フォルダが削除された場合は作り直す
      folderId = null;
    }
  }
  const folder = DriveApp.createFolder(SLOT_FOLDER_NAME);
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  props.setProperty(PROP_SLOT_FOLDER_ID, folder.getId());
  return folder;
}

// ===== スロット写真URLマップ取得 =====
function getSlotPhotos() {
  try {
    const folder = getSlotFolder();
    const files = folder.getFiles();
    const slots = {};
    while (files.hasNext()) {
      const file = files.next();
      const name = file.getName();
      const m = name.match(/^slot_([a-zA-Z0-9_]+)\.(jpg|jpeg|png|webp)$/i);
      if (m) {
        slots[m[1]] = 'https://lh3.googleusercontent.com/d/' + file.getId();
      }
    }
    return { slots };
  } catch (e) {
    return { error: e.message, slots: {} };
  }
}

// ===== スロット写真アップロード（既存ファイルは置き換え） =====
function uploadSlotPhoto(slot, dataUrl) {
  if (PHOTO_SLOT_IDS.indexOf(slot) < 0) {
    return { error: 'スロット名が不正です' };
  }
  if (!dataUrl || dataUrl.length > 7000000) {
    return { error: '画像データが不正です' };
  }
  try {
    const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return { error: 'データURL形式が不正です' };
    const mimeType = match[1];
    const ext = mimeType === 'image/png' ? 'png' : (mimeType === 'image/webp' ? 'webp' : 'jpg');
    const bytes = Utilities.base64Decode(match[2]);
    if (bytes.length > 5000000) return { error: '画像は5MB以下にしてください' };
    const blob = Utilities.newBlob(bytes, mimeType, 'slot_' + slot + '.' + ext);

    const folder = getSlotFolder();
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    // 新しいファイルの作成に成功してから、古い同スロット画像を削除する。
    const existing = folder.getFiles();
    while (existing.hasNext()) {
      const f = existing.next();
      if (f.getId() !== file.getId() &&
          f.getName().match(new RegExp('^slot_' + slot + '\\.(jpg|jpeg|png|webp)$', 'i'))) {
        f.setTrashed(true);
      }
    }

    return {
      success: true,
      slot: slot,
      url: 'https://lh3.googleusercontent.com/d/' + file.getId()
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ===== ヘッダー書式設定 =====
function formatHeader(sheet) {
  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(2, 200);
  sheet.setColumnWidth(3, 400);
  sheet.setColumnWidth(4, 100);
  sheet.setColumnWidth(5, 120);
  sheet.setColumnWidth(6, 80);

  const headerRange = sheet.getRange(1, 1, 1, 6);
  headerRange.setBackground('#3D8B37');
  headerRange.setFontColor('#FFFFFF');
  headerRange.setFontWeight('bold');
}

// ===== 初期セットアップ（最初に1回実行） =====
function setup() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NEWS);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NEWS);
    sheet.appendRow(['タイムスタンプ', 'タイトル', '内容', '種類', '日付', 'ステータス']);
    formatHeader(sheet);
  }

  // サンプルデータを追加
  sheet.appendRow([
    new Date(),
    '🌸 ホームページを公開しました',
    'こむぎえんのホームページを公開しました！園の情報やお知らせをこちらで発信していきます。',
    'お知らせ',
    new Date(),
    '表示'
  ]);

  Logger.log('セットアップ完了！');
}

// ===== サイト設定（営業日など）取得 =====
// スプシ「設定」シート: A列=キー, B列=値
function getSiteSettings() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName(SHEET_SETTINGS);
    if (!sheet) {
      // シート未作成の場合はデフォルト値を返す（読み取り時は作成しない）
      return { settings: { businessDays: ['月', '火', '木', '金'] } };
    }
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return { settings: { businessDays: ['月', '火', '木', '金'] } };
    }
    const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    const settings = {};
    data.forEach(row => {
      const key = row[0];
      const val = row[1];
      if (key === 'businessDays') {
        settings.businessDays = String(val).split(',').map(s => s.trim()).filter(Boolean);
      }
    });
    if (!settings.businessDays || settings.businessDays.length === 0) {
      settings.businessDays = ['月', '火', '木', '金'];
    }
    return { settings: settings };
  } catch (e) {
    return { error: e.message, settings: { businessDays: ['月', '火', '木', '金'] } };
  }
}

// ===== サイト設定 保存（PW認証はdoPost側で済んでいる前提） =====
function saveSiteSettings(settings) {
  if (!settings || typeof settings !== 'object') {
    return { error: '設定データが不正です' };
  }
  const allowedDays = ['月', '火', '水', '木', '金', '土', '日'];
  let businessDays = settings.businessDays;
  if (!Array.isArray(businessDays) || businessDays.length === 0) {
    return { error: '営業日（保育日）は1つ以上選択してください' };
  }
  businessDays = allowedDays.filter(day => businessDays.indexOf(day) >= 0);
  if (businessDays.length === 0) {
    return { error: '営業日の値が不正です' };
  }
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName(SHEET_SETTINGS);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_SETTINGS);
      sheet.appendRow(['キー', '値']);
      sheet.getRange(1, 1, 1, 2).setBackground('#3D8B37').setFontColor('#FFFFFF').setFontWeight('bold');
      sheet.setColumnWidth(1, 200);
      sheet.setColumnWidth(2, 400);
    }
    // businessDays行を探して上書き、無ければ追加
    const lastRow = sheet.getLastRow();
    const value = businessDays.join(',');
    let updated = false;
    if (lastRow >= 2) {
      const keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < keys.length; i++) {
        if (keys[i][0] === 'businessDays') {
          sheet.getRange(i + 2, 2).setValue(value);
          updated = true;
          break;
        }
      }
    }
    if (!updated) {
      sheet.appendRow(['businessDays', value]);
    }
    return { success: true, settings: { businessDays: businessDays } };
  } catch (e) {
    return { error: e.message };
  }
}
