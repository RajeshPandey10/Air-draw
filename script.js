// App Class - Main Application Controller
class App {
  constructor() {
    this.cameraManager = new CameraManager(this);
    this.drawingManager = new DrawingManager(this);
    this.textManager = new TextManager(this);
    this.exportManager = new ExportManager(this);
    this.uiManager = new UIManager(this);

    this.statusEl = document.getElementById("status");
    this.previewBox = document.getElementById("previewBox");
    this.previewLabel = document.getElementById("previewLabel");

    this.init();
  }

  init() {
    // Initialize components
    this.cameraManager.init();
    this.drawingManager.init();
    this.textManager.init();
    this.exportManager.init();
    this.uiManager.init();

    // Initial status update
    this.updateStatus("Initializing...");
  }

  updateStatus(message) {
    this.statusEl.textContent = message;
  }

  showNotification(message, type = "info") {
    const notification = document.getElementById("notification");
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.classList.add("show");

    setTimeout(() => {
      notification.classList.remove("show");
    }, 3000);
  }
}

// Camera Manager Class
class CameraManager {
  constructor(app) {
    this.app = app;
    this.video = document.getElementById("video");
    this.retryCamBtn = document.getElementById("retryCam");
    this.uploadFile = document.getElementById("uploadFile");
    this.useBoardBtn = document.getElementById("useBoard");
    this.fallbackMsg = document.getElementById("fallbackMsg");

    this.isCameraActive = false;
    this.camera = null;
    this.stream = null;
  }

  async init() {
    // Event listeners
    this.retryCamBtn.addEventListener("click", () => this.startCamera());
    this.uploadFile.addEventListener("change", (e) => this.handleUpload(e));
    this.useBoardBtn.addEventListener("click", () => this.useDrawingBoard());

    // Start camera
    await this.startCamera();
  }

  async startCamera() {
    try {
      if (this.camera) {
        await this.camera.stop();
        this.camera = null;
      }

      this.app.updateStatus("Requesting camera access...");
      this.camera = new Camera(this.video, {
        onFrame: async () => {
          await this.app.drawingManager.hands.send({ image: this.video });
        },
        width: 1280,
        height: 720,
      });

      await this.camera.start();
      this.isCameraActive = true;
      this.app.updateStatus("Camera active — Ready to draw");
      this.hideFallbackMessage();

      // Apply mirror effect based on checkbox
      const mirrorCheckbox = document.getElementById("mirror");
      this.updateMirrorEffect(mirrorCheckbox.checked);

      mirrorCheckbox.addEventListener("change", (e) => {
        this.updateMirrorEffect(e.target.checked);
      });
    } catch (error) {
      this.handleCameraError(error);
    }
  }

  updateMirrorEffect(isMirrored) {
    // Update the visual mirroring
    this.video.style.transform = isMirrored ? "scaleX(-1)" : "none";

    // Update the drawing manager's mirror setting
    // This ensures the drawing coordinates are consistent with the visual display
    this.app.drawingManager.setMirror(isMirrored);
  }

  handleCameraError(error) {
    this.isCameraActive = false;
    this.app.updateStatus("Camera error: " + error.message);
    this.showFallbackMessage();

    // Hide video element
    this.video.style.display = "none";

    // Show detailed error message
    this.fallbackMsg.innerHTML = `
      <strong>Camera access denied:</strong> ${error.message}<br>
      Please ensure:
      <ul style="list-style-type:disc;padding-left:20px;margin:8px 0;">
        <li>You're running from a secure origin (HTTPS or localhost)</li>
        <li>Your browser supports WebRTC</li>
        <li>You've granted camera permissions</li>
      </ul>
      <strong>Alternative options:</strong>
      <ul style="list-style-type:disc;padding-left:20px;margin:8px 0;">
        <li>Use the "Upload File" option</li>
        <li>Use the "Drawing Board" option</li>
      </ul>
    `;
  }

  showFallbackMessage() {
    this.fallbackMsg.style.display = "block";
  }

  hideFallbackMessage() {
    this.fallbackMsg.style.display = "none";
  }

  handleUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const url = URL.createObjectURL(file);

