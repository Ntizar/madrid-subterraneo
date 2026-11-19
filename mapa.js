// La red del metro, en su sitio.
// Geometría real (network.json, CRTM) + los 12 modelos de estación colocados en su
// ancla geográfica (encaje.json) y girados al rumbo que se midió contra la red.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const $ = (s) => document.querySelector(s);
const lienzo = $('#lienzo');

const R = 6378137.0, LAT0 = 40.4168, LON0 = -3.7038;
const aMetros = (lon, lat) => [
  THREE.MathUtils.degToRad(lon - LON0) * R * Math.cos(THREE.MathUtils.degToRad(LAT0)),
  THREE.MathUtils.degToRad(lat - LAT0) * R,
];
const aMundo = (lon, lat) => { const [x, y] = aMetros(lon, lat); return new THREE.Vector3(x, 0, -y); };

const renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const escena = new THREE.Scene();
escena.fog = new THREE.Fog(0xe7ebee, 30000, 90000);

const camara = new THREE.PerspectiveCamera(38, 1, 20, 260000);
const controles = new OrbitControls(camara, renderer.domElement);
controles.enableDamping = true;
controles.dampingFactor = 0.07;
controles.maxPolarAngle = Math.PI * 0.47;
controles.minDistance = 300;
controles.maxDistance = 120000;

escena.add(new THREE.HemisphereLight(0xf2f6fa, 0x9a8f7d, 1.25));
const sol = new THREE.DirectionalLight(0xfff3e0, 1.9);
sol.position.set(-9000, 16000, 11000);
sol.castShadow = true;
sol.shadow.mapSize.set(2048, 2048);
const sc = sol.shadow.camera;
sc.left = -16000; sc.right = 16000; sc.top = 16000; sc.bottom = -16000;
sc.near = 100; sc.far = 60000;
escena.add(sol);

// suelo neutro
const suelo = new THREE.Mesh(
  new THREE.PlaneGeometry(120000, 120000),
  new THREE.MeshStandardMaterial({ color: 0xefece5, roughness: 0.98, metalness: 0 }));
suelo.rotation.x = -Math.PI / 2;
suelo.position.y = -0.5;
suelo.receiveShadow = true;
escena.add(suelo);

// ---------- cinta a lo largo de una polilínea ---------------------------------
function cinta(puntos, ancho, color, y) {
  const pos = [], idx = [];
  const n = puntos.length;
  if (n < 2) return null;
  for (let i = 0; i < n; i++) {
    const a = puntos[Math.max(0, i - 1)], b = puntos[Math.min(n - 1, i + 1)];
    let dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l * ancho / 2, nz = dx / l * ancho / 2;
    const p = puntos[i];
    pos.push(p.x - nx, y, p.z - nz, p.x + nx, y, p.z + nz);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const malla = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
    color, roughness: 0.62, metalness: 0.02, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  }));
  malla.receiveShadow = true;
  return malla;
}

// ---------- datos ------------------------------------------------------------
const [red, modelos, encaje] = await Promise.all([
  fetch('data/network.json').then((r) => r.json()),
  fetch('data/models.json').then((r) => r.json()),
  fetch('data/encaje.json').then((r) => r.json()),
]);

const porId = new Map(red.lines.map((l) => [String(l.id), l]));
const cajaRed = new THREE.Box3();
const grupoRed = new THREE.Group();
const grupoEstaciones = new THREE.Group();
escena.add(grupoRed, grupoEstaciones);

const porLinea = new Map();   // id línea -> grupo (para encender/apagar)

red.edges.forEach((e) => {
  const linea = porId.get(String(e.line));
  if (!linea) return;
  const pts = e.coords.map((c) => aMundo(c[0], c[1]));
  const yl = 0.6 + (Number(linea.id) || 0) * 0.06;
  const carcasa = cinta(pts, 34, 0xfbfaf6, yl - 0.2);
  const g = cinta(pts, 22, linea.color, yl);
  if (!g) return;
  const idl = String(e.line);
  if (!porLinea.has(idl)) { const gr = new THREE.Group(); porLinea.set(idl, gr); grupoRed.add(gr); }
  if (carcasa) porLinea.get(idl).add(carcasa);
  porLinea.get(idl).add(g);
  pts.forEach((p) => cajaRed.expandByPoint(p));
});

// estaciones: disco con aro
function texturaDisco() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.beginPath(); g.arc(32, 32, 27, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
  g.lineWidth = 5; g.strokeStyle = '#3a352c'; g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const TEX_DISCO = texturaDisco();
const posiciones = [];
red.stations.forEach((s) => {
  const p = aMundo(s.lon, s.lat);
  posiciones.push({ s, p });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX_DISCO, transparent: true, depthTest: false }));
  sp.position.copy(p).setY(12);
  const esc = s.lines.length > 1 ? 320 : 240;
  sp.scale.set(esc, esc, 1);
  sp.userData.estacion = s;
  grupoEstaciones.add(sp);
});

