export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { transId, time, amount, name, phone, account } = req.body;
  const VALID_ACCOUNTS = ["001","002","003","004","005"];

  if (!VALID_ACCOUNTS.includes(account)) {
    return res.json({ ResultCode: "C2B00012", ResultDesc: "Invalid Account" });
  }

  try {
    await fetch(process.env.SHEET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transId, time, amount, name, phone, account })
    });

    return res.json({ ResultCode: "0", ResultDesc: "Success" });
  } catch (err) {
    return res.json({ ResultCode: "1", ResultDesc: "Sheet Error" });
  }
}
