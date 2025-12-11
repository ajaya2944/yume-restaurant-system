/******************************************************
 *  A.K.A Technology – Asian Dining YUME
 *  DIGITAL MENU — BACKEND (Apps Script)
 ******************************************************/

//--------------------------------------
// シート名
//--------------------------------------
const KITCHEN_SHEET         = "Kitchen Display";
const BAR_SHEET             = "Bar Display";
const COUNTER_SHEET         = "Counter Display";
const PAYMENT_HISTORY_SHEET = "Payment History";

/******************************************************
 * STAFF LIST & LOGIN
 ******************************************************/
const STAFF_LIST = [
  { id: "0000", name: "Ajaya",  pin: "1111", role: "manager" },
  { id: "0001", name: "Staff1", pin: "2222", role: "staff" }
];

// 全角英数 → 半角英数 に変換（Android 日本語キーボード対策）
function toHalfWidth(str) {
  if (!str) return "";
  return String(str)
    // 全角英数・記号を半角へ
    .replace(/[\uFF01-\uFF5E]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    })
    // 全角スペース → 半角スペース
    .replace(/\u3000/g, " ");
}

// スタッフログイン確認
function verifyStaff(id, pin) {
  // 全角 → 半角 ＋ trim
  const normId = toHalfWidth(id).trim().toLowerCase();
  const normPin = toHalfWidth(pin).trim();
  Logger.log("LOGIN TRY id='%s' pin='%s'", normId, normPin);

  const staff = STAFF_LIST.find(function (s) {
    return String(s.id).toLowerCase() === normId &&
           String(s.pin) === normPin;
  });

  if (!staff) {
    return { success: false, message: "Invalid ID or PIN" };
  }
  return {
    success: true,
    staff: { id: staff.id, name: staff.name, role: staff.role }
  };
}

/******************************************************
 * doPost（menu.html からの注文）
 ******************************************************/
function doPost(e) {
  try {
    const action = (e.parameter && e.parameter.action) || "";
    if (action !== "menuOrder") {
      return ContentService
        .createTextOutput("unknown action")
        .setMimeType(ContentService.MimeType.TEXT);
    }
    // 実処理
    return handleMenuOrder_(e);

  } catch (err) {
    Logger.log("doPost error: " + (err.stack || err));
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: String(err)
      }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader("Access-Control-Allow-Origin", "*");
  }
}

/******************************************************
 * doGet（view=menu/kitchen/bar/counter, action=dailyReport/rangeReport）
 ******************************************************/
