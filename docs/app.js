// ============ CONFIG ============
const PAGE_PARAMS = new URLSearchParams(window.location.search);
const FORCED_CONNECT_ONLY = window.__SPOTIFY_FORCE_CONNECT_ONLY__ === true;
const CONNECT_ONLY_SESSION = window.sessionStorage.getItem('spotify-connect-only') === '1';
if (CONNECT_ONLY_SESSION) {
    window.sessionStorage.removeItem('spotify-connect-only');
}
const CONNECT_ONLY = FORCED_CONNECT_ONLY || PAGE_PARAMS.get('connect') === '1' || PAGE_PARAMS.get('view') === 'connect' || CONNECT_ONLY_SESSION;
const DATA_FULL = './spotify_clean_parquet/viz_data.json';
const DATA_TOP100K = './spotify_clean_parquet/viz_data_top100k.json';
const DATA_EDGES = './spotify_clean_parquet/edges_top100k_with_tracks.json';
const DATA_EDGES_FALLBACK = './spotify_clean_parquet/edges_top100k.json';
const MIXDNA_META = './spotify_clean_parquet/mixdna_lite_meta.json';
const MIXDNA_VECTORS = './spotify_clean_parquet/mixdna_lite_vectors.bin';

function inferApiBase() {
    const override = window.SPOTIFY_API_BASE || PAGE_PARAMS.get('api') || window.localStorage.getItem('spotify-api-base');
    if (override) return override.replace(/\/$/, '');

    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
        return `${window.location.protocol}//${window.location.hostname}:8000`;
    }

    return 'http://127.0.0.1:8000';
}

const API_BASE = inferApiBase();

// ============ STATE ============
let currentMode = CONNECT_ONLY ? 'top100k' : 'full';
let artists = [];
let artistMap = {};
let edgeMap = {};
let adjacencyList = {};

let scene, camera, renderer, controls;
let pointCloud, highlightRing, highlightGlow;
let pathLines = null;
let pathNodesHelper = null;
let pathLabels = [];
let pathRings = [];
let selectedArtist = null;
let pfSelectedFrom = null;
let pfSelectedTo = null;
let mixDnaLite = null;
let mixDnaLitePromise = null;
let sharedRouteApplied = false;

const CONNECT_EXAMPLES = [
    ['Taylor Swift', 'Ed Sheeran'],
    ['The Weeknd', 'Ariana Grande'],
    ['Rihanna', 'Eminem'],
    ['Bad Bunny', 'J Balvin'],
];

const INIT_POS = new THREE.Vector3(150, 80, 150);
const COLORS = [0x1DB954, 0xFF6B6B, 0x4ECDC4, 0xFFE66D, 0x95E1D3, 0xF38181];
const MOBILE_PATHFINDER_COLLAPSED_H = 56;
const MOBILE_PATHFINDER_MAX_VH = 0.78;

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

function clearElement(element) {
    element.replaceChildren();
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function isMobilePathfinderLayout() {
    return window.matchMedia('(max-width: 768px)').matches;
}

function getExpandedPathfinderHeight() {
    return `${Math.round(window.innerHeight * MOBILE_PATHFINDER_MAX_VH)}px`;
}

function expandPathfinderPanel() {
    const panel = document.getElementById('pathfinder-panel');
    if (!panel || !isMobilePathfinderLayout()) return;
    panel.classList.remove('collapsed');
    panel.style.maxHeight = getExpandedPathfinderHeight();
}

function setLoaderState(message, note) {
    const status = document.getElementById('loader-status');
    const loaderNote = document.getElementById('loader-note');
    if (status) status.textContent = message;
    if (loaderNote && note) loaderNote.textContent = note;
}

function normalizeArtistName(name) {
    return String(name || '').trim().toLowerCase();
}

function findArtistByName(name, allowLoose = false) {
    const normalized = normalizeArtistName(name);
    if (!normalized) return null;
    const exactMatch = artists.find(a => normalizeArtistName(a.n) === normalized);
    if (exactMatch || !allowLoose) return exactMatch;
    return artists.find(a => normalizeArtistName(a.n).includes(normalized));
}

function setPathHelper(message) {
    const helper = document.getElementById('pf-helper');
    if (helper) helper.textContent = message;
}

function buildShareUrl() {
    const url = new URL(window.location.href);
    if (CONNECT_ONLY && !FORCED_CONNECT_ONLY) url.searchParams.set('connect', '1');
    else url.searchParams.delete('connect');
    if (pfSelectedFrom?.name) url.searchParams.set('from', pfSelectedFrom.name);
    else url.searchParams.delete('from');
    if (pfSelectedTo?.name) url.searchParams.set('to', pfSelectedTo.name);
    else url.searchParams.delete('to');
    return url.toString();
}

function setPathSelection(slot, artist) {
    const input = document.getElementById(slot === 'from' ? 'pf-from-input' : 'pf-to-input');
    input.value = artist.n;

    if (slot === 'from') {
        pfSelectedFrom = { id: artist.i, name: artist.n };
    } else {
        pfSelectedTo = { id: artist.i, name: artist.n };
    }

    const shareBtn = document.getElementById('pf-share-btn');
    if (shareBtn) shareBtn.disabled = !(pfSelectedFrom && pfSelectedTo);
}

function clearPathSelections() {
    pfSelectedFrom = null;
    pfSelectedTo = null;
    document.getElementById('pf-from-input').value = '';
    document.getElementById('pf-to-input').value = '';
    document.getElementById('pf-result').style.display = 'none';
    document.getElementById('pf-result-summary').textContent = 'Choose two artists to map the shortest route.';
    document.getElementById('pf-share-btn').disabled = true;
    clearPathVisuals();
    setPathHelper('Pick two artists, hit trace, then share the route or blend their DNA with the lite model.');
}

function swapPathSelections() {
    if (!pfSelectedFrom && !pfSelectedTo) return;

    const currentFrom = pfSelectedFrom ? findArtistByName(pfSelectedFrom.name) : null;
    const currentTo = pfSelectedTo ? findArtistByName(pfSelectedTo.name) : null;

    if (currentTo) {
        setPathSelection('from', currentTo);
    } else {
        pfSelectedFrom = null;
        document.getElementById('pf-from-input').value = '';
    }

    if (currentFrom) {
        setPathSelection('to', currentFrom);
    } else {
        pfSelectedTo = null;
        document.getElementById('pf-to-input').value = '';
    }

    if (pfSelectedFrom && pfSelectedTo) {
        findPath();
    } else {
        document.getElementById('pf-result').style.display = 'none';
        clearPathVisuals();
    }
}

async function shareCurrentRoute() {
    const url = buildShareUrl();
    const shareBtn = document.getElementById('pf-share-btn');

    try {
        if (navigator.share && window.innerWidth < 900) {
            await navigator.share({
                title: 'Spotify Universe - Connect Artists',
                text: 'Trace this artist connection route',
                url,
            });
        } else if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(url);
        } else {
            window.prompt('Copy this link', url);
            return;
        }

        const previousLabel = shareBtn.textContent;
        shareBtn.textContent = 'Copied';
        setTimeout(() => {
            shareBtn.textContent = previousLabel;
        }, 1400);
    } catch (error) {
        window.prompt('Copy this link', url);
    }
}

