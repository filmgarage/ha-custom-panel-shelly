# Shelly Dashboard Panel for Home Assistant

A custom **panel_custom** for Home Assistant that lists all **Shelly devices** in a clean, sortable table. It displays essential information such as model, IP address, MAC address, firmware version, and cloud connection status.

## ✨ Features

* 📋 Displays all Shelly devices detected by Home Assistant
* 🔗 Clickable IP addresses (opens the device’s web UI)
* ☁️ Cloud connection indicators (on/off/unknown)
* 🔍 Search filter for quick lookups
* ↕️ Sortable columns (click column headers to sort)
* ⚙️ Uses Home Assistant’s WebSocket API for live device data

## 📦 Installation

1. **Copy the file**
   Save the JavaScript file as:

   ```bash
   /config/www/shelly-dashboard-panel.js
   ```

2. **Add to `configuration.yaml`**
   Add the following section to your Home Assistant configuration and restart:

   ```yaml
   panel_custom:
     - name: shelly-dashboard-panel
       sidebar_title: Shelly
       sidebar_icon: mdi:chip
       url_path: shelly
       module_url: /local/shelly-dashboard-panel.js
   ```

3. **Restart Home Assistant**
   Restart to load the new custom panel.

4. **Access the Dashboard**
   Open the new **Shelly** entry in your Home Assistant sidebar.

## 🧠 How It Works

* Retrieves the **device registry** and **entity registry** using the WebSocket API.
* Filters all devices manufactured by **Shelly** or entities from the **Shelly integration**.
* Extracts information from device attributes and entities:

  * **Model**: from the device registry.
  * **IP**: from `configuration_url` or entities with IP-related attributes.
  * **MAC**: from the device’s connection info.
  * **Firmware**: from update entities (`update.*`).
  * **Cloud**: from switch entities (`*_cloud`).
* Displays the data in a dynamic, searchable, sortable table.

## 🔐 Security

This panel is part of the authenticated Home Assistant frontend:

* Only logged-in users can access it.
* No public or anonymous access is possible.

## 🛠️ Customization

You can easily extend the panel:

* Add more columns (e.g., RSSI, power usage)
* Integrate More Info dialogs for entity details
* Apply custom styling using Home Assistant’s themes

## 🧩 Compatibility

* Works with both Shelly Gen 1 and Gen 2 devices (as long as they appear in the device registry)
* Requires Home Assistant 2023.8 or newer

## 🧑‍💻 Credits

Developed by [Filmgarage](https://github.com/filmgarage) and assisted by AI — inspired by the need for a clear overview of Shelly devices within Home Assistant.