function doGet(e) {
  const view   = e && e.parameter && e.parameter.view;
  const table  = e && e.parameter && e.parameter.table;
  const action = e && e.parameter && e.parameter.action;

  // ▼ レポート API（URL で叩く場合用）
  if (action === "dailyReport") {
    return getDailyReport_(e);   // JSON で日次サマリ
  }
  if (action === "rangeReport") {
    return getRangeReport_(e);   // JSON で期間サマリ
  }

  // ▼ 画面（HTML）表示
  if (view === "menu") {
    const t = HtmlService.createTemplateFromFile("menu");
    t.tableParam = table || "";
    return t
      .evaluate()
      .setTitle("Asian Dining Yume - Digital Menu")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  if (view === "kitchen") {
    return HtmlService
      .createHtmlOutputFromFile("kitchen")
      .setTitle("Kitchen Orders — Restaurant Control")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  if (view === "bar") {
    return HtmlService
      .createHtmlOutputFromFile("bar")
      .setTitle("Bar Orders — Restaurant Control")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  if (view === "counter") {
    return HtmlService
      .createHtmlOutputFromFile("counter")
      .setTitle("Counter Display — Restaurant Control")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // デフォルト（view が無いとき）
  return HtmlService
    .createHtmlOutput("Digital Menu Online")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/******************************************************
 * 小さなユーティリティ関数（共通で使用）
 ******************************************************/
// JSON を返すレスポンス作成（フロントからの fetch / XHR 用）
function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeader('Access-Control-Allow-Origin', '*');
}

// 日付の 00:00:00 にそろえる
function startOfDay_(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// 日付の 23:59:59.999 にそろえる
function endOfDay_(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

// YYYY-MM-DD 形式に変換
function formatYMD_(d) {
  const y  = d.getFullYear();
  const m  = ("0" + (d.getMonth() + 1)).slice(-2);
  const dd = ("0" + d.getDate()).slice(-2);
  return `${y}-${m}-${dd}`;
}

// 数字変換（￥やカンマ入りにも対応）
function toNumberSafe_(v) {
  if (typeof v === "number") return v || 0;
  if (!v) return 0;
  const n = parseFloat(String(v).replace(/[^\d.-]/g, ""));
  return isNaN(n) ? 0 : n;
}

/******************************************************
 * Payment History シートから、日付範囲のサマリーを集計する
 ******************************************************/
function buildReportSummary_(fromDate, toDate) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(PAYMENT_HISTORY_SHEET);

  // シートが無い場合 → 「履歴なし」として 0 で返す
  if (!sh) {
    return {
      success: true,
      from: formatYMD_(fromDate),
      to:   formatYMD_(toDate),
      orders: 0,
      items: 0,
      gross: 0,
      discount: 0,
      net: 0
    };
  }

  const data = sh.getDataRange().getValues();
  if (data.length <= 1) {
    return {
      success: true,
      from: formatYMD_(fromDate),
      to:   formatYMD_(toDate),
      orders: 0,
      items: 0,
      gross: 0,
      discount: 0,
      net: 0
    };
  }

  const headers = data[0];
  const lower   = headers.map(h => String(h).toLowerCase());

  function findColFlexible_(candidates) {
    return lower.findIndex(s =>
      candidates.some(name => s.indexOf(name.toLowerCase()) !== -1)
    );
  }

  const tsCol   = findColFlexible_(["timestamp", "date", "日付", "日時"]);
  const foodCol = findColFlexible_(["food", "品目", "商品"]);
  const origCol = findColFlexible_(["original price", "original", "gross", "amount", "金額"]);
  const discCol = findColFlexible_(["discount", "割引"]);
  const finalCol= findColFlexible_(["final price", "final", "net", "total", "合計"]);

  const fromMs = startOfDay_(fromDate).getTime();
  const toMs   = endOfDay_(toDate).getTime();

  let orders = 0;
  let items  = 0;
  let gross  = 0;
  let discount = 0;
  let net      = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];

    const tsVal = (tsCol >= 0) ? row[tsCol] : null;
    if (!tsVal) continue;

    const d = tsVal instanceof Date ? tsVal : new Date(tsVal);
    const t = d.getTime();
    if (isNaN(t)) continue;
    if (t < fromMs || t > toMs) continue;

    orders++;

    // 品目数（"2x Curry" の 2 を読む）
    let qty = 1;
    if (foodCol >= 0) {
      const foodLabel = String(row[foodCol] || "");
      const m = foodLabel.match(/^(\d+)\s*x/i);
      if (m) qty = Number(m[1]) || 1;
    }
    items += qty;

    if (origCol  >= 0) gross    += toNumberSafe_(row[origCol]);
    if (discCol  >= 0) discount += toNumberSafe_(row[discCol]);
    if (finalCol >= 0) net      += toNumberSafe_(row[finalCol]);
  }

  return {
    success: true,
    from: formatYMD_(fromDate),
    to:   formatYMD_(toDate),
    orders:   orders,
    items:    items,
    gross:    gross,
    discount: discount,
    net:      net
  };
}

/******************************************************
 * extractOptions（オプション文字列整形）
 ******************************************************/
function extractOptions(opt) {
  if (!opt) {
    return { curry: "", spice: "", bread: "", drink: "" };
  }
  return {
    curry: Array.isArray(opt.curry) ? opt.curry.join(", ") : (opt.curry || ""),
    spice: opt.spice || "",
    bread: opt.bread || "",
    drink: opt.drink || ""
  };
}

/******************************************************
 * getCounterData（counter.html 用・最新版）
 ******************************************************/
function getCounterData() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(COUNTER_SHEET);
    if (!sh) {
      return { success: false, message: "Counter sheet not found." };
    }

    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow < 2) {
      return { success: true, data: [] };
    }

    const header = sh.getRange(1, 1, 1, lastCol).getValues()[0];

    // 列をヘッダ名で探すユーティリティ
    function colContains(keywordList) {
      const lower = header.map(h => String(h).toLowerCase());
      return lower.findIndex(h =>
        keywordList.some(k => h.indexOf(k.toLowerCase()) !== -1)
      );
    }

    const cTime   = colContains(["time", "timestamp", "日時", "時間"]);
    const cTable  = colContains(["table", "テーブル"]);
    const cFood   = colContains(["food", "品目", "商品"]);
    const cSet    = colContains(["set"]);
    const cRice   = colContains(["rice|naan", "rice_naan", "rice", "naan"]);
    const cSpice  = colContains(["spice"]);
    const cDrink  = colContains(["drink"]);
    const cNote   = colContains(["note", "メモ"]);
    const cPrice  = colContains(["price"]);
    const cStatus = colContains(["status", "ステータス"]);

    const tz = Session.getScriptTimeZone();
    const values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

    const data = values.map(function(row) {
      // タイムスタンプを ISO 文字列へ
      let tsIso = "";
      const tsVal = cTime >= 0 ? row[cTime] : "";
      if (tsVal instanceof Date) {
        tsIso = Utilities.formatDate(tsVal, tz, "yyyy-MM-dd'T'HH:mm:ss");
      } else if (tsVal) {
        tsIso = String(tsVal);
      }

      // Rice|Naan / Price 自動補正（古いデータ対応）
      let riceVal  = cRice  >= 0 ? row[cRice]  : "";
      let priceVal = cPrice >= 0 ? row[cPrice] : 0;
      if ((!priceVal || Number(priceVal) === 0) && typeof riceVal === "number") {
        priceVal = riceVal;
        riceVal  = "";
      }

      const rawStatus = cStatus >= 0 ? String(row[cStatus] || "") : "";
      const statusNorm = rawStatus
        ? rawStatus.toLowerCase().trim()
        : "unpaid";

      return {
        key:   generateRowKey(row, header),
        ts:    tsIso,
        table: cTable >= 0 ? (row[cTable] || "") : "",
        food:  cFood  >= 0 ? (row[cFood]  || "") : "",
        set:   cSet   >= 0 ? (row[cSet]   || "") : "",
        riceNaan: cRice  >= 0 ? (riceVal || "") : "",
        spice:    cSpice >= 0 ? (row[cSpice] || "") : "",
        drink:    cDrink >= 0 ? (row[cDrink] || "") : "",
        note:     cNote  >= 0 ? (row[cNote]  || "") : "",
        price: Number(priceVal || 0),
        status: statusNorm        // "paid" / "unpaid" など
      };
    });

    return { success: true, data: data };

  } catch (err) {
    Logger.log("getCounterData ERROR: " + (err.stack || err));
    return { success: false, message: String(err) };
  }
}


/******************************************************
 * markAsPaid（旧：必要なら使用可）
 ******************************************************/
function markAsPaid(keys) {
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(COUNTER_SHEET);
    if (!sheet) return { success: false, message: "Counter sheet not found" };

    const data   = sheet.getDataRange().getValues();
    const headers= data[0];
    const statusCol = headers.findIndex(function (h) {
      return String(h).toLowerCase().indexOf("status") !== -1;
    });
    if (statusCol === -1) {
      return { success: false, message: "Status column not found" };
    }

    let updatedCount = 0;
    for (let i = 1; i < data.length; i++) {
      const row    = data[i];
      const rowKey = generateRowKey(row, headers);
      if (keys.indexOf(rowKey) !== -1) {
        sheet.getRange(i + 1, statusCol + 1).setValue("paid");
        updatedCount++;
      }
    }
    return { success: true, updated: updatedCount };

  } catch (error) {
    return { success: false, message: String(error) };
  }
}

/******************************************************
 * generateRowKey（Counter シート行のユニークキー）
 ******************************************************/
