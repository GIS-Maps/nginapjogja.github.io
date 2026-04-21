/* ============================================================
   APP.JS — WebGIS Hotel Yogyakarta
   Features: Search, Directions (OSRM), Surroundings,
             Analysis, Detail Panel
   ============================================================ */

// ── Routing ──────────────────────────────────────────────────
function showScreen(id) {
  ["s-landing", "s-map", "s-detail", "s-analysis"].forEach((s) => {
    const el = document.getElementById(s);
    if (el) el.classList.toggle("active", s === id);
  });
}

function toast(msg, ms = 2800) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove("show"), ms);
}

// ── Globals ───────────────────────────────────────────────────
let map = null,
  mapInited = false,
  tileOSM = null;
let markerMap = {},
  selectedHotelId = null;
let detailMap = null,
  detailMapInited = false;
let routeLayer = null,
  routeMarkers = [];
let radiusLayer = null,
  surroundLayer = null;
let dirMode = false,
  dirFrom = null,
  dirTo = null;
let adminLayerGroup = null; // batas wilayah Yogyakarta

// ── Go to map ─────────────────────────────────────────────────
function goToMap() {
  showScreen("s-map");
  initMap();
}

// ─────────────────────────────────────────────────────────────
// MAP INIT
// ─────────────────────────────────────────────────────────────
function initMap() {
  if (mapInited) return;
  mapInited = true;

  map = L.map("map", {
    center: YOGYA_CENTER,
    zoom: YOGYA_ZOOM,
    zoomControl: false,
    attributionControl: true,
  });

  L.control.zoom({ position: "bottomright" }).addTo(map);

  tileOSM = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '© <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
  }).addTo(map);

  HOTELS.forEach((h) => addMarker(h));
  buildSidebarList();
  loadYogyaBoundary(); // muat batas wilayah otomatis

  map.on("mousemove", (e) => {
    const el = document.getElementById("cursor-coord");
    if (el)
      el.textContent = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
  });

  map.on("zoomend", () => {
    const el = document.getElementById("zoom-level");
    if (el) el.textContent = map.getZoom();
  });

  map.on("click", onMapClick);

  toast("✅ " + HOTELS.length + " hotel berhasil dimuat");
}

