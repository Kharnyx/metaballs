// script.js

const canvasScaler = 0.75;
const canvas = document.getElementById("canvas");

function setCanvasSize() {
    canvas.width = Math.floor(window.innerWidth * canvasScaler);
    canvas.height = Math.floor(window.innerHeight * canvasScaler);
}
setCanvasSize();

// Default values configuration mapping
const DEFAULT_SETTINGS = {
    colorTheme: 'rgb',
    customColor: '#ffffff',
    metaballBaseRadius: 150,
    sharpness: 10,
    speedMultiplier: 1.0
};

let currentSettings = { ...DEFAULT_SETTINGS };

const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
const offscreen = canvas.transferControlToOffscreen();

function loadStoredSettings() {
    const raw = localStorage.getItem("metaball_project_settings");
    if (raw) {
        try {
            currentSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
        } catch (e) {
            currentSettings = { ...DEFAULT_SETTINGS };
        }
    }
    syncUiElements();
}

function saveAndPushSettings() {
    localStorage.setItem("metaball_project_settings", JSON.stringify(currentSettings));
    worker.postMessage({
        type: "settingsUpdate",
        settings: currentSettings
    });
}

function syncUiElements() {
    document.getElementById("colorTheme").value = currentSettings.colorTheme;
    document.getElementById("monoColorPicker").value = currentSettings.customColor;
    document.getElementById("baseRadius").value = currentSettings.metaballBaseRadius;
    document.getElementById("baseRadiusVal").textContent = currentSettings.metaballBaseRadius;
    document.getElementById("sharpness").value = currentSettings.sharpness;
    document.getElementById("sharpnessVal").textContent = currentSettings.sharpness;
    document.getElementById("speed").value = currentSettings.speedMultiplier;
    document.getElementById("speedVal").textContent = currentSettings.speedMultiplier.toFixed(1);

    // Toggle Color Picker Visibility
    const monoGroup = document.getElementById("monoColorGroup");
    monoGroup.style.display = currentSettings.colorTheme === 'white' ? 'block' : 'none';
}

loadStoredSettings();

worker.postMessage({
    type: "init",
    canvas: offscreen,
    width: canvas.width,
    height: canvas.height,
    initialSettings: currentSettings
}, [offscreen]);

// Toggle open settings overlay interaction behavior
const toggleBtn = document.getElementById("toggleSettingsBtn");
const panel = document.getElementById("controlsPanel");

toggleBtn.addEventListener("click", () => {
    panel.classList.toggle("hidden");
});

// Wire interactive configuration listeners
document.getElementById("colorTheme").addEventListener("change", (e) => {
    currentSettings.colorTheme = e.target.value;
    syncUiElements();
    saveAndPushSettings();
});

document.getElementById("monoColorPicker").addEventListener("input", (e) => {
    currentSettings.customColor = e.target.value;
    saveAndPushSettings();
});

document.getElementById("baseRadius").addEventListener("input", (e) => {
    const val = parseInt(e.target.value, 10);
    currentSettings.metaballBaseRadius = val;
    document.getElementById("baseRadiusVal").textContent = val;
    saveAndPushSettings();
});

document.getElementById("sharpness").addEventListener("input", (e) => {
    const val = parseInt(e.target.value, 10);
    currentSettings.sharpness = val;
    document.getElementById("sharpnessVal").textContent = val;
    saveAndPushSettings();
});

document.getElementById("speed").addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    currentSettings.speedMultiplier = val;
    document.getElementById("speedVal").textContent = val.toFixed(1);
    saveAndPushSettings();
});

document.getElementById("resetBtn").addEventListener("click", () => {
    currentSettings = { ...DEFAULT_SETTINGS };
    syncUiElements();
    saveAndPushSettings();
});

// Input throttling engine
let pendingMouse = { x: 0, y: 0, down: false, changed: false };
let rafPending = false;

function sendMouseIfPending() {
    if (!pendingMouse.changed) { rafPending = false; return; }
    worker.postMessage({
        type: "mouse",
        x: pendingMouse.x,
        y: pendingMouse.y,
        mouseDown: pendingMouse.down
    });
    pendingMouse.changed = false;
    rafPending = false;
}

function scheduleMouseSend() {
    if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(sendMouseIfPending);
    }
}

function getMousePos(evt) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (evt.clientX - rect.left) * (canvas.width / rect.width),
        y: (evt.clientY - rect.top) * (canvas.height / rect.height)
    };
}

canvas.addEventListener("mousemove", (e) => {
    const p = getMousePos(e);
    pendingMouse.x = p.x;
    pendingMouse.y = p.y;
    pendingMouse.changed = true;
    scheduleMouseSend();
});

canvas.addEventListener("pointerdown", (e) => {
    const p = getMousePos(e);
    pendingMouse.x = p.x;
    pendingMouse.y = p.y;
    pendingMouse.down = true;
    pendingMouse.changed = true;
    scheduleMouseSend();
});

window.addEventListener("pointerup", (e) => {
    pendingMouse.down = false;
    pendingMouse.changed = true;
    scheduleMouseSend();
});

window.addEventListener("resize", () => {
    worker.postMessage({
        type: "resize",
        width: window.innerWidth * canvasScaler,
        height: window.innerHeight * canvasScaler
    });
});
