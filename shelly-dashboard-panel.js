// /local/shelly-dashboard-panel.js
// version 0.2.1
// Custom panel that displays all Shelly devices with: model, IP (clickable), MAC,
// and security/maintenance indicators: Auth, Cloud, Bluetooth, Firmware up-to-date.
// 
// Improvements v0.2.1:
// - Fixed primary entity selection to actually prioritize light/switch/cover
// - Fixed IP address detection for multi-channel devices (2PM, Pro4, 2.5, etc)
// - Fixed keyboard shortcuts interference with search input
// - Fixed status detection for Auth, Cloud, Bluetooth, and Firmware
// - Improved visual indicators with proper checkmarks and colors

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
    this._filter = '';
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

      const rows = [];
      for (const d of shellyDevices) {
        const ents = entitiesByDevice.get(d.id) || [];

        // Enhanced primary entity selection: prioritize light and switch
        const primaryEnt = this._selectPrimaryEntity(ents, stateFor);

        // Enhanced IP address detection with multiple fallbacks
        const ip = this._extractIP(d, ents, stateFor);

        // MAC address
        let mac = '';
        if (Array.isArray(d.connections)) {
          const macConn = d.connections.find((c) => c[0] === 'mac');
          if (macConn) mac = macConn[1];
        }

        // Firmware version
        let firmware = '';
        const updateEnt =
          ents.find((e) => e.platform && e.platform.includes('shelly') && e.domain === 'update') ||
          ents.find((e) => e.domain === 'update');
        if (updateEnt) {
          const st = stateFor(updateEnt.entity_id);
          firmware = st?.attributes?.installed_version || st?.attributes?.current_version || '';
        } else {
          const infoEnt = ents.find((e) => /firmware|fw/i.test(e.entity_id));
          if (infoEnt) {
            const st = stateFor(infoEnt.entity_id);
            firmware = st?.state && st.state !== 'unknown' && st.state !== 'unavailable' ? st.state : '';
          }
        }

        // Cloud status - look for binary_sensor or switch
        let cloudState = null;
        const cloudEnt = ents.find(
          (e) => (e.domain === 'binary_sensor' || e.domain === 'switch') && 
                 (/_cloud$/i.test(e.entity_id) || /cloud/i.test(e.entity_id))
        );
        if (cloudEnt) {
          const st = stateFor(cloudEnt.entity_id);
          if (st) {
            cloudState = st.state === 'on' || st.state === 'true';
          }
        }

        // Auth (heuristic) - look for binary_sensor
        let authState = null;
        const authEnt = ents.find(
          (e) =>
            e.domain === 'binary_sensor' &&
            (/(auth|authentication|password|login)/i.test(e.entity_id) ||
            /(auth|authentication|password|login)/i.test(e.original_name || e.name || ''))
        );
        if (authEnt) {
          const st = stateFor(authEnt.entity_id);
          if (st) {
            authState = st.state === 'on' || st.state === 'true';
          }
        }

        // Bluetooth - look for switch
        let btState = null;
        const btEnt = ents.find(
          (e) => (e.domain === 'switch' || e.domain === 'binary_sensor') && 
                 (/bluetooth/i.test(e.entity_id) || /bluetooth/i.test(e.original_name || e.name || ''))
        );
        if (btEnt) {
          const st = stateFor(btEnt.entity_id);
          if (st) {
            btState = st.state === 'on';
          }
        }

        // Firmware up-to-date?
        let fwUpToDate = null;
        if (updateEnt) {
          const st = stateFor(updateEnt.entity_id);
          const installed = st?.attributes?.installed_version || st?.attributes?.current_version;
          const latest = st?.attributes?.latest_version;
          if (installed && latest) {
            fwUpToDate = installed === latest;
          } else if (st) {
            fwUpToDate = st.state === 'off'; // 'off' = no update available
          }
        }

        rows.push({
          device_id: d.id,
          entity_id: primaryEnt ? primaryEnt.entity_id : '',
          name: d.name || d.model || d.id,
          model: d.model || '',
          ip,
          mac,
          firmware,
          auth: authState,
          cloud: cloudState,
          bluetooth: btState,
          fwUpToDate,
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
    // Priority list of domains to look for
    const priorityDomains = ['light', 'switch', 'cover', 'sensor', 'binary_sensor'];
    
    for (const domain of priorityDomains) {
      // First try to find entities of this domain that have a state
      const withState = entities.filter((e) => e.domain === domain && stateFor(e.entity_id));
      if (withState.length > 0) {
        // If we have multiple, prefer ones without _channel or numeric suffixes
        const primary = withState.find((e) => !/_\d+$/.test(e.entity_id) && !/channel_\d+/.test(e.entity_id));
        return primary || withState[0];
      }
      
      // If no state found, just return first entity of this domain
      const anyOfDomain = entities.find((e) => e.domain === domain);
      if (anyOfDomain) return anyOfDomain;
    }

    // Fallback: any entity with state
    const withState = entities.find((e) => stateFor(e.entity_id));
    if (withState) return withState;

    // Last resort: first entity
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
        // Fallback parsing if URL constructor fails
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
          // Validate that it looks like a valid IP address
          if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(st.state)) {
            return st.state;
          }
        }
      }
    }

    // Method 3: Look through ALL sensor entities for IP pattern in state
    const sensors = entities.filter((e) => e.domain === 'sensor');
    for (const sensor of sensors) {
      const st = stateFor(sensor.entity_id);
      if (st?.state && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(st.state)) {
        return st.state;
      }
    }

    // Method 4: Check device attributes for IP
    if (device.name_by_user || device.name) {
      const nameMatch = (device.name_by_user || device.name).match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
      if (nameMatch) return nameMatch[0];
    }

    // No IP found
    return '';
  }

  connectedCallback() { 
    this._render(); 
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
      input[type="search"] { 
        width: 320px; 
        max-width: 100%; 
        padding: 10px 14px; 
        border-radius: 8px; 
        border: 1px solid var(--divider-color, #e0e0e0); 
        background: var(--secondary-background-color, #fafafa); 
        color: var(--primary-text-color); 
        font-size: 14px;
        transition: border-color 0.2s, background-color 0.2s;
      }
      input[type="search"]:focus {
        outline: none;
        border-color: var(--primary-color);
        background: var(--card-background-color, #fff);
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
        input[type="search"] {
          width: 100%;
        }
      }
    `;

    const loading = this._loading;
    const error = this._error;
    const rows = this._data || [];
    const filter = this._filter || '';
    
    const filtered = !filter ? rows : rows.filter((r) => {
      const hay = `${r.name} ${r.model} ${r.ip} ${r.mac} ${r.firmware}`.toLowerCase();
      return hay.includes(filter.toLowerCase());
    });
    
    const shown = this._applySort(filtered.slice());

    // Enhanced status icons with clearer symbols
    const icon = (val) => {
      if (val === true) return '<span class="chip ok" title="Active">✓</span>';
      if (val === false) return '<span class="chip off" title="Inactive">✗</span>';
      return '<span class="chip unknown" title="Unknown">—</span>';
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
          <input type="search" placeholder="Search by name, model, IP, MAC..." value="${this._escape(filter)}"/>
        </div>
        
        ${error ? `<p style="color: var(--error-color); padding: 12px; background: rgba(244,67,54,0.1); border-radius: 8px; margin-bottom: 16px;">⚠️ Error: ${this._escape(error)}</p>` : ''}
        
        ${loading && !rows.length ? '<p class="muted" style="text-align: center; padding: 24px;">⏳ Loading devices...</p>' : ''}
        
        ${!loading && shown.length === 0 && rows.length > 0 ? '<p class="muted" style="text-align: center; padding: 24px;">No devices found matching this search.</p>' : ''}
        
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
                <th class="sortable status-cell" data-key="auth" title="Authentication">Auth <span class="sort-indicator">${this._getSortIndicator('auth')}</span></th>
                <th class="sortable status-cell" data-key="cloud" title="Cloud connection">Cloud <span class="sort-indicator">${this._getSortIndicator('cloud')}</span></th>
                <th class="sortable status-cell" data-key="bluetooth" title="Bluetooth">BT <span class="sort-indicator">${this._getSortIndicator('bluetooth')}</span></th>
                <th class="sortable status-cell" data-key="fwUpToDate" title="Firmware status">FW <span class="sort-indicator">${this._getSortIndicator('fwUpToDate')}</span></th>
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
                  <td class="status-cell">${icon(r.auth)}</td>
                  <td class="status-cell">${icon(r.cloud)}</td>
                  <td class="status-cell">${icon(r.bluetooth)}</td>
                  <td class="status-cell">${icon(r.fwUpToDate)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ` : ''}
        
        <div class="footer muted">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
            <span>${shown.length} ${shown.length === 1 ? 'device' : 'devices'}${filtered.length !== rows.length ? ` (${rows.length} total)` : ''}</span>
            <span>Source: Home Assistant Device & Entity Registry</span>
          </div>
        </div>
      </div>
    `;

    // Event listeners
    this._attachEventListeners();
  }

  _attachEventListeners() {
    // Search functionality
    const search = this.shadowRoot.querySelector('input[type="search"]');
    if (search) {
      search.oninput = (e) => { 
        this._filter = e.target.value || ''; 
        this._render(); 
      };
      
      // Prevent Home Assistant keyboard shortcuts from interfering with search input
      // Use capture phase to catch events before they bubble
      search.addEventListener('keydown', (e) => {
        e.stopPropagation();
      }, true);
      
      search.addEventListener('keyup', (e) => {
        e.stopPropagation();
      }, true);
      
      search.addEventListener('keypress', (e) => {
        e.stopPropagation();
      }, true);
      
      // Also prevent default for some problematic keys
      search.addEventListener('keydown', (e) => {
        // Don't prevent default for navigation keys
        const allowedKeys = ['Tab', 'Escape', 'Enter'];
        if (!allowedKeys.includes(e.key)) {
          // Allow normal typing
          e.stopImmediatePropagation();
        }
      });
    }

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
          // Trigger Home Assistant more-info dialog
          const ev = new Event('hass-more-info', { bubbles: true, composed: true });
          ev.detail = { entityId };
          this.dispatchEvent(ev);
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
