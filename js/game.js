'use strict';

// ==========================================
// 1. GLOBAL STATE & REFERENSI DOM
// ==========================================
let isGameMode = false;
let currentGameRound = 1; 
let gameTimeouts = []; 
let gameClusterLayer = null; 
let gameScore = 0;

let targetGameData = null;
let poolGameData = []; 
let usedGameQIDs = new Set(); 
let savedFilterState = {};

const btnMulaiGame = document.getElementById('btn-mulai-game');
const navBeranda = document.getElementById('nav-beranda');
const navHasil = document.getElementById('nav-hasil-container');
const btnMenuInduk = document.getElementById('btn-menu-induk'); 
const gameDialog = document.getElementById('game-dialog');
const gameMessage = document.getElementById('game-message');
const gameOverlay = document.getElementById('game-overlay');

// ==========================================
// 2. HELPER NARASI DINAMIS
// ==========================================
function getGamePrefix() {
    let prefix = 'letak';
    if (['Kabupaten dan kota'].includes(currentNamaKlaster)) prefix = 'provinsi';
    else if (['Tempat lahir tokoh'].includes(currentNamaKlaster)) prefix = 'tempat lahir';
    else if (['Latar karya sastra'].includes(currentNamaKlaster)) prefix = 'latar';
    else if (['Publikasi', 'Media massa'].includes(currentNamaKlaster)) prefix = 'tempat terbit';
    else if (['Lukisan', 'Lontar', 'Naskah'].includes(currentNamaKlaster)) prefix = 'koleksi';
    else if (['Gempa bumi dan tsunami', 'Peristiwa lainnya', 'Perang & konflik', 'Bencana lainnya'].includes(currentNamaKlaster)) prefix = 'pusat kejadian/terdampak';
    else if (['Situs arkeologi lainnya'].includes(currentNamaKlaster)) prefix = 'letak';
    else if (['Prasasti', 'Artefak'].includes(currentNamaKlaster)) prefix = 'lokasi sekarang';

    if (currentKategoriUtama === 'alam') {
        if (['Bahasa'].includes(currentNamaKlaster)) prefix = 'wilayah penutur utama';
        else if (['Hidangan', 'Pakaian', 'Tari dan pertunjukan', 'Ritual dan upacara', 'Budaya rakyat'].includes(currentNamaKlaster)) prefix = `${currentNamaKlaster.toLowerCase()} khas`;
    }
    return prefix;
}

// ==========================================
// 3. KENDALI TOMBOL (MULAI, BATAL, SKIP)
// ==========================================
btnMulaiGame.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();

    let validRecords = Object.values(Records).filter(r => r.lat && r.lon && r.imageFilename);
    let uniqueRegions = new Set();
    validRecords.forEach(r => {
        let provArray = Object.keys(r.designations).filter(p => p !== 'all' && ProvinceIndex[p] && ProvinceIndex[p].name !== 'Wilayah Lainnya/Tidak Spesifik');
        provArray.forEach(p => uniqueRegions.add(p));
    });

    if (validRecords.length < 10 || uniqueRegions.size < 4) {
        tampilkanDialog("Pencarian saat ini belum memenuhi syarat Mode Game.<br><br>Pastikan ada <b>minimal 10 data bergambar</b> yang tersebar di <b>minimal 4 wilayah berbeda</b>.", "alert", "Syarat Belum Terpenuhi");
        return;
    }

    savedFilterState = {
        region: currentRegionFilter,
        usia: currentUsiaFilter,
        sort: currentUsiaSort,
        search: currentSearchQuery,
        features: Array.from(activeFeatures),
        isAllActive: document.getElementById('btn-all') ? document.getElementById('btn-all').classList.contains('active') : false
    };

    isGameMode = true;
    currentGameRound = 1;
    gameScore = 0;
    usedGameQIDs.clear();
    clearAllGameTimeouts();

    if (typeof window.setMobilePanelExpanded === 'function') window.setMobilePanelExpanded(false, false);
    const panelMobile = document.getElementById('panel');
    if (panelMobile) {
        panelMobile.style.pointerEvents = 'none'; 
        panelMobile.style.opacity = '0.5'; 
    }
    
    navHasil.classList.add('nav-disabled');
    navBeranda.textContent = "Batal Game"; 
    navBeranda.classList.add('text-danger'); 
    btnMenuInduk.textContent = "Skip ⏭️";
    btnMenuInduk.classList.add('text-primary');
    document.getElementById('submenu-atas').classList.add('d-none');

    // Mencegah marker asli berantakan
    if (Map && Map.hasLayer(Cluster)) Map.removeLayer(Cluster);
    if (Map) Map.closePopup();
    
    jalankanRonde();
});