// ─────────────────────────────────────────────────────────────
// BATAS WILAYAH — Kota Yogyakarta + 14 Kecamatan
// Priority: Overpass API (data resmi OSM) → fallback hardcoded
// ─────────────────────────────────────────────────────────────
async function loadYogyaBoundary() {
  if (!adminLayerGroup) {
    adminLayerGroup = L.layerGroup();
  } else {
    adminLayerGroup.clearLayers();
  }
  adminLayerGroup.addTo(map);

  const sOuter = {
    color: "#b487ea",
    weight: 4,
    fillColor: "#c871fb",
    fillOpacity: 0.08,
    interactive: false,
  };

  // Fetch dengan timeout
  async function tFetch(url, opts, ms) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { ...opts, signal: c.signal });
      clearTimeout(t);
      return r;
    } catch (e) {
      clearTimeout(t);
      throw e;
    }
  }

  let gotOuter = false,
    gotKec = false;

  // ─── 1. Batas LUAR via Nominatim (data resmi, 1 request) ───
  try {
    const r = await tFetch(
      "https://nominatim.openstreetmap.org/search?q=Kota+Yogyakarta&format=json&polygon_geojson=1&limit=5&countrycodes=id",
      { headers: { "Accept-Language": "id" } },
      8000,
    );
    const d = await r.json();
    const hit =
      d.find(
        (x) =>
          x.geojson &&
          x.class === "boundary" &&
          (x.geojson.type === "Polygon" || x.geojson.type === "MultiPolygon"),
      ) || d.find((x) => x.geojson && x.geojson.type !== "Point");
    if (hit) {
      L.geoJSON(hit.geojson, { style: sOuter }).addTo(adminLayerGroup);
      gotOuter = true;
    }
  } catch (e) {
    console.warn("Nominatim:", e.message);
  }

  // ─── 2. Batas KECAMATAN via Overpass ───────────────────────
  try {
    const q = `[out:json][timeout:20];
area["name"="Kota Yogyakarta"]["admin_level"="5"]->.kota;
relation["admin_level"="6"](area.kota);
out geom;`;
    const r = await tFetch(
      "https://overpass-api.de/api/interpreter",
      { method: "POST", body: "data=" + encodeURIComponent(q) },
      15000,
    );
    const d = await r.json();
    if (d.elements && d.elements.length > 0) {
      d.elements.forEach((rel) => {
        (rel.members || [])
          .filter(
            (m) => m.role === "outer" && m.geometry && m.geometry.length > 2,
          )
          .forEach((m) =>
            L.polygon(
              m.geometry.map((p) => [p.lat, p.lon]),
              sKec,
            ).addTo(adminLayerGroup),
          );
      });
      gotKec = true;
    }
  } catch (e) {
    console.warn("Overpass:", e.message);
  }

  // ─── 3. Fallback hardcoded jika API gagal ──────────────────
  if (!gotOuter) {
    L.polygon(
      [
        [-7.7525, 110.3335],
        [-7.751, 110.3375],
        [-7.75, 110.345],
        [-7.7495, 110.353],
        [-7.7492, 110.3612],
        [-7.7493, 110.3695],
        [-7.7495, 110.3775],
        [-7.75, 110.3855],
        [-7.7512, 110.3935],
        [-7.7532, 110.4005],
        [-7.7562, 110.4068],
        [-7.7605, 110.4108],
        [-7.7665, 110.4125],
        [-7.7735, 110.4118],
        [-7.7802, 110.4095],
        [-7.7862, 110.4058],
        [-7.7918, 110.4002],
        [-7.7965, 110.3948],
        [-7.8005, 110.3912],
        [-7.8048, 110.3888],
        [-7.8088, 110.3865],
        [-7.8128, 110.3842],
        [-7.8162, 110.3815],
        [-7.8185, 110.3778],
        [-7.8198, 110.3732],
        [-7.8195, 110.3682],
        [-7.8182, 110.363],
        [-7.8162, 110.3578],
        [-7.8132, 110.3528],
        [-7.8092, 110.3485],
        [-7.8045, 110.3448],
        [-7.7995, 110.3415],
        [-7.794, 110.3385],
        [-7.7878, 110.336],
        [-7.7812, 110.334],
        [-7.774, 110.3328],
        [-7.7665, 110.3325],
        [-7.7588, 110.3325],
        [-7.7525, 110.333],
      ],
      sOuter,
    ).addTo(adminLayerGroup);
  }

  if (!gotKec) {
    [
      // Tegalrejo
      [
        [-7.7525, 110.333],
        [-7.7492, 110.361],
        [-7.766, 110.361],
        [-7.766, 110.333],
      ],
      // Jetis
      [
        [-7.7492, 110.361],
        [-7.7493, 110.37],
        [-7.766, 110.37],
        [-7.766, 110.361],
      ],
      // Gondokusuman
      [
        [-7.7493, 110.37],
        [-7.75, 110.3855],
        [-7.7562, 110.4068],
        [-7.7665, 110.4125],
        [-7.7802, 110.4095],
        [-7.7802, 110.37],
        [-7.766, 110.37],
      ],
      // Wirobrajan
      [
        [-7.766, 110.333],
        [-7.766, 110.361],
        [-7.78, 110.361],
        [-7.78, 110.333],
      ],
      // Gedongtengen
      [
        [-7.766, 110.361],
        [-7.766, 110.37],
        [-7.78, 110.37],
        [-7.78, 110.361],
      ],
      // Danurejan
      [
        [-7.766, 110.37],
        [-7.766, 110.38],
        [-7.78, 110.38],
        [-7.78, 110.37],
      ],
      // Ngampilan
      [
        [-7.78, 110.361],
        [-7.78, 110.37],
        [-7.794, 110.37],
        [-7.794, 110.361],
      ],
      // Gondomanan
      [
        [-7.78, 110.37],
        [-7.78, 110.38],
        [-7.794, 110.38],
        [-7.794, 110.37],
      ],
      // Kraton
      [
        [-7.78, 110.38],
        [-7.7802, 110.4095],
        [-7.7918, 110.4002],
        [-7.794, 110.39],
        [-7.794, 110.38],
      ],
      // Pakualaman/Kraton barat
      [
        [-7.78, 110.333],
        [-7.78, 110.361],
        [-7.794, 110.361],
        [-7.794, 110.333],
      ],
      // Mantrijeron
      [
        [-7.794, 110.333],
        [-7.794, 110.361],
        [-7.8195, 110.361],
        [-7.8162, 110.3578],
        [-7.8132, 110.3528],
        [-7.8045, 110.3448],
        [-7.7995, 110.3415],
        [-7.794, 110.3385],
      ],
      // Mergangsan
      [
        [-7.794, 110.361],
        [-7.794, 110.38],
        [-7.8195, 110.38],
        [-7.8195, 110.361],
      ],
      // Umbulharjo
      [
        [-7.794, 110.38],
        [-7.794, 110.39],
        [-7.7918, 110.4002],
        [-7.7965, 110.3948],
        [-7.8048, 110.3888],
        [-7.8128, 110.3842],
        [-7.8185, 110.3778],
        [-7.8198, 110.3732],
        [-7.8195, 110.38],
      ],
      // Kotagede
      [
        [-7.8195, 110.361],
        [-7.8195, 110.38],
        [-7.8198, 110.3732],
        [-7.8185, 110.3778],
        [-7.8162, 110.3815],
        [-7.8195, 110.368],
        [-7.8182, 110.363],
        [-7.8162, 110.3578],
        [-7.8195, 110.361],
      ],
    ].forEach((c) => L.polygon(c, sKec).addTo(adminLayerGroup));
  }

  // Markers tetap di depan
  Object.values(markerMap).forEach(({ marker }) => {
    try {
      marker.bringToFront();
    } catch {}
  });
}

// ── Markers ───────────────────────────────────────────────────
function makeIcon(cat) {
  const meta = CAT_META[cat] || CAT_META["Bintang 3"];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 30 40">
    <path d="M15 0C6.716 0 0 6.716 0 15c0 10 15 25 15 25S30 25 30 15C30 6.716 23.284 0 15 0z"
          fill="${meta.color}" stroke="white" stroke-width="1.5"/>
    <circle cx="15" cy="15" r="8" fill="white" opacity="0.9"/>
    <text x="15" y="19.5" text-anchor="middle" font-size="8.5"
          font-weight="700" fill="${meta.color}" font-family="sans-serif">🏨</text>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [30, 40],
    iconAnchor: [15, 40],
    popupAnchor: [0, -42],
  });
}

