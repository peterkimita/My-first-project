export const config = {
  api: { bodyParser: false },
};

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

  console.log("Full Daraja Payload:", JSON.stringify(body, null, 2));

  const {
    TransID,
    TransAmount,
    TransTime,
    MSISDN,
    FirstName,
    MiddleName,
    LastName,
    BillRefNumber,
    AccountReference,
    ThirdPartyTransID,
    OrgAccountBalance,
    TransactionType,
  } = body;

  const account = AccountReference || BillRefNumber || "";
  const phone = MSISDN ? String(MSISDN).trim() : "";   // ← Strong fix for phone
  const fullName = [FirstName, MiddleName, LastName].filter(Boolean).join(" ").trim();

  const VALID_ACCOUNTS = ["001", "002", "003", "004", "005"];

  if (!VALID_ACCOUNTS.includes(account)) {
    console.log(`Invalid account: ${account}`);
    return res.json({ ResultCode: "C2B00012", ResultDesc: "Invalid Account" });
  }

  try {
    await fetch(process.env.SHEET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transId: TransID || "",
        time: TransTime || "",                    // Raw TransTime (e.g. 20260519124500)
        amount: TransAmount || "",
        phone: phone || "",                       // Clean MSISDN
        name: fullName || FirstName || "Unknown",
        account: account,
        thirdPartyTransID: ThirdPartyTransID || "",
        orgBalance: OrgAccountBalance || "",
        transactionType: TransactionType || "",
      }),
    });

    console.log(`✅ Saved transaction ${TransID} | Phone: ${phone}`);
    return res.json({ ResultCode: "0", ResultDesc: "Success" });

  } catch (err) {
    console.error("Sheet Error:", err.message);
    return res.json({ ResultCode: "1", ResultDesc: "Sheet Error" });
  }
}
