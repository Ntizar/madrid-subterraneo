import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {LineSegments2} from 'three/addons/lines/LineSegments2.js';
import {LineSegmentsGeometry} from 'three/addons/lines/LineSegmentsGeometry.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';
import {findRoute} from './routing.js';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let encaje=new Map();let data,models=[];let stationById,linesById,selected=null,route=null,activeLine=null,view='flat',favorites=[];
try{favorites=JSON.parse(localStorage.getItem('metro-atlas-favorites')||'[]');if(!Array.isArray(favorites))favorites=[]}catch{}
let scene,camera,renderer,controls,mapGroup,highlightGroup,stationMeshes=[],edgeMeshes=[],labels=[],cameraTween=null;
let cityGroup=null,cityLoading=false;const hiddenLines=new Set(),layerHeight=id=>0;
const xyz=(lon,lat,y=0)=>new THREE.Vector3((lon+3.7)*84.8,y,(40.43-lat)*111.32);
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,3000)}
function badge(id){const l=linesById.get(id);return `<span class="badge" style="background:${l?.color||'#63718a'}">${esc(id==='R'?'R':'L'+id)}</span>`}
function badges(ids){return `<span class="badges">${ids.map(badge).join('')}</span>`}
function modelFor(s){return models.find(m=>s.raw.some(id=>m.raw.includes(id)))}
function setTab(name){$$('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));['explore','route','collection'].forEach(t=>$('#'+t+'-panel').hidden=t!==name);$('.explorer').classList.remove('folded');$('#mobile-fold').textContent='Ocultar panel ↓';$('#panel-body').scrollTop=0;}
function feature(s,subtitle,model=false){return `<button class="feature" data-station="${esc(s.id)}" ${model?'data-open-model="true"':''}><span class="feature-icon">${model?'◇':'↳'}</span><span><strong>${esc(s.name)}</strong><small>${esc(subtitle)}</small></span><span class="arrow">↗</span></button>`}
function renderFeatures(){
 const featured=models.slice(0,4).map(m=>{const s=data.stations.find(s=>s.raw.some(id=>m.raw.includes(id)));return s?feature(s,m.subtitle||'Modelo 3D',true):''}).join('');
 $('#featured').innerHTML=featured||data.stations.filter(s=>s.lines.length>2).slice(0,3).map(s=>feature(s,'Nudo de '+s.lines.length+' líneas')).join('');
 const favoriteStations=favorites.map(id=>stationById.get(id)).filter(Boolean);if(favoriteStations.length)$('#featured').innerHTML=`<div class="eyebrow">GUARDADAS EN ESTE DISPOSITIVO</div>`+favoriteStations.map(s=>feature(s,'★ Favorita')).join('')+featured;
 $('#model-list').innerHTML=models.map(m=>{const s=data.stations.find(s=>s.raw.some(id=>m.raw.includes(id)));return s?feature(s,m.subtitle||'Escala sin verificar',true):''}).join('')||'<p class="empty">La publicación de modelos está pendiente de permiso del autor. Puedes abrir tus archivos GLB localmente sin enviarlos a ningún servidor.</p>';
 $('#model-count').textContent=models.length; if(!models.length)$('#collection-note').textContent='El visor está preparado. Los modelos del autor no se publican sin confirmar el alcance de su permiso.';
}
function bindDelegated(){document.addEventListener('click',e=>{const b=e.target.closest('[data-station]');if(b){const s=stationById.get(b.dataset.station);selectStation(s.id);if(b.dataset.openModel)focusMapModel(modelFor(s));}const line=e.target.closest('[data-isolate]');if(line)isolateLine(line.dataset.isolate);});}
function updateHash(){const p=new URLSearchParams;if(selected)p.set('s',selected);if(route){p.set('from',$('#origin').value);p.set('to',$('#destination').value);p.set('priority',$('[name=priority]:checked').value)}if(view==='3d')p.set('view','3d');if(activeLine)p.set('line',activeLine);history.replaceState(null,'','#'+p.toString())}
function searchStations(q){const normalize=s=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();return data.stations.filter(s=>normalize(s.name).includes(normalize(q))).sort((a,b)=>a.name.localeCompare(b.name,'es')).slice(0,9)}
function renderSearch(){const q=$('#search').value.trim();$('#search-results').innerHTML=q?searchStations(q).map(s=>`<button class="result" data-station="${s.id}"><span>${esc(s.name)}</span>${badges(s.lines)}</button>`).join('')||'<p class="empty">No hay estaciones con ese nombre. Prueba sin abreviaturas.</p>':'';}
function selectStation(id,{focus=true}={}){const s=stationById.get(id);if(!s)return;selected=id;$('#search-results').innerHTML='';$('#search').value='';const m=modelFor(s);$('#station-card').hidden=false;$('.map-title').classList.add('hidden-mobile');$('#station-card').innerHTML=`<button class="close" aria-label="Cerrar estación">×</button><span class="eyebrow">FICHA DEL ATLAS</span><h2>${esc(s.name)}</h2>${badges(s.lines)}<p>${s.lines.length>1?'Complejo de conexión de '+s.lines.length+' líneas.':'Estación de la línea '+esc(s.lines[0])+'.'} ${m?'Tiene modelo 3D explorable.':'Sin modelo arquitectónico incorporado.'}</p><div class="station-actions"><button class="outline" id="as-origin">Desde aquí</button><button class="outline" id="as-destination">Hasta aquí</button><button class="star" id="favorite" aria-label="${favorites.includes(id)?'Quitar de':'Añadir a'} favoritas">${favorites.includes(id)?'★':'☆'}</button></div>${m?'<button class="primary wide" id="open-station-model">Ver geometría sobre el mapa <span>◇</span></button>':''}<div class="station-data"><span>Zona ${esc(s.zones.join(' / '))}</span><span>${s.lat.toFixed(4)} N · ${Math.abs(s.lon).toFixed(4)} O</span></div><p class="small">CRTM · copia geográfica 29/05/2026. No acredita el servicio actual.</p>`;
 $('#station-card .close').onclick=closeStation;$('#as-origin').onclick=()=>{setTab('route');$('#origin').value=id;closeStation();toast('Origen seleccionado')};$('#as-destination').onclick=()=>{setTab('route');$('#destination').value=id;closeStation();toast('Destino seleccionado')};$('#favorite').onclick=()=>{favorites=favorites.includes(id)?favorites.filter(v=>v!==id):[...favorites,id];try{localStorage.setItem('metro-atlas-favorites',JSON.stringify(favorites))}catch{toast('Este navegador no permite guardar favoritos')}renderFeatures();selectStation(id,{focus:false})};if(m)$('#open-station-model').onclick=()=>focusMapModel(m);
 updateVisuals();if(focus){const pos=xyz(s.lon,s.lat,layerHeight(s.lines[0]));flyTo(pos,5.4)}updateHash();
}
function closeStation(){selected=null;activeSpatialModel=null;$("#spatial-selection").hidden=true;$(".spatial-tools").classList.remove("spatial-focused");$('#station-card').hidden=true;$('.map-title').classList.remove('hidden-mobile');updateVisuals();updateHash()}
function lineFilter(id){hiddenLines.has(id)?hiddenLines.delete(id):hiddenLines.add(id);activeLine=null;updateVisuals();updateHash()}
function isolateLine(id){hiddenLines.clear();data.lines.forEach(l=>{if(l.id!==id)hiddenLines.add(l.id)});activeLine=id;route=null;$('#route-result').innerHTML='';updateVisuals();const ss=data.stations.filter(s=>s.lines.includes(id));fitPositions(ss.map(s=>xyz(s.lon,s.lat,layerHeight(id))),1.35);updateHash();}
function updateVisuals(){if(!data||!mapGroup)return;$('.map-title').hidden=!!selected||!!route;edgeMeshes.forEach(({mesh,line})=>{mesh.visible=!hiddenLines.has(line);mesh.material.opacity=route?.16:.9;});stationMeshes.forEach(({mesh,stations,line})=>{mesh.visible=!hiddenLines.has(line);const colors=mesh.geometry.attributes.color;stations.forEach((s,i)=>{const c=new THREE.Color(selected===s.id?'#ff9147':'#ffffff');colors.setXYZ(i,c.r,c.g,c.b)});colors.needsUpdate=true;});$$('.line-chip').forEach(b=>{const off=hiddenLines.has(b.dataset.line);b.classList.toggle('off',off);b.setAttribute('aria-pressed',String(!off))});$('#map-status').textContent=route?`${route.edges.length} tramos · ${route.changes} cambios de línea · recorrido teórico`:`${data.stations.length} complejos · ${13-hiddenLines.size} líneas visibles · Powered by CRTM`;drawRoute();}
function drawRoute(){if(!highlightGroup)return;for(const o of [...highlightGroup.children]){o.geometry?.dispose();o.material?.dispose();highlightGroup.remove(o)}if(!route)return;route.edges.forEach(i=>{const e=data.edges[i],positions=[];const path=connectedEdgePath(e);for(let j=1;j<path.length;j++)positions.push(...path[j-1].toArray(),...path[j].toArray());const geo=new LineSegmentsGeometry();geo.setPositions(positions);const material=lineMaterial(linesById.get(e.line).color,1,5);material.depthTest=false;const mesh=new LineSegments2(geo,material);mesh.renderOrder=4;highlightGroup.add(mesh)})}

function calculate(){const a=$('#origin').value,b=$('#destination').value,priority=$('[name=priority]:checked').value;route=findRoute(data,a,b,priority);if(!route){$('#route-result').innerHTML='<p class="empty">No hay conexión en esta copia de la red. No se ha inventado un enlace.</p>';updateVisuals();return}if(!route.edges.length){$('#route-result').innerHTML='<p class="empty">Origen y destino son el mismo complejo.</p>';updateVisuals();updateHash();return}
 hiddenLines.clear();activeLine=null;$('#station-card').hidden=true;selected=null;$('#route-result').innerHTML=`<div class="route-stats"><div><strong>${route.edges.length}</strong><small>tramos entre complejos</small></div><div><strong>${route.changes}</strong><small>cambios de línea</small></div></div><p class="route-summary">${priority==='changes'?'Primero menos cambios de línea, después menos tramos.':'Primero menos tramos, después menos cambios de línea.'}</p><p class="route-notice">Sin tiempos ni incidencias. Verifica el servicio.</p>`+route.nodes.map((id,n)=>{const s=stationById.get(id),line=data.edges[route.edges[Math.min(n,route.edges.length-1)]].line;const changed=n>0&&n<route.edges.length&&data.edges[route.edges[n-1]].line!==line;return `<div class="route-step ${changed?'change':''}" style="--line:${linesById.get(line).color}">${changed?'<small>Cambio a '+esc(line==='R'?'Ramal':'L'+line)+'</small>':''}<button data-station="${s.id}">${esc(s.name)}</button>${n===0?badges([line]):''}</div>`}).join('')+`<div class="route-actions"><button class="outline" id="copy-route">Copiar recorrido</button><button class="outline" id="clear-route">Limpiar</button></div>`;
 $('#copy-route').onclick=()=>copyText('Conexión teórica · Madrid Subterráneo\n'+route.nodes.map(id=>stationById.get(id).name).join(' → ')+`\n${route.edges.length} tramos, ${route.changes} cambios de línea. No incluye incidencias, horarios ni cambios de tren dentro de la misma línea.\n`+location.href);$('#clear-route').onclick=()=>{route=null;$('#route-result').innerHTML='';updateVisuals();updateHash();home()};updateVisuals();fitPositions(route.nodes.map(id=>{const s=stationById.get(id);return xyz(s.lon,s.lat)}),1.6);updateHash();}
async function copyText(text){try{await navigator.clipboard.writeText(text);toast('Copiado')}catch{const a=document.createElement('textarea');a.value=text;document.body.append(a);a.select();const done=document.execCommand('copy');a.remove();toast(done?'Copiado':'No se pudo copiar. Usa la dirección del navegador.')}}
function initMap(){scene=new THREE.Scene();scene.background=new THREE.Color('#eff4f9');const host=$('#map');camera=new THREE.OrthographicCamera(-20,20,15,-15,.01,500);camera.position.set(0,80,.001);renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'low-power'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));host.appendChild(renderer.domElement);renderer.domElement.setAttribute('aria-label','Mapa geográfico de Metro. También puedes explorar estaciones con el buscador.');controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.maxPolarAngle=Math.PI*.495;controls.enableRotate=false;controls.minZoom=.25;controls.maxZoom=35;controls.screenSpacePanning=true;controls.mouseButtons={LEFT:THREE.MOUSE.PAN,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.ROTATE};const grid=new THREE.GridHelper(100,50,0xd9e3f0,0xe2eaf4);grid.position.y=-.12;scene.add(grid);scene.add(new THREE.HemisphereLight(0xffffff,0x61758e,.95));const sun=new THREE.DirectionalLight(0xffffff,1.1);sun.position.set(10,30,20);scene.add(sun);mapGroup=new THREE.Group();scene.add(mapGroup);highlightGroup=new THREE.Group();scene.add(highlightGroup);buildMap();window.addEventListener('resize',resize);resize();
 const pointer=new THREE.Vector2(),raycaster=new THREE.Raycaster();let start;renderer.domElement.addEventListener('pointerdown',e=>start=[e.clientX,e.clientY]);renderer.domElement.addEventListener('pointerup',e=>{if(!start||Math.hypot(e.clientX-start[0],e.clientY-start[1])>7)return;let best=null,distance=12;for(const s of data.stations){const visible=s.lines.filter(l=>!hiddenLines.has(l));for(const l of visible){const p=xyz(s.lon,s.lat,layerHeight(l)).project(camera);const dx=(p.x+1)/2*innerWidth-e.clientX,dy=(1-p.y)/2*innerHeight-e.clientY,d=Math.hypot(dx,dy);if(p.z<1&&d<distance){best=s;distance=d}}}if(best)selectStation(best.id)});renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();toast('Gráficos pausados. Recarga para recuperar el mapa. El buscador sigue disponible.')});
 initSpatialModels();initAndenes();const loop=()=>{requestAnimationFrame(loop);if(document.hidden)return;if(cameraTween){const t=Math.min((performance.now()-cameraTween.start)/650,1),v=1-Math.pow(1-t,3);controls.target.lerpVectors(cameraTween.fromTarget,cameraTween.toTarget,v);camera.position.lerpVectors(cameraTween.fromCamera,cameraTween.toCamera,v);camera.zoom=THREE.MathUtils.lerp(cameraTween.fromZoom,cameraTween.toZoom,v);camera.updateProjectionMatrix();if(t===1)cameraTween=null}controls.update();updateSpatialModels();updateLabels();renderer.render(scene,camera)};loop();home(true);}