navBeranda.addEventListener('click', function(e) {
    if (isGameMode) {
        e.preventDefault(); 
        akhiriGameMode();
    }
});

btnMenuInduk.addEventListener('click', function(e) {
    if (isGameMode) {
        e.preventDefault();
        e.stopPropagation();
        
        clearAllGameTimeouts();
        currentGameRound++;
        if (currentGameRound > 3) akhiriGameMode(true);
        else jalankanRonde();
    }
});

// ==========================================
// 4. LOGIKA RONDE GAME & PEMBUATAN MARKER
// ==========================================
function jalankanRonde() {
    clearAllGameTimeouts();
    if (Map) Map.closePopup();
    
    if (gameClusterLayer && Map.hasLayer(gameClusterLayer)) {
        Map.removeLayer(gameClusterLayer);
    }
    
    gameDialog.classList.remove('d-none');
    gameOverlay.classList.remove('lock-screen', 'd-none');
    document.getElementById('game-title').textContent = `Tantangan ${currentGameRound}/3`;
    gameDialog.style.border = "none";

    gameClusterLayer = L.markerClusterGroup({
        maxClusterRadius: 40,
        spiderfyOnMaxZoom: true,
        zoomToBoundsOnClick: true
    });

    let allValid = Object.values(Records).filter(r => r.lat && r.lon && r.imageFilename);
    let availableForTarget = allValid.filter(r => !usedGameQIDs.has(r.id));
    
    targetGameData = availableForTarget[Math.floor(Math.random() * availableForTarget.length)];
    usedGameQIDs.add(targetGameData.id);

    let distractorPool = allValid.filter(r => r.id !== targetGameData.id);
    let shuffledDistractors = distractorPool.sort(() => 0.5 - Math.random()).slice(0, 9);
    
    poolGameData = [targetGameData, ...shuffledDistractors];
    
    if (currentGameRound === 1) setupGame1();
    else if (currentGameRound === 2) setupGame2();
    else if (currentGameRound === 3) setupGame3();

    // CETAK 10 MARKER KE PETA
    poolGameData.forEach(record => {
        let isTarget = (record.id === targetGameData.id);
        let isBisu = (currentGameRound !== 1);
        
        let marker = L.marker([record.lat, record.lon], { 
            icon: ikonTetesanAir, 
            interactive: !isBisu 
        });
        
        marker.bindPopup(`<b>${record.title}</b>`, { closeButton: false });
        
        if (isTarget) {
            targetGameData.mapMarkerGame = marker; 
        }

        if (!isBisu) {
            marker.on('click', function() {
                evaluasiJawabanGame(isTarget, record.title);
            });
        }
        
        gameClusterLayer.addLayer(marker);
    });

    Map.addLayer(gameClusterLayer);
    
    if (gameClusterLayer.getLayers().length > 0) {
        Map.flyToBounds(gameClusterLayer.getBounds(), { duration: 1.5, padding: [30, 30] });
    }
}

function setupGame1() {
    let prefix = getGamePrefix();
    let kataTanya = (prefix === 'letak' || prefix === 'lokasi sekarang') ? 'lokasi' : prefix;
    gameMessage.innerHTML = `Temukan di peta ${kataTanya}:<br><strong style="font-size:20px; color:#d9534f;">${targetGameData.title}</strong>?`;
}

function setupGame2() {
    let prefix = getGamePrefix();
    let kataTanya = (prefix === 'letak' || prefix === 'lokasi sekarang') ? 'lokasi' : prefix;
    gameMessage.innerHTML = `Di manakah ${kataTanya} dari:<br><strong style="font-size:20px; color:#d9534f;">${targetGameData.title}</strong>?`;

    let provIdsBenar = Object.keys(targetGameData.designations).filter(p => p !== 'all' && ProvinceIndex[p] && ProvinceIndex[p].name !== 'Wilayah Lainnya/Tidak Spesifik');
    let namaWilayahBenar = provIdsBenar.length > 0 ? ProvinceIndex[provIdsBenar[0]].name : "Wilayah Khusus";

    let semuaWilayahUnik = Object.keys(ProvinceIndex)
        .filter(k => k !== 'all' && ProvinceIndex[k].name !== 'Wilayah Lainnya/Tidak Spesifik' && ProvinceIndex[k].name !== namaWilayahBenar)
        .map(k => ProvinceIndex[k].name);
    
    let distractors = semuaWilayahUnik.sort(() => 0.5 - Math.random()).slice(0, 3);
    let options = [{ nama: namaWilayahBenar, benar: true }, ...distractors.map(d => ({ nama: d, benar: false }))];
    options.sort(() => 0.5 - Math.random());

    renderTombolPilihanGanda(options); 
}