function applySharedRouteIfPresent() {
    if (!CONNECT_ONLY || sharedRouteApplied) return;
    sharedRouteApplied = true;

    const fromName = PAGE_PARAMS.get('from');
    const toName = PAGE_PARAMS.get('to');
    if (!fromName && !toName) return;

    const fromArtist = fromName ? findArtistByName(fromName) : null;
    const toArtist = toName ? findArtistByName(toName) : null;

    if (fromArtist) setPathSelection('from', fromArtist);
    if (toArtist) setPathSelection('to', toArtist);

    if (fromArtist && toArtist) {
        setTimeout(() => findPath(), 50);
    }
}

function loadExamplePair(fromName, toName) {
    const fromArtist = findArtistByName(fromName);
    const toArtist = findArtistByName(toName);

    if (!fromArtist || !toArtist) {
        setPathHelper('That example is not available in the current public subset. Try another pair.');
        return;
    }

    setPathSelection('from', fromArtist);
    setPathSelection('to', toArtist);
    findPath();
}

function renderStatusMessage(container, text, fontSize = '11px', padding = '12px 0') {
    clearElement(container);
    const message = document.createElement('div');
    message.style.color = 'rgba(255,255,255,0.4)';
    message.style.fontSize = fontSize;
    message.style.padding = padding;
    message.textContent = text;
    container.appendChild(message);
}

function renderAutocompleteResults(container, matches, onPick, activeIndex = -1) {
    clearElement(container);

    for (let index = 0; index < matches.length; index++) {
        const match = matches[index];
        const item = document.createElement('div');
        item.className = 'result-item';
        if (index === activeIndex) item.classList.add('active');
        item.addEventListener('mousedown', event => event.preventDefault());
        item.addEventListener('click', () => {
            onPick(index);
            container.style.display = 'none';
        });

        const name = document.createElement('div');
        name.className = 'result-name';
        name.textContent = match.n;

        const meta = document.createElement('div');
        meta.className = 'result-meta';
        meta.textContent = `${match.g || 'Unknown'} • Pop: ${match.p}`;

        item.append(name, meta);
        container.appendChild(item);
    }

    container.style.display = 'block';
}

function renderPathList(container, path) {
    clearElement(container);

    for (let i = 0; i < path.length; i++) {
        const curr = artistMap[path[i]];
        const next = i < path.length - 1 ? artistMap[path[i + 1]] : null;
        const color = getPathColorHex(i);

        const step = document.createElement('div');
        step.className = 'pf-step';
        step.style.setProperty('--step-color', color);

        const node = document.createElement('div');
        node.className = 'pf-node';
        node.style.color = color;
        node.textContent = `${i + 1}. ${curr.n}`;
        node.addEventListener('click', () => window.highlightArtistOnly(curr.n));
        step.appendChild(node);

        if (next) {
            const edge = document.createElement('div');
            edge.className = 'pf-edge';
            edge.style.borderLeftColor = color;
            edge.append(document.createTextNode('via '));

            const track = document.createElement('b');
            track.style.color = '#fff';
            track.textContent = edgeMap[`${curr.i}_${next.i}`] || 'Collaborated on track';
            edge.appendChild(track);
            step.appendChild(edge);
        }

        container.appendChild(step);
    }
}

function renderSimilarArtists(container, sims) {
    clearElement(container);

    if (!sims.length) {
        renderStatusMessage(container, 'No similar artists found.', '11px', '0');
        return;
    }

    for (const sim of sims) {
        const item = document.createElement('div');
        item.className = 'similar-item';
        item.addEventListener('click', () => window.selectArtistByName(sim.n));

        const name = document.createElement('span');
        name.className = 'similar-name';
        name.textContent = sim.n;

        const genre = document.createElement('span');
        genre.className = 'similar-genre';
        genre.textContent = sim.g || '';

        item.append(name, genre);
        container.appendChild(item);
    }
}

async function loadMixDnaLite() {
    if (mixDnaLite) return mixDnaLite;
    if (mixDnaLitePromise) return mixDnaLitePromise;

    mixDnaLitePromise = (async () => {
        const [metaResponse, vectorResponse] = await Promise.all([
            fetch(MIXDNA_META),
            fetch(MIXDNA_VECTORS),
        ]);

        if (!metaResponse.ok || !vectorResponse.ok) {
            throw new Error('MixDNA lite assets are missing');
        }

        const meta = await metaResponse.json();
        const buffer = await vectorResponse.arrayBuffer();
        const ids = new Int32Array(meta.ids);
        const scales = new Float32Array(meta.scales);
        const vectors = new Int8Array(buffer);
        const idToRow = new Map();
        for (let i = 0; i < ids.length; i++) {
            idToRow.set(ids[i], i);
        }

        mixDnaLite = {
            count: meta.count,
            dimensions: meta.dimensions,
            ids,
            scales,
            vectors,
            idToRow,
        };
        return mixDnaLite;
    })();

    try {
        return await mixDnaLitePromise;
    } catch (error) {
        mixDnaLitePromise = null;
        throw error;
    }
}

function getMixVector(asset, artistId) {
    const row = asset.idToRow.get(artistId);
    if (row === undefined) return null;
    const start = row * asset.dimensions;
    return asset.vectors.subarray(start, start + asset.dimensions);
}