    if (file.type.startsWith("image/")) {
      this.video.src = url;
      this.video.play();
      this.isCameraActive = false;
      this.app.updateStatus("Using uploaded image as background");
    } else if (file.type.startsWith("video/")) {
      this.video.src = url;
      this.video.play();
      this.isCameraActive = false;
      this.app.updateStatus("Using uploaded video");
    }

    // Show video element
    this.video.style.display = "block";
  }

  useDrawingBoard() {
    this.isCameraActive = false;
    this.video.style.display = "none";
    this.app.updateStatus("Drawing board active");
  }
}

// Enhanced Drawing Manager Class with proper mirror handling
class DrawingManager {
  constructor(app) {
    this.app = app;
    this.canvas = document.getElementById("draw");
    this.overlay = document.getElementById("overlay");
    this.ctx = this.canvas.getContext("2d");
    this.overlayCtx = this.overlay.getContext("2d");

    this.undoBtn = document.getElementById("undo");
    this.clearBtn = document.getElementById("clear");
    this.mouseDrawChk = document.getElementById("mouseDraw");
    this.sizeSlider = document.getElementById("size");
    this.colorPicker = document.getElementById("color");

    // Drawing state
    this.lastPoint = null;
    this.drawing = false;
    this.undoStack = [];
    this.hands = null;

    // Smooth drawing parameters
    this.smoothingFactor = 0.3;
    this.points = [];
    this.velocityFactor = 0.8;
    this.lastVelocity = 0;

    // Hand tracking optimization
    this.handSmoothing = [];
    this.smoothingWindowSize = 5;

    // Drawing settings
    this.currentColor = "#5eead4";
    this.currentSize = 6;

    // Mirror setting (default to false)
    this.isMirrored = false;
  }

  init() {
    // Set up canvas sizes
    this.resizeCanvases();
    window.addEventListener("resize", () => this.resizeCanvases());

    // Initialize MediaPipe Hands
    this.setupHands();

    // Event listeners
    this.undoBtn.addEventListener("click", () => this.undo());
    this.clearBtn.addEventListener("click", () => this.clear());

    // Size and color controls
    this.sizeSlider.addEventListener("input", (e) => {
      this.currentSize = parseInt(e.target.value);
    });

    this.colorPicker.addEventListener("input", (e) => {
      this.currentColor = e.target.value;
    });

    // Mouse/touch drawing with improved handling
    this.overlay.addEventListener("pointerdown", (e) =>
      this.handlePointerDown(e)
    );
    this.overlay.addEventListener("pointermove", (e) =>
      this.handlePointerMove(e)
    );
    this.overlay.addEventListener("pointerup", () => this.handlePointerUp());
    this.overlay.addEventListener("pointercancel", () =>
      this.handlePointerUp()
    );
    this.overlay.addEventListener("pointerleave", () => this.handlePointerUp());

    // Prevent context menu on canvas
    this.overlay.addEventListener("contextmenu", (e) => e.preventDefault());

    // Enable anti-aliasing
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";
  }

  setMirror(isMirrored) {
    this.isMirrored = isMirrored;
  }

  resizeCanvases() {
    const rect = document.getElementById("stage").getBoundingClientRect();
    const { width, height } = rect;

    // Save current canvas content
    const imageData = this.ctx.getImageData(
      0,
      0,
      this.canvas.width,
      this.canvas.height
    );

    [this.canvas, this.overlay].forEach((canvas) => {
      canvas.width = width;
      canvas.height = height;
    });

    // Restore canvas content
    this.ctx.putImageData(imageData, 0, 0);
  }

  setupHands() {
    this.hands = new Hands({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    this.hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.7,
      selfieMode: true,
    });

    this.hands.onResults((results) => this.onResults(results));
  }