function generateRowKey(row, headers) {
  const tsIndex    = headers.findIndex(h => String(h).toLowerCase().indexOf("time")  !== -1);
  const tableIndex = headers.findIndex(h => String(h).toLowerCase().indexOf("table") !== -1);
  const foodIndex  = headers.findIndex(h => String(h).toLowerCase().indexOf("food")  !== -1);
  const priceIndex = headers.findIndex(h => String(h).toLowerCase().indexOf("price") !== -1);

  const ts    = tsIndex    >= 0 ? row[tsIndex]    : "";
  const table = tableIndex >= 0 ? row[tableIndex] : "";
  const food  = foodIndex  >= 0 ? row[foodIndex]  : "";
  const price = priceIndex >= 0 ? row[priceIndex] : "";

  return String(ts) + "|" + String(table) + "|" + String(food) + "|" + String(price);
}

/******************************************************
 * handleMenuOrder_（menu.html からの注文を各シートに振り分け）
 ******************************************************/
function handleMenuOrder_(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("No postData");
    }
    const body = JSON.parse(e.postData.contents);
    Logger.log("menu payload: " + JSON.stringify(body));

    const ss     = SpreadsheetApp.getActiveSpreadsheet();
    const ts     = body.timestamp ? new Date(body.timestamp) : new Date();
    const table  = body.tableNumber || "No Table";
    const notes  = body.notes || "";
    const items  = body.items || [];

    /*********************************
     * KITCHEN — FOOD ONLY
     *********************************/
    const kitchen = ss.getSheetByName(KITCHEN_SHEET);
    if (kitchen) {
      items.forEach(function (item) {
        const catText = Array.isArray(item.category)
          ? item.category.join(",").toLowerCase()
          : String(item.category || "").toLowerCase();

        // ドリンクだけの注文は Kitchen には出さない
        if (catText.indexOf("drink") !== -1) return;

        const opt = extractOptions(item.options);
        const qty = Number(item.qty || 1);
        const rawName  = String(item.name || "");
        const baseName = rawName.split("[")[0].trim() || rawName;
        const foodLabel= qty + "x " + baseName;

        kitchen.appendRow([
          ts,          // A: Time
          table,       // B: Table
          foodLabel,   // C: Food
          opt.curry,   // D: Set
          opt.spice,   // E: Spice
          opt.bread,   // F: Rice/Naan
          "",          // G: Cheese Naan
          notes,       // H: Note
          ""           // I: Status
        ]);
      });
    }

    /*********************************
     * BAR — DRINK / セットのドリンク
     *********************************/
    const bar = ss.getSheetByName(BAR_SHEET);
    if (bar) {
      items.forEach(function (item) {
        const catText = Array.isArray(item.category)
          ? item.category.join(",").toLowerCase()
          : String(item.category || "").toLowerCase();

        const opt = extractOptions(item.options);
        const qty = Number(item.qty || 1);

        const isStandAloneDrink = (catText === "drink" || catText.indexOf("drink") !== -1);
        const isSetWithDrink    = (!!item.isSet && !!opt.drink);

        if (!isStandAloneDrink && !isSetWithDrink) return;

        const rawName  = String(item.name || "");
        const baseName = rawName.split("[")[0].trim() || rawName;

        let barSetStr    = "";
        let barCurryStr  = "";
        let barSpiceStr  = "";
        let barBreadStr  = "";
        let barCheeseStr = "";
        let barDrinkStr  = "";

        if (isStandAloneDrink) {
          barDrinkStr = qty + "x " + baseName;
        } else if (isSetWithDrink) {
          barSetStr    = qty + "x " + baseName;
          barCurryStr  = opt.curry;
          barSpiceStr  = opt.spice;
          barBreadStr  = opt.bread;
          barDrinkStr  = qty + "x " + opt.drink;
        }

        if (!barSetStr && !barDrinkStr) return;

        bar.appendRow([
          ts,          // A: Time
          table,       // B: Table
          barSetStr,   // C: Set
          barCurryStr, // D: Curry
          barSpiceStr, // E: Spice
          barBreadStr, // F: Rice/Naan
          barCheeseStr,// G: Cheese Naan
          barDrinkStr, // H: Drink
          notes        // I: Special
        ]);
      });
    }

    /*********************************
     * COUNTER — 会計用
     *********************************/
    const counter = ss.getSheetByName(COUNTER_SHEET);
    if (counter) {
      const lastCol   = Math.max(10, counter.getLastColumn());
      const headerRow = counter.getRange(1, 1, 1, lastCol).getValues()[0];

      const defaultHeaders = [
        "Timestamp", "Table", "Food", "Set",
        "Rice|Naan", "Spice", "Drink", "Note",
        "Price", "Status"
      ];
      for (let i = 0; i < 10; i++) {
        if (!headerRow[i]) {
          counter.getRange(1, i + 1).setValue(defaultHeaders[i]);
        }
      }

      items.forEach(function (item) {
        const opt = extractOptions(item.options);
        const qty = Number(item.qty || 1);
        const unitPrice = Number(item.price || 0);

        let lineTotal = Number(item.lineTotal);
        if (!lineTotal || isNaN(lineTotal)) {
          lineTotal = unitPrice * qty;
        }

        const rawName  = String(item.name || "");
        const baseName = rawName.split("[")[0].trim() || rawName;

        const rowData = [
          ts,                   // Timestamp
          table,                // Table
          qty + "x " + baseName,// Food
          opt.curry,            // Set
          opt.bread,            // Rice|Naan
          opt.spice,            // Spice
          opt.drink,            // Drink
          notes,                // Note
          lineTotal,            // Price
          "unpaid"              // Status (小文字で統一)
        ];
        Logger.log("COUNTER row = " + JSON.stringify(rowData));
        counter.appendRow(rowData);
      });
    }

    return ContentService
      .createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader("Access-Control-Allow-Origin", "*");

  } catch (err) {
    Logger.log("handleMenuOrder_ ERROR: " + err);
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        message: String(err)
      }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader("Access-Control-Allow-Origin", "*");
  }
}

/******************************************************
 * fixCounterPriceColumn（古いデータ修正用）
 ******************************************************/
