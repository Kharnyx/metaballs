// worker.js

let canvas = null;
let gl = null;
let shaderProgram = null;
let positionBuffer = null;

let widthPixels = 0;
let heightPixels = 0;
let metaballBaseRadius = 200;

// Custom engine modifier targets
let sharpness = 20;
let speedMultiplier = 1.0;
let colorTheme = "rgb";
let customColor = "#ffffff";

let lastTime = performance.now();
let deltaTime = 16 / 1000;

let mouseX = 0, mouseY = 0, mouseDown = false;
let running = false;
let pendingResize = null;

// --- Metaball data ---
const NUM_METABALLS = 3;
let metaballPosition = new Float32Array(NUM_METABALLS * 2);
let metaballRadius = new Float32Array(NUM_METABALLS);
let metaballVx = new Float32Array(NUM_METABALLS);
let metaballVy = new Float32Array(NUM_METABALLS);
let metaballColours = new Float32Array(NUM_METABALLS * 3);
let metaballSelected = [false, false, false];
let mouseOffset = { x: 0, y: 0 };

let socialClock = 0;

// --- CONFIGURATION ---
const MIN_RADIUS_MULTIPLIER = 0.2;
const MAX_RADIUS_MULTIPLIER = 3.5;
const GROWTH_EXPONENT = 2.5;
const MERGE_INTERVAL = 800;

// --- WEBGL SHADERS ---

const vertexShaderSource = `
    attribute vec2 a_position;
    void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
    }
`;

// The GPU takes over the pixel math here
const fragmentShaderSource = `
    precision mediump float;
    uniform vec2 u_resolution;
    uniform vec2 u_positions[${NUM_METABALLS}];
    uniform float u_radii[${NUM_METABALLS}];
    uniform vec3 u_colors[${NUM_METABALLS}];
    uniform float u_sharpness;

    // Convert HSV to RGB
    vec3 hsv2rgb(vec3 c) {
        vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    }

    // Convert RGB to HSV
    vec3 rgb2hsv(vec3 c) {
        vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
        vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
        vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
        float d = q.x - min(q.w, q.y);
        float e = 1.0e-10;
        return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
    }

    void main() {
        vec2 st = gl_FragCoord.xy;
        // Flip Y because WebGL 0,0 is bottom-left, but canvas/mouse is top-left
        st.y = u_resolution.y - st.y;

        float totalForce = 0.0;
        float totalWeight = 0.0;
        vec3 sumColor = vec3(0.0);

        for (int i = 0; i < ${NUM_METABALLS}; i++) {
            vec2 pos = u_positions[i];
            float distSq = dot(st - pos, st - pos);
            float weight = sqrt(distSq);

            float force = (u_radii[i] * u_radii[i] * 0.6) / (distSq + 1.0);
            totalForce += force;
            totalWeight += weight;

            sumColor += u_colors[i] * weight;
        }

        if (totalWeight > 0.0) {
            vec3 avgColor = sumColor / totalWeight;
            vec3 hsv = rgb2hsv(avgColor);

            // Apply Sharpness Math
            float baseBrightness = (totalForce * totalForce) / 500.0;
            hsv.z = min(1.0, pow(baseBrightness, u_sharpness / 15.0));
            hsv.y = max(0.0, min(1.0, hsv.y - 0.2));

            gl_FragColor = vec4(hsv2rgb(hsv), 1.0);
        } else {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        }
    }
`;

// --- WEBGL SETUP HELPERS ---

function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile failed:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function initWebGL() {
    const vertShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

    shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, vertShader);
    gl.attachShader(shaderProgram, fragShader);
    gl.linkProgram(shaderProgram);

    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
        console.error('Program link failed:', gl.getProgramInfoLog(shaderProgram));
        return;
    }

    // Create a full-screen quad (two triangles)
    const vertices = new Float32Array([
        -1.0, -1.0, 1.0, -1.0, -1.0, 1.0,
        -1.0, 1.0, 1.0, -1.0, 1.0, 1.0
    ]);

    positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
}

// --- LOGIC HELPERS ---

function hexToRgbFloat(hex) {
    let bigint = parseInt(hex.substring(1), 16);
    return [((bigint >> 16) & 255) / 255, ((bigint >> 8) & 255) / 255, (bigint & 255) / 255];
}

