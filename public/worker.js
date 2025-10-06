// worker.js

// --- OffscreenCanvas & rendering ---
let canvas = null;
let ctx = null;

let widthPixels = 0;
let heightPixels = 0;
let gridSize = 1;
let horizontalCells = 0;
let verticalCells = 0;
let metaStrength = 50000;

let lastTime = performance.now();
let deltaTime = 16 / 1000;

let mouseX = 0, mouseY = 0, mouseDown = false;
let running = false;
let pendingResize = null;

// --- Metaball data ---
let metaballPosition = [];
let metaballRadius = [];
let metaballColours = [];
let metaballSelected = [];
let mouseOffset = { x: 0, y: 0 };

// --- Buffers ---
let imageData = null;
let pixelBuffer = null;

function ensureBuffers(w, h) {
    widthPixels = w;
    heightPixels = h;
    horizontalCells = Math.ceil(widthPixels / gridSize);
    verticalCells = Math.ceil(heightPixels / gridSize);
    imageData = ctx.createImageData(widthPixels, heightPixels);
    pixelBuffer = imageData.data;
}

// --- Color helpers ---
function hsvToRgb(h, s, v) {
    let r, g, b;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    switch (i % 6) {
        case 0: r = v; g = t; b = p; break;
        case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break;
        case 5: r = v; g = p; b = q; break;
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    const v = max;
    const s = max === 0 ? 0 : d / max;
    let h = 0;
    if (d !== 0) {
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return [h, s, v];
}

// --- Metaballs ---
function createMetaball(x, y, r, c) {
    const h_norm = c[0] / 360;
    const s_norm = c[1] / 100;
    const v_norm = c[2] / 100;
    const alpha = Math.round(c[3] * 255);
    const [cr, cg, cb] = hsvToRgb(h_norm, s_norm, v_norm);
    metaballPosition.push([x, y]);
    metaballRadius.push(r);
    metaballSelected.push(false);
    metaballColours.push(cr, cg, cb, alpha);
}

function createDefaults() {
    metaballPosition = [];
    metaballRadius = [];
    metaballColours = [];
    metaballSelected = [];
    mouseOffset = { x: 0, y: 0 };

    const cx = widthPixels / 2, cy = heightPixels / 2;
    const radius = 200;
    const colours = [[0, 100, 100, 1], [120, 100, 100, 1], [240, 100, 100, 1]];
    const n = colours.length;

    for (let i = 0; i < n; i++) {
        const angle = 2 * Math.PI * i / n;
        const x = cx + radius * Math.cos(angle);
        const y = cy + radius * Math.sin(angle);
        createMetaball(x, y, 300, colours[i]);
    }
}

// --- Movement & rotation ---
function rotatePoint(metaIndex, cx, cy, speed = 0.05) {
    const x = metaballPosition[metaIndex][0];
    const y = metaballPosition[metaIndex][1];
    const radius = Math.hypot(x - cx, y - cy);
    let angle = Math.atan2(y - cy, x - cx);
    angle += speed;
    metaballPosition[metaIndex][0] = cx + radius * Math.cos(angle);
    metaballPosition[metaIndex][1] = cy + radius * Math.sin(angle);
}

// --- Frame generation ---
function generateFrame() {
    const now = performance.now();
    deltaTime = (now - lastTime) / 1000;
    lastTime = now;

    // Handle pending resize smoothly
    if (pendingResize) {
        const oldW = widthPixels, oldH = heightPixels;
        const newW = pendingResize.width, newH = pendingResize.height;
        const scaleX = newW / oldW, scaleY = newH / oldH;

        for (let i = 0; i < metaballPosition.length; i++) {
            metaballPosition[i][0] *= scaleX;
            metaballPosition[i][1] *= scaleY;
        }

        widthPixels = newW;
        heightPixels = newH;
        canvas.width = widthPixels;
        canvas.height = heightPixels;
        ensureBuffers(widthPixels, heightPixels);
        pendingResize = null;
    }

    // Update dragging
    if (mouseDown) {
        const idx = metaballSelected.indexOf(true);
        if (idx !== -1) {
            metaballPosition[idx][0] = mouseX - mouseOffset.x;
            metaballPosition[idx][1] = mouseY - mouseOffset.y;
        } else {
            for (let i = 0; i < metaballPosition.length; i++) {
                const dx = mouseX - metaballPosition[i][0];
                const dy = mouseY - metaballPosition[i][1];
                const dist = Math.hypot(dx, dy);
                if (dist < metaballRadius[i] * 0.6) {
                    metaballSelected[i] = true;
                    mouseOffset.x = dx;
                    mouseOffset.y = dy;
                    break;
                }
            }
        }
    } else metaballSelected.fill(false);

    // Rotate metaballs
    const cx = widthPixels / 2, cy = heightPixels / 2;
    rotatePoint(0, cx, cy, 0.05);
    rotatePoint(1, cx, cy, -0.05);
    rotatePoint(2, cx, cy, -0.02);

    // Clear buffer
    pixelBuffer.fill(0);

    // Render every pixel
    for (let y = 0; y < heightPixels; y++) {
        for (let x = 0; x < widthPixels; x++) {
            const index = (y * widthPixels + x) * 4;
            let r = 0, g = 0, b = 0, totalWeight = 0, totalForce = 0;

            for (let i = 0; i < metaballPosition.length; i++) {
                const dx = x - metaballPosition[i][0];
                const dy = y - metaballPosition[i][1];
                const distSq = dx * dx + dy * dy;
                const force = metaStrength / (distSq + 1);
                totalForce += force;
                const weight = Math.sqrt(distSq);
                totalWeight += weight;
                r += metaballColours[i * 4] * weight;
                g += metaballColours[i * 4 + 1] * weight;
                b += metaballColours[i * 4 + 2] * weight;
            }

            if (totalWeight > 0) {
                r = Math.min(255, r / totalWeight);
                g = Math.min(255, g / totalWeight);
                b = Math.min(255, b / totalWeight);

                let hsv = rgbToHsv(r, g, b);
                hsv[2] = Math.min(1.0, (totalForce * totalForce) / 1000);
                hsv[1] = Math.max(0, Math.min(1, hsv[1] - 0.2));
                [r, g, b] = hsvToRgb(hsv[0], hsv[1], hsv[2]);
            }

            pixelBuffer[index] = r;
            pixelBuffer[index + 1] = g;
            pixelBuffer[index + 2] = b;
            pixelBuffer[index + 3] = 255;
        }
    }

    ctx.putImageData(imageData, 0, 0);
}

// --- Loop control ---
function loop() {
    if (!running) return;
    generateFrame();
    requestAnimationFrame(loop);
}

function startLoop() {
    if (running) return;
    running = true;
    lastTime = performance.now();
    requestAnimationFrame(loop);
}

function stopLoop() {
    running = false;
}

// --- Message handling ---
onmessage = function (e) {
    const data = e.data;
    if (!data) return;

    if (data.type === "init") {
        canvas = data.canvas;
        ctx = canvas.getContext("2d");
        widthPixels = data.width;
        heightPixels = data.height;
        gridSize = data.gridSize || 1;
        metaStrength = data.metaStrength || 50000;

        canvas.width = widthPixels;
        canvas.height = heightPixels;

        ensureBuffers(widthPixels, heightPixels);
        createDefaults();
        startLoop();

    } else if (data.type === "mouse") {
        mouseX = data.x;
        mouseY = data.y;
        mouseDown = !!data.mouseDown;
    } else if (data.type === "resize") {
        pendingResize = { width: data.width, height: data.height };
    } else if (data.type === "stop") {
        stopLoop();
    } else if (data.type === "addMetaball") {
        const { x, y, r, c } = data;
        createMetaball(x, y, r, c);
    }
};
