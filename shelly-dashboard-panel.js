// /local/shelly-dashboard-panel.js
// version 0.3.1
// Custom panel that displays all Shelly devices (one per row) with essential information.
// 
// Changes in v0.3.1:
// - Primary entity selection now properly filters out CONFIG and DIAGNOSTIC entities
// - All entities (cloud, temperature, rssi, uptime, firmware, reboot) matched per device_id
// - Added Reboot button column (button.*_reboot)
// - MAC address is now clickable and opens device config page
// - Removed refresh button (users can refresh page manually)

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

        // Cloud status - binary_sensor ending with _cloud (from THIS device's entities)
        let cloudState = null;
        const cloudEnt = ents.find((e) => e.domain === 'binary_sensor' && /_cloud$/i.test(e.entity_id));
        if (cloudEnt) {
          const st = stateFor(cloudEnt.entity_id);
          if (st) cloudState = st.state === 'on';
        }

        // Device temperature - sensor ending with _device_temperature (from THIS device)
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

        // RSSI - sensor ending with _rssi (from THIS device)
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

        // Uptime - sensor ending with _uptime (from THIS device)
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

        // Firmware update - update entity ending with _firmware_update (from THIS device)
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

        // Reboot button - button ending with _reboot (from THIS device)
        let rebootEntity = null;
        const rebootEnt = ents.find((e) => e.domain === 'button' && /_reboot$/i.test(e.entity_id));
        if (rebootEnt) {
          rebootEntity = rebootEnt.entity_id;
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
          rebootEntity,
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

  // Select the best PRIMARY entity (no CONFIG or DIAGNOSTIC entities)
  // Priority: light > switch > cover > others
  _selectPrimaryEntity(entities, stateFor) {
    // Filter out CONFIG and DIAGNOSTIC entities - we only want PRIMARY entities
    const primaryEntities = entities.filter(e => !e.entity_category);
    
    if (primaryEntities.length === 0) {
      // Fallback if no primary entities found
      return entities[0];
    }

    const priorityDomains = ['light', 'switch', 'cover', 'sensor', 'binary_sensor'];
    
    for (const domain of priorityDomains) {
      // Look for entities of this domain with state
      const withState = primaryEntities.filter((e) => e.domain === domain && stateFor(e.entity_id));
      if (withState.length > 0) {
        // Prefer entities without channel suffixes
        const primary = withState.find((e) => !/_\d+$/.test(e.entity_id) && !/channel_\d+/.test(e.entity_id));
        return primary || withState[0];
      }
      
      // If no state found, just return first entity of this domain
      const anyOfDomain = primaryEntities.find((e) => e.domain === domain);
      if (anyOfDomain) return anyOfDomain;
    }

    // Fallback: any primary entity with state
    const withState = primaryEntities.find((e) => stateFor(e.entity_id));
    if (withState) return withState;

    // Last resort: first primary entity
    return primaryEntities[0];
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

  async _handleReboot(entityId) {
    if (!this._hass || !entityId) return;
    
    try {
      await this._hass.callService('button', 'press', {
        entity_id: entityId
      });
      
      alert('Reboot command sent to device');
    } catch (err) {
      console.error('Error rebooting device:', err);
      alert(`Error rebooting device: ${err.message}`);
    }
  }

  _navigateToDevice(deviceId) {
    if (!deviceId) return;
    
    // Navigate to device config page
    window.history.pushState(null, '', `/config/devices/device/${deviceId}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
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
        font-weight: 500;
      }
      a:hover { 
        text-decoration: underline; 
      }
      .mac-link {
        font-family: monospace;
        font-size: 12px;
        cursor: pointer;
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
      .action-button {
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
      .action-button:hover {
        opacity: 0.9;
      }
      .action-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .update-button {
        background: #ff9800;
      }
      .reboot-button {
        background: #f44336;
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
          <h1>Shelly Devices</h1>
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
                <th class="status-cell" title="Reboot device">Reboot</th>
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
                  <td>
                    ${r.mac 
                      ? `<a class="mac-link" data-device="${this._escape(r.device_id)}" title="Open device config page">${this._escape(r.mac)}</a>` 
                      : '<span class="muted">—</span>'}
                  </td>
                  <td class="status-cell">${icon(r.cloud)}</td>
                  <td class="numeric-cell">${formatTemp(r.temperature)}</td>
                  <td class="numeric-cell">${formatRSSI(r.rssi)}</td>
                  <td>${formatUptime(r.uptime)}</td>
                  <td class="status-cell">
                    ${r.fwUpdateAvailable 
                      ? `<button class="action-button update-button" data-entity="${this._escape(r.fwUpdateEntity)}" title="Click to update firmware">Update</button>`
                      : r.fwUpToDate === true
                        ? '<span class="chip ok" title="Up to date">✓</span>'
                        : '<span class="chip unknown" title="Unknown">—</span>'}
                  </td>
                  <td class="status-cell">
                    ${r.rebootEntity 
                      ? `<button class="action-button reboot-button" data-entity="${this._escape(r.rebootEntity)}" title="Click to reboot device">Reboot</button>`
                      : '<span class="muted">—</span>'}
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
            <span style="font-weight: 600; color: var(--primary-text-color);">v0.3.1</span>
            <span>Source: Home Assistant Device & Entity Registry</span>
          </div>
        </div>
      </div>
    `;

    // Event listeners
    this._attachEventListeners();
  }

  _attachEventListeners() {
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

    // MAC address links to device config
    this.shadowRoot.querySelectorAll('a.mac-link[data-device]').forEach((link) => {
      link.onclick = (e) => {
        e.preventDefault();
        const deviceId = link.getAttribute('data-device');
        if (deviceId) {
          this._navigateToDevice(deviceId);
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

    // Reboot buttons
    this.shadowRoot.querySelectorAll('button.reboot-button[data-entity]').forEach((btn) => {
      btn.onclick = () => {
        const entityId = btn.getAttribute('data-entity');
        if (entityId && confirm('Reboot this device? It will be unavailable for a short time.')) {
          this._handleReboot(entityId);
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