function updateThemeColors() {
    const themes = {
        rgb: [[0, 1, 1], [1, 0, 1], [1, 1, 0]],
        cmy: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        white: [hexToRgbFloat(customColor), hexToRgbFloat(customColor), hexToRgbFloat(customColor)]
    };
    const colours = themes[colorTheme] || themes.rgb;
    for (let i = 0; i < NUM_METABALLS; i++) {
        metaballColours[i * 3] = colours[i][0];
        metaballColours[i * 3 + 1] = colours[i][1];
        metaballColours[i * 3 + 2] = colours[i][2];
    }
}

function createDefaults() {
    const cx = widthPixels / 2;
    const cy = heightPixels / 2;
    const circleRadius = Math.max(0, (Math.min(widthPixels, heightPixels) / 2) - 100);

    for (let i = 0; i < NUM_METABALLS; i++) {
        const angle = (2 * Math.PI * i) / NUM_METABALLS;
        metaballPosition[i * 2] = cx + circleRadius * Math.cos(angle);
        metaballPosition[i * 2 + 1] = cy + circleRadius * Math.sin(angle);

        metaballRadius[i] = metaballBaseRadius;
        metaballVx[i] = (Math.random() - 0.5) * 2;
        metaballVy[i] = (Math.random() - 0.5) * 2;
        metaballSelected[i] = false;
    }
    updateThemeColors();
}

// --- MAIN LOOP ---

function generateFrame() {
    const now = performance.now();
    deltaTime = (now - lastTime) / 1000;
    lastTime = now;

    if (pendingResize) {
        const oldW = widthPixels, oldH = heightPixels;
        widthPixels = Math.ceil(pendingResize.width);
        heightPixels = Math.ceil(pendingResize.height);

        for (let i = 0; i < NUM_METABALLS; i++) {
            metaballPosition[i * 2] = (metaballPosition[i * 2] / oldW) * widthPixels;
            metaballPosition[i * 2 + 1] = (metaballPosition[i * 2 + 1] / oldH) * heightPixels;
        }

        canvas.width = widthPixels;
        canvas.height = heightPixels;
        gl.viewport(0, 0, widthPixels, heightPixels);
        pendingResize = null;
    }

    // A. Mouse Interaction
    if (mouseDown) {
        const idx = metaballSelected.indexOf(true);
        if (idx !== -1) {
            metaballPosition[idx * 2] = mouseX - mouseOffset.x;
            metaballPosition[idx * 2 + 1] = mouseY - mouseOffset.y;
            metaballVx[idx] = 0;
            metaballVy[idx] = 0;
        } else {
            for (let i = 0; i < NUM_METABALLS; i++) {
                const dx = mouseX - metaballPosition[i * 2];
                const dy = mouseY - metaballPosition[i * 2 + 1];
                if (Math.hypot(dx, dy) < metaballBaseRadius * 0.8) {
                    metaballSelected[i] = true;
                    mouseOffset = { x: dx, y: dy };
                    break;
                }
            }
        }
    } else metaballSelected.fill(false);

    // B. PHYSICS & PROXIMITY ENGINE (Executed in JS)
    socialClock = (socialClock + 1) % MERGE_INTERVAL;
    const mergeDuration = 250;
    const mergeStart = MERGE_INTERVAL - mergeDuration;
    let attractionMagnitude = 0;

    if (socialClock > mergeStart) {
        const progress = socialClock - mergeStart;
        if (progress < 60) attractionMagnitude = (progress / 60) * 0.07;
        else if (progress < mergeDuration - 60) attractionMagnitude = 0.07;
        else attractionMagnitude = (1.0 - (progress - (mergeDuration - 60)) / 60) * 0.07;
    }

    for (let i = 0; i < NUM_METABALLS; i++) {
        let totalProximity = 0;
        const ix = metaballPosition[i * 2];
        const iy = metaballPosition[i * 2 + 1];

        for (let j = 0; j < NUM_METABALLS; j++) {
            if (i === j) continue;
            const distSq = Math.pow(ix - metaballPosition[j * 2], 2) + Math.pow(iy - metaballPosition[j * 2 + 1], 2);
            totalProximity += 10000 / (distSq + 100);
        }

        let targetRadius = metaballBaseRadius * (MIN_RADIUS_MULTIPLIER +
            (Math.pow(totalProximity, GROWTH_EXPONENT) * (MAX_RADIUS_MULTIPLIER - MIN_RADIUS_MULTIPLIER)));
        targetRadius = Math.min(targetRadius, metaballBaseRadius * MAX_RADIUS_MULTIPLIER);
        metaballRadius[i] += (targetRadius - metaballRadius[i]) * 0.15;

        if (metaballSelected[i]) continue;

        let ax = 0, ay = 0;
        for (let j = 0; j < NUM_METABALLS; j++) {
            if (i === j) continue;
            const dx = metaballPosition[j * 2] - ix;
            const dy = metaballPosition[j * 2 + 1] - iy;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist > 0 && dist < 1000) {
                if (attractionMagnitude > 0) {
                    ax += (dx / dist) * attractionMagnitude;
                    ay += (dy / dist) * attractionMagnitude;
                }
                if (dist < 180) {
                    const proxFact = 1.0 - (dist / 180);
                    const rep = proxFact * proxFact * 0.25;
                    ax -= (dx / dist) * rep;
                    ay -= (dy / dist) * rep;
                }
            }
        }

        metaballVx[i] += ax;
        metaballVy[i] += ay;

        let currentSpeed = Math.sqrt(metaballVx[i] ** 2 + metaballVy[i] ** 2);
        let targetSpeed = 1.5 * speedMultiplier;

        if (currentSpeed > 0) {
            let smoothedSpeed = currentSpeed * 0.93 + targetSpeed * 0.07;
            metaballVx[i] = (metaballVx[i] / currentSpeed) * smoothedSpeed;
            metaballVy[i] = (metaballVy[i] / currentSpeed) * smoothedSpeed;
        }

        metaballPosition[i * 2] += metaballVx[i];
        metaballPosition[i * 2 + 1] += metaballVy[i];

        const pad = 5;
        if (metaballPosition[i * 2] < pad) { metaballPosition[i * 2] = pad; metaballVx[i] = Math.abs(metaballVx[i]); }
        else if (metaballPosition[i * 2] > widthPixels - pad) { metaballPosition[i * 2] = widthPixels - pad; metaballVx[i] = -Math.abs(metaballVx[i]); }

        if (metaballPosition[i * 2 + 1] < pad) { metaballPosition[i * 2 + 1] = pad; metaballVy[i] = Math.abs(metaballVy[i]); }
        else if (metaballPosition[i * 2 + 1] > heightPixels - pad) { metaballPosition[i * 2 + 1] = heightPixels - pad; metaballVy[i] = -Math.abs(metaballVy[i]); }
    }

    // C. RENDER PIPELINE (Executed on GPU)
    gl.useProgram(shaderProgram);

    // Bind vertices
    const posLoc = gl.getAttribLocation(shaderProgram, "a_position");
    gl.enableVertexAttribArray(posLoc);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    // Push Uniforms (State to GPU)
    gl.uniform2f(gl.getUniformLocation(shaderProgram, "u_resolution"), widthPixels, heightPixels);
    gl.uniform1f(gl.getUniformLocation(shaderProgram, "u_sharpness"), sharpness);
    gl.uniform2fv(gl.getUniformLocation(shaderProgram, "u_positions"), metaballPosition);
    gl.uniform1fv(gl.getUniformLocation(shaderProgram, "u_radii"), metaballRadius);
    gl.uniform3fv(gl.getUniformLocation(shaderProgram, "u_colors"), metaballColours);

    // Draw
    gl.drawArrays(gl.TRIANGLES, 0, 6);
}

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