function computeMixDnaLite(idA, idB, asset) {
    const vectorA = getMixVector(asset, idA);
    const vectorB = getMixVector(asset, idB);
    if (!vectorA || !vectorB) {
        throw new Error('One of the selected artists has no DNA vector in the lite model');
    }

    const dim = asset.dimensions;
    const mid = new Float32Array(dim);
    const midNormParts = new Float32Array(dim);
    let midNormSq = 0;

    for (let i = 0; i < dim; i++) {
        const scaled = ((vectorA[i] + vectorB[i]) / 2) * asset.scales[i];
        mid[i] = scaled;
        midNormParts[i] = scaled * asset.scales[i];
        midNormSq += scaled * scaled;
    }

    const midNorm = Math.sqrt(midNormSq);
    if (!midNorm) {
        throw new Error('The selected artists do not produce a valid fusion vector');
    }

    let bestId = null;
    let bestScore = -Infinity;

    for (let row = 0; row < asset.count; row++) {
        const candidateId = asset.ids[row];
        if (candidateId === idA || candidateId === idB) continue;
        const artist = artistMap[candidateId];
        if (!artist) continue;

        const start = row * dim;
        let dot = 0;
        let normSq = 0;

        for (let col = 0; col < dim; col++) {
            const value = asset.vectors[start + col];
            dot += value * midNormParts[col];
            const scaled = value * asset.scales[col];
            normSq += scaled * scaled;
        }

        if (!normSq) continue;

        const cosine = dot / (Math.sqrt(normSq) * midNorm + 1e-9);
        const popularityBoost = (artist.p || 0) / 100;
        const score = (cosine * 0.7) + (popularityBoost * 0.3);

        if (score > bestScore) {
            bestScore = score;
            bestId = candidateId;
        }
    }

    if (bestId === null) {
        throw new Error('No fusion candidate found in the lite model');
    }

    const childVector = getMixVector(asset, bestId);
    const similarities = [];
    for (const parentId of [idA, idB]) {
        const parentVector = getMixVector(asset, parentId);
        let dot = 0;
        let normParent = 0;
        let normChild = 0;
        for (let i = 0; i < dim; i++) {
            const parentScaled = parentVector[i] * asset.scales[i];
            const childScaled = childVector[i] * asset.scales[i];
            dot += parentScaled * childScaled;
            normParent += parentScaled * parentScaled;
            normChild += childScaled * childScaled;
        }
        const similarity = dot / (Math.sqrt(normParent) * Math.sqrt(normChild) + 1e-9);
        similarities.push({
            id: parentId,
            name: artistMap[parentId]?.n || 'Unknown',
            similarity: Math.round(clamp(similarity * 100, 0, 100) * 10) / 10,
        });
    }

    return {
        child: artistMap[bestId],
        score: bestScore,
        parentSimilarities: similarities,
    };
}

function renderMixDnaResult(result) {
    const child = result.child;
    const parentSims = result.parentSimilarities || [];

    let parentMetricsHtml = '';
    parentMetricsHtml += `<div class="ai-metrics-grid">`;
    parentMetricsHtml += `<div style="font-size:11px; opacity:0.5; margin-bottom:12px; text-transform:uppercase; letter-spacing:1px; text-align:center;">Genetic Similarity Breakdown</div>`;

    for (let i = 0; i < parentSims.length; i++) {
        const parent = parentSims[i];
        const barId = `bar-sim-${i}`;
        parentMetricsHtml += `
            <div class="ai-metric-row">
                <span class="ai-metric-label">match with ${escapeHtml(parent.name)}</span>
                <span class="ai-metric-val">${parent.similarity}%</span>
            </div>
            <div class="ai-bar-bg">
                <div class="ai-bar-fill" id="${barId}" style="width: 0%"></div>
            </div>
        `;
    }
    parentMetricsHtml += `</div>`;

    const html = `
        <div class="ai-child-showcase">
            <div class="ai-score-label">DNA FUSION RESULT</div>
            <div class="ai-child-name">${escapeHtml(child.n)}</div>
            <div class="ai-child-sub">Static mix computed in your browser</div>
        </div>

        ${parentMetricsHtml}

        <div class="ai-footer-info">
            Lite model • 64-dimensional vectors • No backend required
        </div>
    `;
    const icon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: text-bottom; margin-right: 6px;"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/></svg>`;
    showModal(icon + 'SONIC FUSION', html);

    setTimeout(() => {
        for (let i = 0; i < parentSims.length; i++) {
            const bar = document.getElementById(`bar-sim-${i}`);
            if (bar) bar.style.width = parentSims[i].similarity + '%';
        }
    }, 100);
}

function hashColor(s) {
    if (!s) return 0x555555;
    let h = 0;
    for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
    return COLORS[Math.abs(h) % COLORS.length];
}

function applyConnectOnlyVariant() {
    if (!CONNECT_ONLY) return;

    document.body.classList.add('connect-only');
    document.title = 'Spotify Universe - Connect Artists';

    const modeFull = document.getElementById('mode-full');
    const modeTop100k = document.getElementById('mode-top100k');
    if (modeFull) modeFull.classList.remove('active');
    if (modeTop100k) modeTop100k.classList.add('active');

    const pathfinderPanel = document.getElementById('pathfinder-panel');
    if (pathfinderPanel) pathfinderPanel.classList.add('visible');

    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.placeholder = 'Spotlight an artist...';

    const loaderText = document.querySelector('.loader-text');
    if (loaderText) loaderText.textContent = 'Loading Connect Artists';

    const pfSubtitle = document.getElementById('pf-subtitle');
    if (pfSubtitle) pfSubtitle.textContent = 'Public edition: shortest routes plus browser-side MixDNA lite.';

    const footer = document.getElementById('footer');
    if (footer) {
        footer.innerHTML = '<span>Spotify</span> Universe • Connect Artists • Static Edition';
    }
}

