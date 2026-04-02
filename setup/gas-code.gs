// ================================================
// こむぎえん 管理システム - Google Apps Script
// ================================================
// このコードをGoogle Apps Scriptにコピーして使います
// セットアップ手順は setup-guide.txt を参照
// ================================================

// ===== 設定 =====
const SHEET_NEWS = 'お知らせ';
const SHEET_PHOTOS = '写真設定';
const PHOTO_FOLDER_NAME = 'こむぎえん写真';
const ADMIN_PASSWORD = 'komugien2026'; // 管理画面のパスワード

// ===== GET リクエスト（データ取得） =====
function doGet(e) {
  const action = e.parameter.action || 'getNews';
  let result;

  switch (action) {
    case 'getNews':
      result = getNews();
      break;
    case 'getPhotos':
      result = getPhotos(e.parameter.folder);
      break;
    case 'getPhotoMap':
      result = getPhotoMap();
      break;
    default:
      result = { error: '不明なアクション' };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== POST リクエスト（データ追加・更新） =====
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // パスワードチェック
    if (data.password !== ADMIN_PASSWORD) {
      return ContentService.createTextOutput(JSON.stringify({ error: '認証エラー' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    let result;
    switch (data.action) {
      case 'addNews':
        result = addNews(data);
        break;
      case 'deleteNews':
        result = deleteNews(data.row);
        break;
      case 'uploadPhoto':
        result = uploadPhoto(data);
        break;
      default:
        result = { error: '不明なアクション' };
    }

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ===== お知らせ取得 =====
function getNews() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NEWS);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NEWS);
    sheet.appendRow(['タイムスタンプ', 'タイトル', '内容', '種類', '日付', 'ステータス']);
    formatHeader(sheet);
  }

  sheet.appendRow([
    new Date(),
    data.title,
    data.content,
    data.category,
    data.date,
    '表示'
  ]);

  return { success: true };
}

// ===== お知らせ非表示 =====
function deleteNews(row) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NEWS);
  sheet.getRange(row, 6).setValue('非表示');
  return { success: true };
}

// ===== 写真一覧取得（Google Driveフォルダ） =====
function getPhotos(folderId) {
  if (!folderId) return { photos: [] };

  try {
    const folder = DriveApp.getFolderById(folderId);
    const files = folder.getFiles();
    const photos = [];

    while (files.hasNext()) {
      const file = files.next();
      if (file.getMimeType().startsWith('image/')) {
        photos.push({
          id: file.getId(),
          name: file.getName(),
          url: 'https://lh3.googleusercontent.com/d/' + file.getId(),
          thumbnail: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w400',
          date: Utilities.formatDate(file.getLastUpdated(), 'Asia/Tokyo', 'yyyy-MM-dd')
        });
      }
    }

    photos.sort((a, b) => new Date(b.date) - new Date(a.date));
    return { photos };
  } catch (e) {
    return { error: e.message, photos: [] };
  }
}

// ===== 写真アップロード =====
function uploadPhoto(data) {
  // base64をデコードしてBlobに変換
  var imageBlob = Utilities.newBlob(Utilities.base64Decode(data.imageData), 'image/jpeg', data.fileName);

  // 写真フォルダを取得または作成
  var folders = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME);
  var folder;
  if (folders.hasNext()) {
    folder = folders.next();
  } else {
    folder = DriveApp.createFolder(PHOTO_FOLDER_NAME);
  }

  // 同じスロットの古いファイルがあればゴミ箱へ
  var existingFiles = folder.getFilesByName(data.fileName);
  while (existingFiles.hasNext()) {
    existingFiles.next().setTrashed(true);
  }

  // 新しいファイルをアップロード
  var file = folder.createFile(imageBlob);
  file.setSharing(DriveApp.Access.ANYONE, DriveApp.Permission.VIEW);

  var fileId = file.getId();
  var fileUrl = 'https://lh3.googleusercontent.com/d/' + fileId;

  // スプレッドシートにマッピングを記録
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_PHOTOS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_PHOTOS);
    sheet.getRange('A1:D1').setValues([['スロットID', 'ラベル', 'ファイルID', 'URL']]);
    var headerRange = sheet.getRange(1, 1, 1, 4);
    headerRange.setBackground('#3D8B37');
    headerRange.setFontColor('#FFFFFF');
    headerRange.setFontWeight('bold');
  }

  // 既存の行を更新、なければ追加
  var dataRange = sheet.getDataRange();
  var values = dataRange.getValues();
  var found = false;
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === data.slotId) {
      sheet.getRange(i + 1, 3, 1, 2).setValues([[fileId, fileUrl]]);
      found = true;
      break;
    }
  }
  if (!found) {
    sheet.appendRow([data.slotId, data.slotLabel, fileId, fileUrl]);
  }

  return { success: true, url: fileUrl };
}

// ===== 写真マッピング取得 =====
function getPhotoMap() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_PHOTOS);
  var photoMap = {};

  if (sheet && sheet.getLastRow() > 1) {
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][3]) {
        photoMap[data[i][0]] = data[i][3];
      }
    }
  }

  return { photoMap: photoMap };
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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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
