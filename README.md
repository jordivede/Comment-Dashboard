# Figma Comment Dashboard Plugin

A Figma plugin to view and manage comments in a dashboard interface.

## Features

- 📊 View all comments from a Figma file
- 🔍 Filter comments by author, status, age, and more
- 🎯 Navigate to comment locations in the file
- 📈 Summary statistics and insights
- 🎨 Figma-native UI design

## Setup

1. Clone this repository
2. Open Figma Desktop App
3. Go to Plugins > Development > Import plugin from manifest
4. Select the `manifest.json` file

## Configuration

The plugin requires an OAuth token with `file_comments:read` scope to fetch comments from the Figma REST API.

## Development

This plugin is written in **pure JavaScript** (no TypeScript or build step required).

## Files

- `code.js` - Main plugin code (runs in Figma's plugin sandbox)
- `ui.html` - Plugin UI with inline CSS and JavaScript
- `manifest.json` - Plugin configuration

## License

MIT