// ============ INIT ============
async function init() {
    applyConnectOnlyVariant();

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 3500);
    camera.position.copy(INIT_POS);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 10;
    controls.maxDistance = 800;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.3;

    // Highlight Objects
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x1DB954, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
    highlightRing = new THREE.Mesh(new THREE.RingGeometry(3, 4, 32), ringMat);
    highlightRing.visible = false;
    scene.add(highlightRing);

    const glowMat = new THREE.MeshBasicMaterial({ color: 0x1DB954, transparent: true, opacity: 0.4 });
    highlightGlow = new THREE.Mesh(new THREE.SphereGeometry(2.5, 16, 16), glowMat);
    highlightGlow.visible = false;
    scene.add(highlightGlow);

    await loadData(currentMode);

    // Event Listeners
    window.addEventListener('resize', onResize);
    renderer.domElement.addEventListener('click', onClick);

    // ===== MOBILE TOUCH SUPPORT (Full mode: tap to identify) =====
    let touchStartX = 0, touchStartY = 0, touchStartTime = 0;
    renderer.domElement.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            touchStartTime = performance.now();
        }
    }, { passive: true });

    renderer.domElement.addEventListener('touchend', (e) => {
        if (currentMode !== 'full') return;
        const dt = performance.now() - touchStartTime;
        if (dt > 300) return; // Not a tap, was a drag/hold
        const ct = e.changedTouches[0];
        const dx = ct.clientX - touchStartX;
        const dy = ct.clientY - touchStartY;
        if (Math.abs(dx) > 15 || Math.abs(dy) > 15) return; // Was a swipe

        // It's a real tap — do raycasting
        const r = renderer.domElement.getBoundingClientRect();
        const m = new THREE.Vector2(
            ((ct.clientX - r.left) / r.width) * 2 - 1,
            -((ct.clientY - r.top) / r.height) * 2 + 1
        );
        const rc = new THREE.Raycaster();
        rc.params.Points.threshold = 3.5; // Bigger threshold for fat fingers
        rc.setFromCamera(m, camera);
        const hits = rc.intersectObject(pointCloud);
        if (hits.length) selectArtist(artists[hits[0].index]);
    });

    // ===== MOBILE: Pathfinder interactive bottom sheet (draggable) =====
    const pfPanel = document.getElementById('pathfinder-panel');
    const pfHandle = document.getElementById('pf-mobile-handle');
    let isDragging = false;
    let touchYStart = 0;
    let startHeight = 0;
    const COLLAPSED_H = MOBILE_PATHFINDER_COLLAPSED_H;
    const MAX_VH = MOBILE_PATHFINDER_MAX_VH;

    pfPanel.addEventListener('touchstart', (e) => {
        // Only trigger drag if clicking the handle or the title area (the top part)
        if (!e.target.closest('#pf-mobile-handle') && !e.target.closest('.pf-header')) return;

        isDragging = true;
        touchYStart = e.touches[0].clientY;
        startHeight = pfPanel.offsetHeight;
        pfPanel.style.transition = 'none';
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        const currentY = e.touches[0].clientY;
        const deltaY = touchYStart - currentY; // Up is positive
        let newHeight = startHeight + deltaY;

        const limit = window.innerHeight * MAX_VH;
        if (newHeight < COLLAPSED_H) newHeight = COLLAPSED_H;
        if (newHeight > limit) newHeight = limit;

        pfPanel.style.maxHeight = newHeight + 'px';
    }, { passive: false });

    window.addEventListener('touchend', (e) => {
        if (!isDragging) return;
        isDragging = false;
        pfPanel.style.transition = ''; // Restore CSS smooth transition

        const touchYEnd = e.changedTouches[0].clientY;
        const totalDelta = Math.abs(touchYStart - touchYEnd);

        if (totalDelta < 8) {
            // Treat as a tap: toggle
            pfPanel.classList.toggle('collapsed');
            pfPanel.style.maxHeight = pfPanel.classList.contains('collapsed') ? COLLAPSED_H + 'px' : getExpandedPathfinderHeight();
        } else {
            // Drag ended: snap to nearest state
            const currentHeight = pfPanel.offsetHeight;
            const limit = window.innerHeight * MAX_VH;
            if (currentHeight > (limit + COLLAPSED_H) / 2) {
                pfPanel.classList.remove('collapsed');
                pfPanel.style.maxHeight = getExpandedPathfinderHeight();
            } else {
                pfPanel.classList.add('collapsed');
                pfPanel.style.maxHeight = COLLAPSED_H + 'px';
            }
        }
    });


    document.getElementById('mode-full').addEventListener('click', () => switchMode('full'));
    document.getElementById('mode-top100k').addEventListener('click', () => switchMode('top100k'));
    document.getElementById('pf-find-btn').addEventListener('click', findPath);
    document.getElementById('pf-swap-btn').addEventListener('click', swapPathSelections);
    document.getElementById('pf-clear-btn').addEventListener('click', clearPathSelections);
    document.getElementById('pf-share-btn').addEventListener('click', shareCurrentRoute);
    document.getElementById('card-set-from-btn').addEventListener('click', () => {
        if (!selectedArtist) return;
        setPathSelection('from', selectedArtist);
        setPathHelper(`${selectedArtist.n} is now your starting point.`);
    });
    document.getElementById('card-set-to-btn').addEventListener('click', () => {
        if (!selectedArtist) return;
        setPathSelection('to', selectedArtist);
        setPathHelper(`${selectedArtist.n} is now your destination.`);
    });

    document.querySelectorAll('#pf-example-row .pf-chip').forEach((button, index) => {
        const fallback = CONNECT_EXAMPLES[index] || [button.dataset.from, button.dataset.to];
        button.addEventListener('click', () => loadExamplePair(button.dataset.from || fallback[0], button.dataset.to || fallback[1]));
    });

    // Autocomplete Setup
    setupAutocomplete('search-input', 'search-results', a => {
        selectArtist(a);
        document.getElementById('search-input').value = a.n;
        if (CONNECT_ONLY) {
            setPathHelper(`${a.n} highlighted. Use the info card buttons to set From or To.`);
        }
    });

    setupAutocomplete('pf-from-input', 'pf-from-results', a => {
        setPathSelection('from', a);
    });

    setupAutocomplete('pf-to-input', 'pf-to-results', a => {
        setPathSelection('to', a);
    });

    animate();
}