function lineMaterial(color,opacity=.95,width=3){return new LineMaterial({color,linewidth:width,worldUnits:false,resolution:new THREE.Vector2(innerWidth,innerHeight),transparent:true,opacity,depthTest:true})}
let markerTexture=null;function getMarkerTexture(){if(markerTexture)return markerTexture;const c=document.createElement('canvas');c.width=64;c.height=64;const ctx=c.getContext('2d');ctx.beginPath();ctx.arc(32,32,27,0,Math.PI*2);ctx.fillStyle='#ffffff';ctx.fill();ctx.lineWidth=8;ctx.strokeStyle='#47627f';ctx.stroke();markerTexture=new THREE.CanvasTexture(c);markerTexture.colorSpace=THREE.SRGBColorSpace;return markerTexture;}
function buildMap(){for(const o of [...mapGroup.children]){o.geometry?.dispose();o.material?.dispose();mapGroup.remove(o)}edgeMeshes=[];stationMeshes=[];
 window.__polilineas=new Map();data.lines.forEach(l=>{const positions=[];const pl=[];window.__polilineas.set(l.id,pl);data.edges.filter(e=>e.line===l.id).forEach(e=>{const path=connectedEdgePath(e);for(const q of path)pl.push(q);for(let i=1;i<path.length;i++){if(!withinLevelDetail(path[i-1])&&!withinLevelDetail(path[i]))continue;positions.push(...path[i-1].toArray(),...path[i].toArray())}});if(!positions.length)return;const geometry=new LineSegmentsGeometry();geometry.setPositions(positions);const mesh=new LineSegments2(geometry,lineMaterial(l.color,.95,innerWidth<700?2.8:3.2));mesh.computeLineDistances();mapGroup.add(mesh);edgeMeshes.push({mesh,line:l.id});const stations=data.stations.filter(s=>s.lines.includes(l.id)&&withinLevelDetail(xyz(s.lon,s.lat)));const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(stations.flatMap(s=>stationLinePosition(s,l.id).toArray()),3));geo.setAttribute('color',new THREE.Float32BufferAttribute(stations.flatMap(()=>[1,1,1]),3));const points=new THREE.Points(geo,new THREE.PointsMaterial({size:innerWidth<700?6:6.7,sizeAttenuation:false,map:getMarkerTexture(),alphaTest:.25,transparent:true,vertexColors:true,depthTest:false}));points.renderOrder=5;points.frustumCulled=false;mapGroup.add(points);stationMeshes.push({mesh:points,stations,line:l.id});});
 for(const entry of spatialModels.values()){if(!entry.group.visible||!entry.loaded)continue;for(const p of entry.m.platforms||[]){if(hiddenLines.has(p.line))continue;const path=worldPlatformPath(entry,p),positions=[];for(let i=1;i<path.length;i++)positions.push(...path[i-1].toArray(),...path[i].toArray());const g=new LineSegmentsGeometry();g.setPositions(positions);const mesh=new LineSegments2(g,lineMaterial(linesById.get(p.line)?.color||'#56687f',1,3.5));mapGroup.add(mesh);edgeMeshes.push({mesh,line:p.line})}}
 if(view==='3d'){const positions=[];data.stations.filter(s=>s.lines.length>1&&!activeStationEntry(s)).forEach(s=>{const min=Math.min(...s.lines.map(layerHeight)),max=Math.max(...s.lines.map(layerHeight));positions.push(...xyz(s.lon,s.lat,min).toArray(),...xyz(s.lon,s.lat,max).toArray())});const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));mapGroup.add(new THREE.LineSegments(geo,new THREE.LineBasicMaterial({color:0x9fb6d3,transparent:true,opacity:.4})));}
 $('#map-labels').innerHTML='';labels=data.stations.map(s=>{const el=document.createElement('span');el.className='map-label';el.textContent=s.name;$('#map-labels').append(el);return {s,el}});updateVisuals();}

