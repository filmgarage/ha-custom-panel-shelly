// /local/shelly-dashboard-panel.js
// version 0.3.0
// Custom panel that displays all Shelly devices (one per row) with essential information.
// 
// Changes in v0.3.0:
// - One device per row (deduplicated by device_id)
// - Removed: Auth, Bluetooth columns and search field
// - Added: Device Temperature, RSSI (signal strength), Uptime columns
// - Added: Firmware Update button (starts update directly)
// - Cloud status uses binary_sensor.*_cloud
// - Version number displayed in footer

class ShellyDashboardPanel extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this._panel = null;
    this._narrow = false;
    this._data = [];
    this._loading = false;
    this._error = null;
    this._sort = { key: 'name', dir: 'asc' };
    this.attachShadow({ mode: 'open' });
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._loading && (!this._data || this._data.length === 0)) {
      this._loadData();
    } else {
      this._render();
    }
  }

  set panel(panel) { this._panel = panel; }
  set narrow(narrow) { this._narrow = narrow; this._render(); }

  async _loadData() {
    if (!this._hass) return;
    this._loading = true;
    this._error = null;
    this._render();

    try {
      const [devices, entities] = await Promise.all([
        this._hass.callWS({ type: 'config/device_registry/list' }),
        this._hass.callWS({ type: 'config/entity_registry/list' }),
      ]);

      // Group entities by device
      const entitiesByDevice = new Map();
      for (const ent of entities) {
        if (!entitiesByDevice.has(ent.device_id)) {
          entitiesByDevice.set(ent.device_id, []);
        }
        entitiesByDevice.get(ent.device_id).push(ent);
      }

      const stateFor = (entity_id) => this._hass?.states?.[entity_id];

      // Filter only real Shelly devices
      const shellyDevices = devices.filter((d) => {
        const ents = entitiesByDevice.get(d.id) || [];
        const isShellyIntegration = ents.some((e) => e.platform === 'shelly');
        const isShellyManufacturer = d.manufacturer && String(d.manufacturer).toLowerCase() === 'shelly';
        return isShellyIntegration || isShellyManufacturer;
      });

      // Deduplicate by device_id and IP - each device appears only once
      const seenDevices = new Set();
      const rows = [];
      
      for (const d of shellyDevices) {
        // Skip if we've already processed this device
        if (seenDevices.has(d.id)) continue;
        
        const ents = entitiesByDevice.get(d.id) || [];
        const primaryEnt = this._selectPrimaryEntity(ents, stateFor);
        const ip = this._extractIP(d, ents, stateFor);

        // Skip duplicates by IP address as well
        const ipKey = ip ? `ip_${ip}` : null;
        if (ipKey && seenDevices.has(ipKey)) continue;
        
        // Mark this device and IP as processed
        seenDevices.add(d.id);
        if (ipKey) seenDevices.add(ipKey);

        // MAC address
        let mac = '';
        if (Array.isArray(d.connections)) {
          const macConn = d.connections.find((c) => c[0] === 'mac');
          if (macConn) mac = macConn[1];
        }

        // Cloud status - binary_sensor ending with _cloud
        let cloudState = null;
        const cloudEnt = ents.find((e) => e.domain === 'binary_sensor' && /_cloud$/i.test(e.entity_id));
        if (cloudEnt) {
          const st = stateFor(cloudEnt.entity_id);
          if (st) cloudState = st.state === 'on';
        }

        // Device temperature - sensor ending with _device_temperature
        let temperature = null;
        let temperatureEntity = null;
        const tempEnt = ents.find((e) => e.domain === 'sensor' && /_device_temperature$/i.test(e.entity_id));
        if (tempEnt) {
          const st = stateFor(tempEnt.entity_id);
          if (st && st.state !== 'unknown' && st.state !== 'unavailable') {
            temperature = st.state;
            temperatureEntity = tempEnt.entity_id;
          }
        }

        // RSSI - sensor ending with _rssi
        let rssi = null;
        let rssiEntity = null;
        const rssiEnt = ents.find((e) => e.domain === 'sensor' && /_rssi$/i.test(e.entity_id));
        if (rssiEnt) {
          const st = stateFor(rssiEnt.entity_id);
          if (st && st.state !== 'unknown' && st.state !== 'unavailable') {
            rssi = st.state;
            rssiEntity = rssiEnt.entity_id;
          }
        }

        // Uptime - sensor ending with _uptime
        let uptime = null;
        let uptimeEntity = null;
        const uptimeEnt = ents.find((e) => e.domain === 'sensor' && /_uptime$/i.test(e.entity_id));
        if (uptimeEnt) {
          const st = stateFor(uptimeEnt.entity_id);
          if (st && st.state !== 'unknown' && st.state !== 'unavailable') {
            uptime = st.state;
            uptimeEntity = uptimeEnt.entity_id;
          }
        }

        // Firmware update - update entity ending with _firmware_update
        let fwUpdateEntity = null;
        let fwUpToDate = null;
        let fwUpdateAvailable = false;
        const updateEnt = ents.find((e) => e.domain === 'update' && /_firmware_update$/i.test(e.entity_id));
        if (updateEnt) {
          fwUpdateEntity = updateEnt.entity_id;
          const st = stateFor(updateEnt.entity_id);
          if (st) {
            fwUpdateAvailable = st.state === 'on';
            fwUpToDate = st.state === 'off';
          }
        }

        rows.push({
          device_id: d.id,
          entity_id: primaryEnt ? primaryEnt.entity_id : '',
          name: d.name || d.model || d.id,
          model: d.model || '',
          ip,
          mac,
          cloud: cloudState,
          temperature,
          temperatureEntity,
          rssi,
          rssiEntity,
          uptime,
          uptimeEntity,
          fwUpdateEntity,
          fwUpToDate,
          fwUpdateAvailable,
          configuration_url: d.configuration_url || (ip ? `http://${ip}/` : ''),
        });
      }

      this._data = rows;
      this._loading = false;
      this._render();
    } catch (err) {
      console.error('Shelly Dashboard Panel - Error loading data:', err);
      this._error = String(err?.message || err);
      this._loading = false;
      this._render();
    }
  }

  // Select the best primary entity (priority: light > switch > cover > others)
  _selectPrimaryEntity(entities, stateFor) {
    const priorityDomains = ['light', 'switch', 'cover', 'sensor', 'binary_sensor'];
    
    for (const domain of priorityDomains) {
      const withState = entities.filter((e) => e.domain === domain && stateFor(e.entity_id));
      if (withState.length > 0) {
        const primary = withState.find((e) => !/_\d+$/.test(e.entity_id) && !/channel_\d+/.test(e.entity_id));
        return primary || withState[0];
      }
      
      const anyOfDomain = entities.find((e) => e.domain === domain);
      if (anyOfDomain) return anyOfDomain;
    }

    const withState = entities.find((e) => stateFor(e.entity_id));
    if (withState) return withState;

    return entities[0];
  }

  // Enhanced IP address extraction with multiple fallback methods
  _extractIP(device, entities, stateFor) {
    // Method 1: configuration_url
    if (device.configuration_url) {
      try {
        const url = new URL(device.configuration_url);
        if (url.hostname && url.hostname !== 'localhost' && url.hostname !== '0.0.0.0') {
          return url.hostname;
        }
      } catch {
        const cleaned = device.configuration_url.replace(/^https?:\/\//, '').replace(/\/$/, '');
        const hostname = cleaned.split('/')[0].split(':')[0];
        if (hostname && hostname !== 'localhost' && hostname !== '0.0.0.0') {
          return hostname;
        }
      }
    }

    // Method 2: Look for wifi_ip or ip_address entity
    const ipPatterns = [
      /wifi_?ip$/i,
      /ip_?address$/i,
      /_ip$/i,
      /^ip$/i
    ];

    for (const pattern of ipPatterns) {
      const ipEnt = entities.find((e) => pattern.test(e.entity_id) && e.domain === 'sensor');
      if (ipEnt) {
        const st = stateFor(ipEnt.entity_id);
        if (st?.state && st.state !== 'unknown' && st.state !== 'unavailable') {
          if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(st.state)) {
            return st.state;
          }
        }
      }
    }

    // Method 3: Look through all sensor entities for IP pattern
    const sensors = entities.filter((e) => e.domain === 'sensor');
    for (const sensor of sensors) {
      const st = stateFor(sensor.entity_id);
      if (st?.state && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(st.state)) {
        return st.state;
      }
    }

    return '';
  }

  connectedCallback() { 
    this._render(); 
  }

  async _handleFirmwareUpdate(entityId) {
    if (!this._hass || !entityId) return;
    
    try {
      await this._hass.callService('update', 'install', {
        entity_id: entityId
      });
      
      // Reload data after a short delay to show updated status
      setTimeout(() => {
        this._data = [];
        this._loadData();
      }, 2000);
    } catch (err) {
      console.error('Error updating firmware:', err);
      alert(`Error updating firmware: ${err.message}`);
    }
  }

  _render() {
    const style = `
      :host { 
        display: block; 
        padding: 16px; 
        box-sizing: border-box; 
      }
      h1 { 
        font-size: 22px; 
        margin: 8px 0 16px;
        font-weight: 500;
      }
      .card { 
        background: var(--card-background-color, #fff); 
        border-radius: 12px; 
        padding: 16px; 
        box-shadow: var(--ha-card-box-shadow, 0 2px 4px rgba(0,0,0,0.1)); 
      }
      table { 
        width: 100%; 
        border-collapse: collapse; 
      }
      th, td { 
        text-align: left; 
        padding: 12px 10px; 
        border-bottom: 1px solid var(--divider-color, #e0e0e0); 
      }
      th { 
        font-weight: 600;
        font-size: 13px;
        color: var(--secondary-text-color, #666);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      th.sortable { 
        cursor: pointer; 
        user-select: none;
        transition: color 0.2s;
      }
      th.sortable:hover {
        color: var(--primary-color);
      }
      th.sortable .sort-indicator { 
        opacity: 0.6; 
        margin-left: 6px; 
        font-size: 11px; 
      }
      tbody tr {
        transition: background-color 0.15s;
      }
      tbody tr:hover {
        background-color: var(--table-row-background-hover-color, rgba(0,0,0,0.03));
      }
      .muted { 
        color: var(--secondary-text-color, #666); 
      }
      .chip { 
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 28px;
        height: 28px;
        padding: 0 10px;
        border-radius: 14px; 
        font-size: 14px;
        font-weight: 600;
        transition: transform 0.1s;
      }
      .chip:hover {
        transform: scale(1.05);
      }
      .ok { 
        background: #4caf50; 
        color: white; 
      }
      .off { 
        background: #f44336; 
        color: white; 
      }
      .unknown { 
        background: #9e9e9e; 
        color: white;
        opacity: 0.6;
      }
      .loading { 
        opacity: 0.7; 
      }
      a { 
        color: var(--primary-color); 
        text-decoration: none;
        font-family: monospace;
        font-weight: 500;
      }
      a:hover { 
        text-decoration: underline; 
      }
      .toolbar { 
        display: flex; 
        align-items: center; 
        justify-content: space-between; 
        margin-bottom: 16px;
        gap: 16px;
        flex-wrap: wrap;
      }
      .linklike { 
        background: none; 
        border: none; 
        padding: 0; 
        margin: 0; 
        color: var(--primary-text-color); 
        text-decoration: none; 
        cursor: pointer; 
        font: inherit;
        font-weight: 500;
        transition: color 0.2s;
      }
      .linklike:hover { 
        color: var(--primary-color);
      }
      .status-cell {
        text-align: center;
      }
      .numeric-cell {
        text-align: right;
        font-family: monospace;
      }
      .footer {
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid var(--divider-color, #e0e0e0);
        font-size: 12px;
      }
      .refresh-button {
        background: var(--primary-color);
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: opacity 0.2s;
      }
      .refresh-button:hover {
        opacity: 0.9;
      }
      .refresh-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .update-button {
        background: #ff9800;
        color: white;
        border: none;
        padding: 4px 12px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        transition: opacity 0.2s;
        text-transform: uppercase;
      }
      .update-button:hover {
        opacity: 0.9;
      }
      .update-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      @media (max-width: 768px) {
        :host {
          padding: 8px;
        }
        .card {
          padding: 12px;
        }
        th, td {
          padding: 8px 6px;
          font-size: 13px;
        }
        .toolbar {
          flex-direction: column;
          align-items: stretch;
        }
      }
    `;

    const loading = this._loading;
    const error = this._error;
    const rows = this._data || [];
    const shown = this._applySort(rows.slice());

    // Enhanced status icons
    const icon = (val) => {
      if (val === true) return '<span class="chip ok" title="Active">✓</span>';
      if (val === false) return '<span class="chip off" title="Inactive">✗</span>';
      return '<span class="chip unknown" title="Unknown">—</span>';
    };

    const formatTemp = (temp) => {
      if (!temp) return '<span class="muted">—</span>';
      return `${temp}°C`;
    };

    const formatRSSI = (rssi) => {
      if (!rssi) return '<span class="muted">—</span>';
      const val = parseInt(rssi);
      let quality = '';
      if (val >= -50) quality = '🟢'; // Excellent
      else if (val >= -60) quality = '🟡'; // Good
      else if (val >= -70) quality = '🟠'; // Fair
      else quality = '🔴'; // Poor
      return `${quality} ${rssi} dBm`;
    };

    const formatUptime = (uptime) => {
      if (!uptime) return '<span class="muted">—</span>';
      return uptime;
    };

    this.shadowRoot.innerHTML = `
      <style>${style}</style>
      <div class="card ${loading ? 'loading' : ''}">
        <div class="toolbar">
          <div style="display: flex; align-items: center; gap: 12px;">
            <h1>Shelly Devices</h1>
            <button class="refresh-button" id="refresh-btn" ${loading ? 'disabled' : ''}>
              ${loading ? '⟳ Loading...' : '⟳ Refresh'}
            </button>
          </div>
        </div>
        
        ${error ? `<p style="color: var(--error-color); padding: 12px; background: rgba(244,67,54,0.1); border-radius: 8px; margin-bottom: 16px;">⚠️ Error: ${this._escape(error)}</p>` : ''}
        
        ${loading && !rows.length ? '<p class="muted" style="text-align: center; padding: 24px;">⏳ Loading devices...</p>' : ''}
        
        ${!loading && rows.length === 0 ? '<p class="muted" style="text-align: center; padding: 24px;">No Shelly devices found.</p>' : ''}
        
        ${shown.length > 0 ? `
        <div style="overflow-x: auto;">
          <table aria-label="Shelly devices overview">
            <thead>
              <tr>
                <th class="sortable" data-key="name">Name <span class="sort-indicator">${this._getSortIndicator('name')}</span></th>
                <th class="sortable" data-key="model">Model <span class="sort-indicator">${this._getSortIndicator('model')}</span></th>
                <th class="sortable" data-key="ip">IP Address <span class="sort-indicator">${this._getSortIndicator('ip')}</span></th>
                <th class="sortable" data-key="mac">MAC Address <span class="sort-indicator">${this._getSortIndicator('mac')}</span></th>
                <th class="sortable status-cell" data-key="cloud" title="Cloud connection">Cloud <span class="sort-indicator">${this._getSortIndicator('cloud')}</span></th>
                <th class="sortable numeric-cell" data-key="temperature" title="Device temperature">Temp <span class="sort-indicator">${this._getSortIndicator('temperature')}</span></th>
                <th class="sortable numeric-cell" data-key="rssi" title="WiFi signal strength">RSSI <span class="sort-indicator">${this._getSortIndicator('rssi')}</span></th>
                <th class="sortable" data-key="uptime" title="Device uptime">Uptime <span class="sort-indicator">${this._getSortIndicator('uptime')}</span></th>
                <th class="sortable status-cell" data-key="fwUpToDate" title="Firmware update">FW Update <span class="sort-indicator">${this._getSortIndicator('fwUpToDate')}</span></th>
              </tr>
            </thead>
            <tbody>
              ${shown.map((r) => `
                <tr>
                  <td>
                    ${r.entity_id 
                      ? `<button class="linklike more-info" data-entity="${this._escape(r.entity_id)}">${this._escape(r.name || '')}</button>` 
                      : this._escape(r.name || '')}
                  </td>
                  <td>${this._escape(r.model || '')}</td>
                  <td>
                    ${r.ip 
                      ? `<a href="${this._escape(r.configuration_url)}" target="_blank" rel="noreferrer noopener" title="Open web interface">${this._escape(r.ip)}</a>` 
                      : '<span class="muted">—</span>'}
                  </td>
                  <td>${r.mac ? `<span style="font-family: monospace; font-size: 12px;">${this._escape(r.mac)}</span>` : '<span class="muted">—</span>'}</td>
                  <td class="status-cell">${icon(r.cloud)}</td>
                  <td class="numeric-cell">${formatTemp(r.temperature)}</td>
                  <td class="numeric-cell">${formatRSSI(r.rssi)}</td>
                  <td>${formatUptime(r.uptime)}</td>
                  <td class="status-cell">
                    ${r.fwUpdateAvailable 
                      ? `<button class="update-button" data-entity="${this._escape(r.fwUpdateEntity)}" title="Click to update firmware">Update</button>`
                      : r.fwUpToDate === true
                        ? '<span class="chip ok" title="Up to date">✓</span>'
                        : '<span class="chip unknown" title="Unknown">—</span>'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ` : ''}
        
        <div class="footer muted">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
            <span>${shown.length} ${shown.length === 1 ? 'device' : 'devices'}</span>
            <span style="font-weight: 600; color: var(--primary-text-color);">v0.3.0</span>
            <span>Source: Home Assistant Device & Entity Registry</span>
          </div>
        </div>
      </div>
    `;

    // Event listeners
    this._attachEventListeners();
  }

  _attachEventListeners() {
    // Refresh button
    const refreshBtn = this.shadowRoot.getElementById('refresh-btn');
    if (refreshBtn) {
      refreshBtn.onclick = () => {
        this._data = [];
        this._loadData();
      };
    }

    // Sort functionality
    this.shadowRoot.querySelectorAll('th.sortable').forEach((th) => {
      th.onclick = () => {
        const key = th.getAttribute('data-key');
        this._toggleSort(key);
      };
    });

    // More Info dialog
    this.shadowRoot.querySelectorAll('button.more-info[data-entity]').forEach((btn) => {
      btn.onclick = () => {
        const entityId = btn.getAttribute('data-entity');
        if (entityId && this._hass) {
          const ev = new Event('hass-more-info', { bubbles: true, composed: true });
          ev.detail = { entityId };
          this.dispatchEvent(ev);
        }
      };
    });

    // Firmware update buttons
    this.shadowRoot.querySelectorAll('button.update-button[data-entity]').forEach((btn) => {
      btn.onclick = () => {
        const entityId = btn.getAttribute('data-entity');
        if (entityId && confirm('Start firmware update for this device?')) {
          this._handleFirmwareUpdate(entityId);
        }
      };
    });
  }

  _getSortIndicator(key) {
    if (this._sort?.key !== key) return '';
    return this._sort.dir === 'asc' ? '▲' : '▼';
  }

  _applySort(arr) {
    const { key, dir } = this._sort || { key: 'name', dir: 'asc' };
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    
    const val = (r) => {
      const v = r[key];
      if (v === null || v === undefined) return '';
      if (typeof v === 'boolean') return v ? '1' : '0';
      return String(v);
    };
    
    arr.sort((a, b) => {
      const cmp = collator.compare(val(a), val(b));
      return dir === 'asc' ? cmp : -cmp;
    });
    
    return arr;
  }

  _toggleSort(key) {
    if (!this._sort) {
      this._sort = { key, dir: 'asc' };
    } else if (this._sort.key === key) {
      this._sort.dir = this._sort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      this._sort.key = key;
      this._sort.dir = 'asc';
    }
    this._render();
  }

  _escape(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
}

customElements.define('shelly-dashboard-panel', ShellyDashboardPanel);
