// ============================================================
// MLANGO SOKO — DARAJA PAYMENT HANDLER
// ============================================================
// ENVIRONMENT VARIABLES (Vercel → Project → Settings → Environment Variables)
//   NEXT_PUBLIC_SUPABASE_URL       = https://sreenqozalzuudydhufm.supabase.co
//   NEXT_PUBLIC_SUPABASE_ANON_KEY  = your anon key
//   SUPABASE_SERVICE_ROLE_KEY      = your service role key
//   TALKSASA_SECRET                = your talksasa token
//
// HOW THIS WORKS:
// Safaricom sends TWO requests for every payment:
//   1. VALIDATION  — "Is this account number valid?" (no TransID)
//   2. CONFIRMATION — "Payment confirmed, save it." (has TransID)
//
// On confirmation we:
//   - Find the member by account number
//   - Add the amount to their UNALLOCATED balance
//   - Save a transaction record
//   - Send an SMS to the member
// ============================================================

export const config = { api: { bodyParser: false } };

// ── SUPABASE HELPER ──────────────────────────────────────────
// Talks to our database. Uses the service role key so it can
// update balances securely from the server side.
async function sb(path, method = "GET", body = null) {
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`;
  const opts = {
    method,
    headers: {
      "apikey":        process.env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
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

// ── FORMAT DATE FOR SMS ──────────────────────────────────────
// Converts Safaricom's TransTime format (20260605120000)
// to readable format (05/06/2026 12:00)
function formatDateTime(transTime) {
  try {
    const s = String(transTime);
    return `${s.slice(6,8)}/${s.slice(4,6)}/${s.slice(0,4)} ${s.slice(8,10)}:${s.slice(10,12)}`;
  } catch { return String(transTime); }
}

// ── SEND SMS ─────────────────────────────────────────────────
async function sendSMS(to, message) {
  const r = await fetch("https://bulksms.talksasa.com/api/v3/sms/send", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${process.env.TALKSASA_SECRET}`,
    },
    body: JSON.stringify({
      recipient: to,
      sender_id: "MlangoSoko",   // ← update once registered with Talksasa
      message,
      type: "plain",
    }),
  });
  const result = await r.json();
  console.log("📱 SMS Result:", JSON.stringify(result));
  return result;
}