async function loadData(mode) {
    const resolvedMode = CONNECT_ONLY ? 'top100k' : mode;
    const loader = document.getElementById('loader');
    loader.classList.remove('hide');
    setLoaderState(
        'Loading artists...',
        resolvedMode === 'top100k'
            ? 'Public mode downloads only the curated artist subset so the app stays fast and free.'
            : 'Full mode loads the complete artist universe and can take longer on first visit.'
    );

    try {
        const res = await fetch(resolvedMode === 'full' ? DATA_FULL : DATA_TOP100K);
        if (!res.ok) throw new Error('Data not found');
        artists = await res.json();

        setLoaderState('Indexing artists...', 'Preparing search, pathfinding and artist lookup in your browser.');

        artistMap = {};
        artists.forEach(a => artistMap[a.i] = a);

        edgeMap = {};
        adjacencyList = {};

        if (resolvedMode === 'top100k') {
            setLoaderState('Loading collaboration map...', 'Fetching the connection graph used by the shortest-path engine.');
            let edges = [];
            try {
                const er = await fetch(DATA_EDGES);
                if (er.ok) edges = await er.json();
                else throw new Error("No tracks");
            } catch {
                try {
                    const er2 = await fetch(DATA_EDGES_FALLBACK);
                    edges = await er2.json();
                } catch {
                    console.warn("No edges found");
                }
            }

            for (const row of edges) {
                const s = row[0], t = row[1];
                const track = row.length > 2 ? row[2] : "Collaboration";

                if (!adjacencyList[s]) adjacencyList[s] = [];
                if (!adjacencyList[t]) adjacencyList[t] = [];
                adjacencyList[s].push(t);
                adjacencyList[t].push(s);

                edgeMap[`${s}_${t}`] = track;
                edgeMap[`${t}_${s}`] = track;
            }
        }

        setLoaderState('Rendering stars...', 'Drawing the artist field and finalizing the interactive scene.');
        createCloud();
        loader.classList.add('hide');
        applySharedRouteIfPresent();

    } catch (e) {
        console.error(e);
        alert("Error loading data. Check console.");
        loader.classList.add('hide');
    }
}

async function switchMode(m) {
    if (CONNECT_ONLY && m !== 'top100k') return;
    if (m === currentMode) return;
    currentMode = m;

    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(m === 'full' ? 'mode-full' : 'mode-top100k').classList.add('active');
    document.getElementById('pathfinder-panel').classList.toggle('visible', m === 'top100k');
    document.getElementById('info-card').classList.remove('visible');

    clearPathVisuals();
    await loadData(m);
    reset();
}

function clearPathVisuals() {
    if (pathLines) { scene.remove(pathLines); pathLines = null; }
    if (pathNodesHelper) { scene.remove(pathNodesHelper); pathNodesHelper = null; }
    pathLabels.forEach(l => scene.remove(l));
    pathLabels = [];
    pathRings.forEach(r => scene.remove(r));
    pathRings = [];
}

