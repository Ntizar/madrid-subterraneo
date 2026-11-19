// Estaciones en corte · Metro de Madrid
// La estación va DENTRO del terreno: corte de tierra, túneles que salen por las paredes
// y andenes a su nivel. Los niveles son los del archivo de origen (croquis de
// Albert Guillaumes), no profundidades topográficas.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = (s) => document.querySelector(s);
const lienzo = $('#lienzo');
const etiquetasEl = $('#etiquetas');
const cargando = $('#cargando');

const estado = { id: null, nivel: null, tierra: 1, tuneles: true, etiquetas: true, tamano: 1 };

let datos = [], modelos = [], colores = {}, nombresLinea = {};
let encaje = null;   // vías reales en coordenadas del modelo, por estación

// ---------- escena ----------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true, alpha: true });
renderer.setClearAlpha(0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const escena = new THREE.Scene();
escena.fog = new THREE.Fog(0xe4e9ee, 900, 2600);

const camara = new THREE.PerspectiveCamera(38, 1, 0.5, 8000);
const controles = new OrbitControls(camara, renderer.domElement);
controles.enableDamping = true;
controles.dampingFactor = 0.06;
controles.maxPolarAngle = Math.PI * 0.495;
controles.minDistance = 20;
controles.maxDistance = 1600;

// luz de estudio: cielo frío, suelo cálido, un sol suave con sombra
const hemi = new THREE.HemisphereLight(0xeaf1f7, 0x7d6e58, 0.62);
escena.add(new THREE.AmbientLight(0xffffff, 0.1));
escena.add(hemi);
const sol = new THREE.DirectionalLight(0xfff2df, 2.9);
sol.position.set(-260, 420, 300);
sol.castShadow = true;
sol.shadow.mapSize.set(2048, 2048);
sol.shadow.bias = -0.0006;
sol.shadow.normalBias = 0.6;
escena.add(sol);
const relleno = new THREE.DirectionalLight(0xdfe9f5, 0.45);
relleno.position.set(300, 180, -260);
escena.add(relleno);

const raiz = new THREE.Group();       // todo el corte de la estación actual
escena.add(raiz);

// ---------- texturas procedurales -------------------------------------------
function canvasTex(ancho, alto, pintar) {
  const c = document.createElement('canvas');
  c.width = ancho; c.height = alto;
  pintar(c.getContext('2d'), ancho, alto);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function texturaEstratos() {
  return canvasTex(256, 512, (g, w, h) => {
    const capas = ['#6b5742', '#7b6549', '#8a7256', '#5d4b3a', '#93795a', '#6f5b46'];
    let y = 0, i = 0;
    while (y < h) {
      const alto = 22 + Math.random() * 46;
      g.fillStyle = capas[i++ % capas.length];
      g.fillRect(0, y, w, alto + 1);
      // grano y piedras
      for (let k = 0; k < 220; k++) {
        g.fillStyle = Math.random() > 0.5 ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.05)';
        g.fillRect(Math.random() * w, y + Math.random() * alto, 1 + Math.random() * 2, 1 + Math.random() * 2);
      }
      y += alto;
    }
    // alguna veta de arena más clara
    g.globalAlpha = 0.18; g.fillStyle = '#c8b394';
    for (let k = 0; k < 6; k++) g.fillRect(0, Math.random() * h, w, 2 + Math.random() * 5);
    g.globalAlpha = 1;
  });
}

function texturaSuelo() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#d8d2c4'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 9000; k++) {
      g.fillStyle = Math.random() > 0.5 ? 'rgba(120,110,95,.05)' : 'rgba(255,255,255,.06)';
      g.fillRect(Math.random() * w, Math.random() * h, 1, 1);
    }
    g.strokeStyle = 'rgba(120,112,98,.22)'; g.lineWidth = 1;
    for (let x = 0; x <= w; x += w / 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += h / 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  });
}

const TEX_ESTRATOS = texturaEstratos();
const TEX_SUELO = texturaSuelo();

// ---------- materiales -------------------------------------------------------
function matConcreto(color, rugosidad = 0.92) {
  return new THREE.MeshStandardMaterial({ color, roughness: rugosidad, metalness: 0, side: THREE.DoubleSide });
}

const MAT = {
  suelo: new THREE.MeshStandardMaterial({ map: TEX_SUELO, roughness: 0.96, metalness: 0 }),
  tierra: new THREE.MeshStandardMaterial({ map: TEX_ESTRATOS, roughness: 1, metalness: 0 }),
  borde: new THREE.MeshStandardMaterial({ color: 0x9c9484, roughness: 0.95, metalness: 0 }),
  tunel: new THREE.MeshStandardMaterial({ color: 0x3b3833, roughness: 0.88, metalness: 0.05, side: THREE.DoubleSide }),
  anden: matConcreto(0xd6d0c4),
  muro: matConcreto(0xc9c2b5),
  techo: matConcreto(0xb9b2a6),
  vacio: new THREE.MeshStandardMaterial({ color: 0x272522, roughness: 0.95, metalness: 0 }),
};

