# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2025-10-27

### Added

* **Refresh button** to manually reload device data
* **Enhanced IP detection** with multiple fallback methods (configuration_url, wifi_ip entities, sensor scanning)
* **Keyboard event handling** to prevent Home Assistant shortcuts from interfering with search input
* **Improved status tooltips** showing "Active", "Inactive", or "Unknown"
* **Better visual feedback** with hover effects on table rows and status chips

### Changed

* **Smart primary entity selection** now prioritizes light > switch > cover > other entities
* **All UI text and code comments** translated to English for broader accessibility
* **Enhanced error messages** with visual styling and clearer descriptions
* **Improved responsive design** for mobile devices
* **Better status indicators** with clearer symbols (✓, ✗, —) and consistent styling

### Fixed

* IP address now reliably detected for all device types including multi-relay devices
* Search field no longer triggers Home Assistant keyboard shortcuts (e.g., pressing "E")
* More consistent primary entity selection across different Shelly device models
* Better error handling with console logging for debugging

---

## [0.1.3] - 2025-10-27

### Added

* **More Info popups** when clicking a device name (opens HA’s native dialog)
* **Filtering** now includes only real Shelly devices (manufacturer or integration)
* **New columns** for key device states:

  * Auth (authentication active)
  * Cloud (connected to Shelly Cloud)
  * Bluetooth (on/off)
  * Firmware (up-to-date indicator)
* **Improved UI** with green checkmarks for enabled features and compact styling.

### Changed

* Updated table rendering for better performance.
* Simplified sorting and search logic.

### Fixed

* Devices with non-Shelly names are no longer falsely included.

---

## [0.1.2] - 2025-10-27

### Added

* Sorting functionality for all table columns (ascending/descending)
* Clickable device names linking to the Home Assistant device page
* Improved visual styling and hover effects

### Fixed

* Minor rendering issues with long firmware names
* Improved IP parsing for devices without `configuration_url`

---

## [0.1.1] - 2025-10-20

### Initial Release

* First public version of **Shelly Dashboard Panel** for Home Assistant
* Lists all Shelly devices with model, IP, MAC, firmware, and cloud connectivity
* Search filter and responsive table layout