function addMarker(h) {
  const meta = CAT_META[h.category] || {};
  const stars = "★".repeat(h.stars) + "☆".repeat(5 - h.stars);
  const capColor =
    h.capacity >= 85 ? "#DC2626" : h.capacity >= 70 ? "#D97706" : "#16A34A";

  const wsmColor =
    h.wsm >= 7.5 ? "#16A34A" : h.wsm >= 6.0 ? "#D97706" : "#DC2626";
  const popupHtml = `
    <div class="p-img">
      <img src="${h.photo}" alt="${h.name}"
        onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <div style="display:none;width:100%;height:100%;background:linear-gradient(135deg,#1C2B4A,#243659);
        align-items:center;justify-content:center;font-size:2.5rem">🏨</div>
      <div class="p-img-overlay"></div>
      <div class="p-img-name">${h.name}</div>
    </div>
    <div class="p-body">
      <div class="p-stars">${stars} <small style="color:#94A3B8;font-size:.68rem">${h.category}</small></div>
      <div class="p-stats">
        <div class="p-stat">
          <div class="lbl">TOTAL ROOMS</div>
          <div class="val">${h.rooms}</div>
        </div>
        <div class="p-stat">
          <div class="lbl">CAPACITY</div>
          <div class="val" style="color:${capColor}">${h.capacity}%</div>
        </div>
        <div class="p-stat">
          <div class="lbl">WSM SCORE</div>
          <div class="val" style="color:${wsmColor}">${h.wsm}</div>
        </div>
        <div class="p-stat">
          <div class="lbl">GEODESIGN</div>
          <div class="val">${h.geodesign}</div>
        </div>
      </div>
      <div class="p-row">📍 ${h.address}</div>
      <div class="p-row">🚶 ${h.distance_tugu}</div>
      <div class="p-row">📞 ${h.phone}</div>
      <div class="p-actions">
        <button class="p-btn p-btn-primary" onclick="openDetail('${h.id}')">VIEW ASSET DETAIL</button>
        <button class="p-btn p-btn-dir" onclick="startDirectionTo('${h.id}')">🗺️ Rute</button>
      </div>
    </div>`;

  const m = L.marker([h.lat, h.lng], { icon: makeIcon(h.category) })
    .bindPopup(popupHtml, { maxWidth: 290, minWidth: 280 })
    .addTo(map);

  m.on("click", () => {
    selectedHotelId = h.id;
    highlightSidebarItem(h.id);
    showSurroundings(h);
  });

  markerMap[h.id] = { marker: m, hotel: h };
}

function highlightSidebarItem(id) {
  document.querySelectorAll(".hli").forEach((el) => {
    el.classList.toggle("selected", el.dataset.id === id);
  });
}

// ── Sidebar List ──────────────────────────────────────────────
function buildSidebarList() {
  const container = document.getElementById("hotel-list");
  if (!container) return;
  container.innerHTML = HOTELS.map((h) => {
    const meta = CAT_META[h.category] || {};
    return `<div class="hli" data-id="${h.id}" onclick="flyToHotel('${h.id}')">
      <div class="hli-dot" style="background:${meta.color}"></div>
      <div class="hli-info">
        <div class="hli-name">${h.name}</div>
        <div class="hli-kec">${h.kecamatan} · ${h.category}</div>
      </div>
      <div class="hli-score">${h.geodesign}</div>
    </div>`;
  }).join("");
}

function flyToHotel(id) {
  const item = markerMap[id];
  if (!item) return;
  selectedHotelId = id;
  highlightSidebarItem(id);
  map.flyTo([item.hotel.lat, item.hotel.lng], 16, { duration: 0.9 });
  setTimeout(() => item.marker.openPopup(), 950);
  showSurroundings(item.hotel);
}

function resetView() {
  if (map) map.flyTo(YOGYA_CENTER, YOGYA_ZOOM, { duration: 1 });
}

// ─────────────────────────────────────────────────────────────
// SEARCH (Nominatim + hotel name)
// ─────────────────────────────────────────────────────────────
let searchTimer = null;

function onSearchInput(val) {
  clearTimeout(searchTimer);
  const drop = document.getElementById("search-drop");
  if (val.length < 2) {
    drop.classList.remove("open");
    return;
  }
  searchTimer = setTimeout(() => performSearch(val), 350);
}