function createCloud() {
    if (pointCloud) scene.remove(pointCloud);

    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(artists.length * 3);
    const col = new Float32Array(artists.length * 3);

    for (let i = 0; i < artists.length; i++) {
        const a = artists[i];
        pos[i * 3] = a.x;
        pos[i * 3 + 1] = a.y;
        pos[i * 3 + 2] = a.z;
        const c = new THREE.Color(hashColor(a.g));
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

    // Texture
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const grd = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 32, 32);

    const mat = new THREE.PointsMaterial({
        size: 2.5,
        vertexColors: true,
        map: new THREE.CanvasTexture(canvas),
        transparent: true,
        alphaTest: 0.05,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    pointCloud = new THREE.Points(geo, mat);
    scene.add(pointCloud);
}

// ============ AUTOCOMPLETE ============
function setupAutocomplete(inputId, resultsId, onSelect) {
    const input = document.getElementById(inputId);
    const results = document.getElementById(resultsId);
    let matches = [];
    let activeIndex = -1;

    const commitSelection = (index) => {
        if (index < 0 || index >= matches.length) return false;
        onSelect(matches[index]);
        activeIndex = -1;
        results.style.display = 'none';
        return true;
    };

    const refreshResults = () => {
        const q = input.value.toLowerCase().trim();
        if (q.length < 2) {
            matches = [];
            activeIndex = -1;
            results.style.display = 'none';
            return;
        }

        matches = artists
            .filter(a => a.n.toLowerCase().includes(q))
            .sort((a, b) => b.p - a.p)
            .slice(0, 8);

        if (!matches.length) {
            activeIndex = -1;
            results.style.display = 'none';
            return;
        }

        activeIndex = 0;
        renderAutocompleteResults(results, matches, commitSelection, activeIndex);
    };

    input.addEventListener('input', () => {
        refreshResults();
    });

    input.addEventListener('keydown', (event) => {
        const dropdownOpen = results.style.display === 'block';

        if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && matches.length) {
            event.preventDefault();

            if (!dropdownOpen) {
                renderAutocompleteResults(results, matches, commitSelection, activeIndex < 0 ? 0 : activeIndex);
                return;
            }

            if (event.key === 'ArrowDown') {
                activeIndex = (activeIndex + 1) % matches.length;
            } else {
                activeIndex = (activeIndex - 1 + matches.length) % matches.length;
            }

            renderAutocompleteResults(results, matches, commitSelection, activeIndex);
            return;
        }

        if (event.key === 'Enter') {
            if (dropdownOpen && matches.length) {
                event.preventDefault();
                if (commitSelection(activeIndex < 0 ? 0 : activeIndex)) return;
            }

            if (inputId === 'pf-from-input' || inputId === 'pf-to-input') {
                event.preventDefault();
                findPath();
            }
            return;
        }

        if (event.key === 'Escape') {
            results.style.display = 'none';
        }
    });

    input.addEventListener('blur', () => setTimeout(() => results.style.display = 'none', 200));
}

// ============ PATH FINDER ============
function findPath() {
    const n1 = document.getElementById('pf-from-input').value;
    const n2 = document.getElementById('pf-to-input').value;

    const a1 = findArtistByName(n1);
    const a2 = findArtistByName(n2);

    if (!a1 || !a2) { alert("Please select valid artists."); return; }

    setPathSelection('from', a1);
    setPathSelection('to', a2);

    const path = bfs(a1.i, a2.i);
    const resDiv = document.getElementById('pf-result');
    const listDiv = document.getElementById('pf-path-list');
    const resultSummary = document.getElementById('pf-result-summary');
    const shareBtn = document.getElementById('pf-share-btn');

    resDiv.style.display = 'block';
    listDiv.scrollTop = 0;
    expandPathfinderPanel();

    if (!path) {
        resultSummary.textContent = 'No route found in the public graph. Try one of the example pairs or more mainstream artists.';
        shareBtn.disabled = false;
        renderStatusMessage(listDiv, 'No connection found.', '13px');
        clearPathVisuals();
        setPathHelper('That pair is outside the public connection graph. Try swapping in a more connected artist.');
        return;
    }

    resultSummary.textContent = `${path.length} artists • ${path.length - 1} collaboration hop${path.length - 1 === 1 ? '' : 's'}`;
    shareBtn.disabled = false;
    renderPathList(listDiv, path);
    setPathHelper(`${a1.n} → ${a2.n} traced successfully. You can share this route or blend the pair with MixDNA.`);

    if (CONNECT_ONLY) {
        history.replaceState({}, '', buildShareUrl());
    }

    drawPath(path);
}

function reconstructPath(parents, end) {
    const path = [];
    let current = end;

    while (current !== null) {
        path.push(current);
        current = parents.get(current) ?? null;
    }

    path.reverse();
    return path;
}

function bfs(start, end) {
    if (start === end) return [start];

    const queue = [start];
    let head = 0;
    const parents = new Map([[start, null]]);

    while (head < queue.length) {
        const node = queue[head++];
        const neighbors = adjacencyList[node];

        if (!neighbors) continue;

        for (const neighbor of neighbors) {
            if (parents.has(neighbor)) continue;

            parents.set(neighbor, node);
            if (neighbor === end) return reconstructPath(parents, end);
            queue.push(neighbor);
        }
    }

    return null;
}

// Neon Palette
const PATH_COLORS = ['#1DB954', '#00FFFF', '#FF0055', '#FFD700', '#9D00FF', '#FF5500'];
function getPathColor(i) { return new THREE.Color(PATH_COLORS[i % PATH_COLORS.length]); }
function getPathColorHex(i) { return PATH_COLORS[i % PATH_COLORS.length]; }

function drawPath(pathIds) {
    clearPathVisuals();
    const points = [];
    const pathBox = new THREE.Box3();

    // Geometry for colored points
    const geoNodes = new THREE.BufferGeometry();
    const pos = [];
    const cols = [];

    pathIds.forEach((id, i) => {
        const a = artistMap[id];
        const v = new THREE.Vector3(a.x, a.y, a.z);
        points.push(v);
        pathBox.expandByPoint(v);

        const color = getPathColor(i);

        // Individual Ring & Glow
        const ringMat = new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
        const glowMat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.4 });

        const ring = new THREE.Mesh(new THREE.RingGeometry(3, 4, 32), ringMat);
        ring.position.copy(v);
        ring.lookAt(camera.position);
        scene.add(ring);
        pathRings.push(ring);

        const glow = new THREE.Mesh(new THREE.SphereGeometry(2.5, 16, 16), glowMat);
        glow.position.copy(v);
        scene.add(glow);
        pathRings.push(glow);

        // Label
        const label = createTextLabel(a.n, getPathColorHex(i));
        label.position.set(a.x, a.y + 6, a.z);
        scene.add(label);
        pathLabels.push(label);

        // Push to buffer
        pos.push(a.x, a.y, a.z);
        cols.push(color.r, color.g, color.b);
    });

    // ===== LASER LINE with Animation =====
    // Interpolate more points for smoother line
    const smoothPoints = [];
    for (let i = 0; i < points.length - 1; i++) {
        const start = points[i];
        const end = points[i + 1];
        const segments = 20; // More segments = smoother
        for (let j = 0; j <= segments; j++) {
            smoothPoints.push(new THREE.Vector3().lerpVectors(start, end, j / segments));
        }
    }

    const geoLine = new THREE.BufferGeometry().setFromPoints(smoothPoints);
    geoLine.setDrawRange(0, 0); // Start invisible

    // Glow layer (thicker, more transparent)
    const glowLineMat = new THREE.LineBasicMaterial({
        color: 0x00FFFF,
        opacity: 0.3,
        transparent: true,
        linewidth: 3,
        blending: THREE.AdditiveBlending
    });
    const glowLine = new THREE.Line(geoLine.clone(), glowLineMat);
    scene.add(glowLine);
    pathRings.push(glowLine); // Store for cleanup

    // Main laser line (bright cyan)
    const matLine = new THREE.LineBasicMaterial({
        color: 0x00FFFF,
        opacity: 1,
        transparent: true,
        linewidth: 2
    });
    pathLines = new THREE.Line(geoLine, matLine);
    scene.add(pathLines);

    // Animate the laser draw (~1 second duration)
    let drawProgress = 0;
    const totalPoints = smoothPoints.length;
    const targetDurationFrames = 120; // ~1 second at 60fps
    const animSpeed = Math.max(1, Math.ceil(totalPoints / targetDurationFrames));

    function animateLaser() {
        if (drawProgress < totalPoints) {
            drawProgress = Math.min(drawProgress + animSpeed, totalPoints);
            geoLine.setDrawRange(0, drawProgress);
            glowLine.geometry.setDrawRange(0, drawProgress);
            requestAnimationFrame(animateLaser);
        }
    }
    animateLaser();

    // Colored Bright Points
    geoNodes.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geoNodes.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));

    const matNodes = new THREE.PointsMaterial({
        size: 16,
        vertexColors: true,
        map: pointCloud.material.map,
        transparent: true, opacity: 1,
        depthWrite: false, blending: THREE.AdditiveBlending
    });

    pathNodesHelper = new THREE.Points(geoNodes, matNodes);
    scene.add(pathNodesHelper);

    fitCameraToPath(pathBox);
}

