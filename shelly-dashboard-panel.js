// /local/shelly-dashboard-panel.js
// version 0.1.3
// Custom panel that lists all Shelly devices with: model, IP (clickable), MAC,
// and security/maintenance flags: Auth, Cloud, Bluetooth, Firmware up-to-date.
// How it works:
// - Uses Home Assistant WebSocket (hass.callWS) to read the device & entity registry
// - Detects Shelly devices by manufacturer === 'Shelly' OR by any entity from 'shelly' integration
// - IP address from device.configuration_url (fallback: *_wifi_ip entity)
// - MAC from device.connections
// - Cloud from a switch entity related to 'cloud'
// - Auth / Bluetooth: heuristics over entity names
// - Firmware up-to-date from update.* entity (installed_version vs latest_version)
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

      const entitiesByDevice = new Map();
      for (const ent of entities) {
        if (!entitiesByDevice.has(ent.device_id)) entitiesByDevice.set(ent.device_id, []);
        entitiesByDevice.get(ent.device_id).push(ent);
      }

      const stateFor = (entity_id) => this._hass?.states?.[entity_id];

      // Only real Shelly devices:
      const shellyDevices = devices.filter((d) => {
        const ents = entitiesByDevice.get(d.id) || [];
        const isShellyIntegration = ents.some((e) => e.platform === 'shelly');
        const isShellyManufacturer = d.manufacturer && String(d.manufacturer).toLowerCase() === 'shelly';
        return isShellyIntegration || isShellyManufacturer;
      });

      const rows = [];
      for (const d of shellyDevices) {
        const ents = entitiesByDevice.get(d.id) || [];

        // Primary entity for More Info
        const primaryEnt = ents.find((e) => stateFor(e.entity_id)) || ents[0];

        // IP
        let ip = '';
        if (d.configuration_url) {
          try {
            const url = new URL(d.configuration_url);
            ip = url.hostname;
          } catch {
            const raw = d.configuration_url.replace(/^https?:\/\//, '').replace(/\/$/, '');
            ip = raw.split('/')[0];
          }
        } else {
          const ipEnt = ents.find((e) => /wifi_?ip|ip_address/i.test(e.entity_id));
          if (ipEnt) {
            const st = stateFor(ipEnt.entity_id);
            if (st?.state && st.state !== 'unknown' && st.state !== 'unavailable') ip = st.state;
          }
        }

        // MAC
        let mac = '';
        if (Array.isArray(d.connections)) {
          const macConn = d.connections.find((c) => c[0] === 'mac');
          if (macConn) mac = macConn[1];
        }

        // Firmware version (raw string, optional)
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
            firmware = st?.state && st.state !== 'unknown' ? st.state : '';
          }
        }

        // Cloud state
        let cloudState = null;
        const cloudEnt = ents.find(
          (e) => e.domain === 'switch' && (/_cloud$/i.test(e.entity_id) || /cloud/i.test(e.original_name || e.name || ''))
        );
        if (cloudEnt) {
          const st = stateFor(cloudEnt.entity_id);
          if (st) cloudState = st.state === 'on';
        }

        // Auth (heuristic)
        let authState = null;
        const authEnt = ents.find(
          (e) =>
            /(auth|authentication|password|login)/i.test(e.entity_id) ||
            /(auth|authentication|password|login)/i.test(e.original_name || e.name || '')
        );
        if (authEnt) {
          const st = stateFor(authEnt.entity_id);
          if (st) authState = st.state === 'on' || st.state === 'true';
        }

        // Bluetooth
        let btState = null;
        const btEnt = ents.find(
          (e) => /bluetooth/i.test(e.entity_id) || /bluetooth/i.test(e.original_name || e.name || '')
        );
        if (btEnt) {
          const st = stateFor(btEnt.entity_id);
          if (st) btState = st.state === 'on';
        }

        // Firmware up-to-date?
        let fwUpToDate = null;
        if (updateEnt) {
          const st = stateFor(updateEnt.entity_id);
          const installed = st?.attributes?.installed_version || st?.attributes?.current_version;
          const latest = st?.attributes?.latest_version;
          if (installed && latest) fwUpToDate = installed === latest;
          else if (st) fwUpToDate = st.state === 'off'; // 'off' => no update available
        }

        rows.push({
          device_id: d.id,
          entity_id: primaryEnt ? primaryEnt.entity_id : '',
          name: d.name || d.model || d.id,
          model: d.model || '',
          ip,
          mac,
          firmware, // kept internally (not shown in table now)
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
      this._error = String(err?.message || err);
      this._loading = false;
      this._render();
    }
  }

  connectedCallback() { this._render(); }

  _render() {
    const style = `
      :host { display: block; padding: 16px; box-sizing: border-box; }
      h1 { font-size: 22px; margin: 8px 0 16px; }
      .card { background: var(--card-background-color, #fff); border-radius: 12px; padding: 16px; box-shadow: var(--ha-card-box-shadow); }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 10px; border-bottom: 1px solid var(--divider-color, #e0e0e0); }
      th { font-weight: 600; }
      th.sortable { cursor: pointer; user-select: none; }
      th.sortable .sort-indicator { opacity: 0.6; margin-left: 6px; font-size: 12px; }
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
      .linklike { background: none; border: none; padding: 0; margin: 0; color: var(--primary-color); text-decoration: none; cursor: pointer; font: inherit; }
      .linklike:hover { text-decoration: underline; }
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

    const icon = (val) => {
      if (val === true) return '<span class="chip ok">✓</span>';
      if (val === false) return '<span class="chip off">✕</span>';
      return '<span class="chip unknown">—</span>';
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
                <th class="sortable" data-key="name">Naam <span class="sort-indicator">${this._sort?.key==='name' ? (this._sort.dir==='asc'?'▲':'▼') : ''}</span></th>
                <th class="sortable" data-key="model">Model <span class="sort-indicator">${this._sort?.key==='model' ? (this._sort.dir==='asc'?'▲':'▼') : ''}</span></th>
                <th class="sortable" data-key="ip">IP <span class="sort-indicator">${this._sort?.key==='ip' ? (this._sort.dir==='asc'?'▲':'▼') : ''}</span></th>
                <th class="sortable" data-key="mac">MAC <span class="sort-indicator">${this._sort?.key==='mac' ? (this._sort.dir==='asc'?'▲':'▼') : ''}</span></th>
                <th class="sortable" data-key="auth">Auth <span class="sort-indicator">${this._sort?.key==='auth' ? (this._sort.dir==='asc'?'▲':'▼') : ''}</span></th>
                <th class="sortable" data-key="cloud">Cloud <span class="sort-indicator">${this._sort?.key==='cloud' ? (this._sort.dir==='asc'?'▲':'▼') : ''}</span></th>
                <th class="sortable" data-key="bluetooth">Bluetooth <span class="sort-indicator">${this._sort?.key==='bluetooth' ? (this._sort.dir==='asc'?'▲':'▼') : ''}</span></th>
                <th class="sortable" data-key="fwUpToDate">Firmware <span class="sort-indicator">${this._sort?.key==='fwUpToDate' ? (this._sort.dir==='asc'?'▲':'▼') : ''}</span></th>
              </tr>
            </thead>
            <tbody>
              ${shown.map((r) => `
                <tr>
                  <td>${r.entity_id ? `<button class="linklike more-info" data-entity="${this._escape(r.entity_id)}">${this._escape(r.name || '')}</button>` : this._escape(r.name || '')}</td>
                  <td>${this._escape(r.model || '')}</td>
                  <td>${r.ip ? `<a href="${this._escape(r.configuration_url)}" target="_blank" rel="noreferrer noopener">${this._escape(r.ip)}</a>` : '<span class="muted">—</span>'}</td>
                  <td>${r.mac ? this._escape(r.mac) : '<span class="muted">—</span>'}</td>
                  <td>${icon(r.auth)}</td>
                  <td>${icon(r.cloud)}</td>
                  <td>${icon(r.bluetooth)}</td>
                  <td>${icon(r.fwUpToDate)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <p class="muted" style="margin-top:8px">Bron: device & entity registry via WebSocket API.</p>
      </div>
    `;

    // Wire search
    const search = this.shadowRoot.querySelector('input[type="search"]');
    if (search) {
      search.oninput = (e) => { this._filter = e.target.value || ''; this._render(); };
    }

    // Wire sorting
    this.shadowRoot.querySelectorAll('th.sortable').forEach((th) => {
      th.onclick = () => {
        const key = th.getAttribute('data-key');
        this._toggleSort(key);
      };
    });

    // Wire More Info buttons
    this.shadowRoot.querySelectorAll('button.more-info[data-entity]').forEach((btn) => {
      btn.onclick = () => {
        const entityId = btn.getAttribute('data-entity');
        if (entityId) {
          const ev = new Event('hass-more-info', { bubbles: true, composed: true });
          ev.detail = { entityId };
          this.dispatchEvent(ev);
        }
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
    arr.sort((a, b) => {
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