function performSearch(q) {
  const drop = document.getElementById("search-drop");
  drop.innerHTML = "";

  // Local hotel search first
  const localResults = HOTELS.filter(
    (h) =>
      h.name.toLowerCase().includes(q.toLowerCase()) ||
      h.address.toLowerCase().includes(q.toLowerCase()) ||
      h.kecamatan.toLowerCase().includes(q.toLowerCase()),
  ).slice(0, 4);

  localResults.forEach((h) => {
    const meta = CAT_META[h.category] || {};
    const item = document.createElement("div");
    item.className = "sr-item";
    item.innerHTML = `
      <span style="font-size:.9rem">🏨</span>
      <div>
        <div class="sr-name">${h.name}</div>
        <div class="sr-addr">${h.address}</div>
      </div>
      <span class="sr-badge" style="background:${meta.bg};color:${meta.color};border:1px solid ${meta.color}44">
        ${h.category}
      </span>`;
    item.onclick = () => {
      flyToHotel(h.id);
      clearSearch();
    };
    drop.appendChild(item);
  });

  // Nominatim geocoding for non-hotel results
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ", Yogyakarta")}&format=json&limit=3&addressdetails=1`;
  fetch(url, { headers: { "Accept-Language": "id" } })
    .then((r) => r.json())
    .then((data) => {
      data.slice(0, 3).forEach((place) => {
        const item = document.createElement("div");
        item.className = "sr-item";
        item.innerHTML = `
          <span style="font-size:.9rem">📍</span>
          <div>
            <div class="sr-name">${place.name || place.display_name.split(",")[0]}</div>
            <div class="sr-addr">${place.display_name.split(",").slice(1, 3).join(",").trim()}</div>
          </div>`;
        item.onclick = () => {
          map.flyTo([+place.lat, +place.lon], 17);
          L.popup()
            .setLatLng([+place.lat, +place.lon])
            .setContent(`<b>📍 ${place.display_name.split(",")[0]}</b>`)
            .openOn(map);
          clearSearch();
        };
        drop.appendChild(item);
      });
      drop.classList.toggle("open", drop.children.length > 0);
    })
    .catch(() => {
      drop.classList.toggle("open", drop.children.length > 0);
    });

  drop.classList.toggle("open", localResults.length > 0);
}

function clearSearch() {
  document.getElementById("search-input").value = "";
  document.getElementById("search-drop").classList.remove("open");
}

// ─────────────────────────────────────────────────────────────
// DIRECTIONS (OSRM)
// ─────────────────────────────────────────────────────────────
function startDirectionTo(hotelId) {
  const h = HOTELS.find((x) => x.id === hotelId);
  if (!h) return;
  dirTo = [h.lat, h.lng];
  document.getElementById("dir-to").value = h.name;
  document.getElementById("dir-panel").classList.add("open");
  toast("📍 Masukkan titik awal atau gunakan lokasi Anda");
}

function openDirPanel() {
  document.getElementById("dir-panel").classList.add("open");
}
function closeDirPanel() {
  document.getElementById("dir-panel").classList.remove("open");
}

function useMyLocation() {
  if (!navigator.geolocation) {
    toast("❌ Geolokasi tidak tersedia");
    return;
  }
  toast("🔍 Mencari lokasi Anda...");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      dirFrom = [pos.coords.latitude, pos.coords.longitude];
      document.getElementById("dir-from").value =
        `${dirFrom[0].toFixed(5)}, ${dirFrom[1].toFixed(5)}`;
      toast("✅ Lokasi ditemukan");
    },
    () => {
      toast("❌ Izin lokasi ditolak");
    },
  );
}

async function getDirections() {
  const fromVal = document.getElementById("dir-from").value.trim();
  const toVal = document.getElementById("dir-to").value.trim();
  if (!fromVal && !dirFrom) {
    toast("⚠️ Masukkan titik awal atau gunakan lokasi Anda");
    return;
  }
  if (!toVal && !dirTo) {
    toast("⚠️ Masukkan tujuan hotel");
    return;
  }

  toast("🔍 Mencari koordinat...");

  // Resolve origin
  if (!dirFrom) {
    const r = await geocode(fromVal);
    if (!r) {
      toast("❌ Titik awal tidak ditemukan. Coba nama jalan / landmark.");
      return;
    }
    dirFrom = r;
  }

  // Resolve destination
  if (!dirTo) {
    const found = HOTELS.find((h) =>
      h.name.toLowerCase().includes(toVal.toLowerCase()),
    );
    if (found) {
      dirTo = [found.lat, found.lng];
    } else {
      const r = await geocode(toVal);
      if (!r) {
        toast("❌ Tujuan tidak ditemukan.");
        return;
      }
      dirTo = r;
    }
  }

  toast("🛣️ Menghitung rute...");

  // Hapus rute lama (tapi simpan dirFrom/dirTo)
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }
  routeMarkers.forEach((m) => map.removeLayer(m));
  routeMarkers = [];

  // Coba beberapa OSRM endpoint (fallback)
  const OSRM_URLS = [
    `https://router.project-osrm.org/route/v1/driving/${dirFrom[1]},${dirFrom[0]};${dirTo[1]},${dirTo[0]}?overview=full&geometries=geojson`,
    `https://routing.openstreetmap.de/routed-car/route/v1/driving/${dirFrom[1]},${dirFrom[0]};${dirTo[1]},${dirTo[0]}?overview=full&geometries=geojson`,
  ];

  let success = false;
  for (const url of OSRM_URLS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.code !== "Ok" || !data.routes.length) continue;

      const route = data.routes[0];
      const coords = route.geometry.coordinates.map((c) => [c[1], c[0]]);
      const dist = (route.distance / 1000).toFixed(1);
      const time = Math.round(route.duration / 60);

      // Gambar rute di peta
      routeLayer = L.polyline(coords, {
        color: "#1A73E8",
        weight: 6,
        opacity: 0.85,
      }).addTo(map);

      // Shadow rute (efek Google Maps)
      L.polyline(coords, {
        color: "#0D47A1",
        weight: 8,
        opacity: 0.25,
      }).addTo(map);
      routeMarkers.push(routeLayer);

      // Marker A dan B
      const mkA = L.marker(dirFrom, {
        icon: pinIcon("A", "#16A34A"),
        zIndexOffset: 1000,
      })
        .addTo(map)
        .bindPopup("📍 <b>Titik Awal</b>")
        .openPopup();
      const mkB = L.marker(dirTo, {
        icon: pinIcon("B", "#DC2626"),
        zIndexOffset: 1000,
      })
        .addTo(map)
        .bindPopup("🏨 <b>Tujuan</b>");
      routeMarkers.push(mkA, mkB);

      map.fitBounds(routeLayer.getBounds(), { padding: [60, 60] });

      const result = document.getElementById("dir-result");
      result.innerHTML = `🛣️ <b>${dist} km</b> &nbsp;·&nbsp; ⏱️ <b>${time} menit</b> mengemudi`;
      result.style.display = "block";
      toast(`✅ Rute ditemukan: ${dist} km · ${time} menit`);
      success = true;
      break;
    } catch (e) {
      continue; // coba endpoint berikutnya
    }
  }

  if (!success) {
    // Fallback: gambar garis lurus
    routeLayer = L.polyline([dirFrom, dirTo], {
      color: "#1A73E8",
      weight: 4,
      opacity: 0.7,
      dashArray: "10,8",
    }).addTo(map);
    routeMarkers.push(routeLayer);
    const mkA = L.marker(dirFrom, { icon: pinIcon("A", "#16A34A") })
      .addTo(map)
      .bindPopup("📍 Titik Awal")
      .openPopup();
    const mkB = L.marker(dirTo, { icon: pinIcon("B", "#DC2626") })
      .addTo(map)
      .bindPopup("🏨 Tujuan");
    routeMarkers.push(mkA, mkB);
    map.fitBounds(routeLayer.getBounds(), { padding: [60, 60] });
    const d = (map.distance(dirFrom, dirTo) / 1000).toFixed(1);
    const result = document.getElementById("dir-result");
    result.innerHTML = `📏 Jarak lurus: <b>${d} km</b> <small style="color:#D97706">(rute jalan tidak tersedia saat ini)</small>`;
    result.style.display = "block";
    toast("⚠️ Server routing sibuk, menampilkan jarak lurus");
  }
}

