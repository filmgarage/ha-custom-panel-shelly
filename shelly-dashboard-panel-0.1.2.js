// /local/shelly-dashboard-panel.js v0.1.2
// Custom panel that lists all Shelly devices with: model, IP (clickable), MAC, firmware, and cloud on/off
// How it works:
// - Uses Home Assistant WebSocket (hass.callWS) to read the device & entity registry
// - Detects Shelly devices by manufacturer === 'Shelly' OR by any entity from 'shelly' integration
// - IP address is parsed from device.configuration_url when available
// - Firmware is read from a matching 'update.*' entity on the device (installed_version)
// - Cloud is read from a switch entity ending with '_cloud' (state on/off)
// NOTE: Depending on your Shelly models/integration, some fields may be unavailable.

class ShellyDashboardPanel extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this._panel = null;
    this._narrow = false;
    this._data = [];
    this._loading = false;
    this._error = null;
    this.attachShadow({ mode: 'open' });
  }

  set hass(hass) {
    this._hass = hass;
    // If we haven't loaded yet, attempt to load
    if (!this._loading && (!this._data || this._data.length === 0)) {
      this._loadData();
    } else {
      this._render();
    }
  }

  set panel(panel) {
    this._panel = panel;
  }

  set narrow(narrow) {
    this._narrow = narrow;
    this._render();
  }

  async _loadData() {
    if (!this._hass) return;
    this._loading = true;
    this._error = null;
    this._render();

    try {
      // Fetch device and entity registries
      const [devices, entities] = await Promise.all([
        this._hass.callWS({ type: 'config/device_registry/list' }),
        this._hass.callWS({ type: 'config/entity_registry/list' }),
      ]);

      // Build lookup of entities by device_id
      const entitiesByDevice = new Map();
      for (const ent of entities) {
        if (!entitiesByDevice.has(ent.device_id)) entitiesByDevice.set(ent.device_id, []);
        entitiesByDevice.get(ent.device_id).push(ent);
      }

      // Helper: find HA state for an entity_id
      const stateFor = (entity_id) => this._hass?.states?.[entity_id];

      // Identify Shelly devices
      const shellyDevices = devices.filter((d) => {
        if (d.manufacturer && String(d.manufacturer).toLowerCase().includes('shelly')) return true;
        const ents = entitiesByDevice.get(d.id) || [];
        // Fallback: any entity with platform 'shelly' (integration) if present on entity registry
        return ents.some((e) => e.platform === 'shelly');
      });

      // Build rows
      const rows = [];
      for (const d of shellyDevices) {
        const ents = entitiesByDevice.get(d.id) || [];

        // IP from configuration_url if present
        let ip = '';
        if (d.configuration_url) {
          try {
            const url = new URL(d.configuration_url);
            ip = url.hostname;
          } catch (e) {
            // Sometimes configuration_url might be missing protocol
            const raw = d.configuration_url.replace(/^https?:\/\//, '').replace(/\/$/, '');
            ip = raw.split('/')[0];
          }
        } else {
          // Try to find IP in any entity attribute commonly used by Shelly (e.g., sensor.*_wifi_ip)
          const ipEnt = ents.find((e) => /wifi_?ip|ip_address/i.test(e.entity_id));
          if (ipEnt) {
            const st = stateFor(ipEnt.entity_id);
            if (st?.state && st.state !== 'unknown' && st.state !== 'unavailable') {
              ip = st.state;
            }
          }
        }

        // MAC from device.connections [['mac', 'xx:xx:..']]
        let mac = '';
        if (Array.isArray(d.connections)) {
          const macConn = d.connections.find((c) => c[0] === 'mac');
          if (macConn) mac = macConn[1];
        }

        // Firmware: try update.* entity on this device
        let firmware = '';
        const updateEnt = ents.find((e) => e.platform && e.platform.includes('shelly') && e.domain === 'update')
          || ents.find((e) => e.domain === 'update');
        if (updateEnt) {
          const st = stateFor(updateEnt.entity_id);
          firmware = st?.attributes?.installed_version || st?.attributes?.current_version || '';
        } else {
          // Some Shelly sensors expose firmware as attribute on a device info sensor
          const infoEnt = ents.find((e) => /firmware|fw/i.test(e.entity_id));
          if (infoEnt) {
            const st = stateFor(infoEnt.entity_id);
            firmware = st?.state && st.state !== 'unknown' ? st.state : '';
          }
        }

        // Cloud switch: look for switch.* ending with _cloud or having device_class 'switch' & name containing 'cloud'
        let cloudState = null; // null = unknown, true/false known
        const cloudEnt = ents.find((e) => e.domain === 'switch' && (/_cloud$/i.test(e.entity_id) || /cloud/i.test(e.original_name || e.name || '')));
        if (cloudEnt) {
          const st = stateFor(cloudEnt.entity_id);
          if (st) cloudState = st.state === 'on';
        }

        rows.push({
          device_id: d.id,
          name: d.name || d.model || d.id,
          model: d.model || '',
          ip,
          mac,
          firmware,
          cloud: cloudState,
          configuration_url: d.configuration_url || (ip ? `http://${ip}/` : ''),
        });
      }

      // Sort rows by name
      rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

      this._data = rows;
      this._loading = false;
      this._render();
    } catch (err) {
      this._error = String(err?.message || err);
      this._loading = false;
      this._render();
    }
  }

  connectedCallback() {
    this._render();
  }

  _render() {
    const style = `
      :host { display: block; padding: 16px; box-sizing: border-box; }
      h1 { font-size: 22px; margin: 8px 0 16px; }
      .card { background: var(--card-background-color, #fff); border-radius: 12px; padding: 16px; box-shadow: var(--ha-card-box-shadow); }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 10px; border-bottom: 1px solid var(--divider-color, #e0e0e0); }
      th { font-weight: 600; }
      .muted { color: var(--secondary-text-color); }
      .chip { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; }
      .ok { background: var(--success-color, #43a047); color: white; }
      .off { background: var(--error-color, #e53935); color: white; }
      .unknown { background: var(--warning-color, #fdd835); color: black; }
      .loading { opacity: 0.7; }
      a { color: var(--primary-color); text-decoration: none; }
      a:hover { text-decoration: underline; }
      .toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
      input[type="search"] { width: 280px; max-width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--divider-color); background: transparent; color: var(--primary-text-color); }
    `;

    const loading = this._loading;
    const error = this._error;
    const rows = this._data || [];
    const filter = this._filter || '';
    const shown = !filter ? rows : rows.filter((r) => {
      const hay = `${r.name} ${r.model} ${r.ip} ${r.mac} ${r.firmware}`.toLowerCase();
      return hay.includes(filter.toLowerCase());
    });

    const cloudChip = (val) => {
      if (val === true) return '<span class="chip ok">✓ Aan</span>';
      if (val === false) return '<span class="chip off">✕ Uit</span>';
      return '<span class="chip unknown">— Onbekend</span>';
    };

    this.shadowRoot.innerHTML = `
      <style>${style}</style>
      <div class="card ${loading ? 'loading' : ''}">
        <div class="toolbar">
          <h1>Shelly apparaten</h1>
          <input type="search" placeholder="Zoek (naam, model, IP, MAC, firmware)" value="${filter}"/>
        </div>
        ${error ? `<p class="muted">Fout: ${error}</p>` : ''}
        ${loading && !rows.length ? '<p class="muted">Laden…</p>' : ''}
        <div style="overflow:auto">
          <table aria-label="Shelly devices table">
            <thead>
              <tr>
                <th>Naam</th>
                <th>Model</th>
                <th>IP</th>
                <th>MAC</th>
                <th>Firmware</th>
                <th>Cloud</th>
              </tr>
            </thead>
            <tbody>
              ${shown.map((r) => `
                <tr>
                  <td>${r.device_id ? `<a href="/config/devices/device/${r.device_id}" target="_blank" rel="noreferrer noopener">${this._escape(r.name || '')}</a>` : this._escape(r.name || '')}</td>
                  <td>${this._escape(r.model || '')}</td>
                  <td>${r.ip ? `<a href="${this._escape(r.configuration_url)}" target="_blank" rel="noreferrer noopener">${this._escape(r.ip)}</a>` : '<span class="muted">—</span>'}</td>
                  <td>${r.mac ? this._escape(r.mac) : '<span class="muted">—</span>'}</td>
                  <td>${r.firmware ? this._escape(r.firmware) : '<span class="muted">—</span>'}</td>
                  <td>${cloudChip(r.cloud)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <p class="muted" style="margin-top:8px">Bron: device & entity registry via WebSocket API.</p>
      </div>
    `;

    // Wire search input
    const search = this.shadowRoot.querySelector('input[type="search"]');
    if (search) {
      search.oninput = (e) => {
        this._filter = e.target.value || '';
        this._render();
      };
    }

    // Wire sortable headers
    this.shadowRoot.querySelectorAll('th.sortable').forEach((th) => {
      th.onclick = () => {
        const key = th.getAttribute('data-key');
        this._toggleSort(key);
      };
    });
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
    arr.sort((a,b) => {
      const cmp = collator.compare(val(a), val(b));
      return dir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }

  _toggleSort(key) {
    if (!this._sort) this._sort = { key, dir: 'asc' };
    if (this._sort.key === key) {
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