// ---------- terreno ----------------------------------------------------------
function bloquesTerreno(caja) {
  const tam = caja.getSize(new THREE.Vector3());
  const cx = (caja.min.x + caja.max.x) / 2;
  const cz = (caja.min.z + caja.max.z) / 2;
  const mar = 8;
  const anchoPozo = tam.x + mar * 2;
  const fondoPozo = tam.z + mar * 2;
  const margenCalle = 30;
  const anchoCalle = anchoPozo + margenCalle * 2;
  const fondoCalle = fondoPozo + margenCalle * 2;
  const base = caja.min.y - Math.max(8, tam.y * 0.12);

  const g = new THREE.Group();
  g.name = 'terreno';

  // 1) calle con el hueco del pozo recortado: el corte se ve desde arriba
  const forma = new THREE.Shape();
  forma.moveTo(-anchoCalle / 2, -fondoCalle / 2);
  forma.lineTo(anchoCalle / 2, -fondoCalle / 2);
  forma.lineTo(anchoCalle / 2, fondoCalle / 2);
  forma.lineTo(-anchoCalle / 2, fondoCalle / 2);
  forma.closePath();
  const hueco = new THREE.Path();
  hueco.moveTo(-anchoPozo / 2, -fondoPozo / 2);
  hueco.lineTo(-anchoPozo / 2, fondoPozo / 2);
  hueco.lineTo(anchoPozo / 2, fondoPozo / 2);
  hueco.lineTo(anchoPozo / 2, -fondoPozo / 2);
  hueco.closePath();
  forma.holes.push(hueco);

  const geoCalle = new THREE.ShapeGeometry(forma, 8);
  const matCalle = MAT.suelo.clone();
  matCalle.map = TEX_SUELO.clone();
  matCalle.map.repeat.set(anchoCalle / 26, fondoCalle / 26);
  matCalle.map.needsUpdate = true;
  const calle = new THREE.Mesh(geoCalle, matCalle);
  calle.rotation.x = -Math.PI / 2;
  calle.position.set(cx, 0, cz);
  calle.receiveShadow = true;
  g.add(calle);

  // 2) paredes del pozo, mirando hacia dentro
  const alto = -base;
  const pared = (w, x, z, rotY) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, alto), MAT.tierra.clone());
    m.material.map = TEX_ESTRATOS.clone();
    m.material.map.repeat.set(w / 26, alto / 22);
    m.material.map.needsUpdate = true;
    m.position.set(x, -alto / 2, z);
    m.rotation.y = rotY;
    m.receiveShadow = true;
    m.castShadow = true;
    return m;
  };
  const paredes = [
    pared(anchoPozo, cx, cz - fondoPozo / 2, 0),
    pared(anchoPozo, cx, cz + fondoPozo / 2, Math.PI),
    pared(fondoPozo, cx - anchoPozo / 2, cz, Math.PI / 2),
    pared(fondoPozo, cx + anchoPozo / 2, cz, -Math.PI / 2),
  ];
  paredes.forEach((m) => g.add(m));

  // 3) solera
  const solera = new THREE.Mesh(new THREE.PlaneGeometry(anchoPozo, fondoPozo), MAT.tierra.clone());
  solera.material.map = TEX_ESTRATOS.clone();
  solera.material.map.repeat.set(anchoPozo / 30, fondoPozo / 30);
  solera.material.map.needsUpdate = true;
  solera.rotation.x = -Math.PI / 2;
  solera.position.set(cx, base - 0.15, cz);
  solera.receiveShadow = true;
  g.add(solera);

  // 4) edificios de la manzana: dan escala y contexto de ciudad
  const rnd = (a, b) => a + Math.random() * (b - a);
  const matFachada = new THREE.MeshStandardMaterial({ color: 0xd9d2c5, roughness: 0.9, metalness: 0 });
  const matFachada2 = new THREE.MeshStandardMaterial({ color: 0xc8c0b2, roughness: 0.92, metalness: 0 });
  const edificios = new THREE.Group();
  const altoEdificio = Math.max(14, Math.min(22, Math.abs(tam.y) * 0.7));
  // dos hileras al fondo y a la izquierda: leen como manzana, no como cajas sueltas
  for (let k = 0; k < 11; k++) {
    const anchoE = rnd(9, 16), fondoE = rnd(9, 16), altura = rnd(altoEdificio * 0.5, altoEdificio);
    const alFondo = k < 7;
    const x = alFondo
      ? cx - anchoCalle / 2 + 6 + (k * (anchoCalle - 12)) / 7 + rnd(-2, 2)
      : cx - anchoPozo / 2 - rnd(12, margenCalle - 6);
    const z = alFondo
      ? cz - fondoPozo / 2 - rnd(11, margenCalle - 6)
      : cz + rnd(-fondoCalle / 2 + 8, fondoCalle / 2 - 8);
    const e = new THREE.Mesh(new THREE.BoxGeometry(anchoE, altura, fondoE), k % 3 ? matFachada : matFachada2);
    e.position.set(x, altura / 2, z);
    e.castShadow = true; e.receiveShadow = true;
    edificios.add(e);
  }
  g.add(edificios);

  return { grupo: g, paredes, fondo: base, ancho: anchoPozo, fondo2: fondoPozo, mar, cx, cz, calle, edificios };
}