function resize(){if(!renderer)return;renderer.setSize(innerWidth,innerHeight);const aspect=innerWidth/innerHeight;camera.left=-20*aspect;camera.right=20*aspect;camera.top=20;camera.bottom=-20;camera.updateProjectionMatrix();edgeMeshes.forEach(({mesh})=>{mesh.material.resolution.set(innerWidth,innerHeight);mesh.material.linewidth=innerWidth<700?2.8:3.2});highlightGroup?.children.forEach(o=>o.material?.resolution?.set(innerWidth,innerHeight));if(modelRenderer&&$('#model-dialog').open)resizeModel();if(window.atlasReady&&!selected&&!route)home()}
function updateLabels(){if(!camera)return;const occupied=[];const sorted=[...labels].sort((a,b)=>(b.s.id===selected?100:0)+(modelFor(b.s)?10:0)+b.s.lines.length-((a.s.id===selected?100:0)+(modelFor(a.s)?10:0)+a.s.lines.length));for(const {s,el} of sorted){if(spatialLevelDetail&&activeSpatialModel&&s.id!==selected){el.hidden=true;continue}const visibleLines=s.lines.filter(l=>!hiddenLines.has(l));if(!visibleLines.length){el.hidden=true;continue}const priority=s.id===selected||modelFor(s)||s.lines.length>=3;const show=s.id===selected||(camera.zoom>4)||(priority&&camera.zoom>1.2)||(s.lines.length>3&&camera.zoom>.6);if(!show){el.hidden=true;continue}const modelAnchor=activeSpatialModel&&s.id===selected?spatialModels.get(activeSpatialModel)?.m.anchor:null;const p=xyz(modelAnchor?.lon??s.lon,modelAnchor?.lat??s.lat,layerHeight(visibleLines[0])+.05).project(camera);const x=(p.x+1)/2*innerWidth,y=(1-p.y)/2*innerHeight;const w=Math.min(220,s.name.length*5.8+18);const overlaps=occupied.some(r=>Math.abs(r.x-x)<(r.w+w)/2&&Math.abs(r.y-y)<24);if(p.z>1||x<0||x>innerWidth||y<90||y>innerHeight-65||(overlaps&&s.id!==selected)){el.hidden=true;continue}el.hidden=false;el.classList.toggle('selected',s.id===selected);el.style.left=x+'px';el.style.top=y+'px';occupied.push({x,y,w});}}
function flyTo(target,zoom){cameraTween={start:performance.now(),fromTarget:controls.target.clone(),toTarget:target.clone(),fromCamera:camera.position.clone(),toCamera:target.clone().add(view==='flat'?new THREE.Vector3(0,80,.001):new THREE.Vector3(25,38,36)),fromZoom:camera.zoom,toZoom:zoom};}
function fitPositions(positions,padding=1.25){const box=new THREE.Box3().setFromPoints(positions),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());let availableW=innerWidth-(innerWidth>700?410:40),availableH=innerHeight-(innerWidth>700?150:innerHeight*.50);const worldW=40*innerWidth/innerHeight;const z=Math.min(worldW/(Math.max(size.x,.8)*padding)*(availableW/innerWidth),40/(Math.max(size.z,.8)*padding)*(availableH/innerHeight));if(innerWidth>700)center.x-=worldW/Math.max(z,.1)*.13;else center.z+=40/Math.max(z,.1)*.18;flyTo(center,Math.min(15,Math.max(.25,z)))}
function home(immediate=false){fitPositions(data.stations.map(s=>xyz(s.lon,s.lat)),1.15);if(immediate&&cameraTween){camera.position.copy(cameraTween.toCamera);controls.target.copy(cameraTween.toTarget);camera.zoom=cameraTween.toZoom;camera.updateProjectionMatrix();cameraTween=null}}
function setView(v){view=v;$('#view-flat').classList.toggle('active',v==='flat');$('#view-3d').classList.toggle('active',v==='3d');$('#view-description').textContent=v==='flat'?'Trazado geográfico · distancias horizontales':'Niveles relativos del modelo · sin profundidad real';controls.enableRotate=v==='3d';$('.north').textContent=v==='flat'?'N ↑':'Órbita libre';buildMap();flyTo(controls.target,camera.zoom);updateHash();}
let modelScene,modelCamera,modelRenderer,modelControls,modelRoot,modelParts=[],modelRAF,modelURL=null;
function disposeModel(){cancelAnimationFrame(modelRAF);modelControls?.dispose();if(modelScene)modelScene.traverse(o=>{o.geometry?.dispose();const mats=Array.isArray(o.material)?o.material:[o.material];mats.filter(Boolean).forEach(m=>{for(const v of Object.values(m))if(v?.isTexture)v.dispose();m.dispose()})});modelRenderer?.dispose();modelRenderer?.domElement.remove();modelRenderer=null;modelScene=null;modelRoot=null;modelParts=[];if(modelURL){URL.revokeObjectURL(modelURL);modelURL=null}}
function resizeModel(){const host=$('#model-viewport');if(!modelRenderer)return;const w=host.clientWidth,h=host.clientHeight;modelRenderer.setSize(w,h);modelCamera.aspect=w/h;modelCamera.updateProjectionMatrix()}
async function openModel(m,file){if(!m&&!file)return;disposeModel();$('#model-dialog').showModal();$('#model-title').textContent=file?file.name:m.name;$('#model-source').hidden=!!file;if(m){$('#model-source').href=m.source;$('#model-source').textContent='Fuente · Albert Guillaumes ↗'}$('#model-credit').textContent=file?'Archivo local. Procedencia, unidades y derechos declarados por quien lo abre. No se envía a ningún servidor.':m.credit;$('#model-loading').hidden=false;$('#model-loading').textContent='Abriendo geometría…';$('#explode').value=0;$('#opacity').value=100;const url=file?(modelURL=URL.createObjectURL(file)):m.file;$('#download-model').href=url;$('#download-model').download=file?file.name:m.file.split('/').pop();$('#download-model').hidden=false;
 try{const buffer=await (await fetch(url)).arrayBuffer();const checkGLB=new DataView(buffer);if(checkGLB.getUint32(0,true)!==0x46546c67)throw new Error('El archivo no es un GLB válido.');const jsonLength=checkGLB.getUint32(12,true);const manifest=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,jsonLength)));if([...(manifest.buffers||[]),...(manifest.images||[])].some(v=>v.uri&&!v.uri.startsWith('data:')))throw new Error('Este visor acepta GLB autocontenidos, sin archivos externos.');
 const gltf=await new Promise((resolve,reject)=>new GLTFLoader().parse(buffer,'',resolve,reject));modelScene=new THREE.Scene();modelScene.background=new THREE.Color('#c5d2e3');modelCamera=new THREE.PerspectiveCamera(38,1,.01,1000);modelRenderer=new THREE.WebGLRenderer({antialias:true,alpha:false});modelRenderer.setPixelRatio(Math.min(devicePixelRatio,2));modelRenderer.setClearColor('#c5d2e3');modelRenderer.toneMapping=THREE.ACESFilmicToneMapping;modelRenderer.toneMappingExposure=.8;modelRenderer.outputColorSpace=THREE.SRGBColorSpace;$('#model-viewport').append(modelRenderer.domElement);modelRenderer.domElement.setAttribute('aria-label','Modelo 3D interactivo de '+$('#model-title').textContent);modelControls=new OrbitControls(modelCamera,modelRenderer.domElement);modelControls.enableDamping=true;modelControls.minDistance=1;modelControls.maxDistance=35;modelScene.add(new THREE.HemisphereLight(0xffffff,0x556579,.9));const light=new THREE.DirectionalLight(0xffffff,1.1);light.position.set(5,10,8);modelScene.add(light);const fill=new THREE.DirectionalLight(0xdce9ff,.5);fill.position.set(-8,3,-5);modelScene.add(fill);
 const root=new THREE.Group();root.add(gltf.scene);modelScene.add(root);let box=new THREE.Box3().setFromObject(gltf.scene);const size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());if(!Number.isFinite(size.length())||size.length()===0)throw new Error('La geometría no tiene dimensiones válidas.');const scale=8/Math.max(size.x,size.y,size.z);gltf.scene.position.sub(center);root.scale.setScalar(scale);modelRoot=root;modelParts=[];gltf.scene.traverse(o=>{if(!o.isMesh)return;o.material=Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone();o.userData.basePosition=o.position.clone();const b=new THREE.Box3().setFromObject(o);const c=b.getCenter(new THREE.Vector3());const direction=c.clone();if(direction.length()<.001)direction.set(0,1,0);direction.normalize();const localOffset=o.parent.worldToLocal(c.clone().add(direction)).sub(o.parent.worldToLocal(c.clone()));modelParts.push({mesh:o,base:o.position.clone(),direction:localOffset});const edges=new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry,28),new THREE.LineBasicMaterial({color:0x43546b,transparent:true,opacity:.25}));edges.name="contorno_visual";o.add(edges);});
 modelCamera.position.set(8,7,10);modelControls.target.set(0,0,0);resizeModel();modelView(false);$('#model-loading').hidden=true;function render(){modelRAF=requestAnimationFrame(render);if(document.hidden)return;modelControls.update();modelRenderer.render(modelScene,modelCamera)}render();
 }catch(err){$('#model-loading').hidden=false;$('#model-loading').textContent='No se pudo abrir: '+err.message;$('#download-model').hidden=true;}}
