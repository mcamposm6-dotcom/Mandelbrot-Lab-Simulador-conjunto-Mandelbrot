

"use strict";

// ==========================================
// MANDELBROT LAB · PHYMATH 2026 · UNEMI
// ==========================================

const $ = id => document.getElementById(id);

const canvas = {
  fractal: $("fractalCanvas"),
  overlay: $("overlayCanvas"),
  orbit: $("orbitCanvas"),
  module: $("moduleCanvas")
};

const ctx = Object.fromEntries(
  Object.entries(canvas).map(([key, value]) =>
    [key, value.getContext("2d")]
  )
);

const W = canvas.fractal.width;
const H = canvas.fractal.height;

const defaults = {
  iterations: 180,
  zoom: 1,
  centerReal: -0.5,
  centerImag: 0,
  palette: "cosmic"
};

const state = {
  phase: "ready",
  task: null,
  raf: null,
  generation: 0,
  progress: 0,
  point: { a: -1, b: 0 },
  z0: { x: 0, y: 0 },
  orbit: [],
  escape: null,
  escapeRadius: 2,
  step: 0,
  selected: false
};

const clamp = (x, a, b) =>
  Math.max(a, Math.min(b, x));

const fmt = x =>
  Number.isFinite(x)
    ? String(Number(x.toPrecision(6)))
    : "∞";

const complexLabel = (a, b) =>
  fmt(a) +
  (b < 0 ? " − " : " + ") +
  fmt(Math.abs(b)) + "i";

// ==========================================
// NAVEGACIÓN
// ==========================================

function navigate(page) {
  if (state.phase === "running" && page !== "lab") {
    pauseSimulation();
  }

  ["welcome", "credits", "lab"].forEach(id => {
    $(id).hidden = id !== page;
    $(id).classList.toggle("active", id === page);
  });

  window.scrollTo(0, 0);
}

$("toCredits").onclick = () => navigate("credits");
$("backWelcome").onclick = () => navigate("welcome");
$("toLab").onclick = () => navigate("lab");
$("homeBtn").onclick = () => navigate("welcome");

$("logoHome").onclick = e => {
  e.preventDefault();
  navigate("welcome");
};

// ==========================================
// BURBUJAS DEL FONDO
// ==========================================

for (let i = 0; i < 22; i++) {
  const bubble = document.createElement("span");
  bubble.className = "bubble";

  bubble.style.setProperty("--left", `${(i * 41 + 17) % 100}%`);
  bubble.style.setProperty("--size", `${8 + (i * 17) % 27}px`);
  bubble.style.setProperty("--duration", `${15 + (i * 7) % 13}s`);
  bubble.style.setProperty("--delay", `${-((i * 11) % 23)}s`);

  $("particles").appendChild(bubble);
}

// ==========================================
// DESLIZADORES
// ==========================================

function parameters() {
  return {
    iterations: Number($("iterations").value),
    zoom: Number($("zoom").value),
    centerReal: Number($("centerReal").value),
    centerImag: Number($("centerImag").value),
    palette: $("palette").value
  };
}

function updateOutputs() {
  const p = parameters();

  $("iterationsOut").textContent = p.iterations;
  $("zoomOut").textContent = p.zoom.toFixed(2) + "×";
  $("centerRealOut").textContent = p.centerReal.toFixed(3);
  $("centerImagOut").textContent = p.centerImag.toFixed(3);

  $("metricIter").textContent = p.iterations;
  $("metricZoom").textContent = p.zoom.toFixed(2) + "×";
}

// ==========================================
// ESTADO Y BOTONES
// ==========================================

function updateButtons() {
  $("pauseBtn").disabled = state.phase !== "running";
  $("continueBtn").disabled = state.phase !== "paused";

  $("startBtn").textContent =
    ["running", "paused"].includes(state.phase)
      ? "↻ Iniciar de nuevo"
      : "▶ Iniciar";
}

function updateStatus(label, progress = state.progress) {
  state.progress = progress;

  $("statusText").textContent = "● " + label;
  $("percentText").textContent =
    Math.round(progress * 100) + " %";

  $("progressFill").style.width =
    progress * 100 + "%";
}

