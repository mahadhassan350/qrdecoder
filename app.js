const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const resultText = document.getElementById("resultText");
const statusBadge = document.getElementById("statusBadge");
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const copyButton = document.getElementById("copyButton");
const sendButton = document.getElementById("sendButton");
const zoomControls = document.getElementById("zoomControls");
const zoomRange = document.getElementById("zoomRange");
const zoomValue = document.getElementById("zoomValue");
const pairList = document.getElementById("pairList");
const addPairButton = document.getElementById("addPairButton");
const tokenModeInput = document.getElementById("tokenMode");
const cookieInput = document.getElementById("cookieInput");
const requestState = document.getElementById("requestState");
const responseSummary = document.getElementById("responseSummary");
const apiResponse = document.getElementById("apiResponse");

const overlayContext = overlay.getContext("2d");
const attendanceEndpoint =
  "https://smartclass.halic.edu.tr/Akademisyen/ProcessQrAttendance";
const proxyEndpoint = "/api/attendance";

let stream = null;
let animationFrameId = null;
let detectedText = "";
let lastSubmissionSignature = "";
let requestInFlight = false;
let cameraTrack = null;
let zoomCapability = null;

function setStatus(text) {
  statusBadge.textContent = text;
}

function setResult(text) {
  detectedText = text;
  resultText.textContent = text;
  copyButton.disabled = !text;
}

function setRequestState(text, stateClass) {
  requestState.textContent = text;
  requestState.className = `request-state ${stateClass}`;
}

function setApiResponse(content) {
  apiResponse.textContent =
    typeof content === "string" ? content : JSON.stringify(content, null, 2);
}

function setZoomVisibility(isVisible) {
  zoomControls.classList.toggle("hidden", !isVisible);
}

function resetZoomControls() {
  cameraTrack = null;
  zoomCapability = null;
  zoomRange.min = "1";
  zoomRange.max = "1";
  zoomRange.step = "0.1";
  zoomRange.value = "1";
  zoomRange.disabled = true;
  zoomValue.textContent = "1.0x";
  setZoomVisibility(false);
}

async function applyZoom(value) {
  if (!cameraTrack || !zoomCapability) {
    return;
  }

  const zoom = Number(value);

  try {
    await cameraTrack.applyConstraints({
      advanced: [{ zoom }],
    });
    zoomValue.textContent = `${zoom.toFixed(1)}x`;
  } catch (error) {
    setStatus(`Zoom failed: ${error.message}`);
  }
}

function setupZoomControls(activeTrack) {
  resetZoomControls();
  cameraTrack = activeTrack;

  const capabilities = activeTrack.getCapabilities?.();
  const settings = activeTrack.getSettings?.();
  const zoom = capabilities?.zoom;

  if (!zoom || typeof zoom.min !== "number" || typeof zoom.max !== "number") {
    return;
  }

  zoomCapability = zoom;
  zoomRange.min = String(zoom.min);
  zoomRange.max = String(zoom.max);
  zoomRange.step = String(zoom.step || 0.1);
  zoomRange.value = String(settings?.zoom ?? zoom.min);
  zoomRange.disabled = false;
  zoomValue.textContent = `${Number(zoomRange.value).toFixed(1)}x`;
  setZoomVisibility(true);
}

function formatResponseBody(content) {
  return typeof content === "string" ? content : JSON.stringify(content, null, 2);
}

function normalizeAuthToken(rawValue) {
  return rawValue.replace(/^Bearer\s+/i, "").trim();
}

function normalizeCookieHeader(rawValue) {
  const lines = rawValue
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\/\//, "").trim());

  const cookieParts = lines
    .filter((line) => /^cookie\s*:/i.test(line))
    .map((line) => line.replace(/^cookie\s*:/i, "").trim())
    .filter(Boolean);

  if (cookieParts.length) {
    return cookieParts.join("; ");
  }

  return rawValue.trim();
}

