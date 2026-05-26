// ============================================================
// PEJA BEAUTY — DARAJA PAYMENT HANDLER
// Vercel Serverless Function
// ============================================================
// ENVIRONMENT VARIABLES (set in Vercel → Project → Settings → Environment Variables)
//
//   SUPABASE_URL        = https://sreenqozalzuudydhufm.supabase.co
//   SUPABASE_ANON_KEY   = your_anon_key_here
//   TALKSASA_SECRET     = your_talksasa_secret_here
//
// ============================================================

export const config = {
  api: { bodyParser: false },
};

// ── Helpers ──────────────────────────────────────────────────

function formatDateTime(transTime) {
  // TransTime format: "20260522123920" → "22/05/2026 12:39"
  try {
    const s = String(transTime);
    const year  = s.slice(0, 4);
    const month = s.slice(4, 6);
    const day   = s.slice(6, 8);
    const hour  = s.slice(8, 10);
    const min   = s.slice(10, 12);
    return `${day}/${month}/${year} ${hour}:${min}`;
  } catch {
    return transTime;
  }
}

// ── Supabase ─────────────────────────────────────────────────

async function supabase(path, method = "GET", body = null) {
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
  const rows = await supabase(
    `accounts?account_number=eq.${accountNumber}&select=*`
  );
  return rows[0] || null;
}

async function saveTxn(data) {
  return supabase("transactions", "POST", data);
}

async function getDailyTotal(accountNumber) {
  // Sum all transactions for this account today (Nairobi = UTC+3)
  const now = new Date();
  const nairobiOffset = 3 * 60 * 60 * 1000;
  const nairobiNow = new Date(now.getTime() + nairobiOffset);
  const todayStr = nairobiNow.toISOString().slice(0, 10); // "2026-05-22"

  // created_at is stored in UTC; we filter from midnight Nairobi (UTC+3 → subtract 3h)
  const dayStart = `${todayStr}T00:00:00+03:00`;
  const dayEnd   = `${todayStr}T23:59:59+03:00`;

  const rows = await supabase(
    `transactions?account_number=eq.${accountNumber}&created_at=gte.${dayStart}&created_at=lte.${dayEnd}&select=amount`
  );
  return rows.reduce((sum, r) => sum + parseFloat(r.amount), 0);
}

// ── Talk Sasa SMS ─────────────────────────────────────────────

async function sendSMS(to, message) {
  const payload = {
    recipient: to,          // 2547XXXXXXXX format
    sender_id: "PejaBeauty",
    message,
    type: "plain",
  };
  const r = await fetch("https://bulksms.talksasa.com/api/v3/sms/send", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${process.env.TALKSASA_SECRET}`,
    },
    body: JSON.stringify(payload),
  });
  const result = await r.json();
  console.log("📱 SMS Result:", JSON.stringify(result));
  return result;
}

// ── Main Handler ──────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Parse body (Daraja sends urlencoded or JSON depending on config)
  let rawBody = "";
  for await (const chunk of req) rawBody += chunk;

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
    FirstName,
    BillRefNumber,
    AccountReference,
  } = body;

  const account = (AccountReference || BillRefNumber || "").trim();

  // ── VALIDATION (Daraja calls with no TransID) ────────────────
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
    });
    console.log(`✅ Saved: ${TransID} | KES ${TransAmount} → ${account}`);
  } catch (err) {
    // Duplicate TransID → already processed, still return success to Daraja
    if (err.message.includes("23505")) {
      console.log(`⚠️ Duplicate TransID ignored: ${TransID}`);
      return res.json({ ResultCode: "0", ResultDesc: "Success" });
    }
    console.error("Save error:", err.message);
    return res.json({ ResultCode: "1", ResultDesc: "Internal Error" });
  }

  // Get daily running total (includes this transaction)
  let dailyTotal = 0;
  try {
    dailyTotal = await getDailyTotal(account);
  } catch (err) {
    console.error("Daily total error:", err.message);
    // Non-fatal — still send SMS with amount received
  }

  // Send SMS to account holder
  const dateStr  = formatDateTime(TransTime);
  const amount   = parseFloat(TransAmount).toFixed(2);
  const sender   = (FirstName || "Customer").charAt(0).toUpperCase() + (FirstName || "Customer").slice(1).toLowerCase();
  const holderName = accountHolder.name;
  const message  = `Dear ${holderName}, you have received Ksh ${amount} from ${sender} on ${dateStr}. The new account balance is Ksh ${dailyTotal.toFixed(2)}. Transaction ID: ${TransID}`;

  try {
    await sendSMS(accountHolder.phone, message);
  } catch (err) {
    console.error("SMS error:", err.message);
    // Non-fatal — payment is already confirmed
  }

  return res.json({ ResultCode: "0", ResultDesc: "Success" });
}
