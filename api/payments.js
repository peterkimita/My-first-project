// pages/api/payment.js
// Daraja C2B callback handler
// - Validates account against "Accounts" Google Sheet
// - Writes new transaction to "Transactions" sheet at row 3 (below header + formula rows)
// - Sends SMS confirmation via TalkSasa with daily running sum from E2

export const config = { api: { bodyParser: false } };

import { google } from "googleapis";

// ── Google Sheets config ──────────────────────────────────────────────────────
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID; // set in Vercel env vars
const ACCOUNTS_SHEET  = "Accounts";     // tab name
const TRANS_SHEET     = "Transactions"; // tab name

// Columns in Accounts sheet (1-indexed): A=Account number, B=Name, C=Phone
// Columns written to Transactions sheet: A=DateTime, B=TransID, C=Account, D=Name, E=Phone, F=Amount

// ── Auth: Service Account ─────────────────────────────────────────────────────
// Store the full JSON key as GOOGLE_SERVICE_ACCOUNT_KEY in Vercel env vars
function getSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

// ── Read all accounts from "Accounts" sheet ───────────────────────────────────
// Returns a map: { "2782": { name: "Peter", phone: "254714082191" }, ... }
async function loadAccounts(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ACCOUNTS_SHEET}!A2:C`, // skip header row 1
  });
  const rows = res.data.values || [];
  const map = {};
  for (const [account, name, phone] of rows) {
    if (account && name && phone) {
      map[account.trim()] = { name: name.trim(), phone: phone.trim() };
    }
  }
  return map;
}

// ── Read daily sum from Transactions!E2 ───────────────────────────────────────
async function getDailySum(sheets) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${TRANS_SHEET}!E2`,
      valueRenderOption: "FORMATTED_VALUE", // get the display value (e.g. "12,500")
    });
    const val = res.data.values?.[0]?.[0] || "0";
    return val;
  } catch {
    return "0";
  }
}

// ── Insert a new row at row 3 (pushes existing data down) ────────────────────
async function writeTransaction(sheets, row) {
  // 1. Insert a blank row at position 3 (0-indexed: startIndex=2)
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          insertDimension: {
            range: {
              sheetId: await getSheetId(sheets, TRANS_SHEET),
              dimension: "ROWS",
              startIndex: 2, // row 3 (0-indexed), after header row 1 and formula row 2
              endIndex: 3,
            },
            inheritFromBefore: false,
          },
        },
      ],
    },
  });

  // 2. Write the transaction data into the newly created row 3
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TRANS_SHEET}!A3:F3`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [row],
    },
  });
}

// ── Get the internal sheetId for a tab by name ────────────────────────────────
const sheetIdCache = {};
async function getSheetId(sheets, tabName) {
  if (sheetIdCache[tabName]) return sheetIdCache[tabName];
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });

  for (const s of meta.data.sheets) {
    if (s.properties.title === tabName) {
      sheetIdCache[tabName] = s.properties.sheetId;
      return s.properties.sheetId;
    }
  }
  throw new Error(`Sheet tab "${tabName}" not found`);
}

// ── Send SMS via TalkSasa ─────────────────────────────────────────────────────
async function sendSMS(phone, message) {
  const res = await fetch("https://bulksms.talksasa.com/api/v3/sms/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.TALK_SASA_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recipient: String(phone),
      sender_id: "MlangoSoko",
      type: "plain",
      message,
    }),
  });
  console.log("SMS status:", res.status, await res.text());
}

// ── Dedup cache (in-memory, resets on cold start) ─────────────────────────────
const seen = new Set();

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  // Parse raw body (Daraja sends JSON or form-encoded)
  let raw = "";
  for await (const chunk of req) raw += chunk;
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    body = Object.fromEntries(new URLSearchParams(raw));
  }

  const { TransID, TransAmount, FirstName, AccountReference, BillRefNumber } = body;
  const account = (AccountReference || BillRefNumber || "").trim();

  // ── Init Sheets client ────────────────────────────────────────────────────
  const sheets = getSheetsClient();

  // ── Validate account against Accounts sheet ───────────────────────────────
  const members = await loadAccounts(sheets);
  const member = members[account];

  if (!member) {
    console.warn("Unknown account:", account);
    return res.json({ ResultCode: "C2B00012", ResultDesc: "Invalid Account" });
  }

  // ── Daraja validation callback (no TransID yet) ───────────────────────────
  if (!TransID) {
    return res.json({ ResultCode: "0", ResultDesc: "Accepted" });
  }

  // ── Dedup check ───────────────────────────────────────────────────────────
  if (seen.has(TransID)) {
    console.log("Duplicate ignored:", TransID);
    return res.json({ ResultCode: "0", ResultDesc: "Success" });
  }
  seen.add(TransID);

  // ── Write to Transactions sheet ───────────────────────────────────────────
  const now = new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" });
  const row = [now, TransID, account, member.name, member.phone, Number(TransAmount)];

  try {
    await writeTransaction(sheets, row);
    console.log("Sheet written:", TransID, member.name, TransAmount);
  } catch (err) {
    console.error("Sheet write error:", err.message);
    // Don't block SMS or Daraja response on sheet failure
  }

  // ── Send SMS with daily sum from E2 ──────────────────────────────────────
  try {
    const dailySum = await getDailySum(sheets);
    const msg =
      `Dear ${member.name}, KES ${TransAmount} received from ${FirstName || "Someone"}. ` +
      `Ref ${TransID}. Today's total: KES ${dailySum}. ` +
      `Pay Paybill 4163519 Acct ${account}. Asante - Mlango Soko Chama.`;
    await sendSMS(member.phone, msg);
    console.log("SMS sent:", TransID, member.name);
  } catch (err) {
    console.error("SMS error:", err.message);
  }

  return res.json({ ResultCode: "0", ResultDesc: "Success" });
}