function renderResponseSummary(results) {
  if (!results || !results.length) {
    responseSummary.className = "response-summary empty";
    responseSummary.textContent = "No request sent yet.";
    return;
  }

  responseSummary.className = "response-summary";
  responseSummary.innerHTML = "";

  for (const result of results) {
    const state = result.state ?? (result.ok ? "success" : "error");
    const badgeText =
      state === "pending" ? "Pending" : result.ok ? "Success" : "Failed";
    const card = document.createElement("div");
    card.className = `response-card ${state}`;
    card.innerHTML = `
      <div class="response-card-header">
        <div class="response-title">Request ${result.requestId}</div>
        <div class="response-badge ${state}">
          ${badgeText}
        </div>
      </div>
      <div class="response-meta">
        Pair: ${result.pairLabel}<br />
        Student: ${result.studentTckn}<br />
        HTTP: ${result.status || "Request error"}<br />
        Token: ${result.tokenPreview}<br />
        QR: ${result.qrContent}
      </div>
      <div class="response-body"></div>
    `;

    card.querySelector(".response-body").textContent = formatResponseBody(
      result.body
    );
    responseSummary.appendChild(card);
  }
}

function createPairCard(studentTckn = "", authToken = "") {
  const card = document.createElement("div");
  card.className = "pair-card";
  card.innerHTML = `
    <div class="pair-card-header">
      <div class="pair-index"></div>
      <button type="button" class="secondary pair-remove">Remove</button>
    </div>
    <label class="field-label">Student TCKN</label>
    <input
      class="text-input student-input"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      placeholder="99834848902"
      value="${studentTckn}"
    />
    <label class="field-label">Bearer Token</label>
    <textarea
      class="text-input text-area compact-text-area token-input"
      spellcheck="false"
      autocomplete="off"
      placeholder="Paste the JWT token only, without the Bearer prefix"
    >${authToken}</textarea>
  `;

  const removeButton = card.querySelector(".pair-remove");
  removeButton.addEventListener("click", () => {
    if (pairList.children.length === 1) {
      card.querySelector(".student-input").value = "";
      card.querySelector(".token-input").value = "";
      return;
    }

    card.remove();
    refreshPairIndexes();
  });

  return card;
}

function refreshPairIndexes() {
  const cards = pairList.querySelectorAll(".pair-card");
  cards.forEach((card, index) => {
    const label = card.querySelector(".pair-index");
    label.textContent = `Pair ${index + 1}`;
  });
}

function addPair(studentTckn = "", authToken = "") {
  pairList.appendChild(createPairCard(studentTckn, authToken));
  refreshPairIndexes();
}

function getPairEntries() {
  return Array.from(pairList.querySelectorAll(".pair-card")).map((card, index) => ({
    pairIndex: index,
    pairLabel: `Pair ${index + 1}`,
    studentTckn: card.querySelector(".student-input").value.trim(),
    authToken: normalizeAuthToken(card.querySelector(".token-input").value.trim()),
  }));
}

function buildSubmissionPlan() {
  const entries = getPairEntries();
  const studentTckns = entries
    .map((entry) => entry.studentTckn)
    .filter(Boolean);
  const authTokens = entries
    .map((entry) => entry.authToken)
    .filter(Boolean);
  const tokenMode = tokenModeInput.value;

  if (!studentTckns.length) {
    return { error: "Enter at least one Student TCKN before scanning." };
  }

  if (!authTokens.length) {
    return { error: "Enter at least one bearer token before scanning." };
  }

  if (tokenMode === "pair") {
    const pairedEntries = entries.filter(
      (entry) => entry.studentTckn && entry.authToken
    );

    if (authTokens.length === 1) {
      return {
        studentTckns,
        authTokens,
        tokenMode,
        requests: entries
          .filter((entry) => entry.studentTckn)
          .map((entry) => ({
            studentTckn: entry.studentTckn,
            authToken: authTokens[0],
            pairIndex: entry.pairIndex,
            pairLabel: entry.pairLabel,
          })),
      };
    }

    if (pairedEntries.length !== studentTckns.length) {
      return {
        error:
          "Match same row mode needs a token on the same row as each student, unless you provide exactly one token to reuse for all students.",
      };
    }

    return {
      studentTckns,
      authTokens,
      tokenMode,
      requests: pairedEntries.map((entry) => ({
        studentTckn: entry.studentTckn,
        authToken: entry.authToken,
        pairIndex: entry.pairIndex,
        pairLabel: entry.pairLabel,
      })),
    };
  }

  return {
    studentTckns,
    authTokens,
    tokenMode,
    requests: entries
      .filter((entry) => entry.studentTckn)
      .flatMap((studentEntry) =>
        entries
          .filter((entry) => entry.authToken)
          .map((tokenEntry) => ({
            studentTckn: studentEntry.studentTckn,
            authToken: tokenEntry.authToken,
            pairIndex: studentEntry.pairIndex,
            pairLabel: `${studentEntry.pairLabel} x ${tokenEntry.pairLabel}`,
          }))
      ),
  };
}