async function geocode(q) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ", Yogyakarta")}&format=json&limit=1`;
  try {
    const r = await fetch(url, { headers: { "Accept-Language": "id" } });
    const d = await r.json();
    if (d.length) return [+d[0].lat, +d[0].lon];
  } catch {}
  return null;
}

function clearRoute() {
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }
  routeMarkers.forEach((m) => {
    try {
      map.removeLayer(m);
    } catch {}
  });
  routeMarkers = [];
  dirFrom = null;
  dirTo = null;
  document.getElementById("dir-from").value = "";
  document.getElementById("dir-to").value = "";
  const r = document.getElementById("dir-result");
  if (r) {
    r.innerHTML = "";
    r.style.display = "none";
  }
  toast("✕ Rute dihapus");
}

function pinIcon(label, color) {
  return L.divIcon({
    html: `<div style="width:26px;height:26px;border-radius:50%;background:${color};
           color:#fff;font-weight:700;font-size:.78rem;display:flex;align-items:center;
           justify-content:center;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,.3)">${label}</div>`,
    className: "",
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

// ─────────────────────────────────────────────────────────────
// SURROUNDINGS (Overpass API)
// ─────────────────────────────────────────────────────────────
async function showSurroundings(h) {
  // Remove old
  if (radiusLayer) {
    map.removeLayer(radiusLayer);
    radiusLayer = null;
  }
  if (surroundLayer) {
    map.removeLayer(surroundLayer);
    surroundLayer = null;
  }

  // Draw 500m circle
  radiusLayer = L.circle([h.lat, h.lng], {
    radius: 500,
    color: "#0B9F97",
    fillColor: "#0B9F97",
    fillOpacity: 0.06,
    weight: 1.5,
    dashArray: "6,4",
  }).addTo(map);

  // Fetch nearby POI via Overpass
  const panel = document.getElementById("surr-panel");
  const body = document.getElementById("surr-body");
  panel.classList.add("open");
  body.innerHTML =
    '<div class="surr-item"><span class="surr-icon">⏳</span><span class="surr-name">Memuat area sekitar...</span></div>';

  const overpass = `
    [out:json][timeout:10];
    (
      node["amenity"~"restaurant|cafe|atm|hospital|pharmacy|bank|fuel|parking"](around:500,${h.lat},${h.lng});
      node["tourism"~"attraction|museum|viewpoint"](around:500,${h.lat},${h.lng});
    );
    out 12;`;

  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: "data=" + encodeURIComponent(overpass),
    });
    const data = await res.json();
    const items = data.elements
      .filter((el) => el.tags && el.tags.name)
      .slice(0, 10);

    if (!items.length) {
      body.innerHTML =
        '<div class="surr-item"><span>📍 Area sekitar tidak ada data</span></div>';
      return;
    }

    const typeIcon = {
      restaurant: "🍽️",
      cafe: "☕",
      atm: "🏧",
      hospital: "🏥",
      pharmacy: "💊",
      bank: "🏦",
      fuel: "⛽",
      parking: "🅿️",
      attraction: "🗺️",
      museum: "🏛️",
      viewpoint: "👁️",
    };

    body.innerHTML = items
      .map((el) => {
        const dist = map.distance([h.lat, h.lng], [el.lat, el.lon]);
        const icon =
          typeIcon[el.tags.amenity] || typeIcon[el.tags.tourism] || "📍";
        return `<div class="surr-item">
        <span class="surr-icon">${icon}</span>
        <span class="surr-name">${el.tags.name}</span>
        <span class="surr-dist">${dist < 1000 ? Math.round(dist) + "m" : (dist / 1000).toFixed(1) + "km"}</span>
      </div>`;
      })
      .join("");

    // Add dots on map
    surroundLayer = L.layerGroup();
    items.forEach((el) => {
      const icon =
        typeIcon[el.tags.amenity] || typeIcon[el.tags.tourism] || "📍";
      L.circleMarker([el.lat, el.lon], {
        radius: 5,
        color: "#2563EB",
        fillColor: "#2563EB",
        fillOpacity: 0.7,
        weight: 1.5,
      })
        .bindPopup(`${icon} <b>${el.tags.name}</b>`)
        .addTo(surroundLayer);
    });
    surroundLayer.addTo(map);
  } catch {
    body.innerHTML =
      '<div class="surr-item">📡 Gagal memuat data sekitar</div>';
  }
}

function closeSurroundings() {
  document.getElementById("surr-panel").classList.remove("open");
  if (radiusLayer) {
    map.removeLayer(radiusLayer);
    radiusLayer = null;
  }
  if (surroundLayer) {
    map.removeLayer(surroundLayer);
    surroundLayer = null;
  }
}

// ── Map click (for direction picking) ────────────────────────
function onMapClick(e) {
  if (dirMode) {
    dirFrom = [e.latlng.lat, e.latlng.lng];
    document.getElementById("dir-from").value =
      `${dirFrom[0].toFixed(5)}, ${dirFrom[1].toFixed(5)}`;
    toast("✅ Titik awal dipilih");
    dirMode = false;
    map.getContainer().style.cursor = "";
  }
}

function pickFromMap() {
  dirMode = true;
  map.getContainer().style.cursor = "crosshair";
  toast("🖱️ Klik lokasi awal di peta");
}

// ── Layer toggle ──────────────────────────────────────────────
function toggleLayer(type) {
  if (type === "hotels") {
    const vis = Object.values(markerMap).some((x) => map.hasLayer(x.marker));
    Object.values(markerMap).forEach((x) =>
      vis ? map.removeLayer(x.marker) : x.marker.addTo(map),
    );
    document.getElementById("toggle-hotels").classList.toggle("off", vis);
    toast(vis ? "🙈 Hotel disembunyikan" : "👁️ Hotel ditampilkan");
  } else if (type === "admin") {
    const el = document.getElementById("toggle-admin");
    if (!adminLayerGroup) {
      toast("⏳ Memuat batas wilayah...");
      loadYogyaBoundary().then(() => {
        el && el.classList.remove("off");
      });
      return;
    }
    if (map.hasLayer(adminLayerGroup)) {
      map.removeLayer(adminLayerGroup);
      el && el.classList.add("off");
      toast("🙈 Batas administrasi disembunyikan");
    } else {
      adminLayerGroup.addTo(map);
      el && el.classList.remove("off");
      toast("👁️ Batas administrasi ditampilkan");
    }
  }
}

