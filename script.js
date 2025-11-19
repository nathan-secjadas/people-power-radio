// Initialize the map with Metro Manila coordinates and zoom level
const map = L.map('map').setView([14.5995, 120.9842], 10);

// Add OpenStreetMap tiles to the map with proper attribution; the main visualizer
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// Google Sheets configuration
const sheetId = "1BZRH8xrng-zS58ey-ex9zhlckyrUGIhEuoUPZcV6zqc"; // The sheet ID from the URL
const sheetTabs = ["Master", "Feb22", "Feb23", "Feb24", "Feb25"]; // The tabs on the Google Sheets
 
// Global variables to store application data
let stations = [];      // Array of radio station objects from Master sheet
let dateContent = {};   // Object containing date-specific content for each tab

/**
 * Loads all Google Sheets tabs asynchronously and processes the data
 * @returns {Promise<Object>} Object containing all sheet data
 */
async function loadAllTabs() {
  try {
    // Create fetch promises for each sheet tab
    const fetches = sheetTabs.map(tabName => {
      const sheetName = encodeURIComponent(tabName);
      const sheetURL = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${sheetName}`;

      return fetch(sheetURL)
        .then(res => res.text())
        .then(csvText => ({
          tab: tabName,
          data: csvToObjects(csvText) // Convert CSV text to JavaScript objects
        }));
    });

    // Wait for all sheets to load concurrently
    const results = await Promise.all(fetches);

    // Convert array of results to object keyed by tab name
    const allSheets = {};
    results.forEach(({ tab, data }) => {
      allSheets[tab] = data;
    });
    console.log('All sheets loaded:', allSheets);

    // Transform raw sheet data into application-specific format
    transformSheetData(allSheets);

    // Initialize the application with the transformed data
    initializeApplication();

    return allSheets;
  } catch (error) {
    console.error('Error loading sheets:', error);
  }
}

/**
 * Transforms raw Google Sheets data into application-specific structures
 * @param {Object} allSheets - Raw data from all sheet tabs
 */
function transformSheetData(allSheets) {
  // Transform Master sheet into stations array with proper data types
  stations = allSheets.Master.map(station => ({
    id: station.id,
    name: station.name,
    lat: parseFloat(station.lat),    // Convert string to float
    lng: parseFloat(station.lng),    // Convert string to float
    description: station.description,
    icon: station.icon
  }));

  console.log('Stations loaded:', stations);

  // Process each date tab (excluding Master) to create date-specific content
  sheetTabs.forEach(tabName => {
    if (tabName !== 'Master') {
      const dateData = allSheets[tabName];
      console.log(`Processing ${tabName}:`, dateData);

      // Create date content structure with title and context
      dateContent[tabName] = {
        title: `February ${tabName.replace('Feb', '')}`,
        context: 'context', // Default context - can be updated if available in sheets
        stations: {}
      };

      // Populate station data for this specific date
      dateData.forEach(stationData => {
        if (stationData.id && stationData.id.trim() !== '') {
          dateContent[tabName].stations[stationData.id] = {
            description: stationData.description || 'No description available',
            audioUrl: stationData.audioUrl || '#' // Fallback for missing audio
          };
        }
      });

      console.log(`Date content for ${tabName}:`, dateContent[tabName]);
    }
  });

  console.log('Full dateContent:', dateContent);
}

/**
 * Initializes the main application components after data is loaded
 */
function initializeApplication() {
    // Create custom map markers for radio stations
    const radioIcon = L.divIcon({
        className: 'radio-marker',
        html: '<div class="signal-waves"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10] // Anchor point at center bottom
    });

    const activeRadioIcon = L.divIcon({
        className: 'radio-marker active',
        html: '<div class="signal-waves"></div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15] // Larger size for active station
    });

    // Add markers to map for each radio station
    stations.forEach(station => {
        const marker = L.marker([station.lat, station.lng], {
            icon: radioIcon
        })
            .addTo(map)
            .bindPopup(`
          <div>
              <h3>${station.name}</h3>
              <p>${station.description}</p>
              <button onclick="selectStation('${station.id}')" class="station-select-btn">Select Station</button>
          </div>
      `);

        // Store marker reference for later manipulation
        station.marker = marker;

        // Add click event to select station when marker is clicked
        marker.on('click', function() {
            selectStation(station.id);
        });
    });

    // Initialize remaining application components
    initializeAudioPlayer();
    setupDateSelector();
    changePanelContent(); // Load initial content based on default date
}

/**
 * Initializes the audio player with all controls and event handlers
 */
function initializeAudioPlayer() {
  const audio = document.getElementById('radio-audio');
  const playBtn = document.getElementById('play-btn');
  const progressBar = document.getElementById('progress-bar');
  const progressContainer = document.getElementById('progress-container');
  const progressHandle = document.getElementById('progress-handle');
  const currentTimeEl = document.getElementById('current-time');
  const durationEl = document.getElementById('duration');
  const currentStationEl = document.getElementById('current-station');
  const stationDescriptionEl = document.getElementById('station-description');
  const volumeSlider = document.getElementById('volume-slider');
  const volumeBtn = document.getElementById('volume-btn');
  const volumeControl = document.querySelector('.volume-control');

  // Audio player state variables
  let isPlaying = false;
  let isMuted = false;
  let lastVolume = 1.0;     // Remember volume level when muting
  let isDragging = false;   // Track if progress bar is being dragged
  let volumePanelTimeout = null; // Timeout for hiding volume panel

  /**
   * Formats seconds into MM:SS time string
   * @param {number} seconds - Time in seconds
   * @returns {string} Formatted time string
   */
  function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  /**
   * Updates progress bar and time displays based on current audio position
   */
  function updateProgress() {
    if (audio.duration && !isNaN(audio.duration)) {
      const progressPercent = (audio.currentTime / audio.duration) * 100;
      progressBar.style.width = `${progressPercent}%`;

      // Update draggable handle position to match progress
      const containerWidth = progressContainer.offsetWidth;
      const handlePosition = (progressPercent / 100) * containerWidth;
      progressHandle.style.left = `${handlePosition}px`;

      currentTimeEl.textContent = formatTime(audio.currentTime);
    }
  }

  /**
   * Resets progress bar and time displays to initial state
   */
  function resetProgress() {
    progressBar.style.width = '0%';
    progressHandle.style.left = '0px';
    currentTimeEl.textContent = '0:00';
    durationEl.textContent = '0:00';
  }

  /**
   * Seeks audio to position based on click/drag coordinates
   * @param {number} clientX - X coordinate of click/drag event
   */
  function seekToPosition(clientX) {
    if (!audio.duration) return;

    const rect = progressContainer.getBoundingClientRect();
    const clickX = clientX - rect.left;
    const width = rect.width;
    const percent = Math.max(0, Math.min(1, clickX / width)); // Clamp between 0-1

    audio.currentTime = percent * audio.duration;
    updateProgress();
  }

  // Event: Update duration display when audio metadata loads
  audio.addEventListener('loadedmetadata', () => {
    durationEl.textContent = formatTime(audio.duration);
  });

  // Event: Reset progress when new audio source starts loading
  audio.addEventListener('loadstart', () => {
    resetProgress();
  });

  // Event: Update progress bar as audio plays
  audio.addEventListener('timeupdate', updateProgress);

  // Event: Handle audio playback completion and restart for looping
  audio.addEventListener('ended', () => {
    // Instead of stopping, reset and restart for seamless looping
    audio.currentTime = 0;
    audio.play().catch(error => {
      console.log('Auto-restart after loop was prevented:', error);
      isPlaying = false;
      playBtn.textContent = 'Play';
    });
  });

  // Event: Click on progress bar to seek to position
  progressContainer.addEventListener('click', (e) => {
    seekToPosition(e.clientX);
  });

  // Event: Start dragging progress handle
  progressHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging = true;
    progressContainer.classList.add('dragging'); // Visual feedback

    document.addEventListener('mousemove', handleDrag);
    document.addEventListener('mouseup', stopDrag);
  });

  /**
   * Handles drag movement for progress bar seeking
   * @param {MouseEvent} e - Mouse move event
   */
  function handleDrag(e) {
    if (!isDragging) return;
    seekToPosition(e.clientX);
  }

  /**
   * Cleans up drag event listeners
   */
  function stopDrag() {
    isDragging = false;
    progressContainer.classList.remove('dragging');
    document.removeEventListener('mousemove', handleDrag);
    document.removeEventListener('mouseup', stopDrag);
  }

  /**
   * Shows volume control panel with smooth animation
   */
  function showVolumePanel() {
    const volumePanel = document.getElementById('volume-panel');
    volumePanel.style.opacity = '1';
    volumePanel.style.visibility = 'visible';
    volumePanel.style.transform = 'translateY(0)';

    // Clear any pending hide timeout
    if (volumePanelTimeout) {
      clearTimeout(volumePanelTimeout);
    }
  }

  /**
   * Hides volume control panel with delay to allow interaction
   */
  function hideVolumePanel() {
    volumePanelTimeout = setTimeout(() => {
      const volumePanel = document.getElementById('volume-panel');
      volumePanel.style.opacity = '0';
      volumePanel.style.visibility = 'hidden';
      volumePanel.style.transform = 'translateY(10px)';
    }, 300); // Delay allows user to move mouse to slider
  }

  // Volume control hover behavior
  volumeControl.addEventListener('mouseenter', showVolumePanel);
  volumeControl.addEventListener('mouseleave', hideVolumePanel);

  // Keep panel open when hovering over slider
  volumeSlider.addEventListener('mouseenter', showVolumePanel);
  volumeSlider.addEventListener('mouseleave', hideVolumePanel);

  // Event: Volume slider adjustment
  volumeSlider.addEventListener('input', () => {
    audio.volume = volumeSlider.value;
    if (audio.volume > 0 && isMuted) {
      isMuted = false; // Automatically unmute when adjusting volume
    }
    updateVolumeButton();
  });

  /**
   * Updates volume button icon based on current volume state
   */
  function updateVolumeButton() {
    if (isMuted || audio.volume === 0) {
      volumeBtn.textContent = '🔇'; // Muted icon
    } else if (audio.volume < 0.5) {
      volumeBtn.textContent = '🔈'; // Low volume icon
    } else {
      volumeBtn.textContent = '🔊'; // High volume icon
    }
  }

  // Event: Mute/unmute toggle (separate from volume adjustment)
  volumeBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent event from closing volume panel

    if (isMuted) {
      // Unmute: restore to last volume or default
      audio.volume = lastVolume > 0 ? lastVolume : 0.7;
      volumeSlider.value = audio.volume;
      isMuted = false;
    } else {
      // Mute: remember current volume and set to 0
      lastVolume = audio.volume;
      audio.volume = 0;
      volumeSlider.value = 0;
      isMuted = true;
    }
    updateVolumeButton();
    showVolumePanel(); // Keep panel open after mute action
  });

  // Event: Close volume panel when clicking elsewhere
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.volume-control')) {
      const volumePanel = document.getElementById('volume-panel');
      volumePanel.style.opacity = '0';
      volumePanel.style.visibility = 'hidden';
      volumePanel.style.transform = 'translateY(10px)';
    }
  });

  // Event: Play/pause toggle
  playBtn.addEventListener('click', () => {
    if (isPlaying) {
      audio.pause();
      playBtn.textContent = 'Play';
    } else {
      audio.play().catch(error => {
        console.log('Audio play failed:', error);
        // Handle browsers that block auto-play
      });
      playBtn.textContent = 'Pause';
    }
    isPlaying = !isPlaying;
  });

  // Store audio elements globally for access in other functions
  window.audioPlayer = audio;
  window.isPlaying = isPlaying;
  window.playBtn = playBtn;
  window.currentStationEl = currentStationEl;
  window.stationDescriptionEl = stationDescriptionEl;
  window.resetProgress = resetProgress;
}

/**
 * Sets up the date selector dropdown with dynamic options
 */
function setupDateSelector() {
    const dropdown = document.getElementById('selectDate');

    // Clear any existing options
    dropdown.innerHTML = '';

    // Add options for each date tab (excluding Master)
    sheetTabs.forEach(tabName => {
        if (tabName !== 'Master') {
            const option = document.createElement('option');
            option.value = tabName;
            option.textContent = `February ${tabName.replace('Feb', '')}`;
            dropdown.appendChild(option);
        }
    });

    // Set default selection
    dropdown.value = 'Feb22';

    // Add change event listener
    dropdown.addEventListener('change', changePanelContent);
}

/**
 * Handles station selection and updates audio player accordingly
 * @param {string} stationId - ID of the selected station
 */
function selectStation(stationId) {
  // Find station data from Master sheet
  const station = stations.find(s => s.id === stationId);

  // Get date-specific data for selected station
  const selectedDateId = document.getElementById('selectDate').value;
  const dynamicData = dateContent[selectedDateId]?.stations[stationId];

  if (!station || !dynamicData) {
    console.warn(`No data found for station ${stationId} on date ${selectedDateId}`);
    return;
  }

  console.log(`Loading station: ${stationId}, Audio: ${dynamicData.audioUrl}`);

  // Store active station ID for persistence
  if (window.currentStationEl) {
    window.currentStationEl.dataset.id = stationId;
  }

  // Update active station visual state in list
  document.querySelectorAll('.station-item').forEach(item => {
    item.classList.remove('active');
    if (item.dataset.station === stationId) {
      item.classList.add('active');
    }
  });

  // Update player display with station info
  window.currentStationEl.textContent = station.name;
  window.stationDescriptionEl.textContent = dynamicData.description;

  // Load and play new audio source with looping enabled
  window.audioPlayer.src = dynamicData.audioUrl;
  window.audioPlayer.loop = true; // Enable automatic looping
  window.audioPlayer.load();
  
  // Reset progress for new audio
  if (window.resetProgress) {
    window.resetProgress();
  }

  // Load and play new audio source
  window.audioPlayer.src = dynamicData.audioUrl;
  window.audioPlayer.load();

  // Handle audio loading errors
  window.audioPlayer.addEventListener('error', function(e) {
    console.error('Audio loading error:', e);
    console.error('Failed to load audio:', dynamicData.audioUrl);
  }, { once: true }); // Remove listener after first error

  // Reset playback position and attempt auto-play
  window.audioPlayer.currentTime = 0;
  const playPromise = window.audioPlayer.play();

  if (playPromise !== undefined) {
    playPromise.then(() => {
      window.isPlaying = true;
      window.playBtn.textContent = 'Pause';
    }).catch(error => {
      console.log('Auto-play was prevented:', error);
      window.isPlaying = false;
      window.playBtn.textContent = 'Play';
    });
  }

  // Center map on selected station and open popup
  map.setView([station.lat, station.lng], 12);
  station.marker.openPopup();
}

// Make selectStation globally available for HTML onclick handlers
window.selectStation = selectStation;

/**
 * Updates panel content when date selection changes
 */
function changePanelContent() {
    const dropdown = document.getElementById('selectDate');
    const selectedDateId = dropdown.value;
    const dateSpecificContent = dateContent[selectedDateId];

    if (!dateSpecificContent) {
        console.warn(`No content found for date: ${selectedDateId}`);
        console.log('Available dateContent:', dateContent);
        return;
    }

    console.log(`Loading content for ${selectedDateId}:`, dateSpecificContent);

    // Update main context sections
    const infoSection = document.querySelector('.info-section h2');
    const contextTitle = document.querySelector('.historical-context h3');
    const contextText = document.querySelector('.historical-context p');

    if (infoSection) infoSection.textContent = `Events of ${selectedDateId.replace('Feb', 'February ')}`;
    if (contextTitle) contextTitle.textContent = dateSpecificContent.title;
    if (contextText) contextText.textContent = dateSpecificContent.context;

    // Update station list with date-specific content
    const stationListDiv = document.querySelector('.station-list');
    if (!stationListDiv) {
        console.error('Station list div not found!');
        return;
    }

    stationListDiv.innerHTML = '<h3>Select a Radio Station</h3>';

    let stationsFound = 0;

    // Rebuild station list with date-specific descriptions
    stations.forEach(fullStationData => {
        const stationId = fullStationData.id;
        const dynamicData = dateSpecificContent.stations[stationId];

        // Skip stations without content for this date
        if (!dynamicData) {
            console.log(`No dynamic data for station ${stationId} on date ${selectedDateId}`);
            return;
        }

        stationsFound++;

        // Update marker popup with date-specific content
        fullStationData.marker.setPopupContent(`
        <div>
            <h3>${fullStationData.name}</h3>
            <p>${dynamicData.description}</p>
            <button onclick="selectStation('${stationId}')" class="station-select-btn">Select Station</button>
        </div>
    `);

        // Create new station list item
        const stationItem = document.createElement('div');
        stationItem.className = 'station-item';
        stationItem.dataset.station = stationId;
        stationItem.innerHTML = `
        <h4>${fullStationData.name}</h4>
        <img src="${fullStationData.icon}" width="30" height="30" alt="${fullStationData.name}">
        <p>${dynamicData.description}</p>
    `;

        // Add click handler to select station
        stationItem.addEventListener('click', () => {
            selectStation(stationId);
        });

        stationListDiv.appendChild(stationItem);
    });

    console.log(`Found ${stationsFound} stations with content for ${selectedDateId}`);

    // Maintain current station selection or select first available
    const currentlySelectedId = window.currentStationEl?.dataset.id;
    if (currentlySelectedId && dateSpecificContent.stations[currentlySelectedId]) {
        selectStation(currentlySelectedId);
    } else if (stations.length > 0) {
        // Fallback: select first station with content for this date
        const firstStationWithData = stations.find(station => dateSpecificContent.stations[station.id]);
        if (firstStationWithData) {
            selectStation(firstStationWithData.id);
        }
    }
}

/**
 * Converts CSV text into an array of JavaScript objects
 * @param {string} csv - Raw CSV text from Google Sheets
 * @returns {Array} Array of objects representing CSV rows
 */
function csvToObjects(csv) {
    const csvRows = csv.split("\n");
    const propertyNames = csvSplit(csvRows[0]); // First row contains headers
    let objects = [];

    // Process each data row (skip header row)
    for (let i = 1, max = csvRows.length; i < max; i++) {
        let thisObject = {};
        let row = csvSplit(csvRows[i]);

        // Map row values to property names
        for (let j = 0, max = row.length; j < max; j++) {
            thisObject[propertyNames[j]] = row[j];
        }
        objects.push(thisObject);
    }
    return objects;
}

/**
 * Robust CSV parsing that handles quoted fields containing commas
 * @param {string} row - Single row of CSV data
 * @returns {Array} Array of parsed field values
 */
function csvSplit(row) {
    const result = [];
    let inQuotes = false;
    let currentField = '';

    // Character-by-character parsing to handle quoted fields
    for (let i = 0; i < row.length; i++) {
        const char = row[i];

        if (char === '"') {
            inQuotes = !inQuotes; // Toggle quote state
        } else if (char === ',' && !inQuotes) {
            result.push(currentField); // End of field
            currentField = '';
        } else {
            currentField += char; // Build current field
        }
    }

    // Don't forget the last field
    result.push(currentField);

    return result;
}

/**
 * Shows trigger warning modal on page load and handles user acceptance
 */
function initializeTriggerWarning() {
    const modal = document.getElementById('trigger-warning-modal');
    const understandBtn = document.getElementById('modal-understand-btn');

    // Check if user has already accepted the warning in this session
    const warningAccepted = sessionStorage.getItem('triggerWarningAccepted');

    if (!warningAccepted) {
        // Show modal if not previously accepted
        modal.style.display = 'flex';

        // Handle understand button click
        understandBtn.addEventListener('click', () => {
            // Hide modal
            modal.style.display = 'none';
            // Store acceptance in session storage (lasts until browser closes)
            sessionStorage.setItem('triggerWarningAccepted', 'true');
            // Start the main application
            loadAllTabs();
        });
    } else {
        // If already accepted, start the application directly
        loadAllTabs();
    }
}

initializeTriggerWarning();
console.log();