function buildSubmissionSignature(qrContent, plan) {
  return JSON.stringify({
    qrContent,
    tokenMode: plan.tokenMode,
    studentTckns: plan.studentTckns,
    authTokens: plan.authTokens,
  });
}

async function submitAttendance(qrContent) {
  const plan = buildSubmissionPlan();
  const normalizedQrContent = qrContent.trim();
  const cookieHeader = normalizeCookieHeader(cookieInput.value);

  if (plan.error) {
    setRequestState("Input required", "error");
    renderResponseSummary([]);
    setApiResponse(plan.error);
    return;
  }

  if (!normalizedQrContent) {
    setRequestState("QR required", "error");
    renderResponseSummary([]);
    setApiResponse("Scan or paste a QR first. Empty QrContent is not sent.");
    return;
  }

  const submissionSignature = buildSubmissionSignature(normalizedQrContent, plan);

  if (requestInFlight || submissionSignature === lastSubmissionSignature) {
    return;
  }

  requestInFlight = true;
  setRequestState(`Sending ${plan.requests.length} request(s)...`, "pending");
  renderResponseSummary(
    plan.requests.map(({ studentTckn, authToken, pairLabel }, index) => ({
      requestId: index + 1,
      pairLabel,
      studentTckn,
      qrContent: normalizedQrContent,
      status: "",
      ok: false,
      state: "pending",
      tokenPreview: `${authToken.slice(0, 12)}...`,
      body: "Request queued...",
    }))
  );
  setApiResponse({
    endpoint: proxyEndpoint,
    upstreamEndpoint: attendanceEndpoint,
    mode: plan.tokenMode,
    qrContent: normalizedQrContent,
    cookieIncluded: Boolean(cookieHeader),
    requestCount: plan.requests.length,
    requests: plan.requests.map(({ studentTckn, authToken, pairLabel }, index) => ({
      requestId: index + 1,
      pairLabel,
      studentTckn,
      qrContent: normalizedQrContent,
      authTokenPreview: `${authToken.slice(0, 12)}...`,
    })),
  });

  try {
    const results = await Promise.all(
      plan.requests.map(async ({ studentTckn, authToken, pairLabel }, index) => {
        try {
          const response = await fetch(proxyEndpoint, {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              qrContent: normalizedQrContent,
              studentTckn,
              authToken,
              cookieHeader,
              requestId: index + 1,
              pairLabel,
            }),
          });

          const responseText = await response.text();
          let parsedBody = responseText;

          try {
            parsedBody = JSON.parse(responseText);
          } catch {
            // Keep plain text when the API does not return JSON.
          }

          return {
            requestId: index + 1,
            pairLabel,
            studentTckn,
            qrContent: normalizedQrContent,
            status: response.status,
            ok: response.ok,
            tokenPreview: `${authToken.slice(0, 12)}...`,
            body: parsedBody,
          };
        } catch (error) {
          return {
            requestId: index + 1,
            pairLabel,
            studentTckn,
            qrContent: normalizedQrContent,
            status: 0,
            ok: false,
            tokenPreview: `${authToken.slice(0, 12)}...`,
            body: error.message,
          };
        }
      })
    );

    const successCount = results.filter((result) => result.ok).length;
    lastSubmissionSignature = submissionSignature;
    setRequestState(
      successCount === results.length
        ? `Sent ${successCount}/${results.length}`
        : `Partial ${successCount}/${results.length}`,
      successCount === results.length ? "success" : "error"
    );
    renderResponseSummary(results);
    setApiResponse({
      endpoint: proxyEndpoint,
      upstreamEndpoint: attendanceEndpoint,
      qrContent: normalizedQrContent,
      mode: plan.tokenMode,
      sent: successCount,
      failed: results.length - successCount,
      results,
    });
  } catch (error) {
    setRequestState("Failed", "error");
    renderResponseSummary([
      {
        requestId: "batch",
        pairLabel: "Batch",
        studentTckn: "Batch",
        qrContent: normalizedQrContent,
        status: 0,
        ok: false,
        tokenPreview: "-",
        body: error.message,
      },
    ]);
    setApiResponse({
      message: error.message,
      note: "This app now expects a same-origin backend proxy at /api/attendance. On Vercel, make sure the API route is deployed with the frontend.",
    });
  } finally {
    requestInFlight = false;
  }
}