function fixCounterPriceColumn() {
  const SHEET_NAME = COUNTER_SHEET;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    Logger.log("Sheet not found: " + SHEET_NAME);
    return;
  }

  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    Logger.log("No data rows to fix.");
    return;
  }

  const numRows = lastRow - 1;

  const rangeI = sh.getRange(2, 9,  numRows, 1); // I: Price
  const rangeJ = sh.getRange(2, 10, numRows, 1); // J: Status or 誤って Price が入っている列

  const valuesI = rangeI.getValues();
  const valuesJ = rangeJ.getValues();

  let moved = 0;
  for (let r = 0; r < numRows; r++) {
    const valI = valuesI[r][0];
    const valJ = valuesJ[r][0];

    if ((valI === "" || valI == null) && valJ !== "" && valJ != null) {
      valuesI[r][0] = valJ;
      valuesJ[r][0] = "";
      moved++;
    }
  }

  rangeI.setValues(valuesI);
  rangeJ.setValues(valuesJ);

  Logger.log("Moved prices from J to I rows: " + moved);
}

/******************************************************
 * Daily / Range Report（doGet API 用）
 ******************************************************/
function getDailyReport_(e) {
  try {
    const dateStr = e && e.parameter && e.parameter.date;
    const base    = dateStr ? new Date(dateStr) : new Date();
    const summary = buildReportSummary_(base, base);
    return jsonOutput_(summary);

  } catch (err) {
    Logger.log("getDailyReport_ error: " + (err.stack || err));
    return jsonOutput_({ success: false, error: String(err) });
  }
}

function getRangeReport_(e) {
  try {
    const fromStr = e && e.parameter && e.parameter.from;
    const toStr   = e && e.parameter && e.parameter.to;
    const from    = fromStr ? new Date(fromStr) : new Date();
    const to      = toStr   ? new Date(toStr)   : from;

    const summary = buildReportSummary_(from, to);
    return jsonOutput_(summary);

  } catch (err) {
    Logger.log("getRangeReport_ error: " + (err.stack || err));
    return jsonOutput_({ success: false, error: String(err) });
  }
}

/******************************************************
 * getDailyReport（counter.html から google.script.run 用）
 ******************************************************/
function getDailyReport(dateStr) {
  try {
    const targetDate = dateStr ? new Date(dateStr) : new Date();
    if (isNaN(targetDate.getTime())) {
      return { success: false, message: "Invalid date format. Please use YYYY-MM-DD" };
    }

    const summary = buildReportSummary_(targetDate, targetDate);
    // buildReportSummary_ は from/to 形式なので date に変換
    return {
      success: summary.success,
      date: formatYMD_(targetDate),
      orders: summary.orders,
      items: summary.items,
      gross: summary.gross,
      discount: summary.discount,
      net: summary.net
    };

  } catch (error) {
    Logger.log("getDailyReport ERROR: " + error);
    return { success: false, message: String(error) };
  }
}

/******************************************************
 * getRangeReport（counter.html から google.script.run 用）
 ******************************************************/
function getRangeReport(startDateStr, endDateStr) {
  try {
    const startDate = new Date(startDateStr + "T00:00:00");
    const endDate   = new Date(endDateStr   + "T23:59:59");

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return { success: false, message: "Invalid date format. Please use YYYY-MM-DD" };
    }
    if (startDate > endDate) {
      return { success: false, message: "Start date cannot be after end date" };
    }

    const summary = buildReportSummary_(startDate, endDate);
    return {
      success: summary.success,
      start: startDateStr,
      end:   endDateStr,
      orders: summary.orders,
      items:  summary.items,
      gross:  summary.gross,
      discount: summary.discount,
      net:      summary.net
    };

  } catch (error) {
    Logger.log("getRangeReport ERROR: " + error);
    return { success: false, message: String(error) };
  }
}

/******************************************************
 * テストプリント（接続確認用）
 ******************************************************/
function testPrint() {
  return { success: true, message: "TEST PRINT OK" };
}

/******************************************************
 * REFERENCE NUMBER GENERATION SYSTEM
 ******************************************************/
function generateReferenceNumber() {
  const now      = new Date();
  const datePart = Utilities.formatDate(now, 'Asia/Tokyo', 'yyMMdd');
  const lastNumber = getLastReferenceNumber(datePart);
  const newNumber  = lastNumber + 1;
  const sequencePart = String(newNumber).padStart(4, '0');
  return `${datePart}-${sequencePart}`;
}

function getLastReferenceNumber(datePart) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(PAYMENT_HISTORY_SHEET);
  if (!sh || sh.getLastRow() <= 1) {
    return 0;
  }

  const data   = sh.getDataRange().getValues();
  const headers= data[0].map(String);
  const lower  = headers.map(h => h.toLowerCase());

  // 「Reference Number」列を探す
  const refCol = lower.findIndex(h => 
    h.includes("reference") || h.includes("ref")
  );
  if (refCol === -1) return 0;

  let lastNumber = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const ref = String(row[refCol] || "");
    if (!ref || !ref.startsWith(datePart + "-")) continue;

    const parts = ref.split("-");
    if (parts.length === 2) {
      const num = parseInt(parts[1], 10);
      if (!isNaN(num) && num > lastNumber) {
        lastNumber = num;
      }
    }
  }
  return lastNumber;
}

/******************************************************
 * checkoutOrders（最終版）
 *  - Counter シートの status を "paid" に更新
 *  - Payment History に 1行ずつ書き込む
 ******************************************************/