function setupGame3() {
    let imgUrl = `${COMMONS_WIKI_URL_PREF}Special:FilePath/${encodeURIComponent(targetGameData.imageFilename)}?width=250`;
    let tanyaNama = `Apa nama ${currentNamaKlaster.toLowerCase()} ini?`;
    if (currentNamaKlaster === 'Tempat lahir tokoh') tanyaNama = `Siapa nama tokoh ini?`;

    gameMessage.innerHTML = `
        ${tanyaNama}<br>
        <img src="${imgUrl}" style="width:100%; max-height:180px; object-fit:cover; border-radius:8px; margin-top:10px; border:2px solid #ddd;">
    `;

    let provIdsBenar = Object.keys(targetGameData.designations).filter(p => p !== 'all' && ProvinceIndex[p]);
    let provTarget = provIdsBenar.length > 0 ? provIdsBenar[0] : null;

    let distractorPool = [];
    if (provTarget) {
        distractorPool = Object.values(Records).filter(r => r.id !== targetGameData.id && r.areaTags.has(provTarget));
    }
    
    if (distractorPool.length < 3) {
        let sisanya = Object.values(Records).filter(r => r.id !== targetGameData.id && !distractorPool.includes(r));
        distractorPool = distractorPool.concat(sisanya.sort(() => 0.5 - Math.random()).slice(0, 3 - distractorPool.length));
    }

    let distractors = distractorPool.sort(() => 0.5 - Math.random()).slice(0, 3);
    let options = [{ nama: targetGameData.title, benar: true }, ...distractors.map(d => ({ nama: d.title, benar: false }))];
    options.sort(() => 0.5 - Math.random());

    renderTombolPilihanGanda(options);
}

// ==========================================
// 5. HELPER UI & EVALUASI
// ==========================================
function renderTombolPilihanGanda(options) {
    let htmlTombol = `<div class="game-options-grid mt-10" style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">`;
    options.forEach(opt => {
        htmlTombol += `<button class="btn-game-option" data-benar="${opt.benar}" data-nama="${opt.nama}" style="padding:10px; border:1px solid #ccc; background:#f9f9f9; border-radius:5px; cursor:pointer; font-size:13px; font-weight:bold;">${opt.nama}</button>`;
    });
    htmlTombol += `</div>`;
    
    gameMessage.insertAdjacentHTML('beforeend', htmlTombol);

    let buttons = gameMessage.querySelectorAll('.btn-game-option');
    buttons.forEach(btn => {
        btn.addEventListener('click', function() {
            let isBenar = this.getAttribute('data-benar') === 'true';
            let namaDiklik = this.getAttribute('data-nama');
            
            buttons.forEach(b => b.disabled = true);
            
            if (!isBenar) {
                this.style.background = "#ffcccc";
                this.style.borderColor = "red";
                let btnBenar = gameMessage.querySelector('.btn-game-option[data-benar="true"]');
                if(btnBenar) {
                    btnBenar.style.background = "#ccffcc";
                    btnBenar.style.borderColor = "green";
                }
            } else {
                this.style.background = "#ccffcc";
                this.style.borderColor = "green";
            }

            evaluasiJawabanGame(isBenar, namaDiklik);
        });
    });
}

function evaluasiJawabanGame(isBenar, titleDiklik) {
    if (isBenar) gameScore++; 
    let markerSistem = targetGameData.mapMarkerGame; 
    
    gameOverlay.classList.add('lock-screen');
    document.getElementById('game-title').textContent = isBenar ? "Tepat Sekali! 🎉" : "Sayang Sekali ❌";
    
    if (currentGameRound === 1) {
        if (isBenar) gameMessage.innerHTML = `Anda berhasil menemukan <strong>${targetGameData.title}</strong>!`;
        else gameMessage.innerHTML = `Anda memilih <strong>${titleDiklik}</strong>.<br>Mengarahkan ke lokasi yang benar...`;
    }

    gameDialog.style.border = isBenar ? "3px solid green" : "3px solid red";
    
    let durasiTerbang = isBenar ? 1.5 : 2.5;
    let waktuTungguBukaPopup = isBenar ? 1500 : 2600;

    Map.flyTo([targetGameData.lat, targetGameData.lon], 17, { duration: durasiTerbang });

    let t1 = setTimeout(() => {
        if (gameClusterLayer && gameClusterLayer.hasLayer(markerSistem)) {
            gameClusterLayer.zoomToShowLayer(markerSistem, function() {
                markerSistem.openPopup();
                bukaPanelEksklusif(targetGameData.id);
            });
        } else {
            if (markerSistem) markerSistem.openPopup();
            bukaPanelEksklusif(targetGameData.id);
        }

        let t2 = setTimeout(() => {
            if (Map) Map.closePopup();
            tutupPanelEksklusif();
            
            currentGameRound++;
            if (currentGameRound > 3) akhiriGameMode(true);
            else jalankanRonde();

        }, 5000);
        gameTimeouts.push(t2);

    }, waktuTungguBukaPopup);

    gameTimeouts.push(t1);
}