function stopTask() {
  if (state.raf !== null) {
    cancelAnimationFrame(state.raf);
  }

  state.raf = null;
  state.task = null;
  state.generation++;
}

function clearCanvas(element) {
  const context = element.getContext("2d");
  context.fillStyle = "#071428";
  context.fillRect(0, 0, element.width, element.height);
}

// ==========================================
// REINICIAR
// ==========================================

function resetView(restore = false) {
  stopTask();

  state.phase = "ready";
  state.progress = 0;
  state.orbit = [];
  state.escape = null;
  state.step = 0;
  state.selected = false;
  state.point = { a: -1, b: 0 };
  state.z0 = { x: 0, y: 0 };
  state.escapeRadius = 2;

  if (restore) {
    Object.entries(defaults).forEach(([id, value]) => {
      $(id).value = value;
    });
  }

  $("cRealInput").value = "-1";
  $("cImagInput").value = "0";
  $("zRealInput").value = "0";
  $("zImagInput").value = "0";

  updateOutputs();

  clearCanvas(canvas.fractal);
  clearCanvas(canvas.orbit);
  clearCanvas(canvas.module);

  ctx.overlay.clearRect(0, 0, W, H);

  $("fractalPlaceholder").hidden = false;
  $("metricC").textContent = "−1 + 0i";
  $("metricZ0").textContent = "0 + 0i";
  $("metricEscape").textContent = "Sin calcular";
  $("escapeThresholdLegend").textContent = "Umbral = 2";

  $("complexMessage").textContent =
    "Introduce c y z₀ para calcular la órbita.";

  $("resultMessage").textContent =
    "Pulsa Iniciar o Calcular si escapa.";

  $("explanationText").textContent =
    "La regla iterativa es zₙ₊₁ = zₙ² + c.";

  updateStatus("Listo", 0);
  updateButtons();
  updateTable();
}

// ==========================================
// PLANO COMPLEJO
// ==========================================

function pixelToComplex(px, py, p) {
  const height = 2.9 / p.zoom;
  const width = height * W / H;

  return {
    a: p.centerReal + (px / W - .5) * width,
    b: p.centerImag + (.5 - py / H) * height
  };
}

// ==========================================
// CÁLCULO DE ÓRBITA
// ==========================================

function calculateOrbit(a, b, zx, zy, maxIter) {
  let x = zx;
  let y = zy;
  let escape = null;

  const standard = zx === 0 && zy === 0;

  // Para z₀ = 0 usamos el radio clásico de Mandelbrot.
  // Con otro z₀ se utiliza un umbral suficiente.
  const radius = standard
    ? 2
    : Math.max(2, Math.hypot(a, b) + 1.000001);

  const samples = [{
    n: 0,
    x,
    y,
    m: Math.hypot(x, y)
  }];

  if (samples[0].m > radius) {
    return {
      samples,
      escape: 0,
      radius,
      standard
    };
  }

  for (let n = 1; n <= maxIter; n++) {
    const nx = x * x - y * y + a;
    const ny = 2 * x * y + b;

    x = nx;
    y = ny;

    const m = Math.hypot(x, y);

    samples.push({ n, x, y, m });

    if (!Number.isFinite(m) || m > radius) {
      escape = n;
      break;
    }
  }

  return { samples, escape, radius, standard };
}

// ==========================================
// SELECCIÓN DEL PUNTO COMPLEJO
// ==========================================