// ─────────────────────────────────────────────────────────────
// DETAIL PANEL
// ─────────────────────────────────────────────────────────────
function openDetail(id) {
  const h = HOTELS.find((x) => x.id === id);
  if (!h) return;

  document.getElementById("d-breadcrumb").innerHTML =
    `DATABASE <span class="bc-sep" style="color:rgba(255,255,255,.3)">›</span>
     ACCOMMODATION <span class="bc-sep" style="color:rgba(255,255,255,.3)">›</span>
     <span>${id}</span>`;

  document.getElementById("d-hotel-name").textContent = h.name;

  document.getElementById("d-badges").innerHTML =
    `<span class="d-badge d-badge-active">● ACTIVE MARKER</span>
     <span class="d-badge d-badge-id">ID: ${h.id}</span>
     <span class="d-badge d-badge-id">${h.category}</span>`;

  document.getElementById("d-lat").textContent = h.lat.toFixed(6);
  document.getElementById("d-lng").textContent = h.lng.toFixed(6);

  document.getElementById("d-landuse").innerHTML = h.landuse
    .map(
      (l, i) =>
        `<span class="lu-tag ${i ? "lu-tag-b" : "lu-tag-a"}">${l.toUpperCase()}</span>`,
    )
    .join("");

  document.getElementById("d-meta").textContent = h.notes;

  // Proximity to landmarks
  const landmarks = [
    { name: "TO TUGU", dist: distKm(h.lat, h.lng, -7.7829, 110.3667) },
    { name: "TO MALIOBORO", dist: distKm(h.lat, h.lng, -7.7928, 110.365) },
    { name: "TO KRATON", dist: distKm(h.lat, h.lng, -7.8053, 110.3643) },
  ];
  document.getElementById("d-prox").innerHTML = landmarks
    .map(
      (l) => `
    <div class="prox-lm-item">
      <div class="prox-lm-name">${l.name}</div>
      <div class="prox-lm-val">${l.dist}</div>
      <div class="prox-lm-unit">km</div>
    </div>`,
    )
    .join("");

  // WSM detail breakdown — gunakan HERITAGE_SCORE dari data.js
  const heritageSkor = Math.max(
    ...h.landuse.map((l) => HERITAGE_SCORE[l] || 0.2),
  );
  const wsmRank = WSM_RANKING.findIndex((x) => x.id === h.id) + 1;
  const wsmColor =
    h.wsm >= 7.5 ? "#16A34A" : h.wsm >= 6.0 ? "#D97706" : "#DC2626";
  const wsmEl = document.getElementById("d-wsm");
  if (wsmEl) {
    wsmEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.75rem">
        <div style="font-family:var(--mono);font-size:2.2rem;font-weight:600;color:${wsmColor};line-height:1">${h.wsm}</div>
        <div>
          <div style="font-size:.7rem;color:var(--muted);font-family:var(--mono);letter-spacing:.08em">WSM SCORE / 10</div>
          <div style="font-size:.72rem;color:${wsmColor};font-weight:600">Peringkat #${wsmRank} dari ${HOTELS.length} hotel</div>
        </div>
      </div>
      <div style="font-size:.68rem;color:var(--muted);font-family:var(--mono);letter-spacing:.06em;margin-bottom:.4rem">DETAIL KOMPONEN WSM</div>
      ${[
        {
          lbl: "Heritage Proximity (×0.30)",
          val: (heritageSkor * 0.3 * 10).toFixed(2),
          norm: heritageSkor * 100,
        },
        {
          lbl: "Connectivity (×0.25)",
          val: ((h.connectivity / 100) * 0.25 * 10).toFixed(2),
          norm: h.connectivity,
        },
        {
          lbl: "Service Efficiency (×0.25)",
          val: (((100 - h.serviceLoad) / 100) * 0.25 * 10).toFixed(2),
          norm: 100 - h.serviceLoad,
        },
        {
          lbl: "Geodesign Score (×0.20)",
          val: ((h.geodesign / 10) * 0.2 * 10).toFixed(2),
          norm: h.geodesign * 10,
        },
      ]
        .map(
          (c) => `
        <div style="margin-bottom:.35rem">
          <div style="display:flex;justify-content:space-between;font-size:.7rem;color:var(--muted);margin-bottom:.15rem">
            <span>${c.lbl}</span><span style="color:var(--text);font-family:var(--mono)">+${c.val}</span>
          </div>
          <div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden">
            <div style="height:100%;width:${Math.min(c.norm, 100)}%;background:var(--teal);border-radius:2px;transition:width .8s ease"></div>
          </div>
        </div>`,
        )
        .join("")}`;
  }

  showScreen("s-detail");

  setTimeout(() => {
    if (!detailMapInited) {
      detailMap = L.map("detail-map", {
        center: [h.lat, h.lng],
        zoom: 15,
        zoomControl: true,
        attributionControl: false,
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(detailMap);
      detailMapInited = true;
    } else {
      detailMap.setView([h.lat, h.lng], 15);
    }
    detailMap.eachLayer((l) => {
      if (l instanceof L.Marker || l instanceof L.Circle)
        detailMap.removeLayer(l);
    });

    L.circle([h.lat, h.lng], {
      radius: 500,
      color: "#0B9F97",
      fillColor: "#0B9F97",
      fillOpacity: 0.08,
      weight: 1.5,
      dashArray: "6,4",
    }).addTo(detailMap);

    L.marker([h.lat, h.lng], {
      icon: L.divIcon({
        html: `<div style="width:14px;height:14px;border-radius:50%;background:#0B9F97;
               border:3px solid white;box-shadow:0 0 12px rgba(11,159,151,.7)"></div>`,
        className: "",
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      }),
    })
      .addTo(detailMap)
      .bindPopup(h.name)
      .openPopup();
  }, 120);
}

