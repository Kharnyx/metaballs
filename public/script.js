// script.js

const canvasScaler = 0.75;
const canvas = document.getElementById("gameCanvas");

function setCanvasSize() {
    canvas.width = Math.floor(window.innerWidth * canvasScaler);
    canvas.height = Math.floor(window.innerHeight * canvasScaler);
}
setCanvasSize();

// Create worker and transfer the OffscreenCanvas
const worker = new Worker("worker.js");

const offscreen = canvas.transferControlToOffscreen();
worker.postMessage({
    type: "init",
    canvas: offscreen,
    width: canvas.width,
    height: canvas.height,
    gridSize: 1,
    metaStrength: 50000
}, [offscreen]);

// Throttle input to once-per-animation-frame to avoid flooding worker
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
    // Just send the new size to the worker
    worker.postMessage({
        type: "resize",
        width: window.innerWidth * canvasScaler,
        height: window.innerHeight * canvasScaler
    });
});

worker.onmessage = (e) => {
    if (e.data && e.data.type === "log") {
        console.log("worker:", e.data.msg);
    }
};