function selectPoint(a, b) {
  state.point = { a, b };
  state.selected = true;

  const { x, y } = state.z0;

  const result = calculateOrbit(
    a,
    b,
    x,
    y,
    parameters().iterations
  );

  state.orbit = result.samples;
  state.escape = result.escape;
  state.escapeRadius = result.radius;

  state.step =
    ["running", "paused"].includes(state.phase)
      ? Math.floor(
          state.progress * (state.orbit.length - 1)
        )
      : state.orbit.length - 1;

  $("metricC").textContent = complexLabel(a, b);
  $("metricZ0").textContent = complexLabel(x, y);

  $("cRealInput").value = String(a);
  $("cImagInput").value = String(b);

  $("metricEscape").textContent =
    result.escape === null
      ? "No detectado"
      : "n = " + result.escape;

  $("escapeThresholdLegend").textContent =
    "Umbral = " + fmt(result.radius);

  if (result.escape === null) {
    $("complexMessage").textContent =
      "No se detectó escape durante las iteraciones. " +
      "Esto no demuestra que la órbita permanezca acotada.";

    $("resultMessage").textContent =
      "Órbita sin escape detectado.";

  } else {
    $("complexMessage").textContent =
      `Escape detectado en n = ${result.escape}.`;

    $("resultMessage").textContent =
      `La órbita superó el umbral ${fmt(result.radius)} ` +
      `en la iteración ${result.escape}.`;
  }

  $("explanationText").textContent =
    result.standard
      ? (
          result.escape === null
            ? "No se detectó escape. Esto no demuestra " +
              "que c pertenezca al conjunto de Mandelbrot."
            : "Con z₀ = 0 se ha demostrado que este punto " +
              "está fuera del conjunto de Mandelbrot."
        )
      : "Has elegido z₀ distinto de cero. Estás estudiando " +
        "otra órbita de la ecuación, no la pertenencia " +
        "de c al conjunto de Mandelbrot.";

  drawMarker();
  drawGraphs();
  updateTable();
}

// ==========================================
// INTRODUCCIÓN MANUAL DE VALORES
// ==========================================

function analyzeInputs() {
  const ids = [
    "cRealInput",
    "cImagInput",
    "zRealInput",
    "zImagInput"
  ];

  const values = ids.map(id => {
    const raw = $(id).value.trim();
    return raw === "" ? NaN : Number(raw);
  });

  if (
    values.some(
      value =>
        !Number.isFinite(value) ||
        Math.abs(value) > 1000000
    )
  ) {
    $("complexMessage").textContent =
      "Introduce cuatro números válidos entre " +
      "−1 000 000 y 1 000 000.";
    return;
  }

  const [a, b, zx, zy] = values;

  state.z0 = { x: zx, y: zy };

  selectPoint(a, b);
}

$("analyzeComplexBtn").onclick = analyzeInputs;

document.querySelectorAll(".complex-preset").forEach(button => {
  button.onclick = () => {
    $("cRealInput").value = button.dataset.a;
    $("cImagInput").value = button.dataset.b;
    $("zRealInput").value = "0";
    $("zImagInput").value = "0";
    analyzeInputs();
  };
});

[
  "cRealInput", "cImagInput",
  "zRealInput", "zImagInput"
].forEach(id => {
  $(id).addEventListener("keydown", e => {
    if (e.key === "Enter") analyzeInputs();
  });
});

// ==========================================
// MARCADOR DEL PUNTO
// ==========================================

function drawMarker() {
  const o = ctx.overlay;
  o.clearRect(0, 0, W, H);

  if (!state.selected) return;

  const p = parameters();
  const h = 2.9 / p.zoom;
  const w = h * W / H;

  const x =
    W / 2 + (state.point.a - p.centerReal) / w * W;

  const y =
    H / 2 - (state.point.b - p.centerImag) / h * H;

  if (x < 0 || x > W || y < 0 || y > H) return;

  o.strokeStyle = "#ffffff";
  o.lineWidth = 2;
  o.beginPath();
  o.arc(x, y, 8, 0, 2 * Math.PI);
  o.moveTo(x - 13, y);
  o.lineTo(x + 13, y);
  o.moveTo(x, y - 13);
  o.lineTo(x, y + 13);
  o.stroke();
}

// ==========================================
// PALETAS
// ==========================================

const palettes = {
  cosmic: [
    [7,16,50], [44,62,161], [135,62,214],
    [248,95,198], [255,220,122]
  ],
  ocean: [
    [4,28,58], [8,96,145], [20,187,221],
    [115,234,225], [245,255,224]
  ],
  fire: [
    [38,5,22], [155,35,31], [246,100,25],
    [255,190,71], [255,250,189]
  ],
  mono: [
    [18,28,44], [70,86,116], [126,150,172],
    [204,218,231], [255,255,255]
  ]
};