function distKm(lat1, lng1, lat2, lng2) {
  if (!map) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return (R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(1);
  }
  return (map.distance([lat1, lng1], [lat2, lng2]) / 1000).toFixed(1);
}

function copyCoords() {
  const lat = document.getElementById("d-lat").textContent;
  const lng = document.getElementById("d-lng").textContent;
  navigator.clipboard
    .writeText(`${lat}, ${lng}`)
    .then(() => toast("📋 Koordinat disalin!"));
}

function backFromDetail() {
  showScreen("s-map");
}

// ─────────────────────────────────────────────────────────────
// ANALYSIS
// ─────────────────────────────────────────────────────────────
function openAnalysis() {
  showScreen("s-analysis");
  setTimeout(() => {
    drawHeatmap();
    animateMetrics();
    buildProxTable();
    buildWSMTable();
    buildDensityChart();
  }, 100);
}

function drawHeatmap() {
  const canvas = document.getElementById("heatmap-canvas");
  if (!canvas) return;
  const W = (canvas.width = canvas.offsetWidth * window.devicePixelRatio);
  const H = (canvas.height = canvas.offsetHeight * window.devicePixelRatio);
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#1C2B4A";
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(255,255,255,.04)";
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y < H; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  const LN = -7.85,
    LX = -7.74,
    LgN = 110.33,
    LgX = 110.42;
  const tx = (lat, lng) => [
    ((lng - LgN) / (LgX - LgN)) * W,
    ((lat - LX) / (LN - LX)) * H,
  ];

  HOTELS.forEach((h) => {
    const [x, y] = tx(h.lat, h.lng);
    const intens = h.capacity / 100;
    const r = (28 + intens * 55) * (W / 700);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    if (intens > 0.85) {
      g.addColorStop(0, "rgba(220,38,38,.8)");
      g.addColorStop(0.5, "rgba(217,119,6,.3)");
    } else if (intens > 0.65) {
      g.addColorStop(0, "rgba(217,119,6,.7)");
      g.addColorStop(0.5, "rgba(37,99,235,.2)");
    } else {
      g.addColorStop(0, "rgba(11,159,151,.65)");
      g.addColorStop(0.5, "rgba(37,99,235,.15)");
    }
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  });

  // City border
  const border = [
    [-7.75, 110.34],
    [-7.75, 110.41],
    [-7.77, 110.42],
    [-7.8, 110.42],
    [-7.83, 110.41],
    [-7.85, 110.39],
    [-7.85, 110.36],
    [-7.83, 110.34],
    [-7.8, 110.33],
    [-7.77, 110.33],
    [-7.75, 110.34],
  ];
  ctx.beginPath();
  border.forEach(([lt, lg], i) => {
    const [x, y] = tx(lt, lg);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.strokeStyle = "rgba(11,207,197,.5)";
  ctx.lineWidth = 2;
  ctx.stroke();

  HOTELS.forEach((h) => {
    const [x, y] = tx(h.lat, h.lng);
    const meta = CAT_META[h.category] || {};
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = meta.color || "#fff";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.6)";
    ctx.lineWidth = 1;
    ctx.stroke();
  });
}

function animateMetrics() {
  document.querySelectorAll(".mfill[data-t]").forEach((b) => {
    setTimeout(() => {
      b.style.width = b.dataset.t + "%";
    }, 250);
  });
}

function buildProxTable() {
  const tbody = document.getElementById("prox-tbody");
  if (!tbody) return;
  const rows = KECAMATAN_STATS.slice(0, 8).map((k) => {
    const hotels = HOTELS.filter((h) => h.kecamatan === k.name);
    const avgDist =
      hotels.reduce(
        (s, h) => s + distKm(h.lat, h.lng, -7.7928, 110.365) * 1,
        0,
      ) / hotels.length;
    const walkIdx = Math.max(1, Math.round(10 - avgDist * 1.5));
    const score = hotels.reduce((s, h) => s + h.geodesign, 0) / hotels.length;
    const status =
      avgDist < 0.8
        ? "OPTIMAL"
        : avgDist < 2
          ? "MODERATE"
          : avgDist < 4
            ? "ACTIONING"
            : "CRITICAL";
    const cls = {
      OPTIMAL: "tag-optimal",
      MODERATE: "tag-moderate",
      ACTIONING: "tag-actioning",
      CRITICAL: "tag-critical",
    }[status];
    const trend =
      status === "OPTIMAL" ? "↑" : status === "MODERATE" ? "→" : "↓";
    return `<tr>
      <td>${k.name}</td>
      <td class="mono">${k.count}</td>
      <td class="mono">${(avgDist * 1000).toFixed(0)}</td>
      <td class="mono">${walkIdx}</td>
      <td class="${cls}">${trend} ${status}</td>
    </tr>`;
  });
  tbody.innerHTML = rows.join("");
}

// ── WSM Ranking Table ─────────────────────────────────────────
function buildWSMTable() {
  const tbody = document.getElementById("wsm-tbody");
  if (!tbody || typeof WSM_RANKING === "undefined") return;

  const HERITAGE_SCORE_MAP = {
    "Kawasan Heritage": 1.0,
    "Zonasi Cagar Budaya": 1.0,
    "Kawasan Kraton": 0.9,
    "Kawasan Bersejarah": 0.8,
    "Kawasan Pariwisata": 0.7,
    "Komersial/Jasa": 0.4,
    "Kawasan Campuran": 0.3,
    "Ruang Terbuka Hijau": 0.3,
    Permukiman: 0.2,
  };

  const rows = WSM_RANKING.map((h, i) => {
    const heritageNorm = Math.max(
      ...h.landuse.map((l) => HERITAGE_SCORE_MAP[l] || 0.2),
    );
    const efisiensi = 100 - h.serviceLoad;
    const meta = CAT_META[h.category] || {};
    const wsmColor =
      h.wsm >= 7.5 ? "#16A34A" : h.wsm >= 6.0 ? "#D97706" : "#DC2626";
    const rankIcon =
      i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`;

    return `<tr style="cursor:pointer" onclick="flyToHotel('${h.id}');showScreen('s-map')">
      <td style="font-family:var(--mono);font-weight:700">${rankIcon}</td>
      <td style="font-weight:500">${h.name}</td>
      <td style="font-size:.72rem;color:var(--muted)">${h.kecamatan}</td>
      <td>
        <span style="background:${meta.bg};color:${meta.color};
          border:1px solid ${meta.color}44;border-radius:4px;
          font-size:.62rem;padding:.15rem .4rem;font-family:var(--mono)">${h.category}</span>
      </td>
      <td>
        <span style="font-family:var(--mono);font-size:1rem;font-weight:700;color:${wsmColor}">${h.wsm}</span>
        <div style="width:${(h.wsm / 10) * 100}%;height:3px;background:${wsmColor};border-radius:2px;margin-top:2px"></div>
      </td>
      <td style="font-family:var(--mono);font-size:.72rem">${(heritageNorm * 100).toFixed(0)}%</td>
      <td style="font-family:var(--mono);font-size:.72rem">${h.connectivity}%</td>
      <td style="font-family:var(--mono);font-size:.72rem">${efisiensi}%</td>
    </tr>`;
  });

  tbody.innerHTML = rows.join("");
}

function buildDensityChart() {
  const canvas = document.getElementById("density-chart");
  if (!canvas) return;
  const W = (canvas.width = canvas.offsetWidth * window.devicePixelRatio);
  const H = (canvas.height = canvas.offsetHeight * window.devicePixelRatio);
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);

  // Bars: count by category
  const cats = Object.keys(CAT_META);
  const counts = cats.map((c) => HOTELS.filter((h) => h.category === c).length);
  const maxC = Math.max(...counts);
  const bw = (W - 60) / cats.length;
  const colors = cats.map((c) => CAT_META[c].color);

  ctx.fillStyle = "#F4F6FA";
  ctx.fillRect(0, 0, W, H);

  cats.forEach((cat, i) => {
    const bh = (counts[i] / maxC) * (H - 40);
    const x = 30 + i * bw + bw * 0.15;
    const w = bw * 0.7;
    const y = H - 20 - bh;
    ctx.fillStyle = colors[i] + "CC";
    ctx.fillRect(x, y, w, bh);
    ctx.fillStyle = colors[i];
    ctx.fillRect(x, y, w, 4);
    ctx.fillStyle = "#64748B";
    ctx.font = `${10 * window.devicePixelRatio}px monospace`;
    ctx.textAlign = "center";
    ctx.fillText(counts[i], x + w / 2, y - 6);
    ctx.fillStyle = "#94A3B8";
    ctx.font = `${8 * window.devicePixelRatio}px monospace`;
    ctx.fillText(
      ["B5", "B4", "B3", "B2", "BTK"][i] || cat.slice(0, 3),
      x + w / 2,
      H - 4,
    );
  });
}

// ── Downloads ─────────────────────────────────────────────────
function downloadJSON() {
  const blob = new Blob([JSON.stringify(HOTELS, null, 2)], {
    type: "application/json",
  });
  dlFile(blob, "hotel-yogyakarta.json");
}
function downloadCSV() {
  const hdr =
    "ID,Nama,Kategori,Bintang,Lat,Lng,Alamat,Kecamatan,Kamar,Kapasitas%,Geodesign";
  const rows = HOTELS.map(
    (h) =>
      `${h.id},"${h.name}","${h.category}",${h.stars},${h.lat},${h.lng},"${h.address}","${h.kecamatan}",${h.rooms},${h.capacity},${h.geodesign}`,
  );
  dlFile(
    new Blob([[hdr, ...rows].join("\n")], { type: "text/csv" }),
    "hotel-yogyakarta.csv",
  );
}
function dlFile(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  toast("💾 " + name + " diunduh");
}

// ── Init ──────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  showScreen("s-landing");
  buildKecTable();
  buildLpFooter();
});

function buildKecTable() {
  const tb = document.getElementById("kec-table-body");
  if (!tb) return;
  tb.innerHTML = KECAMATAN_STATS.map((k) => {
    const meta =
      CAT_META[HOTELS.find((h) => h.kecamatan === k.name)?.category] || {};
    const status =
      k.count >= 4 ? "DENSE" : k.count >= 2 ? "MODERATE" : "SPARSE";
    const cls = {
      DENSE: "tag-critical",
      MODERATE: "tag-moderate",
      SPARSE: "tag-optimal",
    }[status];
    return `<tr>
      <td style="display:flex;align-items:center;gap:.35rem">
        <div style="width:6px;height:6px;border-radius:50%;background:${meta.color || "#888"}"></div>
        ${k.name}
      </td>
      <td class="mono">${k.count}</td>
      <td class="${cls}" style="font-family:var(--mono);font-size:.68rem">${status}</td>
    </tr>`;
  }).join("");
}

function buildLpFooter() {
  const canvas = document.getElementById("lp-footer-canvas");
  if (!canvas) return;
  const W = (canvas.width = canvas.offsetWidth || 1200);
  const H = (canvas.height = canvas.offsetHeight || 140);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1C2B4A";
  ctx.fillRect(0, 0, W, H);

  const pts = HOTELS.map((h) => ({
    x: ((h.lng - 110.33) / (110.43 - 110.33)) * W,
    y: ((h.lat - -7.74) / (-7.86 - -7.74)) * H,
    c: h.capacity / 100,
  }));

  pts.forEach((p) => {
    const r = 20 + p.c * 30;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    const col =
      p.c > 0.85
        ? "rgba(220,38,38,"
        : p.c > 0.65
          ? "rgba(217,119,6,"
          : "rgba(11,159,151,";
    g.addColorStop(0, col + "0.6)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  });
}