// ---------- estación ---------------------------------------------------------
const cargador = new GLTFLoader();

function materialesEstacion(gltf, metadatos) {
  const andenes = new Map(); // nombreMalla -> línea
  (metadatos.platforms || []).forEach((p) => (p.mesh_names || []).forEach((n) => andenes.set(n, p.line)));

  const cache = new Map();
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    const linea = andenes.get(o.name) || andenes.get(o.parent?.name);
    if (linea) {
      const col = colores[linea] || '#8b8b8b';
      o.material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(col), roughness: 0.55, metalness: 0.05,
        emissive: new THREE.Color(col).multiplyScalar(0.12), side: THREE.DoubleSide,
      });
      o.userData.linea = linea;
      return;
    }
    const viejo = o.material;
    const hex = viejo?.color ? viejo.color.getHex() : 0xcccccc;
    const clave = hex;
    if (!cache.has(clave)) {
      const c = new THREE.Color(hex);
      const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      let mat;
      if (lum < 0.18) mat = MAT.vacio.clone();                       // negro del croquis = hueco
      else if (lum > 0.86) mat = MAT.anden.clone();                  // blanco = andén
      else if (lum > 0.7) mat = MAT.muro.clone();                    // paredes
      else mat = matConcreto(new THREE.Color().setHSL(c.getHSL({}).h, 0.05, 0.42 + lum * 0.2), 0.94);
      cache.set(clave, mat);
    }
    o.material = cache.get(clave);
  });
  return gltf.scene;
}


// curva paralela a una dada, desplazada lateralmente d metros
function curvaDesplazada(curva, d, n = 60) {
  const pts = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = curva.getPoint(t);
    const tg = curva.getTangent(t).setY(0).normalize();
    const lado = new THREE.Vector3().crossVectors(tg, up).normalize();
    pts.push(p.clone().addScaledVector(lado, d));
  }
  return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2);
}


// silueta de persona para dar escala (sprite procedural)
function texturaPersona() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#2c2a26';
  g.beginPath(); g.arc(32, 18, 10, 0, Math.PI * 2); g.fill();          // cabeza
  g.beginPath(); g.moveTo(20, 30); g.lineTo(44, 30); g.lineTo(40, 78); g.lineTo(24, 78); g.closePath(); g.fill();
  g.fillRect(24, 78, 6, 44); g.fillRect(34, 78, 6, 44);                // piernas
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const TEX_PERSONA = texturaPersona();

function detalleAnden(g, curva, p, ancho) {
  const cota = p.level_in_file ?? 0;
  const largo = curva.getLength();
  const up = new THREE.Vector3(0, 1, 0);

  // franja amarilla de borde de andén a los dos lados
  [-1, 1].forEach((signo) => {
    const borde = curvaDesplazada(curva, signo * (ancho / 2 - 0.35), 80);
    const pts = borde.getPoints(80).map((q) => new THREE.Vector3(q.x, cota + 0.03, q.z));
    const c2 = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2);
    const banda = new THREE.Mesh(
      new THREE.TubeGeometry(c2, Math.max(40, Math.round(c2.getLength() / 3)), 0.30, 4, false),
      new THREE.MeshStandardMaterial({ color: 0xe8b93a, roughness: 0.6 }));
    banda.scale.y = 0.08;
    banda.userData.linea = p.line;
    g.add(banda);
  });

  // columnas cada ~9 m a los dos lados del andén
  const paso = 9 / Math.max(1, largo);
  for (let t = 0.06; t < 0.97; t += paso) {
    const pt = curva.getPoint(t);
    const tg = curva.getTangent(t).setY(0).normalize();
    const lado = new THREE.Vector3().crossVectors(tg, up).normalize();
    [-1, 1].forEach((signo) => {
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24, 0.24, 3.1, 10),
        new THREE.MeshStandardMaterial({ color: 0xcac2b6, roughness: 0.85 }));
      col.position.copy(pt).addScaledVector(lado, signo * (ancho / 2 - 0.6));
      col.position.y = cota + 1.55;
      col.castShadow = true;
      col.userData.linea = p.line;
      g.add(col);
    });
  }

  // gente: escala humana
  const n = Math.max(3, Math.min(10, Math.round(largo / 18)));
  for (let k = 0; k < n; k++) {
    const t = 0.1 + Math.random() * 0.8;
    const pt = curva.getPoint(t);
    const tg = curva.getTangent(t).setY(0).normalize();
    const lado = new THREE.Vector3().crossVectors(tg, up).normalize();
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX_PERSONA, transparent: true, depthWrite: false }));
    sp.position.copy(pt).addScaledVector(lado, (Math.random() - 0.5) * (ancho - 1.6));
    sp.position.y = cota + 0.88;
    sp.scale.set(0.9, 1.78, 1);
    sp.userData.linea = p.line;
    g.add(sp);
  }
}


