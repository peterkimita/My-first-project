export const config = {
  api: { bodyParser: false },
};

import { google } from 'googleapis';

const SHEET_ID = process.env.GOOGLE_SHEET_ID; // e.g. 1abc123xyz...
const RANGE = "Sheet1!A:G";   // Change if needed

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let rawBody = "";
  for await (const chunk of req) {
    rawBody += chunk;
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    const params = new URLSearchParams(rawBody);
    body = Object.fromEntries(params);
  }

  console.log("🔥 Daraja Payload:", JSON.stringify(body, null, 2));

  const { 
    TransID, 
    TransAmount, 
    TransTime, 
    MSISDN, 
    FirstName, 
    AccountReference,
    BillRefNumber 
  } = body;

  const account = AccountReference || BillRefNumber || "";

  const VALID_ACCOUNTS = ["001", "002", "003", "004", "005"];

  // Validation Request
  if (!TransID) {
    if (!VALID_ACCOUNTS.includes(account)) {
      return res.json({ ResultCode: "C2B00012", ResultDesc: "Invalid Account" });
    }
    return res.json({ ResultCode: "0", ResultDesc: "Accepted" });
  }

  // Confirmation Request
  if (!VALID_ACCOUNTS.includes(account)) {
    return res.json({ ResultCode: "C2B00012", ResultDesc: "Invalid Account" });
  }

  try {
    // === WRITE DIRECTLY TO GOOGLE SHEETS ===
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Format TransTime
    let formattedTime = TransTime || "";
    if (TransTime && TransTime.length === 14) {
      formattedTime = `${TransTime.substring(0,4)}-${TransTime.substring(4,6)}-${TransTime.substring(6,8)} ` +
                     `${TransTime.substring(8,10)}:${TransTime.substring(10,12)}:${TransTime.substring(12,14)}`;
    }

    const phone = (MSISDN && MSISDN.length > 12) ? "N/A" : MSISDN;

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: RANGE,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      resource: {
        values: [[
          TransID,
          formattedTime,
          TransAmount,
          FirstName || "Unknown",
          phone,
          account,
          new Date().toLocaleString()
        ]]
      },
    });

    console.log(`✅ Saved to Google Sheets: ${TransID}`);
    return res.json({ ResultCode: "0", ResultDesc: "Success" });

  } catch (err) {
    console.error("Sheet Error:", err.message);
    return res.json({ ResultCode: "1", ResultDesc: "Internal Error" });
  }
}