function checkoutOrders(payload) {
  try {
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch (e) {
        return { success: false, message: "Invalid payload format" };
      }
    }
    payload = payload || {};

    const keys          = payload.keys || [];
    const discountType  = payload.discountType || "none";
    const discountValue = Number(payload.discountValue || 0);
    const staffName     = payload.staffName || "";
    const paymentMethod = payload.paymentMethod || "cash";
    let   paymentRef    = payload.paymentRef || "";

    if (!keys.length) {
      return { success: false, message: "No rows selected" };
    }

    const ss      = SpreadsheetApp.getActiveSpreadsheet();
    const counter = ss.getSheetByName(COUNTER_SHEET);
    if (!counter) {
      return { success: false, message: "Counter sheet not found" };
    }

    const history = ss.getSheetByName(PAYMENT_HISTORY_SHEET) ||
                    ss.insertSheet(PAYMENT_HISTORY_SHEET);

    // ヘッダー行が無ければ新規作成
    if (history.getLastRow() === 0) {
      history.appendRow([
        "Timestamp", "Table", "Food", "Set", "Rice|Naan", "Spice", "Drink", "Note",
        "Original Price", "Discount", "Final Price",
        "Payment Method", "Payment Ref",
        "Reference Number",
        "Status", "Staff", "Paid At"
      ]);
    }

    // 列の位置を確認
    const headerRow = history.getRange(1, 1, 1, history.getLastColumn()).getValues()[0];
    const headers = {};
    for (let i = 0; i < headerRow.length; i++) {
      headers[headerRow[i]] = i;
    }

    // 必要な列がなければ追加
    const requiredHeaders = [
      "Timestamp", "Table", "Food", "Set", "Rice|Naan", "Spice", "Drink", "Note",
      "Original Price", "Discount", "Final Price",
      "Payment Method", "Payment Ref", "Reference Number",
      "Status", "Staff", "Paid At"
    ];

    let lastCol = history.getLastColumn();
    for (const header of requiredHeaders) {
      if (!(header in headers)) {
        history.getRange(1, lastCol + 1).setValue(header);
        headers[header] = lastCol;
        lastCol++;
      }
    }

    // Counter シートのデータを取得
    const counterData   = counter.getDataRange().getValues();
    const counterHeader = counterData[0];
    const counterLower  = counterHeader.map(h => String(h).toLowerCase());

    const cTsCol    = counterLower.findIndex(h => h.includes("time"));
    const cTableCol = counterLower.findIndex(h => h.includes("table"));
    const cFoodCol  = counterLower.findIndex(h => h.includes("food"));
    const cSetCol   = counterLower.findIndex(h => h === "set");
    const cRiceCol  = counterLower.findIndex(h => 
      h.includes("rice|naan") || h.includes("rice_naan") || h.includes("rice") || h.includes("naan")
    );
    const cSpiceCol = counterLower.findIndex(h => h.includes("spice"));
    const cDrinkCol = counterLower.findIndex(h => h.includes("drink"));
    const cNoteCol  = counterLower.findIndex(h => h.includes("note"));
    const cPriceCol = counterLower.findIndex(h => h.includes("price"));

    // --- ここが修正ポイント：Status 列の検出を強化 ---
    let cStatusCol = counterLower.findIndex(h => 
      h.includes("status") || h.includes("ステータス")
    );

    // もし見つからない場合：トリム＆小文字で厳密に "status" を探す
    if (cStatusCol === -1) {
      cStatusCol = counterHeader.findIndex(h =>
        String(h).trim().toLowerCase() === "status"
      );
    }

    // まだ -1 の場合は、新しく Status 列を末尾に追加する
    if (cStatusCol === -1) {
      cStatusCol = counterHeader.length; // 新しい列 index
      counter.getRange(1, cStatusCol + 1).setValue("Status");
    }
    // --- 修正ここまで ---

    if (cPriceCol === -1 || cStatusCol === -1) {
      return { success: false, message: "Price/Status column not found in Counter sheet" };
    }

    // レシート番号を生成（支払いごとに1つの参照番号）
    let referenceNumber = generateReferenceNumber();
    // paymentRef は別に残す（カード番号の末尾4桁など）
    // もし paymentRef が空ならレシート番号を設定
    if (!paymentRef) {
      paymentRef = referenceNumber;
    }

    let updated        = 0;
    let allOrderDetails= [];
    let totalOriginal  = 0;
    let totalDiscount  = 0;
    let totalFinal     = 0;
    const now          = new Date();

    for (let i = 1; i < counterData.length; i++) {
      const row    = counterData[i];
      const rowKey = generateRowKey(row, counterHeader);
      if (keys.indexOf(rowKey) === -1) continue;

      // 価格を取得
      let originalPrice = Number(row[cPriceCol] || 0);
      if ((!originalPrice || originalPrice === 0) &&
          cRiceCol !== -1 && typeof row[cRiceCol] === "number") {
        originalPrice = Number(row[cRiceCol] || 0);
      }

      // 割引計算
      let discountAmount = 0;
      if (discountType === "yen") {
        discountAmount = Math.min(discountValue, originalPrice);
      } else if (discountType === "percent") {
        discountAmount = Math.min(
          Math.round(originalPrice * (discountValue / 100)),
          originalPrice
        );
      }
      const finalPrice = originalPrice - discountAmount;

      // Counter シートを paid に更新
      counter.getRange(i + 1, cStatusCol + 1).setValue("paid");

      // Payment History に行を作成
      const historyRow = new Array(lastCol).fill("");
      
      // タイムスタンプ（注文時刻）
      const orderTimestamp = cTsCol >= 0 ? row[cTsCol] : now;
      
      // 各列にデータを設定
      if (headers["Timestamp"] !== undefined) historyRow[headers["Timestamp"]] = orderTimestamp;
      if (headers["Table"] !== undefined) historyRow[headers["Table"]] = cTableCol >= 0 ? row[cTableCol] : "";
      if (headers["Food"] !== undefined) historyRow[headers["Food"]] = cFoodCol >= 0 ? row[cFoodCol] : "";
      if (headers["Set"] !== undefined) historyRow[headers["Set"]] = cSetCol >= 0 ? row[cSetCol] : "";
      if (headers["Rice|Naan"] !== undefined) historyRow[headers["Rice|Naan"]] = cRiceCol >= 0 ? row[cRiceCol] : "";
      if (headers["Spice"] !== undefined) historyRow[headers["Spice"]] = cSpiceCol >= 0 ? row[cSpiceCol] : "";
      if (headers["Drink"] !== undefined) historyRow[headers["Drink"]] = cDrinkCol >= 0 ? row[cDrinkCol] : "";
      if (headers["Note"] !== undefined) historyRow[headers["Note"]] = cNoteCol >= 0 ? row[cNoteCol] : "";
      if (headers["Original Price"] !== undefined) historyRow[headers["Original Price"]] = originalPrice;
      if (headers["Discount"] !== undefined) historyRow[headers["Discount"]] = discountAmount;
      if (headers["Final Price"] !== undefined) historyRow[headers["Final Price"]] = finalPrice;
      if (headers["Payment Method"] !== undefined) historyRow[headers["Payment Method"]] = paymentMethod;
      if (headers["Payment Ref"] !== undefined) historyRow[headers["Payment Ref"]] = paymentRef;
      if (headers["Reference Number"] !== undefined) historyRow[headers["Reference Number"]] = referenceNumber;
      if (headers["Status"] !== undefined) historyRow[headers["Status"]] = "paid";
      if (headers["Staff"] !== undefined) historyRow[headers["Staff"]] = staffName;
      if (headers["Paid At"] !== undefined) historyRow[headers["Paid At"]] = now;

      history.appendRow(historyRow);

      allOrderDetails.push({
        food:          cFoodCol >= 0 ? row[cFoodCol] : "",
        price:         finalPrice,
        originalPrice: originalPrice,
        discount:      discountAmount
      });

      totalOriginal += originalPrice;
      totalDiscount += discountAmount;
      totalFinal    += finalPrice;
      updated++;
    }

    return {
      success: true,
      updated: updated,
      referenceNumber: referenceNumber,
      orderDetails: allOrderDetails,
      summary: {
        originalTotal: totalOriginal,
        discountTotal: totalDiscount,
        finalTotal:    totalFinal,
        paymentMethod: paymentMethod,
        paymentRef:    paymentRef
      },
      message: `Payment completed. Reference: ${referenceNumber}`
    };

  } catch (err) {
    Logger.log("checkoutOrders ERROR: " + err);
    return { success: false, message: String(err) };
  }
}