function createTextLabel(text, colorHex) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = 'Bold 28px Inter, Arial';
    const w = ctx.measureText(text).width + 32;
    const h = 64;
    canvas.width = w; canvas.height = h;

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.beginPath(); ctx.roundRect(0, 0, w, h, 16); ctx.fill();

    // Border
    ctx.strokeStyle = colorHex || '#1DB954';
    ctx.lineWidth = 4; ctx.stroke();

    // Text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'Bold 28px Inter, Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(w / 8, h / 8, 1);
    sprite.renderOrder = 999;
    return sprite;
}

function fitCameraToPath(box) {
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    let dist = Math.abs(maxDim / Math.tan(fov / 2)) * 1.8;

    const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
    const targetPos = center.clone().add(dir.multiplyScalar(dist));

    const startPos = camera.position.clone();
    const startTarget = controls.target.clone();
    const duration = 1200;
    const start = performance.now();

    function anim(now) {
        const t = Math.min((now - start) / duration, 1);
        const ease = 1 - Math.pow(1 - t, 3);

        camera.position.lerpVectors(startPos, targetPos, ease);
        controls.target.lerpVectors(startTarget, center, ease);
        controls.update();

        if (t < 1) requestAnimationFrame(anim);
    }
    requestAnimationFrame(anim);
}

// ============ CORE INTERACTION ============
function selectArtist(a) {
    selectedArtist = a;
    controls.autoRotate = false;

    highlightRing.position.set(a.x, a.y, a.z);
    highlightGlow.position.set(a.x, a.y, a.z);
    highlightRing.visible = true;
    highlightGlow.visible = true;

    controls.target.set(a.x, a.y, a.z);

    updateInfoCard(a);
}

window.highlightArtistOnly = (n) => {
    const a = artists.find(x => x.n === n);
    if (!a) return;

    highlightRing.position.set(a.x, a.y, a.z);
    highlightGlow.position.set(a.x, a.y, a.z);
    highlightRing.visible = true;
    highlightGlow.visible = true;

    // No camera move, no info card
};

function updateInfoCard(a) {
    document.getElementById('card-name').textContent = a.n;
    document.getElementById('card-genre').textContent = a.g || 'Unknown';
    document.getElementById('card-pop').textContent = a.p;
    document.getElementById('card-pop-bar').style.width = a.p + '%';
    document.getElementById('info-card').classList.add('visible');

    const simDiv = document.getElementById('card-similar');
    renderStatusMessage(simDiv, 'Finding similar...', '11px', '0');

    setTimeout(() => {
        const sims = getNeighbors(a);
        renderSimilarArtists(simDiv, sims);
    }, 50);
}

function getNeighbors(target) {
    const c = [];
    const step = artists.length > 200000 ? 5 : 1;

    for (let i = 0; i < artists.length; i += step) {
        const a = artists[i];
        if (a.i === target.i) continue;
        const d = (a.x - target.x) ** 2 + (a.y - target.y) ** 2 + (a.z - target.z) ** 2;
        if (c.length < 5 || d < c[0].d) {
            c.push({ a, d });
            c.sort((x, y) => y.d - x.d);
            if (c.length > 5) c.shift();
        }
    }
    return c.reverse().map(x => x.a);
}

window.selectArtistByName = (n) => {
    const a = artists.find(x => x.n === n);
    if (a) selectArtist(a);
};

function onClick(e) {
    // SOLO en modo FULL permite seleccionar artistas
    if (currentMode !== 'full') return;

    const r = renderer.domElement.getBoundingClientRect();
    const m = new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1
    );

    const rc = new THREE.Raycaster();
    rc.params.Points.threshold = 2;
    rc.setFromCamera(m, camera);

    const hits = rc.intersectObject(pointCloud);
    if (hits.length) selectArtist(artists[hits[0].index]);
}

function reset() {
    controls.autoRotate = true;
    camera.position.copy(INIT_POS);
    controls.target.set(0, 0, 0);
    highlightRing.visible = false;
    highlightGlow.visible = false;
    selectedArtist = null;
    document.getElementById('info-card').classList.remove('visible');

    clearPathSelections();
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);

    const pfPanel = document.getElementById('pathfinder-panel');
    if (!pfPanel) return;

    if (isMobilePathfinderLayout()) {
        if (!pfPanel.classList.contains('collapsed')) {
            pfPanel.style.maxHeight = getExpandedPathfinderHeight();
        }
        return;
    }

    pfPanel.classList.remove('collapsed');
    pfPanel.style.maxHeight = '';
}

let tick = 0;
function animate() {
    requestAnimationFrame(animate);
    controls.update();

    if (highlightRing.visible) {
        tick += 0.05;
        const s = 1 + Math.sin(tick) * 0.15;
        highlightRing.scale.set(s, s, s);
        highlightRing.lookAt(camera.position);
        highlightGlow.scale.set(s * 1.2, s * 1.2, s * 1.2);
    }

    // Animate path rings to face camera
    pathRings.forEach(r => {
        if (r.geometry.type === 'RingGeometry') r.lookAt(camera.position);
    });

    renderer.render(scene, camera);
}

// ============ AI FEATURES ============

// Modal handlers
const aiModal = document.getElementById('ai-modal');
const aiModalClose = document.getElementById('ai-modal-close');
const aiModalTitle = document.getElementById('ai-modal-title');
const aiModalBody = document.getElementById('ai-modal-body');

aiModalClose.onclick = function () {
    aiModal.classList.remove('active');
};

aiModal.onclick = function (e) {
    if (e.target === aiModal) {
        aiModal.classList.remove('active');
    }
};

function showModal(title, content) {
    aiModalTitle.innerHTML = title;
    aiModalBody.innerHTML = content;
    aiModal.classList.add('active');
}