// Arco de túnel construido a mano: el hueco de la clave siempre mira hacia arriba
// (con TubeGeometry el giro del marco depende de la curva y la abertura acaba de lado).
function arcoTunel(curva, radio, angIni, angFin, nSeg = 90, nRad = 10) {
  const up = new THREE.Vector3(0, 1, 0);
  const pos = [], nor = [], uv = [], idx = [];
  for (let i = 0; i <= nSeg; i++) {
    const t = i / nSeg;
    const p = curva.getPoint(t);
    const tg = curva.getTangent(t).normalize();
    const side = new THREE.Vector3().crossVectors(tg, up).normalize().negate();
    for (let j = 0; j <= nRad; j++) {
      const a = angIni + (angFin - angIni) * (j / nRad);
      const dir = new THREE.Vector3().addScaledVector(side, Math.cos(a)).addScaledVector(up, Math.sin(a));
      const v = p.clone().addScaledVector(dir, radio);
      pos.push(v.x, v.y, v.z);
      nor.push(-dir.x, -dir.y, -dir.z);       // normal hacia dentro
      uv.push(j / nRad, i / nSeg);
    }
  }
  const ancho = nRad + 1;
  for (let i = 0; i < nSeg; i++) {
    for (let j = 0; j < nRad; j++) {
      const a = i * ancho + j, b = a + ancho;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function tunelesEstacion(metadatos, enc) {
  const g = new THREE.Group();
  g.name = 'tuneles';
  (metadatos.platforms || []).forEach((p) => {
    const anden = (enc?.andenes || []).find((a) => String(a.linea) === String(p.line));
    let pts;
    if (anden?.via && anden.via.length >= 2) {
      // vía real (del CRTM) en coordenadas del modelo, a la cota del andén
      const cotaV = p.level_in_file ?? 0;
      pts = anden.via.map(([x, z]) => new THREE.Vector3(x, cotaV, z));
    } else {
      pts = (p.path || []).map(([x, y, z]) => new THREE.Vector3(x, y, z));
    }
    if (pts.length < 2) return;
    const a = pts[0], b = pts[pts.length - 1];
    const dirA = new THREE.Vector3().subVectors(pts[0], pts[1]).normalize();
    const dirB = new THREE.Vector3().subVectors(pts[pts.length - 1], pts[pts.length - 2]).normalize();
    const cuerpo = [a.clone().addScaledVector(dirA, 26), ...pts, b.clone().addScaledVector(dirB, 26)];
    const curva = new THREE.CatmullRomCurve3(cuerpo, false, 'catmullrom', 0.35);
    const largo = curva.getLength();
    const seg = Math.max(32, Math.round(largo / 2.2));
    const RADIO = 7.4;
    const anchoAnden = Number(p.platform_width || 7);

    // bóveda: tres piezas (hombro izquierdo, hombro derecho y contrabóveda)
    // con la clave abierta, para que se vea el andén desde arriba
    const matBoveda = new THREE.MeshStandardMaterial({
      color: 0x9e968b, roughness: 0.96, metalness: 0, side: THREE.DoubleSide,
    });
    const piezas = [
      arcoTunel(curva, RADIO, Math.PI * 0.60, Math.PI * 1.00, seg),          // hombro izquierdo
      arcoTunel(curva, RADIO, Math.PI * 0.00, Math.PI * 0.40, seg),          // hombro derecho
      arcoTunel(curva, RADIO, Math.PI * 1.00, Math.PI * 2.00, seg),          // contrabóveda
    ];
    piezas.forEach((geo) => {
      const m = new THREE.Mesh(geo, matBoveda);
      m.castShadow = true; m.receiveShadow = true;
      m.userData.linea = p.line;
      g.add(m);
    });

    // línea de color de la línea, en el arranque de la bóveda a cada lado
    const color = new THREE.Color(colores[p.line] || '#888888');
    [-1, 1].forEach((signo) => {
      const eje = curvaDesplazada(curva, signo * (RADIO - 0.06), 70);
      const pts = eje.getPoints(70).map((q) => new THREE.Vector3(q.x, q.y + 0.15, q.z));
      const c2 = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2);
      const franja = new THREE.Mesh(
        new THREE.TubeGeometry(c2, Math.max(40, Math.round(c2.getLength() / 2.5)), 0.14, 5, false),
        new THREE.MeshStandardMaterial({ color, roughness: 0.5, emissive: color.clone().multiplyScalar(0.18) }));
      franja.userData.linea = p.line;
      g.add(franja);
    });

    // vías: dos haces laterales (balasto + dos carriles) al nivel de la solera del túnel
    const desvio = Math.min(4.2, Math.max(2.6, anchoAnden / 2 + 1.5));
    const yVia = (p.level_in_file ?? 0) - 1.0;
    [-desvio, desvio].forEach((d) => {
      const eje = curvaDesplazada(curva, d, 90);
      const pts2 = eje.getPoints(90).map((q) => new THREE.Vector3(q.x, yVia, q.z));
      const via = new THREE.CatmullRomCurve3(pts2, false, 'catmullrom', 0.2);
      const balasto = new THREE.Mesh(
        new THREE.TubeGeometry(via, Math.max(40, Math.round(via.getLength() / 2)), 1.5, 8, false),
        new THREE.MeshStandardMaterial({ color: 0x4a443d, roughness: 1 }));
      balasto.scale.y = 0.16;
      balasto.receiveShadow = true;
      balasto.userData.linea = p.line;
      g.add(balasto);
      [-0.75, 0.75].forEach((off) => {
        const viaCarril = curvaDesplazada(via, off, 40);
        const carril = new THREE.Mesh(
          new THREE.TubeGeometry(viaCarril, Math.max(40, Math.round(viaCarril.getLength() / 2)), 0.09, 5, false),
          new THREE.MeshStandardMaterial({ color: 0x8f8b84, roughness: 0.35, metalness: 0.75 }));
        carril.scale.y = 0.45;
        carril.userData.linea = p.line;
        g.add(carril);
      });
    });

    detalleAnden(g, curva, p, anchoAnden);

    (g.userData.anclas ||= []).push({
      pos: curva.getPoint(0.5).clone().add(new THREE.Vector3(0, 5.4, 0)),
      linea: p.line,
      cota: p.level_in_file,
    });
  });
  return g;
}

// Convierte las losas del croquis (1 m de espesor, flotando) en volúmenes:
// cada placa se extruye 3,2 m hacia abajo con sus muros, así se lee como arquitectura.
function volumenesDePlacas(est, metadatos) {
  const plataformas = new Set();
  (metadatos.platforms || []).forEach((p) => (p.mesh_names || []).forEach((n) => plataformas.add(n)));

  const grupo = new THREE.Group();
  grupo.name = 'volumenes';
  const muro = new THREE.MeshStandardMaterial({ color: 0xc4bcb0, roughness: 0.94, metalness: 0, side: THREE.DoubleSide });
  const losa = new THREE.MeshStandardMaterial({ color: 0xd0c9bd, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  const alto = 3.2;

  const mallas = [];
  est.traverse((o) => { if (o.isMesh) mallas.push(o); });

  mallas.forEach((o) => {
    const esAnden = o.userData.linea || plataformas.has(o.name.replace('.002', ''));
    if (esAnden) return;
    o.geometry.computeBoundingBox();
    const caja = o.geometry.boundingBox.clone();
    const tam = caja.getSize(new THREE.Vector3());
    if (tam.x * tam.z < 12) return;          // piezas pequeñas: se quedan como están
    const yTop = caja.max.y;

    // contorno de la cara superior
    const bordes = new THREE.EdgesGeometry(o.geometry, 24);
    const pos = bordes.attributes.position;
    const quads = [];
    for (let k = 0; k < pos.count; k += 2) {
      const ax = pos.getX(k), ay = pos.getY(k), az = pos.getZ(k);
      const bx = pos.getX(k + 1), by = pos.getY(k + 1), bz = pos.getZ(k + 1);
      if (Math.abs(ay - yTop) > 0.35 || Math.abs(by - yTop) > 0.35) continue;
      quads.push([ax, ay, az, bx, by, bz]);
    }
    if (!quads.length) return;
    const vert = [];
    const nor = [];
    quads.forEach(([ax, ay, az, bx, by, bz]) => {
      const dx = bx - ax, dz = bz - az;
      const nx = dz, nz = -dx;
      const l = Math.hypot(nx, nz) || 1;
      // dos triángulos: a, b, b-abajo / a, b-abajo, a-abajo
      vert.push(ax, ay, az, bx, by, bz, bx, by - alto, bz);
      vert.push(ax, ay, az, bx, by - alto, bz, ax, ay - alto, az);
      for (let t = 0; t < 6; t++) nor.push(nx / l, 0, nz / l);
    });
    const geoMuros = new THREE.BufferGeometry();
    geoMuros.setAttribute('position', new THREE.Float32BufferAttribute(vert, 3));
    geoMuros.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    const m = new THREE.Mesh(geoMuros, muro);
    m.castShadow = true; m.receiveShadow = true;
    m.position.copy(o.position); m.quaternion.copy(o.quaternion); m.scale.copy(o.scale);
    (o.parent || grupo).add(m);

    // tapa inferior: la misma planta, desplazada
    const geo = o.geometry.clone();
    geo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, -alto, 0));
    const t = new THREE.Mesh(geo, losa);
    t.receiveShadow = true; t.castShadow = true;
    t.position.copy(o.position);
    t.quaternion.copy(o.quaternion);
    t.scale.copy(o.scale);
    (o.parent || grupo).add(t);

    // la placa original pierde su material plano y pasa a ser el suelo de la sala
    o.material = losa;
  });
  return grupo;
}

function luces(meta) {
  const g = new THREE.Group();
  (meta.platforms || []).forEach((p) => {
    const pts = (p.path || []).map(([x, y, z]) => new THREE.Vector3(x, y, z));
    if (!pts.length) return;
    const mid = pts[Math.floor(pts.length / 2)];
    const l = new THREE.PointLight(0xffe7c2, 90, 90, 2);
    l.position.set(mid.x, mid.y + 2.6, mid.z);
    g.add(l);
  });
  return g;
}

// ---------- carga de una estación -------------------------------------------
let actual = null;

async function cargarEstacion(id, opciones = {}) {
  const meta = modelos.find((m) => m.id === id) || modelos[0];
  estado.id = meta.id;
  cargando.hidden = false;

  if (actual) { raiz.remove(actual); actual.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); actual = null; }

  const gltf = await cargador.loadAsync('models/' + meta.file.split('/').pop());
  const est = materialesEstacion(gltf, meta);
  est.updateMatrixWorld(true);

  const caja = new THREE.Box3().setFromObject(est);
  const centro = caja.getCenter(new THREE.Vector3());
  est.position.x -= centro.x;
  est.position.z -= centro.z;
  caja.translate(new THREE.Vector3(-centro.x, 0, -centro.z));
  const enc = encaje?.get(meta.id) || null;
  alinearAndenes(est, enc);
  const mallaTuneles = tunelesEstacion(meta, enc);
  const volumenes = volumenesDePlacas(est, meta);
  const terreno = bloquesTerreno(caja);

  const grupo = new THREE.Group();
  grupo.add(terreno.grupo, est, volumenes, mallaTuneles, luces(meta));
  grupo.userData = { caja, terreno, tuneles: mallaTuneles, est };
  raiz.add(grupo);
  actual = grupo;

  // sombra del sol ajustada al tamaño de la estación
  const r = caja.getSize(new THREE.Vector3()).length() / 2;
  const d = Math.max(120, r * 1.6);
  const cam = sol.shadow.camera;
  cam.left = -d; cam.right = d; cam.top = d; cam.bottom = -d;
  cam.near = 1; cam.far = d * 6;
  cam.updateProjectionMatrix();
  sol.position.set(-r * 1.2, r * 1.9, r * 1.3);

  aplicarTierra(); aplicarTuneles();
  construirNiveles(meta);
  pintarFicha(meta);
  const cajaDiorama = new THREE.Box3().setFromObject(grupo);
  grupo.userData.cajaDiorama = cajaDiorama;
  // el encuadre se centra en el pozo: es lo que hay que leer
  const cajaPozo = caja.clone().expandByScalar(6);
  cajaPozo.max.y = Math.max(caja.max.y, 2);
  if (opciones.encuadrar !== false) encuadrar(cajaPozo, meta);
  etiquetasHTML(meta);
  cargando.hidden = true;
  ubicacion(meta.id);
}

// Gira cada andén del croquis hasta que su eje coincide con el de su vía real
function alinearAndenes(est, enc) {
  if (!enc) return;
  est.rotation.y = -THREE.MathUtils.degToRad(enc.giro_conjunto_deg || 0);
  (enc.andenes || []).forEach((a) => {
    if (!a.via) return;
    const R = new THREE.Matrix4().makeRotationY(-THREE.MathUtils.degToRad(a.giro_fino_deg || 0));
    const T = new THREE.Matrix4().makeTranslation(a.traslacion[0], 0, a.traslacion[1]);
    est.traverse((o) => {
      if (!o.isMesh || String(o.userData.linea) !== String(a.linea)) return;
      o.updateMatrix();
      o.matrix.premultiply(R).premultiply(T);
      o.matrixAutoUpdate = false;
      o.updateMatrixWorld(true);
    });
  });
}

function encuadrar(caja, meta) {
  const centro = caja.getCenter(new THREE.Vector3());
  centro.y = caja.min.y * 0.55;
  const dir = new THREE.Vector3(0.92, 0.44, 1).normalize();   // vista baja, de esquina
  const vFov = THREE.MathUtils.degToRad(camara.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camara.aspect);
  const ejex = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
  const ejey = new THREE.Vector3().crossVectors(dir, ejex).normalize();
  let maxX = 0, maxY = 0, maxZ = 0;
  const p = new THREE.Vector3();
  for (let k = 0; k < 8; k++) {
    p.set(k & 1 ? caja.max.x : caja.min.x, k & 2 ? caja.max.y : caja.min.y, k & 4 ? caja.max.z : caja.min.z).sub(centro);
    maxX = Math.max(maxX, Math.abs(p.dot(ejex)));
    maxY = Math.max(maxY, Math.abs(p.dot(ejey)));
    maxZ = Math.max(maxZ, p.dot(dir));
  }
  const dist = Math.max(maxY / Math.tan(vFov / 2), maxX / Math.tan(hFov / 2)) * 1.04 + maxZ;
  camara.position.copy(centro).addScaledVector(dir, dist);
  camara.near = Math.max(0.3, dist / 400);
  camara.far = dist * 10;
  camara.updateProjectionMatrix();
  controles.target.copy(centro);
  controles.maxDistance = dist * 2.2;
  controles.update();
}

// ---------- niveles ------------------------------------------------------------
function cota(p) {
  const v = Number(p.level_in_file ?? 0);
  return (Math.abs(v) < 0.6 ? 0 : v);
}
function textoCota(p) {
  const v = cota(p);
  return v === 0 ? 'a ras de calle' : `${v.toFixed(1).replace('.', ',')} m`;
}

function construirNiveles(meta) {
  const cont = $('#niveles');
  cont.innerHTML = '';
  const niveles = [...(meta.platforms || [])].sort((a, b) => cota(b) - cota(a));
  if (!niveles.length) { cont.innerHTML = '<p class="nz-text--muted nz-text--small">Sin andenes documentados.</p>'; return; }
  niveles.forEach((p, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'nivel' + (estado.nivel === null && i === 0 ? '' : '');
    b.dataset.linea = p.line;
    b.innerHTML = `<span class="nivel__punto" style="background:${colores[p.line] || '#999'}"></span>
      <span class="nivel__txt">${nombresLinea[p.line] || 'L' + p.line}</span>
      <span class="nivel__cota">${textoCota(p)}</span>`;
    b.addEventListener('click', () => enfocarNivel(p.line));
    cont.appendChild(b);
  });
  estado.nivel = null;
}

function enfocarNivel(linea) {
  const grupo = actual; if (!grupo) return;
  estado.nivel = estado.nivel === linea ? null : linea;
  const objetivo = estado.nivel;
  document.querySelectorAll('.nivel').forEach((b) => b.classList.toggle('is-on', b.dataset.linea === objetivo));

  grupo.traverse((o) => {
    if (!o.isMesh || !o.userData.linea) return;
    const esObjetivo = objetivo === null || o.userData.linea === objetivo;
    o.material.transparent = objetivo !== null && !esObjetivo;
    o.material.opacity = esObjetivo ? 1 : 0.22;
    o.material.needsUpdate = true;
    if (o.isMesh && o.material.emissive) {
      const col = new THREE.Color(colores[o.userData.linea] || '#999');
      o.material.emissive.copy(col).multiplyScalar(objetivo === o.userData.linea ? 0.35 : 0.1);
    }
  });

  // cámara al nivel elegido
  const meta = modelos.find((m) => m.id === estado.id);
  const caja = grupo.userData.caja;
  const p = (meta.platforms || []).find((x) => x.line === objetivo);
  const y = p ? cota(p) : null;
  const tam = caja.getSize(new THREE.Vector3());
  if (y !== null) {
    const dist = Math.max(tam.x, tam.z) * 0.95;
    const dir = new THREE.Vector3(0.9, 0.35, 1).normalize();
    controles.target.set(0, y, 0);
    camara.position.set(0, y, 0).addScaledVector(dir, dist);
    controles.update();
  } else {
    encuadrar(grupo.userData.cajaDiorama || caja, meta);
  }
  aplicarTierra();
}

// ---------- capas y controles ---------------------------------------------------
function aplicarTierra() {
  const g = actual; if (!g) return;
  const t = estado.tierra;
  (g.userData.terreno.paredes || []).forEach((m) => {
    m.visible = t > 0.02;
    m.material.transparent = t < 0.99;
    m.material.opacity = 0.18 + 0.82 * t;
    m.material.needsUpdate = true;
  });
  g.userData.terreno.grupo.visible = true;
}

function aplicarTuneles() {
  const g = actual; if (!g) return;
  g.userData.tuneles.visible = estado.tuneles;
}

// ---------- etiquetas en pantalla -----------------------------------------------
let anclas = [];
function etiquetasHTML(meta) {
  etiquetasEl.innerHTML = '';
  anclas = [];
  const g = actual; if (!g) return;
  (g.userData.tuneles.userData.anclas || []).forEach((a) => {
    const div = document.createElement('div');
    div.className = 'etiq';
    div.textContent = `${nombresLinea[a.linea] || 'L' + a.linea} · ${Number(a.cota).toFixed(1).replace('.', ',')} m`;
    etiquetasEl.appendChild(div);
    anclas.push({ div, pos: a.pos.clone(), linea: a.linea, cota: a.cota });
  });
}

const v3 = new THREE.Vector3();
function pintarEtiquetas() {
  if (!estado.etiquetas || !anclas.length) { etiquetasEl.style.display = 'none'; return; }
  etiquetasEl.style.display = '';
  const ancho = renderer.domElement.clientWidth, alto = renderer.domElement.clientHeight;
  anclas.forEach((a) => {
    v3.copy(a.pos).project(camara);
    const visible = v3.z < 1 && a.pos.y < 0.5;
    const enFoco = estado.nivel === null || estado.nivel === a.linea;
    a.div.style.display = visible && enFoco ? '' : 'none';
    a.div.style.left = ((v3.x * 0.5 + 0.5) * ancho).toFixed(1) + 'px';
    a.div.style.top = ((-v3.y * 0.5 + 0.5) * alto).toFixed(1) + 'px';
  });
}

// ---------- ficha / url --------------------------------------------------------
function pintarFicha(meta) {
  const n = (meta.platforms || []).length;
  const tipo = meta.kind === 'original' ? 'Modelo original de Albert Guillaumes' : 'Reconstrucción del croquis';
  $('#ficha').textContent = `${tipo} · ${n} ${n === 1 ? 'andén' : 'andenes'} · ${meta.subtitle || ''}`;
  $('#aviso').textContent = meta.kind === 'original'
    ? 'Los niveles son los del archivo de origen: sirven para leer el orden y la separación, no son cotas topográficas.'
    : 'Reconstrucción esquemática: escala y alturas convencionales.';
  $('#sub').textContent = `${meta.name}: la estación dentro del terreno, con sus túneles saliendo por el corte.`;
}

function ubicacion(id) {
  const u = new URL(location.href);
  u.hash = 'e=' + id;
  history.replaceState(null, '', u);
}

// ---------- arranque ------------------------------------------------------------
async function inicio() {
  const [red, mods, enc] = await Promise.all([
    fetch('data/network.json').then((r) => r.json()),
    fetch('data/models.json').then((r) => r.json()),
    fetch('data/encaje.json').then((r) => r.json()).catch(() => ({ estaciones: [] })),
  ]);
  modelos = mods;
  encaje = new Map((enc.estaciones || []).filter((e) => e.giro_conjunto_deg !== undefined).map((e) => [e.id, e]));
  (red.lines || []).forEach((l) => {
    colores[l.id] = l.color;
    nombresLinea[l.id] = l.id === 'R' ? 'Ramal' : 'L' + l.id;
  });

  const sel = $('#sel-estacion');
  mods.forEach((m) => {
    const o = document.createElement('option');
    o.value = m.id; o.textContent = m.name;
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => { estado.nivel = null; cargarEstacion(sel.value); });

  $('#tierra').addEventListener('input', (e) => { estado.tierra = e.target.value / 100; aplicarTierra(); });
  $('#tuneles').addEventListener('change', (e) => { estado.tuneles = e.target.checked; aplicarTuneles(); });
  $('#etiqueta-on').addEventListener('change', (e) => { estado.etiquetas = e.target.checked; });
  $('#tamano').addEventListener('input', (e) => {
    const f = e.target.value / 100;
    raiz.scale.setScalar(f);
  });

  const pedido = (location.hash.match(/e=([\w-]+)/) || [])[1]
    || (location.search.match(/[?&]e=([\w-]+)/) || [])[1];
  const inicial = mods.find((m) => m.id === pedido) ? pedido : 'alonso_martinez';
  sel.value = inicial;
  await cargarEstacion(inicial);
  ajustarTamano();
}

function ajustarTamano() {
  const cajaEl = lienzo.parentElement.getBoundingClientRect();
  renderer.setSize(cajaEl.width, cajaEl.height, false);
  camara.aspect = cajaEl.width / Math.max(1, cajaEl.height);
  camara.updateProjectionMatrix();
}
window.addEventListener('resize', ajustarTamano);

function bucle() {
  requestAnimationFrame(bucle);
  controles.update();
  pintarEtiquetas();
  renderer.render(escena, camara);
}

inicio().then(() => { ajustarTamano(); bucle(); }).catch((err) => {
  cargando.hidden = true;
  console.error(err);
  $('#sub').textContent = 'No se pudo cargar el modelo: ' + err.message;
});

// utilidades de diagnóstico (verificación headless)
window.__maq = {
  estado, get caja() { return actual?.userData.caja; },
  get escena() { return escena; }, get camara() { return camara; },
  get modelos() { return modelos; }, get actual() { return actual; },
  get encaje() { return encaje; },
  // Verificación del encaje sobre la malla ya transformada: distancia del andén a su vía
  verificar() {
    const enc = encaje?.get(estado.id);
    if (!enc || !actual) return null;
    actual.updateMatrixWorld(true);
    const out = [];
    (enc.andenes || []).forEach((a) => {
      if (!a.via) return;
      // centroide de las mallas del andén, en coordenadas de mundo
      const caja = new THREE.Box3();
      let n = 0;
      actual.traverse((o) => {
        if (!o.isMesh || String(o.userData.linea) !== String(a.linea)) return;
        const b = new THREE.Box3().setFromObject(o);
        if (b.isEmpty()) return;
        caja.union(b); n++;
      });
      if (!n) return;
      const c = caja.getCenter(new THREE.Vector3());
      // distancia del centro del andén al eje de la vía (puntos en mundo)
      const a0 = new THREE.Vector3(a.via[0][0], 0, a.via[0][1]).applyMatrix4(actual.matrixWorld);
      const a1 = new THREE.Vector3(a.via[a.via.length - 1][0], 0, a.via[a.via.length - 1][1]).applyMatrix4(actual.matrixWorld);
      const dir = a1.clone().sub(a0).normalize();
      const v = c.clone().sub(a0);
      const perp = v.clone().sub(dir.clone().multiplyScalar(v.dot(dir))).length();
      out.push({ linea: a.linea, desde_eje_m: +(perp * Math.abs(actual.matrixWorld.elements[0])).toFixed(2), mallas: n });
    });
    return { estacion: estado.id, giro: enc.giro_conjunto_deg, andenes: out };
  },
};