function fractalColor(n, magnitude, palette) {
  const stops = palettes[palette];

  const smooth =
    n + 1 -
    Math.log2(
      Math.max(
        1e-9,
        Math.log2(Math.max(magnitude, 2.0001))
      )
    );

  const position =
    (((smooth * .028) % 1 + 1) % 1) *
    (stops.length - 1);

  const i = Math.floor(position);
  const t = position - i;

  return stops[i].map((value, k) => {
    const next =
      stops[Math.min(i + 1, stops.length - 1)][k];

    return Math.round(value + (next - value) * t);
  });
}

// ==========================================
// INICIAR GENERACIÓN DEL FRACTAL
// ==========================================

function startSimulation() {
  stopTask();

  const p = parameters();

  const image = ctx.fractal.createImageData(W, H);

  state.task = {
    p,
    image,
    row: 0,
    generation: state.generation
  };

  state.phase = "running";
  state.progress = 0;
  state.step = 0;

  ctx.fractal.clearRect(0, 0, W, H);
  $("fractalPlaceholder").hidden = true;

  selectPoint(state.point.a, state.point.b);

  updateStatus("Generando", 0);
  updateButtons();
  schedule();
}

function schedule() {
  if (
    state.phase !== "running" ||
    !state.task ||
    state.raf !== null
  ) return;

  const task = state.task;

  state.raf = requestAnimationFrame(() => {
    state.raf = null;

    if (
      state.phase === "running" &&
      state.task === task &&
      task.generation === state.generation
    ) {
      renderBlock(task);
    }
  });
}

function renderBlock(task) {
  const first = task.row;
  const started = performance.now();

  while (
    task.row < H &&
    task.row - first < 3 &&
    performance.now() - started < 10
  ) {
    const py = task.row;

    for (let px = 0; px < W; px++) {
      const { a, b } = pixelToComplex(
        px + .5,
        py + .5,
        task.p
      );

      let x = 0, y = 0;
      let x2 = 0, y2 = 0;
      let n = 0;

      while (
        n < task.p.iterations &&
        x2 + y2 <= 4
      ) {
        const nx = x2 - y2 + a;
        const ny = 2 * x * y + b;

        x = nx;
        y = ny;
        x2 = x * x;
        y2 = y * y;
        n++;
      }

      const color =
        n === task.p.iterations && x2 + y2 <= 4
          ? [3, 9, 23]
          : fractalColor(
              n,
              Math.hypot(x, y),
              task.p.palette
            );

      const k = (py * W + px) * 4;

      task.image.data[k] = color[0];
      task.image.data[k + 1] = color[1];
      task.image.data[k + 2] = color[2];
      task.image.data[k + 3] = 255;
    }

    task.row++;
  }

  ctx.fractal.putImageData(
    task.image,
    0,
    0,
    0,
    first,
    W,
    task.row - first
  );

  const progress = task.row / H;

  state.step = Math.min(
    state.orbit.length - 1,
    Math.floor(progress * (state.orbit.length - 1))
  );

  drawGraphs();
  updateStatus("Generando", progress);

  if (task.row >= H) {
    state.phase = "finished";
    state.task = null;
    state.step = state.orbit.length - 1;
    updateStatus("Finalizado", 1);
    updateButtons();
    drawGraphs();
  } else {
    schedule();
  }
}

// ==========================================
// PAUSAR Y CONTINUAR
// ==========================================

function pauseSimulation() {
  if (state.phase !== "running") return;

  state.phase = "paused";

  if (state.raf !== null) {
    cancelAnimationFrame(state.raf);
    state.raf = null;
  }

  updateStatus("Pausado");
  updateButtons();
}

function continueSimulation() {
  if (
    state.phase !== "paused" ||
    !state.task
  ) return;

  state.phase = "running";
  updateStatus("Continuando");
  updateButtons();
  schedule();
}

// ==========================================
// DIBUJO DE GRÁFICAS
// ==========================================