/******************************************************
 * 既存 Payment History に参照番号を振り直す
 ******************************************************/
function fixMissingReferenceNumbers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(PAYMENT_HISTORY_SHEET);
  if (!sh) return;

  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return;

  const headers = data[0].map(String);
  const lower   = headers.map(h => h.toLowerCase());
  const tsCol   = lower.findIndex(h =>
    h.includes("timestamp") || h.includes("date") || h.includes("日付") || h.includes("日時")
  );
  const refCol  = lower.findIndex(h => h.includes("reference number"));

  if (tsCol === -1 || refCol === -1) {
    Logger.log("Timestamp / Reference Number column not found.");
    return;
  }

  // 日付ごとの最大シーケンスを管理
  const seqMap = {};

  // 既存参照番号から最大値を集計
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const ts  = row[tsCol];
    if (!(ts instanceof Date)) continue;

    const ref = String(row[refCol] || "").trim();
    const datePart = Utilities.formatDate(ts, 'Asia/Tokyo', 'yyMMdd');
    if (!seqMap[datePart]) seqMap[datePart] = 0;

    if (ref) {
      const parts = ref.split("-");
      if (parts[0] === datePart) {
        const num = parseInt(parts[1], 10);
        if (!isNaN(num) && num > seqMap[datePart]) {
          seqMap[datePart] = num;
        }
      }
    }
  }

  // 参照番号が空の行に新しい番号を振る
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const ts  = row[tsCol];
    if (!(ts instanceof Date)) continue;

    let ref = String(row[refCol] || "").trim();
    if (ref) continue; // 既に番号あり

    const datePart = Utilities.formatDate(ts, 'Asia/Tokyo', 'yyMMdd');
    if (!seqMap[datePart]) seqMap[datePart] = 0;
    seqMap[datePart]++;

    const seq   = String(seqMap[datePart]).padStart(4, '0');
    const value = datePart + "-" + seq;

    sh.getRange(i + 1, refCol + 1).setValue(value);
    Logger.log("Set ref " + value + " to row " + (i + 1));
  }
}

/******************************************************
 * REPRINT SYSTEM 基本読み取り
 ******************************************************/
function _readPaymentHistoryOrders_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(PAYMENT_HISTORY_SHEET);
  if (!sh) {
    return { data: [], headers: [], lower: [], cols: {} };
  }

  const raw = sh.getDataRange().getValues();
  if (raw.length <= 1) {
    return { data: [], headers: [], lower: [], cols: {} };
  }

  const headers = raw[0].map(String);
  const lower = headers.map(h => h.toLowerCase());
  const rows = raw.slice(1);

  // 列のインデックスを検出
  const tsCol = lower.findIndex(h => 
    h.includes("timestamp") || h.includes("date") || h.includes("日付") || h.includes("日時")
  );
  
  const tableCol = lower.findIndex(h => 
    h.includes("table") || h.includes("テーブル")
  );
  
  const foodCol = lower.findIndex(h => 
    h.includes("food") || h.includes("品目") || h.includes("商品")
  );
  
  const origCol = lower.findIndex(h => 
    h.includes("original") || h.includes("gross") || h.includes("金額")
  );
  
  const discCol = lower.findIndex(h => 
    h.includes("discount") || h.includes("割引")
  );
  
  const finalCol = lower.findIndex(h => 
    h.includes("final") || h.includes("net") || h.includes("合計")
  );
  
  const payMCol = lower.findIndex(h => 
    h.includes("payment method") || h.includes("payment m")
  );
  
  const payRCol = lower.findIndex(h => 
    h.includes("payment ref") || h.includes("payment r")
  );
  
  const statusCol = lower.findIndex(h => 
    h.includes("status") || h.includes("ステータス")
  );
  
  const refCol = lower.findIndex(h => 
    h.includes("reference number") || h.includes("reference") || h.includes("ref")
  );

  return {
    data: rows,
    headers: headers,
    lower: lower,
    cols: {
      tsCol, tableCol, foodCol,
      origCol, discCol, finalCol,
      payMCol, payRCol, statusCol, refCol
    }
  };
}

/******************************************************
 * Reprint 用オブジェクト生成
 ******************************************************/
