(() => {
  "use strict";

  const video = document.getElementById("video");
  const overlay = document.getElementById("overlay");
  const ctx = overlay.getContext("2d");
  const camStage = document.getElementById("camStage");
  const placeholder = document.getElementById("camPlaceholder");
  const startBtn = document.getElementById("startBtn");
  const statusPill = document.getElementById("statusPill");
  const statusText = document.getElementById("statusText");
  const fpsLabel = document.getElementById("fpsLabel");
  const alertFlash = document.getElementById("alertFlash");

  const metricAngle = document.getElementById("metricAngle");
  const metricVel = document.getElementById("metricVel");
  const metricPosture = document.getElementById("metricPosture");

  const sensSlider = document.getElementById("sensSlider");
  const sensVal = document.getElementById("sensVal");
  const stillSlider = document.getElementById("stillSlider");
  const stillVal = document.getElementById("stillVal");

  const soundToggle = document.getElementById("soundToggle");
  const recordToggle = document.getElementById("recordToggle");
  const simulateBtn = document.getElementById("simulateBtn");
  const clearLogBtn = document.getElementById("clearLogBtn");

  const trailCanvas = document.getElementById("trailCanvas");
  const trailCtx = trailCanvas.getContext("2d");

  const logList = document.getElementById("logList");
  const logCount = document.getElementById("logCount");

  const trail = [];
  const TRAIL_MAX = 200;
  const VEL_WINDOW = 5;
  let poseHistory = [];
  let running = false;
  let lastFrameTime = 0;
  let fpsSmooth = 0;
  let events = [];
  let cooldownUntil = 0;
  let mediaRecorder = null;
  let recordedChunks = [];

  function resizeOverlay() {
    overlay.width = camStage.clientWidth;
    overlay.height = camStage.clientHeight;
    trailCanvas.width = trailCanvas.clientWidth * devicePixelRatio;
    trailCanvas.height = trailCanvas.clientHeight * devicePixelRatio;
    trailCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  window.addEventListener("resize", resizeOverlay);
  resizeOverlay();

  function setStatus(txt, alert) {
    statusText.textContent = txt;
    statusPill.classList.toggle("alert", !!alert);
  }

  sensSlider.addEventListener("input", () => {
    sensVal.textContent = parseFloat(sensSlider.value).toFixed(2);
  });
  stillSlider.addEventListener("input", () => {
    stillVal.textContent = parseFloat(stillSlider.value).toFixed(1);
  });

  function toggleSwitch(el) {
    el.classList.toggle("on");
    return el.classList.contains("on");
  }
  soundToggle.addEventListener("click", () => toggleSwitch(soundToggle));
  recordToggle.addEventListener("click", () => toggleSwitch(recordToggle));

  function playAlarm() {
    if (!soundToggle.classList.contains("on")) return;
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ac.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ac.currentTime + 0.4);
      gain.gain.setValueAtTime(0.5, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.8);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + 0.8);
    } catch (e) {}
  }

  function triggerAlert(reason) {
    const now = Date.now();
    if (now < cooldownUntil) return;
    cooldownUntil = now + 6000;

    playAlarm();
    alertFlash.classList.add("show");
    setTimeout(() => alertFlash.classList.remove("show"), 1600);
    setStatus("FALL DETECTED", true);

    const clipBlob = stopRecording();
    const evt = {
      time: new Date(),
      reason,
      clip: clipBlob || null,
    };
    events.unshift(evt);
    renderLog();

    setTimeout(() => {
      if (running) setStatus("monitoring", false);
    }, 3000);
  }

  function startRecording() {
    if (!recordToggle.classList.contains("on")) return;
    try {
      const stream = video.captureStream ? video.captureStream() : null;
      if (!stream) return;
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data);
      };
      mediaRecorder.start();
    } catch (e) {
      mediaRecorder = null;
    }
  }

  function stopRecording() {
    if (!mediaRecorder || mediaRecorder.state === "inactive") return null;
    return new Promise((res) => {
      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: "video/webm" });
        recordedChunks = [];
        mediaRecorder = null;
        res(blob);
      };
      try {
        mediaRecorder.stop();
      } catch (e) {
        recordedChunks = [];
        mediaRecorder = null;
        res(null);
      }
    });
  }

  function renderLog() {
    logCount.textContent = events.length + " event" + (events.length !== 1 ? "s" : "");
    if (events.length === 0) {
      logList.innerHTML =
        '<div class="log-empty">No incidents recorded yet.<br>This log only exists in your browser tab and clears on refresh.</div>';
      return;
    }
    logList.innerHTML = "";
    events.forEach((ev, i) => {
      const div = document.createElement("div");
      div.className = "log-item";
      const t = ev.time;
      const ts =
        t.getFullYear() +
        "-" +
        String(t.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(t.getDate()).padStart(2, "0") +
        " " +
        String(t.getHours()).padStart(2, "0") +
        ":" +
        String(t.getMinutes()).padStart(2, "0") +
        ":" +
        String(t.getSeconds()).padStart(2, "0");
      let html = '<span class="tag">FALL</span>';
      html += '<div class="lt"><b>' + ts + "</b><span>#" + (events.length - i) + "</span></div>";
      html += '<div class="desc">' + ev.reason + "</div>";
      if (ev.clip) {
        const url = URL.createObjectURL(ev.clip);
        html += '<video controls preload="metadata" src="' + url + '"></video>';
      }
      div.innerHTML = html;
      logList.appendChild(div);
    });
  }

  clearLogBtn.addEventListener("click", () => {
    events = [];
    renderLog();
  });

  function drawTrail() {
    const w = trailCanvas.clientWidth;
    const h = trailCanvas.clientHeight;
    trailCtx.clearRect(0, 0, w, h);

    if (trail.length < 2) return;

    trailCtx.beginPath();
    trailCtx.strokeStyle = "#e8a23c";
    trailCtx.lineWidth = 2;
    trailCtx.lineJoin = "round";

    for (let i = 0; i < trail.length; i++) {
      const x = (i / TRAIL_MAX) * w;
      const y = trail[i] * h;
      if (i === 0) trailCtx.moveTo(x, y);
      else trailCtx.lineTo(x, y);
    }
    trailCtx.stroke();

    const last = trail[trail.length - 1];
    const lastX = ((trail.length - 1) / TRAIL_MAX) * w;
    trailCtx.beginPath();
    trailCtx.arc(lastX, last * h, 4, 0, Math.PI * 2);
    trailCtx.fillStyle = "#e8a23c";
    trailCtx.fill();
  }

  function processPose(landmarks) {
    if (!landmarks || landmarks.length < 33) return;

    const now = Date.now();

    const leftHip = landmarks[23];
    const rightHip = landmarks[24];
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    const leftKnee = landmarks[25];
    const rightKnee = landmarks[26];

    const hipMid = {
      x: (leftHip.x + rightHip.x) / 2,
      y: (leftHip.y + rightHip.y) / 2,
      z: (leftHip.z + rightHip.z) / 2,
    };

    const shoulderMid = {
      x: (leftShoulder.x + rightShoulder.x) / 2,
      y: (leftShoulder.y + rightShoulder.y) / 2,
    };

    const torsoDy = shoulderMid.y - hipMid.y;
    const torsoDx = shoulderMid.x - hipMid.x;
    const torsoAngle = Math.atan2(torsoDy, torsoDx) * (180 / Math.PI);
    const torsoAngleAbs = Math.abs(90 - Math.abs(torsoAngle));

    const kneeMid = {
      y: (leftKnee.y + rightKnee.y) / 2,
    };

    const legDy = kneeMid.y - hipMid.y;
    const bodyTilt = Math.abs(torsoAngle) > 50;

    const posture = torsoAngleAbs < 25 ? "upright" : torsoAngleAbs < 50 ? "tilted" : "horizontal";
    metricAngle.textContent = torsoAngleAbs.toFixed(1) + "°";
    metricPosture.textContent = posture;

    poseHistory.push({
      y: hipMid.y,
      t: now,
    });

    const windowMs = VEL_WINDOW * 33;
    while (poseHistory.length > 0 && now - poseHistory[0].t > windowMs) {
      poseHistory.shift();
    }

    let velY = 0;
    if (poseHistory.length >= 2) {
      const oldest = poseHistory[0];
      const newest = poseHistory[poseHistory.length - 1];
      const dt = (newest.t - oldest.t) / 1000;
      if (dt > 0.001) {
        velY = (newest.y - oldest.y) / dt;
      }
    }

    const velDisplay = (velY * 10).toFixed(2);
    metricVel.textContent = velDisplay;

    trail.push(hipMid.y);
    if (trail.length > TRAIL_MAX) trail.shift();
    drawTrail();

    const threshold = parseFloat(sensSlider.value);
    const stillWindow = parseFloat(stillSlider.value) * 1000;

    const dropSpeed = -velY;

    if (dropSpeed > threshold && now > cooldownUntil) {
      let stableCount = 0;
      const checkWindow = Math.floor(stillWindow / 33);
      const recent = poseHistory.slice(-checkWindow);
      if (recent.length >= 2) {
        const minY = Math.min(...recent.map((p) => p.y));
        const maxY = Math.max(...recent.map((p) => p.y));
        const range = maxY - minY;
        if (range < 0.08) stableCount = recent.length;
      }

      if (stableCount >= Math.floor(checkWindow * 0.6) && bodyTilt) {
        triggerAlert(
          "Vertical velocity " +
            dropSpeed.toFixed(2) +
            " exceeded threshold " +
            threshold.toFixed(2) +
            "; body horizontal and still after drop."
        );
        poseHistory = [];
      }
    }
  }

  function drawSkeleton(landmarks) {
    if (!landmarks) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const connections = [
      [11, 12],
      [11, 13],
      [13, 15],
      [12, 14],
      [14, 16],
      [11, 23],
      [12, 24],
      [23, 24],
      [23, 25],
      [24, 26],
      [25, 27],
      [26, 28],
      [27, 29],
      [28, 30],
      [29, 31],
      [30, 32],
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 7],
      [0, 4],
      [4, 5],
      [5, 6],
      [6, 8],
      [9, 10],
    ];

    ctx.strokeStyle = "rgba(232,162,60,0.6)";
    ctx.lineWidth = 2;
    connections.forEach(([a, b]) => {
      const pa = landmarks[a];
      const pb = landmarks[b];
      ctx.beginPath();
      ctx.moveTo(pa.x * overlay.width, pa.y * overlay.height);
      ctx.lineTo(pb.x * overlay.width, pb.y * overlay.height);
      ctx.stroke();
    });

    landmarks.forEach((lm, i) => {
      const x = lm.x * overlay.width;
      const y = lm.y * overlay.height;
      const r = [23, 24, 11, 12, 0].includes(i) ? 5 : 3;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = [23, 24].includes(i) ? "#d64545" : "#e8a23c";
      ctx.fill();
    });

    const hip = {
      x: ((landmarks[23].x + landmarks[24].x) / 2) * overlay.width,
      y: ((landmarks[23].y + landmarks[24].y) / 2) * overlay.height,
    };
    ctx.beginPath();
    ctx.arc(hip.x, hip.y, 6, 0, Math.PI * 2);
    ctx.strokeStyle = "#e8a23c";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  async function initPose() {
    const pose = new Pose({
      locateFile: (file) => {
        return "https://cdn.jsdelivr.net/npm/@mediapipe/pose/" + file;
      },
    });

    pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      enableSegmentation: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    pose.onResults((results) => {
      const now = performance.now();
      const delta = now - lastFrameTime;
      lastFrameTime = now;
      if (delta > 0) {
        fpsSmooth = fpsSmooth * 0.9 + (1000 / delta) * 0.1;
      }
      fpsLabel.textContent = Math.round(fpsSmooth) + " fps";

      if (results.poseLandmarks) {
        drawSkeleton(results.poseLandmarks);
        processPose(results.poseLandmarks);
      } else {
        ctx.clearRect(0, 0, overlay.width, overlay.height);
      }
    });

    return pose;
  }

  let poseInstance = null;
  let cameraInstance = null;

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();

      placeholder.style.display = "none";
      resizeOverlay();
      setStatus("loading model…", false);

      poseInstance = await initPose();

      cameraInstance = new Camera(video, {
        onFrame: async () => {
          await poseInstance.send({ image: video });
        },
        width: 640,
        height: 480,
      });

      await cameraInstance.start();
      running = true;
      setStatus("monitoring", false);
      startRecording();
    } catch (err) {
      console.error("Camera init failed:", err);
      setStatus("camera error", true);
      placeholder.innerHTML =
        'Could not access camera.<br>Please allow camera permission and reload.<br><small style="color:#666b75">' +
        err.message +
        "</small>";
    }
  }

  startBtn.addEventListener("click", startCamera);

  simulateBtn.addEventListener("click", () => {
    triggerAlert("Simulated fall triggered by user.");
    poseHistory = [];
  });
})();