  onResults(results) {
    // Clear overlay
    this.overlayCtx.clearRect(0, 0, this.overlay.width, this.overlay.height);

    // Process hand landmarks
    const handsLms = results.multiHandLandmarks || [];
    for (const landmarks of handsLms) {
      // Draw connections and landmarks
      drawConnectors(this.overlayCtx, landmarks, HAND_CONNECTIONS, {
        color: "#9fb4ff",
        lineWidth: 2,
      });
      drawLandmarks(this.overlayCtx, landmarks, {
        color: "#ffd06e",
        lineWidth: 1,
        radius: 3,
      });

      // Get thumb and index tips for pinch detection
      const thumbTip = landmarks[4];
      const indexTip = landmarks[8];

      // Calculate pinch distance
      const pinchDistance = Math.hypot(
        thumbTip.x - indexTip.x,
        thumbTip.y - indexTip.y
      );

      // Dynamic threshold based on hand size
      const wristToIndex = Math.hypot(
        landmarks[0].x - indexTip.x,
        landmarks[0].y - indexTip.y
      );
      const threshold = wristToIndex * 0.15; // 15% of hand size

      // Map index tip to canvas coordinates with smoothing
      let xNorm = document.getElementById("mirror").checked
        ? 1 - indexTip.x
        : indexTip.x;
      if (this.isMirrored) {
        xNorm = 1 - xNorm;
      }
      const rawPoint = {
        x: xNorm * this.canvas.width,
        y: indexTip.y * this.canvas.height,
      };
      // Apply smoothing
      const point = this.smoothPoint(rawPoint);
      // Draw cursor with dynamic size based on pinch
      const cursorSize = pinchDistance < threshold ? 4 : 8;
      this.overlayCtx.beginPath();
      this.overlayCtx.arc(point.x, point.y, cursorSize, 0, Math.PI * 2);
      this.overlayCtx.fillStyle =
        pinchDistance < threshold
          ? "rgba(255, 100, 100, 0.9)"
          : "rgba(95, 234, 212, 0.9)";
      this.overlayCtx.fill();

      // Pinch detection for drawing
      if (pinchDistance < threshold) {
        // Start drawing if not already
        if (!this.drawing) {
          this.drawing = true;
          this.lastPoint = point;
          this.points = [point];
          this.undoStack.push(
            this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height)
          );
        } else {
          // Draw line from last point to current
          this.drawLine(
            this.lastPoint,
            point,
            this.currentColor,
            this.currentSize
          );
          this.lastPoint = point;
          this.points.push(point);
        }
      } else {
        // Stop drawing
        this.drawing = false;
        this.lastPoint = null;
        this.points = [];
      }
    }
  }

  // Smoothing function for hand points
  smoothPoint(rawPoint) {
    this.handSmoothing.push(rawPoint);
    if (this.handSmoothing.length > this.smoothingWindowSize) {
      this.handSmoothing.shift();
    }
    const avg = this.handSmoothing.reduce(
      (acc, pt) => {
        acc.x += pt.x;
        acc.y += pt.y;
        return acc;
      },
      { x: 0, y: 0 }
    );
    avg.x /= this.handSmoothing.length;
    avg.y /= this.handSmoothing.length;
    return avg;
  }

  // Draw a line on the main canvas
  drawLine(from, to, color, size) {
    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = size;
    this.ctx.lineCap = "round";
    this.ctx.beginPath();
    this.ctx.moveTo(from.x, from.y);
    this.ctx.lineTo(to.x, to.y);
    this.ctx.stroke();
    this.ctx.restore();
  }

  // Undo last drawing action
  undo() {
    if (this.undoStack.length > 0) {
      const imageData = this.undoStack.pop();
      this.ctx.putImageData(imageData, 0, 0);
    }
  }

  // Clear the canvas
  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.undoStack = [];
  }
}

// Text Manager Class
class TextManager {
  constructor(app) {
    this.app = app;
    this.canvas = document.getElementById("textLayer");
    this.ctx = this.canvas.getContext("2d");

    this.textInput = document.getElementById("textInput");
    this.textColor = document.getElementById("textColor");
    this.fontSize = document.getElementById("fontSize");
    this.addTextBtn = document.getElementById("addText");
    this.addNoteBtn = document.getElementById("addNote");
    this.notesList = document.getElementById("notesList");

    this.items = [];
    this.selectedItem = null;
    this.draggingItem = null;
    this.dragOffset = { x: 0, y: 0 };
  }

