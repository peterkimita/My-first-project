export const config = { api: { bodyParser: false } };

const MEMBERS = {
  "001": { name: "John Theuri",       phone: "254718456514" },
  "002": { name: "Ann Nyokabi",       phone: "254714098302" },
  "003": { name: "John Maina",        phone: "254723219321" },
  "004": { name: "Peter Kimita",      phone: "254714082191" },
  "005": { name: "Lucas Kimani",      phone: "254728304132" },
  "006": { name: "Gladys Wambura",    phone: "254702320501" },
  "007": { name: "Magraret Kariuki",  phone: "254724083957" },
  "008": { name: "Simon Mukundi",     phone: "254720921361" },
  "009": { name: "Martin Mwangi",     phone: "254727652898" },
  "010": { name: "Nancy Nyutu",       phone: "254704172339" },
  "011": { name: "Lydiah Wanja",      phone: "254728226857" },
  "012": { name: "Wilson Mburu",      phone: "254792745619" },
  "013": { name: "Teresa Njoki",      phone: "254723003640" },
  "014": { name: "Julia Njoroge",     phone: "254720615334" },
  "015": { name: "Hannah Wanjiru",    phone: "254711439695" },
  "016": { name: "Teresiah Githindi", phone: "254720335734" },
  "017": { name: "Magraret Mathenge", phone: "254724410811" },
  "018": { name: "Obadiah Gitachu",   phone: "254112077413" },
  "019": { name: "Magraret Wariko",   phone: "254727424720" },
  "020": { name: "Jane Muriuki",      phone: "254711234224" },
};

const seen = new Set();

// ── Talk Sasa SMS ──
async function sendSMS(phone, message) {
  const res = await fetch("https://bulksms.talksasa.com/api/v3/sms/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.TALK_SASA_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      recipient: String(phone),
      sender_id: "PejaBeauty",
      type: "plain",
      message
    }),
  });
  console.log("SMS:", res.status, await res.text());
}

// ── Supabase write ──
async function writeToSupabase(memberId, amount, transId, memberName) {
  const base = process.env.SUPABASE_URL;
  const key  = process.env.SUPABASE_SERVICE_KEY;

  const headers = {
    "apikey": key,
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json",
    "Prefer": "return=representation"
  };

  // 1. Get current unallocated balance
  const balRes = await fetch(
    `${base}/rest/v1/balances?member_id=eq.${memberId}&select=id,unallocated`,
    { headers }
  );
  const balRows = await balRes.json();

  if (!balRows || balRows.length === 0) {
    console.error("No balance row found for member_id:", memberId);
    return false;
  }

  const currentUnalloc = parseFloat(balRows[0].unallocated) || 0;
  const newUnalloc = currentUnalloc + parseFloat(amount);
  const balId = balRows[0].id;

  // 2. Update unallocated balance
  await fetch(
    `${base}/rest/v1/balances?id=eq.${balId}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        unallocated: newUnalloc,
        updated_at: new Date().toISOString()
      })
    }
  );

  // 3. Insert transaction record
  await fetch(
    `${base}/rest/v1/transactions`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        member_id: memberId,
        type: "payment_in",
        amount: parseFloat(amount),
        description: `M-PESA payment received. Ref: ${transId}`,
        recorded_by: "mpesa"
      })
    }
  );

  console.log(`Supabase updated: ${memberName} +KES ${amount} unallocated`);
  return true;
}

// ── Main handler ──
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  let raw = "";
  for await (const chunk of req) raw += chunk;

  let body;
  try { body = JSON.parse(raw); }
  catch { body = Object.fromEntries(new URLSearchParams(raw)); }

  const { TransID, TransAmount, FirstName, AccountReference, BillRefNumber } = body;
  const account = (AccountReference || BillRefNumber || "").trim();
  const member  = MEMBERS[account];

  // Unknown account
  if (!member) {
    return res.json({ ResultCode: "C2B00012", ResultDesc: "Invalid Account" });
  }

  // Validation callback (no TransID)
  if (!TransID) {
    return res.json({ ResultCode: "0", ResultDesc: "Accepted" });
  }

  // Duplicate guard
  if (seen.has(TransID)) {
    console.log("DUPLICATE:", TransID);
    return res.json({ ResultCode: "0", ResultDesc: "Success" });
  }
  seen.add(TransID);

  // Find member ID in Supabase (by account number)
  try {
    const base = process.env.SUPABASE_URL;
    const key  = process.env.SUPABASE_SERVICE_KEY;

    const memberRes = await fetch(
      `${base}/rest/v1/members?account_number=eq.${account}&select=id,full_name`,
      {
        headers: {
          "apikey": key,
          "Authorization": `Bearer ${key}`
        }
      }
    );
    const memberRows = await memberRes.json();

    if (memberRows && memberRows.length > 0) {
      const dbMemberId = memberRows[0].id;
      await writeToSupabase(dbMemberId, TransAmount, TransID, member.name);
    } else {
      console.error("Member not found in Supabase for account:", account);
    }
  } catch (err) {
    // Never block M-PESA response even if Supabase fails
    console.error("Supabase write error:", err.message);
  }

  // Send SMS confirmation
  try {
    const msg = `Dear ${member.name}, KES ${TransAmount} recd from ${FirstName || "Someone"}. Ref ${TransID}. Allocated Thursday midnight. God bless. Mlango Soko.`;
    await sendSMS(member.phone, msg);
  } catch (err) {
    console.error("SMS error:", err.message);
  }

  return res.json({ ResultCode: "0", ResultDesc: "Success" });
}