async function sendCurrentQr() {
  if (!detectedText) {
    setRequestState("No QR", "error");
    setApiResponse("Scan a QR code first.");
    return;
  }

  lastSubmissionSignature = "";
  await submitAttendance(detectedText);
}

function drawBoundingBox(location) {
  overlayContext.strokeStyle = "#74ff87";
  overlayContext.lineWidth = 4;
  overlayContext.beginPath();
  overlayContext.moveTo(location.topLeftCorner.x, location.topLeftCorner.y);
  overlayContext.lineTo(location.topRightCorner.x, location.topRightCorner.y);
  overlayContext.lineTo(location.bottomRightCorner.x, location.bottomRightCorner.y);
  overlayContext.lineTo(location.bottomLeftCorner.x, location.bottomLeftCorner.y);
  overlayContext.closePath();
  overlayContext.stroke();
}

function scanFrame() {
  if (!stream || video.readyState !== video.HAVE_ENOUGH_DATA) {
    animationFrameId = requestAnimationFrame(scanFrame);
    return;
  }

  if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
  }

  overlayContext.drawImage(video, 0, 0, overlay.width, overlay.height);
  const imageData = overlayContext.getImageData(0, 0, overlay.width, overlay.height);
  const qrCode = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: "dontInvert",
  });

  overlayContext.clearRect(0, 0, overlay.width, overlay.height);

  if (qrCode) {
    drawBoundingBox(qrCode.location);

    if (qrCode.data !== detectedText) {
      setResult(qrCode.data);
      submitAttendance(qrCode.data);
    }

    setStatus("QR detected");
  } else {
    setStatus("Scanning...");
  }

  animationFrameId = requestAnimationFrame(scanFrame);
}

async function startCamera() {
  if (stream) {
    return;
  }

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "Camera API unavailable. Open the HTTPS Vercel site in Safari and allow camera access."
      );
    }

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
      },
      audio: false,
    });

    video.srcObject = stream;
    await video.play();
    setupZoomControls(stream.getVideoTracks()[0]);

    startButton.disabled = true;
    stopButton.disabled = false;
    setStatus("Scanning...");
    animationFrameId = requestAnimationFrame(scanFrame);
  } catch (error) {
    setStatus("Camera access failed");
    setResult(`Unable to access camera: ${error.message}`);
  }
}

function stopCamera() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  if (stream) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }

  stream = null;
  resetZoomControls();
  video.srcObject = null;
  overlayContext.clearRect(0, 0, overlay.width, overlay.height);
  setStatus("Camera stopped");
  setRequestState("Idle", "idle");
  startButton.disabled = false;
  stopButton.disabled = true;
}

async function copyResult() {
  if (!detectedText) {
    return;
  }

  try {
    await navigator.clipboard.writeText(detectedText);
    setStatus("Decoded text copied");
  } catch (error) {
    setStatus(`Copy failed: ${error.message}`);
  }
}

addPairButton.addEventListener("click", () => addPair());
zoomRange.addEventListener("input", (event) => applyZoom(event.target.value));
startButton.addEventListener("click", startCamera);
stopButton.addEventListener("click", stopCamera);
copyButton.addEventListener("click", copyResult);
sendButton.addEventListener("click", sendCurrentQr);

addPair("99834848902", "");
resetZoomControls();
window.addEventListener("beforeunload", stopCamera);
