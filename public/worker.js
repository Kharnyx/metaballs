// worker.js

// --- OffscreenCanvas & rendering ---
let canvas = null;
let ctx = null;

let widthPixels = 0;
let heightPixels = 0;
let metaballBaseRadius = 300;
let gridSize = metaballBaseRadius * 2; // Grid cell size set to 2x base radius for safe influence culling
let horizontalCells = 0;
let verticalCells = 0;
let metaStrength = 50000;

let lastTime = performance.now();
let deltaTime = 16 / 1000;

let mouseX = 0, mouseY = 0, mouseDown = false;
let running = false;
let pendingResize = null;

let resolutionScale = 1;

// --- Metaball data & Spatial Grid ---
let metaballPosition = [];
let metaballRadius = [];
let metaballColours = [];
let metaballSelected = [];
let mouseOffset = { x: 0, y: 0 };
let metaballGrid = [];

// --- Buffers ---
let imageData = null;
let pixelBuffer = null;

function ensureBuffers(w, h) {
    widthPixels = w;
    heightPixels = h;

    const renderW = Math.floor(widthPixels * resolutionScale);
    const renderH = Math.floor(heightPixels * resolutionScale);

    // Update Grid dimensions based on the rendering size and cell size
    horizontalCells = Math.ceil(renderW / gridSize);
    verticalCells = Math.ceil(renderH / gridSize);

    imageData = ctx.createImageData(renderW, renderH);
    pixelBuffer = imageData.data;

    // Initialize the Spatial Grid
    metaballGrid = Array(horizontalCells * verticalCells).fill(0).map(() => []);
}

// --- Spatial Grid Functions ---

function updateGrid() {
    // Clear the grid before repopulating
    for (let i = 0; i < metaballGrid.length; i++) {
        metaballGrid[i].length = 0;
    }

    // Populate the grid with metaball indices
    for (let i = 0; i < metaballPosition.length; i++) {
        const radius = metaballRadius[i];
        const x = metaballPosition[i][0];
        const y = metaballPosition[i][1];

        // Define the influence area for grid cell overlap calculation
        const influenceMargin = radius * 2;
        const minCellX = Math.floor((x - influenceMargin) / gridSize);
        const maxCellX = Math.ceil((x + influenceMargin) / gridSize);
        const minCellY = Math.floor((y - influenceMargin) / gridSize);
        const maxCellY = Math.ceil((y + influenceMargin) / gridSize);

        // Map the metaball to all cells it overlaps
        for (let gx = minCellX; gx < maxCellX; gx++) {
            for (let gy = minCellY; gy < maxCellY; gy++) {
                if (gx >= 0 && gx < horizontalCells && gy >= 0 && gy < verticalCells) {
                    const cellIndex = gy * horizontalCells + gx;
                    // Add index to the cell list
                    if (!metaballGrid[cellIndex].includes(i)) {
                        metaballGrid[cellIndex].push(i);
                    }
                }
            }
        }
    }
}

function getRelevantMetaballs(x, y) {
    // Get the grid cell index for the given world coordinate (x, y)
    const gx = Math.floor(x / gridSize);
    const gy = Math.floor(y / gridSize);

    if (gx < 0 || gx >= horizontalCells || gy < 0 || gy >= verticalCells) {
        return [];
    }

    const cellIndex = gy * horizontalCells + gx;
    return metaballGrid[cellIndex];
}

// --- Color helpers (unchanged) ---
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

    const colours = [
        [0, 100, 100, 1],
        [120, 100, 100, 1],
        [240, 100, 100, 1]
    ];

    const n = colours.length;
    const cx = widthPixels / 2;
    const cy = heightPixels / 2;

    const maxAllowedRadius = Math.min(widthPixels, heightPixels) / 2 - metaballBaseRadius;
    const circleRadius = Math.max(0, maxAllowedRadius * 0.8);

    for (let i = 0; i < n; i++) {
        const angle = (2 * Math.PI * i) / n;
        const x = cx + circleRadius * Math.cos(angle);
        const y = cy + circleRadius * Math.sin(angle);

        const clampedX = Math.min(Math.max(x, metaballBaseRadius), widthPixels - metaballBaseRadius);
        const clampedY = Math.min(Math.max(y, metaballBaseRadius), heightPixels - metaballBaseRadius);

        createMetaball(clampedX, clampedY, metaballBaseRadius, colours[i]);
    }
}