// ---------- modelos 3D en su sitio -------------------------------------------
const cargador = new GLTFLoader();
const modelosColocados = [];
const metaModelos = new Map(modelos.map((m) => [m.id, m]));
const norm = (t) => (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const modeloPorNombre = new Map(modelos.map((m) => [norm(m.name), m]));
const encajePorId = new Map(encaje.estaciones.map((e) => [e.id, e]));

for (const e of encaje.estaciones) {
  if (e.giro_conjunto_deg === undefined || !e.escala) continue;
  const meta = metaModelos.get(e.id);
  if (!meta) continue;
  try {
    const gltf = await cargador.loadAsync('models/' + meta.file.split('/').pop());
    const obj = gltf.scene;
    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      o.material.side = THREE.DoubleSide;
      o.material.roughness = 0.9;
      o.material.metalness = 0;
    });
    // mallas del croquis que son andén (mesh_names del manifiesto)
    const porLinea = new Map();
    (meta.platforms || []).forEach((p) => (p.mesh_names || []).forEach((n) => porLinea.set(n, p.line)));
    obj.traverse((o) => {
      if (!o.isMesh) return;
      const l = porLinea.get(o.name) || porLinea.get(o.parent?.name);
      if (l !== undefined) o.userData.linea = l;
    });
    const pos = aMundo(e.lon, e.lat);
    obj.position.copy(pos).setY(0);
    obj.rotation.y = -THREE.MathUtils.degToRad(e.giro_conjunto_deg || 0);
    obj.scale.setScalar(e.escala);
    // cada andén a su vía real
    (e.andenes || []).forEach((a) => {
      if (!a.via) return;
      const R = new THREE.Matrix4().makeRotationY(-THREE.MathUtils.degToRad(a.giro_fino_deg || 0));
      const T = new THREE.Matrix4().makeTranslation(a.traslacion[0], 0, a.traslacion[1]);
      obj.traverse((o) => {
        if (!o.isMesh || String(o.userData.linea) !== String(a.linea)) return;
        o.updateMatrix();
        o.matrix.premultiply(R).premultiply(T);
        o.matrixAutoUpdate = false;
      });
    });
    obj.userData.encaje = e;
    escena.add(obj);
    modelosColocados.push(obj);
  } catch (err) { console.warn('modelo', e.id, err.message); }
}

// ---------- leyenda ----------------------------------------------------------
const leyenda = $('#leyenda');
[...porLinea.keys()].sort((a, b) => (Number(a) || 99) - (Number(b) || 99)).forEach((id) => {
  const l = porId.get(id);
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'leyenda__b'; b.dataset.linea = id;
  b.innerHTML = `<span class="leyenda__punto" style="background:${l.color}"></span>${id === 'R' ? 'Ramal' : 'L' + id}`;
  b.addEventListener('click', () => {
    const gr = porLinea.get(id);
    gr.visible = !gr.visible;
    b.classList.toggle('is-off', !gr.visible);
  });
  leyenda.appendChild(b);
});

// ---------- interacción -------------------------------------------------------
const rayo = new THREE.Raycaster();
const tarjeta = $('#tarjeta');
let elegida = null;

function pulsar(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  const p = new THREE.Vector2(
    ((ev.clientX - r.left) / r.width) * 2 - 1,
    -((ev.clientY - r.top) / r.height) * 2 + 1);
  rayo.setFromCamera(p, camara);
  const impactos = rayo.intersectObjects(grupoEstaciones.children, false);
  if (!impactos.length) { tarjeta.hidden = true; elegida = null; return; }
  const s = impactos[0].object.userData.estacion;
  elegida = s;
  $('#tarjeta-nombre').textContent = s.name;
  $('#tarjeta-lineas').textContent = 'Líneas ' + s.lines.map((l) => (l === 'R' ? 'Ramal' : l)).join(' · ');
  const modelado = modeloPorNombre.get(norm(s.name));
  const ir = $('#tarjeta-ir');
  if (modelado) {
    ir.hidden = false;
    ir.href = 'estacion.html#' + modelado.id;
    ir.dataset.id = modelado.id;
  } else {
    ir.hidden = true;
  }
  tarjeta.hidden = false;
  $('#tarjeta-lbl').textContent = modelado ? 'Estación modelada en 3D' : 'Estación de la red';
}
renderer.domElement.addEventListener('pointerdown', (ev) => { pulsar(ev); });
$('#tarjeta-ir').addEventListener('click', (ev) => {
  ev.preventDefault();
  const id = ev.currentTarget.dataset.id;
  if (id) location.href = 'estacion.html?e=' + id;
});