function modelView(top=false){if(!modelCamera||!modelRoot)return;const direction=top?new THREE.Vector3(.001,1,.001):new THREE.Vector3(1,1.1,1.3).normalize();const box=new THREE.Box3().setFromObject(modelRoot),center=box.getCenter(new THREE.Vector3());const corners=[];modelRoot.updateMatrixWorld(true);modelRoot.traverse(o=>{if(!o.isMesh)return;o.geometry.computeBoundingBox();const b=o.geometry.boundingBox;for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z])corners.push(new THREE.Vector3(x,y,z).applyMatrix4(o.matrixWorld))});let distance=18;for(let k=0;k<4;k++){modelCamera.position.copy(center).addScaledVector(direction,distance);modelCamera.lookAt(center);modelCamera.updateMatrixWorld();let extent=0;for(const c of corners){const p=c.clone().project(modelCamera);extent=Math.max(extent,Math.abs(p.x),Math.abs(p.y))}distance*=Math.max(.45,extent/.82)}modelCamera.position.copy(center).addScaledVector(direction,distance);modelControls.target.copy(center);modelControls.update()}

async function init(){try{const r=await fetch('data/network.json');if(!r.ok)throw new Error('Datos no disponibles');data=await r.json();try{models=await (await fetch('data/models.json')).json()}catch{models=[]}models.forEach(m=>{m.file=String(m.file||'').replace(/^\//,'')});/* encaje.json se carga en datosAltura: una sola fuente */stationById=new Map(data.stations.map(s=>[s.id,s]));linesById=new Map(data.lines.map(l=>[l.id,l]));$('#station-count').textContent=data.stations.length;$('#info-count').textContent=data.stations.length+' complejos y '+data.edges.length+' conexiones entre ellos';$('#line-grid').innerHTML=data.lines.map(l=>`<button class="line-chip" style="background:${l.color};--line:${l.color}" data-line="${l.id}" title="Mostrar u ocultar ${l.name}. Doble clic para aislar." aria-label="Mostrar u ocultar ${l.name}" aria-pressed="true">${l.id==='R'?'R':'L'+l.id}</button>`).join('');$$('.line-chip').forEach(b=>{b.onclick=()=>lineFilter(b.dataset.line);b.ondblclick=()=>isolateLine(b.dataset.line)});const options=[...data.stations].sort((a,b)=>a.name.localeCompare(b.name,'es')).map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');$('#origin').innerHTML=options;$('#destination').innerHTML=options;$('#origin').value=data.stations.find(s=>s.name==='Sol')?.id||data.stations[0].id;$('#destination').value=data.stations.find(s=>s.name.includes('Pinar de Chamart'))?.id||data.stations[1].id;renderFeatures();bindDelegated();try{initMap()}catch(err){$('#map').innerHTML='<div class="loading-fail"><strong>No hay aceleración 3D disponible.</strong><p>El buscador y las conexiones siguen funcionando. Activa WebGL o prueba otro navegador para ver el mapa.</p></div>';$('#map-status').textContent='Mapa no disponible · búsqueda y conexiones activas';console.error(err)}const params=new URLSearchParams(location.hash.slice(1));const initialModel=models.find(m=>m.id===params.get("model"));if(params.get('view')==='3d'&&renderer)setView('3d');if(params.has('line')&&linesById.has(params.get('line')))isolateLine(params.get('line'));if(stationById.has(params.get('from'))&&stationById.has(params.get('to'))){$('#origin').value=params.get('from');$('#destination').value=params.get('to');const pri=params.get('priority');if(['changes','stops'].includes(pri))$(`[name=priority][value=${pri}]`).checked=true;setTab('route');calculate()}if(stationById.has(params.get('s')))selectStation(params.get('s'));if(initialModel)focusMapModel(initialModel);window.atlasReady=true;
 }catch(err){$('#map-status').textContent='No se han podido cargar los datos. Recarga la página.';$('#search-results').innerHTML='<p class="empty">Datos no disponibles. No mostramos una red de ejemplo.</p>';console.error(err)}}
$$('[data-tab]').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));$('#search').addEventListener('input',renderSearch);$('#search').addEventListener('keydown',e=>{if(e.key==='Enter'){const first=$('#search-results button');if(first)first.click()}});$('#all-lines').onclick=()=>{hiddenLines.clear();activeLine=null;route=null;$('#route-result').innerHTML='';updateVisuals();home();updateHash()};$('#swap').onclick=()=>{const v=$('#origin').value;$('#origin').value=$('#destination').value;$('#destination').value=v};$('#calculate').onclick=calculate;$('#view-flat').onclick=()=>setView('flat');$('#view-3d').onclick=()=>setView('3d');$('#home').onclick=()=>{activeSpatialModel=null;$('#spatial-selection').hidden=true;$('.spatial-tools').classList.remove('spatial-focused');home()};$('#zoom-in').onclick=()=>{if(camera)flyTo(controls.target,Math.min(35,camera.zoom*1.4))};$('#zoom-out').onclick=()=>{if(camera)flyTo(controls.target,Math.max(.25,camera.zoom/1.4))};$('#share').onclick=()=>copyText(location.href);$('#about').onclick=()=>$('#info-dialog').showModal();$$('.dialog-close').forEach(b=>b.onclick=()=>b.closest('dialog').close());$$('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close()}}));$('#model-dialog').addEventListener('close',disposeModel);$('#model-iso').onclick=()=>modelView(false);$('#model-top').onclick=()=>modelView(true);$('#model-reset').onclick=()=>{modelView(false);$('#explode').value=0;$('#opacity').value=100;updateModelParts()};function updateModelParts(){const ex=Number($('#explode').value)/100;modelParts.forEach(p=>{p.mesh.position.copy(p.base).addScaledVector(p.direction,ex*1.4);const materials=Array.isArray(p.mesh.material)?p.mesh.material:[p.mesh.material];materials.forEach(m=>{m.opacity=Number($('#opacity').value)/100;m.transparent=m.opacity<1;m.depthWrite=m.opacity>.7})})}$('#explode').oninput=updateModelParts;$('#opacity').oninput=updateModelParts;$('#import-glb').onchange=e=>{const f=e.target.files[0];if(!f)return;if(f.size>40*1024*1024){toast('El límite local de este visor es 40 MB');return}openModel(null,f);e.target.value=''};$('#mobile-fold').onclick=()=>{const folded=$('.explorer').classList.toggle('folded');$('#mobile-fold').textContent=folded?'Mostrar herramientas ↑':'Ocultar panel ↓'};$('.identity').onclick=e=>{e.preventDefault();closeStation();route=null;hiddenLines.clear();activeLine=null;$('#route-result').innerHTML='';setTab('explore');updateVisuals();home();updateHash()};document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)&&!$('dialog[open]')){e.preventDefault();setTab('explore');$('#search').focus()}if(e.key==='Escape'&&!$('dialog[open]'))closeStation()});init();

$('#city-base').onclick=async()=>{if(!scene)return;if(cityGroup){cityGroup.visible=!cityGroup.visible;$('#city-base').classList.toggle('active',cityGroup.visible);$('#city-base').setAttribute('aria-pressed',String(cityGroup.visible));$('.osm-credit').hidden=!cityGroup.visible;return}if(cityLoading)return;cityLoading=true;$('#city-base').textContent='Cargando…';cityGroup=new THREE.Group();scene.add(cityGroup);$('.osm-credit').hidden=false;const zoom=11,n=2**zoom,toX=lon=>Math.floor((lon+180)/360*n),toY=lat=>Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n),lon=x=>x/n*360-180,lat=y=>Math.atan(Math.sinh(Math.PI*(1-2*y/n)))*180/Math.PI;const minX=toX(-3.93),maxX=toX(-3.4),minY=toY(40.6),maxY=toY(40.25);let failed=0;const tasks=[];for(let x=minX;x<=maxX;x++)for(let y=minY;y<=maxY;y++){tasks.push(new Promise(resolve=>{new THREE.TextureLoader().load(`https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`,texture=>{texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;const nw=xyz(lon(x),lat(y)),se=xyz(lon(x+1),lat(y+1));const mesh=new THREE.Mesh(new THREE.PlaneGeometry(se.x-nw.x,se.z-nw.z),new THREE.MeshBasicMaterial({map:texture,transparent:true,opacity:.35,depthWrite:false}));mesh.rotation.x=-Math.PI/2;mesh.position.set((nw.x+se.x)/2,-.14,(nw.z+se.z)/2);cityGroup.add(mesh);resolve()},undefined,()=>{failed++;resolve()})}));}await Promise.all(tasks);cityLoading=false;$('#city-base').textContent='Ciudad';$('#city-base').classList.add('active');$('#city-base').setAttribute('aria-pressed','true');if(failed){toast('Base urbana parcial o no disponible. La red sigue funcionando.')}else toast('Base urbana OpenStreetMap activada');};

let colocacion=new Map(),cotasRed={},EXAG=8;
const VER_DATOS='20261119b';
const datosAltura=(async()=>{
  try{const r=await fetch('data/colocacion.json');const j=await r.json();colocacion=new Map((j.modelos||[]).map(f=>[f.id,f]));}catch(e){}
  try{const r=await fetch('data/cotas.json');const j=await r.json();cotasRed=j.cotas||{};}catch(e){}
  try{const r=await fetch('data/encaje.json?v='+VER_DATOS);const j=await r.json();encaje=new Map((j.estaciones||[]).filter(x=>x.estacion).map(x=>[x.id,x]));}catch(e){}
  try{const r=await fetch('data/metro.json?v='+VER_DATOS);prepararPerfiles(await r.json());}catch(e){}
  try{const r=await fetch('data/andenes.json?v='+VER_DATOS);const j=await r.json();ANDENES=Object.values(j.andenes||{});window.__andenes=ANDENES;if(typeof scene!=='undefined'&&scene)initAndenes();}catch(e){}
})();
const cotaY=(id)=>{const c=cotasRed[id]?.cota;return -((c==null?22:c)/1000)*EXAG;};
let spatialLevelDetail=false;let spatialModels=new Map(),spatialGroup=null,activeSpatialModel=null,spatialVisible=true,spatialSize=1,spatialLoadCount=0;
let ANDENES=null,andenGroup=null,andenMesh=null,andenSizeLast=-1,andenPiezas=[];
const ANDEN_ALTO=0.8;
// La estación se genera DESDE LA VÍA: plataforma de largo real, pegada a su vía,
// centrada en el punto del andén y a la cota de su línea. Un andén lateral tiene
// dos plataformas (una por sentido); uno central, una entre las dos vías.
function piezasAnden(){
  const out=[];
  for(const a of ANDENES){
    const S=a.S||4.6;
    if(a.tipo==='central')out.push({a,lado:0,ancho:Math.max(2.5,S-1.6)});
    else{out.push({a,lado:-1,ancho:3.4});out.push({a,lado:1,ancho:3.4})}
  }
  return out;
}
function actualizarAndenes(){
  if(!andenMesh||!ANDENES)return;
  const mtx=new THREE.Matrix4(),q=new THREE.Quaternion(),p=new THREE.Vector3(),e=new THREE.Euler(),esc=new THREE.Vector3();
  const k=Math.max(0.5,spatialSize);
  andenPiezas.forEach((pieza,i)=>{
    const a=pieza.a,S=(a.S||4.6),ang=THREE.MathUtils.degToRad(a.ang||0);
    const nx=Math.cos(ang),nz=Math.sin(ang);
    const off=pieza.lado===0?0:pieza.lado*(S/2+pieza.ancho/2);
    p.copy(xyz(a.lon,a.lat,-(((a.cota_linea??a.cota??22))/1000)*EXAG));
    p.x+=nx*off*k/1000;p.z+=nz*off*k/1000;
    e.set(0,THREE.MathUtils.degToRad(90-(a.ang||0)),0);
    q.setFromEuler(e);
    esc.set((a.largo||100)*k,ANDEN_ALTO,pieza.ancho*k);
    mtx.compose(p,q,esc);
    andenMesh.setMatrixAt(i,mtx);
  });
  andenMesh.instanceMatrix.needsUpdate=true;
  andenSizeLast=spatialSize;
}
function initAndenes(){
  if(!ANDENES||!ANDENES.length||andenGroup)return;
  andenPiezas=piezasAnden();
  andenGroup=new THREE.Group();scene.add(andenGroup);
  const geo=new THREE.BoxGeometry(1,1,1);
  const mat=new THREE.MeshLambertMaterial({color:0xe3ebf5,transparent:true,opacity:.95});
  andenMesh=new THREE.InstancedMesh(geo,mat,andenPiezas.length);
  andenMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  andenMesh.renderOrder=2;
  andenGroup.add(andenMesh);
  andenGroup.visible=spatialVisible;
  actualizarAndenes();
}
window.atlasDiagnostics = () => {
  // distancia de cada plataforma a la vía dibujada de su línea y salto de cota
  const vias = window.__polilineas || new Map();
  const salida = [];
  for (const pieza of andenPiezas) {
    const a = pieza.a;
    const v = vias.get(a.l) || vias.get(String(a.l));
    if (!v || v.length < 2) continue;
    const ang = THREE.MathUtils.degToRad(a.ang || 0);
    const off = pieza.lado === 0 ? 0 : pieza.lado * ((a.S || 4.6) / 2 + pieza.ancho / 2);
    const x = xyz(a.lon, a.lat, 0).x + Math.cos(ang) * off / 1000;
    const z = xyz(a.lon, a.lat, 0).z + Math.sin(ang) * off / 1000;
    const y = -(((a.cota_linea ?? a.cota ?? 22)) / 1000) * EXAG;
    let mejor = null;
    for (let i = 0; i < v.length - 1; i++) {
      const p = v[i], q = v[i + 1];
      const dx = q.x - p.x, dz = q.z - p.z;
      const n2 = dx * dx + dz * dz || 1e-12;
      const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (z - p.z) * dz) / n2));
      const cx = p.x + dx * t, cz = p.z + dz * t, cy = p.y + (q.y - p.y) * t;
      const d = Math.hypot(x - cx, z - cz);
      if (!mejor || d < mejor.d) mejor = { d, dy: y - cy };
    }
    if (mejor) salida.push({ est: a.est, linea: a.l, dist_m: +(mejor.d * 1000).toFixed(2), salto_cota_m: +(mejor.dy * 1000).toFixed(2) });
  }
  const ds = salida.map(o => o.dist_m).sort((x, y) => x - y);
  const ys = salida.map(o => Math.abs(o.salto_cota_m)).sort((x, y) => x - y);
  return { n: salida.length, dist_mediana: ds[ds.length >> 1], dist_p95: ds[Math.floor(ds.length * .95)],
           cota_max: ys[ys.length - 1], peores: salida.sort((a, b) => b.dist_m - a.dist_m).slice(0, 5), muestra: salida.slice(0, 3) };
};
function initSpatialModels(){spatialGroup=new THREE.Group();scene.add(spatialGroup);window.spatialModelDiagnostics=[];for(const m of models){const group=new THREE.Group();const anchor=xyz(m.anchor.lon,m.anchor.lat,.035);group.position.copy(anchor);group.visible=false;spatialGroup.add(group);const ring=new THREE.Mesh(new THREE.RingGeometry(.028,.043,32),new THREE.MeshBasicMaterial({color:0xff9147,side:THREE.DoubleSide,depthTest:false}));ring.rotation.x=-Math.PI/2;ring.renderOrder=20;group.add(ring);const entry={m,group,root:null,ring,loaded:false};spatialModels.set(m.id,entry);loadSpatialModel(entry)}}
async function loadSpatialModel(entry){const {m,group}=entry;await datosAltura;try{const gltf=await new GLTFLoader().loadAsync(m.file);const root=gltf.scene;const box=new THREE.Box3().setFromObject(root),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());const enc=encaje.get(m.id),fila=colocacion.get(m.id);
// metros_por_unidad es la escala REAL del croquis (la calculó build_encaje.py);
// 1e-3 asumía 1 unidad = 1 mm, y por eso el modelo salía 4-6 veces pequeño
const factor=((enc&&enc.metros_por_unidad)||1000)*1e-3;
root.position.sub(center);const wrapper=new THREE.Group();wrapper.add(root);wrapper.scale.setScalar(factor);
const giro=(enc&&enc.giro_conjunto_deg!=null)?enc.giro_conjunto_deg:(fila?.giro||0);
wrapper.rotation.y=THREE.MathUtils.degToRad(giro);
if(enc&&enc.traslacion_conjunto){wrapper.position.x+=enc.traslacion_conjunto[0]*factor;wrapper.position.z-=enc.traslacion_conjunto[1]*factor;}
else if(fila){wrapper.position.x+=(fila.dx||0)*1e-3;wrapper.position.z-=(fila.dy||0)*1e-3;}
const yAnden=(enc&&enc.andenes&&enc.andenes[0]&&enc.andenes[0].path_encajado)?enc.andenes[0].path_encajado[0][1]:0;
wrapper.position.y=-(fila?.cota??22)/1000*EXAG-yAnden*factor;group.add(wrapper);
/* el modelo no se toca: es la verdad. La vía se adapta a él. */
root.traverse(o=>{if(!o.isMesh)return;o.castShadow=false;o.receiveShadow=false;o.userData.mapModelId=m.id;const edge=new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry,30),new THREE.LineBasicMaterial({color:0x324a68,transparent:true,opacity:.35}));edge.name='map_outline';o.add(edge)});entry.root=wrapper;entry.sourceCenter=center.clone();entry.sourceFactor=factor;entry.loaded=true;spatialRebuildNeeded=true;spatialLoadCount++;$('#spatial-status').textContent=`${spatialLoadCount}/12 modelos listos · visibles al acercar`;window.spatialModelDiagnostics.push({id:m.id,anchor:m.anchor,loaded:true,normalized_max_extent:.5,profiles:m.platforms.map(p=>({line:p.line,meshes:p.mesh_names,level_in_file:p.level_in_file}))});if(activeSpatialModel===m.id)$('#spatial-status').textContent=m.name+' sobre su anclaje CRTM'}catch(err){entry.error=err.message;window.spatialModelDiagnostics.push({id:m.id,loaded:false,error:err.message});$('#spatial-status').textContent='Algún modelo no se pudo cargar. El atlas sigue disponible.'}}
let spatialRebuildNeeded=false;
function activeStationEntry(s){for(const entry of spatialModels.values()){if(entry.loaded&&entry.group.visible&&s.raw.some(r=>entry.m.raw.includes(r)))return entry}return null}
function worldPlatformPath(entry,p){entry.group.updateMatrixWorld(true);const base=p.path;return base.map(a=>new THREE.Vector3(a[0],a[1],a[2]).sub(entry.sourceCenter).applyMatrix4(entry.root.matrixWorld))}
function stationLinePosition(s,line){const entry=activeStationEntry(s),p=entry?.m.platforms?.find(p=>p.line===line);if(p){const path=worldPlatformPath(entry,p);return path[Math.floor(path.length/2)].clone().add(new THREE.Vector3(0,.001,0))}return xyz(s.lon,s.lat,layerHeight(line)+.02)}
// --- Cota y trazado: la vía del CRTM es la verdad -------------------------
// El perfil de metro.json da la cota a lo largo de la vía (rampas suaves y
// monótonas). La vía se dibuja tal cual: no se pliega sobre ningún croquis.
let perfilesLinea=new Map(),shapesLinea=new Map();
function prepararPerfiles(metro){
  if(!metro||!metro.shapes)return;
  const ids=new Map();
  for(const p of metro.patterns||[]){
    if(!ids.has(String(p.l)))ids.set(String(p.l),new Set());
    ids.get(String(p.l)).add(p.s);
  }
  for(const [linea,set] of ids){
    const si=[...set].sort((a,b)=>a-b)[0];
    const sh=metro.shapes[si],pf=metro.perfiles?.[String(si)];
    if(!sh)continue;
    shapesLinea.set(linea,sh);
    if(pf&&pf.length)perfilesLinea.set(linea,pf);
  }
}
const cotaEnPerfil=(linea,s)=>{
  const pf=perfilesLinea.get(String(linea));
  if(!pf||!pf.length||s==null)return null;
  if(s<=pf[0][0])return -(pf[0][1]/1000)*EXAG;
  for(let i=0;i<pf.length-1;i++){
    const s0=pf[i][0],c0=pf[i][1],s1=pf[i+1][0],c1=pf[i+1][1];
    if(s>=s0&&s<=s1){const t=s1>s0?(s-s0)/(s1-s0):0;return -((c0+(c1-c0)*t)/1000)*EXAG}
  }
  return -(pf[pf.length-1][1]/1000)*EXAG;
};
// distancia recorrida sobre la traza del punto del mundo (x,z) más cercano
const sEnTraza=(linea,x,z)=>{
  const sh=shapesLinea.get(String(linea));
  if(!sh||!sh.cum)return null;
  const lat=40.43-z/111.32,lon=x/84.8-3.7;
  const pts=sh.pts,cum=sh.cum;
  const kx=111320*Math.cos(lat*Math.PI/180),ky=111320;
  let mejor=1e18,s=0;
  for(let i=0;i<pts.length-1;i++){
    const ax=(pts[i][1]-lon)*kx,ay=(pts[i][0]-lat)*ky;
    const bx=(pts[i+1][1]-lon)*kx,by=(pts[i+1][0]-lat)*ky;
    const dx=bx-ax,dy=by-ay,n2=dx*dx+dy*dy;
    const t=n2===0?0:Math.max(0,Math.min(1,-(ax*dx+ay*dy)/n2));
    const d=Math.hypot(ax+dx*t,ay+dy*t);
    if(d<mejor){mejor=d;s=cum[i]+(cum[i+1]-cum[i])*t}
  }
  return mejor<80?s:null;
};
function connectedEdgePath(e){
  // densificar sin mover un solo punto de la vía; la cota sale del perfil
  const base=e.coords.map(c=>xyz(c[0],c[1],0));
  const linea=String(e.line);
  const sA=sEnTraza(linea,base[0].x,base[0].z);
  const sB=sEnTraza(linea,base[base.length-1].x,base[base.length-1].z);
  const puntos=[];
  const nTramos=base.length-1;
  for(let i=0;i<nTramos;i++){
    const a=base[i],b=base[i+1],d=Math.hypot(b.x-a.x,b.z-a.z),n=Math.max(1,Math.ceil(d/0.008));
    for(let k=0;k<n;k++){
      const p=a.clone().lerp(b,k/n);
      const t=(i+k/n)/(nTramos||1);
      const c=(sA!=null&&sB!=null)?cotaEnPerfil(linea,sA+(sB-sA)*t):null;
      p.y=(c!=null)?c:(cotaY(e.a)+(cotaY(e.b)-cotaY(e.a))*t);
      puntos.push(p);
    }
  }
  const fin=base[base.length-1].clone();
  const cFin=(sA!=null&&sB!=null)?cotaEnPerfil(linea,sB):null;
  fin.y=(cFin!=null)?cFin:cotaY(e.b);
  puntos.push(fin);
  return puntos;
}