function plotFrame(context, element, maxX, minY, maxY) {
  const w = element.width;
  const h = element.height;
  const L = 64, R = 24, T = 24, B = 40;

  context.fillStyle = "#071428";
  context.fillRect(0, 0, w, h);

  const grid = $("showGrid").checked;
  const width = w - L - R;
  const height = h - T - B;

  if (maxY <= minY) maxY = minY + 1;

  const X = n => L + n / Math.max(1, maxX) * width;

  const Y = v =>
    T + (maxY - clamp(v, minY, maxY)) /
    (maxY - minY) * height;

  context.font = "12px Arial";

  if (grid) {
    for (let i = 0; i <= 4; i++) {
      const value = maxY - i * (maxY - minY) / 4;
      const y = Y(value);

      context.strokeStyle = "#294668";
      context.beginPath();
      context.moveTo(L, y);
      context.lineTo(w - R, y);
      context.stroke();

      context.fillStyle = "#a8bddd";
      context.fillText(fmt(value), 5, y + 4);
    }
  }

  context.strokeStyle = "#bed7ef";
  context.beginPath();
  context.moveTo(L, T);
  context.lineTo(L, h - B);
  context.lineTo(w - R, h - B);
  context.stroke();

  context.fillStyle = "#e3f4ff";
  context.fillText("n", w - R, h - 14);

  return { X, Y };
}

function drawSeries(context, data, X, Y, field, color, limit) {
  context.strokeStyle = color;
  context.lineWidth = 2.5;
  context.beginPath();

  let started = false;

  for (
    let i = 0;
    i <= limit && i < data.length;
    i++
  ) {
    const value = field(data[i]);

    if (!Number.isFinite(value)) {
      started = false;
      continue;
    }

    if (!started) {
      context.moveTo(X(data[i].n), Y(value));
      started = true;
    } else {
      context.lineTo(X(data[i].n), Y(value));
    }
  }

  context.stroke();
}

function drawGraphs() {
  const data = state.orbit;

  if (!data.length) {
    clearCanvas(canvas.orbit);
    clearCanvas(canvas.module);
    return;
  }

  const limit =
    ["running", "paused"].includes(state.phase)
      ? state.step
      : data.length - 1;

  const visible = data.slice(0, limit + 1);

  const components = visible
    .flatMap(d => [d.x, d.y])
    .filter(Number.isFinite);

  const maxN = Math.max(1, data[data.length - 1].n);

  const orbitFrame = plotFrame(
    ctx.orbit,
    canvas.orbit,
    maxN,
    Math.min(-2, ...components),
    Math.max(2, ...components)
  );

  drawSeries(
    ctx.orbit, data,
    orbitFrame.X, orbitFrame.Y,
    d => d.x, "#42e6f2", limit
  );

  drawSeries(
    ctx.orbit, data,
    orbitFrame.X, orbitFrame.Y,
    d => d.y, "#b177ff", limit
  );

  const modules = visible
    .map(d => d.m)
    .filter(Number.isFinite);

  const maxY = Math.min(
    20,
    Math.max(3, state.escapeRadius, ...modules)
  );

  const moduleFrame = plotFrame(
    ctx.module,
    canvas.module,
    maxN,
    0,
    maxY
  );

  ctx.module.strokeStyle = "#ff768c";
  ctx.module.setLineDash([7, 5]);
  ctx.module.beginPath();
  ctx.module.moveTo(
    moduleFrame.X(0),
    moduleFrame.Y(state.escapeRadius)
  );
  ctx.module.lineTo(
    moduleFrame.X(maxN),
    moduleFrame.Y(state.escapeRadius)
  );
  ctx.module.stroke();
  ctx.module.setLineDash([]);

  drawSeries(
    ctx.module, data,
    moduleFrame.X, moduleFrame.Y,
    d => d.m, "#ffce72", limit
  );
}

function updateVisibleGraphs() {
  [
    ["showFractal", "fractalCard"],
    ["showOrbit", "orbitCard"],
    ["showModule", "moduleCard"]
  ].forEach(([id, card]) => {
    $(card).classList.toggle(
      "hidden-graph",
      !$(id).checked
    );
  });

  drawGraphs();
}

// ==========================================
// TABLA DE RESULTADOS
// ==========================================

