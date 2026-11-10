# Changelog

## 0.2.0

### Added

- Support for the Kimetsu 2.11.0 peer network. Pi tools `kimetsu_network_status`
  and `kimetsu_network_request`, plus `/kimetsu-network-status`,
  `/kimetsu-network-request`, and `/kimetsu-network-share`.
- A `kimetsu --version` check before any network command. Older binaries and
  builds without the `network` feature explain the gap. Nothing listens in
  that case.
- Sharing stays a terminal command. The extension never starts
  `kimetsu network share`. `/kimetsu-network-share` only prints it. The relay
  stays off, and only a signed, scrubbed repo pack is sent.
- Request passes `--no-mdns` unless discovery is requested, and `--map-ports`
  only when asked. The process is killed on the 60-second deadline or when Pi
  cancels the call.

### Security

- Pin the development-only `undici` dependency to 8.12.4 so the audit gate
  clears the high-severity advisories in 8.12.1 and earlier. Pi itself stays
  on 1.2.0.

## 0.1.5

- Pi 1.2.0 compatibility for custom-triggered turns, and integration coverage
  against the Kimetsu 2.8.0 CLI.

## 0.1.4

- Fresh memory per task, a five-minute session-save deadline, and guidance for
  corrections and usefulness feedback.
