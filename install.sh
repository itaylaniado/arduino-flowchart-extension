#!/bin/bash

# Get the latest release download URL
LATEST_RELEASE=$(curl -s "https://api.github.com/repos/itaylaniado/arduino-flowchart-extension/releases")
VSIX_URL=$(echo "$LATEST_RELEASE" | grep -o '"browser_download_url": "[^"]*\.vsix"' | head -1 | cut -d'"' -f4)

if [ -z "$VSIX_URL" ]; then
  echo "Error: Could not find VSIX in latest release"
  exit 1
fi

# Determine the plugin directory based on OS
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS
  PLUGIN_DIR="$HOME/.arduinoIDE/plugins/arduino-flowchart"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
  # Linux
  PLUGIN_DIR="$HOME/.arduinoIDE/plugins/arduino-flowchart"
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
  # Windows
  PLUGIN_DIR="$APPDATA/.arduinoIDE/plugins/arduino-flowchart"
else
  echo "Unsupported OS"
  exit 1
fi

# Create plugin directory if it doesn't exist
mkdir -p "$PLUGIN_DIR"

# Download and extract
TEMP_DIR=$(mktemp -d)
curl -L "$VSIX_URL" -o "$TEMP_DIR/extension.vsix"
unzip -q "$TEMP_DIR/extension.vsix" -d "$PLUGIN_DIR"
rm -rf "$TEMP_DIR"

echo "Successfully installed Arduino Flowchart extension to $PLUGIN_DIR"