# Changelog

All notable changes to this project will be documented in this file.

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