function updateSpatialModels(){if(andenGroup){andenGroup.visible=spatialVisible&&camera.zoom>2.2;if(andenSizeLast!==spatialSize)actualizarAndenes();}if(!spatialGroup)return;let changed=spatialRebuildNeeded;spatialRebuildNeeded=false;for(const entry of spatialModels.values()){const {m,group,root}=entry;const s=data.stations.find(s=>s.raw.some(r=>m.raw.includes(r)));const line=s?.lines.find(l=>!hiddenLines.has(l));const visible=!!line&&entry.loaded&&activeSpatialModel===m.id;if(group.visible!==visible)changed=true;group.visible=visible;group.position.y=.035;if(root){const base=root.userData.baseScale||(root.userData.baseScale=root.scale.x);if(root.scale.x!==base*spatialSize)changed=true;root.scale.setScalar(base*spatialSize)}}if(changed){buildMap();updateVisuals()}}
function focusMapModel(m,{top=false,side=false}={}){if(!m||!camera)return;activeSpatialModel=m.id;spatialLevelDetail=side;spatialVisible=true;spatialRebuildNeeded=true;$('#map-models-toggle').textContent='Ocultar 3D';$('#map-models-toggle').setAttribute('aria-pressed','true');const s=data.stations.find(s=>s.raw.some(r=>m.raw.includes(r)));if(s){hiddenLines.clear();selected=s.id}$('#station-card').hidden=true;$('.map-title').hidden=true;$('#spatial-selection').hidden=false;$('.spatial-tools').classList.add('spatial-focused');$('#spatial-name').textContent=m.name+' · SOBRE EL MAPA';$('#spatial-credit').textContent='Anclaje CRTM '+m.anchor.raw_station_code+' · '+m.anchor.lat.toFixed(5)+', '+m.anchor.lon.toFixed(5)+'. Enlace a '+m.platforms.length+' líneas en sus franjas del archivo. Orden alto→bajo: '+m.platforms.slice().sort((a,b)=>b.level_in_file-a.level_in_file).map(p=>p.line==='R'?'R':'L'+p.line).join(' / ')+'. Andén y vía a la misma cota real.';$('#spatial-top').onclick=()=>focusMapModel(m,{top:true});$('#spatial-oblique').onclick=()=>focusMapModel(m);$('#spatial-levels').onclick=()=>focusMapModel(m,{side:true});$('#spatial-inspect').onclick=()=>openModel(m);setView('flat');controls.enableRotate=!top;$('.north').textContent=top?'N ↑':'Órbita libre';const target=xyz(m.anchor.lon,m.anchor.lat,layerHeight(s?.lines[0]||'1'));const zoom=innerWidth<700?18:(side?48:32);controls.maxZoom=100;const worldW=40*innerWidth/innerHeight/zoom;if(innerWidth>700)target.x-=worldW*.025;else {const offset=top?new THREE.Vector3(0,0,1):new THREE.Vector3(.35,-.7,.48).normalize();target.addScaledVector(offset,40/zoom*.245)}flyTo(target,zoom);if(cameraTween&&!top)cameraTween.toCamera=target.clone().add((side?new THREE.Vector3(0,.04,1.2):new THREE.Vector3(.8,1.3,1.1)).multiplyScalar(40));updateVisuals();updateHash();const p=new URLSearchParams(location.hash.slice(1));p.set('model',m.id);history.replaceState(null,'','#'+p.toString());if(!spatialModels.get(m.id)?.loaded)toast('Cargando geometría en su estación…');}
$('#map-model-size').oninput=()=>{spatialRebuildNeeded=true;spatialSize=Number($('#map-model-size').value)/100;$('#map-size-value').textContent='×'+spatialSize.toFixed(1)};
$('#map-models-toggle').onclick=()=>{spatialVisible=!spatialVisible;$('#map-models-toggle').textContent=spatialVisible?'Ocultar 3D':'Mostrar 3D';$('#map-models-toggle').setAttribute('aria-pressed',String(spatialVisible))};