function updateTable() {
  const tbody = $("tableBody");
  tbody.replaceChildren();

  if (!state.orbit.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 5;
    cell.textContent = "No hay resultados calculados.";

    row.appendChild(cell);
    tbody.appendChild(row);

    $("tablePoint").textContent = "Sin calcular";
    $("tableInitial").textContent = "0 + 0i";
    $("tableCount").textContent = "0 registros";
    return;
  }

  $("tablePoint").textContent =
    complexLabel(state.point.a, state.point.b);

  $("tableInitial").textContent =
    complexLabel(state.z0.x, state.z0.y);

  const fragment = document.createDocumentFragment();

  state.orbit.forEach(d => {
    const row = document.createElement("tr");

    const escaped =
      !Number.isFinite(d.m) ||
      d.m > state.escapeRadius;

    if (escaped) row.classList.add("escaped");

    [
      d.n,
      fmt(d.x),
      fmt(d.y),
      fmt(d.m),
      escaped ? "Escapa" : d.n === 0 ? "Inicial" : "No escapa"
    ].forEach(value => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });

    fragment.appendChild(row);
  });

  tbody.appendChild(fragment);

  $("tableCount").textContent =
    state.orbit.length + " registros";
}

// ==========================================
// EXPORTAR TABLA A CSV
// ==========================================