  init() {
    // Set up canvas sizes
    this.resizeCanvas();
    window.addEventListener("resize", () => this.resizeCanvas());

    // Event listeners
    this.addTextBtn.addEventListener("click", () => {
      const text = this.textInput.value.trim();
      if (text) {
        this.addItem("text", text);
        this.textInput.value = "";
      }
    });

    this.addNoteBtn.addEventListener("click", () => {
      const text = this.textInput.value.trim();
      if (text) {
        this.addItem("note", text);
        this.textInput.value = "";
      }
    });

    // Canvas interaction events
    this.canvas.addEventListener("pointerdown", (e) =>
      this.handleCanvasPointerDown(e)
    );
    this.canvas.addEventListener("pointermove", (e) =>
      this.handleCanvasPointerMove(e)
    );
    this.canvas.addEventListener("pointerup", () =>
      this.handleCanvasPointerUp()
    );
    this.canvas.addEventListener("pointercancel", () =>
      this.handleCanvasPointerUp()
    );
    this.canvas.addEventListener("dblclick", (e) =>
      this.handleCanvasDoubleClick(e)
    );

    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      if (this.selectedItem && e.key === "Delete") {
        this.deleteItem(this.selectedItem);
      }
    });
  }

  resizeCanvas() {
    const rect = document.getElementById("stage").getBoundingClientRect();
    const { width, height } = rect;
    this.canvas.width = width;
    this.canvas.height = height;
    this.renderItems();
  }

  addItem(type, text = "", x = null, y = null) {
    const id = Date.now() + Math.random().toString(36).slice(2, 7);
    const size = Number(this.fontSize.value) || 36;
    const color = this.textColor.value || "#fff";
    const pos = {
      x: x ?? this.canvas.width / 2 - 40,
      y: y ?? this.canvas.height / 2,
    };

    const item = {
      id,
      type,
      text,
      color,
      size,
      x: pos.x,
      y: pos.y,
      w: 0,
      h: 0,
    };

    this.items.push(item);
    this.renderItems();
    this.refreshNotesList();
    this.app.showNotification(
      `${type === "note" ? "Note" : "Text"} added`,
      "success"
    );
    return item;
  }

  deleteItem(item) {
    const index = this.items.findIndex((i) => i.id === item.id);
    if (index !== -1) {
      this.items.splice(index, 1);
      this.selectedItem = null;
      this.renderItems();
      this.refreshNotesList();
      this.app.showNotification("Item deleted", "info");
    }
  }

  renderItems() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.textBaseline = "top";

    // Enable anti-aliasing
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";

    for (const item of this.items) {
      if (item.type === "note") {
        // Draw sticky note rectangle
        const padding = 12;
        this.ctx.font = `${item.size}px sans-serif`;
        const metrics = this.ctx.measureText(item.text);
        const w = Math.min(this.canvas.width - 20, metrics.width + padding * 2);
        const h = item.size + padding * 2 + 4;
        item.w = w;
        item.h = h;

        // Note shadow
        this.ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
        this.ctx.shadowBlur = 4;
        this.ctx.shadowOffsetX = 2;
        this.ctx.shadowOffsetY = 2;

        // Note background with gradient
        const gradient = this.ctx.createLinearGradient(
          item.x - padding,
          item.y - padding,
          item.x - padding,
          item.y - padding + h
        );
        gradient.addColorStop(0, "rgba(255, 240, 150, 0.95)");
        gradient.addColorStop(1, "rgba(255, 220, 100, 0.95)");

        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(item.x - padding, item.y - padding, w, h);

        // Reset shadow
        this.ctx.shadowColor = "transparent";
        this.ctx.shadowBlur = 0;

        // Note text
        this.ctx.fillStyle = "#333";
        this.ctx.fillText(item.text, item.x, item.y);
      } else {
        this.ctx.font = `${item.size}px sans-serif`;
        const metrics = this.ctx.measureText(item.text);
        const w = metrics.width;
        const h = item.size;
        item.w = w;
        item.h = h;

        // Text shadow for better visibility
        this.ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
        this.ctx.shadowBlur = 3;
        this.ctx.shadowOffsetX = 1;
        this.ctx.shadowOffsetY = 1;

        this.ctx.fillStyle = item.color;
        this.ctx.fillText(item.text, item.x, item.y);

        // Reset shadow
        this.ctx.shadowColor = "transparent";
        this.ctx.shadowBlur = 0;
      }

      // Draw outline when selected
      if (this.selectedItem && this.selectedItem.id === item.id) {
        this.ctx.strokeStyle = "rgba(100, 200, 255, 0.8)";
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([5, 5]);
        this.ctx.strokeRect(item.x - 6, item.y - 6, item.w + 12, item.h + 12);
        this.ctx.setLineDash([]);
      }
    }
  }

  refreshNotesList() {
    this.notesList.innerHTML = "";
    this.items.forEach((item) => {
      const el = document.createElement("div");
      el.className = "note-item";
      el.innerHTML = `
        <span>${item.type.toUpperCase()}: ${item.text.substring(0, 20)}${
        item.text.length > 20 ? "..." : ""
      }</span>
        <button onclick="app.textManager.deleteItem(app.textManager.items.find(i => i.id === '${
          item.id
        }'))" style="margin-left: auto; padding: 2px 6px; font-size: 12px;">×</button>
      `;
      el.addEventListener("click", (e) => {
        if (e.target.tagName !== "BUTTON") {
          this.selectedItem = item;
          this.renderItems();
        }
      });
      this.notesList.appendChild(el);
    });
  }

  handleCanvasPointerDown(e) {
    const pos = this.getEventPos(e);

    // Check if clicking a text item
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      const padding = item.type === "note" ? 12 : 6;
      if (
        pos.x >= item.x - padding &&
        pos.x <= item.x + item.w + padding &&
        pos.y >= item.y - padding &&
        pos.y <= item.y + item.h + padding
      ) {
        this.draggingItem = item;
        this.dragOffset.x = pos.x - item.x;
        this.dragOffset.y = pos.y - item.y;
        this.selectedItem = item;
        this.renderItems();
        e.stopPropagation();
        return;
      }
    }

    this.selectedItem = null;
    this.renderItems();
  }

  handleCanvasPointerMove(e) {
    if (!this.draggingItem) return;

    const pos = this.getEventPos(e);
    this.draggingItem.x = pos.x - this.dragOffset.x;
    this.draggingItem.y = pos.y - this.dragOffset.y;

    // Keep within bounds
    this.draggingItem.x = Math.max(
      0,
      Math.min(this.canvas.width - this.draggingItem.w, this.draggingItem.x)
    );
    this.draggingItem.y = Math.max(
      0,
      Math.min(this.canvas.height - this.draggingItem.h, this.draggingItem.y)
    );

    this.renderItems();
  }

  handleCanvasPointerUp() {
    this.draggingItem = null;
  }

  handleCanvasDoubleClick(e) {
    const pos = this.getEventPos(e);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      const padding = item.type === "note" ? 12 : 6;
      if (
        pos.x >= item.x - padding &&
        pos.x <= item.x + item.w + padding &&
        pos.y >= item.y - padding &&
        pos.y <= item.y + item.h + padding
      ) {
        const newText = prompt("Edit text:", item.text);
        if (newText !== null && newText.trim()) {
          item.text = newText.trim();
          this.renderItems();
          this.refreshNotesList();
          this.app.showNotification("Text updated", "success");
        }
        return;
      }
    }
  }

  getEventPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (this.canvas.width / rect.width),
      y: (e.clientY - rect.top) * (this.canvas.height / rect.height),
    };
  }
}