// ==========================================
// 6. HELPER PANEL EKSKLUSIF (Tanpa Hash)
// ==========================================
function bukaPanelEksklusif(qid) {
    displayRecordDetails(qid); 
    if (typeof window.setMobilePanelExpanded === 'function') {
        window.setMobilePanelExpanded(true, true);
    }
    
    // Sembunyikan dialog game & normalkan panel
    if (gameDialog) gameDialog.classList.add('d-none');
    const panelMobile = document.getElementById('panel');
    if (panelMobile) {
        panelMobile.style.pointerEvents = 'auto';
        panelMobile.style.opacity = '1';
    }
}

function tutupPanelEksklusif() {
    displayPanelContent('index'); 
    if (typeof window.setMobilePanelExpanded === 'function') {
        window.setMobilePanelExpanded(false, false);
    }
    
    const panelMobile = document.getElementById('panel');
    if (panelMobile && isGameMode) {
        panelMobile.style.pointerEvents = 'none';
        panelMobile.style.opacity = '0.5';
    }
}

// ==========================================
// 7. MANAJEMEN TIMEOUT & AKHIRI GAME
// ==========================================
function clearAllGameTimeouts() {
    gameTimeouts.forEach(t => clearTimeout(t));
    gameTimeouts = [];
}

function akhiriGameMode(isMenang = false) {
    isGameMode = false;
    clearAllGameTimeouts();

    if (gameClusterLayer && Map.hasLayer(gameClusterLayer)) {
        Map.removeLayer(gameClusterLayer);
        gameClusterLayer = null;
    }
    
    // KEMBALIKAN MARKER ASLI
    if (!Map.hasLayer(Cluster)) Map.addLayer(Cluster);

    gameDialog.classList.add('d-none');
    gameOverlay.classList.remove('lock-screen', 'd-none');
    gameOverlay.classList.add('d-none');
    document.getElementById('game-title').textContent = "Tantangan Game!";

    navHasil.classList.remove('nav-disabled');
    navBeranda.textContent = "Beranda";
    navBeranda.classList.remove('text-danger');
    btnMenuInduk.textContent = "Lainnya";
    btnMenuInduk.classList.remove('text-primary');
    
    let subMenu = document.getElementById('submenu-atas');
    if(subMenu) subMenu.classList.add('d-none');

    const panelMobile = document.getElementById('panel'); 
    if (panelMobile) {
        panelMobile.style.pointerEvents = 'auto'; 
        panelMobile.style.opacity = '1'; 
    }
    
    if (Object.keys(savedFilterState).length > 0) {
        currentRegionFilter = savedFilterState.region;
        currentUsiaFilter = savedFilterState.usia;
        currentUsiaSort = savedFilterState.sort;
        currentSearchQuery = savedFilterState.search;
        activeFeatures = new Set(savedFilterState.features);
        
        let selectRegion = document.getElementById('filter-region');
        if(selectRegion) selectRegion.value = currentRegionFilter;
        
        let selectKombinasi = document.getElementById('filter-sort-kombinasi');
        if(selectKombinasi) selectKombinasi.value = (currentUsiaFilter !== 'all' || currentUsiaSort !== 'default') ? (currentUsiaFilter === 'all' ? `sort-${currentUsiaSort}` : `filter-${currentUsiaFilter}`) : 'default';

        let searchInput = document.getElementById('search-input');
        if(searchInput) searchInput.value = currentSearchQuery;

        document.querySelectorAll('.feat-btn').forEach(btn => {
            let type = btn.getAttribute('data-filter');
            if (activeFeatures.has(type)) btn.classList.add('active');
            else btn.classList.remove('active');
        });
        
        let btnAll = document.getElementById('btn-all');
        if (btnAll) {
            if (savedFilterState.isAllActive) btnAll.classList.add('active');
            else btnAll.classList.remove('active');
        }
    }

    applyIntersectionFilter(true);
    tutupPanelEksklusif();
    Map.closePopup();

    if (isMenang) {
        setTimeout(() => {
            let pesanSkor = gameScore > 0 
                ? `Selamat! Anda menjawab benar <b>${gameScore} dari 3</b> pertanyaan!<br><br>Mau mencoba lagi?`
                : `Anda belum berhasil menjawab pertanyaan dengan benar!<br><br>Mau mencoba lagi?`;
            
            tampilkanDialog(pesanSkor, "confirm", "Skor Akhir 🏆").then(mauMainLagi => {
                if (mauMainLagi) {
                    document.getElementById('btn-mulai-game').click();
                }
            });
        }, 500);
    }
}