$("exportCSV").onclick = () => {
  if (!state.orbit.length) {
    alert("Primero debes analizar un punto.");
    return;
  }

  const lines = [
    "Iteracion,Real,Imaginaria,Modulo,Estado"
  ];

  state.orbit.forEach(d => {
    const escaped =
      !Number.isFinite(d.m) ||
      d.m > state.escapeRadius;

    lines.push([
      d.n,
      d.x,
      d.y,
      d.m,
      escaped ? "Escapa" : "No escapa"
    ].join(","));
  });

  const blob = new Blob(
    ["\uFEFF" + lines.join("\r\n")],
    { type: "text/csv;charset=utf-8" }
  );

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = "resultados_mandelbrot.csv";
  a.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// ==========================================
// EVENTOS DEL SIMULADOR
// ==========================================

$("startBtn").onclick = startSimulation;
$("pauseBtn").onclick = pauseSimulation;
$("continueBtn").onclick = continueSimulation;

$("restartBtn").onclick = () => resetView(false);

$("defaultsBtn").onclick = () => {
  resetView(true);
  $("changesHint").textContent =
    "Se restauraron los parámetros originales.";
};

[
  "iterations", "zoom",
  "centerReal", "centerImag", "palette"
].forEach(id => {
  $(id).addEventListener("input", () => {
    resetView(false);
    updateOutputs();
    $("changesHint").textContent =
      "Parámetros modificados. Pulsa Iniciar.";
  });
});

[
  "showFractal", "showOrbit",
  "showModule", "showGrid"
].forEach(id => {
  $(id).addEventListener("change", updateVisibleGraphs);
});

canvas.fractal.addEventListener("click", e => {
  if (state.phase === "ready") return;

  const rect = canvas.fractal.getBoundingClientRect();

  const px = (e.clientX - rect.left) / rect.width * W;
  const py = (e.clientY - rect.top) / rect.height * H;

  const point = pixelToComplex(px, py, parameters());

  selectPoint(point.a, point.b);
});

// ==========================================
// ACTIVIDAD FINAL
// ==========================================

const questions = [
  {
    text: "¿Cuál es la ecuación iterativa del conjunto de Mandelbrot?",
    options: [
      "z(n+1) = z(n) + c",
      "z(n+1) = z(n)² + c",
      "z(n+1) = 2z(n) + c",
      "z(n+1) = c²"
    ],
    correct: 1,
    explanation: "Se utiliza z(n+1) = z(n)² + c y z₀ = 0."
  },
  {
    text: "¿Qué ocurre cuando |zₙ| supera el valor 2?",
    options: [
      "El punto pertenece al conjunto",
      "La órbita se vuelve cero",
      "El punto escapa y está fuera del conjunto",
      "La fórmula deja de funcionar"
    ],
    correct: 2,
    explanation: "Superar el radio 2 demuestra el escape."
  },
  {
    text: "Si c = 0 y z₀ = 0, ¿qué sucede?",
    options: [
      "Todos los términos permanecen en cero",
      "Escapa en la tercera iteración",
      "Crece sin límite",
      "Alterna entre 1 y 2"
    ],
    correct: 0,
    explanation: "El valor cero permanece en cero."
  },
  {
    text: "¿Qué permite aumentar las iteraciones máximas?",
    options: [
      "Modificar la ecuación",
      "Detectar escapes tardíos",
      "Eliminar la parte imaginaria",
      "Demostrar que todos los puntos pertenecen"
    ],
    correct: 1,
    explanation: "Más iteraciones permiten detectar escapes tardíos."
  },
  {
    text: "¿Para qué sirve el zoom?",
    options: [
      "Cambiar la ecuación",
      "Cambiar el radio de escape",
      "Eliminar los números complejos",
      "Explorar detalles del fractal"
    ],
    correct: 3,
    explanation: "El zoom permite observar escalas menores."
  }
];

let quizIndex = 0;
let quizScore = 0;
let quizAttempts = 0;
let quizAnswered = false;

function showQuestion() {
  const q = questions[quizIndex];

  quizAttempts = 0;
  quizAnswered = false;

  $("quizCounter").textContent =
    `Pregunta ${quizIndex + 1} de ${questions.length}`;

  $("quizQuestion").textContent = q.text;
  $("quizScore").textContent = `${quizScore}/10`;

  $("quizProgress").style.width =
    quizIndex / questions.length * 100 + "%";

  $("quizFeedback").textContent =
    "Selecciona una respuesta.";

  $("quizFinal").hidden = true;
  $("quizCheck").disabled = false;
  $("quizNext").disabled = true;

  const box = $("quizOptions");
  box.replaceChildren();

  q.options.forEach((option, i) => {
    const label = document.createElement("label");
    label.className = "quiz-option";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "quizAnswer";
    radio.value = i;

    const span = document.createElement("span");
    span.textContent = option;

    label.append(radio, span);
    box.appendChild(label);
  });
}

function checkAnswer() {
  if (quizAnswered) return;

  const selected = document.querySelector(
    'input[name="quizAnswer"]:checked'
  );

  if (!selected) {
    $("quizFeedback").textContent =
      "Elige una alternativa antes de comprobar.";
    return;
  }

  const q = questions[quizIndex];
  const choice = Number(selected.value);
  const label = selected.closest("label");

  if (choice === q.correct) {
    quizAnswered = true;

    const points = quizAttempts === 0 ? 2 : 1;
    quizScore += points;

    label.classList.add("correct");

    $("quizFeedback").textContent =
      `¡Correcto! +${points} punto(s). ${q.explanation}`;

  } else {
    quizAttempts++;

    label.classList.add("wrong");
    selected.checked = false;
    selected.disabled = true;

    if (quizAttempts === 1) {
      $("quizFeedback").textContent =
        "Incorrecto. Tienes un segundo intento por 1 punto.";
      return;
    }

    quizAnswered = true;

    $("quizOptions")
      .children[q.correct]
      .classList.add("correct");

    $("quizFeedback").textContent =
      "Respuesta correcta: " +
      q.options[q.correct] + ". " + q.explanation;
  }

  $("quizScore").textContent = `${quizScore}/10`;

  $("quizCheck").disabled = true;
  $("quizNext").disabled = false;

  document.querySelectorAll(
    'input[name="quizAnswer"]'
  ).forEach(input => input.disabled = true);
}

function nextQuestion() {
  if (!quizAnswered) return;

  if (quizIndex < questions.length - 1) {
    quizIndex++;
    showQuestion();
    return;
  }

  $("quizProgress").style.width = "100%";
  $("quizCounter").textContent = "Actividad finalizada";
  $("quizQuestion").textContent = "¡Desafío completado!";
  $("quizOptions").replaceChildren();

  $("quizCheck").disabled = true;
  $("quizNext").disabled = true;

  $("quizFinal").hidden = false;
  $("quizFinal").textContent =
    `Calificación final: ${quizScore}/10. ` +
    (
      quizScore >= 7
        ? "Buen trabajo: comprendiste los conceptos."
        : "Explora nuevamente el laboratorio y repite la actividad."
    );
}

$("quizCheck").onclick = checkAnswer;
$("quizNext").onclick = nextQuestion;

$("quizReset").onclick = () => {
  quizIndex = 0;
  quizScore = 0;
  showQuestion();
};

// ==========================================
// INICIALIZACIÓN
// ==========================================

updateOutputs();
resetView(true);
updateVisibleGraphs();
showQuestion();
