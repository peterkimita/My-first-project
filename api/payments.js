<!-- 
  SECTIONS (Ctrl+F to jump):
  - CONFIG: line ~370 (SUPABASE_URL, ADMIN_PWD)
  - ACCOUNTS CRUD: search "saveAccount"
  - CASH SALE: search "saveCashSale"  
  - SMS logic: search "bulksms.talksasa"
  - PDF export: search "makePDF"
-->
// ============================================================
// PEJA BEAUTY — DARAJA PAYMENT HANDLER
// ============================================================
// ENVIRONMENT VARIABLES (Vercel → Project → Settings → Environment Variables)
//   SUPABASE_URL       = https://sreenqozalzuudydhufm.supabase.co
//   SUPABASE_ANON_KEY  = your_anon_key_here
//   TALKSASA_SECRET    = your_talksasa_secret_here
// ============================================================

export const config = { api: { bodyParser: false } };

function formatDateTime(transTime) {
  try {
    const s = String(transTime);
    return `${s.slice(6,8)}/${s.slice(4,6)}/${s.slice(0,4)} ${s.slice(8,10)}:${s.slice(10,12)}`;
  } catch { return transTime; }
}

async function sb(path, method = "GET", body = null) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${path}`;
  const opts = {
    method,
    headers: {
      "apikey":        process.env.SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${process.env.SUPABASE_ANON_KEY}`,
      "Content-Type":  "application/json",
      "Prefer":        method === "POST" ? "return=representation" : "",
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Supabase ${method} ${path} → ${r.status}: ${err}`);
  }
  const text = await r.text();
  return text ? JSON.parse(text) : [];
}

async function getAccount(accountNumber) {
  const rows = await sb(`accounts?account_number=eq.${accountNumber}&select=*`);
  return rows[0] || null;
}

async function saveTxn(data) {
  return sb("transactions", "POST", data);
}

async function getDailyTotal(accountNumber) {
  // Use UTC times — Nairobi is UTC+3, so midnight Nairobi = 21:00 UTC previous day
  const now = new Date();
  const nairobiNow = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const todayStr = nairobiNow.toISOString().slice(0, 10); // "2026-05-26"
  // Midnight Nairobi in UTC = todayStr at 21:00 UTC the day before
  const dayStartUTC = new Date(`${todayStr}T00:00:00.000Z`);
  dayStartUTC.setHours(dayStartUTC.getHours() - 3); // subtract 3h to get UTC midnight Nairobi
  const dayEndUTC = new Date(dayStartUTC.getTime() + 24 * 60 * 60 * 1000 - 1);

  const startISO = dayStartUTC.toISOString(); // e.g. "2026-05-25T21:00:00.000Z"
  const endISO   = dayEndUTC.toISOString();   // e.g. "2026-05-26T20:59:59.999Z"

  const rows = await sb(
    `transactions?account_number=eq.${accountNumber}&created_at=gte.${startISO}&created_at=lte.${endISO}&select=amount`
  );
  return rows.reduce((sum, r) => sum + parseFloat(r.amount), 0);
}

async function sendSMS(to, message) {
  const r = await fetch("https://bulksms.talksasa.com/api/v3/sms/send", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${process.env.TALKSASA_SECRET}`,
    },
    body: JSON.stringify({
      recipient: to,
      sender_id: "PejaBeauty",
      message,
      type: "plain",
    }),
  });
  const result = await r.json();
  console.log("📱 SMS Result:", JSON.stringify(result));
  return result;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let rawBody = "";
  for await (const chunk of req) rawBody += chunk;

  let body;
  try { body = JSON.parse(rawBody); }
  catch { body = Object.fromEntries(new URLSearchParams(rawBody)); }

  console.log("🔥 Daraja Payload:", JSON.stringify(body, null, 2));

  const { TransID, TransAmount, TransTime, FirstName, BillRefNumber, AccountReference } = body;
  const account = (AccountReference || BillRefNumber || "").trim();

  // ── VALIDATION ───────────────────────────────────────────────
  if (!TransID) {
    const exists = await getAccount(account);
    if (!exists) {
      console.log(`❌ Validation Failed — Unknown Account: ${account}`);
      return res.json({ ResultCode: "C2B00012", ResultDesc: "Invalid Account Reference" });
    }
    console.log(`✅ Validation Passed — Account: ${account} (${exists.name})`);
    return res.json({ ResultCode: "0", ResultDesc: "Accepted" });
  }

  // ── CONFIRMATION ─────────────────────────────────────────────
  let accountHolder;
  try {
    accountHolder = await getAccount(account);
  } catch (err) {
    console.error("Supabase lookup error:", err.message);
    return res.json({ ResultCode: "1", ResultDesc: "DB Error" });
  }

  if (!accountHolder) {
    console.log(`❌ Unknown Account in Confirmation: ${account}`);
    return res.json({ ResultCode: "C2B00012", ResultDesc: "Invalid Account" });
  }

  // Save transaction
  try {
    await saveTxn({
      trans_id:       TransID,
      trans_time:     TransTime,
      amount:         parseFloat(TransAmount),
      sender_name:    FirstName || "Customer",
      account_number: account,
      type:           "mpesa",
    });
    console.log(`✅ Saved: ${TransID} | KES ${TransAmount} → ${account}`);
  } catch (err) {
    if (err.message.includes("23505")) {
      console.log(`⚠️ Duplicate TransID ignored: ${TransID}`);
      return res.json({ ResultCode: "0", ResultDesc: "Success" });
    }
    console.error("Save error:", err.message);
    return res.json({ ResultCode: "1", ResultDesc: "Internal Error" });
  }

  // Get daily running total
  await new Promise(r => setTimeout(r, 400));
  let dailyTotal = parseFloat(TransAmount);
  try {
    const queried = await getDailyTotal(account);
    if (queried >= parseFloat(TransAmount)) dailyTotal = queried;
    console.log(`💰 Daily total for ${account}: KES ${dailyTotal}`);
  } catch (err) {
    console.error("Daily total error:", err.message);
  }

  // Send SMS
  const dateStr    = formatDateTime(TransTime);
  const amount     = parseFloat(TransAmount).toFixed(2);
  const sender     = (FirstName || "Customer").charAt(0).toUpperCase() + (FirstName || "Customer").slice(1).toLowerCase();
  const holderName = accountHolder.name;
  const message    = `Dear ${holderName}, you have received Ksh ${amount} from ${sender} on ${dateStr}. The new account balance is Ksh ${dailyTotal.toFixed(2)}. Transaction ID: ${TransID}`;

  try {
    await sendSMS(accountHolder.phone, message);
  } catch (err) {
    console.error("SMS error:", err.message);
  }

  return res.json({ ResultCode: "0", ResultDesc: "Success" });
}