// --- Movement & rotation ---
function rotatePoint(metaIndex, cx, cy, speed = 0.02) {
    const x = metaballPosition[metaIndex][0];
    const y = metaballPosition[metaIndex][1];
    const radius = Math.hypot(x - cx, y - cy);
    let angle = Math.atan2(y - cy, x - cx);
    angle += speed * deltaTime * 60;
    metaballPosition[metaIndex][0] = cx + radius * Math.cos(angle);
    metaballPosition[metaIndex][1] = cy + radius * Math.sin(angle);
}

// --- Frame generation ---
function generateFrame() {
    const now = performance.now();
    deltaTime = (now - lastTime) / 1000;
    lastTime = now;

    // Handle pending resize smoothly (Centered Scaling)
    if (pendingResize) {
        const oldW = widthPixels, oldH = heightPixels;
        const newW = pendingResize.width, newH = pendingResize.height;

        const oldCx = oldW / 2;
        const oldCy = oldH / 2;
        const newCx = newW / 2;
        const newCy = newH / 2;

        const scaleX = newW / oldW;
        const scaleY = newH / oldH;
        const scaleFactor = Math.min(scaleX, scaleY);

        for (let i = 0; i < metaballPosition.length; i++) {
            // 1. Calculate relative position
            const x = metaballPosition[i][0] - oldCx;
            const y = metaballPosition[i][1] - oldCy;

            // 2. Apply INVERSE scaling to the relative position to maintain pixel distance from center
            const scaledX = x / scaleX;
            const scaledY = y / scaleY;

            // 3. Translate back to the new center
            metaballPosition[i][0] = scaledX + newCx;
            metaballPosition[i][1] = scaledY + newCy;

            // 4. Scale Radius
            metaballRadius[i] *= scaleFactor;
        }

        widthPixels = Math.ceil(newW);
        heightPixels = Math.ceil(newH);
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
                // Reduced collision threshold for accurate grab near center
                if (dist < metaballRadius[i] * 0.1) {
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
    rotatePoint(0, cx, cy, 0.01);
    rotatePoint(1, cx, cy, -0.01);
    rotatePoint(2, cx, cy, -0.02);

    // Update the Spatial Grid for efficient rendering
    updateGrid();

    // Clear pixel buffer
    pixelBuffer.fill(0);

    const renderW = Math.floor(widthPixels * resolutionScale);
    const renderH = Math.floor(heightPixels * resolutionScale);

    // Render every pixel
    for (let y = 0; y < renderH; y++) {
        for (let x = 0; x < renderW; x++) {
            const worldX = x / resolutionScale;
            const worldY = y / resolutionScale;
            const index = (y * renderW + x) * 4;

            let r = 0, g = 0, b = 0, totalWeight = 0, totalForce = 0;

            // Use Grid Lookup to only check nearby metaballs
            const relevantMetaballIndices = getRelevantMetaballs(worldX, worldY);

            for (const i of relevantMetaballIndices) {
                const dx = worldX - metaballPosition[i][0];
                const dy = worldY - metaballPosition[i][1];
                const distSq = dx * dx + dy * dy;

                // Removed hard cutoff check; force calculation allows for smooth falloff
                const force = metaStrength / (distSq + 1);
                totalForce += force;
                const weight = Math.sqrt(distSq);
                totalWeight += weight;
                r += metaballColours[i * 4] * weight;
                g += metaballColours[i * 4 + 1] * weight;
                b += metaballColours[i * 4 + 2] * weight;
            }

            if (totalWeight > 0) {
                // Color blending based on distance
                r = Math.min(255, r / totalWeight);
                g = Math.min(255, g / totalWeight);
                b = Math.min(255, b / totalWeight);

                let hsv = rgbToHsv(r, g, b);

                // Adjust brightness based on total force (lower threshold for brighter edges)
                hsv[2] = Math.min(1.0, (totalForce * totalForce) / 500);

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
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(canvas, 0, 0, renderW, renderH, 0, 0, widthPixels, heightPixels);
}

// --- Loop control and messages ---
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

onmessage = function (e) {
    const data = e.data;
    if (!data) return;

    if (data.type === "init") {
        canvas = data.canvas;
        ctx = canvas.getContext("2d");
        widthPixels = Math.ceil(data.width);
        heightPixels = Math.ceil(data.height);
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
    } else if (data.type === "setResolution") {
        resolutionScale = data.scale;
        ensureBuffers(widthPixels, heightPixels);
    }
};