// Predict Hit Button
document.getElementById('ai-predict-btn').onclick = async function () {
    const fromInput = document.getElementById('pf-from-input');
    const toInput = document.getElementById('pf-to-input');

    if (!pfSelectedFrom || !pfSelectedTo) {
        showModal('SELECT ARTISTS', '<p style="text-align:center; opacity:0.6">Please select both artists using the dropdowns above.</p>');
        return;
    }

    // Show loading
    showModal('ANALYZING', '<p style="text-align:center; opacity:0.6">Running AI prediction model...</p>');

    try {
        const params = new URLSearchParams({
            id_a: String(pfSelectedFrom.id),
            id_b: String(pfSelectedTo.id)
        });
        const response = await fetch(`${API_BASE}/predict_collab?${params.toString()}`);
        const data = await response.json();

        const errorMessage = data.error || data.detail;
        if (!response.ok || errorMessage) {
            showModal('ERROR', `<p style="text-align:center; opacity:0.6">${escapeHtml(errorMessage || 'Unexpected server error')}</p>`);
            return;
        }

        // Determine description based on score
        let descText = "Low potential. Niche appeal.";
        if (data.score > 80) descText = "Viral potential! Mainstream hit likely.";
        else if (data.score > 60) descText = "Good potential. Solid fanbase appeal.";
        else if (data.score > 40) descText = "Moderate potential. Experimental mix.";

        const score = Math.round(data.score);
        const chemistry = Math.round(data.chemistry);

        // Parse genre overlap percent
        let genrePct = 0;
        try {
            genrePct = parseInt(data.genre_overlap) || 0;
        } catch (e) { }

        const html = `
            <div class="ai-score-container">
                <div class="ai-score-value">${score}</div>
                <div class="ai-score-label">HIT PREDICTION SCORE</div>
                <div class="ai-score-desc">${descText}</div>
            </div>
            
            <div class="ai-metrics-grid">
                <!-- Streams -->
                <div class="ai-metric-row">
                    <span class="ai-metric-label">Est. Streams</span>
                    <span class="ai-metric-val" style="color:#fff">${escapeHtml(data.streams_est)}</span>
                </div>
                <div class="ai-bar-bg"><div class="ai-bar-fill" style="width: 100%; opacity: 0.3"></div></div>

                <!-- Chemistry -->
                <div class="ai-metric-row">
                    <span class="ai-metric-label">Artist Chemistry</span>
                    <span class="ai-metric-val">${chemistry}%</span>
                </div>
                <div class="ai-bar-bg">
                    <div class="ai-bar-fill" id="bar-chem" style="width: 0%"></div>
                </div>
            </div>
            
            <div class="ai-footer-info">
                Model v1.2 • XGBoost Gradient Boosting • Trained on top charts
            </div>
        `;
        const ICON_HIT = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: text-bottom; margin-right: 6px;"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"></path></svg>`;
        showModal(ICON_HIT + 'HIT PREDICTOR', html);

        // Animate bars after render
        setTimeout(() => {
            const bChem = document.getElementById('bar-chem');
            if (bChem) bChem.style.width = chemistry + '%';
        }, 100);

    } catch (err) {
        showModal('CONNECTION ERROR', '<p style="text-align:center; opacity:0.6">Could not reach the AI server. Make sure the backend is running.</p>');
    }
};

// Mix DNA (Sonic Fusion) Button
document.getElementById('ai-fusion-btn').onclick = async function () {
    const fromInput = document.getElementById('pf-from-input');
    const toInput = document.getElementById('pf-to-input');

    if (!pfSelectedFrom || !pfSelectedTo) {
        showModal('SELECT ARTISTS', '<p style="text-align:center; opacity:0.6">Please select both artists using the dropdowns above.</p>');
        return;
    }

    // Show loading
    showModal('MIXING DNA', '<p style="text-align:center; opacity:0.6">Blending artist vectors...</p>');

    if (CONNECT_ONLY) {
        try {
            const asset = await loadMixDnaLite();
            const result = computeMixDnaLite(pfSelectedFrom.id, pfSelectedTo.id, asset);
            renderMixDnaResult(result);
        } catch (err) {
            showModal('MIXDNA UNAVAILABLE', `<p style="text-align:center; opacity:0.6">${escapeHtml(err?.message || 'MixDNA lite assets could not be loaded.')}</p>`);
        }
        return;
    }

    try {
        const ids = `${pfSelectedFrom.id},${pfSelectedTo.id}`;
        const params = new URLSearchParams({ ids });
        const response = await fetch(`${API_BASE}/sonic_fusion?${params.toString()}`);
        const data = await response.json();

        const errorMessage = data.error || data.detail;
        if (!response.ok || errorMessage) {
            showModal('ERROR', `<p style="text-align:center; opacity:0.6">${escapeHtml(errorMessage || 'Unexpected server error')}</p>`);
            return;
        }

        const child = data.child;
        const parentSims = data.parent_similarities || [];

        // Build parent similarity bars
        let parentMetricsHtml = '';
        parentMetricsHtml += `<div class="ai-metrics-grid">`;

        // Add header for metrics
        parentMetricsHtml += `<div style="font-size:11px; opacity:0.5; margin-bottom:12px; text-transform:uppercase; letter-spacing:1px; text-align:center;">Genetic Similarity Breakdown</div>`;

        for (let i = 0; i < parentSims.length; i++) {
            const p = parentSims[i];
            // Generate unique ID for animation
            const barId = `bar-sim-${i}`;
            parentMetricsHtml += `
                <div class="ai-metric-row">
                    <span class="ai-metric-label">match with ${escapeHtml(p.name)}</span>
                    <span class="ai-metric-val">${p.similarity}%</span>
                </div>
                <div class="ai-bar-bg">
                    <div class="ai-bar-fill" id="${barId}" style="width: 0%"></div>
                </div>
            `;
        }
        parentMetricsHtml += `</div>`;

        const html = `
            <div class="ai-child-showcase">
                <div class="ai-score-label">DNA FUSION RESULT</div>
                <div class="ai-child-name">${escapeHtml(child.name)}</div>
                <div class="ai-child-sub">The perfect sonic bridge</div>
            </div>
            
            ${parentMetricsHtml}
            
            <div class="ai-footer-info">
                Calculated using 64-dimensional high-dimensional vector interpolation
            </div>
        `;
        const ICON_DNA = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: text-bottom; margin-right: 6px;"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/></svg>`;
        showModal(ICON_DNA + 'SONIC FUSION', html);

        // Animate bars
        setTimeout(() => {
            for (let i = 0; i < parentSims.length; i++) {
                const bar = document.getElementById(`bar-sim-${i}`);
                if (bar) bar.style.width = parentSims[i].similarity + '%';
            }
        }, 100);

    } catch (err) {
        showModal('CONNECTION ERROR', '<p style="text-align:center; opacity:0.6">Could not reach the AI server. Make sure the backend is running.</p>');
    }
};

init();