// Export Manager Class
class ExportManager {
  constructor(app) {
    this.app = app;
    this.canvas = document.getElementById("draw");
    this.textCanvas = document.getElementById("textLayer");
    this.video = document.getElementById("video");

    this.exportBtn = document.getElementById("exportPNG");
    this.copyBtn = document.getElementById("copyClipboard");

    this.previewBox = document.getElementById("previewBox");
    this.previewLabel = document.getElementById("previewLabel");
  }

  init() {
    this.exportBtn.addEventListener("click", () => this.exportImage());
    this.copyBtn.addEventListener("click", () => this.copyToClipboard());
  }

  async exportImage() {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    const tctx = tmp.getContext("2d");

    // Enable anti-aliasing
    tctx.imageSmoothingEnabled = true;
    tctx.imageSmoothingQuality = "high";

    // Background layer
    if (
      this.app.cameraManager.isCameraActive ||
      (this.video && !this.video.paused && this.video.readyState >= 2)
    ) {
      if (document.getElementById("mirror").checked) {
        tctx.save();
        tctx.translate(w, 0);
        tctx.scale(-1, 1);
        tctx.drawImage(this.video, 0, 0, w, h);
        tctx.restore();
      } else {
        tctx.drawImage(this.video, 0, 0, w, h);
      }
    } else if (this.video && this.video.src) {
      try {
        tctx.drawImage(this.video, 0, 0, w, h);
      } catch (e) {
        tctx.fillStyle = "#1a1a1a";
        tctx.fillRect(0, 0, w, h);
      }
    } else {
      // Gradient background for drawing board
      const gradient = tctx.createLinearGradient(0, 0, w, h);
      gradient.addColorStop(0, "#1a1a1a");
      gradient.addColorStop(1, "#2d2d2d");
      tctx.fillStyle = gradient;
      tctx.fillRect(0, 0, w, h);
    }

    // Draw layers
    tctx.drawImage(this.canvas, 0, 0);
    tctx.drawImage(this.textCanvas, 0, 0);

    const dataURL = tmp.toDataURL("image/png", 1.0);

    // Update preview
    const img = new Image();
    img.onload = () => {
      this.previewBox.innerHTML = "";
      this.previewBox.appendChild(img);
      this.previewLabel.style.display = "none";
    };
    img.src = dataURL;
    img.style.width = "100%";
    img.style.height = "auto";

    // Download
    const a = document.createElement("a");
    a.href = dataURL;
    a.download = `AirDraw-${
      new Date().toISOString().split("T")[0]
    }-${Date.now()}.png`;
    a.click();

    this.app.showNotification("Image exported successfully", "success");
  }