// --- WORKER MESSAGING ---

onmessage = function (e) {
    const data = e.data;
    if (!data) return;

    if (data.type === "init") {
        canvas = data.canvas;
        gl = canvas.getContext("webgl");

        widthPixels = Math.ceil(data.width);
        heightPixels = Math.ceil(data.height);
        canvas.width = widthPixels;
        canvas.height = heightPixels;
        gl.viewport(0, 0, widthPixels, heightPixels);

        if (data.initialSettings) {
            sharpness = data.initialSettings.sharpness;
            speedMultiplier = data.initialSettings.speedMultiplier;
            colorTheme = data.initialSettings.colorTheme;
            customColor = data.initialSettings.customColor || "#ffffff";
            metaballBaseRadius = data.initialSettings.metaballBaseRadius;
        }

        initWebGL();
        createDefaults();
        startLoop();

    } else if (data.type === "settingsUpdate") {
        const s = data.settings;
        sharpness = s.sharpness;
        speedMultiplier = s.speedMultiplier;
        metaballBaseRadius = s.metaballBaseRadius;

        if (s.colorTheme !== colorTheme || s.customColor !== customColor) {
            colorTheme = s.colorTheme;
            customColor = s.customColor;
            updateThemeColors();
        }

    } else if (data.type === "mouse") {
        mouseX = data.x;
        mouseY = data.y;
        mouseDown = !!data.mouseDown;
    } else if (data.type === "resize") {
        pendingResize = { width: data.width, height: data.height };
    } else if (data.type === "stop") {
        running = false;
    }
};
