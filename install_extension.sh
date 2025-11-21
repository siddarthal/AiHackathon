#!/bin/bash

# Raasi AI Extension - Quick Install Script

echo "🚀 Raasi AI Extension Installer"
echo "================================"
echo ""

# Check if VS Code is installed
if ! command -v code &> /dev/null; then
    echo "❌ VS Code command 'code' not found!"
    echo "   Make sure VS Code is installed and 'code' command is in PATH"
    echo "   In VS Code: Cmd+Shift+P → 'Shell Command: Install code command in PATH'"
    exit 1
fi

echo "✓ VS Code found"

# Check if extension file exists
EXTENSION_FILE="./vscode-extension/raasi-ai-1.0.0.vsix"
if [ ! -f "$EXTENSION_FILE" ]; then
    echo "❌ Extension file not found: $EXTENSION_FILE"
    exit 1
fi

echo "✓ Extension file found"
echo ""

# Install extension
echo "📦 Installing Raasi AI extension..."
code --install-extension "$EXTENSION_FILE"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Raasi AI extension installed successfully!"
    echo ""
    echo "📝 Next steps:"
    echo "   1. Start the backend: python main.py"
    echo "   2. Open VS Code and reload window (Cmd+Shift+P → 'Reload Window')"
    echo "   3. Open chat: Cmd+Shift+P → 'Raasi: Open Chat'"
    echo ""
    echo "🎉 Happy coding with Raasi AI!"
else
    echo ""
    echo "❌ Installation failed!"
    echo "   Try installing manually from VS Code Extensions view"
    exit 1
fi