// ---------- volar a una estación ---------------------------------------------
let vuelo = null;
function volarA(destino, distancia, ms = 900) {
  vuelo = {
    desde: camara.position.clone(),
    desdeTarget: controles.target.clone(),
    hasta: destino.clone().add(new THREE.Vector3(0, 0, 0)),
    hastaTarget: destino.clone(),
    distancia, t0: performance.now(), ms,
  };
}
function avanzarVuelo(ahora) {
  if (!vuelo) return;
  const k = Math.min(1, (ahora - vuelo.t0) / vuelo.ms);
  const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  const dir = new THREE.Vector3(0.12, 0.95, 0.55).normalize();
  const objetivo = vuelo.hastaTarget.clone().addScaledVector(dir, vuelo.distancia);
  camara.position.lerpVectors(vuelo.desde, objetivo, e);
  controles.target.lerpVectors(vuelo.desdeTarget, vuelo.hastaTarget, e);
  if (k >= 1) vuelo = null;
}

// lista de estaciones modeladas: lleva la cámara a cada una
const lista = document.createElement('div');
lista.className = 'modeladas';
lista.id = 'modeladas';
lista.innerHTML = '<p class="nz-lbl">Modeladas en 3D</p>';
encaje.estaciones.filter((e) => e.giro_conjunto_deg !== undefined).forEach((e) => {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'modeladas__b';
  b.textContent = e.nombre;
  b.addEventListener('click', () => {
    volarA(aMundo(e.lon, e.lat), 2200);
    $('#tarjeta-nombre').textContent = e.nombre;
    $('#tarjeta-lineas').textContent = 'Andenes encajados en su vía · escala ' + e.escala;
    const meta = encaje.estaciones.find((x) => x.id === e.id);
    const ir = $('#tarjeta-ir');
    ir.hidden = false; ir.dataset.id = e.id; ir.href = 'estacion.html?e=' + e.id;
    tarjeta.hidden = false;
    $('#tarjeta-lbl').textContent = 'Estación modelada en 3D';
  });
  lista.appendChild(b);
});
document.body.appendChild(lista);

// ---------- cámara y bucle ----------------------------------------------------
function encuadrarRed() {
  const centro = cajaRed.getCenter(new THREE.Vector3());
  const tam = cajaRed.getSize(new THREE.Vector3());
  const radio = Math.max(tam.x, tam.z) * 0.5;
  const dist = radio / Math.tan(THREE.MathUtils.degToRad(camara.fov / 2)) * 0.72;
  const dir = new THREE.Vector3(0.02, 1.35, 0.62).normalize();
  camara.position.copy(centro).addScaledVector(dir, dist);
  controles.target.copy(centro);
  controles.update();
}

function ajustar() {
  const caja = lienzo.getBoundingClientRect();
  renderer.setSize(caja.width, caja.height, false);
  camara.aspect = caja.width / Math.max(1, caja.height);
  camara.updateProjectionMatrix();
}
window.addEventListener('resize', ajustar);

function bucle(ahora) {
  requestAnimationFrame(bucle);
  avanzarVuelo(ahora || performance.now());
  controles.update();
  renderer.render(escena, camara);
}

ajustar(); encuadrarRed(); bucle();

// diagnóstico / verificación
window.__mapa = {
  escena, camara, controles,
  get estaciones() { return posiciones.length; },
  get lineas() { return porLinea.size; },
  get modelos() { return modelosColocados.length; },
  get caja() { return cajaRed; },
  /** residuo del encaje: ángulo entre el andén del modelo y su vía real, en el mundo */
  residuos() {
    const out = [];
    for (const obj of modelosColocados) {
      const e = obj.userData.encaje;
      const meta = metaModelos.get(e.id);
      obj.updateMatrixWorld(true);
      (e.andenes || []).forEach((a) => {
        if (!a.via || a.via.length < 2) return;
        // vía real (ya en coordenadas de modelo) -> mundo
        const p0 = new THREE.Vector3(a.via[0][0], 0, -a.via[0][1]).applyMatrix4(obj.matrixWorld);
        const p1 = new THREE.Vector3(a.via[a.via.length - 1][0], 0, -a.via[a.via.length - 1][1]).applyMatrix4(obj.matrixWorld);
        const pl = (meta.platforms || []).find((x) => String(x.line) === String(a.linea));
        if (!pl) return;
        const q = pl.path;
        const m0 = new THREE.Vector3(q[0][0], 0, -q[0][2]).applyMatrix4(obj.matrixWorld);
        const m1 = new THREE.Vector3(q[q.length - 1][0], 0, -q[q.length - 1][2]).applyMatrix4(obj.matrixWorld);
        const ang = (u, v) => Math.abs(Math.atan2(u.x * v.z - u.z * v.x, u.x * v.x + u.z * v.z)) * 180 / Math.PI;
        let r = ang(p1.clone().sub(p0), m1.clone().sub(m0));
        if (r > 90) r = 180 - r;
        out.push({ estacion: e.id, linea: a.linea, residuo_deg: +r.toFixed(1) });
      });
    }
    return out;
  },
};