window.stationConnectionDiagnostics=()=>[...spatialModels.values()].filter(e=>e.loaded&&e.group.visible).map(entry=>({id:entry.m.id,profiles:entry.m.platforms.map(p=>{const strip=worldPlatformPath(entry,p),s=data.stations.find(s=>s.raw.some(r=>entry.m.raw.includes(r))),edges=data.edges.filter(e=>e.line===p.line&&(e.a===s.id||e.b===s.id));return {line:p.line,level:p.level_in_file,world_y:strip[0].y,edges:edges.length,junction_errors:edges.map(e=>Math.min(...connectedEdgePath(e).map(x=>Math.min(x.distanceTo(strip[0]),x.distanceTo(strip.at(-1))))))}})}));

function withinLevelDetail(p){if(!spatialLevelDetail||!activeSpatialModel)return true;const m=spatialModels.get(activeSpatialModel)?.m;if(!m)return true;const a=xyz(m.anchor.lon,m.anchor.lat);return Math.hypot(p.x-a.x,p.z-a.z)<.8*spatialSize}
window.ajustarGiro = (signo) => {
  // experimento: gira todos los modelos con un signo dado y deja medir la dirección
  for (const entry of spatialModels.values()) {
    const fila = colocacion.get(entry.m.id);
    if (!entry.root || !fila || fila.giro == null) continue;
    entry.root.rotation.y = signo * THREE.MathUtils.degToRad(fila.giro);
  }
  if (scene) scene.updateMatrixWorld(true);
  return true;
};
window.encajeDiagnostics = () => {
  // Mide lo que importa: cuánto se separa la vía DIBUJADA del eje del andén.
  const salida = [];
  for (const entry of spatialModels.values()) {
    if (!entry.loaded) continue;
    const s = data.stations.find((st) => st.raw.some((r) => entry.m.raw.includes(r)));
    if (!s) continue;
    const andenes = [];
    for (const p of entry.m.platforms || []) {
      const strip = worldPlatformPath(entry, p);
      if (!strip || strip.length < 3) continue;
      const edges = data.edges.filter((e) => e.line === p.line && (e.a === s.id || e.b === s.id));
      if (!edges.length) continue;
      const linea = edges.flatMap((e) => connectedEdgePath(e));
      // centro del andén (el contorno es un anillo: sus esquinas no sirven de testigo)
      const cen = new THREE.Vector3();
      strip.forEach((v) => cen.add(v));
      cen.multiplyScalar(1 / strip.length);
      // eje del andén en el mundo (rectángulo de área mínima)
      let eje = 0, areaMin = Infinity;
      for (let i = 0; i < 90; i++) {
        const a = (i * 2 * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
        let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
        for (const p of strip) {
          const dx = p.x - cen.x, dz = p.z - cen.z, u = dx * co + dz * si, v = -dx * si + dz * co;
          u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
        }
        const ar = (u1 - u0) * (v1 - v0);
        if (ar < areaMin) { areaMin = ar; eje = (v1 - v0) > (u1 - u0) ? a + Math.PI / 2 : a; }
      }
      // dirección de la vía dibujada junto a ese punto
      let dirVia = null, dMin = Infinity;
      for (let i = 0; i < linea.length - 1; i++) {
        const q = linea[i], r = linea[i + 1];
        const d = Math.hypot(q.x - cen.x, q.z - cen.z);
        if (d < dMin) { dMin = d; dirVia = Math.atan2(r.z - q.z, r.x - q.x); }
      }
      let dif = null;
      if (dirVia !== null) {
        const g = Math.abs(((eje - dirVia) * 180) / Math.PI) % 180;
        dif = Number(Math.min(g, 180 - g).toFixed(1));
      }
      let peor = Infinity;
      for (const q of linea) {
        const d = Math.hypot(q.x - cen.x, q.z - cen.z);
        if (d < peor) peor = d;
      }
      andenes.push({
        linea: p.line,
        nivel: p.level_in_file,
        separacion_max_m: Number((peor * 1000).toFixed(1)),
        direccion_deg: dif,
      });
    }
    if (andenes.length) salida.push({ id: entry.m.id, andenes: andenes });
  }
  return salida;
};
window.__mallasDiag = () => {
  const out = [];
  for (const entry of spatialModels.values()) {
    if (!entry.loaded || !entry.meshGroups) continue;
    const filas = [];
    for (const g of entry.meshGroups) {
      const box = new THREE.Box3();
      const nombres = [];
      let n = 0;
      g.traverse((o) => { if (o.isMesh) { box.expandByObject(o); nombres.push(o.name); n++; } });
      const c = box.getCenter(new THREE.Vector3());
      const strip = worldPlatformPath(entry, { line: g.userData.linea, path: g.userData.path });
      const sc = new THREE.Vector3();
      strip.forEach((v) => sc.add(v));
      sc.multiplyScalar(1 / strip.length);
      filas.push({ linea: g.userData.linea, mallas: n, nombres: nombres.slice(0, 3), distCentroM: Math.round(c.distanceTo(sc) * 1000) });
    }
    out.push({ id: entry.m.id, filas: filas });
  }
  return out;
};