// ── MAIN HANDLER ─────────────────────────────────────────────
export default async function handler(req, res) {

  // Only accept POST requests from Safaricom
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Read the raw request body
  let rawBody = "";
  for await (const chunk of req) rawBody += chunk;

  // Parse it — Safaricom sends JSON
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    body = Object.fromEntries(new URLSearchParams(rawBody));
  }

  console.log("🔥 Daraja Payload:", JSON.stringify(body, null, 2));

  // Pull out the fields Safaricom sends
  const {
    TransID,
    TransAmount,
    TransTime,
    FirstName,
    BillRefNumber,
    AccountReference,
  } = body;

  // Account number is what the member entered on Paybill
  // e.g. "001", "002" etc.
  const account = (AccountReference || BillRefNumber || "").trim().padStart(3, "0");

  // ── STEP 1: VALIDATION ────────────────────────────────────
  // Safaricom first asks: "Is this account valid?"
  // If no TransID, this is a validation request.
  if (!TransID) {
    console.log(`🔍 Validation request for account: ${account}`);
    try {
      const rows = await sb(
        `members?account_number=eq.${account}&status=eq.active&select=id,full_name`
      );
      if (!rows.length) {
        console.log(`❌ Validation Failed — Unknown Account: ${account}`);
        return res.json({ ResultCode: "C2B00012", ResultDesc: "Invalid Account Number" });
      }
      console.log(`✅ Validation Passed — Account: ${account} (${rows[0].full_name})`);
      return res.json({ ResultCode: "0", ResultDesc: "Accepted" });
    } catch (err) {
      console.error("Validation DB error:", err.message);
      // If DB fails, accept anyway to not block payment
      return res.json({ ResultCode: "0", ResultDesc: "Accepted" });
    }
  }

  // ── STEP 2: CONFIRMATION ──────────────────────────────────
  // Safaricom says: "Payment confirmed. Save it."
  console.log(`💰 Confirmation: ${TransID} | KES ${TransAmount} → ${account}`);

  // Look up the member
  let member;
  try {
    const rows = await sb(
      `members?account_number=eq.${account}&status=eq.active&select=id,full_name,phone_number`
    );
    member = rows[0];
  } catch (err) {
    console.error("Member lookup error:", err.message);
    return res.json({ ResultCode: "1", ResultDesc: "DB Error" });
  }

  if (!member) {
    console.log(`❌ Member not found for account: ${account}`);
    return res.json({ ResultCode: "C2B00012", ResultDesc: "Invalid Account" });
  }

  const amount = parseFloat(TransAmount);

  // ── STEP 3: SAVE TRANSACTION ──────────────────────────────
  try {
    await sb("transactions", "POST", {
      member_id:         member.id,
      type:              "paybill",
      amount:            amount,
      direction:         "credit",
      allocation_target: "unallocated",
      mpesa_trans_id:    TransID,
      reason:            `M-PESA payment from ${FirstName || "Customer"}`,
    });
    console.log(`✅ Transaction saved: ${TransID}`);
  } catch (err) {
    // Error code 23505 = duplicate transaction ID — already saved, ignore
    if (err.message.includes("23505")) {
      console.log(`⚠️ Duplicate TransID ignored: ${TransID}`);
      return res.json({ ResultCode: "0", ResultDesc: "Success" });
    }
    console.error("Transaction save error:", err.message);
    return res.json({ ResultCode: "1", ResultDesc: "Internal Error" });
  }

  // ── STEP 4: UPDATE UNALLOCATED BALANCE ───────────────────
  // We add the payment to the member's unallocated pot.
  // On Thursday midnight the system will move it to the
  // right place (savings, loans, contributions etc.)
  try {
    // Get current balance
    const balRows = await sb(
      `balances?member_id=eq.${member.id}&select=id,unallocated`
    );

    if (balRows.length) {
      // Balance record exists — add to it
      const current = parseFloat(balRows[0].unallocated) || 0;
      const newBal  = current + amount;
      await sb(`balances?member_id=eq.${member.id}`, "PATCH", {
        unallocated: newBal,
        updated_at:  new Date().toISOString(),
      });
      console.log(`💼 Unallocated updated: ${current} + ${amount} = ${newBal} for ${member.full_name}`);

      // ── STEP 5: SEND SMS ────────────────────────────────
      const dateStr = formatDateTime(TransTime);
      const sender  = (FirstName || "Customer")
        .charAt(0).toUpperCase() +
        (FirstName || "Customer").slice(1).toLowerCase();

      const message =
        `Dear ${member.full_name.split(" ")[0]}, ` +
        `KES ${amount.toFixed(2)} received from ${sender} on ${dateStr}. ` +
        `Unallocated balance: KES ${newBal.toFixed(2)}. ` +
        `Ref: ${TransID}. ` +
        `Funds will be allocated on Thursday midnight.`;

      try {
        await sendSMS(member.phone_number, message);
      } catch (err) {
        // SMS failure should not block the payment confirmation
        console.error("SMS error:", err.message);
      }

    } else {
      // No balance record yet — create one
      // This should not normally happen as we create balances
      // when members are added, but just in case.
      await sb("balances", "POST", {
        member_id:   member.id,
        savings:     0,
        unallocated: amount,
      });
      console.log(`⚠️ Created missing balance record for ${member.full_name}`);
    }

  } catch (err) {
    console.error("Balance update error:", err.message);
    // Still return success to Safaricom — transaction is saved,
    // admin can manually fix the balance if needed.
  }

  // Always tell Safaricom we received the payment successfully
  return res.json({ ResultCode: "0", ResultDesc: "Success" });
}