  async copyToClipboard() {
    try {
      const w = this.canvas.width;
      const h = this.canvas.height;
      const tmp = document.createElement("canvas");
      tmp.width = w;
      tmp.height = h;
      const tctx = tmp.getContext("2d");

      // Enable anti-aliasing
      tctx.imageSmoothingEnabled = true;
      tctx.imageSmoothingQuality = "high";

      // Background layer
      if (
        this.app.cameraManager.isCameraActive ||
        (this.video && !this.video.paused && this.video.readyState >= 2)
      ) {
        if (document.getElementById("mirror").checked) {
          tctx.save();
          tctx.translate(w, 0);
          tctx.scale(-1, 1);
          tctx.drawImage(this.video, 0, 0, w, h);
          tctx.restore();
        } else {
          tctx.drawImage(this.video, 0, 0, w, h);
        }
      } else if (this.video && this.video.src) {
        try {
          tctx.drawImage(this.video, 0, 0, w, h);
        } catch (e) {
          tctx.fillStyle = "#1a1a1a";
          tctx.fillRect(0, 0, w, h);
        }
      } else {
        // Gradient background for drawing board
        const gradient = tctx.createLinearGradient(0, 0, w, h);
        gradient.addColorStop(0, "#1a1a1a");
        gradient.addColorStop(1, "#2d2d2d");
        tctx.fillStyle = gradient;
        tctx.fillRect(0, 0, w, h);
      }

      // Draw layers
      tctx.drawImage(this.canvas, 0, 0);
      tctx.drawImage(this.textCanvas, 0, 0);

      const blob = await new Promise((resolve) =>
        tmp.toBlob(resolve, "image/png", 1.0)
      );
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      this.app.showNotification("Copied to clipboard!", "success");
    } catch (err) {
      this.app.showNotification(
        "Copy failed: " + (err && err.message ? err.message : err),
        "error"
      );
    }
  }
}

// UI Manager Class
class UIManager {
  constructor(app) {
    this.app = app;
    this.notification = document.getElementById("notification");
  }

  init() {
    // Add keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      // Ctrl/Cmd + Z for undo
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        this.app.drawingManager.undo();
      }

      // Ctrl/Cmd + S for export
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        this.app.exportManager.exportImage();
      }

      // Ctrl/Cmd + C for copy
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key === "c" &&
        !window.getSelection().toString()
      ) {
        e.preventDefault();
        this.app.exportManager.copyToClipboard();
      }
    });

    // Add loading spinner control
    const spinner = document.getElementById("brushSpinner");
    if (spinner) {
      spinner.style.display = "none";
    }
  }

  showNotification(message, type = "info") {
    this.app.showNotification(message, type);
  }
}

// Initialize the application
let app;
document.addEventListener("DOMContentLoaded", () => {
  app = new App();

  // Make app globally accessible for debugging
  window.app = app;
});
