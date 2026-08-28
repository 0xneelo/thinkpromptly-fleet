#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
mkdir -p .fleetdeck
xcrun swiftc -O -framework AppKit -framework ApplicationServices \
  mac/ClaudeDesktopSend.swift -o .fleetdeck/claude-desktop-send