function _buildReprintOrderObject_(row, cols) {
  const tz = Session.getScriptTimeZone();

  const tsVal = cols.tsCol >= 0 ? row[cols.tsCol] : "";
  const table = cols.tableCol >= 0 ? row[cols.tableCol] : "";
  const food = cols.foodCol >= 0 ? row[cols.foodCol] : "";
  const orig = cols.origCol >= 0 ? toNumberSafe_(row[cols.origCol]) : 0;
  const disc = cols.discCol >= 0 ? toNumberSafe_(row[cols.discCol]) : 0;
  const final = cols.finalCol >= 0 ? toNumberSafe_(row[cols.finalCol]) : 0;
  const payM = cols.payMCol >= 0 ? row[cols.payMCol] : "";
  const payR = cols.payRCol >= 0 ? row[cols.payRCol] : "";
  const status = cols.statusCol >= 0 ? row[cols.statusCol] : "";
  const refNo = cols.refCol >= 0 ? row[cols.refCol] : "";

  let tsIso = "";
  if (tsVal instanceof Date) {
    tsIso = Utilities.formatDate(tsVal, tz, "yyyy-MM-dd'T'HH:mm:ss");
  } else if (tsVal) {
    try {
      const d = new Date(tsVal);
      if (!isNaN(d.getTime())) {
        tsIso = Utilities.formatDate(d, tz, "yyyy-MM-dd'T'HH:mm:ss");
      } else {
        tsIso = String(tsVal);
      }
    } catch (e) {
      tsIso = String(tsVal);
    }
  }

  return {
    timestamp: tsIso,
    table: table,
    food: food,
    originalPrice: orig,
    discount: disc,
    finalPrice: final,
    paymentMethod: payM,
    paymentRef: payR,
    referenceNumber: refNo,
    status: status,
    displayDate: tsIso ? Utilities.formatDate(new Date(tsIso), tz, "yyyy-MM-dd HH:mm") : ""
  };
}

/******************************************************
 * 日付範囲で支払い済みオーダー取得
 ******************************************************/
function getOrdersForReprint(startDateStr, endDateStr) {
  try {
    const parsed = _readPaymentHistoryOrders_();
    if (!parsed.data.length) {
      return { success: true, orders: [] };
    }

    const cols = parsed.cols;
    const tsCol = cols.tsCol;

    if (tsCol === -1) {
      return { success: false, message: "Timestamp column not found" };
    }

    // Parse dates properly
    const startDate = new Date(startDateStr + "T00:00:00");
    const endDate = new Date(endDateStr + "T23:59:59");
    
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return { success: false, message: "Invalid date format. Use YYYY-MM-DD" };
    }

    const orders = [];

    parsed.data.forEach(function(row) {
      const ts = row[tsCol];
      if (!ts) return;
      
      // Convert to Date object
      const d = ts instanceof Date ? ts : new Date(ts);
      if (isNaN(d.getTime())) return;
      
      // Check if within date range
      if (d >= startDate && d <= endDate) {
        orders.push(_buildReprintOrderObject_(row, cols));
      }
    });

    // Sort by timestamp (newest first)
    orders.sort((a, b) => {
      return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
    });

    return { success: true, orders: orders };

  } catch (err) {
    Logger.log("getOrdersForReprint ERROR: " + err);
    return { success: false, message: String(err) };
  }
}

/******************************************************
 * キーワード検索（テーブル番号/料理名/参照番号）
 ******************************************************/
function searchOrdersForReprint(keyword, dateStr) {
  try {
    keyword = String(keyword || "").trim().toLowerCase();
    const parsed = _readPaymentHistoryOrders_();
    if (!parsed.data.length) {
      return { success: true, orders: [] };
    }

    const cols     = parsed.cols;
    const tsCol    = cols.tsCol;
    const tableCol = cols.tableCol;
    const foodCol  = cols.foodCol;
    const refCol   = cols.refCol;

    const targetDate = dateStr ? new Date(dateStr) : null;
    const orders = [];

    parsed.data.forEach(function (row) {
      const ts = row[tsCol];
      let d;
      if (ts instanceof Date) {
        d = ts;
      } else if (ts) {
        d = new Date(ts);
      } else {
        return;
      }

      // 日付フィルタ（指定されている場合のみ）
      if (targetDate && !isNaN(d.getTime())) {
        const s = startOfDay_(targetDate);
        const e = endOfDay_(targetDate);
        if (d < s || d > e) return;
      }

      // ① 参照番号の完全一致チェック
      if (refCol >= 0 && keyword) {
        const refVal = String(row[refCol] || "").trim().toLowerCase();
        if (refVal && refVal === keyword) {
          orders.push(_buildReprintOrderObject_(row, cols));
          return;
        }
      }

      // ② テーブル＋フード名の部分一致
      const tableStr = tableCol >= 0 ? String(row[tableCol] || "") : "";
      const foodStr  = foodCol  >= 0 ? String(row[foodCol]  || "") : "";
      const combined = (tableStr + " " + foodStr).toLowerCase();

      if (!keyword || combined.indexOf(keyword) !== -1) {
        orders.push(_buildReprintOrderObject_(row, cols));
      }
    });

    // Sort by timestamp (newest first)
    orders.sort((a, b) => {
      return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
    });

    return { success: true, orders: orders };

  } catch (err) {
    Logger.log("searchOrdersForReprint ERROR: " + err);
    return { success: false, message: String(err) };
  }
}

/******************************************************
 * searchByReferenceNumber
 *  参照番号（YYMMDD-XXXX）で Payment History を検索
 ******************************************************/
