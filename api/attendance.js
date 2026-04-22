const attendanceEndpoint =
  "https://smartclass.halic.edu.tr/Akademisyen/ProcessQrAttendance";

function normalizeAuthToken(rawValue) {
  return String(rawValue ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
}

function normalizeCookieHeader(rawValue) {
  const input = String(rawValue ?? "").trim();
  if (!input) {
    return "";
  }

  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\/\//, "").trim());

  const cookieParts = lines
    .filter((line) => /^cookie\s*:/i.test(line))
    .map((line) => line.replace(/^cookie\s*:/i, "").trim())
    .filter(Boolean);

  return cookieParts.length ? cookieParts.join("; ") : input;
}

function sendJson(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { success: false, message: "Method not allowed" });
  }

  const {
    qrContent,
    studentTckn,
    authToken,
    cookieHeader,
    requestId,
    pairLabel,
  } = req.body ?? {};
  const normalizedAuthToken = normalizeAuthToken(authToken);
  const normalizedCookieHeader = normalizeCookieHeader(cookieHeader);

  if (!qrContent || !studentTckn) {
    return sendJson(res, 400, {
      success: false,
      message: "qrContent and studentTckn are required",
    });
  }

  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    "accept-language": "en-AU,en-US;q=0.9,en;q=0.8",
    "accept-encoding": "gzip, deflate, br",
    "user-agent": "SmartCampus-Mobile",
    priority: "u=3, i",
  };

  if (normalizedAuthToken) {
    headers.authorization = `Bearer ${normalizedAuthToken}`;
  }

  if (normalizedCookieHeader) {
    headers.cookie = normalizedCookieHeader;
  }

  try {
    const upstreamResponse = await fetch(attendanceEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        QrContent: qrContent,
        StudentTckn: studentTckn,
      }),
    });

    const responseText = await upstreamResponse.text();
    let parsedBody = responseText;

    try {
      parsedBody = JSON.parse(responseText);
    } catch {
      // Keep plain text when the upstream API does not return JSON.
    }

    return sendJson(res, upstreamResponse.status, {
      requestId,
      pairLabel,
      studentTckn,
      qrContent,
      upstreamStatus: upstreamResponse.status,
      upstreamOk: upstreamResponse.ok,
      body: parsedBody,
    });
  } catch (error) {
    return sendJson(res, 502, {
      requestId,
      pairLabel,
      studentTckn,
      qrContent,
      success: false,
      message: error.message,
    });
  }
};