function searchByReferenceNumber(refNo) {
  try {
    if (!refNo) {
      return { success: true, orders: [] };
    }
    refNo = String(refNo).trim();

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(PAYMENT_HISTORY_SHEET);
    if (!sh) {
      return { success: false, message: "Payment History sheet not found" };
    }

    const data = sh.getDataRange().getValues();
    if (data.length <= 1) {
      return { success: true, orders: [] };
    }

    const headers = data[0].map(String);
    const lower   = headers.map(h => h.toLowerCase());

    const tsCol   = lower.findIndex(h => h.includes("timestamp") || h.includes("date") || h.includes("日付") || h.includes("日時"));
    const tableCol= lower.findIndex(h => h.includes("table"));
    const foodCol = lower.findIndex(h => h.includes("food") || h.includes("品目") || h.includes("商品"));
    const origCol = lower.findIndex(h => h.includes("original") || h.includes("gross") || h.includes("金額"));
    const discCol = lower.findIndex(h => h.includes("discount") || h.includes("割引"));
    const finalCol= lower.findIndex(h => h.includes("final") || h.includes("net") || h.includes("合計"));
    const methodCol = lower.findIndex(h => h.includes("payment method"));
    const statusCol = lower.findIndex(h => h.includes("status"));
    const refCol  = lower.findIndex(h => h.includes("reference number") || h.includes("reference") || h.includes("ref"));

    if (refCol === -1) {
      return { success: false, message: "Reference Number column not found" };
    }

    const orders = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const refVal = String(row[refCol] || "").trim();
      if (!refVal || refVal !== refNo) continue;

      const tsVal = tsCol >= 0 ? row[tsCol] : "";
      const d     = tsVal instanceof Date ? tsVal : (tsVal ? new Date(tsVal) : null);

      orders.push({
        timestamp: d ? Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss") : "",
        table: tableCol >= 0 ? row[tableCol] : "",
        food:  foodCol  >= 0 ? row[foodCol]  : "",
        originalPrice: origCol >= 0 ? toNumberSafe_(row[origCol]) : 0,
        discount:      discCol >= 0 ? toNumberSafe_(row[discCol]) : 0,
        finalPrice:    finalCol >= 0 ? toNumberSafe_(row[finalCol]) : 0,
        paymentMethod: methodCol >= 0 ? row[methodCol] : "",
        referenceNumber: refVal,
        status: statusCol >= 0 ? row[statusCol] : "",
        displayDate: d ? Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm") : ""
      });
    }

    // Sort by timestamp (newest first)
    orders.sort((a, b) => {
      return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
    });

    return { success: true, orders: orders };

  } catch (err) {
    Logger.log("searchByReferenceNumber error: " + err);
    return { success: false, message: String(err) };
  }
}

/******************************************************
 * 注文情報の詳細を取得（個別オーダー用）
 ******************************************************/
function getOrderDetailsForReprint(orderKey) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const counter = ss.getSheetByName(COUNTER_SHEET);
    if (!counter) {
      return { success: false, message: "Counter sheet not found" };
    }

    const data = counter.getDataRange().getValues();
    const headers = data[0];
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const key = generateRowKey(row, headers);
      
      if (key === orderKey) {
        // 列のインデックスを取得
        const cTsCol    = headers.findIndex(h => String(h).toLowerCase().includes("time"));
        const cTableCol = headers.findIndex(h => String(h).toLowerCase().includes("table"));
        const cFoodCol  = headers.findIndex(h => String(h).toLowerCase().includes("food"));
        const cSetCol   = headers.findIndex(h => String(h).toLowerCase().includes("set"));
        const cRiceCol  = headers.findIndex(h => 
          String(h).toLowerCase().includes("rice|naan") || 
          String(h).toLowerCase().includes("rice_naan") ||
          String(h).toLowerCase().includes("rice") ||
          String(h).toLowerCase().includes("naan")
        );
        const cSpiceCol = headers.findIndex(h => String(h).toLowerCase().includes("spice"));
        const cDrinkCol = headers.findIndex(h => String(h).toLowerCase().includes("drink"));
        const cNoteCol  = headers.findIndex(h => String(h).toLowerCase().includes("note"));
        const cPriceCol = headers.findIndex(h => String(h).toLowerCase().includes("price"));

        const tz = Session.getScriptTimeZone();
        const tsVal = cTsCol >= 0 ? row[cTsCol] : new Date();
        const tsIso = tsVal instanceof Date ? 
          Utilities.formatDate(tsVal, tz, "yyyy-MM-dd'T'HH:mm:ss") : 
          String(tsVal);

        return {
          success: true,
          order: {
            timestamp: tsIso,
            table: cTableCol >= 0 ? row[cTableCol] : "",
            food: cFoodCol >= 0 ? row[cFoodCol] : "",
            set: cSetCol >= 0 ? row[cSetCol] : "",
            riceNaan: cRiceCol >= 0 ? row[cRiceCol] : "",
            spice: cSpiceCol >= 0 ? row[cSpiceCol] : "",
            drink: cDrinkCol >= 0 ? row[cDrinkCol] : "",
            note: cNoteCol >= 0 ? row[cNoteCol] : "",
            price: cPriceCol >= 0 ? Number(row[cPriceCol] || 0) : 0,
            displayDate: Utilities.formatDate(new Date(tsIso), tz, "yyyy-MM-dd HH:mm")
          }
        };
      }
    }

    return { success: false, message: "Order not found" };

  } catch (err) {
    Logger.log("getOrderDetailsForReprint ERROR: " + err);
    return { success: false, message: String(err) };
  }
}

/******************************************************
 * Debug Reprint System Function
 ******************************************************/
function debugReprintSystem() {
  const parsed = _readPaymentHistoryOrders_();
  Logger.log("Total rows in Payment History: " + parsed.data.length);
  Logger.log("Columns found: " + JSON.stringify(parsed.cols));
  Logger.log("Headers: " + JSON.stringify(parsed.headers));
  
  if (parsed.data.length > 0) {
    const sample = parsed.data[0];
    Logger.log("Sample row: " + JSON.stringify(sample));
    Logger.log("Sample timestamp: " + sample[parsed.cols.tsCol]);
    Logger.log("Timestamp type: " + typeof sample[parsed.cols.tsCol]);
  }
  
  return {
    success: true,
    totalRows: parsed.data.length,
    columns: parsed.cols
  };
}

// Note: The printReceipt function at the end uses a different printing method
// (Android intent) and is not used by the current frontend Bluetooth printing system.
// It's safe to remove or keep it for compatibility.
function printReceipt(text) {
  const encodedText = encodeURIComponent(text);
  const slip = `intent://print/#Intent;scheme=escpos;package=co.richofy.bluetoothprinterservice;S.text=${encodedText};end`;
  // This function appears to be for a different printing method and may not be used.
  // If not used, consider removing it.
  return { success: false, message: "This printing method is not supported in the current system" };
}
